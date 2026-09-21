'use strict';

const { isScriptCompileFailure, compressIssues, isExecutionInProgress, CONCURRENT_HINT } = require('./issues.js');

/**
 * 统一信封：{ok, verified, intent, actual, hint, code}
 *
 * 核心语义（本项目唯一自研价值）：
 *   - uloop 的 `Success:true` 只表示「代码执行了」，**不表示「意图达成了」**
 *   - 因此 ok:true 时 verified 仍为 null；只有写后读回比对通过才置 true
 */

/**
 * 构造成功信封。
 *
 * 第二参是**白名单**：只采纳 `verified` / `intent` / `hint` / `code`，
 * 其余键一律静默忽略。这样调用方无法用 `ok(a, { ok: false })` 之类的手法
 * 篡改 `ok` / `actual`，也堵死了「随便塞一个键就改变信封语义」的逃生口。
 *
 * `verified` 是唯一一个「允许被覆盖成非 null」的语义字段，且只应由写后读回
 * 路径（任务 8 `lib/readback.js`）在比对确实通过后显式传 `true`；其它任何
 * 调用方都不应传它 —— 不传即恒为 `null`，表示「未验证」。
 *
 * @param {*} actual 实际观测到的结果
 * @param {{verified?: true|false|null, intent?: *, hint?: string[], code?: string}} [extra]
 *   白名单可选覆盖；不在白名单内的键被忽略
 * @returns {{ok: true, verified: true|false|null, intent: *, actual: *, hint: string[], code?: string}}
 */
function ok(actual, extra = {}) {
  const { verified = null, intent = null, hint = [], code } = extra ?? {};
  const envelope = { ok: true, verified, intent, actual, hint };
  if (code !== undefined) envelope.code = code;
  return envelope;
}

/**
 * 已知的瞬时失败码：**值得重试**，但不是「无界重试许可」。
 *
 * `retryable: true` 只表示「这次失败可能是瞬时的，重试有意义」。调用方
 * **必须**自己限次（建议 ≤3 次并配合退避），**不得**无界重试：
 * `ULOOP_NO_JSON` 同时承载两种完全不同的原因 ——
 *   - 编辑器未就绪 / 输出抖动（瞬时，重试有意义）；
 *   - `PI_UNITY_ULOOP_BIN` 路径错误、项目未打开（终态，重试永远不会成功）。
 * 两者在 `fail()` 里只能靠 `hint` 区分（`hint` 会提示去查 dispatcher 路径 /
 * 打开项目），所以调用方在重试前**必须**读 `hint`，把终态原因识别出来并
 * 直接失败，否则会在终态错误上空转、反而掩盖本应显式判断的情形。
 * `ULOOP_TRUNCATED` 是 drain 宽限的保守判定，同样必须限次。
 *
 * `UNITY_SERVER_BUSY`（U49）：uloop dispatcher 的**单飞**拒绝 —— 上游信封逐字说
 * 「uloop is single-flight by design; never run uloop commands in parallel」，并且 dispatcher 自己
 * 已经重试了 10 秒（真机见 `docs/m5-probes-raw/victim2.json`）。它是**瞬时**的（并发那条一结束就能过），
 * 所以登记在此 —— 上游在**平铺**形状里根本不给 `Retryable` 字段，只靠 `Boolean(e.Retryable)` 会
 * 把它误判成终态、让 agent 放弃重试。
 */
const RETRYABLE_CODES = new Set([
  'ULOOP_NO_JSON',
  'ULOOP_TRUNCATED',
  'UNITY_SERVER_BUSY',
]);

/** 用法错的进程退出码：argv 形状/取值非法，命令根本没被有意义地执行。 */
const EXIT_USAGE = 2;

