'use strict';
// M3 任务 2：`unity scene save` / `unity scene open` —— 交付物落盘闭环（关闭 E2E B2）。
// 契约来源：`.superpowers/sdd/2026-09-19-pi-unity-m3-exec/task-2-brief.md`。
// 覆盖：写后读回（sceneTree 的 sceneName）+ 用法错只在 uloop 之前收敛 + 脏场景守卫 + 截断不假绿。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../bin/unity.js');
const { sceneSave, sceneOpen } = require('../lib/scenefile.js');
// F1/R359：证明 `readBackAndVerify` 的 `successHint` 默认值没有动到既有写命令的成功输出。
const { nodeCreate } = require('../lib/scene.js');
const { captureStdout, captureStderr } = require('./helpers/capture.js');

/** 只取信封的退出码（复用生产实现，避免测试自己复述规则）。 */
function exitCodeOf(envelope) {
  return require('../lib/envelope.js').exitCodeFor(envelope);
}

/**
 * 造一个临时项目 + 一份 hierarchy JSON（`sceneTree` 的读回面）。
 * 读回路径给**绝对路径**，与真机 `HierarchyFilePath` 的形态一致（sceneTree 直接读它）。
 */
function sceneReadback(sceneName, nodeCount = 1) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-scenefile-'));
  const abs = path.join(project, '.uloop', 'outputs', 'HierarchyResults', 'h.json');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({
    Hierarchy: [{
      sceneName,
      stats: { rootCount: 1, nodeCount, maxDepth: 0 },
      roots: [{ name: 'Main Camera', isActive: true, components: ['Camera'], children: [] }],
    }],
  }));
  return { project, abs };
}

/** 按调用序回放固定 json 的假 `_call`（第 1 次写、第 2 次读回）；与 test/scene.test.js 同形。 */
function sequenceCall(results, spy = []) {
  let n = 0;
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    const json = results[Math.min(n, results.length - 1)];
    n++;
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

/** 传输层截断（`truncated:true` 时 `json` 必为 null —— lib/uloop.js 的契约）。 */
function truncatedCall(spy = []) {
  return async (tool, args) => {
    spy.push({ tool, args });
    return { code: 0, stdout: '', stderr: '', timedOut: true, drained: false, json: null, truncated: true, tool, args };
  };
}

/** `.cs` 写成功的回包（`scene-save` 的协议）。
 * F3/R361：成功载荷必须带 `mtimeBefore`/`mtimeAfter`（ISO）—— 磁盘硬证据要能经 `--json` 自查。
 */
function savedResult({
  name = 'SampleScene', p = 'Assets/Scenes/SampleScene.scene', count = 1,
  mtimeBefore = '2026-09-19T01:00:00.0000000Z', mtimeAfter = '2026-09-19T01:00:01.0000000Z',
} = {}) {
  return { Success: true, Result: JSON.stringify({ __saved: true, path: p, name, count, mtimeBefore, mtimeAfter }) };
}

/** 写一个「按 argv 里出现的脚本名回不同 json」的假 dispatcher 并运行 fn（CLI 端到端用）。 */
async function withScriptedDispatcher(scriptBody, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-scenefile-disp-'));
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

// ───────────────────────────── scene save（写后读回） ─────────────────────────────

test('sceneSave 写后读回一致 → ok/verified:true，载荷走 scene-save.cs 且读回走 get-hierarchy', async () => {
  const { abs } = sceneReadback('SampleScene');
  const spy = [];
  const call = sequenceCall([
    savedResult(),
    { Success: true, HierarchyFilePath: abs },
  ], spy);
  const e = await sceneSave({ projectPath: 'X', path: 'Assets/Scenes/SampleScene.scene', _call: call });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.strictEqual(e.actual.sceneName, 'SampleScene');
  assert.deepStrictEqual(e.mismatches, []);
  assert.deepStrictEqual(e.intent, { saved: true, sceneName: 'SampleScene' });
  assert.strictEqual(exitCodeOf(e), 0);
  // F1/R359：`successHint` 默认 `[]` —— sceneSave 的成功信封逐字不变
  assert.deepStrictEqual(e.hint, [], 'sceneSave 成功且无分歧时 hint 必须仍为空数组');
  // F3/R361：`.cs` 的磁盘硬证据（mtime before/after，ISO）必须透传到 `actual`
  assert.strictEqual(e.actual.mtimeBefore, '2026-09-19T01:00:00.0000000Z');
  assert.strictEqual(e.actual.mtimeAfter, '2026-09-19T01:00:01.0000000Z');

  assert.strictEqual(spy.length, 2, '一写一读，恰两次调用（多出的调用会复用最后一帧，永不被发现）');
  assert.strictEqual(spy[0].tool, 'execute-dynamic-code');
  assert.ok(spy[0].args[1].endsWith('scene-save.cs'), '写必须走 scene-save.cs');
  // uloop 丢弃 `--parameters` 的 key、按 key 排序位置化成 param0 → 载荷里只能有一个 key `p`
  const params = JSON.parse(spy[0].args[3]);
  assert.deepStrictEqual(Object.keys(params), ['p']);
  assert.deepStrictEqual(JSON.parse(params.p), { path: 'Assets/Scenes/SampleScene.scene' });
  // 读回必须是 get-hierarchy（不是信写脚本的自述）
  assert.strictEqual(spy[1].tool, 'get-hierarchy');
});

test('sceneSave 的 .cs 不带 mtime 证据时，actual 不注入 undefined（与 intent 同形、verified 不受影响）', async () => {
  const { abs } = sceneReadback('SampleScene');
  // 老版本 .cs（或字段缺失/空串）→ mtimeEvidence 必须只透传**非空字符串**
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __saved: true, path: 'Assets/Scenes/SampleScene.scene', name: 'SampleScene', count: 1, mtimeBefore: '', mtimeAfter: null }) },
    { Success: true, HierarchyFilePath: abs },
  ]);
  const e = await sceneSave({ projectPath: 'X', path: 'Assets/Scenes/SampleScene.scene', _call: call });
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(e.actual, { saved: true, sceneName: 'SampleScene' });
  assert.ok(!Object.hasOwn(e.actual, 'mtimeBefore'), '空串/缺失的 mtime 不得透传');
  assert.ok(!Object.hasOwn(e.actual, 'mtimeAfter'));
});

