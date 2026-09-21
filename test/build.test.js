'use strict';
// M3 任务 3：`unity build` —— 构建命令化 + 产物写后读回。
// 契约来源：`.superpowers/sdd/2026-09-19-pi-unity-m3-exec/task-3-brief.md`。
// 路径由真机探测定型（2026-09-19）：编辑器内 `execute-dynamic-code` → `BuildPipeline.BuildPlayer`
// （盲测项目实测 17.5s / Succeeded / 115.5 MB，见 task-3-report.md 的探测结论）。
// 覆盖：目标可用性（U9）/ 用法错只在 uloop 之前收敛 / 构建失败结构化错误 /
//      **假绿防线**（report 说成功但磁盘上没产物 → ARTIFACT_MISSING + verified:false）/
//      超时 / 截断 / 产物写后读回（verified 布尔 + 实测 sizeBytes）/ CLI 端到端。
// R371：主产物 mtime 新鲜度**从判据降级为 hint**（同 `--out` 增量重跑不重写产物不算失败）；
//      判据只剩「目录一致 / 存在 / 非空 / fileCount>0 / sizeBytes>0」。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../bin/unity.js');
const { buildGame, TARGETS, MTIME_SLACK_MS } = require('../lib/build.js');
const { exitCodeFor } = require('../lib/envelope.js');
const { captureStdout } = require('./helpers/capture.js');

/** 信封 → 退出码（复用生产实现，避免测试自己复述规则）。 */
function exitCodeOf(envelope) {
  return exitCodeFor(envelope);
}

/** 造一个真实存在的临时输出目录（生产路径会 `fs.mkdirSync`）。 */
function tempOut() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piu-build-out-'));
}

/** 造一个真实落盘的产物目录：主 exe + `*_Data/` 子目录（写后读回会真的 stat）。 */
function realOutWithArtifacts({ exeBytes = 464384, dataBytes = 1024 } = {}) {
  const out = tempOut();
  fs.writeFileSync(path.join(out, 'Game.exe'), Buffer.alloc(exeBytes, 1));
  fs.mkdirSync(path.join(out, 'Game_Data'), { recursive: true });
  fs.writeFileSync(path.join(out, 'Game_Data', 'level0'), Buffer.alloc(dataBytes, 2));
  return out;
}

/** 固定回放 json 的假 `_call`（形状与 test/scene.test.js 的 fakeCall 一致）。 */
function fakeCall(json, spy = [], extra = {}) {
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    return {
      code: 0, stdout: '', stderr: '', timedOut: false, drained: false,
      json, truncated: false, tool, args, ...extra,
    };
  };
}

/** `execute-dynamic-code` 的成功回包（脚本 `Result` 是 JSON 字符串）。 */
function scriptResult(payload) {
  return { Success: true, Result: JSON.stringify(payload) };
}

/** `build-player.cs` 的成功载荷（字段名与 C# 脚本逐字一致）。 */
function payloadSucceeded(outDir, overrides = {}) {
  return {
    result: 'Succeeded',
    totalErrors: 0,
    totalWarnings: 0,
    totalSize: 115535765,
    durationSeconds: 17.43,
    outputPath: `${outDir}/Game.exe`,
    productName: 'Game',
    sceneCount: 1,
    scenes: ['Assets/Scenes/SampleScene.scene'],
    Errors: [],
    Warnings: [],
    errorTotal: 0,
    warningTotal: 0,
    stepsTruncated: false,
    ...overrides,
  };
}

/** 写后读回面的注入缝（默认：目录与主 exe 都在，各文件有大小；mtime 默认「刚写出」）。
 *  ⚠️ `mtimeMs` 必须**在 stat 调用时**求值（`Date.now()`），不能在造 fake 时就定值 ——
 *  读回发生在构建「开始之后」，定值会落到 `startedAt` 之前，多出一条「未在本轮被重写」hint
 *  （R371：mtime 已降级为 hint，不再是红；但默认值应当代表「本轮写的」）。 */
function fakeFs({ exists = [], entries = {}, sizes = {}, mtimes = {} } = {}) {
  const existsSet = new Set(exists);
  return {
    _exists: (p) => existsSet.has(p),
    _readDir: (p) => entries[p] || [],
    _stat: (p) => ({
      size: sizes[p] ?? 0,
      mtimeMs: Object.hasOwn(mtimes, p) ? mtimes[p] : Date.now(),
      isDirectory: () => Object.hasOwn(entries, p),
    }),
  };
}

/** `fs.Dirent` 的最小替身。 */
function dirent(name, isDir) {
  return { name, isDirectory: () => isDir };
}

/** 一套「产物完整」的读回注入缝（`mtimes` 透传给 `fakeFs`，用于「本轮没重写」场景）。 */
function fsWithArtifacts(out, { exeBytes = 464384, dllBytes = 44104024, exeEntryName = 'Game.exe', mtimes = {} } = {}) {
  const exe = path.join(out, exeEntryName);
  const dataDir = path.join(out, 'Game_Data');
  const level0 = path.join(dataDir, 'level0');
  const dll = path.join(out, 'TuanjiePlayer.dll');
  return fakeFs({
    exists: [out, exe, dataDir, level0, dll],
    entries: {
      [out]: [dirent(exeEntryName, false), dirent('Game_Data', true), dirent('TuanjiePlayer.dll', false)],
      [dataDir]: [dirent('level0', false)],
    },
    sizes: { [exe]: exeBytes, [level0]: 1024, [dll]: dllBytes },
    mtimes,
  });
}

