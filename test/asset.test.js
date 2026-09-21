// test/asset.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { compile, assetWrite, resolveTemplate } = require('../lib/asset.js');
const { exitCodeFor } = require('../lib/envelope.js');

function fakeCall(json, spy = []) {
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

const OK_COMPILE = { Success: true, ErrorCount: 0, WarningCount: 0, Errors: [], Warnings: [], Message: 'compiled' };

test('compile 成功：errorCount===0 → ok:true、verified:null（读命令），argv 不带 --force-recompile', async () => {
  const spy = [];
  const e = await compile({ projectPath: 'P', _call: fakeCall(OK_COMPILE, spy) });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, null);
  assert.strictEqual(spy[0].tool, 'compile');
  assert.deepStrictEqual(spy[0].args, []);
  assert.strictEqual(e.actual.errorCount, 0);
});

test('compile 有错：ok:false + COMPILE_FAILED + 结构化 errors（文件/行/消息）', async () => {
  const e = await compile({
    projectPath: 'P',
    _call: fakeCall({
      Success: true, ErrorCount: 2, WarningCount: 1,
      Errors: [{ Message: 'CS1002: ; expected', File: 'Assets/X.cs', Line: 12 }, { Message: 'CS0246: 找不到类型', File: 'Assets/X.cs', Line: 20 }],
      Warnings: [{ Message: 'CS0168', File: 'Assets/X.cs', Line: 3 }],
      Message: 'compile failed',
    }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'COMPILE_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(e.actual.errorCount, 2);
  assert.deepStrictEqual(e.actual.errors[0], { message: 'CS1002: ; expected', file: 'Assets/X.cs', line: 12 });
  assert.ok(e.hint.some((h) => /CS1002/.test(h)), 'hint 必须带上第一条错误，省一轮 get-logs');
});

test('compile 不确定（Success:null / ErrorCount:null）→ BAD_COMPILE_RESPONSE（不猜）', async () => {
  // R209 降级标注：`Success: null` 在当前 vendor 上**生产不可达** ——
  //   `CompileResponseFactory.cs:80,91` 把 Success 强制成 bool；保留它是因为上游 SKILL.md 写的是 “boolean or null”，
  //   且 `fromUloop` 会把 `Success:null` 先判成 ULOOP_BAD_PAYLOAD（「这不是 uloop 信封」，误导）。
  //   可达的不确定形态是后两条（ErrorCount/WarningCount 缺失）。
  for (const bad of [
    { Success: null, ErrorCount: null, WarningCount: null, Message: 'COMPILE_RESULT_UNKNOWN' },   // 防御分支（生产不可达）
    { Success: true, ErrorCount: null, WarningCount: 0 },                                          // 可达
    { Success: true, Message: 'no counters' },                                                     // 可达
  ]) {
    const e = await compile({ projectPath: 'P', _call: fakeCall(bad) });
    assert.strictEqual(e.code, 'BAD_COMPILE_RESPONSE', `${JSON.stringify(bad)}`);
    assert.strictEqual(exitCodeFor(e), 1);
  }
});

test('compile 上游报错（ErrorCode/NextActions）→ 直接按上游失败，NextActions 进 hint', async () => {
  const e = await compile({
    projectPath: 'P',
    _call: fakeCall({ Success: false, ErrorCode: 'COMPILE_ALREADY_IN_PROGRESS', Message: 'Unity is busy running "compile"', NextActions: ['Wait and rerun the command.'] }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'COMPILE_ALREADY_IN_PROGRESS');
  assert.ok(e.hint.some((h) => /Wait and rerun/.test(h)));
});

// R275：**真机（S0Project，2026-09-19）反馈**：上游在编译有错时给 `Success:false` + 完整 `Errors[]`
//（`CompileResultFactory.cs:39` `success: errorCount == 0`），**不是**简报假定的 `Success:true + ErrorCount>0`。
// 本用例是那条跨语言真值的 tripwire：若 `compile()` 先走 `envelopeFromCall`，`Success:false` 会被映射成
// `ULOOP_ERROR` 并丢掉 `Errors[]` → 真机判据②（`errors[0]` 带 file/line/message）落空。
// payload 逐字取自裸 `uloop compile`（Broken.cs）的实测输出。
test('compile 真机形状：Success:false + ErrorCount>0 + Errors[] → COMPILE_FAILED 且 errors 结构化（R275）', async () => {
  const e = await compile({
    projectPath: 'P',
    _call: fakeCall({
      ErrorCount: 1,
      WarningCount: 0,
      Errors: [{ Message: "Assets\\PiProbe\\Broken.cs(1,42): error CS1525: Invalid expression term ';'", File: 'Assets\\PiProbe\\Broken.cs', Line: 1 }],
      Warnings: [],
      Message: null,
      ErrorCode: null,
      NextActions: null,
      ProjectRoot: 'C:\\S0Project',
      Warning: null,
      Success: false,
    }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'COMPILE_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.deepStrictEqual(e.actual.errors[0], {
    message: "Assets\\PiProbe\\Broken.cs(1,42): error CS1525: Invalid expression term ';'",
    file: 'Assets\\PiProbe\\Broken.cs',
    line: 1,
  });
  assert.ok(e.hint.some((h) => /CS1525/.test(h)), 'hint 必须带上第一条错误');
});

test('assetWrite 缺 --to / --from 与 --template 都给或都不给 → 用法错 2，不写盘', async () => {
  let writes = 0;
  const w = { _writeFile: () => { writes++; }, _readSource: () => Buffer.from('x'), _exists: () => false, _call: fakeCall(OK_COMPILE) };
  for (const [opts, code] of [
    [{}, 'MISSING_TO'],
    [{ to: 'Assets/X.cs' }, 'MISSING_SOURCE'],
    [{ to: 'Assets/X.cs', from: 'a.cs', template: 'PiBrickBreaker' }, 'BAD_SOURCE'],
  ]) {
    const e = await assetWrite({ projectPath: 'P', ...w, ...opts });
    assert.strictEqual(e.code, code, `${JSON.stringify(opts)}`);
    assert.strictEqual(exitCodeFor(e), 2);
  }
  assert.strictEqual(writes, 0);
});

test('assetWrite 目标路径必须在 Assets/ 下且不含 .. → BAD_TARGET_PATH（2）', async () => {
  for (const to of ['/abs/X.cs', 'Library/X.cs', 'Assets/../X.cs', '']) {
    const e = await assetWrite({ projectPath: 'P', to, from: 'a.cs', _call: fakeCall(OK_COMPILE), _readSource: () => Buffer.from('x'), _writeFile: () => {}, _exists: () => false, _mkdirp: () => {} });
    assert.strictEqual(e.code, 'BAD_TARGET_PATH', to);
  }
});

// R284（F6②）：`--to` 反斜杠形式归一化 —— 之前只有实现、没有 tripwire。
test('assetWrite --to 用反斜杠（Assets\\X.cs）→ 归一化为 Assets/X.cs 并接受', async () => {
  const e = await assetWrite({
    projectPath: 'P', to: 'Assets\\X.cs', from: 'src.cs',
    _readSource: () => Buffer.from('x'), _exists: () => false, _writeFile: () => {}, _mkdirp: () => {},
    _readBack: () => Buffer.from('x'), _call: fakeCall(OK_COMPILE),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.actual.path, 'Assets/X.cs');
  assert.strictEqual(e.intent.path, 'Assets/X.cs');
});

test('assetWrite 目标已存在且无 --force → ASSET_EXISTS（1），不写盘', async () => {
  let writes = 0;
  const e = await assetWrite({
    projectPath: 'P', to: 'Assets/X.cs', from: 'src.cs',
    _exists: () => true, _writeFile: () => { writes++; }, _readSource: () => Buffer.from('x'),
    _call: fakeCall(OK_COMPILE),
  });
  assert.strictEqual(e.code, 'ASSET_EXISTS');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(writes, 0);
  assert.ok(e.hint.some((h) => /--force/.test(h)));
});

test('assetWrite 成功：写 → 读回 sha256 一致 → verified:true，并串起 compile', async () => {
  const content = 'public class PiBrickBreaker : UnityEngine.MonoBehaviour { }\n';
  const spy = [];
  const e = await assetWrite({
    projectPath: 'P', to: 'Assets/PiBB/PiBrickBreaker.cs', from: 'C:/skill/reference/PiBrickBreaker.cs',
    _readSource: () => Buffer.from(content), _exists: () => false,
    _writeFile: () => {}, _mkdirp: () => {}, _readBack: () => Buffer.from(content),
    _call: fakeCall(OK_COMPILE, spy),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.strictEqual(e.actual.path, 'Assets/PiBB/PiBrickBreaker.cs');
  assert.strictEqual(e.actual.bytes, Buffer.byteLength(content));
  assert.strictEqual(e.actual.sha256, crypto.createHash('sha256').update(content).digest('hex'));
  assert.strictEqual(e.actual.compiled, true);
  assert.strictEqual(spy[0].tool, 'compile');
  assert.deepStrictEqual(spy[0].args, []);
  // R280（F4）：写命令的成功信封一律带 `mismatches`（`ok()` 白名单刻意不含它，须显式附加）
  assert.deepStrictEqual(e.mismatches, []);
});

test('assetWrite --no-compile：跳过 compile（一条 uloop 调用都不发）', async () => {
  const spy = [];
  const e = await assetWrite({
    projectPath: 'P', to: 'Assets/X.cs', from: 'src.cs', noCompile: true,
    _readSource: () => Buffer.from('x'), _exists: () => false, _writeFile: () => {}, _mkdirp: () => {}, _readBack: () => Buffer.from('x'),
    _call: fakeCall(OK_COMPILE, spy),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.actual.compiled, null);
  assert.strictEqual(spy.length, 0);
  assert.deepStrictEqual(e.mismatches, []);
});

test('assetWrite 源文件读不了 → SOURCE_NOT_FOUND（1）', async () => {
  const e = await assetWrite({
    projectPath: 'P', to: 'Assets/X.cs', from: 'C:/nope.cs',
    _readSource: () => { throw new Error('ENOENT'); }, _exists: () => false, _writeFile: () => {}, _mkdirp: () => {},
    _call: fakeCall(OK_COMPILE),
  });
  assert.strictEqual(e.code, 'SOURCE_NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('assetWrite 写后读回内容不符 → verified:false + READBACK 差异字段（写盘不完整不谎报）', async () => {
  const e = await assetWrite({
    projectPath: 'P', to: 'Assets/X.cs', from: 'src.cs',
    _readSource: () => Buffer.from('0123456789'), _exists: () => false, _writeFile: () => {}, _mkdirp: () => {},
    _readBack: () => Buffer.from('01234'),
    _call: fakeCall(OK_COMPILE),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.actual.sha256 === e.actual.readBackSha256, false);
  assert.strictEqual(e.actual.readBackBytes, 5);
});

// ───────────────────────── 修复轮（R277–R285） ─────────────────────────

// R277（F1）：`--timeout-seconds` 非法必须在**任何写盘/调用之前**收敛（约束 16）。
// 之前：写盘之后才由内部 compile() 报 BAD_TIMEOUT，却被折成 COMPILE_FAILED/退出码 1；
// 加 `--no-compile` 又静默成功 —— 同一份 argv 因副作用路径不同而结论不同。
test('assetWrite --timeout-seconds 非法 → BAD_TIMEOUT（2），零写盘（R277）', async () => {
  let writes = 0;
  const e = await assetWrite({
    projectPath: 'P', to: 'Assets/X.cs', from: 'a.cs', timeoutSeconds: 'abc',
    _readSource: () => Buffer.from('x'), _exists: () => false, _writeFile: () => { writes++; }, _mkdirp: () => {},
    _readBack: () => Buffer.from('x'), _call: fakeCall(OK_COMPILE),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BAD_TIMEOUT');
  assert.strictEqual(exitCodeFor(e), 2);
  assert.strictEqual(writes, 0, '非法用法错必须在写盘之前收敛');
});

// R278（F2）：缺 `--project-path` 与 M1 R68 同族 —— 裸写给 `true` 会让 `path.join` TypeError 逃出
// （顶层 catch → 退出码 3，把用户 argv 失误报成「本包 bug」）；完全不给则 path.join('', …) 写到
// 进程 CWD 的 Assets/，再让随后的 compile 走调度器默认工程 → 假绿 + CWD 游离目录。
test('assetWrite 缺 projectPath → MISSING_PROJECT_PATH（用法错 2），不写盘、不抛（R278）', async () => {
  let writes = 0;
  let e;
  await assert.doesNotReject(async () => {
    e = await assetWrite({
      to: 'Assets/X.cs', from: 'a.cs',
      _readSource: () => Buffer.from('x'), _exists: () => false,
      _writeFile: () => { writes++; }, _mkdirp: () => {},
      _call: fakeCall(OK_COMPILE),
    });
  }, '缺 projectPath 时不得抛出（抛出会冒成 internal error / 退出码 3）');
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'MISSING_PROJECT_PATH');
  assert.strictEqual(exitCodeFor(e), 2);
  assert.deepStrictEqual(e.actual, { to: 'Assets/X.cs' });
  assert.ok(e.hint.length > 0);
  assert.strictEqual(writes, 0);
});

test('assetWrite --project-path 裸写（parseArgs → true）→ MISSING_PROJECT_PATH（用法错 2），不写盘（R278）', async () => {
  let writes = 0;
  const e = await assetWrite({
    projectPath: true, to: 'Assets/X.cs', from: 'a.cs',
    _readSource: () => Buffer.from('x'), _exists: () => false,
    _writeFile: () => { writes++; }, _mkdirp: () => {},
    _call: fakeCall(OK_COMPILE),
  });
  assert.strictEqual(e.code, 'MISSING_PROJECT_PATH');
  assert.strictEqual(exitCodeFor(e), 2);
  assert.strictEqual(writes, 0);
});

// R279（F3）：编译阶段的失败码不得被压平 —— `ULOOP_TRUNCATED`/`ULOOP_NO_JSON`/
// `COMPILE_ALREADY_IN_PROGRESS` 的原码与 `retryable` 语义必须透传（任务 10/11 按 code 判定）。
test('assetWrite 编译阶段 ULOOP_TRUNCATED → 原码透传 + retryable:true（R279）', async () => {
  const truncated = async (tool, args) => ({
    code: 124, stdout: '', stderr: '', timedOut: true, drained: false,
    json: null, truncated: true, tool, args,
  });
  const e = await assetWrite({
    projectPath: 'P', to: 'Assets/X.cs', from: 'a.cs',
    _readSource: () => Buffer.from('x'), _exists: () => false, _writeFile: () => {}, _mkdirp: () => {},
    _readBack: () => Buffer.from('x'), _call: truncated,
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
  assert.notStrictEqual(e.code, 'COMPILE_FAILED');
  assert.strictEqual(e.retryable, true);
  assert.strictEqual(exitCodeFor(e), 1);
  // R284（F8）：编译未过 ≠ 写盘没验过 —— intent/两个子判定把「写盘已验、编译没过」说清楚
  assert.strictEqual(e.intent.sha256, e.actual.sha256);
  assert.strictEqual(e.actual.writeVerified, true);
  assert.strictEqual(e.actual.compileVerified, false);
});

// F4/R348（原延后项 D5②）：message 必须与同一信封的 code/retryable 同口径 ——
// 旧写法对 `ULOOP_TRUNCATED`（`retryable:true`，编译结果**未知**）也写「编译未通过」，
// 会把 agent 引去修一个可能不存在的编译错。结论类才写「未通过」，其余必须写「未知」+ 原码。
test('assetWrite 编译失败的 message 与 code 同口径：结论类「未通过」/未知类「未知」（F4/R348）', async () => {
  const writeArgs = {
    projectPath: 'P', to: 'Assets/X.cs', from: 'src.cs',
    _readSource: () => Buffer.from('x'), _exists: () => false, _writeFile: () => {}, _mkdirp: () => {},
    _readBack: () => Buffer.from('x'),
  };
  // ① 结论类：编译确实有错 → COMPILE_FAILED，写「编译未通过」
  const bad = await assetWrite({
    ...writeArgs,
    _call: fakeCall({
      Success: true, ErrorCount: 1, WarningCount: 0,
      Errors: [{ Message: 'CS1002: ; expected', File: 'Assets/X.cs', Line: 12 }], Warnings: [],
    }),
  });
  assert.strictEqual(bad.code, 'COMPILE_FAILED');
  assert.strictEqual(bad.retryable, false);
  assert.match(bad.message, /编译未通过/, `结论类必须直说编译未通过：${bad.message}`);
  // ② 未知类：传输层截断（retryable:true，编译**没跑出结论**）→ 不得说「未通过」
  const truncated = await assetWrite({
    ...writeArgs,
    _call: async (tool, args) => ({
      code: 124, stdout: '', stderr: '', timedOut: true, drained: false,
      json: null, truncated: true, tool, args,
    }),
  });
  assert.strictEqual(truncated.code, 'ULOOP_TRUNCATED');
  assert.strictEqual(truncated.retryable, true);
  assert.match(truncated.message, /未知/, `未知类必须写「未知」：${truncated.message}`);
  assert.ok(!/未通过/.test(truncated.message), `未知结论不得写「编译未通过」：${truncated.message}`);
  assert.match(truncated.message, /ULOOP_TRUNCATED/, `未知类必须在 message 里带上原码：${truncated.message}`);
});

// R282（F6①）：R275 新增的「矛盾分支」此前无 tripwire。
test('compile 矛盾形态：Success!==true 却 ErrorCount===0 → BAD_COMPILE_RESPONSE（不猜成 0）（R282）', async () => {
  const e = await compile({
    projectPath: 'P',
    _call: fakeCall({ Success: false, ErrorCount: 0, WarningCount: 0, Errors: [], Warnings: [], Message: null }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BAD_COMPILE_RESPONSE');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(e.actual.errorCount, 0);
});

test('assetWrite --template 解析到包内模板；未知模板 → TEMPLATE_NOT_FOUND（1）', () => {
  const p = resolveTemplate('PiBrickBreaker');
  assert.ok(p && p.endsWith(`templates${require('node:path').sep}PiBrickBreaker.cs`), String(p));
  assert.strictEqual(resolveTemplate('NoSuchTemplate'), null);
});

// ─────────────────── R206⑤：CLI 级用例（main([...]) 端到端，照 M1 test/scene.test.js 的写法）───────────────────

/** 写一个假 dispatcher 脚本并运行 fn（**逐字照搬** test/scene.test.js 的 withScriptedDispatcher，含 try/finally 还原 env）。 */
async function withScriptedDispatcher(scriptBody, fn) {
  const fss = require('node:fs');
  const pathh = require('node:path');
  const dir = fss.mkdtempSync(pathh.join(require('node:os').tmpdir(), 'piu-asset-scripted-'));
  const fake = pathh.join(dir, 'fake-uloop.js');
  fss.writeFileSync(fake, scriptBody);
  const saved = process.env.PI_UNITY_ULOOP_CMD;
  process.env.PI_UNITY_ULOOP_CMD = JSON.stringify([process.execPath, fake]);
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.PI_UNITY_ULOOP_CMD;
    else process.env.PI_UNITY_ULOOP_CMD = saved;
  }
}

test('CLI compile：无错 → 退出码 0；有编译错 → 1 且 code=COMPILE_FAILED（main([...]) 端到端）', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout } = require('./helpers/capture.js');
  const okRun = await withScriptedDispatcher(
    "process.stdout.write(JSON.stringify({ Success: true, ErrorCount: 0, WarningCount: 0, Message: 'ok' }) + '\\n');",
    () => captureStdout(() => main(['compile', '--project-path', 'X', '--json'])),
  );
  assert.strictEqual(okRun.result, 0);
  assert.strictEqual(JSON.parse(okRun.out).actual.errorCount, 0);

  const badRun = await withScriptedDispatcher(
    // R281（F5）：真机（R275）形状是「脏载荷走 **stdout** + 退出码 1」（`lib/uloop.js` 的 secondary 兜底），
    // 不是 stderr。逐字取真机 `Success:false` 形状，覆盖这条真机确实会走的通道。
    "process.stdout.write(JSON.stringify({ ErrorCount: 1, WarningCount: 0, Errors: [{ Message: 'CS1002', File: 'Assets/X.cs', Line: 1 }], Warnings: [], Message: null, ErrorCode: null, NextActions: null, Success: false }) + '\\n'); process.exitCode = 1;",
    () => captureStdout(() => main(['compile', '--project-path', 'X', '--json'])),
  );
  assert.strictEqual(badRun.result, 1);
  const bad = JSON.parse(badRun.out);
  assert.strictEqual(bad.code, 'COMPILE_FAILED');
  assert.strictEqual(bad.actual.errors[0].line, 1);
});

test('CLI asset write：--from 真文件 → 0 且 verified:true、compiled:true；--to 非 Assets/ → 2 BAD_TARGET_PATH', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout } = require('./helpers/capture.js');
  const fss = require('node:fs');
  const pathh = require('node:path');
  // 写盘走真实 fs：用一个临时「项目目录」，别碰任何真实工程（全局约束 20）
  const proj = fss.mkdtempSync(pathh.join(require('node:os').tmpdir(), 'piu-asset-proj-'));
  const src = pathh.join(proj, 'Probe.cs');
  fss.writeFileSync(src, 'public class Probe {}\n');
  const body = "const a = process.argv.join(' ');"
    + " process.stdout.write(JSON.stringify(a.includes('compile') ? { Success: true, ErrorCount: 0, WarningCount: 0 } : { Success: true, Result: '{}' }) + '\\n');";
  const run = await withScriptedDispatcher(body, () => captureStdout(
    () => main(['asset', 'write', '--project-path', proj, '--to', 'Assets/PiProbe/Probe.cs', '--from', src, '--json']),
  ));
  assert.strictEqual(run.result, 0);
  const e = JSON.parse(run.out);
  assert.strictEqual(e.verified, true);
  assert.strictEqual(e.actual.compiled, true);
  assert.ok(fss.existsSync(pathh.join(proj, 'Assets/PiProbe/Probe.cs')), '文件必须真的落盘');

  const bad = await captureStdout(() => main(['asset', 'write', '--project-path', proj, '--to', '/abs/X.cs', '--from', src, '--json']));
  assert.strictEqual(bad.result, 2);
  assert.strictEqual(JSON.parse(bad.out).code, 'BAD_TARGET_PATH');
});
