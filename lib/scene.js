'use strict';

/**
 * 场景/节点命令：读路径（`unity scene tree` / `unity node inspect`）+ 写路径
 * （`unity node create` / `unity node set`，`nodeCreate`/`nodeSet`）。
 *
 * 信封语义（R66）：
 *   - **读**命令没有 intent 可比对，成功信封一律 `verified: null`，且必须用
 *     {@link ok} 构造（单一构造点 + 白名单），**不得**手写
 *     `{ok:true, verified:true, …}` —— `verified:true` 是「写后读回比对通过」的专属结论，
 *     在读路径上声称它属于虚报，会污染「`verified:false` 必须停下」这条铁律。
 *   - **写**命令才允许 `verified: true/false`：`nodeCreate`/`nodeSet` 先执行写入，
 *     再用 `node-inspect` 读回，交给 `lib/readback.js` 的 `verifyWrite` 比对
 *     intent vs actual（本项目唯一自研价值）。读回失败绝不产 `ok`。
 */

const fs = require('node:fs');
const path = require('node:path');
const { call } = require('./uloop.js');
const { ok, fail, RETRYABLE_CODES, envelopeFromCall } = require('./envelope.js');
const { verifyWrite, compareSubset, isPlainObject } = require('./readback.js');

const SCRIPTS_DIR = path.join(__dirname, '..', 'unity-scripts');

/**
 * R92：`node set --patch` 允许的键。
 *
 * `unity-scripts/node-set.cs` 只认这四个字段；未知键（如 `components`）会被脚本**静默忽略**，
 * 而读回恰好一致 → `ok:true, verified:true` 的假绿。所以键集合必须在这里收封。
 *
 * ⚠️ R221：必须 `Object.freeze` —— 活数组会被外部 `PATCH_KEYS.push('sprite')` 永久放宽
 * 白名单（`Object.freeze(new Set())` 拦不住 `.add()`，数组冻结则 `push` 会抛）。
 */
const PATCH_KEYS = Object.freeze(['name', 'active', 'position', 'scale']);

/**
 * 写路径透传传输层失败信封时的统一复核提示（F3/R348，原延后项 D14）。
 *
 * `envelopeFromCall` 的 `ULOOP_TRUNCATED` / `ULOOP_NO_JSON` 信封只说「可限次重试」——
 * 对**读**命令够用，对**写**命令会误导：`execute-dynamic-code` 的写入可能**已经生效**
 * （create 已建出节点、set 已改完字段，只是回程输出被截断），照 hint 直接重试就会造出
 * 重复节点 / 重复改动。故写路径在透传信封时**追补**本条 hint。
 */
const WRITE_OUTCOME_UNKNOWN_HINT =
  '写入是否生效未知：重试前先用 `unity scene tree` / `unity node inspect` 复核该节点是否已存在/已改动';

/**
 * 透传失败信封，并为**写**路径补一条「先复核再重试」的 hint（F3/R348）。
 *
 * ⚠️ 只追加 `hint`：`code` / `verified` / `retryable` / `phase` 与退出码（`exitCodeFor`）
 * 一律不动 —— 本条不改变失败结论，只把「重试前提」说清。
 *
 * @param {object} envl `envelopeFromCall` 产出的失败信封
 * @returns {object} 新信封（不原地改传入对象）
 */
function withWriteRecheckHint(envl) {
  // R435：本任务唯一产出的「脚本根本没执行」码是 `SCRIPT_COMPILE_ERROR`（编译就失败）→
  // 不可能有写入，再追加「写入是否生效未知」就是把人往错方向引（与 R475 同一条纪律）。
  // ⚠️ **不能**用 `phase === 'compile'` 判定：`lib/asset.js:343` 早已用同一字面量表示
  // 「**已写入磁盘**、但随后 compile 失败/结果未知」（`ULOOP_TRUNCATED` /
  // `COMPILE_ALREADY_IN_PROGRESS` / `COMPILE_RESULT_UNKNOWN` / `ULOOP_NO_JSON`）。按 phase 跳过
  // 会让这些「文件已在盘上」的失败静默丢掉写复核提示。跳过条件必须绑到码。
  if (envl && envl.code === 'SCRIPT_COMPILE_ERROR') return envl;
  return { ...envl, hint: [...(Array.isArray(envl.hint) ? envl.hint : []), WRITE_OUTCOME_UNKNOWN_HINT] };
}

/**
 * hierarchy 递归深度上限（R89①）。
 *
 * 病态输入（实测 ~3000 层）会让递归 walk 爆栈，异常冒到 `bin/unity.js` 顶层变成
 * 「internal error + 退出码 3」—— 那是「本工具自己坏了」的假象。真实场景远达不到
 * 200 层，故超限即停止递归并由命令路径落 `HIERARCHY_TOO_DEEP`。
 */
const MAX_HIERARCHY_DEPTH = 200;

/**
 * 生成 execute-dynamic-code 的参数：`--code-file <cs> --parameters {"p":"<json>"}`。
 *
 * ⚠️ `--parameters` 的 key **会被 uloop 丢弃**，值按 key 排序后以 `param0`… 暴露
 * （实测，见 docs/CAPABILITIES §4.5）。载荷里只有一个 key `p`，所以它恒为 `param0`；
 * 与之配套的 `.cs` 里读 `parameters["param0"]`（**不要遍历 `parameters`**：
 * uloop 会把代码里的字符串字面量驻留成 `__uloop_literal_*`）。
 *
 * @param {string} scriptName `unity-scripts/` 下的脚本名（不含 `.cs`）
 * @param {*} payload 可 JSON 序列化的载荷
 * @param {{scriptsDir?: string}} [opts] `scriptsDir` 仅测试注入用
 * @returns {string[]} 可直接展开进 `uloop` argv 的参数
 */
function buildPayloadArgs(scriptName, payload, { scriptsDir = SCRIPTS_DIR } = {}) {
  return [
    '--code-file', path.join(scriptsDir, `${scriptName}.cs`),
    '--parameters', JSON.stringify({ p: JSON.stringify(payload) }),
  ];
}

