'use strict';

const { sceneTree, nodeCreate, nodeSet, nodeDelete } = require('./scene.js');

/**
 * `doctor --golden`：**同一组确定性指令搭两轮**，比对 `get-hierarchy` 的**结构投影**，报首个分歧路径。
 *
 * 为什么用白名单投影而不是「剥 GUID」：本版本 `get-hierarchy` 的真机输出**没有 GUID 字段**
 * （实测 2026-09-19，节点键只有 name/isActive/components/siblingIndex/tag/layer/children，
 * 顶层只有 ExportTimestamp/Context/Hierarchy），唯一的易变字段是 ExportTimestamp。
 * 白名单投影对未来新增字段免疫（不会把上游加字段误判成变异），也把「只比结构」这件事写在明处。
 *
 * 清理纪律（照搬 pi-cocos 的 golden）：跑完必须删掉临时根 + **读回确认**；删不掉就显式报残留
 * 路径与手工命令，**绝不谎报成功**，也绝不在有残骸的情况下继续下一轮。
 *
 * ⚠️ 本命令会向**当前场景**写临时节点（随后删除），编辑器场景会变 dirty；本命令**不保存场景**。
 */

/** 临时根名（两轮都用同一个名字，故可整树比对；也是清理的锚点）。 */
const GOLDEN_ROOT = '__pi_golden';

/**
 * 确定性指令集（**写死**；每一步的参数都是常量）。
 * 覆盖：根节点 / 子节点 / 带组件的子节点 / 嵌套子节点（裸名规则的边界）/ `node set` 的 position+scale /
 * `active:false`（**验证删除路径也能命中非激活节点**，R80/R82 的核心）。
 */