/**
 * 用法错错误码（退出码 {@link EXIT_USAGE}）：argv 形状/取值非法，命令根本没被有意义地执行。
 *
 * 边界规则（M1 延后项⑨，M2 定案）：
 *   - **2 = 用法错** —— 参数缺失 / 类型不符 / 枚举外取值 / JSON 语法错（JSON 语法错在 `bin/unity.js` 里
 *     直接返回 `EXIT_USAGE`，不经信封）；
 *   - **1 = 运行时 / 环境 / 验证错** —— 编辑器没连上、节点不存在、读回不一致（`verified:false`）、编译不过。
 *
 * ⚠️ **R477（订正）**：`MISSING_PROJECT_PATH`（缺 `--project-path`）是**参数缺失**，按上面的边界规则
 * 本就该归 **2**。此前它在数组外、被 `isUsageFailure` 保守判 `false` → 给 1，与「缺失即用法错」
 * 自相矛盾（`docs/PITFALLS.md` 的 D12 登记），本次按 R477 移入。**产出点（`lib/asset.js` 等）的
 * `code` 值不变**，只是退出码归属变了。
 *
 * ⚠️ **刻意不使用 `MISSING_`/`BAD_` 前缀规则**：`BAD_SCRIPT_RESULT`（脚本返回非 JSON）与
 * `BAD_HIERARCHY`（上游形状变了）都是**运行时**错，前缀规则会把它们误判成用法错。
 * 新增用法错码时**必须同时改这个数组与 `test/envelope.test.js` 的成员断言**。
 *
 * ⚠️ R221：导出的是**冻结数组**，成员判定走私有 `USAGE_SET` —— `Object.freeze(new Set())`
 * 只挡属性写入，拦不住 `USAGE_FAILURE_CODES.add('NOT_FOUND')`：任何消费者都能把退出码
 * 从 1 静默改成 2。数组冻结后 `push` 会抛，真值不再可被外部改写。
 */
const USAGE_FAILURE_CODES = Object.freeze([
  'MISSING_NAME', 'MISSING_PATH', 'MISSING_PATCH', 'MISSING_KEY', 'MISSING_FILE',
  'MISSING_PROJECT_PATH', 'MISSING_SOURCE', 'MISSING_TO',
  'BAD_COMPONENTS', 'BAD_PARENT', 'BAD_PATCH', 'BAD_COLOR', 'BAD_SORTING_ORDER',
  'BAD_WINDOW_NAME', 'BAD_OUT_DIR', 'BAD_CAPTURE_MODE', 'BAD_MATCH_MODE',
  'BAD_AT', 'BAD_REGION', 'BAD_EXPECT', 'BAD_TOLERANCE', 'BAD_ACTION', 'BAD_COORD', 'BAD_TIMEOUT',
  'BAD_SIZE', 'BAD_SOURCE', 'BAD_TARGET_PATH',
  'BAD_PPU', 'BAD_FILTER', 'BAD_COMPRESSION', 'BAD_MAX_SIZE', 'BAD_REMOVE_BG', 'BAD_SIBLING_INDEX', 'BAD_FIT', 'BAD_FLAG_VALUE', 'BAD_PIVOT',
  'MISSING_ASSET', 'BAD_ASSET_PATH', 'BAD_WORLD_SIZE',
  'DIFF_SIZE_MISMATCH',
  'EMPTY_PATCH', 'UNKNOWN_PATCH_KEY',
]);

const USAGE_SET = new Set(USAGE_FAILURE_CODES);

/** 该错误码是否属于「用法错」（未知码保守判 false → 退出码 1，方向安全）。 */
function isUsageFailure(code) {
  return typeof code === 'string' && USAGE_SET.has(code);
}

/**
 * **信封 → 退出码**的唯一判定处（全局约束 16）：各命令 handler 不得再手写
 * `e.ok ? 0 : 1`，否则「2 与 1 的边界」会再次漂移。
 *
 * ⚠️ 作用域仅限「**有信封可判**」的路径：argv 形状错（缺子动作、非法 JSON 等）由
 * `bin/unity.js` 的 handler 直接 `return EXIT_USAGE`（不经信封）；`lib/doctor.js` 的
 * 0/1 是 doctor 自报，也不产信封。
 *
 * `0` = 成功且 `verified !== false`；`1` = 运行时/环境/验证错（含 `verified:false`、`actual.match === false`）；`2` = 用法错。
 * `actual.match` 是**读命令的判定字段**（`unity pixels --expect` 用），它和 `verified` 一样只由
 * 命令自己置位；没有 `match` 字段的读命令不受影响。
 */
function exitCodeFor(envelope) {
  if (!envelope || envelope.ok !== true) return isUsageFailure(envelope && envelope.code) ? EXIT_USAGE : 1;
  if (envelope.verified === false) return 1;
  if (envelope.actual && envelope.actual.match === false) return 1;
  return 0;
}

/** uloop 返回的 JSON 不含布尔 `Success` 字段（不是 uloop 信封）时的错误码。 */
const ULOOP_BAD_PAYLOAD = 'ULOOP_BAD_PAYLOAD';

/**
 * 构造失败信封。
 *
 * `retryable` 语义：
 *   - `true`  —— **值得**重试（瞬时故障）；调用方必须限次（建议 ≤3）并先读
 *     `hint` 排除终态原因（如 dispatcher 路径错误、项目未打开）
 *   - `false` —— 终态错误，重试无意义
 * 取值规则：显式传入优先；未传入时查 `RETRYABLE_CODES`（非集合内错误码，
 * 含 `code === undefined`，一律为 `false`）。
 */
