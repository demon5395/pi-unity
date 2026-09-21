# M5 backlog ④ 只读侦察：`sprite assign --world-size` 的 drawMode / UI Image 分叉（B2）

> 真机：Unity 官方中国版 **2022.3.62f3c1**（`C:/Users/<用户>/pi-unity-official-f3c1`），uloop 3.5.1。
> 资产 `Assets/Art/hero-blind.png`（已验证 Sprite/Single，ppu=16，`sprite.bounds.size={0.375,0.25}` = 6×4 纹理）。
> 全部命令**串行**执行；原始证据见同目录 `b2-*.json` / `b2-*.err` / `b2-*.cs`。**未改源码/测试，未 commit，未保存场景。**

## A. drawMode 探测（节点 `M5Draw`）

| 步 | 状态 | 关键实测值 | 证据 |
|---|---|---|---|
| A3 初始 | Simple，sprite=null | `sr.size={1,1}`、`sr.bounds.size={0,0}`、scale=1 | `b2-a3-dump-initial.json` |
| A4 Simple assign 2,1 | **verified:true**（退出码 0） | localScale=`{5.3333,4}`；读回 `worldSize={2,1}` | `b2-a4-assign-simple.json` |
| A4b 同点读回 | — | `sr.size = sprite.bounds = {0.375,0.25}`；`sr.bounds = {2,1}`（=sprite.bounds×scale） | `b2-a4b-dump-simple-after.json` |
| A5 切 Sliced（不动 size） | — | 字段与 A4b 完全一致：`sr.size={0.375,0.25}`、`sr.bounds={2,1}` | `b2-a5b-dump-sliced-untouched.json` |
| A6 Sliced assign 2,1 | **verified:true**（退出码 0） | 因此刻 `sr.size==sprite.bounds` → 两侧不叉，故真绿 | `b2-a6-assign-sliced.json` |
| A7 强制 `sr.size=5,5` | — | `sr.size={5,5}`、`sr.bounds={26.6667,20}`（=5×{5.3333,4}）、`sprite.bounds={0.375,0.25}` | `b2-a7b-dump-sliced-size5.json` |
| A7c Sliced assign 2,1 | **verified:false（退出码 1）** | `mismatches=[sprite.worldSize.x 2→26.6667, sprite.worldSize.y 1→20]` | `b2-a7c-assign-sliced-size5.json` |
| A8 Tiled（保留 size=5,5） | — | 与 Sliced 同：`sr.bounds={26.6667,20}` | `b2-a8b-dump-tiled-size5.json` |
| A8c Tiled assign 2,1 | **verified:false（退出码 1）** | 同上两条 mismatches（2→26.6667 / 1→20） | `b2-a8c-assign-tiled-size5.json` |

**结论（drawMode）**：**不是假绿，是预期诚实行为**——`verified:false` + 两条 `worldSize` 分歧，退出码 1。
分叉机制已实测：写侧 `sprite-assign.cs` 用 `sp.bounds.size = {0.375,0.25}` 反算 localScale；
读侧 `node-inspect.cs` 读 `sr.bounds.size`，而 Sliced/Tiled 下 **`sr.bounds.size = sr.size × lossyScale`**（实测 `5×5.3333=26.6667`）。
仅当 `sr.size ≠ sprite.bounds` 才分叉；`sr.size == sprite.bounds`（如切 drawMode 后默认残留）时两侧仍一致 → **真绿**。
→ **不需要改代码，只需写死限制/文档化**（可选项：assign 时拒绝 Sliced/Tiled，或把 drawMode 归零）。

## B. UI `Image` 假绿反证（节点 `M5UI`）

| 步 | 结果 | 证据 |
|---|---|---|
| B9 建节点 | 短名 `Image` → `COMPONENT_TYPE_NOT_FOUND`（退出码 1）；全名 `UnityEngine.UI.Image` → 成功，组件 `[RectTransform,CanvasRenderer,Image]` | `b2-b9-create-m5ui-image.json` / `b2-b9-try-create-m5ui-fullname.json` |
| B10 初始读回 | `Image.sprite=null`、`Image.enabled=true`、**无 SpriteRenderer** | `b2-b10-dump-ui-initial.json` |
| B11 `sprite assign`（无 --world-size） | **verified:true（退出码 0）**；`actual.components` **多出 `SpriteRenderer`**；读回面 `sprite.assetPath=Assets/Art/hero-blind.png`、`worldSize={0.375,0.25}` | `b2-b11-assign-ui.json` |
| B12 事后读回 | `Image.sprite` **仍为 null**（完全没变）；`SpriteRenderer.sprite=hero-blind`（新加的组件） | `b2-b12-dump-ui-after.json` |

**结论（UI Image）**：按题面判据（`verified:true` 且 `Image.sprite` 仍 null 且 `components` 多出 `SpriteRenderer`）**假绿成立**。
路径：`sprite-assign.cs` 对无 SpriteRenderer 的节点**静默 `AddComponent<SpriteRenderer>()`**，而读回面（`node-inspect.cs`）
**只读 SpriteRenderer**，于是 intent（`sprite.assetPath`）与原组件上的「新 SpriteRenderer」匹配 → `verified:true`，
真正被改的 UI `Image` 无人比对。**这是需要修的真假绿路径**（例如：节点已有 `Image` 且无 `SpriteRenderer` 时拒绝，
或把 `components`/Image 状态纳入判据）。
> 粒度说明：若把契约窄化为「就是给节点挂一个 SpriteRenderer」，则此处算「符合书面 intent」而非机械假绿；
> 但对「给一个已有 Image 的 UI 节点设图」的自然意图而言，退出码 0 是误导性绿。判定权在计划侧。

## C. 清理与仓库状态

`node delete M5Draw` / `node delete M5UI` 均 `verified:true`；`scene tree` 读回 **nodeCount=3、M5 残留=0**
（`Main Camera, Directional Light, Hero`）——`b2-c13-delete-*.json`、`b2-c13-cleanup-tree.json`。场景**未保存**。
`git status --porcelain`：**仅 `docs/m5-probes-raw/b2-*` 未跟踪**，无源码/测试改动。
