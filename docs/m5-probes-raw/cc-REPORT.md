# cc-REPORT —— 图集半（SpriteAtlas / Multiple）+ `/unity-*` 扩展可行性

**日期**：2026-09-21（真机）
**环境**：Unity 官方中国版 **2022.3.62f3c1**（`C:/Users/<用户>/pi-unity-official-f3c1`，3D 模板，场景 `SampleScene`）
**约束**：只读侦察 + 真机探针；**未改 pi-unity 源码/测试，未 git commit**；全部 `unity` 命令**串行**（uloop 单飞）；未触碰 `<真实工程>`。
**前缀**：证据全部落在 `docs/m5-probes-raw/cc-*`。

---

## 0. 结论速览

| 问题 | 结论 | 关键证据 |
|---|---|---|
| 图集半能否关闭（官方版） | **能** —— 图集核心类型无需 `com.unity.2d.sprite` 包；但**纯反射创建路径不干净**（控制台断言），见 §2.4 | `cc-03`…`cc-13b` |
| 是否需装包 | **不需要**（`UnityEngine.U2D.SpriteAtlas` / `UnityEditor.U2D.SpriteAtlasAsset` / `SpriteAtlasUtility` 都在 `UnityEngine.CoreModule` / `UnityEditor.CoreModule`，工程 `manifest.json` 里 `com.unity.2d.*` 计数 = 0） | `cc-01`、`cc-06`、`cc-99-zero-pollution` |
| 图集打包后 `--world-size` 口径 | **不变**：`verified:true`，`node inspect` 的 `sprite.assetPath` 仍是 **PNG**（不是 `.spriteatlas`），`Sprite.bounds.size` 不被打包改变 | `cc-21`、`cc-22`、`cc-23` |
| `Multiple` 是否仍硬失败 | **是**：`AMBIGUOUS_SPRITE`（退出码 1，`count:2`），与 U43 一致 | `cc-31`、`cc-32` |
| `/unity-*` 扩展最小形态 | **可行且零第三方依赖**；放 `pi-extension/unity-commands.ts`，`package.json` 的 `pi.extensions` 声明，`pi.registerCommand` + `pi.exec` | §5（引用文档路径+章节） |
| 清理 | 零污染（图集资产 `LoadAssetAtPath==null`、`nodeCount=3`、hero `.meta` 与探针前**逐字节相同**）；**唯一不可逆副作用**：`scene save` 重写了场景文件（见 §6.3） | `cc-98-*`、`cc-99-*` |

---

## 1. 基线（探针前）

| 事实 | 值 | 证据 |
|---|---|---|
| 场景节点 | `nodeCount=3`：`Main Camera` / `Directional Light` / `Hero` | `cc-02-baseline-tree.json` |
| `hero-blind.png` 导入 | `spriteMode:1`(Single)、`spriteMeshType:0`(FullRect)、PPU=16、`textureType:8`(Sprite)、`maxTextureSize`(Default平台)=32 | `cc-30-hero-meta-BEFORE.txt`（sha256 `7768cfea…`） |
| 图集三类型可解析 | `SpriteAtlas` / `SpriteAtlasAsset` / `SpriteAtlasUtility` 均解析；`Unity.2D.Sprite` 程序集**未加载** | `cc-01-atlas-type.json` |

---

## 2. 图集探针（创建 → Add → Pack）

### 2.1 API 反射（`cc-03-atlas-reflect.json` / `cc-09-atlas-types.json`）

`UnityEditor.U2D.SpriteAtlasAsset` 的**全部**可用成员（NonPublic 也含）：

```
static Void Internal_Create(SpriteAtlasAsset self)      ← 唯一的创建入口（native extern）
Void SetMasterAtlas(SpriteAtlas atlas) / SpriteAtlas GetMasterAtlas()
Void Add(Object[] objects) / Remove / RemoveAt
Void SetIncludeInBuild(Boolean) / Boolean IsIncludeInBuild()
static SpriteAtlasAsset Load(String assetPath)
static Void Save(SpriteAtlasAsset asset, String assetPath)
```

