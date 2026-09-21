'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { doctor, collectChecks, playbackEngines, smoke } = require('../lib/doctor.js');
// R207：captureStdout 已抽到 test/helpers/capture.js（三个测试文件共用一份）。
const { captureStdout } = require('./helpers/capture.js');
// M2 任务 10：写闭环用假场景后端驱动（不 spawn 真实进程，见 test/helpers/fake-scene.js）。
const { makeFakeSceneBackend } = require('./helpers/fake-scene.js');

const FAKE = path.join(__dirname, 'fixtures', 'fake-uloop.js');

/** 造一个必定不存在的目录路径（用于隔离发现逻辑的注入来源）。 */
function nonexistent(...parts) {
  return path.join(os.tmpdir(), `piu-nonexistent-${process.pid}-${Math.random().toString(36).slice(2)}`, ...parts);
}

/** 造一个只含空 dispatcher 的临时仓库根（覆盖 findDispatcher 的 uloop-bin 档）。 */
function tempRepoWithUloopBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-bin-'));
  const bin = path.join(root, 'uloop-bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'uloop.exe' : 'uloop'), '');
  return root;
}

/** 构造假的 run 结果工厂（注入 runImpl，绝不 spawn 真实进程）。 */
function fakeRun(partial) {
  return async () => ({ code: 0, stdout: '', stderr: '', timedOut: false, drained: false, ...partial });
}

/**
 * 用假场景后端驱动整条 `--smoke`：补上只读三工具里不属于场景后端的 `compile`/`get-logs`，
 * 并允许 `override(tool, args)` **在触碰后端之前**返回**替换结果**（返回 falsy 表示用真实后端）。
 *
 * ⚠️ override 必须先于 `be.call`：否则「假装写成功但实际没写」这类用例会先被后端真的写一遍。
 */
function smokeCall(be, override) {
  return async (tool, args) => {
    if (tool === 'compile') return { code: 0, json: { Success: true, ErrorCount: 0, WarningCount: 0 }, truncated: false, tool, args };
    if (tool === 'get-logs') return { code: 0, json: { Success: true, TotalCount: 0, DisplayedCount: 0, Logs: [] }, truncated: false, tool, args };
    if (override) {
      const replaced = override(tool, args);
      if (replaced) return replaced;
    }
    return be.call(tool, args);
  };
}

test('playbackEngines 枚举已安装的构建目标', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piupe-'));
  fs.mkdirSync(path.join(root, 'Data', 'PlaybackEngines', 'WebGLSupport'), { recursive: true });
  assert.deepStrictEqual(playbackEngines(root), ['WebGLSupport']);
  // 目录不存在时早返回空数组（边界）
  assert.deepStrictEqual(playbackEngines(nonexistent()), []);
});

