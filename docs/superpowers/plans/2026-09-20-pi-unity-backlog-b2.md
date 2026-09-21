# pi-unity backlog 批次 B-2 实现计划（④ `--world-size` 边界真机钉死 + UI `Image` 假绿修正）

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 关闭 `docs/HANDOFF.md` §7 backlog **④ 中官方版能做的那半**（`Tight`/`Sliced`/`Tiled` + UI `Image`）—— 把 `unity sprite assign --world-size` 在这些形态下的行为真机钉死并文档化；并修掉探测新发现的**真 bug**：节点上只有 UI `Image` 时 `sprite assign` **静默加 `SpriteRenderer` 且假绿**。**图集（SpriteAtlas / `Multiple`）那半需团结 `com.unity.2d.sprite`，本批次如实记为「延后」。**

**架构：** 探测（只读侦察）已完成，事实见 `docs/m5-probes-raw/b2-REPORT.md` 与 `b2-*` 原始 JSON。结论：① `drawMode=Sliced/Tiled` 下写读两侧分叉并**如实落 `verified:false`**（不是假绿）→ **不改代码，只文档化 + 改 `mismatchHint`**；② `Tight` 是资产侧 `spriteMeshType`，按 U34 不裁几何 → 本批次**补一条真机探针**钉死；③ UI `Image` 假绿是**真 bug**（读回面只读 `SpriteRenderer`）→ `sprite-assign.cs` 加「有 `Image` 无 `SpriteRenderer` 则拒」的守卫（**反射**探测 UI 类型，零编译期依赖），JS 侧映射成运行时码 `UI_IMAGE_PRESENT`（退出码 1）+ hint。

**技术栈：** Node.js ≥ 21（CommonJS，`node --test`，零依赖）+ Unity C# 载荷脚本。

**规格：** `docs/HANDOFF.md` §7 backlog ④ + `docs/PITFALLS.md` U34/U43 + `docs/M4-DECISIONS.md` R404 + `docs/m5-probes-raw/b2-REPORT.md`。本计划 §2 的探测结论是事实基础。

**引擎：** **官方版 `2022.3.62f3c1`**（测试工程 `C:/Users/<用户>/pi-unity-official-f3c1`，编辑器已在跑）。**图集半需团结 → 本批次延后**（不冒充「两者」）。

---

## 全局约束

（逐字来自 `docs/HANDOFF.md` §6 与 `package.json`）

- 零第三方依赖（只用 `node:*` 与 `node --test`）；不 fork uloop。
- **`verified` 语义不许扩张**：只有「写后读回比对 intent vs actual」才置 `true/false`；无 intent 的读/执行命令恒 `null`。
- **退出码单点**：`lib/envelope.js` 的 `exitCodeFor` 是唯一判定处；**用法错只由 argv 决定**、在任何写盘/调用之前收敛。
- `USAGE_FAILURE_CODES` 是**冻结数组**；新增用法错码要同时改它 + `test/envelope.test.js` 的**排序后全等**断言。**运行时码（退出码 1）不进冻结表。**
- **防假绿三道线**：① `ULOOP_TRUNCATED` 绝不产 `ok:true`；② 磁盘硬证据；③ **读回投影必须与 intent 同形**。
- ⭐ **凡改动/新增 `.cs` 分支，必须真机跑一次**（R367）。**静态契约测试测不出编译错误。**
- ⭐ **一次只发一条 `unity` 命令（含只读）**（U46/U49：uloop 单飞）；**不许碰** `<真实工程>`。
- 真机验证不得污染：临时节点/资产/导入设置要复原并读回确认。
- **`.cs` 静态契约要有牙**：断言**剥注释后**的源码（先剥 `/* */` 再剥 `//`，范式见 `test/prefab.test.js`）。
- 新增 `docs/PITFALLS.md` 条目**只追加到文件末尾、编号由文档任务统一**，**必须标适用引擎**。
- ⭐ **控制者不要手改实现/测试代码**（R372）。
- ⭐ **不要把 `npm test` 串在 `&&` 链中间、后面还跟一个总是成功的 `grep`**。
- **测试数据（mock）要与现实同形**。
- 测试里不要用 `.` + `$` 匹配行尾（**工作树当前全是 CRLF**）。
- `npm test` 基线 = **619/619**；每个任务结束必须全绿。