`UnityEditor.U2D.SpriteAtlasUtility`：

```
static Void PackAtlases(SpriteAtlas[] atlases, BuildTarget target, Boolean canCancel)
static Void PackAllAtlases(BuildTarget target, Boolean canCancel)
static Void PackAtlasesInternal(SpriteAtlas[], BuildTarget, Boolean, Boolean, Boolean)
```

额外发现（反射扫全部 `*SpriteAtlas*` 类型，`cc-09`）：`UnityEditor.U2D.SpriteAtlasExtensions` 提供
**internal** 静态方法 `Add` / `GetPackables` / `GetPackedSprites` / `GetPreviewTextures` / `GetStoredHash` 等
（读回打包结果必须用它，且必须带 `NonPublic` 绑定标志，否则 `GetMethod` 返回 `null`）。

### 2.2 关键坑：`SpriteAtlasAsset` **不是** `ScriptableObject`

`cc-06-atlas-basetype.json`：

```
chain = UnityEditor.U2D.SpriteAtlasAsset [asm=UnityEditor.CoreModule]
      → UnityEngine.Object [asm=UnityEngine.CoreModule]
      → System.Object
ctors = [ public .ctor() ]
isScriptableObject = false
isUnityObject     = true
```

**后果**：`ScriptableObject.CreateInstance(tAsset)` 返回 **`null`**（`cc-04-atlas-create.json` 的 `CreateInstance` 步骤 = `null`）。
`Activator.CreateInstance(tAsset)` + 反射调 `Internal_Create` 才拿到可用的 native 对象（`cc-07`）。

### 2.3 成功路径（逐步）

| 步 | 返回 | 证据 |
|---|---|---|
| `Activator.CreateInstance(SpriteAtlasAsset)` | `UnityEditor.U2D.SpriteAtlasAsset` | `cc-07` |
| `Internal_Create(aa)`（反射，NonPublic） | `invoked` | `cc-07` |
| `Add([hero-blind])` | `invoked` | `cc-07` |
| `GetMasterAtlas()`（**创建时**） | **`null`** | `cc-07` |
| `Save(aa,"Assets/Art/CcAtlas.spriteatlas")` | 落盘（`LoadAssetAtPath` = true） | `cc-07` |
| 但磁盘 YAML `m_MasterAtlas: {fileID: 0}` | 只存了 asset，**没存 master atlas 子资产** | 见下方 §2.4 |
| 换路：建 `SpriteAtlas` 对象 + `SetMasterAtlas` | `GetMasterAtlas` = `UnityEngine.U2D.SpriteAtlas` | `cc-10` |
| 仍不行：`Save` 后 `m_MasterAtlas` 还是 0 | `LoadAllAssetsAtPath` = `[SpriteAtlasAsset, ImportLog]` | `cc-10` |
| **可行**：`AssetDatabase.CreateAsset(aa)` + `AssetDatabase.AddObjectToAsset(atlas)` | YAML 出现 `SpriteAtlas &200014992480315190` 且 `SpriteAtlasAsset.m_MasterAtlas: {fileID: 200014992480315190}` | `cc-11` |
| 打包 `SpriteAtlasUtility.PackAtlases([atlas], StandaloneWindows64, false)` | `atlas.spriteCount` **0 → 1** | `cc-12` |
| 预览纹理 | `GetPreviewTextures` = `["sactx-0-32x32-DXT5\|BC3--418b0630\|32x32"]` → **确实打包了** | `cc-12`/`cc-13b` |

**注意**：`SpriteAtlasAsset.Add` 把 packable 写进 `m_ImporterData.packables`，但**运行时 `SpriteAtlas` 的 `GetPackables` 仍是空的**（`cc-12`：`GetPackables(atlas) n=0`）——必须再调 `SpriteAtlasExtensions.Add(atlas, …)` 才让打包器看到（`n=1`）。这是绕过 importer 的代价。

### 2.4 诚实记录：反射创建路径**不干净**（控制台报错原文）

`cc-99-logs-errors.json`（`unity play logs --log-type Error`）共 **7 条**，其中与本次图集探针直接相关：