// ─────────────────────────── 目标可用性（U9）───────────────────────────

test('目标不可用 → BUILD_TARGET_UNAVAILABLE + hint 列出可用目标（退出码 1，绝不假装成功）', async () => {
  const out = tempOut();
  const spy = [];
  const e = await buildGame({
    projectPath: 'P',
    target: 'webgl',
    outDir: out,
    _call: fakeCall(scriptResult({
      __error: 'BUILD_TARGET_UNAVAILABLE', target: 'webgl', available: ['win64', 'android'],
    }), spy),
    ...fakeFs(),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BUILD_TARGET_UNAVAILABLE');
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeOf(e), 1, '目标不可用是**运行时**错（不是用法错，也不许自动改打别的目标）');
  assert.deepStrictEqual(e.actual, { target: 'webgl', available: ['win64', 'android'] });
  assert.ok(e.hint.some((h) => h.includes('win64') && h.includes('android')), `hint 必须列出可用目标：${JSON.stringify(e.hint)}`);
  assert.ok(e.hint.some((h) => h.includes('doctor')), 'hint 要指向 `unity doctor` 的 build-targets');
  assert.strictEqual(spy.length, 1);
});

test('目标枚举缺失/枚举外/非字符串 → MISSING_TO / BAD_ACTION，且不发起任何 uloop 调用', async () => {
  const out = tempOut();
  for (const [target, code] of [
    [undefined, 'MISSING_TO'],
    [true, 'BAD_ACTION'],
    ['', 'BAD_ACTION'],
    ['ps5', 'BAD_ACTION'],
    [42, 'BAD_ACTION'],
  ]) {
    const spy = [];
    const e = await buildGame({
      projectPath: 'P', target, outDir: out, _call: fakeCall(scriptResult(payloadSucceeded(out)), spy), ...fakeFs(),
    });
    assert.strictEqual(e.ok, false, `target=${JSON.stringify(target)}`);
    assert.strictEqual(e.code, code, `target=${JSON.stringify(target)}`);
    assert.strictEqual(exitCodeOf(e), 2, `target=${JSON.stringify(target)} 必须是用法错`);
    assert.strictEqual(spy.length, 0, `target=${JSON.stringify(target)} 不得发起 uloop 调用`);
  }
});

test('目标表把「枚举名」集中在一处（candidates 由 TARGETS 生成，不散落在 CLI）', () => {
  assert.deepStrictEqual(Object.keys(TARGETS).sort(), ['android', 'webgl', 'weixin', 'win64']);
  assert.strictEqual(TARGETS.win64.buildTarget, 'StandaloneWindows64');
  assert.strictEqual(TARGETS.win64.buildTargetGroup, 'Standalone');
});

// ─────────────────────────── 用法错（在 uloop 之前收敛）───────────────────────────

test('--out 缺失/裸写/空串/非字符串 → BAD_OUT_DIR（用法错 2），不发起调用', async () => {
  for (const outDir of [undefined, true, '', 42, ['x']]) {
    const spy = [];
    const e = await buildGame({
      projectPath: 'P', target: 'win64', outDir, _call: fakeCall(scriptResult({}), spy), ...fakeFs(),
    });
    assert.strictEqual(e.code, 'BAD_OUT_DIR', `outDir=${JSON.stringify(outDir)}`);
    assert.strictEqual(exitCodeOf(e), 2);
    assert.strictEqual(spy.length, 0);
  }
});

test('--timeout-seconds 非正整数 → BAD_TIMEOUT（用法错 2），不发起调用', async () => {
  const out = tempOut();
  for (const t of ['0', '-1', '1.5', 'abc', true, '']) {
    const spy = [];
    const e = await buildGame({
      projectPath: 'P', target: 'win64', outDir: out, timeoutSeconds: t,
      _call: fakeCall(scriptResult(payloadSucceeded(out)), spy), ...fakeFs(),
    });
    assert.strictEqual(e.code, 'BAD_TIMEOUT', `timeoutSeconds=${JSON.stringify(t)}`);
    assert.strictEqual(exitCodeOf(e), 2);
    assert.strictEqual(spy.length, 0);
  }
  // F4②：校验本体只允许在 lib/asset.js 一处实现（build 复用 compileTimeoutArg，不复制第三份）
  const buildSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'build.js'), 'utf8');
  assert.ok(buildSrc.includes('compileTimeoutArg'), 'lib/build.js 必须复用 lib/asset.js 的 compileTimeoutArg');
  assert.ok(!buildSrc.includes('/^\\d+$/'), 'lib/build.js 不得再复制一份 —timeout-seconds 的正则校验');
});

test('--project-path 缺失/裸写/空串 → MISSING_PROJECT_PATH（不加守卫会打错工程），不发起调用', async () => {
  const out = tempOut();
  for (const projectPath of [undefined, true, '']) {
    const spy = [];
    const e = await buildGame({
      projectPath, target: 'win64', outDir: out,
      _call: fakeCall(scriptResult(payloadSucceeded(out)), spy), ...fakeFs(),
    });
    assert.strictEqual(e.code, 'MISSING_PROJECT_PATH', `projectPath=${JSON.stringify(projectPath)}`);
    assert.strictEqual(exitCodeFor(e), 2, '缺 project-path 是用法错（R477）');
    assert.strictEqual(spy.length, 0);
  }
});