/**
 * 把 uloop 的 hierarchy JSON 规范化成可读结构（带 `path`，便于后续引用）。
 *
 * ⚠️ **不遍历 `parameters` 式的约定之外**：这里只读已知字段。
 *
 * ⚠️ **宽容规范化（R70）**：字段缺失 / 类型不符一律按空处理，**本函数不校验形状也永不抛**
 * （上游可能给出非对象节点、非数组 `children`/`roots`）。形状校验在命令路径
 * {@link sceneTree} 里做（`BAD_HIERARCHY`）—— 因为 `{}` 与真·空场景在规范化结果里
 * 不可区分，宽容纯函数无法、也不该承担这个判断。
 *
 * ⚠️ **`path` 的语义（R71）**：由**名字用 `/` 拼接**而成，**不保证唯一**
 * （同名兄弟会撞车），也**无法表示含 `/` 的名字**。
 *
 * ⚠️ **M2 任务 9（R206 / 约束 25）**：上游给的 `siblingIndex`/`tag`/`layer` 现在**保留**
 * （additive；`path` 无法消歧，而它们既是消歧信息也是结构的一部分 —— 顺序/标签/层）。
 * M1 曾丢弃它们（旧 JSDoc 写「任务 10 需要时自行从 raw 取用」）；`doctor --golden` 的
 * 结构投影需要它们，丢了会让「顺序变了」这类真实变异漏检。
 *
 * R61：M1 只把 `Hierarchy[0]`（单场景）当主路径，但**其余场景不得静默消失** ——
 * `otherSceneCount` / `otherSceneNames` 把它们显式暴露出来（additive 字段，
 * 不改动 `sceneName` / `nodeCount` / `maxDepth` / `roots` 的既有含义）。
 *
 * R63：`active` 取 `isActive` —— get-hierarchy **会**列出非激活节点，
 * 因此 node-inspect 也必须能读到它们（见 `unity-scripts/node-inspect.cs`）。
 *
 * R316：上游的组件有**两种形状**，两者都要解 —— 否则大场景的 `components` 恒空：
 *   - 内联形（小场景）：逐节点 `components: ["Transform","Camera",…]`；
 *   - LUT 形（较大/嵌套场景，实测 **25 节点已出现**；阈值与序列化体积相关、
 *     **未定稿、勿依赖**，见 `docs/PITFALLS.md` 末尾条目）：`Hierarchy[0].componentsLut = [...]`
 *     \+ 逐节点 `componentsIdx: [0,1,2]`（索引），**没有** `components` 键。
 * 解析口径：**逐节点降级** —— 该节点带 `componentsIdx` 时按 LUT 查表（`lut[i]`，`undefined` 项过滤掉），
 * 否则回退 `n.components`（R323：上游混合形里个别节点仍内联，整体放弃内联会静默变 `[]`）。
 * 宽容口径同 R71：`componentsLut`/`componentsIdx` 非数组、
 * 索引越界、元素非字符串、两者皆无 → 按空数组，**绝不抛**（畸形输入不得冒成退出码 3）。
 *
 * R75：`otherSceneNames` 里空场景名退化成可读占位「场景 #N」（N 是从 2 开始的序号）——
 * 真机实测 `sceneName` 就是 `""`，直接 `join(', ')` 会让 hint 打出「…：」断尾句。
 *
 * @param {object} raw get-hierarchy 落盘的 hierarchy JSON
 * @returns {{sceneName: string, nodeCount: number, maxDepth: number, roots: object[],
 *   otherSceneCount: number, otherSceneNames: string[], tooDeep: boolean}}
 *   `tooDeep` 是 additive（R89①）：递归到 {@link MAX_HIERARCHY_DEPTH} 层即停止，
 *   并由命令路径落 `HIERARCHY_TOO_DEEP`（纯函数自身不抛、也不返回信封）
 */
function normalizeHierarchy(raw) {
  const list = raw && Array.isArray(raw.Hierarchy) ? raw.Hierarchy : [];
  const h = list[0] || { stats: {}, roots: [] };
  // R316：LUT 形（大场景）的查表函数 —— `lut` 非数组即退化为「无 LUT」，回退内联 `components`。
  // 索引按 `lut[i]` 取；越界/负数得到 `undefined`、元素非字符串一律过滤（R71 宽容口径，不抛）。
  // R323：LUT 与内联**逐节点**取舍 —— 只有该节点真的带 `componentsIdx` 才走 LUT，
  // 否则回退内联（混合形里没有 `componentsIdx` 的节点不得被静默清空）。
  const lut = Array.isArray(h.componentsLut) ? h.componentsLut : null;
  const componentsOf = (n) => {
    if (lut && Array.isArray(n.componentsIdx)) {
      return n.componentsIdx
        .filter((i) => Number.isInteger(i))
        .map((i) => lut[i])
        .filter((c) => typeof c === 'string');
    }
    return Array.isArray(n.components) ? n.components : [];
  };
  let tooDeep = false;
  const walk = (node, parentPath, depth) => {
    // R71：畸形输入不得抛（`null.children` / `'x'.map is not a function` 都会冒成
    // internal error + 退出码 3）；非对象节点按空对象处理。
    const n = node && typeof node === 'object' ? node : {};
    const p = parentPath ? `${parentPath}/${n.name}` : n.name;
    const rawChildren = Array.isArray(n.children) ? n.children : [];
    // R89①：超限停止下钻（有子节点才算真的被截断），避免爆栈
    if (depth >= MAX_HIERARCHY_DEPTH) {
      if (rawChildren.length > 0) tooDeep = true;
      return {
        name: n.name,
        path: p,
        active: n.isActive,
        components: componentsOf(n),
        // M2 additive（与下方同口径）：深度超限分支也要保留这三个字段，
        // 否则「投影随深度缺字段」会变成另一类假分歧。
        siblingIndex: n.siblingIndex,
        tag: n.tag,
        layer: n.layer,
        children: [],
      };
    }
    return {
      name: n.name,
      path: p,
      active: n.isActive,
      components: componentsOf(n),
      // M2 additive（golden 的结构比对需要它们；M1 的 JSDoc 曾注明「需要时自行从 raw 取用」）：
      // siblingIndex 是**顺序**信息（丢了会让「顺序变了」这类变异漏检），tag/layer 也是结构的一部分。
      siblingIndex: n.siblingIndex,
      tag: n.tag,
      layer: n.layer,
      children: rawChildren.map((c) => walk(c, p, depth + 1)),
    };
  };
  return {
    sceneName: h.sceneName || '',
    nodeCount: h.stats ? h.stats.nodeCount : 0,
    maxDepth: h.stats ? h.stats.maxDepth : 0,
    roots: (Array.isArray(h.roots) ? h.roots : []).map((r) => walk(r, '', 0)),
    // additive（R61）：0 表示没有场景被丢弃
    otherSceneCount: Math.max(0, list.length - 1),
    // R75：空名 → 「场景 #N」（slice(1) 的第 i 个对应全局第 i+2 个场景）
    otherSceneNames: list.slice(1).map((s, i) => (s && s.sceneName) || `场景 #${i + 2}`),
    tooDeep,
  };
}

/**
 * 相对路径 → 绝对路径（绝对路径原样返回）。
 *
 * ⚠️ 入参必须是字符串：`path.join(undefined, rel)` 会抛 TypeError。相对路径 +
 * 缺 `projectPath` 的组合必须在调用本函数**之前**被收敛（R68），否则抛出会冒成
 * internal error + 退出码 3。
 */
function toAbs(projectPath, relPath) {
  return path.isAbsolute(relPath) ? relPath : path.join(projectPath, relPath);
}