```
'UnityEditor.U2D.SpriteAtlasAsset' is missing the class attribute 'ExtensionOfNativeClass'!   ×2
Assertion failed on expression: 'wrapper.GetCachedPtr() == NULL'                              ×5
```

前者来自 `Activator.CreateInstance(SpriteAtlasAsset)`（native 类缺少 `ExtensionOfNativeClass`），
后者来自绕过托管构造器创建 `UnityEngine.Object`。**这是本探针的创建手法本身产生的**，
不是业务代码问题，但足以说明：**“用 `unity exec` 纯反射造 SpriteAtlas 资产”不是一条干净的官方路径** ——
Unity 官方入口（Assets ▸ Create ▸ 2D ▸ Sprite Atlas）走的是 importer/菜单内部 API。

> 因此本报告的图集事实**全部成立**（打包、`spriteCount`、预览纹理都实测到），
> 但**不建议**把“反射造图集资产”直接产品化；若真要做，应优先找编辑器菜单/内部工厂，或明确记为 best-effort。

---

## 3. 图集打包后 `sprite assign --world-size` 的行为（核心问题）

命令（原样）：

```
unity sprite assign --project-path <P> --path CcNode --asset Assets/Art/hero-blind.png --world-size 2,1 --json
```

`cc-21-assign-atlas.json`：

| 字段 | 值 |
|---|---|
| `ok` / `verified` | **true / true**（退出码 0） |
| `actual.scale` | `{x:5.33333349, y:4, z:1}` |
| `actual.sprite.assetPath` | **`Assets/Art/hero-blind.png`** |
| `actual.sprite.worldSize` | `{x:2, y:1}` |
| `actual.sprite.ppu` | `16` |
| `actual.sprite.spriteName` | `hero-blind` |

`cc-22-inspect-atlas.json`（独立 `node inspect` 复核）：**完全一致** ——
`sprite.assetPath = Assets/Art/hero-blind.png`、`worldSize = {2,1}`、`ppu=16`。

`cc-23-atlas-still-packed.json`（打包态**未**因 assign 而解除）：

```
spriteCount=1, packedCount=1, previewTextures=["sactx-0-32x32-DXT5|BC3--418b0630"]
srSpriteName="hero-blind"
srSpriteAssetPath="Assets/Art/hero-blind.png"      ← 仍是 PNG
srSpriteBounds="(0.38, 0.25, 0.20)"                ← 与未打包时全同
srBounds="(2.00, 1.00, 0.20)"
srSameAsPacked0=true                               ← SR 挂的就是“打包 sprite”本身
```

**回答两个点名问题**：

1. **`--asset` 指向原 PNG 时，被图集打包后 `worldSize` 仍 `verified:true`** ——
   因为 `SpriteAtlasUtility.PackAtlases` **不改变** `Sprite.bounds.size`（`(0.375,0.25)` 前后一致），
   也不改变 `AssetDatabase.GetAssetPath(sprite)`；`sprite-assign.cs` 写侧用 `sp.bounds`、
   `node-inspect.cs` 读侧用 `sr.bounds.size`，两侧口径与未打包时**逐字相同**。
2. **`node inspect` 的 `sprite.assetPath` 是 PNG，不是 `.spriteatlas`** ——
   `AssetDatabase.GetAssetPath(sr.sprite)` 返回 `Assets/Art/hero-blind.png`。
   图集绑定（`SpriteAtlasManager` 的 late-binding）只在**运行时**改 `sprite.texture`，
   Editor 侧 `sprite.assetPath` / `sprite.bounds` 都不变。

**与 U34 / U43 / U52 对照**：

- **U34（`Tight` 不裁几何）**：同向 —— 打包**也不改** `Sprite.bounds`，`--world-size` 判据不受影响。
- **U43（“图集对 `--world-size` 的影响未探测”）**：**本报告关闭该缺口** —— 官方版实测：**无影响**。
  但仍有一条**未验证**边界（如实声明）：本探针的图集**只含 1 张 sprite 且落在 atlas 原点**，
  未制造“多 sprite → 打包偏移”的 `sprite.rect` 非零偏移场景。
  `Sprite.bounds` 是**以 pivot 为中心**的局部尺寸，理论上与 atlas 偏移无关，但**未实测**。
