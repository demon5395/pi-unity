// lib/asset.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { call } = require('./uloop.js');
const { ok, fail, envelopeFromCall } = require('./envelope.js');
const { normalizeAssetTo } = require('./assetpath.js');
const { compressIssues } = require('./issues.js');

/**
 * `unity asset write` + `unity compile` —— 把真实 `.cs` 写进项目并验证它能编译。
 *
 * 为什么需要（M2 范围补充，依据写在计划任务 8 的决策节）：运行时逻辑必须是**真 asset**，
 * 动态代码里定义的 MonoBehaviour 不能跨 PlayMode 的域重载存活（PITFALLS U8 同族）。
 * 为什么不需要 `AssetDatabase.Refresh()`：上游 compile skill 明确说 plain `uloop compile`
 * 自己会 refresh（vendor 出处见任务 8 决策节）。
 */

/** 包内模板表（**唯一真值**；`unity asset write --template <名字>` 只能取这里的键）。 */
const TEMPLATES = {
  PiBrickBreaker: path.join(__dirname, '..', 'unity-scripts', 'templates', 'PiBrickBreaker.cs'),
};

/** 模板名 → 包内绝对路径；未知模板返回 `null`。 */
function resolveTemplate(name) {
  return Object.hasOwn(TEMPLATES, name) ? TEMPLATES[name] : null;
}

/** `--timeout-seconds` 透传（`compile` 默认 600s；非法值 → null 由调用方落用法错）。
 *  接受正整数数字（供 `assetWrite` 预校验后往下传）与纯数字字符串（CLI argv）。
 *
 *  ⚠️ 本函数是**唯一的 `--timeout-seconds` 校验实现**（`unity build` 直接复用，见 `lib/build.js`）：
 *  非法的判据（非 `^\d+$` / ≤ 0 / 布尔 / 浮点）只此一处，避免两处逐字重复后各自漂移。 */
function compileTimeoutArg(v) {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v !== 'string' || !/^\d+$/.test(v) || Number(v) <= 0) return null;
  return Number(v);
}

/**
 * `unity compile`：跑一次 plain `uloop compile` 并报告结构化结果。
 *
 * 判据分层（U11 的纪律）：**字段缺失即失败**，绝不把 `ErrorCount:null`（不确定）当成 0。
 * `Success === null` 也是不确定（上游在编译中断时给 null + `COMPILE_RESULT_UNKNOWN`）。
 * 本命令是**读**命令 → `verified` 恒 `null`，成功与否看 `ok`（全局约束 15）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, timeoutSeconds?: string, _call?: typeof call}} [opts]
 * @returns {Promise<object>} 信封
 */
