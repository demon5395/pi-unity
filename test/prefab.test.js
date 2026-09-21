'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { prefabCreate: prefabCreateRaw, prefabInstantiate, prefabApply, prefabRevert, nodeProjection, prefabRootName } = require('../lib/prefab.js');
// R455：生产侧在写 Prefab 之前会 `fs.mkdirSync(path.dirname(absTo), {recursive:true})`。
// 本文件的用例普遍用 `projectPath:'P'`（相对路径）→ 不注入的话会在**仓库根**真的建出 `P/Assets/Prefabs`。
// 所以默认注入一个空实现（测试缝）；要验证 mkdirp 本身的用例显式传 `_mkdirp`（覆盖这里的默认值）。
const prefabCreate = (opts = {}) => prefabCreateRaw({ _mkdirp: () => {}, ...opts });
const { nodeCreate } = require('../lib/scene.js');
const { exitCodeFor } = require('../lib/envelope.js');

function sequenceCall(results, spy = []) {
  let n = 0;
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    const json = results[Math.min(n, results.length - 1)];
    n++;
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}
const nodeResult = (obj) => ({ Success: true, Result: JSON.stringify(obj) });
const SRC_NODE = {
  name: 'Brick_0_0', active: true, path: 'Brick_0_0',
  components: ['Transform', 'SpriteRenderer'],
  position: { x: 1, y: 2, z: 0 }, scale: { x: 2, y: 2, z: 1 },
  sprite: { present: true, color: { r: 255, g: 255, b: 255, a: 255 }, sortingOrder: 0, sortingLayerName: 'Default', spriteName: 'hero', assetPath: 'Assets/Art/hero.png', ppu: 16, worldSize: { x: 1.6, y: 1.2 } },
};
// ⚠️ R432：读回的 `name` 是 **Prefab 根名 = `--to` 文件 basename**（`Brick.prefab` → `Brick`），
//   不是源节点名（`Brick_0_0`）—— 真机实测 `SaveAsPrefabAsset` 会把根名改成文件名。
const PREFAB_READ = {
  asset: 'Assets/Prefabs/Brick.prefab', name: 'Brick',
  // R448：`components` 是读回面的一部分（`prefab-create.cs` read 模式 + `nodeProjection`）。
  //   这里必须与 `SRC_NODE.components` **一致** —— mock 与现实同形：真实资产的读回
  //   一定带这个键，夹具缺键会让既有 `verified:true` 用例因「intent 有、actual 没有」
  //   而翻红（那不是断言该放宽，是夹具不真）。
  components: ['Transform', 'SpriteRenderer'],
  position: { x: 1, y: 2, z: 0 }, scale: { x: 2, y: 2, z: 1 },
  spriteAssetPath: 'Assets/Art/hero.png', guid: 'guid-abc',
};
/** `prefabCreate` 写调用的成功返回（guid 默认与 `PREFAB_READ.guid` 一致 → 不触发 R444 的 guid 分歧）。 */
const WRITE_PREFAB = (over = {}) => ({ Success: true, Result: JSON.stringify({ __written: true, guid: 'guid-abc', ...over }) });
/** `prefabCreate` 读调用的成功返回（`{"__read":{…}}`）。 */
const READ_PREFAB = (over = {}) => ({ Success: true, Result: JSON.stringify({ __read: { ...PREFAB_READ, ...over } }) });
/** `prefabInstantiate` 的**资产预读**返回（R437：真实根名 / sprite / 资产根局部变换）。 */
const ASSET_READ = (over = {}) => ({ Success: true, Result: JSON.stringify({ __read: { ...PREFAB_READ, ...over } }) });
/** `prefabInstantiate` 写调用的成功返回。 */
const INST_WRITE = (over = {}) => ({ Success: true, Result: JSON.stringify({ __written: true, instancePath: 'Brick', name: 'Brick', ...over }) });
/** `prefab apply`/`revert` 写调用的成功返回（`__written`/`assetPath`/`hasOverrides`）。 */
const APPLY_WRITE = (over = {}) => ({ Success: true, Result: JSON.stringify({ __written: true, assetPath: 'Assets/Prefabs/CaP.prefab', hasOverrides: false, ...over }) });
/** 实例读回（node inspect）：根 scale 3,3 / components / sprite。
 *  position 故意 ≠ 资产（根 `localPosition` 是 Unity 豁免项，不进读回面）。 */
const INST_READ = (over = {}) => nodeResult({
  name: 'CaI', active: true, path: 'CaI', siblingIndex: 3, instanceId: -1, matchCount: 1,
  position: { x: 5, y: 5, z: 0 }, scale: { x: 3, y: 3, z: 1 },
  sprite: null, components: ['Transform'],
  ...over,
});

test('prefabCreate：缺 --from-node / --to / --project-path → 各自的码，零调用', async () => {
  const spy = [];
  const a = await prefabCreate({ projectPath: 'P', fromNode: undefined, to: 'Assets/Prefabs/a.prefab', _call: sequenceCall([], spy) });
  assert.strictEqual(a.code, 'MISSING_PATH');
  assert.strictEqual(exitCodeFor(a), 2);
  const b = await prefabCreate({ projectPath: 'P', fromNode: 'N', to: undefined, _call: sequenceCall([], spy) });
  assert.strictEqual(b.code, 'MISSING_TO');
  assert.strictEqual(exitCodeFor(b), 2);
  const c = await prefabCreate({ fromNode: 'N', to: 'Assets/Prefabs/a.prefab', _call: sequenceCall([], spy) });
  assert.strictEqual(c.code, 'MISSING_PROJECT_PATH');
  assert.strictEqual(exitCodeFor(c), 2);
  assert.strictEqual(spy.length, 0);
});

test('prefabCreate：--to 不以 .prefab 结尾 / 不在 Assets/ 下 → BAD_TARGET_PATH（用法错 2）', async () => {
  const spy = [];
  for (const to of ['Assets/Prefabs/a.txt', 'Prefabs/a.prefab', 'Assets/../a.prefab']) {
    const e = await prefabCreate({ projectPath: 'P', fromNode: 'N', to, _call: sequenceCall([], spy) });
    assert.strictEqual(e.code, 'BAD_TARGET_PATH', to);
    assert.strictEqual(exitCodeFor(e), 2);
  }
  assert.strictEqual(spy.length, 0);
});

test('prefabCreate：--to 归一（折叠重复 `/`、去掉 `./`）→ intent 与载荷同源（R439）', async () => {
  const spy = [];
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets//Prefabs/./Brick.prefab', _call: sequenceCall([
      nodeResult(SRC_NODE), WRITE_PREFAB(), READ_PREFAB(),
    ], spy),
    _stat: () => ({ size: 2437, mtimeMs: 1700000000000 }),
  });
  assert.strictEqual(e.intent.prefab.asset, 'Assets/Prefabs/Brick.prefab');
  assert.strictEqual(e.intent.prefab.name, 'Brick');
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[1].args[3]).p), { mode: 'write', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab' });
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[2].args[3]).p), { mode: 'read', path: 'Assets/Prefabs/Brick.prefab' });
});

