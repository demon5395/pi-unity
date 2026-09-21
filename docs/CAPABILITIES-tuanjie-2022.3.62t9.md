# CAPABILITIES — 团结引擎 2022.3.62t9 / uloop 3.6.3

> **实测记录，非文档转述。** 数据来源：S0–S7 实机验证（2026-09-18）+ 编辑器生成的 `.uloop/tools.json`。
> 上游 README 与实测有差异处已显式标注 —— **以本文为准**。

---

## 0. 验证总览

| 步 | 内容 | 结果 |
|---|---|---|
| **S0** | codeload vendor 安装 + 编译 | ✅ 44 asmdef → 44 DLL，0 error / 0 warning |
| **S1** | CLI 连接运行中的编辑器 | ✅ **第一次尝试（15s）成功** |
| **S2** | `execute-dynamic-code` | ✅ 返回 `Application.dataPath` |
| **S3** | `compile` / `get-logs` | ✅ 结构化（ErrorCount/WarningCount） |
| **S4** | `screenshot` | ✅ 通过（**需本地化窗口名**，见 U7） |
| **S5** | 写后读回语义（**最关键**） | ✅ 见 §3 —— 结论是**分层的** |
| **S6** | PlayMode + 输入模拟 | ✅ UI 点击闭环打通（见 U8） |
| **S7** | 确定性 | ✅ 两次读回 IDENTICAL |
| **S8** | **构建出包**（batchmode + `-executeMethod`） | ✅ **构建成功 + 产物可运行**（109.4 MB / 14.7s） |

环境：团结引擎 **2022.3.62t9**（Tuanjie Editor 1.9.1）+ uloop 包 **3.6.3** + dispatcher **3.5.1** + project-runner **3.4.0**

**R1 完全解决**：包装、编译、CLI 连接**全部通过**。本机没有 Unity 官方版不是阻塞项。

---

## 1. 安装（S0）

| 路径 | 结果 |
|---|---|
| `package.openupm.com`（官方 `uloop package install`） | ❌ 三轮全部 21s 超时 |
| UPM git URL | ⚠️ 需 `github.com`，间歇 |
| **codeload tarball** ✅ | 7.8 MB / 2.35s / 3.4 MB/s |
| **GitHub Releases（dispatcher zip）** ✅ | 7.0 MB / 1.98s / 3.7 MB/s |

> ⚠️ **修正**：`github.com` 的 **HTML 页面**间歇不可达，但 **Releases 下载畅通**（1.98s）。
> 不要因为 `curl https://github.com` 超时就断定 Releases 也不可用。

有效做法：

```bash
curl -sL -o uloop-main.tgz \
  "https://codeload.github.com/hatayama/unity-cli-loop/tar.gz/refs/heads/main"
tar xzf uloop-main.tgz "unity-cli-loop-main/Packages/src"
mv unity-cli-loop-main/Packages/src vendor/uloopmcp
# Packages/manifest.json:
#   "io.github.hatayama.uloopmcp": "file:C:/.../vendor/uloopmcp"

# CLI:
curl -sL -o uloop-disp.zip \
  "https://github.com/hatayama/unity-cli-loop/releases/download/dispatcher-v3.5.1/uloop-dispatcher-windows-amd64.zip"
unzip -o uloop-disp.zip -d uloop-bin     # → uloop.exe (19.8 MB)
```

**sha256 三方一致**（官方 `.sha256` = 实际 = `project-runner-pin.json` 内清单）：
`9d981d103c593a967ebfcd8f705d8ff30ef1e5bd20e416f96e0d32d0ff28f8c3`

**依赖解析**：uloop 需 `com.unity.nuget.newtonsoft-json@3.2.1` + `com.unity.nuget.mono-cecil@1.11.6`，均正常解析。
Registry 可达：`packages.unity.cn` **0.32s** / `packages.unity.com` 2.50s / `download.packages.unity.com` 1.67s。

## 2. CLI 层（native commands，实测）

```
launch  list  sync  focus-window  await-pause-point  pause-point-status
set-code-optimization  skills  package  install  update  uninstall  version
```

**关键语义（实测，脚本化必读）**：

