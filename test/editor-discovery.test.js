'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discover, language, languageInfo, hubRoot } = require('../lib/editor-discovery.js');

/** 造一个假 Hub 目录结构 */
function makeHub({ secondary, hubExe } = {}) {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-'));
  const hub = path.join(appData, 'TuanjieHub');
  fs.mkdirSync(hub, { recursive: true });
  if (secondary) fs.writeFileSync(path.join(hub, 'secondaryInstallPath.json'), JSON.stringify(secondary));
  if (hubExe) fs.writeFileSync(path.join(hub, 'hubInfo.json'), JSON.stringify({ executablePath: hubExe }));
  fs.writeFileSync(path.join(hub, 'languageConfig.json'), JSON.stringify({ language: 'zh_CN' }));
  return { appData, hub };
}

/** 在 root 下造 <ver>/Editor/<exeName> */
function makeEditor(root, ver, exeName) {
  const dir = path.join(root, ver, 'Editor');
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, exeName);
  fs.writeFileSync(exe, '');
  return exe;
}

test('从 secondaryInstallPath.json 发现编辑器（实测的真实形态）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piuinst-'));
  const exe = makeEditor(root, '2022.3.62t9', 'Tuanjie.exe');
  const { appData } = makeHub({ secondary: root });
  const found = discover({ appData, env: {} });
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].path, exe);
  assert.strictEqual(found[0].version, '2022.3.62t9');
  assert.strictEqual(found[0].source, 'tuanjiehub:secondaryInstallPath');
});

test('secondaryInstallPath.json 是裸 JSON 字符串也能解析', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piuinst-'));
  makeEditor(root, '2022.3.62t9', 'Tuanjie.exe');
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-'));
  const hub = path.join(appData, 'TuanjieHub');
  fs.mkdirSync(hub, { recursive: true });
  // 裸字符串（不带引号包裹的对象），与实测一致
  fs.writeFileSync(path.join(hub, 'secondaryInstallPath.json'), JSON.stringify(root));
  const found = discover({ appData, env: {} });
  assert.strictEqual(found.length, 1);
});

test('env override 优先且排在第一位', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piuinst-'));
  makeEditor(root, '2022.3.62t9', 'Tuanjie.exe');
  const { appData } = makeHub({ secondary: root });
  const manual = path.join(root, 'manual', 'Editor', 'Tuanjie.exe');
  fs.mkdirSync(path.dirname(manual), { recursive: true });
  fs.writeFileSync(manual, '');
  const found = discover({ appData, env: { PI_UNITY_EDITOR_BIN: manual } });
  assert.strictEqual(found[0].path, manual);
  assert.strictEqual(found[0].source, 'env:PI_UNITY_EDITOR_BIN');
});

test('从 hubInfo.json 的 executablePath 推 Hub 目录', () => {
  const hubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhubdir-'));
  const exe = makeEditor(path.join(hubDir, 'Editor'), '2022.3.62t9', 'Tuanjie.exe');
  const { appData } = makeHub({ hubExe: path.join(hubDir, 'Tuanjie Hub.exe') });
  const found = discover({ appData, env: {} });
  assert.ok(found.some((f) => f.path === exe && f.source === 'tuanjiehub:hubInfo'));
});

test('同时认 Tuanjie.exe 与 Unity.exe', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piuinst-'));
  const t = makeEditor(root, '2022.3.62t9', 'Tuanjie.exe');
  const u = makeEditor(root, '2022.3.62t9', 'Unity.exe');
  const { appData } = makeHub({ secondary: root });
  const paths = discover({ appData, env: {} }).map((f) => f.path);
  assert.ok(paths.includes(t) && paths.includes(u));
});

test('找不到任何编辑器时返回空数组（不抛异常）', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-'));
  assert.deepStrictEqual(discover({ appData, env: {}, programFiles: [] }), []);
});

test('跨来源命中同一路径时去重，保留优先级最高的来源', () => {
  const hubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhubdir-'));
  const installRoot = path.join(hubDir, 'Editor');
  const exe = makeEditor(installRoot, '2022.3.62t9', 'Tuanjie.exe');
  const { appData } = makeHub({ secondary: installRoot, hubExe: path.join(hubDir, 'Tuanjie Hub.exe') });
  const found = discover({ appData, env: {} });
  assert.strictEqual(found.filter((f) => f.path === exe).length, 1);
  assert.strictEqual(found.find((f) => f.path === exe).source, 'tuanjiehub:secondaryInstallPath');
});

test('第 4 层：Program Files 下的 Unity Hub 默认路径', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'piuprogfiles-'));
  const exe = makeEditor(path.join(base, 'Unity', 'Hub', 'Editor'), '2022.3.62t9', 'Unity.exe');
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-'));
  const found = discover({ appData, env: {}, programFiles: [base] });
  assert.ok(found.some((f) => f.path === exe && f.source === 'unity:hub-default'));
});

test('language 读 languageConfig.json，缺省回落 en_US', () => {
  const { appData } = makeHub({});
  assert.strictEqual(language({ appData }), 'zh_CN');
  assert.strictEqual(language({ appData: fs.mkdtempSync(path.join(os.tmpdir(), 'empty-')) }), 'en_US');
});

// ───────────── 多 Hub 语言探测（官方版机器没有 TuanjieHub 目录；PITFALLS 官方-2/官方-3） ─────────────

/** 只造 Hub 目录（不造编辑器），用于语言探测。 */
function makeHubDirs(appData, hubs) {
  for (const [dir, lang] of Object.entries(hubs)) {
    const hub = path.join(appData, dir);
    fs.mkdirSync(hub, { recursive: true });
    if (lang !== null) fs.writeFileSync(path.join(hub, 'languageConfig.json'), JSON.stringify({ language: lang }));
  }
}

test('language 多 Hub：只装官方版（无 TuanjieHub）时读 UnityHub 的 languageConfig.json', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-'));
  makeHubDirs(appData, { UnityHub: 'zh_CN' });
  assert.strictEqual(language({ appData }), 'zh_CN', '有 TuanjieHub 之外的语言源时必须用它，不再一律回落 en_US');
});

test('language 多 Hub：两个 Hub 都有配置 → TuanjieHub 优先（探测顺序 = 既有行为）', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-'));
  makeHubDirs(appData, { TuanjieHub: 'zh_CN', UnityHub: 'ja_JP' });
  assert.strictEqual(language({ appData }), 'zh_CN');
});

test('language 多 Hub：TuanjieHub 目录在但没有 languageConfig.json → 落到 UnityHub', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-'));
  makeHubDirs(appData, { TuanjieHub: null, UnityHub: 'zh_TW' });
  assert.strictEqual(language({ appData }), 'zh_TW');
});

test('language 多 Hub：两个 Hub 都读不到 → 回落 en_US（既有行为不变）', () => {
  const both = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-'));
  makeHubDirs(both, { TuanjieHub: null, UnityHub: null });
  assert.strictEqual(language({ appData: both }), 'en_US');
  assert.strictEqual(language({ appData: fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-')) }), 'en_US');
});

test('languageInfo 报出真正给出语言的 Hub 目录（doctor 的 editor-language 证据必须属实）', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-'));
  makeHubDirs(appData, { UnityHub: 'ja_JP' });
  const info = languageInfo({ appData });
  assert.strictEqual(info.language, 'ja_JP');
  assert.strictEqual(info.hub, path.join(appData, 'UnityHub'));
  // 都读不到 → hub 为 null（调用方不得谎称来自某个 Hub）
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-'));
  assert.deepStrictEqual(languageInfo({ appData: empty }), { language: 'en_US', hub: null });
});
