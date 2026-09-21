'use strict';

/**
 * 场景**文件**写命令：`unity scene save` / `unity scene open`（M3 任务 2，关闭 E2E B2）。
 *
 * 为什么单独一个模块：`lib/scene.js` 管的是场景里的**节点**（读回面是 `node-inspect`）；
 * 这两个命令改的是**场景文件/当前打开的场景**，读回面是 `get-hierarchy` 的 `sceneName`
 * —— 载体不同，但验证纪律完全相同：
 *   - 写命令 → **必须写后读回**（`readBackAndVerify`，本文件不重写第二份）；
 *   - 读回失败 → `READBACK_FAILED`（`ok:false`），**绝不假绿**；
 *   - 用法错只由 argv 决定，**在任何 uloop 调用之前**收敛（`MISSING_PATH` /
 *     `BAD_TARGET_PATH` 已在 `lib/envelope.js` 的冻结表内 → 退出码 2）；
 *   - 运行时错（`NO_SCENE` / `SAVE_FAILED` / `SCENE_NOT_FOUND` / `DIRTY_SCENE` /
 *     `OPEN_FAILED`）不在表内 → 退出码 1。
 */

const { call } = require('./uloop.js');
const { fail, envelopeFromCall } = require('./envelope.js');
const {
  buildPayloadArgs, parseScriptResult, readBackAndVerify, sceneTree, withWriteRecheckHint,
} = require('./scene.js');

/** argv 值的人读化（`--path` 裸写 → `true`；空串原样可见）。 */
function describeArg(v) {
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
}

/**
 * R359：`sceneOpen` **成功**信封的提示 —— CLI 用户/agent 读的是信封，不是 SKILL/PITFALLS。
 *
 * 事实（U27 / R357 真机实测）：`execute-dynamic-code` 里的场景改动**不置 `Scene.isDirty`**，
 * 所以 ① 脏场景守卫只能看见编辑器 UI 造的改动；② CLI 自己造的改动会被 `scene open` **默默挤掉**
 * （它们既没落盘、也不在新场景里）。切场景前必须 `unity scene save`。
 */
const OPEN_SUCCESS_HINT = '⚠️ 本命令只按 sceneName 读回比对；**CLI 造的未保存改动不置 isDirty**，所以脏场景守卫拦不住它们 —— 若你刚用 CLI 改过场景，那些改动不在新场景里，切场景前请先 `unity scene save`';

/**
 * R361：把 `.cs` 的磁盘硬证据（`mtimeBefore` / `mtimeAfter`，ISO 字符串）透传进成功信封的 `actual`。
 *
 * 只透传**非空字符串**：缺字段 / 空值时保持 `actual` 与 intent 同形（不引入 `undefined` 噪音）。
 * `compareSubset` 只遍历 intent 的键，所以附加字段不影响 `verified`。
 */
function mtimeEvidence(parsed) {
  const out = {};
  for (const key of ['mtimeBefore', 'mtimeAfter']) {
    if (typeof parsed[key] === 'string' && parsed[key] !== '') out[key] = parsed[key];
  }
  return out;
}

/**
 * `Assets/Scenes/SampleScene.scene` → `SampleScene`（`.unity` 也接受）。
 *
 * `scene open` 的 `intent.sceneName` 由**请求的路径**派生（brief 契约：「读回 `sceneName`
 * 与请求的场景名比对」）—— 这样即使 `.cs` 的回报不可信，读回面也有一份独立的期望值。
 */
function sceneNameFromPath(p) {
  const base = p.split(/[\\/]/).pop() || '';
  return base.replace(/\.(scene|unity)$/i, '');
}

/**
 * `--path` 的用法守卫（**只由 argv 决定**，必须在任何 uloop 调用之前收敛）。
 *
 * - 缺失：`scene open` 必填 → `MISSING_PATH`；`scene save` 可选 → 放行（保存全部打开场景）。
 * - 裸写（`parseArgs` 给 `true`）/ 空串 / 空白串 / 非字符串 → `BAD_TARGET_PATH`
 *   —— 裸写**不能**当作「没给 path」放行，否则 `--path` 手滑会静默变成 `SaveOpenScenes()`。
 * - 路径推不出场景名（如 `--path /`）→ `BAD_TARGET_PATH`：intent 会是空串，读回比对失去意义。
 *
 * @param {*} raw `args.path`
 * @param {{required: boolean}} opts `required` 为 true 表示缺失即用法错
 * @returns {object|null} 失败信封或 `null`（放行）
 */
