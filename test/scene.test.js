'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../bin/unity.js');
const { normalizeHierarchy, readHierarchyFile, buildPayloadArgs, sceneTree, nodeInspect, nodeCreate, nodeSet, nodeDelete, PATCH_KEYS } = require('../lib/scene.js');
const { exitCodeFor } = require('../lib/envelope.js');
// R480：本文件此前**没有** require 假场景后端（它只在 golden/doctor 用）——同父同名定位
// 需要「内存场景」才能构造，故补上（见计划冲突扫描 #4）。
const { makeFakeSceneBackend } = require('./helpers/fake-scene.js');
// R207：captureStdout / captureStderr 已抽到 test/helpers/capture.js（三个测试文件共用一份）。
const { captureStdout, captureStderr } = require('./helpers/capture.js');

const SAMPLE = {
  ExportTimestamp: '2026-09-18 17:38:54',
  Context: { sceneType: 'editor', sceneName: '', nodeCount: 2, maxDepth: 1 },
  Hierarchy: [{
    sceneName: '',
    stats: { rootCount: 1, nodeCount: 2, maxDepth: 1 },
    roots: [{
      name: 'Canvas', isActive: true, components: ['RectTransform', 'Canvas'],
      siblingIndex: 0, tag: 'Untagged', layer: 5,
      children: [{ name: 'Btn', isActive: true, components: ['RectTransform', 'Button'], children: [] }],
    }],
  }],
};

/** 多场景样本（R61：第二个场景不得静默消失）。 */
const MULTI_SCENE = {
  Hierarchy: [
    SAMPLE.Hierarchy[0],
    { sceneName: 'Sub', stats: { rootCount: 1, nodeCount: 1, maxDepth: 0 }, roots: [{ name: 'Extra', isActive: true, children: [] }] },
  ],
};

/**
 * R316：上游在较大/嵌套场景改用 `componentsLut` + 逐节点 `componentsIdx`（实测 **25 节点已出现**；
 * 阈值与序列化体积相关、**未定稿、勿依赖**，见 `docs/PITFALLS.md` 末尾条目）
 *
 * 的**真实导出形状**（字段序、短名 LUT 都照抄 `S0Project/.uloop/outputs/HierarchyResults/` 的 9451 字节导出）。
 * 修复前 `normalizeHierarchy` 只读 `n.components` → 这些场景的 `components` 全是 `[]`。
 */
const LUT_SAMPLE = {
  ExportTimestamp: '2026-09-19 13:18:25',
  Context: { sceneType: 'editor', sceneName: '', nodeCount: 3, maxDepth: 1 },
  Hierarchy: [{
    sceneName: '',
    stats: { rootCount: 2, nodeCount: 3, maxDepth: 1 },
    componentsLut: ['Transform', 'Camera', 'AudioListener', 'SpriteRenderer', 'PiBrickBreaker'],
    roots: [
      { name: 'Main Camera', isActive: true, componentsIdx: [0, 1, 2], siblingIndex: 0, tag: 'MainCamera', layer: 0, children: [] },
      {
        name: 'Bricks',
        isActive: true,
        componentsIdx: [0],
        siblingIndex: 1,
        tag: 'Untagged',
        layer: 0,
        children: [
          { name: 'Brick_0_0', isActive: true, componentsIdx: [0, 3], siblingIndex: 0, tag: 'Untagged', layer: 0, children: [] },
        ],
      },
    ],
  }],
};

/** 造一个临时项目，并把 hierarchy JSON 落盘到相对路径 `.uloop/outputs/HierarchyResults/h.json`。 */
function tempProject(sample = SAMPLE) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-scene-'));
  const rel = path.join('.uloop', 'outputs', 'HierarchyResults', 'h.json');
  fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
  fs.writeFileSync(path.join(project, rel), JSON.stringify(sample));
  return { project, rel };
}

/** 构造只回放固定 json 的 `_call` 假实现（R2 预留的注入缝，绝不 spawn 真实进程）。
 *
 * `extra` 用来覆盖默认字段（R215：注入 `truncated:true` 等截断形状，守 envelopeFromCall 接入）。
 */
function fakeCall(json, spy = [], extra = {}) {
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args, ...extra };
  };
}

/** 只取信封的退出码（复用生产实现，避免测试自己复述规则）。 */
function exitCodeOf(envelope) {
  return require('../lib/envelope.js').exitCodeFor(envelope);
}

/** 用假 dispatcher（PI_UNITY_ULOOP_CMD）跑 fn，结束后恢复环境变量。 */
async function withFakeDispatcher(payload, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-fake-'));
  const fake = path.join(dir, 'fake-uloop.js');
  fs.writeFileSync(fake, `process.stdout.write(${JSON.stringify(JSON.stringify(payload))} + '\\n');\n`);
  const saved = process.env.PI_UNITY_ULOOP_CMD;
  process.env.PI_UNITY_ULOOP_CMD = JSON.stringify([process.execPath, fake]);
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.PI_UNITY_ULOOP_CMD;
    else process.env.PI_UNITY_ULOOP_CMD = saved;
  }
}

test('normalizeHierarchy 抽出可读结构', () => {
  const n = normalizeHierarchy(SAMPLE);
  assert.strictEqual(n.nodeCount, 2);
  assert.strictEqual(n.roots[0].name, 'Canvas');
  assert.strictEqual(n.roots[0].children[0].name, 'Btn');
  assert.strictEqual(n.roots[0].path, 'Canvas');
  assert.strictEqual(n.roots[0].children[0].path, 'Canvas/Btn');
});

test('readHierarchyFile 能把相对路径解析到项目根', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-proj-'));
  const rel = path.join('.uloop', 'outputs', 'HierarchyResults', 'h.json');
  fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
  fs.writeFileSync(path.join(project, rel), JSON.stringify(SAMPLE));
  const n = readHierarchyFile(project, rel);
  assert.strictEqual(n.roots[0].name, 'Canvas');
});

test('buildPayloadArgs 生成 --code-file 与单 JSON 载荷参数', () => {
  const args = buildPayloadArgs('node-inspect', { path: 'Canvas/Btn' });
  assert.deepStrictEqual(args[0], '--code-file');
  assert.ok(args[1].endsWith('node-inspect.cs'));
  assert.deepStrictEqual(args[2], '--parameters');
  const parsed = JSON.parse(args[3]);
  assert.deepStrictEqual(Object.values(parsed), [JSON.stringify({ path: 'Canvas/Btn' })]);
});

test('normalizeHierarchy 多场景不静默丢弃（R61）', () => {
  const n = normalizeHierarchy(MULTI_SCENE);
  // 主路径仍是第一个场景
  assert.strictEqual(n.roots[0].name, 'Canvas');
  // 被丢弃的场景必须可见
  assert.strictEqual(n.otherSceneCount, 1);
  assert.deepStrictEqual(n.otherSceneNames, ['Sub']);
  // 单场景时既不虚报也不多出场景名
  const single = normalizeHierarchy(SAMPLE);
  assert.strictEqual(single.otherSceneCount, 0);
  assert.deepStrictEqual(single.otherSceneNames, []);
});

test('sceneTree 成功：ok / verified 为 null / actual 带 path（R65① R66）', async () => {
  const { project, rel } = tempProject();
  const spy = [];
  const e = await sceneTree({
    projectPath: project,
    _call: fakeCall({ Success: true, HierarchyFilePath: rel }, spy),
  });
  assert.strictEqual(spy[0].tool, 'get-hierarchy');
  assert.strictEqual(e.ok, true);
  // R66：读命令没有 intent 可比对，绝不虚报 verified:true
  assert.strictEqual(e.verified, null);
  assert.strictEqual(e.actual.roots[0].path, 'Canvas');
  assert.deepStrictEqual(e.hint, []);
});

test('sceneTree 多场景时 hint 提示未读场景（R61）', async () => {
  const { project, rel } = tempProject(MULTI_SCENE);
  const e = await sceneTree({
    projectPath: project,
    _call: fakeCall({ Success: true, HierarchyFilePath: rel }),
  });
  assert.strictEqual(e.ok, true);
  assert.match(e.hint.join(' '), /还有 1 个场景未读/);
});

test('sceneTree 遇 uloop 失败信封原样透传（R65②）', async () => {
  const e = await sceneTree({
    projectPath: 'X',
    _call: fakeCall({
      Success: false,
      Error: { ErrorCode: 'UNITY_NOT_REACHABLE', Message: 'not reachable', NextActions: ['先启动编辑器'] },
    }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'UNITY_NOT_REACHABLE');
  assert.strictEqual(e.message, 'not reachable');
  assert.strictEqual(e.verified, false);
});

test('sceneTree 缺 HierarchyFilePath → NO_HIERARCHY_PATH（R65③）', async () => {
  const e = await sceneTree({ projectPath: 'X', _call: fakeCall({ Success: true }) });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'NO_HIERARCHY_PATH');
});

test('sceneTree 读文件失败落可诊断失败信封，不抛（R60 R65④）', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-scene-'));
  const rel = path.join('.uloop', 'outputs', 'HierarchyResults', 'missing.json');
  const e = await sceneTree({
    projectPath: project,
    _call: fakeCall({ Success: true, HierarchyFilePath: rel }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'HIERARCHY_READ_FAILED');
  assert.strictEqual(e.actual.path, path.join(project, rel));
  assert.ok(path.isAbsolute(e.actual.path));
  assert.ok(e.hint.length > 0);
});

test('nodeInspect 成功：ok / verified 为 null / 载荷按 param0 传递（R65⑤ R66）', async () => {
  const spy = [];
  const node = {
    name: 'Btn', active: true,
    position: { x: 1, y: 2, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    components: ['RectTransform', 'Button'],
  };
  const e = await nodeInspect({
    projectPath: 'X',
    path: 'Canvas/Btn',
    _call: fakeCall({ Success: true, Result: JSON.stringify(node) }, spy),
  });
  assert.strictEqual(spy[0].tool, 'execute-dynamic-code');
  assert.ok(spy[0].args[1].endsWith('node-inspect.cs'));
  // key 被 uloop 丢弃、值按 key 排序成为 param0（`p` 是唯一 key）
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[0].args[3]).p), { path: 'Canvas/Btn' });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, null);
  assert.deepStrictEqual(e.actual, node);
});

