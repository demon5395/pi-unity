# CAPABILITIES — Unity 官方中国版 2022.3.62f3c1（对照 2022.3.62f1c1）/ uloop 3.6.3

> **实测记录，非文档转述。** 数据来源：2026-09-20 真机（`pi-unity-official-f3c1` / `pi-unity-official-f1` 两个**新建的官方版项目**）。
> 与团结侧 [`CAPABILITIES-tuanjie-2022.3.62t9.md`](CAPABILITIES-tuanjie-2022.3.62t9.md) **同形态、逐节对照**，差异集中在 §7。
> 逐项探测的**命令原文 / 退出码 / 关键输出**见 `docs/UNITY-OFFICIAL-VERIFICATION.md`（9 项清单表）。

**一句话结论**：**命令面 21 工具全部可用、7 项冒烟全 OK、golden 确定性成立、构建出 `UnityPlayer.dll`** ——
Q2「兼容 Unity 官方版」的核心成立；但有 **3 处硬差异**会让 SKILL 现文案在官方版上**直接误导**
（`.scene` 扩展名、`shot` 的窗口名本地化映射、`doctor` 的 `build-targets`）。

---

## 0. 验证总览（9 项探测清单）

| # | 项 | 官方版实测 | 与团结 |
|---|---|---|---|
| 1 | `doctor` 5 项 | ✅ **5/5 pass**（`editor-install` 发现 3 个编辑器，走 `unity:hub-default`） | ⚠️ `editor-language` / `build-targets` **取值错**（§7.2） |
| 2 | `--smoke` / `--golden` | ✅ **7/7 pass**；`matched:true`（两轮各 6 节点） | 一致 |
| 3 | `scene tree` / `node` CRUD | ✅ 全通过；小场景内联 `components`、34 节点 → **`componentsLut`+`componentsIdx`** | 一致（R316 复现） |
| 4 | `sprite set` + `shot` + `pixels` | ✅ 三者可用；❌ **`shot` 在 EditMode 必然失败**（窗口名映射） | ❌ **不同**（§7.3） |
| 5 | `play start/status/logs/stop` + `exec` | ✅ 全通过；**R263 成立**（Play/Stop 无 `Success`）；`key` 如实落 `INPUT_SYSTEM_UNAVAILABLE` | 一致 |
| 6 | `asset write` + `compile` | ✅ sha256 读回 + 自动 refresh；编译错回 `Success:false` + 结构化 `errors[]` | 一致（R275 逐字相同） |
| 7 | `scene save` / `scene open` | ✅ **但只认 `.unity`**（`.scene` → `SAVE_FAILED` / `OPEN_FAILED`）；**R356/R357 成立** | ❌ **不同**（§7.4） |
| 8 | `build` | ✅ win64 → **`UnityPlayer.dll`**；`webgl`/`android` 均 `BUILD_TARGET_UNAVAILABLE` | 产物名不同、可用目标不同（§7.5） |
| 9 | `PITFALLS` U11–U26 回访 | 见 [`PITFALLS.md`](PITFALLS.md) 各条「适用引擎」行 | 12 条共有 / 2 条官方特有 / 其余未涉及 |

环境：**Unity 官方中国版 2022.3.62f3c1**（`1623fc0bbb97`）+ 复跑版 **2022.3.62f1c1**（`b0109b07edb8`）
+ uloop 包 **3.6.3** + dispatcher **3.5.1** + project-runner **3.4.0**（与团结侧同版本）。

> ⚠️ **两个「官方版」都是中国构建**（`ProductVersion` 带 `c1`），**真国际版在本网络不可得**（见 `UNITY-OFFICIAL-VERIFICATION.md` 环境一节）。
> 因此本文件回答的是「**是否绑死团结**」，不是「是否与 Unity 国际版逐字节一致」。

---

## 1. 安装面（官方版）

