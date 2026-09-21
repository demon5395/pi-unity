# pi-unity backlog 批次 C-B 实现计划（③ `unity prefab apply` / `revert`）

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 关闭 `docs/HANDOFF.md` §7 backlog **③**：新增 `unity prefab apply`（把实例覆盖写回 Prefab **资产**）与 `unity prefab revert`（丢弃实例覆盖），两者都遵守「写后必读回 + `verified` 不许扩张」纪律。

**架构：** 侦察（`docs/m5-probes-raw/cb-REPORT.md`）钉死 Unity 语义：`PrefabUtility.ApplyPrefabInstance` / `RevertPrefabInstance` 都**只对根 `localPosition` 豁免**（apply 不把它写进资产、revert 也不把它还原），根 `scale` / 子节点变换 / sprite / components 都正常。因此读回面 = **实例投影 vs 资产投影**，**排除根 `position` 与 `name`**（`name` 资产侧=`--to` 文件名、实例侧任意），用 `HasPrefabInstanceAnyOverrides` 判 revert。新增 `.cs` = `unity-scripts/prefab-apply.cs`（`mode: apply|revert`）；`lib/prefab.js` 加 `prefabApply`/`prefabRevert`。

**技术栈：** Node.js ≥ 21（CommonJS，`node --test`，零依赖）+ Unity C# 载荷脚本（uloop `execute-dynamic-code`）。

**规格：** `docs/HANDOFF.md` §7 backlog ③ + `docs/m5-probes-raw/cb-REPORT.md`（本计划事实基础）+ `docs/PITFALLS.md` U39/U54 + `lib/prefab.js`（既有 `prefabCreate`/`prefabInstantiate` 范式）。

**引擎：** **Unity 官方中国版 `2022.3.62f3c1`**（测试工程 `C:/Users/<用户>/pi-unity-official-f3c1`）。团结侧未跑（本轮只保证官方版实测；文档标「官方版实测」）。

---

## 全局约束

（逐字来自 `docs/HANDOFF.md` §6 与 `package.json`）

- 零第三方依赖（只用 `node:*` 与 `node --test`）；不 fork uloop。
- **`verified` 语义不许扩张**：只有「写后读回比对 intent vs actual」才置 `true/false`；无 intent 的读/执行命令恒 `null`。
- **退出码单点**：`lib/envelope.js` 的 `exitCodeFor` 是唯一判定处；**用法错只由 argv 决定**、在任何写盘/调用之前收敛。
- `USAGE_FAILURE_CODES` 是**冻结数组**；本批次**不新增用法错码**（只用既有 `MISSING_PATH`），故不动冻结表。**新增运行时码（退出码 1）不进冻结表。**
- **防假绿三道线**：① `ULOOP_TRUNCATED` 绝不产 `ok:true`；② 磁盘硬证据；③ **读回投影必须与 intent 同形**。
- ⭐ **凡改动/新增 `.cs` 分支，必须真机跑一次**（R367）。**静态契约测试测不出编译错误。**
- ⭐ **一次只发一条 `unity` 命令（含只读）**（U46/U49：uloop 单飞）；**不许碰** `<真实工程>`。
- 真机验证不得污染：临时节点/资产要删并读回确认。
- **`.cs` 静态契约要有牙**：断言**剥注释后**的源码（先剥 `/* */` 再剥 `//`，范式见 `test/prefab.test.js`）。
- 新增 `docs/PITFALLS.md` 条目**只追加到文件末尾、编号由文档任务统一**，**必须标适用引擎**。
- ⭐ **控制者不要手改实现/测试代码**（R372）。
- ⭐ **不要把 `npm test` 串在 `&&` 链中间、后面还跟一个总是成功的 `grep`**。
- **测试数据（mock）要与现实同形**（本计划 §2 的 mock 与真机读数同形）。
- `npm test` 基线 = **621/621**；每个任务结束必须全绿。

---

## 1. 决策点（需人类伙伴批准）

| # | 决策 | 备选 | 推荐 |
|---|---|---|---|
| **D-CB-1** | 根 `localPosition` 是否进 apply 读回面 | (a) **排除**并在 hint/文档写明「Unity 豁免根 position」；(b) 纳入 → 只要实例根 pos ≠ 资产根 pos 就必假红 | **(a)** —— 真机实证 apply 不写根 position（`docs/m5-probes-raw/cb-60-apply.json`：实例 5,5、资产仍 0,0）；纳入即 100% 假红 |
| **D-CB-2** | 是否需要 `--asset` | (a) 只给 `--path`，资产路径由 `PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot` 推得；(b) 再要 `--asset` | **(a)** —— 实例唯一确定资产，多一个参数多一个 argv 校验面；(b) 会在两者不一致时产生新失败模式 |
| **D-CB-3** | `revert` 的判据 | (a) `HasPrefabInstanceAnyOverrides(go,false)==false` **且**（排除根 position 后）实例投影==资产投影；(b) 只比变换 | **(a)** —— 覆盖清空是 Unity 自己给的直接判据（`cb2-12-revert.json`），比推断可靠 |
| **D-CB-4** | `name` 是否进读回面 | (a) **排除**（资产 name=文件名、实例 name 任意）；(b) 纳入 | **(a)** —— `prefab create` 的 name 语义（R432）在此不适用 |
| **D-CB-5** | 无覆盖时 `apply` 的 `verified` | (a) `true`（no-op，资产本就等于实例投影）；(b) `false` | **(a)** —— 读回比对通过就是 `true`；`verified` 表达「intent vs actual 一致」，不是「发生了改变」 |