/** 读盘 + JSON.parse（入参为**绝对路径**）。会抛 —— 由调用方收敛成失败信封。 */
function readHierarchyRaw(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

/**
 * 读取 hierarchy 文件并规范化。uloop 返回的是相对项目根的路径
 * （形如 `.uloop\outputs\HierarchyResults\...`）；绝对路径原样使用。
 *
 * 本函数**会抛**（文件缺失 / JSON 损坏）：它是给任务 10 等调用方的「读盘 + 宽容规范化」
 * 便捷入口，由调用方自己收敛异常。命令路径 {@link sceneTree} 为了做 R70 的形状校验
 * 必须先拿到**原始** JSON，所以它直接走 `readHierarchyRaw`（同一套 `toAbs` 规则），
 * 并把异常收敛成 `HIERARCHY_READ_FAILED` / `BAD_HIERARCHY`。
 *
 * @param {string} projectPath 项目根
 * @param {string} relPath `HierarchyFilePath`
 * @returns {ReturnType<typeof normalizeHierarchy>}
 */
function readHierarchyFile(projectPath, relPath) {
  return normalizeHierarchy(readHierarchyRaw(toAbs(projectPath, relPath)));
}

/**
 * R70 + R89③：hierarchy 形状校验（只在命令路径 `sceneTree` 用；`normalizeHierarchy` 保持宽容）。
 *
 * 期望 `Hierarchy` 是数组、`Hierarchy[0]` 含对象型 `stats` 与数组型 `roots`。
 * 不符时不能放行：宽容规范化会把 `{}` / `{Hierarchy:[]}` / `{Hierarchy:[{}]}` 静默变成
 * 「空场景」（`ok` + `{roots:[],nodeCount:0}` + exit 0），与真·空场景不可区分；
 * 且上游字段改名时会产出「`nodeCount:0` 而 `roots` 有 N 个节点」的自相矛盾结果。
 *
 * R89③（同 R38）：`stats` 存在时，`normalizeHierarchy` 真正消费的
 * `nodeCount` / `maxDepth` 必须是数字 —— 否则会静默产出 `nodeCount:0` 这类错值。
 * 这里返回**具名诊断**（哪个字段坏了）而不是布尔，让失败信封能点名。
 *
 * @param {unknown} raw JSON.parse 的产物
 * @returns {{field: string|null, message: string}|null} 通过时返回 `null`
 */
function hierarchyShapeProblem(raw) {
  const h0 = raw && Array.isArray(raw.Hierarchy) ? raw.Hierarchy[0] : undefined;
  const shaped = Boolean(
    h0
    && typeof h0 === 'object'
    && !Array.isArray(h0)
    && h0.stats && typeof h0.stats === 'object' && !Array.isArray(h0.stats)
    && Array.isArray(h0.roots),
  );
  if (!shaped) {
    return { field: null, message: 'hierarchy JSON 形状不符：期望 Hierarchy[0] 同时含 stats 与 roots（数组）' };
  }
  for (const key of ['nodeCount', 'maxDepth']) {
    if (typeof h0.stats[key] !== 'number') {
      return { field: `stats.${key}`, message: `hierarchy JSON 形状不符：stats.${key} 缺失或非数字` };
    }
  }
  return null;
}

/**
 * `unity scene tree`：读场景节点树。
 *
 * get-hierarchy 只给出**落盘路径**，树本身要从文件里读；文件缺失/损坏是真实可能的
 * （uloop 给了路径但还没落盘、被清理、写入中断），必须落可诊断的失败信封，
 * 而不是让异常冒到 `bin/unity.js` 变成「internal error + 退出码 3」（那意味着本工具自己坏了）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, _call?: typeof call}} [opts]
 *   `_call` 仅供测试注入（R2 预留的注入缝）
 * @returns {Promise<object>} 信封
 */
async function sceneTree({ projectPath, env, _call } = {}) {
  const r = await (_call || call)('get-hierarchy', [], { projectPath, env });
  const envl = envelopeFromCall(r);
  if (!envl.ok) return envl;

  const hierarchyFilePath = r.json.HierarchyFilePath;
  // 非字符串（缺失 / 数字 / 对象…）同样走这里：否则 path.isAbsolute 会先抛
  if (typeof hierarchyFilePath !== 'string' || hierarchyFilePath === '') {
    return fail({
      code: 'NO_HIERARCHY_PATH',
      message: 'get-hierarchy 未返回 HierarchyFilePath',
      actual: r.json,
      hint: ['用 `unity doctor --smoke` 确认 get-hierarchy 可用'],
    });
  }

  // R68：**在 try 之前**收敛「缺 --project-path」。否则 path.join(undefined, rel) 的
  // TypeError 会先落进 catch，而 catch 里再算一次绝对路径会二次抛出 → 冒到
  // bin/unity.js 顶层变成 internal error + 退出码 3（工具「自己坏了」的假象）。
  // `--project-path` 裸写时 parseArgs 给出 `true`，与 undefined 同罪，故按类型判。
  const alreadyAbs = path.isAbsolute(hierarchyFilePath);
  if (!alreadyAbs && (typeof projectPath !== 'string' || projectPath === '')) {
    return fail({
      code: 'MISSING_PROJECT_PATH',
      message: '需要 --project-path（get-hierarchy 返回的是项目相对路径）',
      actual: { hierarchyFilePath },
      hint: ['用 --project-path <项目根> 指定项目'],
    });
  }
  // 绝对路径只算一次并复用：真正的读取与失败信封的 actual.path 是同一个值
  const abs = alreadyAbs ? hierarchyFilePath : path.join(projectPath, hierarchyFilePath);

  let raw;
  try {
    raw = readHierarchyRaw(abs);
  } catch (err) {
    // R60：读文件失败不得抛（抛出会变成 internal error / 退出码 3，与事实不符）。
    // ⚠️ catch 体内不得再有任何可抛调用：消息提取与 actual.path 都只用手头已有的值。
    return fail({
      code: 'HIERARCHY_READ_FAILED',
      message: `读取 hierarchy 文件失败：${(err && err.message) || String(err)}`,
      actual: { path: abs },
      hint: ['确认 uloop 的 get-hierarchy 已落盘；路径来自 HierarchyFilePath'],
    });
  }

  // R70 + R89③：形状校验放命令路径（normalizeHierarchy 是宽容纯函数，见其 JSDoc）
  const problem = hierarchyShapeProblem(raw);
  if (problem) {
    return fail({
      code: 'BAD_HIERARCHY',
      message: problem.message,
      // field 是 additive：兼容既有断言（keys 必为数组），并点名坏字段
      actual: { keys: Object.keys(raw ?? {}), field: problem.field },
      hint: [
        '确认 uloop 的 get-hierarchy 输出未被改名/换版本',
        '用 `unity doctor --smoke` 重新生成 hierarchy',
      ],
    });
  }

  const actual = normalizeHierarchy(raw);
  // R89①：超深不静默截断成「看起来正常」的树
  if (actual.tooDeep) {
    return fail({
      code: 'HIERARCHY_TOO_DEEP',
      message: `hierarchy 深度超过 ${MAX_HIERARCHY_DEPTH} 层，已停止遍历`,
      actual: { depthLimit: MAX_HIERARCHY_DEPTH },
      hint: ['场景层级异常深（可能不是真实场景）；确认 get-hierarchy 输出未被破坏'],
    });
  }
  // R61 + R75：被丢弃的场景必须可见，否则读者会以为整棵树都在这里；
  // 空场景名已在 normalizeHierarchy 里退化成「场景 #N」，不会打出「…：」断尾句
  const hint = actual.otherSceneCount > 0
    ? [`还有 ${actual.otherSceneCount} 个场景未读（M1 只读第一个场景）：${actual.otherSceneNames.join(', ')}`]
    : [];
  return ok(actual, { hint });
}

/**
 * R77：`execute-dynamic-code` 的 `Result` 解析 —— `nodeInspect` / `nodeCreate` / `nodeSet`
 * 三处**唯一**落点（禁止三份复制）。
 *
 * 覆盖的既有语义：
 *   - R62：`Result` 缺失 / 非 JSON → `BAD_SCRIPT_RESULT`（不得抛，抛出会退化成
 *     internal error + 退出码 3）；
 *   - R67：合法 JSON 但不是对象（`null` / `"x"` / `1` / `[..]`）同样不是载荷；
 *   - R72：`.cs` 用 `__error` 哨兵报错，凡出现即按该码失败（不装成 ok）；
 *   - R89②：`__error` 收严 —— 空串 / 非字符串**也算失败**（落 `SCRIPT_ERROR`），
 *     且错误码与 {@link RETRYABLE_CODES} 撞名时加 `SCRIPT_` 前缀，避免被 `fail()`
 *     误归入「值得重试」（脚本错误与 uloop 瞬时故障无关）。
 *
 * @param {{json: object}} r `call('execute-dynamic-code', …)` 的返回值（`Success` 已为 true）
 * @param {{label: string, describeError?: (code: string, parsed: object) =>
 *   {message?: string, actual?: *, hint?: string[]}}} [opts]
 *   `label` 是脚本名（用于默认文案与 hint）；`describeError` 让调用方把已知错误码
 *   映射成更精确的文案 / actual / hint
 * @returns {{parsed: object}|{envelope: object}} 二者恰有其一
 */
function parseScriptResult(r, { label, describeError } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(r.json.Result);
  } catch (err) {
    // R62：Result 缺失 / 非 JSON 不得抛（同样会退化成 internal error + 退出码 3）
    return {
      envelope: fail({
        code: 'BAD_SCRIPT_RESULT',
        message: `${label} 的返回值不是 JSON：${err.message}`,
        actual: { raw: r.json.Result },
        hint: [`检查 unity-scripts/${label}.cs 是否编译通过（看 CompilationErrors）`],
      }),
    };
  }
  // R67：JSON.parse 的产物只可能是 null/布尔/数字/字符串/数组/普通对象，三个条件已足够
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      envelope: fail({
        code: 'BAD_SCRIPT_RESULT',
        message: `${label} 的返回值不是 JSON 对象`,
        actual: { raw: r.json.Result },
        hint: [`检查 unity-scripts/${label}.cs 是否返回了 JSON 对象`],
      }),
    };
  }
  // R72 / R89②：`__error` 只要**存在**（哪怕空串/非字符串）就是失败
  if (Object.hasOwn(parsed, '__error')) {
    const code = scriptErrorCode(parsed.__error);
    const d = (describeError && describeError(code, parsed)) || {};
    return {
      envelope: fail({
        code,
        message: d.message || `${label} 返回错误：${code}`,
        actual: d.actual !== undefined ? d.actual : parsed,
        hint: d.hint || [`检查 unity-scripts/${label}.cs 的返回协议`],
      }),
    };
  }
  return { parsed };
}

