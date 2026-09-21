'use strict';

const { call } = require('./uloop.js');
const { ok, fail, envelopeFromCall } = require('./envelope.js');
const { compareSubset } = require('./readback.js');

/**
 * `unity play`：PlayMode 试玩闭环（进/出/暂停/步进 + 模拟输入 + 日志 + Game 视图尺寸）。
 *
 * 参数名与响应字段名**全部来自上游 vendor 实证**（全局约束 7 / 任务 7 的探测节）：
 *   - `control-play-mode --action/--timeout-seconds`：ControlPlayMode/Skill/SKILL.md:21-22
 *   - `simulate-mouse-ui --action/--x/--y/--from-x/--from-y/--drag-speed/--duration/--button/--bypass-raycast/--target-path/--drop-target-path`：SimulateMouseUi/Skill/SKILL.md:31-41
 *   - `simulate-mouse-input --action/--x/--y/--button/--duration/--delta-x/--delta-y/--scroll-x/--scroll-y/--dry-run`：SimulateMouseInput/Skill/SKILL.md:37-46
 *   - `simulate-keyboard --action/--key/--duration`：SimulateKeyboard/Skill/SKILL.md:30-32
 *   - `get-logs --log-type/--max-count/--search-text/--include-stack-trace`：GetLogs/Skill/SKILL.md:21-23
 *   - `set-game-view-size --width/--height`：SetGameViewSize/Skill/SKILL.md:21-22
 *
 * **信封口径**：`start`/`stop`/`pause`/`step` 有可比对的 intent（PlayMode 状态），故 `verified` 是布尔；
 * `status` / `click` / `mouse` / `key` / `logs` / `view` 没有 intent → `verified` 恒 `null`（全局约束 15）。
 */

/** `control-play-mode --action` 的合法取值（上游枚举）。 */
const MODE_ACTIONS = ['Play', 'Stop', 'Pause', 'Step', 'Status'];
/** `simulate-mouse-ui --action` 的合法取值。 */
const UI_ACTIONS = ['Click', 'LongPress', 'Drag', 'DragStart', 'DragMove', 'DragEnd'];
/** 需要 `--from-x`/`--from-y` 的 UI 动作（只有一次性 Drag 需要；DragStart/Move/End 从当前位置开始）。 */
const UI_FROM_ACTIONS = ['Drag'];
const BUTTONS = ['Left', 'Right', 'Middle'];
/** `simulate-mouse-input --action` 的合法取值。 */
const MOUSE_ACTIONS = ['Click', 'LongPress', 'MoveDelta', 'SmoothDelta', 'Scroll'];
/** `simulate-keyboard --action` 的合法取值。 */
const KEY_ACTIONS = ['Press', 'KeyDown', 'KeyUp', 'ReleaseAll'];
/** `get-logs --log-type` 的合法取值。 */
const LOG_TYPES = ['All', 'Error', 'Warning', 'Log'];

/**
 * 上游「缺 Input System」的逐字报文识别（出处见文件头注释）。
 * 大小写不敏感，只认关键短语 —— 报文里还带包名与 Active Input Handling 的指引。
 */
function isInputSystemMissing(message) {
  return typeof message === 'string' && /requires the input system package/i.test(message);
}

/** `INPUT_SYSTEM_UNAVAILABLE` 的两条出路（**不许**静默降级成别的调用）。 */
const INPUT_SYSTEM_HINT = [
  "上游要求 Input System 包（com.unity.inputsystem）：装包，并把 Player Settings 的 Active Input Handling 改成 'Input System Package (New)' 或 'Both'（改完需重启编辑器）",
  // F5/R348（原 E2E B1「报错误导」）：旧文案把用户指向裸 uloop 的 `execute-dynamic-code`，
  // 而 SKILL §8 明令禁止裸 uloop —— M3 起命令面已有 `unity exec`（R349 收口），出路改为它。
  '不改项目设置的话：如实声明「无真实输入、玩法自动运行」，用 `unity play logs` 读运行期状态（打砖块模板的 `[BB] … score=… left=…` 就在日志里），或用 `unity exec` 直接读运行期脚本字段（`score` / `bricksAlive`，返回值在 `actual.result`）—— **不要**绕开 `unity` 去调裸 uloop',
  '本命令不会静默降级：拿不到真实输入就如实失败',
];