function pathUsageFailure(raw, { required }) {
  if (raw === undefined || raw === null) {
    if (!required) return null;
    return fail({
      code: 'MISSING_PATH',
      message: '缺少 --path（场景资产路径，形如 Assets/Scenes/SampleScene.scene）',
      actual: { path: raw },
      hint: [
        '用 `unity scene tree --json` 看当前场景名；路径写 asset 相对路径（以 Assets/ 开头）',
        '打开场景必须显式指定目标 —— 本命令不会猜你要打开哪一个',
      ],
    });
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return fail({
      code: 'BAD_TARGET_PATH',
      message: `--path 需要非空字符串（场景资产路径），收到 ${describeArg(raw)}`,
      actual: { path: raw },
      hint: [
        '路径形如 Assets/Scenes/SampleScene.scene（asset 相对路径）',
        '`--path` 裸写（不带值）也属此类 —— 请补上值，或整体省略该开关',
      ],
    });
  }
  if (sceneNameFromPath(raw) === '') {
    return fail({
      code: 'BAD_TARGET_PATH',
      message: `--path 不是场景文件路径（推不出场景名）：${describeArg(raw)}`,
      actual: { path: raw },
      hint: ['路径要以 .scene / .unity 结尾，如 Assets/Scenes/SampleScene.scene'],
    });
  }
  return null;
}

/**
 * 写调用 + 传输层/脚本协议收敛（本模块两个写命令共用一份）。
 *
 * 与 `lib/scene.js` 的 `nodeCreate` / `nodeSet` 同构：
 *   - 写调用 reject → `WRITE_CALL_FAILED`（不冒成 internal error + 退出码 3）；
 *   - `truncated` → 透传 `ULOOP_TRUNCATED` + 写路径专属 hint（`withWriteRecheckHint`）；
 *   - `.cs` 的 `__error` → `parseScriptResult` 的 `describeError` 映射成具名失败码。
 *
 * @param {{scriptName: string, payload: object, projectPath?: string, env?: object,
 *   callFn: typeof call, intent: object, describeError?: Function}} opts
 * @returns {Promise<{parsed: object}|{envelope: object}>} 二者恰有其一
 */
async function writeScene({ scriptName, payload, projectPath, env, callFn, intent, describeError }) {
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs(scriptName, payload), { projectPath, env });
  } catch (err) {
    return {
      envelope: fail({
        code: 'WRITE_CALL_FAILED',
        message: `${scriptName} 写调用失败：${(err && err.message) || String(err)}`,
        intent,
        hint: [
          '写入是否生效未知；先用 `unity scene tree` 复核当前场景状态',
          '确认编辑器已打开目标项目（用 `unity doctor` 查看环境）',
        ],
        phase: 'write',
      }),
    };
  }
  const envl = envelopeFromCall(w);
  // 写路径的传输层失败不是纯读故障（保存可能已经落盘、打开可能已经生效）→ 补复核 hint
  if (!envl.ok) return { envelope: withWriteRecheckHint(envl) };
  const res = parseScriptResult(w, { label: scriptName, describeError });
  if (res.envelope) return { envelope: res.envelope };
  return { parsed: res.parsed };
}

/**
 * 写后读回的**读回面**：`scene tree` 的 `sceneName`。
 *
 * 读失败时抛出的 Error 带 `envelope` —— `readBackAndVerify` 会把它收敛成
 * `READBACK_FAILED`（含原始 `code` / `actual` / `hint`），**绝不产出 `ok`**。
 *
 * @param {{projectPath?: string, env?: object, callFn: typeof call, key: 'saved'|'opened'}} opts
 *   `key` 是写命令的完成标记（`saved` / `opened`），让 intent 与 actual 同形可比。
 * @returns {Promise<object>} 与 intent 同形的 actual（`{<key>: true, sceneName: string}`）
 */
async function readSceneName({ projectPath, env, callFn, key }) {
  const read = await sceneTree({ projectPath, env, _call: callFn });
  if (!read.ok) {
    const err = new Error(`读回失败（${read.code}）：${read.message}`);
    err.envelope = read;
    throw err;
  }
  return { [key]: true, sceneName: read.actual.sceneName };
}

