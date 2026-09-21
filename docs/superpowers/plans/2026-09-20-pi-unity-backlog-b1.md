# pi-unity backlog 批次 B-1 实现计划（⑤ 实例唯一定位 · ⑥ Prefab 读回面纳入 components）

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 关闭 `docs/HANDOFF.md` §7 backlog 的 **⑤**（同父多同名实例时 `node inspect` 只能命中一个 → 加一种定位模式）与 **⑥**（空节点 Prefab 投影几乎无内容 → 把 `components` 纳入读回面）。

**架构：** 两项都**必须改 `.cs`**（uloop 载荷脚本），因此按 HANDOFF §6 铁律**必须真机跑一次**（R367：静态契约测试测不出编译错误）。⑤ 是**跨语言三联**（`node-inspect.cs` + `lib/scene.js` + `bin/unity.js` + 测试假后端）；⑥ 是 `prefab-create.cs` 读回面 + `lib/prefab.js` 的 `nodeProjection`。

**技术栈：** Node.js ≥ 21（CommonJS，`node --test`，零依赖）+ Unity C# 载荷脚本。

**规格：** `docs/HANDOFF.md` §7 backlog 表（⑤⑥ 原文）+ `docs/PITFALLS.md` U42 + `docs/M4-DECISIONS.md` R448 / R451③ + 本计划 §2 的侦察结论。

**引擎：** **官方版 `2022.3.62f3c1`**（测试工程 `C:/Users/<用户>/pi-unity-official-f3c1`，编辑器已在跑）。**所有真机结论一律标注「官方版实测」；团结复测记为延后**（不冒充「两者」）。

---

## 全局约束

（逐字来自 `docs/HANDOFF.md` §6 与 `package.json`）

- 零第三方依赖（只用 `node:*` 与 `node --test`）；不 fork uloop。
- **`verified` 语义不许扩张**：只有「写后读回比对 intent vs actual」才置 `true/false`；无 intent 的读/执行命令恒 `null`。
- **退出码单点**：`lib/envelope.js` 的 `exitCodeFor` 是唯一判定处；**用法错只由 argv 决定**、在任何写盘/调用之前收敛。
- `USAGE_FAILURE_CODES` 是**冻结数组**；新增用法错码要同时改它 + `test/envelope.test.js` 的**排序后全等**断言。
- **防假绿三道线**：① `ULOOP_TRUNCATED` 绝不产 `ok:true`；② 磁盘硬证据；③ **读回投影必须与 intent 同形**。
- ⭐ **凡改动/新增 `.cs` 分支，必须真机跑一次**（R367）。**静态契约测试测不出编译错误。**
- ⭐ **一次只发一条 `unity` 命令（含只读）**（U46/U49：uloop 单飞）；**不许碰** `<真实工程>`。
- 真机验证不得污染：临时节点/资产要删并读回确认。
- **`.cs` 静态契约要有牙**：断言**剥注释后**的源码（先剥 `/* */` 再剥 `//`，范式见 `test/prefab.test.js`）。
- 新增 `docs/PITFALLS.md` 条目**只追加到文件末尾、编号由文档任务统一**，**必须标适用引擎**。
- ⭐ **控制者不要手改实现/测试代码**（R372）。
- ⭐ **不要把 `npm test` 串在 `&&` 链中间、后面还跟一个总是成功的 `grep`**。
- **测试数据（mock）要与现实同形**。
- 测试里不要用 `.` + `$` 匹配行尾（**工作树当前全是 CRLF**）。
- `npm test` 基线 = **606/606**；每个任务结束必须全绿。

---

## 1. 决策点（需人类伙伴批准）

| # | 决策 | 备选 | 推荐 |
|---|---|---|---|
| **D-B1** | ⑤ 的定位参数用哪个 | (a) `--sibling-index <n>`；(b) `--instance-id <id>`；(c) 两者都加 | **(a)** —— `get-hierarchy` 的读回面**已有 `siblingIndex`**（`lib/scene.js:187`），agent 可直接取来用；`GetInstanceID` 全仓零出现、且**不跨编辑器会话稳定**（重开工程就变），做定位键会让「记下来再用」失效 |
| **D-B2** | ⑤ 歧义（同父多同名、且没给定位参数）时的默认行为 | (a) 保持「取第一个」（现状）+ 新增 `actual.matchCount` 与一条 hint；(b) 直接硬失败（新增运行时码 `AMBIGUOUS_NODE`） | **(a)** —— (b) 会**破坏 U42 记录的既有用法**（多实例验收靠 `--name` 区分，没给定位参数时突然报错是行为倒退）；(a) 是**纯 additive**，且把「你命中的是第几个」变成可见事实 |
| **D-B3** | ⑥ 的 `components` 读回形式 | (a) `prefab.components = ["Transform","SpriteRenderer"]`（与 `node inspect` 的 `components` 同形）；(b) 带类型的对象数组 | **(a)** —— 与 `node-inspect.cs:125-126` 的既有口径**同形**（`GetComponents<Component>().Where(c => c != null).Select(c => c.GetType().Name)`），`compareSubset` 的数组语义（长度不等即分歧、等长逐元素比）直接可用 |
| **D-B4** | ⑤ 是否也给 `node set` / `node delete` 加定位参数 | (a) 只加 `node inspect`（backlog 原文如此）；(b) 三个命令都加 | **(a)** —— backlog 原文只点名 `node-inspect`；扩到 set/delete 会显著放大改动面与真机验证量，另开任务更合适 |