**控制者先行裁定**：按推荐执行（a/a/a/a/a）。

---

## 2. 侦察结论（真机事实，2026-09-20，官方版 2022.3.62f3c1）

完整证据 `docs/m5-probes-raw/cb-REPORT.md`。

| 事实 | 证据 |
|---|---|
| `ApplyPrefabInstance(go, AutomatedAction)` 可经 `unity exec` 调用，不抛异常 | `cb-60-apply.json` |
| apply **写入**根 `scale`（资产 `1,1→3,3`）与子节点 `position`（`0,0→2,2`） | `cb2-09-apply.json` / `cb2-10-after.json` |
| apply **不写入**根 `localPosition`（实例 `5,5`、资产仍 `0,0`） | `cb-60-apply.json` |
| apply 后 `HasPrefabInstanceAnyOverrides(go,false)==false` | `cb-60-apply.json` / `cb2-09-apply.json` |
| `RevertPrefabInstance` 把根 `scale` 从覆盖值 `9,9` 还原到**资产值** `3,3`；`hasOverrides==false` | `cb2-12-revert.json` / `cb2-13-state.json` |
| 场景未保存时 `prefab create --force` 会重置实例（前置必须 `scene save`） | PITFALLS **U54** |

---

## 3. 文件结构

| 文件 | 职责 | 本批次动作 |
|---|---|---|
| `unity-scripts/prefab-apply.cs` | `apply`/`revert` 载荷（单 JSON 载荷 + `__error` 哨兵） | **创建** |
| `lib/prefab.js` | prefab 面 | 修改：加 `prefabApply`/`prefabRevert` + `applySubset` + `describeError` 映射；导出 |
| `bin/unity.js` | CLI 分派 + USAGE | 修改：`prefab` handler 加 `apply`/`revert` |
| `test/prefab.test.js` | `prefab*` 全套测试 + `.cs` 静态契约（**既有**） | 修改：加 JS 用例 + `.cs` 静态契约 |
| `docs/PITFALLS.md` · `docs/M5-PROBES.md` · `skills/unity-game-dev/SKILL.md` · `docs/HANDOFF.md` · `README.md` | 文档/账本 | 任务 4 |

> ⚠️ 新用例一律加到 **既有** `test/prefab.test.js`（含 `sequenceCall`/`nodeResult`/`ASSET_READ` 等），不要另起炉灶。

---

## 4. 任务

### 任务 1：`unity-scripts/prefab-apply.cs`（新 `.cs`）

**文件：**
- 创建：`unity-scripts/prefab-apply.cs`

- [ ] **步骤 1：写文件**

```csharp
// unity-scripts/prefab-apply.cs
// 入参：{"mode":"apply"|"revert","path":"CaI"}
// 出参：{"__written":true,"assetPath":"Assets/Prefabs/CaP.prefab","hasOverrides":false}
// 失败：{"__error":"BAD_PAYLOAD"|"NOT_FOUND"|"NOT_PREFAB_INSTANCE"|"APPLY_FAILED"|"REVERT_FAILED"}
//
// ⚠️ 真机事实（docs/m5-probes-raw/cb-REPORT.md）：ApplyPrefabInstance/RevertPrefabInstance
//   都会写/读「正常属性覆盖」（根 scale、子节点变换、sprite、components），
//   但**根 `localPosition` 是豁免项**（apply 不写进资产、revert 也不还原）—— 读回面由 lib 侧排除。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var mode = (string)req["mode"];
if (mode != "apply" && mode != "revert") return "{\"__error\":\"BAD_PAYLOAD\"}";
var nodePath = (string)req["path"];
if (string.IsNullOrEmpty(nodePath)) return "{\"__error\":\"BAD_PAYLOAD\"}";
GameObject go = GameObject.Find(nodePath);
if (go == null)
{
    // 同 node-inspect.cs / prefab-create.cs：Find 找不到**非激活**对象，回退按路径递归查找。
    string[] segs = nodePath.Split('/');
    foreach (GameObject sceneRoot in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
    {
        GameObject hit = FindByPath(sceneRoot.transform, segs, 0);
        if (hit != null) { go = hit; break; }
    }
}
if (go == null) return "{\"__error\":\"NOT_FOUND\"}";
// 🔴 修正（冲突扫描 #4）：--path 必须是**实例根** —— 子对象也会过 IsPartOfPrefabInstance，
//   但拿「资产**根**投影」比「**子节点**投影」会永久假红。用 GetOutermostPrefabInstanceRoot 卡死。
if (!PrefabUtility.IsPartOfPrefabInstance(go)) return "{\"__error\":\"NOT_PREFAB_INSTANCE\"}";
if (PrefabUtility.GetOutermostPrefabInstanceRoot(go) != go) return "{\"__error\":\"NOT_PREFAB_INSTANCE\"}";
var assetPath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(go);
if (string.IsNullOrEmpty(assetPath)) return "{\"__error\":\"NOT_PREFAB_INSTANCE\"}";
try
{
    // 🔴 修正（冲突扫描 #12）：InteractionMode 用**全限定名**（唯一真机证据 cb-60-apply.cs 全限定；静态测试测不出 CS0103）
    if (mode == "apply") PrefabUtility.ApplyPrefabInstance(go, UnityEditor.InteractionMode.AutomatedAction);
    else PrefabUtility.RevertPrefabInstance(go, UnityEditor.InteractionMode.AutomatedAction);
}
catch (System.Exception ex)
{
    var er = new Newtonsoft.Json.Linq.JObject();
    er["__error"] = mode == "apply" ? "APPLY_FAILED" : "REVERT_FAILED";
    er["detail"] = ex.Message;
    return er.ToString(Newtonsoft.Json.Formatting.None);
}
AssetDatabase.SaveAssets();
var o = new Newtonsoft.Json.Linq.JObject();
o["__written"] = true;
o["assetPath"] = assetPath;
o["hasOverrides"] = PrefabUtility.HasPrefabInstanceAnyOverrides(go, false);
return o.ToString(Newtonsoft.Json.Formatting.None);

// ⚠️ 不能加 static（uloop 会把字面量提升成外层局部变量 → CS8421）
GameObject FindByPath(Transform t, string[] segs, int i)
{
    if (t.name != segs[i]) return null;
    if (i == segs.Length - 1) return t.gameObject;
    for (int k = 0; k < t.childCount; k++)
    {
        GameObject hit = FindByPath(t.GetChild(k), segs, i + 1);
        if (hit != null) return hit;
    }
    return null;
}
```