test('nodeInspect 节点不存在 → NOT_FOUND（R65⑥）', async () => {
  const e = await nodeInspect({
    projectPath: 'X',
    path: 'Nope',
    _call: fakeCall({ Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'NOT_FOUND');
  assert.match(e.message, /Nope/);
});

test('nodeInspect Result 非 JSON / 非对象 → BAD_SCRIPT_RESULT，不抛（R62 R65⑦ R67）', async () => {
  for (const Result of ['not json at all', undefined, 'null', '"x"', '[1,2]']) {
    const e = await nodeInspect({ projectPath: 'X', path: 'A', _call: fakeCall({ Success: true, Result }) });
    assert.strictEqual(e.ok, false, `Result=${String(Result)} 应失败`);
    assert.strictEqual(e.code, 'BAD_SCRIPT_RESULT');
    assert.deepStrictEqual(e.actual.raw, Result);
    assert.strictEqual(e.verified, false);
  }
});

test('CLI 默认人读、--json 输出 JSON（R59）', async () => {
  const { project, rel } = tempProject();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-fake-'));
  const fake = path.join(dir, 'fake-uloop.js');
  fs.writeFileSync(fake, `process.stdout.write(JSON.stringify({Success:true,HierarchyFilePath:${JSON.stringify(rel)}}) + '\\n');\n`);
  const saved = process.env.PI_UNITY_ULOOP_CMD;
  process.env.PI_UNITY_ULOOP_CMD = JSON.stringify([process.execPath, fake]);
  try {
    const human = await captureStdout(() => main(['scene', 'tree', '--project-path', project]));
    assert.strictEqual(human.result, 0);
    assert.match(human.out, /^\[OK\] /);
    assert.throws(() => JSON.parse(human.out));

    const machine = await captureStdout(() => main(['scene', 'tree', '--project-path', project, '--json']));
    assert.strictEqual(machine.result, 0);
    const envelope = JSON.parse(machine.out);
    assert.strictEqual(envelope.ok, true);
    assert.strictEqual(envelope.verified, null);
    assert.strictEqual(envelope.actual.roots[0].path, 'Canvas');
  } finally {
    if (saved === undefined) delete process.env.PI_UNITY_ULOOP_CMD;
    else process.env.PI_UNITY_ULOOP_CMD = saved;
  }
});

// ───────────────────────── 修复轮 1（R68–R75） ─────────────────────────

test('sceneTree 缺 projectPath（相对路径）→ MISSING_PROJECT_PATH 且不抛（R68 F1）', async () => {
  let e;
  await assert.doesNotReject(async () => {
    e = await sceneTree({ _call: fakeCall({ Success: true, HierarchyFilePath: '.uloop/outputs/x.json' }) });
  }, '缺 projectPath 时不得抛出（抛出会冒成 internal error / 退出码 3）');
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'MISSING_PROJECT_PATH');
  assert.strictEqual(exitCodeOf(e), 2, 'R477：缺 --project-path 是用法错');
  assert.deepStrictEqual(e.actual, { hierarchyFilePath: '.uloop/outputs/x.json' });
  assert.ok(e.hint.length > 0);
  // `--project-path` 裸写（parseArgs → true）与 undefined 同罪：都不可进 path.join
  const bare = await sceneTree({
    projectPath: true,
    _call: fakeCall({ Success: true, HierarchyFilePath: 'rel.json' }),
  });
  assert.strictEqual(bare.ok, false);
  assert.strictEqual(bare.code, 'MISSING_PROJECT_PATH');
});

test('sceneTree 绝对路径不依赖 projectPath（R68 F1）', async () => {
  const { project, rel } = tempProject();
  const e = await sceneTree({
    _call: fakeCall({ Success: true, HierarchyFilePath: path.join(project, rel) }),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.actual.roots[0].path, 'Canvas');
});

test('sceneTree 形状不符 → BAD_HIERARCHY；真空场景仍 ok（R70 F3）', async () => {
  const bad = [null, {}, { Hierarchy: [] }, { Hierarchy: [{}] }, { Hierarchy: [{ stats: {}, roots: {} }] }];
  for (const raw of bad) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-bad-'));
    const file = path.join(project, 'h.json');
    fs.writeFileSync(file, JSON.stringify(raw));
    const e = await sceneTree({ _call: fakeCall({ Success: true, HierarchyFilePath: file }) });
    assert.strictEqual(e.ok, false, `raw=${JSON.stringify(raw)} 应失败`);
    assert.strictEqual(e.code, 'BAD_HIERARCHY');
    assert.ok(Array.isArray(e.actual.keys));
    assert.strictEqual(e.verified, false);
    assert.ok(e.hint.length > 0);
  }
  // 真·空场景（stats + roots 都在）必须仍是 ok，不能与「字段缺失」混为一谈
  const emptyScene = {
    Hierarchy: [{ sceneName: 'S', stats: { rootCount: 0, nodeCount: 0, maxDepth: 0 }, roots: [] }],
  };
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-empty-'));
  const file = path.join(project, 'h.json');
  fs.writeFileSync(file, JSON.stringify(emptyScene));
  const e = await sceneTree({ _call: fakeCall({ Success: true, HierarchyFilePath: file }) });
  assert.strictEqual(e.ok, true);
  assert.deepStrictEqual(e.actual.roots, []);
  assert.strictEqual(e.actual.nodeCount, 0);
});

test('normalizeHierarchy 对畸形节点宽容，不抛（R71 F4）', () => {
  const n = normalizeHierarchy({
    Hierarchy: [{ stats: { nodeCount: 1 }, roots: [{ name: 'A', children: 'not-an-array' }, null] }],
  });
  assert.strictEqual(n.roots.length, 2);
  assert.deepStrictEqual(n.roots[0].children, []);
  assert.deepStrictEqual(n.roots[1].children, []);
  // roots 本身非数组同样不抛
  const n2 = normalizeHierarchy({ Hierarchy: [{ stats: {}, roots: 'x' }] });
  assert.deepStrictEqual(n2.roots, []);
});

test('normalizeHierarchy 解析大场景的 componentsLut + componentsIdx（R316）', () => {
  const n = normalizeHierarchy(LUT_SAMPLE);
  assert.deepStrictEqual(n.roots[0].components, ['Transform', 'Camera', 'AudioListener'], 'LUT 索引要还原成组件短名');
  assert.deepStrictEqual(n.roots[1].components, ['Transform']);
  // 影响面不止 golden：嵌套节点（用户真实工程每次 `scene tree` 都靠这条维度）
  assert.deepStrictEqual(n.roots[1].children[0].components, ['Transform', 'SpriteRenderer']);
  // 两种形状**同时**出现时以 LUT 为准（上游 LUT 形导出里逐节点只有 componentsIdx）
  const both = normalizeHierarchy({
    Hierarchy: [{ componentsLut: ['Transform'], roots: [{ name: 'A', componentsIdx: [0], components: ['内联'], children: [] }] }],
  });
  assert.deepStrictEqual(both.roots[0].components, ['Transform']);
  // 无 LUT 时回退内联（小场景形状；内联用例仍绿）
  assert.deepStrictEqual(normalizeHierarchy(SAMPLE).roots[0].components, ['RectTransform', 'Canvas']);
});

test('normalizeHierarchy 的 LUT 按节点降级：无 componentsIdx 的节点回退内联（R323）', () => {
  // 混合形：上游给了 LUT，但个别节点**没有** componentsIdx、仍有内联 `components`。
  // 「有 LUT 就完全放弃内联」会把这类节点的组件静默变成 `[]` —— 必须**逐节点**降级。
  const n = normalizeHierarchy({
    Hierarchy: [{
      componentsLut: ['Transform', 'SpriteRenderer'],
      roots: [
        { name: 'LutNode', isActive: true, componentsIdx: [1], children: [] },
        { name: 'InlineNode', isActive: true, components: ['Transform', 'Camera'], children: [] },
        { name: 'Neither', isActive: true, children: [] },
      ],
    }],
  });
  assert.deepStrictEqual(n.roots[0].components, ['SpriteRenderer'], '有 componentsIdx 时仍以 LUT 为准（既有语义不变）');
  assert.deepStrictEqual(n.roots[1].components, ['Transform', 'Camera'], '无 componentsIdx 时必须回退内联，不得静默变 []');
  assert.deepStrictEqual(n.roots[2].components, [], '两者皆无 → []');
});

test('normalizeHierarchy 的 componentsIdx 畸形输入按空/过滤处理，不抛（R316，口径同 R71）', () => {
  const shape = (lut, node) => normalizeHierarchy({ Hierarchy: [{ componentsLut: lut, roots: [node] }] });
  const base = { name: 'A', isActive: true, children: [] };
  // componentsLut 不是数组 → 不可解析（无内联可回退）→ []
  assert.deepStrictEqual(shape('not-an-array', { ...base, componentsIdx: [0] }).roots[0].components, []);
  assert.deepStrictEqual(shape(undefined, base).roots[0].components, []);
  // D16：`componentsIdx` 不是数组时**回退内联**（R323 逐节点降级），不是「一律 []」——
  // 旧注释/旧断言在「节点没有内联分量」时两种实现同形（都得到 []），看不出差别；
  // 这里补上内联分量，把「回退内联」真正钉住（实现若改成畸形 → []，本断言立刻红）。
  for (const idx of [undefined, 'x', 3, {}]) {
    assert.deepStrictEqual(
      shape(['Transform'], { ...base, components: ['Camera'], componentsIdx: idx }).roots[0].components,
      ['Camera'],
      `componentsIdx=${JSON.stringify(idx)} 必须回退内联（不得把畸形索引当 0 号组件、也不得静默清空）`,
    );
  }
  // 索引越界 / 负数 / 元素非字符串 → 只过滤该槽位，不抛
  assert.deepStrictEqual(
    shape(['Transform', 42, null], { ...base, componentsIdx: [0, 1, 2, 99, -1] }).roots[0].components,
    ['Transform'],
  );
  assert.doesNotThrow(
    () => normalizeHierarchy({ Hierarchy: [{ componentsLut: {}, roots: [null, 'x', { name: 'N', componentsIdx: 'x', children: 'x' }] }] }),
    '畸形输入不得抛（抛出会冒成 internal error + 退出码 3）',
  );
});

test('normalizeHierarchy 深度超限分支同样解析 LUT 形（R316）', () => {
  // N1 → … → N200（depth 0..199）→ Deep（depth 200 = MAX_HIERARCHY_DEPTH）；
  // Deep 有子节点 → 触发 R89① 的「超限返回」分支，该分支也必须解析 LUT。
  let node = { name: 'Deep', isActive: true, componentsIdx: [1], children: [{ name: 'X', isActive: true, componentsIdx: [0], children: [] }] };
  for (let i = 200; i >= 1; i--) node = { name: `N${i}`, isActive: true, componentsIdx: [0], children: [node] };
  const n = normalizeHierarchy({
    Hierarchy: [{ componentsLut: ['Transform', 'SpriteRenderer'], stats: { nodeCount: 202, maxDepth: 201 }, roots: [node] }],
  });
  assert.strictEqual(n.tooDeep, true);
  let cursor = n.roots[0];
  let depth = 0;
  while (Array.isArray(cursor.children) && cursor.children.length > 0) {
    cursor = cursor.children[0];
    depth++;
  }
  assert.strictEqual(depth, 200);
  assert.deepStrictEqual(cursor.components, ['SpriteRenderer'], '超限分支的 components 不得恒空');
});

test('nodeInspect 缺 --path / 裸 --path → MISSING_PATH（R69 F2）', async () => {
  for (const p of [undefined, '', true]) {
    let e;
    await assert.doesNotReject(async () => {
      e = await nodeInspect({ projectPath: 'X', path: p, _call: fakeCall({ Success: true, Result: '{}' }) });
    });
    assert.strictEqual(e.ok, false, `path=${String(p)} 应失败`);
    assert.strictEqual(e.code, 'MISSING_PATH');
    assert.deepStrictEqual(e.actual, { path: p });
    assert.ok(e.hint.length > 0);
  }
});

test('nodeInspect NOT_FOUND 的 actual 带被查 path，hint 说明只查当前激活场景（R69 F2 R74 F7）', async () => {
  const e = await nodeInspect({
    projectPath: 'X',
    path: 'Canvas/Nope',
    _call: fakeCall({ Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) }),
  });
  assert.strictEqual(e.code, 'NOT_FOUND');
  assert.deepStrictEqual(e.actual, { path: 'Canvas/Nope' });
  assert.match(e.hint.join(' '), /当前激活场景/);
  assert.match(e.hint.join(' '), /inactive/);
});

test('nodeInspect 未知 __error 码 → 按该码失败，不装成 ok（R72 F5）', async () => {
  const e = await nodeInspect({
    projectPath: 'X',
    path: 'A',
    _call: fakeCall({ Success: true, Result: JSON.stringify({ __error: 'FUTURE_CODE' }) }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'FUTURE_CODE');
  assert.deepStrictEqual(e.actual, { __error: 'FUTURE_CODE' });
  assert.strictEqual(e.verified, false);
});

test('normalizeHierarchy 空场景名退化为「场景 #N」（R75 F8）', async () => {
  const unnamed = {
    Hierarchy: [
      SAMPLE.Hierarchy[0],
      { sceneName: '', stats: { rootCount: 0, nodeCount: 0, maxDepth: 0 }, roots: [] },
    ],
  };
  assert.deepStrictEqual(normalizeHierarchy(unnamed).otherSceneNames, ['场景 #2']);
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-unnamed-'));
  const file = path.join(project, 'h.json');
  fs.writeFileSync(file, JSON.stringify(unnamed));
  const e = await sceneTree({ _call: fakeCall({ Success: true, HierarchyFilePath: file }) });
  assert.strictEqual(e.ok, true);
  assert.match(e.hint.join(' '), /场景 #2/);
  assert.ok(!/：\s*$/.test(e.hint[0]), 'hint 不得以冒号断尾');
});

test('CLI node inspect --path X --json → 0 且输出可 JSON.parse（R73 F6①）', async () => {
  const node = {
    name: 'Btn', active: true,
    position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, components: ['Transform'],
  };
  const { result, out } = await withFakeDispatcher(
    { Success: true, Result: JSON.stringify(node) },
    () => captureStdout(() => main(['node', 'inspect', '--project-path', 'X', '--path', 'Canvas/Btn', '--json'])),
  );
  assert.strictEqual(result, 0);
  const envelope = JSON.parse(out);
  assert.strictEqual(envelope.ok, true);
  assert.strictEqual(envelope.actual.name, 'Btn');
});

test('CLI 未知/缺子动作 → 退出码 2（R73 F6②）', async () => {
  for (const argv of [['node'], ['node', 'bogus'], ['scene'], ['scene', 'bogus']]) {
    const { result } = await captureStderr(() => main(argv));
    assert.strictEqual(result, 2, `${argv.join(' ')} 应返回 2`);
  }
});

test('CLI node inspect 缺 --path → 2 且 code=MISSING_PATH（R73 F6③；M2 任务 2 起用法错=2）', async () => {
  const { result, out } = await withFakeDispatcher(
    { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) },
    () => captureStdout(() => main(['node', 'inspect', '--project-path', 'X', '--json'])),
  );
  assert.strictEqual(result, 2);
  const envelope = JSON.parse(out);
  assert.strictEqual(envelope.ok, false);
  assert.strictEqual(envelope.code, 'MISSING_PATH');
});

// ───────────────────────── 任务 10：node create / set（写路径 + verified） ─────────────────────────

/** 按调用序回放固定 json 的假 `_call`（典型：第 1 次写、第 2 次读回）。 */
function sequenceCall(results, spy = []) {
  let n = 0;
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    const json = results[Math.min(n, results.length - 1)];
    n++;
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

/** 写一个「按 argv 里出现的脚本名回不同 json」的假 dispatcher 并运行 fn（CLI 端到端用）。 */
async function withScriptedDispatcher(scriptBody, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-scripted-'));
  const fake = path.join(dir, 'fake-uloop.js');
  fs.writeFileSync(fake, scriptBody);
  const saved = process.env.PI_UNITY_ULOOP_CMD;
  process.env.PI_UNITY_ULOOP_CMD = JSON.stringify([process.execPath, fake]);
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.PI_UNITY_ULOOP_CMD;
    else process.env.PI_UNITY_ULOOP_CMD = saved;
  }
}

/** 造一个「写成功 + 读回给定节点」的假 dispatcher 脚本体。 */
function nodeSetScript(readNode) {
  return `
    const a = process.argv.join(' ');
    const out = a.includes('node-set.cs')
      ? { Success: true, Result: '{"__written":true}' }
      : { Success: true, Result: ${JSON.stringify(JSON.stringify(readNode))} };
    process.stdout.write(JSON.stringify(out) + '\\n');
  `;
}

test('nodeCreate 读回一致时 verified=true', async () => {
  const fakeCall = async () => ({ code: 0, json: { Success: true, Result: '{"name":"Brick","active":true}' } });
  const e = await nodeCreate({ projectPath: 'X', name: 'Brick', _call: fakeCall });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(e.actual, { name: 'Brick', active: true });
});

test('nodeSet 读回不一致时 verified=false 并保留分歧（钳制场景）', async () => {
  // 第一次调用执行写，第二次调用读回
  let n = 0;
  const fakeCall = async () => {
    n++;
    return n === 1
      ? { code: 0, json: { Success: true, Result: '{"__written":true}' } }
      : { code: 0, json: { Success: true, Result: '{"name":"Brick","active":true,"position":{"x":0,"y":1e-5,"z":0}}' } };
  };
  const e = await nodeSet({
    projectPath: 'X', path: 'Brick', patch: { position: { x: 0, y: -100, z: 0 } }, _call: fakeCall,
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'position.y');
});

test('nodeSet 读回一致时 verified=true', async () => {
  let n = 0;
  const fakeCall = async () => {
    n++;
    return n === 1
      ? { code: 0, json: { Success: true, Result: '{"__written":true}' } }
      : { code: 0, json: { Success: true, Result: '{"name":"Brick","active":false}' } };
  };
  const e = await nodeSet({ projectPath: 'X', path: 'Brick', patch: { active: false }, _call: fakeCall });
  assert.strictEqual(e.verified, true);
});

test('nodeCreate 载荷走 node-create.cs，parent 时读回 parent/name 且 intent 含 path（R78 R79）', async () => {
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ name: 'Brick', active: true, path: 'Canvas/Brick' }) },
    { Success: true, Result: JSON.stringify({ name: 'Brick', active: true, path: 'Canvas/Brick', components: [] }) },
  ], spy);
  const e = await nodeCreate({ projectPath: 'X', name: 'Brick', parent: 'Canvas', _call: call });
  assert.strictEqual(spy.length, 2, '一写一读，恰两次调用（多出的调用会复用最后一帧，永不被发现）');
  assert.strictEqual(spy[0].tool, 'execute-dynamic-code');
  assert.ok(spy[0].args[1].endsWith('node-create.cs'));
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[0].args[3]).p), { name: 'Brick', parent: 'Canvas', components: [] });
  // 读回必须走 node-inspect（不是信 write 脚本的自述），path = parent/name
  assert.ok(spy[1].args[1].endsWith('node-inspect.cs'));
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[1].args[3]).p), { path: 'Canvas/Brick' });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(e.intent, { name: 'Brick', active: true, path: 'Canvas/Brick' });
  assert.deepStrictEqual(e.mismatches, []);
});