| 项 | 实测 |
|---|---|
| 编辑器 | `C:\Program Files\Unity\Hub\Editor\2022.3.62f3c1\Editor\Unity.exe`（主用）、`…\2022.3.62f1\Editor\Unity.exe`（复跑） |
| ProductVersion | `2022.3.62f3c1_1623fc0bbb97` / `2022.3.62f1c1_b0109b07edb8` |
| `ProjectSettings/ProjectVersion.txt` | `m_EditorVersion: 2022.3.62f3c1` + `m_EditorVersionWithRevision: 2022.3.62f3c1 (1623fc0bbb97)` |
| 许可证 | `C:\ProgramData\Unity\Unity_lic.ulf`（2645 B）；日志 `[Licensing::Client] Successfully resolved entitlement details`、`Serial number assigned to: "F4-4V8E-VRT8-7ZJX-K8AN-XXXX"` |
| `-batchmode -createProject` | ✅ **20s 内完成**（`Exiting batchmode successfully now! … return code 0`），**无包拉取等待** |
| 新建项目内容 | **空 3D 项目**：`Assets/` 为空（**无场景文件**）、`Main Camera` 是 **透视**相机（`orthographic=False`，`size=5` 不生效，位置 `(0,0,0)+(0,1,-10)`）；`Packages/manifest.json` 只有 `com.unity.modules.*` |
| 模块（`Data/PlaybackEngines/`） | **只有 `windowsstandalonesupport`**（f1 / f3c1 完全相同） |
| 依赖解析 | `file:C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp`（`source=local`, depth 0）→ `com.unity.ugui 1.0.0`(**builtin**) + `com.unity.nuget.newtonsoft-json 3.2.1`(registry, depth 1) + `com.unity.nuget.mono-cecil 1.11.6`(registry, depth 1) —— **与团结 S0Project 逐字相同** |
| 首次编译 | **44 asmdef → 42 个 `UnityCLILoop.*.dll`**（另有 `Assembly-CSharp` / `UnityEngine.UI` / `UnityEditor.UI` / `Unity.InternalAPIEditorBridge.024`，共 46 DLL）；**0 error / 0 warning**；`compile time=4451 ms`、`domain reload time=762 ms` |
| `.uloop/tools.json` | ✅ 生成，**21 个工具，与团结侧同名同序同集合** |

**为什么是 42 而不是 44**（非缺陷，**条件装配**）：`UnityCLILoop.FirstPartyTools.RunTests.TestFramework.Editor.asmdef` 带
`defineConstraints: ["ULOOP_HAS_TEST_FRAMEWORK"]` + `versionDefines: com.unity.test-framework`；官方**空项目没装
`com.unity.test-framework`**（团结 S0Project 是 Hub 模板建的，带 `1.1.33`）→ 该程序集被跳过。
另一个是 Unity 自带的 `Unity.InternalAPIEditorBridge.024`（同名文件由 Unity 提供，非我们编译产出）。

### ⚠️ 官方版 GUI 启动有**阻塞式管理员警告对话框**（本机必踩）

以管理员身份启动（本机 `管理员` 账户下**必然**如此）时，Unity 在**写日志文件之前**弹出模态框：

```
[#32770] "Unity is running as administrator."
  Button: "&Restart Unity as a standard user"
  Button: "&I wish to continue at my own risk"
```

- **点「continue at my own risk」才会继续**（实测：点之前 `editor.log` **根本没被创建**，进程只有 ~117 MB 且不动）；
- **不点 = 编辑器永远不启动**，`uloop` 侧看到的是「连不上」；
- **不要点「Restart as a standard user」** —— 实测它会**重启编辑器并再次弹同一个框**（在 管理员会话里无限循环）；
- 静默/脚本化处置：对窗口发 `BM_CLICK`（`0x00F5`）到标题为 `&I wish to continue at my own risk` 的按钮。
- 团结侧**没有**这个对话框（本次全程只开官方版，团结未复测该点）。

---

## 2. 依赖面 / 包管理

| 项 | 官方版实测 |
|---|---|
| vendor 方式 | `Packages/manifest.json` 里 `"io.github.hatayama.uloopmcp": "file:C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp"` —— **一次成功**，未走 OpenUPM（U1 的绕法在官方版上同样有效） |
| Newtonsoft | `com.unity.nuget.newtonsoft-json 3.2.1`，`source=registry`，`depth=1` —— **与团结一致** |
| Mono.Cecil | `com.unity.nuget.mono-cecil 1.11.6`，`source=registry`，`depth=1` —— **与团结一致** |
| `com.unity.ugui` | `1.0.0`，`source=**builtin**` —— 官方版**内置**（团结侧同样是 builtin，但团结 S0Project 把它显式写进了 manifest 的 `depth=0`） |
| 注册表可达性 | 本机走 `packages.unity.cn`（中国 registry），解析全部成功（无超时） |
| `PiBrickBreaker` 模板写入 | `unity asset write --template PiBrickBreaker` → `verified:true`，`sha256` 写后读回一致，`compiled:true` / `errorCount:0` |