/**
 * `unity scene save`：保存场景 + **写后读回**。
 *
 * - 有 `--path` → `EditorSceneManager.SaveScene(活动场景, path)`；
 * - 无 `--path` → 逐场景 `EditorSceneManager.SaveScene(scene, scene.path)`（保存全部打开的场景；
 *   `.cs` 侧会先挡下未命名场景 —— 那会弹模态保存对话框、把编辑器主线程阻塞住）；
 *   ⚠️ **R356 真机实测（团结 2022.3.62t9）**：`EditorSceneManager.SaveOpenScenes()` **返回 true
 *   却什么都不写**（文件 mtime/size/md5 全不变），所以 `.cs` 不用它 —— 逐场景 `SaveScene` 才真的落盘。
 *   根因是 **R357**：动态代码建的节点**不置 `Scene.isDirty`**（实测 roots 5→6 而 `isDirty` 仍 False），
 *   而 `SaveOpenScenes` 只保存 dirty 的场景 → 它对 CLI 造出的改动天然无感。
 *   因此 `.cs` 的硬证据是**每次保存后文件 mtime 必须前进**（不是 `isDirty`）；
 *   没前进就落 `SAVE_FAILED`，把「报告成功但没落盘」变成响亮失败。
 * - 读回：`scene tree` 的 `sceneName` 必须与 `.cs` 回报的 `name` 一致 → `verified` 布尔。
 *
 * `.cs` 的回报必须符合协议（`__saved === true` + 非空 `name`）：否则**不读回**、
 * 直接 `BAD_SCRIPT_RESULT` —— 沿 `nodeDelete` 的 R225 口径（协议不符时若沿用入参读回，
 * 会产出**无证据的** `verified:true`）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, path?: string, _call?: typeof call}} [opts]
 * @returns {Promise<object>} 信封（成功时 `verified` 为布尔，绝非 null）
 */
async function sceneSave({ projectPath, env, path: targetPath, _call } = {}) {
  const usage = pathUsageFailure(targetPath, { required: false });
  if (usage) return usage;
  const callFn = _call || call;
  // 写失败时能给出的期望值：有 --path 时就是它的场景名；无 --path 时保存的是「当前场景」，
  // 期望名要等 `.cs` 回报（`{saved:true}` 已经足够标明意图）。
  const writeIntent = targetPath === undefined
    ? { saved: true }
    : { saved: true, sceneName: sceneNameFromPath(targetPath) };
  const res = await writeScene({
    scriptName: 'scene-save',
    payload: targetPath === undefined ? {} : { path: targetPath },
    projectPath,
    env,
    callFn,
    intent: writeIntent,
    describeError: (code, parsed) => {
      if (code === 'NO_SCENE') {
        return {
          message: `没有可保存的场景：${typeof parsed.detail === 'string' && parsed.detail !== '' ? parsed.detail : '没有活动场景或场景未命名'}`,
          actual: parsed,
          hint: [
            '用 `unity scene save --path Assets/Scenes/X.scene` 给未命名场景指定落盘路径',
            '用 `unity scene tree --json` 看当前场景（`sceneName` 为空串 = 未命名）',
          ],
        };
      }
      if (code === 'SAVE_FAILED') {
        return {
          message: `保存场景失败：${typeof parsed.detail === 'string' && parsed.detail !== '' ? parsed.detail : 'SaveScene 未成功'}`,
          actual: parsed,
          hint: [
            '确认 `--path` 以 Assets/ 开头且父目录存在（如 Assets/Scenes）',
            '确认场景文件没被外部程序锁住、磁盘可写',
            // R356/R357：硬证据是「文件 mtime 前进」，不是 isDirty（动态代码的改动不置 isDirty）
            '`detail` 说「保存后文件 mtime 未前进」意味着这次保存没真正落盘 —— 不要当成功看待',
          ],
        };
      }
      return {};
    },
  });
  if (res.envelope) return res.envelope;

  // 协议校验（同 nodeDelete 的 R225）：`name` 是读回比对的期望值，必须有据可依
  if (res.parsed.__saved !== true || typeof res.parsed.name !== 'string' || res.parsed.name === '') {
    return fail({
      code: 'BAD_SCRIPT_RESULT',
      message: 'scene-save 的写结果不符合协议（需要 {"__saved":true,"name":"<非空场景名>",…}）',
      intent: writeIntent,
      actual: res.parsed,
      hint: [
        '检查 unity-scripts/scene-save.cs：`__saved` 必须为 true、`name` 必须是非空字符串',
        '确认 `--code-file` 指向的是 scene-save.cs',
      ],
    });
  }

  return readBackAndVerify({
    projectPath,
    env,
    callFn,
    intent: { saved: true, sceneName: res.parsed.name },
    // R361：读回面补上写脚本的磁盘硬证据（mtime before/after）——`--json` 用户能自查
    readActual: async () => ({
      ...(await readSceneName({ projectPath, env, callFn, key: 'saved' })),
      ...mtimeEvidence(res.parsed),
    }),
    residue: '保存可能已生效（.scene 文件可能已写盘）；先用 `unity scene tree` 与磁盘上的场景文件复核，再决定是否重试',
    mismatchHint: '读回的场景名与保存结果不一致（verified:false）——不要继续叠加命令：先 `unity scene tree --json` 确认当前到底打开着哪个场景（多场景打开时读回只取第一个）',
  });
}