- **U52（`Sliced`/`Tiled` 会落 `verified:false`）**：图集与 `drawMode` 正交；本探针全程 `drawMode=Simple`，
  未叠加 `Sliced`/`Tiled`。

> ⚠️ 知识图谱不可用（本会话无 `cbm_*` 工具），本节为手工模式（read/grep/exec）结论。

---

## 4. `Multiple` 复核（U43 称硬失败）

| 步 | 结果 | 证据 |
|---|---|---|
| 设 `spriteImportMode=Multiple` + `spritesheet=[(0,0,3,4),(3,0,3,4)]` + `SaveAndReimport` | `sprites at path count=2 names=["hero_0","hero_1"]`；`LoadAssetAtPath<Sprite>` 只给第一个 `hero_0` | `cc-31-set-multiple.json` |
| `sprite assign --path CcNode --asset Assets/Art/hero-blind.png --world-size 2,1` | **`code=AMBIGUOUS_SPRITE`，退出码 1**，`actual={asset, count:2}`，`retryable:false` | `cc-32-assign-multiple.json` |
| 复原 `Single` + `FullRect` + 清 `spritesheet` | 读回 `spriteImportMode=Single`、`spriteMeshType=FullRect`、PPU=16、`textureType=Sprite`、`count=1 ["hero-blind"]`、`rect=(0,0,6,4)`、`bounds=(0.375,0.25,0.2)` | `cc-33-restore-single.json` |
| 清 Multiple 残留 `nameFileIdTable`（`m_SpriteSheet.m_NameFileIdTable` 用 `SerializedObject.ClearArray`） | `arraySize=0` | `cc-34-clear-namefileid.json` |
| `.meta` 与探针前**逐字节比对** | **`diff` 无输出，sha256 相同**（`7768cfea…`） | `cc-30-hero-meta-BEFORE.txt` vs `cc-34-hero-meta-AFTER2.txt` |

**结论**：`Multiple`（一图多子 sprite）仍**硬失败** `AMBIGUOUS_SPRITE`（退出码 1），与 U43 一致，**不会**随便挑第一个子图。

**顺带实测（U28 复现）**：`TextureImporter.spriteMeshType` **不存在** —— 直接写 `ti.spriteMeshType` 报
`CS1061: 'TextureImporter' does not contain a definition for 'spriteMeshType'`（`cc-31` 首次编译错误原文）；
必须走 `TextureImporterSettings.spriteMeshType`（`cc-31`/`cc-33` 的可行路径）。

---

## 5. ⑫ `/unity-*` 扩展命令：最小可行形态（**只给结论，不实现**）

### 5.1 引用（文档路径 + 章节）

| 事实 | 出处 |
|---|---|
| 扩展 = TS 模块，`export default function(pi: ExtensionAPI)`；可 `pi.registerCommand()` | `…/pi-coding-agent/docs/extensions.md` §Quick Start（≈L55–107）、§Writing an Extension（≈L160–176） |
| 扩展放哪：`~/.pi/agent/extensions/*.ts`（全局）、`.pi/extensions/*.ts`（项目本地）、`* /index.ts`（子目录）；`/reload` 热重载 | `extensions.md` §Extension Locations（≈L110–127） |
| 包形态声明：`package.json` 的 `"pi": { "extensions": ["./extensions"], "skills": [...] }` | `docs/packages.md` §Creating a Pi Package（≈L120–131） |
| `pi.registerCommand(name, { description, getArgumentCompletions?, handler })` | `extensions.md` §`pi.registerCommand(name, options)`（≈L1564–1595） |
| `pi.exec(command, args, options?) → {stdout, stderr, code, killed}` | `extensions.md` §`pi.exec`（≈L1707–1714） |
| 核心包由 Pi 自带，列 `peerDependencies:"*"`、**不要打包**（`@earendil-works/pi-coding-agent`、`typebox` …） | `packages.md` §Dependencies（≈L160–170） |
| 最小命令示例（无 package.json，靠 bundled core） | `examples/extensions/commands.ts` |
| 带 `package.json` 的包形态示例 | `examples/extensions/with-deps/package.json`（`"pi": { "extensions": ["./index.ts"] }`） |