/**
 * 只解析「成功脚本的 JSON 载荷」，不做额外的错误文案映射 —— 供不需要自定义 describeError
 * 的调用方（如 `lib/sprite.js`）复用，避免第三份 `JSON.parse(r.json.Result)`。
 * `__error` 统一走 `parseScriptResult`；**`NOT_FOUND` 特殊**：`actual` 带被查的 `path`
 * （R207 / M1 R69 口径），所以调用方必须把 `path` 传进来。
 *
 * @param {object} r `call()` 返回值
 * @param {{path?: string}} [opts] 被查节点路径（`NOT_FOUND` 的 `actual` 用它）
 */
function parseNodeResult(r, { path } = {}) {
  return parseScriptResult(r, {
    label: 'sprite-set',
    describeError: (code) => (code === 'NOT_FOUND'
      ? {
        message: `节点不存在：${path}`,
        actual: { path },
        hint: [
          '用 `unity scene tree` 查看可用路径',
          '仅查当前激活场景（含 inactive 节点）；其它场景/DontDestroyOnLoad 里的节点会报 NOT_FOUND',
        ],
      }
      : undefined),
  });
}

/**
 * R89②：把脚本的 `__error` 值收敛成错误码。
 * 空串 / 非字符串 → `SCRIPT_ERROR`；与 uloop 瞬时故障码撞名 → 加 `SCRIPT_` 前缀。
 */
function scriptErrorCode(raw) {
  if (typeof raw !== 'string' || raw === '') return 'SCRIPT_ERROR';
  return RETRYABLE_CODES.has(raw) ? `SCRIPT_${raw}` : raw;
}

/** R78b③：组件名一律映射到短名比对（`UnityEngine.Sprite` → `Sprite`）。 */
function shortComponentName(v) {
  return typeof v === 'string' ? v.slice(v.lastIndexOf('.') + 1) : v;
}

/**
 * 写后读回 + 额外校验 → 写命令信封。
 *
 * **契约**（与 `lib/readback.js` 的 F6 对齐）：读回失败（`nodeInspect` 落失败信封，
 * 或调用本身抛出）一律落 `READBACK_FAILED`（`ok:false`），**绝不**产出 `ok:true`
 * —— 「写成功但读回从未发生」不是通过。
 *
 * 成功时返回写信封 `{ok, verified, intent, actual, mismatches, hint}`（R78）：
 * `ok`/`intent` 仍由 {@link ok} 构造（单一构造点 + 白名单），`mismatches` 是
 * 写路径专属的 additive 字段（`ok()` 白名单刻意不含它，所以在这里显式附加）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, callFn: typeof call,
 *   readPath?: string, intent: object, extraCheck?: (actual: object) => object[],
 *   residue?: string, mismatchHint?: string, successHint?: string[],
 *   readActual?: () => Promise<object>}} opts
 *   `readActual` 是**读回面**的注入缝（M3 任务 2）：默认走 `nodeInspect(readPath)`（节点写命令）；
 *   场景写命令（`sceneSave` / `sceneOpen`）的读回面是 `get-hierarchy` 的 `sceneName`、不是某个节点，
 *   由调用方传入自己的 readActual —— 但**读回失败 → `READBACK_FAILED`** 的收敛仍然只此一处
 *   （`readActual` 抛出的 Error 带 `envelope` 时，该信封进 `actual` / `hint`）。
 *   `residue` 是读回失败时的**复核指引**（R110④）：create 会留下新节点、set 不会，
 *   两者的 hint 必须不同 —— 中性文案会把 create 的有用信息丢掉，
 *   create 的文案对 set 又是错的（R104①）。不传则用中性默认值。
 *   `mismatchHint` 是**读回成功但与 intent 不一致**（`verified:false`）时的提示（R245）：
 *   不同写命令要查的方向不同（`node set` 查 patch 是否被钳制，`sprite set` 查
 *   SpriteRenderer/颜色是否被改写），不传则用中性默认文案（逐字保持 M1 的既有输出）。
 *   `successHint` 是**成功且无分歧**（`mismatches` 为空、`verified:true`）时并入 `hint` 的提示
 *   （R359）：默认 `[]` —— 不传的调用方（`nodeCreate` / `nodeSet` / `spriteSet` / `sceneSave`）
 *   成功输出**逐字不变**。只有需要「成功也要提醒一句」的命令才传（如 `sceneOpen` 的
 *   「CLI 造的未保存改动不置 isDirty」）。有分歧时仍走 `mismatchHint`，不混入成功提示。
 * @returns {Promise<object>} 信封
 */