---

## 1. 决策点（需人类伙伴批准）

| # | 决策 | 备选 | 推荐 |
|---|---|---|---|
| **D-B2-1** | 节点有 UI `Image` 且**无** `SpriteRenderer` 时 `sprite assign` 的行为 | (a) **硬失败**新增运行时码 `UI_IMAGE_PRESENT`（退出码 1）+ hint；(b) 继续加 `SpriteRenderer`，但 actual 旁路回传 `uiImage` 信号；(c) 不改，仅文档 | **(a)** —— (c) 就是现在的假绿；(b) 仍返回 `ok:true`，agent 读 `verified:true` 不会去看旁路字段；(a) 是唯一「不许谎报」解 |
| **D-B2-2** | `drawMode=Sliced/Tiled` 的分叉是否改代码 | (a) 只文档化 + `mismatchHint` 提及 `drawMode`；(b) assign 时若 `drawMode≠Simple` 拒绝；(c) assign 时把 `drawMode` 归零 | **(a)** —— 分叉落 `verified:false` 已是**诚实**行为（不是假绿）；(b)(c) 会替用户改他手工设的渲染模式，越权且盖住事实 |
| **D-B2-3** | 图集（SpriteAtlas / `Multiple`）半 | (a) 切团结做；(b) 延后 | **(b)** —— 需 kill 用户正在跑的官方版编辑器，且 `com.unity.2d.sprite` 只在 S0Project；本批次如实记「延后」 |
| **D-B2-4** | `Tight`（backlog ④ 原文点名，非图集） | (a) 官方版补真机探针钉死；(b) 仅引 U34 断言「不新增风险」 | **(a)** —— `SpriteMeshType` 是基础引擎类型，官方版能探；backlog 原文点了它，只靠推断不够 |

**已由控制者先行裁定（人类伙伴仅回「要」，未否决）**：按推荐执行（a/a/b/a）；图集半在任务 3 的 HANDOFF §7 里如实标「官方半完成（`Tight`/`Sliced`/`Tiled` + UI `Image`）/ 团结半延后」，**不冒充「两者」**。

---

## 2. 侦察结论（真机事实，2026-09-20，官方版 2022.3.62f3c1）

**资产**：`Assets/Art/hero-blind.png`，ppu=16，`sprite.bounds.size = {0.375, 0.25}`（6×4 纹理）。
**证据落盘**：`docs/m5-probes-raw/b2-*`（39 份）+ `docs/m5-probes-raw/b2-REPORT.md`。

| 事实 | 证据 |
|---|---|
| **Simple + `--world-size 2,1`** → `verified:true`；`sr.size == sprite.bounds == {0.375,0.25}`、`sr.bounds == {2,1}` | `b2-a4-assign-simple.json` · `b2-a4b-dump-simple-after.json` |
| **切 `drawMode=Sliced`（不动 `sr.size`）** → 再 assign 仍 `verified:true`（两侧恰好不叉） | `b2-a6-assign-sliced.json` |
| **`sr.size=5,5`（Sliced）** → assign `--world-size 2,1` **`verified:false`、退出码 1**；`mismatches`: `sprite.worldSize.x 2→26.6667`、`.y 1→20` | `b2-a7c-assign-sliced-size5.json` |
| **Tiled（`sr.size=5,5`）** → 与 Sliced **完全相同** 的两条 mismatch | `b2-a8c-assign-tiled-size5.json` |
| 分叉机制：**Sliced/Tiled 下 `sr.bounds.size = sr.size × lossyScale`**（`5×5.3333=26.6667`、`5×4=20`），写侧用的是 `sp.bounds.size` | `b2-a7b` / `b2-a8b` |
| **UI `Image` 假绿成立**：`node` 只有 `UnityEngine.UI.Image`、无 `SpriteRenderer` → `sprite assign` **`verified:true`**，`actual.components` **多出 `SpriteRenderer`**，而事后 `Image.sprite` **仍为 `null`** | `b2-b11-assign-ui.json` · `b2-b12-dump-ui-after.json` |
| UI 组件短名 `Image` 在 `node create --components` 里 → `COMPONENT_TYPE_NOT_FOUND`；**全名 `UnityEngine.UI.Image` 才行** | `b2-b9-try-create-m5ui-fullname.json` · `b2-b9-create-m5ui-image.json` |
| **`Tight` 未在本轮探针里单列**（U34 已实测「`Tight` 不裁几何」，U43 仍登记为未探测）→ 任务 2 补探 | U34 · `docs/PITFALLS.md:66/1637` |