/**
 * `unity scene open`：打开场景 + **写后读回**，带**脏场景守卫**。
 *
 * 脏场景守卫（约束：不许静默丢改动）：活动场景 `isDirty` 且没给 `--force` 时，`.cs`
 * 拒绝打开并回 `DIRTY_SCENE` —— 真机行为上 `EditorSceneManager.OpenScene` **不弹对话框**、
 * 会直接丢弃未保存改动，所以守卫必须由本命令自己承担。
 *
 * 守卫失败的 hint 必须给出**两条出路**：① 先 `unity scene save`；② 确实要丢弃改动就加
 * `--force`（并写明会丢失未保存改动）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, path?: string, force?: *,
 *   _call?: typeof call}} [opts] `force` 只认字面 `true`（裸 `--force` 由 argv 给 `true`）
 * @returns {Promise<object>} 信封（成功时 `verified` 为布尔，绝非 null）
 */
async function sceneOpen({ projectPath, env, path: targetPath, force, _call } = {}) {
  const usage = pathUsageFailure(targetPath, { required: true });
  if (usage) return usage;
  const callFn = _call || call;
  const intent = { opened: true, sceneName: sceneNameFromPath(targetPath) };
  const res = await writeScene({
    scriptName: 'scene-open',
    // `force` 归一成布尔：argv 的裸 `--force` 是 true，`--force=abc` 这类取值一律当 false
    // （安全方向：脏场景守卫只会更严，不会更松），`.cs` 侧也就不用处理非布尔取值。
    // **CLI 侧**由 `normalizeBooleans` 提前挡下（`BAD_FLAG_VALUE`）；本库级分支仍保留，
    // 供直接调用库的调用方使用。
    payload: { path: targetPath, force: force === true },
    projectPath,
    env,
    callFn,
    intent,
    describeError: (code, parsed) => {
      if (code === 'DIRTY_SCENE') {
        const active = typeof parsed.active === 'string' && parsed.active !== '' ? parsed.active : '未命名';
        return {
          message: `当前场景有未保存改动（${active}）：未给 --force，拒绝打开（不静默丢改动）`,
          actual: parsed,
          hint: [
            '先保存再打开：`unity scene save`（未命名场景用 `unity scene save --path Assets/Scenes/X.scene`）',
            '确实要丢弃这些未保存改动就加 `--force`（⚠️ 改动会丢失且不可恢复）',
          ],
        };
      }
      if (code === 'SCENE_NOT_FOUND') {
        return {
          message: `场景文件不存在：${targetPath}`,
          actual: parsed,
          hint: [
            '路径要写 asset 相对路径（如 Assets/Scenes/SampleScene.scene）',
            '确认项目 Assets/ 下确实有该 .scene 文件（可先用 `unity scene tree` 看当前场景）',
          ],
        };
      }
      if (code === 'OPEN_FAILED') {
        return {
          message: `打开场景失败：${typeof parsed.detail === 'string' && parsed.detail !== '' ? parsed.detail : 'OpenScene 未成功'}`,
          actual: parsed,
          hint: [
            '确认该 .scene 是合法 Unity 场景文件且未被破坏',
            '确认编辑器不在 PlayMode / 编译中，且没有别的模态窗口挡着',
          ],
        };
      }
      return {};
    },
  });
  if (res.envelope) return res.envelope;

  if (res.parsed.__opened !== true) {
    return fail({
      code: 'BAD_SCRIPT_RESULT',
      message: 'scene-open 的写结果不符合协议（需要 {"__opened":true,…}）',
      intent,
      actual: res.parsed,
      hint: [
        '检查 unity-scripts/scene-open.cs：`__opened` 必须为 true',
        '确认 `--code-file` 指向的是 scene-open.cs',
      ],
    });
  }

  return readBackAndVerify({
    projectPath,
    env,
    callFn,
    intent,
    readActual: () => readSceneName({ projectPath, env, callFn, key: 'opened' }),
    // R359：成功信封必须自己说出「CLI 造的未保存改动不置 isDirty」这个坑（不许只写在 SKILL/PITFALLS 里）
    successHint: [OPEN_SUCCESS_HINT],
    residue: '打开可能已生效（当前场景可能已经换了）；先用 `unity scene tree` 复核当前场景名',
    mismatchHint: '读回的场景名与请求的不一致（verified:false）——不要继续叠加命令：先 `unity scene tree --json` 确认当前打开的是哪个场景（多场景打开时读回只取第一个）',
  });
}

module.exports = { sceneSave, sceneOpen };