| 项 | 实测 |
|---|---|
| 退出码 | 成功 **0** / 失败 **1**（有意义，可用于判断） |
| JSON 输出流 | **成功 → stdout；失败 → stderr** ⚠️ **（已更正）** —— S0 只测了失败路径，当时误记为「一律 stderr」；后重测确认两者分流 |
| 管道名 | `\\.\pipe\uloop-UnityCliLoop-<16位项目路径哈希>` —— **per-project，多项目可共存** |
| project-runner | 首次调用时**自动下载**（"downloading pinned project runner 3.4.0..."），成功 |
| 编辑器未运行时 | `ErrorCode: UNITY_NOT_REACHABLE`，`Phase: connection`，`Retryable: true`，附 `NextActions` |

## 3. 工具面实测 —— **21 个**（权威，来源 `.uloop/tools.json`）

| # | 工具 | 参数 | Action 枚举 |
|---|---|---|---|
| 1 | `simulate-mouse-ui` | 11 | Click, Drag, DragStart, DragMove, DragEnd, LongPress |
| 2 | `enable-pause-point` | 12 | — |
| 3 | `clear-pause-point` | 2 | — |
| 4 | `record-video` | 8 | start, stop, status |
| 5 | `compile` | 4 | — |
| 6 | `get-hierarchy` | 7 | — |
| 7 | `find-game-objects` | 8 | — |
| 8 | `clear-console` | 1 | — |
| 9 | `get-logs` | 6 | — |
| 10 | `execute-dynamic-code` | 5 | — |
| 11 | `control-play-mode` | 2 | Play, Stop, Pause, Step, Status, Resume |
| 12 | `simulate-mouse-input` | 12 | Click, LongPress, MoveDelta, Scroll, SmoothDelta |
| 13 | `run-tests` | 6 | — |
| 14 | `set-game-view-size` | 2 | — |
| 15 | `get-watch-values` | 1 | — |
| 16 | `clear-watch` | 2 | — |
| 17 | `enable-watch` | 3 | — |
| 18 | `simulate-keyboard` | 3 | Press, KeyDown, KeyUp, ReleaseAll |
| 19 | `hot-reload` | 4 | — |
| 20 | `replay-input` | 4 | start, stop, status |
| 21 | `screenshot` | 9 | — |

**与 README 的差异（已在 PITFALLS U5 记录）**：`pause-point` 拆成两个；新增 **watch 子系统**（`enable-watch`/`get-watch-values`/`clear-watch`）；`focus-window` 属 CLI 层而非工具。

> **watch + pause-point = 「暂停在任意行 → 读变量 → 继续」**，pi-cocos 完全没有的调试维度。

---

## 4. 信封结构（实测）—— **uloop 自带结构化输出**

### 4.1 通用失败信封

```json
{ "Success": false,
  "Error": { "ErrorCode": "UNITY_NOT_REACHABLE", "Phase": "connection",
             "Message": "...", "Retryable": true, "SafeToRetry": true,
             "ProjectRoot": "...", "Command": "list",
             "NextActions": ["If Unity is closed, run `uloop launch`.", ...],
             "Details": { "Cause": "open \\\\.\\pipe\\...", "Endpoint": "..." } } }
```

**这已经是一个信封了**：`Success`（≈我们的 `ok`）、结构化 `ErrorCode`、`Phase`、`Retryable`、`NextActions`（≈pi-cocos 的 `hint`）。

### 4.2 `execute-dynamic-code`

```json
{ "Result": "...", "Logs": [...], "CompilationErrors": [...],
  "ErrorMessage": "", "Error": "", "UpdatedCode": null,
  "DiagnosticsSummary": null, "Diagnostics": [],
  "EditorPlaying": false, "Success": true }
```

### 4.3 `compile` 的错误结构（比 pi-cocos 的 `console.read` 强）

```json
{ "Message": "CS1040: Preprocessor directives must appear as the first non-whitespace character on a line",
  "Line": 1, "Column": 20, "ErrorCode": "CS1040", "Hint": "",
  "Suggestions": [], "Context": "L1:this is not valid C#;\r\n                      ^\r\n" }
```

带**行/列/错误码/插入符上下文**。