test('sceneSave 不给 --path → 载荷无 path（保存全部打开场景），仍走写后读回', async () => {
  const { abs } = sceneReadback('SampleScene');
  const spy = [];
  const call = sequenceCall([
    savedResult({ count: 1 }),
    { Success: true, HierarchyFilePath: abs },
  ], spy);
  const e = await sceneSave({ projectPath: 'X', _call: call });
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[0].args[3]).p), {});
  assert.strictEqual(e.verified, true);
  assert.strictEqual(exitCodeOf(e), 0);
});

test('sceneSave 读回 sceneName 不一致 → ok 但 verified:false + mismatches + 退出码 1', async () => {
  const { abs } = sceneReadback('OtherScene');
  const call = sequenceCall([
    savedResult(),
    { Success: true, HierarchyFilePath: abs },
  ]);
  const e = await sceneSave({ projectPath: 'X', path: 'Assets/Scenes/SampleScene.scene', _call: call });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'sceneName');
  assert.strictEqual(e.mismatches[0].intent, 'SampleScene');
  assert.strictEqual(e.mismatches[0].actual, 'OtherScene');
  assert.strictEqual(exitCodeOf(e), 1);
});

test('sceneSave 读回失败 → READBACK_FAILED（退出码 1，绝不产 ok）', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-scenefile-miss-'));
  const call = sequenceCall([
    savedResult(),
    { Success: true, HierarchyFilePath: path.join(project, 'missing.json') },
  ]);
  const e = await sceneSave({ projectPath: project, _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeOf(e), 1);
  assert.ok(e.hint.length > 0, '读回失败必须给复核指引');
});

test('sceneSave 的 .cs 返回 NO_SCENE / SAVE_FAILED → 退出码 1（运行时错，不是用法错）', async () => {
  for (const [payload, code] of [
    [{ __error: 'NO_SCENE' }, 'NO_SCENE'],
    [{ __error: 'SAVE_FAILED', detail: 'SaveScene 返回 false' }, 'SAVE_FAILED'],
  ]) {
    const spy = [];
    const call = sequenceCall([{ Success: true, Result: JSON.stringify(payload) }], spy);
    const e = await sceneSave({ projectPath: 'X', _call: call });
    assert.strictEqual(e.ok, false);
    assert.strictEqual(e.code, code);
    assert.strictEqual(exitCodeOf(e), 1);
    assert.strictEqual(spy.length, 1, '写失败时不得读回');
  }
});