test('nodeCreate 无 parent 时读回 path=name（R78）', async () => {
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ name: 'Brick', active: true, path: 'Brick' }) },
    { Success: true, Result: JSON.stringify({ name: 'Brick', active: true, path: 'Brick' }) },
  ], spy);
  const e = await nodeCreate({ projectPath: 'X', name: 'Brick', _call: call });
  assert.strictEqual(spy.length, 2, '一写一读，恰两次调用');
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[1].args[3]).p), { path: 'Brick' });
  assert.deepStrictEqual(e.intent, { name: 'Brick', active: true });
  assert.strictEqual(e.verified, true);
});

test('nodeCreate 组件未生效 → verified=false 且 components 分歧；生效 → true（R78b②）', async () => {
  const mk = (components) => sequenceCall([
    { Success: true, Result: '{"name":"Brick","active":true,"path":"Brick"}' },
    { Success: true, Result: JSON.stringify({ name: 'Brick', active: true, path: 'Brick', components }) },
  ]);
  const bad = await nodeCreate({ projectPath: 'X', name: 'Brick', components: ['UnityEngine.Sprite'], _call: mk(['Transform']) });
  assert.strictEqual(bad.ok, true);
  assert.strictEqual(bad.verified, false);
  assert.strictEqual(bad.mismatches[0].key, 'components');
  assert.deepStrictEqual(bad.mismatches[0].intent, ['UnityEngine.Sprite']);

  // 短名与全名一律映射到短名比对：请求全名、读回短名 → 一致
  const good = await nodeCreate({ projectPath: 'X', name: 'Brick', components: ['UnityEngine.Sprite'], _call: mk(['Transform', 'Sprite']) });
  assert.strictEqual(good.verified, true);
  assert.deepStrictEqual(good.mismatches, []);
});