---

## 3. 信封结构（官方版逐字段抽查）

**与团结侧同形**（抽查了 `get-hierarchy` / `compile` / `execute-dynamic-code` / `control-play-mode` / `list` 五处）：

| 形状 | 官方版实测 |
|---|---|
| `execute-dynamic-code` 成功 | `{Success:true, Result:"…", Logs:[…], CompilationErrors:[]}` —— `Result` 拿到脚本 `return` 值 |
| `compile` 干净 | `{"ErrorCount":0,"WarningCount":0,"Errors":[],"Warnings":[],"Success":true}` |
| `compile` 有错 | **`Success:false`** + `Errors:[{Message,File,Line}]`（**R275/U19 同形**） |
| `get-hierarchy` 落盘 | `{"sceneName":…,"stats":…,"roots":[…]}`；大场景多一个 `componentsLut` 键 |
| `control-play-mode` 跨 domain reload | **无 `Success` 字段**（R263，§4.5） |
| `uloop list`（dispatcher 级） | `{"Version":"3.4.0","Tools":[…]}`（21 项）——**无 `Success`**（U14 同形） |
| 工具级**平铺**失败 | `{"Success":false,"Message":"PlayMode rendering did not produce an image.","NextActions":[…]}` —— 无 `Error` 子对象、无 `ErrorCode`（U12 同形） |

---

## 4. 工具可用性（21 个，官方版）

工具清单（`.uloop/tools.json`，与团结**逐字相同**）：
`control-play-mode / simulate-mouse-ui / simulate-mouse-input / enable-pause-point / clear-pause-point /
record-video / run-tests / set-game-view-size / get-watch-values / clear-watch / enable-watch / compile /
get-hierarchy / find-game-objects / simulate-keyboard / hot-reload / replay-input / clear-console /
screenshot / execute-dynamic-code / get-logs`（**21**；`control-play-mode.Action` 枚举 = `Play, Stop, Pause, Step, Status, Resume`，同）。

### 4.1 `doctor`（官方版实测输出）

```
  OK  uloop              dispatcher: C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe
  OK  editor-install     2022.3.62t9 (tuanjiehub:secondaryInstallPath), 2022.3.62f1 (unity:hub-default), 2022.3.62f3c1 (unity:hub-default)
  OK  editor-language    zh_CN（hub: C:\Users\<用户>\AppData\Roaming\TuanjieHub）
  OK  build-targets      AndroidPlayer, WeixinMiniGameSupport, windowsstandalonesupport
       hint: 未安装 WebGL 模块：…
  OK  editor-connection  uloop 3.4.0 已连接
```

- `editor-install` ✅ **确实能发现 `Unity.exe`**（`unity:hub-default` 分支命中，U6/R13 的团结路径特例**没有**挡住官方版）；
- 但同一行还把团结一起列出来，且**顺序是团结在前** → 后两项取值来自**团结**（§7.2）；
- `editor-connection` 绿 ⇒ 编辑器进程活着且打开了该项目（与 U14 的结论一致）。

### 4.2 `--smoke` / `--golden`

```
compile OK errors=0 warnings=0 | get-logs OK total=0 | get-hierarchy OK saved: .uloop\outputs\HierarchyResults\…
write-create OK verified:true | write-set OK verified:true | write-delete OK verified:true | write-clean OK 无残留
--golden: 轮 1 节点数：6 / 轮 2 节点数：6 / matched:true / diff:null / cleanup ok
```

### 4.3 场景与节点（`scene tree` / `node inspect|create|set|delete`）