/** 十进制整数参数：缺省 → `undefined`；非法 → `null`（调用方落用法错）。 */
function intArg(v) {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !/^-?\d+$/.test(v)) return null;
  return Number(v);
}

/** `unity play start|stop|pause|step|status` → `control-play-mode`。 */
async function playMode({ projectPath, env, action = 'Play', timeoutSeconds, _call } = {}) {
  if (!MODE_ACTIONS.includes(action)) {
    return fail({
      code: 'BAD_ACTION',
      message: `play 的 --action 取值非法：${JSON.stringify(action)}`,
      actual: { action, allowed: [...MODE_ACTIONS] },
      hint: ['子动作：start(Play) / stop(Stop) / pause(Pause) / step(Step) / status(Status)'],
    });
  }
  const timeout = intArg(timeoutSeconds);
  if (timeout === null || (timeout !== undefined && timeout <= 0)) {
    return fail({
      code: 'BAD_TIMEOUT',
      message: `--timeout-seconds 需要正整数，收到 ${JSON.stringify(timeoutSeconds)}`,
      actual: { timeoutSeconds },
      hint: ['用法：--timeout-seconds 180（上游默认 180 秒）'],
    });
  }
  const args = ['--action', action];
  if (timeout !== undefined) args.push('--timeout-seconds', String(timeout));
  const r = await (_call || call)('control-play-mode', args, { projectPath, env });
  // ⚠️ R263：`control-play-mode` 在**触发 domain reload 的 Play/Stop 调用**上不回 `Success`
  // （真机实证：`{"IsPlaying":true,"Changed":true,"Message":"Play mode started",...}`，无 Success 字段），
  // 若照 `fromUloop` 的全局判据会把「已按意图切换」误报成 `ULOOP_BAD_PAYLOAD`。
  // 例外**只**在本工具的专用路径里收口，**不许**放宽 `lib/envelope.js` 的 `Success === true`
  //（U11/R16 的假绿教训），也不得影响 playClick/playMouse/playKey/playLogs/playView。
  // 四支：① Success===false（含其它失败形状）→ 走既有错误映射；② Success===true → 正常；
  // ③ Success 缺失 **且** IsPlaying 是布尔 → 这是 Play/Stop 形状，接受该载荷为 actual；
  // ④ 其余（`{}` / Success 是字符串 / 无布尔 IsPlaying）→ 仍落 ULOOP_BAD_PAYLOAD（安全网不变）。
  const raw = r && r.truncated === true ? null : (r ? r.json : null);
  // R267：真机证据只覆盖 Play/Stop（Pause/Step/Status 恒带 Success），所以第③支再收窄到这两个 action；
  // 「truncated 优先」的判定顺序不许动（R268① 的 tripwire 钉住它）。
  const isPlayStopShape = raw !== null && typeof raw === 'object' && raw.Success === undefined
    && typeof raw.IsPlaying === 'boolean' && (action === 'Play' || action === 'Stop');
  if (!isPlayStopShape) {
    const envl = envelopeFromCall(r);
    if (!envl.ok) return envl;
  }
  const j = raw;
  const actual = {
    action,
    isPlaying: j.IsPlaying === true,
    isPaused: j.IsPaused === true,
    changed: j.Changed === true,
    wasAlreadyStopped: j.WasAlreadyStopped === true,
    resumedFromPause: j.ResumedFromPause === true,
    blockedByCompileErrors: j.BlockedByCompileErrors === true,
    blockedByUnsavedChanges: j.BlockedByUnsavedChanges === true,
    compileErrorCount: typeof j.CompileErrorCount === 'number' ? j.CompileErrorCount : null,
    stoppedBy: j.StoppedBy ?? null,
    stoppedAt: j.StoppedAt ?? null,
    message: typeof j.Message === 'string' ? j.Message : '',
  };
  const hint = [];
  if (typeof j.Warning === 'string' && j.Warning !== '') hint.push(`上游警告：${j.Warning}`);
  if (actual.blockedByUnsavedChanges) {
    hint.push('场景有未保存改动且无法静默保存（最常见是未命名场景）—— 先把场景保存到明确路径（或放弃改动）再重试');
  }
  if (actual.blockedByCompileErrors) {
    hint.push(`编译错挡住 PlayMode（CompileErrorCount=${actual.compileErrorCount}）—— 先 \`unity compile\` 修掉`);
  }
  if (actual.wasAlreadyStopped) hint.push('Stop 时本来就没在跑（Changed:false、WasAlreadyStopped:true）—— 这是幂等成功，不是失败');
  // intent：Play/Stop 看 isPlaying；Pause/Step 看 isPaused；Status 只看状态（无 intent）
  const intent = action === 'Play' ? { isPlaying: true }
    : action === 'Stop' ? { isPlaying: false }
      : (action === 'Pause' || action === 'Step') ? { isPaused: true }
        : null;
  if (intent === null) return ok(actual, { hint });
  const mismatches = compareSubset(intent, actual);
  return {
    ...ok(actual, {
      verified: mismatches.length === 0,
      intent,
      hint: mismatches.length
        ? [...hint, 'PlayMode 状态与意图不一致（verified:false）——先看 actual.blockedByUnsavedChanges / blockedByCompileErrors / message']
        : hint,
    }),
    mismatches,
  };
}