### 4.4 `screenshot` 的坐标公式（解决了 pi-cocos 的 F6 问题）

```json
{ "ImagePath": "...", "ImageCoordinateSystem": "top-left-game-view",
  "ResolutionScale": 1.0, "ImageToInputOffsetY": 0,
  "GameViewWidth": 534.0, "GameViewHeight": 334.0,
  "ScreenshotToInputFormula": "simulate_mouse_x = image_x / resolutionScale; simulate_mouse_y = image_y / resolutionScale + imageToInputOffsetY",
  "UnityInputFormula": "unity_x = input_x; unity_y = gameViewHeight - input_y",
  "AnnotatedElements": [ ... ], "RaycastLayerSummaries": [] }
```

`--annotate-elements` 回传的元素：

```json
{ "Name": "S6Button", "Path": "S6Canvas/S6Button", "Type": "Button",
  "Interaction": "Click", "SimX": 267.0, "SimY": 167.0,
  "BoundsMinX": 147.0, "BoundsMinY": 107.0, "BoundsMaxX": 387.0, "BoundsMaxY": 227.0,
  "Label": "A", "SortingOrder": 0, "SiblingIndex": 0 }
```

**`SimX`/`SimY` 是可直接喂给 `simulate-mouse-ui --x/--y` 的坐标** —— 坐标换算问题被完全消除。
`--target-path` 可配合 `--bypass-raycast` 绕过遮挡层。

### 4.5 `execute-dynamic-code` 的三种传参方式（D3 接口基础，实测）

| 方式 | 结论 |
|---|---|
| `--code '<inline>'` | ✅ 可用（S5/S6 全程使用） |
| **`--code-file <path>`** | ✅ **可用** —— 多行 C# 从文件读，**不经过 shell 引号** |
| `--parameters '<json>'` | ⚠️ **语义与直觉不同**，见下 |

#### `--parameters` 的真实语义（实测，重要）

```bash
--parameters '{"name":"Foo","count":3}'
# C# 中 parameters 实际内容：
#   param0 = 3      ← 值按 key 排序后位置化
#   param1 = Foo
#   （"name" / "count" 这两个 key **完全丢失**）
```

| 约束 | 实测结果 |
|---|---|
| 必须是 JSON **对象** | 传数组 → `INVALID_ARGUMENT` / `Phase: argument_parsing`（**客户端校验**，未到 Unity） |
| key | **被丢弃**；值以 `parameters["param0"]`、`param1`… **按 key 排序**位置暴露 |
| JSON 字符串作为**值** | ✅ **可行且关键**（见下） |

#### ✅ 推荐用法：单参数载荷（已实测通）

```bash
--parameters '{"payload":"{\"name\":\"Foo\",\"x\":5,\"nested\":{\"a\":[1,2]}}"}'
```

C# 侧：

```csharp
var raw = parameters["param0"] as string;   // → 完整 JSON 字符串
// 用 Newtonsoft（uloop 已依赖 com.unity.nuget.newtonsoft-json）反序列化
```

**实测结果**：载荷**完整到达**，嵌套对象与数组均保留，可解析回对象。
→ **这是本项目 C# 片段的传参方案**（D3）：载荷序列化成一个 JSON 字符串，作唯一参数。

#### ⚠️ `__uloop_literal_*` 副作用

uloop 会**自动把 C# 代码里的字符串字面量驻留进 `parameters`**：

```
parameters 里出现：__uloop_literal_0 … __uloop_literal_N（值为代码中的各字符串字面量）
```

**影响**：遍历 `parameters` 会看到这些额外条目（实测 `count=7`，其中 5 个是 literal）。
**处理**：**不要遍历 `parameters`**；直接按下标取 `param0`。也不要依赖 literal 的编号顺序。

---

### 4.6 工具字段/参数实证（上游源码出处）

`doctor --smoke` 的 per-tool 读回依赖下列**上游响应字段名 / CLI 参数名**。
仓内（团结 2022.3.62t9 实测）此前只落过 `compile` 的两个字段，其余来自上游 `uloopmcp` 包源码
（下面路径均为该包内相对路径；本机 vendor 于 `C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp`，
**不在本仓库内**；行号已逐条核对）：