async function readBackAndVerify({ projectPath, env, callFn, readPath, intent, extraCheck, residue, mismatchHint, successHint = [], readActual: readActualFn }) {
  let r;
  try {
    r = await verifyWrite({
      intent,
      readActual: readActualFn || (async () => {
        const read = await nodeInspect({ projectPath, env, path: readPath, _call: callFn });
        if (!read.ok) {
          const err = new Error(`读回失败（${read.code}）：${read.message}`);
          err.envelope = read;
          throw err;
        }
        return read.actual;
      }),
    });
  } catch (err) {
    const read = err && err.envelope;
    // R94/F5③：读回失败 **不等于**写入失败 —— `.cs` 是「先写后返回」，只要
    // execute-dynamic-code 跑到了写，改动就已经落在场景里。
    // R104①/R110④：hint 文本**参数化** —— `node create` 可能留下新节点（要提示复核后删除），
    // `node set` 不会新建节点（说「清理残骸」是错的）。
    const residueHint = residue
      || '写入可能已生效；用 `unity scene tree` / `unity node inspect` 复核本次改动的落点';
    const base = read && Array.isArray(read.hint) && read.hint.length
      ? read.hint
      : ['读回动作本身失败，写入结果未知；用 `unity node inspect` 复核'];
    return fail({
      code: 'READBACK_FAILED',
      message: read
        ? `写后读回失败（${read.code}）：${read.message}`
        : `写后读回失败：${(err && err.message) || String(err)}`,
      intent,
      actual: read ? read.actual : null,
      hint: [...base, residueHint],
      phase: 'readback',
    });
  }
  const mismatches = [...r.mismatches, ...(extraCheck ? extraCheck(r.actual) : [])];
  // R359：成功（无分歧）时才并入 `successHint`（默认 `[]`）；有分歧时维持 `mismatchHint` 原口径。
  const successHints = Array.isArray(successHint) ? [...successHint] : [];
  return {
    ...ok(r.actual, {
      verified: mismatches.length === 0,
      intent,
      hint: mismatches.length
        ? [mismatchHint || '读回结果与意图不一致（verified:false）——Unity 可能钳制了数值/改名/未应用 patch；逐条查 mismatches']
        : successHints,
    }),
    mismatches,
  };
}

/**
 * `unity node inspect`：读单个节点。
 *
 * 属性值必须走 execute-dynamic-code —— get-hierarchy 不含属性（只有 name/isActive/components）。
 * 返回的字段与任务 10 的 `node.set` patch 对齐，便于直接比对；其中 **`position` 是
 * 局部坐标（`localPosition`）**，不是世界坐标（R64）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, path?: string, siblingIndex?: string, _call?: typeof call}} [opts]
 * @returns {Promise<object>} 信封
 */
async function nodeInspect({ projectPath, env, path: nodePath, siblingIndex, _call } = {}) {
  // R69：缺 --path 必须在调用**之前**收敛（守卫放这里而非 CLI：任务 10 复用同一函数）。
  // 否则载荷会变成 `{path:undefined}`（`--path` 裸写更会变成 `true` → C# 里 Find("True")），
  // 失败信号完全误导（Unity 异常栈 / 「节点不存在：undefined」/ actual 为 null）。
  if (typeof nodePath !== 'string' || nodePath === '') {
    return fail({
      code: 'MISSING_PATH',
      message: '缺少 --path（形如 Canvas/Btn）',
      actual: { path: nodePath },
      hint: ['用 `unity scene tree` 取可用路径'],
    });
  }
  // R480（D-B1）：`--sibling-index` 是**可选**定位参数。纯 argv 校验必须在任何调用之前收敛
  // （全局约束：用法错只由 argv 决定）。`parseArgs` 裸写给布尔 `true` → 必须显式拒，
  // 否则会被当成 1（静默定位到错的实例）。
  let siblingIndexNum;
  if (siblingIndex !== undefined) {
    // R480（b1r2 修复）：`/^\d+$/` 只挡形状、挡不住范围 —— `999…9`（400 位）会 `Number()` 成
    // `Infinity`，`JSON.stringify` 变 `null`，`.cs` 的 `Type != Null` 判定把它当「没给」→
    // `ok:true` 静默返回第一个实例（假绿）；`3000000000` 也会过形状守卫但在 C# `(int)` 处溢出。
    // 与 R407「`Number()` 宽容是假绿的温床」同口径：形状 + 范围都要在 argv 处收封。
    const n = typeof siblingIndex === 'string' && /^\d+$/.test(siblingIndex) ? Number(siblingIndex) : NaN;
    if (!Number.isSafeInteger(n) || n > 2147483647) {
      return fail({
        code: 'BAD_SIBLING_INDEX',
        message: `--sibling-index 需要 0..2147483647 的整数，收到 ${JSON.stringify(siblingIndex)}`,
        actual: { siblingIndex },
        hint: [
          'siblingIndex 就是 `unity scene tree` 里该节点的 siblingIndex 字段值（同父下的真实子序号，可能不连续）',
          '用 `unity scene tree` 读出目标节点的 siblingIndex，再传 --sibling-index <该值>',
        ],
      });
    }
    siblingIndexNum = n;
  }
  const payload = { path: nodePath };
  if (siblingIndexNum !== undefined) payload.siblingIndex = siblingIndexNum;
  const r = await (_call || call)('execute-dynamic-code', buildPayloadArgs('node-inspect', payload), { projectPath, env });
  const envl = envelopeFromCall(r);
  if (!envl.ok) return envl;
  // R77：解析语义与 node-create / node-set 共用同一 helper
  const res = parseScriptResult(r, {
    label: 'node-inspect',
    describeError: (code, parsed) => {
      if (code === 'NOT_FOUND') {
        return {
          message: `节点不存在：${nodePath}`,
          // R69：NOT_FOUND 带上被查的 path（否则 actual 为 null，无法判断查的是谁）
          actual: { path: nodePath },
          hint: [
            '用 `unity scene tree` 查看可用路径',
            // R74：回退只覆盖当前激活场景 —— 其它场景 / DontDestroyOnLoad 里的节点仍会 NOT_FOUND，
            // hint 必须写明范围，否则「scene tree 看得见却 inspect 不到」会被误判为 bug
            '仅查当前激活场景（含 inactive 节点）；其它场景/DontDestroyOnLoad 里的节点会报 NOT_FOUND',
          ],
        };
      }
      if (code === 'SIBLING_INDEX_OUT_OF_RANGE') {
        // R480（b1r1 修复）：--sibling-index 是 **transform.GetSiblingIndex() 的真实值**
        // （与 `scene tree` 的 siblingIndex 字段同口径），**不是**同名命中列表的下标。
        // 越界时把**可用的真实序号列表**回传 —— 否则用户只能盲试（旧 hint「下标从 0 起」会骗人）。
        const avail = parsed && Array.isArray(parsed.available) ? parsed.available : null;
        // R480（b1r2）：`matches` 是**按 path 命中**的集合，可能跨不同父（两个 root 都叫 `Root`
        // 且各有 `Brick`）——文案不得再说「同父同名」；`actual` 与成功路径同口径带上 `matchCount`。
        return {
          message: `--sibling-index ${siblingIndexNum} 未命中：该路径命中 ${parsed && parsed.count} 个节点（可能来自不同父），可用 siblingIndex：${avail ? avail.join(', ') : '未知'}`,
          actual: { path: nodePath, siblingIndex: siblingIndexNum, count: parsed && parsed.count, matchCount: parsed && parsed.count, available: avail },
          hint: [
            'siblingIndex 就是 `unity scene tree` 里该节点的 siblingIndex 字段值（同父下的真实子序号，可能不连续）',
            '用 `unity scene tree` 读出目标节点的 siblingIndex，再传 --sibling-index <该值>',
          ],
        };
      }
      return {
        message: `node-inspect 返回错误：${code}`,
        actual: parsed,
        hint: ['检查 unity-scripts/node-inspect.cs 的返回协议'],
      };
    },
  });
  if (res.envelope) return res.envelope;
  const success = ok(res.parsed);
  // R480（D-B2）：命中多个且没给定位参数 → 保持既有「取第一个」行为（不破坏 U42 的既有用法），
  // 但把「你命中的是第几个」变成可见事实 + 给出路。
  if (res.parsed && res.parsed.matchCount > 1 && siblingIndexNum === undefined) {
    return {
      ...success,
      hint: [
        ...success.hint,
        `该路径命中 ${res.parsed.matchCount} 个节点（可能来自不同父）；本次返回 siblingIndex=${res.parsed.siblingIndex}、instanceId=${res.parsed.instanceId} 那个 —— 要精确归属请用 \`unity scene tree\` 读出目标节点的 siblingIndex，再传 --sibling-index <该值>（PITFALLS U42）`,
      ],
    };
  }
  return success;
}

