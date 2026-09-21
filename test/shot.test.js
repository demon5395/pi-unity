'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../bin/unity.js');
const { shot, windowNameFor, isLocalizedMiss, pickScreenshot } = require('../lib/shot.js');
const { exitCodeFor } = require('../lib/envelope.js');
// R207：captureStdout 已抽到 test/helpers/capture.js（三个测试文件共用一份）。
const { captureStdout } = require('./helpers/capture.js');

// R110⑤：本文件造的临时目录（语言注入 / 假 dispatcher）全部登记，跑完统一删。
const TEMP_DIRS = [];
after(() => {
  for (const d of TEMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

// ───────────────────────── 简报 5 条（纯函数，逐字保留） ─────────────────────────

test('窗口名按语言映射（实测 zh_CN 的 Game 是「游戏」）', () => {
  assert.strictEqual(windowNameFor('Game', 'zh_CN'), '游戏');
  assert.strictEqual(windowNameFor('Scene', 'zh_CN'), '场景');
  assert.strictEqual(windowNameFor('Game', 'en_US'), 'Game');
});

test('未知语言回落到英文原名', () => {
  assert.strictEqual(windowNameFor('Game', 'ja_JP'), 'Game');
});

test('识别本地化导致的窗口找不到（U7）', () => {
  assert.strictEqual(isLocalizedMiss("Window 'Game' not found (MatchMode: exact)"), true);
  assert.strictEqual(isLocalizedMiss('Some other error'), false);
});

test('pickScreenshot 从结果里取第一张图路径', () => {
  const j = { Success: true, Screenshots: [{ ImagePath: 'C:/a.png', Width: 100, Height: 50 }] };
  assert.deepStrictEqual(pickScreenshot(j), { path: 'C:/a.png', width: 100, height: 50 });
});

test('pickScreenshot 无图时返回 null', () => {
  assert.strictEqual(pickScreenshot({ Success: true, Screenshots: [] }), null);
});

// ───────────────────── U7 的两种报文都要识别（R102） ─────────────────────

test('isLocalizedMiss 识别 Game 窗口的报文（Neither … nor … window found，R102）', () => {
  // U7 实录：Game 走的不是「Window 'X' not found」那条分支
  assert.strictEqual(
    isLocalizedMiss('Neither Game nor Simulator window found; open the Game view and retry'),
    true,
  );
});

test('isLocalizedMiss 识别其余窗口的报文（Window \'X\' not found，R102）', () => {
  for (const name of ['Scene', 'Console', 'Inspector', 'Project', 'Hierarchy']) {
    assert.strictEqual(isLocalizedMiss(`Window '${name}' not found (MatchMode: exact)`), true, name);
  }
  // 非字符串 / 无关键片段一律 false（不得误报为本地化失配）
  for (const msg of [undefined, null, 42, {}, '', 'NOT_FOUND', 'Game view and retry']) {
    assert.strictEqual(isLocalizedMiss(msg), false, String(msg));
  }
});

// ───────────────────────── shot() 命令路径（R98 R99 R100 R103 R105） ─────────────────────────

/** 构造只回放固定 json 的 `_call` 假实现（绝不 spawn 真实进程）。 */
function fakeCall(json, spy = []) {
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

/** 造一个「界面语言 = lang」的 appData 目录（language() 读 <appData>/TuanjieHub/languageConfig.json）。 */
function langAppData(lang) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-lang-'));
  TEMP_DIRS.push(dir);
  fs.mkdirSync(path.join(dir, 'TuanjieHub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'TuanjieHub', 'languageConfig.json'), JSON.stringify({ language: lang }));
  return dir;
}

/** 造一个「界面语言 = zh_CN」的 appData 目录。 */
function zhAppData() {
  return langAppData('zh_CN');
}

/** 造一个「没有语言配置」的 appData 目录（language() 回落 en_US）。 */
function enAppData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-lang-'));
  TEMP_DIRS.push(dir);
  return dir;
}

const OK_JSON = {
  Success: true,
  ScreenshotCount: 1,
  ResolvedCaptureMode: 'window',
  Screenshots: [{ ImagePath: 'C:/shots/游戏_1.png', Width: 892, Height: 355, FileSizeBytes: 1234 }],
};

test('shot 成功：ok / verified 为 null / actual.path / 参数拼装（R66 R98①⑤ R105）', async () => {
  const spy = [];
  const e = await shot({
    projectPath: 'X', outDir: 'C:/shots', appData: zhAppData(), _call: fakeCall(OK_JSON, spy),
  });
  assert.strictEqual(spy.length, 1);
  assert.strictEqual(spy[0].tool, 'screenshot');
  // --out 与本地化窗口名确实出现在 argv 里（R98⑤）
  assert.deepStrictEqual(spy[0].args, ['--output-directory', 'C:/shots', '--window-name', '游戏']);
  // R99：不传 --capture-mode（uloop 默认 auto 在 PlayMode 下解析为 rendering）
  assert.ok(!spy[0].args.includes('--capture-mode'));
  assert.strictEqual(spy[0].opts.projectPath, 'X');
  // R66：读命令没有 intent 可比对，绝不虚报 verified:true
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, null);
  assert.strictEqual(e.actual.path, 'C:/shots/游戏_1.png');
  assert.strictEqual(e.actual.width, 892);
  assert.strictEqual(e.actual.height, 355);
  // R105：ResolvedCaptureMode 是 additive 字段
  assert.strictEqual(e.actual.captureMode, 'window');
  assert.deepStrictEqual(e.hint, []);
});

test('shot 不传 outDir 时只发 --window-name；en_US 用英文原名（R100）', async () => {
  const spy = [];
  const e = await shot({ projectPath: 'X', appData: enAppData(), _call: fakeCall(OK_JSON, spy) });
  assert.deepStrictEqual(spy[0].args, ['--window-name', 'Game']);
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.actual.captureMode, 'window');
});

test('shot 中文环境下 --window-name 被映射成「场景」（R100 注入 appData）', async () => {
  const spy = [];
  await shot({ projectPath: 'X', windowName: 'Scene', appData: zhAppData(), _call: fakeCall(OK_JSON, spy) });
  assert.deepStrictEqual(spy[0].args, ['--window-name', '场景']);
});

test('shot 识别 U7 的两种本地化失配报文并给出三条出路（R102 R103）', async () => {
  const messages = [
    'Neither Game nor Simulator window found; open the Game view and retry',
    "Window 'Scene' not found (MatchMode: exact)",
  ];
  for (const msg of messages) {
    const e = await shot({
      projectPath: 'X',
      appData: zhAppData(),
      _call: fakeCall({ Success: false, Error: { ErrorCode: 'WINDOW_NOT_FOUND', Message: msg, Phase: 'execution',
        NextActions: ['Open the requested Unity window, then retry the screenshot.'] } }),
    });
    assert.strictEqual(e.ok, false, msg);
    assert.strictEqual(e.code, 'WINDOW_NAME_LOCALIZED', msg);
    assert.strictEqual(e.verified, false, msg);
    assert.strictEqual(e.message, msg, '上游报文不得丢失');
    // 报出当前语言与已尝试的名字（出路①的前提）
    assert.strictEqual(e.actual.language, 'zh_CN');
    assert.strictEqual(e.actual.windowName, '游戏');
    const hint = e.hint.join('\n');
    assert.match(hint, /zh_CN/);
    assert.match(hint, /游戏/);
    assert.match(hint, /--window-name/, '出路①：传本地化名');
    assert.match(hint, /PlayMode/, '出路②：进 PlayMode（auto → rendering 忽略窗口名）');
    assert.match(hint, /--match-mode/, '出路③：contains|prefix 片段匹配');
    assert.match(hint, /Open the requested Unity window, then retry the screenshot\./, 'R111⑤：上游 NextActions 不得被吞');
  }
});

test('shot 识别上游**平铺**报文（真机实测形状：Success:false + 顶层 Message，R102）', async () => {
  // 2026-09-19 真机实测：uloop 3.5.1 的 screenshot 失败无 Error 子对象，Message/NextActions 在顶层
  for (const [windowName, message] of [
    ['Game', 'Neither Game nor Simulator window found; open the Game view or Device Simulator and retry'],
    ['Scene', "Window 'Scene' not found (MatchMode: exact)"],
  ]) {
    const flat = {
      Screenshots: [], TimedOut: false, ScreenshotCount: 0, ResolvedCaptureMode: 'window',
      Message: message,
      NextActions: ['Open the requested Unity window, then retry the screenshot.'],
      Success: false,
    };
    const e = await shot({ projectPath: 'X', windowName, appData: zhAppData(), _call: fakeCall(flat) });
    assert.strictEqual(e.ok, false, windowName);
    assert.strictEqual(e.code, 'WINDOW_NAME_LOCALIZED', windowName);
    assert.strictEqual(e.message, message, '平铺 Message 不得丢失');
    const hint = e.hint.join('\n');
    assert.match(hint, /--match-mode/);
    // R111⑤：平铺失败时 NextActions 是上游唯一可靠抬起的提示 —— 本地化分支不得把它丢掉
    assert.match(hint, /Open the requested Unity window, then retry the screenshot\./);
  }
});

test('shot 非本地化的 uloop 失败原样透传（R98④）', async () => {
  const e = await shot({
    projectPath: 'X',
    _call: fakeCall({
      Success: false,
      Error: { ErrorCode: 'UNITY_NOT_REACHABLE', Message: 'not reachable', NextActions: ['先启动编辑器'] },
    }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'UNITY_NOT_REACHABLE');
  assert.strictEqual(e.message, 'not reachable');
  assert.match(e.hint.join(' '), /先启动编辑器/);
});

test('shot 遇非 uloop 信封（Success 缺失）→ ULOOP_BAD_PAYLOAD，不装成成功', async () => {
  const e = await shot({ projectPath: 'X', appData: enAppData(), _call: fakeCall({ Screenshots: [] }) });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_BAD_PAYLOAD');
});

test('shot 无图（Screenshots 空 / ImagePath 为空）→ NO_SCREENSHOT（R98③）', async () => {
  for (const json of [
    { Success: true, ScreenshotCount: 0, Screenshots: [] },
    { Success: true, Screenshots: [{ ImagePath: '', Width: 0, Height: 0 }] },
    { Success: true },
  ]) {
    const e = await shot({ projectPath: 'X', appData: enAppData(), _call: fakeCall(json) });
    assert.strictEqual(e.ok, false, JSON.stringify(json));
    assert.strictEqual(e.code, 'NO_SCREENSHOT');
    assert.strictEqual(e.verified, false);
    assert.deepStrictEqual(e.actual, json);
    assert.ok(e.hint.length > 0);
  }
});

test('shot 把上游 Warning 写进 hint（PlayMode 暂停可能是旧帧，R105）', async () => {
  const e = await shot({
    projectPath: 'X',
    appData: enAppData(),
    _call: fakeCall({ ...OK_JSON, Warning: 'Play Mode is paused; the image may show the previous frame' }),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.actual.captureMode, 'window');
  assert.match(e.hint.join('\n'), /Play Mode is paused/);
  assert.match(e.hint.join('\n'), /Step/, '给出刷新旧帧的手段');
});

// ───────────────────────── CLI（R97：--json 真的控制输出） ─────────────────────────

/** 临时覆盖环境变量（如 APPDATA → 语言探测目录）。 */
async function withEnv(overrides, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** 用假 dispatcher（PI_UNITY_ULOOP_CMD）跑 fn，结束后恢复环境变量。 */
async function withScriptedDispatcher(scriptBody, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-shot-'));
  TEMP_DIRS.push(dir);
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

test('CLI shot --json：退出码 0、信封可解析、--out 与本地化窗口名到达 uloop（R97 R98⑤）', async () => {
  const body = `
    const a = process.argv.join(' ');
    const good = a.includes('--output-directory C:/shots')
      && a.includes('--window-name 游戏')
      && !a.includes('--capture-mode');
    const out = good
      ? ${JSON.stringify(OK_JSON)}
      : { Success: false, Error: { ErrorCode: 'BAD_ARGS', Message: a } };
    process.stdout.write(JSON.stringify(out) + '\\n');
  `;
  const { result, out } = await withScriptedDispatcher(body, () => withEnv({ APPDATA: zhAppData() }, () => captureStdout(
    () => main(['shot', '--project-path', 'X', '--out', 'C:/shots', '--json']),
  )));
  assert.strictEqual(result, 0);
  const e = JSON.parse(out);
  assert.strictEqual(e.ok, true);
  // R66：读命令不得虚报 verified:true
  assert.strictEqual(e.verified, null);
  assert.strictEqual(e.actual.path, 'C:/shots/游戏_1.png');
  assert.strictEqual(e.actual.captureMode, 'window');
});

test('CLI shot 默认人读、--json 才输出 JSON（R97）', async () => {
  const body = `process.stdout.write(${JSON.stringify(JSON.stringify(OK_JSON))} + '\\n');\n`;
  const human = await withScriptedDispatcher(body, () => withEnv({ APPDATA: zhAppData() }, () => captureStdout(
    () => main(['shot', '--project-path', 'X']),
  )));
  assert.strictEqual(human.result, 0);
  assert.match(human.out, /^\[OK\] /);
  assert.throws(() => JSON.parse(human.out), '人读输出不得是 JSON');

  const machine = await withScriptedDispatcher(body, () => withEnv({ APPDATA: zhAppData() }, () => captureStdout(
    () => main(['shot', '--project-path', 'X', '--json']),
  )));
  assert.strictEqual(machine.result, 0);
  assert.strictEqual(JSON.parse(machine.out).actual.path, 'C:/shots/游戏_1.png');
});

// ───────── R107：裸写开关是**用法错**，不得伪装成环境/本地化错 ─────────

test('shot 裸写 --window-name / --out → BAD_WINDOW_NAME / BAD_OUT_DIR，且一次都不调 uloop（R107）', async () => {
  // 裸写 → parseArgs 给布尔 true；上游会报 Window 'true' not found（看不出来是用法错）
  for (const bad of [true, 1, {}, [], '']) {
    const spy = [];
    const e = await shot({ projectPath: 'X', appData: enAppData(), windowName: bad, _call: fakeCall(OK_JSON, spy) });
    assert.strictEqual(e.ok, false, `windowName=${JSON.stringify(bad)}`);
    assert.strictEqual(e.code, 'BAD_WINDOW_NAME');
    assert.strictEqual(e.verified, false);
    assert.strictEqual(e.actual.windowName, bad);
    assert.notStrictEqual(e.code, 'WINDOW_NAME_LOCALIZED', '用法错不得被诊断成本地化错');
    assert.ok(e.hint.length > 0);
    assert.strictEqual(spy.length, 0, '用法错误必须挡在 uloop 调用之前');
  }
  // 裸写 --out → --output-directory true：上游会在项目根造一个名为 true 的目录（且报 ok:true）
  for (const bad of [true, 1, {}, [], '']) {
    const spy = [];
    const e = await shot({ projectPath: 'X', appData: enAppData(), outDir: bad, _call: fakeCall(OK_JSON, spy) });
    assert.strictEqual(e.ok, false, `outDir=${JSON.stringify(bad)}`);
    assert.strictEqual(e.code, 'BAD_OUT_DIR');
    assert.strictEqual(e.actual.outDir, bad);
    assert.ok(e.hint.length > 0);
    assert.strictEqual(spy.length, 0, '用法错误必须挡在 uloop 调用之前');
  }
});

test('CLI shot 裸写 --window-name → 退出码 2 且 code=BAD_WINDOW_NAME（R107；M2 任务 2 起用法错=2）', async () => {
  const body = `process.stdout.write(${JSON.stringify(JSON.stringify(OK_JSON))} + '\\n');\n`;
  const { result, out } = await withScriptedDispatcher(body, () => withEnv({ APPDATA: zhAppData() }, () => captureStdout(
    () => main(['shot', '--project-path', 'X', '--window-name', '--json']),
  )));
  assert.strictEqual(result, 2);
  const e = JSON.parse(out);
  assert.strictEqual(e.code, 'BAD_WINDOW_NAME');
});

test('CLI shot 裸写 --out → 退出码 2 且 code=BAD_OUT_DIR（R107；M2 任务 2 起用法错=2）', async () => {
  const body = `process.stdout.write(${JSON.stringify(JSON.stringify(OK_JSON))} + '\\n');\n`;
  const { result, out } = await withScriptedDispatcher(body, () => withEnv({ APPDATA: zhAppData() }, () => captureStdout(
    () => main(['shot', '--project-path', 'X', '--out', '--json']),
  )));
  assert.strictEqual(result, 2);
  const e = JSON.parse(out);
  assert.strictEqual(e.code, 'BAD_OUT_DIR');
});

// ───────── R109：hint 必须有证据感（不再建议「已经试过的那个名字」） ─────────

test('shot 已做过映射替换仍 not found → 出「已试过本地化名」，不再建议同一个名字（R109）', async () => {
  const e = await shot({
    projectPath: 'X', appData: zhAppData(), windowName: 'Game',
    _call: fakeCall({ Success: false, Message: "Window '游戏' not found (MatchMode: exact)" }),
  });
  assert.strictEqual(e.code, 'WINDOW_NAME_LOCALIZED');
  const hint = e.hint.join('\n');
  assert.match(hint, /已试过本地化名/);
  assert.match(hint, /游戏/);
  // 建议的名字必须不是已经试过的那个
  assert.ok(!/改传本地化窗口名[^\n]*--window-name 游戏/.test(hint), '不得再建议已经试过的「游戏」');
  assert.match(hint, /--match-mode/);
  assert.strictEqual(e.actual.substituted, true, 'additive：暴露是否做过映射替换');
});

test('shot 用户已直接传本地化名仍 not found → 也不建议同一个名字（R109）', async () => {
  const e = await shot({
    projectPath: 'X', appData: zhAppData(), windowName: '游戏',
    _call: fakeCall({ Success: false, Message: "Window '游戏' not found (MatchMode: exact)" }),
  });
  assert.strictEqual(e.code, 'WINDOW_NAME_LOCALIZED');
  const hint = e.hint.join('\n');
  assert.ok(!/改传本地化窗口名/.test(hint), '已经传了本地化名，不得再建议改传本地化名');
  assert.match(hint, /不在映射表内|没打开/);
  assert.strictEqual(e.actual.substituted, false);
});

test('shot 笔误窗口名 → 证据 hint（窗口没打开 / 不在映射表内）而非空泛建议（R109）', async () => {
  const e = await shot({
    projectPath: 'X', appData: zhAppData(), windowName: 'Gam',
    _call: fakeCall({ Success: false, Message: "Window 'Gam' not found (MatchMode: exact)" }),
  });
  assert.strictEqual(e.code, 'WINDOW_NAME_LOCALIZED');
  const hint = e.hint.join('\n');
  assert.match(hint, /不在映射表内/);
  assert.strictEqual(e.actual.substituted, false);
});

test('shot 语言判定为英文但存在可映射的本地化候选 → 建议改传本地化名（R109）', async () => {
  const e = await shot({
    projectPath: 'X', appData: enAppData(), windowName: 'Scene',
    _call: fakeCall({ Success: false, Message: "Window 'Scene' not found (MatchMode: exact)" }),
  });
  assert.strictEqual(e.code, 'WINDOW_NAME_LOCALIZED');
  const hint = e.hint.join('\n');
  assert.match(hint, /改传本地化窗口名/);
  assert.match(hint, /--window-name 场景/);
  assert.strictEqual(e.actual.substituted, false);
});

test('WINDOW_NAME_LOCALIZED 不再重复暴露 upstreamMessage（与 message 重复，R110⑥）', async () => {
  const msg = "Window 'Scene' not found (MatchMode: exact)";
  const e = await shot({ projectPath: 'X', appData: zhAppData(), windowName: 'Scene', _call: fakeCall({ Success: false, Message: msg }) });
  assert.strictEqual(e.message, msg);
  assert.strictEqual(e.actual.upstreamMessage, undefined, 'upstreamMessage 与 message 重复，已删');
});

// ───────── R110①② + R204③：三条出路必须给出**可用写法**（不得再声称「未接线 / 需裸 uloop」），语言判定放宽到 zh* ─────────

// R204③：接线后出路仍要在，但不再声称「未接线 / 需裸 uloop」——而是给出可用的 unity shot 写法。
test('shot 的 hint 给出 --capture-mode / --match-mode 的**已接线**出路（R110① / M2 接线后）', async () => {
  const e = await shot({
    projectPath: 'X', appData: zhAppData(), windowName: 'Game',
    _call: fakeCall({ Success: false, Message: "Window '游戏' not found (MatchMode: exact)" }),
  });
  const captureHints = e.hint.filter((h) => /capture-mode/.test(h));
  const matchHints = e.hint.filter((h) => /--match-mode/.test(h));
  assert.ok(captureHints.length > 0, '仍有 PlayMode（capture-mode）出路');
  assert.ok(matchHints.length > 0, '仍有 match-mode 出路');
  // 接线后：出路必须教用户用 `unity shot` 自己的开关（M2 起可用），不得再叫用户去裸 uloop
  assert.ok(captureHints.some((h) => /unity shot/.test(h) && /--capture-mode/.test(h)), '②必须给出已接线的 unity shot 写法');
  assert.ok(matchHints.some((h) => /unity shot/.test(h) && /--match-mode/.test(h)), '③必须给出已接线的 unity shot 写法');
  assert.ok(!captureHints.some((h) => /未接线|需\*\*裸 uloop\*\*/.test(h)), '②不得再声称未接线');
  assert.ok(!matchHints.some((h) => /未接线|需\*\*裸 uloop\*\*/.test(h)), '③不得再声称未接线');
});

test('ZH 表逐项有真机出处：Inspector 的中文标题是「检查器」（R101 补实测）', () => {
  // 2026-09-19 真机枚举（Resources.FindObjectsOfTypeAll<EditorWindow>）：
  // SceneView=>场景 / ConsoleWindow=>控制台 / GameView=>游戏 /
  // SceneHierarchyWindow=>层级 / ProjectBrowser=>项目 / **InspectorWindow=>检查器**
  // 旧表写「属性」是错的（当时标「未实测」）；真机 `--window-name 检查器` 截图成功（276x926）。
  assert.strictEqual(windowNameFor('Inspector', 'zh_CN'), '检查器');
  assert.strictEqual(windowNameFor('Console', 'zh_CN'), '控制台');
  assert.strictEqual(windowNameFor('Hierarchy', 'zh_CN'), '层级');
  assert.strictEqual(windowNameFor('Project', 'zh_CN'), '项目');
});

test('windowNameFor 对中文变体一律映射（zh_TW / zh-Hans / 大小写，R110②）', () => {
  for (const lang of ['zh_TW', 'zh-Hans', 'zh_Hans', 'ZH_cn', 'zh']) {
    assert.strictEqual(windowNameFor('Game', lang), '游戏', lang);
    assert.strictEqual(windowNameFor('Scene', lang), '场景', lang);
  }
  assert.strictEqual(windowNameFor('Game', 'en_US'), 'Game');
});

test('shot 非 zh_CN 的中文变体给出「映射表可能不适用」的不同提示（R110②）', async () => {
  const e = await shot({
    projectPath: 'X', appData: langAppData('zh_TW'), windowName: 'Game',
    _call: fakeCall({ Success: false, Message: "Window '游戏' not found (MatchMode: exact)" }),
  });
  assert.strictEqual(e.code, 'WINDOW_NAME_LOCALIZED');
  assert.strictEqual(e.actual.language, 'zh_TW');
  assert.strictEqual(e.actual.windowName, '游戏');
  const hint = e.hint.join('\n');
  assert.match(hint, /zh_TW/);
  assert.match(hint, /zh_CN/, '说明静态表只实测过 zh_CN');
});

test('CLI shot 本地化失配 → 退出码 1 且 code=WINDOW_NAME_LOCALIZED（R102）', async () => {
  const msg = 'Neither Game nor Simulator window found; open the Game view and retry';
  const payload = { Success: false, Error: { ErrorCode: 'WINDOW_NOT_FOUND', Message: msg } };
  const body = `process.stdout.write(${JSON.stringify(JSON.stringify(payload))} + '\\n');\n`;
  const { result, out } = await withScriptedDispatcher(body, () => withEnv({ APPDATA: zhAppData() }, () => captureStdout(
    () => main(['shot', '--project-path', 'X', '--json']),
  )));
  assert.strictEqual(result, 1);
  const e = JSON.parse(out);
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'WINDOW_NAME_LOCALIZED');
});

// ─────────────────── M2 任务 6：--capture-mode / --match-mode / 坐标元数据 ───────────────────

const { validateCaptureMode, validateMatchMode } = require('../lib/shot.js');

test('capture/m match 枚举校验：合法值原样返回，非法返回 null', () => {
  assert.strictEqual(validateCaptureMode('auto'), 'auto');
  assert.strictEqual(validateCaptureMode('rendering'), 'rendering');
  assert.strictEqual(validateCaptureMode('GameView'), 'GameView', 'GameView 是 rendering 的别名，大小写敏感（上游枚举字面量）');
  assert.strictEqual(validateCaptureMode('bogus'), null);
  assert.strictEqual(validateCaptureMode(undefined), 'auto', '缺省即 auto');
  assert.strictEqual(validateCaptureMode(true), null, '裸写 --capture-mode 是用法错');
  assert.strictEqual(validateMatchMode('contains'), 'contains');
  assert.strictEqual(validateMatchMode('bogus'), null);
  assert.strictEqual(validateMatchMode(undefined), 'exact');
});

test('shot 把 capture/m match 传给 uloop，且只在显式给出时传（默认不传 = 保持 M1 行为）', async () => {
  const spy = [];
  const e = await shot({
    projectPath: 'X', windowName: 'Game', captureMode: 'rendering', matchMode: 'contains', appData: zhAppData(),
    _call: fakeCall({ Success: true, Screenshots: [{ ImagePath: 'C:/a.png', Width: 960, Height: 640 }] }, spy),
  });
  assert.strictEqual(e.ok, true);
  assert.deepStrictEqual(spy[0].args, ['--window-name', '游戏', '--capture-mode', 'rendering', '--match-mode', 'contains']);

  const spy2 = [];
  await shot({
    projectPath: 'X', windowName: 'Game', appData: zhAppData(),
    _call: fakeCall({ Success: true, Screenshots: [{ ImagePath: 'C:/a.png', Width: 960, Height: 640 }] }, spy2),
  });
  assert.deepStrictEqual(spy2[0].args, ['--window-name', '游戏'], 'M1 行为：不传这两个开关时 argv 必须逐字不变');
});

test('shot 拒绝枚举外取值：BAD_CAPTURE_MODE / BAD_MATCH_MODE（用法错，退出码 2），不调 uloop', async () => {
  for (const [opt, code] of [
    [{ captureMode: 'nope' }, 'BAD_CAPTURE_MODE'],
    [{ matchMode: 'nope' }, 'BAD_MATCH_MODE'],
    [{ captureMode: true }, 'BAD_CAPTURE_MODE'],
    [{ matchMode: true }, 'BAD_MATCH_MODE'],
  ]) {
    const spy = [];
    const e = await shot({ projectPath: 'X', appData: enAppData(), _call: fakeCall({ Success: true }, spy), ...opt });
    assert.strictEqual(e.code, code, `${JSON.stringify(opt)} 应落 ${code}`);
    assert.strictEqual(spy.length, 0, '用法错必须在调用之前挡下');
    assert.strictEqual(exitCodeFor(e), 2);
  }
});

test('shot 的 actual 暴露渲染坐标元数据（additive，M1 字段不变）', async () => {
  const json = {
    Success: true,
    ResolvedCaptureMode: 'rendering',
    ScreenshotCount: 1,
    TimedOut: false,
    Screenshots: [{
      ImagePath: 'C:/a.png',
      Width: 960,
      Height: 640,
      FileSizeBytes: 12345,
      ResolutionScale: 1,
      ImageCoordinateSystem: 'top-left-game-view',
      ImageToInputOffsetY: 0,
      GameViewWidth: 960,
      GameViewHeight: 640,
      ScreenshotToInputFormula: 'simulate_mouse_x = image_x / resolutionScale;',
      UnityInputFormula: 'unity_x = input_x;',
      AnnotatedElements: [{ Name: 'A' }, { Name: 'B' }],
    }],
  };
  const e = await shot({ projectPath: 'X', appData: zhAppData(), _call: fakeCall(json) });
  assert.strictEqual(e.actual.path, 'C:/a.png');
  assert.strictEqual(e.actual.width, 960);
  assert.strictEqual(e.actual.height, 640);
  assert.strictEqual(e.actual.captureMode, 'rendering');
  assert.strictEqual(e.actual.windowName, '游戏');
  assert.strictEqual(e.actual.screenshotCount, 1);
  assert.strictEqual(e.actual.fileSizeBytes, 12345);
  assert.strictEqual(e.actual.imageCoordinateSystem, 'top-left-game-view');
  assert.strictEqual(e.actual.gameViewWidth, 960);
  assert.strictEqual(e.actual.gameViewHeight, 640);
  assert.strictEqual(e.actual.imageToInputOffsetY, 0);
  assert.match(e.actual.screenshotToInputFormula, /simulate_mouse_x/);
  assert.strictEqual(e.actual.annotatedElementCount, 2);
  assert.strictEqual(e.actual.timedOut, false);
});

test('shot 顶层 TimedOut:true 且 Success:true → 加 hint（不谎称一定拿到新帧）', async () => {
  const e = await shot({
    projectPath: 'X', appData: enAppData(),
    _call: fakeCall({ Success: true, TimedOut: true, Screenshots: [{ ImagePath: 'C:/a.png', Width: 1, Height: 1 }] }),
  });
  assert.strictEqual(e.ok, true);
  assert.ok(e.hint.some((h) => /TimedOut|超时/.test(h)), `hint 必须提到超时：${JSON.stringify(e.hint)}`);
});

test('CLI shot --capture-mode bogus → 退出码 2 且 code=BAD_CAPTURE_MODE', async () => {
  const { result, out } = await captureStdout(() => main(['shot', '--project-path', 'X', '--capture-mode', 'bogus', '--json']));
  assert.strictEqual(result, 2);
  assert.strictEqual(JSON.parse(out).code, 'BAD_CAPTURE_MODE');
});

// ───────────── 官方-2：窗口名映射**双向** + 本地化失配自动重试（官方版英文界面） ─────────────
// 出处：docs/PITFALLS.md「追加：Unity 官方版验证新坑」官方-2 / docs/UNITY-OFFICIAL-VERIFICATION.md §S3。
// 场景：机器同时装了团结（%APPDATA%\TuanjieHub\languageConfig.json = zh_CN）与 Unity 官方版（英文界面）。

test('windowNameFor 双向：中文标题在英文/未知语言下映射回英文名（官方版反向映射）', () => {
  // 反向（本次新增）：官方版英文界面 + 用户/agent 传了中文标题
  assert.strictEqual(windowNameFor('游戏', 'en_US'), 'Game');
  assert.strictEqual(windowNameFor('场景', 'en_US'), 'Scene');
  assert.strictEqual(windowNameFor('检查器', 'ja_JP'), 'Inspector', '未知语言也走反向表');
  // 既有行为逐字不变（M1 断言）：zh* → 中文标题；中文语言下中文名原样；表外名字原样
  assert.strictEqual(windowNameFor('Game', 'zh_CN'), '游戏');
  assert.strictEqual(windowNameFor('Game', 'en_US'), 'Game');
  assert.strictEqual(windowNameFor('游戏', 'zh_CN'), '游戏');
  assert.strictEqual(windowNameFor('Gam', 'en_US'), 'Gam');
});

test('双引擎共存（Hub 语言 zh_CN）+ 官方英文界面：本地化失配后用英文原名自动重试并成功（官方-2）', async () => {
  const spy = [];
  // 第 1 次（游戏）失配；第 2 次（Game）命中 —— 真机形态见 PITFALLS 官方-2
  const sequentialCall = async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    const json = spy.length === 1
      ? { Success: false, Message: "Window '游戏' not found (MatchMode: exact)" }
      : {
        Success: true,
        ResolvedCaptureMode: 'window',
        ScreenshotCount: 1,
        Screenshots: [{ ImagePath: 'C:/shots/Game_1.png', Width: 800, Height: 600 }],
      };
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
  const e = await shot({ projectPath: 'X', windowName: 'Game', appData: zhAppData(), _call: sequentialCall });
  assert.strictEqual(e.ok, true, JSON.stringify(e));
  assert.strictEqual(e.verified, null, '截图是读命令');
  assert.strictEqual(e.actual.path, 'C:/shots/Game_1.png');
  // 先按语言映射成「游戏」，失配后自动改用英文原名「Game」
  assert.deepStrictEqual(spy.map((s) => s.args), [['--window-name', '游戏'], ['--window-name', 'Game']]);
  assert.strictEqual(e.actual.windowName, 'Game', 'actual.windowName = 真正命中的那个名字');
  assert.strictEqual(e.actual.retriedFrom, '游戏', 'additive：暴露重试前的名字');
  assert.ok(e.hint.some((h) => /改用|重试/.test(h)), `必须说明发生过替代重试：${JSON.stringify(e.hint)}`);
});

test('shot 本地化失配（重试也失配）→ hint 给出「官方版传英文名」的可操作出路（官方-2）', async () => {
  const e = await shot({
    projectPath: 'X', windowName: 'Game', appData: zhAppData(),
    _call: fakeCall({ Success: false, Message: "Window '游戏' not found (MatchMode: exact)" }),
  });
  assert.strictEqual(e.code, 'WINDOW_NAME_LOCALIZED');
  assert.strictEqual(e.actual.retriedWith, 'Game', '记录自动重试用过的替代名');
  const hint = e.hint.join('\n');
  assert.match(hint, /--window-name Game/, '给出「官方版传英文原名」出路');
  assert.match(hint, /官方版|双引擎/, '说明这是双引擎共存/官方版场景');
  assert.match(hint, /--capture-mode rendering/, '仍保留 PlayMode rendering 出路');
});

test('shot 非 zh 语言下传中文标题：自动反向重试（中文标题 → 英文名，双向）', async () => {
  const spy = [];
  const sequentialCall = async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    const json = spy.length === 1
      ? { Success: false, Message: "Window 'Game' not found (MatchMode: exact)" }
      : { Success: true, Screenshots: [{ ImagePath: 'C:/shots/a.png', Width: 10, Height: 10 }] };
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
  const e = await shot({ projectPath: 'X', windowName: '游戏', appData: enAppData(), _call: sequentialCall });
  assert.strictEqual(e.ok, true, JSON.stringify(e));
  assert.deepStrictEqual(spy.map((s) => s.args), [['--window-name', 'Game'], ['--window-name', '游戏']]);
  assert.strictEqual(e.actual.retriedFrom, 'Game');
});

test('笔误窗口名没有「另一种形态」→ 不做无意义的第二次调用（只有一次 uloop）', async () => {
  const spy = [];
  const e = await shot({
    projectPath: 'X', windowName: 'Gam', appData: zhAppData(),
    _call: fakeCall({ Success: false, Message: "Window 'Gam' not found (MatchMode: exact)" }, spy),
  });
  assert.strictEqual(e.code, 'WINDOW_NAME_LOCALIZED');
  assert.strictEqual(spy.length, 1, '无反向映射 → 不得重复调用');
  assert.strictEqual(e.actual.retriedWith, null);
});

// R376：重试门槛收紧 —— 只有「真的因为映射改过名字」才重试。
// 否则用户显式传的名字被语言映射成同一个名字（tried === windowName）时，
// 窗口确实没开也会白打一次 uloop（`Game` 在 en_US 下恒等映射 → 却仍会去试「游戏」）。
test('shot 显式传英文名且语言判定为英文：本地化失配也不重试（tried === windowName，R376）', async () => {
  const spy = [];
  const e = await shot({
    projectPath: 'X', windowName: 'Game', appData: enAppData(),
    _call: fakeCall({ Success: false, Message: "Window 'Game' not found (MatchMode: exact)" }, spy),
  });
  assert.strictEqual(e.code, 'WINDOW_NAME_LOCALIZED');
  assert.strictEqual(spy.length, 1, '名字未被映射改过（tried === windowName）→ 不得重试');
  assert.strictEqual(e.actual.retriedWith, null);
});

// R377：重试只看报文形状还不够 —— 非本地化失败（Screenshot failed）一律不重试。
test('shot 非本地化失败（Screenshot failed）不重试：只有一次 uloop（R377）', async () => {
  const spy = [];
  const e = await shot({
    projectPath: 'X', windowName: 'Game', appData: zhAppData(),
    _call: fakeCall({ Success: false, Message: 'Screenshot failed' }, spy),
  });
  assert.strictEqual(e.ok, false);
  assert.notStrictEqual(e.code, 'WINDOW_NAME_LOCALIZED', '非本地化报文不得归到本地化分支');
  assert.strictEqual(spy.length, 1, '报文不是 Window ... not found → 不得重试');
});