// ─────────────────────────── 构建失败 / 上游错误 ───────────────────────────

test('构建报告失败（totalErrors>0）→ BUILD_FAILED + 结构化错误（复用 compressIssues 的形状）', async () => {
  const out = tempOut();
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(out, {
      result: 'Failed',
      totalErrors: 2,
      totalWarnings: 1,
      Errors: [
        { Message: 'CS1002: ; expected', File: 'Assets/PiBB/X.cs', Line: 7 },
        { Message: 'Build failed with 1 error', File: null, Line: null },
      ],
      Warnings: [{ Message: 'unused variable', File: 'Assets/X.cs', Line: 3 }],
    }))),
    ...fsWithArtifacts(out),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BUILD_FAILED');
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeOf(e), 1);
  assert.strictEqual(e.actual.result, 'Failed');
  assert.strictEqual(e.actual.totalErrors, 2);
  assert.deepStrictEqual(e.actual.errors, [
    { message: 'CS1002: ; expected', file: 'Assets/PiBB/X.cs', line: 7 },
    { message: 'Build failed with 1 error', file: null, line: null },
  ]);
  assert.deepStrictEqual(e.actual.warnings, [{ message: 'unused variable', file: 'Assets/X.cs', line: 3 }]);
  assert.ok(e.hint.some((h) => h.includes('CS1002')), `hint 要给首条错误：${JSON.stringify(e.hint)}`);
});

test('result=Succeeded 但 totalErrors>0（自相矛盾）→ BUILD_FAILED，不猜成成功', async () => {
  const out = tempOut();
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(out, { totalErrors: 3 }))),
    ...fsWithArtifacts(out),
  });
  assert.strictEqual(e.code, 'BUILD_FAILED');
  assert.strictEqual(exitCodeOf(e), 1);
});

test('没有可构建的场景 → BUILD_NO_SCENES（退出码 1）+ hint 给出出路', async () => {
  const out = tempOut();
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult({ __error: 'BUILD_NO_SCENES' })),
    ...fakeFs(),
  });
  assert.strictEqual(e.code, 'BUILD_NO_SCENES');
  assert.strictEqual(exitCodeOf(e), 1);
  assert.ok(e.hint.some((h) => /Build Settings|scene save/.test(h)), `hint 要给出路：${JSON.stringify(e.hint)}`);
});

test('输出目录建不了 → OUT_DIR_UNWRITABLE（运行时错 1，不是用法错）', async () => {
  const out = tempOut();
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult({ __error: 'OUT_DIR_UNWRITABLE', detail: 'Access to the path is denied.' })),
    ...fakeFs(),
  });
  assert.strictEqual(e.code, 'OUT_DIR_UNWRITABLE');
  assert.strictEqual(exitCodeOf(e), 1);
  assert.ok(e.hint.some((h) => h.includes(out)), `hint 要带上具体目录：${JSON.stringify(e.hint)}`);
});

test('脚本抛异常 → BUILD_FAILED，detail 进 actual（不谎报成功）', async () => {
  const out = tempOut();
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult({ __error: 'BUILD_FAILED', detail: 'NullReferenceException: ...' })),
    ...fsWithArtifacts(out),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BUILD_FAILED');
  assert.strictEqual(exitCodeOf(e), 1);
  assert.ok(JSON.stringify(e.actual).includes('NullReferenceException'));
});

test('编辑器没连上（上游失败信封）→ 原码透传 + 补「本命令需要编辑器开着」的 hint', async () => {
  const out = tempOut();
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall({
      Success: false,
      Error: {
        ErrorCode: 'UNITY_NOT_REACHABLE',
        Phase: 'connection',
        Message: 'The Unity CLI Loop server is not reachable for this project.',
        Retryable: true,
        NextActions: ['If Unity is closed, run `uloop launch`.'],
      },
    }),
    ...fakeFs(),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'UNITY_NOT_REACHABLE');
  assert.strictEqual(exitCodeOf(e), 1);
  assert.ok(
    e.hint.some((h) => h.includes('编辑器') && /打开|连接/.test(h)),
    `必须点明「构建走已连接的编辑器」：${JSON.stringify(e.hint)}`,
  );
});

// ─────────────────────────── 传输层：超时 / 截断 ───────────────────────────

test('uloop 超时（timedOut）→ BUILD_TIMEOUT（不是泛化的 ULOOP_TRUNCATED），hint 说明构建可能仍在跑', async () => {
  const out = tempOut();
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: async (tool, args) => ({
      code: 124, stdout: '', stderr: '', timedOut: true, drained: false,
      json: null, truncated: true, tool, args,
    }),
    ...fsWithArtifacts(out),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BUILD_TIMEOUT');
  assert.strictEqual(exitCodeOf(e), 1);
  assert.ok(e.hint.some((h) => /仍在|继续构建|还没结束/.test(h)), `hint 要说清后台可能还在构建：${JSON.stringify(e.hint)}`);
  // R366：超时的 hint **不得**诱导「有产物就直接复用」——那次构建从未被读回校验，
  // 半成品目录同样有同名 exe；必须要求先核对完整性、不确定就重跑。
  const hintText = e.hint.join('\n');
  assert.ok(!/直接复用/.test(hintText), `超时 hint 不得写「直接复用」：${hintText}`);
  assert.ok(/重跑|核对/.test(hintText), `超时 hint 必须要求核对完整性或直接重跑：${hintText}`);
  assert.ok(/半成品|不完整/.test(hintText), `超时 hint 必须点明该目录可能不完整：${hintText}`);
});