⚠️ 变量名不得与既有局部量重名（uloop 顶层语句同域）：本文件仅 `req/mode/nodePath/go/segs/sceneRoot/hit/assetPath/ex/er/o`，全仓仅此一处。

---

### 任务 2：`lib/prefab.js` 加 `prefabApply` / `prefabRevert` + `bin/unity.js` 接线

**文件：**
- 修改：`lib/prefab.js`（在 `prefabInstantiate` 之后、`module.exports` 之前）
- 修改：`bin/unity.js`（`prefab` handler）

- [ ] **步骤 1：写失败测试（`test/prefab.test.js` 追加，先跑红）**

```js
const { prefabApply, prefabRevert } = require('../lib/prefab.js');

/** 实例读回（node-inspect）：根 scale 3,3 / components / sprite。position 故意≠资产（根 position 豁免）。 */
const INST_READ = (over = {}) => nodeResult({
  name: 'CaI', active: true, path: 'CaI', siblingIndex: 3, instanceId: -1, matchCount: 1,
  position: { x: 5, y: 5, z: 0 }, scale: { x: 3, y: 3, z: 1 },
  sprite: null, components: ['Transform'],
  ...over,
});
/** apply 写调用成功返回。 */
const APPLY_WRITE = (over = {}) => ({ Success: true, Result: JSON.stringify({ __written: true, assetPath: 'Assets/Prefabs/CaP.prefab', hasOverrides: false, ...over }) });

test('prefabApply：实例投影（排除根 position/name）与资产投影一致 → verified:true', async () => {
  // 写调用 → 实例读回 → 资产读回（prefab-create read）
  const call = sequenceCall([APPLY_WRITE(), INST_READ(), READ_PREFAB({ name: 'CaP', position: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: null, components: ['Transform'] })]);
  const e = await prefabApply({ projectPath: 'P', path: 'CaI', _call: call, _stat: () => ({ size: 910, mtimeMs: 1 }) });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(e.intent, { scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: null, components: ['Transform'] });
});

test('prefabApply：缺 --path → MISSING_PATH（用法错 2，零调用）', async () => {
  const spy = [];
  const e = await prefabApply({ projectPath: 'P', path: undefined, _call: sequenceCall([], spy) });
  assert.strictEqual(e.code, 'MISSING_PATH');
  assert.strictEqual(exitCodeFor(e), 2);
  assert.strictEqual(spy.length, 0);
});

test('prefabApply：节点不是 Prefab 实例 → NOT_PREFAB_INSTANCE（运行时 1）', async () => {
  const call = sequenceCall([{ Success: true, Result: JSON.stringify({ __error: 'NOT_PREFAB_INSTANCE' }) }]);
  const e = await prefabApply({ projectPath: 'P', path: 'Plain', _call: call });
  assert.strictEqual(e.code, 'NOT_PREFAB_INSTANCE');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('prefabRevert：hasOverrides=true → verified:false（覆盖没清空）', async () => {
  const call = sequenceCall([{ Success: true, Result: JSON.stringify({ __written: true, assetPath: 'Assets/Prefabs/CaP.prefab', hasOverrides: true }) }, INST_READ({ scale: { x: 9, y: 9, z: 1 } }), READ_PREFAB({ scale: { x: 3, y: 3, z: 1 }, spriteAssetPath: null, components: ['Transform'] })]);
  const e = await prefabRevert({ projectPath: 'P', path: 'CaI', _call: call });
  assert.strictEqual(e.verified, false);
  assert.ok(e.hint.some((h) => h.includes('override') || h.includes('覆盖')));
});
```