function fail({ code, message, intent = null, actual = null, hint = [], phase, retryable } = {}) {
  return {
    ok: false,
    verified: false,
    code,
    message,
    intent,
    actual,
    hint,
    phase,
    retryable: retryable ?? RETRYABLE_CODES.has(code),
  };
}

/**
 * 从 `call()` 的 argv 里取 `--code-file` 的**原值**（完整路径）。取不到返回 null。
 *
 * ⚠️ 不能用 `scriptNameFromArgs` 的 basename 替代 hint 里的路径：`unity exec --code-file`
 * 收的是**任意路径**（真机探针就写 `exec --code-file $R/probe-r427.cs`），写死
 * `unity-scripts/<basename>` 会指向一个不存在的文件（与 R435「别把人带偏」相反）。
 *
 * 健壮性契约（与 `scriptNameFromArgs` 同）：`r` 缺失 / `args` 非数组 / 值非字符串 / 空串 → null。
 */
function scriptPathFromArgs(r) {
  const args = r && Array.isArray(r.args) ? r.args : [];
  const i = args.indexOf('--code-file');
  if (i === -1 || typeof args[i + 1] !== 'string' || args[i + 1] === '') return null;
  return args[i + 1];
}

/**
 * 从 `call()` 的 argv 里取载荷脚本名（`--code-file <abs>/scene-save.cs` → `scene-save.cs`）。
 * 只为把 `actual.script` 说得更具体，取不到就返回 null。
 *
 * 实现复用 {@link scriptPathFromArgs}（**唯一**的 argv 解析点），避免两份解析逻辑漂移。
 */