test('输出被截断但不是超时（drained）→ ULOOP_TRUNCATED（残缺载荷不可信）', async () => {
  const out = tempOut();
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: async (tool, args) => ({
      code: 0, stdout: '', stderr: '', timedOut: false, drained: true,
      json: null, truncated: true, tool, args,
    }),
    ...fsWithArtifacts(out),
  });
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
  assert.strictEqual(exitCodeOf(e), 1);
});

// ─────────────────────────── 写后读回（verified 布尔）───────────────────────────

test('产物完整 → verified:true + 实测 sizeBytes（磁盘总字节，不是 report 的 totalSize）', async () => {
  const out = tempOut();
  const spy = [];
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(out)), spy),
    ...fsWithArtifacts(out),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true, '写后读回通过才允许 verified:true');
  assert.strictEqual(exitCodeOf(e), 0);
  assert.deepStrictEqual(e.intent, { built: true, target: 'win64' });
  assert.deepStrictEqual(e.mismatches, [], '成功信封一律带空 mismatches（与既有写命令同口径）');
  assert.strictEqual(e.actual.sizeBytes, 464384 + 1024 + 44104024, 'sizeBytes 必须是磁盘实测总字节');
  assert.strictEqual(e.actual.reportedSizeBytes, 115535765, 'report 的体积另存，便于与实测对账');
  assert.strictEqual(e.actual.result, 'Succeeded');
  assert.strictEqual(e.actual.totalErrors, 0);
  assert.strictEqual(e.actual.totalWarnings, 0);
  assert.strictEqual(e.actual.durationSeconds, 17.43);
  assert.strictEqual(e.actual.outDir, out);
  assert.strictEqual(e.actual.target, 'win64');
  assert.deepStrictEqual(
    e.actual.artifacts.map((a) => [a.name, a.type]),
    [['Game.exe', 'file'], ['Game_Data', 'directory'], ['TuanjiePlayer.dll', 'file']],
    'artifacts 必须是**实际目录**的内容（不硬编码 Unity 官方产物名）',
  );
  assert.strictEqual(e.actual.mainArtifact.name, 'Game.exe');
  assert.strictEqual(e.actual.mainArtifact.exists, true);
  assert.strictEqual(spy.length, 1);
  assert.strictEqual(spy[0].tool, 'execute-dynamic-code');
});

test('假绿防线①：report 说 Succeeded 但磁盘上什么都没写 → ARTIFACT_MISSING + verified:false', async () => {
  const out = tempOut();
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(out))),
    _exists: () => false,
    _readDir: () => [],
    _stat: () => ({ size: 0 }),
  });
  assert.strictEqual(e.ok, false, 'report 成功 + 磁盘无产物 = 失败，绝不能落 ok:true');
  assert.strictEqual(e.code, 'ARTIFACT_MISSING');
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeOf(e), 1);
  assert.ok(e.mismatches.some((m) => m.key === 'outDir'), `mismatches 要指出哪里对不上：${JSON.stringify(e.mismatches)}`);
  assert.strictEqual(e.actual.sizeBytes, 0);
});

test('假绿防线②：主可执行文件在但 0 字节 → ARTIFACT_MISSING（空文件不算产物）', async () => {
  const out = tempOut();
  const exe = path.join(out, 'Game.exe');
  const dll = path.join(out, 'TuanjiePlayer.dll');
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(out))),
    ...fakeFs({
      exists: [out, exe, dll],
      entries: { [out]: [dirent('Game.exe', false), dirent('TuanjiePlayer.dll', false)] },
      sizes: { [exe]: 0, [dll]: 44104024 },
    }),
  });
  assert.strictEqual(e.code, 'ARTIFACT_MISSING');
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeOf(e), 1);
  assert.ok(e.mismatches.some((m) => m.key === 'mainArtifact.sizeBytes'), JSON.stringify(e.mismatches));
  assert.strictEqual(e.actual.sizeBytes, 44104024, '实际体积照报（便于排障），但不许据此判成功');
});

test('假绿防线③：report 的 outputPath 是空串（拿不到主产物名）→ ARTIFACT_MISSING', async () => {
  const out = tempOut();
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(out, { outputPath: '' }))),
    ...fsWithArtifacts(out),
  });
  assert.strictEqual(e.code, 'ARTIFACT_MISSING');
  assert.strictEqual(exitCodeOf(e), 1);
  assert.ok(e.mismatches.some((m) => m.key === 'outputPath'), JSON.stringify(e.mismatches));
});

test('假绿防线④（R364）：report 的 outputPath 落在**别的目录**，--out 里恰有上一轮同名产物 → 不许 verified', async () => {
  const out = tempOut();          // --out：里面有上一轮的 Game.exe（mtime 是「刚刚」）
  const other = tempOut();        // report 实际报告的目录
  const exe = path.join(out, 'Game.exe');
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(other.replace(/\\/g, '/')))),
    ...fakeFs({
      exists: [out, exe],
      entries: { [out]: [dirent('Game.exe', false)] },
      sizes: { [exe]: 464384 },
    }),
  });
  assert.strictEqual(e.ok, false, '只比 basename 会拿上一轮同名产物假绿：目录对不上就不许 ok:true');
  assert.strictEqual(e.code, 'ARTIFACT_MISSING');
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeOf(e), 1);
  const m = e.mismatches.find((x) => x.key === 'outputPath.dir');
  assert.ok(m, `mismatches 必须指出 outputPath 的目录不对：${JSON.stringify(e.mismatches)}`);
  assert.strictEqual(m.intent, out);
  assert.strictEqual(m.actual, other);
});

