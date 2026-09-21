'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { call } = require('./uloop.js');
const { fail, ok, envelopeFromCall } = require('./envelope.js');
const { normalizeAssetTo, foldAssetSlashes } = require('./assetpath.js');
const { nodeInspect, buildPayloadArgs, parseScriptResult, readBackAndVerify, withWriteRecheckHint } = require('./scene.js');
// `compareSubset` / `isPlainObject`：实例读回的**额外校验**（资产根的局部 position/scale）
// 复用读回模块同一套比较语义（容差、F2 类型判），不在这里另写一份比较。
const { compareSubset, isPlainObject } = require('./readback.js');

/**
 * `Assets/` 下、`.prefab` 结尾、不含 `..` 的路径。
 *
 * 与 `lib/sprite.js` 的 `normalizeAssetPath` 同一口径，但**不共用**：那里的错码是
 * MISSING_ASSET/BAD_ASSET_PATH，`prefab create` 的 `--to` 要走 MISSING_TO/BAD_TARGET_PATH
 * （复用 `lib/assetpath.js`），且必须**额外**以 `.prefab` 结尾（`.png` 是合法资产路径但不是 Prefab）。
 *
 * @param {*} v 原始 argv 值
 * @returns {string|null} 归一后的路径（折叠重复 `/`、去掉 `./` 段，R439）；非法 → `null`
 */
function normalizePrefabPath(v) {
  if (typeof v !== 'string' || v === '') return null;
  const normalized = foldAssetSlashes(v.replace(/\\/g, '/'));
  if (segmentsIncludeParentRef(normalized)) return null;
  return /^Assets\//.test(normalized) && normalized.endsWith('.prefab') ? normalized : null;
}

/** `..` **按段**判（`Assets/a..b.prefab` 里的 `..` 不是独立段）—— 与 `lib/sprite.js` 同口径。 */
function segmentsIncludeParentRef(p) {
  return p.split('/').includes('..');
}

/**
 * Prefab **根节点的名字** —— 由资产路径推得（`Assets/Prefabs/Brick.prefab` → `Brick`）。
 *
 * ⚠️ **不是**源节点的名字（R432）：真的 Unity 语义是「`SaveAsPrefabAsset(go, path)` 把
 * 保存后的 Prefab 根 GameObject 名改成**文件 basename**」——
 * 源节点名不变，但写进资产的根名 = 文件名。真机证据：源 `NameProbe` + `--to DifferentName.prefab`
 * → 落盘 YAML `m_Name: DifferentName`、读回 `name: "DifferentName"`、源节点仍是 `NameProbe`
 * （`…/real-machine/task6-name-mismatch.json`、`task6fix-name-different.json`；
 * 二次观测 `docs/M4-PROBES.md` §②-10② 的 `out2_rootName: ChildOut`）。
 *
 * 因此 intent 的 `name` 必须用「Unity 会写进去的那个名字」= 本条；拿源节点名去断言，
 * 只要 `--to` 的 basename ≠ 源节点名就**必假红**（简报 step 5 的示例正落在这条上）。
 *
 * ⚠️ **只适用于 `prefab create`**：根名 = 文件名是 `SaveAsPrefabAsset` 的行为。
 * `prefab instantiate` **不得**用本函数猜根名（R438）—— 外部 Prefab（不是本工具存的）
 * 根名完全可以 ≠ 文件名，猜出来的期望值会假红；实例化侧的期望根名一律取
 * **资产读回的真实根名**（`readPrefabAsset`）。
 *
 * @param {string} assetPath 项目内资产路径（如 `Assets/Prefabs/Brick.prefab`）
 * @returns {string} 根节点名（如 `Brick`）
 */
function prefabRootName(assetPath) {
  return path.basename(assetPath, '.prefab');
}

/**
 * 从 node inspect 的读回里抽出「Prefab 该长成什么样」的投影（**intent 的唯一来源**）。
 *
 * ⚠️ `position` / `scale` 是 `node-inspect.cs` 的**局部**值（`localPosition`/`localScale`）。
 * 这与 Prefab 根语义天然对齐：`SaveAsPrefabAsset` 存下来的就是这个节点的**局部**变换
 * （任务 5 真机 §②-10②：源是子节点时，Prefab 根保留子节点的 local 值，**不是**世界坐标）
 * → intent / actual 同口径，不会假红，也**不需要**在 JS 侧重算任何世界坐标。
 *
 * ⚠️ **不**放 `worldSize` / `ppu` 之类要靠 Unity 计算的字段：那等于在 JS 侧重新实现
 * Unity 的 sprite 语义，两边一旦漂移就会假红（`lib/sprite.js` 的同一纪律）。
 *
 * @param {{name?: string, position?: object, scale?: object, components?: string[],
 *   sprite?: {assetPath?: string|null}|null}} node
 *   `nodeInspect` 的 `actual`
 * @returns {{name: *, position: *, scale: *, spriteAssetPath: string|null, components: string[]|null}}
 */