// R356/R357（真机实测）：SaveOpenScenes() 返回 true 却不写盘（根因：动态代码不置 isDirty）→
// .cs 改为逐场景 SaveScene + 核对文件 mtime 前进，JS 侧必须原样带上 detail、绝不当成功。
test('sceneSave 的 .cs 回 SAVE_FAILED（保存后文件 mtime 未前进）→ message 带上 detail、退出码 1、不读回', async () => {
  const spy = [];
  // F3/R361：失败 detail 必须带 before → after（否则「没前进」无从诊断）
  const detail = '保存后文件 mtime 未前进（未真正落盘）：Assets/Scenes/SampleScene.scene；mtime '
    + '2026-09-19T01:00:01.0000000Z → 2026-09-19T01:00:01.0000000Z';
  const call = sequenceCall([{ Success: true, Result: JSON.stringify({ __error: 'SAVE_FAILED', detail }) }], spy);
  const e = await sceneSave({ projectPath: 'X', _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'SAVE_FAILED');
  assert.match(e.message, /mtime 未前进/);
  assert.strictEqual(e.actual.detail, detail);
  assert.match(e.message, /2026-09-19T01:00:01\.0000000Z → 2026-09-19T01:00:01\.0000000Z/, '失败 detail 必须带 before → after 两个时间戳');
  assert.strictEqual(exitCodeOf(e), 1);
  assert.strictEqual(spy.length, 1, '写失败时不得读回');
});

test('sceneSave 的写结果不符合协议（缺 __saved / name 为空）→ BAD_SCRIPT_RESULT，不拿 name 去读回', async () => {
  for (const payload of [
    { name: 'SampleScene' },
    { __saved: true, name: '', path: 'Assets/Scenes/SampleScene.scene', count: 1 },
  ]) {
    const spy = [];
    const call = sequenceCall([{ Success: true, Result: JSON.stringify(payload) }], spy);
    const e = await sceneSave({ projectPath: 'X', _call: call });
    assert.strictEqual(e.ok, false);
    assert.strictEqual(e.code, 'BAD_SCRIPT_RESULT');
    assert.strictEqual(exitCodeOf(e), 1);
    assert.strictEqual(spy.length, 1, '协议不符时不得读回（否则会产出无证据的 verified:true）');
  }
});

test('sceneSave 写调用被截断 → ULOOP_TRUNCATED（绝无 ok:true，退出码 1）', async () => {
  const spy = [];
  const e = await sceneSave({ projectPath: 'X', _call: truncatedCall(spy) });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
  assert.strictEqual(e.retryable, true);
  assert.strictEqual(exitCodeOf(e), 1);
  assert.strictEqual(spy.length, 1, '截断后不得继续读回');
});

// R435（项②）：payload 类命令的 .cs 编译错原先只落 message 为空的 ULOOP_ERROR ——
// agent 拿不到 CS 码/行号，只能翻 Editor.log。中央识别后必须给出可读报文。
test('R435：scene save 的 .cs 编译失败 → SCRIPT_COMPILE_ERROR（可读），不是空 message 的 ULOOP_ERROR', async () => {
  const e = await sceneSave({
    projectPath: 'C:/p',
    _call: async () => ({
      code: 0, stdout: '', stderr: '', timedOut: false, drained: false, truncated: false,
      tool: 'execute-dynamic-code',
      args: ['--code-file', 'C:/p/unity-scripts/scene-save.cs', '--parameters', '{}'],
      json: {
        Success: false,
        CompilationErrors: [{ Message: 'CS1002: ; expected', File: 'Assets/PiSceneSave.cs', Line: 7 }],
        ErrorMessage: 'Compilation error occurred',
      },
    }),
  });
  assert.strictEqual(e.code, 'SCRIPT_COMPILE_ERROR');
  assert.match(e.message, /Assets\/PiSceneSave\.cs:7/);
  assert.strictEqual(e.actual.script, 'scene-save.cs');
  assert.ok(e.hint.some((h) => h.includes('scene-save.cs')));
  assert.ok(!e.hint.some((h) => /写入是否生效未知/.test(h)), '编译失败时脚本从未执行，不得追加写入复核 hint');
  assert.strictEqual(exitCodeOf(e), 1);
});

// R435（修复 2）：跳过条件必须绑到**码**而非 `phase` —— `lib/asset.js:343` 早已用
// `phase: 'compile'` 表示「已写入磁盘、但随后 compile 失败/结果未知」。若按 phase 跳过，
// 这些「文件已在盘上」的失败会**静默丢掉**写复核提示（定时炸弹）。
test('R435 修复2：phase=compile 但码不是 SCRIPT_COMPILE_ERROR（已写盘的 asset 语义）→ 仍必须追加写复核 hint', () => {
  const { withWriteRecheckHint } = require('../lib/scene.js');
  const e = withWriteRecheckHint({
    ok: false, verified: false, code: 'ULOOP_TRUNCATED', message: 'x', phase: 'compile', hint: [],
  });
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
  assert.ok(e.hint.some((h) => /写入是否生效未知/.test(h)), 'phase=compile 不能当作「脚本没执行」的唯一判据');
});

// ───────────────────────────── scene open（脏场景守卫 + 写后读回） ─────────────────────────────

test('sceneOpen 写后读回一致（sceneName 由 --path 派生）→ verified:true + 退出码 0', async () => {
  const { abs } = sceneReadback('SampleScene');
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __opened: true, path: 'Assets/Scenes/SampleScene.scene', name: 'SampleScene' }) },
    { Success: true, HierarchyFilePath: abs },
  ], spy);
  const e = await sceneOpen({ projectPath: 'X', path: 'Assets/Scenes/SampleScene.scene', _call: call });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(e.intent, { opened: true, sceneName: 'SampleScene' });
  assert.strictEqual(e.mismatches.length, 0);
  assert.strictEqual(exitCodeOf(e), 0);
  assert.ok(spy[0].args[1].endsWith('scene-open.cs'));
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[0].args[3]).p), { path: 'Assets/Scenes/SampleScene.scene', force: false });
});