**结论**：④ 的官方半**大部分不需要改 drawMode 相关代码**（分叉已诚实落 `verified:false`，只需文档化 + hint）；`Tight` 补探；真正要修的是 **UI `Image` 假绿**。

---

## 3. 文件结构

| 文件 | 职责 | 本批次动作 |
|---|---|---|
| `unity-scripts/sprite-assign.cs` | sprite 挂载载荷 | 修改：UI `Image` 守卫（反射探测 + `UI_IMAGE_PRESENT`） |
| `lib/sprite.js` | sprite 面 | 修改：`describeError` 加 `UI_IMAGE_PRESENT` 支 + `mismatchHint` 提 `drawMode` |
| `test/sprite-assign.test.js` | `spriteAssign` 全套测试 + `.cs` 静态契约（**既有**） | 修改：JS 用例 + 扩既有静态契约的码集合/顺序断言 |
| `docs/PITFALLS.md` · `README.md` · `skills/unity-game-dev/SKILL.md` · `docs/HANDOFF.md` · `docs/M5-PROBES.md` | 文档/账本 | 任务 3 |

> ⚠️ 本仓**已有** `test/sprite-assign.test.js`（含 `fakeCall`/`sequenceCall`/`READBACK`/`inspectEnvelope` 与 `sprite-assign.cs` 静态契约，`:244`）。**新用例与 tripwire 一律加到该文件**（不要另起炉灶，也不要加进 `test/sprite.test.js`）。

---

## 4. 任务

### 任务 1：UI `Image` 假绿修正（`UI_IMAGE_PRESENT`，R481）

**文件：**
- 修改：`unity-scripts/sprite-assign.cs`、`lib/sprite.js`
- 修改：`test/sprite-assign.test.js`

- [ ] **步骤 1：写失败测试（`test/sprite-assign.test.js` 追加）**

在文件末尾（静态契约测试之后）追加：

```js
test('R481：节点只有 UI Image（无 SpriteRenderer）→ UI_IMAGE_PRESENT（运行时码 1，不谎报成功）', async () => {
  // .cs 侧用反射探测 UI Image 后返回该码；这里测 JS 契约：码 → 信封 code/退出码/hint
  const call = fakeCall({ Success: true, Result: JSON.stringify({ __error: 'UI_IMAGE_PRESENT', component: 'Image' }) });
  const e = await spriteAssign({ projectPath: 'P', path: 'M5UI', asset: ASSET, _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'UI_IMAGE_PRESENT');
  assert.strictEqual(exitCodeFor(e), 1, '「节点上是 UI Image」是运行时事实，不是 argv 形状错');
  assert.ok(e.hint.some((h) => h.includes('SpriteRenderer')), 'hint 必须说明本命令只挂 SpriteRenderer');
  assert.ok(e.hint.some((h) => h.includes('Image')), 'hint 必须点名 UI Image');
  assert.notStrictEqual(e.verified, true, '绝不谎报 verified:true');
});
```

