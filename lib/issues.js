'use strict';

/**
 * 把 `CompilationErrors` / `compile` 的条目压成 `{message, file, line}`（上游 CompileIssue 字段面）。
 *
 * R435：本函数原在 `lib/asset.js`。下沉到此（**零依赖**）是因为 `lib/envelope.js` 需要它，
 * 而 `lib/asset.js` 已经 `require('./envelope.js')` —— 留在原处会形成 `envelope ⇄ asset` 环。
 */
function compressIssues(list) {
  // 元素可能是 `null`/`undefined`/原始值：`isScriptCompileFailure` 只要求
  // `CompilationErrors` 是**非空数组**，`[null]` 会通过判据被送进来。读属性前必须
  // 先判对象，否则 `null.Message` 抛 TypeError → 冒到 `bin/unity.js` 顶层 → 退出码 3。
  return (Array.isArray(list) ? list : []).map((i) => ({
    message: i && typeof i.Message === 'string' ? i.Message : '',
    file: i && typeof i.File === 'string' ? i.File : null,
    line: i && typeof i.Line === 'number' ? i.Line : null,
  }));
}

/**
 * 判据：uloop 信封是不是「**脚本编译失败**」。
 *
 * ⚠️ R475（真机 2026-09-20，见 `docs/M5-PROBES.md` P2）：`CompilationErrors` 在**成功**载荷里
 * 恒存在（实测 `{"Success":true,…,"CompilationErrors":[]}`），并发被拒时也回
 * `{Success:false, CompilationErrors:[], ErrorMessage:'Another execution is already in progress'}`。
 * 旧判据只要求 `Array.isArray` → 空数组也满足 → 把「并发被拒」误报成「编译失败」。故**必须要求非空**。
 *
 * @param {unknown} json uloop 原始 JSON
 * @returns {boolean}
 */
function isScriptCompileFailure(json) {
  return Boolean(json) && typeof json === 'object'
    && json.Success === false
    && Array.isArray(json.CompilationErrors)
    && json.CompilationErrors.length > 0;
}

/** 上游「另一条命令正在执行」的哨兵文案（`UnityCliLoopConstants.ERROR_MESSAGE_EXECUTION_IN_PROGRESS`）。 */
const EXECUTION_IN_PROGRESS_TEXT = 'Another execution is already in progress';

/** 文本门控：该失败是否其实是「另一条命令正在执行」（uloop 单飞）。 */
function isExecutionInProgress(message) {
  return typeof message === 'string' && message.includes(EXECUTION_IN_PROGRESS_TEXT);
}

/**
 * 并发被拒时统一追加的 hint。
 * 措辞**不得**含「写入 / 未生效 / 已经生效」——`test/dynamic.test.js:149` 钉死「不写场景的命令不得套用写入类 hint」。
 */
const CONCURRENT_HINT =
  '另一条 `unity` 命令正在执行 —— uloop 是**单飞**（single-flight）的，并行调用必被拒：请**串行重试**本命令（不要重开编辑器、不要重跑并发的那条）';

module.exports = { compressIssues, isScriptCompileFailure, isExecutionInProgress, EXECUTION_IN_PROGRESS_TEXT, CONCURRENT_HINT };