### 5.2 最小可行形态（结论）

1. **放哪个文件**：仓库里**已经存在一个空的 `pi-extension/` 目录**（`ls -la pi-extension` = 空）。
   最小形态 = 新增 **`pi-extension/unity-commands.ts`**（单文件，默认导出一个工厂）。
   > 也可用惯例目录 `extensions/`，但本仓已有 `pi-extension/`，复用它最省事。
2. **`package.json` 怎么声明**：在现有 `"pi"` 块里**加一行**（当前只有 `skills`，README R113 说明刻意不保留死配置）：
   ```json
   "pi": {
     "skills": ["./skills"],
     "extensions": ["./pi-extension"]
   }
   ```
   pi-unity 以 **git 包**形式被 settings.json 引用（`"git\\<内部 git 服务器>\\pi\\pi-unity"`），
   所以改 `package.json` 后重新安装/`/reload` 即可被 Pi 发现。
3. **命令怎么注册**（示意，**不落地**）：
   ```ts
   import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

   export default function (pi: ExtensionAPI) {
     pi.registerCommand("unity-tree", {
       description: "读当前 Unity 场景节点树",
       handler: async (args, ctx) => {
         const project = args.trim();
         const r = await pi.exec("node", ["bin/unity.js", "scene", "tree",
                                        "--project-path", project, "--json"],
                                 { timeout: 180_000 });
         ctx.ui.notify(r.stdout || r.stderr, r.code === 0 ? "info" : "error");
       },
     });
     // 其余 /unity-* 同理：一个命令 = 一条 `node bin/unity.js <子命令>`
   }
   ```
   要点：命令名不能带 `/`（`registerCommand("unity-tree")` → 用户输入 `/unity-tree`）；
   参数自动补全用可选的 `getArgumentCompletions`；`pi.exec` 的 cwd 默认是会话 cwd，
   需要时用 `--project-path` 显式传，避免“打错工程”。
4. **零第三方依赖能否满足**：**能**。只用
   - `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"`（**type-only**，Pi 自带核心包，`packages.md` 要求列 `peerDependencies:"*"` 且不打包），
   - `pi.exec`（ExtensionAPI 内建），
   - Node 内建（`node:fs`/`node:path`，文档明示可用）。
   只有注册**自定义工具**（`pi.registerTool`）才需要 `typebox`；纯 `/unity-*` 命令**不需要**。
   `pi-unity` 当前 `dependencies: {}` 可保持为空。
5. **注意（不是阻碍，是设计选择）**：扩展命令在**交互式 TUI** 里才有意义；`prompt`/RPC 路径下
   extension command 不会被 `prompt` 调用（`extensions.md` §`pi.getCommands()` 明说 built-in 交互命令不在列表里）。
   因此 `/unity-*` 应定位为**人在环的快捷入口**（一键跑 `unity doctor` / `scene tree` / `shot`），
   而不是给 LLM 用的工具面 —— LLM 侧继续用现有 `bash` 调 `unity` 即可。

---

## 6. 清理与零污染证据

### 6.1 清理动作

| 动作 | 结果 | 证据 |
|---|---|---|
| 删 `CcNode` | `verified:true`，`deleted:true` | `cc-98-node-delete.json` |
| 删 `Assets/Art/CcAtlas.spriteatlas` | `DeleteAsset_ok:true`；`after_exists:false`；`after_allAssets_count:0`；文件+`.meta` 均不在磁盘 | `cc-98-atlas-delete.json` |
| 复原 `hero-blind.png` | `Single` + `FullRect`（`.meta` 与探针前**逐字节相同**，sha256 `7768cfea…`） | `cc-33`/`cc-34`/`cc-30-hero-meta-BEFORE.txt` vs `cc-34-hero-meta-AFTER2.txt` |
| `scene save` | `verified:true`，`sceneName=SampleScene` | `cc-99-scene-save.json` |

