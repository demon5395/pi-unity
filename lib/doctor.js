// lib/doctor.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { call, findDispatcher } = require('./uloop.js');
const { discover, languageInfo } = require('./editor-discovery.js');
// M2 任务 10：`--smoke` 的写-读回-删自闭环用**我们自己的库函数**（信封层 + 读写回 + 删除读回），
// 而不是裸 uloop 调用。
const { sceneTree, nodeCreate, nodeSet, nodeDelete } = require('./scene.js');

/** 枚举已安装的构建目标（U9：目标不是全的，取决于安装时勾选的模块）。 */
function playbackEngines(editorDir) {
  const dir = path.join(editorDir, 'Data', 'PlaybackEngines');
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * 产出失败描述（R43 / F1 / M2 任务 1 合并）。
 *
 * 两种形态共用同一套分流（**这正是合并的目的**：改「截断」措辞或分流规则时不可能只改一处）：
 * - `standalone: false`（默认）—— 能拼在「无法连接」之后的**中缀片段**（`：<msg>（退出码 N）`）；
 * - `standalone: true` —— **整句**，供 per-tool 冒烟用：自带主语「工具报告失败：」，
 *   且 `code === 0` 时**不拼**「退出码 0」（那不含信息量，正是 R42 要消灭的退化）。
 *
 * spawnError 分支两种形态输出相同：它已有准确的「无法启动 dispatcher」措辞。
 * `timedOut || drained` 才说「输出被截断，可重试」。
 */
function failureText(r, { standalone = false } = {}) {
  if (r.spawnError) return `无法启动 dispatcher：${r.spawnError.message}（退出码 ${r.code}）`;
  const detail = r.json && r.json.Error && r.json.Error.Message;
  const cut = r.timedOut || r.drained ? '；输出被截断，可重试' : '';
  if (!standalone) {
    const base = detail ? `：${detail}（退出码 ${r.code}）` : `（退出码 ${r.code}）`;
    return `${base}${cut}`;
  }
  const code = r.code === 0 ? '' : `（退出码 ${r.code}）`;
  const base = detail ? `工具报告失败：${detail}${code}` : `工具报告失败且未给出原因${code}`;
  return `${base}${cut}`;
}

/**
 * 生成 `editor-connection` 的 message（R27 / R31 / R43）。
 * 失败响应同样带 json（uloop 把完整的错误对象写到 stderr），所以必须按**状态**分流，
 * 而不是按「有没有 json」——否则会出现「状态 fail 但文案说已连接」的自相矛盾。
 * 失败描述由 {@link failureText} 提供，这里只加「无法连接」前缀
 * （spawnError 除外：它已有准确的「无法启动 dispatcher」措辞）。
 */
function connectionMessage(r, ok) {
  if (ok) return `uloop ${r.json.Version ?? ''} 已连接`;
  // R43：spawnError 时 failureText 已给出「无法启动 dispatcher」措辞，再加
  // 「无法连接」前缀会重复且语义偏差（R31 断言也用该措辞）；连接检查的既有文案保持不变。
  return r.spawnError ? failureText(r) : `无法连接${failureText(r)}`;
}

/** spawnError 时的统一 hint（collectChecks 与 smoke 共用）。 */
const DISPATCHER_HINT = '设置 PI_UNITY_ULOOP_BIN / PI_UNITY_ULOOP_CMD 指向正确的 dispatcher';

/**
 * 探活（`list`）是否说明「真的连上了 dispatcher」。
 *
 * ⚠️ **R115（2026-09-19 团结 2022.3.62t9 + uloop dispatcher 3.5.1 真机实证；
 * 修正 R15/R16 对 `list` 的误用）**：
 * R15/R16 的 `Success === true` 判据是针对 **first-party 工具**的 —— `compile` /
 * `get-logs` / `get-hierarchy` 真机响应确实都带布尔 `Success`（已逐条核实）。
 * 但 `list` 是 **dispatcher 级命令**，真机响应是 `{Version, Tools:[...]}`，
 * **没有 `Success` 字段**（实拍：顶层键 `Version, Tools`；`Object.hasOwn(json,'Success') === false`）。
 * 把工具级判据套在 `list` 上会让「编辑器明明连着」被报成
 * `FAIL editor-connection 无法连接（退出码 0）` —— **假红**，`unity doctor` 永远不绿，
 * skill 黄金流程的第一步（doctor 不绿不许往下做）被直接堵死。
 *
 * 故 `list` 的判据改为 dispatcher 的**具体形状**：`Version` 是字符串且 `Tools` 是数组。
 *
 * ⚠️ **放宽的边界（F1 修正，勿再夸大为「更有鉴别力」）**：新判据等价于
 * `Success === true` **OR** `{Version:string, Tools:array}`，是旧判据的**严格超集**：
 * - 放宽**只**针对 `{Version, Tools}` 这一具体形状 —— `{"hello":1}` 这类裸对象仍 fail；
 * - `{"Success":true}`（code=0）**继续被接受**（单测 fixture / 历史形状），
 *   所以相对旧判据，鉴别力**没有增强、只是没有退化**（R15「别的程序不许假绿」未被收严）；
 * - 显式 `Success === false` 一律 fail —— 真机实测（2026-09-19）：编辑器**关掉**时 dispatcher 返回
 *   `{Success:false, Error:{ErrorCode:'UNITY_NOT_REACHABLE', ...}}`（退出码 1），正是走这条分支。
 * 要真正收严（例如要求 `Version` 形如 semver）需在 M2 讨论。
 */
function isConnectedProbe(r) {
  if (r.code !== 0 || !r.json || typeof r.json !== 'object') return false;
  if (r.json.Success === true) return true;
  if (r.json.Success === false) return false;
  return typeof r.json.Version === 'string' && Array.isArray(r.json.Tools);
}

/**
 * 把 `Error.NextActions` 归一成数组（R34 / R37，doctor 与 smoke 共用）。
 * 它可能是字符串 / 布尔 / 数字：直接当 hint 会让人读路径逐字符打印，
 * 或让 `for (const h of hint)` 抛 TypeError 把排障入口变成 internal error。
 */
function errorNextActions(json) {
  return json && json.Error && Array.isArray(json.Error.NextActions) ? json.Error.NextActions : [];
}

async function collectChecks({ env = process.env, appData, projectPath, rootDir, runImpl, _call } = {}) {
  const checks = [];
  // M2 任务 10：连接检查也走统一的注入缝（`_call` 优先；生产不传时行为与 M1 逐字一致）。
  const callFn = _call || ((tool, args, opts) => call(tool, args, { ...opts, rootDir, runImpl }));

  // 1. uloop dispatcher 是否存在
  // ⚠️ R23/R29：不能用 `status: cmd ? ... : ...` —— findDispatcher 永远返回非空 cmd
  // （最次兜底裸名 uloop.exe/uloop），那样在完全没装 uloop 时也会假绿。
  // 判据是「解析结果是一个磁盘上真实存在的文件」：
  // - 无效的 CMD（非法 JSON / 非字符串元素）与指向不存在文件的 BIN 都会让
  //   findDispatcher 回落裸名 → 不存在 → fail，用户配置的错误路径不会被掩盖；
  // - `typeof` 守卫必须在 `fs.existsSync` 之前：`PI_UNITY_ULOOP_CMD='[123]'`
  //   会让 cmd 是数字 123，`fs.existsSync(123)` 会抛 ERR_INVALID_ARG_TYPE；
  // - 不得为此复制 findDispatcher 的 JSON 解析逻辑（R23）。
  const { cmd } = findDispatcher({ env, rootDir });
  const found = typeof cmd === 'string' && fs.existsSync(cmd);
  const dispatcherHint = ['设置 PI_UNITY_ULOOP_BIN 指向 uloop 可执行文件'];
  checks.push({
    name: 'uloop',
    status: found ? 'pass' : 'fail',
    code: found ? null : 'DISPATCHER_NOT_FOUND',
    message: found
      ? `dispatcher: ${cmd}`
      : `未配置 PI_UNITY_ULOOP_CMD / PI_UNITY_ULOOP_BIN，且未在仓库根 uloop-bin 找到（裸名 ${cmd} 只在 PATH 里兜底）`,
    hint: found ? [] : dispatcherHint,
  });

  // 2. 编辑器安装（O5）
  const editors = discover({ env, appData });
  checks.push({
    name: 'editor-install',
    status: editors.length > 0 ? 'pass' : 'fail',
    code: editors.length > 0 ? null : 'EDITOR_NOT_FOUND',
    message: editors.length > 0
      ? editors.map((e) => `${e.version} (${e.source})`).join(', ')
      : '未发现编辑器。已尝试：PI_UNITY_EDITOR_BIN → %APPDATA%\\TuanjieHub\\secondaryInstallPath.json → hubInfo.json → Unity 官方默认路径',
    hint: editors.length > 0 ? [] : [
      '设置 PI_UNITY_EDITOR_BIN 指向 Tuanjie.exe / Unity.exe',
      '确认 %APPDATA%\\TuanjieHub\\secondaryInstallPath.json 存在',
    ],
  });

  // 3. 界面语言（O6 的输入；多 Hub 探测见 editor-discovery.js）
  // ⚠️ 多引擎共存机上该值只反映**配置**，未必是当前所连编辑器界面的语言（PITFALLS 官方-3）——
  // 故这里把**真正给出语言的 Hub 目录**一并报出（都读不到时如实写「未找到」）。
  const lang = languageInfo({ appData, env });
  checks.push({
    name: 'editor-language',
    status: 'pass',
    code: null,
    message: `${lang.language}（hub: ${lang.hub || '未找到 languageConfig.json，已回落 en_US'}）`,
    hint: [],
  });

  // 4. PlaybackEngines（U9）
  if (editors.length > 0) {
    const engines = playbackEngines(path.dirname(editors[0].path));
    checks.push({
      name: 'build-targets',
      status: engines.length > 0 ? 'pass' : 'fail',
      code: engines.length > 0 ? null : 'BUILD_TARGETS_NONE',
      message: engines.join(', ') || '无',
      hint: engines.includes('WebGLSupport') ? [] : ['未安装 WebGL 模块：`unity build --target webgl` 会如实落 BUILD_TARGET_UNAVAILABLE（退出码 1），不会改打别的目标'],
    });
  }

  // 5. 编辑器连接（真机）
  // ⚠️ R24：dispatcher 都没找到时不要 spawn —— 裸名 uloop.exe 会走 PATH，
  // 既不可靠又慢，还可能歪打正着连上别的程序。直接产出 fail 并说明已跳过。
  if (!found) {
    checks.push({
      name: 'editor-connection',
      status: 'fail',
      code: 'EDITOR_CONNECTION_FAILED',
      message: '未找到 dispatcher，跳过连接检查',
      hint: dispatcherHint,
    });
  } else {
    const r = await callFn('list', [], { env, projectPath });
    // ⚠️ R15/R16 的 `Success === true` 判据是为 **first-party 工具**定的；`list` 是 dispatcher 级
    //    命令，真机不带 `Success` → 用专门的探活判据（R115，见 isConnectedProbe 的 JSDoc）。
    const ok = isConnectedProbe(r);
    // R34：NextActions 可能不是数组（字符串/布尔/数字），直接当 hint 会让人读路径逐字符打印，
    // 或让 `for (const h of c.hint)` 抛 TypeError 把排障入口变成 internal error。
    const nextActions = errorNextActions(r.json);
    checks.push({
      name: 'editor-connection',
      status: ok ? 'pass' : 'fail',
      code: ok ? null : 'EDITOR_CONNECTION_FAILED',
      message: connectionMessage(r, ok),
      // R31：spawnError 时 json 为 null（truncated 契约），NextActions 必为空，
      // 需要单独给出「去配置 dispatcher」的提示，而不是留空。
      hint: r.spawnError ? [DISPATCHER_HINT] : nextActions,
    });
  }

  return checks;
}

/**
 * 只读冒烟要跑的工具（顺序即输出顺序）。
 * 全部是**只读**工具：绝不写场景、不改工程。
 * `pick` 把成功响应压成一行人读文案；**读不到所需字段时返回 null**（R38），
 * 由调用方判 fail 并点名缺失字段，绝不用 `?` 之类占位符假装成功。
 * `missing` 是 `pick` 所需字段名，仅用于字段缺失时的错误文案。
 */
const SMOKE_TOOLS = [
  {
    name: 'compile',
    args: [],
    missing: 'ErrorCount/WarningCount',
    pick: (j) => (typeof j.ErrorCount === 'number' && typeof j.WarningCount === 'number'
      ? `errors=${j.ErrorCount} warnings=${j.WarningCount}`
      : null),
  },
  {
    name: 'get-logs',
    args: ['--max-count', '1'],
    missing: 'TotalCount',
    pick: (j) => (typeof j.TotalCount === 'number' ? `total=${j.TotalCount}` : null),
  },
  {
    name: 'get-hierarchy',
    args: [],
    missing: 'HierarchyFilePath',
    pick: (j) => (typeof j.HierarchyFilePath === 'string' && j.HierarchyFilePath
      ? `saved: ${j.HierarchyFilePath}`
      : null),
  },
];

/** 冒烟里用到的节点名（临时，跑完必删）。 */
const SMOKE_NODE = '__pi_smoke';

/**
 * `--smoke` 的全部项名（**唯一真值**，R304⑦）：{@link SMOKE_ITEMS} 与 {@link writeLoopItems}
 * 都从它派生 —— 两份硬编码的名字会在改名时静默漂移（JSON 里一项、人读行里另一项）。
 * 顺序：前 3 项是只读工具（{@link SMOKE_TOOLS}），后 4 项是写闭环。
 */
const SMOKE_ITEM_NAMES = [
  ...SMOKE_TOOLS.map((t) => t.name),
  'write-create', 'write-set', 'write-delete', 'write-clean',
];

/** 写闭环四项的名字（同一份真值的切片，供 {@link writeLoopItems} 使用）。 */
const SMOKE_WRITE_NAMES = SMOKE_ITEM_NAMES.slice(SMOKE_TOOLS.length);

/** `--smoke` 的全量清单（探活失败 / 缺项目根时全 skip，顺序与成功时逐字一致）。 */
const SMOKE_ITEMS = SMOKE_ITEM_NAMES.map((name) => ({ name }));

/**
 * 冒烟：先探活，再逐个跑只读工具，最后跑**写-读回-删自闭环**（M2：规格 §6.2 的后半句）。
 *
 * ⚠️ **`--smoke` 从 M2 起不再只读**：它会在当前场景建 `__pi_smoke`、改它的 position、
 * 再删掉它，并**读回确认无残留**。编辑器场景会因此变 dirty；本命令**不保存场景**。
 *
 * 写闭环用我们自己的库函数（`nodeCreate`/`nodeSet`/`nodeDelete`/`sceneTree`），所以它验证的是
 * 「信封层 + 写后读回 + 删除读回」整条链，而不是「上游某个工具能跑」。
 *
 * - R35/F4：探活判据**与被调命令的响应形状一致**（`list` 用 {@link isConnectedProbe}，
 *   不是 `Success === true`）；**每工具** pass 判据仍是 `Success === true`（见下方 `pass`）。
 *   连不通时**每一项**都 skip
 *   （避免每个工具各报一次同样的连接错误），message 复用 {@link connectionMessage}，
 *   不得把 spawnError / 输出截断说成「编辑器未连接」。
 * - R38：`Success` 为真但字段缺失仍判 fail，并点名缺哪个字段。
 * - R40：`rootDir` / `runImpl` 是纯注入缝，透传给 `call`；生产不传则行为不变。
 * - M2 任务 10：`_call` 是新的注入缝（假后端驱动写闭环用），优先级高于 `rootDir`/`runImpl`；
 *   每项都带 `code`（pass 为 `null`、skip / fail 为具名码）——这是 `--json` 的统一契约。
 *
 * @returns {Promise<Array<{name:string,status:'pass'|'fail'|'skip',code:string|null,
 *   message:string,hint:string[]}>>}
 */
async function smoke({ env = process.env, projectPath, rootDir, runImpl, _call } = {}) {
  const callFn = _call || ((tool, args, opts) => call(tool, args, { ...opts, rootDir, runImpl }));
  const probe = await callFn('list', [], { env, projectPath });
  // 同 collectChecks：`list` 是 dispatcher 级命令，判据用 isConnectedProbe（R115）
  const probeOk = isConnectedProbe(probe);
  if (!probeOk) {
    const message = connectionMessage(probe, probeOk);
    const hint = probe.spawnError ? [DISPATCHER_HINT] : errorNextActions(probe.json);
    // F5：每项复制一份 hint —— 共享同一个数组实例时，任一处 push 会污染其它项。
    return SMOKE_ITEMS.map((t) => ({ name: t.name, status: 'skip', code: 'NOT_CONNECTED', message, hint: [...hint] }));
  }

  const out = [];
  for (const t of SMOKE_TOOLS) {
    const r = await callFn(t.name, t.args, { env, projectPath });
    const pass = Boolean(r.code === 0 && r.json && r.json.Success === true); // 同任务 6：必须是 === true
    const picked = pass ? t.pick(r.json) : null;
    if (picked !== null) {
      out.push({ name: t.name, status: 'pass', code: null, message: picked, hint: [] });
    } else if (pass) {
      // R38：Success 为真但字段缺失 —— 这仍是一次失败，不能假装成功
      out.push({ name: t.name, status: 'fail', code: 'SMOKE_FIELD_MISSING', message: `响应缺少 ${t.missing}`, hint: [] });
    } else {
      out.push({
        name: t.name,
        status: 'fail',
        code: 'SMOKE_TOOL_FAILED',
        // R42/R43/F1：不得退回简报的 `Error.Message ?? 退出码 ${r.code}` —— drained（code=0、
        // timedOut=false）会退化成「退出码 0」，用户看不出真正原因。也不能复用
        // `connectionMessage`（会谎称「无法连接」），更不能复用中缀片段 `failureText`
        // 的默认形态（行首孤立全角冒号），故用整句形态 `failureText(..., { standalone: true })`。
        // R202：任务 1 已删掉 `standaloneFailure`，这里必须用定稿签名。
        message: failureText(r, { standalone: true }),
        // F3/R46：call 契约保证 spawnError 时 json=null，errorNextActions 必为 []，
        // 需要单独给出与探活/collectChecks 一致的「去配置 dispatcher」提示。
        hint: r.spawnError ? [DISPATCHER_HINT] : errorNextActions(r.json),
      });
    }
  }

  out.push(...await writeLoopItems({ projectPath, env, callFn }));
  return out;
}

/** 写闭环各步的 **pass 文案**（R298：逐字保持任务 10 的原样，只把取值收进单一真值）。 */
const WRITE_PASS_TEXT = {
  create: `verified: true（建了 ${SMOKE_NODE}）`,
  set: 'verified: true（position {1,2,0}）',
  delete: 'verified: true（已删除）',
};

/**
 * 写闭环某一步的人读文案（R298；名字沿用审查裁定，尽管它也负责 pass 文案）。
 *
 * `ok` 与 `verified` 是**两个正交的轴**，三种组合各自真实可达：
 * - `ok:true` + `verified:true`  → pass 文案（{@link WRITE_PASS_TEXT}）；
 * - `ok:true` + `verified:false` → **真实可达**（Unity 钳制数值 / 改名 / 未应用 patch）：
 *   `ok()` 的白名单**不含 `code`/`message`**，旧写法 `${e.code}${e.message ? … : ''}` 会打出
 *   字面 **`undefined`**，并且丢掉唯一的证据 `mismatches`（在 `readBackAndVerify` 的返回里）；
 * - `ok:false` → fail 信封的具名 `code` + `message`。
 *
 * @param {'create'|'set'|'delete'} name 步骤短名（失败文案沿用 M2 的 `create 未通过：…`）
 * @param {object} e `nodeCreate` / `nodeSet` / `nodeDelete` 的信封
 * @returns {string}
 */
function writeFailMessage(name, e) {
  if (e.ok && e.verified === true) return WRITE_PASS_TEXT[name] || `verified: true（${name}）`;
  if (e.ok && e.verified === false) {
    const detail = (Array.isArray(e.mismatches) ? e.mismatches : [])
      .map((m) => `${m.key}=${JSON.stringify(m.actual)}`)
      .join(', ');
    return `读回与意图不一致（verified:false）：${detail || '见 hint'}`;
  }
  return `${name} 未通过：${e.code}${e.message ? ` ${e.message}` : ''}`;
}

/**
 * 残留判定**限定根层**（R303）：smoke 只在**根**建 `__pi_smoke`，清理也用裸名（根路径）。
 * 递归匹配任意深度会让 `Canvas/__pi_smoke` 变成「检测到 → 裸名删不掉 → 每次 `--smoke` 都失败」
 * 的永久假红，且给用户的手工命令（`unity node delete --path __pi_smoke`）也无效。
 */
function hasRootNode(roots, name) {
  return (Array.isArray(roots) ? roots : []).some((r) => r && typeof r === 'object' && r.name === name);
}

/**
 * 写闭环的 4 个冒烟项。顺序固定（create → set → delete → clean），任一步失败后续步仍继续跑
 * （失败细节比「短路」更有诊断价值），但 `write-clean` 的判定独立：只要最后读回还有残留就 fail。
 *
 * 开局先清上一次跑挂留下的 `__pi_smoke` —— 不清掉会让 `nodeInspect` 的路径语义变歧义
 * （Unity 允许同名兄弟，真机 `node-create.cs` 也不查重）。
 *
 * R300：`status` = **是否执行**、`code` = **原因** —— 探活失败用 `NOT_CONNECTED`，
 * **前置步骤失败**产生的 skip 用 `WRITE_LOOP_NOT_RUN`（不得再拿 `WRITE_LOOP_FAILED` 冒充原因）。
 * R306：`projectPath` 不是非空字符串时**零写入**，四项 skip + `MISSING_PROJECT_PATH`
 * （不强加退出码 2：`doctor --smoke` 的只读部分仍照 M1 行为跑完）。
 */
async function writeLoopItems({ projectPath, env, callFn }) {
  const items = [];
  const item = (name, status, code, message, hint = []) => ({ name, status, code, message, hint });
  const [W_CREATE, W_SET, W_DELETE, W_CLEAN] = SMOKE_WRITE_NAMES;

  // R306：写路径必须先确定项目根 —— 缺 --project-path 时绝不落任何写调用。
  if (typeof projectPath !== 'string' || projectPath === '') {
    const hint = ['用 --project-path <项目根> 指定项目（写闭环必须知道往哪个工程写）'];
    return SMOKE_WRITE_NAMES.map((name) => item(
      name, 'skip', 'MISSING_PROJECT_PATH', '缺少 --project-path，写闭环未执行（零写入）', [...hint],
    ));
  }

  // ① 开局清残留（上一次跑挂了会留下它；不清掉会让 nodeInspect 的路径语义变歧义）
  let residueNote = '';
  let precheckHint = [];
  const before = await sceneTree({ projectPath, env, _call: callFn });
  if (!before.ok) {
    // R301：读回失败 → 残留守卫**根本没被评估**（可能带着残留去 create）。绝不能静默吞掉。
    precheckHint = [`清理前读回失败：${before.code} ${before.message}`];
  } else if (hasRootNode(before.actual.roots, SMOKE_NODE)) {
    const del = await nodeDelete({ projectPath, env, path: SMOKE_NODE, _call: callFn });
    if (del.ok && del.verified === true) residueNote = '（已清理上一次的残留）';
    else {
      return [
        item(W_CREATE, 'fail', 'WRITE_LOOP_RESIDUE', `上一次的 ${SMOKE_NODE} 清不掉：${writeFailMessage('delete', del)}`, del.hint || []),
        item(W_SET, 'skip', 'WRITE_LOOP_NOT_RUN', '写闭环被残留阻断，set 未执行', []),
        item(W_DELETE, 'skip', 'WRITE_LOOP_NOT_RUN', '写闭环被残留阻断，delete 未执行', []),
        item(W_CLEAN, 'fail', 'WRITE_LOOP_RESIDUE', `${SMOKE_NODE} 仍在场景里`, [`unity node delete --path ${SMOKE_NODE}`]),
      ];
    }
  }

  const create = await nodeCreate({ projectPath, env, name: SMOKE_NODE, _call: callFn });
  const createOk = create.ok && create.verified === true;
  items.push(createOk
    ? item(W_CREATE, 'pass', null, `${writeFailMessage('create', create)}${residueNote}`, precheckHint)
    // R301：预检失败的痕迹并进 hint（pass 时也带 —— 「没评估残留」与 create 成败无关）
    : item(W_CREATE, 'fail', 'WRITE_LOOP_FAILED', writeFailMessage('create', create), [...(create.hint || []), ...precheckHint]));

  const set = createOk
    ? await nodeSet({ projectPath, env, path: SMOKE_NODE, patch: { position: { x: 1, y: 2, z: 0 } }, _call: callFn })
    : null;
  const setOk = Boolean(set && set.ok && set.verified === true);
  if (setOk) items.push(item(W_SET, 'pass', null, writeFailMessage('set', set)));
  else if (!set) items.push(item(W_SET, 'skip', 'WRITE_LOOP_NOT_RUN', 'create 没成功，set 未执行', []));
  else items.push(item(W_SET, 'fail', 'WRITE_LOOP_FAILED', writeFailMessage('set', set), set.hint || []));

  const del = createOk
    ? await nodeDelete({ projectPath, env, path: SMOKE_NODE, _call: callFn })
    : null;
  const delOk = Boolean(del && del.ok && del.verified === true);
  if (delOk) items.push(item(W_DELETE, 'pass', null, writeFailMessage('delete', del)));
  else if (!del) items.push(item(W_DELETE, 'skip', 'WRITE_LOOP_NOT_RUN', 'create 没成功，delete 未执行', []));
  else items.push(item(W_DELETE, 'fail', 'WRITE_LOOP_FAILED', writeFailMessage('delete', del), del.hint || []));

  // 最终读回确认无残留 —— 这一步是「闭环」的闭环
  const after = await sceneTree({ projectPath, env, _call: callFn });
  if (!after.ok) {
    items.push(item(W_CLEAN, 'fail', 'WRITE_LOOP_FAILED', `清理后读回失败：${after.code} ${after.message}`, after.hint || []));
  } else if (hasRootNode(after.actual.roots, SMOKE_NODE)) {
    items.push(item(W_CLEAN, 'fail', 'WRITE_LOOP_RESIDUE', `${SMOKE_NODE} 仍在场景里（残骸）`, [`unity node delete --path ${SMOKE_NODE}`]));
  } else {
    // R302：pass 分支必须带上 `after.hint` —— `sceneTree` 在 otherSceneCount>0 时会给
    // 「还有 N 个场景未读」；丢掉它会让「无残留」的结论范围被隐去。
    items.push(item(W_CLEAN, 'pass', null, '无残留（读回确认）', after.hint || []));
  }
  return items;
}

/**
 * 在 roots 里按名字**深找**（通用工具；R303 之后 smoke 的残留判定改用根层的 {@link hasRootNode}，
 * 本函数保留给需要全深度查找的调用方）。
 */
function findNodeByName(roots, name) {
  for (const r of Array.isArray(roots) ? roots : []) {
    if (!r || typeof r !== 'object') continue;
    if (r.name === name) return r;
    const hit = findNodeByName(r.children, name);
    if (hit) return hit;
  }
  return null;
}

// R41：`runImpl` / `rootDir` 透传给 `smoke` / `collectChecks`，让 `--smoke` 的退出码（R39）
// 与 JSON 结果可测；纯增量注入缝，生产不传时行为不变。
// M2 任务 10：新增 `_call`（写闭环的假后端注入缝，透传给 smoke / runGolden / collectChecks）；
// `appData` 也一并透传（否则 `doctor --json` 的隔离性测试会读到真实 Hub 目录）。
async function doctor(argv, { env = process.env, runImpl, rootDir, _call, appData } = {}) {
  // D-A2：`lib` 不得依赖 `bin` —— 这里**自己**接 `normalizeBooleans`（不 require `bin/unity.js` 的
  // `parseArgsStrict`）。归一失败（如 `--smoke=maybe`）按既有 argv 形状错的做法直接返回 EXIT_USAGE。
  const { parseArgs, normalizeBooleans } = require('./args.js');
  const { EXIT_USAGE } = require('./envelope.js');
  const normalized = normalizeBooleans(parseArgs(argv));
  if (normalized.error) {
    process.stderr.write(`[FAIL] ${normalized.error.code}: ${normalized.error.message}\n`);
    for (const h of normalized.error.hint) process.stderr.write(`  hint: ${h}\n`);
    return EXIT_USAGE;
  }
  const args = normalized.args;

  // `--smoke` 与 `--golden` 都会向当前场景写入：混跑会让「谁建的节点」无法归因，直接用退出码 2 拒绝。
  if (args.smoke && args.golden) {
    process.stderr.write('--smoke 与 --golden 不能同时用（两者都会向当前场景写入，混跑无法归因）\n');
    // R222 / 约束 16：用法错的退出码取**单一常量**（裸 `2` 会在 handler 之间漂移）；
    // 该冲突只由 argv 决定，所以走用法错（不经信封）。EXIT_USAGE 已在函数顶部引入。
    return EXIT_USAGE;
  }

  if (args.golden) {
    const { runGolden } = require('./golden.js');
    // M2 任务 10：补上 `_call` 透传（为 `doctor --json --golden` 的形状断言提供注入缝）。
    // `runGolden` 忽略 `rootDir`/`runImpl`，保留它们只是为了不改任务 9 已经写好的调用面。
    const r = await runGolden({ projectPath: args['project-path'], env, rootDir, runImpl, _call });
    if (args.json) {
      process.stdout.write(JSON.stringify({
        ok: r.ok,
        mode: 'golden',
        matched: r.matched,
        diff: r.diff,
        cleanup: r.cleanup,
        blocked: r.blocked,
        lines: r.lines,
      }, null, 2) + '\n');
    } else {
      for (const l of r.lines) process.stdout.write(`${l}\n`);
    }
    return r.ok ? 0 : 1;
  }

  if (args.smoke) {
    const results = await smoke({ env, projectPath: args['project-path'], rootDir, runImpl, _call });
    const failed = results.filter((r) => r.status === 'fail');
    const passed = results.filter((r) => r.status === 'pass');
    const skipped = results.filter((r) => r.status === 'skip');
    // R39/R45：只在「至少一项 pass、无 fail 且无 skip」时算通过 —— 全 skip（乃至部分 skip）
    // 都不算成功，否则基础检查在编辑器未连接时返回 1，而 --smoke 返回 0，自相矛盾且属 falsely-pass。
    // ⚠️ 这里的 `ok` 语义是「**本次检查集**通过」，**不是**信封的 `ok`（信封还有 `verified`）。
    const ok = failed.length === 0 && skipped.length === 0 && passed.length > 0;
    if (args.json) {
      // M2 契约统一（M1 延后项④）：两种模式都是 `{ok, mode, checks}`（golden 显式例外，不用 checks）。
      process.stdout.write(JSON.stringify({ ok, mode: 'smoke', checks: results }, null, 2) + '\n');
    } else {
      for (const r of results) {
        process.stdout.write(`${r.status === 'pass' ? '  OK ' : r.status === 'skip' ? 'SKIP ' : 'FAIL '} ${r.name.padEnd(18)} ${r.message}\n`);
        for (const h of r.hint) process.stdout.write(`       hint: ${h}\n`);
      }
      // R299：只有**全 skip** 才能说「未能验证任何工具」—— 部分 skip（create 失败 → set/delete
      // skip、残留阻断 → set/delete skip）时只读三工具可能全 pass，原句就是假话。
      if (skipped.length === results.length) {
        process.stdout.write(`\n冒烟未执行（${skipped.length} 项被跳过）：未能验证任何工具\n`);
      } else if (skipped.length > 0) {
        process.stdout.write(`\n${skipped.length} 项因前置步骤失败未执行（这几项未验证）。\n`);
      }
    }
    return ok ? 0 : 1;
  }

  const checks = await collectChecks({ env, projectPath: args['project-path'], rootDir, runImpl, _call, appData });
  const failed = checks.filter((c) => c.status === 'fail');

  if (args.json) {
    // M2 契约统一（M1 延后项④）：`{ok, mode, checks}`（与 --smoke 同形）。
    process.stdout.write(JSON.stringify({ ok: failed.length === 0, mode: 'basic', checks }, null, 2) + '\n');
  } else {
    for (const c of checks) {
      process.stdout.write(`${c.status === 'pass' ? '  OK ' : 'FAIL '} ${c.name.padEnd(18)} ${c.message}\n`);
      for (const h of c.hint) process.stdout.write(`       hint: ${h}\n`);
    }
    process.stdout.write(failed.length === 0 ? '\n全部通过。\n' : `\n${failed.length} 项失败。\n`);
  }
  return failed.length === 0 ? 0 : 1;
}

module.exports = {
  doctor, collectChecks, playbackEngines, smoke,
  // M2 任务 10：写闭环的测试/引用面（任务 11 的 skill 会引用这些常量与项名）。
  writeLoopItems, findNodeByName, SMOKE_NODE,
};