test('nodeCreate 组件类型解析不出 → COMPONENT_TYPE_NOT_FOUND，不静默跳过（R78b①）', async () => {
  const e = await nodeCreate({
    projectPath: 'X', name: 'Brick', components: ['cc.Sprite'],
    _call: fakeCall({ Success: true, Result: JSON.stringify({ __error: 'COMPONENT_TYPE_NOT_FOUND', component: 'cc.Sprite' }) }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'COMPONENT_TYPE_NOT_FOUND');
  assert.strictEqual(e.actual.component, 'cc.Sprite');
  assert.strictEqual(e.verified, false);
});

test('nodeSet 写结果带 __error → 直接按码失败，不退化成 mismatch 堆（R84 R83）', async () => {
  const nf = await nodeSet({
    projectPath: 'X', path: 'Nope', patch: { active: false },
    _call: fakeCall({ Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) }),
  });
  assert.strictEqual(nf.ok, false);
  assert.strictEqual(nf.code, 'NOT_FOUND');
  assert.match(nf.message, /Nope/);

  const bp = await nodeSet({
    projectPath: 'X', path: 'Brick', patch: { position: { x: 1 } },
    _call: fakeCall({ Success: true, Result: JSON.stringify({ __error: 'BAD_PATCH', field: 'position', missing: ['y', 'z'] }) }),
  });
  assert.strictEqual(bp.ok, false);
  assert.strictEqual(bp.code, 'BAD_PATCH');
  assert.match(bp.message, /position/);
});

test('nodeSet 改名后按新名读回，不沿用旧路径（R81）', async () => {
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: '{"__written":true}' },
    { Success: true, Result: JSON.stringify({ name: 'New', active: true, path: 'Canvas/New' }) },
  ], spy);
  const e = await nodeSet({ projectPath: 'X', path: 'Canvas/Old', patch: { name: 'New' }, _call: call });
  assert.strictEqual(spy.length, 2, '一写一读，恰两次调用');
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[1].args[3]).p), { path: 'Canvas/New' });
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(e.intent, { name: 'New' });
});

test('nodeSet patch 非普通对象 → MISSING_PATCH，不发起写（R88 R53）', async () => {
  for (const patch of [undefined, null, [], true, 'x', 1]) {
    const spy = [];
    const e = await nodeSet({ projectPath: 'X', path: 'Brick', patch, _call: fakeCall({ Success: true, Result: '{}' }, spy) });
    assert.strictEqual(e.ok, false, `patch=${String(patch)} 应失败`);
    assert.strictEqual(e.code, 'MISSING_PATCH');
    assert.ok(e.hint.length > 0);
    assert.strictEqual(spy.length, 0, 'patch 不合法时不得发起任何 uloop 调用');
  }
});

test('nodeCreate name 缺失/空/裸写 → MISSING_NAME，不发起写（R86）', async () => {
  for (const name of [undefined, '', true, 1]) {
    const spy = [];
    const e = await nodeCreate({ projectPath: 'X', name, _call: fakeCall({ Success: true, Result: '{}' }, spy) });
    assert.strictEqual(e.ok, false, `name=${String(name)} 应失败`);
    assert.strictEqual(e.code, 'MISSING_NAME');
    assert.strictEqual(spy.length, 0);
  }
});

test('nodeCreate components 非非空字符串数组 → BAD_COMPONENTS（R78b③）', async () => {
  for (const components of [true, 'Sprite', [''], [1], {}]) {
    const e = await nodeCreate({ projectPath: 'X', name: 'B', components, _call: fakeCall({ Success: true, Result: '{}' }) });
    assert.strictEqual(e.ok, false, `components=${JSON.stringify(components)} 应失败`);
    assert.strictEqual(e.code, 'BAD_COMPONENTS');
  }
});

test('写成功但读回失败 → READBACK_FAILED（ok:false，绝不假绿）', async () => {
  const notFound = sequenceCall([
    { Success: true, Result: '{"__written":true}' },
    { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) },
  ]);
  const e = await nodeSet({ projectPath: 'X', path: 'Brick', patch: { active: false }, _call: notFound });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.strictEqual(e.verified, false);
  assert.match(e.message, /NOT_FOUND/);

  // 读回调用本身抛出（verifyWrite 会 reject）同样不得冒到顶层
  let n = 0;
  const throwing = async () => {
    n++;
    if (n === 1) return { code: 0, json: { Success: true, Result: '{"__written":true}' } };
    throw new Error('boom');
  };
  let caught;
  await assert.doesNotReject(async () => {
    caught = await nodeSet({ projectPath: 'X', path: 'Brick', patch: { active: false }, _call: throwing });
  });
  assert.strictEqual(caught.ok, false);
  assert.strictEqual(caught.code, 'READBACK_FAILED');
  assert.match(caught.message, /boom/);
});

test('nodeCreate/nodeSet 与 nodeInspect 共用脚本结果解析（R77）', async () => {
  for (const Result of ['not json', undefined, 'null', '[1]']) {
    const c = await nodeCreate({ projectPath: 'X', name: 'B', _call: fakeCall({ Success: true, Result }) });
    assert.strictEqual(c.ok, false, `create Result=${String(Result)}`);
    assert.strictEqual(c.code, 'BAD_SCRIPT_RESULT');
    const s = await nodeSet({ projectPath: 'X', path: 'B', patch: { active: false }, _call: fakeCall({ Success: true, Result }) });
    assert.strictEqual(s.ok, false, `set Result=${String(Result)}`);
    assert.strictEqual(s.code, 'BAD_SCRIPT_RESULT');
  }
});

test('__error 收严：空串/非字符串 → SCRIPT_ERROR；可重试码加前缀（R89②）', async () => {
  const cases = [['', 'SCRIPT_ERROR'], [123, 'SCRIPT_ERROR'], [null, 'SCRIPT_ERROR'], ['ULOOP_TRUNCATED', 'SCRIPT_ULOOP_TRUNCATED'], ['ULOOP_NO_JSON', 'SCRIPT_ULOOP_NO_JSON']];
  for (const [raw, code] of cases) {
    const e = await nodeInspect({
      projectPath: 'X', path: 'A',
      _call: fakeCall({ Success: true, Result: JSON.stringify({ __error: raw }) }),
    });
    assert.strictEqual(e.ok, false, `__error=${JSON.stringify(raw)} 应失败`);
    assert.strictEqual(e.code, code);
    // 脚本错误码不得被 fail() 归入可重试集合
    assert.strictEqual(e.retryable, false);
  }
});

test('hierarchy 超深 → HIERARCHY_TOO_DEEP，不栈溢出（R89①）', async () => {
  let node = { name: 'N500', isActive: true, components: [], children: [] };
  for (let i = 499; i >= 1; i--) node = { name: `N${i}`, isActive: true, components: [], children: [node] };
  const raw = { Hierarchy: [{ sceneName: 'S', stats: { rootCount: 1, nodeCount: 500, maxDepth: 500 }, roots: [node] }] };
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-deep-'));
  const file = path.join(project, 'h.json');
  fs.writeFileSync(file, JSON.stringify(raw));
  let e;
  await assert.doesNotReject(async () => {
    e = await sceneTree({ _call: fakeCall({ Success: true, HierarchyFilePath: file }) });
  }, '超深 hierarchy 不得抛（抛会冒成 internal error / 退出码 3）');
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'HIERARCHY_TOO_DEEP');
  assert.ok(e.hint.length > 0);
});

test('stats 的 nodeCount/maxDepth 缺失或非数字 → BAD_HIERARCHY 并点名（R89③ R38）', async () => {
  const cases = [
    [{ sceneName: 'S', stats: { maxDepth: 0 }, roots: [] }, 'stats.nodeCount'],
    [{ sceneName: 'S', stats: { nodeCount: '2', maxDepth: 0 }, roots: [] }, 'stats.nodeCount'],
    [{ sceneName: 'S', stats: { nodeCount: 0 }, roots: [] }, 'stats.maxDepth'],
  ];
  for (const [h0, field] of cases) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-stats-'));
    const file = path.join(project, 'h.json');
    fs.writeFileSync(file, JSON.stringify({ Hierarchy: [h0] }));
    const e = await sceneTree({ _call: fakeCall({ Success: true, HierarchyFilePath: file }) });
    assert.strictEqual(e.ok, false);
    assert.strictEqual(e.code, 'BAD_HIERARCHY');
    assert.strictEqual(e.actual.field, field);
    assert.ok(Array.isArray(e.actual.keys));
  }
});