- **新建项目打开时 `sceneName` 是空串**（`""`，未命名场景），落盘后变 `SampleScene`；
- `node create` / `set` / `inspect` / `delete` 全部 `verified:true`（`resolve` 出的组件短名、`sprite:null` 字段形状与团结一致）；
- **float32 反例复现**：`node set --patch '{"position":{"x":100000.123,…}}'` → 读回 `100000.125` → **`verified:false`、退出码 1**（U15 在官方版上**同样成立**）；
- **`components` 两种形状都复现**：2–3 个根节点时逐节点内联 `components`；**34 节点**时落盘 JSON 顶层出现
  `componentsLut:["Transform","Camera","AudioListener","Light","SpriteRenderer"]` + 逐节点 `componentsIdx`（**无** `components` 键）——
  `unity scene tree` 两种形状都能给出短名（R316 的解析在官方版上同样必要）。

### 4.4 `sprite set` + `shot` + `pixels`

- `sprite set --color '#FF2E88' --sorting-order 3` → `verified:true`，读回 `color {255,46,136,255}`、`sortingOrder 3`、**`spriteName:""`**（运行时 sprite，无名字——与团结一致）；
- 进 PlayMode 后 `spriteName` **变 `null`**（domain reload 销毁运行时 sprite，**U20 同样成立**），补跑一次 `sprite set` 后同帧渲染图 `--count-color '#FF2E88'` = **110224 px**、中心 `rgb(255,46,136)`；
- `pixels --at` / `--count-color` / 退出码口径与团结一致；
- ❌ **`unity shot` 在官方版 EditMode 下必然失败**（本机与团结共存时）：`WINDOW_NAME_LOCALIZED`，退出码 1，见 §7.3；
- ✅ PlayMode 下 `--capture-mode rendering` 可用（须**先打开 Game 视图**，见 §7.6）。

### 4.5 `play` / `exec`（R263 逐字复现）

原生 `uloop control-play-mode` 的响应形状（官方版实测）：

| 调用 | 顶层有 `Success`？ | 备注 |
|---|---|---|
| `--action Play`（Edit→Play，跨 domain reload） | **没有** | 字段与团结逐字同序：`IsPlaying,IsPaused,Changed,WasAlreadyStopped,ResumedFromPause,BlockedByCompileErrors,BlockedByUnsavedChanges,CompileErrorCount,CompileErrors,Message,Warning` |
| `--action Stop`（Play→Edit，跨 domain reload） | **没有** | `Message:"Play mode stopped"`, `Warning:""` |
| `--action Pause` | **有**（`true`） | 无 `Warning` 键 |
| `--action Status` | **有**（`true`） | 带 `StoppedBy/StoppedAt` |

→ **R263 在官方版上照样成立**：`lib/play.js` 里那条「跨 domain reload 的回包无 `Success`」的窄口径例外
**不是团结特有的补丁**，在官方版上**同样必需**（否则 `play start/stop` 会假红）。实测
`unity play start` → 退出码 0 / `verified:true` / `isPlaying:true`，`unity play stop` → 退出码 0 / `verified:true`。

- `play logs` ✅（`totalCount` / `displayedCount` / `logs[]` 形状一致）；
- `play view --width 960 --height 640` ✅（`previousWidth:1532 previousHeight:769` → `960x640`）；
- `unity exec --code-file` ✅ —— PlayMode 里读回 `isPlaying=True dataPath=…/Assets productName=pi-unity-official-f3c1 unityVersion=2022.3.62f3c1 scenePath=Assets/Scenes/SampleScene.unity rootCount=2`；
- `play key --action Press --key Space` ❌ **`INPUT_SYSTEM_UNAVAILABLE`**（项目未装 Input System）—— **U25 同形**，退出码 1，报文逐字相同。

### 4.6 `asset write` + `compile`

- `asset write --to Assets/PiBrickBreaker/PiBrickBreaker.cs --template PiBrickBreaker` → `verified:true`（`bytes:11754`，写回 sha256 三方一致），**顺带编译 `compiled:true / errorCount:0`**；
- **`compile` 自动 refresh**：用 shell（**不经 CLI**）往磁盘写一个 `Assets/PiProbe/Broken.cs`，直接 `unity compile` →
  退出码 **1** + `COMPILE_FAILED` + `errors[0] = {message:"Assets\\PiProbe\\Broken.cs(1,42): error CS1525: Invalid expression term ';'", file, line:1}`
  —— **与团结侧记录逐字相同**（R275 同形，且证明 plain `compile` 自己会拉起外部改动）；