/** `unity play click` → `simulate-mouse-ui`（需要 PlayMode + EventSystem + ScreenSpaceOverlay uGUI）。 */
async function playClick({
  projectPath, env, action = 'Click', x, y, fromX, fromY, button, duration, targetPath, bypassRaycast, _call,
} = {}) {
  if (!UI_ACTIONS.includes(action)) {
    return fail({
      code: 'BAD_ACTION',
      message: `play click 的 --action 取值非法：${JSON.stringify(action)}`,
      actual: { action, allowed: [...UI_ACTIONS] },
      hint: ['Click / LongPress / Drag / DragStart / DragMove / DragEnd'],
    });
  }
  if (button !== undefined && !BUTTONS.includes(button)) {
    return fail({ code: 'BAD_ACTION', message: `--button 取值非法：${JSON.stringify(button)}`, actual: { button, allowed: [...BUTTONS] }, hint: ['Left / Right / Middle'] });
  }
  const xi = intArg(x); const yi = intArg(y);
  if (xi === undefined || yi === undefined || xi === null || yi === null) {
    return fail({
      code: 'BAD_COORD',
      message: 'play click 需要 --x 与 --y（Game 视图像素，左上原点；上游默认 0 会点到角落）',
      actual: { x, y },
      hint: ['坐标取自 `unity shot --capture-mode rendering --json` 的 gameViewWidth/Height 与元素标注，或 `unity exec` 算出的 Camera.WorldToScreenPoint'],
    });
  }
  const fxi = intArg(fromX); const fyi = intArg(fromY);
  if (UI_FROM_ACTIONS.includes(action) && (fxi === undefined || fyi === undefined)) {
    return fail({
      code: 'BAD_COORD',
      message: `play click --action ${action} 需要 --from-x 与 --from-y（拖拽起点）`,
      actual: { fromX, fromY },
      hint: ['用法：--action Drag --from-x 100 --from-y 200 --x 300 --y 200'],
    });
  }
  // R264：成对守卫与 action 无关 —— 只要给了任一侧，两侧就必须都是整数。
  // 修前：非 Drag 的 fromX 单给会把字面量 "undefined" 发给上游（畸形 argv），fromY 单给会被静默丢弃；
  // 约束 16 要求用法错只由 argv 决定且在 uloop 调用前收敛，故两条路径都落 BAD_COORD（退出码 2）。
  const fromGiven = fxi !== undefined || fyi !== undefined;
  if (fromGiven && (fxi === undefined || fyi === undefined || fxi === null || fyi === null)) {
    return fail({ code: 'BAD_COORD', message: '--from-x / --from-y 必须成对给整数', actual: { fromX, fromY }, hint: ['用法：--from-x 100 --from-y 200'] });
  }
  const args = ['--action', action, '--x', String(xi), '--y', String(yi)];
  if (fromGiven) args.push('--from-x', String(fxi), '--from-y', String(fyi));
  if (button !== undefined) args.push('--button', button);
  if (duration !== undefined) args.push('--duration', duration);
  if (targetPath !== undefined) args.push('--target-path', targetPath);
  if (bypassRaycast === true) args.push('--bypass-raycast');

  const r = await (_call || call)('simulate-mouse-ui', args, { projectPath, env });
  const envl = envelopeFromCall(r);
  if (!envl.ok) return uiFailureHint(envl);
  const j = r.json;
  const hint = [];
  if (j.HitGameObjectName === null && action === 'Click') {
    hint.push('点击落空（HitGameObjectName 为 null 且 Success:true）——空地上的点击也算成功，业务效果不会发生');
  }
  if (j.InterruptedByPausePoint === true) {
    hint.push('被 pause point 打断：读 message 判断指针事件是否已经派发；本命令不自动恢复');
  }
  return ok({
    action,
    hitGameObjectName: j.HitGameObjectName ?? null,
    positionX: typeof j.PositionX === 'number' ? j.PositionX : null,
    positionY: typeof j.PositionY === 'number' ? j.PositionY : null,
    endPositionX: typeof j.EndPositionX === 'number' ? j.EndPositionX : null,
    endPositionY: typeof j.EndPositionY === 'number' ? j.EndPositionY : null,
    interruptedByPausePoint: j.InterruptedByPausePoint === true,
    pausePointHitCount: typeof j.PausePointHitCount === 'number' ? j.PausePointHitCount : null,
    message: typeof j.Message === 'string' ? j.Message : '',
  }, { hint });
}