function nodeProjection(node) {
  const n = node && typeof node === 'object' ? node : {};
  const sprite = n.sprite && typeof n.sprite === 'object' ? n.sprite : null;
  const assetPath = sprite && typeof sprite.assetPath === 'string' && sprite.assetPath !== '' ? sprite.assetPath : null;
  return {
    name: n.name,
    position: n.position,
    scale: n.scale,
    spriteAssetPath: assetPath,
    // R448：把源节点的组件名列表带进 intent —— 空节点场景下这是**唯一**有鉴别力的字段
    //   （其余四个都是常量默认值，任何空 Prefab 都能满足）。口径与 `prefab-create.cs`
    //   的 read 模式逐字对齐（`GetComponents<Component>()` 过滤 null 后取类型名）。
    // ⚠️ 源节点**没有** components 字段时写 null 而不是 []：写 [] 会在 `compareSubset`
    //   的数组语义下与「Prefab 里一个组件都没有」混淆。
    // ⚠️ 不做归一/排序（归一化会抹掉真实分歧）。
    components: Array.isArray(n.components) ? n.components : null,
  };
}

/**
 * `unity prefab create`：把场景里的节点存成 Prefab 资产（**覆盖 = 更新**，guid 不变）。
 *
 * 写后读回分两段：① 写调用只证明「SaveAsPrefabAsset 返回了非空」；
 * ② **独立一次** read 调用把**资产里的内容**读回来，与「源节点的投影」比对 —— 这才证明
 * 「Prefab 里装的确实是那个节点」（而不是一个空壳）。extraCheck 再补一条磁盘防线（文件真的在、非空）。
 *
 * 覆盖语义（真机证据 `docs/M4-PROBES.md` §②-2 / §②-8）：同名覆盖 → **guid 不变、内容更新**
 * → 引用它的实例/场景不会断；但**已有实例的根 `localPosition` 永不跟随**（规则③）。
 *
 * ⚠️ 源节点是 **Prefab 实例**：由 `.cs` 拒绝（`SOURCE_IS_PREFAB_INSTANCE`）—— 拿实例当源，
 * `SaveAsPrefabAsset` 会**静默**产出 Prefab **变体**（R430 / §②-10①）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, fromNode?: string, to?: string, force?: boolean,
 *   _call?: typeof call, _exists?: (p: string) => boolean, _stat?: (p: string) => import('node:fs').Stats,
 *   _mkdirp?: (p: string) => void}} [opts]
 * @returns {Promise<object>} 信封
 */