- 删掉坏文件后 `unity compile` → 退出码 0、`errorCount:0`。

### 4.7 `scene save` / `scene open`

| 命令 | 官方版实测 |
|---|---|
| `scene save --path Assets/Scenes/SampleScene.scene` | ❌ `SAVE_FAILED`（退出码 1）—— `SaveScene` 返回 `false`（**父目录存在也一样**） |
| `scene save --path Assets/Scenes/SampleScene.unity` | ✅ `verified:true`，`mtimeBefore 0001-01-01 → mtimeAfter 2026-09-20T01:20:16Z`（文件真落盘） |
| `scene save`（无 `--path`，当前场景已命名） | ✅ `verified:true`，`mtime` 前进 |
| `scene open --path …/SampleScene.unity`（不脏、无 `--force`） | ✅ `verified:true`，`sceneName:SampleScene` |
| `scene open --path …/FromTuanjie.scene`（团结的 `.scene`） | ❌ `OPEN_FAILED`：`Scene file path not valid: 'Assets/Scenes/FromTuanjie.scene'. **Extension should be '.unity'**` |
| 同上内容**改名** `.unity` 再开 | ❌ `OPEN_FAILED`：`Cannot open scene with path …`（YAML tag `yousandi.cn,2023` 不被接受） |
| `scene save --path`（裸写） | ✅ 用法错口径一致：`BAD_TARGET_PATH`，退出码 2 |

**R356 / R357 官方版实测**：

| 探针 | 官方版结果 |
|---|---|
| `node create` 之后 `EditorSceneManager.GetActiveScene().isDirty` | **`False`**（CLI 造的改动**不置 dirty**，U27 同形） |
| `EditorSceneManager.SaveOpenScenes()` | 返回 **`True`**，但场景文件 **mtime 逐字未变**、磁盘内容里**搜不到**刚建的节点（R356 同形） |

→ **R356/R357 是 Unity 家族共有的行为**，`scene save` 里「不用 `SaveOpenScenes`、改逐场景 `SaveScene` +
核对 mtime 前进」的防御分支在官方版上**同样必需**（**不是**多余分支）。
`play start` 的脏场景守卫也只在 `isDirty=true` 时生效：脚本新建的未命名场景 `isDirty=False` → 守卫**看不见**
（`play start` 直接成功）；手工 `MarkSceneDirty` 后 → `CONTROL_PLAY_MODE_UNSAVED_CHANGES`（退出码 1，报文同团结）。

### 4.8 `build`

| 项 | 官方版 f3c1 | 官方版 f1 | 团结果 S0Project（对照） |
|---|---|---|---|
| `--target win64` | ✅ `verified:true` / `result:Succeeded` / `totalErrors:0` | ✅ 同 | ✅ 同 |
| 端到端耗时 | **4.82s** | **4.78s** | 13s（首次）/ ~2s（增量） |
| 磁盘总字节 | **71,259,785 B（67.9 MB）** | **71,247,830 B** | 114,718,252 B（109.4 MB） |
| 文件数 | 129 | — | — |
| 主产物 | `<productName>.exe`（666,624 B） | 同 | `<productName>.exe`（464 KB） |
| 播放器 DLL | **`UnityPlayer.dll`（31,200,080 B）** | **`UnityPlayer.dll`** | `TuanjiePlayer.dll`（44 MB） |
| 崩溃处理器 | **`UnityCrashHandler64.exe`** | 同 | `TuanjieCrashHandler64.exe` |
| 其余 | `MonoBleedingEdge/`、`<productName>_Data/` | 同 | 同 |
| `report.summary` 形状 | `result/totalErrors/totalWarnings/totalSize/steps` —— **逐字段与团结侧同形**；`sizeBytes == reportedSizeBytes`（无 Burst 目录） | 同 | 同 |

