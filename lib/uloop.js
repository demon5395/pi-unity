'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./exec.js');

/**
 * 最多尝试的 `{` 候选数。
 * 病态输入（大量 `{` 但无一能解析成功）下，每次尝试都是 O(n)，
 * 不设上限会退化成 O(n²)；设了上限最坏情况为 O(MAX_JSON_CANDIDATES · n)。
 */
const MAX_JSON_CANDIDATES = 100;

/**
 * 解析 `text[start, end)` 这片以 `{` 开头的区间。
 * 成功返回解析结果；失败返回 `undefined`（JSON.parse 不会产出 undefined，故可作失败哨兵）。
 */
function tryParseObject(text, start, end) {
  try {
    return JSON.parse(text.slice(start, end));
  } catch {
    return undefined;
  }
}

/**
 * 从 `text[start]`（必须是 `{`）开始做大括号配对，返回与之配对的 `}` 的下标。
 * 无匹配时返回 -1。
 *
 * 配对扫描尊重 JSON 词法：
 * - `"` 字符串内部的大括号不计入配对；
 * - `\` 转义后续字符，`\"` 不会提前结束字符串。
 */
function matchObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * `text[i]`（必须是 `{`）是否为「行首候选」：自上一个 `\n` 起只有空白。
 * 行首是 JSON 载荷最可能的起始位置，而噪声行里内嵌的 JSON 片段通常不是行首。
 */
function isLineStart(text, i) {
  for (let j = i - 1; j >= 0; j--) {
    const ch = text[j];
    if (ch === '\n') return true;
    if (ch !== ' ' && ch !== '\t' && ch !== '\r') return false;
  }
  return true;
}

/**
 * 尝试从 `text[i]`（必须是 `{`）处解析出一个 JSON 对象。
 * 成功返回解析结果；失败返回 `undefined`。
 */
function extractObjectAt(text, i) {
  // 快路径：JSON 一直延续到 EOF（真实 uloop 输出的常态）
  const toEof = tryParseObject(text, i, text.length);
  if (toEof !== undefined) return toEof;

  // 慢路径：JSON 之后还有噪声 —— 用字符串/转义感知的配对扫描定位结束位置
  const end = matchObjectEnd(text, i);
  if (end === -1) return undefined;
  return tryParseObject(text, i, end + 1);
}

/**
 * 从可能含噪声行的输出中提取第一个可解析的 JSON **对象**。
 * uloop 会先打印 "uloop: downloading pinned project runner ..." 之类的行，
 * 也（少数情况下）可能在 JSON 之后再补一行诊断信息。
 *
 * 算法：分两遍扫描 `{` 候选 ——
 * 1. 先只试「行首候选」（自上一个 `\n` 起只有空白）；
 * 2. 再无差别地试剩下的候选。
 * 每遍对候选先试「到 EOF」，再试「大括号配对区间」，返回第一个能 `JSON.parse`
 * 成功的候选。行首优先能避免噪声行里内嵌的 JSON 片段遮蔽后面真正的载荷
 * （静默产出错值比返回 null 更危险）；真实 uloop 输出（噪声 + 到 EOF 的 JSON）
 * 走「到 EOF」快路径，为 O(n)；尾部噪声含 `}` 时走配对路径，仍为 O(n)。
 *
 * 两遍共享同一个候选计数，总尝试次数不超过 {@link MAX_JSON_CANDIDATES}。
 *
 * 契约：**只处理顶层对象**。跳过前导空白后若以 `[` 开头（顶层数组），
 * 直接返回 null —— 不退化成「返回数组内首个对象」。uloop 实测只返回对象。
 *
 * @param {unknown} text 原始输出（stdout 或 stderr）
 * @returns {object|null} 解析出的第一个 JSON 对象；非字符串、找不到对象、
 *   顶层数组、或候选超过 {@link MAX_JSON_CANDIDATES} 时返回 null
 */
function extractJson(text) {
  if (typeof text !== 'string') return null;

  // 顶层数组不在契约内（search 未命中返回 -1，text[-1] 为 undefined，自动落入下面的扫描）
  if (text[text.search(/\S/)] === '[') return null;

  let candidates = 0;
  // 第一遍只要行首候选；没找到再第二遍退化为任意候选（保持对
  // `uloop: result: {...}` 这类非行首载荷的兼容）
  for (const lineStartOnly of [true, false]) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '{') continue;
      if (lineStartOnly && !isLineStart(text, i)) continue;
      if (++candidates > MAX_JSON_CANDIDATES) return null;

      const found = extractObjectAt(text, i);
      if (found !== undefined) return found;
    }
  }
  return null;
}