/**
 * `simulate-mouse-ui` 的失败补 hint（**按证据分支**，与 M1 的 R109 同源）：
 * 上游的射线只遍历 ScreenSpaceOverlay + GraphicRaycaster 的 uGUI（vendor 出处见任务 7 探测节），
 * 所以「场景里没有 EventSystem」与「点不到 sprite」都必须是**可操作的**提示，而不是让 agent 反复重试。
 */
function uiFailureHint(envelope) {
  const hint = [...envelope.hint];
  if (/No EventSystem found/i.test(envelope.message || '')) {
    hint.push('simulate-mouse-ui 只对 uGUI 生效：需要场景里有 EventSystem，且目标在 ScreenSpaceOverlay 的 Canvas + GraphicRaycaster 下');
    hint.push('SpriteRenderer / 2D 物理对象**打不到**（上游只收集 uGUI 的 Graphic）——要驱动 sprite 游戏请用 `unity exec` 注入状态（注入的要如实声明），或改用 uGUI 承载交互');
  }
  return { ...envelope, hint };
}

/** `unity play mouse` → `simulate-mouse-input`（真实注入需要 Input System；`--dry-run` 不需要）。 */
async function playMouse({
  projectPath, env, action = 'Click', x, y, button, duration, deltaX, deltaY, scrollX, scrollY, dryRun, _call,
} = {}) {
  if (!MOUSE_ACTIONS.includes(action)) {
    return fail({
      code: 'BAD_ACTION',
      message: `play mouse 的 --action 取值非法：${JSON.stringify(action)}`,
      actual: { action, allowed: [...MOUSE_ACTIONS] },
      hint: ['Click / LongPress / MoveDelta / SmoothDelta / Scroll'],
    });
  }
  if (button !== undefined && !BUTTONS.includes(button)) {
    return fail({ code: 'BAD_ACTION', message: `--button 取值非法：${JSON.stringify(button)}`, actual: { button, allowed: [...BUTTONS] }, hint: ['Left / Right / Middle'] });
  }
  const args = ['--action', action];
  if (action === 'Click' || action === 'LongPress' || dryRun === true) {
    const xi = intArg(x); const yi = intArg(y);
    if (xi === undefined || yi === undefined || xi === null || yi === null) {
      return fail({ code: 'BAD_COORD', message: `play mouse --action ${action} 需要 --x 与 --y（Game 视图像素）`, actual: { x, y }, hint: ['用法：--x 960 --y 540'] });
    }
    args.push('--x', String(xi), '--y', String(yi));
  }
  if (button !== undefined) args.push('--button', button);
  if (duration !== undefined) args.push('--duration', duration);
  if (deltaX !== undefined) args.push('--delta-x', deltaX);
  if (deltaY !== undefined) args.push('--delta-y', deltaY);
  if (scrollX !== undefined) args.push('--scroll-x', scrollX);
  if (scrollY !== undefined) args.push('--scroll-y', scrollY);
  if (dryRun === true) args.push('--dry-run');

  const r = await (_call || call)('simulate-mouse-input', args, { projectPath, env });
  const envl = envelopeFromCall(r);
  if (!envl.ok) {
    if (isInputSystemMissing(envl.message) && dryRun !== true) {
      return fail({
        code: 'INPUT_SYSTEM_UNAVAILABLE',
        message: envl.message,
        actual: { ...(envl.actual && typeof envl.actual === 'object' ? envl.actual : {}), upstreamMessage: envl.message, action },
        hint: [...INPUT_SYSTEM_HINT, ...envl.hint],
        retryable: false,
      });
    }
    return envl;
  }
  const j = r.json;
  const hint = [];
  if (dryRun === true) {
    hint.push('--dry-run 用的是 **3D Physics 射线**（上游文档），打不到 2D 碰撞体 —— 2D 项目里它的命中结果没有意义');
    hint.push('dry-run 的结果字段：cameraName/cameraPath/hit/hitGameObjectName/hitPoint*（先看 cameraName 对不对，再看有没有命中）');
  }
  return ok({
    action,
    dryRun: dryRun === true,
    button: j.Button ?? null,
    positionX: typeof j.PositionX === 'number' ? j.PositionX : null,
    positionY: typeof j.PositionY === 'number' ? j.PositionY : null,
    cameraName: j.CameraName ?? null,
    cameraPath: j.CameraPath ?? null,
    hit: typeof j.Hit === 'boolean' ? j.Hit : null,
    hitGameObjectName: j.HitGameObjectName ?? null,
    interruptedByPausePoint: j.InterruptedByPausePoint === true,
    pressDeliveredToGame: typeof j.PressDeliveredToGame === 'boolean' ? j.PressDeliveredToGame : null,
    message: typeof j.Message === 'string' ? j.Message : '',
  }, { hint });
}

