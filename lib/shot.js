'use strict';

const { call } = require('./uloop.js');
const { ok, fail, envelopeFromCall } = require('./envelope.js');
const { language } = require('./editor-discovery.js');

/**
 * 窗口名映射（O6）。
 *
 * ⚠️ 实测（docs/PITFALLS.md **U7**）：uloop 的 `--window-name` 是**按窗口标题字符串**
 * 做 exact 比较的，本机编辑器界面语言为中文，窗口标题是「游戏/场景/控制台/层级/项目」，
 * 因此英文名 `Game`/`Scene`/`Console`/`Hierarchy`/`Project` **全部失配**
 * （Game 报 `Neither Game nor Simulator window found…`，其余报 `Window 'X' not found`）。
 *
 * 完整映射应由运行时枚举 `EditorWindow` 得到；此处是覆盖常见窗口的**静态表**，
 * 每一项都必须有实测出处。
 *
 * ⚠️ **2026-09-19 真机补齐**（`Resources.FindObjectsOfTypeAll<EditorWindow>()` 枚举标题）：
 * `SceneView=>场景` / `ConsoleWindow=>控制台` / `GameView=>游戏` /
 * `SceneHierarchyWindow=>层级` / `ProjectBrowser=>项目` / `InspectorWindow=>检查器`。
 * **Inspector 的标题是「检查器」而不是「属性」** —— 旧表值错（当时标了「未实测」），
 * 真机实证：`--window-name 检查器` → Success（276x926）；`--window-name 属性` → not found。
 *
 * @type {Record<string, string>}
 */
const ZH = {
  Game: '游戏', // 实测（U7；本次枚举 GameView => 游戏）
  Scene: '场景', // 实测（U7；本次枚举 SceneView => 场景）
  Console: '控制台', // 实测（U7；本次枚举 ConsoleWindow => 控制台）
  Hierarchy: '层级', // 实测（U7；本次枚举 SceneHierarchyWindow => 层级）
  Project: '项目', // 实测（U7；本次枚举 ProjectBrowser => 项目）
  Inspector: '检查器', // 实测（2026-09-19，InspectorWindow => 检查器；截图 276x926 成功）
};

/**
 * 反向表（**中文标题 → 英文名**）。
 *
 * ⚠️ **官方-2**：Unity 官方版（`Unity.exe`）的界面是**英文**（`GameView=>Game` / `SceneView=>Scene` /
 * `ConsoleWindow=>Console` / `SceneHierarchyWindow=>Hierarchy` / `ProjectBrowser=>Project` /
 * `InspectorWindow=>Inspector`，真机 `titleContent` 枚举），而 `language()` 在多引擎共存机上可能
 * 取到**团结的** `zh_CN` → 单向往 `Game → 游戏` 映射在官方版上**必失配**。
 * 本表提供反方向（`游戏 → Game`），由 {@link windowNameFor} 在英文/未知语言下使用，
 * 也是 {@link alternateWindowName} 自动重试的取值来源。
 *
 * @type {Record<string, string>}
 */
const EN = Object.fromEntries(Object.entries(ZH).map(([en, zh]) => [zh, en]));

/** `--capture-mode` 的合法取值（上游枚举字面量，大小写敏感；出处见 Screenshot/Skill/SKILL.md:24）。 */
const CAPTURE_MODES = ['auto', 'window', 'rendering', 'GameView'];

/** `--match-mode` 的合法取值（出处同上 :23）。 */
const MATCH_MODES = ['exact', 'prefix', 'contains'];

/** 缺省 `auto`；非法（含裸写 `true`）返回 `null` → 调用方落 `BAD_CAPTURE_MODE`。 */
function validateCaptureMode(v) {
  if (v === undefined) return 'auto';
  return typeof v === 'string' && CAPTURE_MODES.includes(v) ? v : null;
}

/** 缺省 `exact`；非法返回 `null` → 调用方落 `BAD_MATCH_MODE`。 */
function validateMatchMode(v) {
  if (v === undefined) return 'exact';
  return typeof v === 'string' && MATCH_MODES.includes(v) ? v : null;
}