/**
 * `unity node create`：建节点 + **写后读回验证**。
 *
 * R78：uloop 的 `Success:true` 只说明代码跑了，**不说明节点真的建成了**。
 * 因此这里显式构造 `intent`（`{name, active:true}`；有 `parent` 时追加 `path`，见 R79）
 * 并走 `verifyWrite({intent, readActual})` —— 绝不把 `nodeInspect`（读命令，
 * `verified:null`）的信封直接返回。
 *
 * R78b②：请求的**每个组件短名**必须出现在读回的 `components` 里；少了就追加一条
 * `{key:'components', intent, actual}` 分歧（数组子集语义，`compareSubset` 做不了）。
 *
 * R94：`parent` 只接受「未给」或非空字符串（裸写 `true` / `''` → `BAD_PARENT`），
 * 且去掉尾随 `/` —— 否则 JS 会拼出 `Canvas//Brick`（假红）或与 `.cs` 的
 * `IsNullOrEmpty` 口径分叉。R95：写调用 reject → `WRITE_CALL_FAILED`（不冒成退出码 3）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, name?: string, parent?: string,
 *   components?: string[], _call?: typeof call}} [opts]
 *   组件名用 `UnityEngine.X` 或短名 `X`（一律映射到短名比对）
 * @returns {Promise<object>} 信封（成功时 `verified` 为布尔，绝非 null）
 */
