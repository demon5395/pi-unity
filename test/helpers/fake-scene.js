'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * 「内存场景」假后端：注入给 lib 的 `_call`，让 golden / smoke 这类多步流程**不碰编辑器**也能测。
 *
 * - `execute-dynamic-code` 按 `--code-file` 的脚本名分派，模拟 node-create / node-set / node-inspect / node-delete；
 * - `get-hierarchy` 把当前内存模型写成临时 JSON 文件并返回路径（`sceneTree` 会去读它）；
 * - 每次调用都记进 `calls`，供断言「有没有发起某次调用」。
 *
 * 它**不 spawn 任何进程**，也不读真实项目（全局约束 13 + 单测密闭要求）。
 */
function makeFakeSceneBackend({ baseScene = [] } = {}) {
  // R480：`Map<path, node[]>` —— **不是**有序数组。键仍是 path，`be.nodes.has/.size` 的 key 语义
  // 逐字不变（doctor/golden 共 9 条断言依赖它）；数组只用来表达「同父同名多个实例」。
  const nodes = new Map();
  // R480（b1r2 修复）：跨 path 的全局**创建序**（每个实例一条）。`nodes` 是 path-keyed Map，
  // 对「同父同名」会把交错序分组读错（`A,Brick,C,Brick` → `A,Brick,Brick,C`）；hierarchyOf
  // 需要真实创建序才能给同一父下每个子节点算出**真实 siblingIndex**（而非同 path 数组下标）。
  const order = [];
  let instanceSeq = 0;
  for (const n of baseScene) {
    const node = { name: n.path, active: true, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, components: ['Transform'], ...n, instanceId: n.instanceId ?? ++instanceSeq };
    const list = nodes.get(n.path) || [];
    list.push(node);
    nodes.set(n.path, list);
    order.push({ path: n.path, ref: node });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-fake-scene-'));
  const calls = [];
  let snap = 0;

  /** 该 path 的**全部**命中（同父同名时 > 1）；无命中返回 []。 */
  const findAll = (p) => nodes.get(p) || [];
  /**
   * R480（b1r3）：真机 `node-set.cs` / `node-delete.cs` / `node-inspect.cs` 无参默认都走
   * `GameObject.Find` —— **激活优先**（返回该 path 下第一个 active 的对象）。夹具旧行为取
   * `list[0]`（创建序）→ 同父同名而其一 inactive 时，夹具改/删/查的不是真机那个。
   * 这里对齐：该 path 命中里**第一个 active**，全 inactive 则回第一个（Find 找不到非激活 → 旧行为回退）。
   */
  const activeFirst = (p) => {
    const list = findAll(p);
    return list.find((n) => n.active) || list[0] || null;
  };

  const hierarchyOf = () => {
    const roots = [];
    const byPath = new Map();
    // 每个父（根用空串作键）下已分配的 siblingIndex 计数：同父下按**创建序**排第 k 个 → k。
    const childSeq = new Map();
    for (const { path: p, ref: n } of order) {
      const slash = p.lastIndexOf('/');
      const parentPath = slash === -1 ? '' : p.slice(0, slash);
      const k = childSeq.get(parentPath) || 0;
      childSeq.set(parentPath, k + 1);
      const node = {
        name: n.name, isActive: n.active, components: [...n.components],
        // R480（b1r2 修复）：同父下按**真实创建序**填 siblingIndex（显式 `n.siblingIndex` 优先），
        // 不再是同 path 数组下标 —— 后者会把 `A,Brick,C,Brick` 错报成 `Brick@0,Brick@1,C@0`。
        siblingIndex: n.siblingIndex ?? k, tag: n.tag ?? 'Untagged', layer: n.layer ?? 0, children: [],
      };
      byPath.set(p, node);
      if (slash === -1) roots.push(node);
      else { const parent = byPath.get(parentPath); if (parent) parent.children.push(node); else roots.push(node); }
    }
    const count = (list) => list.reduce((n, x) => n + 1 + count(x.children), 0);
    return {
      ExportTimestamp: `2026-09-19 00:00:0${snap}`,
      Context: { sceneType: 'editor', sceneName: '', nodeCount: count(roots), maxDepth: 0 },
      Hierarchy: [{ sceneName: '', stats: { rootCount: roots.length, nodeCount: count(roots), maxDepth: 0 }, roots }],
    };
  };

  const wrap = (json) => ({ code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false });

  const call = async (tool, args) => {
    calls.push({ tool, args });
    // 探活（dispatcher 级命令）：doctor 的 smoke/collectChecks 第一步就是它（R115 的真实形状）
    if (tool === 'list') return wrap({ Version: '3.4.0', Tools: [] });
    // M2 任务 10：smoke 的只读三工具里有两个不属于场景后端 —— 补上确定的成功响应，
    // 让 `_call: makeFakeSceneBackend(...).call` 能独当一面驱动整条 `doctor --smoke`。
    if (tool === 'compile') return wrap({ Success: true, ErrorCount: 0, WarningCount: 0 });
    if (tool === 'get-logs') return wrap({ Success: true, TotalCount: 0, DisplayedCount: 0, Logs: [] });
    if (tool === 'get-hierarchy') {
      const file = path.join(dir, `h${++snap}.json`);
      fs.writeFileSync(file, JSON.stringify(hierarchyOf()));
      return wrap({ Success: true, HierarchyFilePath: file });
    }
    if (tool !== 'execute-dynamic-code') throw new Error(`假后端不认的工具：${tool}`);
    const script = String(args[1] || '').split(/[\\/]/).pop();
    const payload = JSON.parse(JSON.parse(args[3]).p);
    if (script === 'node-create.cs') {
      const p = payload.parent ? `${payload.parent}/${payload.name}` : payload.name;
      if (payload.parent && !nodes.has(payload.parent)) return wrap({ Success: true, Result: JSON.stringify({ __error: 'PARENT_NOT_FOUND', parent: payload.parent }) });
      // R480：夹具改为 `Map<path, node[]>` 后，同一路径的第二次 create **追加**成第二个同名兄弟
      // （与真机一致：`unity-scripts/node-create.cs` 无 NAME_EXISTS 守卫，允许同名叠加）。
      // R292 原守卫的动机（path-keyed Map 会静默覆盖同一 key → 凭空少一个节点）已由数组模型消除。
      const created = { name: payload.name, active: true, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, components: ['Transform', ...(payload.components || [])], instanceId: ++instanceSeq };
      const list = nodes.get(p) || [];
      list.push(created);
      nodes.set(p, list);
      order.push({ path: p, ref: created });
      return wrap({ Success: true, Result: JSON.stringify({ name: payload.name, active: true, path: p }) });
    }
    if (script === 'node-inspect.cs') {
      const list = findAll(payload.path);
      if (list.length === 0) return wrap({ Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) });
      // R480（b1r1 修复）：--sibling-index 与真机同口径 = 节点的**真实 siblingIndex 字段**
      //（`n.siblingIndex ?? 数组下标` 仅作无显式值时的回退），**不是**命中列表下标。
      // 越界是**运行时事实**（不是用法错）→ 回传 available 让人可自修。
      // ⚠️ 仍只读 `Map<path, node[]>`，不改有序数组（9 条既有断言依赖 key 语义）。
      const sibOf = (n, i) => n.siblingIndex ?? i;
      let picked;
      if (Object.prototype.hasOwnProperty.call(payload, 'siblingIndex')) {
        const want = payload.siblingIndex;
        picked = list.find((n, i) => sibOf(n, i) === want);
        if (!picked) {
          return wrap({ Success: true, Result: JSON.stringify({ __error: 'SIBLING_INDEX_OUT_OF_RANGE', count: list.length, requested: want, available: list.map(sibOf) }) });
        }
      } else {
        picked = activeFirst(payload.path);
      }
      const pos = list.indexOf(picked);
      return wrap({ Success: true, Result: JSON.stringify({ ...picked, path: payload.path, siblingIndex: sibOf(picked, pos), matchCount: list.length }) });
    }
    if (script === 'node-set.cs') {
      const n = activeFirst(payload.path);
      if (!n) return wrap({ Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) });
      const next = { ...n };
      if (payload.patch.name !== undefined) next.name = payload.patch.name;
      if (payload.patch.active !== undefined) next.active = payload.patch.active;
      if (payload.patch.position) next.position = payload.patch.position;
      if (payload.patch.scale) next.scale = payload.patch.scale;
      const list = nodes.get(payload.path);
      // R480（b1r3）：默认命中的是 activeFirst（可能是 list 中非 0 下标），须按下标替换。
      list[list.indexOf(n)] = next;
      // 保持创建序引用与替换后的对象同步（否则 hierarchyOf 会读到 set 之前的旧字段）。
      const entry = order.find((e) => e.ref === n);
      if (entry) entry.ref = next;
      return wrap({ Success: true, Result: '{"__written":true}' });
    }
    if (script === 'node-delete.cs') {
      const list = nodes.get(payload.path);
      if (!list || list.length === 0) return wrap({ Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) });
      // R480（b1r2 修复）：真机 `node-delete.cs` = `GameObject.Find(path)` + `DestroyImmediate`
      // —— **一次只销毁一个实例**。旧夹具一次删光同 path 全部实例，会让「同名兄弟仍在」这种
      // 真机现象读回成 `verified:true`（假绿）；现在删一个，读回落到剩下的那个 → `verified:false`。
      // R480（b1r3）：默认删 `activeFirst`（真机 Find 激活优先），不是 `list[0]`。
      const [removed] = list.splice(list.indexOf(activeFirst(payload.path)), 1);
      const oi = order.findIndex((e) => e.ref === removed);
      if (oi !== -1) order.splice(oi, 1);
      if (list.length === 0) {
        // 该路径已无实例 → `DestroyImmediate` **连同子树**一并销毁（保留真机语义）。
        nodes.delete(payload.path);
        for (const key of [...nodes.keys()]) {
          if (key.startsWith(`${payload.path}/`)) nodes.delete(key);
        }
        // `order`（全局创建序）必须同步剔除整棵子树 —— 否则 hierarchyOf 会把已删节点
        // 当成「找不到父的孤儿根」继续渲染（golden 第 2 轮 nodeCount 会虚高）。
        for (let i = order.length - 1; i >= 0; i--) {
          const p = order[i].path;
          if (p === payload.path || p.startsWith(`${payload.path}/`)) order.splice(i, 1);
        }
      }
      return wrap({ Success: true, Result: JSON.stringify({ __deleted: true, path: payload.path }) });
    }
    throw new Error(`假后端不认的脚本：${script}`);
  };

  return { call, nodes, calls, dir, snapshotCount: () => snap };
}

module.exports = { makeFakeSceneBackend };