// F1/R359：CLI 造的未保存改动**不置 isDirty**（U27）→ 脏场景守卫看不见它们，而它们不在新场景里。
// 这条事实必须出现在**成功信封的 hint** 里：CLI 用户/agent 读的是信封，不是 SKILL/PITFALLS。
// 同时钉死 `readBackAndVerify` 的 `successHint` 默认值 —— sceneSave / nodeCreate 的成功 hint 仍是 []。
test('sceneOpen 成功信封带「CLI 造的未保存改动不置 isDirty」的提示（R359）', async () => {
  const { abs } = sceneReadback('SampleScene');
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __opened: true, path: 'Assets/Scenes/SampleScene.scene', name: 'SampleScene' }) },
    { Success: true, HierarchyFilePath: abs },
  ]);
  const e = await sceneOpen({ projectPath: 'X', path: 'Assets/Scenes/SampleScene.scene', _call: call });
  assert.strictEqual(e.verified, true);
  assert.ok(
    e.hint.some((h) => h.includes('不置 isDirty') && h.includes('unity scene save')),
    `sceneOpen 成功信封必须提示「CLI 造的未保存改动不置 isDirty、切场景前先 scene save」：${JSON.stringify(e.hint)}`,
  );

  // 默认值没变：sceneSave 成功 hint 仍是 []（不传 successHint）
  const { abs: saveAbs } = sceneReadback('SampleScene');
  const saveCall = sequenceCall([savedResult(), { Success: true, HierarchyFilePath: saveAbs }]);
  const saved = await sceneSave({ projectPath: 'X', path: 'Assets/Scenes/SampleScene.scene', _call: saveCall });
  assert.deepStrictEqual(saved.hint, [], 'sceneSave 不传 successHint → 成功 hint 仍为空数组');

  // 默认值没变：nodeCreate 成功 hint 仍是 []（节点写命令一字未动）
  const createCall = sequenceCall([
    { Success: true, Result: JSON.stringify({ name: 'Brick', active: true }) },
    { Success: true, Result: JSON.stringify({ name: 'Brick', active: true }) },
  ]);
  const created = await nodeCreate({ projectPath: 'X', name: 'Brick', _call: createCall });
  assert.strictEqual(created.verified, true);
  assert.deepStrictEqual(created.hint, [], 'nodeCreate 不传 successHint → 成功 hint 仍为空数组');
});