**若人类伙伴不批准 D-B2 的 (a)**，则改为 (b) 硬失败（新增 `AMBIGUOUS_NODE` 进冻结表 + 一条 U 条目记录行为变更）。

---

## 2. 侦察结论（事实基础，2026-09-20，只读侦察）

### ⑤ 的现状

| 事实 | 证据 |
|---|---|
| `node-inspect.cs` 载荷协议**只有一个键** `{path}`，两级查找都是「第一个命中即返回」 | `unity-scripts/node-inspect.cs:10-11`、`:19-32`（`GameObject.Find` → DFS 回退）、`:133-143`（`FindByPath` 取 childCount 序最小者） |
| 读回面**没有** `siblingIndex` / `instanceId` / `tag` / `layer` | `node-inspect.cs:37-127` 只写 `{name, active, path, position, scale, sprite, components}` |
| `siblingIndex` **只在 `scene tree` 读回面** | `lib/scene.js:174`、`:187` |
| `GetInstanceID` **全仓零出现**（`.cs` + `.js`） | `grep -rn "GetInstanceID"` → 0 命中 |
| 假后端是 **path-keyed `Map`**，**表达不了同父同名两个节点** | `test/helpers/fake-scene.js:23-24`（`nodes.get(p)`）、`:78-82`（`node-inspect.cs` 分支 `{...n}`） |
| `node inspect` 的 handler 只传 `project-path` + `path` | `bin/unity.js:391-396` |
| U42 原文 | `docs/PITFALLS.md:65`（索引）、`:1618-1627`（正文）：「要**精确归属**就用 `prefab instantiate --name` 区分」 |

### ⑥ 的现状

| 事实 | 证据 |
|---|---|
| `prefab-create.cs` 的 read 模式只读 `asset / name / position / scale / spriteAssetPath / guid` | `unity-scripts/prefab-create.cs:62-85` |
| `nodeProjection` 只取 `name / position / scale / spriteAssetPath` 四项 | `lib/prefab.js:76-85` |
| `intent.prefab.name` 被 `--to` 的**文件名**覆盖 | `lib/prefab.js:159-161` + `prefabRootName` |
| `verified` = `compareSubset(intent, actual)` 的 `mismatches` 为空（+ `extraCheck` 的 `file.bytes` / `guid`） | `lib/readback.js:184-193`、`lib/prefab.js:266-308` |
| **空节点现状：`verified:true` 但证伪力≈0** —— 四个投影字段全是常量默认值（`name` 由路径决定、`position`=0,0,0、`scale`=1,1,1、`spriteAssetPath`=null） | 由 `lib/prefab.js:76-85/159-161` + `prefab-create.cs:62-84` + `lib/readback.js:191-192` 推出 |
| `compareSubset` 的数组语义：**长度不等即一条分歧；等长逐元素比**（**顺序敏感**） | `lib/readback.js:129-193` |
| R448 原文 | `docs/M4-DECISIONS.md:264`：「空节点（默认 transform + 无 sprite）的投影几乎无内容（可选：把 `components` 纳入读回面）→ **defer**」 |
| 现有 `nodeProjection` 用例**只钉四个字段**，**没有**「空节点也能通过」的用例 | `test/prefab.test.js:637-643`、`:95-113` |

---

## 3. 文件结构

| 文件 | 职责 | 本批次动作 |
|---|---|---|
| `unity-scripts/node-inspect.cs` | 节点读取载荷 | 修改：加 `siblingIndex` 定位 + 读回 `siblingIndex`/`instanceId`/`matchCount` |
| `unity-scripts/prefab-create.cs` | Prefab 写/读载荷 | 修改：read 模式加 `components` |
| `lib/scene.js` | 节点面 | 修改：`nodeInspect` 的 argv 守卫 + payload + `describeError` |
| `lib/prefab.js` | Prefab 面 | 修改：`nodeProjection` 加 `components` |
| `bin/unity.js` | CLI | 修改：`node inspect` 的 handler 透传 + USAGE |
| `test/helpers/fake-scene.js` | 假后端 | 修改：支持同父同名 + `siblingIndex` 定位（**硬要求**，见 §2） |
| `test/scene.test.js` · `test/prefab.test.js` · `test/envelope.test.js` | 测试 | 修改 |

---

## 4. 任务

### 任务 1：⑤ `node inspect` 的实例唯一定位（`--sibling-index`）

**文件：**
- 修改：`unity-scripts/node-inspect.cs`、`lib/scene.js`、`bin/unity.js`、`lib/envelope.js`
- 修改：`test/helpers/fake-scene.js`、`test/scene.test.js`、`test/envelope.test.js`

- [ ] **步骤 1：写失败测试（`test/scene.test.js` 追加）**