test('uloop 可用时对应检查项 pass', async () => {
  const checks = await collectChecks({
    env: { ...process.env, FAKE_MODE: 'ok', PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
  });
  const uloop = checks.find((c) => c.name === 'uloop');
  assert.strictEqual(uloop.status, 'pass');
});

test('editor-connection 认 dispatcher 级 list 形状 {Version,Tools}（R115 真机形状）', async () => {
  // 2026-09-19 真机：`uloop list` 的响应是 `{Version, Tools}`，**没有** `Success` 字段
  //（`uloop list` 是 dispatcher 级命令，不是 first-party 工具）。fixture 的 `ok` 载荷
  //（test/fixtures/fake-uloop.js）就是同一形状，但此前没有任何用例以**真实 `list` 形状**断言
  // connection pass（其它 connection-pass 用例都把载荷手写成 `{Success:true,...}`）——
  // 于是「`Success === true` 才 pass」这条（为 first-party 工具定的）判据被套在 `list` 上，
  // 把「编辑器明明连着」报成 `无法连接（退出码 0）`（假红，doctor 永远不绿）。
  const appData = nonexistent('appdata');
  const checks = await collectChecks({
    env: { APPDATA: appData, FAKE_MODE: 'ok', PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
    appData,
    rootDir: nonexistent('repo'),
  });
  const conn = checks.find((c) => c.name === 'editor-connection');
  assert.strictEqual(conn.status, 'pass');
  assert.match(conn.message, /已连接/);
  assert.match(conn.message, /3\.4\.0/);
  assert.deepStrictEqual(conn.hint, []);
});

test('dispatcher 级 list 形状的判据仍然有鉴别力：显式 Success:false / 裸对象一律 fail（R115）', async () => {
  const appData = nonexistent('appdata');
  const env = { APPDATA: appData, PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) };
  const rootDir = nonexistent('repo');
  // ① 显式 Success:false（即使带了 Version/Tools）→ 不算连上
  const failed = await collectChecks({
    env, appData, rootDir,
    runImpl: fakeRun({ code: 1, stderr: JSON.stringify({ Success: false, Version: '3.4.0', Tools: [], Error: { Message: 'nope' } }) }),
  });
  assert.strictEqual(failed.find((c) => c.name === 'editor-connection').status, 'fail');
  // ② 裸对象（既无 Success 也无 list 形状）→ 不算连上（R15 的本意：别的程序不算 dispatcher）
  const bare = await collectChecks({ env, appData, rootDir, runImpl: fakeRun({ code: 0, stdout: '{"hello":1}' }) });
  assert.strictEqual(bare.find((c) => c.name === 'editor-connection').status, 'fail');
});

test('uloop 连不上时对应检查项 fail 且带上 hint', async () => {
  const checks = await collectChecks({
    env: { ...process.env, FAKE_MODE: 'fail', PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
  });
  const conn = checks.find((c) => c.name === 'editor-connection');
  assert.strictEqual(conn.status, 'fail');
  assert.ok(conn.hint && conn.hint.length > 0);
  // R27：失败响应也带 json（uloop 把错误对象写到 stderr），message 必须按**状态**分流，
  // 否则会出现「状态 fail 但文案说已连接」的矛盾。
  assert.doesNotMatch(conn.message, /已连接/);
  assert.match(conn.message, /not reachable/);   // fake-uloop 的 Error.Message 就是 'not reachable'
});

test('uloop 配置无效或指向不存在的文件时 fail（R29）', async () => {
  const appData = nonexistent('appdata');
  const rootDir = nonexistent('repo');

  // BIN 指向不存在的文件：findDispatcher 会跳过它并回落裸名，此时绝不能判 pass，
  // 否则用户配置的错误路径在报告里根本不出现（与 R23 同型的假绿）。
  const bin = await collectChecks({
    env: { APPDATA: appData, PI_UNITY_ULOOP_BIN: path.join(nonexistent('typo'), 'uloop.exe') },
    appData,
    rootDir,
  });
  assert.strictEqual(bin.find((c) => c.name === 'uloop').status, 'fail');

  // CMD 是合法 JSON 但元素是数字：cmd 为 123，必须被 typeof 守卫挡住且不得
  // 让 fs.existsSync(123) 抛 ERR_INVALID_ARG_TYPE。
  const num = await collectChecks({
    env: { APPDATA: appData, PI_UNITY_ULOOP_CMD: '[123]' },
    appData,
    rootDir,
  });
  assert.strictEqual(num.find((c) => c.name === 'uloop').status, 'fail');

  // CMD 是空数组：无有效 cmd，同样回落裸名 → fail。
  const empty = await collectChecks({
    env: { APPDATA: appData, PI_UNITY_ULOOP_CMD: '[]' },
    appData,
    rootDir,
  });
  assert.strictEqual(empty.find((c) => c.name === 'uloop').status, 'fail');
});

test('uloop-bin 中存在 dispatcher 时 uloop pass（R30）', async () => {
  const appData = nonexistent('appdata');
  const checks = await collectChecks({
    env: { APPDATA: appData },
    appData,
    rootDir: tempRepoWithUloopBin(),
    // 注入假 run：本轮 found=true 会走到 call()，不得 spawn 真实进程
    runImpl: fakeRun({ code: 0, stdout: '{"Success":true,"Version":"1.2.3"}' }),
  });
  const uloop = checks.find((c) => c.name === 'uloop');
  assert.strictEqual(uloop.status, 'pass');
  assert.match(uloop.message, /uloop-bin/);
  const conn = checks.find((c) => c.name === 'editor-connection');
  assert.strictEqual(conn.status, 'pass');
});

test('spawnError 时不谎报截断/已连接，hint 指向 dispatcher 配置（R31）', async () => {
  const appData = nonexistent('appdata');
  const checks = await collectChecks({
    env: { APPDATA: appData, PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
    appData,
    rootDir: nonexistent('repo'),
    runImpl: fakeRun({ code: -1, spawnError: new Error('spawn ENOENT') }),
  });
  const conn = checks.find((c) => c.name === 'editor-connection');
  assert.strictEqual(conn.status, 'fail');
  assert.match(conn.message, /无法启动 dispatcher/);
  assert.match(conn.message, /spawn ENOENT/);
  assert.doesNotMatch(conn.message, /已连接/);
  assert.doesNotMatch(conn.message, /输出被截断/);
  assert.ok(Array.isArray(conn.hint) && conn.hint.length > 0);
  assert.match(conn.hint.join(' '), /PI_UNITY_ULOOP_BIN/);
  assert.match(conn.hint.join(' '), /PI_UNITY_ULOOP_CMD/);
});

test('超时/截断时保留「输出被截断，可重试」文案（R31）', async () => {
  const appData = nonexistent('appdata');
  for (const truncation of [{ timedOut: true }, { drained: true }]) {
    const checks = await collectChecks({
      env: { APPDATA: appData, PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
      appData,
      rootDir: nonexistent('repo'),
      runImpl: fakeRun({ code: 0, stdout: '{"Success":', ...truncation }),
    });
    const conn = checks.find((c) => c.name === 'editor-connection');
    assert.strictEqual(conn.status, 'fail');
    assert.match(conn.message, /输出被截断，可重试/);
    assert.doesNotMatch(conn.message, /无法启动 dispatcher/);
  }
});

test('NextActions 非数组时 hint 归一为数组且不崩（R34）', async () => {
  const appData = nonexistent('appdata');
  for (const nextActions of ['去设置一下', true, 42]) {
    const checks = await collectChecks({
      env: { APPDATA: appData, PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
      appData,
      rootDir: nonexistent('repo'),
      runImpl: fakeRun({
        code: 1,
        stderr: JSON.stringify({ Success: false, Error: { Message: 'bad payload', NextActions: nextActions } }),
      }),
    });
    const conn = checks.find((c) => c.name === 'editor-connection');
    assert.strictEqual(conn.status, 'fail');
    assert.match(conn.message, /bad payload/);
    assert.ok(Array.isArray(conn.hint), `hint 必须是数组，收到 ${JSON.stringify(nextActions)}`);
    assert.deepStrictEqual(conn.hint, []);
  }
});

test('找不到编辑器时 fail 并列出已尝试路径', async () => {
  const checks = await collectChecks({
    // R25：Program Files 指向不存在的目录，隔离第 4 层，避免真实 Unity Hub 让断言假红
    // R33：显式中和 PI_UNITY_EDITOR_BIN（本项目文档教的变量），否则任何导出过它的机器上会假红
    env: {
      ...process.env,
      FAKE_MODE: 'fail',
      PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]),
      PI_UNITY_EDITOR_BIN: undefined,
      ProgramFiles: nonexistent('pf'),
      'ProgramFiles(x86)': nonexistent('pf86'),
    },
    appData: nonexistent('appdata'),
  });
  const ed = checks.find((c) => c.name === 'editor-install');
  assert.strictEqual(ed.status, 'fail');
  assert.match(ed.message, /PI_UNITY_EDITOR_BIN/);
});

test('smoke 探活同样认 dispatcher 级 list 形状（R115）', async () => {
  const runImpl = async (cmd, args) => {
    if (args.includes('list')) return { code: 0, stdout: JSON.stringify({ Version: '3.4.0', Tools: [{ Name: 'compile' }] }) };
    if (args.includes('compile')) return { code: 0, stdout: JSON.stringify({ Success: true, ErrorCount: 0, WarningCount: 0 }) };
    if (args.includes('get-logs')) return { code: 0, stdout: JSON.stringify({ Success: true, TotalCount: 0 }) };
    if (args.includes('get-hierarchy')) return { code: 0, stdout: JSON.stringify({ Success: true, HierarchyFilePath: 'C:/tmp/h.json' }) };
    throw new Error(`unexpected tool: ${args.join(' ')}`);
  };
  const results = await smoke({ env: { APPDATA: nonexistent('appdata') }, runImpl });
  // R205：smoke 现在 = 3 个只读工具 + 4 个写闭环项；本用例只注入只读三工具。
  assert.strictEqual(results.length, 7, 'smoke = 3 个只读工具 + 4 个写闭环项');
  assert.deepStrictEqual(results.slice(0, 3).map((r) => r.status), ['pass', 'pass', 'pass']);
});

test('smoke 汇总每项结果，失败的记为 fail 并带 hint', async () => {
  // F5：真的落到 per-tool **fail** 分支（探活成功、compile 失败），而不是靠全 skip 路径蒙混；
  // 断言也改成精确的状态序列 + hint 内容，不再用对硬编码三态恒真的 `includes`。
  const nextAction = '打开 Console 查看编译错误';
  const runImpl = async (cmd, args) => {
    if (args.includes('list')) return { code: 0, stdout: JSON.stringify({ Success: true, Version: '3.4.0' }) };
    if (args.includes('compile')) {
      return { code: 1, stderr: JSON.stringify({ Success: false, Error: { Message: 'CS1040: bad', NextActions: [nextAction] } }) };
    }
    if (args.includes('get-logs')) return { code: 0, stdout: JSON.stringify({ Success: true, TotalCount: 0 }) };
    if (args.includes('get-hierarchy')) return { code: 0, stdout: JSON.stringify({ Success: true, HierarchyFilePath: 'C:/tmp/h.json' }) };
    throw new Error(`unexpected tool: ${args.join(' ')}`);
  };
  const results = await smoke({ env: { APPDATA: nonexistent('appdata') }, runImpl });
  assert.strictEqual(results.length, 7);
  assert.deepStrictEqual(results.slice(0, 3).map((r) => r.status), ['fail', 'pass', 'pass']);
  const failed = results.find((r) => r.name === 'compile');
  assert.ok(failed.hint.length > 0, '失败项必须带 hint');
  assert.deepStrictEqual(failed.hint, [nextAction]);
});

test('smoke 在连不上编辑器时全部 skip（不抛异常）', async () => {
  const results = await smoke({
    env: { ...process.env, FAKE_MODE: 'fail', PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
  });
  assert.strictEqual(results.length, 7, '全 skip 时七项都要出现（不是只报只读三工具）');
  // R304⑦：全 skip 也必须是**同一份七项清单**（名字逐字）—— 与成功路径一份真值。
  assert.deepStrictEqual(results.map((r) => r.name), [
    'compile', 'get-logs', 'get-hierarchy', 'write-create', 'write-set', 'write-delete', 'write-clean',
  ]);
  assert.ok(results.every((r) => r.status === 'skip'));
  assert.ok(results.every((r) => r.code === 'NOT_CONNECTED'), '探活失败的 skip 用 NOT_CONNECTED');
  assert.ok(results[0].hint.length > 0);
  // F5：七项不得共享同一个 hint 数组实例 —— 否则任一处 push 会污染其它项。
  assert.strictEqual(new Set(results.map((r) => r.hint)).size, 7, 'skip 七项不得共享 hint 数组');
});

test('smoke 三个工具全 pass 时 message 来自 pick（R36）', async () => {
  // 注入假 run 并按 args 里的工具名分派载荷 —— 覆盖简报两条用例到不了的 pass 路径
  const runImpl = async (cmd, args) => {
    if (args.includes('list')) return { code: 0, stdout: JSON.stringify({ Success: true, Version: '3.4.0' }) };
    if (args.includes('compile')) return { code: 0, stdout: JSON.stringify({ Success: true, ErrorCount: 0, WarningCount: 2 }) };
    if (args.includes('get-logs')) return { code: 0, stdout: JSON.stringify({ Success: true, TotalCount: 5 }) };
    if (args.includes('get-hierarchy')) return { code: 0, stdout: JSON.stringify({ Success: true, HierarchyFilePath: 'C:/tmp/hierarchy.json' }) };
    throw new Error(`unexpected tool: ${args.join(' ')}`);
  };
  const results = await smoke({ env: { APPDATA: nonexistent('appdata') }, projectPath: 'C:/proj', runImpl });
  assert.deepStrictEqual(results.map((r) => r.name), [
    'compile', 'get-logs', 'get-hierarchy', 'write-create', 'write-set', 'write-delete', 'write-clean',
  ], '七项名字与顺序固定');
  assert.strictEqual(results.length, 7, 'R304⑧：名字断言之外再钉死数量');
  // R205：本用例的 runImpl 只覆盖只读三工具；写闭环四项由新增用例（_call: makeFakeSceneBackend）覆盖。
  assert.deepStrictEqual(results.slice(0, 3).map((r) => r.status), ['pass', 'pass', 'pass']);
  assert.match(results[0].message, /errors=0 warnings=2/);
  assert.match(results[1].message, /total=5/);
  assert.match(results[2].message, /C:\/tmp\/hierarchy\.json/);
  for (const r of results.slice(0, 3)) assert.deepStrictEqual(r.hint, []);
});

test('smoke 在 Success 为真但字段缺失时判 fail 并点名缺失字段（R38）', async () => {
  const runImpl = async () => ({ code: 0, stdout: JSON.stringify({ Success: true }) });
  const results = await smoke({ env: { APPDATA: nonexistent('appdata') }, runImpl });
  assert.strictEqual(results.length, 7);
  assert.deepStrictEqual(results.slice(0, 3).map((r) => r.status), ['fail', 'fail', 'fail']);
  assert.match(results[0].message, /ErrorCount/);
  assert.match(results[0].message, /WarningCount/);
  assert.match(results[1].message, /TotalCount/);
  assert.match(results[2].message, /HierarchyFilePath/);
  for (const r of results.slice(0, 3)) assert.deepStrictEqual(r.hint, []);
});

test('doctor --smoke 全 skip → 退出码 1 / ok=false，有 pass 无 fail → 退出码 0 / ok=true（R39/R41）', async () => {
  // 注入假 dispatcher 只为让 RED 阶段（runImpl 尚未透传）不落到 PATH 上 spawn 真实 uloop.exe；
  // GREEN 阶段 runImpl 优先，不再 spawn。
  const env = { ...process.env, PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) };
  const rootDir = nonexistent('repo');

  // 场景①：探活失败（Success 非 true）→ 三项全 skip。此时**必须**是失败退出码（R39），
  // 否则「基础检查返回 1、--smoke 返回 0」自相矛盾，且属 falsely-pass。
  const skipRun = fakeRun({
    code: 1,
    stderr: JSON.stringify({ Success: false, Error: { Message: 'not reachable' } }),
  });
  const skipped = await captureStdout(() => doctor(['--smoke', '--json'], { env, rootDir, runImpl: skipRun }));
  assert.strictEqual(skipped.result, 1, '全 skip 不得返回 0（R39）');
  const skippedJson = JSON.parse(skipped.out);
  assert.strictEqual(skippedJson.ok, false);
  // R205：键名 results → checks；全 skip 覆盖七项（含写闭环四项）
  assert.deepStrictEqual(skippedJson.checks.map((r) => r.status), ['skip', 'skip', 'skip', 'skip', 'skip', 'skip', 'skip']);

  // 场景②：探活 + 三个只读工具 + 写闭环四项全 pass → 退出码 0 / ok=true
  // R205：写闭环必须用假场景后端驱动（runImpl 注入只覆盖只读三工具）。
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const passCall = async (tool, args) => {
    if (tool === 'compile') return { code: 0, json: { Success: true, ErrorCount: 0, WarningCount: 0 }, truncated: false, tool, args };
    if (tool === 'get-logs') return { code: 0, json: { Success: true, TotalCount: 0 }, truncated: false, tool, args };
    return be.call(tool, args);
  };
  const passed = await captureStdout(() => doctor(['--smoke', '--json', '--project-path', 'P'], { env, rootDir, _call: passCall }));
  assert.strictEqual(passed.result, 0, '至少一项 pass 且无 fail 才算通过');
  const passedJson = JSON.parse(passed.out);
  assert.strictEqual(passedJson.ok, true);
  assert.deepStrictEqual(passedJson.checks.map((r) => r.status), ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass']);

  // 场景③（F4/R45）：人读路径的尾行必须如实说明「未验证任何工具」，条件只看是否有 skip，
  // 不再要求「既无 pass 也无 fail」——否则措辞与 ok 的语义会不一致。
  const human = await captureStdout(() => doctor(['--smoke'], { env, rootDir, runImpl: skipRun }));
  assert.strictEqual(human.result, 1);
  assert.match(human.out, /冒烟未执行（7 项被跳过）：未能验证任何工具/);
});

test('smoke per-tool 输出被截断（drained, code=0）判 fail 且点明截断，不误报「退出码 0」（R42）', async () => {
  const runImpl = async (cmd, args) => (args.includes('list')
    ? { code: 0, stdout: JSON.stringify({ Success: true, Version: '3.4.0' }) }
    // drained：code=0 且 timedOut=false，是唯一能识别「输出被截断」的信号（见 lib/uloop.js 契约）
    : { code: 0, stdout: '{"Success":', drained: true });
  const results = await smoke({
    env: { ...process.env, PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
    rootDir: nonexistent('repo'),
    runImpl,
  });
  assert.strictEqual(results.length, 7);
  assert.deepStrictEqual(results.slice(0, 3).map((r) => r.status), ['fail', 'fail', 'fail']);
  for (const r of results.slice(0, 3)) {
    // F1：per-tool 文案是**整句**，不得复用中缀片段（全角冒号开头会被误当格式化 bug），
    // 也不得在 code=0 时拿「退出码 0」冒充原因（那正是 R42 要消灭的退化）。
    assert.doesNotMatch(r.message, /^：/, `${r.name} 的文案不得以全角冒号开头（中缀片段误当整句）`);
    assert.doesNotMatch(r.message, /（退出码 0）/, `${r.name} 的文案不得把「退出码 0」当原因`);
    assert.match(r.message, /截断/, `${r.name} 的文案必须点明截断`);
  }
});

test('smoke per-tool 失败文案是整句：三种形态都不以「：」开头、不拿「退出码 0」当原因（F1/R44）', async () => {
  // ① Success:false 且无 Error.Message（code=0）——旧写法会产出 `（退出码 0）`；
  // ② Error.Message 存在（code=1，编译类错误）——旧写法会以孤立全角冒号开头；
  // ③ code=0 但 stdout 非 JSON（fixture 的 nojson 形态，**不是** drained/timedOut）。
  const cases = [
    {
      label: '无原因',
      result: { code: 0, stdout: JSON.stringify({ Success: false }) },
      expected: /^工具报告失败且未给出原因$/,
    },
    {
      label: '有原因',
      result: { code: 1, stderr: JSON.stringify({ Success: false, Error: { Message: 'CS1040: bad' } }) },
      expected: /^工具报告失败：CS1040: bad（退出码 1）$/,
    },
    {
      label: '非 JSON',
      result: { code: 0, stdout: 'not json at all\n' },
      expected: /^工具报告失败且未给出原因$/,
    },
  ];
  for (const c of cases) {
    const runImpl = async (cmd, args) => (args.includes('list')
      ? { code: 0, stdout: JSON.stringify({ Success: true, Version: '3.4.0' }) }
      : c.result);
    const results = await smoke({ env: { APPDATA: nonexistent('appdata') }, runImpl });
    assert.strictEqual(results.length, 7, c.label);
    assert.deepStrictEqual(results.slice(0, 3).map((r) => r.status), ['fail', 'fail', 'fail'], c.label);
    for (const r of results.slice(0, 3)) {
      assert.doesNotMatch(r.message, /^：/, `${c.label}/${r.name} 不得以全角冒号开头`);
      assert.doesNotMatch(r.message, /（退出码 0）/, `${c.label}/${r.name} 不得把「退出码 0」当原因`);
      assert.match(r.message, c.expected, `${c.label}/${r.name} 文案形态`);
    }
  }
});

test('smoke per-tool spawnError 时 hint 指向 dispatcher 配置（F3/R46）', async () => {
  // call 契约：spawnError 时 json 必为 null，errorNextActions(json) 必为 []（R37）；
  // 若不给 hint，per-tool 的 spawnError 会比探活/collectChecks 少一条排障提示。
  const runImpl = async (cmd, args) => (args.includes('list')
    ? { code: 0, stdout: JSON.stringify({ Success: true, Version: '3.4.0' }) }
    : { code: -1, spawnError: new Error('spawn ENOENT'), stdout: '', stderr: '' });
  const results = await smoke({ env: { APPDATA: nonexistent('appdata') }, runImpl });
  // R205：spawnError 只注入到只读三工具；写闭环四项的错误码不同，故只遍历前三项。
  assert.strictEqual(results.length, 7);
  assert.deepStrictEqual(results.slice(0, 3).map((r) => r.status), ['fail', 'fail', 'fail']);
  for (const r of results.slice(0, 3)) {
    assert.match(r.message, /无法启动 dispatcher/);
    assert.ok(r.hint.length > 0, `${r.name} 的 spawnError hint 不得为空`);
    assert.match(r.hint.join(' '), /PI_UNITY_ULOOP_BIN/);
  }
});

test('smoke per-tool 在已连接状态下失败时不谎称「无法连接」，保留工具报错（R43）', async () => {
  // 探活成功（编辑器确实连着），只有 compile 返回 Success:false —— 这是**工具级**失败，
  // 不是连接失败。文案必须保留 uloop 的 Error.Message，且不得出现「无法连接」，
  // 否则用户会去查连接/编辑器，而不是看编译报错。
  const compileError = 'CS1040: Preprocessor directives must appear as the first non-whitespace character on a line';
  const runImpl = async (cmd, args) => {
    if (args.includes('list')) return { code: 0, stdout: JSON.stringify({ Success: true, Version: '3.4.0' }) };
    if (args.includes('compile')) return { code: 1, stderr: JSON.stringify({ Success: false, Error: { Message: compileError } }) };
    if (args.includes('get-logs')) return { code: 0, stdout: JSON.stringify({ Success: true, TotalCount: 0 }) };
    if (args.includes('get-hierarchy')) return { code: 0, stdout: JSON.stringify({ Success: true, HierarchyFilePath: 'C:/tmp/h.json' }) };
    throw new Error(`unexpected tool: ${args.join(' ')}`);
  };
  const results = await smoke({
    env: { ...process.env, PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
    rootDir: nonexistent('repo'),
    runImpl,
  });
  assert.strictEqual(results.length, 7);
  assert.deepStrictEqual(results.slice(0, 3).map((r) => r.status), ['fail', 'pass', 'pass']);
  assert.match(results[0].message, /CS1040/, '工具报错必须保留');
  assert.match(results[0].message, /退出码 1/);
  assert.doesNotMatch(results[0].message, /无法连接/, '工具级失败不得自称连接问题');
  assert.doesNotMatch(results[0].message, /无法启动 dispatcher/);
});

test('无 dispatcher 时 uloop fail 且不 spawn，连接检查跳过', async () => {
  // env 不设 PI_UNITY_ULOOP_CMD / PI_UNITY_ULOOP_BIN，rootDir 指向不存在的目录 →
  // 即便本机真下载过 uloop-bin/（.gitignore 的运行时目录），findDispatcher 也只会
  // 兜底返回裸名，必须判 fail（否则静默假绿）。
  const appData = nonexistent('appdata');
  const checks = await collectChecks({
    env: { APPDATA: appData, FAKE_MODE: 'fail' },
    appData,
    rootDir: nonexistent('repo'),
  });
  const uloop = checks.find((c) => c.name === 'uloop');
  assert.strictEqual(uloop.status, 'fail');
  assert.ok(uloop.hint && uloop.hint.length > 0);
  const conn = checks.find((c) => c.name === 'editor-connection');
  assert.strictEqual(conn.status, 'fail');
  assert.ok(conn.message.includes('跳过'));
});

// ─────────────── M2 任务 10：--smoke 的写-读回-删自闭环 + --json 契约 ───────────────

test('smoke 现在的 items 顺序与数量固定：3 个只读工具 + 4 个写闭环项（名字逐字）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const results = await smoke({ env: { ...process.env }, projectPath: 'P', _call: be.call });
  assert.deepStrictEqual(results.map((r) => r.name), [
    'compile', 'get-logs', 'get-hierarchy', 'write-create', 'write-set', 'write-delete', 'write-clean',
  ]);
  for (const r of results) {
    assert.ok(['pass', 'fail', 'skip'].includes(r.status), `${r.name} 状态非法`);
    assert.ok(Object.hasOwn(r, 'code'), `${r.name} 必须带 code（pass 为 null）`);
  }
});

test('写闭环全绿：create/set/delete 都 verified:true，最后一步读回确认无残留', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  // compile / get-logs 由假后端补上（只读工具）
  const call = async (tool, args) => {
    if (tool === 'compile') return { code: 0, json: { Success: true, ErrorCount: 0, WarningCount: 0 }, truncated: false, tool, args };
    if (tool === 'get-logs') return { code: 0, json: { Success: true, TotalCount: 0, DisplayedCount: 0, Logs: [] }, truncated: false, tool, args };
    return be.call(tool, args);
  };
  const results = await smoke({ env: process.env, projectPath: 'P', _call: call });
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  for (const n of ['write-create', 'write-set', 'write-delete', 'write-clean']) {
    assert.strictEqual(byName[n].status, 'pass', `${n}: ${byName[n].message}`);
    assert.strictEqual(byName[n].code, null);
  }
  assert.strictEqual(be.nodes.has('__pi_smoke'), false, '冒烟结束不得留残留');
});

test('写闭环失败要如实报 fail 且带内层 hint（不把假绿当通过）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const call = async (tool, args) => {
    if (tool === 'compile') return { code: 0, json: { Success: true, ErrorCount: 0, WarningCount: 0 }, truncated: false, tool, args };
    if (tool === 'get-logs') return { code: 0, json: { Success: true, TotalCount: 0, DisplayedCount: 0, Logs: [] }, truncated: false, tool, args };
    const r = await be.call(tool, args);
    // 让 node-set 永远报 BAD_PATCH（带 hint）→ write-set 必须 fail
    if (tool === 'execute-dynamic-code' && String(args[1]).endsWith('node-set.cs')) {
      return { ...r, json: { Success: true, Result: JSON.stringify({ __error: 'BAD_PATCH', detail: 'position 需要完整的数值 x/y/z' }) } };
    }
    return r;
  };
  const results = await smoke({ env: process.env, projectPath: 'P', _call: call });
  const setItem = results.find((r) => r.name === 'write-set');
  assert.strictEqual(setItem.status, 'fail');
  assert.strictEqual(setItem.code, 'WRITE_LOOP_FAILED');
  assert.match(setItem.message, /BAD_PATCH/);
  assert.ok(setItem.hint.length > 0, '失败必须带可操作 hint');
});

test('上一次残留的 __pi_smoke 会先被清掉（并读回确认），不静默叠两个同名节点', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }, { path: '__pi_smoke' }] });
  const call = async (tool, args) => {
    if (tool === 'compile') return { code: 0, json: { Success: true, ErrorCount: 0, WarningCount: 0 }, truncated: false, tool, args };
    if (tool === 'get-logs') return { code: 0, json: { Success: true, TotalCount: 0, DisplayedCount: 0, Logs: [] }, truncated: false, tool, args };
    return be.call(tool, args);
  };
  const results = await smoke({ env: process.env, projectPath: 'P', _call: call });
  const create = results.find((r) => r.name === 'write-create');
  assert.strictEqual(create.status, 'pass');
  assert.match(create.message, /残留|清理/, '必须先清残留并说明');
  assert.strictEqual(be.nodes.has('__pi_smoke'), false);
});