test('R371：同 --out 连跑第二次（工程未改，Unity 判定已最新不重写产物）→ 不误红 + hint 说明产物仍可用', async () => {
  // 真机误红复现：产物完好、report 也是 Succeeded，只因主产物 mtime 落在本轮之前就落 ARTIFACT_MISSING。
  // 增量/无改动重跑不重写产物是 Unity 的**正确语义**，不该判红；判据只剩「目录/存在/非空/count/size」。
  const out = tempOut();
  const stale = Date.now() - 3600_000;   // 一小时前：上一轮构建写出的产物
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(out.replace(/\\/g, '/')))),
    ...fsWithArtifacts(out, {
      mtimes: {
        [path.join(out, 'Game.exe')]: stale,
        [path.join(out, 'Game_Data', 'level0')]: stale,
        [path.join(out, 'TuanjiePlayer.dll')]: stale,
      },
    }),
  });
  assert.strictEqual(e.ok, true, `产物完好却被判红（R371 真机误红）：${JSON.stringify(e.mismatches ?? e)}`);
  assert.strictEqual(e.verified, true);
  assert.strictEqual(exitCodeOf(e), 0, '误红会直接让 CLI 退出码变 1');
  assert.deepStrictEqual(e.mismatches, [], 'mtime 不再是判据：不许出现在 mismatches 里');
  assert.strictEqual(e.actual.mainArtifact.exists, true);
  assert.strictEqual(e.actual.mainArtifact.mtimeMs, stale, '旧 mtime 照报（排障要它），但不影响成败');
  assert.ok(e.actual.fileCount > 0 && e.actual.sizeBytes > 0, '非空/count/size 仍是判据');
  assert.ok(
    e.hint.some((h) => h.includes('未在本轮被重写')),
    `必须给「未在本轮被重写」hint（真话而不是失败）：${JSON.stringify(e.hint)}`,
  );
});

test('R371 反证：降级 mtime 后，目录一致性（R364①）仍是防线 —— outputPath 落到别的目录且 --out 里只有上一轮同名产物 → 必须红', async () => {
  // 变体自检锚点：去捧 `dirCompareKey` 比较（或删 dir 判定）→ 本用例必须变红。
  const out = tempOut();
  const other = tempOut();
  const exe = path.join(out, 'Game.exe');
  const stale = Date.now() - 3600_000;   // 连 mtime 也是旧的：红只可能来自目录不一致
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(other.replace(/\\/g, '/')))),
    ...fakeFs({
      exists: [out, exe],
      entries: { [out]: [dirent('Game.exe', false)] },
      sizes: { [exe]: 464384 },
      mtimes: { [exe]: stale },
    }),
  });
  assert.strictEqual(e.ok, false, '目录对不上就是拿上一轮同名产物冒充：不许 ok:true');
  assert.strictEqual(e.code, 'ARTIFACT_MISSING');
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeOf(e), 1);
  assert.ok(
    e.mismatches.some((m) => m.key === 'outputPath.dir'),
    `红必须来自目录不一致：${JSON.stringify(e.mismatches)}`,
  );
  assert.ok(
    !e.mismatches.some((m) => m.key === 'mainArtifact.mtimeMs'),
    'mtime 已降级为 hint：它不得出现在 mismatches 里',
  );
});

test('R371（原假绿防线⑤改写）：--out 里的同名主产物是上一轮的（mtime 早于本轮开始）→ 不再判红，改为 hint', async () => {
  const out = tempOut();
  const exe = path.join(out, 'Game.exe');
  const stale = Date.now() - 3600_000;   // 一小时前：上一轮构建的产物
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(out.replace(/\\/g, '/')))),
    ...fakeFs({
      exists: [out, exe],
      entries: { [out]: [dirent('Game.exe', false)] },
      sizes: { [exe]: 464384 },
      mtimes: { [exe]: stale },
    }),
  });
  assert.strictEqual(e.ok, true, `陈旧 mtime 不再是失败理由（R371）：${JSON.stringify(e.mismatches ?? e)}`);
  assert.strictEqual(e.verified, true);
  assert.strictEqual(exitCodeOf(e), 0);
  assert.deepStrictEqual(e.mismatches, []);
  assert.ok(
    e.hint.some((h) => h.includes('未在本轮被重写')),
    `hint 必须点明「未在本轮被重写」：${JSON.stringify(e.hint)}`,
  );
});