| 工具 | 参数 / 字段 | 上游文件与行号 | 仓内他处已引用？ |
|---|---|---|---|
| `compile` | 响应字段 `ErrorCount` / `WarningCount` | 实测（本文件 §0 的 S3 行；规格 `docs/superpowers/specs/2026-09-18-pi-unity-design.md:407`） | ✅ 本文件 §0（S3 行） |
| `get-logs` | CLI 参数 `--max-count` | `Editor/FirstPartyTools/GetLogs/Skill/SKILL.md:22` | ❌ 仅规格与实现引用 |
| `get-logs` | 响应字段 `TotalCount` | `Editor/FirstPartyTools/GetLogs/Skill/SKILL.md:32` | ❌ 仅规格与实现引用 |
| `get-hierarchy` | 响应字段 `HierarchyFilePath` | `Editor/FirstPartyTools/GetHierarchy/GetHierarchyResponse.cs:26` | ❌ 仅规格与实现引用 |

> ✅ **真机对账已完成（M1 验收，2026-09-19）**：真实 dispatcher **3.5.1** + 团结 2022.3.62t9，
> `unity doctor --smoke` 三项全 `OK` —— `compile` 的 `ErrorCount`/`WarningCount`（`errors=0 warnings=0`）、
> `get-logs` 的 `TotalCount` + `--max-count`（`total=0`）、`get-hierarchy` 的 `HierarchyFilePath`
> （`saved: .uloop\outputs\HierarchyResults\...json`）逐字段核实通过。
> **M2 补充（2026-09-19）**：`--smoke` 从 3 项扩到 **7 项**（3 只读 + 4 写闭环），七项全 `pass`；
> 新增字段/参数的实证见 §4.7。
> 若某个名字与上游不符，后果是 **falsely-fail**（健康机器上冒烟立刻变红、当场暴露），
> **不是静默假绿** —— 这正是本包「字段缺失即 fail、绝不打印 `?`」纪律的收益，方向安全
> （见 `PITFALLS.md` U11）。
>
> 另：**`uloop list`（dispatcher 级命令）的响应没有 `Success` 字段**，拿 first-party 工具的
> `Success === true` 判据做探活会假红 —— 已修（R115），见 `PITFALLS.md` U14。

### 4.7 M2 用到的字段/参数实证（上游源码出处）

M2 在既有 21 工具面上用到下列**上游工具参数名 / 响应字段名**。本表只列**需要查上游出处**的项 ——
`pixels`（本地 PNG 解码）、`node delete`（走 `execute-dynamic-code`）、`doctor`（复用 M1 已列字段）、
`sprite set`（本包自带 `unity-scripts/sprite-set.cs`）**没有新增上游字段，故不单独列行**。
每一个名字都在 vendor 包里有出处（本机 vendor 于 `C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp`，
**不在本仓库内**；下列行号为收口时**逐条重核**过的实际行号；`Editor/FirstPartyTools/` 与
`Editor/ToolContracts/` 是 vendor 根下的两个不同目录，下列路径已统一补全到 vendor 根相对路径）：