### 6.2 零污染读回（`cc-99-zero-pollution.json`）

```
atlas_LoadAssetAtPath_isNull : true
atlas_LoadAllAssetsAtPath_count : 0
atlas_file_on_disk / atlas_meta_on_disk : false / false
project_SpriteAtlasAsset_guids : []
project_SpriteAtlas_guids : []
hero_spriteImportMode / hero_spriteMeshType : Single / FullRect
hero_ppu / hero_textureType : 16 / Sprite
hero_nameFileIdTable_size : 0
hero_sprite : hero-blind|rect=(0,0,6,4)|bounds=(0.38,0.25,0.20)
CcNode_exists : false
Hero_spriteAssetPath : Assets/Art/hero-blind.png
rootGameObjectCount : 3
```

`cc-99-tree.json`：`nodeCount=3`，`Main Camera` / `Directional Light` / `Hero`（与 `cc-02` 基线**同构**）。
磁盘 `Assets/` 无任何 `*sactx*` / `*.spriteatlas*` 残留；`Packages/manifest.json` 中 `com.unity.2d` 计数 = 0（**未装包**）。

### 6.3 ⚠️ 唯一不可逆副作用：`scene save` 重写了场景文件（如实报告）

| | 值 |
|---|---|
| 保存前 | sha256 `3bc5baaf3b6debe5bdd39c3f3bc5ff8634b80a18ef1ef9c8c8a23cd31a89ba09`，**15206** 字节，mtime `2026-09-20T15:43:16Z` |
| 保存后 | sha256 `eb999e9394a799c3c955c36743a427185f05137cdd2db238111561111b7e8e9f`，**10398** 字节，mtime `2026-09-20T23:57:52Z` |
| 保存后内容 | 恰好 **3 个 GameObject**（`Hero` / `Directional Light` / `Main Camera`），`grep -c "Cc"` = **0** |

**解释**：探针**从未**保存过场景，所以保存前的磁盘文件来自**更早的会话**；
`scene save` 把**编辑器内存里的当前状态**落盘。保存前后**节点结构一致**（都是基线 3 节点），
但磁盘文件体积从 15206 → 10398 字节 —— 说明保存前的磁盘文件相对编辑器内存是**陈旧的**
（更可能是更早批次探针在某次 cleanup **之前**保存的、含已删除对象的旧快照），
而本次保存把内存中的**干净 3 节点**状态落盘。

**局限（如实）**：我在 `scene save` 之前**没有**对原文件做内容快照（只记了 hash/大小/mtime），
因此**无法逐字段给出差异**。这是本次流程的一个疏漏。
可复原性：官方工程**不是 git 仓库**，`Temp/__Backupscenes/0.backup` 是**二进制**（无文本节点名，且 mtime 23:10 早于原文件 23:43），**无法**用它还原。

> 若必须 100% 复原，需主会话确认：是否接受“场景 = 干净 3 节点”这一终态，或由更早的会话备份回滚。

### 6.4 控制台残留（内存态，不落盘）

`cc-99-logs-errors.json` 的 7 条 Error 全部是 §2.4 所述的**反射创建手法**产生的
（`ExtensionOfNativeClass` ×2、`wrapper.GetCachedPtr() == NULL` ×5），属于探针会话内存，
不影响磁盘资产；清理后未再触发。

---

## 7. 证据文件清单（`docs/m5-probes-raw/`）

