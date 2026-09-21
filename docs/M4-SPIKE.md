# M4 开路探测（spike）—— Unity 导入层真机实证

> **性质**：M4（美术管线 + Prefab 工作流）的**事实基础**。写实现计划前先读本文，不要重新试探。
> **环境**：团结引擎 2022.3.62t9 + uloop dispatcher 3.5.1；项目 `S0Project`（未碰用户真实工程）。
> **来源**：`expert` 子代理真机 spike，原始报告原样收录于下（含 7 条待编号新坑 NEW-1…NEW-7）。
> **纪律**：文中凡「未探测」字样，一律当未验证看，不许在计划里当成已知。

---

# M4 开路探测报告：美术导入链 + Prefab 工作流（团结 2022.3.62t9）
- **环境**：`Application.unityVersion=2022.3.62t9`、`productName=2D Project`、项目 `C:/Users/<用户>/pi-unity-spike/S0Project`（编辑器手动拉起；全部经 `unity exec --code-file`）。原始 JSON：`tmp/m4spike/{q2-members,q1-q3-run1,q4-guid,q3-q4-prefab,q5-alpha-mesh,q4-guid-identity}.json`；探针 `probe-*.cs` + `mkfixtures.js`（同目录）。Fixture `rgba-margins-24x16.png`：24×16、四周全透明、中心 6×4 不透明红块（Node 侧原像素 `corner(0,0)=0,0,0,0 / center(12,8)=255,0,0,255`）。
## Q1 整条链能否用 `unity exec` 走通 —— **能，且不需要 Refresh**
- 真实 `actual.result`（probe-import）：`p1.guidBefore=""` → `File.Copy` 写盘 → `AssetDatabase.ImportAsset("Assets/PiSpike/p1-importasset-only.png")` → `p1.importAssetMs=89.0` → `p1.guidAfterImportAsset=fad2b2ac5786d6a4696cf521e212ab70`、`p1.loadAfterImportAsset=True`、`p1.importerAfterImportAsset=TextureImporter`。对照：`AssetDatabase.Refresh(ForceSynchronousImport)` 也能导入（`p2.guidAfterRefresh=85fea81c…`），但耗时 **3540.1 ms**（首次全量）vs `ImportAsset(单路径)` **89 ms** → 实现走 `ImportAsset(path)`，不用 `Refresh()`。
- 设置链：`GetAtPath → as TextureImporter` → 赋值 → `SaveAndReimport()`（**40.2 ms**）→ **同一次调用内立刻读回就是新值**；其后 `ImportAsset(path, ForceUpdate)`（30.5 ms）仍保持。两次 reimport 足够，**无需等帧**。
- ⚠️ `p3.sameInstanceAsBefore=False`：`SaveAndReimport()` 后旧 importer 实例作废 → **必须重新 `AssetImporter.GetAtPath`** 再读回。
- 同调用读回（p3.afterSave）：`filterMode=Point / textureCompression=Uncompressed / mipmapEnabled=False / wrapMode=Clamp / PPU=16 / maxTextureSize=2048 / npotScale=None / isReadable=True / spriteMeshType=FullRect / spriteExtrude=0 / spriteAlignment=9 / spritePivot=(0.250,0.750)`；载入纹理 `24x16 fmt=RGBA32 filter=Point mipmapCount=1`；`Sprite ppu=16.000 rect=(0,0,24,16) bounds=(1.50,1.00,0.20) verts=4 tris=6`（=24/16 × 16/16，PPU 语义成立）。跨调用复读（probe-prefab `later.*`）全部一致 → **稳定，不需要重试**。
## Q2 像素画/精灵的确切设置（团结 2022.3.62t9 实测，全部 `== 生效`）
| 目标 | API（真实可用名） | 我设的值 | 读回值 |
|---|---|---|---|
| 精灵类型 | `TextureImporter.textureType` | `Sprite` | `Sprite` ✅ |
| 导入模式 | `.spriteImportMode` | `Single` | `Single` ✅ |
| 点采样 | `.filterMode` | `FilterMode.Point` | `Point`（纹理对象亦 `Point`）✅ |
| 不压缩 | `.textureCompression` | `Uncompressed` | `Uncompressed`（纹理 `RGBA32`；默认 `DXT5`）✅ |
| 无 mip | `.mipmapEnabled` | `false` | `False`（`mipmapCount=1`）✅ |
| 无平铺 | `.wrapMode` | `TextureWrapMode.Clamp` | `Clamp` ✅ |
| PPU | `.spritePixelsPerUnit`（`spritePixelsToUnits` 为别名，同步变） | `16f` | `16` ✅ |
| 尺寸上限 | `.maxTextureSize` | `2048` | `2048` ✅ |
| NPOT | `.npotScale` | `TextureImporterNPOTScale.None` | `None` ✅ |
| 透明 | `.alphaIsTransparency` | `true` | `True`（**会改写透明像素 RGB，见 Q5**）✅ |
| 可读 | `.isReadable` | `true` | `True` ✅ |
- ⚠️ **`spriteMeshType`/`spriteExtrude`/`spriteAlignment`/`spriteGenerateFallbackPhysicsShape`/`spriteTessellationDetail` 不在 `TextureImporter` 上**（真机 CS1061）→ `var s=new TextureImporterSettings(); ti.ReadTextureSettings(s); s.spriteMeshType=…; ti.SetTextureSettings(s); ti.SaveAndReimport();`（实测生效）。另：`SpriteMeshType` 在 **`UnityEngine`** 命名空间（`UnityEditor.SpriteMeshType` → CS0234）；`spriteExtrude` 是 `uint`，字面量须 `0u`。
- ⚠️ **默认值不是像素画友好值且随工程模板变**：首次导入得 `textureType=Sprite / filterMode=Bilinear / textureCompression=Compressed(ps.format=AutomaticCompressed) / PPU=100 / spriteMeshType=Tight / spriteExtrude=1 / isReadable=false / maxTextureSize=2048 / alphaIsTransparency=true / npotScale=None / wrapMode=Clamp`；实测默认导入 8×8、24×16 分别落地为 **`DXT1`、`DXT5` + `Bilinear`** → **必须逐项显式设置**。完整可用 API 面（含 `alphaSource`、`textureShape`、`sRGBTexture`、`ps.format/compression`、全枚举名）见 `q2-members.json`。
## Q3 `ImportAsset` 的时序 —— **读写同步，不需要等帧/重试**
- `SaveAndReimport()` 后同调用内 `GetAtPath` + `LoadAssetAtPath<Texture2D>` + `LoadAssetAtPath<Sprite>` 全为新值（`Point/Uncompressed/RGBA32/mipmapCount=1`）；跨 exec 复读一致；`ImportAsset` 后再读一致。
- 唯一时序坑是**对象身份**（`SaveAndReimport` 换新 importer 实例），不是**值**的时序。
- **结论：实现不需要重试/二次读回；但读回必须在 `SaveAndReimport()` 之后重新 `GetAtPath`。** 新文件必须先 `ImportAsset`/`Refresh` 才在 DB 中存在（见「额外」）。
## Q4 GUID 稳定性 —— **同路径覆盖 ⇒ 引用稳定；但引用 guid 不在 `.meta`（移植性有风险）**
- 形状实据：prefab YAML `m_Sprite: {fileID: 21300000, guid: 0e6760542563e834ba84aaf6cb1fb4ae, type: 3}`，而 `.meta` 写的是 `guid: Dy8ZsiytVn8eFGLDNO3RSsqCBSoXs3klvy5IrAbJpfpb89U/xOyIQ4k=`（**56 字符 base64**）；`AssetDatabase.AssetPathToGUID` 返回的 **32-hex** 才是被引用的那个。
- 稳定性（`p5-guid.png`，hex `88de8efa82300ff49a664c461417b41d`）：覆盖同名文件+`Refresh` → 不变；+`ImportAsset(ForceUpdate)` → 不变；连续再 import 两次 → 不变；**`DeleteAsset` 后同名重建 → 同一 guid**；`MoveAsset` 改名 → guid 跟随。→ 「同名覆盖=更新」契约成立（美术返工安全）。
- 反例：`png`+`.meta` 一起拷成新名 → 新 guid（`da43e061…`，且 `.meta` base64 被引擎改写）；**内容完全相同的两份 PNG 在两条路径下 guid 不同**（`19a5880b…` vs `88de8efa…`）→ 非内容派生。
- **决定性实验**：手改 A 的 `.meta` guid 行为 B 的 base64、甚至全新值 → 引擎**接受并保留**（`g2.metaKeptInjectedValue=True`），但 **hex 引用 guid 一动不动**（`g2.hexChanged=False`）→ **两套独立 id；`.meta` 无法指定/携带引用 guid**。该 hex 在磁盘上只出现在引用它的 YAML 里（不在 `.meta`，不在 `Library/{SourceAssetDB,ArtifactDB}` 的 ASCII 或裸 16 字节里，也不是 `md5/sha1/sha256(path | path+productGUID | 内容)` 的任何变体，穷举 0 命中）。
- **风险**：**删 `Library/` 或全新 clone 时，PNG 的 sprite 引用很可能被重新指派而断开**（未直接验证——需第二工程/清 Library，本机单座席做不到）→ **建议 M4 把「全新 clone 后引用是否仍指向同一文件」列为必测项**；跨机器协作时美术资产与其引用方（场景/Prefab）应同批提交。
## Q5 去底/裁边该在哪一侧做 —— **Node 侧（有实据），Unity 侧只做声明式导入设置**
- Unity 侧**没有去底 API**：`alphaSource=None` 是**丢弃 alpha**（实测 `B.alphaNone.px(0,0).a=1.00`，格式退回 `DXT1`），不是去底；`alphaIsTransparency` 是 **alpha 膨胀**且**改写透明像素 RGB**——同一 fixture 磁盘上 `(0,0,0,a=0)`，`true` 导入后 `corner=1.000,0.000,0.000,a=0.00`（被邻居红填充），`false` 才回到 `0,0,0,a=0` → **Unity 侧看到的已不是原图**。
- Unity 侧**裁边也没有旋钮**：`spriteMeshType=Tight`（默认）在有 66% 透明边界的 24×16 精灵上**不裁几何**（`B.tight.verts=4/tris=6/rect=全图/textureRect=全图`，与 `FullRect` 全同），透明像素仍在纹理里（`px(0,0).a=0`）。
- Unity 侧真要动像素：`isReadable=true`（额外内存+一次 reimport）→ `GetPixels32/SetPixels32` → `EncodeToPNG` → **回写用户源文件** → 再 reimport；多一轮往返、改写用户原图、编码还会归一化 PNG 格式。另 **`maxTextureSize` 是静默缩放陷阱**：源 24×16 + `maxTextureSize=8` → 导入后 `8×5`（`B.maxTex8.texSize=8x5`，41.7 ms 生效）→ 约定 `maxTextureSize >= max(w,h)` 并读回校验。
- Node 侧：`lib/png.js` 已能解码 bitDepth 8 / colorType 0,2,4,6 / 滤镜 0–4（本次解出 `32x16`、`4x3`、自造 fixture），确定性、无重导入往返；本次已用它 + 约 60 行零依赖编码器（`mkfixtures.js`）造出并校验带透明边与 NPOT 的 fixture；**但 `lib/png.js` 没有编码器 → M4 需补（工作量已知很小）**。
- **建议**：去底/裁边/缩放/调色板全放 **Node 侧**（port pi-cocos `lib/art.js`，写盘一次），Unity 侧只做声明式设置；生产用 `isReadable=false`，`alphaIsTransparency` 由我们显式定（像素已由 Node 定稿）。
## 额外：`unity asset write` × PNG
- **`asset write` 本身完全不触发导入**：`--no-compile` 写 `Assets/PiSpike/p10-viaassetwrite-nocompile.png` → `ok=true verified=true shaMatch=true`；**9.7 s 后**读回 `p10.metaExists=False`、`p10.guid=""`、`p10.loadable=False`（文件在盘上、DB 里不存在）。随后 `ImportAsset` 94 ms 登记好（`guid=49be5899…`），importer 是默认 `Sprite/Bilinear/Compressed/ppu=100`、纹理 `8x8 fmt=DXT1`。
- 反例：**不带 `--no-compile`** 时其默认的 `uloop compile`（plain compile 自带 refresh）**顺带**导入了它（`p11.metaExists=True`、`guid=d521b578…`、`loadable=True`，12.5 s 后检查），但拿到同一套**错误默认值**（`Sprite/Bilinear/Compressed`、`24x16 fmt=DXT5`）。
- → **必须为 PNG 做专门路径**（新增 `unity asset import`：写/拷文件 → `ImportAsset` → 配 `TextureImporter` → `SaveAndReimport` → 读回）；**不能借 `asset write`+compile 的副作用**（时机不可控、设置一律错）。`asset write` 对二进制文件本身可用（sha256 读回正常），可复用作「落盘」那一半。
## Prefab 工作流（`unity exec` 内实测，可走通）
- `PrefabUtility.SaveAsPrefabAsset(go,"Assets/PiSpike/SpikeSprite.prefab")` → 38.9 ms、返回非空、文件 2437 B、`prefabGuid=420bd970d9d6de242b529440fc7ddd5e`。
- `PrefabUtility.InstantiatePrefab(prefabAsset)` → **0.3 ms**，读回 `name=SpikeSprite / spriteName=spike-rgba / spriteAssetPath=Assets/PiSpike/spike-rgba.png / spritePPU=16.00 / sortingOrder=3 / position=(1.00,2.00,0.00) / isPrefabInstance=True / correspondingSource=OK`（建节点→存 Prefab→实例化回来，引用+PPU 完整）。**未做**：实例化后的画面可见性（`shot`/`pixels`）断言、Prefab 变体/嵌套、覆盖已有 Prefab 的幂等性 → 留给 M4 的 E2E（M2 只验证过纯色 sprite 的可见性）。
## 候选新坑（编号由文档任务统一分配；均为团结 2022.3.62t9 实测）
- **NEW-1**：`TextureImporter` 没有 `spriteMeshType/spriteExtrude/spriteAlignment`，须走 `TextureImporterSettings` 往返（`SpriteMeshType` 在 `UnityEngine`、`spriteExtrude` 是 `uint`）——静态契约测试测不出，只能真机编译。（团结 2022.3.62t9；大概率同 Unity 2022.3）
- **NEW-2**：外部进程写进 `Assets/` 的文件**不会**被自动导入——shell 拷贝 6.2 s、`asset write --no-compile` 9.7 s 后仍 `guid="" / 无 .meta / loadable=false`；必须显式 `ImportAsset(path)`（89 ms）或 `Refresh`（首轮 3540 ms）。（同上；未测「编辑器有焦点时」）
- **NEW-3**：`.meta` 的 `guid:` 是 **56 字符 base64**，与 `AssetPathToGUID` 的 **32-hex**（YAML 引用用这个）是两套 id；手改 `.meta` guid **不会**改变引用 id，`.meta` 也无法携带引用。（团结新导入资产；`SampleScene.scene.meta` 等老资产仍是 32-hex）
- **NEW-4**：默认导入设置**压缩 + Bilinear + PPU=100 + Tight**（实测 `DXT1/DXT5`）→ 像素画不逐项显式设置必糊。（同上；默认值随工程模板变）**NEW-5**：`maxTextureSize` 小于源尺寸时**静默缩放**（24×16 + `=8` → `8×5`）。（同上）
- **NEW-6**：`alphaIsTransparency=true`（团结默认）会**改写透明像素的 RGB**（`(0,0,0,0)`→`(1,0,0,0)`，导入后纹理 ≠ 磁盘 PNG）；`alphaSource=None` 是**丢弃 alpha**（非去底）。（同上）
- **NEW-7**：`spriteMeshType=Tight`（默认）在 66% 透明边界的精灵上**不裁剪几何**（4 顶点/全图 rect，与 `FullRect` 相同）→ 不能用它裁边。（团结；与 Unity 官方文档预期不同，建议官方版复测）
## 命令面建议（基于实测）
- 新增 `unity asset import --from <png> --to Assets/...`：**暴露** `--from/--to/--force/--ppu/--max-size/--filter <point|bilinear>/--compression <none|normal>/--pivot <x,y>`；**固定为约定**（写进 SKILL）：`textureType=Sprite`、`spriteImportMode=Single`、`wrapMode=Clamp`、`spriteMeshType=FullRect`、`spriteExtrude=0`、`npotScale=None`、`isReadable=false`、`spriteGenerateFallbackPhysicsShape=false`、`maxTextureSize` 自动抬到 `>= max(w,h)`。
- **读回口径**：`verified` 比对（新实例的）`GetAtPath` 11 项 + `LoadAssetAtPath<Texture2D>` 的 `width/height/format/filterMode/mipmapCount`，并断言 `LoadAssetAtPath<Sprite> != null`；**不加重试**（同步）。最小序列（已实测，共 2 次 reimport / ~130 ms）：写文件 → `ImportAsset(rel)` → `GetAtPath` → 设值 → `SaveAndReimport()` → 重新 `GetAtPath` 读回。
- `unity sprite set` 需 `--sprite <asset>`：引入真实资产后 **`localScale` 不再等于世界尺寸**（实测 `bounds=texSize/PPU`；纯色 1×1 时代才 1:1）→ 建议加 `--world-size w,h` 或不给时按 `bounds` 换算，并改掉 SKILL 里「localScale = 世界尺寸」的旧说法。
- Prefab：`unity prefab create --from-node <path> --to Assets/...`（`SaveAsPrefabAsset`）+ `unity prefab instantiate --asset <p> [--parent <p>]`（`InstantiatePrefab`）；API 已验证可达，**建议实现前再补一次「覆盖已有 Prefab 的幂等性 + 画面可见性（`pixels`）」探测**。
## 未探测 / 存疑（交接 M4 计划）
- 最高优先级：**删 `Library/` 或全新 clone 后 PNG 的引用 guid 是否被重新指派**（本机单座席无法安全验证）。其余：「编辑器有焦点时外部写文件是否自动导入」（NEW-2 边界）；`SaveAsPrefabAsset` 覆盖幂等性、Prefab 变体/嵌套；资产 sprite 的 `pixels` 可见性断言；`Multiple`/`Polygon`/sprite sheet/预写 `.meta` 的处理；NEW-1/3/6/7 在 Unity 官方 2022.3 是否同样成立（本机无官方版）。