/**
 * 按界面语言换算窗口名（**双向**；表外名字原样返回）。
 *
 * - 界面语言是中文（{@link isZh}）→ **英文名 → 中文标题**（`Game → 游戏`）；中文名/表外名原样。
 * - 界面语言非中文（`en_US` / 未知）→ **中文标题 → 英文名**（`游戏 → Game`，官方-2）；
 *   英文名/表外名原样（`Game → Game` —— **M1 的恒等行为逐字不变**）。
 *
 * R110②：语言判定**放宽到 `zh*`**（`zh_TW` / `zh-Hans` / `zh_Hans` / `ZH_cn` 都算中文）。
 * 旧实现只认字面量 `zh_CN`，`zh_TW` 会回落英文名 → 在中文界面上**必然** miss（U7）。
 * 注意：`ZH` 表是**简体**标题（实测来源 `zh_CN`），繁体变体的标题可能不同 ——
 * 命令路径会在 hint 里显式提醒（非 `zh_CN` 的中文变体）。
 *
 * @param {string} name 窗口名（`Game` / `游戏` / …）
 * @param {string} lang `language()` 的返回值（`zh_CN` / `zh_TW` / `en_US` / …）
 * @returns {string}
 */
function windowNameFor(name, lang) {
  if (isZh(lang)) return ZH[name] || name;
  return EN[name] || name;
}

/**
 * 本地化失配时的「另一种形态」窗口名（官方-2 的自动重试输入）。
 *
 * 中文界面 → 该名字对应的**英文原名**（`游戏 → Game`）；非中文界面 → 对应的**中文标题**（`Game → 游戏`）。
 * 没有对应形态（笔误 / 表外名）时返回 `null` ⇒ 调用方**不得**发第二次无意义的 uloop 调用。
 *
 * @param {string} tried 已经试过并失配的窗口名（`windowNameFor(name, lang)` 的结果）
 * @param {string} lang `language()` 的返回值
 * @returns {string|null}
 */
function alternateWindowName(tried, lang) {
  const alt = windowNameFor(tried, isZh(lang) ? 'en_US' : 'zh_CN');
  return alt === tried ? null : alt;
}

/** 界面语言是否中文（宽口径，R110②）。 */
function isZh(lang) {
  return String(lang).toLowerCase().startsWith('zh');
}

/**
 * 识别「窗口名因本地化而失配」（U7）。
 *
 * ⚠️ **两种报文都要认**（R102，U7 实录）：
 *   - Game：`Neither Game nor Simulator window found; open the Game view and retry`
 *     —— **不是** `Window 'X' not found` 那条分支；
 *   - 其余窗口：`Window 'Scene' not found (MatchMode: exact)`。
 *
 * @param {unknown} message 上游失败报文（`fromUloop` 抬起的 `message`；嵌套/平铺两种形状都已归一）
 * @returns {boolean}
 */
function isLocalizedMiss(message) {
  if (typeof message !== 'string') return false;
  return /Window\s+'[^']*'\s+not found/i.test(message)
    || /Neither\s+.*\s+nor\s+.*\s+window found/i.test(message);
}

/**
 * 从 screenshot 响应里取第一张图。
 *
 * ⚠️ **永远用 `ImagePath`**（上游 `SKILL.md` Output）：输出目录会累积历史截图，
 * 用 `ls -t` 之类猜「最新文件」可能静默取到上一次的旧图。
 *
 * @param {object} json uloop 响应
 * @returns {{path: string, width: number, height: number}|null} 无图（`Screenshots` 空 /
 *   `ImagePath` 为空 —— 后者出现在 `--elements-only`）时返回 `null`
 */
function pickScreenshot(json) {
  const s = json && Array.isArray(json.Screenshots) ? json.Screenshots[0] : null;
  if (!s || !s.ImagePath) return null;
  return { path: s.ImagePath, width: s.Width, height: s.Height };
}