const GOLDEN_STEPS = [
  { kind: 'create', name: GOLDEN_ROOT },
  { kind: 'create', name: 'GOLDEN_A', parent: GOLDEN_ROOT },
  { kind: 'create', name: 'GOLDEN_B', parent: GOLDEN_ROOT, components: ['SpriteRenderer'] },
  { kind: 'create', name: 'GOLDEN_C', parent: `${GOLDEN_ROOT}/GOLDEN_B` },
  { kind: 'set', path: GOLDEN_ROOT, patch: { position: { x: 1, y: 2, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
  { kind: 'set', path: `${GOLDEN_ROOT}/GOLDEN_B`, patch: { active: false } },
];

/** 单个节点的结构投影（白名单：只保留结构字段，易变/无关字段一律丢弃）。 */
function projectNode(node) {
  const n = node && typeof node === 'object' ? node : {};
  return {
    name: n.name,
    active: n.active,
    components: Array.isArray(n.components) ? [...n.components] : [],
    siblingIndex: n.siblingIndex,
    tag: n.tag,
    layer: n.layer,
    children: (Array.isArray(n.children) ? n.children : []).map(projectNode),
  };
}

/** 整棵树的投影（`normalizeHierarchy` 的产物 → 可比对的结构）。 */
function projectStructure(normalized) {
  const n = normalized && typeof normalized === 'object' ? normalized : {};
  return {
    sceneName: n.sceneName,
    nodeCount: n.nodeCount,
    roots: (Array.isArray(n.roots) ? n.roots : []).map(projectNode),
  };
}

/**
 * 首个分歧（**结构化**，不只是字符串）。`kind` 语义：
 *   - `'type'`          两侧类型不同（含 `array` vs `object`）
 *   - `'array-length'`  数组长度不同（`a`/`b` 是长度数字）
 *   - `'missing-right'` 只有 a 有该键（b 缺）
 *   - `'missing-left'`  只有 b 有该键（a 缺）
 *   - `'value'`         值不同
 * `path` 形如 `roots[0].children[1].components[2]`；根为 `<root>`。
 *
 * R294：`a` / `b` **恒存在**（缺键与 `undefined` 值一律规范成 `null`）——`undefined` 在
 * `JSON.stringify` 里会**整键消失**，`--json` 消费方会读到 `diff.a === undefined`（甚至没有该键），
 * 与「字段缺失」的判据打架。
 */
function firstDiff(a, b, path = '') {
  if (a === b) return null;
  const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  // R294：`undefined` → `null`，保证 `a`/`b` 两个键**一定**出现在返回值里。
  const mk = (kind, x, y) => ({ path: path || '<root>', kind, a: x === undefined ? null : x, b: y === undefined ? null : y });
  if (kindOf(a) !== kindOf(b)) return mk('type', a, b);
  if (Array.isArray(a)) {
    if (a.length !== b.length) return mk('array-length', a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      const p = path ? `${path}.${k}` : k;
      const ha = Object.hasOwn(a, k);
      const hb = Object.hasOwn(b, k);
      if (ha && !hb) return { path: p, kind: 'missing-right', a: a[k] === undefined ? null : a[k], b: null };
      if (!ha && hb) return { path: p, kind: 'missing-left', a: null, b: b[k] === undefined ? null : b[k] };
      const d = firstDiff(a[k], b[k], p);
      if (d) return d;
    }
    return null;
  }
  return mk('value', a, b);
}

/** `{path}` 可读化（给人读输出用；JSON 里给的是结构本身）。 */
function formatDiff(d) {
  return `${d.path}（${d.kind}）：${JSON.stringify(d.a)} vs ${JSON.stringify(d.b)}`;
}

/**
 * 「连不上编辑器」这类失败必须报 blocked（不是 step failed）——它们的共同点是
 * **重跑同样的指令也不会成功**，判据是「不是本次指令本身的错」：
 * 传输层截断 / dispatcher 未起 / 连接类 phase / 运行时不可达。
 */
function isConnectivityFailure(e) {
  if (!e) return false;
  if (e.phase === 'connection') return true;
  if (typeof e.code === 'string' && e.code.startsWith('ULOOP_')) return true;
  return ['UNITY_NOT_REACHABLE', 'WRITE_CALL_FAILED', 'CONNECTION_FAILED'].includes(e.code);
}

/** 在 roots 里按名字深找（给清理的读回确认用）。 */
function findByName(roots, name) {
  for (const r of Array.isArray(roots) ? roots : []) {
    if (!r || typeof r !== 'object') continue;
    if (r.name === name) return r;
    const hit = findByName(r.children, name);
    if (hit) return hit;
  }
  return null;
}

/**
 * 跑一轮指令集并取一次结构快照。返回 `{ok, error, errorEnvelope, snapshot}`。
 *
 * R295①：**不再返回「失败在第几步」**。旧稿据此判「第 0 步失败 = 本轮没发出任何建节点调用」，
 * 事实相反：第 0 步的 `nodeCreate` 可能**写已落场景、只是读回没确认**（`READBACK_FAILED` /
 * `ok:true + verified:false`，见 `lib/scene.js` 的 residue 语义「写入可能已生效；请复核并删除多余项」）
 * —— 用步号当「有没有写」的判据会让残骸留在场景里而报「无需清理」。清理与否由调用方
 * **无条件**决定（只要过了开局预检就清）。
 */
async function runRound({ projectPath, env, _call }) {
  for (const s of GOLDEN_STEPS) {
    const e = s.kind === 'create'
      ? await nodeCreate({ projectPath, env, name: s.name, parent: s.parent, components: s.components || [], _call })
      : await nodeSet({ projectPath, env, path: s.path, patch: s.patch, _call });
    // 铁律：写命令必须 verified !== false 才算这一步成功（ok:true + verified:false 也是失败）
    if (!e.ok || e.verified === false) {
      return {
        ok: false,
        error: `${s.kind} ${s.name || s.path} 失败：${e.code || 'verified:false'}${e.message ? ` ${e.message}` : ''}`,
        errorEnvelope: e,
      };
    }
  }
  const tree = await sceneTree({ projectPath, env, _call });
  if (!tree.ok) return { ok: false, error: `读快照失败：${tree.code} ${tree.message}`, errorEnvelope: tree };
  return { ok: true, snapshot: projectStructure(tree.actual) };
}

/**
 * 删临时根并**读回确认**。返回 `{status: 'ok'|'failed', path, recovered?, confirmed?, code?, message?}`。
 *
 * R289：失败分两种，**必须**能区分（否则人读输出会把「不知道」写成「确证有残留」）：
 *   - `confirmed:true` —— 读到场景了、根还在（**确证**残留）→ 可以让人手工 `node delete`；
 *   - `confirmed:false` —— **连读场景都失败**（如 `UNITY_NOT_REACHABLE`）→ 只能报「无法确认」，
 *     此时 `code`/`message` 也带的是**读回失败**的原因（不是删除失败的原因）。
 */
async function cleanupGolden({ projectPath, env, _call }) {
  const del = await nodeDelete({ projectPath, env, path: GOLDEN_ROOT, _call });
  if (del.ok && del.verified === true) return { status: 'ok', path: GOLDEN_ROOT, recovered: false };
  // 二次确认：可能「删除其实生效了但读回抖了一下」
  const tree = await sceneTree({ projectPath, env, _call });
  if (tree.ok && !findByName(tree.actual.roots, GOLDEN_ROOT)) {
    return { status: 'ok', path: GOLDEN_ROOT, recovered: true };
  }
  if (!tree.ok) {
    return {
      status: 'failed',
      path: GOLDEN_ROOT,
      confirmed: false,
      code: tree.code,
      message: `读回确认失败（读场景失败：${tree.code}）${tree.message ? `：${tree.message}` : ''}`,
    };
  }
  return {
    status: 'failed',
    path: GOLDEN_ROOT,
    confirmed: true,
    code: del.code || null,
    message: del.message || '删除后仍能在场景里找到临时根',
  };
}

/**
 * `doctor --golden` 的主流程。返回 pi-cocos 同形的结果对象（供 doctor 输出与 `--json` 使用）：
 * `{ok, matched, diff, cleanup, blocked, lines}`。
 *
 * R291 / R295④：`matched` **仅在「没完成比对」时为 `null`** —— 即被 blocked / **任一轮**的指令或
 * 快照失败 / **第 1 轮**清理失败。不许把「没比成」写成 `matched:false`（那是「比了且不一致」）。
 * 反过来，**两轮都跑完、只有末次清理失败**时返回 `{ok:false, matched:true, cleanup:{status:'failed'}}`：
 * 两轮结构确实一致，失败由 `ok`/`cleanup` 表达（信息量比压成 `matched:null` 更大）。
 */
async function runGolden({ projectPath, env, _call } = {}) {
  const lines = ['场景回归黄金测试（同一组确定性指令搭两轮，比对 get-hierarchy 的结构投影）'];
  let cleanup = { status: 'none', path: null };

  // R206③：返回值形状**固定 6 个键**（与接口总表逐字一致）——`errorEnvelope` 只用于内部
  // 判断「是不是连不上」，**不进** runGolden 的返回值（否则成功/失败两种路径的键集不同，形状断言无法写）。
  const blockedResult = (reason) => {
    lines.push(`⛔ 无法执行：${reason}`);
    lines.push(cleanupLine(cleanup));
    return { ok: false, matched: null, diff: null, blocked: reason, cleanup, lines };
  };

  // 0️⃣ R290：开局先确认场景里没有上一次跑挂留下的临时根。Unity 允许同名兄弟、真机 `node-create.cs`
  // 也不查重 —— 带着残留跑会建出**第二个** `__pi_golden`，之后按名字解析（`Find` / 路径拼接）变歧义：
  // 可能改/验到旧节点（假红），或删掉本轮从未创建的那个。清不掉就**不带着残骸继续跑**。
  // 连场景都读不到 → 基线无法确认 → 直接 blocked（重跑也不会成功），且**不发起任何写调用**。
  const pre = await sceneTree({ projectPath, env, _call });
  if (!pre.ok) {
    // R295⑤：这里的失败是**数据/上游**问题（`BAD_HIERARCHY` / `HIERARCHY_READ_FAILED` /
    // `NO_HIERARCHY_PATH`），不是 `blocked` 契约原本所指的「连不上编辑器等」——措辞收束成
    // 「读场景失败，无法确认基线」。行为不变（写前失败 / 退出码 1 / `blocked` 仍为非 null）。
    return blockedResult(`读场景失败，无法确认基线（${pre.code}）${pre.message ? `：${pre.message}` : ''}`);
  }
  // R295②：`cleanup.status === 'none'` **只**保留给上面这条「开局预检就 blocked、任何写调用都没
  // 发出」的早退路径（`path: null`）。此后无论第几步失败都一律走 `mergeCleanup`。
  if (findByName(pre.actual.roots, GOLDEN_ROOT)) {
    cleanup = await cleanupGolden({ projectPath, env, _call });
    if (cleanup.status === 'failed') {
      lines.push('❌ 场景里已有上一次的临时根，且这次也清不掉 —— 不带着残骸继续跑');
      return blockedResult(`场景里已存在上一次的临时根（${GOLDEN_ROOT}）且清理失败`);
    }
    lines.push(`⚠️ 场景里已有上一次的临时根（${GOLDEN_ROOT}）—— 已清理上一次残留`);
  }

  // ① 第一轮
  const a = await runRound({ projectPath, env, _call });
  if (!a.ok) {
    // R295①：**只要过了开局预检就一律清理**，不看失败在第几步 —— 第 0 步的 `nodeCreate` 也可能
    // 「写已落场景、读回才失败」（`READBACK_FAILED` / `ok:true + verified:false`）。真没建成时
    // `nodeDelete` 的 `NOT_FOUND` + 二次读回会自然落 `ok`（文案覆盖「本就无残留」）。
    cleanup = mergeCleanup(cleanup, await cleanupGolden({ projectPath, env, _call }));
    if (isConnectivityFailure(a.errorEnvelope)) return blockedResult(a.error);
    lines.push(`❌ ${a.error}`);
    lines.push(cleanupLine(cleanup));
    return { ok: false, matched: null, diff: null, blocked: null, cleanup, lines };
  }
  cleanup = mergeCleanup(cleanup, await cleanupGolden({ projectPath, env, _call }));
  if (cleanup.status === 'failed') {
    lines.push('❌ 第一轮临时节点删除失败，放弃本轮比对（不带着残骸继续）');
    lines.push(cleanupLine(cleanup));
    return { ok: false, matched: null, diff: null, blocked: null, cleanup, lines };
  }

  // ② 第二轮
  const b = await runRound({ projectPath, env, _call });
  if (!b.ok) {
    // 同①（R295①）：第二轮与第一轮**同构** —— 第二个 `__pi_golden` 的首个 create 也可能写已落场景、
    // 读回才失败；无条件清理，并由 `mergeCleanup` 保留「第一轮是否已 ok / 是否靠二次读回兜底」的痕迹。
    cleanup = mergeCleanup(cleanup, await cleanupGolden({ projectPath, env, _call }));
    if (isConnectivityFailure(b.errorEnvelope)) return blockedResult(b.error);
    lines.push(`❌ ${b.error}`);
    lines.push(cleanupLine(cleanup));
    return { ok: false, matched: null, diff: null, blocked: null, cleanup, lines };
  }
  cleanup = mergeCleanup(cleanup, await cleanupGolden({ projectPath, env, _call }));

  // ③ 比对
  const diff = firstDiff(a.snapshot, b.snapshot);
  lines.push(`  轮 1 节点数：${countNodes(a.snapshot)}`);
  lines.push(`  轮 2 节点数：${countNodes(b.snapshot)}`);
  if (diff === null) lines.push('✅ 两轮一致：同一组指令产出了相同的场景结构');
  else lines.push(`❌ 检测到结构变异：首个分歧在 ${formatDiff(diff)}`);
  lines.push(cleanupLine(cleanup));

  return {
    ok: diff === null && cleanup.status !== 'failed',
    matched: diff === null,
    diff,
    blocked: null,
    cleanup,
    lines,
  };
}

/** 投影里的节点总数（含投影的 roots）。 */
function countNodes(proj) {
  const walk = (list) => (Array.isArray(list) ? list.reduce((n, x) => n + 1 + walk(x.children), 0) : 0);
  return walk(proj && proj.roots);
}

/**
 * 把一次清理结果并进既有 `cleanup`（R295②）：`'none'` 只留给「开局预检就 blocked、任何写调用都
 * 没发出」的早退路径，其余路径一律经本函数落 `'ok'`/`'failed'`。成功时保留「是否靠二次读回兜底」
 * 的痕迹 `recovered`（跨轮累积：任一轮发生过二次读回兜底都要如实带出）。
 */
function mergeCleanup(prev, next) {
  if (next.status === 'failed') return next;
  return {
    status: 'ok',
    path: GOLDEN_ROOT,
    recovered: (prev.status === 'ok' && prev.recovered === true) || next.recovered === true,
  };
}

/**
 * 清理状态的一行说明（绝不把 failed 写成 ok，也绝不把「无法确认」写成「确证有残留」）。
 *
 * R289：`failed` 要按 `cleanup.confirmed` 分两种口径 ——
 *   - `confirmed:false`（读场景失败）→ 「无法确认」，命令是**条件式**的（先 `unity scene tree` 复核）；
 *   - `confirmed:true`（确证根还在）→ 现有措辞 + 无条件的手工 `node delete`。
 * 旧稿只按 `status` 判，于是「连不上编辑器、根本没建过节点」也会硬说「临时根仍在场景里」，
 * 把人指向一条必然 `NOT_FOUND` 的命令。
 */
function cleanupLine(cleanup) {
  // R295③：`recovered:true` **不得只写「已回收」**（那会暗示「确实发生过删除」）——它同时覆盖
  // 两种情形：①删除其实生效了、只是直接读回一度不一致；②`nodeDelete` 报 `NOT_FOUND`（本就无残留）。
  if (cleanup.status === 'ok' && cleanup.recovered) {
    return '清理：无残留（二次读回确认临时根已不在场景里 —— 删除已生效但直接读回一度不一致，或本就无残留）';
  }
  if (cleanup.status === 'ok') return '清理：无残留（临时节点已删除并读回确认）';
  if (cleanup.status === 'failed') {
    if (cleanup.confirmed === false) {
      return `⚠️ 清理：**无法确认**是否残留（读场景失败：\`${cleanup.code}\`）——连接恢复后用 \`unity scene tree\` 复核 \`${cleanup.path}\`，若在则 \`unity node delete --path ${cleanup.path}\``;
    }
    return `❌ 清理：临时根仍在场景里（${cleanup.path}）——请手工执行 \`unity node delete --path ${cleanup.path}\`，或直接在编辑器里删掉它；本命令不保存场景`;
  }
  return '清理：未创建节点，无需清理';
}

module.exports = {
  runGolden, projectNode, projectStructure, firstDiff, formatDiff,
  cleanupGolden, runRound, isConnectivityFailure, mergeCleanup, GOLDEN_ROOT, GOLDEN_STEPS,
};