async function nodeCreate({ projectPath, env, name, parent, components = [], _call } = {}) {
  // R86：空名会变成 `new GameObject("")`，失败信号完全误导
  if (typeof name !== 'string' || name === '') {
    return fail({
      code: 'MISSING_NAME',
      message: '缺少 --name（节点名不能为空）',
      actual: { name },
      hint: ['用 `unity node create --name Brick` 指定节点名'],
    });
  }
  if (!Array.isArray(components) || components.some((c) => typeof c !== 'string' || c === '')) {
    return fail({
      code: 'BAD_COMPONENTS',
      message: 'components 需要非空字符串数组',
      actual: { components },
      hint: ['组件名用 `UnityEngine.X` 或短名 `X`（如 SpriteRenderer / Rigidbody）'],
    });
  }
  // R94/F5②：`parent` 只有「未给」与「非空字符串」两种合法形态。
  // `--parent` 裸写 → `true`，`--parent ''` → `''`：前者会让 `.cs` 的 Find(true)
  // 语义完全误导，后者会让 `.cs`（IsNullOrEmpty → 不设父）与 JS 的 path 拼接口径分叉。
  let parentPath = parent;
  if (parentPath !== undefined && parentPath !== null) {
    if (typeof parentPath !== 'string') {
      return fail({
        code: 'BAD_PARENT',
        message: '--parent 需要字符串（父节点路径）',
        actual: { parent },
        hint: ['父路径需从根写起，如 --parent Canvas 或 --parent Canvas/Panel'],
      });
    }
    // 去掉尾随 `/`：`--parent Canvas/` 会拼出 `Canvas//Brick` → 读回必假红
    parentPath = parentPath.replace(/\/+$/, '');
    if (parentPath === '') {
      return fail({
        code: 'BAD_PARENT',
        message: '--parent 不能为空',
        actual: { parent },
        hint: ['父路径需从根写起，如 --parent Canvas；建根节点请省略 --parent'],
      });
    }
  }
  // R79：有 parent 时把落位也纳入 intent，否则「建在哪」只有脚本自述
  const intent = { name, active: true };
  if (parentPath) intent.path = `${parentPath}/${name}`;
  const callFn = _call || call;
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('node-create', { name, parent: parentPath, components }), { projectPath, env });
  } catch (err) {
    // R95/F6①：写调用 reject 不得冒到 `bin/unity.js` 顶层变成 internal error + 退出码 3
    // （与 readBackAndVerify 同构）。写入是否生效未知 —— 按失败处理并提示复核残骸。
    return fail({
      code: 'WRITE_CALL_FAILED',
      message: `node-create 写调用失败：${(err && err.message) || String(err)}`,
      intent,
      hint: [
        '写入是否生效未知；用 `unity scene tree` 复核并清理可能的残骸',
        '确认编辑器已打开目标项目（用 `unity doctor` 查看环境）',
      ],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  // F3/R348：写路径的传输层失败不是纯读故障 —— create 可能已建出节点，重试前必须先复核。
  if (!envl.ok) return withWriteRecheckHint(envl);
  const res = parseScriptResult(w, {
    label: 'node-create',
    describeError: (code, parsed) => {
      if (code === 'PARENT_NOT_FOUND') {
        // R104④：`.cs` 的 detail（「裸名只接受根对象…」）不能丢 —— 否则
        // 「节点存在但在嵌套里」会被读成「不存在」。
        const detail = typeof parsed.detail === 'string' && parsed.detail !== '' ? parsed.detail : null;
        return {
          message: detail ? `父节点不存在：${parentPath}（${detail}）` : `父节点不存在：${parentPath}`,
          actual: { parent: parentPath, detail },
          hint: [
            '用 `unity scene tree` 查看可用路径（含 inactive 节点）',
            // R94：裸名只接受根对象 —— 嵌套子节点必须从根写全路径
            '父路径需从根写起（如 Canvas/Panel）；裸名只匹配根对象',
          ],
        };
      }
      if (code === 'COMPONENT_TYPE_NOT_FOUND') {
        return {
          message: `组件类型不存在：${parsed.component}`,
          actual: parsed,
          hint: ['组件名用 `UnityEngine.X` 或短名 `X`（如 SpriteRenderer / Rigidbody）'],
        };
      }
      // R93：类型能解析但不是 Component（如 System.String）
      if (code === 'NOT_A_COMPONENT') {
        return {
          message: `不是组件类型：${parsed.component}`,
          actual: parsed,
          hint: ['只有 Component 子类能挂到节点上；确认组件名拼写（如 SpriteRenderer / Rigidbody）'],
        };
      }
      // R93 兜底：组件类型合法但 AddComponent 抛异常（依赖/抽象类型等）
      if (code === 'COMPONENT_ADD_FAILED') {
        return {
          message: `添加组件失败：${parsed.component}`,
          actual: parsed,
          hint: ['确认该组件的依赖约束（如 Collider 与 Rigidbody）或是否需要先有父节点'],
        };
      }
      return {};
    },
  });
  if (res.envelope) return res.envelope;

  return readBackAndVerify({
    projectPath,
    env,
    callFn,
    readPath: intent.path || name,
    intent,
    // R110④：create 专属 —— 读回失败时可能已经建出了节点/半成品，要提示复核并删除
    residue: '写入可能已生效；若本次 create 已留下新节点或半成品，用 `unity scene tree` 复核并删除多余项（本工具不自动回滚）',
    // R78b②：组件短名集合必须被读回的 components 覆盖
    extraCheck: (actual) => {
      const have = Array.isArray(actual.components) ? actual.components.map(shortComponentName) : [];
      const missing = components.map(shortComponentName).filter((c) => !have.includes(c));
      return missing.length ? [{ key: 'components', intent: components, actual: actual.components }] : [];
    },
  });
}

/**
 * `unity node set`：改节点 + **写后读回验证**。
 *
 * R84：写结果的 `__error`（`NOT_FOUND` / `BAD_PATCH` …）与 `nodeCreate` 走同一
 * helper，直接按码失败 —— 否则会退化成「一堆 mismatch」，用户看到「值不对」
 * 而不是「节点不存在」。
 *
 * R81：patch 含 `name` 时节点已改名，读回路径必须换成新名（同父前缀），
 * 否则永远 `NOT_FOUND` → 正确操作被报成失败。
 *
 * R91：空 patch `{}` → `EMPTY_PATCH`（subset 语义下没有可比字段，放行就是零信息
 * `verified:true`）。R92：键白名单 `name/active/position/scale`，未知键 →
 * `UNKNOWN_PATCH_KEY`（`.cs` 会静默忽略未知键，读回「恰好一致」即假绿）。
 * R95：写调用 reject → `WRITE_CALL_FAILED`。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, path?: string, patch?: object,
 *   _call?: typeof call}} [opts]
 * @returns {Promise<object>} 信封（成功时 `verified` 为布尔，绝非 null）
 */
async function nodeSet({ projectPath, env, path: nodePath, patch, _call } = {}) {
  // R69：与 nodeInspect 同罪 —— 缺 --path 必须在调用前收敛
  if (typeof nodePath !== 'string' || nodePath === '') {
    return fail({
      code: 'MISSING_PATH',
      message: '缺少 --path（形如 Canvas/Btn）',
      actual: { path: nodePath },
      hint: ['用 `unity scene tree` 取可用路径'],
    });
  }
  // R88（顺带满足 R53）：patch 必须是普通对象 —— 否则 intent 比对会假绿
  // 守卫实现由 readback.js 的 isPlainObject 提供（单一真值；M2 任务 1 删除本地副本 isPlainPatch）
  if (!isPlainObject(patch)) {
    return fail({
      code: 'MISSING_PATCH',
      message: '缺少 --patch（需要一个 JSON 对象）',
      actual: { patch },
      hint: ['--patch 需要一个 JSON 对象，如 --patch \'{"active":false}\''],
    });
  }
  // R91：空对象在 subset 语义下**没有可比对的字段** —— 放行会产出「零信息 verified:true」，
  // 那比不验证更坏（agent 会以为改动已确认生效）。
  if (Object.keys(patch).length === 0) {
    return fail({
      code: 'EMPTY_PATCH',
      message: '--patch 不能是空对象（没有可比对的字段）',
      actual: { patch },
      hint: ['--patch 需要一个含字段的 JSON 对象，如 --patch \'{"active":false}\''],
    });
  }
  // R92：键集合必须封闭 —— `{"components":["Transform"]}` 打在只有 Transform 的节点上时，
  // node-set.cs 完全忽略它，读回却「恰好一致」→ ok+verified 假绿。
  const unknown = Object.keys(patch).filter((k) => !PATCH_KEYS.includes(k));
  if (unknown.length) {
    return fail({
      code: 'UNKNOWN_PATCH_KEY',
      message: `--patch 含 node set 不支持的字段：${unknown.join(', ')}`,
      // R104③：白名单必须**拷一份**再外泄 —— 直接给模块级 PATCH_KEYS 的话，
      // 调用方 push 一下就静默放开了白名单（且是永久生效的）。
      actual: { unknown, allowed: [...PATCH_KEYS] },
      // hint 的字段名列表与白名单同源（避免两份真值漂移）
      hint: [`node set 支持的字段：${PATCH_KEYS.join('/')}；加组件用 node create --components`],
    });
  }
  // R104②：空名会被 `.cs` 改成无名节点，而读回仍用旧路径 → READBACK_FAILED +
  // 一个难寻址的残骸。必须挡在写入之前。
  if (Object.hasOwn(patch, 'name') && patch.name === '') {
    return fail({
      code: 'BAD_PATCH',
      message: 'patch.name 不能为空（会把节点改成无名，无法再寻址）',
      actual: { field: 'name' },
      hint: ['删除 `name` 字段或给一个非空名字，如 --patch \'{"name":"NewName"}\''],
    });
  }
  const callFn = _call || call;
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('node-set', { path: nodePath, patch }), { projectPath, env });
  } catch (err) {
    // R95/F6①：写调用 reject 不得冒成 internal error + 退出码 3（与 readBackAndVerify 同构）
    return fail({
      code: 'WRITE_CALL_FAILED',
      message: `node-set 写调用失败：${(err && err.message) || String(err)}`,
      intent: patch,
      hint: [
        '写入是否生效未知；用 `unity node inspect` / `unity scene tree` 复核并清理',
        '确认编辑器已打开目标项目（用 `unity doctor` 查看环境）',
      ],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  // F3/R348：写路径的传输层失败不是纯读故障 —— set 可能已改完，重试前必须先复核。
  if (!envl.ok) return withWriteRecheckHint(envl);
  const res = parseScriptResult(w, {
    label: 'node-set',
    describeError: (code, parsed) => {
      if (code === 'NOT_FOUND') {
        return {
          message: `节点不存在：${nodePath}`,
          actual: { path: nodePath },
          hint: [
            '用 `unity scene tree` 查看可用路径',
            '仅查当前激活场景（含 inactive 节点）；其它场景/DontDestroyOnLoad 里的节点会报 NOT_FOUND',
          ],
        };
      }
      if (code === 'BAD_PATCH') {
        return {
          message: `patch 不合法：${parsed.detail || parsed.field || '字段缺失或类型不符'}`,
          actual: parsed,
          hint: ['position / scale 需要完整的数值 x/y/z，如 {"x":1,"y":2,"z":0}'],
        };
      }
      return {};
    },
  });
  if (res.envelope) return res.envelope;

  // R81：改名后旧 nodePath 已不存在，读回路径换成同父前缀 + 新名。
  // R104②：用 `Object.hasOwn` 判「patch 里有没有 name」而不是 `patch.name` 的真值 ——
  // 与 `.cs` 的「字段存在即改名」口径一致（空名已在上面被 BAD_PATCH 挡下）。
  const slash = nodePath.lastIndexOf('/');
  const parentPrefix = slash === -1 ? '' : nodePath.slice(0, slash);
  const readPath = Object.hasOwn(patch, 'name')
    ? (parentPrefix ? `${parentPrefix}/${patch.name}` : patch.name)
    : nodePath;
  // R110④：set 中性文案 —— 明确不会新建节点，避免 create 专属的「清理残骸」误导
  return readBackAndVerify({
    projectPath, env, callFn, readPath, intent: patch,
    residue: '写入可能已生效；用 `unity scene tree` / `unity node inspect` 复核本次改动的落点（set 不会新建节点）',
  });
}

/**
 * `unity node delete`：删节点 + **写后读回**（「消失」才是成功）。
 *
 * 与 `nodeCreate`/`nodeSet` 不同，删除没有「读回一个对象」可比对 —— 判据是**读回必须落 `NOT_FOUND`**：
 *   - 写调用 reject → `WRITE_CALL_FAILED`（复用 R95 的收敛方式）；
 *   - `.cs` 报 `__error` → 直接按码失败（`NOT_FOUND` 是运行时错，退出码 1）；
 *   - 读回 `ok:true`（节点还在）→ `ok:true` + `verified:false` + `compareSubset` 的**真分歧**（**不许静默假绿**）；
 *   - 读回 `NOT_FOUND` → `verified:true`；
 *   - 读回落在别的失败码（如 `ULOOP_NO_JSON`）→ `READBACK_FAILED`（删除结果未知，提示复核）。
 *
 * **intent 语义（R226）**：delete 的意图一律表达为 `{path:null}`（= 该路径理应**不存在**），
 * 成功与失败信封都带它 —— 不再出现「信封说想删 X、分歧却写 intent:null」的自相矛盾；
 * `verified:false` 的分歧条目必须是 `compareSubset({path:null}, actual)` 的真产物，**不得手写**。
 *
 * **写结果必须符合协议（R225）**：`.cs` 要回报 `{"__deleted":true,"path":"<非空字符串>"}`；
 * 缺 `path` / `__deleted` 非 true → `BAD_SCRIPT_RESULT`（退出码 1），**绝不**静默回落调用方入参
 * —— 协议不符的响应若沿用入参读回，会产出**无证据的 `verified:true`**（违反「宁可 falsely-fail」）。
 *
 * 读回路径用 `.cs` 回报的**实际路径**（`parsed.path`），不是调用方给的入参 —— 入参可能是裸名。
 * `DestroyImmediate` 连带删子节点；skill §5 要求删**用户既有内容**前先问用户，本函数不做交互。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, path?: string, _call?: typeof call}} [opts]
 * @returns {Promise<object>} 信封
 */
async function nodeDelete({ projectPath, env, path: nodePath, _call } = {}) {
  if (typeof nodePath !== 'string' || nodePath === '') {
    return fail({
      code: 'MISSING_PATH',
      message: '缺少 --path（形如 Canvas/Btn）',
      actual: { path: nodePath },
      hint: ['用 `unity scene tree` 取可用路径'],
    });
  }
  const callFn = _call || call;
  // R226：delete 的 intent 语义固定为「该路径理应不存在」。
  // 只有 argv 用法错（MISSING_PATH）不带它 —— 那时连要删什么都不知道，与 nodeSet/nodeCreate 的用法守卫同口径。
  const intent = { path: null };
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('node-delete', { path: nodePath }), { projectPath, env });
  } catch (err) {
    return fail({
      code: 'WRITE_CALL_FAILED',
      message: `node-delete 写调用失败：${(err && err.message) || String(err)}`,
      intent,
      hint: [
        '删除是否生效未知；用 `unity scene tree` 复核',
        '确认编辑器已打开目标项目（用 `unity doctor` 查看环境）',
      ],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  // F3/R348：写路径的传输层失败不是纯读故障 —— delete 可能已删，重试前必须先复核。
  if (!envl.ok) return { ...withWriteRecheckHint(envl), intent };
  const res = parseScriptResult(w, {
    label: 'node-delete',
    describeError: (code, parsed) => {
      if (code === 'NOT_FOUND') {
        return {
          message: `节点不存在：${nodePath}`,
          actual: { path: nodePath },
          hint: [
            '用 `unity scene tree` 查看可用路径',
            '仅查当前激活场景（含 inactive 节点）；其它场景/DontDestroyOnLoad 里的节点会报 NOT_FOUND',
          ],
        };
      }
      return { message: `node-delete 返回错误：${code}`, actual: parsed, hint: ['检查 unity-scripts/node-delete.cs 的返回协议'] };
    },
  });
  if (res.envelope) return { ...res.envelope, intent };

  // R225：写结果必须符合协议 —— 缺 `path` 时若静默沿用调用方入参，读回可能落在**别的**路径上
  // 并落 `NOT_FOUND`，从而产出一个无证据的 `verified:true`。宁可 falsely-fail。
  if (res.parsed.__deleted !== true || typeof res.parsed.path !== 'string' || res.parsed.path === '') {
    return fail({
      code: 'BAD_SCRIPT_RESULT',
      message: 'node-delete 的写结果不符合协议（需要 {"__deleted":true,"path":"<实际路径>"}）',
      intent,
      actual: res.parsed,
      hint: [
        '检查 unity-scripts/node-delete.cs：`__deleted` 必须为 true、`path` 必须是非空字符串',
        '确认 `--code-file` 指向的是 node-delete.cs',
      ],
    });
  }
  const deletedPath = res.parsed.path;

  let read;
  try {
    read = await nodeInspect({ projectPath, env, path: deletedPath, _call: callFn });
  } catch (err) {
    return fail({
      code: 'READBACK_FAILED',
      message: `删除后读回失败：${(err && err.message) || String(err)}`,
      intent,
      hint: ['删除可能已生效；用 `unity scene tree` 复核'],
      phase: 'readback',
    });
  }
  if (read.ok) {
    // 节点还在 → 删除没生效（或删的是同名的另一个）。不假绿、也不抛。
    // R226：分歧必须是 `compareSubset({path:null}, actual)` 的真产物（不再手写条目），
    // 这样「同一信封里 intent 与 mismatches[].intent 打架」的自相矛盾从结构上消失。
    return {
      ...ok(read.actual, {
        verified: false,
        intent,
        hint: [
          '删除后节点仍在（verified:false）——不要继续叠加后续命令，先用 `unity scene tree` 复核',
          // R227①：删除不可逆，同名兄弟会让「删了 A、留下同名的 B」这种错位无从察觉
          '路径按名字拼接、不保证唯一 —— 若存在同名兄弟，被删的可能不是本次想要的那个，先 `unity scene tree` 核对',
        ],
      }),
      mismatches: compareSubset(intent, read.actual),
    };
  }
  if (read.code === 'NOT_FOUND') {
    // 没有分歧 —— 但显式给出空数组：写命令的成功信封一律带 `mismatches`（
    // `ok()` 白名单刻意不含它，`readBackAndVerify` 同样是显式附加）。
    return { ...ok({ path: deletedPath, deleted: true }, { verified: true, intent }), mismatches: [] };
  }
  return fail({
    code: 'READBACK_FAILED',
    message: `删除后读回结果不确定（${read.code}）：${read.message}`,
    intent,
    actual: read.actual,
    hint: [...(Array.isArray(read.hint) ? read.hint : []), '删除是否生效未知；用 `unity scene tree` 复核'],
    phase: 'readback',
  });
}

module.exports = {
  buildPayloadArgs, normalizeHierarchy, readHierarchyFile, sceneTree, nodeInspect,
  parseScriptResult, parseNodeResult, readBackAndVerify, nodeCreate, nodeSet, nodeDelete,
  SCRIPTS_DIR, PATCH_KEYS, withWriteRecheckHint, scriptErrorCode,
};