test('prefabCreate：源节点不存在 → 直接把 node inspect 的失败信封透传（NOT_FOUND，退出码 1），不写盘', async () => {
  const spy = [];
  const call = sequenceCall([nodeResult({ __error: 'NOT_FOUND' })], spy);
  const e = await prefabCreate({ projectPath: 'P', fromNode: 'Nope', to: 'Assets/Prefabs/a.prefab', _call: call });
  assert.strictEqual(e.code, 'NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(spy.length, 1, '只许发生「读源节点」这一次调用');
});

test('prefabCreate：happy path —— intent 是源节点投影；写→读两次调用；verified:true', async () => {
  const spy = [];
  const call = sequenceCall([
    nodeResult(SRC_NODE),                                                        // 1) 读源节点（建 intent）
    { Success: true, Result: JSON.stringify({ __written: true, guid: 'guid-abc' }) }, // 2) 写 prefab
    { Success: true, Result: JSON.stringify({ __read: PREFAB_READ }) },          // 3) 读回 prefab 资产
  ], spy);
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab', _call: call,
    // ⚠️ 必须注入 `_stat`：生产侧用 fs.statSync(absTo) 做磁盘防线，而这里没有真项目目录 → 会抛 → `file=null`
    //   → extraCheck 报 `file.bytes` 分歧 → verified:false。**不许**为了过测试放宽生产侧的防线。
    _stat: () => ({ size: 2437, mtimeMs: 1700000000000 }),
  });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(exitCodeFor(e), 0);
  // R432：intent 的 name = `--to` 的文件名（Unity 会写进去的根名），**不是**源节点名
  assert.deepStrictEqual(e.intent.prefab.name, 'Brick');
  assert.deepStrictEqual(e.intent.prefab.position, { x: 1, y: 2, z: 0 });
  assert.strictEqual(e.intent.prefab.spriteAssetPath, 'Assets/Art/hero.png');
  assert.strictEqual(e.actual.guid, 'guid-abc');
  const w = JSON.parse(JSON.parse(spy[1].args[3]).p);
  const r = JSON.parse(JSON.parse(spy[2].args[3]).p);
  assert.deepStrictEqual(w, { mode: 'write', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab' });
  assert.deepStrictEqual(r, { mode: 'read', path: 'Assets/Prefabs/Brick.prefab' });
});

test('prefabCreate：Prefab 内容与源节点不符 → verified:false + 具体分歧键', async () => {
  const spy = [];
  const call = sequenceCall([
    nodeResult(SRC_NODE),
    WRITE_PREFAB(),
    READ_PREFAB({ position: { x: 9, y: 9, z: 0 }, spriteAssetPath: null }),
  ], spy);
  const e = await prefabCreate({ projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab', _call: call });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeFor(e), 1);
  const keys = e.mismatches.map((m) => m.key);
  assert.ok(keys.includes('prefab.position.x'), keys.join(','));
  assert.ok(keys.includes('prefab.spriteAssetPath'), keys.join(','));
});

test('R448：prefab create 的读回面含 components（空节点不再「几乎无内容」）', async () => {
  // 空节点：只有默认 Transform、无 sprite。旧投影的四个字段全是常量默认值
  //   （name 由 `--to` 文件名覆盖、position=0,0,0、scale=1,1,1、spriteAssetPath=null）
  //   → 任何空 Prefab 都能满足同一份 intent → `verified:true` 的证伪力 ≈ 0。
  //   `components` 是这种场景下**唯一**有鉴别力的字段。
  const emptyNode = {
    name: 'M5Empty', active: true, path: 'M5Empty',
    components: ['Transform'],
    position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    sprite: { present: false, assetPath: null },
  };
  const spy = [];
  const call = sequenceCall([
    nodeResult(emptyNode),
    WRITE_PREFAB(),
    READ_PREFAB({
      asset: 'Assets/Prefabs/Empty.prefab', name: 'Empty', components: ['Transform'],
      position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, spriteAssetPath: null,
    }),
  ], spy);
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'M5Empty', to: 'Assets/Prefabs/Empty.prefab', _call: call,
    _stat: () => ({ size: 1000, mtimeMs: 1700000000000 }),
  });
  assert.deepStrictEqual(e.intent.prefab.components, ['Transform'], 'intent 必须来自源节点的读回面');
  assert.deepStrictEqual(e.actual.prefab.components, ['Transform'], 'actual 必须来自 Prefab 资产的读回面');
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(exitCodeFor(e), 0);
});

test('R448：源节点有 SpriteRenderer、Prefab 里丢了 → verified:false + components 分歧（真正有鉴别力）', async () => {
  // 本任务的核心价值：加 `components` 前，「Prefab 里少/多一个组件」根本检不出来
  //   （源节点 `SRC_NODE` 与读回夹具的四个投影字段相同 → 旧代码恒 verified:true）。
  const spy = [];
  const call = sequenceCall([
    nodeResult(SRC_NODE),                 // components: ['Transform','SpriteRenderer']
    WRITE_PREFAB(),
    READ_PREFAB({ components: ['Transform'] }), // Prefab 里少了 SpriteRenderer
  ], spy);
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab', _call: call,
    _stat: () => ({ size: 2437, mtimeMs: 1700000000000 }),
  });
  assert.strictEqual(e.verified, false, '组件集合不同必须被检出');
  assert.strictEqual(exitCodeFor(e), 1);
  const hit = e.mismatches.find((m) => m.key === 'prefab.components');
  assert.ok(hit, JSON.stringify(e.mismatches));
  assert.deepStrictEqual(hit.intent, ['Transform', 'SpriteRenderer']);
  assert.deepStrictEqual(hit.actual, ['Transform']);
});

test('prefabCreate：目标已存在且无 --force → ASSET_EXISTS（运行时 1），零调用', async () => {
  const spy = [];
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab', _call: sequenceCall([], spy),
    _exists: () => true,
  });
  assert.strictEqual(e.code, 'ASSET_EXISTS');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(spy.length, 0);
});

test('prefabCreate：--force 时不落 ASSET_EXISTS（覆盖=更新），照常走写→读回', async () => {
  const spy = [];
  const call = sequenceCall([nodeResult(SRC_NODE), WRITE_PREFAB(), READ_PREFAB()], spy);
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab', force: true, _call: call,
    _exists: () => true,
    _stat: () => ({ size: 2438, mtimeMs: 1700000000001 }),
  });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(spy.length, 3);
});

test('prefabCreate：`--to` 的父目录不存在时自动建目录 —— 在「读源节点」之后、「写调用」之前各一次（R455）', async () => {
  // 事实：`prefab-create.cs` 只调 `SaveAsPrefabAsset`，**不建目录**；父目录不存在 → `PREFAB_SAVE_FAILED`，
  // 而旧 hint 只说「确认目录在项目内且可写」→ 目录确实在项目内也可写，用户无路可走。
  // 照 `lib/importart.js` 的既有做法：写调用之前把父目录建出来（可注入的 `_mkdirp` 测试缝）。
  const spy = [];
  const dirs = [];
  let callsAtMkdir = null;
  const call = sequenceCall([nodeResult(SRC_NODE), WRITE_PREFAB(), READ_PREFAB()], spy);
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab', _call: call,
    _mkdirp: (p) => { dirs.push(p); callsAtMkdir = spy.length; },
    _stat: () => ({ size: 2437, mtimeMs: 1700000000000 }),
  });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(exitCodeFor(e), 0);
  assert.deepStrictEqual(dirs, [path.join('P', 'Assets', 'Prefabs')], '必须且只建一次 `--to` 的父目录');
  assert.strictEqual(callsAtMkdir, 1, 'mkdirp 发生在「读源节点」之后（源不存在时不建目录）、「写调用」之前');
  assert.strictEqual(spy.length, 3, '读源节点 + 写 + 读回（mkdirp 不是 uloop 调用）');
});

test('prefabCreate：建父目录失败 → WRITE_FAILED（运行时 1，带 intent，绝不发生写调用）（R455）', async () => {
  const spy = [];
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab',
    _call: sequenceCall([nodeResult(SRC_NODE)], spy),
    _mkdirp: () => { const err = new Error('EACCES: permission denied'); err.code = 'EACCES'; throw err; },
  });
  assert.strictEqual(e.code, 'WRITE_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(e.phase, 'write');
  assert.strictEqual(spy.length, 1, '建目录失败 → 绝不发生写调用（更不读回）');
  assert.deepStrictEqual(e.intent.prefab.name, 'Brick', 'WRITE_FAILED 也要带 intent（与 asset import 同口径）');
  assert.ok(e.hint.join(' ').includes('可写'), e.hint.join(' | '));
});

