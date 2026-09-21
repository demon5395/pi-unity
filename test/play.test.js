'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { playMode, playClick, playMouse, playKey, playLogs, playView, isInputSystemMissing } = require('../lib/play.js');
const { exitCodeFor } = require('../lib/envelope.js');

function fakeCall(json, spy = []) {
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

const INPUT_SYSTEM_MSG = "simulate-keyboard requires the Input System package (com.unity.inputsystem). "
  + "Install it via Package Manager and set Active Input Handling to 'Input System Package (New)' or 'Both' in Player Settings.";

test('isInputSystemMissing 认出上游逐字报文（含大小写/前后缀干扰）', () => {
  assert.strictEqual(isInputSystemMissing(INPUT_SYSTEM_MSG), true);
  assert.strictEqual(isInputSystemMissing('simulate-mouse-input requires the Input System package (com.unity.inputsystem). x'), true);
  assert.strictEqual(isInputSystemMissing('requires the input system package'), true, '大小写不敏感');
  assert.strictEqual(isInputSystemMissing('No EventSystem found in the scene.'), false);
  assert.strictEqual(isInputSystemMissing(undefined), false);
});

test('playMode start 成功：intent {isPlaying:true} → verified:true，argv 用 --action Play', async () => {
  const spy = [];
  const e = await playMode({
    projectPath: 'P', action: 'Play',
    _call: fakeCall({ Success: true, IsPlaying: true, IsPaused: false, Changed: true, Message: 'Play mode started', Warning: 'fresh Play start from Edit-time scene state' }, spy),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(spy[0].args, ['--action', 'Play']);
  assert.strictEqual(e.actual.isPlaying, true);
  assert.strictEqual(e.actual.changed, true);
  assert.ok(e.hint.some((h) => /Edit-time|场景/.test(h)), '上游 Warning 必须进 hint');
});

test('playMode start 没能进入 PlayMode → verified:false（绝不假绿）', async () => {
  const e = await playMode({
    projectPath: 'P', action: 'Play',
    _call: fakeCall({ Success: true, IsPlaying: false, IsPaused: false, Changed: false, BlockedByUnsavedChanges: true, Message: 'blocked' }),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'isPlaying');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.hint.some((h) => /未保存|Untitled|保存/.test(h)), 'BlockedByUnsavedChanges 必须给可操作的 hint');
});

test('playMode stop 成功：intent {isPlaying:false}；status 不设 intent（verified:null）', async () => {
  const stop = await playMode({ projectPath: 'P', action: 'Stop', _call: fakeCall({ Success: true, IsPlaying: false, WasAlreadyStopped: false }) });
  assert.strictEqual(stop.verified, true);
  const status = await playMode({ projectPath: 'P', action: 'Status', _call: fakeCall({ Success: true, IsPlaying: true, IsPaused: false }) });
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.verified, null, 'Status 没有 intent，不许声称 verified');
  assert.strictEqual(status.actual.isPlaying, true);
});

// R263：`control-play-mode` 在**触发 domain reload 的 Play/Stop 调用**上不回 `Success`，
// 但其余字段完整合法（真机实证，见 docs/PITFALLS.md）。收口只在 lib/play.js 的 playMode 里，
// **不许**动 lib/envelope.js 的 fromUloop 全局判据。
test('playMode 缺 Success + 布尔 IsPlaying（真机 Play/Stop 形状）→ 按 intent 比对，verified 是真值', async () => {
  const start = await playMode({
    projectPath: 'P', action: 'Play',
    _call: fakeCall({ IsPlaying: true, IsPaused: false, Changed: true, Message: 'Play mode started', Warning: '' }),
  });
  assert.strictEqual(start.ok, true, '这是上游的合法形状，不许落 ULOOP_BAD_PAYLOAD');
  assert.strictEqual(start.verified, true);
  assert.strictEqual(start.actual.isPlaying, true);
  assert.strictEqual(exitCodeFor(start), 0);

  const stop = await playMode({
    projectPath: 'P', action: 'Stop',
    _call: fakeCall({ IsPlaying: false, IsPaused: false, Changed: true, Message: 'Play mode stopped', Warning: '' }),
  });
  assert.strictEqual(stop.ok, true);
  assert.strictEqual(stop.verified, true);
  assert.strictEqual(exitCodeFor(stop), 0);
});

test('playMode 缺 Success 且状态不符意图 → verified:false、退出码 1（绝不假绿）', async () => {
  const e = await playMode({
    projectPath: 'P', action: 'Play',
    _call: fakeCall({ IsPlaying: false, IsPaused: false, Changed: false, Message: 'blocked' }),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'isPlaying');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('playMode 缺 Success 且缺布尔 IsPlaying（{} 等怪载荷）→ 安全网仍有牙：ULOOP_BAD_PAYLOAD', async () => {
  for (const payload of [{}, { Success: 'true', IsPlaying: 'true' }, { Message: 'x' }]) {
    const e = await playMode({ projectPath: 'P', action: 'Play', _call: fakeCall(payload) });
    assert.strictEqual(e.ok, false, `${JSON.stringify(payload)} 不该被当成合法载荷`);
    assert.strictEqual(e.code, 'ULOOP_BAD_PAYLOAD');
    assert.strictEqual(exitCodeFor(e), 1);
  }
});

test('playMode Success:false 仍走既有错误映射（例外不吃掉上游真失败，行为不变）', async () => {
  const e = await playMode({
    projectPath: 'P', action: 'Play',
    _call: fakeCall({ Success: false, Message: 'Play Mode is blocked by compile errors', ErrorCode: 'ULOOP_ERROR', NextActions: ['fix compile'] }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_ERROR');
  assert.strictEqual(e.message, 'Play Mode is blocked by compile errors');
  assert.deepStrictEqual(e.hint, ['fix compile']);
  assert.strictEqual(exitCodeFor(e), 1);
});

// R268①：截断优先于形状判定 —— 残缺 JSON 里恰好有布尔 IsPlaying 也不能被当成合法载荷。
test('playMode truncated 优先于形状判定 → ULOOP_TRUNCATED（残缺 JSON 不当合法载荷）', async () => {
  const e = await playMode({
    projectPath: 'P', action: 'Play',
    _call: async (tool, args) => ({
      code: 0, stdout: '', stderr: '', timedOut: true, drained: false,
      json: { IsPlaying: true, Changed: true, Message: 'Play mode started' }, truncated: true, tool, args,
    }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
  assert.strictEqual(exitCodeFor(e), 1);
});

// R268②：①（Success:false → 上游错误码）优先于 ③（缺 Success 的 Play/Stop 形状）。
test('playMode Success:false 且带嵌套 Error → 走上游错误码（① 优先于 ③），退出码 1', async () => {
  const e = await playMode({
    projectPath: 'P', action: 'Play',
    _call: fakeCall({ Success: false, IsPlaying: true, Error: { ErrorCode: 'X', Message: 'boom' } }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'X');
  assert.strictEqual(e.message, 'boom');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('playMode 非法 action / 非法 timeout → BAD_ACTION / BAD_TIMEOUT（用法错 2），不调 uloop', async () => {
  for (const [opts, code] of [
    [{ action: 'Nope' }, 'BAD_ACTION'],
    [{ action: 'Play', timeoutSeconds: '0' }, 'BAD_TIMEOUT'],
    [{ action: 'Play', timeoutSeconds: 'x' }, 'BAD_TIMEOUT'],
    [{ action: 'Play', timeoutSeconds: '1.5' }, 'BAD_TIMEOUT'],
  ]) {
    const spy = [];
    const e = await playMode({ projectPath: 'P', _call: fakeCall({ Success: true }, spy), ...opts });
    assert.strictEqual(e.code, code, `${JSON.stringify(opts)} 应落 ${code}`);
    assert.strictEqual(spy.length, 0);
    assert.strictEqual(exitCodeFor(e), 2);
  }
  // 合法的 timeout 透传
  const spy = [];
  await playMode({ projectPath: 'P', action: 'Play', timeoutSeconds: '30', _call: fakeCall({ Success: true, IsPlaying: true }, spy) });
  assert.deepStrictEqual(spy[0].args, ['--action', 'Play', '--timeout-seconds', '30']);
});

test('playKey 命中 Input System 缺失 → INPUT_SYSTEM_UNAVAILABLE + 两条出路 hint（绝不假装可用）', async () => {
  const e = await playKey({
    projectPath: 'P', action: 'Press', key: 'Space',
    _call: fakeCall({ Success: false, Message: INPUT_SYSTEM_MSG, Action: 'Press' }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'INPUT_SYSTEM_UNAVAILABLE');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.hint.some((h) => /com\.unity\.inputsystem/.test(h)));
  // F5/R348 的 M3 收口（R349）：旧文案指向裸 uloop 的 `execute-dynamic-code`（E2E B1「报错误导」）——
  // 命令面现有 `unity exec`，出路必须落在命令面内。
  assert.ok(e.hint.some((h) => /unity play logs/.test(h)), '第二条出路：用 `unity play logs` 读运行期状态');
  assert.ok(e.hint.some((h) => /unity exec/.test(h) && /actual\.result/.test(h)), '第二条出路：用 `unity exec` 读运行期脚本字段（取 actual.result）');
  assert.ok(!e.hint.some((h) => /execute-dynamic-code/.test(h)), '不得再指向裸 uloop 的 execute-dynamic-code（B1 报错误导）');
  assert.strictEqual(e.actual.upstreamMessage, INPUT_SYSTEM_MSG, '上游原文不得丢');
});

test('playKey ReleaseAll 不需要 --key；Press 缺 --key → MISSING_KEY（用法错 2）', async () => {
  const spy = [];
  const okRelease = await playKey({ projectPath: 'P', action: 'ReleaseAll', _call: fakeCall({ Success: true, Message: 'released', ReleasedKeys: ['W'] }, spy) });
  assert.strictEqual(okRelease.ok, true);
  assert.deepStrictEqual(spy[0].args, ['--action', 'ReleaseAll']);

  const badSpy = [];
  const bad = await playKey({ projectPath: 'P', action: 'Press', _call: fakeCall({ Success: true }, badSpy) });
  assert.strictEqual(bad.code, 'MISSING_KEY');
  assert.strictEqual(exitCodeFor(bad), 2);
  assert.strictEqual(badSpy.length, 0, '用法错必须在调 uloop 之前收敛');
});

test('playKey Press 成功：--key/--duration 透传 + 诊断字段进 actual', async () => {
  const spy = [];
  const e = await playKey({
    projectPath: 'P', action: 'Press', key: 'Space', duration: '0.2',
    _call: fakeCall({ Success: true, Action: 'Press', KeyName: 'Space', PressDeliveredToGame: true, PressEdgeObserved: false, Message: 'pressed' }, spy),
  });
  assert.deepStrictEqual(spy[0].args, ['--action', 'Press', '--key', 'Space', '--duration', '0.2']);
  assert.strictEqual(e.verified, null, '动作型命令没有可比对的 intent');
  assert.strictEqual(e.actual.pressEdgeObserved, false);
  assert.ok(e.hint.some((h) => /PressEdgeObserved/.test(h)), 'PressEdgeObserved=false 必须提示「游戏循环可能没看到这次按键」');
});

test('playClick：--x/--y 必填（缺 → BAD_COORD 2）；Drag 需要 --from-x/--from-y', async () => {
  const missingSpy = [];
  const missing = await playClick({ projectPath: 'P', action: 'Click', _call: fakeCall({ Success: true }, missingSpy) });
  assert.strictEqual(missing.code, 'BAD_COORD');
  assert.strictEqual(exitCodeFor(missing), 2);
  assert.strictEqual(missingSpy.length, 0, '用法错必须在调 uloop 之前收敛');

  const dragSpy = [];
  const drag = await playClick({ projectPath: 'P', action: 'Drag', x: '10', y: '20', _call: fakeCall({ Success: true }, dragSpy) });
  assert.strictEqual(drag.code, 'BAD_COORD');
  assert.match(drag.message, /from-x/);
  assert.strictEqual(dragSpy.length, 0, '用法错必须在调 uloop 之前收敛');

  const spy = [];
  const ok = await playClick({
    projectPath: 'P', action: 'Click', x: '267', y: '167', targetPath: 'Canvas/Btn',
    _call: fakeCall({ Success: true, Action: 'Click', HitGameObjectName: 'Btn', PositionX: 267, PositionY: 167, Message: 'Clicked' }, spy),
  });
  assert.deepStrictEqual(spy[0].args, ['--action', 'Click', '--x', '267', '--y', '167', '--target-path', 'Canvas/Btn']);
  assert.strictEqual(ok.actual.hitGameObjectName, 'Btn');
  assert.strictEqual(ok.verified, null, 'UI 点击没有可比对的 intent');
});

// R264：成对守卫与 action 无关 —— 非 Drag 动作单给一个 from 坐标也必须是用法错：
// fromX 单给会把字面量 "undefined" 发给上游（畸形 argv），fromY 单给会被静默丢弃。
test('playClick 非 Drag 只给 --from-x → BAD_COORD（绝不把字面 undefined 发给上游）', async () => {
  const spy = [];
  const e = await playClick({ projectPath: 'P', action: 'Click', x: '10', y: '20', fromX: '30', _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(e.code, 'BAD_COORD');
  assert.strictEqual(exitCodeFor(e), 2);
  assert.strictEqual(spy.length, 0, '用法错必须在调 uloop 之前收敛');
});

test('playClick 非 Drag 只给 --from-y → BAD_COORD（绝不静默丢弃）', async () => {
  const spy = [];
  const e = await playClick({ projectPath: 'P', action: 'Click', x: '10', y: '20', fromY: '40', _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(e.code, 'BAD_COORD');
  assert.strictEqual(exitCodeFor(e), 2);
  assert.strictEqual(spy.length, 0, '用法错必须在调 uloop 之前收敛');
});

test('playClick 命中空场景（无 EventSystem / 打不到 uGUI）→ hint 说明它只对 uGUI 生效（U16）', async () => {
  const e = await playClick({
    projectPath: 'P', action: 'Click', x: '10', y: '10',
    _call: fakeCall({ Success: false, Message: 'No EventSystem found in the scene. Ensure an EventSystem GameObject exists.' }),
  });
  assert.strictEqual(e.ok, false);
  assert.ok(e.hint.some((h) => /uGUI|GraphicRaycaster|SpriteRenderer/.test(h)), `hint 必须点明适用范围：${JSON.stringify(e.hint)}`);
});

test('playMouse 非 dry-run 且命中 Input System 缺失 → INPUT_SYSTEM_UNAVAILABLE；--dry-run 不受影响', async () => {
  const e = await playMouse({
    projectPath: 'P', action: 'Click', x: '10', y: '10',
    _call: fakeCall({ Success: false, Message: 'simulate-mouse-input requires the Input System package (com.unity.inputsystem). x' }),
  });
  assert.strictEqual(e.code, 'INPUT_SYSTEM_UNAVAILABLE');

  const spy = [];
  const dry = await playMouse({
    projectPath: 'P', action: 'Click', x: '10', y: '10', dryRun: true,
    _call: fakeCall({ Success: true, Hit: false, CameraName: 'Main Camera', Message: 'no hit' }, spy),
  });
  assert.strictEqual(dry.ok, true);
  assert.deepStrictEqual(spy[0].args, ['--action', 'Click', '--x', '10', '--y', '10', '--dry-run']);
  assert.ok(dry.hint.some((h) => /3D|Physics/.test(h)), '--dry-run 用的是 3D 物理射线，必须写在 hint 里');
  assert.strictEqual(dry.verified, null, '鼠标注入没有可比对的 intent');
});

test('playLogs：--log-type/--max-count/--search-text 透传，日志压成 {type,message}（不带 stack trace）', async () => {
  const spy = [];
  const e = await playLogs({
    projectPath: 'P', logType: 'Log', maxCount: '5', searchText: '[BB]',
    _call: fakeCall({
      Success: true, TotalCount: 7, DisplayedCount: 2, LogType: 'Log', MaxCount: 5, SearchText: '[BB]',
      Logs: [
        { Type: 'Log', Message: '[BB] ready bricks=24', StackTrace: 'long...' },
        { Type: 'Log', Message: '[BB] hit brick=Brick_2_1 score=1', StackTrace: 'long...' },
      ],
    }, spy),
  });
  assert.deepStrictEqual(spy[0].args, ['--log-type', 'Log', '--max-count', '5', '--search-text', '[BB]']);
  assert.strictEqual(e.actual.totalCount, 7);
  assert.deepStrictEqual(e.actual.logs, [
    { type: 'Log', message: '[BB] ready bricks=24' },
    { type: 'Log', message: '[BB] hit brick=Brick_2_1 score=1' },
  ]);
  assert.strictEqual(e.actual.logs[0].stackTrace, undefined, '不主动搬 stack trace（token 成本）');
  assert.ok(e.hint.some((h) => /7|裁剪|TotalCount/.test(h)), 'TotalCount > DisplayedCount 必须提示被裁剪');
  assert.strictEqual(e.verified, null, '读日志没有可比对的 intent');
});

// R265：Logs 的元素形状必须逐个校验 —— 否则 [null] 会以 TypeError 冒到 bin/unity.js 顶层
// （退出码 3「内部错误」，把上游载荷问题错分类成本包 bug），['oops'] 会凭空造出 {type:'Log',message:''}。
test('playLogs：Logs 里有非对象元素 → BAD_LOG_RESPONSE（退出码 1，不抛异常）', async () => {
  const e = await playLogs({
    projectPath: 'P',
    _call: fakeCall({ Success: true, TotalCount: 1, DisplayedCount: 1, Logs: [null] }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BAD_LOG_RESPONSE');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('playLogs 非法 --log-type → BAD_ACTION（用法错 2）；缺 --log-type 用默认 All', async () => {
  const badSpy = [];
  const bad = await playLogs({ projectPath: 'P', logType: 'Nope', _call: fakeCall({ Success: true }, badSpy) });
  assert.strictEqual(bad.code, 'BAD_ACTION');
  assert.strictEqual(badSpy.length, 0, '用法错必须在调 uloop 之前收敛');
  const spy = [];
  await playLogs({ projectPath: 'P', _call: fakeCall({ Success: true, TotalCount: 0, DisplayedCount: 0, Logs: [] }, spy) });
  assert.deepStrictEqual(spy[0].args, ['--log-type', 'All']);
});

test('playView：读写 Game 视图分辨率；只给一半 → BAD_SIZE（2）', async () => {
  const spy = [];
  const e = await playView({
    projectPath: 'P', width: '960', height: '640',
    _call: fakeCall({ Success: true, PreviousWidth: 892, PreviousHeight: 355, CurrentWidth: 960, CurrentHeight: 640, Changed: true, Message: 'changed' }, spy),
  });
  assert.deepStrictEqual(spy[0].args, ['--width', '960', '--height', '640']);
  assert.strictEqual(e.actual.currentWidth, 960);
  assert.strictEqual(e.actual.changed, true);
  assert.strictEqual(e.verified, null, '读写 Game 视图分辨率没有可比对的 intent');

  const readOnly = await playView({ projectPath: 'P', _call: fakeCall({ Success: true, PreviousWidth: 892, PreviousHeight: 355, CurrentWidth: 892, CurrentHeight: 355, Changed: false }) });
  assert.strictEqual(readOnly.ok, true, '不带 --width/--height 是只读查询');

  const badSpy = [];
  const bad = await playView({ projectPath: 'P', width: '960', _call: fakeCall({ Success: true }, badSpy) });
  assert.strictEqual(bad.code, 'BAD_SIZE');
  assert.strictEqual(exitCodeFor(bad), 2);
  assert.strictEqual(badSpy.length, 0, '用法错必须在调 uloop 之前收敛');
});

test('CLI play：子动作表与用法错（未知动作 / 未知 --action → 2）', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout, captureStderr } = require('./helpers/capture.js');
  const unknown = await captureStderr(() => main(['play', 'dance']));
  assert.strictEqual(unknown.result, 2);
  assert.match(unknown.out, /usage: unity play/);
  const badAction = await captureStdout(() => main(['play', 'click', '--action', 'Nope', '--x', '1', '--y', '2', '--json']));
  assert.strictEqual(badAction.result, 2);
  assert.strictEqual(JSON.parse(badAction.out).code, 'BAD_ACTION');
});