并在**既有**静态契约测试（`test/sprite-assign.test.js:244` 起）里：
1. 把 `for (const code of ['BAD_PAYLOAD', …, 'COMPONENT_ADD_FAILED'])` 数组**追加 `'UI_IMAGE_PRESENT'`**；
2. 在该测试末尾追加两条（用已剥注释的 `csCode`）：
```js
  assert.match(csCode, /UnityEngine\.UI\.Image,\s*UnityEngine\.UI/, '必须用程序集限定名反射探测 UI Image（零编译期依赖）');
  assert.ok(
    csCode.indexOf('"UI_IMAGE_PRESENT"') < csCode.indexOf('AddComponent<SpriteRenderer>'),
    'Image 守卫必须在 AddComponent<SpriteRenderer> 之前（否则读到假绿）',
  );
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/sprite-assign.test.js`
预期：FAIL —— `UI_IMAGE_PRESENT` 未映射（落兜底 hint）、`.cs` 无该标记

- [ ] **步骤 3：改 `unity-scripts/sprite-assign.cs`**

把这一段（现 `:80-88`）：

```csharp
var sr = go.GetComponent<SpriteRenderer>();
if (sr == null) sr = go.AddComponent<SpriteRenderer>();
if (sr == null)
{
    var addErr = new Newtonsoft.Json.Linq.JObject();
    addErr["__error"] = "COMPONENT_ADD_FAILED";
    addErr["component"] = "SpriteRenderer";
    return addErr.ToString(Newtonsoft.Json.Formatting.None);
}
```

**整段替换成**（⚠️ 含 `COMPONENT_ADD_FAILED` 分支，一个字都不能丢）：

```csharp
var sr = go.GetComponent<SpriteRenderer>();
if (sr == null)
{
    // R481（B-2 D-B2-1）：节点上只有 UI `Image`（没有 SpriteRenderer）时，旧实现会**静默
    //   AddComponent<SpriteRenderer>()** —— sprite 挂到新组件、`Image` 原封不动，而读回面
    //   （node-inspect.cs）只读 SpriteRenderer → `verified:true` **假绿**（真机实证 b2-b11）。
    //   用**反射**探测 UI Image：零编译期依赖（不 `using UnityEngine.UI`、不加 asmdef）。
    //   解析范式照 node-create.cs:62-73（Type.GetType → 扫已加载程序集）。
    System.Type uiImageType = System.Type.GetType("UnityEngine.UI.Image, UnityEngine.UI");
    if (uiImageType == null)
    {
        foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
        {
            uiImageType = asm.GetType("UnityEngine.UI.Image");
            if (uiImageType != null) break;
        }
    }
    var uiImage = uiImageType != null ? go.GetComponent(uiImageType) : null;
    if (uiImage != null)
    {
        var uiErr = new Newtonsoft.Json.Linq.JObject();
        uiErr["__error"] = "UI_IMAGE_PRESENT";
        uiErr["component"] = "Image";
        return uiErr.ToString(Newtonsoft.Json.Formatting.None);
    }
    sr = go.AddComponent<SpriteRenderer>();
}
if (sr == null)
{
    var addErr = new Newtonsoft.Json.Linq.JObject();
    addErr["__error"] = "COMPONENT_ADD_FAILED";
    addErr["component"] = "SpriteRenderer";
    return addErr.ToString(Newtonsoft.Json.Formatting.None);
}
```

⚠️ **变量名不得与既有局部量重名**（CS0136：uloop 顶层语句同域；`asm`/`uiImageType`/`uiImage`/`uiErr` 全仓仅此一处）。⚠️ **局部函数不得加 `static`**（CS8421）。⚠️ `GetComponent(System.Type)` 在 `node-create.cs:95` 有先例。

- [ ] **步骤 4：改 `lib/sprite.js` 的 `describeError`**

在 `AMBIGUOUS_SPRITE` 支（约 `:266-275`）之后追加：

