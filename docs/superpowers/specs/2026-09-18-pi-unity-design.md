# pi-unity 可行性 + 设计文档

| 项 | 值 |
|---|---|
| 日期 | 2026-09-18 |
| 版本 | v6（2026-09-18）—— **S0–S8 全过 + O5/O6/O9/O10 已决策**；新增 U9/U10、`TUANJIE-DIVERGENCES.md` |
| 状态 | **草案** — 选型已定（§10），Spike 主体已完成（§8.1），剩余未验项见 §8.1 末 |
| 决策前提（已确认） | ① 目标形态 = **标准 Pi 包**（可 `pi install`、带命令、可分享）<br>② 引擎绑定 = **兼容 Unity 官方版**（不绑死团结引擎）<br>③ 文档 = 独立 md（本文档），确定后再建仓库 |
| 架构决策 | **D1–D6 已定**，见 §10 决策记录 |

> ⚠️ **本文档的证据分级**：`[已验证]` = 本次实测或上游文档明确记载；`[未验证]` = 推断/假设，必须由 Spike 确认。
> 全文不含任何未标注的实机结论。

---

## 0. 结论摘要

> ✅ **S0–S8 实测全部通过（2026-09-18）**：uloop **3.6.3** + dispatcher **3.5.1** 在**团结引擎 2022.3.62t9** 上跑通**完整交付链**——
> 包装编译（44 asmdef → 44 DLL，0 error / 0 warning）→ **CLI 连接（首次 15s 成功）** → 动态 C# 执行 → 编译错误结构化 → 截图 → **PlayMode UI 点击闭环** → 确定性验证 → **构建出包 + 产物可运行**（109.4 MB / 14.7s）。
> **R1 完全解决**：本机没有 Unity 官方版不再是阻塞项。**pi-cocos 的全部支柱均已在 Unity 侧对应上。**
> 详见 §8.1 与 `pi-unity-spike/CAPABILITIES-tuanjie-2022.3.62t9.md`、`pi-unity-spike/PITFALLS.md`（U1–U8）。
>
> ⚠️ **最重要的发现（S5）**：uloop 对**异常和编译错误是诚实的**（`Success:false` + 完整堆栈），
> 但**对「语义偏离」不检测**（`fieldOfView = -100` 被钳制为 `1e-05`，仍报 `Success:true`）。
> → 信封层的职责被精确界定为「**写后读回比对 intent vs actual**」，而非重建错误处理。

**可行性高，但实现路径与 pi-cocos 完全不同——不要照抄 pi-cocos 的架构。**

三条核心判断：

1. **pi-cocos 最贵的那块在 Unity 世界有现成 MIT 替代。**
   pi-cocos 花了 4362 行 `editor-extension/` 去逆向 Cocos 2.4.15 的 IPC 通道（P1–P18 全在解这个）。Unity 生态已有人把这件事做完了，且是 MIT 许可。`[已验证]`

2. **其中两个方案本身就是 CLI，而 Pi 明确不要 MCP。**
   Pi README 第 499 行：**"No MCP."** —— 所以 MCP 类方案对 Pi 是**逆向适配**（要自写 MCP 客户端），CLI 类方案是**顺向适配**（直接调）。`[已验证]`

3. **因此 pi-unity 的形态应是：薄信封层 + skill + PITFALLS 纪律。**
   不是"再造一个 pi-cocos"。真正的工程量从"逆向编辑器"转移到"真机联调 + 坑位累积"，而后者是必须实打实做的。`[推断]`

**最大风险**：本机唯一安装的编辑器是**团结引擎**，而所有候选桥接方案只声明支持 **Unity 官方版**。二者兼容性 `[未验证]`，是 Spike 的第一优先级。

---

## 1. 已核实事实

### 1.1 本机环境 `[已验证]`

| 项 | 实况 |
|---|---|
| 引擎 | 团结引擎 Tuanjie **2022.3.62t9**，Tuanjie Editor 版本 `1.9.1`（基于 Unity 2022.3 LTS） |
| 编辑器 | `/d/devsoft/unity/unitySoft/2022.3.62t9/Editor/Tuanjie.exe` |
| 真实项目 | `<真实工程>/`（含 HybridCLR、TMP、Timeline、Test Framework） |
| Unity 官方版 | **未安装**（`/c/Program Files/Unity` 下无 Editor） |
| 已有 AI 工具链 | `Tuanjie Cowork` → `codely.exe`（213MB），自带 agent CLI / skills / MCP 管理 |
| 团结内置桥 | `codely serve unity-mcp --unity-project-path <p>` → stdio 或 HTTP streaming（默认 8765） |
| 团结桥工具面 | `manage_gameobject` / `manage_scene` / `manage_asset` / `manage_script` / `manage_shader` / `manage_editor` / `read_console` / `execute_menu_item` / `apply_text_edits`（**9 个**） |
| 团结桥接包 | `cn.tuanjie.codely.bridge`，发现文件 `.com-unity-codely.json`（存 TCP 端口） |
| ⚠️ 未装 | 该桥接包**不在** `Packages/manifest.json` 里 |

> **Q2 决策的后果**：因为要兼容 Unity 官方版，`cn.tuanjie.codely.bridge` **不能作为设计基石**（它同时绑死团结 + 需从 codely marketplace 获取）。团结桥降级为"本机 E2E 的临时手段"。

### 1.2 决定性约束：Pi 没有 MCP `[已验证]`

Pi `README.md:499`：

> **No MCP.** Build CLI tools with READMEs (see Skills), or build an extension that adds MCP support.

Pi `docs/usage.md:309`：

> It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash. You can build or install those workflows as extensions or packages…

**推论**：pi-unity 若选 MCP 桥，必须自己写 MCP 客户端（JSON-RPC over stdio/HTTP）。若选 CLI 桥，**零额外协议层**。

---

## 2. 桥接层选型（本文档的关键决策）

### 2.1 候选对比 `[已验证：以下数据来自各仓库 README / GitHub API，2026-09-18]`

| 候选 | 星 | 许可 | 传输 | 额外运行时 | 对 Pi 的适配 |
|---|---|---|---|---|---|
| **hatayama/unity-cli-loop**（`uloop`） | 565 | **MIT** | **无端口**：Unix domain socket / Windows named pipe | **无** | ⭐⭐⭐ **本身就是 CLI** |
| **youngwoocho02/unity-cli** | 311 | **MIT** | 直连 HTTP POST（Unity 侧自动监听 + 自动发现实例） | **无**（Go 单二进制） | ⭐⭐⭐ **本身就是 CLI** |
| CoplayDev/unity-mcp | 14307 | MIT | MCP stdio + TCP 到 Unity | **Python 3.10+ / uv** | ⭐ 需自写 MCP 客户端 + 拖 Python |
| isuzu-shiranui/UnityMCP | 319 | MIT | Unity Editor 自己暴露 `http://127.0.0.1:<port>/mcp` | 无 | ⭐⭐ 无独立进程，但仍是 MCP 协议 |
| **自研**（照抄 pi-cocos） | — | — | 自定 | 无 | ⭐ 最贵，且重复造轮子 |

### 2.2 工具面对比 `[已验证]`

**uloop（unity-cli-loop）—— 以下为 `[实测]`，来源 `.uloop/tools.json`**

**21 个工具**（含每个工具的参数 schema）：