/**
 * `unity shot`：截 Unity 编辑器窗口 / Game 视图为 PNG。
 *
 * 绕开 U7 的机制（**R99**）：**不传 `--capture-mode`**。
 * uloop 的 `--capture-mode` 默认 `auto` —— **PlayMode 下解析为 `rendering`，
 * 此时 `--window-name` 被上游忽略**（vendor/uloopmcp/…/Screenshot/Skill/SKILL.md:24，
 * 实测见 docs/PITFALLS.md U7 处理②）。因此进 PlayMode 后本命令天然不受本地化影响。
 * **不要**硬传 `--capture-mode rendering`：它要求 PlayMode，EditMode 下会失败。
 *
 * R66：截图是**读**命令，没有 intent 可比对 → 成功信封一律
 * `ok(actual, { hint })`（`verified: null`），**不得**声称 `verified: true`。
 *
 * R105：不吞上游字段 —— `Warning`（非空时）进 `hint`（PlayMode 暂停时画面可能是旧帧）；
 * `ResolvedCaptureMode` 进 `actual.captureMode`（additive，供排障与后续 annotation 流程）。
 *
 * R107：**裸写开关是用法错，不得伪装成环境错** —— `unity shot --window-name`（裸写）
 * 会被 `parseArgs` 解析成布尔 `true` → argv `--window-name true` → 上游回
 * `Window 'true' not found`，旧实现把它归到 `WINDOW_NAME_LOCALIZED`（hint 让用户去改界面语言，
 * 方向完全错）；`unity shot --out`（裸写）更糟：`--output-directory true` 让上游在
 * **编辑器 CWD（项目根）造出一个 `true/` 目录**把图写进去，而信封报 `ok:true`。
 * 两者都在**发起任何 uloop 调用之前**挡下（`BAD_WINDOW_NAME` / `BAD_OUT_DIR`）。
 *
 * **官方-2 / 双向映射**：多引擎共存机上 `language()` 可能取到团结的 `zh_CN`（与当前所连编辑器无关），
 * 而 Unity 官方版（`Unity.exe`）界面是**英文** → 首次按语言映射出的名字（`Game → 游戏`）必失配。
 * 故本地化失配时会**自动用反向形态重试一次**（`游戏 ↔ Game`，{@link alternateWindowName}）；
 * 命中则 `ok:true`，`actual.windowName` 是**真正命中**的那个名字、`actual.retriedFrom` 是被换掉的名字；
 * 两种形态都失配才落 `WINDOW_NAME_LOCALIZED`（hint 给出「官方版传英文原名」+ PlayMode rendering 等出路）。
 * 只按语言映射就能命中时**仍然只有一次** uloop 调用（M1 行为逐字不变）。
 * **R376**：重试的附加门槛是 `tried !== windowName`（名字**真的被映射改过**才重试）——
 * 显式传的名字与映射结果相同（如 en_US 下 `Game → Game`）时窗口没开也不会白打一次调用；
 * 「界面语言非中文 + 用户手动传中文名」（`游戏 → Game`）仍会重试（有意保留的出路）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, outDir?: string,
 *   windowName?: string, captureMode?: string, matchMode?: string, appData?: string, _call?: typeof call}} [opts]
 *   `captureMode` / `matchMode`（M2 接线）：缺省时不进 argv（保持 M1 行为，uloop 默认 auto/exact）；
 *   非法值（含裸写布尔）在调用前落 `BAD_CAPTURE_MODE` / `BAD_MATCH_MODE`；
 *   `appData` 透传给 {@link language}（R100：让窗口名映射可注入测试；生产不传时行为不变）；
 *   `_call` 仅供测试注入
 * @returns {Promise<object>} 信封
 */