test('doctor --json：两种模式都是 {ok, mode, checks}，且逐项带 code（M1 延后项④）', async () => {
  const appData = nonexistent('appdata');
  const basic = await captureStdout(() => doctor(['--project-path', 'P', '--json'], { env: { ...process.env, PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) }, appData }));
  const bj = JSON.parse(basic.out);
  assert.deepStrictEqual(Object.keys(bj), ['ok', 'mode', 'checks']);
  assert.strictEqual(bj.mode, 'basic');
  for (const c of bj.checks) assert.ok(Object.hasOwn(c, 'code'), `${c.name} 必须带 code`);

  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const call = async (tool, args) => {
    if (tool === 'compile') return { code: 0, json: { Success: true, ErrorCount: 0, WarningCount: 0 }, truncated: false, tool, args };
    if (tool === 'get-logs') return { code: 0, json: { Success: true, TotalCount: 0, DisplayedCount: 0, Logs: [] }, truncated: false, tool, args };
    return be.call(tool, args);
  };
  const smokeOut = await captureStdout(() => doctor(['--project-path', 'P', '--json', '--smoke'], { env: process.env, _call: call, appData }));
  const sj = JSON.parse(smokeOut.out);
  assert.deepStrictEqual(Object.keys(sj), ['ok', 'mode', 'checks']);
  assert.strictEqual(sj.mode, 'smoke');
  assert.strictEqual(sj.ok, true);
});

