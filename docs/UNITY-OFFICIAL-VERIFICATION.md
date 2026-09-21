# Unity 官方版兼容性验证（M3 backlog 第 4 项 / Q2 的核心主张）

> **目的**：验证设计文档 Q2 —— 「**兼容 Unity 官方版**（不依赖团结私有 API）」。这是**对主张本身的验证**，不是新功能。
> **现状**：本机此前**只有团结引擎 2022.3.62t9**；`docs/PITFALLS.md` 里 **U11 起逐条标注适用引擎**，其中大量条目写着「Unity 官方未验证」。本清单就是去把这些「未验证」变成「已验证/已证伪」。

## 目标版本

| 版本 | changeset | 说明 |
|---|---|---|
| **`2022.3.62f1`（国际版，首选）** | `4af31df58517` | **与团结 2022.3.62t9 同补丁号** → 苹果对苹果比较；也是最严格的「官方版」证据 |
| `2022.3.62f3c1`（中国版，备选） | `1623fc0bbb97` | 中国 CDN 直接提供；若国际版下载不可用再退到这里 |

## 环境准备（注意：**不要用团结的项目**）

1. **Unity Hub 登录**（一次性人工步骤）：登录后 Personal 许可证才会落到本机。
2. 装编辑器（headless）：
   `"Unity Hub.exe" -- --headless install --version 2022.3.62f1 --changeset 4af31df58517`
   （需要 Windows 模块时加 `--module windows-il2cpp`；WebGL 模块可选 —— 本机团结侧 WebGL 未装，官方版若装了就能顺带验证 U9）
3. **新建一个官方版项目**（`Unity.exe -createProject <dir>` 或 Hub GUI）。
   ⚠️ **不要用团结的项目**：团结的 `.scene` YAML tag 是 `yousandi.cn`（U10），官方版很可能直接打不开 —— 这本身就是 U10 的一个待验证点，但别让它挡住主流程。
4. vendor uloop（走 codeload tarball → `Packages/manifest.json` 写 `file:` 引用，U1；**不走 OpenUPM**），然后 `doctor` 应能连上。

## 逐项探测清单（每项记 **真实输出 + 退出码**，并与团结的实测值并列）

| # | 项 | 特别要看什么（团结侧的已知行为 → 官方版是否相同） |
|---|---|---|
| 1 | `doctor` 5 项 | `editor-install` 要能发现 **`Unity.exe`**（U6/R13 是团结路径特例）；`editor-language`；`build-targets` |
| 2 | `doctor --smoke` / `--golden` | **7/7 pass**、`matched:true`。**golden 跨引擎最有信息量**（确定性/结构投影是否同样成立） |
| 3 | `scene tree` / `node inspect`/`create`/`set`/`delete` | 场景扩展名（U10：团结是 `.scene`）；`siblingIndex`/`components`（**含大场景的 `componentsLut` 形态**，R316） |
| 4 | `sprite set` + `shot` + `pixels` | **窗口名在官方版是英文 `Game`/`Scene`**（U7 是中文「游戏/场景」）→ `unity shot` 的本地化映射是否**双向**都对；PlayMode `--capture-mode rendering`；`pixels` 判据 |
| 5 | `play start/status/logs/stop` + `exec` | `control-play-mode` 的 **Play/Stop 无 `Success` 字段**（R263）是否同样成立；`exec` 动态 C# 可用性；无 Input System 时的 `INPUT_SYSTEM_UNAVAILABLE`（U25） |
| 6 | `asset write` + `compile` | 编译错回 `Success:false` + `CompilationErrors`（R275）；`compile` 自动 refresh（任务 8 判据④） |
| 7 | `scene save` / `scene open` | `SaveOpenScenes()` **返回 true 却不写盘**（R356）是否同样；`isDirty` 守卫；CLI 造的改动不置 dirty（R357/U27） |
| 8 | `build` | 产物应是 **`UnityPlayer.dll`**（团结是 `TuanjiePlayer.dll`，U10 + 约束 24）；`--target webgl` 的可用性（U9）；`report.summary` 形状；耗时/体积 |
| 9 | 逐条回访 `PITFALLS` U11–U26 | 每条标「Unity 官方未验证」的，标注成 **两引擎共有 / 仅团结 / 仅官方** |

---

## ✅ 实测结果（2026-09-20，已按上表逐项跑完）