| 分类 | 工具 |
|---|---|
| 开发循环 | `compile`、`get-logs`、`clear-console`、`run-tests`、**`hot-reload`** |
| 编辑器自动化 | `get-hierarchy`、`find-game-objects`、**`screenshot`**、`set-game-view-size`、**`record-video`**、`control-play-mode`、**`execute-dynamic-code`** |
| PlayMode 测试 | **`simulate-mouse-ui`**、**`simulate-mouse-input`**、**`simulate-keyboard`**、**`replay-input`** |
| 运行时调试 | **`enable-pause-point`** / `clear-pause-point`、**`enable-watch`** / `get-watch-values` / `clear-watch` |

> ⚠️ **与 README 的差异（以实测为准）**：`pause-point` 实际拆成 `enable-pause-point` + `clear-pause-point`；README 未提的 **watch 子系统**（`enable-watch` / `get-watch-values` / `clear-watch`）真实存在；README 列的 `focus-window` **不在** tools.json 里。详见 PITFALLS U5。
>
> **watch 子系统是重要发现**：它与 `enable-pause-point` 合起来 = 「暂停在任意行 → 读变量值 → 继续」，这是 pi-cocos 完全没有的调试维度。

> `launch` / `package install` / `skills install` / `compile-check` 是 **CLI 层命令**，不属于这 21 个 Unity 侧工具（见 PITFALLS U5）。

设计哲学（README §Design Philosophy）直接说了为什么要这么少：

> With dynamic C# code execution (`execute-dynamic-code`), almost any Unity Editor operation can be accomplished through a single tool. Too many tools make it harder for AI to choose the right one… When you find yourself wanting a new dedicated tool, **a Skill usually suffices**.

**unity-cli（Go）**

| 命令 | 说明 |
|---|---|
| `editor` | play / stop / pause / refresh（play 支持 `--wait`） |
| `console` | 读、过滤、清空控制台日志 |
| **`exec`** | **在 Unity 内运行任意 C# 代码** |
| `test` | 跑 EditMode / PlayMode 测试 |
| `menu` | 按路径执行任意 Unity 菜单项 |
| `screenshot` | 截 Scene / Game 视图为 PNG |
| `reserialize` | 走 Unity 序列化器重写资产 |
| `profiler` | 读 profiler 层级、控制录制 |
| `list` | 列出全部工具及参数 schema |
| `status` | 连接状态 |

### 2.3 决策 D1：**主选 `uloop`** `[已定 — 2026-09-18]`

**决定性理由不是星数，是能力覆盖**：

| pi-cocos 支柱 | uloop | unity-cli |
|---|---|---|
| §5 编译没错 | `compile` / `get-logs` / `clear-console` | `console`（较弱） |
| §6 截图看图 | `screenshot`（含 `CaptureMode:rendering` 游戏内画面）+ `record-video` + `set-game-view-size` | `screenshot` |
| **§7 点了会不会动** | **`simulate-mouse-ui` / `simulate-keyboard` / `replay-input`** | ❌ **无**（只有 Test Runner） |
| 调试增强 | `pause-point` / `hot-reload` | `profiler` |
| 万能口 | `execute-dynamic-code` | `exec` / `menu` |
| 仓库体积 | 154 MB（含 Unity 工程） | **322 KB** |

**§7「点了会不会动」是最难 DIY 的一环**——uloop 原生提供；unity-cli 需用 `exec` 手写 EventSystem / Input System 模拟，是实打实的开发量且必然踩一串坑。这一条就足以定选型。

**另外两个被低估的设计** `[已验证：上游文档]`：

1. **大输出自动落盘**。官方原文：*"Retrieved hierarchy data is always saved as JSON in `.uloop/outputs/HierarchyResults/` … The response only returns the file path, minimizing token consumption even for large datasets."* 场景树动辄几千行，直接进 context 会炸——uloop 自己就在做 token 优化。
2. **双二进制 + 按项目钉版本**：全局 `uloop` dispatcher 读 `.uloop/project-runner-pin.json`，按版本下载缓存的 `uloop-project-runner`，多项目不同版本共存。（CLI 与 unity-cli 同为 Go）

#### ⚠️ 2.3.1 安装路径：**不走 OpenUPM** `[已验证：2026-09-18 三轮实测]`

uloop 的官方 CLI 路径 `uloop package install` 走 OpenUPM scoped registry（`io.github.hatayama.uloopmcp`），而 **`package.openupm.com` 在本机 3 轮全部 21s 超时（不可达）**。同一批测试中 `raw.githubusercontent.com` 0.28s、`cdn.jsdelivr.net` 0.72s 稳定——不是整体网络问题，是该域名被阻断。

| 安装路径 | 本机可行性 |
|---|---|
| OpenUPM registry（官方 CLI 路径） | ❌ 不可达 |
| UPM git URL `https://github.com/hatayama/unity-cli-loop.git?path=/Packages/src`（README 的 UI 路径） | ⚠️ 需 `github.com`，实测间歇（3 轮中 1 轮 200，其余 30s 超时） |
| **codeload tarball → 本地 `file:` 包** | ✅ **0.67s 下完 87KB** |

**决策：走第三条，本地 vendor。** 这正是 pi-cocos `scripts/install.js` 已在用的模式（本地 vendor 编辑器扩展，Windows 用 junction）。`scripts/install.js` 应实现：

1. 从 `codeload.github.com` 下载上游 tarball → 落到项目外缓存目录
2. 在 `Packages/manifest.json` 写 `file:` 引用（或建 junction/symlink）
3. 支持 `--offline <已下载路径>` 与 `--version` 钉版本

**代价（必须承认）**：

- 仓库 154MB、C# 重、上游 churn 明显（V2→V3 换过传输层）
- Windows named pipe 稳定性 `[未验证]` → Spike S8
- `replay-input` 需 **Input System 包**，且录制只能在编辑器窗口手动做（**上游明确：无 CLI 录制命令**）。故试玩验证主力是 `simulate-*`，`replay-input` 是加分项而非主力。

**不推荐 CoplayDev**（尽管 14.3k★、工具最全 47 个）：强制 **Python 3.10+ / uv**，而 Pi 这边还要再写一个 MCP 客户端。两个依赖叠加不划算。它适合直接用 Claude Desktop 的人，不适合 Pi。

**不推荐自研**：pi-cocos 自研是因为 Cocos 2.4.15 没有选项（P1–P4 证明了官方 API 面不存在）。Unity 这边有 MIT 现成方案，自研属于重复造轮子。

**保留 `unity-cli` 作降级后端**：`exec` + `menu` 是万能逃生口，且仓库仅 322 KB、无 registry 依赖。uloop 的 `execute-dynamic-code` 理论上等价，但 Windows 上两者稳定性排序 `[未验证]`（Spike S8）。

> **配套设计纪律（重要）**：信封层做成 backend adapter，**skill 里只写我们自己的 JSON 契约，绝不泄漏 uloop 原生命令**。否则换后端要重写 skill——见 §3.2 ② 与 §6.4。

### 2.4 能力缺口：**构建出包** → ✅ 已解决 `[S8 已验证]`

**两个候选都没有「出包/构建 Player」的原生命令**（uloop 只在 `launch` 里带 `-p`；unity-cli 无 build）。

**但 S8 证实了正确的实现路径**：

```bash
Tuanjie.exe -batchmode -quit -projectPath <项目> \
  -executeMethod PiBuildScript.BuildWin64 -logFile <日志>
```

