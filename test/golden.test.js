'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { projectNode, projectStructure, firstDiff, formatDiff, runGolden, GOLDEN_ROOT } = require('../lib/golden.js');
const { normalizeHierarchy } = require('../lib/scene.js');
const { makeFakeSceneBackend } = require('./helpers/fake-scene.js');

test('normalizeHierarchy 现在 additive 保留 siblingIndex/tag/layer（M1 丢弃，golden 需要）', () => {
  const n = normalizeHierarchy({
    Hierarchy: [{
      stats: { nodeCount: 1, maxDepth: 0 },
      roots: [{ name: 'Main Camera', isActive: true, components: ['Transform'], siblingIndex: 0, tag: 'MainCamera', layer: 0, children: [] }],
    }],
  });
  assert.strictEqual(n.roots[0].siblingIndex, 0);
  assert.strictEqual(n.roots[0].tag, 'MainCamera');
  assert.strictEqual(n.roots[0].layer, 0);
});

test('projectNode/projectStructure：白名单投影（易变字段一律不进投影）', () => {
  const node = { name: 'A', active: true, components: ['Transform'], siblingIndex: 2, tag: 'Untagged', layer: 5, path: 'A', strange: 1, children: [] };
  assert.deepStrictEqual(projectNode(node), { name: 'A', active: true, components: ['Transform'], siblingIndex: 2, tag: 'Untagged', layer: 5, children: [] });
  const proj = projectStructure({ sceneName: 'S', nodeCount: 1, maxDepth: 0, roots: [node], otherSceneCount: 0, otherSceneNames: [], tooDeep: false });
  assert.deepStrictEqual(proj, { sceneName: 'S', nodeCount: 1, roots: [projectNode(node)] });
});

test('firstDiff：类型/数组长度/缺键/值 四类，路径格式可读', () => {
  assert.strictEqual(firstDiff({ a: 1 }, { a: 1 }), null, '一致时 null');
  assert.deepStrictEqual(firstDiff({ a: 1 }, { a: '1' }), { path: 'a', kind: 'type', a: 1, b: '1' });
  assert.deepStrictEqual(firstDiff({ a: [1, 2] }, { a: [1] }), { path: 'a', kind: 'array-length', a: 2, b: 1 });
  assert.deepStrictEqual(firstDiff({ a: 1 }, {}), { path: 'a', kind: 'missing-right', a: 1, b: null });
  assert.deepStrictEqual(firstDiff({}, { a: 1 }), { path: 'a', kind: 'missing-left', a: null, b: 1 });
  // R294：`a`/`b` 恒存在（可能为 null）——`undefined` 会在 JSON.stringify 里整键丢失。
  const mr = firstDiff({ a: 1 }, {});
  assert.ok(Object.hasOwn(mr, 'a') && Object.hasOwn(mr, 'b'), 'a/b 两个键必须都在');
  assert.strictEqual(mr.b, null);
  assert.strictEqual(JSON.parse(JSON.stringify(mr)).b, null, 'JSON 往返后 b 不得整键消失');
  const d = firstDiff({ roots: [{ children: [{ name: 'B' }] }] }, { roots: [{ children: [{ name: 'C' }] }] });
  assert.deepStrictEqual(d, { path: 'roots[0].children[0].name', kind: 'value', a: 'B', b: 'C' });
  assert.match(formatDiff(d), /roots\[0\]\.children\[0\]\.name/);
  assert.match(formatDiff(d), /"B"/);
});

test('runGolden 两轮一致：ok:true / matched:true / cleanup ok，且临时根被删掉', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const r = await runGolden({ projectPath: 'P', _call: be.call });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.diff, null);
  assert.strictEqual(r.cleanup.status, 'ok');
  assert.strictEqual(r.blocked, null);
  assert.strictEqual(be.nodes.has(GOLDEN_ROOT), false, '临时根必须被删除');
  // 预检 1 次（R290 的开局残留检查）+ 每轮跑完 1 次 = 3 次；
  // 清理走 `nodeDelete` 的写后读回，成功时**不再**取 `get-hierarchy`。
  assert.strictEqual(be.snapshotCount(), 3, `快照次数 ${be.snapshotCount()}`);
  // 步骤包含嵌套节点（裸名规则）与 setActive(false)（inactive 查找路径）——
  // R294：旧写法 `JSON.stringify(args).includes('GOLDEN_B')` 近乎恒真（编译期常量到处出现），
  // 改成断言「确实对 __pi_golden/GOLDEN_B 发起过 `node-set`（patch.active === false）」。
  const payloadOf = (c) => JSON.parse(JSON.parse(c.args[3]).p);
  const scriptOf = (c) => String(c.args[1]).split(/[\\/]/).pop();
  assert.ok(
    be.calls.some((c) => c.tool === 'execute-dynamic-code' && scriptOf(c) === 'node-set.cs'
      && payloadOf(c).path === `${GOLDEN_ROOT}/GOLDEN_B` && payloadOf(c).patch.active === false),
    '确实对 __pi_golden/GOLDEN_B 发起过 node-set（active:false）',
  );
});