test('两个 .cs 携带读回/非激活/组件校验的协议标记（R79 R80 R82 R83 R90 R93 R94）', () => {
  // ⚠️ 这是**字符串 tripwire，不是行为测试**：它只能证明文件里出现了这些标记，
  // 测不出 CS0136（局部变量重名）、CS8421 这类编译错误，也测不出「先改后验」这类
  // 行为缺陷 —— 那些只能靠真机验证（见 task-10-report.md 的修复轮 1）。
  const dir = path.join(__dirname, '..', 'unity-scripts');
  const inspect = fs.readFileSync(path.join(dir, 'node-inspect.cs'), 'utf8');
  assert.match(inspect, /o\["path"\]/);
  // R480（b1r3）：node-inspect.cs 的**实例定位协议**必须有静态契约钉住 ——
  //   复审实测：把选择逻辑改回 `matches[wantSibling.Value]` 后 615 条仍全绿（单测对 .cs 无牙）。
  //   ① 载荷判**存在性**：JSON null 在 Json.NET 里是 JValue（不是 C# null），只能用 Property(...) 判。
  assert.match(inspect, /req\.Property\("siblingIndex"\)/, '必须用 Property(...) 判载荷键存在性');
  assert.match(inspect, /JTokenType\.Null/, '必须显式排除 JSON null（否则「没给」被当成 0/1）');
  //   ② 选择语义 = 节点的**真实 GetSiblingIndex**（不是同名命中列表下标）—— 本轮语义核心。
  assert.match(inspect, /GetSiblingIndex\(\)\s*==\s*wantSibling\.Value/, '必须按真实序号选实例');
  //   ③ 越界错误码 + 可自修的 available 列表。
  assert.match(inspect, /"SIBLING_INDEX_OUT_OF_RANGE"/);
  assert.match(inspect, /err\["available"\]/);
  //   ④ 三个 additive 读回字段。
  assert.match(inspect, /o\["siblingIndex"\]/);
  assert.match(inspect, /o\["instanceId"\]/);
  assert.match(inspect, /o\["matchCount"\]/);
  //   ⑤ DFS 收集函数改名：CollectByPath 定义在、旧名 FindByPath 全文不得再出现。
  assert.match(inspect, /void\s+CollectByPath\(/, 'CollectByPath 函数定义必须存在');
  assert.doesNotMatch(inspect, /FindByPath/, '旧的 FindByPath（只取第一个命中）不得再存在');
  const set = fs.readFileSync(path.join(dir, 'node-set.cs'), 'utf8');
  assert.match(set, /GetRootGameObjects/);
  assert.match(set, /localPosition/);
  assert.match(set, /BAD_PATCH/);
  // R90：两遍式（先全量校验 / 后统一赋值）的标记
  assert.match(set, /R90/);
  assert.match(set, /全部校验通过/);
  const create = fs.readFileSync(path.join(dir, 'node-create.cs'), 'utf8');
  assert.match(create, /COMPONENT_TYPE_NOT_FOUND/);
  assert.match(create, /AddComponent/);
  // R93：非 Component 类型必须先判再 AddComponent（否则异常穿出 + 场景留残骸）
  assert.match(create, /IsAssignableFrom/);
  assert.match(create, /NOT_A_COMPONENT/);
  // R104⑤/R110③：裸名直接走根锚定查找（不再依赖「先 Find 再判根」的顺序 —— 同名根/嵌套共存时会误拒）。
  // 断言必须有鉴别力（F1 审查者用两个变异证明旧的 /FindParentByPath/ 无牙）：
  //   回退调用点 → 第一个断言红；删掉函数定义 → 第二个断言红；退回任意深度 Find → 第三个断言红。
  assert.match(create, /FindParentByPath\(parentPath\)/, '裸名必须调用根锚定函数');
  assert.match(create, /GameObject\s+FindParentByPath\(string\s+path\)/, '函数定义必须存在');
  assert.doesNotMatch(create, /GameObject\.Find\(parentPath\)/, '裸名不得回退到任意深度的 GameObject.Find');
  // R111③：上面的 doesNotMatch 只盯 `Find(parentPath)` 这个字面 —— 把裸名分支改回
  // `GameObject.Find(path)` 时三条断言仍全绿（复审实测）。整文件里 `GameObject.Find(` 只应
  // 出现一次（FindParentByPath 的非裸名分支）；出现第二次即「裸名分支引入了任意深度查找」。
  assert.strictEqual(
    (create.match(/GameObject\.Find\(/g) || []).length,
    1,
    '裸名分支不得引入任意深度查找（GameObject.Find( 全文只允许出现 1 次）',
  );
});

test('CLI node create --json → verified:true 且退出码 0（R85 R78）', async () => {
  const payload = { Success: true, Result: JSON.stringify({ name: 'PiProbe', active: true, path: 'PiProbe' }) };
  const { result, out } = await withFakeDispatcher(payload, () => captureStdout(
    () => main(['node', 'create', '--project-path', 'X', '--name', 'PiProbe', '--json']),
  ));
  assert.strictEqual(result, 0);
  const e = JSON.parse(out);
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
});

test('CLI node set：verified:false → 退出码 1（R85 设计铁律）', async () => {
  const body = nodeSetScript({ name: 'Brick', active: true, position: { x: 0, y: 1e-5, z: 0 } });
  const { result, out } = await withScriptedDispatcher(body, () => captureStdout(
    () => main(['node', 'set', '--project-path', 'X', '--path', 'Brick', '--patch', '{"position":{"x":0,"y":-100,"z":0}}', '--json']),
  ));
  assert.strictEqual(result, 1);
  const e = JSON.parse(out);
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'position.y');
});

test('CLI node set：读回一致 → 退出码 0（R85）', async () => {
  const body = nodeSetScript({ name: 'Brick', active: true, position: { x: 1, y: 2, z: 0 } });
  const { result, out } = await withScriptedDispatcher(body, () => captureStdout(
    () => main(['node', 'set', '--project-path', 'X', '--path', 'Brick', '--patch', '{"position":{"x":1,"y":2,"z":0}}', '--json']),
  ));
  assert.strictEqual(result, 0);
  assert.strictEqual(JSON.parse(out).verified, true);
});

test('CLI 写命令 --patch 非法 JSON → stderr + 退出码 2，不抛（R87）', async () => {
  const { result, out } = await captureStderr(
    () => main(['node', 'set', '--project-path', 'X', '--path', 'B', '--patch', '{oops']),
  );
  assert.strictEqual(result, 2);
  assert.match(out, /--patch/);
});

test('CLI 写命令 --components 非法 JSON → stderr + 退出码 2，不抛（R87 R78b③）', async () => {
  const { result, out } = await captureStderr(
    () => main(['node', 'create', '--project-path', 'X', '--name', 'B', '--components', 'Sprite']),
  );
  assert.strictEqual(result, 2);
  assert.match(out, /--components/);
});

test('CLI node set 缺 --patch → 退出码 2 且 code=MISSING_PATCH（R88；M2 任务 2 起用法错=2）', async () => {
  const { result, out } = await withFakeDispatcher(
    { Success: true, Result: '{}' },
    () => captureStdout(() => main(['node', 'set', '--project-path', 'X', '--path', 'B', '--json'])),
  );
  assert.strictEqual(result, 2);
  const e = JSON.parse(out);
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'MISSING_PATCH');
});

test('CLI node create --components 透传并比对（R78b③）', async () => {
  const payload = {
    Success: true,
    Result: JSON.stringify({ name: 'B', active: true, path: 'B', components: ['Transform', 'Sprite'] }),
  };
  const { result, out } = await withFakeDispatcher(payload, () => captureStdout(
    () => main(['node', 'create', '--project-path', 'X', '--name', 'B', '--components', '["Sprite"]', '--json']),
  ));
  assert.strictEqual(result, 0);
  assert.strictEqual(JSON.parse(out).verified, true);
});

// ─────────────────── 修复轮 1（R90–R95）：写路径的原子性与键封闭性 ───────────────────

test('nodeSet 空 patch {} → EMPTY_PATCH，不发起写（R91）', async () => {
  const spy = [];
  const e = await nodeSet({ projectPath: 'X', path: 'Brick', patch: {}, _call: fakeCall({ Success: true, Result: '{}' }, spy) });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'EMPTY_PATCH');
  assert.deepStrictEqual(e.actual, { patch: {} });
  assert.ok(e.hint.length > 0);
  // 空对象在 subset 语义下没有可比字段 —— 放行就是「零信息 verified:true」
  assert.strictEqual(spy.length, 0, '空 patch 不得发起任何 uloop 调用');
});

test('nodeSet 未知 patch 键 → UNKNOWN_PATCH_KEY，不发起写（R92）', async () => {
  const allowed = ['name', 'active', 'position', 'scale'];
  for (const patch of [{ components: ['Transform'] }, { active: false, nope: 1 }]) {
    const spy = [];
    const e = await nodeSet({ projectPath: 'X', path: 'Brick', patch, _call: fakeCall({ Success: true, Result: '{}' }, spy) });
    assert.strictEqual(e.ok, false, `patch=${JSON.stringify(patch)} 应失败`);
    assert.strictEqual(e.code, 'UNKNOWN_PATCH_KEY');
    assert.deepStrictEqual(e.actual.allowed, allowed);
    assert.deepStrictEqual(e.actual.unknown, Object.keys(patch).filter((k) => !allowed.includes(k)));
    assert.ok(e.hint.some((h) => /node create --components/.test(h)));
    // .cs 只认这四个键：忽略未知键后读回「恰好一致」→ ok+verified 假绿
    assert.strictEqual(spy.length, 0, '未知键必须挡在写入之前');
  }
});

test('nodeSet 的 actual.allowed 是副本，调用方 push 不会放宽白名单（R104③）', async () => {
  const first = await nodeSet({
    projectPath: 'X', path: 'Brick', patch: { nope: 1 },
    _call: fakeCall({ Success: true, Result: '{}' }),
  });
  assert.strictEqual(first.code, 'UNKNOWN_PATCH_KEY');
  first.actual.allowed.push('components');
  first.actual.allowed.push('whatever');
  // 模块级白名单不得被外部引用篡改
  const second = await nodeSet({
    projectPath: 'X', path: 'Brick', patch: { components: ['Transform'] },
    _call: fakeCall({ Success: true, Result: '{}' }),
  });
  assert.strictEqual(second.code, 'UNKNOWN_PATCH_KEY');
  assert.deepStrictEqual(second.actual.allowed, ['name', 'active', 'position', 'scale']);
  // hint 的字段名列表与白名单同源（不得两份真值漂移）
  assert.ok(second.hint.some((h) => h.includes('name/active/position/scale')));
});

test('nodeSet 空名 patch {name:""} → BAD_PATCH，不发起写（R104②）', async () => {
  // .cs 会把节点改成无名，而读回仍用旧路径 → READBACK_FAILED + 一个难寻址的残骸
  const spy = [];
  const e = await nodeSet({
    projectPath: 'X', path: 'Brick', patch: { name: '' },
    _call: fakeCall({ Success: true, Result: '{"__written":true}' }, spy),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BAD_PATCH');
  assert.strictEqual(e.actual.field, 'name');
  assert.ok(e.hint.length > 0);
  assert.strictEqual(spy.length, 0, '空名必须挡在写入之前');
});

test('nodeCreate --parent 非字符串/空 → BAD_PARENT，不发起写（R94 F5②）', async () => {
  for (const parent of [true, 1, {}, [], '', '/', '//']) {
    const spy = [];
    const e = await nodeCreate({ projectPath: 'X', name: 'B', parent, _call: fakeCall({ Success: true, Result: '{}' }, spy) });
    assert.strictEqual(e.ok, false, `parent=${JSON.stringify(parent)} 应失败`);
    assert.strictEqual(e.code, 'BAD_PARENT');
    assert.ok(e.hint.length > 0);
    assert.strictEqual(spy.length, 0, '父路径不合法时不得发起任何 uloop 调用');
  }
  // 未给 parent 仍然合法（无父建节点）—— R104⑥：断言有牙（原先的 notStrictEqual 任何其它错误码都能过）
  const spy = [];
  const e = await nodeCreate({ projectPath: 'X', name: 'B', _call: fakeCall({ Success: true, Result: '{}' }, spy) });
  assert.strictEqual(e.ok, true, '未给 parent 必须走到写入+读回，而不是被 BAD_PARENT 挡下');
  assert.deepStrictEqual(
    JSON.parse(JSON.parse(spy[0].args[3]).p), { name: 'B', components: [] },
    '写入载荷里不得出现 parent',
  );
});

test('nodeCreate PARENT_NOT_FOUND 带上 .cs 的 detail（R104④）', async () => {
  // 「节点存在但在嵌套里」与「节点不存在」是两回事，detail 不能丢
  const e = await nodeCreate({
    projectPath: 'X', name: 'Brick', parent: 'Panel',
    _call: fakeCall({
      Success: true,
      Result: JSON.stringify({
        __error: 'PARENT_NOT_FOUND', parent: 'Panel',
        detail: '裸名只接受根对象；父路径需从根写起（如 Canvas/Panel）',
      }),
    }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'PARENT_NOT_FOUND');
  assert.strictEqual(e.actual.parent, 'Panel');
  assert.match(e.actual.detail, /裸名只接受根对象/);
  assert.match(e.message, /裸名只接受根对象/, 'detail 必须进 message，否则被读成「不存在」');
});

test('nodeCreate --parent 尾随 / 被规范化，不拼出 Canvas//Brick 假红（R94 F5②）', async () => {
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ name: 'Brick', active: true, path: 'Canvas/Brick' }) },
    { Success: true, Result: JSON.stringify({ name: 'Brick', active: true, path: 'Canvas/Brick', components: [] }) },
  ], spy);
  const e = await nodeCreate({ projectPath: 'X', name: 'Brick', parent: 'Canvas/', _call: call });
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[0].args[3]).p), { name: 'Brick', parent: 'Canvas', components: [] });
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[1].args[3]).p), { path: 'Canvas/Brick' });
  assert.deepStrictEqual(e.intent, { name: 'Brick', active: true, path: 'Canvas/Brick' });
  assert.strictEqual(e.verified, true);
  assert.strictEqual(spy.length, 2);
});