| 工具 | 参数 / 字段 | 上游文件与行号 |
|---|---|---|
| `control-play-mode` | 参数 `--action` / `--timeout-seconds` | `Editor/FirstPartyTools/ControlPlayMode/Skill/SKILL.md:21-22` |
| `control-play-mode` | 响应 `IsPlaying` / `IsPaused` / `Changed` / `WasAlreadyStopped` / `ResumedFromPause` / `BlockedByCompileErrors` / `BlockedByUnsavedChanges` / `CompileErrorCount` / `Message` / `Warning` / `StoppedBy` / `StoppedAt` | `Editor/FirstPartyTools/ControlPlayMode/ControlPlayModeResponse.cs:12-22,33,39` |
| `simulate-mouse-ui` | 参数 `--action` / `--x` / `--y` / `--from-x` / `--from-y` / `--drag-speed` / `--duration` / `--button` / `--bypass-raycast` / `--target-path` / `--drop-target-path` | `Editor/FirstPartyTools/SimulateMouseUi/Skill/SKILL.md:31-41` |
| `simulate-mouse-ui` | 响应 `HitGameObjectName` / `PositionX` / `PositionY` / `InterruptedByPausePoint` / `PausePointHitCount` | `Editor/FirstPartyTools/SimulateMouseUi/SimulateMouseUiResponse.cs:14-21,40` |
| `simulate-mouse-input` | 参数 `--action` / `--x` / `--y` / `--button` / `--duration` / `--delta-x` / `--delta-y` / `--scroll-x` / `--scroll-y` / `--dry-run` / `--layer-mask` / `--max-distance` | `Editor/FirstPartyTools/SimulateMouseInput/Skill/SKILL.md:37-47` |
| `simulate-mouse-input` | 响应 `Hit` / `CameraName` / `CameraPath` / `HitGameObjectName` / `PressDeliveredToGame` / `InputCoordinateSystem` / `InputPositionX/Y` / `InjectedUnityPositionX/Y` | `Editor/FirstPartyTools/SimulateMouseInput/SimulateMouseInputResponse.cs:14-42,50` |
| `simulate-keyboard` | 参数 `--action` / `--key` / `--duration` | `Editor/FirstPartyTools/SimulateKeyboard/Skill/SKILL.md:22-32` |
| `simulate-keyboard` | 响应 `KeyName` / `PressDeliveredToGame` / `PressEdgeObserved` / `ReleasedKeys` / `ReleasedKeyStates`；**缺包报文逐字** | `Editor/FirstPartyTools/SimulateKeyboard/SimulateKeyboardResponse.cs:15-22,49,59,115,120`；`Editor/FirstPartyTools/Common/InputSystem/InputSystemPackageRequirementMessage.cs:11-18` |
| `get-logs` | 参数 `--log-type` / `--max-count` / `--search-text` / `--include-stack-trace` | `Editor/FirstPartyTools/GetLogs/Skill/SKILL.md:21-24` |
| `get-logs` | 响应 `TotalCount` / `DisplayedCount` / `Logs[]`，每条 `Type` / `Message` / `StackTrace` | `Editor/FirstPartyTools/GetLogs/GetLogsResponse.cs:33,38,63` + `LogEntry:10-20` |
| `set-game-view-size` | 参数 `--width` / `--height` | `Editor/FirstPartyTools/SetGameViewSize/Skill/SKILL.md:21-22` |
| `set-game-view-size` | 响应 `PreviousWidth` / `PreviousHeight` / `CurrentWidth` / `CurrentHeight` / `Changed` | `Editor/FirstPartyTools/SetGameViewSize/SetGameViewSizeResponse.cs:10-12` + `Editor/FirstPartyTools/SetGameViewSize/Skill/SKILL.md:29-32` |
| `compile` | 参数 `--timeout-seconds` / `--force-recompile` / `--no-wait-for-domain-reload` | `Editor/FirstPartyTools/Compile/Skill/SKILL.md:14,21-24` |
| `compile` | 响应 `ErrorCount`(可 null) / `WarningCount`(可 null) / `Errors[]` / `Warnings[]` / `ErrorCode` / `NextActions`；`Success` 在**基类** `UnityCliLoopToolResponse` | `Editor/FirstPartyTools/Compile/CompileResponse.cs:35,42,49,56,63,68`（`Success` 与 `ErrorCode` 的 null 语义见任务 8 的 R209） |
| `screenshot` | 参数 `--capture-mode` / `--match-mode` / `--window-name` / `--annotate-elements` / `--elements-only` | `Editor/FirstPartyTools/Screenshot/Skill/SKILL.md:22-23,27,29` |
| `screenshot` | 响应顶层 `Screenshots` / `TimedOut` / `ResolvedCaptureMode` / `ScreenshotCount`，每图 `ImagePath` / `GameViewWidth` / `GameViewHeight` / `ScreenshotToInputFormula` / `AnnotatedElements` | `Editor/ToolContracts/ScreenshotResponse.cs:12,23,24,25,27,37,38,41,44` |