> 环境：**Unity 官方中国版 2022.3.62f3c1**（`1623fc0bbb97`，主用）+ **2022.3.62f1c1**（`b0109b07edb8`，复跑对照）
> + uloop 包 3.6.3 / dispatcher 3.5.1 / project-runner 3.4.0；项目 = 两个**新建的官方版项目**（不碰团结项目、不碰用户工程）。
> 逐条命令原文/退出码见 `docs/CAPABILITIES-unity-2022.3.62f3c1.md` 与 `.superpowers/sdd/2026-09-19-pi-unity-m3-exec/unity-official-verify-report.md`。

| # | 项 | 官方版实测值 | 团结 2022.3.62t9 已知值 | 结论 |
|---|---|---|---|---|
| 1 | `doctor` 5 项 | ✅ **5/5 pass**；`editor-install` = `2022.3.62t9 (tuanjiehub:secondaryInstallPath), 2022.3.62f1 (unity:hub-default), 2022.3.62f3c1 (unity:hub-default)` → **确实能发现 `Unity.exe`**；⚠️ `editor-language` = **`zh_CN`**（但该编辑器界面是**英文**）；⚠️ `build-targets` = `AndroidPlayer, WeixinMiniGameSupport, windowsstandalonesupport`（其实是**团结的**列表，官方版只有 `windowsstandalonesupport`） | 同 5/5 pass；`editor-language zh_CN`（界面确实是中文）；`build-targets` = 同三串（**是它自己的**） | 通过与否**一致**；⚠️ **取值**在两处不一致（双引擎共存导致，见 `PITFALLS` 官方-3） |
| 2 | `--smoke` / `--golden` | ✅ **7/7 pass**（compile 0/0、get-logs total=0、get-hierarchy saved、write-create/set/delete/clean 全 verified）；`--golden` **`matched:true`**、`diff:null`、两轮各 **6** 节点、cleanup ok | 同 7/7；`--golden matched:true`（S0Project 5 节点 / 盲测 29 节点） | **一致**（跨引擎确定性成立） |
| 3 | `scene tree` / `node` CRUD | ✅ 全部 `verified:true`；float32 反例 `100000.123` → 读回 `100000.125` → **`verified:false` 退出码 1**（U15 同）；**`componentsLut` 复现**：2–3 节点内联 `components`，**34 节点**全部走 `componentsLut`+`componentsIdx`（34/34，0 内联） | 同（U15 同形；U21 记载翻转点在 24↔25 节点 / 46↔50 引用之间） | **一致**（R316 的解析两边都必需） |
| 4 | `sprite set` + `shot` + `pixels` | ✅ `sprite set` `verified:true`（`spriteName:""`）；`pixels --at/--count-color` 口径一致；❌ **`unity shot` 默认在 EditMode 落 `WINDOW_NAME_LOCALIZED`（`Window '游戏' not found`，退出码 1）**；`--window-name Game` / `--match-mode contains` / `--capture-mode GameView` **全都救不回来**；✅ PlayMode 下 `auto`→`rendering`（窗口名被忽略）成功 | `shot` 在中文界面用「游戏」**命中**（U7） | ❌ **不同**：**官方英文界面 + 我们的单向映射 = EditMode 截图无路可走**（`PITFALLS` 官方-2） |
| 5 | `play …` + `exec` | ✅ start/status/logs/stop/exec 全通过（`play start` → exit 0 / `verified:true` / `isPlaying:true`）；**R263 成立**：原生 `Play`/`Stop` 顶层**无 `Success`**、`Pause`/`Status` **有**；`exec --code-file` 在 PlayMode 里读回 `isPlaying=True … rootCount=2`；`play key` → **`INPUT_SYSTEM_UNAVAILABLE`**（退出码 1，报文逐字同） | 同（R263 = U18 实测；U25 同报文） | **一致** → `lib/play.js` 的窄口径例外**在官方版上同样必需**，**不是**「多余的但无害」 |
| 6 | `asset write` + `compile` | ✅ `asset write --template PiBrickBreaker` → `verified:true`（sha256 三方一致、顺带 `compiled:true`）；**`compile` 自动 refresh**：磁盘直写坏文件 → 退出码 1 + `COMPILE_FAILED` + `errors[0]`（`Broken.cs(1,42): error CS1525: Invalid expression term ';'`）**逐字同团结** | 同（R275）；同一条错误文本 | **一致** |
| 7 | `scene save` / `scene open` | ❌ **`--path …SampleScene.scene` → `SAVE_FAILED`**（父目录存在也一样）；✅ **`--path …SampleScene.unity` → `verified:true`**（mtime 前进）；`scene open` 团结 `.scene` → `OPEN_FAILED: Extension should be '.unity'`，改名 `.unity` → `Cannot open scene`（YAML tag `yousandi.cn` 不被接受）；**R356/R357 成立**：`node create` 后 `isDirty=False`、`SaveOpenScenes()` 返回 **True** 但 **mtime 未变/内容没写** | `.scene` 正常；R356/R357 同形 | ❌ **扩展名不同（官方只认 `.unity`）**；R356/R357 **一致** → `scene save` 的 mtime 防御分支**在官方版上仍必需** |
| 8 | `build` | ✅ `win64` → `verified:true` / `Succeeded` / `totalErrors:0`；产物 **`UnityPlayer.dll`**（31.2 MB）+ **`UnityCrashHandler64.exe`** + `<productName>.exe`；磁盘 **71,259,785 B / 129 文件**、**4.82s**；产物**能跑**（`player.log` 21 行 0 error）；❌ `webgl` **和** `android` 都 `BUILD_TARGET_UNAVAILABLE`（`actual.available: ["win64"]`，输出目录不创建）；❌ 未落盘场景 → `BUILD_NO_SCENES` | `win64` ✅ / `android` ✅ / `weixin` ✅，`webgl` ❌；**`TuanjiePlayer.dll`**（44 MB）/ `TuanjieCrashHandler64.exe`；109.4 MB / 13s | ❌ **产物名不同**（但 `lib/build.js` 不硬编码 → 两边都对）；可用目标**取决于装的模块**（都非引擎特性）；`report.summary` 形状**一致** |
| 9 | 回访 `PITFALLS` U11–U26（+U27） | 已在 `docs/PITFALLS.md` 逐条改写「适用引擎」行：**共有 12 条**（U11/U12/U13/U14/U15/U16/U18/U19/U20/U21/U25/U26/U27）、**仅团结 1 条**（U17，且属**单次未复现观测，不足以定论**）、**引擎无关 2 条**（U22 判据设计 / U23、U24 本包命令面） | — | 见下节汇总 |