test('READBACK_FAILED 的 hint 写明「写入可能已生效」与中性复核指引（R94 F5③ / R104①）', async () => {
  // R110④：residue 文案是 readBackAndVerify 的**参数** —— create / set 各自得到对的信息
  const createNotFound = sequenceCall([
    { Success: true, Result: '{"__written":true}' },
    { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) },
  ]);
  const c = await nodeCreate({ projectPath: 'X', name: 'Brick', _call: createNotFound });
  assert.strictEqual(c.code, 'READBACK_FAILED');
  assert.ok(c.hint.some((h) => /新节点/.test(h)), 'create 的读回失败要提示可能已留下新节点');
  assert.ok(c.hint.some((h) => /删除/.test(h)), 'create 要给出删除多余项的指引');
  assert.ok(c.hint.some((h) => /scene tree/.test(h)));

  // 读回失败 ≠ 写入失败：.cs 先写后返回，只要跑到了写，改动就已经在场景里
  const notFound = sequenceCall([
    { Success: true, Result: '{"__written":true}' },
    { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) },
  ]);
  const e = await nodeSet({ projectPath: 'X', path: 'Brick', patch: { active: false }, _call: notFound });
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.ok(e.hint.some((h) => /写入可能已生效/.test(h)));
  assert.ok(e.hint.some((h) => /scene tree/.test(h)));
  // R104①：`node set` 不会新建节点，hint 不得说「清理残骸」（那是 create 专属）
  assert.ok(!e.hint.some((h) => /清理/.test(h)), 'set 的读回失败不得提示清理残骸');
  assert.ok(!e.hint.some((h) => /新节点/.test(h)), 'set 不会新建节点，不得提新节点');

  // 读回调用本身抛出（无 read 信封）同样要给出残骸提示
  let n = 0;
  const throwing = async () => {
    n++;
    if (n === 1) return { code: 0, json: { Success: true, Result: '{"__written":true}' } };
    throw new Error('boom');
  };
  const e2 = await nodeSet({ projectPath: 'X', path: 'Brick', patch: { active: false }, _call: throwing });
  assert.strictEqual(e2.code, 'READBACK_FAILED');
  assert.ok(e2.hint.some((h) => /写入可能已生效/.test(h)));
});

test('写调用本身抛出 → WRITE_CALL_FAILED，不冒成 internal error/退出码 3（R95 F6①）', async () => {
  const boom = async () => { throw new Error('spawn boom'); };
  let c;
  await assert.doesNotReject(async () => { c = await nodeCreate({ projectPath: 'X', name: 'B', _call: boom }); });
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.code, 'WRITE_CALL_FAILED');
  assert.match(c.message, /spawn boom/);
  assert.deepStrictEqual(c.intent, { name: 'B', active: true });
  assert.strictEqual(c.verified, false);
  let s;
  await assert.doesNotReject(async () => {
    s = await nodeSet({ projectPath: 'X', path: 'B', patch: { active: false }, _call: boom });
  });
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.code, 'WRITE_CALL_FAILED');
  assert.deepStrictEqual(s.intent, { active: false });
});

test('nodeSet 的 patch 守卫仍认「普通对象」：类实例 / Date 一律 MISSING_PATCH（isPlainPatch 删除后行为不变）', async () => {
  const spy = [];
  for (const bad of [new Date(), new (class { constructor() { this.active = true; } })()]) {
    const e = await nodeSet({ projectPath: 'X', path: 'B', patch: bad, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'MISSING_PATCH');
  }
  assert.strictEqual(spy.length, 0, '守卫必须在发起任何调用之前挡下');
});

// ─────────────── M2 任务 1 修复轮：截断感知接入的回归网（R215）───────────────
// 这两条守的是**接入事实**「场景调用点必须走 envelopeFromCall」：把 lib/scene.js 的
// `envelopeFromCall(r)` 改回 `fromUloop(r.json)` 时它们必红。
// 之所以必须有：全部既有假件都硬写 `truncated:false`，截断分支无人守护，
// 改回 fromUloop 也能让套件全绿 —— M1 的假绿可以无声回潮。

test('sceneTree：_call 报 truncated → ULOOP_TRUNCATED，截断优先于 json（不产伪结果，R215）', async () => {
  const r = await sceneTree({
    projectPath: 'X',
    // 假件的 json 是「看起来成功」的：截断的实现若采信它就会继续去读 x 而落别的码
    _call: fakeCall({ Success: true, HierarchyFilePath: 'x' }, [], { truncated: true, drained: true }),
  });
  assert.strictEqual(r.ok, false, '截断必须按失败处理，绝不落 ok:true');
  assert.strictEqual(r.code, 'ULOOP_TRUNCATED');
  assert.strictEqual(r.actual.drained, true);
});

test('nodeSet：_call 报 truncated 且 json 非 null → ULOOP_TRUNCATED 优先于 json（绝不落 ok:true，R215）', async () => {
  const spy = [];
  const r = await nodeSet({
    projectPath: 'X', path: 'B', patch: { active: false },
    _call: fakeCall({ Success: true, Result: '{"__written":true}' }, spy, { truncated: true, drained: true }),
  });
  assert.strictEqual(r.ok, false, '截断必须按失败处理，绝不落 ok:true');
  assert.strictEqual(r.code, 'ULOOP_TRUNCATED');
  assert.strictEqual(r.actual.drained, true);
  assert.strictEqual(spy.length, 1, '截断在写调用返回后立即短路，不得再发起读回调用');
});

// ─────── F3/R348（原延后项 D14）：写路径遇传输层截断时，hint 必须提示「先复核再重试」───────
// `envelopeFromCall` 的截断 hint 只说「可限次重试」（对**读**命令够用）；对**写**命令照着重试
// 会造重复节点 / 重复改动 —— `execute-dynamic-code` 的写入可能**已经生效**。
// 三处写路径都必须补上复核提示，且**只加 hint**：`code`/`verified`/`retryable` 与退出码一律不动
// （本就如此，故这里连它们一并钉住，防止后续“顺手”改坏）。

test('写路径（create/set/delete）遇 ULOOP_TRUNCATED：hint 提示先复核再重试，code/退出码不变（F3/R348）', async () => {
  const truncatedCall = () => async (tool, args) => ({
    code: 124, stdout: '', stderr: '', timedOut: true, drained: false,
    json: null, truncated: true, tool, args,
  });
  const envls = {
    nodeCreate: await nodeCreate({ projectPath: 'X', name: 'B', _call: truncatedCall() }),
    nodeSet: await nodeSet({ projectPath: 'X', path: 'B', patch: { active: false }, _call: truncatedCall() }),
    nodeDelete: await nodeDelete({ projectPath: 'X', path: 'B', _call: truncatedCall() }),
  };
  for (const [label, e] of Object.entries(envls)) {
    assert.strictEqual(e.ok, false, label);
    assert.strictEqual(e.code, 'ULOOP_TRUNCATED', label);
    assert.strictEqual(e.verified, false, label);
    assert.strictEqual(e.retryable, true, label);
    assert.strictEqual(exitCodeOf(e), 1, `${label}：只加 hint，不得改退出码`);
    assert.ok(
      e.hint.some((h) => /复核/.test(h) && /scene tree/.test(h)),
      `${label} 缺「先复核再重试」的 hint：${JSON.stringify(e.hint)}`,
    );
    assert.ok(
      e.hint.some((h) => /已存在|已改动/.test(h)),
      `${label} 必须点明「写入可能已生效」：${JSON.stringify(e.hint)}`,
    );
  }
  // delete 的 intent 透传不受影响（R226）；create/set 的截断信封仍是无 intent 的传输层信封（不凭空编造）
  assert.deepStrictEqual(envls.nodeDelete.intent, { path: null });
  assert.strictEqual(envls.nodeCreate.intent, null);
  assert.strictEqual(envls.nodeSet.intent, null);
});

// ─────────────────── M2 任务 2：PATCH_KEYS ↔ node-set.cs tripwire ───────────────────

test('跨语言真值 tripwire：PATCH_KEYS 与 node-set.cs 的 patch 字段逐字一致（M1 延后项③）', () => {
  assert.deepStrictEqual([...PATCH_KEYS], ['name', 'active', 'position', 'scale']);
  // R221：白名单必须真的冻结 —— 活数组被 `PATCH_KEYS.push('sprite')` 后，UNKNOWN_PATCH_KEY 守卫静默失效
  assert.strictEqual(Object.isFrozen(PATCH_KEYS), true, 'PATCH_KEYS 必须冻结（push 会永久放宽白名单）');
  assert.throws(() => PATCH_KEYS.push('sprite'), TypeError);
  const src = fs.readFileSync(path.join(__dirname, '..', 'unity-scripts', 'node-set.cs'), 'utf8');
  // R218：**一次集合相等**同时覆盖正反两个方向（比原意图更强）：
  //   少一个键 = `.cs` 不支持该键（JS 放行却静默无操作 → ok+verified 假绿）；
  //   多一个键 = `.cs` 读了白名单外的 patch 字段（绕过 UNKNOWN_PATCH_KEY 守卫）。
  // ⚠️ 不得退回逐键 `new RegExp(\`patch\["${k}"\]\`)` 式断言：模板字面量里的 `\[` 是
  // NonEscapeCharacter，编译出的字符串是 `patch["name"]`，作为**正则**时 `["name"]` 是
  // **字符类**（匹配 " / n / a / m / e 之一），`.cs` 里任意一处 `patch"`（头部注释与
  // `var patch = req["patch"]`）就能让它恒真。变异实证（修复轮 1）：
  //   `patch["name"]`→`patch["active"]`、删掉整段 scale 支持 → 旧断言全绿。
  const reads = [...new Set([...src.matchAll(/patch\["([^"]+)"\]/g)].map((m) => m[1]))].sort();
  assert.deepStrictEqual(reads, [...PATCH_KEYS].sort(),
    'node-set.cs 读的 patch 字段必须与 PATCH_KEYS 逐字一致（少一个 = .cs 不支持该键；多一个 = 绕过 UNKNOWN_PATCH_KEY 守卫）');
  // USAGE 必须把 4 个键写在用户看得到的地方（新增键时漏改 USAGE = 文档与实现脱节）。
  // R220：必须锚定**具体那一行** —— `usage.includes(k)` 是对 `bin/unity.js` **整个文件源文本**
  // 做子串匹配，`name`/`active` 在别处（`--name` / `--window-name` 等）也出现，
  // 把 USAGE 里那一整行删掉仍绿。
  const usage = fs.readFileSync(path.join(__dirname, '..', 'bin', 'unity.js'), 'utf8');
  assert.match(usage, /支持的键只有\s+name \/ active \/ position \/ scale/,
    'USAGE 必须逐字列出支持的 patch 键');
});

test('退出码边界：用法错 2 / 运行时错 1（M1 延后项⑨，CLI 端到端）', async () => {
  const { exitCodeFor } = require('../lib/envelope.js');
  // 缺 --patch（值缺失）= 用法错
  const miss = await withFakeDispatcher(
    { Success: true, Result: '{}' },
    () => captureStdout(() => main(['node', 'set', '--project-path', 'X', '--path', 'B', '--json'])),
  );
  assert.strictEqual(miss.result, 2);
  assert.strictEqual(JSON.parse(miss.out).code, 'MISSING_PATCH');
  assert.strictEqual(exitCodeFor(JSON.parse(miss.out)), 2);
  // 目标不存在（运行时）= 1
  const notFound = await withFakeDispatcher(
    { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) },
    () => captureStdout(() => main(['node', 'inspect', '--project-path', 'X', '--path', 'Nope', '--json'])),
  );
  assert.strictEqual(notFound.result, 1);
});

// ─────────────────── M2 任务 3：node delete（写后读回：消失才算成功）───────────────────

test('nodeDelete 缺 --path / 裸 --path → MISSING_PATH，不发起写（沿用 R69）', async () => {
  for (const p of [undefined, '', true]) {
    const spy = [];
    const e = await nodeDelete({ projectPath: 'X', path: p, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'MISSING_PATH');
    assert.strictEqual(spy.length, 0);
  }
});

test('nodeDelete 成功：写 → 读回 NOT_FOUND → verified:true，actual 带实际路径', async () => {
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __deleted: true, path: 'Canvas/Btn' }) },
    { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) },
  ], spy);
  const e = await nodeDelete({ projectPath: 'X', path: 'Btn', _call: call });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(e.actual, { path: 'Canvas/Btn', deleted: true });
  assert.deepStrictEqual(e.mismatches, []);
  assert.deepStrictEqual(e.intent, { path: null }, 'R226：成功信封也带 delete 的统一 intent（该路径理应不存在）');
  assert.strictEqual(spy[0].tool, 'execute-dynamic-code');
  assert.strictEqual(spy[1].tool, 'execute-dynamic-code');
  assert.strictEqual(JSON.parse(JSON.parse(spy[0].args[3]).p).path, 'Btn');
  assert.strictEqual(JSON.parse(JSON.parse(spy[1].args[3]).p).path, 'Canvas/Btn', '读回必须用 .cs 回报的实际路径');
});