test('prefabCreate：`_mkdirp` 生产默认分支真的建出目录 —— `os.tmpdir()` 临时项目根实测（R473）', async () => {
  // 文件头的 `prefabCreate` 包装默认注入 `_mkdirp: () => {}`（测试缝），**生产默认**（`fs.mkdirSync`）零覆盖。
  // 这里直接调原始 `prefabCreateRaw`（**不传 `_mkdirp`**）+ 临时项目根，钉住默认分支真的落盘建目录。
  // ⚠️ 临时根在 `os.tmpdir()` 下，绝不在仓库里造目录；跑完清理。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-unity-prefab-mkdirp-'));
  try {
    const spy = [];
    const e = await prefabCreateRaw({
      projectPath: root, fromNode: 'Brick_0_0', to: 'Assets/Deep/Sub/a.prefab',
      _call: sequenceCall([nodeResult(SRC_NODE), WRITE_PREFAB(),
        READ_PREFAB({ asset: 'Assets/Deep/Sub/a.prefab', name: 'a' })], spy),
      _stat: () => ({ size: 2439, mtimeMs: 1700000000002 }),
    });
    const dir = path.join(root, 'Assets', 'Deep', 'Sub');
    assert.ok(fs.existsSync(dir), '生产默认 _mkdirp 必须真的建出 ' + dir);
    assert.ok(fs.statSync(dir).isDirectory(), '必须是个目录');
    assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
    assert.strictEqual(exitCodeFor(e), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('prefabCreate：源节点是 Prefab 实例 → SOURCE_IS_PREFAB_INSTANCE（运行时 1，拒绝产出 Variant）', async () => {
  const spy = [];
  const call = sequenceCall([
    nodeResult(SRC_NODE),                                                        // 读源节点（它自己是实例）
    { Success: true, Result: JSON.stringify({ __error: 'SOURCE_IS_PREFAB_INSTANCE' }) },
  ], spy);
  const e = await prefabCreate({ projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab', _call: call });
  assert.strictEqual(e.code, 'SOURCE_IS_PREFAB_INSTANCE');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.hint.join(' ').includes('Prefab 实例'), e.hint.join(' | '));
  // R446：hint 必须给**可执行**路径（CLI 没有「断开连接」这条命令）——
  //   首轮写的「先在场景里 Instantiate 后断开连接再存」是不可执行的指引。
  assert.ok(!e.hint.join(' ').includes('断开连接'), 'R446：不许再给「断开连接」这种 CLI 里不存在的步骤');
  assert.ok(e.hint.join(' ').includes('Unpack'), e.hint.join(' | '));
  assert.ok(e.hint.join(' ').includes('unity node create'), e.hint.join(' | '));
  assert.strictEqual(spy.length, 2, '读源节点 + 写调用（由 .cs 判定并拒绝），绝不发生读回');
});

test('prefabCreate：源是子节点 → intent 用 node inspect 的 **local** 值，不自己换算世界坐标（R430②）', async () => {
  const spy = [];
  const child = { ...SRC_NODE, name: 'Child', path: 'Parent/Child', position: { x: 1, y: 1, z: 0 } };
  const call = sequenceCall([
    nodeResult(child),
    WRITE_PREFAB(),
    READ_PREFAB({ asset: 'Assets/Prefabs/Child.prefab', name: 'Child', position: { x: 1, y: 1, z: 0 } }),
  ], spy);
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'Parent/Child', to: 'Assets/Prefabs/Child.prefab', _call: call,
    _stat: () => ({ size: 2000, mtimeMs: 1 }),
  });
  assert.deepStrictEqual(e.intent.prefab.position, { x: 1, y: 1, z: 0 });
  assert.deepStrictEqual(e.intent.prefab.scale, { x: 2, y: 2, z: 1 });
  assert.deepStrictEqual(e.intent.prefab.name, 'Child', '子节点当源时，根名同样是 --to 的文件名（R432）');
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
});

test('prefabCreate：写调用抛出 → WRITE_CALL_FAILED（不冒成退出码 3）', async () => {
  const call = (() => {
    let n = 0;
    return async () => {
      n += 1;
      if (n === 1) return { code: 0, stdout: '', stderr: '', json: nodeResult(SRC_NODE), truncated: false, timedOut: false, drained: false };
      throw new Error('spawn failed');
    };
  })();
  const e = await prefabCreate({ projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab', _call: call });
  assert.strictEqual(e.code, 'WRITE_CALL_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(e.phase, 'write');
  assert.deepStrictEqual(e.intent.prefab.name, 'Brick');
});

test('prefabCreate：源节点名 ≠ `--to` 文件名 → verified:true 且 intent.prefab.name = 文件名（R432）', async () => {
  // 真机事实：`SaveAsPrefabAsset` 把 Prefab **根节点名改成 `--to` 的文件名**（源节点名不变）——
  // 证据见 task-6-report.md §⑥② / 修复轮 real-machine 的 task6fix-name-different.json。
  // 所以 intent 必须拿「Unity 会写进去的那个名字」（文件名）去断言，而不是源节点名。
  const spy = [];
  const call = sequenceCall([
    nodeResult({ ...SRC_NODE, name: 'PfSource', path: 'PfSource' }),               // 1) 源节点名 PfSource
    WRITE_PREFAB(),                                                                // 2) 写
    READ_PREFAB({ asset: 'Assets/Prefabs/Different.prefab', name: 'Different' }),  // 3) 读回
  ], spy);
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'PfSource', to: 'Assets/Prefabs/Different.prefab', _call: call,
    _stat: () => ({ size: 2437, mtimeMs: 1700000000000 }),
  });
  assert.deepStrictEqual(e.intent.prefab.name, 'Different', 'intent 的名字必须来自 --to 文件名');
  assert.strictEqual(e.actual.prefab.name, 'Different', '读回的根名 = 文件名');
  // 源节点与资产的绑定改由这三项钉住（源节点名不参与断言）
  assert.deepStrictEqual(e.intent.prefab.position, { x: 1, y: 2, z: 0 });
  assert.deepStrictEqual(e.intent.prefab.scale, { x: 2, y: 2, z: 1 });
  assert.strictEqual(e.intent.prefab.spriteAssetPath, 'Assets/Art/hero.png');
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(exitCodeFor(e), 0);
});

test('prefabCreate：读回资产失败（PREFAB_NOT_FOUND）→ READBACK_FAILED（绝不 ok:true）', async () => {
  const spy = [];
  const call = sequenceCall([
    nodeResult(SRC_NODE),
    WRITE_PREFAB(),
    { Success: true, Result: JSON.stringify({ __error: 'PREFAB_NOT_FOUND' }) },
  ], spy);
  const e = await prefabCreate({ projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab', _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('prefabCreate：磁盘防线负向用例 —— _stat 抛 EACCES / 返回 size 0 → verified:false + file.bytes 分歧（R441）', async () => {
  const stats = [
    () => { const err = new Error('EACCES: permission denied'); err.code = 'EACCES'; throw err; },
    () => ({ size: 0, mtimeMs: 1 }),
  ];
  for (const stat of stats) {
    const e = await prefabCreate({
      projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab',
      _call: sequenceCall([nodeResult(SRC_NODE), WRITE_PREFAB(), READ_PREFAB()]),
      _stat: stat,
    });
    assert.strictEqual(e.verified, false, '盘上文件读不到/为空绝不 verified:true');
    assert.strictEqual(exitCodeFor(e), 1);
    const keys = e.mismatches.map((m) => m.key);
    assert.ok(keys.includes('file.bytes'), keys.join(','));
    // R445：分歧键是 file.bytes 时，hint 必须说明「Unity 侧内容对、是盘上没读到」并指向 --project-path
    assert.ok(e.hint.join(' ').includes('project-path'), e.hint.join(' | '));
  }
});

test('prefabCreate：读回缺 __read 对象 → READBACK_FAILED（退出码 1，绝不 ok:true）（R441）', async () => {
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab',
    _call: sequenceCall([
      nodeResult(SRC_NODE),
      WRITE_PREFAB(),
      { Success: true, Result: JSON.stringify({ __written: true }) },
    ]),
    _stat: () => ({ size: 2437, mtimeMs: 1 }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('prefabCreate：写调用自报 guid ≠ 读回资产 guid → verified:false + guid 分歧（R444）', async () => {
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab',
    _call: sequenceCall([
      nodeResult(SRC_NODE),
      WRITE_PREFAB({ guid: 'guid-write' }),
      READ_PREFAB({ guid: 'guid-read' }),
    ]),
    _stat: () => ({ size: 2437, mtimeMs: 1 }),
  });
  assert.strictEqual(e.verified, false);
  const g = e.mismatches.find((m) => m.key === 'guid');
  assert.ok(g, JSON.stringify(e.mismatches));
  assert.strictEqual(g.intent, 'guid-read');
  assert.strictEqual(g.actual, 'guid-write');
});

test('prefabInstantiate：缺 --asset → MISSING_ASSET；非 .prefab / 非 Assets → BAD_ASSET_PATH（用法错 2）', async () => {
  const spy = [];
  const a = await prefabInstantiate({ projectPath: 'P', asset: undefined, _call: sequenceCall([], spy) });
  assert.strictEqual(a.code, 'MISSING_ASSET');
  assert.strictEqual(exitCodeFor(a), 2);
  for (const asset of ['Assets/Prefabs/a.png', 'Prefabs/a.prefab', '//Assets/a.prefab']) {
    const e = await prefabInstantiate({ projectPath: 'P', asset, _call: sequenceCall([], spy) });
    assert.strictEqual(e.code, 'BAD_ASSET_PATH', asset);
    assert.strictEqual(exitCodeFor(e), 2);
  }
  assert.strictEqual(spy.length, 0);
});

test('prefabInstantiate：--parent 非法（裸写 / 空串 / 只有斜杠）→ BAD_PARENT；--name 空串 → MISSING_NAME（用法错 2，零调用）', async () => {
  const spy = [];
  for (const parent of [true, '', '/', '//']) {
    const e = await prefabInstantiate({ projectPath: 'P', asset: 'Assets/Prefabs/a.prefab', parent, _call: sequenceCall([], spy) });
    assert.strictEqual(e.code, 'BAD_PARENT', String(parent));
    assert.strictEqual(exitCodeFor(e), 2);
  }
  const n = await prefabInstantiate({ projectPath: 'P', asset: 'Assets/Prefabs/a.prefab', name: '', _call: sequenceCall([], spy) });
  assert.strictEqual(n.code, 'MISSING_NAME');
  assert.strictEqual(exitCodeFor(n), 2);
  assert.strictEqual(spy.length, 0);
});

test('prefabInstantiate：--parent 尾随 `/` 被归一，其余**逐字保留**（R442 = R94 逐字一致）', async () => {
  const payloadFor = async (parent) => {
    const spy = [];
    const call = sequenceCall([
      ASSET_READ(),                                        // 1) 资产预读（R437）
      INST_WRITE({ instancePath: 'Panel/Brick', name: 'Brick' }),  // 2) 写
      nodeResult({ ...SRC_NODE, name: 'Brick', path: 'Panel/Brick' }), // 3) 读回
    ], spy);
    const e = await prefabInstantiate({ projectPath: 'P', asset: 'Assets/Prefabs/Brick.prefab', parent, _call: call });
    assert.strictEqual(e.verified, true, `${JSON.stringify(parent)}: ${JSON.stringify(e.mismatches)}`);
    return JSON.parse(JSON.parse(spy[1].args[3]).p);
  };
  const plain = await payloadFor('Panel');
  assert.deepStrictEqual(plain, { asset: 'Assets/Prefabs/Brick.prefab', parent: 'Panel' });
  for (const parent of ['Panel/', 'Panel//']) {
    assert.deepStrictEqual(await payloadFor(parent), plain, `${JSON.stringify(parent)} 必须与 'Panel' 等价`);
  }
  // R442：**不**多剥尾随空白（R434 那版会剥）—— R94 只做 replace(/\/+$/,'')
  for (const parent of ['Panel/ ', 'Panel/\t']) {
    assert.strictEqual((await payloadFor(parent)).parent, parent, 'R442：尾随空白逐字保留');
  }
});

test('prefabInstantiate：--parent 归一与 nodeCreate（R94）**逐字一致**（R442）', async () => {
  const parents = ['Panel', 'Panel/', 'Panel//', 'Panel/ ', 'Panel/\t', '/', '//', '  /  ', 'A/B/'];
  for (const parent of parents) {
    const spyP = [];
    const p = await prefabInstantiate({
      projectPath: 'P', asset: 'Assets/Prefabs/Brick.prefab', parent,
      _call: sequenceCall([ASSET_READ(), INST_WRITE(), nodeResult({ ...SRC_NODE, name: 'Brick', path: 'Brick' })], spyP),
    });
    const spyN = [];
    const n = await nodeCreate({
      projectPath: 'P', name: 'Brick', parent, components: [], _call: sequenceCall([nodeResult({ ...SRC_NODE, name: 'Brick', path: 'Brick' })], spyN),
    });
    if (p.code === 'BAD_PARENT' || n.code === 'BAD_PARENT') {
      assert.strictEqual(p.code, n.code, `${JSON.stringify(parent)}：BAD_PARENT 口径必须一致`);
      continue;
    }
    const pParent = JSON.parse(JSON.parse(spyP[1].args[3]).p).parent;
    const nParent = JSON.parse(JSON.parse(spyN[0].args[3]).p).parent;
    assert.strictEqual(pParent, nParent, `${JSON.stringify(parent)} 的归一结果必须与 node create 逐字一致`);
  }
});

test('prefabInstantiate：happy path —— 先读资产、再用实例路径读回；--name 时 intent = {name,path} → verified:true（R437）', async () => {
  const spy = [];
  const call = sequenceCall([
    ASSET_READ({ name: 'Brick_0_0' }),                                                  // 1) 资产预读
    INST_WRITE({ instancePath: 'Panel/Brick_0_0', name: 'Brick_0_0' }),                 // 2) 写
    nodeResult({ ...SRC_NODE, path: 'Panel/Brick_0_0', name: 'Brick_0_0' }),            // 3) 读回实例
  ], spy);
  const e = await prefabInstantiate({
    projectPath: 'P', asset: 'Assets/Prefabs/Brick.prefab', parent: 'Panel', name: 'Brick_0_0', _call: call,
  });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  // R437：--name 给了 → intent = {name, path}，`path` 是 **JS 侧算出的期望路径**（不是 .cs 自报的 instancePath）
  assert.deepStrictEqual(e.intent, { name: 'Brick_0_0', path: 'Panel/Brick_0_0' });
  assert.strictEqual(e.actual.path, 'Panel/Brick_0_0');
  assert.strictEqual(e.actual.sprite.assetPath, 'Assets/Art/hero.png');
  // 调用顺序：① 读资产（prefab-create read）② 实例化 ③ node-inspect 读回
  assert.strictEqual(spy.length, 3);
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[0].args[3]).p), { mode: 'read', path: 'Assets/Prefabs/Brick.prefab' });
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[1].args[3]).p), { asset: 'Assets/Prefabs/Brick.prefab', parent: 'Panel', name: 'Brick_0_0' });
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[2].args[3]).p), { path: 'Panel/Brick_0_0' });
});

