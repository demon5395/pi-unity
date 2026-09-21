'use strict';

/** 解析 `--key value` / `--flag` / `--key=value` 为普通对象。 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/** 布尔开关的取值归一表（D-A2）。 */
const TRUE_VALUES = new Set(['1', 'true', 'yes']);
const FALSE_VALUES = new Set(['0', 'false', 'no']);

/**
 * **全项目布尔开关清单（9 个）**。`bin/unity.js` 与 `lib/doctor.js` 共用。
 * 消费点（供将来核对）：json（bin 16 处 + doctor 3 处）、smoke/golden（doctor）、
 * force（asset/importart/prefab/scenefile）、no-compile（asset）、trim（importart）、
 * bypass-raycast/dry-run/include-stack-trace（play）。
 */
const BOOLEAN_KEYS = Object.freeze([
  'json', 'smoke', 'golden', 'force', 'trim', 'no-compile',
  'bypass-raycast', 'dry-run', 'include-stack-trace',
]);

/**
 * 把布尔开关的 `--flag=<值>` 归一成真布尔（D-A2）。
 *
 * 为什么必须有这一层：`parseArgs` 对 `--flag=1` 给的是**字符串** `'1'`，而各命令的消费点
 * 分两族 —— 严格族（`x === true`，如 `--force`/`--trim`/`--dry-run`）会**静默 no-op**，
 * 真值族（`Boolean(x)`，如 `--json`）则**关不掉**（`--json=0` 仍输出 JSON）。
 * 两族都是「用户说了话、工具没照做」的静默失败（`--dry-run=1` 甚至**真的注入输入**）。
 * 归一后：`1/true/yes`→`true`、`0/false/no`→`false`，其余值报 `BAD_FLAG_VALUE`（用法错 2）。
 *
 * 只遍历 {@link BOOLEAN_KEYS} → **带值参数（`--ppu 1` / `--sorting-order 0` / `--max-count 1` …）不受影响**。
 *
 * 非字符串入参按 `String()` 语义处理：数字 `1` → `'1'` → `true`；数组/对象经 `String()` 后不在
 * 归一表内 → `BAD_FLAG_VALUE`（如 `['1','2']`、`{a:1}`）。
 *
 * @param {Record<string, unknown>} args `parseArgs` 的输出
 * @param {string[]} [keys] 布尔开关键名；缺省用 {@link BOOLEAN_KEYS}
 * @returns {{args: Record<string, unknown>, error?: {code: string, message: string, hint: string[]}}}
 */
function normalizeBooleans(args, keys = BOOLEAN_KEYS) {
  const out = { ...args };
  for (const key of keys) {
    const v = out[key];
    if (v === undefined || typeof v === 'boolean') continue;
    const s = String(v).trim().toLowerCase();
    if (TRUE_VALUES.has(s)) out[key] = true;
    else if (FALSE_VALUES.has(s)) out[key] = false;
    else {
      return {
        args,
        error: {
          code: 'BAD_FLAG_VALUE',
          message: `--${key} 是布尔开关，只接受 1/0/true/false/yes/no，收到 ${JSON.stringify(v)}`,
          hint: [`用法：--${key}（等价于 --${key}=1）或不写`],
        },
      };
    }
  }
  return { args: out };
}

module.exports = { parseArgs, normalizeBooleans, BOOLEAN_KEYS };