test('doctor --golden 与 --smoke 同时给 → 退出码 2 + stderr 说明', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStderr } = require('./helpers/capture.js');
  const r = await captureStderr(() => main(['doctor', '--smoke', '--golden', '--project-path', 'P']));
  assert.strictEqual(r.result, 2);
  assert.match(r.out, /不能同时用/);
});

// R206③：golden 的 `--json` 形状（doctor 级）——任务 9 已给 runGolden 的形状测试，
// 这里验证透传后的 doctor 输出形状（显式例外：golden 不叫 checks）。
test('doctor --json --golden 的输出形状固定：{ok,mode,matched,diff,cleanup,blocked,lines}（R206③）', async () => {
  const appData = nonexistent('appdata');
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const out = await captureStdout(() => doctor(['--project-path', 'P', '--json', '--golden'], { env: process.env, _call: be.call, appData }));
  const j = JSON.parse(out.out);
  assert.deepStrictEqual(Object.keys(j).sort(), ['blocked', 'cleanup', 'diff', 'lines', 'matched', 'mode', 'ok']);
  assert.strictEqual(j.mode, 'golden');
  assert.strictEqual(j.matched, true);
  assert.strictEqual(j.cleanup.status, 'ok');
  assert.strictEqual(j.blocked, null);
});