```js
test('R480：node inspect --sibling-index 能定位同父同名的第 N 个实例（U42 关闭）', async () => {
  // ⚠️ 本文件当前**没有** require fake-scene（扫描 #4）—— 先补：
  //    const { makeFakeSceneBackend } = require('./helpers/fake-scene.js');
  //    以及顶部已有的 exitCodeFor require。
  // ⚠️ 必须传 baseScene（不传 = 空场景 → 只会得 NOT_FOUND，用例不自洽）。
  //    两个同父同名节点：Root/Brick#0 与 Root/Brick#1（同父 = Root）
  const { call } = makeFakeSceneBackend({ baseScene: /* 见步骤 3 的 fake 扩改后形状 */ });
  const e0 = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', siblingIndex: '0', _call: call });
  const e1 = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', siblingIndex: '1', _call: call });
  assert.strictEqual(e0.ok, true);
  assert.strictEqual(e1.ok, true);
  assert.strictEqual(e0.actual.siblingIndex, 0);
  assert.strictEqual(e1.actual.siblingIndex, 1);
  assert.notStrictEqual(e0.actual.instanceId, e1.actual.instanceId, '两个实例必须是不同的对象');
});

test('R480：不给 --sibling-index 且命中多个 → 仍取第一个，但 actual.matchCount > 1 且带 hint（D-B2）', async () => {
  const { call } = makeFakeSceneBackend({ baseScene: /* 同上，两个同父同名 */ });
  const e = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', _call: call });
  assert.strictEqual(e.ok, true, '不破坏既有行为（仍 ok）');
  assert.strictEqual(e.actual.siblingIndex, 0, '仍取第一个');
  assert.strictEqual(e.actual.matchCount, 2);
  assert.ok(e.hint.some((h) => h.includes('--sibling-index')), 'hint 必须给出定位出路');
});

test('R480：--sibling-index 越界 → SIBLING_INDEX_OUT_OF_RANGE（运行时码 1，不是用法错）', async () => {
  const { call } = makeFakeSceneBackend({ baseScene: /* 同上 */ });
  const e = await nodeInspect({ projectPath: 'P', path: 'Root/Brick', siblingIndex: '9', _call: call });
  assert.strictEqual(e.code, 'SIBLING_INDEX_OUT_OF_RANGE');
  assert.strictEqual(exitCodeFor(e), 1, '「第 9 个兄弟不存在」是运行时事实，不是 argv 形状错');
});

test('R480：--sibling-index 非非负整数 → BAD_SIBLING_INDEX（用法错 2），且在任何调用之前收敛', async () => {
  const boom = async () => { throw new Error('不该调用 uloop'); };
  for (const bad of ['-1', '1.5', 'abc', '']) {
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
  const { main } = require('../bin/unity.js');
  const { captureStdout } = require('./helpers/capture.js');
  // 扫描 #10：本用例**必须真的断言接线**（只跑 --help 测不到透传）。
  // 用本文件既有的 withScriptedDispatcher（定义在 test/scene.test.js:91，不是 dynamic.test.js）
  // 注入假 dispatcher：让它把收到的 argv 回显成 Result，再断言载荷里 siblingIndex === 1。
  const run = await withScriptedDispatcher(
    "process.stdout.write(JSON.stringify({ Success: true, Result: JSON.stringify({ name: 'Brick', path: 'Root/Brick', siblingIndex: 1, instanceId: 42, matchCount: 2, components: ['Transform'] }) }) + '\\n');",
    () => captureStdout(() => main(['node', 'inspect', '--project-path', 'P', '--path', 'Root/Brick', '--sibling-index', '1', '--json'])),
  );
  assert.strictEqual(run.result, 0);
  assert.strictEqual(JSON.parse(run.out).actual.siblingIndex, 1);
  const help = await captureStdout(() => main(['--help']));
  assert.match(help.out, /--sibling-index/);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/scene.test.js`
预期：FAIL —— `BAD_SIBLING_INDEX` / `SIBLING_INDEX_OUT_OF_RANGE` 未知码，`siblingIndex`/`matchCount` 为 undefined

- [ ] **步骤 3：扩 `test/helpers/fake-scene.js`（硬要求）**

**现有假后端是 `Map<path, node>`（`test/helpers/fake-scene.js:17` 的 `new Map()`、`:25` 的 `nodes.get(p)`），表达不了同父同名两个节点。必须扩改，且扫描 #2 已钉死唯一安全形状：**

> 🔴 **只能改成 `Map<path, node[]>`，绝不要改成「有序数组」**：`test/doctor.test.js:507/541/705/760` 与 `test/golden.test.js:52/183/210/222/223` 共 **9 条断言**依赖 `be.nodes.has(...)` / `be.nodes.size` 的 **key 语义**；改成数组会让这 9 条全挂（`TypeError: .has is not a function`）。`Map<path, node[]>` 保持 key 语义不变 → 9 条全绿。

具体改动：
- `:17` `const nodes = new Map()` → `Map<path, node[]>`；`:25` `nodes.get(p)` → 返回**全部命中**。
- `:30`（`for (const [p, n] of nodes)`）、`:33`（`n.siblingIndex ?? 0`）、`:35`（`byPath.set(p, node)`）、`:36`（`byPath.get(parent)`）四处**父挂接逻辑必须一并改**（父现在拿到的是数组）。
- `node-inspect.cs` 分支（`:78-82`）：按 `payload.siblingIndex` 取（给了 → 该下标，越界 → `{"__error":"SIBLING_INDEX_OUT_OF_RANGE","count":N}`；没给 → 第 0 个 + `matchCount = 命中数`）；读回面 additive 加 `siblingIndex` / `instanceId` / `matchCount`。
- 🔴 `:74` 的 `if (findByPath(p)) return NAME_EXISTS` 是**夹具专用守卫**（真机不产此码，`:66-70` 注释已声明）—— 它会让「造同父同名」在夹具里**必被拒**。**必须**改成：同名检查只针对**同一父下**（或仅在 `payload.parent` 存在时生效），使「不同父同名」与「同父同名」都能构造；且**既有 `NAME_EXISTS` 用例必须继续绿**（先找出断言它的用例行号）。
- `get-hierarchy` 分支的 `siblingIndex`（`:33`）按同父下**实际次序**填，不再写死 `?? 0`。
- ⚠️ **默认（无同父同名）时行为必须逐字段不变** —— `test/golden.test.js` 与 `test/doctor.test.js` 全绿是硬门槛。