- **产物名取自 `Application.productName`**：本机新建项目的 productName 就是**工程目录名** `pi-unity-official-f3c1`（与团结侧「`2D Project`」同样的坑面）；
- `unity build --target webgl` → ❌ `BUILD_TARGET_UNAVAILABLE`、`actual.available = ["win64"]`、**输出目录根本不创建**（U9 逻辑一致）；
- `unity build --target android` → ❌ **同样 `BUILD_TARGET_UNAVAILABLE`**，尽管 `doctor` 的 `build-targets` 里**列着 `AndroidPlayer`**（§7.2）；
- ❌ **未保存场景会挡住构建**：f1 未落盘场景时 `unity build --target win64` → `BUILD_NO_SCENES`（退出码 1，`actual.__error`）；`scene save --path …unity` 之后立刻成功；
- 产物**能跑**：启动主 exe + `-logFile`，进程存活（~132 MB），`player.log` **21 行、0 error**，含
  `Mono path[0]`、`GfxDevice: Direct3D 11.0`、`Renderer: NVIDIA GeForce RTX 4070 SUPER`、`Initialized touch support`、
  `Initialize engine version: 2022.3.62f3c1 (1623fc0bbb97)`（与团结侧 S8 的验证口径一致）。

---

## 5. 坐标公式（官方版注意：默认项目是**透视**相机）

`unity shot` 的响应字段面与团结一致（实测 rendering 模式）：

```json
{ "path": "…Rendering_20260920_092104_936.png", "width": 960, "height": 640,
  "captureMode": "rendering", "windowName": "游戏", "resolutionScale": 1,
  "imageCoordinateSystem": "top-left-game-view", "imageToInputOffsetY": 0,
  "gameViewWidth": 960, "gameViewHeight": 640,
  "screenshotToInputFormula": "simulate_mouse_x = image_x / resolutionScale; simulate_mouse_y = image_y / resolutionScale + imageToInputOffsetY",
  "unityInputFormula": "unity_x = input_x; unity_y = gameViewHeight - input_y" }
```

> ⚠️ `windowName` 在 `rendering` 模式下**被原样回显但被忽略** —— 所以它回显 `"游戏"` **不代表**截图用的是中文窗口。

**SKILL §8⑤ 的换算公式只在正交相机下成立**。官方版 `-createProject` 出来的空 3D 项目里
`Camera.main` 是**透视**（`orthographic=False`，`orthographicSize=5` 不参与成像，位置 `(0,1,-10)`，FOV 60）：

| 探针 | 官方版实测 | 正交公式预期 |
|---|---|---|
| 6×6 世界单位的纯色 sprite（z=0）在 960×640 rendering 图里的同色像素数 | **110224 px**（≈332×332） | 147456 px（≈384×384，`ppu=640/(2×5)=64`） |
| 中心像素 | `rgb(255,46,136)` = `#FF2E88` | — |

→ 结论：**像素判定的公式要用实际相机参数算**（打砖块配方里的正交相机才适用 §8⑤）；本机官方版默认场景是透视，
两者不可混用。**判定「渲染对不对」用 `--at` / `--count-color` 这类相对判据**，不依赖像素级坐标换算。

---

## 6. 构建出包（官方版）

见 §4.8。要点：

1. **产物名不硬编码也能两边都对**：`lib/build.js` 只读磁盘 + `Application.productName`，官方版拿到
   `UnityPlayer.dll`/`UnityCrashHandler64.exe`，团结版拿到 `TuanjiePlayer.dll`/`TuanjieCrashHandler64.exe` —— **无需改代码**；
2. **可用目标由编辑器决定**，而与 `doctor` 的 `build-targets` 不一定是同一台编辑器（§7.2）：
   官方版实测 `actual.available = ["win64"]`（只有 `windowsstandalonesupport`）；
3. **构建前必须先落盘场景**（`BUILD_NO_SCENES`），且落盘路径必须是 `.unity`；
4. 体积比团结侧小 ~42 MB（无 Burst / 无 Android 模块等因素，**未逐项归因**）。

---

## 7. 与团结的差异表（**本轮最重要的产出**）

### 7.1 文件 / 产物命名（**U10 完全证实，且比原记录更硬**）