test('runGolden 检出变异：报首个分歧路径（结构化 diff）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  // R210/R290：预检 1 + 轮 1 的 1 = 前两次快照；**第 3 次**（轮 2 的快照）注入变异 → 与轮 1 必然不同 → 能真红。
  let snapshots = 0;
  const call = async (tool, args) => {
    const r = await be.call(tool, args);
    if (tool === 'get-hierarchy') {
      snapshots++;
      if (snapshots >= 3) {
        const fs = require('node:fs');
        const raw = JSON.parse(fs.readFileSync(r.json.HierarchyFilePath, 'utf8'));
        const find = (list, name) => { for (const n of list) { if (n.name === name) return n; const h = find(n.children, name); if (h) return h; } return null; };
        const b = find(raw.Hierarchy[0].roots, 'GOLDEN_B');
        if (b) b.components = [...b.components, 'SpriteRenderer'];
        fs.writeFileSync(r.json.HierarchyFilePath, JSON.stringify(raw));
      }
    }
    return r;
  };
  const r = await runGolden({ projectPath: 'P', _call: call });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.matched, false);
  assert.strictEqual(r.diff.kind, 'array-length');
  assert.match(r.diff.path, /GOLDEN_B|components/);
  assert.ok(r.lines.some((l) => /首个分歧/.test(l)));
});

test('runGolden 清理失败：不谎报成功，给出残留路径与手工命令', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const call = async (tool, args) => {
    // 让 node-delete 永远报错 → 清理必然失败。
    // ⚠️ 必须在**委托假后端之前**拦下：`be.call` 一旦被调用，删除的内存副作用就已经发生，
    // 之后的二次读回会「确认根已消失」并谎报 recovered → 清理假绿（用例失去意义）。
    if (tool === 'execute-dynamic-code' && String(args[1]).endsWith('node-delete.cs')) {
      return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json: { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) }, truncated: false };
    }
    return be.call(tool, args);
  };
  const r = await runGolden({ projectPath: 'P', _call: call });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.matched, null, '第一轮清理失败 = 没完成比对 → 必须是 null，不是 false');
  assert.strictEqual(r.cleanup.status, 'failed');
  assert.strictEqual(r.cleanup.path, GOLDEN_ROOT);
  assert.strictEqual(r.cleanup.confirmed, true, '读到场景且根还在 = 确证残留');
  assert.ok(r.lines.some((l) => /残留|手工|unity node delete/.test(l)));
});

test('R289：连不上编辑器（从未建过节点）不谎报残留，走「无需清理」', async () => {
  const r = await runGolden({
    projectPath: 'P',
    _call: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, drained: false, json: { Success: false, Error: { ErrorCode: 'UNITY_NOT_REACHABLE', Phase: 'connection', Message: 'nope' } }, truncated: false }),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.matched, null);
  assert.match(r.blocked, /UNITY_NOT_REACHABLE/);
  assert.deepStrictEqual(r.cleanup, { status: 'none', path: null });
  assert.ok(r.lines.some((l) => /未创建节点，无需清理/.test(l)));
  // 旧稿在这里硬说「临时根仍在场景里」+ 无条件 `unity node delete` —— 必然 NOT_FOUND。
  assert.ok(!r.lines.some((l) => /临时根仍在场景里/.test(l)), '不得谎称确证残留');
  assert.ok(!r.lines.some((l) => /node delete --path/.test(l)), '不得给出必然失败的手工命令');
});