> **方法论（M1 的 U11 教训）**：本包的**每一个**上游参数名/字段名都必须在 vendor 里有出处；
> 靠猜的名字会在健康机器上造成**假红**（falsely-fail），而不是静默假绿。
> 反例：`--region` 的区域均色字段是 `actual.region.color`（形状 `{r,g,b,a}`），**不是** `meanColor` ——
> 后者是收口前文档里出现过的臆造名（已在 commit `0ac9623` 中从 `docs/E2E-ACCEPTANCE-m2.md` / `docs/PITFALLS.md` / `skills/unity-game-dev/SKILL.md` 清掉）。

---

## 5. S5：写后读回语义（**最关键的一测**）

**结论是分层的 —— 这精确界定了信封层该做什么：**

| 场景 | 实测结果 | 谁负责 |
|---|---|---|
| **抛异常** | ✅ `Success: false` + `ErrorMessage` + **完整堆栈** | uloop 已处理 |
| **编译错误** | ✅ `CompilationErrors[]` 含行/列/错误码/插入符 | uloop 已处理 |
| **语义偏离**（意图达成与否） | ❌ **`Success: true`，工具不检测** | **← 我们的信封层** |

**语义偏离的实证**：

```csharp
cam.fieldOfView = -100f;   // Unity 钳制为 1e-05
return "intent=-100 actual=" + cam.fieldOfView;
// → Result: "intent=-100 actual=1E-05",  Success: true
```

`Success: true` 的含义是「**你的代码执行了**」，**不是**「**你的意图达成了**」。

> **这是 Cocos P12/P20 的 Unity 类比，但有一个关键区别**：
> Cocos 2.4.15 写通道**根本不回调**，无法判断；uloop **能**让你检查，但**不会替**你检查。
> → **信封层的核心价值 = 写后主动读回比对 intent vs actual**，不是重建错误处理。

**写后读回闭环已验证**：`execute-dynamic-code` 建 `S5Probe` → `get-hierarchy` 读回 `nodeCount: 2` 且 `S5Probe` 在列 ✅

**`get-hierarchy` 的字段边界（重要）**：只有 `name` / `isActive` / `components` / `siblingIndex` / `tag` / `layer` / `children`。
**不含任何 Transform 数值或属性值** → 验证属性必须再用 `execute-dynamic-code` 或 `find-game-objects`。

输出落盘（省 token）：`.uloop/outputs/HierarchyResults/hierarchy_<ts>.json`，响应只回路径。

## 6. S6：PlayMode + 输入模拟（pi-cocos §7 等价能力）

**完整闭环已验证通过**：

```
建 UI（Canvas + Button + EventSystem）
  → control-play-mode --action Play        → IsPlaying: true
  → screenshot --annotate-elements --elements-only
                                            → AnnotatedElements[0].SimX/SimY = 267/167
  → simulate-mouse-ui --action Click --x 267 --y 167
                                            → HitGameObjectName: "S6Button", Success: true
  → get-logs --search-text S6_CLICK         → "S6_CLICK_OK_RUNTIME" ✅
```

**`control-play-mode` 的信封很完善**：`IsPlaying` / `IsPaused` / `Changed` / `WasAlreadyStopped` / `ResumedFromPause` / `BlockedByCompileErrors` / `BlockedByUnsavedChanges` / `CompileErrorCount`，且带一条关于会话语义的有用 `Warning`。

**PlayMode 下 `screenshot` 自动切 `rendering` 模式**（`--capture-mode auto` → rendering），此时**忽略 `--window-name`** —— 这绕开了 U7 的本地化问题。

## 7. S7：确定性

两次连续 `get-hierarchy` 读回，剥掉 `ExportTimestamp` 后 **完全一致（IDENTICAL）**。
→ golden 测试在本场景下可行。**M2 已完成更大样本验证**：`doctor --golden` 在盲测项目（29 节点 / 24 砖 /
`componentsLut` 形状）上两轮结构投影 `matched:true`、`diff:null`；**S0Project**（小场景）同样 `matched:true`，两轮各 **5** 节点一致。
> ⚠️ 两个数字分属**不同项目/场景**，不要混用：**29 节点 / 24 砖**来自**盲测项目**（`C:/Users/<用户>/pi-unity-m2-blind`）；
> **5 节点**来自任务 13 真机所用的 **S0Project**（实测输出见 `.superpowers/sdd/2026-09-19-pi-unity-m2-implementation/task-13-report.md` §6）。
`get-hierarchy` 的**两种响应形状**（小场景内联 `components`、大场景 `componentsLut`+`componentsIdx`）见 `docs/PITFALLS.md` **U21**。