/** `unity play key` → `simulate-keyboard`（需要 Input System；`ReleaseAll` 是恢复动作）。 */
async function playKey({ projectPath, env, action = 'Press', key, duration, _call } = {}) {
  if (!KEY_ACTIONS.includes(action)) {
    return fail({
      code: 'BAD_ACTION',
      message: `play key 的 --action 取值非法：${JSON.stringify(action)}`,
      actual: { action, allowed: [...KEY_ACTIONS] },
      hint: ['Press / KeyDown / KeyUp / ReleaseAll'],
    });
  }
  if (action !== 'ReleaseAll' && (typeof key !== 'string' || key === '')) {
    return fail({
      code: 'MISSING_KEY',
      message: `play key --action ${action} 需要 --key（Input System Key 枚举名，如 W / Space / LeftShift）`,
      actual: { key },
      hint: ['数字键写 Digit0-Digit9（不是裸的 0-9）', '恢复卡住的按键状态用 --action ReleaseAll（不需要 --key）'],
    });
  }
  const args = ['--action', action];
  if (action !== 'ReleaseAll') args.push('--key', key);
  if (duration !== undefined) args.push('--duration', duration);

  const r = await (_call || call)('simulate-keyboard', args, { projectPath, env });
  const envl = envelopeFromCall(r);
  if (!envl.ok) {
    if (isInputSystemMissing(envl.message)) {
      return fail({
        code: 'INPUT_SYSTEM_UNAVAILABLE',
        message: envl.message,
        actual: { ...(envl.actual && typeof envl.actual === 'object' ? envl.actual : {}), upstreamMessage: envl.message, action, key: key ?? null },
        hint: [...INPUT_SYSTEM_HINT, ...envl.hint],
        retryable: false,
      });
    }
    return envl;
  }
  const j = r.json;
  const hint = [];
  if (typeof j.Warning === 'string' && j.Warning !== '') hint.push(`上游警告：${j.Warning}`);
  if (j.PressEdgeObserved === false) {
    hint.push('PressEdgeObserved:false —— 游戏循环很可能**没看到**这次按键（上游建议先看 PressEdge* 诊断与 pause-point-status，编辑器失焦时先跑 uloop focus-window）');
  }
  if (j.InterruptedByPausePoint === true) {
    hint.push('被 pause point 打断：Press/KeyDown 先读 pressDeliveredToGame 再决定是否重试；状态不一致时用 --action ReleaseAll 恢复');
  }
  return ok({
    action,
    keyName: j.KeyName ?? (key ?? null),
    pressDeliveredToGame: typeof j.PressDeliveredToGame === 'boolean' ? j.PressDeliveredToGame : null,
    pressEdgeObserved: typeof j.PressEdgeObserved === 'boolean' ? j.PressEdgeObserved : null,
    releasedKeys: Array.isArray(j.ReleasedKeys) ? j.ReleasedKeys : null,
    interruptedByPausePoint: j.InterruptedByPausePoint === true,
    warning: typeof j.Warning === 'string' ? j.Warning : '',
    message: typeof j.Message === 'string' ? j.Message : '',
  }, { hint });
}