async function shot({ projectPath, env, outDir, windowName = 'Game', captureMode, matchMode, appData, _call } = {}) {
  // R237/R247：两个新开关的合法性**只由 argv 决定**，在任何 `_call` 之前收敛。
  const cm = validateCaptureMode(captureMode);
  if (cm === null) {
    return fail({
      code: 'BAD_CAPTURE_MODE',
      message: `--capture-mode 取值非法：${JSON.stringify(captureMode)}`,
      actual: { captureMode, allowed: [...CAPTURE_MODES] },
      hint: [
        `合法取值：${CAPTURE_MODES.join(' | ')}`,
        'rendering / GameView 需要 PlayMode；EditMode 下只能用 auto（→ window）或 window',
        '出处：上游 Screenshot skill 的参数表（本仓库 docs/PITFALLS.md U7 记录了实测行为）',
      ],
    });
  }
  const mm = validateMatchMode(matchMode);
  if (mm === null) {
    return fail({
      code: 'BAD_MATCH_MODE',
      message: `--match-mode 取值非法：${JSON.stringify(matchMode)}`,
      actual: { matchMode, allowed: [...MATCH_MODES] },
      hint: [`合法取值：${MATCH_MODES.join(' | ')}`, 'match-mode 只在 window 捕获模式下生效（rendering 会忽略窗口名）'],
    });
  }
  // R107：用法错必须在调用前收敛（裸写 / 空串 / 非字符串）
  if (typeof windowName !== 'string' || windowName === '') {
    return fail({
      code: 'BAD_WINDOW_NAME',
      message: '--window-name 需要一个非空字符串（不能裸写）',
      actual: { windowName },
      hint: [
        '`--window-name` 裸写会被解析成布尔 true，上游会报 Window \'true\' not found（那不是本地化问题）',
        '用法：`--window-name 游戏` 或 `--window-name Game`；不传则默认 Game',
      ],
    });
  }
  if (outDir !== undefined && (typeof outDir !== 'string' || outDir === '')) {
    return fail({
      code: 'BAD_OUT_DIR',
      message: '--out 需要一个非空字符串（不能裸写）',
      actual: { outDir },
      hint: [
        '`--out` 裸写会被解析成布尔 true，上游会执行 Directory.CreateDirectory("true") —— 在编辑器工作目录（项目根）造出一个 `true/` 目录把图写进去，而信封仍报 ok:true',
        '用法：`--out C:/shots`；不传则用 .uloop/outputs/Screenshots/',
      ],
    });
  }
  const lang = language({ appData, env });
  const tried = windowNameFor(windowName, lang);
  // 只在**显式给出**时传（保证 M1 默认 argv 逐字不变）：
  // 不传 `--capture-mode` 时 uloop 默认 auto —— PlayMode 下解析为 rendering，窗口名被忽略（U7）。
  const buildArgs = (name) => {
    const a = [];
    if (outDir) a.push('--output-directory', outDir);
    a.push('--window-name', name);
    if (captureMode !== undefined) a.push('--capture-mode', cm);
    if (matchMode !== undefined) a.push('--match-mode', mm);
    return a;
  };
  const callTool = _call || call;
  let r = await callTool('screenshot', buildArgs(tried), { projectPath, env });
  let envl = envelopeFromCall(r);
  // 官方-2：本地化失配时**自动用另一种形态重试一次**。
  // 动因：多引擎共存机上 language() 可能取到团结的 zh_CN，而官方版界面是英文
  //（`Game` 被映射成「游戏」→ 必失配）。首次仍按语言映射（M1 行为逐字不变：命中则只有一次调用），
  // 失败才用反向形态（「游戏」→`Game`，反之亦然）再试一次。
  //
  // R376：**门槛收紧** —— 只有「真的因为映射改过名字」（`tried !== windowName`）才重试。
  // 否则用户显式传的名字与映射结果相同时（如 en_US 下 `Game → Game` 恒等），窗口确实没开
  // 也会白打一次 uloop。**有意保留**「界面语言非中文 + 用户手动传中文名」这条出路：
  // 此时 `tried` 是映射出的英文名（`游戏 → Game`），`tried !== windowName` 成立，仍会重试。
  let retriedWith = null;
  let retriedFrom = null;
  let retryFailure = null;
  if (!envl.ok && isLocalizedMiss(envl.message) && tried !== windowName) {
    const alt = alternateWindowName(tried, lang);
    if (alt !== null) {
      const r2 = await callTool('screenshot', buildArgs(alt), { projectPath, env });
      const envl2 = envelopeFromCall(r2);
      retriedWith = alt;
      if (envl2.ok) {
        envl = envl2;
        r = r2;
        retriedFrom = tried;
      } else {
        retryFailure = envl2.message;
      }
    }
  }
  if (!envl.ok) {
    // R108：平铺/嵌套两种失败形状由 fromUloop 统一抬起 Message —— 这里只看信封的 message
    // （真机实测（2026-09-19）：uloop 3.5.1 的 screenshot 失败是平铺形状，
    //  `{Success:false, Message, NextActions, ScreenshotCount, ResolvedCaptureMode}`）。
    if (isLocalizedMiss(envl.message)) {
      // R109：hint 按**证据**分支 —— 不再无脑建议「改传本地化窗口名」
      //（那可能正是刚刚试过的那个名字）。三个证据源：
      //   ① mapped：`--window-name Game` 被换算成了「游戏」才 miss；
      //   ② candidate：静态表里有**没试过**的本地化名（界面语言可能判定不准）；
      //   ③ 都没有（笔误 / 已直接传本地化名 / 表未覆盖）→ 只给「窗口没开/标题不在表内」。
      const mapped = tried !== windowName;
      const candidate = Object.hasOwn(ZH, windowName) ? ZH[windowName] : null;
      const suggestLocalized = candidate !== null && candidate !== tried;
      const hint = [`当前界面语言：${lang}；已尝试窗口名：${tried}`
        + (mapped ? `（由 \`--window-name ${windowName}\` 映射而来）` : '')];
      if (suggestLocalized) {
        hint.push(
          `出路①：改传本地化窗口名（界面语言可能判定不准）—— 试 \`--window-name ${candidate}\``
          + '（中文界面下 Game/Scene/Console/Hierarchy/Project/Inspector 分别是 游戏/场景/控制台/层级/项目/检查器）',
        );
      } else if (mapped) {
        hint.push(`已试过本地化名 \`${tried}\`：窗口可能没打开，或该窗口标题不在映射表内`
          + '（可试 `--match-mode contains`，或用裸 uloop 枚举真实标题）');
      } else {
        hint.push(`窗口名 \`${tried}\` 未找到：窗口可能没打开，或该标题不在映射表内`
          + '（可试 `--match-mode contains`，或用裸 uloop 枚举真实标题）');
      }
      if (isZh(lang) && String(lang).toLowerCase() !== 'zh_cn') {
        hint.push(`界面语言 ${lang} 不是实测过的 zh_CN：静态映射表是简体标题（实测来源 zh_CN），`
          + `${lang} 下标题可能是繁体或其它写法 —— 用裸 uloop 枚举真实标题更稳`);
      }
      // 官方-2：双引擎共存 / 官方版英文界面 —— 给「传英文原名」这条可操作出路。
      // （不一定与「改传本地化名」同向：语言判定可能来自团结 Hub，而官方版标题是英文。）
      const englishName = Object.hasOwn(ZH, windowName) ? windowName : (EN[tried] || null);
      if (englishName !== null && englishName !== tried) {
        hint.push(`出路①-b（**官方版英文界面 / 双引擎共存**，PITFALLS 官方-2）：改传**英文原名** —— `
          + `\`unity shot --window-name ${englishName}\`。本机若同时装了团结，界面语言判定可能来自团结 Hub`
          + `（\`%APPDATA%\\TuanjieHub\`），而 Unity 官方版（\`Unity.exe\`）的窗口标题其实是英文`
          + '（本命令已自动试过这个英文名；它也没命中说明窗口确实没打开）');
      }
      if (retriedWith !== null) {
        hint.push(`已自动用另一种形态重试一次：\`--window-name ${retriedWith}\``
          + (retryFailure ? `（同样失败：${retryFailure}）` : ''));
      }
      // R204：这两个开关**已在 M2 接线**（本任务）——出路必须给出 `unity shot` 自己的写法，
      // 不得再声称「未接线 / 需裸 uloop」：旧措辞会让 agent 绕过 CLI 去调裸 uloop，而 T12 的盲测
      // 判据 2 禁止裸 uloop（且要求 `shot --capture-mode rendering`）。
      hint.push('出路②：进入 PlayMode 后重拍 —— 用 `unity shot --capture-mode rendering`（已接线；'
        + '`--capture-mode auto` 在 PlayMode 下也解析为 rendering，此时窗口名被忽略。上游 SKILL.md:24）');
      hint.push('出路③：用 `unity shot --match-mode contains|prefix` 做片段匹配（已接线；上游真实旋钮，SKILL.md:23）');
      return fail({
        code: 'WINDOW_NAME_LOCALIZED',
        message: envl.message,
        // R110⑥：不再额外塞 upstreamMessage（与 message 逐字重复）
        actual: { windowName: tried, language: lang, substituted: mapped, retriedWith },
        // R111⑤：上游 NextActions 必须接着抬起 —— 平铺失败（R108）里它是唯一可靠的提示，
        // 本地化分支自己重写 hint 时把它丢掉等于「吞上游字段」，与 R105 相反。
        hint: [...hint, ...envl.hint],
      });
    }
    return envl;
  }

  const picked = pickScreenshot(r.json);
  if (!picked) {
    return fail({
      code: 'NO_SCREENSHOT',
      message: 'screenshot 未返回图像路径',
      actual: r.json,
      hint: ['确认目标窗口已打开；`--elements-only` 不产图（ImagePath 为空）'],
    });
  }
  const s = Array.isArray(r.json.Screenshots) ? r.json.Screenshots[0] : null;
  const hint = [];
  if (retriedFrom !== null) {
    hint.push(`窗口名 \`${retriedFrom}\` 未命中（界面语言判定为 ${lang}），改用 \`${retriedWith}\` 后成功 —— `
      + '当前编辑器的界面语言与 Hub 配置不一致（双引擎共存时常见，PITFALLS 官方-2）');
  }
  if (r.json.TimedOut === true) {
    hint.push('上游报告 TimedOut:true —— 这次截图可能没有拿到新帧；先用 `uloop control-play-mode --action Step`（或 `unity play step`）步进一帧再重拍');
  }
  const warning = r.json.Warning;
  if (typeof warning === 'string' && warning !== '') {
    hint.push(`上游警告：${warning}`);
    hint.push('若画面是暂停前的旧帧，用 `uloop control-play-mode --action Step` 步进一帧后重拍');
  }
  return ok({
    ...picked,
    captureMode: r.json.ResolvedCaptureMode ?? null,
    // 官方-2：`windowName` = 真正产出这张图的名字（重试命中时是替代名）；
    // `retriedFrom` 为 additive 字段，仅在自动重试命中时非 null。
    windowName: retriedFrom === null ? tried : retriedWith,
    retriedFrom,
    screenshotCount: typeof r.json.ScreenshotCount === 'number' ? r.json.ScreenshotCount : null,
    fileSizeBytes: typeof s.FileSizeBytes === 'number' ? s.FileSizeBytes : null,
    resolutionScale: typeof s.ResolutionScale === 'number' ? s.ResolutionScale : null,
    imageCoordinateSystem: s.ImageCoordinateSystem ?? null,
    imageToInputOffsetY: typeof s.ImageToInputOffsetY === 'number' ? s.ImageToInputOffsetY : null,
    gameViewWidth: typeof s.GameViewWidth === 'number' ? s.GameViewWidth : null,
    gameViewHeight: typeof s.GameViewHeight === 'number' ? s.GameViewHeight : null,
    screenshotToInputFormula: s.ScreenshotToInputFormula ?? null,
    unityInputFormula: s.UnityInputFormula ?? null,
    annotatedElementCount: Array.isArray(s.AnnotatedElements) ? s.AnnotatedElements.length : null,
    timedOut: r.json.TimedOut === true,
  }, { hint });
}

module.exports = {
  shot, windowNameFor, alternateWindowName, isLocalizedMiss, pickScreenshot,
  validateCaptureMode, validateMatchMode, CAPTURE_MODES, MATCH_MODES,
};