test('sceneOpen 读回不一致时不并入成功提示（successHint 只在成功时生效）', async () => {
  const { abs } = sceneReadback('Untitled');
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __opened: true, path: 'Assets/Scenes/SampleScene.scene', name: 'Untitled' }) },
    { Success: true, HierarchyFilePath: abs },
  ]);
  const e = await sceneOpen({ projectPath: 'X', path: 'Assets/Scenes/SampleScene.scene', _call: call });
  assert.strictEqual(e.verified, false);
  assert.ok(e.hint.some((h) => h.includes('verified:false')), '分歧时应给 mismatchHint');
  assert.ok(!e.hint.some((h) => h.includes('不置 isDirty')), '分歧时不应混入成功提示');
});

test('sceneOpen 读回 sceneName 不一致 → verified:false + mismatches + 退出码 1', async () => {
  const { abs } = sceneReadback('Untitled');
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __opened: true, path: 'Assets/Scenes/SampleScene.scene', name: 'Untitled' }) },
    { Success: true, HierarchyFilePath: abs },
  ]);
  const e = await sceneOpen({ projectPath: 'X', path: 'Assets/Scenes/SampleScene.scene', _call: call });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'sceneName');
  assert.strictEqual(exitCodeOf(e), 1);
});

test('sceneOpen 读回失败 → READBACK_FAILED（退出码 1）', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-scenefile-open-'));
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __opened: true, path: 'Assets/Scenes/SampleScene.scene', name: 'SampleScene' }) },
    { Success: true, HierarchyFilePath: path.join(project, 'missing.json') },
  ]);
  const e = await sceneOpen({ projectPath: project, path: 'Assets/Scenes/SampleScene.scene', _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.strictEqual(exitCodeOf(e), 1);
});

test('sceneOpen 遇脏场景 → DIRTY_SCENE（退出码 1）+ hint 给两条出路（含 --force 会丢失改动）', async () => {
  const spy = [];
  const call = sequenceCall(
    [{ Success: true, Result: JSON.stringify({ __error: 'DIRTY_SCENE', active: 'SampleScene' }) }],
    spy,
  );
  const e = await sceneOpen({ projectPath: 'X', path: 'Assets/Scenes/SampleScene.scene', _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'DIRTY_SCENE');
  assert.strictEqual(e.actual.active, 'SampleScene');
  assert.strictEqual(exitCodeOf(e), 1);
  assert.strictEqual(spy.length, 1, '脏场景守卫失败时不得读回（什么都没打开）');
  const hints = e.hint.join(' ');
  assert.match(hints, /--force/, '必须给出「确实要丢弃改动」的出路');
  assert.match(hints, /scene save/, '必须给出「先保存再打开」的出路');
  assert.match(hints, /丢失|丢弃/, '必须写明 --force 会丢失未保存改动');
});

test('sceneOpen --force → 载荷里 force 为 true（裸 --force 归一成布尔）', async () => {
  const { abs } = sceneReadback('SampleScene');
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __opened: true, path: 'Assets/Scenes/SampleScene.scene', name: 'SampleScene' }) },
    { Success: true, HierarchyFilePath: abs },
  ], spy);
  const e = await sceneOpen({ projectPath: 'X', path: 'Assets/Scenes/SampleScene.scene', force: true, _call: call });
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[0].args[3]).p), { path: 'Assets/Scenes/SampleScene.scene', force: true });
  assert.strictEqual(e.verified, true);
});