test('R371（原假绿防线⑤-b改写）：mtime 差 1900ms（在 MTIME_SLACK_MS=2000 容差内）→ 视为本轮写出：无 hint、不判红', async () => {
  // 容差存在的理由：文件系统 mtime 粒度（FAT 2s）+ 时钟取整会让「刚写出」落在构建开始前几毫秒。
  // R371 后容差只决定 hint 出不出现（不再决定成败）—— 不加容差会在粗粒度文件系统上刷出**假 hint**。
  const out = tempOut();
  const exe = path.join(out, 'Game.exe');
  const mtime = Date.now() - 1900;
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(out.replace(/\\/g, '/')))),
    ...fakeFs({
      exists: [out, exe],
      entries: { [out]: [dirent('Game.exe', false)] },
      sizes: { [exe]: 464384 },
      mtimes: { [exe]: mtime },
    }),
  });
  assert.strictEqual(e.ok, true, `差 1900ms 必须落在容差内：${JSON.stringify(e.mismatches ?? e)}`);
  assert.strictEqual(e.verified, true);
  assert.ok(
    !e.hint.some((h) => h.includes('未在本轮被重写')),
    `容差内不得断言「未在本轮被重写」（假 hint）：${JSON.stringify(e.hint)}`,
  );
  // 容差是契约的一部分：钉住它，别让「顺手放宽」悄悄生效（放宽到 >= 5000 会让下面那条用例的 hint 消失）
  assert.strictEqual(MTIME_SLACK_MS, 2000, 'MTIME_SLACK_MS 是被用例钉住的契约值，改动必须同步改用例与注释');
});

test('R371（原假绿防线⑤-c改写）：mtime 差 5000ms（超出 MTIME_SLACK_MS=2000）→ 仍不判红，hint 给两条出路', async () => {
  const out = tempOut();
  const exe = path.join(out, 'Game.exe');
  const old = Date.now() - 5000;
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(out.replace(/\\/g, '/')))),
    ...fakeFs({
      exists: [out, exe],
      entries: { [out]: [dirent('Game.exe', false)] },
      sizes: { [exe]: 464384 },
      mtimes: { [exe]: old },
    }),
  });
  assert.strictEqual(e.ok, true, `超出容差也不许判红（成败与容差无关，R371）：${JSON.stringify(e.mismatches ?? e)}`);
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(e.mismatches, []);
  const h = e.hint.find((x) => x.includes('未在本轮被重写'));
  assert.ok(h, `必须给「未在本轮被重写」hint：${JSON.stringify(e.hint)}`);
  assert.match(h, /强制重建/, `hint 要给出路：${h}`);
  assert.match(h, /--out/, `hint 要给出路（换 --out）：${h}`);
  assert.match(h, /清空/, `hint 要给出路（先清空旧产物）：${h}`);
});

test('R368：win32 大小写不敏感 —— report 的 outputPath 只有大小写不同（同一目录）→ 不许误红', { skip: process.platform !== 'win32' ? '仅 Windows 的文件系统大小写不敏感' : false }, async () => {
  const out = tempOut();
  // 只翻驱动盘符的大小写：`C:\…` → `c:\…`（同一目录，Unity 回传大小写不保证逐字一致）
  const flipped = out.replace(/^([A-Za-z]):/, (_, d) => `${d === d.toUpperCase() ? d.toLowerCase() : d.toUpperCase()}:`);
  assert.notStrictEqual(flipped, out, '本用例必须真的翻到大小写（否则它什么都没测）');
  const exe = path.join(out, 'Game.exe');
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(flipped.replace(/\\/g, '/')))),
    ...fakeFs({
      exists: [out, exe],
      entries: { [out]: [dirent('Game.exe', false)] },
      sizes: { [exe]: 464384 },
    }),
  });
  assert.strictEqual(
    e.ok, true,
    `只有大小写不同的同一目录不许报 outputPath.dir（否则真成功被误红）：${JSON.stringify(e.mismatches ?? e.code)}`,
  );
  assert.strictEqual(e.verified, true);
});

test('目录型产物（webgl/weixin）：目录内文件递归非空才算产物（空目录 → ARTIFACT_MISSING）', async () => {
  const out = tempOut();
  const mainDir = path.join(out, 'Game');            // 无扩展名 → report 的 outputPath 是目录
  const index = path.join(mainDir, 'index.html');
  const declared = mainDir.replace(/\\/g, '/');

  const filled = await buildGame({
    projectPath: 'P', target: 'webgl', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(out, { outputPath: declared }))),
    ...fakeFs({
      exists: [out, mainDir, index],
      entries: { [out]: [dirent('Game', true)], [mainDir]: [dirent('index.html', false)] },
      sizes: { [index]: 32 },
    }),
  });
  assert.strictEqual(filled.ok, true, JSON.stringify(filled));
  assert.strictEqual(filled.verified, true);
  assert.strictEqual(filled.actual.mainArtifact.isDirectory, true);
  assert.strictEqual(
    filled.actual.mainArtifact.sizeBytes, 32,
    '目录型主产物的体积是目录内文件的递归合计（stat(dir).size 在 Windows 上恒 0，不能当判据）',
  );

  const empty = await buildGame({
    projectPath: 'P', target: 'webgl', outDir: out,
    _call: fakeCall(scriptResult(payloadSucceeded(out, { outputPath: declared }))),
    ...fakeFs({
      exists: [out, mainDir],
      entries: { [out]: [dirent('Game', true)], [mainDir]: [] },
    }),
  });
  assert.strictEqual(empty.ok, false, '空目录不算产物');
  assert.strictEqual(empty.code, 'ARTIFACT_MISSING');
  assert.strictEqual(empty.verified, false);
  assert.ok(empty.mismatches.some((m) => m.key === 'mainArtifact.sizeBytes'), JSON.stringify(empty.mismatches));
});