| 项 | 实测 |
|---|---|
| 总耗时 / 退出码 | **29s** / **0**（构建本体 14.7s） |
| `report.summary.result` | **Succeeded**，0 error / 0 warning |
| 体积 | **109.4 MB**（**空场景也是 110 MB** —— 默认含完整运行时） |
| 产物可运行 | ✅ 启动 exe → D3D11 初始化 → 渲出场景 |

→ 按 D3 分档，**构建属于「低频一次性」**，所以写成 skill 里的 C# 片段（不封进包）——见 §6.4。

**两个新增约束（已入档）**：

1. **构建目标不是全的**（U9）：本机 `PlaybackEngines/` 只有 Android / WeixinMiniGame / WindowsStandalone，**WebGL 未安装**。→ `doctor`/`build` 必须先枚举并报可用目标，**不能假定 web 平台存在**（pi-cocos 的参考流程恰好是 `web-mobile`）。
2. **产物体积**：空场景就 110 MB。交付体积是个实际考量点。

---

## 3. 架构设计

### 3.1 分层

```
┌─────────────────────────────────────────────────────────┐
│ Pi (无 MCP，靠 skill + shell)                            │
│   skills/unity-game-dev/SKILL.md      ← 方法论与铁律      │
│   pi-extension/                       ← /unity-* 命令    │
└───────────────────────┬─────────────────────────────────┘
                        │ 只调 CLI（Pi 的原生方式）
┌───────────────────────▼─────────────────────────────────┐
│ bin/unity.js   ← 薄信封层（本项目唯一自研代码）           │
│   · 包装 uloop / unity-cli 调用                          │
│   · 统一信封 {ok, verified, intent, actual, hint}         │
│   · 写后读回校验（补 uloop 没有的 verified 语义）          │
│   · 端口/实例发现、超时、重试                             │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│ uloop / unity-cli   ← 上游 MIT，不 fork、不改             │
└───────────────────────┬─────────────────────────────────┘
                        │ named pipe / HTTP
┌───────────────────────▼─────────────────────────────────┐
│ Unity Editor + 上游的 Unity 侧 Connector 包              │
│   （UPM git URL 安装，随编辑器自动启动）                  │
└─────────────────────────────────────────────────────────┘
```

### 3.2 关键设计点

**① 信封层是唯一自研代码，且必须比预先设想的更薄——因为 uloop 已经自带了大部分。** `[S0–S5 实测修正]`

原设想的「信封层要造 `{ok, verified, intent, actual, hint}`」被实测修正：

| 信封字段 | uloop 已有？ | 我们的工作 |
|---|---|---|
| `ok` | ✅ `Success` | 直接用 |
| `hint` | ✅ `NextActions[]` | 直接用 |
| 错误分类 | ✅ `ErrorCode` / `Phase` / `Retryable` | 直接用 |
| 异常信息 | ✅ `ErrorMessage` + 完整堆栈 | 直接用 |
| 编译错误细节 | ✅ `Line`/`Column`/`ErrorCode`/`Context`（带插入符） | 直接用 |
| **`verified`（意图是否达成）** | ❌ **没有** | **← 唯一真正的自研价值** |

**S5 实测证据**：

```csharp
cam.fieldOfView = -100f;  // Unity 钳制为 1e-05
// → Result: "intent=-100 actual=1E-05",  Success: true
```

`Success: true` 的含义是「**你的代码执行了**」，**不是**「**你的意图达成了**」。

**所以信封层的真正职责 = 写后用 `get-hierarchy` / `execute-dynamic-code` 读回，比对 intent vs actual，不符则 `verified:false`。**

**配套的三个集成事实（实测，否则信封层会写错）**：

1. **JSON 走 stderr**，stdout 为空；**退出码 0=成功 / 1=失败**
2. **`get-hierarchy` 不含任何属性值**（只有 name/isActive/components/tag/layer/children）→ 验证属性必须走 `execute-dynamic-code` 读回
3. **uloop 的读回也是落盘的**（`.uloop/outputs/HierarchyResults/`）→ 信封层要读文件而非抓 stdout

**② 不 fork 上游。**
上游更新频率高（uloop V2→V3 换过传输层，CoplayDev 已到 v10.0.0）。fork 会背上合并成本。信封层作为**进程外包装**，上游升级不破坏契约。

**③ skill 是主要交付物，不是附属品。**
uloop 自己也 `uloop skills install --claude/--agents` 装 skill。我们要写的是**面向 Pi + 面向"在 Unity 里搭可交付游戏"这个任务**的 skill，与上游 skill 是互补而非重复：上游讲工具怎么用，我们讲**工作流铁律**（先 doctor、写后必读回、截图必须真看、迭代上限、停止条件）。

**④ PITFALLS 机制照搬，编号从 U1 起。**
pi-cocos 的 P1–P63 是本项目最值钱的资产。Unity 侧从零累积，每条带编号 + 证据 + 实测日期。

---

## 4. 与 pi-cocos 的复用矩阵

| pi-cocos 资产 | 行数 | pi-unity 可复用度 |
|---|---|---|
| `editor-extension/`（编辑器扩展） | 4362 | ❌ **整个不需要**（上游代劳） |
| `lib/art.js` + art pipeline（去底/裁边/缩放） | — | ⭐⭐⭐ 与引擎无关，几乎原样搬 |
| `lib/chrome.js` + puppeteer-core | — | ⭐⭐ 部分：uloop 自带 `screenshot`，WebGL 产物验证仍可用 Chrome |
| `lib/serve.js` 静态服务 | — | ⭐⭐⭐ 原样搬（验证 WebGL 产物时要用） |
| `lib/doctor.js` / `smoke.js` / `golden.js` | 1671（lib 合计） | ⭐⭐ 思路照搬，实现重写 |
| `bin/cocos.js` CLI 骨架 + 信封 | 369 | ⭐⭐ 改签名 |
| `lib/build.js` | — | ⭐ 重写（Unity 侧要过 `BuildPipeline`） |
| `skills/` + `PITFALLS.md` + 回写方法论 | 360 + 623 | ⭐⭐⭐ **方法论照搬，内容全新** |

**净效果**：省掉的是最贵的一块（4362 行逆向 + 其对应的几十次重启预算），保留的是纪律与工具链骨架。

---

## 5. 工具映射：pi-cocos 27 工具 → Unity 侧对应

| pi-cocos | Unity / uloop 对应 | 备注 |
|---|---|---|
| `doctor` / `doctor --smoke` / `--golden` | 需自建（包装连接检查 + 冒烟） | 黄金测试可借 `get-hierarchy` 做规范化比对 |
| `scene.info` / `scene.tree` | `get-hierarchy` / `find-game-objects` | 输出 JSON，天然适合做 golden 比对 |
| `node.create` / `node.inspect` / `node.set` | `execute-dynamic-code` | 需在 skill 里固化 C# 片段 |
| `component.add` / `.set` / `.inspect` | `execute-dynamic-code` | 同上 |
| `component.bindEvent` | `execute-dynamic-code`（写 `UnityEvent`） | Unity 无 `emitEvents` 静默跳过坑，但有自己的序列化坑 `[未验证]` |
| `prefab.create/instantiate/apply/revert` | `execute-dynamic-code`（`PrefabUtility`） | — |
| `asset.list` / `.import` / `.delete` / `.refresh` | `execute-dynamic-code`（`AssetDatabase`） | — |
| `asset.setMeta`（filterMode 等） | `execute-dynamic-code`（`TextureImporter`） | — |
| `console.read` | **`get-logs` / `compile`** | 原生支持，比 pi-cocos 更直接 |
| `preview.start` | `control-play-mode` | Unity 无需"预览服务"，直接 Play |
| `shot` / `shot --frames` | **`screenshot`** / `record-video` | 原生更强 |
| `play`（模拟点击试玩） | **`simulate-mouse-ui` / `simulate-keyboard`** | 原生更强 |
| `anim-probe`（属性时间序列） | `pause-point` + `record-video` | 机制不同，效果可能更好 |
| `build` | ❌ **缺口** → `execute-dynamic-code` 调 `BuildPipeline` 或 `menu` | 见 §2.4 |