```js
      if (code === 'UI_IMAGE_PRESENT') {
        return {
          message: `节点上只有 UI Image、没有 SpriteRenderer：${nodePath}`,
          actual: { path: nodePath, component: (parsed && parsed.component) || 'Image' },
          hint: [
            '`sprite assign` 只挂 `SpriteRenderer`，不处理 UI `Image`（Canvas 下的图片走 UI 管线）',
            '确实要在该节点挂 SpriteRenderer：先删掉 / 挪走 UI `Image`，或换个非 UI 节点',
            '要设 UI `Image.sprite`：本包暂无该命令（backlog）—— 用 `unity exec` 直接赋值',
          ],
        };
      }
```

- [ ] **步骤 5：跑测试**

运行：`node --test test/sprite-assign.test.js`（预期 PASS）→ 再 `npm test`（**预期 620**：619 + 1 条新 JS 用例；tripwire 是扩既有用例，不增数）

- [ ] **步骤 6：真机验证（`.cs` 改动铁律，必做）**

```bash
export PI_UNITY_ULOOP_BIN="C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe"
P="C:/Users/<用户>/pi-unity-official-f3c1"
unity node create --project-path "$P" --name M5UI --components '["UnityEngine.UI.Image"]' --json
unity sprite assign --project-path "$P" --path M5UI --asset Assets/Art/hero-blind.png --json   # 期望 code=UI_IMAGE_PRESENT / exit 1
unity exec --project-path "$P" --json --code '…读该节点 components…'                          # 期望**不含** SpriteRenderer（证明守卫在 AddComponent 之前）
unity node create --project-path "$P" --name M5Plain --json
unity sprite assign --project-path "$P" --path M5Plain --asset Assets/Art/hero-blind.png --world-size 2,1 --json  # 期望 verified:true（既有路径未误伤）
# 清理 M5UI / M5Plain（读回确认零污染）
```

**必须记录**：原始 JSON 落 `docs/m5-probes-raw/`（前缀 `b2t1-`）+ 清理读回。

- [ ] **步骤 7：Commit（由控制者执行）**

```bash
git add unity-scripts/sprite-assign.cs lib/sprite.js test/sprite-assign.test.js
git commit -m "fix(sprite): R481 UI Image 假绿 —— 有 Image 无 SpriteRenderer 时拒（UI_IMAGE_PRESENT）"
```

---

### 任务 2：`Tight` 补探 + `drawMode=Sliced/Tiled` 限制文档化 + `mismatchHint`（R482）

**文件：**
- 修改：`lib/sprite.js`、`test/sprite-assign.test.js`
- 修改：`docs/PITFALLS.md`、`skills/unity-game-dev/SKILL.md`（也可与任务 3 一起收口）

- [ ] **步骤 1：写失败测试（`test/sprite-assign.test.js` 追加）**

```js
test('R482：worldSize 不一致时 mismatchHint 必须点出 drawMode=Sliced/Tiled 这条成因', async () => {
  // 写成功 + 读回 worldSize 与 intent(2,1) 不等（模拟 drawMode=Sliced 下 sr.bounds = sr.size × scale）
  const call = sequenceCall([WRITTEN, inspectEnvelope({ worldSize: { x: 26.6667, y: 20 } })]);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, worldSize: '2,1', _call: call });
  assert.strictEqual(e.verified, false);
  assert.ok(e.hint.some((h) => h.includes('drawMode')), 'mismatchHint 必须提及 SpriteRenderer.drawMode（Sliced/Tiled 下 sr.bounds = sr.size × scale）');
});
```

- [ ] **步骤 2：运行验证失败** → `node --test test/sprite-assign.test.js` 预期 FAIL（hint 无 `drawMode`）

- [ ] **步骤 3：改 `lib/sprite.js` 的 `mismatchHint`**

在既有「worldSize 不符说明父级有缩放/旋转…」句后**追加**（不要删旧内容）：