test('report 为 null（BuildPlayer 返回 null）→ 脚本落 BUILD_FAILED 哨兵（不抛 NRE），JS 侧不谎报成功', async () => {
  // 跨语言：C# 脚本必须在解引用 report.summary 之前挡住 null（R365），否则报错不可读
  const cs = fs.readFileSync(path.join(__dirname, '..', 'unity-scripts', 'build-player.cs'), 'utf8');
  assert.match(cs, /report\s*==\s*null/, 'report 为 null 必须有显式守卫（否则 report.summary 直接 NRE）');
  assert.match(cs, /report\s*==\s*null[\s\S]{0,300}"BUILD_FAILED"/, '守卫分支必须落 BUILD_FAILED 哨兵');
  assert.ok(cs.includes('BuildPlayer returned null'), 'detail 必须写明 BuildPlayer returned null');

  // R367（Critical）禁止性 tripwire：`BuildSummary` 是 **struct**（团结 2022.3.62t9 实测；
  // Unity 官方版同 —— `UnityEditor.CoreModule` 的 TypeDef extends `System.ValueType`，无 `op_Equality`），
  // 对 struct 写 `== null` 是**编译错误 CS0019**（实测原文：`Operator '==' cannot be applied to operands
  // of type 'BuildSummary' and '<null>'`）→ 整个脚本编译不过，**真机 `unity build` 必挂**。
  // ⚠️ 这类断言**只**是禁用性 tripwire：它抓不住别的编译错误；凡改动 `.cs`，真机跑一次才是唯一有效验证。
  assert.doesNotMatch(
    cs, /\.summary\s*==\s*null/,
    '`report.summary` 是 BuildSummary(struct)，与 null 比较会让脚本编译失败（CS0019）——只判 `report`',
  );
  // 更宽的一条：编辑器侧的 `*.Summary` / `*Report` 类型不得与 null 比较（struct 没有 op_Equality 的可能）
  assert.doesNotMatch(
    cs, /\.\w*(Summary|Report)\b[\w.[\]"']*\s*[!=]=\s*null/i,
    '`*.Summary`/`*Report` 字段不得与 null 比较（这些编辑器类型里可能是 struct，== null 即 CS0019）',
  );

  const out = tempOut();
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult({ __error: 'BUILD_FAILED', detail: 'BuildPlayer returned null' })),
    ...fsWithArtifacts(out),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BUILD_FAILED');
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeOf(e), 1);
  assert.strictEqual(e.actual.detail, 'BuildPlayer returned null');
});

test('相对 --out 按当前 shell 的 cwd 解析成绝对路径再发给编辑器（避免以编辑器 cwd 为基准）', async () => {
  const spy = [];
  const e = await buildGame({
    projectPath: 'P', target: 'win64', outDir: 'rel-out-dir-should-not-exist',
    _call: fakeCall(scriptResult(payloadSucceeded(path.resolve('rel-out-dir-should-not-exist'))), spy),
    _exists: () => false, _readDir: () => [], _stat: () => ({ size: 0 }),
  });
  const payload = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.strictEqual(payload.outDir, path.resolve('rel-out-dir-should-not-exist'));
  assert.strictEqual(e.actual.outDir, path.resolve('rel-out-dir-should-not-exist'));
});

// ─────────────────────────── 调用形状 / 跨语言 tripwire ───────────────────────────

test('调用形状：execute-dynamic-code + build-player.cs + --parameters 单参数载荷 + timeoutMs', async () => {
  const out = tempOut();
  const spy = [];
  await buildGame({
    projectPath: 'P', target: 'android', outDir: out, timeoutSeconds: '30',
    _call: fakeCall(scriptResult({ __error: 'BUILD_TARGET_UNAVAILABLE', target: 'android', available: [] }), spy),
    ...fakeFs(),
  });
  assert.strictEqual(spy[0].tool, 'execute-dynamic-code');
  assert.strictEqual(spy[0].args[0], '--code-file');
  assert.match(spy[0].args[1], /unity-scripts[\\/]build-player\.cs$/);
  assert.strictEqual(spy[0].args[2], '--parameters');
  const payload = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.strictEqual(payload.target, 'android');
  assert.strictEqual(payload.outDir, out);
  assert.strictEqual(payload.outputExtension, '.apk');
  assert.deepStrictEqual(
    payload.candidates.map((c) => c.name).sort(),
    Object.keys(TARGETS).sort(),
    'candidates 必须由 TARGETS 生成（目标表只此一处）',
  );
  assert.strictEqual(spy[0].opts.timeoutMs, 30000, '--timeout-seconds 必须转成 uloop 的 timeoutMs');
  assert.strictEqual(spy[0].opts.projectPath, 'P');
});

test('默认超时 600s → timeoutMs=600000（与 `unity compile` 同口径）', async () => {
  const out = tempOut();
  const spy = [];
  await buildGame({
    projectPath: 'P', target: 'win64', outDir: out,
    _call: fakeCall(scriptResult({ __error: 'BUILD_TARGET_UNAVAILABLE', target: 'win64', available: [] }), spy),
    ...fakeFs(),
  });
  assert.strictEqual(spy[0].opts.timeoutMs, 600000);
});