> **观察**：pi-cocos 用大量"造出来的工具"补编辑器的能力缺口；uloop 用 `execute-dynamic-code` 这一个万能口 + 少数高频专用工具。后者的模式意味着**很多逻辑从 CLI 层转移到 skill 的 C# 片段里**——这是本文档最重要的架构含义 `[推断]`。

---

## 6. 必须保留的资产（来自 pi-cocos 的教训），与一条显式分歧

### 6.1 写后读回铁律

pi-cocos 原文：

> **贯穿全程的一条铁律**：2.4.15 的场景写通道**大多不回调**，"调用已发送"≠"已生效"。所有写操作返回信封里的 `verified`；**`verified:false` 就是失败，必须停下处理，不许往下继续搭**。

Unity 侧是否有同类问题 `[未验证]`。但**这条铁律的形态必须保留**——Spike 的第一件事就是测：`execute-dynamic-code` 改属性后，`get-hierarchy` 读回是否一致？是否有静默 no-op 的情况（pi-cocos 的 P12）？

### 6.2 doctor / smoke / golden 三件套

- `doctor`：连接、编辑器在线、项目已打开、build target
- `doctor --smoke`：只读工具逐个跑 + 写-读回-删自闭环，逐项 pass/fail
- `doctor --golden`：同一组确定性指令跑两轮，比对 `get-hierarchy`（剥 GUID），报首个分歧路径

第三个尤其必要：**Unity 的浮点序列化、组件顺序、GUID 分配都可能引入不确定性**，不测出来会变成随机失败。

### 6.3 里程碑回写

照搬 pi-cocos 的 `DEV-WORKFLOW.md` §1 第 5 步 + 反例警戒：

> **文档回写**放在真机验证**之后**（避免写未经验证的结论）。
> 反例警戒：先写文档再验证，会把未证实的公式写进 SKILL/ARCHITECTURE（P33/P40 都是真机才暴露）。

每次回写扫：工具数、坑位数、测试数、能力清单、`bin --help` 文案。

### 6.4 一条显式分歧：上游说「别加工具，写 skill」，我们不照办

uloop 上游的设计哲学原文（README §Design Philosophy）：

> With dynamic C# code execution (`execute-dynamic-code`), almost any Unity Editor operation can be accomplished through a single tool. Too many tools make it harder for AI to choose the right one… **When you find yourself wanting a new dedicated tool, a Skill usually suffices.** Write the routine operation down as SKILL.md instructions, a shell script, or a C# snippet passed to `execute-dynamic-code`, and the AI just invokes it.

**这条建议不适用于 pi-unity 的高频路径**，因为它假设的是**低频**操作。而「搭场景」是**高频 + 每次参数不同**的：

- **低频**：参数固定 → 写成 skill 片段合理
- **高频**：参数每次不同 → 写成 skill 片段意味着**每轮都要 LLM 重新生成 C#** → token 浪费 + 生成即出错的风险

**决策 D3 的分档**：

| 类型 | 方案 | 例子 |
|---|---|---|
| **高频写操作** | **包内 `.cs` + 只暴露 JSON 契约** | `unity node.set '{"path":"...","patch":{...}}'`、组件增删改、Prefab 操作 |
| **低频一次性** | skill 内联 C# 片段 | `BuildPipeline` 出包（一辈子写一次，封装反而降低透明度） |

**高频走包内的三条理由**：

1. **token**：搭场景的 C# 片段累计上千行，内联 skill 意味着每次加载都吃满 context。uloop 自己都为大输出做了落盘优化——我们在 skill 里塞一千行 C# 是自相矛盾。
2. **可验证**：markdown 里的 C# **编译器检查不到**，写错了只有运行时才暴露。这恰是 pi-cocos 用 623 行 PITFALLS 记录的那类问题。
3. **可测试**：能进单测。pi-cocos 的底线是 34 个测试文件 / 5034 行测试代码。

> **这条分歧必须显式记录**，否则将来的会话看到上游文档会动摇，或重复论证「为什么不按上游推荐来」。

---

## 7. 风险清单（全部标注验证状态）

| # | 风险 | 状态 | 影响 |
|---|---|---|---|
| R1 | uloop / unity-cli 在**团结引擎 2022.3.62t9** 上能否装、能否连 | **包侧 ✅ 已验证（S0）**；**连接侧 `[未验证]`（S1）** | 已降级——本机无 Unity 官方版不再是阻塞项 |
| R2 | 写操作是否有 `verified` 读回语义 | **✅ 已验证（S5）——分层结论**：异常/编译错误 **uloop 已诚实上报**；**语义偏离不检测**（`Success:true` 但意图未达成） | 已降级——信封层职责收窄为「写后读回比对」 |
| R3 | Windows 上 named pipe（uloop）的稳定性 vs HTTP（unity-cli） | **✅ 已验证（S1）**：named pipe 连接**首次 15s 成功**，管道名 per-project（`uloop-UnityCliLoop-<哈希>`） | 已消除——无需降级到 unity-cli |
| R4 | 构建/出包无原生命令，需自己写 C# 片段 | `[已验证存在缺口]` | 中——第一批坑位 |
| R5 | Unity 域重载/资产导入的时序不确定（类比 pi-cocos P26「preview stash 是旧的」） | `[未验证]` | 中 |
| R6 | Editor Throttling 导致后台命令延迟（unity-cli README 明确要求关掉） | `[已验证：上游文档]` | 低，但必踩——首条 PITFALLS 候选 |
| R7 | Unity 浮点/顺序/GUID 的非确定性影响 golden 测试 | **⚠️ 初步已验证（S7）**：单相机场景下两次读回 **IDENTICAL**；复杂场景待验 | 降级——golden 可行 |
| **R12** | **编辑器界面语言影响窗口匹配**（`--window-name Game` 在中文编辑器上全部失败） | **✅ 已验证（S4→U7）** | 中——`doctor` 必须探测语言或强制走 `rendering` |
| **R13** | **`uloop launch` 无法发现团结引擎**（只搜 Unity Hub 路径） | **✅ 已验证（S1→U6）** | 中——`doctor`/`launch` 必须自实现编辑器发现 |
| **R14** | **构建目标取决于已安装的 PlaybackEngines**（本机 WebGL 未装） | **✅ 已验证（S8→U9）** | 高——`build` 不能假定平台存在 |
| **R15** | **团结与 Unity 官方的文件/产物差异**（`.scene` / `yousandi.cn` tag / `TuanjiePlayer.dll`） | **✅ 已验证（S8→U10）** | **高**——硬编码 Unity 约定必挂 |
| R8 | 上游破坏性变更（uloop V2→V3 换过传输层） | `[已验证：上游文档]` | 中——不 fork 策略的代价 |
| R9 | 团结引擎与 Unity 官方在 API/包管理上的差异面未知 | `[未验证]` | 中 |
| R10 | **网络可达性**：`package.openupm.com` 不可达；`github.com` 间歇（30s 超时 / 200）；`codeload.github.com` ✅ 0.67s；`raw.githubusercontent.com` ✅ 0.28s；`cdn.jsdelivr.net` ✅ 0.72s | `[已验证：2026-09-18 三轮实测]` | **高**——决定安装路径必须走 codeload vendor（见 §2.3.1） |
| R11 | 不 fork 策略下上游语义可能泄漏进 skill，导致换后端要重写 skill | `[设计风险]` | 中——靠 §3.2 ② + §6.4 纪律约束 |