// R202：本任务把 `standaloneFailure(r)` 换成 `failureText(r, { standalone: true })`
// （任务 1 已删掉 standaloneFailure —— 旧写法落地即 `ReferenceError`，既有 smoke 用例会直接红）。
// 这个改动由既有的 `smoke per-tool 失败文案是整句（F1/R44）` 用例盖住，不需要新增用例。

// ─────────────── M2 任务 10 修复轮：R298–R306 ───────────────

/** `node-set` 报成功但没真的改（Unity 静默未应用 patch）→ 读回与 intent 不一致。 */
const SET_NOT_APPLIED = (tool, args) => (tool === 'execute-dynamic-code' && String(args[1]).endsWith('node-set.cs')
  ? { code: 0, json: { Success: true, Result: '{"__written":true}' }, truncated: false, tool, args }
  : null);

/** `node-create` 报一个具名错误 → create 落失败信封。 */
const CREATE_BAD_REQUEST = (tool, args) => (tool === 'execute-dynamic-code' && String(args[1]).endsWith('node-create.cs')
  ? { code: 0, json: { Success: true, Result: JSON.stringify({ __error: 'BAD_REQUEST' }) }, truncated: false, tool, args }
  : null);

test('写闭环 verified:false 的失败文案展开 mismatches，不打出字面 undefined（R298）', async () => {
  // `ok:true + verified:false` 的信封**没有 code/message**（`ok()` 白名单不含）——
  // 旧写法 `set 未通过：${set.code}${set.message ? … : ''}` 会打出字面 `undefined`，
  // 并把唯一的证据 `mismatches` 丢掉。
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const results = await smoke({ env: process.env, projectPath: 'P', _call: smokeCall(be, SET_NOT_APPLIED) });
  const setItem = results.find((r) => r.name === 'write-set');
  assert.strictEqual(setItem.status, 'fail', setItem.message);
  assert.strictEqual(setItem.code, 'WRITE_LOOP_FAILED');
  assert.doesNotMatch(setItem.message, /undefined/, 'verified:false 时不得打出字面 undefined');
  assert.match(setItem.message, /position/, '必须展开 mismatches 的分歧 key（compareSubset 给出 position.x/.y）');
  assert.match(setItem.message, /verified:false/);
});