/** `unity play logs` → `get-logs`（**这是本项目「状态读回」的标准手段**）。 */
async function playLogs({ projectPath, env, logType = 'All', maxCount, searchText, includeStackTrace, _call } = {}) {
  if (!LOG_TYPES.includes(logType)) {
    return fail({
      code: 'BAD_ACTION',
      message: `--log-type 取值非法：${JSON.stringify(logType)}`,
      actual: { logType, allowed: [...LOG_TYPES] },
      hint: ['All / Error / Warning / Log'],
    });
  }
  const mc = intArg(maxCount);
  if (mc === null || (mc !== undefined && mc <= 0)) {
    return fail({ code: 'BAD_ACTION', message: `--max-count 需要正整数，收到 ${JSON.stringify(maxCount)}`, actual: { maxCount }, hint: ['用法：--max-count 50（上游默认 100）'] });
  }
  const args = ['--log-type', logType];
  if (mc !== undefined) args.push('--max-count', String(mc));
  if (searchText !== undefined) args.push('--search-text', searchText);
  if (includeStackTrace === true) args.push('--include-stack-trace');

  const r = await (_call || call)('get-logs', args, { projectPath, env });
  const envl = envelopeFromCall(r);
  if (!envl.ok) return envl;
  const j = r.json;
  if (typeof j.TotalCount !== 'number' || !Array.isArray(j.Logs)) {
    // 字段缺失即失败（U11 的纪律）：绝不打印 ? 假装成功
    return fail({
      code: 'BAD_LOG_RESPONSE',
      message: 'get-logs 响应缺 TotalCount 或 Logs（上游字段可能改名）',
      actual: { keys: Object.keys(j ?? {}) },
      hint: ['对照 docs/CAPABILITIES-*.md §4.7 的字段表；用 `unity doctor --smoke` 复现'],
    });
  }
  const badElement = j.Logs.some((l) => l === null || typeof l !== 'object' || Array.isArray(l));
  if (badElement) {
    // R265：元素形状必须校验 —— `[null]` 会在 map 里抛 TypeError（冒到 bin/unity.js 顶层 → 退出码 3
    // 「内部错误」，把上游载荷问题错分类成本包 bug），`['oops']` 会凭空造出 `{type:'Log',message:''}`。
    // 两者都按上游形状变化响亮失败（退出码 1），**不抛**。
    return fail({
      code: 'BAD_LOG_RESPONSE',
      message: 'get-logs 的 Logs 里有非对象元素（上游字段形状变了）',
      actual: { keys: Object.keys(j), sample: j.Logs.slice(0, 3) },
      hint: ['对照 docs/CAPABILITIES-*.md §4.7 的字段表；用 `unity doctor --smoke` 复现'],
    });
  }
  const logs = j.Logs.map((l) => ({
    type: typeof l.Type === 'string' ? l.Type : 'Log',
    message: typeof l.Message === 'string' ? l.Message : '',
    ...(includeStackTrace === true && typeof l.StackTrace === 'string' && l.StackTrace !== '' ? { stackTrace: l.StackTrace } : {}),
  }));
  const hint = [];
  const displayed = typeof j.DisplayedCount === 'number' ? j.DisplayedCount : logs.length;
  if (j.TotalCount > displayed) {
    hint.push(`TotalCount=${j.TotalCount} > DisplayedCount=${displayed}：日志被 --max-count 裁剪了，调大它或加 --search-text 缩小范围`);
  }
  if (logs.some((l) => /Exception|NullReference/i.test(l.message))) {
    hint.push('日志里出现过 Exception/NullReference —— PlayMode 里的异常会中断脚本，先用 `play stop` 收场再查因');
  }
  return ok({
    totalCount: j.TotalCount,
    displayedCount: displayed,
    logType: typeof j.LogType === 'string' ? j.LogType : logType,
    maxCount: typeof j.MaxCount === 'number' ? j.MaxCount : (mc ?? null),
    searchText: typeof j.SearchText === 'string' ? j.SearchText : (searchText ?? null),
    logs,
  }, { hint });
}

