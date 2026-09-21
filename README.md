# pi-unity

让 Pi 端到端搭出**可交付**的 Unity / 团结引擎小游戏。

> **它是什么** —— 包在上游 MIT CLI [hatayama/unity-cli-loop](https://github.com/hatayama/unity-cli-loop) 之上的
> 一层**信封 CLI**。补的唯一语义是**写后主动读回**：把意图（intent）送进编辑器后**真的读回来比一次**，
> 给出 `verified: true/false`，让「画面真的变了 / 节点真的建了 / 包真的出来了」有可判定的证据，
> 而不是靠日志「看起来没问题」。
>
> **交付物** —— ① `unity` CLI（doctor / scene / node / sprite / shot / pixels / play / asset / prefab / exec / build …）
> ② skill `skills/unity-game-dev/SKILL.md`（照着它从空工程搭到能玩的打砖块）
> ③ 真机坑位库 `docs/PITFALLS.md`（U1–U55，逐条标注适用引擎）。
>
> **三步上手** —— `pi install <本仓库路径或 git URL>` → `/reload` → 对 Pi 说「用 Unity 做个打砖块」。
> 完整用法（前置条件 / 命令解剖 / 最小工作流 / 退出码 / 常见坑）见下面 **§ 怎么用**。

## 一句话架构

```
Pi ──> bin/unity.js（信封层，本仓库唯一自研代码）
         └─> uloop（上游 MIT，Unity CLI Loop）
               └─> Unity / 团结引擎编辑器
```

**不自研编辑器桥。** 上游 [hatayama/unity-cli-loop](https://github.com/hatayama/unity-cli-loop)（MIT）已提供
21 个 Unity 侧工具（编译/截图/输入模拟/动态 C# 执行/构建），我们只在外面包一层**信封 + 写后读回验证**。

## 为什么需要这一层

上游对**异常和编译错误是诚实的**（`Success:false` + 完整堆栈），但**不验证意图是否达成**：

```csharp
cam.fieldOfView = -100f;   // Unity 钳制为 1e-05
// → Result: "intent=-100 actual=1E-05",  Success: true
```

`Success: true` 只表示「你的代码执行了」，**不表示「你的意图达成了」**。
本仓库的信封层补的就是这个 `verified` 语义：**写后主动读回，比对 intent vs actual**。

## 怎么用

### 三种用法

| 用法 | 怎么开始 | 你会得到 |
|---|---|---|
| **① 在 Pi 里用**（主交付物） | `pi install <本仓库路径或 git URL>` 然后 `/reload` | skill **`unity-game-dev`** + 扩展命令 **`/unity-doctor`** / **`/unity-tree`**。之后直接说「用 Unity 做个打砖块」，Pi 会照 SKILL §3.5 配方逐条执行（建砖块阵列 → 挂 sprite → 截图 → PlayMode 验证 → 出包） |
| **② 当 CLI 单独用** | `node bin/unity.js <子命令>`；或 `npm link` 之后直接用 `unity <子命令>` | 就是下面「状态」里那张命令表——不装 Pi 也能用。扩展层找 CLI 的顺序：`PI_UNITY_CLI=<仓库>/bin/unity.js` → PATH 上的 `unity` |
| **③ 当操作手册读** | 直接读 `skills/unity-game-dev/SKILL.md` | 9 节可照做的流程：前置检查 / 铁律 / 黄金流程（§3.5 打砖块 · §3.6 美术 · §3.7 交付）/ 截图 / 停止条件 / 迭代上限 / 常见错误 → U 编号 / **§8 验证配方** / 构建出包 |

### 前置条件

| 需要 | 说明 |
|---|---|
| **Node.js ≥ 21** | 硬要求（原因见「环境要求」）。全部代码只用 `node:*`，**零第三方依赖** |
| **Unity / 团结引擎编辑器** | 已实测：团结 `2022.3.62t9`、Unity 官方中国版 `2022.3.62f3c1` / `2022.3.62f1c1` |
| **uloop**（上游 MIT） | 编辑器与 CLI 之间的桥。国内装不了 openupm，走 tarball vendor 路径（`docs/PITFALLS.md` U1） |
| **uloop 可执行文件路径** | 每条命令都要 `export PI_UNITY_ULOOP_BIN="…/uloop.exe"`（**新进程不继承**） |
| **一个能写坏的测试工程** | 别拿生产工程试手 |

### 一条命令长什么样

```
unity node set --project-path "$P" --path Brick --patch '{"position":{"x":0,"y":3,"z":0}}'
  │     │    │                     │          │        └─ 意图（intent）
  │     │    │                     │          └─ 作用对象
  │     │    │                     └─ 项目根（写/读编辑器状态的命令必需；缺了落 MISSING_PROJECT_PATH，退出码 2）
  │     │    └─ 动作
  │     └─ 资源（场景 / 节点 / 精灵 / 资产 / Prefab / 像素 / 构建 …）
  └─ 信封层（本仓库唯一自研代码，包在 uloop 之上）
```

**写命令的返回值里都有 `verified`**：`unity` 把 intent 送进编辑器后**主动读回**再和你要的比一次——
`true` = 意图达成、`false` = 没达成（附 `actual`），无 intent 的命令（纯读 / `exec`）恒为 `null`。

### 最小工作流（照抄可跑）

```bash
export PI_UNITY_ULOOP_BIN="C:/path/to/uloop-bin/uloop.exe"   # 每条命令都要带
P="C:/path/to/TestProject"

unity doctor --project-path "$P" --smoke      # 0 = 环境通（--smoke 会写临时节点再自删）
unity scene tree --project-path "$P"          # 先看清场景里有什么

unity node create --project-path "$P" --name Brick --components '["SpriteRenderer"]'
unity node set    --project-path "$P" --path Brick --patch '{"position":{"x":0,"y":3,"z":0}}'
unity node inspect --project-path "$P" --path Brick --json   # 想看细节/拿准字段名

unity sprite set  --project-path "$P" --path Brick --color '#FF2E88'
unity shot        --project-path "$P" --out "C:/path/to/shots"
unity pixels      --file "C:/path/to/shots/<最新>.png" --at 100,100 --expect '#FF2E88'

unity play view   --project-path "$P" --width 960 --height 640
unity play start  --project-path "$P" && unity play status --project-path "$P"
unity play logs   --project-path "$P" --log-type Error      # totalCount 应为 0
unity play stop   --project-path "$P"

unity build --project-path "$P" --target win64 --out "C:/path/to/build-out"
```

> ⚠️ **一次只发一条命令（含只读）**。并行调用会落 `UNITY_SERVER_BUSY`（uloop 单飞），
> 并行 `exec` 会落 `SCRIPT_COMPILE_ERROR: Another execution is already in progress` ——
> 两个码**都不指向真因**（`docs/PITFALLS.md` **U46** / **U49**）。

### 退出码

| 码 | 含义 |
|---|---|
| **0** | 成功**且** `verified !== false`（写了但不生效 → 不算成功） |
| **1** | 运行时失败 / 验证失败（`verified:false`）；**也包含**编译错、`DIRTY_SCENE`、`NOT_FOUND` 等有据可查的失败 |
| **2** | **用法错**——只由 argv 决定（缺参 / 类型不符 / 枚举外取值 / JSON 语法错），在任何写盘与调用**之前**收敛 |

三者由 `lib/envelope.js` 的 `exitCodeFor` **单点**判定；所以 `echo $?` 就是「这次到底成没成」的权威答案。

### 常见坑（详见 `docs/PITFALLS.md` U1–U55）

- **一次只发一条命令**（U46 / U49，见上）。
- **场景扩展名随引擎不同**：团结用 `.scene`，**Unity 官方版只认 `.unity`**（官方-1）。
- **`scene save` 的两种含义**：不给 `--path` = 把所有已打开场景**原地保存**；给了 `--path` = **Save-As**（别对验收场景用）。
- **`node create` 建出的裸节点只有 `Transform`** → Game 视图里不渲染任何东西，截不到图是**正常**的，用 `scene tree` / `node inspect` 交叉证明。

## 状态

### M2 已交付（2026-09-19）

**`unity` 命令面（M2 全量 + M3/M4 增量）**（信封层，写后读回验证）：

| 命令 | 类型 | 退出码 |
|---|---|---|
| `unity doctor [--smoke] [--golden] [--json]` | 只读检查 / **--smoke 与 --golden 会写临时节点** | 0 / 1 / 2 |
| `unity scene tree` | 读场景节点树 | 0 / 1 / 2 |
| `unity scene save [--path <Assets/…>]` | **写**（写后读回 `scene tree` 的 `sceneName`）；不给 `--path` 保存全部打开场景 | 0 且 `verified!==false` / 1 / 2 |
| `unity scene open --path <Assets/…> [--force]` | **写**（写后读回；dirty 且无 `--force` → `DIRTY_SCENE`） | 0 且 `verified!==false` / 1 / 2 |
| `unity node inspect --path <p> [--sibling-index <n>]` | 读单个节点（含 `sprite`/`components` 字段）；`--sibling-index` = 真实子序号（=`scene tree` 的 `siblingIndex`），唯一定位同父同名实例 | 0 / 1 / 2 |
| `unity node create --name <n> [--parent <p>] [--components <json>]` | **写**（写后读回） | 0 且 `verified!==false` / 1 / 2 |
| `unity node set --path <p> --patch <json>` | **写**（写后读回） | 0 且 `verified!==false` / 1 / 2 |
| `unity node delete --path <p>` | **写**（读回必须 NOT_FOUND） | 0 且 `verified!==false` / 1 / 2 |
| `unity sprite set --path <p> --color <#hex> [--sorting-order <n>]` | **写**（写后读回） | 0 且 `verified!==false` / 1 / 2 |
| `unity shot [--out <dir>] [--window-name <n>] [--capture-mode <m>] [--match-mode <m>]` | 读（截图） | 0 / 1 / 2 |
| `unity pixels --file <png> [--at x,y] [--region x,y,w,h] [--expect <hex>] [--count-color <hex>] [--diff <png>] [--centroid <hex>] [--bbox <hex>]` | 读（像素判定；`--diff`/`--centroid`/`--bbox` 让「画面变没变」有一等公民判据） | 0 / 1 / 2（`DIFF_SIZE_MISMATCH` 属 **2 档**用法错） |
| `unity play start\|stop\|pause\|step\|status\|click\|mouse\|key\|logs\|view …` | **写**（PlayMode）/ 读（logs） | 0 / 1 / 2 |
| `unity asset write --to <Assets/…> (--from <f>\|--template <n>) [--force]` | **写**（读回 sha256） | 0 且 `verified!==false` / 1 / 2 |
| `unity asset import --from <png> --to <Assets/…png> [--remove-bg …] [--trim] [--fit w,h] [--ppu n] [--force]` | **写**（读回 11 项导入设置 + 真实纹理尺寸 + 磁盘 sha256） | 0 且 `verified!==false` / 1 / 2 |
| `unity sprite assign --path <p> --asset <Assets/…png> [--world-size w,h]` | **写**（读回 `assetPath`/`worldSize`；`--world-size` 仅 `drawMode=Simple` 适用；节点只有 UI `Image` → `UI_IMAGE_PRESENT`） | 0 且 `verified!==false` / 1 / 2 |
| `unity prefab create --from-node <p> --to <Assets/…prefab> [--force]` | **写**（把资产内容读回来与源节点比对，含 `components`） | 0 且 `verified!==false` / 1 / 2 |
| `unity prefab instantiate --asset <Assets/…prefab> [--parent <p>] [--name <n>]` | **写**（先读资产拿真实根名/sprite，再 inspect 实例） | 0 且 `verified!==false` / 1 / 2 |
| `unity prefab apply --path <实例根>` | **写**（读回：实例投影 vs 资产投影，排除根 `localPosition`） | 0 且 `verified!==false` / 1 / 2 |
| `unity prefab revert --path <实例根>` | **写**（读回：`hasOverrides` 必须为 false） | 0 且 `verified!==false` / 1 / 2 |
| `unity compile` | 读（编译结果） | 0 无错 / 1 有编译错 / 2 |

**Skill**：`skills/unity-game-dev/SKILL.md`（9 节：前置检查 / 铁律 / 黄金流程（含 **§3.5 打砖块配方**、**§3.6 美术配方**、**§3.7 交付**）/
截图 / 停止条件 / 迭代上限 / 常见错误 → U 编号 / **验证配方** / 构建出包）。

**扩展命令（⑫）**：`pi-extension/index.ts` —— `/unity-doctor [项目根]`、`/unity-tree [项目根]`
（薄封装 `pi.exec` 调 CLI，零第三方依赖）。CLI 定位： `PI_UNITY_CLI=<仓库>/bin/unity.js` 或 PATH 上的 `unity`。

**包内模板**：`unity-scripts/templates/PiBrickBreaker.cs` —— 一个可编译的极简霓虹打砖块参考实现
（手写 AABB，不用 `Rigidbody2D`/`Collider2D`；`OnGUI` 画分数，不依赖字体资产 / TMP；
球自动发射 + 挡板默认自动跟随 —— 所以**不需要输入注入**就能证明「画面在变、分数在涨」；
`Start()` 里还有 `EnsureSprites()`：给缺 sprite 的渲染器补 1×1 白 sprite —— 因为
**EditMode 用 `unity sprite set` 挂的运行时 sprite 进 PlayMode 会被 domain reload 销毁**）。
装入项目：`unity asset write --to Assets/PiBrickBreaker/PiBrickBreaker.cs --template PiBrickBreaker`。

**测试**：`npm test` → **636/636 绿**（零依赖，`node --test "test/*.test.js"`）。
⚠️ **测试 glob 必须显式写全，且只能由 Node ≥21 的 `node --test` 自己展开**（R211）—— 三种退化要分清：
- **裸 `node --test`**（无参）会递归收 `test/` 全目录，把 `test/fixtures/fake-uloop.js` 这个 fixture
  当测试文件执行 —— M1「报 207、真实 206」即此成因（当时脚本正是裸 `node --test`）；
- **Node < 21 不展开 glob**：`test/*.test.js` 被当成字面路径 → `Could not find`（退出码 1；吵，但不假绿）；
- 真正危险的是**匹配到 0 个文件的 glob**（写错、测试被改名等）：Node ≥21 上得到 **0 条用例、退出码 0**
  的**静默全绿**。注意这条形态**只在 ≥21 上存在**（避开它靠 **glob 写对 + 用例计数核对**，不是引擎下限）；
  `engines >= 21` + 显式 glob 是为了避开「收错文件」并让 Node<21 响亮失败
  （Windows 的 npm 走 cmd.exe，**不展开 glob**，只能靠 Node 自己展开）。

**验证环境**：团结引擎 **2022.3.62t9**（Tuanjie Editor 1.9.1）+ **Unity 官方中国版 2022.3.62f3c1 / 2022.3.62f1c1** + uloop dispatcher **3.5.1** / 包 **3.6.3**（project-runner 3.4.0）。
**Unity 官方版已实测**（2022-09-20；⚠️ 只是**中国版**构建，国际版在本网络拿不到）：
`doctor` 5/5、`--smoke` 7/7、`--golden matched:true`、21 个工具全部可用、构建出 `UnityPlayer.dll` 且能跑。
**3 处硬差异**（场景扩展名、`shot` 窗口名、`doctor` 的 build-targets/language 取值）已写进
`docs/PITFALLS.md`「追加：Unity 官方版验证新坑」（官方-1…官方-8）+ `docs/UNITY-OFFICIAL-VERIFICATION.md`；
凡涉及版本/界面差异处，`docs/PITFALLS.md` 的 **U11 起逐条**标注适用引擎（U1–U10 多为引擎版本无关，**U7 / U9 / U10 例外**）。

**已验证的真实能力边界**（真机，非文档转述）：

- **写路径 `verified`**：`node create` / `node set` 真机 `[VERIFIED]`（`verified:true`）；
  反向验证用 `100000.123`（float32 ULP ≈ 0.0078 ≫ 容差 1e-4）→ `verified:false`。
  ⚠️ **不要用 `1e30`** —— float32 最短往返不产生 mismatch，会得到 `verified:true`（见 U15）。
- **截图**：Game 窗口真机 892x355；`ImagePath` 为唯一可信路径（输出目录会累积历史图）。
- **doctor**：5 项全 OK；`--smoke` 七项全 `pass`（3 只读 + 写-读回-删自闭环；M2 起 `--smoke` **不再只读**）；
  `--golden` 两轮结构投影 `matched:true`、清理 `cleanup.status:"ok"` —— 这也是 U11 的字段名真机对账。
- **窗口名本地化坑**：中文编辑器的 Inspector 标题是「**检查器**」（不是「属性」，U7 真机纠正）；
  6 个窗口的中文标题已实测并入表。映射是**双向**的（英文名→中文标题、中文标题→英文名），
  且本地化失配时 `unity shot` 会**自动用另一种形态重试一次**（`游戏 ↔ Game`）—— 这是为了「团结 + Unity 官方版共存」的机器：
  `language()` 可能取到团结的 `zh_CN`，而官方版（`Unity.exe`）界面是**英文**（PITFALLS 官方-2）。
  真机实测（官方 2022.3.62f3c1）：EditMode 下 `unity shot --window-name Game` → 退出码 0、`windowName:"Game"`、`retriedFrom:"游戏"`。
- **已知边界**：`node create` 建出的裸节点只有 `Transform`，**Game 视图里不渲染任何东西** ——
  截图看不到它是正常现象，用 `scene tree` / `node inspect` 交叉证明。
- **打砖块全链路真机跑通**（M2，960×640 + `orthographicSize=5`）：24 块砖按行上色（四行颜色各 **19584 px** > 0）
  后截图 `read` 目视确认（四行彩砖 + 青色挡板 + 白球 + 左上角 `SCORE/LIVES/BRICKS`）；
  `play logs` 有 `[BB] ready bricks=24`、5 秒内 5 条 `[BB] hit brick=`（score 0→5、bricks 24→19）；
  两次渲染图**逐像素差 25083 px**（球心 491→239 px、挡板中心 484→222 px）；
  像素公式实测命中（世界 `(-4.625,3)` → 像素 `(184,128)` = `#FF2E88`，偏差 0 px；砖块 102×32 px，容差 ±2 px）；
  `play logs --log-type Error` → `totalCount:0`；场景 md5 **未变**（**磁盘上的场景文件干净、只有内存中的未保存改动**时，`Play` 未观测到写盘；**真正 dirty 的场景是否会先静默保存未验证**，见 `docs/PITFALLS.md` **U26**）。
- **场景落盘 `scene save` / `scene open`（M3 真机）**：`scene save`（不给 `--path`）把内存里那 29 节点打砖块
  写进 `Assets/Scenes/SampleScene.scene` —— md5 `44ff180d…` → `5a08a69a…`、`grep -c "Brick_"` **0 → 24**、
  size 12009 → 68872 B；保存后 `scene tree` 仍 29 节点、`doctor --golden` 仍 `matched:true`。
  `scene open` 在活动场景 dirty 且无 `--force` 时落 `DIRTY_SCENE`（退出码 1、给两条出路），
  `--force` 才会丢弃未保存改动（真机验证：`inspect` 探针 → `NOT_FOUND`）。
  ⚠️ 真机同时暴露 **U27（高）**：动态代码的改动**不置 `isDirty`** → `EditorSceneManager.SaveOpenScenes()`
  **返回 true 却什么都不写**（修复前 `scene save` 因此假绿）。已改为逐场景 `SaveScene` + **核对文件 mtime 前进**
  （没前进 → `SAVE_FAILED`，退出码 1）——`verified:true` 现在背后有磁盘证据。
- **输入注入的边界**（U25）：S0Project 是 `activeInputHandler:0`（Old Input），`unity play key`/`mouse` 会
  **如实失败**（`INPUT_SYSTEM_UNAVAILABLE`）；`unity play click` 只对 ScreenSpaceOverlay + GraphicRaycaster
  的 uGUI 生效，**打不到 SpriteRenderer** —— 故模板用「球自动发射 + 挡板自动跟随」绕开输入注入。

**已交付（M3）**：① `unity exec`（动态 C# 执行，`--code-file` / `--code`，`verified` 恒 `null`，
编译错映射为 `SCRIPT_COMPILE_ERROR` 带 `file:line`）—— 关闭 M2 E2E 的 B1「报错误导」缺口；
② `unity scene save` / `unity scene open`（**写**命令，写后读回 `scene tree` 的 `sceneName`；
脏场景且无 `--force` → `DIRTY_SCENE`，**不静默丢改动**）—— 关闭 M2 E2E 的 **B2**「交付物无法落盘」：
真机验证时当场救下盲测项目里那份**重建但从未落盘**的 29 节点打砖块（`grep -c "Brick_"` 0 → 24+）；
③ `unity build`（构建出包 + **写后读回**产物）—— 关闭最后一个功能缺口「做出来了但发不出去」。
真机（S0Project，2026-09-19）：首次 **13s**、`verified:true`、**109.4 MB**、退出码 0；
`--target webgl`（本机未装）→ `BUILD_TARGET_UNAVAILABLE` + 退出码 1 + hint 列出可用目标
（`win64` / `android` / `weixin`），**不假装成功、不改打别的目标**；产物清单从**实际磁盘目录**读
（团结 `TuanjiePlayer.dll` / 官方 `UnityPlayer.dll` / `MonoBleedingEdge/` / `<productName>_Data/`，
主产物名取自 `Application.productName` —— **播放器 DLL 名随引擎不同，两边都不硬编码**）。
**E2E 盲测**（另一 agent 只读 skill 复现 demo）是 **M2 的任务 12：✅ 已完成（2026-09-19）** ——
四条判据（结构 / 画面 / 可动 / 纪律）全部通过，由独立子代理复核 + 回写后重跑确认，
原始记录与截图清单见 `docs/E2E-ACCEPTANCE-m2.md` §2。

> **包形态说明（R113）**：M1 没有 Pi extension，故 `package.json` 的 `pi` manifest **只声明 `skills`**，
> 不再保留指向不存在目录的 `pi.extensions`（避免死配置误导）。

### M0（Spike）已完成

S0–S8 全部实测通过，见 `docs/CAPABILITIES-tuanjie-2022.3.62t9.md`。

| 步 | 内容 | 结果 |
|---|---|---|
| S0 | 包安装 + 编译 | ✅ 44 asmdef → 44 DLL，0 error / 0 warning |
| S1 | CLI 连接编辑器 | ✅ 首次 15s 成功 |
| S2–S4 | 动态 C# / 编译 / 截图 | ✅ |
| S5 | 写后读回语义 | ✅ 分层结论（见上） |
| S6 | PlayMode + UI 点击闭环 | ✅ |
| S7 | 确定性 | ✅ 两次读回一致 |
| S8 | 构建出包 + 产物可运行 | ✅ 109.4 MB / 14.7s |

## 文档

| 文件 | 内容 |
|---|---|
| `docs/superpowers/specs/2026-09-18-pi-unity-design.md` | **设计规格**（决策 D1–D6 / O5–O10，风险 R1–R15） |
| `docs/CAPABILITIES-tuanjie-2022.3.62t9.md` | 实测能力面（信封结构 / 21 工具 / 坐标公式 / 构建） |
| `docs/PITFALLS.md` | 踩坑记录 **U1–U55**（**U11 起逐条标注适用引擎**；M2 收口定稿：新增条目 U16–U26；**M4 编号收口（任务 7）：`NEW-1`…`NEW-7` → U28–U34、本包 PNG 支持面 = U35、任务 3–6 真机发现 → U36–U45；**最终修复波（R475/R477）→ U46–U47；批次 A 真机验收（R475/R477 落地）→ U48–U49；批次 B-1（R480 实例定位 / R448 Prefab `components`）→ U50–U51；批次 B-2（R481 UI Image 假绿 / R482 drawMode=Tight/Sliced/Tiled 限制）→ U52–U53；批次 C-A（官方版复测 U28–U41 + 新坑 U54：场景未存时 `--force` 重置实例）→ U54；批次 C-B（`prefab apply`/`revert` 根 `localPosition` 豁免）→ U55**，克隆/`.meta` 交付结论单列 `### M4：…`（不抢 U 编号）**；索引表同稿补齐；文末另有「已知问题登记」—— 代码/测试类 Minor 只登记不改，交最终整分支审查）+ **「追加：Unity 官方版验证新坑」（官方-1…官方-8，暂不编号）** |
| `docs/UNITY-OFFICIAL-VERIFICATION.md` | **Unity 官方版兼容性验证**（9 项清单逐条实测 + Q2 结论 + 待改 SKILL 清单 S1–S10） |
| `docs/CAPABILITIES-unity-2022.3.62f3c1.md` | Unity 官方版实测能力面（含与团结的差异表） |
| `docs/TUANJIE-DIVERGENCES.md` | 团结 vs Unity 官方 12 条差异（**新增条目必须标注适用引擎**） |
| `docs/E2E-ACCEPTANCE-m2.md` | M2 盲测协议 + 四条判据的独立复核记录 + 截图清单 + 回写去向（盲测暴露问题的分类与登记） |
| `skills/unity-game-dev/SKILL.md` | **skill（M2 完整版）**：命令面 + 搭场景黄金流程 + **§3.5 打砖块配方** + **§8 验证配方** |

## 环境要求

- **Node.js ≥ 21**（**硬要求**）：`npm test` 依赖 `node --test` 对显式 glob `test/*.test.js` 的展开
  （Node 21 起支持；Windows 上 cmd.exe 不展开 glob，只能靠 Node 自己展开）。Node < 21 会把该 glob
  当字面路径（`Could not find`，退出码 1）；而匹配 0 个文件的 glob 在 Node ≥21 上会「0 条用例、退出码 0」
  静默全绿 —— 故下限不能降。实测环境 Node v22；`package.json` 的 `engines` 已声明该下限。
- **团结引擎 2022.3.62t9**，或 **Unity 官方 2022.3 LTS**（已实测：官方中国版 `2022.3.62f3c1` / `2022.3.62f1c1`；国际版未验证）
  ⚠️ **场景扩展名随引擎不同**：团结用 `.scene`，**官方版只认 `.unity`**（PITFALLS 官方-1）
- **uloop** dispatcher + Unity 侧包（安装见 `docs/CAPABILITIES-*.md` §1）
- 用法前先 `unity doctor`（见 skill §1）

> ⚠️ **`package.openupm.com` 在国内不可达** —— uloop 官方安装命令必失败。
> 走 codeload tarball vendor 路径，见 `docs/PITFALLS.md` U1。

## 开发

```bash
npm test          # node --test "test/*.test.js"
```

## 新会话接手

读完 **`docs/HANDOFF.md`** 就能接手（现状 / 已完成里程 / 下一步 M4 起手式 / 环境凭据 / 纪律与踩过的坑 / backlog / 账本索引）。