test('写闭环 verified:false 仍判 fail（不把 ok:true 当通过）且 hint 指向 mismatches（R305b）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const results = await smoke({ env: process.env, projectPath: 'P', _call: smokeCall(be, SET_NOT_APPLIED) });
  const setItem = results.find((r) => r.name === 'write-set');
  assert.strictEqual(setItem.status, 'fail');
  assert.strictEqual(setItem.code, 'WRITE_LOOP_FAILED');
  assert.ok(setItem.hint.some((h) => /mismatches/.test(h)), `必须把 mismatches 指给用户：${JSON.stringify(setItem.hint)}`);
});

test('前置步骤失败产生的 skip：code 是 WRITE_LOOP_NOT_RUN，不是 WRITE_LOOP_FAILED（R300）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const results = await smoke({ env: process.env, projectPath: 'P', _call: smokeCall(be, CREATE_BAD_REQUEST) });
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  assert.strictEqual(results.length, 7);
  assert.strictEqual(byName['write-create'].status, 'fail');
  for (const n of ['write-set', 'write-delete']) {
    assert.strictEqual(byName[n].status, 'skip', n);
    assert.strictEqual(byName[n].code, 'WRITE_LOOP_NOT_RUN', `${n} 的 code 必须是「为什么没跑」`);
  }
  // 只读三工具已经跑过（与探活失败的全 skip 不同）
  assert.deepStrictEqual(results.slice(0, 3).map((r) => r.status), ['pass', 'pass', 'pass']);
});