test('prefabInstantiate：不给 --name → intent 断言 **资产读回** 的 sprite.assetPath（R437②）+ --asset 归一（R439）', async () => {
  const spy = [];
  const call = sequenceCall([
    ASSET_READ(),
    INST_WRITE({ instancePath: 'Panel/Brick', name: 'Brick' }),
    nodeResult({ ...SRC_NODE, name: 'Brick', path: 'Panel/Brick' }),
  ], spy);
  const e = await prefabInstantiate({ projectPath: 'P', asset: 'Assets//Prefabs/./Brick.prefab', parent: 'Panel', _call: call });
  // 不给 --name → payload 里仍然**不带** name（让 Unity 用默认名）；--asset 归一到规范路径（读资产与写载荷同源）
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[1].args[3]).p), { asset: 'Assets/Prefabs/Brick.prefab', parent: 'Panel' });
  assert.deepStrictEqual(JSON.parse(JSON.parse(spy[0].args[3]).p), { mode: 'read', path: 'Assets/Prefabs/Brick.prefab' });
  assert.deepStrictEqual(e.intent, { sprite: { assetPath: 'Assets/Art/hero.png' } }, 'intent 的 sprite 来自资产读回值');
  assert.strictEqual(e.actual.name, 'Brick');
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(exitCodeFor(e), 0);
});