| 文件 | 内容 |
|---|---|
| `cc-01-atlas-type.json` | （既有）三图集类型可解析、`Unity.2D.Sprite` 未加载 |
| `cc-02-baseline-tree.json` | 基线 `nodeCount=3` |
| `cc-03-atlas-reflect.{cs,json}` | `SpriteAtlasAsset`/`SpriteAtlasUtility`/`SpriteAtlas` 方法属性反射 |
| `cc-04-atlas-create.{cs,json}` | `ScriptableObject.CreateInstance` → **null**（失败） |
| `cc-05-atlas-create2.{cs,json}` | `GetUninitializedObject` 强转 `ScriptableObject` → `InvalidCastException` |
| `cc-06-atlas-basetype.{cs,json}` | 继承链证明 `SpriteAtlasAsset : UnityEngine.Object` |
| `cc-07-atlas-create3.{cs,json}` | `Activator`+`Internal_Create`+`Add`+`Save`（master atlas 为 0） |
| `cc-08-atlas-pack.{cs,json}` | `Load`/`GetMasterAtlas` 仍 null、`LoadAllAssetsAtPath` 无 `SpriteAtlas` |
| `cc-09-atlas-types.{cs,json}` | 全 `*SpriteAtlas*` 类型 + 静态方法（发现 `SpriteAtlasExtensions`） |
| `cc-10-atlas-create4.{cs,json}` | `SetMasterAtlas` 内存成功但 `Save` 不持久化子资产 |
| `cc-11-atlas-create5.{cs,json}` | `CreateAsset`+`AddObjectToAsset` → YAML 持久化成功 |
| `cc-12-atlas-pack2.{cs,json}` | `GetPackables` 0→1、`PackAtlases`、`spriteCount` 0→1 |
| `cc-13-atlas-readback.{cs,json}` | 失败版（internal 方法需 NonPublic） |
| `cc-13b-atlas-readback.{cs,json}` | 打包读回：`GetPackedSprites`/`GetPreviewTextures` |
| `cc-20-node-create.json` | 建 `CcNode` |
| `cc-21-assign-atlas.json` | **`sprite assign` 图集下 `verified:true`、assetPath=PNG** |
| `cc-22-inspect-atlas.json` | `node inspect` 独立复核 |
| `cc-23-atlas-still-packed.{cs,json}` | assign 后仍打包、`sr.sprite` == 打包 sprite |
| `cc-30-hero-meta-BEFORE.txt` / `.sha256` | 探针前 hero `.meta` 快照 |
| `cc-31-set-multiple.{cs,json}` | 设 `Multiple`（2 子 sprite）；`ti.spriteMeshType` CS1061 复现 |
| `cc-32-assign-multiple.json` | **`AMBIGUOUS_SPRITE` 硬失败** |
| `cc-33-restore-single.{cs,json}` / `cc-33-hero-meta-AFTER.txt` | 复原 `Single`/`FullRect` |
| `cc-34-clear-namefileid.{cs,json}` / `cc-34-hero-meta-AFTER2.txt` | 清 `nameFileIdTable` → `.meta` 逐字节复原 |
| `cc-98-node-delete.json` / `cc-98-atlas-delete.{cs,json}` / `cc-98-scene-BEFORE.sha256` | 清理动作 |
| `cc-99-scene-save.json` / `cc-99-scene-AFTER.sha256` | `scene save` + hash |
| `cc-99-tree.json` / `cc-99-zero-pollution.{cs,json}` / `cc-99-logs-errors.json` | 零污染读回 + 控制台错误 |

---

## 8. 给主会话的建议

1. **图集半可关闭**：官方版实测 `SpriteAtlas` 类型无需 `com.unity.2d.sprite`；
   `--world-size` 在图集打包下**无影响**（`verified:true`、`assetPath` 仍 PNG）→ 写进 PITFALLS U43 订正。
2. **不建议把“反射造图集”产品化**：`Activator.CreateInstance` 路径产生 `ExtensionOfNativeClass` /
   `GetCachedPtr` 控制台断言；若要支持建图集，应另找官方工厂或走编辑器菜单（记为新坑）。
3. **`Multiple` 结论不变**：`AMBIGUOUS_SPRITE` 硬失败。
4. **⑫ 可行**：`pi-extension/unity-commands.ts` + `package.json` 的 `pi.extensions` + `pi.registerCommand`/`pi.exec`，零第三方依赖。
5. **需主会话裁定**：`scene save` 造成的场景文件 hash 变化（§6.3）是否可接受。