test('R289：已建根之后连接中断 → 只能报「无法确认」，命令是复核式', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const unreachable = () => ({ code: 1, stdout: '', stderr: '', timedOut: false, drained: false, json: { Success: false, Error: { ErrorCode: 'UNITY_NOT_REACHABLE', Phase: 'connection', Message: 'nope' } }, truncated: false });
  const scriptOf = (c) => String((c.args && c.args[1]) || '').split(/[\\/]/).pop();
  // ⚠️ `nodeCreate` 内部还有一次读回（`node-inspect`）——掉线只能从**第 2 个 create** 开始，
  // 否则第 1 个 create 会因读回失败而“失败”，根本走不到 cleanup 的「无法确认」分支。
  let creates = 0;
  const call = async (tool, args) => {
    if (scriptOf({ args }) === 'node-create.cs') {
      creates++;
      if (creates >= 2) return unreachable();
    }
    if (creates >= 2) return unreachable(); // 掉线后所有调用（含清理的 delete / 读回）都失败
    return be.call(tool, args);
  };
  const r = await runGolden({ projectPath: 'P', _call: call });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.matched, null);
  assert.ok(r.blocked, '连接类失败必须报 blocked');
  assert.strictEqual(r.cleanup.status, 'failed');
  assert.strictEqual(r.cleanup.confirmed, false, '读场景也失败 = 无法确认，不是确证残留');
  assert.strictEqual(r.cleanup.code, 'UNITY_NOT_REACHABLE');
  const text = r.lines.join('\n');
  assert.match(text, /无法确认/);
  assert.doesNotMatch(text, /临时根仍在场景里/);
  assert.match(text, /unity scene tree/, '必须让人先复核再删，而不是断言式 node delete');
});

test('R295：第 1 个 create 写入已落场景但读回失败 → 仍必须尝试清理（不得留残留）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const scriptOf = (args) => String((args && args[1]) || '').split(/[\\/]/).pop();
  const wrap = (json) => ({ code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false });
  const call = async (tool, args) => {
    // 第 1 个 create：**写调用照常落场景**（委托假后端建出 `__pi_golden`），但随后的 `node-inspect`
    // 读回内容不符 → `nodeCreate` 返回 `ok:true + verified:false`（写入可能已生效、读回没确认）。
    // 旧稿的 `failedStep > 0` 门会因此跳过清理，把 `__pi_golden` 留在场景里却报「未创建节点，无需清理」。
    if (tool === 'execute-dynamic-code' && scriptOf(args) === 'node-inspect.cs') {
      const payload = JSON.parse(JSON.parse(args[3]).p);
      if (payload.path === GOLDEN_ROOT) {
        return wrap({ Success: true, Result: JSON.stringify({ name: 'NOT_THE_ROOT', active: true, path: GOLDEN_ROOT }) });
      }
    }
    return be.call(tool, args);
  };
  const r = await runGolden({ projectPath: 'P', _call: call });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.matched, null, '第 0 步就失败 = 没比成（不是「比了且不一致」）');
  assert.strictEqual(r.blocked, null, '读回不一致不是连接类失败，不得报 blocked');
  assert.notStrictEqual(r.cleanup.status, 'none', 'R295②：写调用已发出就必须清理，不得报「无需清理」');
  assert.ok(
    be.calls.some((c) => scriptOf(c.args) === 'node-delete.cs'),
    'R295①：必须真的发起过 node-delete 尝试清理',
  );
  assert.strictEqual(be.nodes.has(GOLDEN_ROOT), false, '写入留下的临时根必须被清掉（不得留残骸）');
  const text = r.lines.join('\n');
  assert.doesNotMatch(text, /未创建节点，无需清理/);
  assert.match(text, /或本就无残留/, 'R295③：recovered 文案必须同时覆盖「删除读回一度不一致」与「本就无残留」');
});

test('R295：写调用根本没落场景（写前就失败）→ 仍尝试清理，文案报「本就无残留」而不是 status:none', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const scriptOf = (args) => String((args && args[1]) || '').split(/[\\/]/).pop();
  const call = async (tool, args) => {
    // 第 1 个 create 的**写调用**就落 `__error`（脚本没建任何节点）→ 场景里没有残骸。
    // 清理仍然要发起：`nodeDelete` 的 `NOT_FOUND` + 二次读回会自然落 `ok/recovered`。
    if (tool === 'execute-dynamic-code' && scriptOf(args) === 'node-create.cs') {
      return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json: { Success: true, Result: JSON.stringify({ __error: 'BAD_REQUEST', detail: '夹具注入' }) }, truncated: false };
    }
    return be.call(tool, args);
  };
  const r = await runGolden({ projectPath: 'P', _call: call });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.matched, null);
  assert.strictEqual(r.blocked, null, 'BAD_REQUEST 不是连接类失败');
  assert.notStrictEqual(r.cleanup.status, 'none', 'R295②：过了开局预检就不再落 none');
  assert.strictEqual(r.cleanup.status, 'ok', '本就无残留 → 清理成功');
  assert.strictEqual(r.cleanup.recovered, true, '删除报 NOT_FOUND + 二次读回确认不在 = 本就无残留');
  const text = r.lines.join('\n');
  assert.match(text, /或本就无残留/, 'R295③：文案不得只说「已回收」（那会暗示发生过删除）');
  assert.doesNotMatch(text, /已回收/);
  assert.strictEqual(be.nodes.has(GOLDEN_ROOT), false);
});