async function prefabCreate({ projectPath, env, fromNode, to, force, _call, _exists, _stat, _mkdirp } = {}) {
  if (typeof fromNode !== 'string' || fromNode === '') {
    return fail({
      code: 'MISSING_PATH',
      message: '缺少 --from-node（要存成 Prefab 的节点路径）',
      actual: { fromNode },
      hint: ['用 `unity scene tree` 取可用路径'],
    });
  }
  const toCheck = normalizeAssetTo(to, {
    sample: 'Assets/Prefabs/Brick.prefab',
    missingHint: '用法：unity prefab create --project-path <P> --from-node Brick_0_0 --to Assets/Prefabs/Brick.prefab',
    badHint: '用法：--to Assets/Prefabs/Brick.prefab',
  });
  if (!toCheck.ok) return toCheck.envelope;
  const normalizedTo = toCheck.path;
  // `.prefab` 后缀是 `prefab create` 独有的约束（`asset write --to` 允许任意脚本路径）
  if (!normalizedTo.endsWith('.prefab')) {
    return fail({
      code: 'BAD_TARGET_PATH',
      message: `--to 必须以 .prefab 结尾：${JSON.stringify(to)}`,
      actual: { to },
      hint: ['用法：--to Assets/Prefabs/Brick.prefab'],
    });
  }
  if (typeof projectPath !== 'string' || projectPath === '') {
    return fail({
      code: 'MISSING_PROJECT_PATH',
      message: '需要 --project-path（本命令要按项目根解析 --to 的落地路径）',
      actual: { to: normalizedTo },
      hint: ['用 --project-path <项目根> 指定项目'],
    });
  }
  const absTo = path.join(projectPath, normalizedTo);
  const exists = _exists || fs.existsSync;
  if (exists(absTo) && force !== true) {
    return fail({
      code: 'ASSET_EXISTS',
      message: `目标已存在：${normalizedTo}（未给 --force）`,
      actual: { path: normalizedTo },
      hint: [
        '覆盖已有 Prefab 属于停止条件（skill §5）：先向用户确认',
        '确认后用 --force（同名覆盖 = 更新，**引用它的实例/场景不会断** —— 见 docs/M4-PROBES.md §②-2）',
        '⚠️ 覆盖**不会**把场景里已有实例的根 `position` 拉回资产的值（根 localPosition 恒被记为 override）；scale 会跟随',
      ],
    });
  }

  const callFn = _call || call;
  // ① 先读源节点 → intent（**必须在写之前**：intent 不能从写的结果倒推）
  const readSrc = await nodeInspect({ projectPath, env, path: fromNode, _call: callFn });
  if (!readSrc.ok) return readSrc;
  // R432：`name` 用 **`--to` 的文件名**（= Unity 会写进资产的 Prefab 根名），**不是**源节点名；
  // 源节点与资产的绑定改由 `position`/`scale`/`spriteAssetPath` 三项钉住（见 `prefabRootName`）。
  const intent = {
    prefab: { asset: normalizedTo, ...nodeProjection(readSrc.actual), name: prefabRootName(normalizedTo) },
  };

  // R455：`prefab-create.cs` 直接 `SaveAsPrefabAsset`，**不建父目录** ——
  // `--to` 的父目录不存在时会落 `PREFAB_SAVE_FAILED`，而旧 hint 只说「确认目录在项目内且可写」
  // （目录确实在项目内、也确实可写）→ 用户无路可走。照 `lib/importart.js` 的既有做法：
  // 在**写调用之前**把父目录建出来（保持可注入的 `_mkdirp` 测试缝）；失败落 `WRITE_FAILED`（运行时码）。
  // 位置选在「读源节点之后」：源节点不存在时**不**留下空目录。
  try {
    (_mkdirp || ((p) => fs.mkdirSync(p, { recursive: true })))(path.dirname(absTo));
  } catch (err) {
    return fail({
      code: 'WRITE_FAILED',
      message: `建不了 --to 的父目录：${(err && err.message) || String(err)}`,
      intent,
      actual: { path: absTo, dir: path.dirname(absTo) },
      hint: [
        '确认项目目录可写、磁盘有空间',
        '`--to` 必须是项目内路径（`<project-path>/Assets/…`）',
        // M3：父路径是**文件**（不是目录）时 `mkdirp` 在这里就失败 —— 它到不了 PREFAB_SAVE_FAILED。
        '父路径是**文件**时会在这一步失败（`mkdir` 建不出目录）：先删掉 / 改名那个同名文件，再重跑',
      ],
      phase: 'write',
    });
  }

  // ② 写
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('prefab-create', { mode: 'write', fromNode, to: normalizedTo }), { projectPath, env });
  } catch (err) {
    return fail({
      code: 'WRITE_CALL_FAILED',
      message: `prefab-create 写调用失败：${(err && err.message) || String(err)}`,
      intent,
      hint: ['Prefab 是否已写出未知；先看 AssetDatabase 里有没有该文件，再决定是否重试'],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  if (!envl.ok) return withWriteRecheckHint(envl);
  const res = parseScriptResult(w, {
    label: 'prefab-create',
    describeError: (code, parsed) => {
      if (code === 'NOT_FOUND') {
        return {
          message: `节点不存在：${fromNode}`,
          actual: { path: fromNode },
          hint: ['用 `unity scene tree` 查看可用路径'],
        };
      }
      if (code === 'SOURCE_IS_PREFAB_INSTANCE') {
        return {
          message: `源节点是 Prefab 实例，已拒绝存成 Prefab：${fromNode}`,
          actual: { path: fromNode },
          // R446：hint 必须给**可执行**路径。CLI 没有「断开连接」这条命令，
          // 「先在场景里 Instantiate 后断开连接再存」是**不可执行**的指引（首轮的真问题）。
          hint: [
            '源节点是 Prefab 实例：先在编辑器里对它 **Unpack Prefab**（右键 → Prefab → Unpack Prefab）把它变成普通节点，'
              + '或就地用 `unity node create` 按原样重建一个普通节点，再跑本命令',
            '拿实例当源时 `SaveAsPrefabAsset` 会**静默**产出一个 Prefab **变体（Variant）**（根名还会被改成文件名）——'
              + ' 本命令拒绝在 verified:true 下交出这种意外工件（docs/M4-PROBES.md §②-10①）',
          ],
        };
      }
      if (code === 'PREFAB_SAVE_FAILED') {
        return {
          message: `SaveAsPrefabAsset 失败：${normalizedTo}`,
          actual: { path: normalizedTo, detail: parsed && parsed.detail },
          hint: ['父目录不存在时本命令会**自动创建**；若仍失败，检查路径是否在项目内、是否可写（只读目录 / 路径被 Unity 拒绝时会落本码）',
            '`--to` 是项目内路径（**不是**宿主绝对路径）',
            '⚠️ 父路径是**文件**的情形会在更早的 `mkdir` 阶段落 `WRITE_FAILED`（不落本码）'],
        };
      }
      return undefined;
    },
  });
  if (res.envelope) return res.envelope;
  const guid = res.parsed && typeof res.parsed.guid === 'string' && res.parsed.guid !== '' ? res.parsed.guid : null;

  // ③ 独立读回资产内容 + 磁盘防线
  const stat = _stat || ((p) => fs.statSync(p));
  return readBackAndVerify({
    projectPath,
    env,
    callFn,
    intent,
    readActual: async () => {
      const r = await callFn('execute-dynamic-code', buildPayloadArgs('prefab-create', { mode: 'read', path: normalizedTo }), { projectPath, env });
      const e2 = envelopeFromCall(r);
      if (!e2.ok) {
        const err = new Error(`读回失败（${e2.code}）：${e2.message}`);
        err.envelope = e2;
        throw err;
      }
      const p2 = parseScriptResult(r, { label: 'prefab-create', describeError: () => undefined });
      if (p2.envelope) {
        const err = new Error(`读回失败（${p2.envelope.code}）：${p2.envelope.message}`);
        err.envelope = p2.envelope;
        throw err;
      }
      // 读回协议：`prefab-create.cs` 的 read 模式把投影包在 `{"__read":{…}}` 里
      // （与 write 的 `{"__written":true}` 同一套哨兵）。**必须解包**：不解包的话
      // `actual.prefab` 会是 `{__read:{…}}`，与 intent 的 `{prefab:{name,position,…}}`
      // 形状不同 → `compareSubset` 记一堆「缺字段」分歧 → 正确操作被报成 verified:false。
      // （简报 step 4 的 `{...p2.parsed}` 少了这一步 —— 简报 step 1 的测试用
      //  `{__read: PREFAB_READ}` 作为 mock，两种写法只有「解包」能同时满足。）
      const readBack = p2.parsed && typeof p2.parsed === 'object' ? p2.parsed.__read : null;
      if (!readBack || typeof readBack !== 'object' || Array.isArray(readBack)) {
        const err = new Error('读回结果不符合协议（缺少 __read 对象）');
        err.envelope = fail({
          code: 'BAD_SCRIPT_RESULT',
          message: 'prefab-create 的 read 模式没有返回 __read 对象',
          actual: p2.parsed,
          hint: ['检查 unity-scripts/prefab-create.cs 的返回协议（read → {"__read":{…}}）'],
        });
        throw err;
      }
      let file = null;
      try {
        const s = stat(absTo);
        file = { path: normalizedTo, bytes: s.size, mtimeMs: s.mtimeMs };
      } catch (err) { file = null; }
      // ⚠️ 读回投影必须与 intent **同形**（intent 是 `{prefab:{…}}`）。
      return { prefab: { ...readBack }, guid, file };
    },
    residue: 'Prefab 可能已经写出；先用 `unity exec` 看 AssetDatabase 里有没有它，再决定是否重试',
    mismatchHint: '读回与源节点不一致（verified:false）——Prefab 里装的内容与场景节点不同；'
      + '逐条查 mismatches（name = `--to` 文件名、position/scale/spriteAssetPath = 源节点、'
      + 'components = 源节点的组件列表）。'
      + '若分歧键是 `file.bytes`：**Unity 侧的内容已经对了**，是**盘上**那个文件没读到 / 为空'
      + '（缺 `--project-path`、或它没指向这个项目 —— Prefab 落在 <project-path>/Assets/… 下）',
    // 写后读回不仅要「Unity 说内容对」，还要：
    //   ① 盘上真有这个非空文件（磁盘防线；`_stat` 缺失/抛异常 → file=null → 记一条分歧，安全方向）；
    //   ② 写调用自报的 guid 与**读回资产**自报的 guid 是同一个（R444）——
    //      不一致就说明「写到的资产」和「读回的资产」不是同一个（路径大小写/被别的进程换掉）。
    extraCheck: (actual) => {
      const out = [];
      if (!(actual.file && actual.file.bytes > 0)) {
        out.push({ key: 'file.bytes', intent: '>0', actual: actual.file });
      }
      const readGuid = isPlainObject(actual.prefab) ? actual.prefab.guid : undefined;
      if (readGuid !== actual.guid) {
        out.push({ key: 'guid', intent: readGuid, actual: actual.guid });
      }
      return out;
    },
  });
}

/** `PREFAB_NOT_FOUND` 的**唯一**文案（资产**预读**与写调用共用 → 同码同 hint，R437）。 */
function prefabNotFoundDetail(assetPath) {
  return {
    message: `Prefab 资产不存在：${assetPath}`,
    actual: { asset: assetPath },
    hint: ['先用 `unity prefab create` 生成它，或核对路径（必须以 .prefab 结尾、在 Assets/ 下）'],
  };
}

/**
 * R437：实例化**之前**读一次**资产**（`prefab-create` 的 read 模式）。
 *
 * 这是实例读回期望值的**唯一来源**：真实根名（R438 —— 外部 Prefab 的根名完全可以 ≠ 文件名，
 * 用 `basename` 猜就是假红）、`spriteAssetPath`、以及资产根的**局部** position/scale。
 * 它是一次**独立于实例**的 Unity 读数 —— 拿它当期望值才有证伪力。
 *
 * `.cs` 自报的 `instancePath` / `isPrefabInstance` / `correspondingSource` **不算**读回面
 * （它们不在 `node inspect` 的字段面上，也拿不到「资产里到底装了什么」这个事实）。
 *
 * 失败映射（R437）：`PREFAB_NOT_FOUND` 必须与实例化自身报**同一个码、同一份 hint** ——
 * 调用方跑的是 `prefab instantiate`，不许出现「prefab-create 返回错误」这种越界文案。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, callFn: typeof call, assetPath: string}} opts
 * @returns {Promise<{ok: true, asset: object} | {ok: false, envelope: object}>}
 */
async function readPrefabAsset({ projectPath, env, callFn, assetPath }) {
  let r;
  try {
    r = await callFn('execute-dynamic-code', buildPayloadArgs('prefab-create', { mode: 'read', path: assetPath }), { projectPath, env });
  } catch (err) {
    return {
      ok: false,
      envelope: fail({
        code: 'READBACK_FAILED',
        message: `读取 Prefab 资产失败：${(err && err.message) || String(err)}`,
        actual: { asset: assetPath },
        hint: [
          '本步在实例化**之前**，场景里不会留下任何实例',
          '确认编辑器已打开目标项目（用 `unity doctor` 查看环境）',
        ],
      }),
    };
  }
  const envl = envelopeFromCall(r);
  if (!envl.ok) return { ok: false, envelope: envl };
  const res = parseScriptResult(r, {
    label: 'prefab-create',
    describeError: (code) => (code === 'PREFAB_NOT_FOUND' ? prefabNotFoundDetail(assetPath) : undefined),
  });
  if (res.envelope) return { ok: false, envelope: res.envelope };
  const readBack = isPlainObject(res.parsed) ? res.parsed.__read : null;
  if (!isPlainObject(readBack)) {
    return {
      ok: false,
      envelope: fail({
        code: 'BAD_SCRIPT_RESULT',
        message: 'prefab-create 的 read 模式没有返回 __read 对象（资产预读协议不符）',
        actual: res.parsed,
        hint: ['检查 unity-scripts/prefab-create.cs 的返回协议（read → {"__read":{…}}）'],
      }),
    };
  }
  return { ok: true, asset: readBack };
}

/**
 * R437：实例应当**沿用资产根的局部 position/scale**（docs/M4-PROBES.md §②-7 实测）。
 *
 * 期望值来自**资产读回**（独立读数）→ 有真实证伪力：读回来的是错对象、或实例被重新定位/
 * 缩放，都会被抓住（首轮 `extraCheck` 只比「`.cs` 自报路径的末段」，那基本是自证）。
 *
 * @param {object} asset `prefab-create` read 模式的投影
 * @param {object} actual `node inspect` 的读回
 * @returns {Array<{key: string, intent: *, actual: *}>} 分歧列表
 */
function transformMismatches(asset, actual) {
  const out = [];
  for (const key of ['position', 'scale']) {
    if (!isPlainObject(asset[key])) continue;
    out.push(...compareSubset({ [key]: asset[key] }, { [key]: actual ? actual[key] : undefined }));
  }
  return out;
}

/**
 * `unity prefab instantiate`：把 Prefab 资产实例化进当前场景（可选挂到父节点下/改名）。
 *
 * 读回面 = `node inspect`（复用既有 helper），读回路径 = `.cs` 自报的 `instancePath`。
 * **期望值**不来自 `.cs`（R437）—— 先用 `prefab-create` read 模式读一次**资产**，拿
 * 真实根名 / `spriteAssetPath` / 资产根的局部 position/scale：
 *   - 给了 `--name` → `intent = {name, path: parent ? `${parent}/${name}` : name}`，
 *     其中 `path` 是 **JS 侧算出的期望路径**，与 `node inspect` 沿父链**自己重算**的 `path` 比；
 *   - 没给 `--name` → 资产有 sprite → `intent = {sprite:{assetPath}}`（资产读回值）；
 *     资产无 sprite → `intent = {name: 资产读回的真实根名}`。
 * ⚠️ **已知窗口**：没给 `--name` 且退回名字断言时，同父下已有同名节点 —— `node inspect` 只会命中
 * 其中一个（同名歧义；Unity **不会**改名，见 PITFALLS **U42** / 账本 R451）→ 要确定归属就显式给
 * `--name`（**不同名**，那时断言的是名字+路径）。
 *
 * ⚠️ 实例**沿用资产根的局部 pos/scale** —— 本命令不提供 `--position`，要挪动就事后 `node set`。
 * `extraCheck` 用资产读回的局部 position/scale 逐字段复核（R437）。
 *
 * ⚠️ `--name` **可选**：不给时实例名 = **Prefab 根节点的名字**（= 资产读回的 `name`，
 * **未必**等于文件名 —— 外部 Prefab 见 R438）。空 intent 是不允许的：`lib/readback.js` 的 F1
 * 对顶层空 intent 直接落 `verified:false` + `<root>` 分歧，会让「写成功」被报成退出码 1（假红）。
 *
 * ⚠️ `--parent` 尾随 `/` 在此归一（R442，与 `node create --parent` 的 R94 **逐字一致**：
 * 只 `replace(/\/+$/, '')`，不额外剥尾随空白）；否则 `.cs` 的 `Split('/')` 得到空段 →
 * 明明存在的父节点落 `PARENT_NOT_FOUND`。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, asset?: string, parent?: string, name?: string,
 *   _call?: typeof call}} [opts]
 * @returns {Promise<object>} 信封
 */
async function prefabInstantiate({ projectPath, env, asset, parent, name, _call } = {}) {
  if (typeof asset !== 'string' || asset === '') {
    return fail({
      code: 'MISSING_ASSET',
      message: '缺少 --asset（要实例化的 Prefab 资产路径）',
      actual: { asset },
      hint: ['用法：unity prefab instantiate --project-path <P> --asset Assets/Prefabs/Brick.prefab'],
    });
  }
  // R439：`--asset` 归一到**规范路径**（折叠重复 `/`、去掉 `./` 段）——
  // 归一结果同时用于**读资产**与**写载荷**，否则「传给 Unity 一个样、读回来又一个样」→ 假红。
  const assetPath = normalizePrefabPath(asset);
  if (assetPath === null) {
    return fail({
      code: 'BAD_ASSET_PATH',
      message: `--asset 必须是 Assets/ 下、.prefab 结尾的项目内路径：${JSON.stringify(asset)}`,
      actual: { asset },
      hint: ['用法：--asset Assets/Prefabs/Brick.prefab'],
    });
  }
  // R94/R442：`parent` 只有「未给」与「非空字符串」两种合法形态。
  // 归一**逐字**照 `nodeCreate`（R94）：只剥尾随 `/`（不额外剥尾随空白）。
  // `--parent Panel/` 若原样透传，`.cs` 的 `Split('/')` 会得到空段 → 找不到父节点（假红）。
  let parentPath = parent;
  if (parentPath !== undefined && parentPath !== null) {
    if (typeof parentPath !== 'string') {
      return fail({
        code: 'BAD_PARENT',
        message: `--parent 需要字符串（父节点路径），收到 ${JSON.stringify(parent)}`,
        actual: { parent },
        hint: ['父路径需从根写起，如 --parent Panel 或 --parent Canvas/Panel'],
      });
    }
    parentPath = parentPath.replace(/\/+$/, '');
    if (parentPath === '') {
      return fail({
        code: 'BAD_PARENT',
        message: `--parent 不能为空，收到 ${JSON.stringify(parent)}`,
        actual: { parent },
        hint: ['父路径需从根写起，如 --parent Panel；实例化到场景根请省略 --parent'],
      });
    }
  }
  if (name !== undefined && (typeof name !== 'string' || name === '')) {
    return fail({
      code: 'MISSING_NAME',
      message: `--name 需要非空字符串，收到 ${JSON.stringify(name)}`,
      actual: { name },
      hint: ['不给 --name 就用 **Prefab 根节点的名字**（= 资产读回的真实根名，未必等于文件名）'],
    });
  }

  const callFn = _call || call;
  // R437/R438：**先读资产** → 真实根名 / spriteAssetPath / 资产根局部变换。
  const assetRead = await readPrefabAsset({ projectPath, env, callFn, assetPath });
  if (!assetRead.ok) return assetRead.envelope;
  const assetInfo = assetRead.asset;

  const payload = { asset: assetPath };
  if (parentPath !== undefined && parentPath !== null) payload.parent = parentPath;
  if (name !== undefined) payload.name = name;

  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('prefab-instantiate', payload), { projectPath, env });
  } catch (err) {
    return fail({
      code: 'WRITE_CALL_FAILED',
      message: `prefab-instantiate 写调用失败：${(err && err.message) || String(err)}`,
      hint: ['实例是否已建出未知；用 `unity scene tree` 复核后再决定是否重试'],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  if (!envl.ok) return withWriteRecheckHint(envl);
  const res = parseScriptResult(w, {
    label: 'prefab-instantiate',
    describeError: (code, parsed) => {
      if (code === 'PARENT_NOT_FOUND') {
        return {
          message: `父节点不存在：${(parsed && parsed.parent) || parent}`,
          actual: { parent },
          hint: [
            '用 `unity scene tree` 查看可用路径',
            '本次没有建出任何实例（脚本在挂父级失败时已销毁它）',
          ],
        };
      }
      if (code === 'PREFAB_NOT_FOUND') return prefabNotFoundDetail(assetPath);
      if (code === 'INSTANTIATE_FAILED') {
        return {
          message: `InstantiatePrefab 失败：${assetPath}`,
          actual: { asset: assetPath },
          hint: [
            '该资产可能不是 Prefab 根（例如 .prefab 里装的是模型/变体的子对象）',
            '用 `unity exec --code \'return AssetDatabase.LoadAssetAtPath<GameObject>("…") != null;\'` 复核',
          ],
        };
      }
      return undefined;
    },
  });
  if (res.envelope) return res.envelope;
  const instancePath = res.parsed && typeof res.parsed.instancePath === 'string' && res.parsed.instancePath !== ''
    ? res.parsed.instancePath
    : null;
  // R225 同款纪律：**协议不符绝不静默回落调用方入参** —— 没有实例路径就没有可信的读回目标，
  // 手写一个路径去 inspect 会产出「无证据的 verified:true」。宁可 falsely-fail。
  if (!instancePath) {
    return fail({
      code: 'INSTANTIATE_FAILED',
      message: 'prefab-instantiate 没有返回实例路径（协议不符）',
      actual: res.parsed,
      hint: ['检查 unity-scripts/prefab-instantiate.cs 的返回协议（成功 → {"__written":true,"instancePath":"<路径>","name":"<名字>"}）'],
    });
  }

  // R437：期望值全部由**资产读回** + JS 侧算出（`.cs` 自报的 instancePath 只当**读回目标**）。
  let intent;
  if (name !== undefined) {
    intent = { name, path: parentPath !== undefined && parentPath !== null ? `${parentPath}/${name}` : name };
  } else if (typeof assetInfo.spriteAssetPath === 'string' && assetInfo.spriteAssetPath !== '') {
    intent = { sprite: { assetPath: assetInfo.spriteAssetPath } };
  } else {
    intent = { name: assetInfo.name };
  }

  return readBackAndVerify({
    projectPath,
    env,
    callFn,
    readPath: instancePath,
    intent,
    residue: '实例可能已经建出来了；用 `unity scene tree` 复核，必要时空场景重来',
    mismatchHint: '读回与期望不一致（verified:false）——逐条查 mismatches：'
      + '`name`/`path` 是按 `--name` + `--parent` 由 JS 侧算出的期望（`path` 由 `node inspect` 沿父链**独立重算**）、'
      + '`sprite.assetPath` 来自**资产读回**、`position`/`scale` 应当等于资产根的**局部**值。'
      + '常见成因：同父下有同名节点 → `node inspect` 只能命中其中一个（**不会**改名 —— PITFALLS U42 / R451）；'
      + '要确定归属就显式给 `--name`（不同名）；或读回命中了另一个对象',
    // R437：资产读回的局部 position/scale 是**独立读数**，拿它复核实例的局部变换
    // （首轮那条「路径末段 == 名字」基本是自证，已被 intent.path 取代）。
    extraCheck: (actual) => transformMismatches(assetInfo, actual),
  });
}

/**
 * apply/revert 的读回面：从节点/资产投影里取「会被 apply 写回资产」的字段。
 *
 * ⚠️ 排除 `position`（根 `localPosition` 是 Unity 对 Apply/RevertPrefabInstance 的
 *   **豁免项** —— apply 不写进资产、revert 也不还原，见 `docs/m5-probes-raw/cb-REPORT.md` /
 *   PITFALLS U39）与 `name`（资产 name = `--to` 文件名、实例 name 任意，二者本就不该相等
 *   —— R432 / D-CB-4）。
 *
 * ⚠️ `components` **顺序敏感**（`compareSubset` 数组语义：长度不等即分歧、等长逐元素比），
 *   与 `prefab create` 的读回面（R448）同一口径。
 *
 * @param {*} proj `node inspect` 的实例投影或 `prefab-create` read 的资产投影
 * @returns {{scale: *, spriteAssetPath: *, components: *}}
 */
function applySubset(proj) {
  const n = isPlainObject(proj) ? proj : {};
  return {
    scale: n.scale,
    spriteAssetPath: n.spriteAssetPath !== undefined ? n.spriteAssetPath : null,
    components: n.components,
  };
}

/** 把 `node inspect` 的实例读回投影成 {@link applySubset} 同形（`sprite.assetPath` → `spriteAssetPath`）。 */
function instanceSubset(node) {
  const n = isPlainObject(node) ? node : {};
  const sprite = isPlainObject(n.sprite) ? n.sprite : null;
  const assetPath = sprite && typeof sprite.assetPath === 'string' && sprite.assetPath !== '' ? sprite.assetPath : null;
  return applySubset({ scale: n.scale, spriteAssetPath: assetPath, components: n.components });
}

/**
 * `prefab apply` / `prefab revert` 的公共实现（仅 `mode` 与要断言的投影方向不同）。
 *
 * 写后读回分两次**独立**调用：① `node inspect` 读实例；② `prefab-create` read 读资产。
 * 读回面 = {@link applySubset}（根 `scale` / `spriteAssetPath` / `components`），
 * **不含**根 `position`（Unity 豁免项，D-CB-1）与 `name`（D-CB-4）、也不含子节点（D-CB-5 修正/#5）。
 *
 * 信封形状（冲突扫描 #7）：`actual` 与 `intent` **同形**（都是 `{scale,spriteAssetPath,components}`）：
 *   - apply  → `actual = 资产投影`、`intent = 实例投影`（把实例覆盖写进资产）；
 *   - revert → `actual = 实例投影`、`intent = 资产投影`（把实例拉回资产）。
 * `hasOverrides` **只**作为一条 mismatch（`key:'hasOverrides'`）出现，不进 `actual`。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, path?: string, action?: 'apply'|'revert',
 *   _call?: typeof call, _stat?: (p: string) => import('node:fs').Stats}} [opts]
 * @returns {Promise<object>} 信封（成功时 verified 为布尔，绝非 null）
 */
async function prefabApplyOrRevert({ projectPath, env, path: nodePath, action, _call, _stat } = {}) {
  if (typeof nodePath !== 'string' || nodePath === '') {
    return fail({
      code: 'MISSING_PATH',
      message: `缺少 --path（要 ${action} 的 Prefab 实例路径）`,
      actual: { path: nodePath },
      hint: ['用 `unity scene tree` 取可用路径'],
    });
  }
  const callFn = _call || call;
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('prefab-apply', { mode: action, path: nodePath }), { projectPath, env });
  } catch (err) {
    return fail({
      code: action === 'apply' ? 'APPLY_FAILED' : 'REVERT_FAILED',
      message: `${action} 调用失败：${(err && err.message) || String(err)}`,
      hint: ['实例状态是否已变未知；先用 `unity node inspect` 复核该实例'],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  if (!envl.ok) return withWriteRecheckHint(envl);
  const res = parseScriptResult(w, {
    label: 'prefab-apply',
    describeError: (code, parsed) => {
      if (code === 'NOT_FOUND') {
        return {
          message: `节点不存在：${nodePath}`,
          actual: { path: nodePath },
          hint: ['用 `unity scene tree` 查看可用路径'],
        };
      }
      if (code === 'NOT_PREFAB_INSTANCE') {
        return {
          message: `该节点不是 Prefab 实例（或不是实例根）：${nodePath}`,
          actual: { path: nodePath },
          hint: [
            '本命令只对 Prefab 实例生效（`prefab instantiate` 出来的节点）',
            '`--path` 必须是**实例根**：子对象不是（`GetOutermostPrefabInstanceRoot != go` → 本码）',
            '用 `unity node inspect` + 资产读回确认它是不是实例根',
          ],
        };
      }
      if (code === 'APPLY_FAILED' || code === 'REVERT_FAILED') {
        return {
          message: `${action} 失败：${nodePath}`,
          actual: { path: nodePath, detail: parsed && parsed.detail },
          hint: ['先用 `unity node inspect` 复核该实例状态'],
        };
      }
      return undefined;
    },
  });
  if (res.envelope) return res.envelope;
  const assetPath = res.parsed && typeof res.parsed.assetPath === 'string' ? res.parsed.assetPath : null;
  if (!assetPath) {
    return fail({
      code: 'BAD_SCRIPT_RESULT',
      message: 'prefab-apply 未返回 assetPath',
      actual: res.parsed,
      hint: ['检查 unity-scripts/prefab-apply.cs 的返回协议（成功 → {"__written":true,"assetPath":"…","hasOverrides":<bool>}）'],
    });
  }
  // ⭐ 协议守卫（假绿修复）：`hasOverrides` 缺失/非布尔时必须显式失败 ——
  //   否则 `=== true` 会把「键没发射」静默当 false，revert 判据（D-CB-3）直接失效。
  if (typeof (res.parsed && res.parsed.hasOverrides) !== 'boolean') {
    return fail({
      code: 'BAD_SCRIPT_RESULT',
      message: 'prefab-apply 未返回布尔 hasOverrides',
      actual: res.parsed,
      hint: ['检查 unity-scripts/prefab-apply.cs 的返回协议（成功 → {__written,assetPath,hasOverrides}）'],
    });
  }
  const hasOverrides = res.parsed.hasOverrides;

  // 读回：实例（node-inspect）+ 资产（prefab-create read），两次独立调用
  const instEnv = await nodeInspect({ projectPath, env, path: nodePath, _call: callFn });
  if (!instEnv.ok) {
    return fail({
      code: 'READBACK_FAILED',
      message: `写后读回实例失败（${instEnv.code}）：${instEnv.message}`,
      intent: null,
      actual: instEnv.actual,
      // ⭐ 实例读回失败时写可能已经生效（residue）—— 必须给出复核指引，不能只报读回失败。
      hint: [
        ...(Array.isArray(instEnv.hint) ? instEnv.hint : []),
        '写可能已生效：先 `unity node inspect` 复核',
      ],
      phase: 'readback',
    });
  }
  const assetRead = await readPrefabAsset({ projectPath, env, callFn, assetPath });
  if (!assetRead.ok) {
    // 🔴 冲突扫描 #6：`readPrefabAsset` 的失败信封带的是 `prefab instantiate` 专属文案
    //   （「本步在实例化**之前**…」），且丢掉「写可能已生效」的 residue —— 在这里包装。
    return fail({
      code: 'READBACK_FAILED',
      message: `写后读回资产失败（${assetRead.envelope.code}）：${assetRead.envelope.message}`,
      intent: action === 'apply' ? instanceSubset(instEnv.actual) : null,
      actual: null,
      hint: [
        ...(Array.isArray(assetRead.envelope.hint) ? assetRead.envelope.hint : []),
        '写可能已生效：资产/实例可能已改，先 `unity node inspect` 复核',
      ],
      phase: 'readback',
    });
  }

  const mismatches = [];
  if (action === 'apply') {
    // intent = 实例（写回源），actual = 资产（写回目标）
    mismatches.push(...compareSubset(instanceSubset(instEnv.actual), applySubset(assetRead.asset)));
  } else {
    // intent = 资产（目标状态），actual = 实例
    mismatches.push(...compareSubset(applySubset(assetRead.asset), instanceSubset(instEnv.actual)));
    // D-CB-3：覆盖清空与否由 Unity 自己给的直接判据裁定。
    if (hasOverrides) mismatches.push({ key: 'hasOverrides', intent: false, actual: true });
  }
  // 磁盘防线（apply 才改资产）
  if (action === 'apply') {
    try {
      const s = (_stat || ((p) => fs.statSync(p)))(path.join(projectPath, assetPath));
      if (!(s && s.size > 0)) {
        // ⭐ actual 必须是**可诊断对象**（不是 null）：盘上确实读到但为空 / stat 返回空对象
        mismatches.push({ key: 'file.bytes', intent: '>0', actual: { bytes: (s && s.size) ?? null, mtimeMs: (s && s.mtimeMs) ?? null } });
      }
    } catch (err) {
      // ⭐ catch 分支带上 `err.code`/message（缺 --project-path、路径不存在等要看得见）
      mismatches.push({ key: 'file.bytes', intent: '>0', actual: { error: (err && err.code) || null, message: (err && err.message) || String(err) } });
    }
  }
  const verified = mismatches.length === 0;
  const instSubset = instanceSubset(instEnv.actual);
  const assetSubset = applySubset(assetRead.asset);
  // 🔴 冲突扫描 #7：actual/intent **同形**（都是读回面的投影），hasOverrides 只进 mismatches。
  const actual = action === 'apply' ? assetSubset : instSubset;
  const intent = action === 'apply' ? instSubset : assetSubset;
  // 成功 hint：豁免项 + 读回面边界（#6）+ 同名歧义（#4，写命令静默改错同名实例代价高）
  const successHints = [
    '⚠️ 根 `localPosition` 是 Unity 对 apply/revert 的**豁免项**：本命令不会把它写进资产、也不会还原它（PITFALLS U39）',
    '读回面只覆盖根 `scale`/`spriteAssetPath`/`components`；子节点与其它属性覆盖不在面内',
  ];
  if (instEnv.actual && instEnv.actual.matchCount > 1) {
    successHints.push('实例读回命中多个同名实例，要精确归属请用 `--sibling-index`（PITFALLS U42）');
  }
  // 失败 hint 按 action 分支（#2）：apply 产不出 `hasOverrides`，但要解释 `file.bytes`。
  const mismatchHints = [
    '读回不一致（verified:false）——逐条查 mismatches；`scale`/`spriteAssetPath`/`components` 应一致，根 `position` 不在比对面内',
  ];
  if (action === 'revert') {
    mismatchHints.push('若 mismatches 里有 `hasOverrides`：revert 后实例仍有覆盖（Unity 未能清空）');
  } else {
    mismatchHints.push('若分歧键是 `file.bytes`：Unity 侧内容已对，是盘上文件没读到/为空 —— 确认 `--project-path` 指向这个项目（Prefab 落在 <project-path>/Assets/… 下）');
  }
  return {
    ...ok(actual, {
      verified,
      intent,
      hint: verified ? successHints : mismatchHints,
    }),
    mismatches,
  };
}

/** `unity prefab apply`：把实例覆盖写回 Prefab **资产**。 */
async function prefabApply(opts = {}) { return prefabApplyOrRevert({ ...opts, action: 'apply' }); }
/** `unity prefab revert`：丢弃实例覆盖（把实例拉回资产值）。 */
async function prefabRevert(opts = {}) { return prefabApplyOrRevert({ ...opts, action: 'revert' }); }

module.exports = { prefabCreate, prefabInstantiate, prefabApply, prefabRevert, nodeProjection, prefabRootName };