- [ ] **步骤 2：运行验证失败** → `node --test test/prefab.test.js` 预期 FAIL（`prefabApply` 未定义）

- [ ] **步骤 3：在 `lib/prefab.js` 实现**

```js
/**
 * apply/revert 的读回面：从节点/资产投影里取「会被 apply 写回资产」的字段。
 * ⚠️ 排除 `position`（根 localPosition 是 Unity 豁免项，见 cb-REPORT）与 `name`
 *   （资产 name = `--to` 文件名、实例 name 任意，二者本就不该相等 —— R432/D-CB-4）。
 */
function applySubset(proj) {
  const n = isPlainObject(proj) ? proj : {};
  return {
    scale: n.scale,
    spriteAssetPath: n.spriteAssetPath !== undefined ? n.spriteAssetPath : null,
    components: n.components,
  };
}

/** 把 `node inspect` 的实例读回投影成 applySubset 同形（sprite.assetPath → spriteAssetPath）。 */
function instanceSubset(node) {
  const n = isPlainObject(node) ? node : {};
  const sprite = isPlainObject(n.sprite) ? n.sprite : null;
  const assetPath = sprite && typeof sprite.assetPath === 'string' && sprite.assetPath !== '' ? sprite.assetPath : null;
  return applySubset({ scale: n.scale, spriteAssetPath: assetPath, components: n.components });
}

async function prefabApplyOrRevert({ projectPath, env, path: nodePath, action, _call, _stat } = {}) {
  if (typeof nodePath !== 'string' || nodePath === '') {
    return fail({ code: 'MISSING_PATH', message: `缺少 --path（要 ${action} 的 Prefab 实例路径）`, actual: { path: nodePath }, hint: ['用 `unity scene tree` 取可用路径'] });
  }
  const callFn = _call || call;
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('prefab-apply', { mode: action, path: nodePath }), { projectPath, env });
  } catch (err) {
    return fail({ code: action === 'apply' ? 'APPLY_FAILED' : 'REVERT_FAILED', message: `${action} 调用失败：${(err && err.message) || String(err)}`, hint: ['实例状态是否已变未知；先用 `unity node inspect` 复核该实例'], phase: 'write' });
  }
  const envl = envelopeFromCall(w);
  if (!envl.ok) return withWriteRecheckHint(envl);
  const res = parseScriptResult(w, {
    label: 'prefab-apply',
    describeError: (code, parsed) => {
      if (code === 'NOT_FOUND') return { message: `节点不存在：${nodePath}`, actual: { path: nodePath }, hint: ['用 `unity scene tree` 查看可用路径'] };
      if (code === 'NOT_PREFAB_INSTANCE') return { message: `该节点不是 Prefab 实例：${nodePath}`, actual: { path: nodePath }, hint: ['本命令只对 Prefab 实例生效（`prefab instantiate` 出来的节点）', '用 `unity node inspect` + 资产读回确认它是不是实例'] };
      if (code === 'APPLY_FAILED' || code === 'REVERT_FAILED') return { message: `${action} 失败：${nodePath}`, actual: { path: nodePath, detail: parsed && parsed.detail }, hint: ['先用 `unity node inspect` 复核该实例状态'] };
      return undefined;
    },
  });
  if (res.envelope) return res.envelope;
  const assetPath = res.parsed && typeof res.parsed.assetPath === 'string' ? res.parsed.assetPath : null;
  const hasOverrides = res.parsed && res.parsed.hasOverrides === true;
  if (!assetPath) return fail({ code: 'BAD_SCRIPT_RESULT', message: 'prefab-apply 未返回 assetPath', actual: res.parsed, hint: ['检查 unity-scripts/prefab-apply.cs 的返回协议'] });

  // 读回：实例（node-inspect）+ 资产（prefab-create read），两次独立调用
  const instEnv = await nodeInspect({ projectPath, env, path: nodePath, _call: callFn });
  if (!instEnv.ok) return fail({ code: 'READBACK_FAILED', message: `写后读回实例失败（${instEnv.code}）`, intent: null, actual: instEnv.actual, hint: instEnv.hint, phase: 'readback' });
  const assetRead = await readPrefabAsset({ projectPath, env, callFn, assetPath });
  if (!assetRead.ok) return assetRead.envelope;

  const mismatches = [];
  if (action === 'apply') {
    // intent = 实例（写回源），actual = 资产（写回目标）
    mismatches.push(...compareSubset(instanceSubset(instEnv.actual), applySubset(assetRead.asset)));
  } else {
    mismatches.push(...compareSubset(applySubset(assetRead.asset), instanceSubset(instEnv.actual)));
    if (hasOverrides) mismatches.push({ key: 'hasOverrides', intent: false, actual: true });
  }
  // 磁盘防线（apply 才改资产）
  if (action === 'apply') {
    try {
      const s = (_stat || ((p) => fs.statSync(p)))(path.join(projectPath, assetPath));
      if (!(s && s.size > 0)) mismatches.push({ key: 'file.bytes', intent: '>0', actual: null });
    } catch (err) { mismatches.push({ key: 'file.bytes', intent: '>0', actual: null }); }
  }
  const verified = mismatches.length === 0;
  return {
    ...ok(
      { instance: instanceSubset(instEnv.actual), asset: applySubset(assetRead.asset), hasOverrides },
      {
        verified,
        intent: action === 'apply' ? instanceSubset(instEnv.actual) : applySubset(assetRead.asset),
        hint: verified
          ? ['⚠️ 根 `localPosition` 是 Unity 的 apply/revert **豁免项**：本命令不会把它写进资产、也不会还原它（PITFALLS U39）']
          : ['读回不一致（verified:false）——逐条查 mismatches；`scale`/`spriteAssetPath`/`components` 应一致，根 `position` 不在比对面内', '若 mismatches 里有 `hasOverrides`：revert 后实例仍有覆盖（Unity 未能清空）'],
      },
    ),
    mismatches,
  };
}

/** `unity prefab apply`：把实例覆盖写回 Prefab 资产。 */
async function prefabApply(opts = {}) { return prefabApplyOrRevert({ ...opts, action: 'apply' }); }
/** `unity prefab revert`：丢弃实例覆盖。 */
async function prefabRevert(opts = {}) { return prefabApplyOrRevert({ ...opts, action: 'revert' }); }
```