| 面 | 团结 2022.3.62t9 | Unity 官方 2022.3.62f3c1 | 影响 |
|---|---|---|---|
| 场景扩展名 | **`.scene`** | **`.unity`**（**只认它**） | `scene save --path X.scene` → `SAVE_FAILED`；`scene open --path X.scene` → `OPEN_FAILED: Extension should be '.unity'` |
| 场景 YAML tag | `%TAG !u! tag:yousandi.cn,2023:` | `%TAG !u! tag:unity3d.com,2011:` | 团结 `.scene` **改名成 `.unity` 也打不开**（`Cannot open scene with path`）—— 两种格式**互相不可读** |
| 播放器 DLL | `TuanjiePlayer.dll` | **`UnityPlayer.dll`** | `lib/build.js` **不硬编码** → 两边都对 |
| 崩溃处理器 | `TuanjieCrashHandler64.exe` | **`UnityCrashHandler64.exe`** | 同上 |

### 7.2 `doctor` 的两项在**多引擎共存机**上取值错

| 项 | 团结机上 | 官方版项目上（本机） | 机制 |
|---|---|---|---|
| `editor-language` | `zh_CN` ✅ | **`zh_CN` ❌**（该编辑器实际是**英文界面**：`GameView=>Game / SceneView=>Scene / ConsoleWindow=>Console / SceneHierarchyWindow=>Hierarchy / ProjectBrowser=>Project / InspectorWindow=>Inspector`） | `lib/editor-discovery.js` 的 `hubRoot()` **写死 `%APPDATA%\TuanjieHub`**，只读它的 `languageConfig.json`；与「当前连的是哪个编辑器」无关 |
| `build-targets` | `AndroidPlayer, WeixinMiniGameSupport, windowsstandalonesupport` ✅ | **同一串 ❌** —— 真实值应是 **只有 `windowsstandalonesupport`** | `lib/doctor.js` 用 `editors[0]`（发现顺序里**团结在前**）的 `Data/PlaybackEngines`；**不是**连着的那个编辑器 |

**后果（实测）**：`doctor` 说 `android` 可用 → `unity build --target android` 落
`BUILD_TARGET_UNAVAILABLE`（`actual.available:["win64"]`）。**doctor 的 build-targets 在双引擎机上不可信**（已记入 PITFALLS）。

### 7.3 `unity shot` 的窗口名映射（**U7 的镜像坑**）

| 场景 | 团结（中文界面） | 官方版（英文界面，本机与团结共存） |
|---|---|---|
| `unity shot`（默认） | ✅ 用 `游戏` 命中 | ❌ `WINDOW_NAME_LOCALIZED`，退出码 1：`Window '游戏' not found` |
| `--window-name Game` | ✅（映射后命中中文） | ❌ 仍映射成 `游戏` → 同样失败 |
| `--match-mode contains/prefix` | 可用 | ❌ **救不回来**（`场景` 不可能是 `Game` 的子串） |
| `--capture-mode GameView`（EditMode） | — | ❌ `Rendering screenshots require PlayMode, but Unity is currently in EditMode.` |
| `--capture-mode rendering`（PlayMode） | ✅ | ✅（**PlayMode 下窗口名被忽略**） |
| `unity shot`（PlayMode，默认 `auto`） | ✅ → rendering | ✅ → **解析为 `rendering`**，退出码 0 |

→ 结论：**映射是单向的，官方英文界面上 EditMode 截图无路可走**（只能进 PlayMode）。
根因同 §7.2 的 `hubRoot()`：语言判定不来自被连的编辑器。
**反证**：`windowNameFor('Game','en_US') === 'Game'`（恒等）→ **如果机器上只有官方版、没有 TuanjieHub 目录，
`language()` 返回 `en_US`，默认 `shot` 是好的**。即该缺陷只在「团结 + 官方共存」的机器上暴露（本机正是如此）。

### 7.4 场景落盘语义

| 面 | 团结 | 官方版 |
|---|---|---|
| `SaveOpenScenes()` 返回值 | `true` 但不写盘（R356） | **同**（`true` 但 mtime 未变、内容没有新节点） |
| CLI 改动是否置 `isDirty` | 否（R357/U27） | **同**（`node create` 后 `isDirty=False`） |
| `scene save` 的 `.scene` 路径 | ✅ 正常 | ❌ `SAVE_FAILED`（**必须 `.unity`**） |
| `play start` 脏场景守卫 | `CONTROL_PLAY_MODE_UNSAVED_CHANGES` | **同**（手工 `MarkSceneDirty` 后逐字同报文）；`isDirty=False` 时守卫同样失明 |