---

## 8. Spike 计划（决定选型的最小验证）

**目标**：用最小成本把 R1 / R2 / R3 变成已知。**不写正式代码。**

**顺序**：按 D1，**先 uloop**（S0–S7）；`unity-cli` 作为对照（S8）。

### 8.1 S0–S8 实测结果 ✅ **全部通过**（2026-09-18）

在**新建的干净测试项目**（`pi-unity-spike/S0Project`，从编辑器自带 `cn.tuanjie.template.2d-7.0.4.tgz` 解出）上验证，**未触碰用户真实工程**（已用 md5 验证）。

| 步 | 内容 | 结果 |
|---|---|---|
| **S0** | codeload vendor 安装 + 编译 | ✅ 44 asmdef → 44 DLL，**0 error / 0 warning**；batchmode 退出码 0（43s）；许可证 `responseCode 200` |
| **S1** | CLI 连接运行中的编辑器 | ✅ **首次尝试（15s）成功**；project-runner 3.4.0 自动下载 |
| **S2** | `execute-dynamic-code` | ✅ 返回 `Application.dataPath` |
| **S3** | `compile` / `get-logs` | ✅ `ErrorCount: 0` / `WarningCount: 0`，结构化 |
| **S4** | `screenshot` | ✅ 通过（**需本地化窗口名「游戏」** → U7） |
| **S5** | 写后读回语义（**最关键**） | ✅ **分层结论**，见下 |
| **S6** | PlayMode + 输入模拟 | ✅ **UI 点击闭环打通**（建 UI → 进 PlayMode → 标注截图 → 点击 → 日志验证回调） |
| **S7** | 确定性 | ✅ 两次读回 **IDENTICAL** |
| **S8** | **构建出包** | ✅ **构建成功 + 产物可运行**（109.4 MB / 14.7s / 0 error） |

**S5 的分层结论（本次最重要的发现）**：