并把 `module.exports` 改为：

```js
module.exports = { prefabCreate, prefabInstantiate, prefabApply, prefabRevert, nodeProjection, prefabRootName };
```

⚠️ **🔴 修正（冲突扫描 #1）**：`lib/prefab.js:6` 必须改为 `const { fail, ok, envelopeFromCall } = require('./envelope.js');`（现为 `{ fail, envelopeFromCall }`，缺 `ok` → 计划代码里的 `ok(...)` 会 ReferenceError）。需要 `fs`/`path`（已在文件顶部 require）、`nodeInspect`（已在顶部从 `./scene.js` 解构）、`readPrefabAsset`（同文件已定义）、`compareSubset`/`isPlainObject`（顶部已从 `./readback.js` 解构）。

- [ ] **步骤 4：改 `bin/unity.js` 的 `prefab` handler**

把 `if (action === 'create' || action === 'instantiate') {` 一段改为：

```js
    if (action === 'create' || action === 'instantiate' || action === 'apply' || action === 'revert') {
      const { prefabCreate, prefabInstantiate, prefabApply, prefabRevert } = require('../lib/prefab.js');
      let e;
      if (action === 'create') {
        e = await prefabCreate({ projectPath: args['project-path'], fromNode: args['from-node'], to: args.to, force: args.force });
      } else if (action === 'instantiate') {
        e = await prefabInstantiate({ projectPath: args['project-path'], asset: args.asset, parent: args.parent, name: args.name });
      } else {
        const fn = action === 'apply' ? prefabApply : prefabRevert;
        e = await fn({ projectPath: args['project-path'], path: args.path });
      }
      emit(e, { json: Boolean(args.json) });
      return exitCodeFor(e);
    }
    process.stderr.write('usage: unity prefab create --from-node <节点路径> --to <Assets/...prefab> [--force]\n'
      + '       unity prefab instantiate --asset <Assets/...prefab> [--parent <节点路径>] [--name <名字>]\n'
      + '       unity prefab apply  --path <实例路径>\n'
      + '       unity prefab revert --path <实例路径>\n');
    return EXIT_USAGE;
```

并在 `USAGE` 的 `prefab` 段加两行（`prefab create`/`instantiate` 之后）：

```
  prefab apply           把 Prefab 实例的覆盖写回**资产**（写后读回：实例投影 vs 资产投影）
    --path <实例路径>    必填：场景里的 Prefab 实例路径
                         ⚠️ 根 `\`localPosition\`` 是 Unity 豁免项：**不会**写进资产（PITFALLS U39）
                         ⚠️ `--path` 必须是**实例根**（非根子对象 → `NOT_PREFAB_INSTANCE`）
                         退出码：0 且 verified:true / 1（NOT_FOUND / NOT_PREFAB_INSTANCE / APPLY_FAILED /
                         READBACK_FAILED / BAD_SCRIPT_RESULT / PREFAB_NOT_FOUND / verified:false）/ 2（缺 --path → MISSING_PATH）
  prefab revert          丢弃 Prefab 实例的覆盖（写后读回：hasOverrides 必须为 false）
    --path <实例路径>    必填
                         ⚠️ 同样不还原根 `\`localPosition\``（豁免项）；`--path` 必须是实例根
                         退出码：0 且 verified:true / 1（NOT_FOUND / NOT_PREFAB_INSTANCE / REVERT_FAILED /
                         READBACK_FAILED / BAD_SCRIPT_RESULT / PREFAB_NOT_FOUND / verified:false）/ 2（缺 --path → MISSING_PATH）