> `；或 **SpriteRenderer.drawMode 不是 Simple**（Sliced/Tiled 下 `sr.bounds.size = sr.size × scale`，与写侧用的 `Sprite.bounds` 是两个量 —— 真机实测 `docs/m5-probes-raw/b2-REPORT.md`；把 drawMode 改回 Simple 再 assign，或用 `shot`+`pixels` 判几何）`

- [ ] **步骤 4：`Tight` 真机补探（backlog ④ 原文点名）**

在官方版工程上（**会改导入设置，必须复原**）：
1. 记 `Assets/Art/hero-blind.png` 当前 `TextureImporter.spriteMeshType`（基线，应为 `FullRect`）。
2. `unity exec`：`spriteMeshType = SpriteMeshType.Tight` + `SaveAndReimport()`，返回新值。
3. `unity node create --name M5Tight --components '["SpriteRenderer"]'` + `sprite assign --world-size 2,1` → 记结果（**预期 `verified:true`**：U34 实测 `Tight` 不裁几何 → `Sprite.bounds` 与 FullRect 同 → 写读恒等）。
4. **复原**：`spriteMeshType = FullRect` + `SaveAndReimport()`，读回确认；删 `M5Tight`。
5. 原始 JSON 落 `docs/m5-probes-raw/`（前缀 `b2t2-tight-`）。若结果与预期不符（例如 `verified:false`），**停下汇报**，不要放宽断言。

- [ ] **步骤 5：跑全量测试** → `npm test`（**预期 621**：620 + 1）

- [ ] **步骤 6：写 `docs/PITFALLS.md` 新条目（只追加到文件末尾，层级 `###`，**标适用引擎**）**

- **U52**：`sprite assign --world-size` 在 `SpriteRenderer.drawMode=Sliced/Tiled` 下会（预期地）落 `verified:false` —— 写侧用 `Sprite.bounds`、读侧 `sr.bounds.size = sr.size × scale`；仅当 `sr.size == sprite.bounds` 时才一致。出路：只对 `drawMode=Simple` 用 `--world-size`，或改回 Simple 再 assign，或改用 `shot`+`pixels`。
- **U53**：节点上**只有 UI `Image`** 时 `sprite assign` 会静默加 `SpriteRenderer` 并假绿（已修 R481：现在落 `UI_IMAGE_PRESENT`，退出码 1）；顺带：`node create --components` 的 UI 组件要用**全名** `UnityEngine.UI.Image`（短名 `Image` → `COMPONENT_TYPE_NOT_FOUND`）。

- [ ] **步骤 7：写 SKILL 限制（`skills/unity-game-dev/SKILL.md` §3.6 `sprite assign` 段）**

加三行：① `--world-size` 只在 `drawMode=Simple` 下有定义（Sliced/Tiled 会 `verified:false`，见 U52）；② `Tight` 不裁几何、对 `--world-size` 无影响（U34）；③ UI 节点走 UI 管线，`sprite assign` 不处理 `Image`（有 Image 无 SpriteRenderer → `UI_IMAGE_PRESENT`，见 U53）。

- [ ] **步骤 8：Commit（由控制者执行）**

```bash
git add lib/sprite.js test/sprite-assign.test.js docs/PITFALLS.md skills/unity-game-dev/SKILL.md docs/m5-probes-raw/
git commit -m "docs(sprite): R482 drawMode=Tight/Sliced/Tiled 的 --world-size 限制（U52）+ UI Image 假绿修正（U53）"
```

---

### 任务 3：文档回写 + 账本 + 计划收尾（由控制者执行）

- [ ] **步骤 1：`docs/PITFALLS.md`**
  - 索引表同步补 **U52/U53** 两行。
  - **U43 追加订正注记**（正文末尾）：`Tight`/`Sliced`/`Tiled` 已由 B-2 真机钉死（`Tight` 同 FullRect，`Sliced/Tiled` 分叉落 `verified:false`），引 **U52** + `docs/m5-probes-raw/b2-a7c`/`b2-a8c`/`b2t2-tight-*`；**仅图集（SpriteAtlas/Multiple）仍为未探测**。