test('nodeDelete 节点不存在 → NOT_FOUND（退出码 1，不是用法错）', async () => {
  const e = await nodeDelete({
    projectPath: 'X', path: 'Nope',
    _call: fakeCall({ Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'NOT_FOUND');
  assert.deepStrictEqual(e.actual, { path: 'Nope' });
  assert.deepStrictEqual(e.intent, { path: null }, 'R226：失败信封也带 delete 的统一 intent');
  assert.strictEqual(exitCodeOf(e), 1);
});

test('nodeDelete 写结果不符合协议（缺 path）→ BAD_SCRIPT_RESULT，不静默回落入参（R225）', async () => {
  const e = await nodeDelete({
    projectPath: 'X', path: 'B',
    _call: fakeCall({ Success: true, Result: JSON.stringify({ __deleted: true }) }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BAD_SCRIPT_RESULT');
  assert.deepStrictEqual(e.actual, { __deleted: true });
  assert.deepStrictEqual(e.intent, { path: null });
  assert.strictEqual(exitCodeOf(e), 1, '协议不符是运行时错，不是用法错');
});

// R296（M2 任务 10 补）：`__deleted !== true` 子句单独一条防线（旧用例只盖了「缺 path」那一半）。
test('nodeDelete 写结果缺 __deleted（只有 path）→ BAD_SCRIPT_RESULT，不静默回落入参（R296）', async () => {
  const e = await nodeDelete({
    projectPath: 'X', path: 'B',
    _call: fakeCall({ Success: true, Result: JSON.stringify({ path: 'B' }) }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BAD_SCRIPT_RESULT');
  assert.deepStrictEqual(e.intent, { path: null });
  assert.strictEqual(exitCodeOf(e), 1, '协议不符是运行时错，不是用法错');
});

test('nodeDelete 读回发现节点还在 → verified:false + 一条分歧（绝不假绿）', async () => {
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __deleted: true, path: 'B' }) },
    { Success: true, Result: JSON.stringify({ name: 'B', active: true, path: 'B', components: ['Transform'], position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }) },
  ]);
  const e = await nodeDelete({ projectPath: 'X', path: 'B', _call: call });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'path');
  assert.strictEqual(e.mismatches[0].actual, 'B');
  // R226：分歧必须是 compareSubset({path:null}, actual) 的真产物，且与信封 intent 同源
  assert.deepStrictEqual(e.intent, { path: null });
  assert.deepStrictEqual(e.mismatches, [{ key: 'path', intent: null, actual: 'B' }]);
  assert.ok(e.hint.some((h) => /同名兄弟/.test(h)), 'R227①：删除不可逆，hint 必须提醒同名兄弟风险');
});

test('nodeDelete 写调用 reject → WRITE_CALL_FAILED（不冒成退出码 3）', async () => {
  const e = await nodeDelete({
    projectPath: 'X', path: 'B',
    _call: async () => { throw new Error('boom'); },
  });
  assert.strictEqual(e.code, 'WRITE_CALL_FAILED');
  assert.match(e.message, /boom/);
  assert.deepStrictEqual(e.intent, { path: null });
  assert.strictEqual(exitCodeOf(e), 1, 'R227④：reject 不得冒成内部错（退出码 3）');
});

test('nodeDelete 读回阶段抛异常 → READBACK_FAILED（保留「可能已删」的提示）', async () => {
  let n = 0;
  const e = await nodeDelete({
    projectPath: 'X', path: 'B',
    _call: async () => {
      n++;
      if (n === 1) return { code: 0, json: { Success: true, Result: JSON.stringify({ __deleted: true, path: 'B' }) }, truncated: false, tool: 'execute-dynamic-code', args: [] };
      throw new Error('read blew up');
    },
  });
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.strictEqual(e.phase, 'readback');
  assert.ok(e.hint.some((h) => /scene tree/.test(h)));
});

test('nodeDelete 读回落在其它失败码 → READBACK_FAILED（R224：该分支必须有防线）', async () => {
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __deleted: true, path: 'B' }) },
    { Success: false, ErrorCode: 'UNITY_EXCEPTION', Message: 'readback blew up' },
  ]);
  const e = await nodeDelete({ projectPath: 'X', path: 'B', _call: call });
  assert.strictEqual(e.ok, false, '读回失败不得被当成删除成功');
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.strictEqual(e.phase, 'readback');
  assert.deepStrictEqual(e.intent, { path: null });
  assert.match(e.message, /UNITY_EXCEPTION/);
  assert.ok(e.hint.some((h) => /scene tree/.test(h)));
  assert.strictEqual(exitCodeOf(e), 1);
});

test('CLI node delete 成功 → 退出码 0；缺 --path → 2（M2 退出码边界）', async () => {
  const okRun = await withScriptedDispatcher(
    [
      "const args = process.argv.slice(2).join(' ');",
      "const json = args.includes('node-delete')",
      "  ? { Success: true, Result: JSON.stringify({ __deleted: true, path: 'B' }) }",
      "  : { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) };",
      "process.stdout.write(JSON.stringify(json) + '\\n');",
    ].join('\n'),
    () => captureStdout(() => main(['node', 'delete', '--project-path', 'X', '--path', 'B', '--json'])),
  );
  assert.strictEqual(okRun.result, 0);
  assert.strictEqual(JSON.parse(okRun.out).verified, true);

  const bad = await captureStdout(() => main(['node', 'delete', '--project-path', 'X', '--json']));
  assert.strictEqual(bad.result, 2);
  assert.strictEqual(JSON.parse(bad.out).code, 'MISSING_PATH');
});

// ───────────────── R480：⑤ `node inspect` 的实例唯一定位（`--sibling-index`）─────────────────

/** 两个同父同名节点（同父 = Root）：Root/Brick#0 与 Root/Brick#1（真实序号 0、1）。 */
function dupScene() {
  return makeFakeSceneBackend({ baseScene: [{ path: 'Root' }, { path: 'Root/Brick' }, { path: 'Root/Brick' }] });
}

/**
 * R480（b1r1）：**父下异名兄弟交错**的场景 —— Root 的子序为 `Brick(0), Other(1), Brick(2)`。
 * 这是本次修复的判别场景：同父同名的「命中列表下标」是 0/1，而「真实 GetSiblingIndex」是 0/2。
 * 旧实现（`matches[n]`）在这里必错。
 */