- [ ] **步骤 4：改 `unity-scripts/node-inspect.cs`**

- 载荷加可选键 `siblingIndex`（**用 `req.Property("siblingIndex") != null` 判存在性**，理由同 `sprite-assign.cs:17-20`：JSON null 在 Json.NET 里是 JValue 不是 C# null）。
- 把两级查找改成**收集全部命中**（`GameObject.Find` 只给一个，故**统一走 DFS 收集**；`FindByPath` 改为 `CollectByPath(Transform, string[], int, List<GameObject>)`，不再提前 return）。
- 选择逻辑：给了 `siblingIndex` → 取 `matches[siblingIndex]`（越界 → `{"__error":"SIBLING_INDEX_OUT_OF_RANGE","count":<命中数>}`）；没给 → `matches[0]`。
- 读回面**additive** 加三个字段：`siblingIndex`（`go.transform.GetSiblingIndex()`）、`instanceId`（`go.GetInstanceID()`）、`matchCount`（`matches.Count`）。
- ⚠️ **变量名不得与既有局部变量重名**（CS0136：uloop 把顶层语句放同一作用域；`segs` 已有前例注释）。
- ⚠️ **局部函数不能加 `static`**（uloop 字面量提升 → CS8421，见既有注释）。

- [ ] **步骤 5：改 `lib/scene.js` 的 `nodeInspect`**

```js
async function nodeInspect({ projectPath, env, path: nodePath, siblingIndex, _call } = {}) {
  // ……既有 MISSING_PATH 守卫一字不动……
  // R480（D-B1）：`--sibling-index` 是**可选**定位参数。纯 argv 校验必须在任何调用之前收敛
  // （全局约束：用法错只由 argv 决定）。`parseArgs` 裸写给布尔 `true` → 必须显式拒，
  // 否则会被当成 1（静默定位到错的实例）。
  let siblingIndexNum;
  if (siblingIndex !== undefined) {
    if (typeof siblingIndex !== 'string' || !/^\d+$/.test(siblingIndex)) {
      return fail({
        code: 'BAD_SIBLING_INDEX',
        message: `--sibling-index 需要非负整数，收到 ${JSON.stringify(siblingIndex)}`,
        actual: { siblingIndex },
        hint: ['用法：--sibling-index 1（同父同名的第 2 个实例，从 0 起）', '用 `unity scene tree` 的 siblingIndex 字段取值'],
      });
    }
    siblingIndexNum = Number(siblingIndex);
  }
  const payload = { path: nodePath };
  if (siblingIndexNum !== undefined) payload.siblingIndex = siblingIndexNum;
  const r = await (_call || call)('execute-dynamic-code', buildPayloadArgs('node-inspect', payload), { projectPath, env });
  // ……既有 envelopeFromCall / parseScriptResult 一字不动，describeError 里追加两支……
```

`describeError` 追加：

```js
        if (code === 'SIBLING_INDEX_OUT_OF_RANGE') {
          return {
            message: `--sibling-index ${siblingIndexNum} 越界：同父同名的实例只有 ${parsed && parsed.count} 个`,
            actual: { path: nodePath, siblingIndex: siblingIndexNum, count: parsed && parsed.count },
            hint: ['下标从 0 起；用 `unity scene tree` 看同父下有几个同名节点'],
          };
        }
```

成功路径追加 hint（**D-B2**）：

```js
    const envl = ok(res.parsed);
    // R480（D-B2）：命中多个且没给定位参数 → 保持既有「取第一个」行为（不破坏 U42 的既有用法），
    // 但把「你命中的是第几个」变成可见事实 + 给出路。
    if (res.parsed && res.parsed.matchCount > 1 && siblingIndexNum === undefined) {
      return {
        ...envl,
        hint: [
          ...envl.hint,
          `同父同名的实例有 ${res.parsed.matchCount} 个，本次返回的是 siblingIndex=${res.parsed.siblingIndex} 那个 —— 要精确归属请加 --sibling-index <0..${res.parsed.matchCount - 1}>（PITFALLS U42）`,
        ],
      };
    }
    return envl;
```

- [ ] **步骤 6：`lib/envelope.js` 的 `USAGE_FAILURE_CODES` 加 `BAD_SIBLING_INDEX`**

插到 `lib/envelope.js` 的 `'BAD_REMOVE_BG',` 之后；**`test/envelope.test.js:319-326` 的期望数组**里 `'BAD_SIBLING_INDEX'` 必须落在 `'BAD_REMOVE_BG',` 与 `'BAD_SIZE',` 之间（扫描 #5：计划初稿写的「`BAD_SORTING_ORDER` 之后、`BAD_SOURCE` 之前」与字典序自相矛盾 —— `BAD_SI…` < `BAD_SO…`）。数组物理位置不参与断言（测试先 `.sort()`），但**期望数组必须同步**。

> `SIBLING_INDEX_OUT_OF_RANGE` **不进**冻结表（它是运行时事实，退出码 1）。

- [ ] **步骤 7：改 `bin/unity.js`**

handler（`:391-396`）加透传 `siblingIndex: args['sibling-index']`；USAGE 在 `node create / set 选项：` 块里加 `--sibling-index <n>`（注明仅 inspect 用）。

- [ ] **步骤 8：跑全量测试**

运行：`npm test`
预期：PASS（新总数 = 606 + 新增用例数）