/**
 * 定位 uloop dispatcher。
 * 优先 PI_UNITY_ULOOP_CMD（JSON 数组，如 ["C:/node.exe","fake.js"]）—— 供测试注入；
 * 其次 PI_UNITY_ULOOP_BIN（单个可执行文件路径）；
 * 再次仓库内的 uloop-bin/；最后 PATH 上的 uloop。
 *
 * ⚠️ **不按空格切分** —— Windows 上 node / 编辑器路径常含空格（"C:\\Program Files\\..."），
 * 切分会把单个路径拆碎。（本机 node 恰好无空格，但不得依赖这一点。）
 */
function findDispatcher({ env = process.env, rootDir } = {}) {
  if (env.PI_UNITY_ULOOP_CMD) {
    try {
      const parts = JSON.parse(env.PI_UNITY_ULOOP_CMD);
      if (Array.isArray(parts) && parts.length > 0) {
        return { cmd: parts[0], prefixArgs: parts.slice(1) };
      }
    } catch { /* 落回下面的候选 */ }
  }
  if (env.PI_UNITY_ULOOP_BIN && fs.existsSync(env.PI_UNITY_ULOOP_BIN)) {
    return { cmd: env.PI_UNITY_ULOOP_BIN, prefixArgs: [] };
  }
  const local = path.join(rootDir ?? path.join(__dirname, '..'), 'uloop-bin',
    process.platform === 'win32' ? 'uloop.exe' : 'uloop');
  if (fs.existsSync(local)) return { cmd: local, prefixArgs: [] };
  return { cmd: process.platform === 'win32' ? 'uloop.exe' : 'uloop', prefixArgs: [] };
}

/**
 * 调用一个 uloop Unity 工具。
 * 约定（实测）：成功 → stdout；失败 → stderr；退出码 0/1。
 *
 * 输出被截断时缓冲到的文本是残缺的：其中的 JSON 片段可能恰好能被 `extractJson`
 * 解析成「看起来合法」的错值（如 `'{"Success":true,"Items":[{"id":1},'` → `{"id":1}`）。
 * **三个截断信号任一为真 —— `timedOut`（超时被杀）、`spawnError`（进程没起来）、
 * `drained`（`run()` 的 drain 宽限到期、未等到管道 EOF）—— 都强制 `json = null`，
 * 并用 `truncated: true` 标明「输出不可信」。**
 * 其中 `drained` 最关键：它表现为 `code=0 && timedOut=false`，与正常输出在
 * 其他字段上完全一致，只有这个信号能把两者区分开。
 *
 * 契约：`truncated === true` 时 `json` 必为 `null`。调用方必须把这种情况
 * **按失败处理**（报错/重试），**不得**把它当成与「无 JSON 输出」不同的
 * 另一种可用状态，也不得从 `stdout`/`stderr` 里自行重解析。
 *
 * @param {string} tool
 * @param {string[]} [toolArgs]
 * @param {{ projectPath?: string, env?: NodeJS.ProcessEnv, rootDir?: string,
 *   timeoutMs?: number, runImpl?: typeof run }} [opts]
 *   `runImpl` 仅供测试注入假 `run` 结果（默认即生产实现）。
 * @returns {Promise<{code:number, stdout:string, stderr:string, timedOut:boolean,
 *   drained:boolean, spawnError?:Error, json:object|null, truncated:boolean,
 *   tool:string, args:string[]}>}
 */
async function call(tool, toolArgs = [], {
  projectPath, env, rootDir, timeoutMs, runImpl = run,
} = {}) {
  const { cmd, prefixArgs } = findDispatcher({ env, rootDir });
  const args = [...prefixArgs];
  if (projectPath) args.push('--project-path', projectPath);
  args.push(tool, ...toolArgs);

  const r = await runImpl(cmd, args, { timeoutMs, env });

  // 成功读 stdout，失败读 stderr；两条都兜底试一遍
  const primary = r.code === 0 ? r.stdout : r.stderr;
  const secondary = r.code === 0 ? r.stderr : r.stdout;
  // drained：close 缺席、drain 宽限到期收尾 —— code=0 且 timedOut=false，
  // 只能靠这个信号识别「输出可能被截断」，否则残缺载荷会被解析成静默错值。
  const truncated = Boolean(r.timedOut || r.spawnError || r.drained);
  const json = truncated ? null : (extractJson(primary) ?? extractJson(secondary));

  return { ...r, json, truncated, tool, args };
}

module.exports = { extractJson, findDispatcher, call };