### 额外确认的四处（本轮重点）

| 问题 | 官方版实测结论 |
|---|---|
| **窗口名**（U7 反向） | 官方版界面标题是**英文** `Game/Scene/Console/Hierarchy/Project/Inspector`；**我们的映射是单向的**（只做 英→中）→ 在「团结+官方共存」机器上（`language()` 只读 `TuanjieHub`）默认 `shot` **必失败**。**若机器上没有 TuanjieHub 目录，`language()` 回 `en_US`、映射恒等、`shot` 正常** → 是**共存**导致，不是官方版本身 |
| **场景扩展名** | 官方版**只认 `.unity`**（`.scene` → `SAVE_FAILED` / `OPEN_FAILED: Extension should be '.unity'`），且团结场景**改名成 `.unity` 也打不开** → **SKILL 现在教的 `.scene` 在官方版上会误导人**（列在改 SKILL 清单里） |
| **构建产物名** | 官方版是 **`UnityPlayer.dll`**（+`UnityCrashHandler64.exe`），团结是 `TuanjiePlayer.dll` —— `lib/build.js` **只读磁盘、不硬编码**，**两边都对，不需要改** |
| **R263 / R356 / R357** | **三条全部在官方版上成立** → 全是 **Unity 家族共有**，我们代码里对应的三条防御分支在官方版上**同样必需**（**不是**「多余的但无害」） |

### 两个官方版之间（f1c1 vs f3c1）

复跑 **5 项**（`doctor` / `--smoke` / `shot` 窗口名 / `scene save --path …scene` / `build` 产物名）：**全部一致**
（f1：doctor 5/5、smoke 7/7、`shot` 同落 `WINDOW_NAME_LOCALIZED`、`.scene` 同样 `SAVE_FAILED`、`.unity` 保存后构建出
`UnityPlayer.dll`、71,247,830 B / 4.78s）。→ 本轮发现的差异**不是某个中国构建的个体问题**。

## 判据与产出