- [ ] **步骤 9：真机验证（`.cs` 改动铁律，必做）**

在官方版测试工程上：

```bash
export PI_UNITY_ULOOP_BIN="C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe"
P="C:/Users/<用户>/pi-unity-official-f3c1"
# 造两个同父同名节点（临时，验完必删）
node bin/unity.js node create --project-path "$P" --name M5Sib --json
node bin/unity.js node create --project-path "$P" --name M5Sib --json
node bin/unity.js node inspect --project-path "$P" --path M5Sib --json           # 期望 matchCount=2 + hint
node bin/unity.js node inspect --project-path "$P" --path M5Sib --sibling-index 1 --json   # 期望 siblingIndex=1
node bin/unity.js node inspect --project-path "$P" --path M5Sib --sibling-index 9 --json   # 期望 SIBLING_INDEX_OUT_OF_RANGE / 1
# 清理（两个都要删，且读回确认）
```

**必须记录**：四条命令的**原始 JSON**（落 `docs/m5-probes-raw/`）+ 清理后的 `scene tree` 读回（证明零污染）。

> ⚠️ **清理有坑（扫描 #6）**：`node-delete.cs:13/31` 只 `Find` 一个并 `DestroyImmediate`；删掉一个后**同名兄弟仍在** → `lib/scene.js:983-998` 的读回必然返回 `ok + verified:false`（「删除后节点仍在」）。**这是预期现象，不是 bug**：必须**连删两次**（每次都用 `--sibling-index` 指定，或用 `--path` 配合 `matchCount` 逐步收敛），直到 `scene tree` 读回确认两个都没了。
> 若实现者发现「连删两次」也难以收敛，**停下来汇报**，不要放宽断言。

（真机事实（扫描 #8）：`unity-scripts/node-create.cs` **没有** `NAME_EXISTS` 守卫（`grep` 0 命中，`:22` 直接 `new GameObject(name)`）→ 连发两条 `node create --name M5Sib` **可以**造出同父同名节点。挡路的只有夹具。）

- [ ] **步骤 10：Commit（由控制者执行）**

```bash
git add unity-scripts/node-inspect.cs lib/scene.js lib/envelope.js bin/unity.js test/helpers/fake-scene.js test/scene.test.js test/envelope.test.js
git commit -m "feat(node-inspect): R480 实例唯一定位（--sibling-index + matchCount/instanceId 读回）"
```

---

### 任务 2：⑥ Prefab 读回面纳入 `components`

**文件：**
- 修改：`unity-scripts/prefab-create.cs`、`lib/prefab.js`
- 修改：`test/prefab.test.js`

- [ ] **步骤 1：写失败测试（`test/prefab.test.js` 追加）**

> 🔴 **必须先修夹具（扫描 #2）**：`test/prefab.test.js:33-37` 的 `PREFAB_READ` 夹具**没有 `components` 键**，而 `:27` 的 `SRC_NODE` **有** `components: ['Transform','SpriteRenderer']`。新 `nodeProjection` 一旦把 `components` 带进 intent，actual 缺键 → `lib/readback.js` 必记一条分歧 ⇒ **`:81/108/155/172/210/250/289` 七条既有 `verified:true` 用例全部翻红**。
> **修法**：给 `PREFAB_READ` 夹具补 `components`（与 `SRC_NODE.components` **一致**，这样既有用例语义不变）。这是「mock 与现实同形」（HANDOFF §6）的要求，不是放宽断言。

```js
test('R448：prefab create 的读回面含 components（空节点不再「几乎无内容」）', async () => {
  // 源节点：只有 Transform（空节点）；Prefab 资产读回 components = ["Transform"]
  // intent.components 必须来自源节点的 node inspect 读回面
  // 断言 intent.prefab.components 与 actual.prefab.components 都等于 ['Transform'] 且 verified === true
});

test('R448：源节点有 SpriteRenderer、Prefab 里丢了 → verified:false + components 分歧（真正有鉴别力）', async () => {
  // 这是本任务的核心：空节点场景原来恒 verified:true，加了 components 后
  // 「Prefab 里少/多一个组件」必须能被检出
  // 断言 mismatches 里有 { key: 'prefab.components' }
});

test('nodeProjection：五个字段（含 components），sprite 缺失 → spriteAssetPath null（R448 扩展）', () => {
  // 更新既有 :637 用例：从四字段扩到五字段
});

test('prefab-create.cs 静态契约（剥注释后）：read 模式含 components 读取（R440 范式）', () => {
  // 照 test/prefab.test.js:653-661 的 stripComments 范式，断言
  // 剥注释后源码里含 o["components"] 与 GetComponents<Component>() 的过滤形态
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/prefab.test.js`
预期：FAIL

- [ ] **步骤 3：改 `unity-scripts/prefab-create.cs`（read 模式）**

在 `:85`（`o["guid"]`）之后追加（**不用 LINQ** —— 扫描 #10：本文件**没有** `using System.Linq;`，`.Where(...).Select(...)` 会编译失败（R367 真机必炸）。用显式 foreach，产物与 `node-inspect.cs` 同形）：