| 场景 | 实测 | 谁负责 |
|---|---|---|
| 抛异常 | ✅ `Success:false` + `ErrorMessage` + **完整堆栈** | uloop 已处理 |
| 编译错误 | ✅ `CompilationErrors[]` 含行列/错误码/**插入符上下文** | uloop 已处理 |
| **语义偏离**（意图 vs 实际） | ❌ **`Success:true`，工具不检测** | **← 我们的信封层** |

**直接收获**：

1. **R1 完全解决**：包装、编译、**CLI 连接**全部通过。本机没有 Unity 官方版 **不再是阻塞项**。
2. **R2 解决（分层）**：uloop 错误上报诚实，但**不验证意图** → 信封层职责收窄为「写后读回比对」（修正 §3.2 ①）。
3. **R3 消除**：named pipe 首次即通，**无需准备 unity-cli 降级后端**。
4. **R7 降级**：单场景确定性成立，golden 测试可行。
5. **权威工具清单到手**：21 个工具 + 参数 schema（已回写 §2.2）。
6. **新发现 watch 子系统**：`enable-watch` / `get-watch-values` / `clear-watch`。
7. **坐标问题被原生解决**：`screenshot` 直接回传 `ScreenshotToInputFormula` + `AnnotatedElements[].SimX/SimY`（**pi-cocos 的 F6 问题不需要我们重现**：无需自建 `clickDesign` 机制）。
8. **8 条坑位入档**（`PITFALLS.md` U1–U8）。

**新增依赖面与网络**：uloop 需 `com.unity.nuget.newtonsoft-json@3.2.1` + `com.unity.nuget.mono-cecil@1.11.6`；Unity registry 组均可达（`packages.unity.cn` 0.32s）。
**修正**：`github.com` 的 **HTML 页面**间歇不可达，但 **Releases 下载畅通**（1.98s）——不要因首页超时就断定 Releases 不可用。

**仍未验证**：`simulate-keyboard`/`simulate-mouse-input`（需项目装 Input System）、`replay-input`、`pause-point`/watch 实际行为、`hot-reload`、`record-video`、`run-tests`、`find-game-objects`、WebGL/Android 出包（U9）、复杂场景 golden 确定性。

### 8.1b S8 详述：构建出包

| 项 | 结果 |
|---|---|
| 路径 | `-batchmode -quit -executeMethod PiBuildScript.BuildWin64`（**不需要编辑器运行**） |
| 目标 | `StandaloneWindows64`（WebGL 未装 → U9） |
| 结果 | `Succeeded` / **0 error / 0 warning** / **109.4 MB** / 构建 14.7s（总 29s） |
| 产物 | `S0Project.exe` + `S0Project_Data/` + **`TuanjiePlayer.dll`(44MB)** + `MonoBleedingEdge/` |
| 产物验证 | ✅ 进程启动、`player.log` 无错、D3D11 初始化、**画面渲染确认** |

**验证方法的差异**：Windows standalone **用不了** pi-cocos 那套「`serve` + headless 截图」。
实际做法：启动 exe → 查进程/日志 → 截桌面（**必须先 `SetForegroundWindow` 切前台**，否则被其他窗口遮住）。

### 8.2 步骤表

| 步 | 动作 | 通过判据 |
|---|---|---|
| **S0** ✅ | **codeload vendor 安装**：下载 `hatayama/unity-cli-loop` tarball → 落到缓存 → `Packages/manifest.json` 写 `file:` 引用 → 重启编辑器<br>（**不走 OpenUPM**，见 §2.3.1） | ~~包被 Unity 识别、编译无错~~ → **已通过** |
| S1 | `uloop launch` + 连接检查 | 能连上编辑器 → **R1 首答** |
| S2 | `uloop execute-dynamic-code --code 'return Application.dataPath;'` | 返回真实路径 → **R1 通过** |
| S3 | `uloop compile` + `uloop get-logs` | 能读编译错误与控制台 |
| S4 | `uloop screenshot`（含 `CaptureMode:rendering`） | 出 PNG，且 PlayMode 下能拿到**游戏内画面**（无编辑器窗口边框） |
| S5 | **R2 关键**：用 dynamic code 改某节点属性 → `get-hierarchy` 读回 → **再故意写一个非法值看是否静默失败** | 明确区分「真成功 / 静默 no-op」→ **决定信封层厚度与 D3 分档线** |
| S6 | `uloop control-play-mode` 进 PlayMode + `simulate-mouse-ui` / `simulate-keyboard` | PlayMode 能进、**输入能生效**（pi-cocos §7 等价能力） |
| S7 | 连续跑 S1–S6 两轮，比对 `get-hierarchy`（剥 GUID） | 非确定性可见 → R7 首答，golden 测试可行性 |
| S8 | 同 S0–S6 换 `unity-cli`（`?path=unity-connector`）重跑 | 对照 **R3**（named pipe vs HTTP 稳定性） |
| S9 | （**仅当**团结不通）装 Unity 官方版 2022.3 LTS 重试 | 区分「团结差异」与「方案本身问题」 |

> **S5 是这批里最关键的一测**：它决定信封层的厚度——也就是 D3 的分档线到底画在哪。

**S9 的决策含义**：若团结不通而官方版通，则意味着**开发/验证环境必须换成官方版**，本机需新装编辑器。这是 D2 的触发条件，**现在不预设答案**。

**Spike 产出**：`CAPABILITIES-<引擎>-<版本>.md`（实测 API 面）+ `PITFALLS.md` 头几条（**编号从 U1 起**，与 pi-cocos 的 P1–P63 区分）。

**已产出（S0，位于 `C:/Users/<用户>/pi-unity-spike/`）**：

| 文件 | 内容 |
|---|---|
| `CAPABILITIES-tuanjie-2022.3.62t9.md` | S0–S8 全部实测面：安装/依赖/信封结构/21 工具权威表/坐标公式/构建出包 |
| `PITFALLS.md` | **U1–U10**（OpenUPM 不可达 / 空目录 meta 警告 / API size 误判 / Windows Python 与 MSYS /tmp / README 与实测不符 / uloop launch 找不到团结 / 中文窗口名 / UnityEvent 监听器丢失 / PlaybackEngines / 团结差异） |
| `TUANJIE-DIVERGENCES.md` | **团结 vs Unity 官方 12 条差异（D-1~D-12）**，含 D-11 共享 EditorPrefs 风险 |
| `S0Project/` | 干净测试项目（模板解出，**未触碰用户真实工程**）；含 `Assets/Editor/PiBuildScript.cs` |
| `vendor/uloopmcp/` + `uloop-bin/` | 上游包 vendor（2744 文件 / 17 MB）+ dispatcher 3.5.1 |
| `build/win64/` + `s8-build.log` + `player.log` | 构建产物（109.4 MB）与可运行性证据 |

---

## 9. 里程碑路线（草案）

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M0** | Spike（§8）—— **S0–S7 ✅ 全过**；余下未验项见 §8.1 末 | R1 ✅ / R2 ✅（分层）/ R3 ✅ / R7 ⚠️初步 |
| **M1** | ✅ **已完成（2026-09-19）** `bin/unity.js` 信封层 + `doctor`/`--smoke` + `scene tree`/`node inspect` + `node create`/`node set`（写后读回）+ `shot` + skill v1 + PITFALLS | ✅ 真机（团结 2022.3.62t9 + dispatcher 3.5.1）跑通「建节点 → 写后读回 `verified:true` → 截图并看图」；`npm test` **206/206** 绿 |
| **M2** | ✅ **已完成（2026-09-19）**：E2E 验收——盲测让 Pi 只靠 skill 搭一个完整小游戏（极简霓虹打砖块）；新增 `node delete` / `pixels` / `sprite set` / `asset write` / `compile` / `play` / `doctor --smoke` 写闭环 / `doctor --golden` | ✅ 四条判据全过（结构 / 画面 / 可动 / 纪律），由与实现无关的子代理盲测、另一子代理独立复核；`npm test` **366/366** 绿；详见 §9.2 与 `docs/E2E-ACCEPTANCE-m2.md` |
| **M3** | 构建交付：`BuildPipeline` 走通 + 产物验证 | ✅ **S8 已提前验证**（StandaloneWin64）；WebGL 待装模块（U9） |
| **M4** | 美术管线移植（`lib/art.js`）+ Prefab 工作流 | 用户供图 → 自动导入绑定 |
| **M5** | 包化为标准 Pi 包（`pi-package` + `/unity-*` 命令） | `pi install` 可装可用 |

> M1 之前的每一项都必须有 `[已验证]` 证据才能写进 skill。

### 9.1 M1 完成情况与偏差（2026-09-19）

**M1 范围按 R6 收窄**为「基础设施 + `doctor` + 场景读写 + 截图」。以下明确**划入后续里程碑**，
故 M1 的验收口径相应调整为「建节点 → 写后读回 → 截图看图」，**不含** `golden` / `unity play` 试玩闭环：

| 后移项 | 去向 | 现状 |
|---|---|---|
| `golden` 黄金测试（§6.2 第三件） | M2 | R7 只做了初步验证（单相机场景两次读回 IDENTICAL） |
| `unity build` 命令化 | M3 | S8 已**手工**验证 StandaloneWindows64（109.4 MB / 14.7s）；WebGL 待装模块（U9） |
| `unity play` 试玩闭环 | M2 | 只有裸 uloop 的 `control-play-mode` / `simulate-mouse-*` |
| skill 完整版 + E2E 盲测 | M2 | 本里程碑交付的是 skill v1（M1 命令面） |
| `shot` 的 `--match-mode` / `--capture-mode` 接线 | M2 | 需要时用裸 uloop（U7）；**M2 已完成接线，见 §9.2** |

**真机验收还发现并修正了一条计划外缺陷**：`uloop list`（dispatcher 级命令）的响应**没有 `Success` 字段**，
而 `doctor` 的探活复用了为 first-party 工具定的 `Success === true` 判据 → 编辑器明明连着却报
`无法连接（退出码 0）`（假红，doctor 永远不绿）。已按 dispatcher 的具体形状 `{Version, Tools}` 修正（R115），
见 `docs/PITFALLS.md` U14。

**验收判据 4 的口径修正（R112）**：原判据写「截图画面里能看到 `M1Probe`」——**原理上做不到**：
`node create` 建出的是只有 `Transform` 的裸节点，Game 视图不渲染任何几何。故改判为
「**图 = 真实渲染内容**（用 `read` 目视确认非空/非黑/非异常）」+「**`M1Probe` 确实在场景里**由
`node inspect` 与 `scene tree --json` 两条独立证据交叉证明」。该口径已写进
`skills/unity-game-dev/SKILL.md` §3（「裸节点在截图里看不见」）。

---

### 9.2 M2 完成情况与偏差（2026-09-19）

**验收方式**（§6.3：文档回写放在真机验证之后）：盲测由与实现无关的子代理执行
（只给 `SKILL.md` + `docs/PITFALLS.md` + 项目路径 + 命令路径 + 环境变量），四条判据由**另一个**子代理
独立复核（不看盲测自述），原始命令/退出码/截图清单见 `docs/E2E-ACCEPTANCE-m2.md` §2
（含回写后重跑）。工作分支 `m2-impl`（从 M1 的 `m1-impl@8c27e58` 分出）。

| 后移项 / 偏差 | 去向 | 结论（真机证据；每一条都能指向 `docs/E2E-ACCEPTANCE-m2.md` 或某个任务报告） |
|---|---|---|
| 视觉闭环（M1 未证明）—— 锚点：§9.1 的「验收判据 4 的口径修正（R112）」段 + M1 账本的「残留风险」段 | **M2 已证** | `sprite set` 真机 `verified:true`；`pixels --expect` 命中 **退出码 0**（区域均色 `distance:0`）；`read` 看图确认「4 行彩砖 + 青挡板 + 白球 + HUD」。即用 `pixels` 把 R112 的「目视确认」升级为**退出码**（世界坐标→像素公式见 `docs/CAPABILITIES-*.md` §4.4，实测命中偏差 0 px）。证据：任务 5 真机 + 任务 11 打砖块全链路 + E2E §2.3 判据 2；commit 范围：任务 5 `5c6e0b4..ce32137`、任务 11 `1bdf1ae..5d19c01`、任务 12 `95ec92c..c445ec8` |
| `doctor --golden`（§6.2 第三件） | **M2 已交付** | 两轮结构投影 `matched:true`、`diff:null`、`cleanup.status:"ok"`；复杂场景（盲测 29 节点 / 24 砖）确定性成立，首个分歧路径不适用；见任务 9 真机 + E2E §2.3 判据 4（本任务终验复跑见 `task-13-report.md`）；commit 范围：任务 9 `657316a..661a622`、任务 12 `95ec92c..c445ec8` |
| `--smoke` 写-读回-删自闭环 | **M2 已交付** | 七项全 `pass`（3 只读 + 4 写闭环：`write-create`/`write-set`/`write-delete`/`write-clean`）；**语义变化已写入 skill 与 USAGE**（M2 起 `--smoke` **不再只读**，会写 `__pi_smoke` 临时节点、不保存场景）；commit 范围：任务 10 `661a622..1bdf1ae` |
| `unity play` 试玩闭环 | **M2 已交付** | 进/出/暂停/步进/日志/视图尺寸真机通过；`play start/stop` 的域重载回包形状已窄口径收口（U18）。`key`/`mouse` 的 Input System 缺口**如实落 `INPUT_SYSTEM_UNAVAILABLE`**（真实注入**未验证**，U25）；commit 范围：任务 7 `ff786e0..983b873` |
| `shot --capture-mode` / `--match-mode` | **M2 已接线** | 真机：EditMode `window` 仍需本地化窗口名（U7）；`rendering` 需 PlayMode（否则 `ULOOP_ERROR`、退出码 1）；`--match-mode` 仅 `window` 模式生效；commit 范围：任务 6 `ce32137..ff786e0` |
| **M2 新增需求：`unity asset write` + `unity compile`** | **新增（M2 内）** | 依据：动态代码的 `MonoBehaviour` 不能跨域重载存活（U8 同族）→ 盲测游戏必须落真 asset；`compile` 有错时上游回 `Success:false` 且进程退出码 1（U19）；commit 范围：任务 8 `983b873..657316a` |
| **M2 新增需求：`unity node delete`** | **新增（M2 内）** | 依据：`--smoke` 自闭环与 `--golden` 清理都需要它（写后读回：读回必须 `NOT_FOUND` 才算 `verified`）；commit 范围：任务 3 `f223f1f..8a8d816` |
| **M2 新增需求：`unity pixels`** | **新增（M2 内）** | 依据：把「看得见」变成退出码（可观测验收）；只有 `--at` / `--region` / `--count-color` / `--expect`，**没有** diff/质心/bbox（U24）；commit 范围：任务 4 `8a8d816..5c6e0b4` |
| **M2 新增偏差：`doctor --json` 契约** | M2 | `{ok,mode,checks}` + 逐项 `code`（M1 是 `{ok,checks}` / `{ok,results}` 且无 `code`）；`--golden` 是**显式例外** `{ok,mode:'golden',matched,diff,cleanup,blocked,lines}`；commit 范围：任务 10 `661a622..1bdf1ae` |
| **M2 新增偏差：退出码边界** | M2 | `2` = 用法错 / `1` = 运行时错，**单点判定** `exitCodeFor`（`lib/envelope.js`）；`actual.match === false` 也判 1；commit 范围：任务 1 `d2c6b05..2a7e25a` |
| **仍未验证** | M3+ | `simulate-keyboard` / `simulate-mouse-input` 的**真实注入**（需装 Input System 的项目，U25）、`replay-input`、`pause-point` / watch、`record-video`、`run-tests`、`find-game-objects`、`uloop compile --force-recompile` 的 `COMPILE_RESULT_UNKNOWN` 形状、WebGL / Android 出包、**Unity 官方版全量** |

**与本里程碑相关的文档收口**：`docs/PITFALLS.md` 编号定稿为 **U1–U26**（M2 新增 U16–U26，索引表同稿补齐，
`skills/unity-game-dev/SKILL.md` §7 的引用与之一致）；`docs/CAPABILITIES-tuanjie-2022.3.62t9.md` 新增 §4.7
（M2 用到的**每一个**上游字段/参数名及 vendor 出处）；`README.md` 状态段与 `bin/unity.js --help` 逐条对账。
各任务审查循环里判定为 Minor 且属**代码/测试行为**的条目**不在收口任务内改**，集中登记在
`docs/PITFALLS.md` 的「已知问题登记」节，交**最终整分支审查**甄别。

---

## 10. 决策记录（D1–D6 已定，2026-09-18）

| # | 决策 | 理由 | 状态 |
|---|---|---|---|
| **D1** | **主选 `uloop`**，安装走 codeload vendor（**不用 OpenUPM**）；`unity-cli` 作降级后端 | §7 试玩验证只有 uloop 原生提供；大输出落盘省 token（详见 §2.3） | ✅ 已定 |
| **D2** | 先跑 Spike S0–S2，**不提前决策**是否装 Unity 官方版 | S0 成本几分钟（改一行 manifest + 重启），装官方版成本几 GB + 授权 + 国内下载 | ✅ 已定 |
| **D3** | **分两档**：高频写操作 → 包内 `.cs` + 只暴露 JSON 契约；低频一次性 → skill 内联片段 | token + 可编译验证 + 可测试（详见 §6.4） | ✅ 已定 |
| **D4** | 移植 art pipeline，但推到 **M4**，且先重踩 Unity 导入坑 | 唯一引擎无关资产；但 Unity 多一层 `TextureImporter`（`filterMode=Point`、压缩会毁像素画），且 GUID 机制让「文件名稳定」契约需重验 | ✅ 已定 |
| **D5** | 包名 `pi-unity`，命令 `unity`，skill 名 `unity-game-dev` | 无系统命令冲突，对齐 pi-cocos 布局（`skills/` `bin/` `lib/` `pi-extension/`） | ✅ 已定 |
| **D6** | **团结引擎 = 本机 E2E 验证环境（一等公民）；Unity 官方版 = 设计约束 + 兼容性探测目标** | 二者不冲突，见下方澄清 | ✅ 已定 |

### D6 的关键澄清：与 Q2 不冲突

Q2「兼容 Unity 官方版」的真实含义是「**不依赖团结私有 API**」，而不是「必须在官方版上验证」。uloop / unity-cli 走的是 Unity 标准 Editor API（`AssetDatabase` / `PrefabUtility` / `BuildPipeline` / `EditorApplication`）——**只要不用 `cn.tuanjie.codely.bridge`，选它们本身就自动满足 Q2**。

所以 D6 的真问题不是「兼不兼容官方版」，而是「**用哪个引擎做验证**」。结论：**团结引擎当验证环境**，因为这台机器上唯一能跑的就是它——没有验证环境就攒不出坑位，而这个项目 90% 的价值来自实测累积（pi-cocos 最核心的教训就是「必须真机验证」）。

**执行纪律**：所有 SKILL / PITFALLS 条目**加「适用引擎与版本」标注**，避免把团结特有行为误当 Unity 通用行为。

### 开放项（O1–O4、O7 已解决；O5/O6/O9/O10 见下）

| # | 问题 | 状态 |
|---|---|---|
| ~~O1~~ | ~~Windows named pipe 稳定性（R3）~~ | ✅ **S1 已解**：首次连接成功 |
| ~~O2~~ | ~~写后读回语义（R2）~~ | ✅ **S5 已解**：分层结论 |
| O3 | 上游破坏性变更的应对（R8） | 首次遇到时（不 fork 策略的既定代价） |
| ~~O4~~ | ~~是否需要第二个后端适配器（unity-cli）~~ | ✅ **不需要**；保留为理论降级选项 |
| ~~O7~~ | ~~构建出包无原生命令~~ | ✅ **S8 已解**：`-batchmode -executeMethod` |
| O8 | 是否用 Input System 项目验证 `simulate-keyboard`/`replay-input` | 用到时 |

### O5 决策：编辑器发现策略（三层 + 环境变量）`[已定]`

优先序（与 pi-cocos 的 `COCOS_CREATOR_BIN` 模式对齐）：

| 序 | 来源 | 实测值 |
|---|---|---|
| 1 | **环境变量覆盖** `PI_UNITY_EDITOR_BIN` | —（应急逃生口，最高优先） |
| 2 | **`%APPDATA%\TuanjieHub\secondaryInstallPath.json`** → 扫 `<root>/*/Editor/Tuanjie.exe` | `"D:\\devsoft\\unity\\unitySoft"` ✅ |
| 3 | **`%APPDATA%\TuanjieHub\hubInfo.json`** 的 `executablePath` → 推 Hub 目录 → `<hub>/Editor/*/Editor/Tuanjie.exe` | `D:\devsoft\unityHub\Tuanjie Hub\Tuanjie Hub.exe` ✅ |
| 4 | Unity 官方默认路径（为 Q2 兼容） | `C:\Program Files\Unity\Hub\Editor\*\Editor\Unity.exe` |
| 5 | 报错 + 指引（列出所有已尝试路径） | — |

**附带资源**（一旦拿到 Hub 配置根就能白拿）：

| 文件 | 价值 |
|---|---|
| `versionMapping.json` | editor 版本 ↔ Tuanjie 内部版本映射（`2022.3.62t9` ↔ `1.9.1`），可做版本校验 |
| `projectsArchitecture.json` | Hub 记录的已知项目（含新项目），可做项目发现 |
| `favoriteProjects.json` / `projectDir.json` | 最近/常用项目路径 |

> **不依赖 `uloop launch`**（U6：它只搜 Unity Hub 路径，团结上必失败）。连接侧不受影响。

### O6 决策：语言与窗口名 → **运行时枚举 + 缓存**`[已定]`

**首选方案（自配置，locale 无关）**：首次需要窗口名时，用 `execute-dynamic-code` 枚举：

```csharp
foreach (var w in Resources.FindObjectsOfTypeAll<EditorWindow>())
    // w.GetType().Name  → locale 无关（GameView / SceneView / ProjectBrowser）
    // w.titleContent.text → 本地化标题（游戏 / 场景 / 项目）
```

→ 建立 `类名 ↔ 本地化标题` 映射并缓存到 `.pi-unity/window-map.json`。

**为何不用静态映射**：`.dwlt` 布局文件里确实有 locale 无关类名（**已验证**：`GameView` / `SceneView` / `ProjectBrowser`），但它**不能告诉你哪些窗口当前开着**。

**回退**：`%APPDATA%\TuanjieHub\languageConfig.json` → `{"language":"zh_CN"}`（**已验证**），给一份默认映射。

**最优路径**：**PlayMode 下 `screenshot` 自动走 `rendering` 模式，完全绕开窗口名**（§6 已验证）→ 能用就用这条。

### O9 决策：构建目标 → **不硬编码，运行时枚举**`[已定]`

1. **不要求装 WebGL**。`build` 先枚举 `Editor/Data/PlaybackEngines/`（本机：Android / WeixinMiniGame / WindowsStandalone）
2. **默认目标 = `EditorUserBuildSettings.activeBuildTarget`**（项目配置值），**不硬编码 `web-mobile`**（pi-cocos 的参考流程恰好是 web，照抄必挂）
3. 目标不可用时**报错 + 给安装指引**，不静默切换
4. 文档中说明：**装了 WebGL 可获得更好的验证回路**（headless Chrome，与 pi-cocos 一致）；Windows standalone 需「启动 exe + 截桌面」而无法 serve+shot

### O10 决策：**要差异清单** → ✅ 已产出`[已定]`

产物：`pi-unity-spike/TUANJIE-DIVERGENCES.md`

理由：本项目**在团结上验证**（D6）却**声称兼容 Unity 官方**（Q2）。不逐条记录差异，SKILL / PITFALLS 的结论就会被**错误归属**。

已记录 **12 条差异**（D-1 ~ D-12），其中最高风险是：

> **D-11：团结的 EditorPrefs 注册表根是 `HKCU\Software\Unity\UnityEditor\...`（不是 Tuanjie）**
> → 同时装 Unity 官方版与团结时，**两者共享 EditorPrefs**，偏好/布局可能互相覆盖。
> → `doctor` 应主动检测同装并警告。

**维护约定**（已写入该文件 §D）：新增 PITFALLS 条目必须标注「是否已确认在 Unity 官方版同样成立」。

---

## 11. 证据索引

**本机**
- 引擎：`/d/devsoft/unity/unitySoft/2022.3.62t9/Editor/Tuanjie.exe`；`ProjectVersion.txt` = `2022.3.62t9` / `1.9.1`
- 团结桥：`codely.exe serve unity-mcp --help`；工具名由 `grep -a` 于 `codely.exe` 确认；包名 `cn.tuanjie.codely.bridge`
- Pi：`README.md:499`、`docs/usage.md:309`（版本 `0.85.1`）
- pi-cocos：`skills/cocos-game-dev/SKILL.md`（360 行）、`docs/PITFALLS.md`（623 行 / P1–P63）、`docs/DEV-WORKFLOW.md`；`editor-extension/` 4362 行、`lib/` 1671 行、`bin/cocos.js` 369 行

**上游（GitHub API / README，2026-09-18）**
- `hatayama/unity-cli-loop` 565★ MIT，Unity 2022.3+，仓库 154MB，**Go**（`cli/{common,dispatcher,project-runner,release-automation}`，`layout-contract.json` 定义双二进制）；包名 `io.github.hatayama.uloopmcp`；工具面见 §2.2；`.uloop/outputs/` 存运行产物
- `youngwoocho02/unity-cli` 311★ MIT，仓库 322KB，**Go**（`cmd/` `internal/` `unity-connector/`）；UPM `?path=unity-connector`；实例发现走 `~/.unity-cli/instances/*.json`
- `CoplayDev/unity-mcp` 14307★ MIT，Unity 2021.3→6.x，47 工具，**需 Python 3.10+ / uv**
- `isuzu-shiranui/UnityMCP` 319★ MIT，Unity 2022.3→Unity 6，Editor 自暴露 `/mcp`

**网络可达性实测（2026-09-18，三轮，超时 30s/25s）**

| 域名 | 结果 |
|---|---|
| `raw.githubusercontent.com` | ✅ 301 / 0.28s，三轮稳定 |
| `cdn.jsdelivr.net` | ✅ 301 / 0.72s，三轮稳定 |
| `codeload.github.com` | ✅ 200，0.67s 下完 87KB tarball |
| `registry.npmmirror.com` | ✅ 200 / 0.51s |
| `gitee.com` | ✅ 200 / 1.42s |
| `github.com` | ⚠️ 3 轮：2 次 30s 超时（000）、1 次 30s 后 200 |
| `package.openupm.com` | ❌ 3 轮全部 21s 超时（000） |
| `openupm.com` | ❌ TLS 立即重置（curl exit 35） |