test('prefabInstantiate：资产无 sprite 且不给 --name → intent.name = **资产读回的真实根名**（R437③/R438）', async () => {
  // R438：根名以**资产读回**为准 —— 外部 Prefab（不是 `unity prefab create` 存的）根名可以 ≠ 文件名。
  // 这里资产路径 basename = `Enemy`，但资产里的根名 = `Enemy Variant` → 用 basename 猜会假红。
  for (const spriteAssetPath of [null, '']) {
    const spy = [];
    const call = sequenceCall([
      ASSET_READ({ name: 'Enemy Variant', spriteAssetPath }),
      INST_WRITE({ instancePath: 'Enemy Variant', name: 'Enemy Variant' }),
      nodeResult({ ...SRC_NODE, name: 'Enemy Variant', path: 'Enemy Variant' }),
    ], spy);
    const e = await prefabInstantiate({ projectPath: 'P', asset: 'Assets/Prefabs/Enemy.prefab', _call: call });
    assert.deepStrictEqual(e.intent, { name: 'Enemy Variant' }, '根名取资产读回值，不是文件 basename');
    assert.notStrictEqual(e.intent.name, 'Enemy', 'basename 猜出来的名字会假红 —— 这条断言证明它不是 basename');
    assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
    assert.strictEqual(exitCodeFor(e), 0);
  }
});

test('prefabInstantiate：读回对象内容不符（sprite:null / position 不同）→ verified:false（R437①）', async () => {
  // ① sprite 缺失：无 --name → intent 断言 sprite.assetPath → 读回 sprite:null 必须落分歧
  const e1 = await prefabInstantiate({
    projectPath: 'P', asset: 'Assets/Prefabs/Brick.prefab',
    _call: sequenceCall([
      ASSET_READ(),
      INST_WRITE(),
      nodeResult({ ...SRC_NODE, name: 'Brick', path: 'Brick', sprite: null }),
    ]),
  });
  assert.strictEqual(e1.verified, false, '读回 sprite:null 不能 verified:true');
  assert.strictEqual(exitCodeFor(e1), 1);
  assert.ok(e1.mismatches.map((m) => m.key).includes('sprite'), JSON.stringify(e1.mismatches));
  // ② position 不同：资产根的局部值来自**资产读回**（独立读数）→ extraCheck 抓住
  const e2 = await prefabInstantiate({
    projectPath: 'P', asset: 'Assets/Prefabs/Brick.prefab', name: 'Brick',
    _call: sequenceCall([
      ASSET_READ(),
      INST_WRITE(),
      nodeResult({ ...SRC_NODE, name: 'Brick', path: 'Brick', position: { x: 99, y: 99, z: 0 } }),
    ]),
  });
  assert.strictEqual(e2.verified, false, '读回 position(99,99) 不能 verified:true');
  const keys = e2.mismatches.map((m) => m.key);
  assert.ok(keys.includes('position.x'), keys.join(','));
  assert.ok(keys.includes('position.y'), keys.join(','));
});

test('prefabInstantiate：--name 给了但实例被改名/改路径（mock 成 Unity 的 " (1)" 形态）→ name + path 分歧（R437）', async () => {
  const spy = [];
  const call = sequenceCall([
    ASSET_READ(),
    INST_WRITE({ instancePath: 'Panel/Brick (1)', name: 'Brick (1)' }),
    nodeResult({ ...SRC_NODE, path: 'Panel/Brick (1)', name: 'Brick (1)' }),
  ], spy);
  const e = await prefabInstantiate({
    projectPath: 'P', asset: 'Assets/Prefabs/Brick.prefab', parent: 'Panel', name: 'Brick', _call: call,
  });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeFor(e), 1);
  const keys = e.mismatches.map((m) => m.key);
  assert.ok(keys.includes('name'), keys.join(','));
  assert.ok(keys.includes('path'), keys.join(','));
});