```csharp
// R448：把组件的**名字列表**纳入读回面 —— 空节点（默认 transform + 无 sprite）原先的投影
//   四个字段全是常量默认值（name 由 --to 文件名覆盖、position=0,0,0、scale=1,1,1、spriteAssetPath=null），
//   于是任何「空 Prefab」都能满足同一份 intent → verified:true 的证伪力 ≈ 0。
//   口径与 node-inspect.cs:125-126 **同形**（GetComponents<Component>() 过滤 null 后取类型名），
//   这样 intent（来自源节点的 node inspect）与 actual（来自 Prefab 资产）**可以直接逐元素比**。
//   ⚠️ 顺序敏感：compareSubset 对数组是「长度不等即分歧、等长逐元素比」。
//   ⚠️ 本文件没有 `using System.Linq;` → **不要**用 Where/Select/ToArray（会 CS1061 编译失败）。
var comps = new Newtonsoft.Json.Linq.JArray();
foreach (var c in asset.GetComponents<Component>())
{
    if (c != null) comps.Add(c.GetType().Name);
}
o["components"] = comps;
```

- [ ] **步骤 4：改 `lib/prefab.js` 的 `nodeProjection`**

```js
function nodeProjection(node) {
  const n = node && typeof node === 'object' ? node : {};
  const sprite = n.sprite && typeof n.sprite === 'object' ? n.sprite : null;
  const assetPath = sprite && typeof sprite.assetPath === 'string' && sprite.assetPath !== '' ? sprite.assetPath : null;
  return {
    name: n.name,
    position: n.position,
    scale: n.scale,
    spriteAssetPath: assetPath,
    // R448：把源节点的组件名列表带进 intent —— 空节点场景下，这是**唯一**有鉴别力的字段
    // （其余四个都是常量默认值）。口径与 prefab-create.cs 的 read 模式逐字对齐。
    // ⚠️ 源节点**没有** components 字段时（例如手工构造的 actual）写 null 而不是 []：
    // 写 [] 会在 compareSubset 的数组语义下与「Prefab 里一个组件都没有」混淆。
    components: Array.isArray(n.components) ? n.components : null,
  };
}
```

> ⚠️ **必须处理**：`node inspect` 的读回面里 `components` 是**字符串数组**（`node-inspect.cs:125-126`）；但 `prefab-create.cs` 读的是**资产**，资产根**一定有** `Transform` 而源节点若来自 Prefab 实例则组件集合可能不同 —— 这正是要检出的分歧，**不要**做任何归一/排序（归一化会抹掉真实分歧）。

- [ ] **步骤 5：跑全量测试**

运行：`npm test`
预期：PASS

- [ ] **步骤 6：真机验证（`.cs` 改动铁律，必做）**

```bash
P="C:/Users/<用户>/pi-unity-official-f3c1"
node bin/unity.js node create --project-path "$P" --name M5Empty --json          # 空节点（只有 Transform）
node bin/unity.js prefab create --project-path "$P" --from-node M5Empty --to Assets/M5Probe/Empty.prefab --json
# 期望：verified:true 且 intent.prefab.components === actual.prefab.components === ["Transform"]
# ⚠️ 扫描 #9：**不要**用 `node set --patch '{"components":…}'` —— `lib/scene.js:34` 的 PATCH_KEYS
#    只有 name/active/position/scale，`node set` 对 components 明确报 UNKNOWN_PATCH_KEY（退出码 2，
#    `:798-811` 的 hint 自己就写着「加组件用 node create --components」）。改用：
node bin/unity.js node create --project-path "$P" --name M5Sr --components '["SpriteRenderer"]' --json
node bin/unity.js prefab create --project-path "$P" --from-node M5Sr --to Assets/M5Probe/Sr.prefab --json
# 期望：verified:true 且 components === ["Transform","SpriteRenderer"]
# 反向验证（本任务的核心价值）：手工把 Sr.prefab 里的 SpriteRenderer 去掉（或用一个只有 Transform
#   的节点去覆盖同一个 --to 路径），再跑一次 → 期望 verified:false + mismatches 含 prefab.components
# 清理：删两个临时节点与 Assets/M5Probe（读回确认）
```

**必须记录**：原始 JSON 落 `docs/m5-probes-raw/` + 清理读回（零污染）。

- [ ] **步骤 7：Commit（由控制者执行）**

```bash
git add unity-scripts/prefab-create.cs lib/prefab.js test/prefab.test.js
git commit -m "feat(prefab): R448 读回面纳入 components（空节点投影不再恒真）"
```

---

### 任务 3：文档回写 + 账本（由控制者执行）

- [ ] **步骤 1：`docs/PITFALLS.md`**
  - **U42 追加订正注记**（正文末尾）：`--sibling-index` 已可用；并标注「官方版实测」。
  - **追加新条目 U50**（只追加到文件末尾、层级 `###`、**必须标适用引擎**）：`node inspect` 命中多个同名实例时新增 `matchCount` 读回与 hint（D-B2 的 additive 行为）。
  - 索引表同步补 U50 一行。
- [ ] **步骤 2：`skills/unity-game-dev/SKILL.md`**
  - `node inspect` 命令面加 `--sibling-index`；多实例验收段落改为「用 `--sibling-index` 或 `prefab instantiate --name`」。
  - 若有「空节点 Prefab 投影」相关话术，补 `components`。
- [ ] **步骤 3：`README.md`**：命令表 `node inspect` 行加 `--sibling-index`；`prefab create` 行说明读回面含 `components`。
- [ ] **步骤 4：`docs/HANDOFF.md`**
  - §7 backlog：⑤⑥ 标 ✅（附 commit）；§2 测试数更新；§3 里程碑表 M5 行补「批次 B-1」。
- [ ] **步骤 5：跑 `npm test` + Commit**

---

## 5. 自检