- [ ] **步骤 2：`docs/M5-PROBES.md`** 加 **§9 批次 B-2 探测**（drawMode 分叉机制 + `Tight` + UI Image 假绿 + 证据清单 `b2-*`）。
- [ ] **步骤 3：`docs/HANDOFF.md`**
  - §2：测试数刷到实际；§3：加「M5 批次 B-2（官方半）」里程碑行。
  - §7 backlog ④：标 **「✅ 官方半完成（`Tight`/`Sliced`/`Tiled` + UI `Image`）；⏸ 图集半需团结，延后」**（附 commit）。
- [ ] **步骤 4：`README.md`** 命令面若涉及 `sprite assign` 则补一句 UI 限制。
- [ ] **步骤 5：本计划 §7/§8** 补「冲突扫描裁定」与「执行结果与偏差」。
- [ ] **步骤 6：跑 `npm test` + Commit（+ 收尾时按惯例打 tag，若人类伙伴要）**

---

## 5. 自检

| backlog 项 | 对应任务 |
|---|---|
| ④ 官方半：`Tight`/`Sliced`/`Tiled` 真机探测 + 文档化 | 任务 2（`Sliced/Tiled` 结论来自 §2；`Tight` 步骤 4 补探） |
| ④ UI `Image` 假绿 | 任务 1 |
| ④ 图集半 | **延后**（任务 3 如实登记，不冒充） |
| `.cs` 改动必须真机跑一次 | 任务 1 步骤 6 |
| 冻结数组/退出码单点/防假绿 | 全局约束（`UI_IMAGE_PRESENT` 为运行时码 1，不进冻结表） |

**占位符扫描**：本计划的 `…`/`…读该节点 components…` 是**真机命令指引**（照 `docs/m5-probes-raw/b2-b10-dump-ui-initial.json` 的 exec 范式），不是待填占位符；`R481`/`R482` 已钉死（当前最大 R = R480）。
**类型一致性**：`UI_IMAGE_PRESENT` 在 `.cs`/`lib/sprite.js`/测试间同名；`drawMode` 仅出现在 hint/文档，不进 intent/载荷。
**命名一致性**：测例前缀用 `R481`（任务 1）/`R482`（任务 2）。

---

## 6. 执行方式

**1. 子代理驱动（推荐）** —— 每个任务调度一个新子代理，任务间进行 spec + code 双审
**2. 内联执行**

**起飞前冲突扫描**：见 §7。

---

## 7. 起飞前冲突扫描裁定记录（2026-09-20）