function scriptNameFromArgs(r) {
  const scriptPath = scriptPathFromArgs(r);
  if (scriptPath === null) return null;
  const parts = scriptPath.split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

/**
 * 把「脚本编译失败」的 uloop 载荷收敛成**可读**的 `SCRIPT_COMPILE_ERROR` 信封。
 *
 * R435：原先只有 `unity exec` 认这个形状，payload 类命令（node / sprite / prefab / asset / scene 写）
 * 只落 `ULOOP_ERROR` + 空 message —— agent 拿不到 CS 码/行号，只能去翻 Editor.log。
 *
 * `phase: 'compile'` 是**给写路径看的**：编译失败意味着脚本**从未执行**，`withWriteRecheckHint`
 * 不得再追加「写入是否生效未知」（见 `lib/scene.js`）。
 *
 * @param {object} json uloop 原始 JSON（调用方保证 `isScriptCompileFailure(json) === true`）
 * @param {string|null} scriptPath `--code-file` 的**完整路径**，可为 null
 * @returns {object} 失败信封
 */
function scriptCompileFailure(json, scriptPath) {
  // basename 只用于 `actual.script`（既有断言要 `'prefab-create.cs'`）；hint 用完整路径。
  const scriptName = scriptPath ? scriptPath.split(/[\\/]/).pop() || null : null;
  const errors = compressIssues(json.CompilationErrors);
  // 「可读」= 条目带非空 `Message`。`compressIssues` 不丢条目（`[{}]` 也会进 `errors`），
  // 若直接取 `errors[0]`，一条无 message 的条目会产出 `C# 脚本编译失败：<unknown>:? ` ——
  // 那既不比 `ErrorMessage` 可读，还把真正的诊断文案吞掉（R435 的初衷正是「报文可读」）。
  const first = errors.find((x) => x.message !== '');
  // R111④ 同口径：`json` 是**未合并**的原始载荷，`json.Error` 可以是对象 —— 直接兜底会产出
  // `C# 脚本编译失败：[object Object]`。必须 `typeof === 'string'` 守卫（`fromUloop` 亦如此）。
  const errorText = typeof json.Error === 'string' && json.Error !== '' ? json.Error : null;
  const fallback = json.ErrorMessage || errorText || '见 actual.errors';
  return {
    ...fail({
      code: 'SCRIPT_COMPILE_ERROR',
      message: `C# 脚本编译失败：${first ? `${first.file ?? scriptName ?? '<unknown>'}:${first.line ?? '?'} ${first.message}` : fallback}`,
      actual: {
        errors,
        errorMessage: typeof json.ErrorMessage === 'string' ? json.ErrorMessage : null,
        script: scriptName ?? null,
      },
      hint: [
        ...(first ? [`首条：${first.message}`] : []),
        scriptPath ? `修正 ${scriptPath} 后重试（编辑器控制台也会显示）` : '修正 C# 片段后重试（编辑器控制台也会显示）',
      ],
    }),
    phase: 'compile',
  };
}

/**
 * 把 uloop 的 JSON 结果映射成本项目信封（不丢信息）。
 *
 * 成功判定**只认字面量 `json.Success === true`** —— `'true'` / `1` 等真值
 * 都不算成功（字符串 `'false'` 曾是「真值判成功」的漏洞）。
 * 失败判定只认字面量 `json.Success === false`（uloop 自己报的失败）；
 * `Success` 缺失或不是布尔（如 `{}` / `[]` / `Success:'false'`）说明这压根不是
 * uloop 信封，落 `ULOOP_BAD_PAYLOAD`（终态，不可重试），而不是复用
 * `ULOOP_ERROR` 把「这不是 uloop 响应」误报成「uloop 失败」。
 *
 * ⚠️ **失败有两种形状**（R108，2026-09-19 真机 + vendor 实证）：
 *   - **dispatcher 级**：嵌套 `Error:{ErrorCode,Message,Phase,Retryable,NextActions}`
 *     （PITFALLS U6 实录）；
 *   - **first-party 工具级**：**平铺** `{Success:false, Message, NextActions}`
 *     —— 无 `Error` 子对象、无 `ErrorCode`，**也没有 `Retryable`**
 *     （上游 `uloopmcp` 包内 `Editor/ToolContracts/ScreenshotResponse.cs:35-42`；
 *     F5 修正：旧注释误把 `Retryable` 写进平铺形状，并错引 `ScreenshotCaptureResults.cs:28-37`）。
 * 只读 `Error` 会让所有工具级失败落成「未提供 Message」+ 空 hint + `retryable:false`
 *（平铺形状没有 `Retryable`，下方 `Boolean(e.Retryable)` 即为 false —— 并非「上游明说不可重试」）。
 * 故先把两种形状**合并**成同一取值面（嵌套字段优先），再逐字段取。合并对 dispatcher 级零影响
 *（外层只有 `Success`）。
 *
 * @param {unknown} json
 * @returns {object} 信封
 */
function fromUloop(json) {
  if (!json || typeof json !== 'object') {
    return fail({
      code: 'ULOOP_NO_JSON',
      message: 'uloop 未返回可解析的 JSON',
      hint: [
        '确认 uloop dispatcher 路径正确（PI_UNITY_ULOOP_BIN）',
        '确认编辑器已打开目标项目',
        '用 `unity doctor` 查看完整环境状态',
      ],
    });
  }
  if (json.Success === true) {
    return ok(json);
  }
  if (json.Success !== false) {
    return fail({
      code: ULOOP_BAD_PAYLOAD,
      message: 'uloop 返回的 JSON 不是 uloop 信封（Success 字段缺失或非布尔）',
      actual: json,
      hint: [
        '确认 PI_UNITY_ULOOP_BIN / PI_UNITY_ULOOP_CMD 指向的是 uloop dispatcher 而非其它程序',
        '手工执行该工具并检查原始输出是否含布尔 Success 字段',
        '用 `unity doctor` 查看完整环境状态',
      ],
    });
  }
  const e = json.Error && typeof json.Error === 'object' ? { ...json, ...json.Error } : json;
  // R111④ + R435/D-A4：`Message` 必须是非空**字符串**才进信封（真值非字符串会让 emit 打成
  // `[object Object]`）。**兜底必须再读 `ErrorMessage`** —— 上游动态代码载荷（成功与失败都是）
  // **根本没有 `Message` 字段**，只有 `ErrorMessage`（真机实测，docs/M5-PROBES.md P2）；
  // 只认 `Message` 正是「payload 类命令编译错报文不可读」（R435）的根因之一。
  // 第三级再读字符串 `Error`（code 审 💡2）：`json.Error` 是**对象**时会被上面的合并吃进 `e`，
  // 故必须 `typeof === 'string'` 守卫，否则会把对象打成 `[object Object]`。
  // 回退不是「吞掉」：怪载荷留在 `actual` 里供排障（与 R105「不吞上游字段」一致）。
  const hasMessage = typeof e.Message === 'string' && e.Message !== '';
  const hasErrorMessage = typeof e.ErrorMessage === 'string' && e.ErrorMessage !== '';
  const hasErrorText = typeof e.Error === 'string' && e.Error !== '';
  const envelope = fail({
    code: e.ErrorCode || 'ULOOP_ERROR',
    message: hasMessage ? e.Message : (hasErrorMessage ? e.ErrorMessage : (hasErrorText ? e.Error : 'uloop 返回失败但未提供 Message')),
    actual: e.Details || (hasMessage ? null : (e.Message ?? e.ErrorMessage ?? null)),
    hint: Array.isArray(e.NextActions) ? e.NextActions : [],
    phase: e.Phase,
    retryable: Boolean(e.Retryable),
  });
  // R475/U49：uloop 是**单飞**的 —— 并发被拒有两种外观：
  //   · 动态代码载荷被 Unity 执行槽拒绝 → Success:false + ErrorMessage 含哨兵文案（上游无 ErrorCode）；
  //   · dispatcher 侧直接拒绝 → ErrorCode='UNITY_SERVER_BUSY'。
  // 两者都必须指向「串行重试」，否则 agent 会去查编译错 / 重开编辑器（都是错方向）。
  if (envelope.code === 'UNITY_SERVER_BUSY' || isExecutionInProgress(envelope.message)) {
    return { ...envelope, retryable: true, hint: [...envelope.hint, CONCURRENT_HINT] };
  }
  return envelope;
}

/**
 * 把 `call()` 的返回值映射成信封 —— **唯一**的截断感知入口（M2 任务 1，M1 延后项⑤）。
 *
 * 为什么必须有这一层：`lib/uloop.js` 已经算出 `truncated`（`timedOut || spawnError || drained`），
 * 且契约保证「`truncated === true` 时 `json` 必为 null」。但 M1 的调用点全都直接 `fromUloop(r.json)`，
 * 于是「输出被截断」与「压根没拿到 JSON」都落成 `ULOOP_NO_JSON`，诊断差异被抹平，
 * `RETRYABLE_CODES` 里的 `ULOOP_TRUNCATED` 成了没有任何产出点的死码。
 *
 * ⚠️ 残缺输出里的 JSON 片段可能是**看起来合法**的错值（`{"Success":true,"Items":[{"id":1},` 能解析出 `{"id":1}`），
 * 所以这里**只看 `truncated`，不看 `json` 是否非空**；调用方也**不得**自行重解析 stdout/stderr。
 *
 * @param {object} r `lib/uloop.js` 的 `call()` 返回值
 * @returns {object} 信封
 */
function envelopeFromCall(r) {
  if (r && r.truncated === true) {
    return fail({
      code: 'ULOOP_TRUNCATED',
      message: 'uloop 输出被截断（超时被杀 / dispatcher 未起来 / 管道未收尾），本次调用结果不可信',
      actual: {
        tool: r.tool ?? null,
        args: Array.isArray(r.args) ? r.args : null,
        code: r.code,
        timedOut: Boolean(r.timedOut),
        drained: Boolean(r.drained),
        spawnError: r.spawnError ? String(r.spawnError.message || r.spawnError) : null,
      },
      hint: [
        '按失败处理：残缺输出里的 JSON 片段可能是错值，不要自行重解析 stdout/stderr',
        '确认编辑器已打开目标项目（用 `unity doctor` 查看环境）',
        '可限次重试（≤3 次 + 退避）；重试前先读本 hint 排除终态原因（dispatcher 路径错、项目没打开）',
      ],
      phase: 'transport',
    });
  }
  const json = r ? r.json : null;
  // R435：编译失败的识别必须在**截断判定之后**（截断时 json 恒为 null，进不来），
  // 且放在 fromUloop 之前 —— 这是唯一能一处覆盖全部 payload 命令的位置（15 个调用点）。
  if (isScriptCompileFailure(json)) {
    return scriptCompileFailure(json, scriptPathFromArgs(r));
  }
  return fromUloop(json);
}

/** 输出信封。人类可读或 --json。 */
function emit(envelope, { json = false, stream = process.stdout } = {}) {
  if (json) {
    stream.write(JSON.stringify(envelope, null, 2) + '\n');
    return;
  }
  if (envelope.ok) {
    const mark = envelope.verified === true ? 'VERIFIED' : envelope.verified === false ? 'UNVERIFIED' : 'OK';
    stream.write(`[${mark}] ${envelope.code || ''} ${JSON.stringify(envelope.actual)}\n`.replace('  ', ' '));
  } else {
    stream.write(`[FAIL] ${envelope.code}: ${envelope.message}\n`);
    for (const h of envelope.hint) stream.write(`  hint: ${h}\n`);
  }
}

module.exports = {
  ok, fail, fromUloop, envelopeFromCall, emit, RETRYABLE_CODES,
  USAGE_FAILURE_CODES, isUsageFailure, exitCodeFor, EXIT_USAGE,
  scriptCompileFailure, scriptNameFromArgs, scriptPathFromArgs,
};