- **凡在官方版上复现的团结行为** → 在 `docs/PITFALLS.md` 相应条目补一句「**两引擎共有**」（说明它不是团结特性）。
- **凡官方版行为不同** → 必须写进 PITFALLS（**只追加、不编号**）+ **检查 SKILL 是否硬编码了团结行为**（例如窗口名映射、`.scene`、`TuanjiePlayer.dll`），该改就改。
- **凡在官方版上复现的团结行为** → 在 `docs/PITFALLS.md` 相应条目补一句「**两引擎共有**」（说明它不是团结特性）。
- **凡官方版行为不同** → 必须写进 PITFALLS（**只追加、不编号**）+ **检查 SKILL 是否硬编码了团结行为**（例如窗口名映射、`.scene`、`TuanjiePlayer.dll`），该改就改。
- **产出**：`docs/CAPABILITIES-unity-2022.3.62f3c1.md`（照 `CAPABILITIES-tuanjie-2022.3.62t9.md` 的形态）✅ 已产出 + PITFALLS 新条目 ✅ 已追加 + **Q2 的结论** ✅ 见文末。
  （原计划的文件名是 `CAPABILITIES-unity-2022.3.62f1.md`；实际主用版本是 **`f3c1`**，故文件名改为 `CAPABILITIES-unity-2022.3.62f3c1.md`，`f1`（`f1c1`）作为复跑对照写在同一文件里。）
- 纪律照旧：**不碰用户真实工程**；团结是**单座席**（同一时刻只能一个编辑器实例 → 跑官方版时先确认团结已退出）；零第三方依赖；`.cs` 一旦改动必须真机跑一次（R367 的教训）。

---

## 实测记录：环境准备（2026-09-19，团结 2022.3.62t9 之外的第一台 Unity 官方版）

### 已安装（两个都是 **Unity 官方中国版** 构建，不是国际版）

| 版本 | 安装路径 | ProductVersion |
|---|---|---|
| `2022.3.62f3c1` | `C:\Program Files\Unity\Hub\Editor\2022.3.62f3c1\Editor\Unity.exe` | `2022.3.62f3c1_1623fc0bbb97` |
| `2022.3.62f1` | `C:\Program Files\Unity\Hub\Editor\2022.3.62f1\Editor\Unity.exe` | ⚠️ **`2022.3.62f1c1_b0109b07edb8`**（中国构建，**不是国际版 f1**） |

### 两条必须记住的实测事实

1. **本网络拿不到 Unity 国际版**：`download.unity3d.com`（含 `beta.`/`netstorage.`、IPv6）**全部 302 重定向到 `download.unitychina.cn`** → 同一 URL 实际发的是**中国构建**（官方 API 声明该 URL 应为 3,696,795,648 B，中国 CDN 实发 3,754,412,664 B；两个安装包同为中国证书 `CN=优三缔科技（上海）有限公司` 签发）。
   → **后果**：文档原来想要的「与团结同补丁号的国际版苹果对苹果比较」**在本机做不了**；能做的是「团结 vs **Unity 中国版**」，它仍然回答 Q2 的核心（是否绑死团结），但**证据强度较低**；真国际版需海外出口代下。
2. **Unity 编辑器安装器是 NSIS，不是 Inno Setup**：`file` 报 `Nullsoft`。→ 静默安装必须用 **`/S /D=<路径>`**（`/D=` 必须最后且**不带引号**），**不支持 `/LOG=`**；用 Inno 的 `/VERYSILENT /SUPPRESSMSGBOXES` 会被**静默忽略并弹交互 GUI 挂死**（控制者踩过两次）。
   实操上用 `.bat` + `start /wait` 传参数最稳（规避 MSYS 引号重写）。

### 许可证（**阻塞点**）