// F5②：给 sceneOpen 补上 sceneSave 已有的 truncated 对称覆盖（截断后绝不继续读回）
test('sceneOpen 写调用被截断 → ULOOP_TRUNCATED（绝无 ok:true，退出码 1）', async () => {
  const spy = [];
  const e = await sceneOpen({
    projectPath: 'X', path: 'Assets/Scenes/SampleScene.scene', _call: truncatedCall(spy),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
  assert.strictEqual(e.retryable, true);
  assert.strictEqual(exitCodeOf(e), 1);
  assert.strictEqual(spy.length, 1, '截断后不得继续读回');
});

test('sceneOpen 的 .cs 返回 SCENE_NOT_FOUND / OPEN_FAILED → 退出码 1', async () => {
  for (const [payload, code] of [
    [{ __error: 'SCENE_NOT_FOUND' }, 'SCENE_NOT_FOUND'],
    [{ __error: 'OPEN_FAILED', detail: 'OpenScene 返回无效场景' }, 'OPEN_FAILED'],
  ]) {
    const spy = [];
    const call = sequenceCall([{ Success: true, Result: JSON.stringify(payload) }], spy);
    const e = await sceneOpen({ projectPath: 'X', path: 'Assets/Scenes/Nope.scene', _call: call });
    assert.strictEqual(e.ok, false);
    assert.strictEqual(e.code, code);
    assert.strictEqual(exitCodeOf(e), 1);
    assert.strictEqual(spy.length, 1, '打开失败时不得读回');
  }
});

// ───────────────────────────── 用法错（只由 argv 决定，任何 uloop 调用之前） ─────────────────────────────

test('sceneOpen 缺 --path → MISSING_PATH（退出码 2）且一次 uloop 都不调', async () => {
  const spy = [];
  const e = await sceneOpen({ projectPath: 'X', _call: sequenceCall([], spy) });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'MISSING_PATH');
  assert.strictEqual(exitCodeOf(e), 2);
  assert.strictEqual(spy.length, 0, '用法错必须在任何 uloop 调用之前收敛');
});

test('sceneOpen --path 裸写/空串/非字符串 → BAD_TARGET_PATH（退出码 2）且不调 uloop', async () => {
  for (const bad of [true, '', '   ', 42, {}]) {
    const spy = [];
    const e = await sceneOpen({ projectPath: 'X', path: bad, _call: sequenceCall([], spy) });
    assert.strictEqual(e.ok, false);
    assert.strictEqual(e.code, 'BAD_TARGET_PATH');
    assert.strictEqual(exitCodeOf(e), 2);
    assert.strictEqual(spy.length, 0);
  }
});

test('sceneSave --path 裸写/空串/非字符串 → BAD_TARGET_PATH（退出码 2）且不调 uloop；不给 path 合法', async () => {
  for (const bad of [true, '', '   ', 42]) {
    const spy = [];
    const e = await sceneSave({ projectPath: 'X', path: bad, _call: sequenceCall([], spy) });
    assert.strictEqual(e.code, 'BAD_TARGET_PATH');
    assert.strictEqual(exitCodeOf(e), 2);
    assert.strictEqual(spy.length, 0);
  }
});

// ───────────────────────────── CLI 级（main + 假 dispatcher） ─────────────────────────────

test('CLI scene save --json → 退出码 0 且载荷 verified:true', async () => {
  const { abs } = sceneReadback('SampleScene');
  const body = `
    const a = process.argv.join(' ');
    const out = a.includes('scene-save.cs')
      ? { Success: true, Result: ${JSON.stringify(JSON.stringify({ __saved: true, path: 'Assets/Scenes/SampleScene.scene', name: 'SampleScene', count: 1 }))} }
      : { Success: true, HierarchyFilePath: ${JSON.stringify(abs)} };
    process.stdout.write(JSON.stringify(out) + '\\n');
  `;
  const { result, out } = await withScriptedDispatcher(body, () => captureStdout(
    () => main(['scene', 'save', '--project-path', 'X', '--path', 'Assets/Scenes/SampleScene.scene', '--json']),
  ));
  assert.strictEqual(result, 0);
  const envelope = JSON.parse(out);
  assert.strictEqual(envelope.ok, true);
  assert.strictEqual(envelope.verified, true);
});

test('CLI scene open 缺 --path → 退出码 2（用法错）', async () => {
  const { result, out } = await captureStdout(() => main(['scene', 'open', '--project-path', 'X', '--json']));
  assert.strictEqual(result, 2);
  assert.strictEqual(JSON.parse(out).code, 'MISSING_PATH');
});

test('CLI scene 未知子动作仍走用法错（退出码 2，usage 写 stderr）——tree 分支行为不变', async () => {
  const { result, out } = await captureStderr(() => main(['scene', 'bogus', '--json']));
  assert.strictEqual(result, 2);
  assert.match(out, /usage: unity scene tree/);
});

// ─────────── 跨语言 tripwire（字符串 tripwire，不是行为测试；同 M2 任务 5/10 做法） ───────────
// ⚠️ 它只能证明文件里出现了这些标记，测不出 CS0136（局部变量重名）/ CS8421 这类编译错误，
// 也测不出真机上 SaveScene/SaveOpenScenes 的实际返回 —— 那些只能靠报告里的真机五条判据。
test('跨语言 tripwire：scene-save.cs / scene-open.cs 的载荷槽位、错误码、无 static 局部函数', () => {
  const dir = path.join(__dirname, '..', 'unity-scripts');
  const save = fs.readFileSync(path.join(dir, 'scene-save.cs'), 'utf8');
  const open = fs.readFileSync(path.join(dir, 'scene-open.cs'), 'utf8');
  // R356（真机实测）：`SaveOpenScenes()` 返回 true 却**不写盘** → 不得再用它（去注释后再断言，
  // 因为文件里的注释要引出这个事实）。F2 起 `stripComments` 同时用于「去注释后数次数」。
  // ⚠️ 行尾必须容错：Windows 下 `core.autocrlf=true` 的检出是 **CRLF**，而 JS 正则里 `\r`
  // 也是行终止符、`.` 不匹配它 → 用 `split('\n')` + `/\/\/.*$/` 在 CRLF 上**剥不掉注释**
  // （实测：master 上这条 tripwire 曾因注释里的 `SaveOpenScenes()` 被误命中而变红）。
  const stripComments = (src) => src.split(/\r?\n/).map((l) => l.replace(/\/\/[^\r\n]*/, '')).join('\n');
  for (const src of [save, open]) {
    // 载荷只从恒定槽位 param0 读（不要遍历 parameters：uloop 会把字面量驻留成 __uloop_literal_*）
    assert.match(src, /parameters\["param0"\]/);
    assert.doesNotMatch(src, /foreach\s*\([^)]*parameters/);
    // 局部函数不得加 static（uloop 把字面量提升成外层局部变量 → CS8421）
    assert.doesNotMatch(src, /^\s*static\b/m);
  }
  assert.match(save, /SaveScene\(/);
  assert.doesNotMatch(stripComments(save), /SaveOpenScenes\s*\(/);
  // R356/R357：硬证据是「保存后文件 mtime 前进」，不是 isDirty（动态代码的改动不置 isDirty）
  assert.match(save, /GetLastWriteTimeUtc/);
  // F2/R360：mtime 判据是防假绿的**关键** —— 只断言「字符串存在」太弱（把 `<=` 改成 `<`、
  // 或删掉 `--path` 分支的第二次核对，测试都会全绿）。这里锁**方向**与**次数**（去注释后数）：
  // 方向反了（`<`）→ 第一条命中 0 次；少一处核对 → 第二条命中 1 次。两者都必须变红。
  const saveCode = stripComments(save);
  assert.strictEqual(
    (saveCode.match(/FileWriteStamp\([^)]*\)\s*<=\s*\w+/g) || []).length, 2,
    '两个保存分支各要有一处「mtime 不前进即失败」（FileWriteStamp(...) <= before）的方向性核对',
  );
  assert.strictEqual(
    (saveCode.match(/mtime 未前进/g) || []).length, 2,
    '两个保存分支各要有一处 mtime 未前进的报错',
  );
  // F3/R361：失败 detail 带 before → after；成功载荷带 mtimeBefore/mtimeAfter（ISO）
  assert.match(save, /ToString\("o"/, '时间戳必须以 ISO（"o" 格式）输出');
  assert.match(saveCode, /\["mtimeBefore"\]\s*=/, '成功载荷必须带 mtimeBefore');
  assert.match(saveCode, /\["mtimeAfter"\]\s*=/, '成功载荷必须带 mtimeAfter');
  assert.match(saveCode, /\+ " → " \+/, '失败 detail 必须带 before → after');
  assert.match(save, /"__saved":true|\["__saved"\]\s*=\s*true/);
  assert.match(save, /NO_SCENE/);
  assert.match(save, /SAVE_FAILED/);

  assert.match(open, /isDirty/);
  assert.match(open, /OpenSceneMode\.Single/);
  assert.match(open, /"__opened"\]\s*=\s*true|"__opened":true/);
  for (const code of ['DIRTY_SCENE', 'SCENE_NOT_FOUND', 'OPEN_FAILED']) {
    assert.match(open, new RegExp(`"${code}"`), `scene-open.cs 必须保留 __error 码 ${code}`);
  }
  // 脏场景守卫必须在 OpenScene **之前**（不许先打开再报错）
  assert.ok(open.indexOf('isDirty') < open.indexOf('OpenScene('), 'isDirty 守卫必须在 OpenScene 之前');
});
