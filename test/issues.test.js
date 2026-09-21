'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isScriptCompileFailure, isExecutionInProgress, compressIssues } = require('../lib/issues.js');

test('R475：CompilationErrors 为空数组 + 并发文案 → 不是编译失败（旧判据会误判）', () => {
  // 载荷逐字对齐真机（docs/m5-probes-raw/p4-1.json 的 ErrorMessage 分支）
  const json = { Success: false, CompilationErrors: [], ErrorMessage: 'Another execution is already in progress' };
  assert.strictEqual(isScriptCompileFailure(json), false, '空数组不得算编译失败（成功载荷里它恒存在）');
});

test('R352：CompilationErrors 非空 → 是编译失败', () => {
  const json = { Success: false, CompilationErrors: [{ Message: 'CS1061', File: 'Assets/A.cs', Line: 12 }] };
  assert.strictEqual(isScriptCompileFailure(json), true);
});

test('R352 反证：Success 为真 / 缺 CompilationErrors / 非数组 → 都不是编译失败', () => {
  assert.strictEqual(isScriptCompileFailure({ Success: true, CompilationErrors: [{ Message: 'x' }] }), false);
  assert.strictEqual(isScriptCompileFailure({ Success: false, ErrorMessage: 'boom' }), false);
  assert.strictEqual(isScriptCompileFailure({ Success: false, CompilationErrors: 'nope' }), false);
  assert.strictEqual(isScriptCompileFailure(null), false);
});

test('并发文案门控：命中哨兵 / 不命中', () => {
  assert.strictEqual(isExecutionInProgress('Another execution is already in progress'), true);
  assert.strictEqual(isExecutionInProgress("uloop: Another execution is already in progress. Please wait"), true);
  assert.strictEqual(isExecutionInProgress('动态代码编译失败：Another execution is already in progress'), true);
  assert.strictEqual(isExecutionInProgress('compile failed'), false);
  assert.strictEqual(isExecutionInProgress(undefined), false);
});

test('compressIssues 与 asset.js 原实现同形（下沉后不得改形状）', () => {
  assert.deepStrictEqual(
    compressIssues([{ Message: 'm', File: 'f', Line: 3 }, { Message: 7 }, {}]),
    [{ message: 'm', file: 'f', line: 3 }, { message: '', file: null, line: null }, { message: '', file: null, line: null }],
  );
  // 非对象元素（null/undefined）不得抛：`isScriptCompileFailure` 会放 `[null]` 进来，
  // 抛 TypeError 会冒到 `bin/unity.js` 顶层 → 退出码 3（internal error）而非可读失败。
  assert.doesNotThrow(
    () => compressIssues([null, undefined]),
    'compressIssues 对 null/undefined 元素必须安全',
  );
  assert.deepStrictEqual(
    compressIssues([null, undefined]),
    [{ message: '', file: null, line: null }, { message: '', file: null, line: null }],
  );
});
