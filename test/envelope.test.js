'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ok, fail, fromUloop, emit, RETRYABLE_CODES, envelopeFromCall, scriptCompileFailure, scriptNameFromArgs, scriptPathFromArgs, USAGE_FAILURE_CODES, exitCodeFor, isUsageFailure } = require('../lib/envelope.js');

/** 捕获 emit 写入的假流。 */
function capture() {
  const chunks = [];
  return {
    write(s) {
      chunks.push(s);
    },
    text() {
      return chunks.join('');
    },
  };
}

test('ok 的信封形状固定', () => {
  const e = ok({ name: 'Brick' });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, null); // 未做读回前不得声称已验证
  assert.deepStrictEqual(e.actual, { name: 'Brick' });
  assert.deepStrictEqual(e.hint, []);
});

test('fail 的信封形状固定', () => {
  const e = fail({ code: 'X', message: 'boom', hint: ['try y'] });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.code, 'X');
  assert.deepStrictEqual(e.hint, ['try y']);
});

test('fail 对已知瞬时错误码默认 retryable', () => {
  const e = fail({ code: 'ULOOP_NO_JSON', message: 'x' });
  assert.strictEqual(e.retryable, true);
});

test('fail 的显式 retryable 优先于错误码集合', () => {
  const e = fail({ code: 'ULOOP_NO_JSON', message: 'x', retryable: false });
  assert.strictEqual(e.retryable, false);
});

test('fail 对非瞬时错误码默认不可重试', () => {
  const e = fail({ code: 'SOME_CONTRACT_VIOLATION', message: 'x' });
  assert.strictEqual(e.retryable, false);
});

test('RETRYABLE_CODES 导出瞬时错误码集合', () => {
  assert.ok(RETRYABLE_CODES instanceof Set);
  assert.ok(RETRYABLE_CODES.has('ULOOP_NO_JSON'));
  assert.ok(RETRYABLE_CODES.has('ULOOP_TRUNCATED'));
  assert.ok(RETRYABLE_CODES.has('UNITY_SERVER_BUSY'), 'U49：单飞被拒是瞬时故障，必须可重试');
});

test('fromUloop 把 Success:true 映射为 ok 但 verified 仍为 null', () => {
  const e = fromUloop({ Success: true, Result: 'x' });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, null);
});