test('部分 skip 的尾行如实说「因前置步骤失败未执行」，不再谎称「未能验证任何工具」（R299）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const out = await captureStdout(() => doctor(
    ['--smoke', '--project-path', 'P'],
    { env: process.env, _call: smokeCall(be, CREATE_BAD_REQUEST) },
  ));
  assert.strictEqual(out.result, 1);
  assert.match(out.out, /2 项因前置步骤失败未执行（这几项未验证）/);
  assert.doesNotMatch(out.out, /未能验证任何工具/, '只读三工具全 pass 时不得再说「未能验证任何工具」');
});

test('残留清不掉的提前返回：create fail + set/delete skip + clean fail + 手工命令（R305a）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }, { path: '__pi_smoke' }] });
  const results = await smoke({
    env: process.env,
    projectPath: 'P',
    // 残留清理那一步删不掉（NOT_FOUND 等）→ 不得继续 create（否则会叠出同名第二个节点）
    _call: smokeCall(be, (tool, args) => (tool === 'execute-dynamic-code' && String(args[1]).endsWith('node-delete.cs')
      ? { code: 0, json: { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) }, truncated: false, tool, args }
      : null)),
  });
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  assert.strictEqual(byName['write-create'].status, 'fail');
  assert.strictEqual(byName['write-create'].code, 'WRITE_LOOP_RESIDUE');
  assert.doesNotMatch(byName['write-create'].message, /undefined/);
  for (const n of ['write-set', 'write-delete']) {
    assert.strictEqual(byName[n].status, 'skip', n);
    assert.strictEqual(byName[n].code, 'WRITE_LOOP_NOT_RUN', n);
  }
  assert.strictEqual(byName['write-clean'].status, 'fail');
  assert.strictEqual(byName['write-clean'].code, 'WRITE_LOOP_RESIDUE');
  assert.ok(byName['write-clean'].hint.includes('unity node delete --path __pi_smoke'), '必须给出手工命令');
  assert.ok(!be.calls.some((c) => c.tool === 'execute-dynamic-code' && String(c.args[1]).endsWith('node-create.cs')), '残留未清时不得 create');
});