test('R290：开局发现上一次残留 → 先清理再跑（不带着残骸建第二个同名根）', async () => {
  const be = makeFakeSceneBackend({
    baseScene: [{ path: 'Main Camera' }, { path: GOLDEN_ROOT }, { path: `${GOLDEN_ROOT}/STALE` }],
  });
  const r = await runGolden({ projectPath: 'P', _call: be.call });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.cleanup.status, 'ok');
  assert.ok(r.lines.some((l) => /已清理上一次残留/.test(l)), 'lines 要说明清理了上一次残留');
  assert.strictEqual(be.nodes.has(GOLDEN_ROOT), false, '最终不得留下临时根');
  assert.strictEqual(be.nodes.has(`${GOLDEN_ROOT}/STALE`), false, '上一次的子树也必须消失');
});

test('R290：开局残留清不掉 → blocked + 手工命令，且不发起任何建节点调用', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }, { path: GOLDEN_ROOT }] });
  const call = async (tool, args) => {
    // 在委托之前拦下（委托一旦发生，删除的内存副作用就已生效 → 二次读回会谎报 ok）。
    if (String((args && args[1]) || '').endsWith('node-delete.cs')) {
      return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json: { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) }, truncated: false };
    }
    return be.call(tool, args);
  };
  const r = await runGolden({ projectPath: 'P', _call: call });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.matched, null);
  assert.ok(r.blocked, '清不掉残留 = 重跑也不会成功 → blocked');
  assert.strictEqual(r.cleanup.status, 'failed');
  assert.strictEqual(r.cleanup.confirmed, true);
  assert.ok(r.lines.some((l) => /unity node delete --path __pi_golden/.test(l)), '必须给手工命令');
  assert.strictEqual(
    be.calls.some((c) => String((c.args && c.args[1]) || '').endsWith('node-create.cs')),
    false,
    '不得带着残留继续跑（未发出任何建节点调用）',
  );
});

test('R291：两轮跑完但末次清理失败 → ok:false / matched:true / cleanup failed', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  let deletes = 0;
  const call = async (tool, args) => {
    if (String((args && args[1]) || '').endsWith('node-delete.cs')) {
      deletes++;
      // 第 1 次 = 第 1 轮清理（必须成功）；第 2 次 = 末次清理（注入失败）。
      if (deletes >= 2) {
        return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json: { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) }, truncated: false };
      }
    }
    return be.call(tool, args);
  };
  const r = await runGolden({ projectPath: 'P', _call: call });
  assert.strictEqual(r.matched, true, '两轮结构确实一致 —— 不许因清理失败谎报「不一致」');
  assert.strictEqual(r.ok, false, '末次清理失败必须让整体失败');
  assert.strictEqual(r.diff, null);
  assert.strictEqual(r.cleanup.status, 'failed');
  assert.strictEqual(r.cleanup.confirmed, true);
});

test('runGolden 连不上编辑器：blocked，不谎称 matched', async () => {
  const r = await runGolden({
    projectPath: 'P',
    _call: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, drained: false, json: { Success: false, Error: { ErrorCode: 'UNITY_NOT_REACHABLE', Phase: 'connection', Message: 'nope' } }, truncated: false }),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.matched, null);
  assert.match(r.blocked, /UNITY_NOT_REACHABLE|连不上|doctor/);
});

test('R206③：runGolden 的返回形状固定（逐字键集；成功/blocked 两条路径同形）', async () => {
  const KEYS = ['blocked', 'cleanup', 'diff', 'lines', 'matched', 'ok'];
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const r = await runGolden({ projectPath: 'P', _call: be.call });
  assert.deepStrictEqual(Object.keys(r).sort(), KEYS);
  const blocked = await runGolden({
    projectPath: 'P',
    _call: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, drained: false, spawnError: null, truncated: false, json: { Success: false, Error: { ErrorCode: 'UNITY_NOT_REACHABLE', Phase: 'connection', Message: 'nope' } }, tool: 'x', args: [] }),
  });
  assert.deepStrictEqual(Object.keys(blocked).sort(), KEYS);
  assert.strictEqual(blocked.matched, null, '没比成必须是 null，不得写成 false');
});

test('doctor：--smoke 与 --golden 互斥（退出码 2，且不发起任何编辑器调用）', async () => {
  const { doctor } = require('../lib/doctor.js');
  const { captureStderr } = require('./helpers/capture.js');
  // 两者都向当前场景写入，混跑无法归因 —— 必须在任何编辑器调用之前就被 argv 层级拦下
  // （退出码 2 = 用法错）。
  const { result, out } = await captureStderr(() => doctor(['--smoke', '--golden', '--project-path', 'P'], { env: {} }));
  assert.strictEqual(result, 2);
  assert.match(out, /不能同时用/);
});