/** `unity play view` → `set-game-view-size`（读或设 Game 视图分辨率；**不给参数就是只读查询**）。 */
async function playView({ projectPath, env, width, height, _call } = {}) {
  const w = intArg(width); const h = intArg(height);
  if ((w === undefined) !== (h === undefined)) {
    return fail({
      code: 'BAD_SIZE',
      message: '--width 与 --height 必须一起给（只给一个上游会拒绝）',
      actual: { width, height },
      hint: ['用法：--width 960 --height 640；不给任何参数则只读查询当前分辨率'],
    });
  }
  if ((w !== undefined && (w === null || w <= 0)) || (h !== undefined && (h === null || h <= 0))) {
    return fail({
      code: 'BAD_SIZE',
      message: '--width / --height 需要正整数',
      actual: { width, height },
      hint: ['用法：--width 960 --height 640'],
    });
  }
  const args = [];
  if (w !== undefined) args.push('--width', String(w), '--height', String(h));
  const r = await (_call || call)('set-game-view-size', args, { projectPath, env });
  const envl = envelopeFromCall(r);
  if (!envl.ok) return envl;
  const j = r.json;
  const hint = [];
  if (j.Changed === true) {
    hint.push('Game 视图尺寸已改（**只影响本次编辑器会话**，不改项目文件）—— 截图/像素判定的坐标基准随之变化，改完请重新截图');
  }
  return ok({
    previousWidth: typeof j.PreviousWidth === 'number' ? j.PreviousWidth : null,
    previousHeight: typeof j.PreviousHeight === 'number' ? j.PreviousHeight : null,
    currentWidth: typeof j.CurrentWidth === 'number' ? j.CurrentWidth : null,
    currentHeight: typeof j.CurrentHeight === 'number' ? j.CurrentHeight : null,
    changed: j.Changed === true,
    message: typeof j.Message === 'string' ? j.Message : '',
  }, { hint });
}

module.exports = {
  playMode, playClick, playMouse, playKey, playLogs, playView, isInputSystemMissing,
  uiFailureHint, intArg, MODE_ACTIONS, UI_ACTIONS, MOUSE_ACTIONS, KEY_ACTIONS, LOG_TYPES,
};