```

- [ ] **步骤 5：`.cs` 静态契约（加到 `test/prefab.test.js` 既有 `.cs` 契约测试末尾）**

```js
test('prefab-apply.cs 静态契约：码集合 + 守卫顺序 + 无 static 局部函数', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'unity-scripts', 'prefab-apply.cs'), 'utf8');
  const csCode = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const code of ['BAD_PAYLOAD', 'NOT_FOUND', 'NOT_PREFAB_INSTANCE', 'APPLY_FAILED', 'REVERT_FAILED']) {
    assert.ok(csCode.includes('"' + code + '"'), `缺码 ${code}`);
  }
  assert.ok(csCode.indexOf('IsPartOfPrefabInstance') < csCode.indexOf('ApplyPrefabInstance'), '实例守卫必须在 apply 之前');
  assert.match(csCode, /HasPrefabInstanceAnyOverrides/, '必须回传 hasOverrides 供 revert 判据');
  assert.ok(!/static\s+GameObject\s+FindByPath/.test(csCode), '局部函数不能加 static（CS8421）');
});
```

- [ ] **步骤 6：跑测试** → `node --test test/prefab.test.js` 预期 PASS；再 `npm test` 预期 **621 + N**（N = 新增 JS 用例数，tripwire 是新增独立 test，按实际计数）。

- [ ] **步骤 7：Commit（由控制者执行）**

```bash
git add unity-scripts/prefab-apply.cs lib/prefab.js bin/unity.js test/prefab.test.js
git commit -m "feat(prefab): ③ unity prefab apply/revert（写后读回：实例投影 vs 资产投影，根 localPosition 豁免）"
```

---

### 任务 3：真机验证（`.cs` 铁律，必做）

**文件：** 无（产出原始 JSON 落 `docs/m5-probes-raw/`）

- [ ] **步骤 1：序列（官方版工程；全部串行）**

```bash
export PI_UNITY_ULOOP_BIN="C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe"
P="C:/Users/<用户>/pi-unity-official-f3c1"; U="node bin/unity.js"; D=docs/m5-probes-raw
$U node create --project-path "$P" --name CbSrc --json
$U node create --project-path "$P" --name CbChild --parent CbSrc --json
$U prefab create --project-path "$P" --from-node CbSrc --to Assets/Prefabs/CbP.prefab --json
$U prefab instantiate --project-path "$P" --asset Assets/Prefabs/CbP.prefab --name CbI --json
$U node set --project-path "$P" --path CbI --patch '{"scale":{"x":3,"y":3,"z":1}}' --json
$U node set --project-path "$P" --path CbI/CbChild --patch '{"position":{"x":2,"y":2,"z":0}}' --json
$U scene save --project-path "$P" --json
$U prefab apply --project-path "$P" --path CbI --json         # 期望 verified:true（第一次：写回 scale+子节点 pos）
$U prefab apply --project-path "$P" --path CbI --json         # 冲突扫描 #10：no-op（已无覆盖）仍应 verified:true（D-CB-5），落 cb3-* 证据
$U node set --project-path "$P" --path CbI --patch '{"scale":{"x":9,"y":9,"z":1}}' --json
$U prefab revert --project-path "$P" --path CbI --json        # 期望 verified:true、scale 回 3,3
$U node inspect --project-path "$P" --path CbI --json          # 期望 scale {3,3}
$U prefab apply --project-path "$P" --path CbSrc --json        # 期望 NOT_PREFAB_INSTANCE（CbSrc 是普通节点），退出码 1
$U prefab apply --project-path "$P" --path CbI/CbChild --json  # 冲突扫描 #4：期望 NOT_PREFAB_INSTANCE（非实例根），退出码 1
# 清理（冲突扫描 #13，给成可直接粘的命令）：
node bin/unity.js exec --project-path "$P" --code-file docs/m5-probes-raw/ca-40b-cleanup-final.cs --json   # 删 Ca*/Cb* 根 + CaP/CbP.prefab，读回 LoadAssetAtPath==null
node bin/unity.js scene tree --project-path "$P" --json | grep -o '"nodeCount": *[0-9]*'   # 期望 nodeCount=3
```

**必须记录**：原始 JSON 落 `docs/m5-probes-raw/`（前缀 `cb3-`）+ 清理读回（`nodeCount` 回到 3）。
**若与期望不符**（尤其 `verified:false`）：**停下汇报**，不要放宽断言。

- [ ] **步骤 2：Commit 原始证据（由控制者执行）**

---

### 任务 4：文档回写（由控制者执行）

- [ ] `docs/PITFALLS.md`：追加 **U55**（`apply`/`revert` 对根 `localPosition` 豁免 —— apply 不写进资产、revert 不还原；标「官方版实测」）+ 索引表补 U55 行。
- [ ] `docs/M5-PROBES.md`：追加 **§11 批次 C-B**（apply/revert 真机 + 证据清单 `cb-*`）。
- [ ] `skills/unity-game-dev/SKILL.md` §3.6：加 `prefab apply`/`revert` 用法与「根 position 豁免」限制。
- [ ] `docs/HANDOFF.md`：§7 backlog ③ 标完成；§2 命令数 +2；§3 加里程碑行；§8 加 C-B 行；§1/§8 的 U 计数更新。
- [ ] `README.md`：命令面 + U 计数更新。
- [ ] 本计划补 §7/§8。

---

### 任务 5：收尾

- [ ] `npm test` 全绿（记录实际数）。
- [ ] （若人类伙伴要）按惯例打 tag。

---

## 5. 自检

| backlog 项 | 对应任务 |
|---|---|
| ③ `prefab apply`/`revert` | 任务 1/2/3 |
| `apply` 读回面（证明资产真被改） | 任务 2 步骤 3（`applySubset`）+ D-CB-1 |
| `.cs` 改动必须真机跑一次 | 任务 3 |
| 冻结数组/退出码单点/防假绿 | 全局约束（新增码全为运行时 1，不进冻结表） |
| 文档/账本 | 任务 4 |

**占位符扫描**：无「待定/TODO」；任务 3 的注释是**期望值说明**，不是待填项。
**类型一致性**：`applySubset`/`instanceSubset`/`prefabApply`/`prefabRevert` 在 `lib/prefab.js`、测试、`bin/unity.js` 间同名；`.cs` 的 `__written`/`assetPath`/`hasOverrides` 与 JS 解构逐字对齐。
**命名一致性**：`.`cs` 载荷脚本名 `prefab-apply` 在 `buildPayloadArgs` 调用与文件名间一致。