test('跨语言 tripwire：build-player.cs 的入参/出参/错误码与 lib/build.js 读的字段逐字一致', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'unity-scripts', 'build-player.cs'), 'utf8');
  for (const token of ['parameters["param0"]', 'req["target"]', 'req["outDir"]', 'req["outputExtension"]', 'req["candidates"]']) {
    assert.ok(src.includes(token), `脚本必须读入参 ${token}`);
  }
  for (const token of ['res["result"]', 'res["totalErrors"]', 'res["totalWarnings"]', 'res["totalSize"]',
    'res["durationSeconds"]', 'res["outputPath"]', 'res["Errors"]', 'res["Warnings"]']) {
    assert.ok(src.includes(token), `脚本必须回出参 ${token}`);
  }
  for (const code of ['BUILD_TARGET_UNAVAILABLE', 'BUILD_NO_SCENES', 'OUT_DIR_UNWRITABLE', 'BUILD_FAILED']) {
    assert.ok(src.includes(`"${code}"`), `脚本必须能落错误码 ${code}`);
  }
  // 目标可用性只能由 BuildPipeline.IsBuildTargetSupported 判定（U9），不许按目录名/硬编码表猜
  assert.ok(src.includes('IsBuildTargetSupported'), '目标可用性必须问编辑器');
  assert.ok(!/UnityPlayer\.dll|\.unity"/.test(src), '不得硬编码 Unity 官方产物名/场景扩展名（约束 5/24）');
});

// ─────────────────────────── CLI 端到端 ───────────────────────────

/** 写一个「按 argv 回固定 json」的假 dispatcher 并运行 fn（同 test/dynamic.test.js 的口径）。 */
async function withScriptedDispatcher(scriptBody, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-build-disp-'));
  const fake = path.join(dir, 'fake-uloop.js');
  fs.writeFileSync(fake, scriptBody);
  const saved = process.env.PI_UNITY_ULOOP_CMD;
  process.env.PI_UNITY_ULOOP_CMD = JSON.stringify([process.execPath, fake]);
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.PI_UNITY_ULOOP_CMD;
    else process.env.PI_UNITY_ULOOP_CMD = saved;
  }
}

function dispatcherBody(payload) {
  // 两层 stringify：内层是脚本的 `Result` 字符串，外层是生成代码里的 JS 字符串字面量。
  const result = JSON.stringify(scriptResult(payload));
  return `process.stdout.write(${JSON.stringify(result)} + '\\n');`;
}

test('CLI build 成功 → 退出码 0，--json 里 verified:true 且 sizeBytes 是磁盘实测', async () => {
  const out = realOutWithArtifacts();
  const run = await withScriptedDispatcher(
    dispatcherBody(payloadSucceeded(out.replace(/\\/g, '/'))),
    () => captureStdout(() => main(['build', '--project-path', 'X', '--target', 'win64', '--out', out, '--json'])),
  );
  assert.strictEqual(run.result, 0);
  const e = JSON.parse(run.out);
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.strictEqual(e.actual.target, 'win64');
  assert.strictEqual(e.actual.sizeBytes, 464384 + 1024);
  assert.ok(e.actual.sizeBytes < e.actual.reportedSizeBytes, '实测体积与 report 体积是两回事');
});

test('CLI build 目标不可用 → 退出码 1 + code=BUILD_TARGET_UNAVAILABLE（不许退化成别的目标）', async () => {
  const out = tempOut();
  const run = await withScriptedDispatcher(
    dispatcherBody({ __error: 'BUILD_TARGET_UNAVAILABLE', target: 'webgl', available: ['win64', 'android', 'weixin'] }),
    () => captureStdout(() => main(['build', '--project-path', 'X', '--target', 'webgl', '--out', out, '--json'])),
  );
  assert.strictEqual(run.result, 1);
  const e = JSON.parse(run.out);
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BUILD_TARGET_UNAVAILABLE');
  assert.deepStrictEqual(e.actual.available, ['win64', 'android', 'weixin']);
});

test('CLI build --out 裸写 → 退出码 2 且 code=BAD_OUT_DIR（用法错在调用之前收敛）', async () => {
  const run = await captureStdout(() => main(['build', '--project-path', 'X', '--target', 'win64', '--out', '--json']));
  assert.strictEqual(run.result, 2);
  const e = JSON.parse(run.out);
  assert.strictEqual(e.code, 'BAD_OUT_DIR');
});

test('CLI build 人读输出不撒谎：成功打 [VERIFIED]，假绿打 [FAIL] ARTIFACT_MISSING', async () => {
  const out = tempOut();
  const okRun = await withScriptedDispatcher(
    dispatcherBody(payloadSucceeded(out.replace(/\\/g, '/'))),
    () => captureStdout(() => main(['build', '--project-path', 'X', '--target', 'win64', '--out', out])),
  );
  assert.strictEqual(okRun.result, 1, '磁盘上没有产物（tempOut 是空目录）→ 不许退出 0');
  assert.match(okRun.out, /\[FAIL\] ARTIFACT_MISSING/);

  const real = realOutWithArtifacts();
  const verifiedRun = await withScriptedDispatcher(
    dispatcherBody(payloadSucceeded(real.replace(/\\/g, '/'))),
    () => captureStdout(() => main(['build', '--project-path', 'X', '--target', 'win64', '--out', real])),
  );
  assert.strictEqual(verifiedRun.result, 0);
  assert.match(verifiedRun.out, /\[VERIFIED\]/);
});
