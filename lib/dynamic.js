'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { call } = require('./uloop.js');
const { ok, fail, envelopeFromCall } = require('./envelope.js');

/**
 * `unity exec`：在编辑器里执行**独立 C# 脚本**，把脚本的 `return` 值读回来。
 *
 * 这是 M2 E2E 盲测暴露的 **#1 缺口（B1）** 的收口：SKILL §8③ 曾让 agent 用上游
 * `execute-dynamic-code` 读运行期脚本字段（`score` / `bricksAlive`），但 `unity`
 * 命令面没有这个能力，把 agent 逼向 skill 明令禁止的裸 uloop。
 *
 * **信封口径（全局约束 15）**：本命令是**执行/读**命令 —— 没有「写后读回」的
 * intent 可比对，所以 `verified` **恒为 `null`**（不是 `true` 也不是 `false`），
 * 成功信封一律走 `ok(actual, { hint })`，不得手写 `{ok:true, ...}`。
 *
 * **参数形状（上游实证，见 docs/CAPABILITIES-*.md §4.2 / §4.5）**：
 *   - `--code-file <f>`：脚本文件（本项目**不 fork 上游**：`lib/uloop.js` 的 `call`
 *     会自己拼 `--project-path` 与工具名，这里只给工具级 argv）；
 *   - `--code <s>`：内联脚本文本。
 *   两者**恰给一个**；上游 `execute-dynamic-code` 的返回值落在响应的 `Result` 字段。
 *
 * ⚠️ **不用 `buildPayloadArgs`**（`lib/scene.js`）：那是给「仓内固定脚本 +
 * `--parameters {json}`」的写路径用的；本命令执行的是**用户给的独立脚本**，
 * 没有 `--parameters` 契约。
 * ⚠️ `--code-file` 必须先 `path.resolve` 成绝对路径再发：相对路径会以**编辑器进程**
 * 的工作目录为基准解析（通常是项目根），与当前 shell 的 cwd 不是一回事。
 */

/** 源参数必须是**非空字符串**：`--code-file` 裸写时 `parseArgs` 给布尔 `true`。 */
function isUsableSource(value) {
  return typeof value === 'string' && value !== '';
}

/** `exec` 的源参数用法（MISSING_SOURCE / BAD_SOURCE 共用）。 */
const SOURCE_USAGE = 'unity exec --project-path <P> (--code-file <f> | --code <s>) [--json]';

/**
 * 执行一段动态 C# 代码并读回 `Result`。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, codeFile?: string,
 *   code?: string, _call?: typeof call}} [opts] `_call` 仅供测试注入。
 * @returns {Promise<object>} 信封（成功 → `ok({result}, {hint})`，`verified` 恒 `null`）
 */
async function execCode({ projectPath, env, codeFile, code, _call } = {}) {
  const hasFile = codeFile !== undefined;
  const hasCode = code !== undefined;

  if (!hasFile && !hasCode) {
    return fail({
      code: 'MISSING_SOURCE',
      message: 'exec 需要二选一：--code-file <f> 或 --code <s>（恰给一个）',
      actual: { codeFile: null, code: null },
      hint: [
        `用法：${SOURCE_USAGE}`,
        '两者的区别：--code-file 执行磁盘上的独立 .cs；--code 执行命令行里内联的文本',
      ],
    });
  }
  if (hasFile && hasCode) {
    return fail({
      code: 'BAD_SOURCE',
      message: '--code-file 与 --code 只能给一个（两者都给会让「执行哪份源」不确定）',
      actual: { codeFile, code },
      hint: [`用法：${SOURCE_USAGE}`],
    });
  }

  let args;
  if (hasFile) {
    if (!isUsableSource(codeFile)) {
      // `--code-file` 不带值 → parseArgs 给 true；`--code-file=` → 空串；两者都不是可执行源。
      return fail({
        code: 'BAD_SOURCE',
        message: `--code-file 需要非空字符串路径，收到 ${JSON.stringify(codeFile)}`,
        actual: { codeFile },
        hint: [`用法：${SOURCE_USAGE}`, '`--code-file` 必须带值（`--code-file=空的` 也不行）'],
      });
    }
    const abs = path.resolve(codeFile);
    if (!fs.existsSync(abs)) {
      // 用法（argv 形状）合法、环境不满足：这是**运行时**错（退出码 1，不是 2）。
      return fail({
        code: 'SOURCE_NOT_FOUND',
        message: `--code-file 指向的文件不存在：${abs}`,
        actual: { codeFile, resolved: abs },
        hint: [
          '相对路径按**当前 shell 的 cwd** 解析成绝对路径；传到编辑器的是这个绝对路径',
          '确认文件名拼写与 cwd（`pwd`）；路径含空格时整条 argv 用引号包住',
        ],
      });
    }
    args = ['--code-file', abs];
  } else {
    if (!isUsableSource(code)) {
      return fail({
        code: 'BAD_SOURCE',
        message: `--code 需要非空字符串源码，收到 ${JSON.stringify(code)}`,
        actual: { code },
        hint: [
          `用法：${SOURCE_USAGE}`,
          '`--code` 必须带值（`--code=` 空串也不行）',
          '值以 `--` 开头时（如 `--code --count; return count;`）会被 `parseArgs` 当成开关 → 请用 `--code=<片段>` 形式',
        ],
      });
    }
    args = ['--code', code];
  }

  const r = await (_call || call)('execute-dynamic-code', args, { projectPath, env });
  const j = r.json;
  // 截断优先：`truncated:true` 时残缺输出里的 JSON 可能是「看起来合法」的错值，
  // 一律按失败处理（由 `envelopeFromCall` 统一落 ULOOP_TRUNCATED），绝不产 ok:true。
  //
  // R352 + R475：编译失败的形状是 `{Success:false, CompilationErrors:[{Message,File,Line}], ErrorMessage}`
  // （CAPABILITIES §4.2），**没有** `ErrorCode`/`Message`。
  // R435：编译失败已由 `envelopeFromCall` 中央识别（`lib/envelope.js` 的 `scriptCompileFailure`），
  // 本命令不再自建实现（避免两份判据漂移）。
  // 失败信封原样返回（含上游错误码）：本命令**不写场景**，故不追加「写入是否生效未知」类 hint。
  const envl = envelopeFromCall(r);
  if (!envl.ok) return envl;

  return ok(
    { result: j.Result ?? null },
    {
      hint: [
        'actual.result 是脚本 return 的原样值（脚本没有 return → null）',
        '本命令是执行/读命令：没有可比对的 intent，verified 恒为 null —— 别把它当写命令的验证结果',
      ],
    },
  );
}

module.exports = { execCode };