test('fromUloop 保留 uloop 的 ErrorCode / NextActions / Retryable', () => {
  const e = fromUloop({
    Success: false,
    Error: { ErrorCode: 'UNITY_NOT_REACHABLE', Phase: 'connection', Message: 'nope',
             Retryable: true, NextActions: ['run uloop launch'] },
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'UNITY_NOT_REACHABLE');
  assert.strictEqual(e.phase, 'connection');
  assert.strictEqual(e.retryable, true);
  assert.deepStrictEqual(e.hint, ['run uloop launch']);
});

// ───────── R108：上游**所有** first-party 工具的失败都是平铺形状 ─────────

/**
 * 实证来源：上游 `uloopmcp` 包内 `Editor/ToolContracts/ScreenshotResponse.cs:35-42`
 * —— 平铺失败 `{Success:false, Message, NextActions}`（无 `Error` 子对象、无 `ErrorCode`，
 * **也没有 `Retryable`**；F5 修正：旧注释错引 `ScreenshotCaptureResults.cs:28-37` 并误列 `Retryable`）。
 * 嵌套 `Error.ErrorCode` 只出现在 dispatcher 层。只认嵌套形状会让平铺失败落成
 * `ULOOP_ERROR: uloop 返回失败但未提供 Message` + `hint:[]` + `retryable:false`
 *（平铺形状没有 `Retryable` → `Boolean(undefined)` 即 false）。
 */
test('fromUloop 认平铺失败形状（顶层 Message/NextActions；显式 Retryable 也保留，R108）', () => {
  const e = fromUloop({
    Success: false,
    Message: "Window 'Scene' not found (MatchMode: exact)",
    NextActions: ['Open the requested Unity window, then retry the screenshot.'],
    Retryable: true,
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_ERROR');
  assert.strictEqual(e.message, "Window 'Scene' not found (MatchMode: exact)", '平铺 Message 不得丢');
  assert.deepStrictEqual(e.hint, ['Open the requested Unity window, then retry the screenshot.']);
  assert.strictEqual(e.retryable, true, '显式 Retryable:true 不得被压成 false（本用例载荷显式带了它）');
});

test('fromUloop 平铺形状的顶层 ErrorCode 也认（若有）', () => {
  const e = fromUloop({ Success: false, ErrorCode: 'SCREENSHOT_FAILED', Message: 'x', Retryable: false });
  assert.strictEqual(e.code, 'SCREENSHOT_FAILED');
  assert.strictEqual(e.message, 'x');
  assert.strictEqual(e.retryable, false);
});

test('fromUloop NextActions 非数组 → hint 为 []（平铺/嵌套口径一致）', () => {
  for (const json of [
    { Success: false, Message: 'x', NextActions: 'oops' },
    { Success: false, Message: 'x', NextActions: null },
    { Success: false, Error: { Message: 'x', NextActions: {} } },
  ]) {
    const e = fromUloop(json);
    assert.strictEqual(e.message, 'x', JSON.stringify(json));
    assert.deepStrictEqual(e.hint, []);
  }
});

test('fromUloop 平铺形状缺 Message → 仍给兜底文案 + 保留 NextActions', () => {
  const e = fromUloop({ Success: false, NextActions: ['a'] });
  assert.strictEqual(e.code, 'ULOOP_ERROR');
  assert.match(e.message, /未提供 Message/);
  assert.deepStrictEqual(e.hint, ['a']);
  assert.strictEqual(e.retryable, false);
});

test('fromUloop 平铺 Message 非字符串/空串 → 回退兜底文案，怪载荷留在 actual（R111④）', () => {
  // 旧实现 `e.Message || '…未提供 Message'` 对**真值**的非字符串（`{}` / `123` / `[]`）
  // 会原样透传 → emit 的人类可读输出打成 `[object Object]`。契约：Message 必须是字符串。
  for (const bad of [{}, { code: 42 }, 123, [], true]) {
    const e = fromUloop({ Success: false, Message: bad });
    assert.strictEqual(e.message, 'uloop 返回失败但未提供 Message', JSON.stringify(bad));
    assert.ok(!String(e.message).includes('[object'), '人读不得打成 [object Object]');
  }
  // 空串同样回退（旧实现里 `'' || 兜底` 恰好也对，但断言把契约钉住）
  assert.strictEqual(fromUloop({ Success: false, Message: '' }).message, 'uloop 返回失败但未提供 Message');
  // 怪载荷不得被吞掉：原 Message 进 actual 供排障
  assert.deepStrictEqual(fromUloop({ Success: false, Message: { code: 42 } }).actual, { code: 42 });
  // 字符串 Message 行为不变
  assert.strictEqual(fromUloop({ Success: false, Message: 'boom' }).message, 'boom');
});

test('fromUloop Error 子对象为空时回退到顶层 Message（混合形状）', () => {
  const e = fromUloop({ Success: false, Error: {}, Message: 'top-level', NextActions: ['n'] });
  assert.strictEqual(e.message, 'top-level');
  assert.deepStrictEqual(e.hint, ['n']);
});

test('fromUloop 嵌套形状仍优先于顶层（dispatcher 级错误不得被外层字段盖掉）', () => {
  const e = fromUloop({
    Success: false, Message: 'tool-level',
    Error: { ErrorCode: 'UNITY_NOT_REACHABLE', Message: 'dispatcher-level', Phase: 'connection' },
  });
  assert.strictEqual(e.code, 'UNITY_NOT_REACHABLE');
  assert.strictEqual(e.message, 'dispatcher-level');
  assert.strictEqual(e.phase, 'connection');
});

test('fromUloop 对 null 给出可诊断的错误', () => {
  const e = fromUloop(null);
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_NO_JSON');
  assert.ok(e.hint.length > 0);
  assert.strictEqual(e.retryable, true);
});

test('ok 的第二参不得篡改 ok / actual 等核心字段', () => {
  const e = ok({ a: 1 }, { ok: false, verified: true, actual: { b: 2 }, message: 'x' });
  assert.strictEqual(e.ok, true);
  assert.deepStrictEqual(e.actual, { a: 1 });
  assert.strictEqual(e.message, undefined);
  assert.strictEqual(e.verified, true); // verified 属白名单，显式传入生效
});

test('ok 的第二参只认白名单键（其余静默忽略）', () => {
  const e = ok({ a: 1 }, { code: 'SCENE_TREE', frobnicate: 1, message: 'x' });
  assert.strictEqual(e.code, 'SCENE_TREE');
  assert.strictEqual(e.frobnicate, undefined);
  assert.strictEqual(e.message, undefined);
});

test('fromUloop 不把字符串 Success:"false" 判成功', () => {
  const e = fromUloop({ Success: 'false' });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.code, 'ULOOP_BAD_PAYLOAD');
});

test('fromUloop 不把数字 Success:1 判成功', () => {
  const e = fromUloop({ Success: 1 });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.code, 'ULOOP_BAD_PAYLOAD');
});

test('fromUloop 对缺 Success 字段的载荷给 ULOOP_BAD_PAYLOAD 而非 ULOOP_ERROR', () => {
  for (const bad of [{}, [], { Version: '3.4.0', Tools: [] }]) {
    const e = fromUloop(bad);
    assert.strictEqual(e.ok, false);
    assert.strictEqual(e.code, 'ULOOP_BAD_PAYLOAD');
    assert.notStrictEqual(e.code, 'ULOOP_ERROR');
    assert.strictEqual(e.retryable, false); // 载荷形态错误是终态，重试不会变好
  }
});

test('emit --json 输出完整信封 JSON 且以换行结尾', () => {
  const s = capture();
  emit(ok({ name: 'Brick' }), { json: true, stream: s });
  assert.deepStrictEqual(JSON.parse(s.text()), {
    ok: true, verified: null, intent: null, actual: { name: 'Brick' }, hint: [],
  });
  assert.ok(s.text().endsWith('\n'));
});

test('emit 人类可读输出标注验证状态并列出 hint', () => {
  const unverified = capture();
  emit(ok({ name: 'Brick' }), { stream: unverified });
  assert.match(unverified.text(), /\[OK\]/);

  const verified = capture();
  emit(ok({ name: 'Brick' }, { verified: true }), { stream: verified });
  assert.match(verified.text(), /\[VERIFIED\]/);

  const failed = capture();
  emit(fail({ code: 'X', message: 'boom', hint: ['try y'] }), { stream: failed });
  assert.match(failed.text(), /\[FAIL\] X: boom/);
  assert.match(failed.text(), /hint: try y/);
});

// ─────────────────── M2 任务 1：envelopeFromCall（截断感知的唯一入口）───────────────────

test('envelopeFromCall：truncated 产出 ULOOP_TRUNCATED（可重试 + 带诊断 actual）', () => {
  const e = envelopeFromCall({
    code: 0,
    stdout: '{"Success":true}',
    stderr: '',
    timedOut: false,
    drained: true,
    json: null,
    truncated: true,
    tool: 'compile',
    args: ['compile'],
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
  assert.strictEqual(e.retryable, true, '截断是瞬时故障，retryable 必须为 true');
  assert.strictEqual(e.phase, 'transport');
  assert.strictEqual(e.actual.tool, 'compile');
  assert.strictEqual(e.actual.drained, true);
  assert.strictEqual(e.actual.timedOut, false);
  assert.ok(e.hint.length > 0);
});

test('envelopeFromCall：truncated 为 true 时即使 json 非空也不采信（call 契约的兜底）', () => {
  const e = envelopeFromCall({
    code: 0, json: { Success: true }, truncated: true, timedOut: false, drained: true,
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
});

test('envelopeFromCall：未截断时逐字等价于 fromUloop', () => {
  const json = { Success: true, Result: 'x' };
  const e = envelopeFromCall({
    code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false,
    tool: 't', args: [],
  });
  assert.deepStrictEqual(e, fromUloop(json));
});

test('envelopeFromCall：truncated 为 false 但 json 为 null → ULOOP_NO_JSON（与截断区分开）', () => {
  const e = envelopeFromCall({ code: 0, json: null, truncated: false, timedOut: false, drained: false });
  assert.strictEqual(e.code, 'ULOOP_NO_JSON');
});

// ─────────────────── M2 任务 2：退出码单点判定 ───────────────────

test('exitCodeFor：成功且未写后读回 → 0；写后 verified:true → 0', () => {
  assert.strictEqual(exitCodeFor(ok({ a: 1 })), 0);
  assert.strictEqual(exitCodeFor(ok({ a: 1 }, { verified: true })), 0);
});

test('exitCodeFor：写后 verified:false → 1（铁律：意图未达成就是失败）', () => {
  const e = { ...ok({ a: 1 }), verified: false };
  assert.strictEqual(exitCodeFor(e), 1);
});

test('exitCodeFor：用法错 → 2；运行时错 → 1', () => {
  assert.strictEqual(exitCodeFor(fail({ code: 'MISSING_PATCH', message: 'x' })), 2);
  assert.strictEqual(exitCodeFor(fail({ code: 'BAD_OUT_DIR', message: 'x' })), 2);
  assert.strictEqual(exitCodeFor(fail({ code: 'EMPTY_PATCH', message: 'x' })), 2);
  assert.strictEqual(exitCodeFor(fail({ code: 'UNKNOWN_PATCH_KEY', message: 'x' })), 2);
  // 运行时错一律 1：它们不是「用法」问题
  for (const code of ['ULOOP_NO_JSON', 'ULOOP_TRUNCATED', 'READBACK_FAILED', 'WRITE_CALL_FAILED',
    'BAD_SCRIPT_RESULT', 'BAD_HIERARCHY', 'NOT_FOUND', 'ULOOP_BAD_PAYLOAD', 'COMPILE_FAILED']) {
    assert.strictEqual(exitCodeFor(fail({ code, message: 'x' })), 1, `${code} 应为 1`);
  }
});

test('exitCodeFor：读命令的 actual.match === false → 1（`pixels --expect` 的判定字段）', () => {
  assert.strictEqual(exitCodeFor(ok({ match: false })), 1);
  assert.strictEqual(exitCodeFor(ok({ match: true })), 0);
  assert.strictEqual(exitCodeFor(ok({ match: null })), 0);
  assert.strictEqual(exitCodeFor(ok({})), 0, '没有 match 字段的读命令不受影响');
});

test('exitCodeFor：未知错误码保守判 1（新码不会静默变成用法错）', () => {
  assert.strictEqual(exitCodeFor(fail({ code: 'TOTALLY_NEW_CODE', message: 'x' })), 1);
  assert.strictEqual(exitCodeFor(fail({ message: 'x' })), 1);
  assert.strictEqual(exitCodeFor(undefined), 1);
});

test('USAGE_FAILURE_CODES 成员恰好是这批（新增/删除用法错码必须同时改这里），且真的冻结', () => {
  // R221：旧标题说「冻结集合」但断言并不验证冻结 —— `Object.freeze(new Set())` 拦不住
  // `.add()`，任何消费者都能把退出码从 1 静默改成 2。导出改为冻结**数组**。
  assert.strictEqual(Array.isArray(USAGE_FAILURE_CODES), true, '导出的必须是数组（冻结的 Set 仍可 add）');
  assert.strictEqual(Object.isFrozen(USAGE_FAILURE_CODES), true, '必须真的冻结');
  assert.throws(() => USAGE_FAILURE_CODES.push('X'), TypeError);
  assert.deepStrictEqual([...USAGE_FAILURE_CODES].sort(), [
    'BAD_ACTION', 'BAD_ASSET_PATH', 'BAD_AT', 'BAD_CAPTURE_MODE', 'BAD_COLOR', 'BAD_COMPONENTS', 'BAD_COMPRESSION', 'BAD_COORD',
    'BAD_EXPECT', 'BAD_FILTER', 'BAD_FIT', 'BAD_FLAG_VALUE', 'BAD_MATCH_MODE', 'BAD_MAX_SIZE', 'BAD_OUT_DIR', 'BAD_PARENT',
    'BAD_PATCH', 'BAD_PIVOT', 'BAD_PPU', 'BAD_REGION', 'BAD_REMOVE_BG',
    'BAD_SIBLING_INDEX',
    'BAD_SIZE', 'BAD_SORTING_ORDER', 'BAD_SOURCE', 'BAD_TARGET_PATH', 'BAD_TIMEOUT', 'BAD_TOLERANCE',
    'BAD_WINDOW_NAME', 'BAD_WORLD_SIZE', 'DIFF_SIZE_MISMATCH', 'EMPTY_PATCH', 'MISSING_ASSET', 'MISSING_FILE', 'MISSING_KEY', 'MISSING_NAME',
    'MISSING_PATCH', 'MISSING_PATH', 'MISSING_PROJECT_PATH', 'MISSING_SOURCE', 'MISSING_TO', 'UNKNOWN_PATCH_KEY',
  ]);
});

test('R477：MISSING_PROJECT_PATH 是「缺参数」→ 用法错 2 档（不再是 1）', () => {
  assert.strictEqual(isUsageFailure('MISSING_PROJECT_PATH'), true);
  assert.strictEqual(exitCodeFor(fail({ code: 'MISSING_PROJECT_PATH', message: 'x' })), 2);
});

test('R475：并发被拒（空 CompilationErrors + ErrorMessage 哨兵）→ ULOOP_ERROR + 串行重试 hint + retryable', () => {
  // 载荷逐字对齐真机：**没有** Message、**没有** ErrorCode（见 docs/m5-probes-raw/p4-1.json）
  const e = fromUloop({ Success: false, CompilationErrors: [], ErrorMessage: 'Another execution is already in progress' });
  assert.strictEqual(e.code, 'ULOOP_ERROR', '上游没给 ErrorCode → 落 ULOOP_ERROR');
  assert.strictEqual(e.message, 'Another execution is already in progress', 'message 兜底必须读 ErrorMessage（上游没有 Message 字段）');
  assert.strictEqual(e.retryable, true, '并发被拒是瞬时的，必须可重试');
  assert.ok(e.hint.some((h) => h.includes('单飞')), '必须给出中文串行重试 hint');
  assert.ok(!e.hint.some((h) => /写入|未生效|已经生效/.test(h)), '不写场景的命令不得套用写入类 hint');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('U49：UNITY_SERVER_BUSY 即使上游不给 Retryable 也可重试，且带串行重试 hint', () => {
  const e = fromUloop({ Success: false, Error: { ErrorCode: 'UNITY_SERVER_BUSY', Message: "Unity is busy running 'compile'." } });
  assert.strictEqual(e.code, 'UNITY_SERVER_BUSY');
  assert.strictEqual(e.retryable, true, '单飞被拒是瞬时的，必须可重试');
  assert.ok(e.hint.some((h) => h.includes('单飞')));
  assert.strictEqual(exitCodeFor(e), 1);
});

test('R111④ 回归：message 兜底扩到 ErrorMessage 后，缺 Message 且缺 ErrorMessage 仍给兜底文案', () => {
  assert.match(fromUloop({ Success: false, NextActions: ['a'] }).message, /未提供 Message/);
  assert.strictEqual(fromUloop({ Success: false, Message: '' }).message, 'uloop 返回失败但未提供 Message');
  assert.deepStrictEqual(fromUloop({ Success: false, Message: { code: 42 } }).actual, { code: 42 });
});

test('U49 附带：RETRYABLE_CODES 扩大后，脚本 __error 与瞬时码撞名仍加 SCRIPT_ 前缀', () => {
  const { scriptErrorCode } = require('../lib/scene.js');
  assert.strictEqual(scriptErrorCode('UNITY_SERVER_BUSY'), 'SCRIPT_UNITY_SERVER_BUSY');
  assert.strictEqual(scriptErrorCode('MY_BUSINESS_ERROR'), 'MY_BUSINESS_ERROR');
});

// ─────────────────── 任务 3：payload 类命令的 .cs 编译错报文可读（R435）───────────────────

test('R435：scriptCompileFailure 形状（message 带 文件:行 与首条；hint 带首条与脚本名；actual 带 errors/script；phase=compile）', () => {
  const e = scriptCompileFailure({
    Success: false,
    CompilationErrors: [{ Message: 'CS1061: does not contain a definition', File: 'Assets/PiPrefab.cs', Line: 12 }],
    ErrorMessage: 'Compilation error occurred',
  }, 'prefab-create.cs');
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'SCRIPT_COMPILE_ERROR');
  assert.strictEqual(e.phase, 'compile');
  assert.strictEqual(e.actual.errors[0].line, 12);
  assert.strictEqual(e.actual.errors[0].file, 'Assets/PiPrefab.cs');
  assert.strictEqual(e.actual.script, 'prefab-create.cs');
  assert.match(e.message, /Assets\/PiPrefab\.cs:12/);
  assert.ok(e.hint.some((h) => h.includes('CS1061')));
  assert.ok(e.hint.some((h) => h.includes('prefab-create.cs')), 'hint 必须点名是哪个 .cs 脚本');
  assert.strictEqual(exitCodeFor(e), 1, '编译错是运行时错（不在冻结用法表内）');
});

test('R435：没有可读条目时回落到 ErrorMessage', () => {
  const e = scriptCompileFailure({ Success: false, CompilationErrors: [{}], ErrorMessage: 'Compilation error occurred' }, null);
  assert.strictEqual(e.code, 'SCRIPT_COMPILE_ERROR');
  assert.match(e.message, /Compilation error occurred/);
});

test('R435 修复1：无 ErrorMessage、json.Error 是**对象**时兜底不得打成 [object Object]', () => {
  // 旧实现 `json.ErrorMessage || json.Error || '见 actual.errors'` 直接透传对象 →
  // `C# 脚本编译失败：[object Object]`（json 是**未合并**原始载荷，fromUloop 才做合并）
  const e = scriptCompileFailure({ Success: false, CompilationErrors: [{}], Error: { ErrorCode: 'X' } }, null);
  assert.strictEqual(e.code, 'SCRIPT_COMPILE_ERROR');
  assert.ok(!String(e.message).includes('[object'), '对象形态不得被打成 [object Object]');
  assert.match(e.message, /见 actual\.errors/);
  // 字符串 Error 仍可作第三级兜底
  const s = scriptCompileFailure({ Success: false, CompilationErrors: [{}], Error: 'Compilation error occurred' }, null);
  assert.match(s.message, /Compilation error occurred/);
});

test('R435：scriptNameFromArgs 从 --code-file 取脚本名（Windows 反斜杠也要认）', () => {
  assert.strictEqual(scriptNameFromArgs({ args: ['--code-file', 'C:/a/b/unity-scripts/scene-save.cs', '--parameters', '{}'] }), 'scene-save.cs');
  assert.strictEqual(scriptNameFromArgs({ args: ['--code-file', 'C:\\a\\b\\node-inspect.cs'] }), 'node-inspect.cs');
  assert.strictEqual(scriptNameFromArgs({ args: ['--code', 'return 1;'] }), null);
  assert.strictEqual(scriptNameFromArgs({ args: ['--code-file'] }), null);
  assert.strictEqual(scriptNameFromArgs(null), null);
});

test('R435 修复3：scriptPathFromArgs 返回 --code-file 原值（完整路径）；缺失/非数组/非字符串/空串 → null', () => {
  assert.strictEqual(scriptPathFromArgs({ args: ['--code-file', 'C:/x/y/unity-scripts/prefab-create.cs', '--parameters', '{}'] }), 'C:/x/y/unity-scripts/prefab-create.cs');
  assert.strictEqual(scriptPathFromArgs({ args: ['--code-file', 'C:\\x\\y\\probe-r427.cs'] }), 'C:\\x\\y\\probe-r427.cs');
  assert.strictEqual(scriptPathFromArgs({ args: ['--code', 'return 1;'] }), null);
  assert.strictEqual(scriptPathFromArgs({ args: ['--code-file'] }), null);
  assert.strictEqual(scriptPathFromArgs({ args: ['--code-file', ''] }), null);
  assert.strictEqual(scriptPathFromArgs({ args: ['--code-file', 42] }), null);
  assert.strictEqual(scriptPathFromArgs({ args: 'not-an-array' }), null);
  assert.strictEqual(scriptPathFromArgs({}), null);
  assert.strictEqual(scriptPathFromArgs(null), null);
});

test('R435 修复3：scriptCompileFailure 第二参是完整路径 —— actual.script 取 basename，hint 用完整路径', () => {
  const e = scriptCompileFailure({ Success: false, CompilationErrors: [{ Message: 'CS1002: ; expected' }] }, 'C:/x/y/unity-scripts/prefab-create.cs');
  assert.strictEqual(e.actual.script, 'prefab-create.cs');
  assert.ok(e.hint.some((h) => h.includes('C:/x/y/unity-scripts/prefab-create.cs')), 'hint 必须用完整路径（任意路径的 exec --code-file 也指得对）');
});

test('R435 截断 tripwire 回归：truncated:true 且 json 是编译错形状 → 仍落 ULOOP_TRUNCATED', () => {
  const e = envelopeFromCall({
    truncated: true, tool: 'execute-dynamic-code', args: [], code: 0, timedOut: false, drained: true,
    json: { Success: false, CompilationErrors: [{ Message: 'CS1002' }] },
  });
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED', '识别必须排在截断判定之后');
});

test('R435 附带：ErrorMessage 为空串时 message 兜底再读**字符串** Error（对象形态不得被打成字符串）', () => {
  const e = fromUloop({ Success: false, CompilationErrors: [], ErrorMessage: '', Error: 'Compilation error occurred' });
  assert.match(e.message, /Compilation error occurred/);
  // `json.Error` 是对象时会被合并进 e —— 必须靠 `typeof === 'string'` 守卫，不得读成 `[object Object]`
  const nested = fromUloop({ Success: false, Error: { ErrorCode: 'X' } });
  assert.ok(!String(nested.message).includes('[object'), '对象形态不得被打成 [object Object]');
  assert.strictEqual(nested.message, 'uloop 返回失败但未提供 Message');
});