---

## 6. 执行方式

**1. 子代理驱动（推荐）** —— 每个任务一个新子代理，任务间 spec + code 双审
**2. 内联执行**

**起飞前冲突扫描**：见 §7。

---

## 7. 起飞前冲突扫描裁定记录（2026-09-20）

只读子代理（`reviewer`）通读本计划 + `cb-REPORT.md` + `lib/prefab.js`/`bin/unity.js`/`test/prefab.test.js` 后报 **3🔴 + 9🟡 + 4💡**，**全部成立**。裁定与落点：

**🔴 阻塞（已在正文直接修正）**：

| # | 发现 | 裁定 / 落点 |
|---|---|---|
| #1 | `lib/prefab.js:6` 只引 `{ fail, envelopeFromCall }`，计划代码用 `ok(...)` → ReferenceError | 成立。任务 2 步骤 3 修正行已写明：改为 `{ fail, ok, envelopeFromCall }` |
| #2 | USAGE 模板字符串里裸反引号会提前终止 `bin/unity.js:8` 的模板字面量 → 全命令挂、621 大面积翻红 | 成立。任务 2 步骤 4 的 USAGE 已改为 `\`localPosition\`` 转义；执行后**必须**先 `node -c bin/unity.js`（或 `node bin/unity.js version`）自检 |
| #3 | 测试 4 断言 hint 含 `override`/`覆盖`，但实现的失败 hint 两词都无 → 必红 | 成立。已把失败 hint 补上 `hasOverrides` 一句（任务 2 步骤 3 的 hint 块） |

**🟡 需修（裁定后由执行者按 §7 覆盖正文相应片段）**：

| # | 发现 | 裁定 / 落点 |
|---|---|---|
| #4 | `--path` 未限定实例根 → 子对象被当实例根，revert/apply 拿「资产根投影」比「子节点投影」→ 永久假红 | 成立。`.cs` 加 `GetOutermostPrefabInstanceRoot(go) != go → NOT_PREFAB_INSTANCE`（任务 1 步骤 1 已改）；USAGE/任务 3 已加断言步骤 |
| #5 | 读回面宣称含子节点变换，但 `applySubset` 不含子节点字段；任务 3 拿子节点覆盖当证据无意义 | 成立。**本批读回面明确只覆盖根 `scale`/`spriteAssetPath`/`components`**；任务 3 的子节点 `node set` 仍保留为「真机跑一次 apply（不报错）」，但**不作为 verified 的证据**；子节点写入已由 cb2 侦察单独记录（`cb2-09/10`），留给后续批次纳入读回面 |
| #6 | 复用 `readPrefabAsset` 失败会带进 immediate 专属的错 hint（「本步在实例化之前…」）且丢掉 residue | 成立。任务 2 步骤 3 里 `if (!assetRead.ok) return assetRead.envelope;` 改为包装：`fail({code:'READBACK_FAILED', phase:'readback', intent, actual: null, hint:[...assetRead.envelope.hint, '写可能已生效：资产/实例可能已改，先 `unity node inspect` 复核']})` |
| #7 | 自建信封 `actual={instance,asset,hasOverrides}` 与 `intent` **不同形**，违反「读回投影必须与 intent 同形」 | 成立。改为：**apply** → `ok(applySubset(asset), {intent: instanceSubset(inst), verified, hint})`；**revert** → `ok(instanceSubset(inst), {intent: applySubset(asset), verified, hint})`；`hasOverrides` 只进 `mismatches`（key=`hasOverrides`），不进 `actual` |
| #8 | USAGE 退出码枚举漏 `BAD_SCRIPT_RESULT` / `PREFAB_NOT_FOUND` | 成立。已补（任务 2 步骤 4） |
| #9 | hint/USAGE 引用尚不存在的 `U55` | 成立。代码/文案里**去 U55**（只引 U39）；**U55 建号在任务 4 文档步骤**，与代码解耦 |
| #10 | D-CB-5 裁定「无覆盖 apply → verified:true」无真机支撑 | 成立。任务 3 已加第二次 `prefab apply`（no-op）期望 `verified:true`，落 `cb3-*` |
| #11 | cb-REPORT「结论②」说 revert 不能拿资产值当 intent，与计划 revert intent=资产投影 表面冲突 | 成立。**以 cb2 侦察的「修正结论③」为准**：仅根 `localPosition` 不回归资产值（已排除），其余字段 `cb2-13-state.json` 实测回归资产值；本条已写入本表，执行者以本表为准 |
| #12 | `InteractionMode` 用非限定名，无真机证据 | 成立。`.cs` 改用 `UnityEditor.InteractionMode.AutomatedAction`（任务 1 步骤 1 已改） |