function interleavedScene() {
  return makeFakeSceneBackend({
    baseScene: [
      { path: 'Root' },
      { path: 'Root/Brick', siblingIndex: 0 },
      { path: 'Root/Other', siblingIndex: 1 },
      { path: 'Root/Brick', siblingIndex: 2 },
    ],
  });
}

test('R480：node inspect --sibling-index 能定位同父同名的第 N 个实例（U42 关闭）', async () => {
  const { call } = dupScene();
  const e0 = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', siblingIndex: '0', _call: call });
  const e1 = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', siblingIndex: '1', _call: call });
  assert.strictEqual(e0.ok, true);
  assert.strictEqual(e1.ok, true);
  assert.strictEqual(e0.actual.siblingIndex, 0);
  assert.strictEqual(e1.actual.siblingIndex, 1);
  assert.notStrictEqual(e0.actual.instanceId, e1.actual.instanceId, '两个实例必须是不同的对象');
});

test('R480（b1r1 核心）：--sibling-index 是真实 GetSiblingIndex 值，不是同名命中列表下标（父下异名交错）', async () => {
  const { call } = interleavedScene();
  // Root 下子序：Brick(0), Other(1), Brick(2)
  const e0 = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', siblingIndex: '0', _call: call });
  const e2 = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', siblingIndex: '2', _call: call });
  assert.strictEqual(e0.ok, true);
  assert.strictEqual(e2.ok, true);
  assert.strictEqual(e0.actual.siblingIndex, 0, '真实序号 0 → 第 1 个 Brick');
  assert.strictEqual(e2.actual.siblingIndex, 2, '真实序号 2 → 第 2 个 Brick（旧实现会错拿下标 1 的那个）');
  assert.notStrictEqual(e0.actual.instanceId, e2.actual.instanceId, '两个实例必须是不同的对象');
  // 真实序号 1 是 Other —— Brick 集合里没有 1 → 必须报越界（旧实现会把 1 当命中下标，静默拿到第 2 个 Brick）
  const bad = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', siblingIndex: '1', _call: call });
  assert.strictEqual(bad.code, 'SIBLING_INDEX_OUT_OF_RANGE');
  assert.strictEqual(exitCodeFor(bad), 1, '「该父下没有序号 1 的同名节点」是运行时事实，不是 argv 形状错');
  assert.deepStrictEqual(bad.actual.available, [0, 2], 'available 回传可用的真实序号列表');
});

test('R480（b1r2 夹具）：scene tree 的 siblingIndex 是「父下真实子序」，不是同 path 数组下标', async () => {
  // 交错声明：Root 的子节点创建序为 A, Brick, C, Brick → 真实 siblingIndex 应 A@0, Brick@1, C@2, Brick@3。
  // 旧夹具按「同 path 数组下标」填，会错报成 A@0, Brick@0, C@0, Brick@1（掩盖主用法 bug）。
  const be = makeFakeSceneBackend({
    baseScene: [
      { path: 'Root' },
      { path: 'Root/A' },
      { path: 'Root/Brick' },
      { path: 'Root/C' },
      { path: 'Root/Brick' },
    ],
  });
  const e = await sceneTree({ projectPath: 'P', _call: be.call });
  assert.strictEqual(e.ok, true);
  const root = e.actual.roots[0];
  assert.strictEqual(root.name, 'Root');
  assert.deepStrictEqual(
    root.children.map((c) => `${c.name.split('/').pop()}@${c.siblingIndex}`),
    ['A@0', 'Brick@1', 'C@2', 'Brick@3'],
  );
});

test('R480（b1r2 夹具）：node-delete 一次只删一个同名实例；同名兄弟仍在 → verified:false', async () => {
  // 真机 `node-delete.cs` = Find + DestroyImmediate（一次一个）。夹具同形后，删完同名兄弟仍在时
  // 读回应命中剩下的那个 → `verified:false`（钉住计划 §7 裁定 #6 的真机现象）。
  const be = dupScene();
  const del = await nodeDelete({ projectPath: 'P', path: 'Root/Brick', _call: be.call });
  assert.strictEqual(del.ok, true);
  assert.strictEqual(del.verified, false, '同名兄弟仍在 → 读回命中它 → verified:false');
  assert.strictEqual(be.nodes.get('Root/Brick').length, 1, '只删一个实例（不是删光整个 key）');
  const del2 = await nodeDelete({ projectPath: 'P', path: 'Root/Brick', _call: be.call });
  assert.strictEqual(del2.verified, true, '删光同 path 全部实例后才 verified:true');
  assert.strictEqual(be.nodes.has('Root/Brick'), false);
});

test('R480（b1r3 夹具）：无参默认「激活优先」——同父同名第一个 inactive / 第二个 active 时命中 active 那个', async () => {
  // 真机 `node-inspect.cs` / `node-set.cs` 的无参默认都走 `GameObject.Find`（**激活优先**）。
  // 夹具旧行为取 `list[0]`（创建序）→ 这里会错拿 inactive 的那个（保真度缺口）。
  const be = makeFakeSceneBackend({
    baseScene: [
      { path: 'Root' },
      { path: 'Root/Brick', active: false },
      { path: 'Root/Brick', active: true },
    ],
  });
  const inspect = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', _call: be.call });
  assert.strictEqual(inspect.ok, true);
  assert.strictEqual(inspect.actual.active, true, 'node inspect 无参默认必须命中激活的那个（对齐真机 Find）');
  assert.strictEqual(inspect.actual.siblingIndex, 1, '命中第二个（真实序号 1）');
  const set = await nodeSet({ projectPath: 'P', path: 'Root/Brick', patch: { position: { x: 7, y: 0, z: 0 } }, _call: be.call });
  assert.strictEqual(set.ok, true);
  assert.strictEqual(set.verified, true);
  const list = be.nodes.get('Root/Brick');
  assert.deepStrictEqual(list.find((n) => n.active).position, { x: 7, y: 0, z: 0 }, '改的是激活的那个');
  assert.deepStrictEqual(list.find((n) => !n.active).position, { x: 0, y: 0, z: 0 }, 'inactive 的那个不得被改');
});

test('R480：不给 --sibling-index 且命中多个 → 仍取第一个，但 actual.matchCount > 1 且带 hint（D-B2）', async () => {
  const { call } = dupScene();
  const e = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', _call: call });
  assert.strictEqual(e.ok, true, '不破坏既有行为（仍 ok）');
  assert.strictEqual(e.actual.siblingIndex, 0, '仍取第一个');
  assert.strictEqual(e.actual.matchCount, 2);
  const hint = e.hint.find((h) => h.includes('--sibling-index'));
  assert.ok(hint, 'hint 必须给出定位出路');
  assert.ok(hint.includes('scene tree'), 'hint 必须指向 `scene tree` 的 siblingIndex 字段');
  assert.ok(!/\d+\.\.\d+/.test(hint), 'hint 不得再给「0..matchCount-1」区间（会诱导错传）');
});

test('R480：--sibling-index 越界 → SIBLING_INDEX_OUT_OF_RANGE（运行时码 1，不是用法错）', async () => {
  const { call } = dupScene();
  const e = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', siblingIndex: '9', _call: call });
  assert.strictEqual(e.code, 'SIBLING_INDEX_OUT_OF_RANGE');
  assert.strictEqual(exitCodeFor(e), 1, '「第 9 个兄弟不存在」是运行时事实，不是 argv 形状错');
  assert.deepStrictEqual(e.actual.available, [0, 1], '越界错误必须回传可用的真实序号列表（可自修）');
  assert.ok(e.hint.some((h) => h.includes('scene tree')), 'hint 必须指向 `scene tree` 取值');
});

test('R480：--sibling-index 非非负整数 → BAD_SIBLING_INDEX（用法错 2），且在任何调用之前收敛', async () => {
  const boom = async () => { throw new Error('不该调用 uloop'); };
  for (const bad of ['-1', '1.5', 'abc', '', '3000000000', '9'.repeat(400)]) {
    const e = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', siblingIndex: bad, _call: boom });
    assert.strictEqual(e.code, 'BAD_SIBLING_INDEX', `--sibling-index=${JSON.stringify(bad)}`);
    assert.strictEqual(exitCodeFor(e), 2);
  }
});

test('R480：--sibling-index 裸写（parseArgs → true）→ BAD_SIBLING_INDEX（2），不是当成 1', async () => {
  const boom = async () => { throw new Error('不该调用 uloop'); };
  const e = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', siblingIndex: true, _call: boom });
  assert.strictEqual(e.code, 'BAD_SIBLING_INDEX');
  assert.strictEqual(exitCodeFor(e), 2);
});

test('R480：CLI node inspect 把 --sibling-index 透传进载荷，且 USAGE 列出该选项', async () => {
  const run = await withScriptedDispatcher(
    [
      // 有牙性（b1r2 修复）：脚本**回显**它收到的原始 argv（--code-file / --parameters），
      // 而不是硬编码 Result —— 删掉 bin/unity.js 的 `siblingIndex: args['sibling-index']`
      // 透传后，载荷里就没有 siblingIndex，下面的断言必红（消除假绿）。
      'const argv = process.argv.slice(2);',
      "const codeFile = argv[argv.indexOf('--code-file') + 1];",
      "const parameters = argv[argv.indexOf('--parameters') + 1];",
      'const payload = JSON.parse(JSON.parse(parameters).p);',
      "process.stdout.write(JSON.stringify({ Success: true, Result: JSON.stringify({ name: 'Brick', path: 'Root/Brick', siblingIndex: payload.siblingIndex, instanceId: 42, matchCount: 2, components: ['Transform'], codeFile, parameters }) }) + '\\n');",
    ].join('\n'),
    () => captureStdout(() => main(['node', 'inspect', '--project-path', 'P', '--path', 'Root/Brick', '--sibling-index', '1', '--json'])),
  );
  assert.strictEqual(run.result, 0);
  const out = JSON.parse(run.out);
  assert.strictEqual(out.actual.siblingIndex, 1);
  assert.ok(out.actual.codeFile.endsWith('node-inspect.cs'), '必须走 node-inspect.cs');
  // 直接检查透传的原始 `--parameters`：其 `p` 必须真的带 siblingIndex=1（不是夹具硬编码）。
  assert.strictEqual(
    JSON.parse(JSON.parse(out.actual.parameters).p).siblingIndex,
    1,
    '--sibling-index 必须被 CLI 透传进 --parameters 载荷',
  );
  const help = await captureStdout(() => main(['--help']));
  assert.match(help.out, /--sibling-index/);
});