→ 三条防御（`SaveScene` + mtime 核对、`isDirty` 守卫、`scene save` 前置于 `scene open`）**在官方版上全部仍然必要**。

### 7.5 构建面

| 面 | 团结 | 官方版 |
|---|---|---|
| 可用目标（真实） | `win64` / `android` / `weixin` | **只有 `win64`**（只装 `windowsstandalonesupport`） |
| `webgl` | ❌ 未装 | ❌ 未装（**两个引擎都不可用**，U9 不是引擎特性） |
| 产物播放器 | `TuanjiePlayer.dll` | `UnityPlayer.dll` |
| 体积（空场景） | 109.4 MB | **67.9 MB** |
| 首次构建端到端 | 13s | **4.8s** |
| `report.summary` 形状 | — | 同形（`result/totalErrors/totalWarnings/totalSize`） |

### 7.6 官方版新增的**环境**差异（非引擎语义）

1. **管理员警告对话框**（§1）——脚本化启动必须先点掉，否则编辑器不启动；
2. **新建项目的 Game 视图默认没被「打开」** → 首次 `shot --capture-mode rendering` 在 PlayMode 里也落
   `ULOOP_ERROR: PlayMode rendering did not produce an image.`，`play logs` 里有
   `[EditorWindowCaptureUtility] Play Mode view RenderTexture is not available`；
   **手动打开 Game 视图**（`EditorWindow.GetWindow(typeof(GameView)).Show()`）后同一条命令立刻成功（960×640）。团结侧历史上没遇到（盲测项目是 Hub 模板建的，布局里 Game 视图是打开的）→ **是否为官方版独有未定论**。

### 7.7 **不**差异（逐条复现一致的项）

`doctor` 5 项通过与否 / `--smoke` 7 项 / `--golden` 确定性 / 21 工具集合与枚举 / 信封两种形状 /
`compile` 结构化错误（**报文逐字相同**）/ `asset write` sha256 读回 / `node` CRUD 的 `verified` 语义 /
float32 大坐标 `verified:false` / `componentsLut` 切换 / `serialize` 出 `spriteName:""`→PlayMode `null` /
`INPUT_SYSTEM_UNAVAILABLE` / **R263**（Play/Stop 无 `Success`）/ **R356**（`SaveOpenScenes` 假成功）/
**R357**（CLI 改动不置 dirty）/ `uloop list` 无 `Success` / 工具级平铺失败形状 / 依赖解析版本号。

---

## 8. 仍未验证 / 剩余不确定性

| 项 | 状态 |
|---|---|
| **Unity 国际版**（`2022.3.62f1` 非 `c1`） | ❌ **本网络不可得**（所有 `download.unity3d.com` 请求 302 到 `download.unitychina.cn`）。本轮两个版本都是**中国构建**，故「与国际版一致」**未验证** |
| `android` / `weixin` 出包 | ❌ 官方版**没装这些模块**（`actual.available=["win64"]`），未测 |
| `webgl` 出包 | ❌ 两个引擎都没装模块（U9） |
| Input System 系工具（`key`/`mouse`） | ❌ 项目未装 `com.unity.inputsystem`（U25）；用具名失败报文验证了边界 |
| `pause-point` / watch / `hot-reload` / `record-video` / `replay-input` / `find-game-objects` / `run-tests` | ❌ 未测（与团结侧同） |
| 团结 `.scene` ↔ 官方 `.unity` 的**互相迁移** | ❌ 官方打不开团结场景（扩展名 + YAML tag 双重拦截）；**反向**（官方场景给团结）**未测** |
| 管理员对话框是否团结也有 | ❌ 未复测（本轮不开团结） |
| `GameView` 未打开导致 rendering 截图失败是否官方独有 | ⚠️ 未定论（见 §7.6.2） |
| 两个官方版之间的差异 | ✅ 复跑 5 项（doctor / smoke / shot 窗口名 / `scene save .scene` 失败 / build 产物名）**全部一致** |