**💡 建议**：

| # | 发现 | 裁定 / 落点 |
|---|---|---|
| #13 | 清理只写成 bash 注释 → 易漏删 | 成立。任务 3 已给成可直接粘的清理命令 + `nodeCount=3` 读回 |
| #14 | `components` 顺序敏感，未覆盖「加组件当覆盖」 | 采纳：真机序列**不**新增组件覆盖；在 `docs/PITFALLS.md` 的读回面说明中写「`components` 顺序敏感（同 `prefab create` 的 R448）」 |
| #15 | 新静态契约测试比同仓范式弱（`includes('"CODE"')` + `$` 行尾） | 采纳：改写为 `split(/\r?\n/)` + `errorPoint(code)` 正则范式（照 `test/prefab.test.js:713-745`）；避免 `$` 行尾 |
| #16 | `bin/unity.js:10` 命令面摘要与 README 命令表未点名 | 成立。任务 4 明确点名这两处（+ `USAGE` 首行 M4 摘要） |

**裁定后执行顺序**：任务 1 → 任务 2（含上述覆盖） → 任务 3（含 no-op + 非根断言 + 清理） → 任务 4（含 U55 建号 + `bin/unity.js:10`/README） → 任务 5。

---

## 8. 执行结果与计划偏差（2026-09-20）

**结论：任务 1–5 全部完成；`npm test` 621 → **636**（+15：实现轮 8 + 修复轮 7）；新增命令 `unity prefab apply`/`revert`；新坑 **U55**。**

### 8.1 真机验收（官方 2022.3.62f3c1，`docs/m5-probes-raw/cb3-*`）

- `prefab apply` 首次（编译新 `.cs`）→ `verified:true`（`cb3-08`）；no-op apply → `verified:true`（`cb3-09`，D-CB-5）
- `prefab revert`（先覆盖 scale=9,9）→ `verified:true`、实例 scale 回 `3,3`（`cb3-11`/`cb3-12`）
- `apply --path CbSrc`（普通节点）/ `apply --path CbI/CbChild`（非实例根）→ `NOT_PREFAB_INSTANCE`（退出码 1，`cb3-13`/`cb3-14`）
- 清理：`cb3-99-cleanup.json`（资产 `LoadAssetAtPath==null`）+ `cb3-99-tree.json`（`nodeCount=3`）

### 8.2 偏离计划的地方

| # | 计划写的 | 实际做的 | 理由 |
|---|---|---|---|
| 1 | 任务 1/2 各一个 commit | **合并为一个** `feat(prefab)` commit | `lib/prefab.js`/`bin/unity.js`/`test/prefab.test.js` 被两任务同时改动 |
| 2 | `.cs` 失败码用三元发射 | 拆成 `if/else` 两个发射点 | §7 #15 的 `errorPoint` 正则只能绑 `["__error"] = "CODE"`（审查确认，行为等价） |
| 3 | 任务 2 列 4 条 JS 用例 | 实现 8 + 修复轮 7 = **15** 条 | 审查要求补：`sprite` 非空映射、apply 字段级分歧、revert 绿例、`hasOverrides` 协议守卫、`file.bytes` 可视化 等 |
| 4 | `applyScale` 字段级分歧断言 `key==='scale'` | 断言 `key==='scale'` 或 `startsWith('scale.')` | `compareSubset` 对嵌套对象递归，实际 key 是 `scale.x`/`scale.y`（未放宽成 `includes`） |
| 5 | USAGE 列 `PREFAB_NOT_FOUND` | 注明「仅出现在 `READBACK_FAILED` 的 message 内」 | §7 #6 把资产读回失败包成 `READBACK_FAILED` |

### 8.3 双审结论

- **spec 审**：任务 1/2 全部符合规格，无 🔴；2 🟡（实例读回失败 residue、文案）已在本轮修复。
- **code 审**：质量「好」，无必须修复项；3 🟡（`hasOverrides` 协议守卫 = revert 假绿风险、`file.bytes` hint、测试缺口）已在本轮修复。
- 修复轮后 `node -c bin/unity.js` OK、`node --test test/prefab.test.js` **56/56**、`npm test` **636/636**。