---

## 8. 仍未验证

| 项 | 状态 |
|---|---|
| `simulate-keyboard` / `simulate-mouse-input`（走 Input System） | `[未验证]` —— 需项目安装 `com.unity.inputsystem`；本测试项目未装（缺包报文与边界见 `docs/PITFALLS.md` **U25**）。**可用面已实测**：无包时 `unity play key/mouse` 如实落 `INPUT_SYSTEM_UNAVAILABLE`（退出码 1） |
| `replay-input` | `[未验证]` —— 需 Input System + 手工录制（上游明确无 CLI 录制） |
| `pause-point` / watch 子系统的实际行为 | `[未验证]` |
| `hot-reload` / `record-video` / `run-tests` | `[未验证]` |
| `find-game-objects` 的输出面 | `[未验证]` |
| 复杂场景下的 golden 确定性 | ✅ **M2 已验证**（2026-09-19）—— `doctor --golden` 在 29 节点 / 24 砖的盲测项目与 S0Project 上均 `matched:true`（见 §7） |
| `uloop compile --force-recompile` / indeterminate 形状 | `[未验证]` —— 上游说该分支常回 `COMPILE_RESULT_UNKNOWN`，任务 8 按裁定**未**制造该响应；实现按形状落码、绝不猜成 0 |
| `uloop launch` 启动团结引擎 | ❌ **不可用**（见 PITFALLS U6），连接侧不受影响 |
| WebGL / Android 出包 | `[未验证]` —— **WebGL 支持未安装**（见 U9）；Android 模块在但未测（`unity build --target android` 会真的走 Gradle，未跑） |
| `unity build` 的**失败**报告（真机） | ✅ **已验证**（2026-09-19）—— 用不存在的场景路径触发 `result:Failed` / `totalErrors:1` / `report.steps` 带 `Error` 消息；同一载荷喂给 `lib/build.js` → `BUILD_FAILED` + 结构化 `actual.errors`（真机捕获的失败形状见 §9.5） |

---

## 9. S8：构建出包（✅ 已验证）

### 9.1 可用构建目标（取决于已安装的 PlaybackEngines）

```
Editor/Data/PlaybackEngines/
  AndroidPlayer                ✅
  WeixinMiniGameSupport        ✅
  windowsstandalonesupport     ✅
  （WebGLSupport）              ❌ 未安装
```

→ **S8 选了 StandaloneWindows64**。构建目标**不是全的**，取决于安装时勾了什么。

### 9.2 正确做法：`-batchmode -executeMethod`（**不需要编辑器运行**）

```bash
Tuanjie.exe -batchmode -quit \
  -projectPath <项目> \
  -executeMethod PiBuildScript.BuildWin64 \
  -logFile <日志>
```

**这是 `build` 命令的正确实现方式** —— 与 pi-cocos §8.1 要求「先完全退出编辑器」是同一意图，但 Unity 侧是**因为 batchmode 才是正规出包路径**（且 `-executeMethod` 不需要 GUI）。

构建脚本核心（`Assets/Editor/PiBuildScript.cs`）：

```csharp
EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene("Assets/Scenes/SampleScene.scene", true) };
var opts = new BuildPlayerOptions {
    scenes = new[] { "Assets/Scenes/SampleScene.scene" },
    locationPathName = outDir + "/S0Project.exe",
    target = BuildTarget.StandaloneWindows64,
    options = BuildOptions.None
};
var report = BuildPipeline.BuildPlayer(opts);
Debug.Log($"RESULT={report.summary.result} size={report.summary.totalSize} errors={report.summary.totalErrors}");
```

### 9.3 实测结果

| 项 | 值 |
|---|---|
| 退出码 / 总耗时 | **0 / 29s**（构建本体 14.7s） |
| `report.summary.result` | **Succeeded** |
| errors / warnings | **0 / 0** |
| 体积 | **114,668,585 B（109.4 MB）** |
| 产物 | `S0Project.exe` (464 KB)、`S0Project_Data/`、**`TuanjiePlayer.dll` (44 MB)**、`MonoBleedingEdge/`、`TuanjieCrashHandler64.exe` |