test('write-clean 残骸：删除自述成功但节点还在 → write-clean fail（R305c）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const results = await smoke({
    env: process.env,
    projectPath: 'P',
    // `.cs` 自述删了（协议合法），但节点实际还在（同名兄弟 / DestroyImmediate 未生效）——
    // nodeDelete 读回发现仍有节点 → ok:true + verified:false → 最终 write-clean 必须报残骸。
    _call: smokeCall(be, (tool, args) => (tool === 'execute-dynamic-code' && String(args[1]).endsWith('node-delete.cs')
      ? { code: 0, json: { Success: true, Result: JSON.stringify({ __deleted: true, path: '__pi_smoke' }) }, truncated: false, tool, args }
      : null)),
  });
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  assert.strictEqual(byName['write-delete'].status, 'fail', byName['write-delete'].message);
  assert.doesNotMatch(byName['write-delete'].message, /undefined/);
  assert.strictEqual(byName['write-clean'].status, 'fail');
  assert.strictEqual(byName['write-clean'].code, 'WRITE_LOOP_RESIDUE');
  assert.ok(byName['write-clean'].hint.includes('unity node delete --path __pi_smoke'));
});

test('--smoke 缺 --project-path：4 个写闭环项 skip + MISSING_PROJECT_PATH，零写入（R306）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const results = await smoke({ env: process.env, _call: be.call });
  assert.strictEqual(results.length, 7);
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  for (const n of ['write-create', 'write-set', 'write-delete', 'write-clean']) {
    assert.strictEqual(byName[n].status, 'skip', n);
    assert.strictEqual(byName[n].code, 'MISSING_PROJECT_PATH', n);
    assert.ok(byName[n].hint.length > 0, `${n} 必须带 hint`);
  }
  assert.ok(!be.calls.some((c) => c.tool === 'execute-dynamic-code'), '缺项目根时不得发起任何写调用');
  assert.strictEqual(be.nodes.size, 1, '场景不得被改动');
});

test('残留预检读回失败：把 code/message 并进 write-create 的 hint，不静默吞掉（R301）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const badFile = path.join(be.dir, 'bad-hierarchy.json');
  let hierarchy = 0;
  const call = async (tool, args) => {
    if (tool === 'get-hierarchy') {
      hierarchy += 1;
      // 第 2 次 = writeLoopItems 的「清理前残留预检」（第 1 次是只读工具）→ 形状不符 → BAD_HIERARCHY
      if (hierarchy === 2) {
        fs.writeFileSync(badFile, JSON.stringify({ Hierarchy: [] }));
        return { code: 0, json: { Success: true, HierarchyFilePath: badFile }, truncated: false, tool, args };
      }
    }
    return smokeCall(be)(tool, args);
  };
  const results = await smoke({ env: process.env, projectPath: 'P', _call: call });
  const create = results.find((r) => r.name === 'write-create');
  assert.strictEqual(create.status, 'pass', create.message);
  assert.ok(create.hint.some((h) => /清理前读回失败：BAD_HIERARCHY/.test(h)), `hint 必须留痕：${JSON.stringify(create.hint)}`);
});

test('write-clean pass 带上 after.hint（还有 N 个场景未读）（R302）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const multiFile = path.join(be.dir, 'multi-scene.json');
  const call = async (tool, args) => {
    if (tool === 'get-hierarchy') {
      fs.writeFileSync(multiFile, JSON.stringify({
        ExportTimestamp: '2026-09-19 00:00:00',
        Context: { sceneType: 'editor', sceneName: '', nodeCount: 1, maxDepth: 0 },
        Hierarchy: [
          { sceneName: '', stats: { rootCount: 1, nodeCount: 1, maxDepth: 0 }, roots: [{ name: 'Main Camera', isActive: true, components: ['Transform'], children: [] }] },
          { sceneName: 'Extra', stats: { rootCount: 0, nodeCount: 0, maxDepth: 0 }, roots: [] },
        ],
      }));
      return { code: 0, json: { Success: true, HierarchyFilePath: multiFile }, truncated: false, tool, args };
    }
    return smokeCall(be)(tool, args);
  };
  const results = await smoke({ env: process.env, projectPath: 'P', _call: call });
  const clean = results.find((r) => r.name === 'write-clean');
  assert.strictEqual(clean.status, 'pass', clean.message);
  assert.ok(clean.hint.some((h) => /还有 1 个场景未读/.test(h)), `pass 也必须带上 otherScene hint：${JSON.stringify(clean.hint)}`);
});

test('残留检测限定根层：Canvas/__pi_smoke 既不阻断也不被误删（R303）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Canvas' }, { path: 'Canvas/__pi_smoke' }] });
  const results = await smoke({ env: process.env, projectPath: 'P', _call: smokeCall(be) });
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  // 根层没有 __pi_smoke → 不该走「清残留」，create 正常通过
  assert.strictEqual(byName['write-create'].status, 'pass', byName['write-create'].message);
  assert.doesNotMatch(byName['write-create'].message, /残留/);
  // 嵌套的同名节点不受影响（smoke 只在根建节点，删除也用根路径）
  assert.strictEqual(be.nodes.has('Canvas/__pi_smoke'), true, '嵌套同名节点不得被误删');
  assert.strictEqual(byName['write-clean'].status, 'pass', byName['write-clean'].message);
});