- 本机**无任何 `.ulf`**（`C:\ProgramData\Unity\` 不存在；Unity 日志：`No ULF license found., Token not found in cache`）。
- 手工激活文件已生成：`.superpowers/sdd/2026-09-19-pi-unity-m3-exec/tmp/unity-dl/Unity_v2022.3.62f3c1.alf`
- **用户步骤**：把该 `.alf` 上传到 **`license.unity.cn/manual`**（注意是 **`.cn`**，因为装的是中国版）→ 选 Personal → 下载 `.ulf` → 放到 `C:\ProgramData\Unity\Unity_lic.ulf`（目录需新建）。
- 之后即可用 `Unity.exe -batchmode -manualLicenseFile <ulf> -quit` 或直接让编辑器读该路径。

### 下一步（许可证到位后）

按本文件「逐项探测清单」跑 **9 项**，并额外记录一条 **三引擎对照**：团结 2022.3.62t9 ↔ Unity 中国版 2022.3.62f3c1 ↔ Unity 中国版 2022.3.62f1（`f1c1`）。**凡是团结与中国版不同的** → 标「团结特有」；**两个中国版之间不同的** → 标「Unity 中国版特有」；**三者相同的** → 标「Unity 家族共有」。

---

# ✅ Q2 结论（2026-09-20 实测收口）

## 结论：**Q2 成立（有条件成立 —— 条件已逐条列出，不是绑死团结）**

**一句话理由**：在**新建的官方版项目**里，`doctor` 5/5、`--smoke` 7/7、`--golden matched:true`、
**21 个工具全部可用**、写后读回语义一致、构建能出包并**跑起来**，**产物名/场景名/路径全部来自运行时或磁盘、无一处硬编码团结约定** ——
即「不依赖团结私有 API」成立；**但命令面的 Windows 侧行为有 3 处硬差异**（场景扩展名、窗口名映射、doctor 的目标/语言取值），
其中 **2 处会让 SKILL 现文案在官方版上直接误导**（`.scene` 写法、EditMode 截图）。

### 成立的那部分（可作数的证据）

| 面 | 证据 |
|---|---|
| 连接与安装 | 官方版 `Unity.exe` 被 `unity:hub-default` 发现；`editor-connection` 绿；vendor 走 `file:` 一次成功 |
| 依赖 | Newtonsoft 3.2.1 / Mono.Cecil 1.11.6 / ugui builtin —— 与团结**逐字相同** |
| 工具面 | `.uloop/tools.json` **21 个工具同名同序**；smoke 7/7（含 4 项写闭环） |
| 确定性 | `--golden matched:true / diff:null` |
| 信封语义 | 两种失败形状、`compile` 结构化错误、`execute-dynamic-code` 的 `Result` —— 逐字段同形 |
| 写后读回 | `node` CRUD / `sprite set` / `asset write`（sha256）/ `scene save`（mtime）全 `verified:true` |
| Runtime 侧 | `play start/stop/status/logs` + `exec` + `pixels` + `shot(rendering)` 全通 |
| 出包 | `win64` → `UnityPlayer.dll` 产物**能跑**（21 行 player.log 0 error）；`report.summary` 形状一致 |
| 防御分支 | **R263 / R356 / R357 三条在官方版上全部成立** → 我们的三条防御都是必要的（不是团结专属、也不是多余的） |

### 那 3 处硬差异（**已全部记入 `PITFALLS.md` 追加区，均未改代码**）

1. **官方版只认 `.unity`**（`.scene` → `SAVE_FAILED`/`OPEN_FAILED`；且团结的 `.scene` 改名 `.unity` 也打不开）
   → **SKILL 现在教的 `.scene` 在官方版上必然失败**（需改 SKILL，见下方清单）；
2. **`unity shot` 的窗口名映射是单向的** + `language()` 只读 `TuanjieHub` → 「团结 + 官方共存」的机器上
   EditMode **没有任何**截图出路（只能进 PlayMode 走 `rendering`）；
3. **`doctor` 的 `build-targets` / `editor-language` 取自 `editors[0]`（团结）**，与「当前连接的是哪台编辑器」无关
   → 官方版项目上 `doctor` 会谎报 `android` 可用（实测 `unity build --target android` 落 `BUILD_TARGET_UNAVAILABLE`）。

> 这 3 处都**不是引擎语义差异**，而是**我们这一侧的实现/文案在「多引擎共存」下不成立** —— 修复面在 `lib/` 与 `skills/`，不在引擎适配层。
> （本轮是**验证**任务：**只记录、不修**。）

### 需要 SKILL 改的地方（**清单，交控制者 / 后续任务；本轮未动 SKILL**）

| # | 位置 | 现文案 | 问题（官方版实测） | 建议 |
|---|---|---|---|---|
| S1 | `skills/unity-game-dev/SKILL.md` §3.5 末步、§5、§8⓪、§9.2 | `unity scene save --path Assets/Scenes/SampleScene.scene` | 官方版**必失败**（`SAVE_FAILED`） | 改成「先看项目里已有的场景资产扩展名」；两种写法都给（`.unity` / `.scene`），并写明**官方版只认 `.unity`** |
| S2 | 同上 §5「进 PlayMode 前的场景准备」 | 同上（`.scene`） | 同 S1 | 同 S1 |
| S3 | §4 截图注意 ① | 「窗口名按界面语言…`unity shot` 会按 `editor-language` 自动映射英文名」 | 官方英文界面上映射**反向用错**（`Game`→`游戏`），且 `language()` 不来自被连的编辑器 | 补一句：**与团结共存的机器上，官方版 EditMode 截图会落 `WINDOW_NAME_LOCALIZED`；直接用 PlayMode `rendering`（现「出路②」已正确）** |
| S4 | §1 前置检查表 / `doctor` 判据 | 「5 项全 OK」 | 在多引擎机上 `editor-language` / `build-targets` **取值不可信**（项仍 pass） | 加一条警告：`build-targets` 可能取的是**另一台编辑器**；构建目标的真值看 `unity build` 的 `actual.available` |
| S5 | §9.1 目标不是全的 | 「查已装模块：`unity doctor` 的 build-targets 项」 | 同 S4（官方版实测 `android` 误报可用） | 改为「以 `unity build` 失败时的 `actual.available` 为准」 |
| S6 | §9.2 产物名 / §9.3 体积·耗时表 | 只写团结的 `TuanjiePlayer.dll` / 109.4 MB / 13s | 官方版是 `UnityPlayer.dll` / **67.9 MB** / **4.8s**（且 `lib/build.js` **无需改**） | 表里按引擎分列，或注明「产物名随引擎不同，读 `actual.mainArtifact`」 |
| S7 | §8⑤ 坐标公式 | `pixelsPerUnit = 图片高度 / (2 × orthographicSize)` | 官方版 `-createProject` 的默认场景是 **透视相机**（`orthographic=False`），公式不适用（实测 110224 px vs 公式 147456 px） | 加限定词：「**仅正交相机**；新建 3D 项目默认是透视，先用 `exec` 读 `Camera.main.orthographic`」 |
| S8 | §3.5 ① `unity play view` 前的隐式前提 | 「④ 截图 然后真的看图」 | 官方版新建项目的 **Game 视图默认未打开** → PlayMode 的 rendering 截图也会失败（`Play Mode view RenderTexture is not available`） | 加一步：「首次截图前确保 Game 视图已打开」 |
| S9 | §7 常见错误表 / §1 表格 | 未提「管理员对话框」 | 官方版 GUI 启动会**阻塞在一个模态框**上（不点则编辑器不启动、`-logFile` 都不创建） | 加一行：启动后若 `editor-connection` 不绿且进程只有 ~117 MB，先看是不是这个框 |
| S10 | §7 表「硬编码 `.unity` / `UnityPlayer.dll` 在团结上挂」（U10 行） | 只从**团结**视角写 | 反向也成立：**硬编码 `.scene`（= SKILL 现状）在官方版上挂** | 把 U10 行改成**双向**表述 |

### 剩余不确定性（**不要把上面的结论读成「与 Unity 国际版一致」**）

1. **真国际版仍未验证（最大的一条）**：本网络把所有 `download.unity3d.com` 请求 302 到 `download.unitychina.cn`，
   本机两个版本都是**中国构建**（`2022.3.62f3c1` / `2022.3.62f1c1`）。所以「Unity 官方版兼容」的证据强度是
   **「团结 vs Unity 中国版」**，不是「团结 vs Unity 国际版」。**要升级证据强度需海外出口代下国际版**。
2. **两个官方版之间只复跑了 5 项**（doctor / smoke / shot 窗口名 / `.scene` 落盘 / build 产物名），其余 4 项未在 `f1c1` 上重跑；
3. **团结的 `.scene` ↔ 官方 `.unity` 只能单向定论**：官方**读不了**团结场景（扩展名 + YAML tag 双拦）；反向未测；
4. `android` / `weixin` / `webgl` 出包、Input System 系工具、pause-point/watch/hot-reload 等**仍未验证**（与团结侧同样的空白）；
5. 官方版 GUI 的**管理员对话框**是否团结也有 —— 本轮未开团结，**未复测**。

### 一句话给主会话

> **Q2 成立但不完整**：命令面与信封层在官方版上**全部跑通**（21 工具 / smoke 7/7 / golden / build 出 `UnityPlayer.dll` 且能跑），
> R263·R356·R357 三条防御**在官方版上同样必需**；
> **但 `.scene` 扩展名、`shot` 窗口名单向映射、`doctor` 的 build-targets 三项在官方版上会坑人**，需按上面 S1–S10 改 SKILL（代码修改属后续任务）。
