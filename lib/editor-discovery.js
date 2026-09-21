// lib/editor-discovery.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXE_NAMES = ['Tuanjie.exe', 'Unity.exe'];

function appDataRoot(env) {
  return env.APPDATA || path.join(env.USERPROFILE || '', 'AppData', 'Roaming');
}

function hubRoot({ appData, env = process.env } = {}) {
  return path.join(appData ?? appDataRoot(env), 'TuanjieHub');
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** 扫描 <root>/<version>/Editor/(Tuanjie|Unity).exe */
function scanInstallRoot(root, source, out) {
  if (!root || !fs.existsSync(root)) return;
  let versions;
  try {
    versions = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return;
  }
  for (const v of versions) {
    for (const name of EXE_NAMES) {
      const exe = path.join(root, v.name, 'Editor', name);
      if (fs.existsSync(exe) && !out.some((f) => f.path === exe)) {
        out.push({ path: exe, version: v.name, source });
      }
    }
  }
}

/**
 * 编辑器发现（O5 决策）：env → secondaryInstallPath → hubInfo → Unity 官方默认路径。
 * 顺序即优先级；返回全部命中项；同路径去重，保留优先级最高的来源。
 */
function discover({ env = process.env, appData, programFiles } = {}) {
  const out = [];

  // 1. 环境变量覆盖
  const manual = env.PI_UNITY_EDITOR_BIN;
  if (manual && fs.existsSync(manual)) {
    out.push({ path: manual, version: 'unknown', source: 'env:PI_UNITY_EDITOR_BIN' });
  }

  const hub = hubRoot({ appData, env });

  // 2. secondaryInstallPath.json（实测内容是裸 JSON 字符串）
  const secondary = readJsonSafe(path.join(hub, 'secondaryInstallPath.json'));
  if (typeof secondary === 'string') {
    scanInstallRoot(secondary, 'tuanjiehub:secondaryInstallPath', out);
  }

  // 3. hubInfo.json → Hub 安装目录下的 Editor/
  const info = readJsonSafe(path.join(hub, 'hubInfo.json'));
  if (info && typeof info.executablePath === 'string') {
    scanInstallRoot(path.join(path.dirname(info.executablePath), 'Editor'), 'tuanjiehub:hubInfo', out);
  }

  // 4. Unity 官方默认路径（为兼容 Unity 官方版）
  const bases = programFiles ?? [env['ProgramFiles'], env['ProgramFiles(x86)']].filter(Boolean);
  for (const base of bases) {
    scanInstallRoot(path.join(base, 'Unity', 'Hub', 'Editor'), 'unity:hub-default', out);
  }

  return out;
}

/**
 * Hub 配置目录名（**按探测优先级**）。
 *
 * ⚠️ **多引擎共存**（PITFALLS「官方版验证新坑」官方-2/官方-3）：本机既有团结（`TuanjieHub`）
 * 又有 Unity 官方版（`UnityHub`）时，**两个目录都可能带 `languageConfig.json`**。
 * 旧实现只读 `TuanjieHub` ⇒ 官方版（英文界面）会被当成中文界面 → 窗口名映射反向用错。
 * 这里保留既有优先级（团结在前），同时在团结缺失/无配置时能读到官方版的。
 */
const HUB_DIRS = ['TuanjieHub', 'UnityHub'];

/**
 * 读编辑器界面语言（实测 zh_CN）。
 *
 * 依次探测 {@link HUB_DIRS} 下的 `languageConfig.json`，取**第一个能读到且带 `language` 字段**的；
 * 都读不到 → 回落 `en_US`（保持既有行为；真机实测：只有官方版、没改过语言的机器就是 `en_US`）。
 *
 * @param {{appData?: string, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {{language: string, hub: string|null}} `hub` = 真正给出语言的配置**目录**（都读不到时为 `null`，
 *   调用方不得谎称来自某个 Hub）
 */
function languageInfo({ appData, env = process.env } = {}) {
  const base = appData ?? appDataRoot(env);
  for (const dir of HUB_DIRS) {
    const hub = path.join(base, dir);
    const cfg = readJsonSafe(path.join(hub, 'languageConfig.json'));
    if (cfg && cfg.language) return { language: cfg.language, hub };
  }
  return { language: 'en_US', hub: null };
}

/** 读编辑器界面语言（只需值时的便捷入口，语义同 {@link languageInfo}）。 */
function language(opts) {
  return languageInfo(opts).language;
}

module.exports = { discover, language, languageInfo, hubRoot };