async function compile({ projectPath, env, timeoutSeconds, _call } = {}) {
  const t = compileTimeoutArg(timeoutSeconds);
  if (t === null) {
    return fail({
      code: 'BAD_TIMEOUT',
      message: `--timeout-seconds 需要正整数，收到 ${JSON.stringify(timeoutSeconds)}`,
      actual: { timeoutSeconds },
      hint: ['上游默认 600 秒；超过 1200 会超出 Unity 侧结果保留窗口'],
    });
  }
  const args = [];
  if (t !== undefined) args.push('--timeout-seconds', String(t));
  const r = await (_call || call)('compile', args, { projectPath, env });
  const j = r.json;
  // ⚠️ R209：`compile` 的 `Success` 在上游文档里可为 `null`（编译中断 → `COMPILE_RESULT_UNKNOWN`，
  //    出处 `Compile/Skill/SKILL.md:50-52`），但 `CompileResponseFactory.cs:80,91` 已强制成 bool
  //    → 本分支**生产不可达，除非上游改回 null**（保留防御：文档与实现不一致，且 `fromUloop`
  //    会把 `Success:null` 判成 `ULOOP_BAD_PAYLOAD`（误导），必须在这里单独认）。
  const indeterminate = !r.truncated && Boolean(j) && typeof j === 'object' && j.Success === null;
  // ⚠️ R275（真机修正，2026-09-19 S0Project 实录）：上游在**编译有错时给 `Success:false`**
  //    （`CompileResultFactory.cs:39` `success: errorCount == 0` → `CompileResponseFactory` 的
  //    `result.Success == true`），**不是**简报假定的 `Success:true + ErrorCount>0`。
  //    若直接走 `envelopeFromCall`，`Success:false` 会被映射成 `ULOOP_ERROR` 并**丢掉 `Errors[]`**
  //    → 真机判据②（`actual.errors[0]` 带 file/line/message）落空。
  //    所以「这是不是一份**确定的** compile 结果」改按**形状与计数的组合**判定：两个计数是数字，
  //    **且**（`Success === true` 或 `Errors` 是数组）。为什么这样分：
  //      · `Success:true + 计数齐全` —— 确定性成功/带错的成功面（简报 4 条用例 + CLI 用例用这个形状，
  //        它们不带 `Errors`，所以**不能**把 `Errors` 数组当作真值成功的必要条件）；
  //      · `Success:false + Errors 数组 + 计数` —— 真机编译有错的形状（`CompileResponseFactory` 只在
  //        indeterminate/force 分支把 `errors` 置 `null`）；
  //      · `Success:false + Errors:null`（indeterminate/force）—— 落上游错码或 BAD_COMPILE_RESPONSE。
  const isObject = !r.truncated && Boolean(j) && typeof j === 'object';
  const hasErrorList = isObject && Array.isArray(j.Errors);
  const hasCounters = isObject && typeof j.ErrorCount === 'number' && typeof j.WarningCount === 'number';
  const definitive = !indeterminate && hasCounters && (j.Success === true || hasErrorList);
  if (!definitive) {
    if (!indeterminate) {
      const envl = envelopeFromCall(r);
      if (!envl.ok) {
        // 上游自己报错（如 COMPILE_ALREADY_IN_PROGRESS / COMPILE_RESULT_UNKNOWN）：直接按码失败，NextActions 已在 hint 里
        if (envl.code === 'COMPILE_ALREADY_IN_PROGRESS') {
          return { ...envl, hint: [...envl.hint, '这是单飞（single-flight）行为，不是失败：等它跑完再重跑本命令，不要重启 Unity'] };
        }
        return envl;
      }
    }
    return fail({
      code: 'BAD_COMPILE_RESPONSE',
      message: 'compile 的结果不确定（Success/ErrorCount/WarningCount 缺失或为 null）——不猜成 0',
      actual: {
        success: j.Success ?? null,
        errorCount: j.ErrorCount ?? null,
        warningCount: j.WarningCount ?? null,
        message: typeof j.Message === 'string' ? j.Message : '',
      },
      hint: [
        '上游在编译中断时给 Success:null + COMPILE_RESULT_UNKNOWN；Message 里通常带 get-logs 指引与最近的 Console 错误',
        '重跑一次 `unity compile`；仍不确定就用 `unity play logs --log-type Error` 看真实错误',
      ],
    });
  }
  // 矛盾形态：`Success` 不是 true 却声称 0 错 —— 上游不变量 `success: errorCount == 0` 被破坏，不猜。
  if (j.Success !== true && j.ErrorCount === 0) {
    return fail({
      code: 'BAD_COMPILE_RESPONSE',
      message: 'compile 的 Success 不是 true 却报 ErrorCount=0（上游不变量被破坏）——不猜成 0',
      actual: {
        success: j.Success ?? null,
        errorCount: j.ErrorCount,
        warningCount: j.WarningCount,
        message: typeof j.Message === 'string' ? j.Message : '',
      },
      hint: ['重跑一次 `unity compile`；仍不确定就用 `unity play logs --log-type Error` 看真实错误'],
    });
  }
  const errors = compressIssues(j.Errors);
  const warnings = compressIssues(j.Warnings);
  const hint = [];
  if (typeof j.Warning === 'string' && j.Warning !== '') hint.push(`上游警告：${j.Warning}`);
  for (const h of (Array.isArray(j.NextActions) ? j.NextActions : [])) hint.push(`上游建议：${h}`);
  if (errors.length > 0) {
    hint.push(`第一条错误：${errors[0].file ?? '?'}:${errors[0].line ?? '?'} ${errors[0].message}`);
    hint.push('改完代码后重跑本命令（plain compile 自己会 refresh 外部改动，不要加 --force-recompile）');
  }
  const actual = {
    errorCount: j.ErrorCount,
    warningCount: j.WarningCount,
    errors,
    warnings,
    message: typeof j.Message === 'string' ? j.Message : '',
    projectRoot: typeof j.ProjectRoot === 'string' ? j.ProjectRoot : null,
  };
  if (j.ErrorCount > 0) {
    return fail({
      code: 'COMPILE_FAILED',
      message: `编译有 ${j.ErrorCount} 个错误（${j.WarningCount} 个警告）`,
      actual,
      hint,
    });
  }
  return ok(actual, { hint });
}
/**
 * `unity asset write`：把本地文件/包内模板写进项目的 `Assets/` 下，**读回比对 sha256**，再跑一次 compile。
 *
 * 契约：
 *   - `--to` 必须形如 `Assets/...` 且不含 `..`（否则 `BAD_TARGET_PATH`）；
 *   - 目标已存在且没给 `--force` → `ASSET_EXISTS`（**覆盖已有脚本属于 skill §5 的停止条件**，必须先问用户）；
 *   - 源：`--from <本地文件>` 或 `--template <包内模板名>`，**恰给一个**；
 *   - 写后读回：`sha256(写回内容) === sha256(源内容)` → `verified:true`；不等 → `verified:false` + 两个哈希（**不谎报**）；
 *   - 除非 `--no-compile`，写完调 `compile()`：有编译错 → `COMPILE_FAILED`（`actual.errors` 带结构化条目）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, to?: string, from?: string, template?: string,
 *   force?: boolean, noCompile?: boolean, timeoutSeconds?: string, _call?: typeof call,
 *   _readSource?: (p: string) => Buffer, _writeFile?: (p: string, b: Buffer) => void,
 *   _readBack?: (p: string) => Buffer, _exists?: (p: string) => boolean, _mkdirp?: (p: string) => void}} [opts]
 * @returns {Promise<object>} 信封
 */