| backlog 项 | 对应任务 |
|---|---|
| ⑤ 实例唯一定位 | 任务 1 |
| ⑥ Prefab 读回面纳入 `components` | 任务 2 |
| U42 订正 / R448 关闭 / 新 U 条目 | 任务 3 |
| `.cs` 改动必须真机跑一次 | 任务 1 步骤 9、任务 2 步骤 6 |
| 冻结数组同改 / 退出码单点 / 防假绿 | 全局约束 |

**占位符扫描**：任务 1 步骤 1 的最后一条用例（CLI 级）里写了「实现者照该范式补齐」——这是**明确的实现指引**（范式在 `test/dynamic.test.js:186-198`），不是占位符；任务 2 步骤 6 的「若 `node set` 不支持加组件，改用…」是**二选一的执行分支**，两者都有具体做法。

**类型一致性**：`siblingIndex` / `matchCount` / `instanceId` / `BAD_SIBLING_INDEX` / `SIBLING_INDEX_OUT_OF_RANGE` / `components` 在各任务间同名同形。

---

## 6. 执行方式

**1. 子代理驱动（推荐）** —— 每个任务调度一个新子代理，任务间进行 spec + code 双审
**2. 内联执行**

**起飞前冲突扫描**：只读子代理通读本计划 → 控制者逐条裁定 → 再开工。

---

## 7. 起飞前冲突扫描裁定记录（2026-09-20）

| # | 扫描发现 | 裁定 | 落入 |
|---|---|---|---|
| 1 | 🔴 `unity-scripts/prefab-create.cs` **没有 `using System.Linq;`** → 计划步骤 3 的 `.Where().Select().ToArray()` 会编译失败（R367 真机必炸） | **成立**。改为**显式 `foreach` 建 `JArray`**（零新 using，产物同形） | 任务 2 步骤 3 |
| 2 | 🔴 `test/prefab.test.js:33-37` 的 `PREFAB_READ` 夹具无 `components` → 新 `nodeProjection` 后 **7 条既有 `verified:true` 全翻红**（`:81/108/155/172/210/250/289`） | **成立**。**先修夹具**（补 `components`，与 `SRC_NODE` 一致）再改实现 | 任务 2 步骤 1 |
| 3 | 🔴 任务 2 步骤 6 的 `node set --patch '{"components":…}'` 必落 `UNKNOWN_PATCH_KEY`（`lib/scene.js:34` 的 `PATCH_KEYS` 只有 4 个键；`:798-811`） | **成立**。改用 `node create --components '["SpriteRenderer"]'`，并补一条**反向验证**（去组件后应 `verified:false` + `prefab.components` 分歧） | 任务 2 步骤 6 |
| 4 | 🔴 `test/helpers/fake-scene.js` 扩改：**「有序数组」会让 9 条断言全挂**（`doctor:507/541/705/760`、`golden:52/183/210/222/223` 依赖 `.has`/`.size` 的 key 语义）；且 `:74` 的夹具专用 `NAME_EXISTS` 会拦住「造同父同名」；`:30/35/36` 父子挂接要一并改；`test/scene.test.js` 当前**没有** require 它 | **成立**。**钉死 `Map<path, node[]>`**（保持 key 语义）；改 `NAME_EXISTS` 为「同父下才判重」；用例必须传 `baseScene` + 补 require | 任务 1 步骤 1/3 |
| 5 | 🔴 `test/envelope.test.js:319-326` 期望数组里 `'BAD_SIBLING_INDEX'` 的正确位置是 `'BAD_REMOVE_BG',` 与 `'BAD_SIZE',` 之间（计划初稿文字与字典序自相矛盾） | **成立**。已订正 | 任务 1 步骤 6 |
| 6 | 🟡 任务 1 步骤 9 的清理：第一条 `node delete` 必返回 `verified:false`（同名兄弟仍在，`lib/scene.js:983-998`） | **成立**（预期现象，非 bug）。已写明「连删两次 + 读回确认」 | 任务 1 步骤 9 |
| 7 | 🟡 `test/helpers/fake-scene.js:23-24` 行号不实（`:25` 才是 `nodes.get(p)`；`new Map()` 在 `:17`）；`withScriptedDispatcher` 实际定义在 `test/scene.test.js:91`（不是 `test/dynamic.test.js:186-198`） | **成立**。已订正引用 | 任务 1 步骤 1/3 |
| 8 | 🟡 任务 1 步骤 1 最后一条 CLI 用例体内是占位注释（只跑 `--help`，测不到透传接线） | **成立**。已写成**具体可执行**的用例（假 dispatcher 回显 `siblingIndex:1`，断言 `actual.siblingIndex === 1`） | 任务 1 步骤 1 |
| 9 | ✅ `lib/scene.js:411-413` 确认 `describeError(code, parsed)` 的 `parsed` 是**整个** `__error` 载荷对象 → 计划的 `parsed.count` 可取 | 无需改（计划推断正确） | — |
| 10 | ✅ `unity-scripts/node-create.cs` **无** `NAME_EXISTS` 守卫 → 真机可造同父同名 | 无需改（挡路的只有夹具） | 任务 1 步骤 9 |
| 11 | ✅ `test/prefab.test.js:658-660` 的 `stripComments` **剥 `/* */`**（比 `test/sprite-assign.test.js:267` 只剥 `//` 更强）→ 新静态契约用例照前者 | 无需改 | 任务 2 步骤 1 |
| 12 | ✅ `nodeInspect` 的既有调用点（`bin/unity.js:394`、`lib/prefab.js:155`、`lib/scene.js:502/973`）都不传新形参 → 新增可选形参零影响 | 无需改 | — |
| 13 | ⚠️ 执行期（b1r1）发现：计划正文把 `--sibling-index` 定为「同名命中列表下标」，但读回字段 `siblingIndex` 是 `GetSiblingIndex()` **真实子序号** —— 父下有异名兄弟时二者不等，**参数名会说谎**（真机实证：两个同名节点真实序号为 `3/5`，旧语义却要传 `1`） | **改语义（成立）**：`--sibling-index` = `transform.GetSiblingIndex()` 真实值（与 `scene tree` 的 `siblingIndex` 字段、与 D-B1 理据同口径）；越界回 `SIBLING_INDEX_OUT_OF_RANGE` + `available`（真实序号列表，可自修）+ 文案改「路径命中 N 个（可能来自不同父）」（`matches` 按 path 段匹配，可跨父） | 任务 1 步骤 4/5；U50 记入任务 3 |
| 14 | ⚠️ 执行期（b1r1）发现：夹具 `test/helpers/fake-scene.js` 的 `NAME_EXISTS` 守卫在 `Map<path,node[]>` 模型下**与真机冲突** —— 真机 `unity-scripts/node-create.cs` **无**此守卫、允许同父同名叠加（本任务的真机验证正需造同父同名），而 R292 立此守卫的动机（path-keyed Map 会静默覆盖同一 key）已被数组模型消除 | **删除该守卫（成立）**：夹具与真机同形；**取代 M2 R292**，由任务 3 在 `docs/M2-DECISIONS.md` 追加取代注记 | 任务 1 步骤 3；任务 3 |
| 15 | 复审（b1r2/b1r3）落地细节，均已由 code 审复核：① `lib/scene.js` argv 范围守卫 `Number.isSafeInteger && <=2147483647`（封 400 位/`3000000000` 假绿）；② 夹具 `order`+`childSeq` 按**父分组创建序**填真实子序；③ `.cs` `NOT_FOUND` 前回退 `GameObject.Find`（不窄化跨场景可查范围）+ 不给键时 Find 优先回插；④ 夹具 `node-delete` 一次只删一个 + `activeFirst`（与真机 Find 激活优先同形）；⑤ 扩展 `test/scene.test.js:793` 的 `.cs` 协议 tripwire（载荷存在性/真实序号选择/错误码/三读回字段/`CollectByPath` 改名） | 全部**成立并落地**（新增均为「测试有牙」与夹具保真度，不改变对外契约）；`.cs` 每次改动均重跑真机 | 任务 1（b1r2/b1r3 修复轮） |