test('prefabInstantiate：父节点不存在 → PARENT_NOT_FOUND（运行时 1）+ 可用路径 hint', async () => {
  const spy = [];
  const call = sequenceCall([
    ASSET_READ(),
    { Success: true, Result: JSON.stringify({ __error: 'PARENT_NOT_FOUND', parent: 'Nope' }) },
  ], spy);
  const e = await prefabInstantiate({ projectPath: 'P', asset: 'Assets/Prefabs/a.prefab', parent: 'Nope', _call: call });
  assert.strictEqual(e.code, 'PARENT_NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.hint.join(' ').includes('scene tree'), e.hint.join(' | '));
  assert.strictEqual(spy.length, 2, '资产预读 + 写调用；父级失败时没有读回');
});

test('prefabInstantiate：Prefab 资产不存在（**资产预读**阶段就发现）→ PREFAB_NOT_FOUND（运行时 1，只发生一次调用）', async () => {
  const spy = [];
  const call = sequenceCall([{ Success: true, Result: JSON.stringify({ __error: 'PREFAB_NOT_FOUND' }) }], spy);
  const e = await prefabInstantiate({ projectPath: 'P', asset: 'Assets/Prefabs/a.prefab', _call: call });
  assert.strictEqual(e.code, 'PREFAB_NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.hint.join(' ').includes('prefab create'), e.hint.join(' | '));
  assert.strictEqual(spy.length, 1, '资产不存在 → 不实例化、不读回');
});

test('prefabInstantiate：资产预读的 PREFAB_NOT_FOUND 与写调用**同码同 hint**（R437：不许出现「prefab-create 返回错误」）', async () => {
  const a = await prefabInstantiate({
    projectPath: 'P', asset: 'Assets/Prefabs/Nope.prefab',
    _call: sequenceCall([{ Success: true, Result: JSON.stringify({ __error: 'PREFAB_NOT_FOUND' }) }]),
  });
  const b = await prefabInstantiate({
    projectPath: 'P', asset: 'Assets/Prefabs/Nope.prefab',
    _call: sequenceCall([
      ASSET_READ(),
      { Success: true, Result: JSON.stringify({ __error: 'PREFAB_NOT_FOUND' }) },
    ]),
  });
  assert.strictEqual(a.code, 'PREFAB_NOT_FOUND');
  assert.strictEqual(b.code, 'PREFAB_NOT_FOUND');
  assert.deepStrictEqual(a.hint, b.hint, '预读与写调用两侧的 hint 必须逐字相同');
  assert.strictEqual(a.message, b.message, '预读与写调用两侧的 message 必须逐字相同');
  assert.ok(!a.message.includes('prefab-create'), a.message);
  assert.ok(!a.hint.join(' ').includes('prefab-create'), a.hint.join(' | '));
});

test('prefabInstantiate：资产预读缺 __read 对象 → BAD_SCRIPT_RESULT（协议不符，绝不 verified）', async () => {
  const e = await prefabInstantiate({
    projectPath: 'P', asset: 'Assets/Prefabs/a.prefab',
    _call: sequenceCall([{ Success: true, Result: JSON.stringify({ __written: true }) }]),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BAD_SCRIPT_RESULT');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('prefabInstantiate：.cs 没返回 instancePath → INSTANTIATE_FAILED（协议不符，绝不 ok:true）', async () => {
  const spy = [];
  const call = sequenceCall([
    ASSET_READ(),
    { Success: true, Result: JSON.stringify({ __written: true, name: 'x' }) },
  ], spy);
  const e = await prefabInstantiate({ projectPath: 'P', asset: 'Assets/Prefabs/a.prefab', _call: call });
  assert.strictEqual(e.code, 'INSTANTIATE_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(spy.length, 2, '没有实例路径就无法读回 —— 不允许再瞎猜一个路径去 inspect');
});

test('prefabInstantiate：实例读不到（.cs 说建了、inspect 找不到）→ READBACK_FAILED（绝不 ok:true）', async () => {
  const spy = [];
  const call = sequenceCall([
    ASSET_READ(),
    INST_WRITE({ instancePath: 'Brick_0_0', name: 'Brick_0_0' }),
    nodeResult({ __error: 'NOT_FOUND' }),
  ], spy);
  const e = await prefabInstantiate({ projectPath: 'P', asset: 'Assets/Prefabs/a.prefab', _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('prefabInstantiate 的 --asset 路径校验（生产路径，取代 isPrefabPath 直测）：只认 Assets/ 下、.prefab 结尾、不含 ..；`\\` 与重复 `/`/`./` 归一（R439）', async () => {
  // 非法：BAD_ASSET_PATH（用法错 2）+ 零调用
  const spy = [];
  for (const asset of ['Assets/a.txt', 'Prefabs/a.prefab', '//Assets/a.prefab', 'Assets/../a.prefab', 'Assets/./../a.prefab']) {
    const e = await prefabInstantiate({ projectPath: 'P', asset, _call: sequenceCall([], spy) });
    assert.strictEqual(e.code, 'BAD_ASSET_PATH', asset);
    assert.strictEqual(exitCodeFor(e), 2);
  }
  assert.strictEqual(spy.length, 0);
  // `undefined` 是「没给」不是「路径非法」→ MISSING_ASSET（R274/R409 同口径）
  const miss = await prefabInstantiate({ projectPath: 'P', asset: undefined, _call: sequenceCall([], spy) });
  assert.strictEqual(miss.code, 'MISSING_ASSET');
  assert.strictEqual(exitCodeFor(miss), 2);
  // 合法：路径归一后进**资产预读**载荷（`\\` → `/`；重复 `/` 与 `./` 折叠）
  for (const [asset, expected] of [
    ['Assets\\Prefabs\\a.prefab', 'Assets/Prefabs/a.prefab'],
    ['Assets//Prefabs/./a.prefab', 'Assets/Prefabs/a.prefab'],
  ]) {
    const s = [];
    const e = await prefabInstantiate({
      projectPath: 'P', asset,
      _call: sequenceCall([{ Success: true, Result: JSON.stringify({ __error: 'PREFAB_NOT_FOUND' }) }], s),
    });
    assert.strictEqual(e.code, 'PREFAB_NOT_FOUND', asset);
    assert.deepStrictEqual(JSON.parse(JSON.parse(s[0].args[3]).p), { mode: 'read', path: expected }, asset);
  }
});

test('nodeProjection：五个字段（含 components），sprite 缺失 → spriteAssetPath null（R448 扩展）', () => {
  assert.deepStrictEqual(nodeProjection(SRC_NODE), {
    name: 'Brick_0_0', position: { x: 1, y: 2, z: 0 }, scale: { x: 2, y: 2, z: 1 },
    spriteAssetPath: 'Assets/Art/hero.png', components: ['Transform', 'SpriteRenderer'],
  });
  assert.deepStrictEqual(nodeProjection({ name: 'n', position: null, scale: null, sprite: null }).spriteAssetPath, null);
  assert.deepStrictEqual(nodeProjection({ name: 'n', position: null, scale: null, sprite: { assetPath: null } }).spriteAssetPath, null);
  // ⚠️ 源节点**没有** `components` 字段 → 投影写 `null`（不是 `[]`）：
  //   写 `[]` 会在 `compareSubset` 的数组语义下与「Prefab 里一个组件都没有」混淆。
  assert.strictEqual(nodeProjection({ name: 'n', position: null, scale: null, sprite: null }).components, null);
  assert.strictEqual(nodeProjection({}).components, null, '缺字段必须是 null，不是 []');
  assert.deepStrictEqual(nodeProjection({ components: [] }).components, [], '空数组是**源节点自报**的空数组，原样带过去');
  // 不做归一/排序（归一化会抹掉真实分歧）
  assert.deepStrictEqual(nodeProjection({ components: ['SpriteRenderer', 'Transform'] }).components, ['SpriteRenderer', 'Transform']);
});

test('prefab-create.cs 静态契约（剥注释后）：read 模式含 components 读取（R448）', () => {
  // 照本文件末尾「两个 .cs 的静态契约」的 `stripComments` 范式（先剥 `/* */` 再剥 `//`）：
  //   「词在注释里出现过」不算契约。
  const src = fs.readFileSync(path.join(__dirname, '..', 'unity-scripts', 'prefab-create.cs'), 'utf8');
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map((l) => l.replace(/\/\/[^\r\n]*/, '')).join('\n');
  assert.match(stripped, /o\["components"\]\s*=/, 'read 模式必须把 components 写进读回对象');
  assert.match(stripped, /GetComponents<Component>\(\)/, '口径必须与 node-inspect.cs 同形');
  // 过滤 null 的形态（显式 foreach —— 本文件没有 `using System.Linq;`）
  assert.match(stripped, /if\s*\(c\s*!=\s*null\)\s*comps\.Add\(c\.GetType\(\)\.Name\)/);
  assert.doesNotMatch(stripped, /\.Where\(/, 'R367：没有 using System.Linq，Where 会 CS1061 编译失败');
  assert.doesNotMatch(stripped, /\.Select\(/, 'R367：没有 using System.Linq，Select 会 CS1061 编译失败');
});

test('prefabRootName：Prefab 根名 = 资产路径 basename（去掉结尾的 .prefab），不是源节点名（R432）', () => {
  assert.strictEqual(prefabRootName('Assets/Prefabs/Brick.prefab'), 'Brick');
  assert.strictEqual(prefabRootName('Assets/M4Probe/PfSource.prefab'), 'PfSource');
  // 只剥结尾那一个 `.prefab`：名字里本来就有点的不能被截断
  assert.strictEqual(prefabRootName('Assets/Prefabs/Brick.v2.prefab'), 'Brick.v2');
  assert.strictEqual(prefabRootName('Assets/Prefabs/a.b.c.prefab'), 'a.b.c');
});

test('两个 .cs 的静态契约：剥注释 + 引号归一后逐条断言（R440）', () => {
  const dir = path.join(__dirname, '..', 'unity-scripts');
  // 范式取自 test/sprite-assign.test.js（R406④）：先**剥注释**再断言 ——
  // 「词在注释里出现过」不算契约（首轮就是这么漏的）。
  // M7：先剥 `/* */`（块注释）再剥 `//` —— 只剥行注释时，把契约整段搬进块注释即可满足断言。
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map((l) => l.replace(/\/\/[^\r\n]*/, '')).join('\n');
  const readCs = (f) => stripComments(fs.readFileSync(path.join(dir, f), 'utf8')).replace(/\\"/g, '"');
  const createCs = readCs('prefab-create.cs');
  const instCs = readCs('prefab-instantiate.cs');

  // ① 每个错误码都必须有一个**真实的发射点**（`x["__error"] = "CODE"` 或 `{"__error":"CODE"}`）
  const errorPoint = (code) => new RegExp(`\\["__error"\\]\\s*=\\s*"${code}"|\\{"__error":"${code}"`);
  for (const code of ['BAD_PAYLOAD', 'NOT_FOUND', 'SOURCE_IS_PREFAB_INSTANCE', 'PREFAB_SAVE_FAILED', 'PREFAB_NOT_FOUND']) {
    assert.match(createCs, errorPoint(code), `prefab-create.cs 必须有把 __error 绑到 ${code} 的返回点（剥注释后）`);
  }
  for (const code of ['BAD_PAYLOAD', 'PREFAB_NOT_FOUND', 'PARENT_NOT_FOUND', 'INSTANTIATE_FAILED']) {
    assert.match(instCs, errorPoint(code), `prefab-instantiate.cs 必须有把 __error 绑到 ${code} 的返回点（剥注释后）`);
  }
  // ② 成功哨兵 + 读回哨兵 + 实例路径字段（R437 的资产预读依赖 `__read`）
  assert.match(createCs, /"__written":true|\["__written"\]\s*=\s*true/);
  assert.match(instCs, /"__written":true|\["__written"\]\s*=\s*true/);
  assert.match(createCs, /root\["__read"\]\s*=/);
  assert.match(instCs, /o\["instancePath"\]\s*=/);
  // ③ payload 键集合**相等**（多一个/少一个都要红）—— 载荷面不许偷偷扩/缩
  const payloadKeys = (code) => [...new Set([...code.matchAll(/req\["([A-Za-z0-9_]+)"\]/g)].map((m) => m[1]))].sort();
  assert.deepStrictEqual(payloadKeys(createCs), ['fromNode', 'mode', 'path', 'to']);
  assert.deepStrictEqual(payloadKeys(instCs), ['asset', 'name', 'parent']);
  // ④ `SetParent` 的 worldPositionStays 必须是 false（局部坐标不被父级污染）
  assert.match(instCs, /SetParent\(parent\.transform,\s*false\)/);
  // ⑤ 全文件禁 `??`（UnityEngine.Object 伪 null 的老坑）
  assert.doesNotMatch(createCs, /\?\?/);
  assert.doesNotMatch(instCs, /\?\?/);
  // 既有事实断言（R430 / 走 PrefabUtility）
  assert.match(createCs, /PrefabUtility\.SaveAsPrefabAsset\(/);
  assert.match(createCs, /AssetDatabase\.LoadAssetAtPath<GameObject>/);
  assert.match(createCs, /PrefabUtility\.IsPartOfPrefabInstance\(/);
  assert.match(instCs, /PrefabUtility\.InstantiatePrefab\(/);
  // R441：不留半成品（父级失败必须销毁刚建出的实例）
  assert.match(instCs, /DestroyImmediate\(inst\)/);
});

// ============================================================================
// 批次 C-B（③ `unity prefab apply` / `revert`）：写后读回 = 实例投影 vs 资产投影
// 读回面只含根 `scale`/`spriteAssetPath`/`components`（根 `localPosition` 是 Unity
// 对 Apply/RevertPrefabInstance 的豁免项 —— PITFALLS U39；`name` 资产侧 = 文件名）。
// ============================================================================

test('prefabApply：实例投影（排除根 position/name）与资产投影一致 → verified:true（#7 信封 actual/intent 同形）', async () => {
  const call = sequenceCall([
    APPLY_WRITE(),
    INST_READ(),
    READ_PREFAB({ name: 'CaP', position: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: null, components: ['Transform'] }),
  ]);
  const e = await prefabApply({ projectPath: 'P', path: 'CaI', _call: call, _stat: () => ({ size: 910, mtimeMs: 1 }) });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(exitCodeFor(e), 0);
  // intent = 实例投影（写回源）
  assert.deepStrictEqual(e.intent, { scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: null, components: ['Transform'] });
  // #7：actual = 资产投影，与 intent **同形**（没有 {instance,asset,hasOverrides} 包裹）
  assert.deepStrictEqual(e.actual, { scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: null, components: ['Transform'] });
  assert.deepStrictEqual(e.mismatches, []);
  // #6：成功 hint 必须写明读回面边界（子节点/其它属性不在面内）
  assert.ok(e.hint.some((h) => h.includes('读回面')), e.hint.join(' | '));
});

test('prefabApply：缺 --path → MISSING_PATH（用法错 2，零调用）', async () => {
  const spy = [];
  const e = await prefabApply({ projectPath: 'P', path: undefined, _call: sequenceCall([], spy) });
  assert.strictEqual(e.code, 'MISSING_PATH');
  assert.strictEqual(exitCodeFor(e), 2);
  assert.strictEqual(spy.length, 0);
});

test('prefabApply：节点不是 Prefab 实例（或不是实例根）→ NOT_PREFAB_INSTANCE（运行时 1）', async () => {
  const call = sequenceCall([{ Success: true, Result: JSON.stringify({ __error: 'NOT_PREFAB_INSTANCE' }) }]);
  const e = await prefabApply({ projectPath: 'P', path: 'Plain', _call: call });
  assert.strictEqual(e.code, 'NOT_PREFAB_INSTANCE');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('prefabApply：.cs 没返回 assetPath → BAD_SCRIPT_RESULT（协议不符，绝不 verified）', async () => {
  const call = sequenceCall([{ Success: true, Result: JSON.stringify({ __written: true }) }]);
  const e = await prefabApply({ projectPath: 'P', path: 'CaI', _call: call });
  assert.strictEqual(e.code, 'BAD_SCRIPT_RESULT');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('prefabApply：资产读回失败 → 包装成 READBACK_FAILED + residue hint（#6：不直传 PREFAB_NOT_FOUND）', async () => {
  const call = sequenceCall([
    APPLY_WRITE(),
    INST_READ(),
    { Success: true, Result: JSON.stringify({ __error: 'PREFAB_NOT_FOUND' }) },
  ]);
  const e = await prefabApply({ projectPath: 'P', path: 'CaI', _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(e.phase, 'readback');
  assert.ok(e.hint.some((h) => h.includes('写可能已生效')), e.hint.join(' | '));
});

test('prefabApply：资产文件为空 → file.bytes 分歧（磁盘防线，绝不假绿）', async () => {
  const call = sequenceCall([
    APPLY_WRITE(),
    INST_READ(),
    READ_PREFAB({ scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: null, components: ['Transform'] }),
  ]);
  const e = await prefabApply({ projectPath: 'P', path: 'CaI', _call: call, _stat: () => ({ size: 0, mtimeMs: 1 }) });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.mismatches.some((m) => m.key === 'file.bytes'), JSON.stringify(e.mismatches));
  // #2：`file.bytes` 的 actual 必须是可诊断对象（不是 null）
  const fb = e.mismatches.find((m) => m.key === 'file.bytes');
  assert.ok(fb && fb.actual && fb.actual.bytes === 0, 'file.bytes 的 actual 必须是可诊断对象：' + JSON.stringify(fb));
  // #2：apply 失败 hint 要解释 file.bytes，且**不得**出现 apply 产不出的 `hasOverrides`
  assert.ok(e.hint.some((h) => h.includes('file.bytes')), e.hint.join(' | '));
  assert.ok(!e.hint.some((h) => h.includes('hasOverrides')), 'apply 失败 hint 不该出现 hasOverrides：' + e.hint.join(' | '));
});

test('prefabRevert：hasOverrides=true → verified:false（覆盖没清空）；hasOverrides 只进 mismatches (#3/#7)', async () => {
  const call = sequenceCall([
    APPLY_WRITE({ hasOverrides: true }),
    INST_READ({ scale: { x: 9, y: 9, z: 1 } }),
    READ_PREFAB({ scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: null, components: ['Transform'] }),
  ]);
  const e = await prefabRevert({ projectPath: 'P', path: 'CaI', _call: call });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.hint.some((h) => h.includes('override') || h.includes('覆盖')), e.hint.join(' | '));
  // #7：actual = 实例投影，intent = 资产投影（同形）；hasOverrides 不进 actual
  assert.deepStrictEqual(e.actual, { scale: { x: 9, y: 9, z: 1 }, spriteAssetPath: null, components: ['Transform'] });
  assert.deepStrictEqual(e.intent, { scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: null, components: ['Transform'] });
  assert.ok(e.mismatches.some((m) => m.key === 'hasOverrides'), JSON.stringify(e.mismatches));
});

test('prefabApply：实例 sprite 非空映射（sprite.assetPath → spriteAssetPath）→ verified:true', async () => {
  const call = sequenceCall([
    APPLY_WRITE(),
    INST_READ({ sprite: { present: true, assetPath: 'Assets/Art/hero.png' } }),
    READ_PREFAB({ scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: 'Assets/Art/hero.png', components: ['Transform'] }),
  ]);
  const e = await prefabApply({ projectPath: 'P', path: 'CaI', _call: call, _stat: () => ({ size: 910, mtimeMs: 1 }) });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.deepStrictEqual(e.intent, { scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: 'Assets/Art/hero.png', components: ['Transform'] });
});

test('prefabApply：资产侧 sprite 路径不同 → verified:false 且 mismatches 含 spriteAssetPath', async () => {
  const call = sequenceCall([
    APPLY_WRITE(),
    INST_READ({ sprite: { present: true, assetPath: 'Assets/Art/hero.png' } }),
    READ_PREFAB({ scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: 'Assets/Art/other.png', components: ['Transform'] }),
  ]);
  const e = await prefabApply({ projectPath: 'P', path: 'CaI', _call: call, _stat: () => ({ size: 910, mtimeMs: 1 }) });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.mismatches.some((m) => m.key === 'spriteAssetPath'), JSON.stringify(e.mismatches));
});

test('prefabApply：字段级分歧（scale 3,3 vs 1,1）→ verified:false 且 mismatches 命中 scale', async () => {
  const call = sequenceCall([
    APPLY_WRITE(),
    INST_READ({ scale: { x: 3, y: 3, z: 1 } }),
    READ_PREFAB({ scale: { x: 1, y: 1, z: 1 }, spriteAssetPath: null, components: ['Transform'] }),
  ]);
  const e = await prefabApply({ projectPath: 'P', path: 'CaI', _call: call, _stat: () => ({ size: 910, mtimeMs: 1 }) });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeFor(e), 1);
  // ⚠️ `compareSubset` 对嵌套对象递归 → 实际 key 是 `scale.x`/`scale.y`（不是字面 `scale`）；
  //    断言「分歧落在 scale 子树」，对两种粒度都成立、又不会被误放宽成全盘 `includes`。
  assert.ok(e.mismatches.some((m) => m.key === 'scale' || m.key.startsWith('scale.')), JSON.stringify(e.mismatches));
});

test('prefabRevert：hasOverrides=false 且两侧投影相等 → verified:true（exitCodeFor 0）', async () => {
  const call = sequenceCall([
    APPLY_WRITE({ hasOverrides: false }),
    INST_READ(),
    READ_PREFAB({ scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: null, components: ['Transform'] }),
  ]);
  const e = await prefabRevert({ projectPath: 'P', path: 'CaI', _call: call });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(exitCodeFor(e), 0);
});

test('prefabApply：.cs 未返回布尔 hasOverrides（键缺失/非布尔）→ BAD_SCRIPT_RESULT（绝不静默当 false）', async () => {
  for (const bad of [undefined, null, 'false', 0]) {
    const payload = { __written: true, assetPath: 'Assets/Prefabs/CaP.prefab' };
    if (bad !== undefined) payload.hasOverrides = bad;
    const call = sequenceCall([{ Success: true, Result: JSON.stringify(payload) }]);
    const e = await prefabApply({ projectPath: 'P', path: 'CaI', _call: call });
    assert.strictEqual(e.code, 'BAD_SCRIPT_RESULT', `hasOverrides=${JSON.stringify(bad)}`);
    assert.strictEqual(exitCodeFor(e), 1);
  }
});

test('prefabApply：实例读回 matchCount>1 → 成功 hint 提醒用 --sibling-index 精确归属', async () => {
  const call = sequenceCall([
    APPLY_WRITE(),
    INST_READ({ matchCount: 2 }),
    READ_PREFAB({ scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: null, components: ['Transform'] }),
  ]);
  const e = await prefabApply({ projectPath: 'P', path: 'CaI', _call: call, _stat: () => ({ size: 910, mtimeMs: 1 }) });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.ok(e.hint.some((h) => h.includes('--sibling-index')), e.hint.join(' | '));
});

test('prefabApply：实例读回失败 → READBACK_FAILED + residue hint（#5）', async () => {
  const call = sequenceCall([
    APPLY_WRITE(),
    nodeResult({ __error: 'NOT_FOUND' }),
  ]);
  const e = await prefabApply({ projectPath: 'P', path: 'CaI', _call: call });
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(e.phase, 'readback');
  assert.ok(e.hint.some((h) => h.includes('写可能已生效')), e.hint.join(' | '));
});

test('prefab-apply.cs 静态契约：码集合（真实发射点）+ 实例根守卫 + 全限定 InteractionMode + 无 static 局部函数（#4/#12/#15）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'unity-scripts', 'prefab-apply.cs'), 'utf8');
  // 照本文件既有 `.cs` 契约范式：先剥 `/* */` 再逐行剥 `//`，并把 `\"` 归一成 `"`（否则 `{"__error":…}` 配不上）
  const csCode = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map((l) => l.replace(/\/\/[^\r\n]*/, '')).join('\n')
    .replace(/\\"/g, '"');
  const errorPoint = (code) => new RegExp(`\\["__error"\\]\\s*=\\s*"${code}"|\\{"__error":"${code}"`);
  for (const code of ['BAD_PAYLOAD', 'NOT_FOUND', 'NOT_PREFAB_INSTANCE', 'APPLY_FAILED', 'REVERT_FAILED']) {
    assert.match(csCode, errorPoint(code), `prefab-apply.cs 必须有把 __error 绑到 ${code} 的返回点（剥注释后）`);
  }
  // 实例守卫必须在写调用之前
  assert.ok(csCode.indexOf('IsPartOfPrefabInstance') < csCode.indexOf('ApplyPrefabInstance'), '实例守卫必须在 apply 之前');
  // #4：`--path` 必须是**实例根**（子对象也会过 IsPartOfPrefabInstance → 永久假红）
  assert.match(csCode, /GetOutermostPrefabInstanceRoot\(go\)\s*!=\s*go/, '必须卡死「非实例根」');
  // revert 判据：回传 hasOverrides
  assert.match(csCode, /HasPrefabInstanceAnyOverrides/, '必须回传 hasOverrides 供 revert 判据');
  // ⭐ 发射点（不能只出现调用名）：hasOverrides 必须真的绑进返回对象
  assert.match(csCode, /o\["hasOverrides"\]\s*=/, '必须把 hasOverrides 绑到返回对象（发射点）');
  // #12：InteractionMode 必须全限定（静态测试测不出 CS0103，只能在这里钉住）
  assert.match(csCode, /UnityEditor\.InteractionMode\.AutomatedAction/, 'InteractionMode 必须全限定');
  assert.doesNotMatch(csCode, /(?<!UnityEditor\.)InteractionMode\./, '不得出现非限定 InteractionMode');
  // CS8421：局部函数不能加 static
  assert.ok(!/static\s+GameObject\s+FindByPath/.test(csCode), '局部函数不能加 static（CS8421）');
  // 载荷键集合与 lib 侧**逐字对齐**（多/少都要红）
  const payloadKeys = [...new Set([...csCode.matchAll(/req\["([A-Za-z0-9_]+)"\]/g)].map((m) => m[1]))].sort();
  assert.deepStrictEqual(payloadKeys, ['mode', 'path']);
  assert.match(csCode, /mode\s*!=\s*"apply"/);
  assert.match(csCode, /mode\s*!=\s*"revert"/);
});
