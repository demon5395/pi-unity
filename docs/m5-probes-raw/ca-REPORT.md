# C-A 只读侦察报告：官方版复测 U28/U31/U32/U33/U36/U39/U40/U41（2026-09-20）

> 真机：Unity 官方中国版 **2022.3.62f3c1**（`C:/Users/<用户>/pi-unity-official-f3c1`），uloop 3.5.1。
> 全部命令**串行**（uloop 单飞）。**未改源码/测试、未 commit**。原始证据 `ca-*.json` / `ca-*.cs`。
> 目的：把 `docs/PITFALLS.md` 里「团结实测；官方 2022.3 未验证」的条目升级为官方版实测。

## 0. 环境与资产

- 官方工程为 **3D 模板**（`Assets/Scenes/SampleScene.unity`，默认透视相机），场景根节点 `Main Camera / Directional Light / Hero`。
- 探针新增临时资产 `Assets/Art/ca-defaults.png`（宿主生成：24×16，左半红 `(255,0,0,255)`、右半透明 `(0,0,0,0)`，`lib/png.js` 编码）。
- 探针新增临时节点 `CaSrc/CaA`（已删）、临时 Prefab `Assets/Prefabs/CaP.prefab`、`CaDifferent.prefab`（已删）。
- 收尾：场景读回 `nodeCount=3`（`ca-50-tree-final.json`），全部临时资产 `LoadAssetAtPath==null`（`ca-40b-cleanup.json`）。

## 1. 结论总表

| 坑 | 团结结论 | 官方版 2022.3.62f3c1 实测 | 判定 |
|---|---|---|---|
| **U28** `ti.spriteMeshType` 直取 | CS1061 | `ca-04-u28-direct`：**CS1061 逐字复现**；settings 往返（`ReadTextureSettings`/`SetTextureSettings`）成功 | ✅ **Unity 家族共有** |
| **U31** 默认导入设置 | Sprite/Bilinear/压缩/PPU=100/Tight | **默认值不同**：`textureType=Default`、`alphaIsTransparency=false`、`npotScale=ToNearest`、`spriteImportMode=None`、`mipmapEnabled=true`、`wrapMode=Repeat`（详见 §2）；`filterMode=Bilinear`、`textureCompression=Compressed`、`spritePixelsPerUnit=100`、`spriteMeshType=Tight`、`spriteExtrude=1`、`isReadable=false` 同 | ⚠️ **结论（像素画须逐项显式设置）成立；但「默认值」随引擎/模板变** |
| **U32** `maxTextureSize` 静默缩放 | 24×16+8→8×5 | `ca-02-maxsize`：**24×16 + maxTextureSize=8 → 8×5** 逐字一致 | ✅ **Unity 家族共有** |
| **U33** `alphaIsTransparency` 改写透明 RGB | 默认 true 时改写 | `ca-03b-alpha`：`false` 时透明像素 `(0,0,0,0)`；**`true` 时变 `(1,0,0,0)`（被邻居红填充）** | ✅ **机制 Unity 家族共有；默认值官方为 `false`** |
| **U36** 默认 `shot` 尺寸由 Game 窗口定 | 892×355 | `ca-13-shot-window`：`--capture-mode window` → **1101×540**（请求 960×640）；且 `ca-12-shot-auto`：PlayMode 默认(auto→rendering) **因 Game 视图未开直接失败** `ULOOP_ERROR` | ✅ 机制成立；**官方版还多一条：Game 视图未开时 rendering 会失败**（对应 HANDOFF S8） |
| **U39** `--force` 三条跟随规则 | ①跟随 ②保持 ③根 pos 永不跟随 | `ca-49-after-force`（**已 `scene save`**）：实例保留 `localPos=5,5,0`（③）与 `localScale=3,3,1`（②）；`ca-31-root-dump`（未存场景那次）：未覆盖的 scale 跟随资产 `2,2,1`（①） | ✅ **三条成立（需场景已保存）**；另见 §3 的「未存场景」新坑 |
| **U40** 源节点不变实例 / 实例沿用资产位姿 | 成立 | `ca-49-after-force`：`CaSrc.prefabInstanceStatus=NotAPrefab`；实例初始 `localPos=0,0,0` = 资产生成时位姿 | ✅ **Unity 家族共有** |
| **U41** 文件名覆盖 Prefab 根名 | 成立 | `ca-21-prefab-create`：`--from-node CaSrc --to Assets/Prefabs/CaDifferent.prefab` → 读回根名 **`CaDifferent`**（非 `CaSrc`）；`ca-43` 同类 | ✅ **Unity 家族共有** |

## 2. U31 官方版默认导入设置（原始值，`ca-01-defaults`）

```
textureType=Default        textureCompression=Compressed   spritePixelsPerUnit=100
filterMode=Bilinear        isReadable=false                 mipmapEnabled=true
alphaIsTransparency=false   wrapMode=Repeat                 npotScale=ToNearest
spriteImportMode=None       maxTextureSize=2048             texWidth=32 texHeight=16 (源 24×16)
spriteMeshType=Tight        spriteExtrude=1                spriteAlignment=0(Center)
texFormat=DXT5
```

**两个额外事实**：
1. **`npotScale=ToNearest` 会静默把 NPOT 源放大到最近的 2 的幂** —— 24→**32**（源 24×16 导入后纹理 32×16）。这与 U32 是**两个不同的缩放变量**，探针 2 必须先 `npotScale=None` 才能单独观察 `maxTextureSize`。
2. 官方 3D 模板默认 `textureType=Default`（**不是** Sprite）；因此 `spriteImportMode=None`。团结团结模板默认 Sprite。

## 3. 新坑：场景未保存时 `prefab create --force` 会重置实例名与覆盖

第一次探针（`ca-2x`，**未** `scene save`）：`CaInstA`/`CaInstB` 设了根 pos/scale 覆盖后，`prefab create --force` 一执行，两个实例**改名成了资产根名 `CaDifferent`**、`localPos` 回到 `0,0,0`、`localScale` 回到资产值 —— 覆盖全丢。
第二次探针（`ca-4x`，**先 `scene save`**）：同样的覆盖在 `--force` 后**完整保留**（`ca-49-after-force`）。

→ **可复现指认的差异变量 = 「实例覆盖是否已随 `scene save` 落盘」**。未落盘的覆盖会在被引用 Prefab 资产重存时丢失。
（机制未深挖；本条按「观测 2 次、变量已隔离」登记，落到 PITFALLS 新条目 **U54**，标「官方版实测」。）

## 4. 仍未探测（如实）

- U36 的 `--capture-mode window` 精确尺寸成因（为何 1101×540）—— 沿用 U36 原文「成因未探测」。
- 图集（SpriteAtlas）—— 官方工程 `Packages/manifest.json` 无 `com.unity.2d.*`（内置于编辑器，可直接加；留待 C-C）。
- Unity **国际版**（本网络不可得，Q2 已判非必要）。
