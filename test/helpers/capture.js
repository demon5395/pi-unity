'use strict';

/**
 * 捕获 `process.stdout` / `process.stderr` 的写入（测试辅助）。
 *
 * `node --test` 的测试子进程会往同一个 `process.stdout.write` 写 v8 序列化的 **Buffer**
 * （enqueue/dequeue 内部协议）—— 必须原样转发给真实 write，否则捕获串会混入二进制垃圾
 * （实测 `JSON.parse` 报 `Unexpected token`）。
 *
 * 放在 `test/helpers/`：`npm test` 用 `node --test "test/*.test.js"`，只收 `test/` 顶层，
 * 这个文件不会被当成测试用例执行。
 */

/** 捕获 process.stdout.write（node --test 会往同一流写 Buffer，必须原样转发）。 */
async function captureStdout(fn) {
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk, ...rest) => {
    if (typeof chunk !== 'string') return original.call(process.stdout, chunk, ...rest);
    out += chunk;
    return true;
  };
  let result;
  try {
    result = await fn();
  } finally {
    process.stdout.write = original;
  }
  return { result, out };
}

/** 捕获 process.stderr.write（用法同 captureStdout；用于 CLI 的 usage 分支）。 */
async function captureStderr(fn) {
  const original = process.stderr.write;
  let out = '';
  process.stderr.write = (chunk, ...rest) => {
    if (typeof chunk !== 'string') return original.call(process.stderr, chunk, ...rest);
    out += chunk;
    return true;
  };
  let result;
  try {
    result = await fn();
  } finally {
    process.stderr.write = original;
  }
  return { result, out };
}

module.exports = { captureStdout, captureStderr };