| # | 扫描发现 | 裁定 | 落入 |
|---|---|---|---|
| 1 | 🔴 任务 1 步骤 3 的 C# 代码块若留空 `if (sr == null) { …占位… }`，逐字粘贴会**删掉 `COMPONENT_ADD_FAILED` 分支** → `test/sprite-assign.test.js:275` 翻红 + 真机 `sr==null` 时 `oldSprite = sr.sprite` NRE | **成立**。已把**完整替换段**（含 `addErr` 分支）写进计划 | 任务 1 步骤 3 |
| 2 | 🔴 backlog ④ 原文含 `Tight`，计划全文未提 → 却要在任务 3 盖「官方半完成」 | **成立**。新增 **D-B2-4**：官方版**补一条 `Tight` 真机探针**（`SpriteMeshType` 是基础引擎类型） | §1 D-B2-4；任务 2 步骤 4 |
| 3 | 🔴 `docs/PITFALLS.md` U43 仍写「`Tight`/`Sliced`/`Tiled` 与图集未探测」→ 与 B-2 结论自相矛盾 | **成立**。任务 3 加 **U43 订正注记**（引 U52 + 真机证据），只留图集为未探测 | 任务 3 步骤 1 |
| 4 | 🟡 本仓**已有** `test/sprite-assign.test.js`（含 `spriteAssign` 全套 + `.cs` 静态契约），计划却指向 `test/sprite.test.js` | **成立**。§3 与任务 1/2 全部改指 `test/sprite-assign.test.js`；tripwire **扩既有静态契约**，不另起一套 | §3；任务 1 步骤 1；任务 2 步骤 1 |
| 5 | 🟡 `R48x` 是未定编号占位符 | **成立**。钉死为 **R481**（UI Image）/ **R482**（drawMode+Tight） | 任务 1/2 |
| 6 | 🟡 计划 §5 引用了本文件不存在的 `nodeResult` | **成立**。改为既有 `sequenceCall`/`READBACK`/`inspectEnvelope` | 任务 2 步骤 1 |
| 7 | 🟡 反射探测只写程序集限定名、无兜底；`node-create.cs:62-73` 有 `AppDomain` 兜底范式 | **成立**。照抄该范式（同风险模型） | 任务 1 步骤 3 |
| 8 | 💡 任务 1「619+2」与任务 2「619+3」口径冲突 | **成立**。统一为**累计** 620（任务 1）/ 621（任务 2） | 任务 1 步骤 5；任务 2 步骤 5 |
| 9 | ✅ `.cs` 插入点/变量名无 CS0136/`Image+SR 并存不误伤`/`UI_IMAGE_PRESENT` 退出码=1/`lib/sprite.js` 引用逐字对上/`M5-PROBES` §9/Tight 理由 —— 实跑与引用核对均通过 | 无需改 | — |

---

## 8. 执行结果与计划偏差（2026-09-20）

**结论：任务 1 / 任务 2 / 任务 3 全部完成；`npm test` 619 → 621（+2）；提交 `a2f60e4`（任务 1+2：代码/测试/U52/U53）+ 任务 3 文档回写（另一次提交）。**

### 8.1 偏离计划的地方（均已由冲突扫描/双审交叉确认）

| # | 计划写的 | 实际做的 | 理由 |
|---|---|---|---|
| 1 | 任务 1、任务 2 各一个 commit | **合并为一个**（`a2f60e4`） | `lib/sprite.js` 与 `test/sprite-assign.test.js` 同时被两任务改动，无法干净拆分 |
| 2 | 任务 2 步骤 4 用 `((TextureImporter)…).spriteMeshType` 读写 | 改用 `ReadTextureSettings`/`SetTextureSettings` 往返 | `spriteMeshType` 在 `TextureImporterSettings` 上，直接访问 CS1061（U28 已记录的坑）；结果仍为预期 `verified:true` |
| 3 | 复审 🟡：`bin/unity.js --help` 缺 `UI_IMAGE_PRESENT`/drawMode | 已补（同批次） | 可发现性 |
| 4 | `docs/PITFALLS.md` U53 证据文件名标签互换 / U34 官方「待复测」过期 | 已订正 | 事实错误（复审抓到） |
| 5 | 图集半 | **延后**（任务 3 如实登记，不冒充） | 需团结 `com.unity.2d.sprite`（官方工程 `Packages/manifest.json` 无 `com.unity.2d.*`） |

### 8.2 真机验收（官方版 2022.3.62f3c1）

- **drawMode**（`b2-a*`）：Simple `verified:true`；Sliced/Tiled + `sr.size=5,5` → `verified:false`（mismatches 恰为 `worldSize.x/y`）。
- **Tight**（`b2t2-tight-*`）：`sprite.bounds` 与 FullRect 全同 → `verified:true`；导入设置已复原。
- **UI Image**（`b2t1-*`）：M5UI → `UI_IMAGE_PRESENT`/exit 1 且事后无 SpriteRenderer；M5Plain → `verified:true`。
- 清理：三轮均读回零污染。

### 8.3 测试与审查

- `npm test`：**621/621 绿**（基线 619，+2：R481/R482）。
- 审查：任务 1 与任务 2 各经 **spec + code 双审**（均无 🔴；🟡 已收尾）。