> ⚠️ **空场景也要 110 MB** —— 默认含完整运行时。这对「交付体积」是个实际考量点。

### 9.4 产物可运行验证（「构建成功 ≠ 能跑」）

按 pi-cocos 的纪律，构建成功**不算通过**，必须验证产物真能跑：

```bash
Start-Process S0Project.exe -ArgumentList '-logFile','<player.log>'
# 等 15s → 查进程 / 查日志 / 截图确认渲染
```

实测：

| 检查 | 结果 |
|---|---|
| 进程 | ✅ 运行中（141 MB） |
| `player.log` | ✅ 无错误；`Mono path[0]` → 程序集加载；`GfxDevice: Direct3D 11.0`；`Renderer: NVIDIA GeForce RTX 4070 SUPER`；`Initialized touch support` |
| 画面 | ✅ 全屏窗口渲染出 SampleScene 的背景色（与编辑器 Game 视图一致） |

**验证方法注意**：Windows standalone 无法用 pi-cocos 那套「`serve` + headless 截图」。
实际做法是**启动 exe + 截桌面 + `SetForegroundWindow` 切到前台**（否则会被其他窗口遮住）。

### 9.5 `unity build`（M3 命令化，✅ 已验证，2026-09-19）

路径与 S8 不同：**编辑器内** `execute-dynamic-code` → `BuildPipeline.BuildPlayer`
（`unity-scripts/build-player.cs`），不需要往用户工程里放 Editor 脚本，也不要求项目没被编辑器占着
—— 代价是**目标项目的编辑器必须开着**。真机（S0Project、win64、输出目录在项目之外）：

| 项 | 值 |
|---|---|
| 退出码 / `verified` / `result` | **0 / true / Succeeded**、`totalErrors:0`、`totalWarnings:0` |
| 端到端耗时 / 构建本体 | **13s** / **11.6s**（uloop 往返 12.8s）；**重复构建（无改动）约 2s** |
| 体积 | 磁盘实测 **114,718,252 B（109.4 MB）**；`report.summary.totalSize` = 114,672,585 B（差的正是 Burst 调试目录） |
| 产物（从**实际目录**读） | `2D Project.exe`(464 KB) / `2D Project_Data/` / **`TuanjiePlayer.dll`**(44 MB，根下) / `MonoBleedingEdge/` / `TuanjieCrashHandler64.exe` |
| 产物可运行 | ✅ 启动后进程存活（146 MB）、`player.log` 20 行无错误（`Mono path[0]` / D3D11 / RTX 4070 SUPER） |

> ⚠️ **产物名是 `Application.productName`，不是工程目录名**：S0Project 的 productName 是 **`2D Project`**
> —— S8 的手工脚本把 `S0Project.exe` 写死过，命令化后按真实 productName 出包。

**目标可用性（U9）真机枚举**（`BuildPipeline.IsBuildTargetSupported`，与磁盘 `PlaybackEngines` 一致）：
`win64` ✅ / `android` ✅ / `weixin` ✅（`BuildTarget.WeixinMiniGame.ToString()` 回 **`MiniGame`**，是别名，
所以候选名必须用**我们自己的**名字）、**`webgl` ❌**（未装模块）。

**反例（不许假装成功）**：`--target webgl` → 退出码 **1** + `BUILD_TARGET_UNAVAILABLE` +
`actual.available = [win64, android, weixin]`；输出目录**根本不会被创建**，不会改打别的目标。

**超时行为**：`--timeout-seconds 1` → 退出码 1 + `BUILD_TIMEOUT`；uloop 客户端退出后
**编辑器仍活着**（`scene tree` 正常、无孤儿 `uloop*.exe` 进程）—— 不要立刻重跑。

**失败的 BuildReport 形状**（探测⑤，用不存在的场景路径）：`result:Failed`、`totalErrors:1`、`totalSize:0`，
但 **`summary.outputPath` 仍然非空** → **不能**用「outputPath 有没有值」判成败；错误消息在
`report.steps[].messages[]`（`type.ToString() == "Error"`）里，`File`/`Line` 为 null。