---

## 8. 执行结果与计划偏差（2026-09-20）

**结论：任务 1 / 任务 2 / 任务 3 全部完成；`npm test` 606 → 619（+13）；提交 `01b0b70`（任务 1）· `08861fc`（任务 2）· 任务 3 文档回写（另一次提交）。**

### 8.1 偏离计划的地方（均已由 spec/code 双审交叉确认）

| # | 计划写的 | 实际做的 | 理由 |
|---|---|---|---|
| 1 | 任务 1 步骤 4：`--sibling-index` = 「同名命中列表下标」，取 `matches[n]` | 改为 **真实 `transform.GetSiblingIndex()`**（见 §7 #13） | 原语义「参数名说谎」（真机序号 `3/5`，却要传 `1`）；D-B1 理据本就是 `scene tree` 的 `siblingIndex` |
| 2 | 任务 1 步骤 3：`NAME_EXISTS`「改成同父下才判重」 | **删除**该守卫（见 §7 #14） | 真机 `node-create.cs` 无此守卫且允许同父同名；`Map<path,node[]>` 已消除 R292 担忧 |
| 3 | 任务 1 步骤 4：统一 DFS 收集，默认取 `matches[0]` | `.cs` 额外**保留 `GameObject.Find` 优先**（不给键时回插首位）+ `NOT_FOUND` 前 Find 兜底 | 不改 U42 既有默认行为；DFS 只覆盖激活场景，Find 还能命中其它已加载场景 / DontDestroyOnLoad 的激活对象 |
| 4 | 任务 2 步骤 6：反向验证 =「用只有 Transform 的节点 `--force` 覆盖同一 `--to` → 期望 `verified:false`」 | 该路线实测 **`verified:true`**（`SaveAsPrefabAsset` 覆盖=替换内容，写后读回必然自洽）→ 改用「源节点加 `HideFlags.DontSave` 的 `BoxCollider`」拿到真 `verified:false`（`mismatches` 仅 `prefab.components`） | 计划文本对该事实的推断错误；替代路径提供等价（且更精确）的鉴别力证据，已落 U51 |

### 8.2 真机验收（Unity 官方中国版 2022.3.62f3c1；团结复测延后）

- **任务 1**（`b1-*` / `b1r1-*` / `b1r2-*` / `b1r3-*`）：交错同名（真实序号 `3/5`）定位正确、越界回 `available:[3,5]`、默认 `Find` 激活优先、清理零污染。
- **任务 2**（`b1t2-*`）：空节点与 SpriteRenderer 均 `verified:true` 且 `components` 一致；反向（`DontSave` BoxCollider）`verified:false` 且 `mismatches` 仅 `prefab.components`；清理零污染。

### 8.3 测试与审查

- `npm test`：**619/619 绿**（基线 606，+13：任务 1 +10、任务 2 +3）。
- 审查：任务 1 经 **spec + code 双审 + 3 轮修复**（b1/b1r1/b1r2/b1r3）；任务 2 经 **spec + code 双审 + 1 轮注释收尾**。