async function assetWrite({
  projectPath, env, to, from, template, force, noCompile, timeoutSeconds, _call,
  _readSource, _writeFile, _readBack, _exists, _mkdirp,
} = {}) {
  // R277（F1）：`--timeout-seconds` 是**纯 argv 用法约束**，必须在任何写盘/uloop 调用之前收敛
  //（约束 16：用法错只由 argv 决定）。否则同一个 argv 会因 `--no-compile` 的有无给出两种结论：
  //   · 写盘 → 内部 compile() 报 BAD_TIMEOUT → 却被折成 COMPILE_FAILED/退出码 1（文件已落盘）；
  //   · `--no-compile` → 静默成功（verified:true）。
  // 预校验后把**校验过的值**往下传给 compile()（compileTimeoutArg 已支持数字入参）。
  const t = compileTimeoutArg(timeoutSeconds);
  if (t === null) {
    return fail({
      code: 'BAD_TIMEOUT',
      message: `--timeout-seconds 需要正整数，收到 ${JSON.stringify(timeoutSeconds)}`,
      actual: { timeoutSeconds },
      hint: ['上游默认 600 秒；超过 1200 会超出 Unity 侧结果保留窗口'],
    });
  }
  // R274：**空串不是「缺 --to」** —— `--to=` 给了值（只是值为空），语义是「目标路径非法」→
  // BAD_TARGET_PATH（仍退出码 2）。只有「没给 / 裸写 flag（true）/ 非字符串」才是 MISSING_TO。
  // 简报实现稿在这里写了 `|| to === ''`，与简报自己的测试（`''` 期望 BAD_TARGET_PATH）冲突，
  // 以测试为准（逐字用例是唯一可执行判据）。
  // R274/R366②：`--to` 校验收口到 `lib/assetpath.js`（asset import 共用同一实现）。
  // 下面三个文案参数**逐字**保留本命令原有输出（既有测试是判据）。
  const toCheck = normalizeAssetTo(to, {
    sample: 'Assets/PiBB/PiBrickBreaker.cs',
    missingHint: '用法：unity asset write --to Assets/PiBB/PiBrickBreaker.cs --template PiBrickBreaker',
    badHint: '用法：--to Assets/PiBB/PiBrickBreaker.cs',
  });
  if (!toCheck.ok) return toCheck.envelope;
  const normalizedTo = toCheck.path;
  const hasFrom = typeof from === 'string' && from !== '';
  const hasTemplate = typeof template === 'string' && template !== '';
  if (!hasFrom && !hasTemplate) {
    return fail({
      code: 'MISSING_SOURCE',
      message: '需要 --from <本地文件> 或 --template <包内模板名>',
      actual: { from, template },
      hint: [`包内模板：${Object.keys(TEMPLATES).join(', ')}`],
    });
  }
  if (hasFrom && hasTemplate) {
    return fail({
      code: 'BAD_SOURCE',
      message: '--from 与 --template 只能给一个',
      actual: { from, template },
      hint: ['二选一：--from <本地文件> 或 --template <包内模板名>'],
    });
  }
  let sourcePath = from;
  if (hasTemplate) {
    const resolved = resolveTemplate(template);
    if (!resolved) {
      return fail({
        code: 'TEMPLATE_NOT_FOUND',
        message: `未知模板：${template}`,
        actual: { template, available: Object.keys(TEMPLATES) },
        hint: [`可用模板：${Object.keys(TEMPLATES).join(', ')}`],
      });
    }
    sourcePath = resolved;
  }
  // R278（F2，M1 R68 同族）：`--project-path` 是 `--to` 落地路径的解析根，不可缺、不可裸写。
  //   · 裸写：parseArgs 给 `true` → `path.join(true, …)` 抛 TypeError 逃出本函数 → 顶层 catch
  //     → 退出码 3（把用户 argv 失误报成「本包 bug」）；
  //   · 完全不给：`path.join('', …)` 是**相对路径** → 写到**进程 CWD** 的 Assets/，而随后的 compile
  //     走调度器默认工程 → 可能 verified:true/compiled:true 的**假绿** + CWD 造出游离目录。
  if (typeof projectPath !== 'string' || projectPath === '') {
    return fail({
      code: 'MISSING_PROJECT_PATH',
      message: '需要 --project-path（本命令要按项目根解析 --to 的落地路径）',
      actual: { to: normalizedTo },
      hint: ['用 --project-path <项目根> 指定项目'],
    });
  }
  const absTo = path.join(projectPath, normalizedTo);
  if ((_exists || fs.existsSync)(absTo) && force !== true) {
    return fail({
      code: 'ASSET_EXISTS',
      message: `目标已存在：${normalizedTo}（未给 --force）`,
      actual: { path: normalizedTo },
      hint: [
        '覆盖已有脚本属于停止条件（skill §5）：先向用户确认',
        '确认后用 --force 覆盖；想先看差异就先 `unity node inspect`/直接读文件',
      ],
    });
  }
  let source;
  try {
    source = await (_readSource || ((p) => fs.readFileSync(p)))(sourcePath);
  } catch (err) {
    return fail({
      code: 'SOURCE_NOT_FOUND',
      message: `读不了源文件：${(err && err.message) || String(err)}`,
      actual: { from: hasFrom ? from : null, template: hasTemplate ? template : null, sourcePath },
      hint: ['--from 用绝对路径；--template 只能用包内模板名（见 hint 的列表）'],
    });
  }
  if (!Buffer.isBuffer(source)) {
    return fail({ code: 'SOURCE_NOT_FOUND', message: '源内容不是 Buffer', actual: { sourcePath }, hint: ['内部注入缝用错（测试只）'] });
  }
  try {
    (_mkdirp || ((p) => fs.mkdirSync(p, { recursive: true })))(path.dirname(absTo));
    (_writeFile || ((p, b) => fs.writeFileSync(p, b)))(absTo, source);
  } catch (err) {
    return fail({
      code: 'ASSET_WRITE_FAILED',
      message: `写盘失败：${(err && err.message) || String(err)}`,
      actual: { path: normalizedTo },
      hint: ['确认项目目录可写、路径拼写正确（--to 是项目内相对路径）'],
    });
  }
  const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const want = sha256(source);
  let back = null;
  try {
    back = await (_readBack || ((p) => fs.readFileSync(p)))(absTo);
  } catch (err) {
    back = null;
  }
  const got = Buffer.isBuffer(back) ? sha256(back) : null;
  const same = got !== null && got === want;
  const actual = {
    path: normalizedTo,
    bytes: source.length,
    sha256: want,
    readBackBytes: Buffer.isBuffer(back) ? back.length : null,
    readBackSha256: got,
    compiled: null,
  };
  if (!same) {
    return {
      ...ok(actual, {
        verified: false,
        intent: { path: normalizedTo, sha256: want },
        hint: ['写盘后读回的内容与源不一致 —— 不要继续（先查磁盘/权限/杀软拦截），也不要当成写完'],
      }),
      mismatches: [{ key: 'sha256', intent: want, actual: got }],
    };
  }
  if (noCompile === true) {
    return { ...ok(actual, { verified: true, intent: { path: normalizedTo, sha256: want } }), mismatches: [] };
  }
  const c = await compile({ projectPath, env, timeoutSeconds: t, _call });
  actual.compiled = c.ok && typeof c.actual.errorCount === 'number';
  actual.compile = {
    errorCount: c.actual && typeof c.actual.errorCount === 'number' ? c.actual.errorCount : null,
    warningCount: c.actual && typeof c.actual.warningCount === 'number' ? c.actual.warningCount : null,
  };
  if (!c.ok) {
    // R279（F3）：只把**真正的编译结论类**（COMPILE_FAILED / BAD_COMPILE_RESPONSE）当作本命令的结论，
    // 其余（COMPILE_ALREADY_IN_PROGRESS / COMPILE_RESULT_UNKNOWN / ULOOP_TRUNCATED / ULOOP_NO_JSON /
    // ULOOP_ERROR …）**原码透传**，并带上 `retryable` —— 「刚写完 .cs 紧接着 compile」撞上 single-flight
    // 是常见情形，一律折成 COMPILE_FAILED 会让任务 10/11 把「编辑器忙/输出被截断」误判成「脚本编译不过」，
    // 并把可重试语义（retryable:true）抹成不可重试。
    // R284（F8）：写盘已验（sha256 相等）而编译未过 —— 用 `intent` + `writeVerified`/`compileVerified`
    // 在结构上说清；`verified:false` 保持不动（约束 15：不许把它扩张成「编译通过」）。
    // F4/R348（原延后项 D5②）：message 必须与同一信封的 `code` / `retryable` 同口径 ——
    // `COMPILE_FAILED`/`BAD_COMPILE_RESPONSE` 是**结论类**（编译确实没过 / 上游给了自相矛盾的结论），
    // 其余（`ULOOP_TRUNCATED` / `COMPILE_RESULT_UNKNOWN` / `COMPILE_ALREADY_IN_PROGRESS` / `ULOOP_NO_JSON`…）
    // 都是「**结果未知**」（且多为 `retryable:true`）：写「编译未通过」会把 agent 引去修一个可能
    // 不存在的编译错。只改 message 措辞，`code`/`retryable`/`verified` 与两个子判定一律不动。
    const compileConcluded = c.code === 'COMPILE_FAILED' || c.code === 'BAD_COMPILE_RESPONSE';
    const compileVerdict = compileConcluded
      ? '编译未通过'
      : `编译结果未知/未取到（${c.code || 'UNKNOWN'}）`;
    return fail({
      code: c.code,
      message: `脚本已写入但${compileVerdict}：${c.message}`,
      intent: { path: normalizedTo, sha256: want },
      actual: { ...actual, writeVerified: true, compileVerified: false, errors: (c.actual && c.actual.errors) || [] },
      hint: [...(c.hint || []), `文件已写入 ${normalizedTo}；修好错误后重跑 \`unity compile\``],
      phase: 'compile',
      retryable: c.retryable,
    });
  }
  // R280（F4）：写命令的成功信封一律带 `mismatches`（`ok()` 白名单刻意不含它，须显式附加）。
  return {
    ...ok(actual, {
      verified: true,
      intent: { path: normalizedTo, sha256: want },
      hint: c.hint || [],
    }),
    mismatches: [],
  };
}

module.exports = { compile, assetWrite, resolveTemplate, TEMPLATES, compressIssues, compileTimeoutArg };
