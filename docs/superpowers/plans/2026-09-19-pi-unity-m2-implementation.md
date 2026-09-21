# pi-unity M2 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 `unity` CLI 补齐 M1 划出的五件事（`doctor --golden` / `--smoke` 写-读回-删自闭环 / `unity play` 试玩闭环 / `shot` 的 `--capture-mode`·`--match-mode` 接线 / 视觉闭环），并**用一次盲测证明「只靠 skill 就能搭出一个能跑能看见的小游戏」**。

**架构：** 不变——`bin/unity.js` 做参数解析与命令分发；`lib/` 每个模块单一职责；**所有** Unity 操作经 `lib/uloop.js` 调上游 uloop（MIT，不 fork）；`lib/readback.js` 仍是唯一自研价值（写后读回比对 intent vs actual）。M2 新增两类能力：①**可观测性**（`unity pixels` 解析 PNG 做像素判定 → 把「看图」从肉眼升级为退出码）；②**运行时闭环**（`unity sprite set` 挂运行时纯色 sprite、`unity asset write` + `unity compile` 把脚本写进项目、`unity play` 进/出 PlayMode 与模拟输入）。

**技术栈：** Node.js **≥ 21**（仅 `node:*` 内置模块 + `node --test`，**零第三方依赖**；M2 新增使用 `node:zlib` 解 PNG）；uloop dispatcher 3.5.1 + Unity 侧包 3.6.3；团结引擎 2022.3.62t9（兼容 Unity 官方 2022.3 LTS）。**`≥ 21` 是硬要求（R211）**：`npm test` 用 `node --test "test/*.test.js"` 的**显式 glob**，而该 glob 由 **Node ≥ 21 的 `--test` 自己展开**（Windows 的 npm 走 cmd.exe，**不展开 glob**）；没有它就退回「`node --test` 收全目录」，`test/fixtures/fake-uloop.js` 会被当测试文件执行 —— 那正是 M1「`npm test` 报 207、真实 206」的成因（任务 1 修，并写进 `package.json` 附近注释与 README）；

**规格：** `docs/superpowers/specs/2026-09-18-pi-unity-design.md`（§5 / §6.1 / §6.2 / §6.3 / §9 / §9.1 / §10）
**配套必读：** `docs/CAPABILITIES-tuanjie-2022.3.62t9.md`、`docs/PITFALLS.md`、`docs/TUANJIE-DIVERGENCES.md`、`skills/unity-game-dev/SKILL.md`

---

## 前提（M2 三项已确认决定 + 本计划自定的四项结论）

**用户已确认（逐字沿用，不得发挥）：**

1. **盲测游戏 = 极简霓虹打砖块**（与 pi-cocos M1-T11 同型）：近黑底 + 霓虹配色；砖块阵列 / 挡板 / 球 / 分数；2D。**不引入** SMB 素材或任何外部美术。
2. **美术 = 运行时生成纯色贴图**：用 `Sprite.Create` 在运行时造纯色 sprite（`SpriteRenderer`），盲测游戏全靠「纯色方块 + 正交摄像机」渲染。**不碰** `TextureImporter` / TMP / 外部图（那是 M4）。
3. **顺手清掉 M1 留下的「M2 必修」延后项**（清单见任务 1/2/10；出处 `.superpowers/sdd/2026-09-18-pi-unity-m1-implementation/progress.md` 的 R117–R120 与 80 条 `minor (deferred)`）。

**本计划自定的四个结论（依据已写在各处，含 vendor 出处；执行者不得推翻，除非真机证据推翻——那就按全局约束 17 如实登记）：**

4. **盲测项目 = 新建的专用项目 `C:/Users/<用户>/pi-unity-m2-blind`**（不用 `S0Project`）。依据：① 模板 tgz 就在编辑器里（`<引擎安装目录>/2022.3.62t9/Editor/Data/Resources/PackageManager/ProjectTemplates/cn.tuanjie.template.2d-7.0.4.tgz`），且它的 `ProjectData~/Assets/Scenes/SampleScene.scene` 与 `S0Project` 的**逐字节相同**（实测 `diff -q` → IDENTICAL），所以物理/视觉事实可平移；② `S0Project` 是 spike 的存档（带 `.uloop/outputs/` 数百个文件、S8 构建产物、`PiBuildScript.cs`），盲测要的是**干净起点**；③ 盲测项目允许被写坏（不碰用户真实工程）。模板场景实测事实：唯一对象 `Main Camera`，`orthographic: 1`、`orthographic size: 5`、位置 `(0,0,-10)`、`m_ClearFlags: 2`（SolidColor）、背景 `(0.192,0.302,0.475)`、`ProjectSettings.asset` 的 `m_ActiveColorSpace: 1`（**Linear**）、`activeInputHandler: 0`（**只有 legacy Input，没有 Input System**）、`ProjectSettings/ProjectVersion.txt` 在模板里不存在（首次打开时写）。
5. **「游戏脚本」用新命令 `unity asset write` 落盘 + `unity compile` 验证，不靠 `execute-dynamic-code` 定义 MonoBehaviour**。依据：① 动态代码里定义的 `MonoBehaviour` 属于动态程序集，**不能跨 PlayMode 的域重载存活**，而 `docs/PITFALLS.md` U8 已经实证「EditMode 加的东西进 PlayMode 会丢」；② `uloop compile` 的官方 skill 原文：*"even when files were edited outside the Editor, a plain `uloop compile` refreshes assets and runs every recompilation the changes require"*（`vendor/uloopmcp/Editor/FirstPartyTools/Compile/Skill/SKILL.md:30`），所以**不需要** `AssetDatabase.Refresh()` 片段；③ 真实 `.cs` 由 Unity 编译器检查，而 skill 内联 C# 不可编译（设计 §6.4 的第 2 条理由）。
6. **「画面里看得见」用像素判定，不靠肉眼**：新增 `unity pixels`（`node:zlib` 解 PNG，零依赖）。依据：M1 的四个真机截图实测是 `colorType=2 / bitDepth=8 / interlace=0`，滤镜类型实际出现 `1,2,4`（实测统计：`游戏_20260919_012315_061.png` 的 355 行滤镜为 `1,4,2,4,...`）——所以解码器必须实现 **滤镜 0–4 全部**，不是只实现 filter 0。已知像素事实（同一张图）：`(446,177)=[49,77,121]`（相机 SolidColor 背景）、`(1,1)=[60,60,60]`（Game 视图工具栏灰）、`(880,350)=[39,39,39]`、`colorCount(#31794D… 即 49,77,121, tol 0)=178356`、`region(400,150,100,50)` 平均 `[49,77,121]`。
7. **「打得动」的证据链 = 日志 + 运行态读回 + 像素差 + 输入路径如实声明**。依据：`simulate-keyboard` / `simulate-mouse-input`（真实注入）**要求 Input System**（`vendor/uloopmcp/Editor/FirstPartyTools/Common/InputSystem/InputSystemPackageRequirementMessage.cs:11-17` 的逐字消息；`SimulateKeyboardUseCase.cs:44-52` 的 `#if !ULOOP_HAS_INPUT_SYSTEM` 分支），而盲测项目 `activeInputHandler: 0` **没有** Input System；`simulate-mouse-ui` 的射线只遍历 **ScreenSpaceOverlay + GraphicRaycaster 的 uGUI**（`vendor/uloopmcp/Editor/FirstPartyTools/Common/MouseUi/UiRaycastHelper.cs:21-53`），**打不到 `SpriteRenderer`**。所以：**键盘/鼠标两路照 vendor 参数表接线，真机探测后按结果如实落 `INPUT_SYSTEM_UNAVAILABLE` + hint（绝不假装可用）**；盲测的「打得动」主证据改为「PlayMode 里球/砖/分数自己在变」+「两次截图像素不同」+「无 Error 日志」，并把「用 `execute-dynamic-code` 注入状态」这一步**显式声明为注入而非真实输入**。

---

## 全局约束

以下每条都来自规格，**每个任务的要求都隐含包含本节**：**1–14 逐字沿用 M1 计划**（出处 `docs/superpowers/plans/2026-09-18-pi-unity-m1-implementation.md` 的「全局约束」，**不合并任何条目**）；**15–26 为 M2 新增**（每条附一句出处/理由）。

> **为什么 1–14 必须逐字**：这批条目会被后续任务的子代理**逐字引用**（例如「全局约束 7」「全局约束 17」），任何改写或合并都会让引用失效；M2 特有的补充一律放 15–26。

1. **零第三方依赖** —— 只用 `node:*` 内置模块与 `node --test`。不要引入 puppeteer/axios/commander。（截图由 uloop 提供，不需要 headless 浏览器）
2. **uloop 输出分流**：**成功 → stdout；失败 → stderr**；退出码 **0 = 成功 / 1 = 失败**。
3. **uloop 输出可能含前置噪声行**（如 `uloop: downloading pinned project runner 3.4.0...`）→ **必须用 JSON 提取器，不能直接 `JSON.parse` 整个输出**。
4. **不 fork uloop、不改上游**；uloop 升级不得破坏信封契约。
5. **不硬编码 Unity 官方约定** —— 场景扩展名是 `.scene`（不是 `.unity`），YAML tag 是 `yousandi.cn`，产物是 `TuanjiePlayer.dll`。一律走 `EditorBuildSettings` / `AssetDatabase` / `report.summary`。见 `TUANJIE-DIVERGENCES.md`。
6. **`get-hierarchy` 不含任何属性值**（只有 name/isActive/components/tag/layer/children）→ **验证属性必须用 `execute-dynamic-code` 读回**。
7. **`Success: true` ≠ 意图达成**（实测：`fieldOfView = -100` 被钳制为 `1e-05` 仍报 `Success:true`）→ **所有写操作默认做 verified 读回**。
8. **C# 片段放 `unity-scripts/*.cs`**，用 `--code-file` 执行（不经 shell 引号）。
9. **传参用单 JSON 载荷**：`--parameters '{"p":"<序列化 JSON>"}'` → C# 读 `parameters["param0"]`，用 `Newtonsoft.Json.Linq` 解析（**已实测可用**）。
10. **不要遍历 `parameters`** —— uloop 会把代码里的字符串字面量驻留为 `__uloop_literal_*`。
11. **窗口名按界面语言**（中文编辑器是「游戏」）；能用 PlayMode 的 `rendering` 模式就优先用它（忽略窗口名）。
12. **新增 `docs/PITFALLS.md` 条目必须标注适用引擎**（团结实测 / 是否已确认 Unity 官方同样成立）。
13. **每个任务一个 commit**；`npm test` 必须保持全绿。
14. **不要按空格切分路径/命令** —— Windows 路径常含空格。测试注入用 `PI_UNITY_ULOOP_CMD`（JSON 数组）。

**M2 新增（15–26，每条附出处/理由）：**

15. **`verified` 的语义不许扩张**：只有「写后读回比对 intent vs actual」才置 `true/false`；读命令恒 `null`。新增命令若没有可比对的 intent（`pixels` / `play logs` / `compile` / `scene tree`），一律 `verified: null`，用 `ok` / `actual.match` 表达结论。（出处：M1 §6.1 写后读回铁律 + 本计划任务 4/7/8）
16. **退出码单点实现**：`lib/envelope.js` 的 `exitCodeFor(envelope)` 是**唯一**判定处（`2` = 用法错，`1` = 运行时/环境/验证错，`0` = 成功且 `verified !== false`）。各命令的 handler **不得**再手写 `e.ok ? 0 : 1`。（出处：M1 延后项⑨；本计划任务 2）
17. **真机优先、诚实声明**：凡只有真机能证明的（`.cs` 能否编译、`simulate-*` 是否可用、golden 是否真的确定、截图里能不能看见东西），必须作为该任务的「真机验证」步执行，并把**真实输出与退出码**写进报告；**无法真机验证的分支必须显式声明「未验证」**，不许用「应该可以」蒙混。（出处：规格 §6.3）
18. **跨语言真值必须成对并有 tripwire**：每个新增 `.cs` 与它的 JS 契约（载荷字段名、`__error` 码、回读字段名）必须有断言把两边钉在一起；新增 `.cs` 一律沿用单 JSON 载荷 + `__error` 哨兵。（出处：M1 R78/R89 + 规格 §10 D3）
19. **新增 CLI 命令必须登记 USAGE**：`bin/unity.js` 的 `USAGE` 里写清子动作、必填参数、退出码口径；「未接线」的开关必须显式写明（M1 的 `--match-mode` 就是这么写的，M2 接线后要删掉那句）。（出处：M1 R59/R97 的教训）
20. **真机验证不得污染**：临时节点必须删除并**读回确认**；任务不得保存场景（除非该任务明说）；盲测以外的真机步骤优先用 `S0Project`（spike 存档，可写坏），用户真实工程 `<真实工程>` **一律不许碰**。（出处：用户已确认决定③ + 规格 §6.3）
21. **测试计数纪律**：`npm test` 的真实用例数（排除 `test/fixtures/` 下被当测试执行的文件）**不得减少**；M2 起点是 **206 条真实用例**（`npm test` 报 207，多出来的 1 条是 `test/fixtures/fake-uloop.js` 被 `node --test` 当测试文件执行 —— 任务 1 会修掉）。（出处：M1 验收 206/206）
22. **像素/截图判据必须给「公式 + 实测值」**，不得只写「肉眼看图」；公式与实测偏移不一致时，以**实测值**为准并回写 PITFALLS。（出处：规格 §9.1 的 R112 口径修正段）
23. **M2 的 PNG 解码用 `node:zlib` 自己写**，不引入任何 PNG 库；只支持 bitDepth 8 / colorType 0,2,4,6 / 非交织 / 滤镜 0–4，不支持的一律响亮抛错（→ `BAD_PNG`）。（出处：约束 1 + 本计划前提 6 的实测）
24. **产物名按真机**：团结引擎的产物是 `TuanjiePlayer.dll`（不是 `UnityPlayer.dll`），不得硬编码（约束 5 的补充）。（出处：`docs/TUANJIE-DIVERGENCES.md`）
25. **`get-hierarchy` 的节点键含 `siblingIndex`**（真机实测：`name/isActive/components/siblingIndex/tag/layer/children`），它和 `tag`/`layer` 一样属于结构，丢弃会让「顺序变了」这类真实变异漏检。（出处：本计划任务 9 的实测节）
26. **`--parameters` 的 key 会被 uloop 丢弃，值按 key 排序位置化**；M2 的载荷只用一个 key `p`，故 C# 侧恒读 `parameters["param0"]`（约束 9/10 的机制说明）。（出处：M1 实测 + 本计划任务 3/5 的载荷断言）

---

## M2 新增接口总表（跨任务契约，逐字实现）

> 这张表是**唯一真值**。后续任务的函数名/签名/错误码/字段名必须与它逐字一致（自检第 3 条会查）。

### 命令与子动作（`bin/unity.js`）

| 命令 | 子动作/参数 | 落点模块 | 退出码 |
|---|---|---|---|
| `unity node delete` | `--path <p>` | `lib/scene.js` `nodeDelete` | `MISSING_PATH`=2；其余 0/1 |
| `unity sprite set` | `--path <p> --color <#hex> [--sorting-order <n>]` | `lib/sprite.js` `spriteSet` | `MISSING_PATH`/`BAD_COLOR`/`BAD_SORTING_ORDER`=2；其余 0/1 |
| `unity pixels` | `--file <png> [--at x,y] [--region x,y,w,h] [--expect <#hex>] [--tolerance <n>] [--count-color <#hex>]` | `lib/pixels.js` `pixels` | 用法错=2；读失败=1；`--expect` 不匹配=1 |
| `unity shot` | 新增 `--capture-mode <auto\|window\|rendering\|GameView>`、`--match-mode <exact\|prefix\|contains>` | `lib/shot.js` `shot` | 枚举外取值=2（`BAD_CAPTURE_MODE`/`BAD_MATCH_MODE`） |
| `unity play` | `start\|stop\|status\|pause\|step\|click\|mouse\|key\|logs\|view` | `lib/play.js` | 用法错=2；`INPUT_SYSTEM_UNAVAILABLE` 等=1 |
| `unity asset write` | `--to <Assets/…> (--from <本地文件> \| --template <名字>) [--force] [--no-compile]` | `lib/asset.js` `assetWrite` | 用法错=2；`ASSET_EXISTS`/`SOURCE_NOT_FOUND`/`COMPILE_FAILED`=1 |
| `unity compile` | `[--timeout-seconds <n>]` | `lib/asset.js` `compile` | 用法错=2；有编译错=1 |
| `unity doctor` | 新增 `--golden`；`--smoke` 改为**含写-读回-删** | `lib/doctor.js` | `--smoke`/`--golden` 同给=2；其余 0/1 |

### 库函数签名（逐字）

```js
// lib/color.js
parseHexColor(text) -> {r,g,b,a} | null      // 接受 '#RGB' / '#RRGGBB' / '#RRGGBBAA'，大小写无关，缺 # 返回 null
maxChannelDistance(a, b) -> number           // 三通道 |差值| 的最大值
formatHex({r,g,b}) -> string                 // '#RRGGBB'（大写）

// lib/png.js
decodePng(buf) -> {width, height, channels, data}   // data 是 RGBA8 的 Buffer；不支持时**抛** Error
pixelAt(img, x, y) -> {r,g,b,a}                     // 越界抛 RangeError
averageColor(img, {x, y, width, height}) -> {r,g,b,a}   // 四舍五入到整数；越界抛 RangeError
countColor(img, color, {tolerance}) -> number       // 逐通道 |diff| <= tolerance 的像素数

// lib/pixels.js
pixels({ file, at, region, expect, tolerance, countColor, _readFile }) -> envelope

// lib/sprite.js
spriteSet({ projectPath, env, path, color, sortingOrder, _call }) -> envelope

// lib/scene.js（新增）
nodeDelete({ projectPath, env, path, _call }) -> envelope
parseNodeResult(r, { path }) -> {parsed} | {envelope}   // 成功 {parsed}；NOT_FOUND 的 actual 带 {path}（R207）
// 导出新增：PATCH_KEYS、parseNodeResult

// lib/envelope.js（新增）
envelopeFromCall(r) -> envelope        // r.truncated === true → ULOOP_TRUNCATED；否则 fromUloop(r.json)
isUsageFailure(code) -> boolean
exitCodeFor(envelope) -> 0 | 1 | 2   // ok!==true → 2/1；verified===false → 1；actual.match===false → 1

// lib/shot.js（签名不变，actual 加字段）
shot({ projectPath, env, outDir, windowName, captureMode, matchMode, appData, _call }) -> envelope

// lib/play.js
playMode({ projectPath, env, action, timeoutSeconds, _call }) -> envelope   // action: 'Play'|'Stop'|'Pause'|'Step'|'Status'
playClick({ projectPath, env, action, x, y, fromX, fromY, button, duration, targetPath, bypassRaycast, _call }) -> envelope
playMouse({ projectPath, env, action, x, y, button, duration, deltaX, deltaY, scrollX, scrollY, dryRun, _call }) -> envelope
playKey({ projectPath, env, action, key, duration, _call }) -> envelope
playLogs({ projectPath, env, logType, maxCount, searchText, includeStackTrace, _call }) -> envelope
playView({ projectPath, env, width, height, _call }) -> envelope
isInputSystemMissing(message) -> boolean

// lib/asset.js
compile({ projectPath, env, timeoutSeconds, _call }) -> envelope
assetWrite({ projectPath, env, to, from, template, force, noCompile, timeoutSeconds, _call,
              _readSource, _writeFile, _readBack, _exists, _mkdirp }) -> envelope
resolveTemplate(name) -> string | null      // 包内 unity-scripts/templates/<name>.cs

// lib/golden.js
projectNode(node) -> object                        // {name, active, components, siblingIndex, tag, layer, children}
projectStructure(normalized) -> object             // {sceneName, nodeCount, roots}
firstDiff(a, b, path) -> {path, kind, a, b} | null // kind ∈ 'value'|'type'|'array-length'|'missing-left'|'missing-right'
formatDiff(diff) -> string
runGolden({ projectPath, env, _call }) -> {ok, matched, diff, cleanup, blocked, lines}

// lib/doctor.js（新增/改）
smoke({ env, projectPath, rootDir, runImpl, _call }) -> results[]   // 固定 7 项：3 只读 + 4 项 write-*
                                                                    // 顺序逐字：compile/get-logs/get-hierarchy/write-create/write-set/write-delete/write-clean
runGolden 经 doctor({json:true}) 输出 {ok, mode:'golden', matched, diff, cleanup, blocked, lines}
             // 注意：golden 的结果对象**不叫 checks**，也没有逐项 code；matched:null = 没比成
             // （blocked / 清理失败），diff:null = 两轮一致，diff:{path,kind,a,b} = 检出变异
             // 它**不产出**错误码：失败只能用 ok/matched/cleanup/blocked 与退出码表达（原表里的
             // GOLDEN_BLOCKED/GOLDEN_STEP_FAILED/GOLDEN_LEFTOVER/GOLDEN_MISMATCH 是死码，已删）
doctor --json（基础/冒烟）统一为 {ok, mode, checks}   // 逐项有 code（pass=null / skip='NOT_CONNECTED' / fail=具名码）
```

### 错误码（新增，逐字）

| 码 | 含义 | 退出码 |
|---|---|---|
| `ULOOP_TRUNCATED` | uloop 输出被截断（超时/被杀/管道未收尾），本次调用结果不可信 | 1（`retryable:true`） |
| `BAD_COLOR` | `--color`/`--count-color` 不是合法 `#RGB`/`#RRGGBB`/`#RRGGBBAA` | 2 |
| `BAD_SORTING_ORDER` | `--sorting-order` 不是整数 | 2 |
| `SPRITE_CREATE_FAILED` | `.cs` 造 `Texture2D`/`Sprite` 失败或 `AddComponent` 返回 null | 1 |
| `MISSING_FILE` | `unity pixels` 缺 `--file` | 2 |
| `FILE_NOT_FOUND` | `--file` 指向的 PNG 不存在/读不了 | 1 |
| `BAD_PNG` | PNG 签名/位深/色彩类型/交织方式不支持，或数据损坏 | 1 |
| `BAD_AT` / `BAD_REGION` | `--at x,y` / `--region x,y,w,h` 格式或范围非法 | 2 |
| `BAD_TOLERANCE` | `--tolerance` 不是非负整数 | 2 |
| `BAD_EXPECT` | `--expect` 给了值但**没有** `--at`/`--region`（无从比较）或值非法 | 2 |
| `BAD_CAPTURE_MODE` / `BAD_MATCH_MODE` | 枚举外取值 | 2 |
| `BAD_ACTION` | `unity play <动作>` 未知名，或 `--action` 取值不在该动作的枚举里 | 2 |
| `MISSING_KEY` | `play key` 的 `Press`/`KeyDown`/`KeyUp` 缺 `--key` | 2 |
| `BAD_COORD` | `play click`/`play mouse` 缺或非法的 `--x`/`--y`（含 `--from-x` 与 `--from-y` 不成对） | 2 |
| `BAD_TIMEOUT` | `--timeout-seconds` 非正整数 | 2 |
| `BAD_SIZE` | `play view` 只给 `--width`/`--height` 之一，或非正整数 | 2 |
| `INPUT_SYSTEM_UNAVAILABLE` | 上游报「requires the Input System package …」 | 1 |
| `MISSING_SOURCE` / `BAD_SOURCE` | `asset write` 的 `--from`/`--template` 都没给 / 同时给了 | 2 |
| `BAD_TARGET_PATH` | `--to` 不以 `Assets/` 开头，或含 `..` | 2 |
| `BAD_LOG_RESPONSE` | `get-logs` 响应缺 `TotalCount`/`Logs`（上游字段可能改名，缺字段即失败） | 1 |
| `TEMPLATE_NOT_FOUND` | `--template` 名字不在包内模板表 | 1 |
| `SOURCE_NOT_FOUND` | `--from` 指向的本地文件不存在 | 1 |
| `ASSET_EXISTS` | 目标已存在且未给 `--force` | 1 |
| `ASSET_WRITE_FAILED` | 写盘失败 | 1 |
| `COMPILE_FAILED` | `CompileResponse.ErrorCount > 0`（`actual.errors` 带结构化条目） | 1 |
| `BAD_COMPILE_RESPONSE` | `compile` 响应缺 `ErrorCount`/`WarningCount` 或 `Success` 既非 true 也非 false（`Success:null` 防御分支：**生产不可达**，除非上游改回 null，见任务 8 的 R209 标注） | 1 |

`USAGE_FAILURE_CODES`（`lib/envelope.js` 里冻结的 `Set`，逐字）：

> ⚠️ **已被 R221 取代，见实现**：`lib/envelope.js:67-84` 导出的是**冻结数组** `USAGE_FAILURE_CODES` + 私有 `Set` + `isUsageFailure()`（`Object.freeze(new Set())` 是假冻结，`.add()` 仍能放宽白名单，见 R221）。下面的码名清单仍逐字有效，**写法以实现为准**。

```
MISSING_NAME MISSING_PATH MISSING_PATCH MISSING_KEY MISSING_FILE MISSING_SOURCE MISSING_TO
BAD_COMPONENTS BAD_PARENT BAD_PATCH BAD_COLOR BAD_SORTING_ORDER BAD_WINDOW_NAME BAD_OUT_DIR
BAD_CAPTURE_MODE BAD_MATCH_MODE BAD_AT BAD_REGION BAD_EXPECT BAD_TOLERANCE BAD_ACTION BAD_COORD BAD_TIMEOUT
BAD_SIZE BAD_SOURCE BAD_TARGET_PATH EMPTY_PATCH UNKNOWN_PATCH_KEY
```

---

## 文件结构

| 文件 | 职责 | M2 变化 |
|---|---|---|
| `bin/unity.js` | CLI 入口：argv 解析、命令表、错误兜底、退出码（改用 `exitCodeFor`） | 改 |
| `lib/exec.js` | 子进程执行封装（可注入、带超时）—— 唯一 spawn 的地方 | 不变 |
| `lib/uloop.js` | uloop 后端：定位 dispatcher、调用、分流、JSON 提取、`truncated` 信号 | 不变 |
| `lib/envelope.js` | 信封 + `fromUloop` + `envelopeFromCall` + `exitCodeFor` + `isUsageFailure` | 改 |
| `lib/editor-discovery.js` | O5 编辑器发现 | 不变 |
| `lib/readback.js` | **核心**：写后读回比对 `intent` vs `actual` | 改（仅 JSDoc 收窄） |
| `lib/color.js` | **新**：`#hex` ↔ `{r,g,b,a}`、通道距离 | 新 |
| `lib/png.js` | **新**：PNG 解码（`node:zlib`，滤镜 0–4，colorType 0/2/4/6，bitDepth 8，非交织） | 新 |
| `lib/pixels.js` | **新**：`unity pixels` —— 采样/区域平均/颜色计数/`--expect` 判定 | 新 |
| `lib/sprite.js` | **新**：`unity sprite set` —— 运行时纯色 sprite + 写后读回 | 新 |
| `lib/play.js` | **新**：`unity play` —— PlayMode 进/出/步进 + UI/键鼠输入 + 日志 + Game 视图尺寸 | 新 |
| `lib/asset.js` | **新**：`unity asset write` + `unity compile` | 新 |
| `lib/golden.js` | **新**：`doctor --golden`（两轮 + 结构投影 + 首个分歧路径 + 可信清理） | 新 |
| `lib/doctor.js` | `doctor` 基础检查 + `--smoke`（**含写-读回-删**）+ `--golden` 接线 + `--json` 契约统一 | 改 |
| `lib/scene.js` | 场景读（tree）与节点读写（inspect/create/set/**delete**）；`PATCH_KEYS` 导出 | 改 |
| `lib/shot.js` | 截图 + O6 窗口名映射 + **`--capture-mode`/`--match-mode` 接线 + 坐标元数据** | 改 |
| `lib/args.js` | `--key value` / `--flag` / JSON 值解析 | 不变 |
| `unity-scripts/node-inspect.cs` | 读节点（新增 `sprite` 字段） | 改 |
| `unity-scripts/node-create.cs` | 建节点 | 不变 |
| `unity-scripts/node-set.cs` | 改节点 | 不变（被 tripwire 测试钉住） |
| `unity-scripts/node-delete.cs` | **新**：删节点 | 新 |
| `unity-scripts/sprite-set.cs` | **新**：运行时纯色 sprite + SpriteRenderer 兜底创建 | 新 |
| `unity-scripts/templates/PiBrickBreaker.cs` | **新**：打砖块参考实现（`unity asset write --template PiBrickBreaker` 的来源） | 新 |
| `skills/unity-game-dev/SKILL.md` | 面向 Pi 的工作流铁律 + **打砖块配方** | 改（M2 完整版） |
| `test/*.test.js` | `node --test` 单测（全部用假 uloop / 注入缝，不依赖编辑器） | 改/新 |
| `test/fixtures/unity-gameview-892x355.png` | **新**：真实 Unity 截图 fixture（`unity pixels` 的真值来源） | 新 |
| `docs/PITFALLS.md` | 坑位（M2 新增条目**只追加到文件末尾、不写 U 编号**；编号与索引表统一由任务 13 定稿，逐条标适用引擎） | 改 |
| `docs/E2E-ACCEPTANCE-m2.md` | **新**：盲测执行协议 + 执行记录（对标 pi-cocos `E2E-ACCEPTANCE.md`） | 新 |
| `docs/superpowers/specs/2026-09-18-pi-unity-design.md` | 规格（§9.1 偏差表补齐） | 改 |
| `README.md` | 状态与命令面 | 改 |

> **测试策略**：所有单测用**假 uloop / 注入缝**（`_call`、`runImpl`、`rootDir`、`appDir`、`_readFile`）驱动，**不依赖编辑器、不依赖真实进程、不依赖 `uloop-bin/` 是否存在**。真机验证单列为每个任务的一步。

---

## 任务 1：M2 必修批 A —— 死码、重复与措辞（机械）

**文件：**
- 修改：`lib/envelope.js`（新增 `envelopeFromCall`）
- 修改：`lib/readback.js`（JSDoc 收窄；导出 `isPlainObject`）
- 修改：`lib/scene.js`（删 `isPlainPatch`，改用 `isPlainObject`；3 处 hint 的 `Sprite` → `SpriteRenderer`；改用 `envelopeFromCall`）
- 修改：`lib/doctor.js`（`describeFailure` + `standaloneFailure` 合并为 `failureText`）
- 修改：`lib/shot.js`（改用 `envelopeFromCall`）
- 修改：`package.json`（`engines` + 明确的测试 glob）
- 测试：`test/envelope.test.js`、`test/readback.test.js`、`test/scene.test.js`

**决策与依据（照此实现，不要另找方案）：**
- **延后项⑤（`ULOOP_TRUNCATED` 无产出点 / `call().truncated` 无消费方）**：不改 `lib/uloop.js`（它已正确算出 `truncated`），而是在 `lib/envelope.js` 增加 `envelopeFromCall(r)`，并把 `lib/scene.js`/`lib/shot.js` 里所有 `fromUloop(r.json)` 换成 `envelopeFromCall(r)`。这样「截断」与「压根没 JSON」在信封层可区分，`RETRYABLE_CODES` 的 `ULOOP_TRUNCATED` 有了真实产出点。
- **延后项⑥（`describeFailure` / `standaloneFailure` 双份）**：合并为一个 `failureText(r, {standalone})`。**输出字符串必须逐字不变**（既有断言靠它）。
- **延后项⑦（`isPlainPatch` / `isPlainObject` 重复）**：删掉 `lib/scene.js` 的 `isPlainPatch`，从 `lib/readback.js` 导入 `isPlainObject`（两者语义完全一致：非 null、typeof object、非数组、原型为 `Object.prototype` 或 `null`）。
- **延后项⑧（`package.json` 缺 `engines`）**：加 `"engines": {"node": ">=21"}`（**必须是 21，不是 18** —— R211：`npm test` 的显式 glob 由 **Node ≥21 的 `--test` 自己展开**，Windows 的 npm 走 cmd.exe 不展开 glob；写 `>=18` 等于在 Node 18/20 上静默回到「`node --test` 收全目录」）。顺带修 `npm test` 把 `test/fixtures/fake-uloop.js` 当测试执行的问题（M2 起点 `npm test` 报 207，其中 1 条是这个 fixture；改成明确的 glob 后，真实用例数与 `node --test "test/*.test.js"` 一致）。**理由必须同时写进 `package.json` 附近的注释与 `README.md`**（见下方 Package.json 块后的说明）：
- **延后项①（`lib/readback.js` JSDoc 绝对措辞，R120①）**：只改注释、不改代码，把「`verified:true` 只可能来自真实比对」收窄为「**顶层**空 intent / 非普通对象 intent 的零约束不算通过」。
- **延后项②（`lib/scene.js` 三处 hint 的 `Sprite` 范例，R120②）**：改成 `SpriteRenderer`（真机 `Sprite` 落 `NOT_A_COMPONENT`，见 U13）。

- [ ] **步骤 1：编写失败的测试**

追加到 `test/envelope.test.js` 末尾（把 `envelopeFromCall` 加进文件顶部那条 `require('../lib/envelope.js')` 的 import）：

```js
// ─────────────────── M2 任务 1：envelopeFromCall（截断感知的唯一入口）───────────────────

test('envelopeFromCall：truncated 产出 ULOOP_TRUNCATED（可重试 + 带诊断 actual）', () => {
  const e = envelopeFromCall({
    code: 0,
    stdout: '{"Success":true}',
    stderr: '',
    timedOut: false,
    drained: true,
    json: null,
    truncated: true,
    tool: 'compile',
    args: ['compile'],
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
  assert.strictEqual(e.retryable, true, '截断是瞬时故障，retryable 必须为 true');
  assert.strictEqual(e.phase, 'transport');
  assert.strictEqual(e.actual.tool, 'compile');
  assert.strictEqual(e.actual.drained, true);
  assert.strictEqual(e.actual.timedOut, false);
  assert.ok(e.hint.length > 0);
});

test('envelopeFromCall：truncated 为 true 时即使 json 非空也不采信（call 契约的兜底）', () => {
  const e = envelopeFromCall({
    code: 0, json: { Success: true }, truncated: true, timedOut: false, drained: true,
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
});

test('envelopeFromCall：未截断时逐字等价于 fromUloop', () => {
  const json = { Success: true, Result: 'x' };
  const e = envelopeFromCall({
    code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false,
    tool: 't', args: [],
  });
  assert.deepStrictEqual(e, fromUloop(json));
});

test('envelopeFromCall：truncated 为 false 但 json 为 null → ULOOP_NO_JSON（与截断区分开）', () => {
  const e = envelopeFromCall({ code: 0, json: null, truncated: false, timedOut: false, drained: false });
  assert.strictEqual(e.code, 'ULOOP_NO_JSON');
  assert.notStrictEqual(e.code, 'ULOOP_TRUNCATED');
});
```

追加到 `test/readback.test.js` 末尾：

```js
// ─────────────────── M2 任务 1：isPlainObject 成为跨模块唯一真值 ───────────────────

test('isPlainObject 对普通对象/空原型对象为真，对 Date/Map/数组/标量为假（scene.js 复用同一实现）', () => {
  const { isPlainObject } = require('../lib/readback.js');
  assert.strictEqual(isPlainObject({}), true);
  assert.strictEqual(isPlainObject({ a: 1 }), true);
  assert.strictEqual(isPlainObject(Object.create(null)), true);
  assert.strictEqual(isPlainObject([]), false);
  assert.strictEqual(isPlainObject(new Date()), false);
  assert.strictEqual(isPlainObject(new Map()), false);
  assert.strictEqual(isPlainObject(null), false);
  assert.strictEqual(isPlainObject(1), false);
  assert.strictEqual(isPlainObject('x'), false);
});
```

追加到 `test/scene.test.js` 末尾：

```js
test('nodeSet 的 patch 守卫仍认「普通对象」：类实例 / Date 一律 MISSING_PATCH（isPlainPatch 删除后行为不变）', async () => {
  const spy = [];
  for (const bad of [new Date(), new (class { constructor() { this.active = true; } })()]) {
    const e = await nodeSet({ projectPath: 'X', path: 'B', patch: bad, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'MISSING_PATCH');
  }
  assert.strictEqual(spy.length, 0, '守卫必须在发起任何调用之前挡下');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/envelope.test.js test/readback.test.js test/scene.test.js`
预期：FAIL —— `envelopeFromCall is not a function`（envelope 4 条）、`isPlainObject` 为 `undefined`（readback 1 条）；scene 那条**应当已经 PASS**（它守的是「重构不改变行为」，属回归网）。

- [ ] **步骤 3：编写最少实现代码**

`lib/envelope.js`：在 `fromUloop` 之后、`emit` 之前插入，并把 `envelopeFromCall` 加进 `module.exports`：

```js
/**
 * 把 `call()` 的返回值映射成信封 —— **唯一**的截断感知入口（M2 任务 1，M1 延后项⑤）。
 *
 * 为什么必须有这一层：`lib/uloop.js` 已经算出 `truncated`（`timedOut || spawnError || drained`），
 * 且契约保证「`truncated === true` 时 `json` 必为 null」。但 M1 的调用点全都直接 `fromUloop(r.json)`，
 * 于是「输出被截断」与「压根没拿到 JSON」都落成 `ULOOP_NO_JSON`，诊断差异被抹平，
 * `RETRYABLE_CODES` 里的 `ULOOP_TRUNCATED` 成了没有任何产出点的死码。
 *
 * ⚠️ 残缺输出里的 JSON 片段可能是**看起来合法**的错值（`{"Success":true,"Items":[{"id":1},` 能解析出 `{"id":1}`），
 * 所以这里**只看 `truncated`，不看 `json` 是否非空**；调用方也**不得**自行重解析 stdout/stderr。
 *
 * @param {object} r `lib/uloop.js` 的 `call()` 返回值
 * @returns {object} 信封
 */
function envelopeFromCall(r) {
  if (r && r.truncated === true) {
    return fail({
      code: 'ULOOP_TRUNCATED',
      message: 'uloop 输出被截断（超时被杀 / dispatcher 未起来 / 管道未收尾），本次调用结果不可信',
      actual: {
        tool: r.tool ?? null,
        args: Array.isArray(r.args) ? r.args : null,
        code: r.code,
        timedOut: Boolean(r.timedOut),
        drained: Boolean(r.drained),
        spawnError: r.spawnError ? String(r.spawnError.message || r.spawnError) : null,
      },
      hint: [
        '按失败处理：残缺输出里的 JSON 片段可能是错值，不要自行重解析 stdout/stderr',
        '确认编辑器已打开目标项目（用 `unity doctor` 查看环境）',
        '可限次重试（≤3 次 + 退避）；重试前先读本 hint 排除终态原因（dispatcher 路径错、项目没打开）',
      ],
      phase: 'transport',
    });
  }
  return fromUloop(r ? r.json : null);
}
```

`lib/readback.js`：

1. `module.exports` 改成 `module.exports = { compareSubset, verifyWrite, isPlainObject };`
2. 文件头 JSDoc 里「**返回空列表 ≠ 验证通过**」那一段，替换为下面这段（**只改注释**）：

```
 * **返回空列表 ≠ 验证通过**：空列表只表示「intent 里没有可比对的字段」
 * （例如 `compareSubset({}, anything)`）。判定通过**必须看 `verifyWrite` 的 `verified`**
 * —— 它是唯一的判定入口，而**顶层空 intent**（`{}`）与**非普通对象 intent**
 * 都直接落 `verified:false` + 一条 `<root>` 分歧。
 * 所以严格的说法是：**`verified:true` 来自逐字段比对通过，而不是来自零次比对**；
 * 但**叶级**空对象（`{a:{}}` vs `{a:{}}`）仍属「确实没有约束」——该叶不产分歧，
 * 因此整条 intent 的比对次数可能为 0 却仍 `verified:true`（R120① 已收窄为「顶层」口径，
 * 不再声称「`verified:true` 只可能来自真实比对」）。
```

`lib/scene.js`：

```js
const { verifyWrite, isPlainObject } = require('./readback.js');
const { ok, fromUloop, fail, RETRYABLE_CODES, envelopeFromCall } = require('./envelope.js');
```

- 删掉 `isPlainPatch` 整个函数（含其 JSDoc）；它唯一的调用点改成 `if (!isPlainObject(patch)) {`（其余不变，仍落 `MISSING_PATCH`）。
- 三处 hint 的 `（如 Sprite / Rigidbody）` 改成 `（如 SpriteRenderer / Rigidbody）`（`lib/scene.js:526` / `:597` / `:605` 附近，共 3 处）。
- 把 `sceneTree` / `nodeInspect` / `nodeCreate` / `nodeSet` 里 5 处 `fromUloop(w.json)` / `fromUloop(r.json)` 全部换成 `envelopeFromCall(w)` / `envelopeFromCall(r)`（`fromUloop` 仍被 `envelopeFromCall` 内部使用，import 保留）。

`lib/shot.js`：`fromUloop(r.json)` → `envelopeFromCall(r)`（import 同步改）。

`lib/doctor.js`：删掉 `describeFailure` 与 `standaloneFailure` 两个函数，替换为一个：

```js
/**
 * 产出失败描述（R43 / F1 / M2 任务 1 合并）。
 *
 * 两种形态共用同一套分流（**这正是合并的目的**：改「截断」措辞或分流规则时不可能只改一处）：
 * - `standalone: false`（默认）—— 能拼在「无法连接」之后的**中缀片段**（`：<msg>（退出码 N）`）；
 * - `standalone: true` —— **整句**，供 per-tool 冒烟用：自带主语「工具报告失败：」，
 *   且 `code === 0` 时**不拼**「退出码 0」（那不含信息量，正是 R42 要消灭的退化）。
 *
 * spawnError 分支两种形态输出相同：它已有准确的「无法启动 dispatcher」措辞。
 * `timedOut || drained` 才说「输出被截断，可重试」。
 */
function failureText(r, { standalone = false } = {}) {
  if (r.spawnError) return `无法启动 dispatcher：${r.spawnError.message}（退出码 ${r.code}）`;
  const detail = r.json && r.json.Error && r.json.Error.Message;
  const cut = r.timedOut || r.drained ? '；输出被截断，可重试' : '';
  if (!standalone) {
    const base = detail ? `：${detail}（退出码 ${r.code}）` : `（退出码 ${r.code}）`;
    return `${base}${cut}`;
  }
  const code = r.code === 0 ? '' : `（退出码 ${r.code}）`;
  const base = detail ? `工具报告失败：${detail}${code}` : `工具报告失败且未给出原因${code}`;
  return `${base}${cut}`;
}
```

把 `doctor.js` 里 `describeFailure(` 的调用改成 `failureText(`，`standaloneFailure(` 的调用改成 `failureText(..., { standalone: true })`（共 4 处调用点）。

`package.json`：

```json
  "engines": {
    "node": ">=21"
  },
  "scripts": {
    "test": "node --test \"test/*.test.js\""
  },
```

> **为什么 `>=21` 不能降成 `>=18`（R211）**：`test/*.test.js` 这个**显式 glob** 由 **Node ≥21 的 `node --test` 自己展开**（Node 21 起 `--test` 支持 glob 参数）。Node 18/20 不展开 glob，`node --test "test/*.test.js"` 会被当成一个字面文件名；Windows 的 npm 走 `cmd.exe`，**shell 也不展开 glob**，所以实际会静默退化成「收 `test/` 全目录」→ `test/fixtures/fake-uloop.js` 被当测试文件执行（M1 的「报 207、真实 206」成因）。
> **目标状态**：`package.json` 顶部加一行注释说明这个取舍（`engines` 与 npm 无关，真正卡关的是 `node --test` 的 glob 展开能力）；`README.md` 的「环境要求」段写「Node.js ≥ 21（`npm test` 依赖 `node --test` 的 glob 展开；Windows 上 cmd.exe 不展开 glob）」。**本计划不改 `package.json`/`README.md` —— 它们是任务 1 的实现内容。**

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test`
预期：PASS。本任务新增 **6 条**用例（envelope 4 + readback 1 + scene 1），且 fixture 不再被当测试执行 → 总数应为 **212**。若实际数字不同，**以实际为准并记进报告**（只增不减：不得让任何既有用例消失）。
再运行：`node --test test/envelope.test.js test/readback.test.js test/scene.test.js` → PASS。

- [ ] **步骤 5：Commit**

```bash
git add lib/envelope.js lib/readback.js lib/scene.js lib/shot.js lib/doctor.js package.json \
        test/envelope.test.js test/readback.test.js test/scene.test.js
git commit -m "refactor(m2): 清 M1 必修批 A（ULOOP_TRUNCATED 产出点/isPlainObject 单一真值/failureText 合并/JSDoc 收窄/SpriteRenderer 范例/engines）"
```

---

## 任务 2：跨语言真值 tripwire + 退出码边界统一（判断）

**文件：**
- 修改：`lib/envelope.js`（`USAGE_FAILURE_CODES` / `isUsageFailure` / `exitCodeFor`）
- 修改：`lib/scene.js`（导出 `PATCH_KEYS`）
- 修改：`bin/unity.js`（所有 handler 改用 `exitCodeFor`；USAGE 补退出码口径）
- 修改：`skills/unity-game-dev/SKILL.md`（退出码口径）
- 测试：`test/envelope.test.js`、`test/scene.test.js`、`test/shot.test.js`

**决策与依据：**
- **延后项③（`PATCH_KEYS` 与 `node-set.cs` 跨语言两份真值）**：加 tripwire 断言把两边钉死（正向：4 个键都在 `.cs` 里被读；反向：`.cs` 不得读白名单外的 `patch["X"]`）。实测：`node-set.cs` 里 `patch["…"]` 只出现 `name`(×4) / `active`(×3) / `position`(×2) / `scale`(×2)，所以反向断言可写死。
- **延后项⑨（退出码 2 与 1 的边界不一致）**：定为**一条规则**并单点实现——
  **`2` = 用法错**（argv 形状/取值非法，命令根本没被有意义地执行）；**`1` = 运行时/环境/验证错**（含 `verified:false`）。
  这条规则把 M1 的 `--out` 裸写（旧 1）与 `--patch` 语法错（旧 2）拉齐到同一侧，因此**必须同步改既有断言与文档**。`lib/envelope.js` 的 `exitCodeFor` 是唯一判定处（全局约束 16）。

- [ ] **步骤 1：编写失败的测试**

追加到 `test/envelope.test.js`（把 `USAGE_FAILURE_CODES`、`exitCodeFor` 加进 import）：

```js
// ─────────────────── M2 任务 2：退出码单点判定 ───────────────────

test('exitCodeFor：成功且未写后读回 → 0；写后 verified:true → 0', () => {
  assert.strictEqual(exitCodeFor(ok({ a: 1 })), 0);
  assert.strictEqual(exitCodeFor(ok({ a: 1 }, { verified: true })), 0);
});

test('exitCodeFor：写后 verified:false → 1（铁律：意图未达成就是失败）', () => {
  const e = { ...ok({ a: 1 }), verified: false };
  assert.strictEqual(exitCodeFor(e), 1);
});

test('exitCodeFor：用法错 → 2；运行时错 → 1', () => {
  assert.strictEqual(exitCodeFor(fail({ code: 'MISSING_PATCH', message: 'x' })), 2);
  assert.strictEqual(exitCodeFor(fail({ code: 'BAD_OUT_DIR', message: 'x' })), 2);
  assert.strictEqual(exitCodeFor(fail({ code: 'EMPTY_PATCH', message: 'x' })), 2);
  assert.strictEqual(exitCodeFor(fail({ code: 'UNKNOWN_PATCH_KEY', message: 'x' })), 2);
  // 运行时错一律 1：它们不是「用法」问题
  for (const code of ['ULOOP_NO_JSON', 'ULOOP_TRUNCATED', 'READBACK_FAILED', 'WRITE_CALL_FAILED',
    'BAD_SCRIPT_RESULT', 'BAD_HIERARCHY', 'NOT_FOUND', 'ULOOP_BAD_PAYLOAD', 'COMPILE_FAILED']) {
    assert.strictEqual(exitCodeFor(fail({ code, message: 'x' })), 1, `${code} 应为 1`);
  }
});

test('exitCodeFor：读命令的 actual.match === false → 1（`pixels --expect` 的判定字段）', () => {
  assert.strictEqual(exitCodeFor(ok({ match: false })), 1);
  assert.strictEqual(exitCodeFor(ok({ match: true })), 0);
  assert.strictEqual(exitCodeFor(ok({ match: null })), 0);
  assert.strictEqual(exitCodeFor(ok({})), 0, '没有 match 字段的读命令不受影响');
});

test('exitCodeFor：未知错误码保守判 1（新码不会静默变成用法错）', () => {
  assert.strictEqual(exitCodeFor(fail({ code: 'TOTALLY_NEW_CODE', message: 'x' })), 1);
  assert.strictEqual(exitCodeFor(fail({ message: 'x' })), 1);
  assert.strictEqual(exitCodeFor(undefined), 1);
});

// ⚠️ 已被 R221 取代，见实现：`USAGE_FAILURE_CODES` 是**冻结数组**（不是 `Set`），
// 这里用 `[...USAGE_FAILURE_CODES]` 展开仍然成立；「冻结」的真断言见 `test/envelope.test.js`。
test('USAGE_FAILURE_CODES 是冻结集合，且成员恰好是这批（新增用法错码必须同时改这里）', () => {
  assert.deepStrictEqual([...USAGE_FAILURE_CODES].sort(), [
    'BAD_ACTION', 'BAD_AT', 'BAD_CAPTURE_MODE', 'BAD_COLOR', 'BAD_COMPONENTS', 'BAD_COORD',
    'BAD_EXPECT', 'BAD_MATCH_MODE', 'BAD_OUT_DIR', 'BAD_PARENT', 'BAD_PATCH', 'BAD_REGION',
    'BAD_SIZE', 'BAD_SORTING_ORDER', 'BAD_SOURCE', 'BAD_TARGET_PATH', 'BAD_TIMEOUT', 'BAD_TOLERANCE',
    'BAD_WINDOW_NAME', 'EMPTY_PATCH', 'MISSING_FILE', 'MISSING_KEY', 'MISSING_NAME',
    'MISSING_PATCH', 'MISSING_PATH', 'MISSING_SOURCE', 'MISSING_TO', 'UNKNOWN_PATCH_KEY',
  ]);
});
```

追加到 `test/scene.test.js`（顶部 import 加 `PATCH_KEYS`）：

```js
// ─────────────────── M2 任务 2：PATCH_KEYS ↔ node-set.cs tripwire ───────────────────

test('跨语言真值 tripwire：PATCH_KEYS 与 node-set.cs 的 patch 字段逐字一致（M1 延后项③）', () => {
  assert.deepStrictEqual([...PATCH_KEYS], ['name', 'active', 'position', 'scale']);
  const src = fs.readFileSync(path.join(__dirname, '..', 'unity-scripts', 'node-set.cs'), 'utf8');
  for (const k of PATCH_KEYS) {
    assert.match(src, new RegExp(`patch\["${k}"\]`), `node-set.cs 必须读 patch["${k}"]`);
  }
  // 反向：`.cs` 读白名单外的 patch 字段会绕过 JS 的 UNKNOWN_PATCH_KEY 守卫并造成假绿
  const reads = [...new Set([...src.matchAll(/patch\["([^"]+)"\]/g)].map((m) => m[1]))];
  assert.deepStrictEqual(reads.filter((k) => !PATCH_KEYS.includes(k)), [], 'node-set.cs 读了白名单外的 patch 字段');
  // USAGE 必须把 4 个键写在用户看得到的地方（新增键时漏改 USAGE = 文档与实现脱节）
  const usage = fs.readFileSync(path.join(__dirname, '..', 'bin', 'unity.js'), 'utf8');
  for (const k of PATCH_KEYS) assert.ok(usage.includes(k), `bin/unity.js 的 USAGE 必须提到 ${k}`);
});

test('退出码边界：用法错 2 / 运行时错 1（M1 延后项⑨，CLI 端到端）', async () => {
  const { exitCodeFor } = require('../lib/envelope.js');
  // 缺 --patch（值缺失）= 用法错
  const miss = await withFakeDispatcher(
    { Success: true, Result: '{}' },
    () => captureStdout(() => main(['node', 'set', '--project-path', 'X', '--path', 'B', '--json'])),
  );
  assert.strictEqual(miss.result, 2);
  assert.strictEqual(JSON.parse(miss.out).code, 'MISSING_PATCH');
  assert.strictEqual(exitCodeFor(JSON.parse(miss.out)), 2);
  // 目标不存在（运行时）= 1
  const notFound = await withFakeDispatcher(
    { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) },
    () => captureStdout(() => main(['node', 'inspect', '--project-path', 'X', '--path', 'Nope', '--json'])),
  );
  assert.strictEqual(notFound.result, 1);
});
```

把既有断言按新规则改掉（**这就是本任务的行为变更**）：
- `test/scene.test.js`：`'CLI node inspect 缺 --path → 1 且 code=MISSING_PATH'` → 标题的 `1` 改 `2`，`assert.strictEqual(result, 1)` → `2`；
- `test/scene.test.js`：`'CLI node set 缺 --patch → 退出码 1 且 code=MISSING_PATCH'` → 标题的 `1` 改 `2`，断言 → `2`；
- `test/shot.test.js`：`'CLI shot 裸写 --window-name → 退出码 1 且 code=BAD_WINDOW_NAME'` → `2`；
- `test/shot.test.js`：`'CLI shot 裸写 --out → 退出码 1 且 code=BAD_OUT_DIR'` → `2`。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/envelope.test.js test/scene.test.js test/shot.test.js`
预期：FAIL —— `exitCodeFor is not a function`（4 条）、`USAGE_FAILURE_CODES` 为 `undefined`（1 条）、`PATCH_KEYS` 为 `undefined`（tripwire 1 条）；两条旧 CLI 断言在 CLI 端仍返回 1 而期望 2。

- [ ] **步骤 3：编写最少实现代码**

`lib/envelope.js`：在 `RETRYABLE_CODES` 之后插入，并把这三个名字加进 `module.exports`：

```js
/**
 * 用法错错误码（退出码 **2**）：argv 形状/取值非法，命令根本没被有意义地执行。
 *
 * 边界规则（M1 延后项⑨，M2 定案）：
 *   - **2 = 用法错** —— 参数缺失 / 类型不符 / 枚举外取值 / JSON 语法错（JSON 语法错在 `bin/unity.js` 里
 *     直接返回 2，不经信封）；
 *   - **1 = 运行时 / 环境 / 验证错** —— 编辑器没连上、节点不存在、读回不一致（`verified:false`）、编译不过。
 *
 * ⚠️ **刻意不使用 `MISSING_`/`BAD_` 前缀规则**：`BAD_SCRIPT_RESULT`（脚本返回非 JSON）与
 * `BAD_HIERARCHY`（上游形状变了）都是**运行时**错，前缀规则会把它们误判成用法错。
 * 新增用法错码时**必须同时改这个集合与 `test/envelope.test.js` 的冻结断言**。
 */
// ⚠️ 已被 R221 取代，见实现：实际是 `const USAGE_FAILURE_CODES = Object.freeze([...]);
// + 私有 `const USAGE_SET = new Set(USAGE_FAILURE_CODES);`，`isUsageFailure()` 走 `USAGE_SET.has`。
const USAGE_FAILURE_CODES = new Set([
  'MISSING_NAME', 'MISSING_PATH', 'MISSING_PATCH', 'MISSING_KEY', 'MISSING_FILE',
  'MISSING_SOURCE', 'MISSING_TO',
  'BAD_COMPONENTS', 'BAD_PARENT', 'BAD_PATCH', 'BAD_COLOR', 'BAD_SORTING_ORDER',
  'BAD_WINDOW_NAME', 'BAD_OUT_DIR', 'BAD_CAPTURE_MODE', 'BAD_MATCH_MODE',
  'BAD_AT', 'BAD_REGION', 'BAD_EXPECT', 'BAD_TOLERANCE', 'BAD_ACTION', 'BAD_COORD', 'BAD_TIMEOUT',
  'BAD_SIZE', 'BAD_SOURCE', 'BAD_TARGET_PATH',
  'EMPTY_PATCH', 'UNKNOWN_PATCH_KEY',
]);

/** 该错误码是否属于「用法错」（未知码保守判 false → 退出码 1，方向安全）。 */
function isUsageFailure(code) {
  return typeof code === 'string' && USAGE_FAILURE_CODES.has(code);
}

/**
 * 信封 → 进程退出码。**本项目唯一的退出码判定处**（全局约束 16）：
 * 各命令 handler 不得再手写 `e.ok ? 0 : 1`，否则「2 与 1 的边界」会再次漂移。
 *
 * `0` = 成功且 `verified !== false`；`1` = 运行时/环境/验证错（含 `verified:false`、`actual.match === false`）；`2` = 用法错。
 * `actual.match` 是**读命令的判定字段**（`unity pixels --expect` 用），它和 `verified` 一样只由
 * 命令自己置位；没有 `match` 字段的读命令不受影响。
 */
function exitCodeFor(envelope) {
  if (!envelope || envelope.ok !== true) return isUsageFailure(envelope && envelope.code) ? 2 : 1;
  if (envelope.verified === false) return 1;
  if (envelope.actual && envelope.actual.match === false) return 1;
  return 0;
}
```

`lib/scene.js`：`module.exports` 的对象里加 `PATCH_KEYS`。

`bin/unity.js`（R203：**不改顶层导入面**，沿用 M1「handler 体内局部 require」风格）：

1. 在已局部 `require` 信封的各 handler（`scene` / `node` / `shot`）里，把那一行改成
   `const { emit, exitCodeFor } = require('../lib/envelope.js');`；`node` 的 `inspect` / `create|set` 分支复用同一个局部绑定。
   **不要**在文件顶部新增 `const { exitCodeFor } = require(...)` —— M1 的 `bin/unity.js` 顶层只有 `pkg`（见文件头），新增顶层导入会让后续任务（T4/T5/T7/T8）误以为顶层可用。
2. 每个命令 handler 的返回改成 `return exitCodeFor(e);`：
   - `scene`：`return exitCodeFor(e);`
   - `node` 的 `inspect` 分支：`return exitCodeFor(e);`
   - `node` 的 `create`/`set` 分支：删掉 `return e.ok && e.verified !== false ? 0 : 1;`，改成 `return exitCodeFor(e);`，并把上方 R85 注释改成「退出码统一由 `exitCodeFor` 判定（2=用法错 / 1=运行时错 / 0=成功）」；
   - `shot`：`return exitCodeFor(e);`
3. `USAGE` 末尾（示例之前）插入：

```
退出码：
  0  成功（写命令另有约束：verified !== false）
  1  运行时/环境/验证失败（编辑器未连接、节点不存在、读回不一致 verified:false、编译不过）
  2  用法错（参数缺失/类型不符/枚举外取值/JSON 语法错）
  3  内部错误（本包 bug，请上报复现步骤）
```

`skills/unity-game-dev/SKILL.md`：把「M1 已交付的命令」表里每条命令的「退出码」列改成 `0 / 1 / 2`（写命令保留「0 且 `verified!==false` / 1 / 2」），并把那段引用块改成：

```
> **退出码口径**：上表是**命令执行结果**。另有：
> **2 = 用法错**（参数缺失 / 类型不符 / 枚举外取值 / JSON 语法错 —— `--patch` 语法错、`--patch` 缺值或裸写、
> `--out` / `--window-name` 裸写都属此类）；**3 = 内部错误**（本包 bug，应上报复现步骤）。
> **1 = 运行时/环境/验证失败**（编辑器未连接、节点不存在、`verified:false`、编译不过）。
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test`
预期：PASS。本任务新增 **8 条**（envelope 6 + scene 2）→ 总数应为 **220**；以实际运行为准并记进报告。

- [ ] **步骤 5：Commit**

```bash
git add lib/envelope.js lib/scene.js bin/unity.js skills/unity-game-dev/SKILL.md \
        test/envelope.test.js test/scene.test.js test/shot.test.js
git commit -m "feat(cli): 退出码单点判定（2=用法错/1=运行时错）+ PATCH_KEYS 跨语言 tripwire"
```

---

## 任务 3：`unity node delete`（集成）

**文件：**
- 创建：`unity-scripts/node-delete.cs`
- 修改：`lib/scene.js`（新增 `nodeDelete` + 导出）
- 修改：`bin/unity.js`（`node delete` 子动作 + USAGE）
- 测试：`test/scene.test.js`

**为什么需要它**：`doctor --smoke` 的「写-读回-删自闭环」（任务 10）与 `doctor --golden` 的可信清理（任务 9）都要求能删节点；M1 没有删节点命令，skill 只能让用户手工删。

**契约（逐字）：**
- 载荷：`{"path":"Canvas/Btn"}` → `.cs` 返回 `{"__deleted":true,"path":"<被删节点的实际路径>"}`，或 `{"__error":"NOT_FOUND"}` / `{"__error":"BAD_REQUEST"}`。
- JS 侧读回判据：写完之后 `nodeInspect(实际路径)` 必须落 `NOT_FOUND` → `verified:true`；若读回 `ok:true`（节点还在）→ `ok:true` + `verified:false` + 一条 `{key:'path', intent:null, actual:'<path>'}` 分歧；其它读回失败 → `READBACK_FAILED`（`phase:'readback'`）。
- `DestroyImmediate` 会连带删子节点（Unity 语义）——写进 `.cs` 注释与 skill 的停止条件。

- [ ] **步骤 1：编写失败的测试**

在 `test/scene.test.js` 顶部 import 里加 `nodeDelete`、`PATCH_KEYS`，并在 `fakeCall` 之后加一个便捷函数：

```js
/** 只取信封的退出码（复用生产实现，避免测试自己复述规则）。 */
function exitCodeOf(envelope) {
  return require('../lib/envelope.js').exitCodeFor(envelope);
}
```

追加到 `test/scene.test.js` 末尾：

```js
// ─────────────────── M2 任务 3：node delete（写后读回：消失才算成功）───────────────────

test('nodeDelete 缺 --path / 裸 --path → MISSING_PATH，不发起写（沿用 R69）', async () => {
  for (const p of [undefined, '', true]) {
    const spy = [];
    const e = await nodeDelete({ projectPath: 'X', path: p, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'MISSING_PATH');
    assert.strictEqual(spy.length, 0);
  }
});

test('nodeDelete 成功：写 → 读回 NOT_FOUND → verified:true，actual 带实际路径', async () => {
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __deleted: true, path: 'Canvas/Btn' }) },
    { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) },
  ], spy);
  const e = await nodeDelete({ projectPath: 'X', path: 'Btn', _call: call });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(e.actual, { path: 'Canvas/Btn', deleted: true });
  assert.deepStrictEqual(e.mismatches, []);
  assert.strictEqual(spy[0].tool, 'execute-dynamic-code');
  assert.strictEqual(spy[1].tool, 'execute-dynamic-code');
  assert.strictEqual(JSON.parse(JSON.parse(spy[0].args[3]).p).path, 'Btn');
  assert.strictEqual(JSON.parse(JSON.parse(spy[1].args[3]).p).path, 'Canvas/Btn', '读回必须用 .cs 回报的实际路径');
});

test('nodeDelete 节点不存在 → NOT_FOUND（退出码 1，不是用法错）', async () => {
  const e = await nodeDelete({
    projectPath: 'X', path: 'Nope',
    _call: fakeCall({ Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'NOT_FOUND');
  assert.deepStrictEqual(e.actual, { path: 'Nope' });
  assert.strictEqual(exitCodeOf(e), 1);
});

test('nodeDelete 读回发现节点还在 → verified:false + 一条分歧（绝不假绿）', async () => {
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __deleted: true, path: 'B' }) },
    { Success: true, Result: JSON.stringify({ name: 'B', active: true, path: 'B', components: ['Transform'], position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }) },
  ]);
  const e = await nodeDelete({ projectPath: 'X', path: 'B', _call: call });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'path');
  assert.strictEqual(e.mismatches[0].actual, 'B');
});

test('nodeDelete 写调用 reject → WRITE_CALL_FAILED（不冒成退出码 3）', async () => {
  const e = await nodeDelete({
    projectPath: 'X', path: 'B',
    _call: async () => { throw new Error('boom'); },
  });
  assert.strictEqual(e.code, 'WRITE_CALL_FAILED');
  assert.match(e.message, /boom/);
});

test('nodeDelete 读回阶段抛异常 → READBACK_FAILED（保留「可能已删」的提示）', async () => {
  let n = 0;
  const e = await nodeDelete({
    projectPath: 'X', path: 'B',
    _call: async () => {
      n++;
      if (n === 1) return { code: 0, json: { Success: true, Result: JSON.stringify({ __deleted: true, path: 'B' }) }, truncated: false, tool: 'execute-dynamic-code', args: [] };
      throw new Error('read blew up');
    },
  });
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.strictEqual(e.phase, 'readback');
  assert.ok(e.hint.some((h) => /scene tree/.test(h)));
});

test('CLI node delete 成功 → 退出码 0；缺 --path → 2（M2 退出码边界）', async () => {
  const okRun = await withScriptedDispatcher(
    [
      "const args = process.argv.slice(2).join(' ');",
      "const json = args.includes('node-delete')",
      "  ? { Success: true, Result: JSON.stringify({ __deleted: true, path: 'B' }) }",
      "  : { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) };",
      "process.stdout.write(JSON.stringify(json) + '\n');",
    ].join('\n'),
    () => captureStdout(() => main(['node', 'delete', '--project-path', 'X', '--path', 'B', '--json'])),
  );
  assert.strictEqual(okRun.result, 0);
  assert.strictEqual(JSON.parse(okRun.out).verified, true);

  const bad = await captureStdout(() => main(['node', 'delete', '--project-path', 'X', '--json']));
  assert.strictEqual(bad.result, 2);
  assert.strictEqual(JSON.parse(bad.out).code, 'MISSING_PATH');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/scene.test.js`
预期：FAIL —— `nodeDelete is not a function`（7 条）。

- [ ] **步骤 3：编写最少实现代码**

```csharp
// unity-scripts/node-delete.cs
// 入参：parameters["param0"] = {"path":"Canvas/Btn"}
// 出参：JSON —— 成功 {"__deleted":true,"path":"<被删节点的实际路径>"}；失败 {"__error":"NOT_FOUND"|"BAD_REQUEST"}
// ⚠️ 本脚本**不做验证**：删完之后「节点真的不在了」由 lib/scene.js 的 nodeDelete 读回确认。
// ⚠️ Unity 语义：DestroyImmediate 会**连带删掉整个子树**；skill §5 的停止条件要求删之前先问用户。
// 回读为什么用「实际路径」：调用方可能给裸名（只匹配根对象），读回必须用同一个路径，
// 否则会出现「删了 A 却去查 B」的假红。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var p = (string)req["path"];
if (string.IsNullOrEmpty(p)) return "{\"__error\":\"BAD_REQUEST\"}";

// R80/R82 同源：GameObject.Find **找不到非激活对象**，回退遍历当前激活场景的全部根对象（含 inactive）。
GameObject go = GameObject.Find(p);
if (go == null)
{
    string[] segs = p.Split('/');
    foreach (GameObject root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
    {
        GameObject hit = FindByPath(root.transform, segs, 0);
        if (hit != null) { go = hit; break; }
    }
}
if (go == null) return "{\"__error\":\"NOT_FOUND\"}";

var pathSegs = new System.Collections.Generic.List<string>();
for (Transform cur = go.transform; cur != null; cur = cur.parent) pathSegs.Insert(0, cur.name);

var o = new Newtonsoft.Json.Linq.JObject();
o["__deleted"] = true;
o["path"] = string.Join("/", pathSegs);
UnityEngine.Object.DestroyImmediate(go);
return o.ToString(Newtonsoft.Json.Formatting.None);

// 同 node-inspect.cs：递归按 <name>/<name> 查找，**不检查 activeSelf**（这正是能命中非激活节点的原因）。
// ⚠️ 本函数**不能加 static**：uloop 会把字面量提升成外层局部变量，静态局部函数引用会编译失败 CS8421。
GameObject FindByPath(Transform t, string[] segs, int i)
{
    if (t.name != segs[i]) return null;
    if (i == segs.Length - 1) return t.gameObject;
    for (int k = 0; k < t.childCount; k++)
    {
        GameObject hit = FindByPath(t.GetChild(k), segs, i + 1);
        if (hit != null) return hit;
    }
    return null;
}
```

`lib/scene.js` 在 `nodeSet` 之后追加：

```js
/**
 * `unity node delete`：删节点 + **写后读回**（「消失」才是成功）。
 *
 * 与 `nodeCreate`/`nodeSet` 不同，删除没有「读回一个对象」可比对 —— 判据是**读回必须落 `NOT_FOUND`**：
 *   - 写调用 reject → `WRITE_CALL_FAILED`（复用 R95 的收敛方式）；
 *   - `.cs` 报 `__error` → 直接按码失败（`NOT_FOUND` 是运行时错，退出码 1）；
 *   - 读回 `ok:true`（节点还在）→ `ok:true` + `verified:false` + 一条分歧（**不许静默假绿**）；
 *   - 读回 `NOT_FOUND` → `verified:true`；
 *   - 读回落在别的失败码（如 `ULOOP_NO_JSON`）→ `READBACK_FAILED`（删除结果未知，提示复核）。
 *
 * 读回路径用 `.cs` 回报的**实际路径**（`parsed.path`），不是调用方给的入参 —— 入参可能是裸名。
 * `DestroyImmediate` 连带删子节点；skill §5 要求删之前先问用户，本函数不做交互。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, path?: string, _call?: typeof call}} [opts]
 * @returns {Promise<object>} 信封
 */
async function nodeDelete({ projectPath, env, path: nodePath, _call } = {}) {
  if (typeof nodePath !== 'string' || nodePath === '') {
    return fail({
      code: 'MISSING_PATH',
      message: '缺少 --path（形如 Canvas/Btn）',
      actual: { path: nodePath },
      hint: ['用 `unity scene tree` 取可用路径'],
    });
  }
  const callFn = _call || call;
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('node-delete', { path: nodePath }), { projectPath, env });
  } catch (err) {
    return fail({
      code: 'WRITE_CALL_FAILED',
      message: `node-delete 写调用失败：${(err && err.message) || String(err)}`,
      intent: { path: nodePath, absent: true },
      hint: [
        '删除是否生效未知；用 `unity scene tree` 复核',
        '确认编辑器已打开目标项目（用 `unity doctor` 查看环境）',
      ],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  if (!envl.ok) return envl;
  const res = parseScriptResult(w, {
    label: 'node-delete',
    describeError: (code, parsed) => {
      if (code === 'NOT_FOUND') {
        return {
          message: `节点不存在：${nodePath}`,
          actual: { path: nodePath },
          hint: [
            '用 `unity scene tree` 查看可用路径',
            '仅查当前激活场景（含 inactive 节点）；其它场景/DontDestroyOnLoad 里的节点会报 NOT_FOUND',
          ],
        };
      }
      return { message: `node-delete 返回错误：${code}`, actual: parsed, hint: ['检查 unity-scripts/node-delete.cs 的返回协议'] };
    },
  });
  if (res.envelope) return res.envelope;

  const deletedPath = typeof res.parsed.path === 'string' && res.parsed.path !== '' ? res.parsed.path : nodePath;
  const intent = { path: deletedPath, absent: true };

  let read;
  try {
    read = await nodeInspect({ projectPath, env, path: deletedPath, _call: callFn });
  } catch (err) {
    return fail({
      code: 'READBACK_FAILED',
      message: `删除后读回失败：${(err && err.message) || String(err)}`,
      intent,
      hint: ['删除可能已生效；用 `unity scene tree` 复核'],
      phase: 'readback',
    });
  }
  if (read.ok) {
    // 节点还在 → 删除没生效（或删的是同名的另一个）。不假绿、也不抛。
    return {
      ...ok(read.actual, {
        verified: false,
        intent,
        hint: ['删除后节点仍在（verified:false）——不要继续叠加后续命令，先用 `unity scene tree` 复核'],
      }),
      mismatches: [{ key: 'path', intent: null, actual: deletedPath }],
    };
  }
  if (read.code === 'NOT_FOUND') {
    return ok({ path: deletedPath, deleted: true }, { verified: true });
  }
  return fail({
    code: 'READBACK_FAILED',
    message: `删除后读回结果不确定（${read.code}）：${read.message}`,
    intent,
    actual: read.actual,
    hint: [...(Array.isArray(read.hint) ? read.hint : []), '删除是否生效未知；用 `unity scene tree` 复核'],
    phase: 'readback',
  });
}
```

`lib/scene.js` 的 `module.exports` 加 `nodeDelete`。

`bin/unity.js` 的 `node` 分支加一条（放在 `inspect` 之后、`create|set` 之前）：

```js
    if (action === 'delete') {
      const { nodeDelete } = require('../lib/scene.js');
      const e = await nodeDelete({ projectPath: args['project-path'], path: args.path });
      emit(e, { json: Boolean(args.json) });
      return exitCodeFor(e);
    }
```

`USAGE` 的 `node` 段加：

```
  node delete --path <p> 删节点（**连同子树**；写后读回：读回必须 NOT_FOUND 才算 verified）
                         ⚠️ 不可逆：删之前先用 `unity scene tree` 确认，并按 skill §5 先问用户
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/scene.test.js` → PASS（新增 7 条）。
运行：`npm test` → PASS（本任务新增 7 条 → 总数应为 227；以实际为准）。

- [ ] **步骤 5：真机验证（必做）**

在 `S0Project`（spike 存档，可写坏）上跑，**把每条命令的真实输出与退出码贴进报告**：

```bash
P=C:/Users/<用户>/pi-unity-spike/S0Project
md5sum "$P/Assets/Scenes/SampleScene.scene" > /tmp/before.md5        # 证明「不保存场景」
node bin/unity.js doctor --project-path $P                            # 退出码 0 才继续
node bin/unity.js node create --project-path $P --name __pi_del_probe
node bin/unity.js node delete --project-path $P --path __pi_del_probe
node bin/unity.js node inspect --project-path $P --path __pi_del_probe ; echo "exit=$?"
node bin/unity.js node delete --project-path $P --path __pi_del_probe ; echo "exit=$?"
node bin/unity.js scene tree --project-path $P --json | grep -c __pi_del_probe ; echo "grep=$?"
md5sum "$P/Assets/Scenes/SampleScene.scene" > /tmp/after.md5
diff /tmp/before.md5 /tmp/after.md5 && echo "场景文件未被改动"
```

判据：① `node create` 报 `verified:true`；② `node delete` 报 `verified:true`（`actual.path` 是真实路径）；
③ `node inspect` 报 `NOT_FOUND`、退出码 **1**；④ **再删一次**同样 `NOT_FOUND`、退出码 **1**（不是 2）；
⑤ `scene tree --json` 里 `__pi_del_probe` 出现 0 次；⑥ `md5sum` 前后一致（`node delete` 只改内存，不保存场景）。
任一条与预期不符 → **如实写进报告**，并在 `docs/PITFALLS.md` 加一条 U 条目（标适用引擎）。

- [ ] **步骤 6：Commit**

```bash
git add unity-scripts/node-delete.cs lib/scene.js bin/unity.js test/scene.test.js
git commit -m "feat(scene): node delete（写后读回：读回 NOT_FOUND 才算 verified）"
```

---

## 任务 4：像素判定 —— `lib/color.js` + `lib/png.js` + `unity pixels`（集成）

**文件：**
- 创建：`lib/color.js`、`lib/png.js`、`lib/pixels.js`
- 创建：`test/color.test.js`、`test/png.test.js`、`test/pixels.test.js`
- 创建：`test/fixtures/unity-gameview-892x355.png`（真实 Unity 截图 fixture，**唯一来源**）
- 修改：`bin/unity.js`（`pixels` 命令 + USAGE）
- 修改：`test/doctor.test.js`、`test/shot.test.js`（**R207**：本任务要把这两个文件里各自本地的 `captureStdout` / `captureStderr` 抽到 `test/helpers/capture.js`；它们是文件的「源」，所以必须进本任务的文件清单与 commit）

**决策与依据：**
- **为什么要自己解 PNG**：M2 的第一条验收是「截图里真的看得见」。只有把「看得见」变成退出码，「盲测四条判据」才可观测（全局约束 22）。零依赖约束下用 `node:zlib` 自己解。
- **必须实现全部 5 种滤镜与 4 种色彩类型**：实测（2026-09-19，`游戏_20260919_012315_061.png`）Unity 截图的 IHDR 是 `bitDepth=8, colorType=2, interlace=0`，但 **355 行里出现了滤镜 1/2/4**（统计见计划前提 6）——只实现 filter 0 会静默产出错色。
- **`--expect` 的判定走 `actual.match` + 退出码**，而不是 `verified`（全局约束 15：读命令 `verified` 恒 `null`）。退出码：`ok:false` → 1；`ok:true && actual.match === false` → 1；否则 0。
- **fixture 来源**（仓库无法自行生成，必须从 spike 目录拷贝，逐字节校验 sha256）：

```bash
cp "C:/Users/<用户>/pi-unity-spike/shots/游戏_20260919_012315_061.png" \
   test/fixtures/unity-gameview-892x355.png
sha256sum test/fixtures/unity-gameview-892x355.png
# 期望：2621ba6cff6684ff504447cff83fb940d1db7849923ccc115a4b7a4382f0702b
```

- [ ] **步骤 1：编写失败的测试**

```js
// test/color.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseHexColor, maxChannelDistance, formatHex } = require('../lib/color.js');

test('parseHexColor 接受 #RGB / #RRGGBB / #RRGGBBAA（大小写无关），alpha 缺省 255', () => {
  assert.deepStrictEqual(parseHexColor('#0A0A14'), { r: 10, g: 10, b: 20, a: 255 });
  assert.deepStrictEqual(parseHexColor('#ff2e88'), { r: 255, g: 46, b: 136, a: 255 });
  assert.deepStrictEqual(parseHexColor('#F0A'), { r: 255, g: 0, b: 170, a: 255 });
  assert.deepStrictEqual(parseHexColor('#FF2E8880'), { r: 255, g: 46, b: 136, a: 128 });
});

test('parseHexColor 拒绝非法输入（含缺 # / 长度不对 / 非十六进制 / 非字符串）', () => {
  for (const bad of ['0A0A14', '#12345', '#GGGGGG', '#', '', 123, null, undefined, {}, '#1234567']) {
    assert.strictEqual(parseHexColor(bad), null, `${String(bad)} 应判 null`);
  }
});

test('maxChannelDistance 取三通道 |差| 的最大值', () => {
  assert.strictEqual(maxChannelDistance({ r: 0, g: 255, b: 200 }, { r: 0, g: 255, b: 200 }), 0);
  assert.strictEqual(maxChannelDistance({ r: 0, g: 255, b: 200 }, { r: 8, g: 245, b: 200 }), 10);
});

test('formatHex 产出大写 #RRGGBB', () => {
  assert.strictEqual(formatHex({ r: 10, g: 10, b: 20 }), '#0A0A14');
  assert.strictEqual(formatHex({ r: 255, g: 46, b: 136 }), '#FF2E88');
});
```

```js
// test/png.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { decodePng, pixelAt, averageColor, countColor } = require('../lib/png.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'unity-gameview-892x355.png');

test('decodePng 解出真实 Unity 截图（IHDR 892x355 / colorType 2 / bitDepth 8）', () => {
  const img = decodePng(fs.readFileSync(FIXTURE));
  assert.strictEqual(img.width, 892);
  assert.strictEqual(img.height, 355);
  assert.strictEqual(img.channels, 3);
  assert.strictEqual(img.data.length, 892 * 355 * 4);
});

test('pixelAt 的已知取值（滤镜 1/2/4 都被真实数据覆盖）', () => {
  const img = decodePng(fs.readFileSync(FIXTURE));
  assert.deepStrictEqual(pixelAt(img, 446, 177), { r: 49, g: 77, b: 121, a: 255 }); // 相机 SolidColor 背景
  assert.deepStrictEqual(pixelAt(img, 1, 1), { r: 60, g: 60, b: 60, a: 255 });      // Game 视图工具栏灰
  assert.deepStrictEqual(pixelAt(img, 880, 350), { r: 39, g: 39, b: 39, a: 255 });
});

test('averageColor 对纯色区域取平均', () => {
  const img = decodePng(fs.readFileSync(FIXTURE));
  assert.deepStrictEqual(averageColor(img, { x: 400, y: 150, width: 100, height: 50 }), { r: 49, g: 77, b: 121, a: 255 });
  assert.deepStrictEqual(averageColor(img, { x: 0, y: 0, width: 20, height: 10 }), { r: 59, g: 59, b: 59, a: 255 });
});

test('countColor 精确计数（tol 0 与 tol 8 在这张图上相同）', () => {
  const img = decodePng(fs.readFileSync(FIXTURE));
  assert.strictEqual(countColor(img, { r: 49, g: 77, b: 121 }, { tolerance: 0 }), 178356);
  assert.strictEqual(countColor(img, { r: 40, g: 40, b: 40 }, { tolerance: 0 }), 108768);
  assert.strictEqual(countColor(img, { r: 49, g: 77, b: 121 }, { tolerance: 8 }), 178356);
  assert.strictEqual(countColor(img, { r: 1, g: 2, b: 3 }, { tolerance: 0 }), 0);
});

test('pixelAt / averageColor 越界抛 RangeError（不静默返回黑）', () => {
  const img = decodePng(fs.readFileSync(FIXTURE));
  assert.throws(() => pixelAt(img, 892, 0), RangeError);
  assert.throws(() => pixelAt(img, -1, 0), RangeError);
  assert.throws(() => averageColor(img, { x: 800, y: 0, width: 200, height: 10 }), RangeError);
});

test('decodePng 拒绝非 PNG / 不支持的头（响亮失败，不猜）', () => {
  assert.throws(() => decodePng(Buffer.from('not a png')), /不是 PNG/);
  // colorType 3（索引色）不在支持面内 → 必须抛，不许瞎解
  const bad = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080300000000', 'hex');
  assert.throws(() => decodePng(bad), /不支持/);
});

test('decodePng 能解自造的 filter 0–4 小图（覆盖 Average 滤镜与灰阶/带 alpha 色彩类型）', () => {
  // 24x1 的三行图：每行分别用 5 种滤镜里的 3 种；像素刻意选成可预测的渐变
  const img = decodePng(makePng({ width: 4, height: 3, colorType: 6, filters: [0, 3, 4] }));
  assert.strictEqual(img.width, 4);
  assert.strictEqual(img.channels, 4);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 4; x++) {
      assert.deepStrictEqual(
        pixelAt(img, x, y),
        { r: 10 * x + 1, g: 20 * x + 2, b: 30 * x + 3, a: 40 * x + 4 },
        `(${x},${y}) 在 filter=${[0, 3, 4][y]} 下解错`,
      );
    }
  }
  // 反向自检：这些字节确实用到了 filter 3 / 4（否则上面的覆盖是假的）
  const filters = [...new Set([...zlib.inflateSync(collectIdat(makePng({ width: 4, height: 3, colorType: 6, filters: [0, 3, 4] })))]
    .filter((_, i, arr) => i % (4 * 4 + 1) === 0))];
  assert.deepStrictEqual(filters, [0, 3, 4]);
});

// ── 测试自带的 PNG 编码器（只用于造 filter 用例；与被测解码器**不共享任何代码**）──
function collectIdat(buf) {
  const parts = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('latin1');
    if (type === 'IDAT') parts.push(buf.slice(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.slice(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** 造一张 width×height、8bit RGBA、指定每行滤镜的合法 PNG。 */
function makePng({ width, height, colorType, filters }) {
  const ch = colorType === 6 ? 4 : 3;
  const raw = Buffer.alloc(height * (width * ch + 1));
  let prev = Buffer.alloc(width * ch);
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * ch);
    for (let x = 0; x < width; x++) {
      const px = colorType === 6
        ? [10 * x + 1, 20 * x + 2, 30 * x + 3, 40 * x + 4]
        : [10 * x + 1, 20 * x + 2, 30 * x + 3];
      for (let c = 0; c < ch; c++) row[x * ch + c] = px[c];
    }
    const ft = filters[y % filters.length];
    const base = y * (width * ch + 1);
    raw[base] = ft;
    for (let i = 0; i < row.length; i++) {
      const a = i >= ch ? row[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = row[i];
      if (ft === 1) v -= a;
      else if (ft === 2) v -= b;
      else if (ft === 3) v -= Math.floor((a + b) / 2);
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v -= (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      raw[base + 1 + i] = v & 255;
    }
    prev = row;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
```

```js
// test/pixels.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pixels } = require('../lib/pixels.js');
const { exitCodeFor } = require('../lib/envelope.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'unity-gameview-892x355.png');
const readFile = (p) => fs.readFileSync(p);

test('pixels 缺 --file → MISSING_FILE（用法错，退出码 2），一次都不读盘', async () => {
  let reads = 0;
  const e = await pixels({ _readFile: () => { reads++; return Buffer.alloc(0); } });
  assert.strictEqual(e.code, 'MISSING_FILE');
  assert.strictEqual(reads, 0);
  assert.strictEqual(exitCodeFor(e), 2);
});

test('pixels 文件不存在 → FILE_NOT_FOUND（运行时错，退出码 1）', async () => {
  const e = await pixels({ file: 'C:/nope/missing.png', _readFile });
  assert.strictEqual(e.code, 'FILE_NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('pixels 非 PNG → BAD_PNG（运行时错）', async () => {
  const e = await pixels({ file: 'x.png', _readFile: () => Buffer.from('nope') });
  assert.strictEqual(e.code, 'BAD_PNG');
  assert.match(e.message, /不是 PNG/);
});

test('pixels --at 采样：ok:true / verified:null / actual.at.color', async () => {
  const e = await pixels({ file: FIXTURE, at: '446,177', _readFile });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, null, '读命令 verified 恒为 null');
  assert.strictEqual(e.actual.width, 892);
  assert.deepStrictEqual(e.actual.at, { x: 446, y: 177, color: { r: 49, g: 77, b: 121, a: 255 } });
  assert.strictEqual(e.actual.match, null);
  assert.strictEqual(exitCodeFor(e), 0);
});

test('pixels --region 取平均色', async () => {
  const e = await pixels({ file: FIXTURE, region: '400,150,100,50', _readFile });
  assert.deepStrictEqual(e.actual.region, {
    x: 400, y: 150, width: 100, height: 50, color: { r: 49, g: 77, b: 121, a: 255 },
  });
});

test('pixels --count-color 计数 + ratio（(49,77,121) 的十六进制是 #314D79）', async () => {
  const e = await pixels({ file: FIXTURE, countColor: '#314D79', _readFile });
  assert.strictEqual(e.actual.count.color, '#314D79');
  assert.strictEqual(e.actual.count.count, 178356);
  assert.ok(Math.abs(e.actual.count.ratio - 178356 / (892 * 355)) < 1e-9);
});

test('pixels --expect 命中 → match:true / 退出码 0；不命中 → match:false / 退出码 1（不产出错误码）', async () => {
  const hit = await pixels({ file: FIXTURE, at: '446,177', expect: '#314D79', tolerance: '0', _readFile });
  assert.strictEqual(hit.ok, true);
  assert.strictEqual(hit.actual.match, true);
  assert.strictEqual(exitCodeFor(hit), 0);

  const miss = await pixels({ file: FIXTURE, at: '446,177', expect: '#FF2E88', tolerance: '0', _readFile });
  assert.strictEqual(miss.ok, true, 'ok 只表示命令跑通；不匹配由 match + 退出码表达');
  assert.strictEqual(miss.actual.match, false);
  assert.strictEqual(miss.actual.expected, '#FF2E88');
  assert.strictEqual(miss.actual.tolerance, 0);
  // 最大通道差 = max(|49-255|, |77-46|, |121-136|) = 206
  assert.strictEqual(miss.actual.distance, 206);
  assert.strictEqual(exitCodeFor(miss), 1);
});

test('pixels --expect 容差内算命中', async () => {
  const e = await pixels({ file: FIXTURE, region: '400,150,100,50', expect: '#314D7A', tolerance: '4', _readFile });
  assert.strictEqual(e.actual.match, true);
});

test('pixels 用法错：BAD_AT / BAD_REGION / BAD_EXPECT / BAD_TOLERANCE / BAD_COLOR', async () => {
  for (const [opt, code] of [
    [{ at: '446' }, 'BAD_AT'],
    [{ at: '446,-1' }, 'BAD_AT'],
    [{ at: '892,0' }, 'BAD_AT'],
    [{ region: '1,2,3' }, 'BAD_REGION'],
    [{ region: '0,0,0,10' }, 'BAD_REGION'],
    [{ region: '0,0,2000,10' }, 'BAD_REGION'],
    [{ expect: '#FF2E88' }, 'BAD_EXPECT'],
    [{ at: '0,0', expect: 'nope' }, 'BAD_EXPECT'],
    [{ countColor: 'nope' }, 'BAD_COLOR'],
    [{ at: '0,0', tolerance: '-1' }, 'BAD_TOLERANCE'],
  ]) {
    const e = await pixels({ file: FIXTURE, _readFile, ...opt });
    assert.strictEqual(e.code, code, `${JSON.stringify(opt)} 应落 ${code}`);
    assert.strictEqual(exitCodeFor(e), 2);
  }
});

test('CLI pixels --expect 命中 → 0 / 不命中 → 1（含 --json 载荷）', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout: cap } = require('./helpers/capture.js'); // 见下方「测试辅助」说明
  const hit = await cap(() => main(['pixels', '--file', FIXTURE, '--at', '446,177', '--expect', '#314D79', '--json']));
  assert.strictEqual(hit.result, 0);
  assert.strictEqual(JSON.parse(hit.out).actual.match, true);
  const miss = await cap(() => main(['pixels', '--file', FIXTURE, '--at', '446,177', '--expect', '#FF2E88', '--json']));
  assert.strictEqual(miss.result, 1);
  assert.strictEqual(JSON.parse(miss.out).actual.match, false);
});
```

> **测试辅助（本任务新建，后续任务复用）**：把 `test/scene.test.js` / `test/doctor.test.js` / `test/shot.test.js` 三处各自本地的 `captureStdout` / `captureStderr` 抽到新文件 `test/helpers/capture.js`（`module.exports = { captureStdout, captureStderr }`，**函数体逐字照搬 scene.test.js 的版本**，含「非字符串 chunk 原样转发」那条防御），三个测试文件都从它 import 并删掉本地副本。**不要**再复制第四份：`node --test "test/*.test.js"` 只跑 `test/` 顶层的 `*.test.js`，`test/helpers/` 不会被当测试文件执行。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/color.test.js test/png.test.js test/pixels.test.js`
预期：FAIL —— `Cannot find module '../lib/color.js'` / `'../lib/png.js'` / `'../lib/pixels.js'` / `'./helpers/capture.js'`。
先执行 fixture 拷贝命令（见上），否则 png/pixels 的用例即使实现好了也会 `FILE_NOT_FOUND`。

- [ ] **步骤 3：编写最少实现代码**

```js
// lib/color.js
'use strict';

/**
 * 颜色小工具：与 PNG 解码、`unity sprite set`、`unity pixels` 共用（零依赖，纯函数）。
 * 内部统一用 **0–255 整数** 表示通道 —— 与 `Texture2D` 的字节、PNG 的取样值、`SpriteRenderer`
 * 读回时 `Math.round(c * 255)` 的约定一致，避免 float↔byte 的往返误差变成假红。
 */

/** 解析 `#RGB` / `#RRGGBB` / `#RRGGBBAA`（大小写无关）→ `{r,g,b,a}`；非法返回 `null`（不抛）。 */
function parseHexColor(text) {
  if (typeof text !== 'string') return null;
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(text);
  if (!m) return null;
  const h = m[1];
  if (h.length === 3) {
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 255 };
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255,
  };
}

/** 两个颜色的最大通道差（只看 r/g/b；判定「像素是不是这个颜色」时用）。 */
function maxChannelDistance(a, b) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

/** `{r,g,b}` → `'#RRGGBB'`（大写；alpha 不进字符串，避免 `#RRGGBBAA` 的歧义）。 */
function formatHex(c) {
  const hex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

module.exports = { parseHexColor, maxChannelDistance, formatHex };
```

```js
// lib/png.js
'use strict';

const zlib = require('node:zlib');

/**
 * 最小 PNG 解码器（零依赖，只用 `node:zlib`）。
 *
 * 支持面（**实测需要的最小面**）：bitDepth 8、colorType 0/2/4/6、interlace 0、**滤镜 0–4 全部**。
 * 为什么必须支持全部滤镜：真机 Unity 截图 892x355 的 355 行里出现了滤镜 1/2/4
 * （`游戏_20260919_012315_061.png`，2026-09-19 实测），只实现 filter 0 会静默产出错色。
 * **不支持的一律抛**（响亮失败）：抛出会被命令路径收敛成 `BAD_PNG`，绝不猜。
 */

/** 每通道字节数与「一个像素占几字节」的映射（bitDepth 固定 8）。 */
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 解析 PNG → `{width, height, channels, data}`，`data` 是 RGBA8 的 Buffer（每像素 4 字节）。 */
function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.slice(0, 8).equals(SIGNATURE)) {
    throw new Error('不是 PNG：签名不符');
  }
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('latin1');
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (!ihdr) throw new Error('不是 PNG：缺 IHDR');
  if (ihdr.bitDepth !== 8) throw new Error(`不支持的 PNG：bitDepth=${ihdr.bitDepth}（只支持 8）`);
  if (CHANNELS[ihdr.colorType] === undefined) throw new Error(`不支持的 PNG：colorType=${ihdr.colorType}（只支持 0/2/4/6）`);
  if (ihdr.interlace !== 0) throw new Error(`不支持的 PNG：interlace=${ihdr.interlace}（只支持 0）`);
  if (idat.length === 0) throw new Error('不支持的 PNG：没有 IDAT 数据');

  const channels = CHANNELS[ihdr.colorType];
  const { width, height } = ihdr;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) {
    throw new Error(`不支持的 PNG：像素数据长度不足（${raw.length} < ${height * (stride + 1)}）`);
  }

  const data = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    if (ft > 4) throw new Error(`不支持的 PNG：第 ${y} 行的滤镜类型 ${ft}`);
    const row = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = row[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += Math.floor((a + b) / 2);
      else if (ft === 4) v += paeth(a, b, c);
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (channels >= 3) {
        data[o] = cur[x * channels];
        data[o + 1] = cur[x * channels + 1];
        data[o + 2] = cur[x * channels + 2];
        data[o + 3] = channels === 4 ? cur[x * channels + 3] : 255;
      } else {
        // colorType 0（灰）/4（灰 + alpha）：三通道取同一灰度值
        data[o] = cur[x * channels];
        data[o + 1] = cur[x * channels];
        data[o + 2] = cur[x * channels];
        data[o + 3] = channels === 2 ? cur[x * channels + 1] : 255;
      }
    }
    prev = cur;
  }
  return { width, height, channels, data };
}

/** 取一个像素（top-left 原点）。越界抛 `RangeError`（不静默返回黑）。 */
function pixelAt(img, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= img.width || y >= img.height) {
    throw new RangeError(`像素越界：(${x},${y}) 不在 ${img.width}x${img.height} 内`);
  }
  const o = (y * img.width + x) * 4;
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2], a: img.data[o + 3] };
}

/** 区域平均色（四舍五入到整数）。区域越界抛 `RangeError`。 */
function averageColor(img, { x, y, width, height }) {
  if (![x, y, width, height].every(Number.isInteger) || width <= 0 || height <= 0
    || x < 0 || y < 0 || x + width > img.width || y + height > img.height) {
    throw new RangeError(`区域越界：${x},${y},${width},${height} 不在 ${img.width}x${img.height} 内`);
  }
  let r = 0; let g = 0; let b = 0; let a = 0;
  for (let yy = y; yy < y + height; yy++) {
    for (let xx = x; xx < x + width; xx++) {
      const o = (yy * img.width + xx) * 4;
      r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; a += img.data[o + 3];
    }
  }
  const n = width * height;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: Math.round(a / n) };
}

/** 逐通道差 <= tolerance 的像素数（只看 r/g/b；抗锯齿边缘靠 tolerance 吸收）。 */
function countColor(img, color, { tolerance = 0 } = {}) {
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (Math.abs(img.data[i] - color.r) <= tolerance
      && Math.abs(img.data[i + 1] - color.g) <= tolerance
      && Math.abs(img.data[i + 2] - color.b) <= tolerance) n++;
  }
  return n;
}

module.exports = { decodePng, pixelAt, averageColor, countColor };
```

```js
// lib/pixels.js
'use strict';

const fs = require('node:fs');
const { ok, fail } = require('./envelope.js');
const { parseHexColor, maxChannelDistance, formatHex } = require('./color.js');
const { decodePng, pixelAt, averageColor, countColor } = require('./png.js');

/** 解析 `x,y`（n=2）或 `x,y,w,h`（n=4）——只接受十进制整数；非法返回 `null`。 */
function parsePair(text, n) {
  if (typeof text !== 'string') return null;
  const parts = text.split(',');
  if (parts.length !== n) return null;
  const nums = parts.map((p) => (/^-?\d+$/.test(p.trim()) ? Number(p.trim()) : NaN));
  return nums.every(Number.isInteger) ? nums : null;
}

/** `--tolerance`：缺省 0；非字符串或非负整数返回 `null`（调用方落 BAD_TOLERANCE）。 */
function parseTolerance(raw) {
  if (raw === undefined) return 0;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * `unity pixels`：读 PNG 做**可断言的像素判定**（M2 的第一条验收靠它）。
 *
 * 为什么不设 `verified`：这是**读**命令，没有 intent 与 actual 的「写后比对」（全局约束 15）。
 * 判定结论放在 `actual.match`（给了 `--expect` 时才有），退出码由 `exitCodeFor` 统一给出。
 *
 * 用法错的边界（都是 argv 形状问题 → 退出码 2）：缺 `--file`、`--at`/`--region` 格式或范围非法、
 * `--expect` 没有可比较的取样点、`--tolerance` 非非负整数、颜色值非法。
 * 运行时错的边界（退出码 1）：文件读不了、PNG 不支持/损坏。
 *
 * @param {{file?: string, at?: string, region?: string, expect?: string, tolerance?: string,
 *   countColor?: string, _readFile?: (p: string) => Buffer}} [opts]
 * @returns {Promise<object>} 信封（`ok:true` 时 `actual` 有 `width`/`height`/`match` 及命中的采样字段）
 */
async function pixels({ file, at, region, expect, tolerance, countColor: countHex, _readFile } = {}) {
  if (typeof file !== 'string' || file === '') {
    return fail({
      code: 'MISSING_FILE',
      message: '缺少 --file（PNG 路径）',
      actual: { file },
      hint: ['用法：unity pixels --file C:/shots/x.png --at 100,50 --expect \'#FF2E88\''],
    });
  }
  const tol = parseTolerance(tolerance);
  if (tol === null) {
    return fail({
      code: 'BAD_TOLERANCE',
      message: `--tolerance 需要非负整数，收到 ${JSON.stringify(tolerance)}`,
      actual: { tolerance },
      hint: ['用法：--tolerance 16'],
    });
  }

  let buf;
  try {
    buf = await (_readFile || ((p) => fs.readFileSync(p)))(file);
  } catch (err) {
    return fail({
      code: 'FILE_NOT_FOUND',
      message: `读不了 PNG：${(err && err.message) || String(err)}`,
      actual: { file },
      hint: ['用 `unity shot` 的返回信封里的 actual.path 作为 --file（不要 ls -t 猜最新图）'],
    });
  }
  let img;
  try {
    img = decodePng(buf);
  } catch (err) {
    return fail({
      code: 'BAD_PNG',
      message: `PNG 解码失败：${(err && err.message) || String(err)}`,
      actual: { file, bytes: Buffer.isBuffer(buf) ? buf.length : null },
      hint: ['只支持 bitDepth 8 / colorType 0,2,4,6 / 非交织的 PNG（Unity 截图实测就是这个形态）'],
    });
  }

  const actual = { file, width: img.width, height: img.height, match: null };
  const hint = [];

  if (countHex !== undefined) {
    const c = parseHexColor(countHex);
    if (!c) {
      return fail({
        code: 'BAD_COLOR',
        message: `--count-color 需要 #RGB/#RRGGBB/#RRGGBBAA，收到 ${JSON.stringify(countHex)}`,
        actual: { countColor: countHex },
        hint: ['用法：--count-color \'#FF2E88\''],
      });
    }
    const n = countColor(img, c, { tolerance: tol });
    actual.count = { color: formatHex(c), count: n, ratio: n / (img.width * img.height), tolerance: tol };
    if (n === 0) hint.push(`画面里一个 ${formatHex(c)} 像素都没有 —— 该颜色可能没被渲染出来，或容差太小`);
  }

  if (at !== undefined) {
    const pair = parsePair(at, 2);
    if (!pair) {
      return fail({
        code: 'BAD_AT',
        message: `--at 需要 x,y（十进制整数），收到 ${JSON.stringify(at)}`,
        actual: { at },
        hint: ['用法：--at 446,177'],
      });
    }
    const [x, y] = pair;
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) {
      return fail({
        code: 'BAD_AT',
        message: `--at ${at} 越界（图 ${img.width}x${img.height}）`,
        actual: { at, width: img.width, height: img.height },
        hint: ['坐标是**图片像素**、左上原点；用 `unity shot` 返回的 width/height 校验'],
      });
    }
    actual.at = { x, y, color: pixelAt(img, x, y) };
  }

  if (region !== undefined) {
    const quad = parsePair(region, 4);
    if (!quad) {
      return fail({
        code: 'BAD_REGION',
        message: `--region 需要 x,y,w,h（十进制整数），收到 ${JSON.stringify(region)}`,
        actual: { region },
        hint: ['用法：--region 400,150,100,50'],
      });
    }
    const [x, y, w, h] = quad;
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > img.width || y + h > img.height) {
      return fail({
        code: 'BAD_REGION',
        message: `--region ${region} 无效或越界（图 ${img.width}x${img.height}，要求 w>0 且 h>0 且完全在图内）`,
        actual: { region, width: img.width, height: img.height },
        hint: ['用法：--region 400,150,100,50'],
      });
    }
    actual.region = { x, y, width: w, height: h, color: averageColor(img, { x, y, width: w, height: h }) };
  }

  if (expect !== undefined) {
    const want = parseHexColor(expect);
    if (!want) {
      return fail({
        code: 'BAD_EXPECT',
        message: `--expect 需要 #RGB/#RRGGBB/#RRGGBBAA，收到 ${JSON.stringify(expect)}`,
        actual: { expect },
        hint: ['用法：--expect \'#FF2E88\''],
      });
    }
    const sampled = actual.at ? actual.at.color : (actual.region ? actual.region.color : null);
    if (!sampled) {
      return fail({
        code: 'BAD_EXPECT',
        message: '--expect 必须配合 --at 或 --region（否则没有可比较的取样点）',
        actual: { expect },
        hint: ['用法：--at 446,177 --expect \'#314D79\'（--region 时比较的是区域平均色）'],
      });
    }
    actual.expected = formatHex(want);
    actual.tolerance = tol;
    actual.distance = maxChannelDistance(sampled, want);
    actual.match = actual.distance <= tol;
    if (!actual.match) {
      hint.push(`取样值 ${formatHex(sampled)} 与期望 ${formatHex(want)} 的最大通道差 ${actual.distance} > 容差 ${tol}`);
    }
  }

  return ok(actual, { hint });
}

module.exports = { pixels, parsePair, parseTolerance };
```

`bin/unity.js` 在 `COMMANDS` 里加：

```js
  pixels: async (rest) => {
    const { parseArgs } = require('../lib/args.js');
    const args = parseArgs(rest);
    // R203：M1 风格 —— 新 handler 在自己体内局部 require 它用到的一切（顶层没有 emit/exitCodeFor）
    const { emit, exitCodeFor } = require('../lib/envelope.js');
    const { pixels } = require('../lib/pixels.js');
    const e = await pixels({
      file: args.file,
      at: args.at,
      region: args.region,
      expect: args.expect,
      tolerance: args.tolerance,
      countColor: args['count-color'],
    });
    emit(e, { json: Boolean(args.json) });
    return exitCodeFor(e);
  },
```

`USAGE` 加一段：

```
  pixels                 读 PNG 做像素判定（退出码 1 = --expect 不匹配）
    --file <png>         必填：`unity shot` 返回的 actual.path
    --at x,y             取单像素颜色（图片坐标，左上原点）
    --region x,y,w,h     取区域平均色
    --count-color <hex>  统计该颜色（逐通道差 <= --tolerance）的像素数与占比
    --expect <hex>       与 --at/--region 的取样值比较；配合 --tolerance（默认 0）
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/color.test.js test/png.test.js test/pixels.test.js`
预期：PASS（color 4 + png 7 + pixels 10 = 21 条；**这里的 19 是旧稿的笔误 —— 统一为 21**）。
运行：`npm test`
预期：PASS。本任务新增 **21 条**（color 4 + png 7 + pixels 10）→ 总数应为 **248**；以实际为准。

> **R206④：`--expect` 不匹配不产出错误码**。接口总表里的 `EXPECT_MISMATCH` 已删（它是死码：`lib/pixels.js` 从不产它）；判定路径是 **`ok:true` + `actual.match:false` + `exitCodeFor` → 1**。断言语义不变（上面的用例已覆盖）。

- [ ] **步骤 5：真机验证（必做）**

用 M1 留下的真实截图做一次端到端（不依赖编辑器）：

```bash
node bin/unity.js pixels --file "C:/Users/<用户>/pi-unity-spike/shots/游戏_20260919_012315_061.png" \
  --at 446,177 --expect '#314D79' --json ; echo "exit=$?"
node bin/unity.js pixels --file "C:/Users/<用户>/pi-unity-spike/shots/游戏_20260919_012315_061.png" \
  --at 446,177 --expect '#FF2E88' --json ; echo "exit=$?"
```

判据：第一条 `exit=0` 且 `actual.match:true`；第二条 `exit=1` 且 `actual.match:false`、`actual.distance:206`。
把两条真实输出贴进报告。另外必须**声明**：`unity pixels` 的坐标与 `--capture-mode rendering` 的对应关系
（`image_x = screen_x`、`image_y = 图高 - screen_y`）**本任务只做了「图片内采样」验证**；
「世界坐标 → 屏幕像素」的换算留到任务 5/11 的真机步骤，用 `Camera.WorldToScreenPoint` 交叉校准。

- [ ] **步骤 6：Commit**

```bash
git add lib/color.js lib/png.js lib/pixels.js bin/unity.js \
        test/color.test.js test/png.test.js test/pixels.test.js test/helpers/capture.js \
        test/fixtures/unity-gameview-892x355.png test/scene.test.js test/doctor.test.js test/shot.test.js
git commit -m "feat(pixels): PNG 像素判定（color/png/pixels + fixture + --expect 退出码）"
```

---

## 任务 5：`unity sprite set` —— 运行时纯色 sprite + 视觉闭环（集成）

**文件：**
- 创建：`unity-scripts/sprite-set.cs`
- 修改：`unity-scripts/node-inspect.cs`（新增 `sprite` 字段）
- 创建：`lib/sprite.js`
- 修改：`bin/unity.js`（`sprite set` + USAGE）
- 创建：`test/sprite.test.js`

**决策一：为什么是**独立命令 `unity sprite set`**，而不是给 `node set` 加 `--sprite-color`？**
1. `node set` 的 `--patch` 是**封闭白名单**（`PATCH_KEYS` = name/active/position/scale），且刚在任务 2 被跨语言 tripwire 钉死。往里加 sprite 字段会同时改动 `PATCH_KEYS`、`node-set.cs`、tripwire 三处，并让 `UNKNOWN_PATCH_KEY` 的语义（「node set 不支持的字段」）变模糊。
2. sprite 的 intent 形状不同（`{sprite:{color,sortingOrder}}`），失败面也不同（要 `SpriteRenderer` 兜底创建、要造 `Texture2D`/`Sprite`），值得有**自己的错误码与 hint**（`SPRITE_CREATE_FAILED`）。
3. 读回字段不同：`nodeInspect` 的 patch 对齐字段（name/active/position/scale）不足以验证颜色，必须给 `node-inspect.cs` 加 `sprite` 子对象。把它塞进 patch 会让「每次 `node set` 的读回」都带上 sprite 字段。
4. 保持 M1 的 207→216 条断言与 skill 的 `node set` 语义零变动。

**决策二：`--size` 刻意不做。** 尺寸就是 `transform.localScale`，已有 `node set --patch '{"scale":{"x":…,"y":…,"z":1}}'` 与既有读回覆盖。两处都能设尺寸 = 两份真值 = 漂移源。所以 `sprite set` **只管 sprite 组件自己的字段**（`--color` / `--sorting-order`），尺寸用 `node set`。

**决策三：基础 sprite 恒为 1×1 世界单位。** `Texture2D(1,1)` 全白 + `Sprite.Create(tex, new Rect(0,0,1,1), new Vector2(0.5f,0.5f), 1f)` —— `pixelsPerUnit = 1f`（**必须显式传**：默认 100 会让 1×1 纹理变成 0.01 世界单位，方块小到看不见）。于是 **`localScale` 就是世界尺寸**，配方（§任务 11）与游戏脚本都按这个约定算。

**决策四：只在 `sr.sprite == null` 时造纹理/sprite。** 改颜色时复用已有 sprite（否则每次调用都泄漏一张 `Texture2D` + `Sprite`）。

- [ ] **步骤 1：编写失败的测试**

```js
// test/sprite.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spriteSet } = require('../lib/sprite.js');
const { exitCodeFor } = require('../lib/envelope.js');

function fakeCall(json, spy = []) {
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

/** 按调用序回放（第 1 次 = sprite-set 写，第 2 次 = node-inspect 读回）。 */
function sequenceCall(results, spy = []) {
  let n = 0;
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    const json = results[Math.min(n, results.length - 1)];
    n++;
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

const READBACK = {
  name: 'Paddle', active: true, path: 'Paddle',
  components: ['Transform', 'SpriteRenderer'],
  position: { x: 0, y: -4.2, z: 0 }, scale: { x: 2.4, y: 0.35, z: 1 },
  sprite: { present: true, color: { r: 0, g: 255, b: 200, a: 255 }, sortingOrder: 0, sortingLayerName: 'Default', spriteName: 'Sprite' },
};

test('spriteSet 缺 --path / 裸 --path → MISSING_PATH，不发起写', async () => {
  for (const p of [undefined, '', true]) {
    const spy = [];
    const e = await spriteSet({ projectPath: 'X', path: p, color: { r: 0, g: 255, b: 200 }, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'MISSING_PATH');
    assert.strictEqual(spy.length, 0);
  }
});

test('spriteSet 缺 color 或 color 非法 → BAD_COLOR（用法错，退出码 2），不发起写', async () => {
  for (const bad of [undefined, null, 'x', { r: 1 }, { r: 0, g: 255, b: 200, a: 999 }]) {
    const spy = [];
    const e = await spriteSet({ projectPath: 'X', path: 'Paddle', color: bad, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'BAD_COLOR', `${JSON.stringify(bad)} 应落 BAD_COLOR`);
    assert.strictEqual(spy.length, 0);
    assert.strictEqual(exitCodeFor(e), 2);
  }
});

test('spriteSet --sorting-order 非整数 → BAD_SORTING_ORDER，不发起写', async () => {
  const e = await spriteSet({
    projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 }, sortingOrder: 'x',
    _call: fakeCall({ Success: true }, []),
  });
  assert.strictEqual(e.code, 'BAD_SORTING_ORDER');
});

test('spriteSet 成功：读回颜色一致 → verified:true，intent 是 {sprite:{color}} 子集', async () => {
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __written: true }) },
    { Success: true, Result: JSON.stringify(READBACK) },
  ], spy);
  const e = await spriteSet({ projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 }, _call: call });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(e.intent, { sprite: { color: { r: 0, g: 255, b: 200 } } });
  assert.deepStrictEqual(e.mismatches, []);
  // 载荷契约：parameters["param0"] 且只有一个 key p
  const payload = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.deepStrictEqual(Object.keys(JSON.parse(spy[0].args[3])), ['p']);
  assert.deepStrictEqual(payload, { path: 'Paddle', color: { r: 0, g: 255, b: 200 } });
  assert.ok(spy[0].args[1].endsWith('sprite-set.cs'));
});

test('spriteSet 颜色不一致（Unity 侧被改）→ verified:false + sprite.color 分歧', async () => {
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __written: true }) },
    { Success: true, Result: JSON.stringify({ ...READBACK, sprite: { ...READBACK.sprite, color: { r: 255, g: 0, b: 0, a: 255 } } }) },
  ]);
  const e = await spriteSet({ projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 }, _call: call });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'sprite.color.r');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('spriteSet 读回没有 sprite 字段（SpriteRenderer 没挂上）→ verified:false', async () => {
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __written: true }) },
    { Success: true, Result: JSON.stringify({ ...READBACK, components: ['Transform'], sprite: null }) },
  ]);
  const e = await spriteSet({ projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 }, _call: call });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'sprite');
});

test('spriteSet .cs 报 SPRITE_CREATE_FAILED → 直接按码失败（退出码 1）', async () => {
  const e = await spriteSet({
    projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 },
    _call: fakeCall({ Success: true, Result: JSON.stringify({ __error: 'SPRITE_CREATE_FAILED', detail: 'null texture' }) }),
  });
  assert.strictEqual(e.code, 'SPRITE_CREATE_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('spriteSet 节点不存在 → NOT_FOUND（退出码 1）', async () => {
  const e = await spriteSet({
    projectPath: 'X', path: 'Nope', color: { r: 0, g: 255, b: 200 },
    _call: fakeCall({ Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) }),
  });
  assert.strictEqual(e.code, 'NOT_FOUND');
  assert.deepStrictEqual(e.actual, { path: 'Nope' });
});

test('spriteSet 带 alpha 时 intent 含 a（8 位 hex 才带）', async () => {
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __written: true }) },
    { Success: true, Result: JSON.stringify(READBACK) },
  ], spy);
  await spriteSet({ projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200, a: 128 }, _call: call });
  const payload = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.deepStrictEqual(payload.color, { r: 0, g: 255, b: 200, a: 128 });
});

test('CLI sprite set 的 --color 解析：合法 hex 走通、非法 → 2', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout } = require('./helpers/capture.js');
  const bad = await captureStdout(() => main(['sprite', 'set', '--project-path', 'X', '--path', 'P', '--color', 'not-a-color', '--json']));
  assert.strictEqual(bad.result, 2);
  assert.strictEqual(JSON.parse(bad.out).code, 'BAD_COLOR');
  const noSub = await captureStdout(() => main(['sprite', 'bogus', '--json']));
  assert.strictEqual(noSub.result, 2);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/sprite.test.js`
预期：FAIL —— `Cannot find module '../lib/sprite.js'`。

- [ ] **步骤 3：编写最少实现代码**

```csharp
// unity-scripts/sprite-set.cs
// 入参：parameters["param0"] = {"path":"Paddle","color":{"r":0,"g":255,"b":200},"sortingOrder":0}
//   说明：color 的 a 字段可选（缺省 255）；sortingOrder 可选。
// 出参：JSON —— 成功 {"__written":true}；失败 {"__error":"NOT_FOUND"|"BAD_PAYLOAD"|"SPRITE_CREATE_FAILED"|"COMPONENT_ADD_FAILED"}
// ⚠️ 本脚本**不做验证**：颜色是否真的生效由 lib/sprite.js 的 spriteSet 读回 node-inspect.cs 比对。
//
// 关键约定（与 skill §3.5 的打砖块配方、node-inspect.cs 的读回字段三者必须一致）：
//   - 基础 sprite 是 **1x1 世界单位**（1x1 纹理 + pixelsPerUnit=1f）→ 节点的 localScale 就是世界尺寸；
//   - 颜色走 SpriteRenderer.color（不改纹理像素）→ 一张白纹理可以复用出所有颜色，零资产文件；
//   - 只在 sprite 为空时创建纹理/sprite（改颜色不重复造，避免每次调用泄漏 Texture2D）。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var p = (string)req["path"];
var colorTok = req["color"] as Newtonsoft.Json.Linq.JObject;
if (string.IsNullOrEmpty(p) || colorTok == null) return "{\"__error\":\"BAD_PAYLOAD\"}";

// 同 node-inspect.cs：Find 找不到非激活对象，回退遍历当前激活场景的全部根对象（含 inactive）。
GameObject go = GameObject.Find(p);
if (go == null)
{
    string[] segs = p.Split('/');
    foreach (GameObject root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
    {
        GameObject hit = FindByPath(root.transform, segs, 0);
        if (hit != null) { go = hit; break; }
    }
}
if (go == null) return "{\"__error\":\"NOT_FOUND\"}";

var sr = go.GetComponent<SpriteRenderer>();
if (sr == null) sr = go.AddComponent<SpriteRenderer>();
if (sr == null)
{
    var addErr = new Newtonsoft.Json.Linq.JObject();
    addErr["__error"] = "COMPONENT_ADD_FAILED";
    addErr["component"] = "SpriteRenderer";
    return addErr.ToString(Newtonsoft.Json.Formatting.None);
}

if (sr.sprite == null)
{
    var tex = new Texture2D(1, 1, TextureFormat.RGBA32, false);
    tex.SetPixel(0, 0, Color.white);
    tex.Apply();
    tex.hideFlags = HideFlags.HideAndDontSave;
    // pixelsPerUnit **必须是 1f**：默认 100 会让 1x1 纹理只有 0.01 世界单位（方块看不见）。
    var sp = Sprite.Create(tex, new Rect(0, 0, 1, 1), new Vector2(0.5f, 0.5f), 1f);
    if (sp == null)
    {
        UnityEngine.Object.DestroyImmediate(tex);
        var createErr = new Newtonsoft.Json.Linq.JObject();
        createErr["__error"] = "SPRITE_CREATE_FAILED";
        createErr["detail"] = "Sprite.Create 返回 null";
        return createErr.ToString(Newtonsoft.Json.Formatting.None);
    }
    sp.hideFlags = HideFlags.HideAndDontSave;
    sr.sprite = sp;
}

// 颜色用 byte 通道 → Unity 侧 float；读回时 Math.round(c * 255) 往返无损（8bit 值不会被浮点吃掉）。
var a = colorTok["a"] != null ? (int)colorTok["a"] : 255;
sr.color = new Color32((byte)(int)colorTok["r"], (byte)(int)colorTok["g"], (byte)(int)colorTok["b"], (byte)a);

if (req["sortingOrder"] != null) sr.sortingOrder = (int)req["sortingOrder"];
return "{\"__written\":true}";

// ⚠️ 不能加 static（uloop 会把字面量提升成外层局部变量，静态局部函数引用会 CS8421）。
GameObject FindByPath(Transform t, string[] segs, int i)
{
    if (t.name != segs[i]) return null;
    if (i == segs.Length - 1) return t.gameObject;
    for (int k = 0; k < t.childCount; k++)
    {
        GameObject hit = FindByPath(t.GetChild(k), segs, i + 1);
        if (hit != null) return hit;
    }
    return null;
}
```

`unity-scripts/node-inspect.cs`：在 `o["components"] = …` **之前**插入（additive 字段，不改既有字段）：

```csharp
// M2：SpriteRenderer 的读回面（`unity sprite set` 的验证依赖它）。
// 颜色用 0–255 整数：`.cs` 侧用 Color32 写入，`Math.round(c * 255)` 读回 → 8bit 往返无损，
// 于是 `compareSubset` 的数值容差（1e-4）在这里不会产生假红/假绿。
// 没有 SpriteRenderer 时写成 JSON null（不是省略）：intent 里的对象字段遇到 null 会被
// compareSubset 的 F2 类型校验记成一条分歧 —— 这正是「没挂上渲染组件」应有的结论。
var sr = go.GetComponent<SpriteRenderer>();
if (sr != null)
{
    var sp = new Newtonsoft.Json.Linq.JObject();
    sp["present"] = true;
    sp["color"] = new Newtonsoft.Json.Linq.JObject
    {
        ["r"] = (int)System.Math.Round(sr.color.r * 255f),
        ["g"] = (int)System.Math.Round(sr.color.g * 255f),
        ["b"] = (int)System.Math.Round(sr.color.b * 255f),
        ["a"] = (int)System.Math.Round(sr.color.a * 255f),
    };
    sp["sortingOrder"] = sr.sortingOrder;
    sp["sortingLayerName"] = sr.sortingLayerName;
    sp["spriteName"] = sr.sprite != null ? sr.sprite.name : null;
    o["sprite"] = sp;
}
else
{
    o["sprite"] = null;
}
```

```js
// lib/sprite.js
'use strict';

const path = require('node:path');
const { call } = require('./uloop.js');
const { ok, fail, envelopeFromCall } = require('./envelope.js');
const { buildPayloadArgs, nodeInspect, parseNodeResult } = require('./scene.js');
const { verifyWrite } = require('./readback.js');

const SCRIPTS_DIR = path.join(__dirname, '..', 'unity-scripts');

/** 颜色必须是非空对象且 r/g/b 是 0–255 整数；a 可选（0–255 整数）。 */
function isValidColor(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  const fields = c.a === undefined ? ['r', 'g', 'b'] : ['r', 'g', 'b', 'a'];
  return fields.every((k) => Number.isInteger(c[k]) && c[k] >= 0 && c[k] <= 255);
}

/**
 * `unity sprite set`：给节点挂运行时纯色 sprite + **写后读回**。
 *
 * 依赖 `unity-scripts/sprite-set.cs` 与 `unity-scripts/node-inspect.cs` 的 `sprite` 字段，
 * 三者由本文件与 `test/sprite.test.js` 的载荷断言钉在一起（全局约束 18）。
 *
 * intent 的**形状**就是读回路径的形状：`{sprite:{color:{r,g,b[,a]}, sortingOrder?}}` ——
 * 于是 `compareSubset` 直接递归比对，且「节点没有 SpriteRenderer」（读回 `sprite: null`）
 * 会自然落成一条 `key:'sprite'` 的分歧（F2 类型校验），不需要手写额外判据。
 *
 * 传给 `.cs` 的载荷**不**带 `sprite` 外壳（`.cs` 只认 `{path, color, sortingOrder}`）；
 * 两者的差异由本函数自己的测试钉住（`payload` 与 `intent` 的断言各一条）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, path?: string,
 *   color?: {r:number,g:number,b:number,a?:number}, sortingOrder?: number, _call?: typeof call}} [opts]
 * @returns {Promise<object>} 信封（成功时 `verified` 为布尔，绝非 null）
 */
async function spriteSet({ projectPath, env, path: nodePath, color, sortingOrder, _call } = {}) {
  if (typeof nodePath !== 'string' || nodePath === '') {
    return fail({
      code: 'MISSING_PATH',
      message: '缺少 --path（形如 Canvas/Brick_0_0）',
      actual: { path: nodePath },
      hint: ['用 `unity scene tree` 取可用路径'],
    });
  }
  if (!isValidColor(color)) {
    return fail({
      code: 'BAD_COLOR',
      message: '--color 需要 #RGB / #RRGGBB / #RRGGBBAA 形式的合法颜色',
      actual: { color },
      hint: ['用法：--color \'#00FFC8\'（8 位写法带 alpha：\'#00FFC880\'）'],
    });
  }
  if (sortingOrder !== undefined && !Number.isInteger(sortingOrder)) {
    return fail({
      code: 'BAD_SORTING_ORDER',
      message: '--sorting-order 需要整数',
      actual: { sortingOrder },
      hint: ['用法：--sorting-order 0'],
    });
  }

  const intent = { sprite: { color: { r: color.r, g: color.g, b: color.b, ...(color.a === undefined ? {} : { a: color.a }) } } };
  if (sortingOrder !== undefined) intent.sprite.sortingOrder = sortingOrder;

  const payload = { path: nodePath, color: { ...color } };
  if (sortingOrder !== undefined) payload.sortingOrder = sortingOrder;

  const callFn = _call || call;
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('sprite-set', payload), { projectPath, env });
  } catch (err) {
    return fail({
      code: 'WRITE_CALL_FAILED',
      message: `sprite-set 写调用失败：${(err && err.message) || String(err)}`,
      intent,
      hint: [
        '写入是否生效未知；用 `unity node inspect` 复核该节点的 components/sprite',
        '确认编辑器已打开目标项目（用 `unity doctor` 查看环境）',
      ],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  if (!envl.ok) return envl;
  // R207：不再裸用 `parseNodeResult(w)` —— 给它传被查的 `path`，使 NOT_FOUND 的 `actual` 带 `{path}`
  // （与 T3 的 nodeDelete 同一口径，M1 R69），而不是原样的 `{__error:'NOT_FOUND'}`。
  const res = parseNodeResult(w, { path: nodePath });
  if (res.envelope) return res.envelope;

  let r;
  try {
    r = await verifyWrite({
      intent,
      readActual: async () => {
        const read = await nodeInspect({ projectPath, env, path: nodePath, _call: callFn });
        if (!read.ok) {
          const err = new Error(`读回失败（${read.code}）：${read.message}`);
          err.envelope = read;
          throw err;
        }
        return read.actual;
      },
    });
  } catch (err) {
    const read = err && err.envelope;
    return fail({
      code: 'READBACK_FAILED',
      message: read ? `写后读回失败（${read.code}）：${read.message}` : `写后读回失败：${(err && err.message) || String(err)}`,
      intent,
      actual: read ? read.actual : null,
      hint: [
        ...(read && Array.isArray(read.hint) && read.hint.length ? read.hint : ['读回动作本身失败，写入结果未知；用 `unity node inspect` 复核该节点']),
        '写入可能已生效；sprite 的纹理由运行时创建（HideAndDontSave），**不随场景保存** —— 场景重开后需重跑本命令或由游戏脚本在运行时生成',
      ],
      phase: 'readback',
    });
  }
  return {
    ...ok(r.actual, {
      verified: r.mismatches.length === 0,
      intent,
      hint: r.mismatches.length
        ? ['读回结果与意图不一致（verified:false）——检查该节点是否真有 SpriteRenderer、颜色是否被改写；逐条查 mismatches']
        : [],
    }),
    mismatches: r.mismatches,
  };
}

module.exports = { spriteSet, isValidColor, SCRIPTS_DIR };
```

> ⚠️ `lib/sprite.js` 依赖 `lib/scene.js` 的既有导出 `buildPayloadArgs` / `nodeInspect` / `parseNodeResult`。为了避免在 `sprite.js` 里重抄一遍「脚本结果解析 + 错误映射」，本任务把 `nodeInspect` 的解析语义抽成一个**共享** helper 并加进 `scene.js` 的导出：

```js
// 追加到 lib/scene.js（放在 parseScriptResult 之后）
/**
 * 只解析「成功脚本的 JSON 载荷」，不做额外的错误文案映射 —— 供不需要自定义 describeError
 * 的调用方（如 `lib/sprite.js`）复用，避免第三份 `JSON.parse(r.json.Result)`。
 * `__error` 统一走 `parseScriptResult`；**`NOT_FOUND` 特殊**：`actual` 带被查的 `path`
 * （R207 / M1 R69 口径），所以调用方必须把 `path` 传进来。
 *
 * @param {object} r `call()` 返回值
 * @param {{path?: string}} [opts] 被查节点路径（`NOT_FOUND` 的 `actual` 用它）
 */
function parseNodeResult(r, { path } = {}) {
  return parseScriptResult(r, {
    label: 'sprite-set',
    describeError: (code) => (code === 'NOT_FOUND'
      ? {
        message: `节点不存在：${path}`,
        actual: { path },
        hint: [
          '用 `unity scene tree` 查看可用路径',
          '仅查当前激活场景（含 inactive 节点）；其它场景/DontDestroyOnLoad 里的节点会报 NOT_FOUND',
        ],
      }
      : undefined),
  });
}
```

`bin/unity.js` 的 `COMMANDS` 里加：

```js
  sprite: async (rest) => {
    const [action, ...opts] = rest;
    const { parseArgs } = require('../lib/args.js');
    const args = parseArgs(opts);
    // R203：局部 require（同上，顶层没有 emit/exitCodeFor）
    const { emit, exitCodeFor } = require('../lib/envelope.js');
    if (action !== 'set') {
      process.stderr.write('usage: unity sprite set --path <p> --color <#hex> [--sorting-order <n>]\n');
      return 2;
    }
    const { spriteSet } = require('../lib/sprite.js');
    const { parseHexColor } = require('../lib/color.js');
    const e = await spriteSet({
      projectPath: args['project-path'],
      path: args.path,
      // `--color` 裸写 → parseArgs 给布尔 true → parseHexColor 判 null → BAD_COLOR（用法错，退出码 2）
      color: parseHexColor(args.color) ?? { bad: args.color },
      sortingOrder: args['sorting-order'] === undefined
        ? undefined
        : (/^-?\d+$/.test(args['sorting-order']) ? Number(args['sorting-order']) : args['sorting-order']),
    });
    emit(e, { json: Boolean(args.json) });
    return exitCodeFor(e);
  },
```

> 注意：`parseHexColor(args.color) ?? { bad: … }` 把非法/缺省值统一变成**非合法颜色对象**，让守卫落在 `lib/sprite.js`（而不是在 CLI 里再写一份颜色校验），既保证 `BAD_COLOR` 唯一产出点，也让裸写与非法值走同一条路。

`USAGE` 加：

```
  sprite set             给节点挂运行时纯色 sprite（写后读回：颜色/排序层）
    --path <p>           必填：目标节点路径（形如 Bricks/Brick_0_0）
    --color <#hex>       必填：#RGB / #RRGGBB / #RRGGBBAA
    --sorting-order <n>  可选：整数
                         ⚠️ 尺寸不是本命令的参数：用 `node set --patch '{"scale":{"x":1.6,"y":0.5,"z":1}}'`
                         ⚠️ 基础 sprite 是 1x1 世界单位，所以 localScale = 世界尺寸
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/sprite.test.js` → PASS（10 条）。
运行：`npm test` → PASS（本任务新增 10 条 → 总数应为 258；以实际为准）。

- [ ] **步骤 5：真机验证（必做 —— 这是 M2 的第一条验收：视觉闭环）**

在 `S0Project` 上端到端跑，**每条命令的真实输出、退出码、截图路径都要贴进报告**：

```bash
P=C:/Users/<用户>/pi-unity-spike/S0Project
S=C:/Users/<用户>/pi-unity-spike/m2-shots
md5sum "$P/Assets/Scenes/SampleScene.scene" > /tmp/before.md5
node bin/unity.js doctor --project-path $P                       # 退出码 0
node bin/unity.js node create --project-path $P --name __pi_visual --components '["SpriteRenderer"]'
node bin/unity.js sprite set --project-path $P --path __pi_visual --color '#FF2E88'
node bin/unity.js node set --project-path $P --path __pi_visual --patch '{"position":{"x":0,"y":0,"z":0},"scale":{"x":6,"y":6,"z":1}}'
node bin/unity.js node inspect --project-path $P --path __pi_visual --json
node bin/unity.js shot --project-path $P --out $S --json          # EditMode → window 模式
# ↑ 从返回的 actual.path 取图，然后：
node bin/unity.js pixels --file "<上一步的 actual.path>" --region 420,160,60,40 --expect '#FF2E88' --tolerance 16 --json ; echo "exit=$?"
node bin/unity.js pixels --file "<上一步的 actual.path>" --count-color '#FF2E88' --tolerance 16 --json
node bin/unity.js node delete --project-path $P --path __pi_visual
md5sum "$P/Assets/Scenes/SampleScene.scene" > /tmp/after.md5 && diff /tmp/before.md5 /tmp/after.md5 && echo "场景未被保存"
```

**判据（全过才算完成）**：
**判据（全过才算完成）**：
1. `sprite set` → `verified:true`（`actual.sprite.color` = `{r:255,g:46,b:136,a:255}`）；
2. `node inspect --json` 的 `actual.sprite.present === true`、`components` 含 `SpriteRenderer`；
3. **`pixels --region … --expect '#FF2E88'` 退出码 0**（画面正中确实有一块品红）—— 这是「截图里真的看得见」的硬证据；
4. `--count-color '#FF2E88'` 的 `count > 0`（把实际数字写进报告）；
5. **用 `read` 工具真的打开 PNG 看一眼**，确认是「大面积纯色块 + 周围背景」，并在报告里写出你看到的东西；
6. `node delete` → `verified:true`；`md5sum` 前后一致（**没有保存场景**）；
7. **声明**：`window` 模式下图片**含 Game 视图工具栏**（实测工具栏是 `[60,60,60]`，见任务 4 的 fixture），所以取样点要落在画面中心区域而不是图片正中心像素；`rendering` 模式的坐标纯净性由任务 11 验证。

**如果 `--expect` 没命中**：先按 `--tolerance` 放宽到 48 再试一次；再不行就用 `--region` 打印真实平均色，把**实测色值**与 `#FF2E88` 的差值写进报告，并在 `docs/PITFALLS.md` 加一条 U 条目（标注「Linear 色彩空间下渲染回读的色偏」+ 适用引擎）。**不许**把没命中的情况写成通过。

- [ ] **步骤 6：Commit**

```bash
git add unity-scripts/sprite-set.cs unity-scripts/node-inspect.cs lib/sprite.js lib/scene.js \
        bin/unity.js test/sprite.test.js
git commit -m "feat(sprite): unity sprite set（运行时纯色 sprite + 写后读回）+ node-inspect 的 sprite 字段"
```

---

## 任务 6：`unity shot --capture-mode` / `--match-mode` 接线 + 坐标元数据（集成）

**文件：**
- 修改：`lib/shot.js`
- 修改：`bin/unity.js`（USAGE；`--match-mode` / `--capture-mode` 的「未接线」那句删掉）
- 修改：`skills/unity-game-dev/SKILL.md`（两处「未接线」文本 —— 见下方 R204 清单）
- 测试：`test/shot.test.js`（除新增用例外，**还要改掉 R110①② 那条断言「必须写需裸 uloop」的用例**）

**R204（三处「未接线」文本必须**本任务内**一起清掉，否则仓库自相矛盾）：**
1. `lib/shot.js` 的失败 hint **出路②③**（现文：「出路②：进入 PlayMode 后重拍 —— 需**裸 uloop**（`unity shot` 未接线 `--capture-mode`…）」「出路③：…需**裸 uloop**（`unity shot` 未接线 `--match-mode`…）」）→ 改成已接线的等价表述（见步骤 3 的第 6 条），并把它们上方那句注释（「②③ 必须写明**需裸 uloop**」）一起改掉；
2. `skills/unity-game-dev/SKILL.md` 里两句：§1 附近的「`--match-mode` / `--capture-mode` 接线。需要时用**裸 uloop**」与 §4 的「**要切 `--match-mode` / `--capture-mode` 只能用裸 uloop**（本命令未接线，传了会被静默忽略）」
3. `test/shot.test.js` 的 `R110①②` 用例（`shot 的 hint 写明 --capture-mode / --match-mode 需裸 uloop…`）→ 改成已接线的等价断言（见步骤 1 末）。

> 为什么必须同任务清理：T12 的盲测判据 2 要求 `shot --capture-mode rendering`，且禁止裸 uloop；三处旧文本会让 agent 以为该开关仍未接线。

**决策与依据（每条都有 vendor 出处）：**
- `--capture-mode` 枚举 `auto|window|rendering|GameView`：**出处** `vendor/uloopmcp/Editor/FirstPartyTools/Screenshot/Skill/SKILL.md:24`（`auto` - rendering in PlayMode and window otherwise；`rendering` - 仅游戏渲染，**需 PlayMode**；`GameView` 是 `rendering` 的别名）。
- `--match-mode` 枚举 `exact|prefix|contains`：**出处** 同上 `:23`（`Ignored when the resolved capture mode is rendering`）。
- **EditMode 下仍然要靠本地化窗口名**（M1 的 U7 结论不变）：只有 `rendering` 才忽略窗口名，而 `rendering` 要求 PlayMode。所以「EditMode 想截图」= 本地化名 + 可选 `--match-mode contains/prefix`。
- M1 把「多窗口与坐标元数据（`ScreenshotCount` / `ScreenshotToInputFormula` / `GameViewWidth|Height`）」丢弃了，M2 的 `simulate-mouse-*` 需要它 → 本任务把它们**additive** 地放进 `actual`（`lib/shot.js` 的既有字段 `path`/`width`/`height`/`captureMode` 一字不改）。
- 字段出处：`vendor/uloopmcp/Editor/ToolContracts/ScreenshotResponse.cs`（顶层 `Screenshots` / `TimedOut` / `Message` / `Warning` / `ResolvedCaptureMode` / `ScreenshotCount`，每张图的 `ImagePath` / `FileSizeBytes` / `Width` / `Height` / `ImageCoordinateSystem` / `ResolutionScale` / `ImageToInputOffsetY` / `GameViewWidth` / `GameViewHeight` / `ScreenshotToInputFormula` / `UnityInputFormula` / `AnnotatedElements`）。

- [ ] **步骤 1：编写失败的测试**

追加到 `test/shot.test.js`：

```js
// ─────────────────── M2 任务 6：--capture-mode / --match-mode / 坐标元数据 ───────────────────

const { validateCaptureMode, validateMatchMode } = require('../lib/shot.js');

test('capture/m match 枚举校验：合法值原样返回，非法返回 null', () => {
  assert.strictEqual(validateCaptureMode('auto'), 'auto');
  assert.strictEqual(validateCaptureMode('rendering'), 'rendering');
  assert.strictEqual(validateCaptureMode('GameView'), 'GameView', 'GameView 是 rendering 的别名，大小写敏感（上游枚举字面量）');
  assert.strictEqual(validateCaptureMode('bogus'), null);
  assert.strictEqual(validateCaptureMode(undefined), 'auto', '缺省即 auto');
  assert.strictEqual(validateCaptureMode(true), null, '裸写 --capture-mode 是用法错');
  assert.strictEqual(validateMatchMode('contains'), 'contains');
  assert.strictEqual(validateMatchMode('bogus'), null);
  assert.strictEqual(validateMatchMode(undefined), 'exact');
});

test('shot 把 capture/m match 传给 uloop，且只在显式给出时传（默认不传 = 保持 M1 行为）', async () => {
  const spy = [];
  const e = await shot({
    projectPath: 'X', windowName: 'Game', captureMode: 'rendering', matchMode: 'contains', appData: enAppData(),
    _call: fakeCall({ Success: true, Screenshots: [{ ImagePath: 'C:/a.png', Width: 960, Height: 640 }] }, spy),
  });
  assert.strictEqual(e.ok, true);
  assert.deepStrictEqual(spy[0].args, ['--window-name', '游戏', '--capture-mode', 'rendering', '--match-mode', 'contains']);

  const spy2 = [];
  await shot({
    projectPath: 'X', windowName: 'Game', appData: enAppData(),
    _call: fakeCall({ Success: true, Screenshots: [{ ImagePath: 'C:/a.png', Width: 960, Height: 640 }] }, spy2),
  });
  assert.deepStrictEqual(spy2[0].args, ['--window-name', '游戏'], 'M1 行为：不传这两个开关时 argv 必须逐字不变');
});

test('shot 拒绝枚举外取值：BAD_CAPTURE_MODE / BAD_MATCH_MODE（用法错，退出码 2），不调 uloop', async () => {
  for (const [opt, code] of [
    [{ captureMode: 'nope' }, 'BAD_CAPTURE_MODE'],
    [{ matchMode: 'nope' }, 'BAD_MATCH_MODE'],
    [{ captureMode: true }, 'BAD_CAPTURE_MODE'],
    [{ matchMode: true }, 'BAD_MATCH_MODE'],
  ]) {
    const spy = [];
    const e = await shot({ projectPath: 'X', appData: enAppData(), _call: fakeCall({ Success: true }, spy), ...opt });
    assert.strictEqual(e.code, code, `${JSON.stringify(opt)} 应落 ${code}`);
    assert.strictEqual(spy.length, 0, '用法错必须在调用之前挡下');
    assert.strictEqual(exitCodeFor(e), 2);
  }
});

test('shot 的 actual 暴露渲染坐标元数据（additive，M1 字段不变）', async () => {
  const json = {
    Success: true,
    ResolvedCaptureMode: 'rendering',
    ScreenshotCount: 1,
    TimedOut: false,
    Screenshots: [{
      ImagePath: 'C:/a.png',
      Width: 960,
      Height: 640,
      FileSizeBytes: 12345,
      ResolutionScale: 1,
      ImageCoordinateSystem: 'top-left-game-view',
      ImageToInputOffsetY: 0,
      GameViewWidth: 960,
      GameViewHeight: 640,
      ScreenshotToInputFormula: 'simulate_mouse_x = image_x / resolutionScale;',
      UnityInputFormula: 'unity_x = input_x;',
      AnnotatedElements: [{ Name: 'A' }, { Name: 'B' }],
    }],
  };
  const e = await shot({ projectPath: 'X', appData: enAppData(), _call: fakeCall(json) });
  assert.strictEqual(e.actual.path, 'C:/a.png');
  assert.strictEqual(e.actual.width, 960);
  assert.strictEqual(e.actual.height, 640);
  assert.strictEqual(e.actual.captureMode, 'rendering');
  assert.strictEqual(e.actual.windowName, '游戏');
  assert.strictEqual(e.actual.screenshotCount, 1);
  assert.strictEqual(e.actual.fileSizeBytes, 12345);
  assert.strictEqual(e.actual.imageCoordinateSystem, 'top-left-game-view');
  assert.strictEqual(e.actual.gameViewWidth, 960);
  assert.strictEqual(e.actual.gameViewHeight, 640);
  assert.strictEqual(e.actual.imageToInputOffsetY, 0);
  assert.match(e.actual.screenshotToInputFormula, /simulate_mouse_x/);
  assert.strictEqual(e.actual.annotatedElementCount, 2);
  assert.strictEqual(e.actual.timedOut, false);
});

test('shot 顶层 TimedOut:true 且 Success:true → 加 hint（不谎称一定拿到新帧）', async () => {
  const e = await shot({
    projectPath: 'X', appData: enAppData(),
    _call: fakeCall({ Success: true, TimedOut: true, Screenshots: [{ ImagePath: 'C:/a.png', Width: 1, Height: 1 }] }),
  });
  assert.strictEqual(e.ok, true);
  assert.ok(e.hint.some((h) => /TimedOut|超时/.test(h)), `hint 必须提到超时：${JSON.stringify(e.hint)}`);
});

test('CLI shot --capture-mode bogus → 退出码 2 且 code=BAD_CAPTURE_MODE', async () => {
  const { result, out } = await captureStdout(() => main(['shot', '--project-path', 'X', '--capture-mode', 'bogus', '--json']));
  assert.strictEqual(result, 2);
  assert.strictEqual(JSON.parse(out).code, 'BAD_CAPTURE_MODE');
});
```

> 复用 `test/shot.test.js` 已有的 helper：`fakeCall(json, spy)`（文件第 60 行附近）、`enAppData()` / `zhAppData()`（第 71 行附近）、`captureStdout` / `withScriptedDispatcher` / `withEnv`。新用例还要把 `exitCodeFor` 加进本文件顶部对 `../lib/envelope.js` 的 require。

**R204③：改掉既有断言（这是本任务必须做的行为变更，不是新增用例）** —— `test/shot.test.js` 里那条
`test('shot 的 hint 写明 --capture-mode / --match-mode 需裸 uloop（shot 未接线，R110①）', …)`（文件第 434–448 行附近）
断言的是「**必须写未接线**」，接线后必红。改成已接线的等价断言（用例标题同步改）：

```js
// R204③：接线后出路仍要在，但不再声称「未接线 / 需裸 uloop」——而是给出可用的 unity shot 写法。
test('shot 的 hint 给出 --capture-mode / --match-mode 的**已接线**出路（R110① / M2 接线后）', async () => {
  const e = await shot({
    projectPath: 'X', appData: zhAppData(), windowName: 'Game',
    _call: fakeCall({ Success: false, Message: "Window '游戏' not found (MatchMode: exact)" }),
  });
  const captureHints = e.hint.filter((h) => /capture-mode/.test(h));
  const matchHints = e.hint.filter((h) => /--match-mode/.test(h));
  assert.ok(captureHints.length > 0, '仍有 PlayMode（capture-mode）出路');
  assert.ok(matchHints.length > 0, '仍有 match-mode 出路');
  // 接线后：出路必须教用户用 `unity shot` 自己的开关（M2 起可用），不得再叫用户去裸 uloop
  assert.ok(captureHints.some((h) => /unity shot/.test(h) && /--capture-mode/.test(h)), '②必须给出已接线的 unity shot 写法');
  assert.ok(matchHints.some((h) => /unity shot/.test(h) && /--match-mode/.test(h)), '③必须给出已接线的 unity shot 写法');
  assert.ok(!captureHints.some((h) => /未接线|需\*\*裸 uloop\*\*/.test(h)), '②不得再声称未接线');
  assert.ok(!matchHints.some((h) => /未接线|需\*\*裸 uloop\*\*/.test(h)), '③不得再声称未接线');
});
```

> 注：枚举标题里的行号（434–448）以本任务执行时的实际文件为准（M1 之后可能已微移）。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/shot.test.js`
预期：FAIL —— `validateCaptureMode is not a function` / `validateMatchMode is not a function`（各 1–2 条）；枚举外取值当前会**静默透传**给 uloop（`spy.length` 不为 0）。

- [ ] **步骤 3：编写最少实现代码**

`lib/shot.js`：

1. 在 `ZH` 表之后加枚举校验（**唯一产出点**）：

```js
/** `--capture-mode` 的合法取值（上游枚举字面量，大小写敏感；出处见 Screenshot/Skill/SKILL.md:24）。 */
const CAPTURE_MODES = ['auto', 'window', 'rendering', 'GameView'];

/** `--match-mode` 的合法取值（出处同上 :23）。 */
const MATCH_MODES = ['exact', 'prefix', 'contains'];

/** 缺省 `auto`；非法（含裸写 `true`）返回 `null` → 调用方落 `BAD_CAPTURE_MODE`。 */
function validateCaptureMode(v) {
  if (v === undefined) return 'auto';
  return typeof v === 'string' && CAPTURE_MODES.includes(v) ? v : null;
}

/** 缺省 `exact`；非法返回 `null` → 调用方落 `BAD_MATCH_MODE`。 */
function validateMatchMode(v) {
  if (v === undefined) return 'exact';
  return typeof v === 'string' && MATCH_MODES.includes(v) ? v : null;
}
```

2. `shot()` 的签名与开头加两个守卫（放在 `--window-name` / `--out` 守卫**之前**，因为它们是纯 argv 形状问题）：

```js
async function shot({
  projectPath, env, outDir, windowName = 'Game', captureMode, matchMode, appData, _call,
} = {}) {
  const cm = validateCaptureMode(captureMode);
  if (cm === null) {
    return fail({
      code: 'BAD_CAPTURE_MODE',
      message: `--capture-mode 取值非法：${JSON.stringify(captureMode)}`,
      actual: { captureMode, allowed: [...CAPTURE_MODES] },
      hint: [
        `合法取值：${CAPTURE_MODES.join(' | ')}`,
        'rendering / GameView 需要 PlayMode；EditMode 下只能用 auto（→ window）或 window',
        '出处：上游 Screenshot skill 的参数表（本仓库 docs/PITFALLS.md U7 记录了实测行为）',
      ],
    });
  }
  const mm = validateMatchMode(matchMode);
  if (mm === null) {
    return fail({
      code: 'BAD_MATCH_MODE',
      message: `--match-mode 取值非法：${JSON.stringify(matchMode)}`,
      actual: { matchMode, allowed: [...MATCH_MODES] },
      hint: [`合法取值：${MATCH_MODES.join(' | ')}`, 'match-mode 只在 window 捕获模式下生效（rendering 会忽略窗口名）'],
    });
  }
  // …（原有的 windowName / outDir 守卫不变）
```

3. argv 拼装改成（**只在显式给出时传**，保证不改变 M1 的默认 argv 逐字行为）：

```js
  const args = [];
  if (outDir) args.push('--output-directory', outDir);
  args.push('--window-name', tried);
  if (captureMode !== undefined) args.push('--capture-mode', cm);
  if (matchMode !== undefined) args.push('--match-mode', mm);
```

4. 成功分支的 `actual` 改成（M1 四个字段逐字保留，其余 additive）：

```js
  const s = Array.isArray(r.json.Screenshots) ? r.json.Screenshots[0] : null;
  const hint = [];
  if (r.json.TimedOut === true) {
    hint.push('上游报告 TimedOut:true —— 这次截图可能没有拿到新帧；先用 `uloop control-play-mode --action Step`（或 `unity play step`）步进一帧再重拍');
  }
  const warning = r.json.Warning;
  if (typeof warning === 'string' && warning !== '') {
    hint.push(`上游警告：${warning}`);
    hint.push('若画面是暂停前的旧帧，用 `unity play step` 步进一帧后重拍');
  }
  return ok({
    ...picked,
    captureMode: r.json.ResolvedCaptureMode ?? null,
    windowName: tried,
    screenshotCount: typeof r.json.ScreenshotCount === 'number' ? r.json.ScreenshotCount : null,
    fileSizeBytes: typeof s.FileSizeBytes === 'number' ? s.FileSizeBytes : null,
    resolutionScale: typeof s.ResolutionScale === 'number' ? s.ResolutionScale : null,
    imageCoordinateSystem: s.ImageCoordinateSystem ?? null,
    imageToInputOffsetY: typeof s.ImageToInputOffsetY === 'number' ? s.ImageToInputOffsetY : null,
    gameViewWidth: typeof s.GameViewWidth === 'number' ? s.GameViewWidth : null,
    gameViewHeight: typeof s.GameViewHeight === 'number' ? s.GameViewHeight : null,
    screenshotToInputFormula: s.ScreenshotToInputFormula ?? null,
    unityInputFormula: s.UnityInputFormula ?? null,
    annotatedElementCount: Array.isArray(s.AnnotatedElements) ? s.AnnotatedElements.length : null,
    timedOut: r.json.TimedOut === true,
  }, { hint });
```

> 注意：`picked` 仍由 `pickScreenshot(r.json)` 提供（`path`/`width`/`height`），**不要**改成从 `s` 直接取 —— `pickScreenshot` 的「无 `ImagePath` 即失败（`NO_SCREENSHOT`）」判据必须保留。

5. `module.exports` 加 `validateCaptureMode, validateMatchMode, CAPTURE_MODES, MATCH_MODES`。

6. **R204①：改写 `lib/shot.js` 的失败 hint 出路②③**（连同它们上方那句注释）。逐字改成：

```js
      // R204：这两个开关**已在 M2 接线**（本任务）——出路必须给出 `unity shot` 自己的写法，
      // 不得再声称「未接线 / 需裸 uloop」：旧措辞会让 agent 绕过 CLI 去调裸 uloop，而 T12 的盲测
      // 判据 2 禁止裸 uloop（且要求 `shot --capture-mode rendering`）。
      hint.push('出路②：进入 PlayMode 后重拍 —— 用 `unity shot --capture-mode rendering`（已接线；'
        + '`--capture-mode auto` 在 PlayMode 下也解析为 rendering，此时窗口名被忽略。上游 SKILL.md:24）');
      hint.push('出路③：用 `unity shot --match-mode contains|prefix` 做片段匹配（已接线；上游真实旋钮，SKILL.md:23）');
```

7. **R204②：改 `skills/unity-game-dev/SKILL.md` 的两处旧文本**：
   - 命令表下方那句「`--match-mode` / `--capture-mode` **接线**。需要时用**裸 uloop**（…）」中删掉这两个开关（M1 还没的列表里它们已过时），并在命令表里把 `unity shot` 那行的参数面改成 `[--out <dir>] [--window-name <n>] [--capture-mode <m>] [--match-mode <m>]`；
   - §4 第 3 条「**要切 `--match-mode` / `--capture-mode` 只能用裸 uloop**（本命令未接线，传了会被静默忽略）」→ 整条改成：「**要切 `--capture-mode` / `--match-mode` 直接用 `unity shot` 的开关**（M2 已接线；`rendering`/`GameView` 需 PlayMode，`--match-mode` 仅在 window 模式生效）」。

`bin/unity.js` 的 `shot` 分支加两个透传：

```js
      captureMode: args['capture-mode'],
      matchMode: args['match-mode'],
```

`USAGE` 的 `shot` 段把「**未接线**」那句删掉，改成：

```
  --capture-mode <m>     auto|window|rendering|GameView（缺省 auto：EditMode→window，PlayMode→rendering）
                         rendering/GameView 需要 PlayMode；rendering 会忽略 --window-name
  --match-mode <m>       exact|prefix|contains（缺省 exact；仅 window 模式生效）
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/shot.test.js` → PASS。
运行：`npm test` → PASS（本任务新增 6 条 → 总数应为 264；以实际为准）。

- [ ] **步骤 5：真机验证（必做）**

```bash
P=C:/Users/<用户>/pi-unity-spike/S0Project
S=C:/Users/<用户>/pi-unity-spike/m2-shots
# ① EditMode + window + match-mode contains（本地化名仍要被用上）
node bin/unity.js shot --project-path $P --out $S --window-name Game --capture-mode window --match-mode contains --json ; echo "exit=$?"
# ② 反例：EditMode 下强行 rendering → 必须失败（上游要求 PlayMode）
node bin/unity.js shot --project-path $P --out $S --capture-mode rendering --json ; echo "exit=$?"
# ③ PlayMode + rendering（用裸 uloop 进 PlayMode，避免与任务 7 耦合）
"C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe" --project-path $P control-play-mode --action Play
node bin/unity.js shot --project-path $P --out $S --capture-mode rendering --json ; echo "exit=$?"
"C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe" --project-path $P control-play-mode --action Stop
```

判据（把真实输出与退出码全部贴进报告）：
1. ① 成功，`actual.captureMode === 'window'`，`actual.windowName === '游戏'`（**EditMode 下仍需本地化名**），`actual.screenshotCount >= 1`；
2. ② **失败**（上游要求 PlayMode）→ 记录真实错误码与报文；若它居然成功，**如实记录**并注明「EditMode 也能 rendering」；
3. ③ 的 `actual.captureMode === 'rendering'`，且 `actual.gameViewWidth/gameViewHeight` 有数值、`actual.screenshotToInputFormula` 非空 —— 这三项是任务 7 的输入；
4. 用 `read` 打开 ③ 的图，确认是**无工具栏的游戏画面**（与 ① 的图对比：① 顶部有 `[60,60,60]` 工具栏带）。
5. **报告必须写明**：本次 PlayMode 进出是否让 `SampleScene.scene` 的 md5 发生变化（在 ③ 前后各取一次 md5）—— 这直接决定任务 7/11 的「Play 会不会静默保存场景」结论。

- [ ] **步骤 6：Commit**

```bash
git add lib/shot.js bin/unity.js test/shot.test.js skills/unity-game-dev/SKILL.md
git commit -m "feat(shot): --capture-mode/--match-mode 接线 + 渲染坐标元数据（additive）"
```

---

## 任务 7：`unity play` 试玩闭环（集成）

**文件：**
- 创建：`lib/play.js`
- 修改：`bin/unity.js`（`play` 命令 + USAGE）
- 创建：`test/play.test.js`

**第一步是真机/文档探测（全局约束 17 + 任务的硬性要求 7）——先做它，再写代码**：

```bash
P=C:/Users/<用户>/pi-unity-spike/S0Project
U=C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe
"$U" --project-path $P simulate-keyboard --action ReleaseAll ; echo "keyboard_exit=$?"
"$U" --project-path $P simulate-mouse-input --action Click --x 10 --y 10 ; echo "mouseinput_exit=$?"
"$U" --project-path $P simulate-mouse-ui --action Click --x 10 --y 10 ; echo "mouseui_exit=$?"
```

**文档侧已确定的实证（写进报告，不必再猜）**：
- `simulate-keyboard` / `simulate-mouse-input`（真实注入）在**没装 Input System** 时的失败报文逐字是
  `simulate-keyboard requires the Input System package (com.unity.inputsystem). Install it via Package Manager and set Active Input Handling to 'Input System Package (New)' or 'Both' in Player Settings.`
  —— 出处 `vendor/uloopmcp/Editor/FirstPartyTools/Common/InputSystem/InputSystemPackageRequirementMessage.cs:11-17` +
  分支位置 `.../SimulateKeyboard/SimulateKeyboardUseCase.cs:44-52`（`#if !ULOOP_HAS_INPUT_SYSTEM` 时**先于 PlayMode preflight** 返回）。
  S0Project / 盲测项目的 `ProjectSettings.asset` 实测 `activeInputHandler: 0`（只有 legacy Input）→ **预期本机会命中这条**。
- `simulate-mouse-ui` **不需要** Input System，但它的射线只遍历 **ScreenSpaceOverlay + GraphicRaycaster 的 uGUI**
  （`vendor/uloopmcp/Editor/FirstPartyTools/Common/MouseUi/UiRaycastHelper.cs:21-53`：只收集 `Canvas` + `GraphicRaycaster` + `Graphic`），
  并且要求场景里有 `EventSystem`（`MouseUiSimulationValidator.cs:29` 的报文 `No EventSystem found in the scene. ...`）。
  **→ 它对 `SpriteRenderer` 无效**（打砖块的方块是 sprite，不是 uGUI）。
- `simulate-mouse-input --dry-run` 不需要 Input System，但它用的是 **3D `Physics` 射线**（vendor SKILL 的 Dry-run 节），
  **打不到 2D 碰撞体** → 对 2D 打砖块无实用价值；本命令仍然接线（如实写进 hint）。

**两种结果的处置（照此实现，不许含糊）**：
- **结果 X（本机预期）**：探测返回 `Success:false` 且报文含 `requires the Input System package` → `play key` / `play mouse`（非 `--dry-run`）落
  `INPUT_SYSTEM_UNAVAILABLE`（`ok:false`，退出码 1），hint 给出两条出路（① 装包 + 把 Active Input Handling 改成
  `Input System Package (New)` 或 `Both`；② 用 `execute-dynamic-code` 直接注入状态，并**声明这是注入不是真实输入**）。
  **不得**假装可用、也不得静默降级成别的调用。
- **结果 Y（若真机撞上已装包的项目）**：把上游的诊断字段（`PressDeliveredToGame` / `PressEdgeObserved` /
  `ReleasedKeyStates` / `Warning`）原样透传进 `actual`，并在报告里贴一次真实的 `Press --key Space` 成功输出。
  若两个结果都没出现（第三种报文）→ **如实记录原文**，按 `INPUT_SYSTEM_UNAVAILABLE` 之外的原码失败，并把这条坑**追加到 `docs/PITFALLS.md` 文件末尾、不写 U 编号**（在报告里写「待编号的坑 + 一句话」；编号与索引表由任务 13 定稿，R213）。

- [ ] **步骤 1：编写失败的测试**

> ⚠️ **`_call` 注入缝的 spy 语义**：`spy[0].args` 是**工具级 argv**（不含 `--project-path`/工具名——那两样由 `lib/uloop.js` 的 `call()` 拼，注入缝绕过了它）；工具名在 `spy[0].tool`。所以断言写 `['--action','Play']` 而不是 `['--project-path','P','control-play-mode','--action','Play']`。

```js
// test/play.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { playMode, playClick, playMouse, playKey, playLogs, playView, isInputSystemMissing } = require('../lib/play.js');
const { exitCodeFor } = require('../lib/envelope.js');

function fakeCall(json, spy = []) {
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

const INPUT_SYSTEM_MSG = "simulate-keyboard requires the Input System package (com.unity.inputsystem). "
  + "Install it via Package Manager and set Active Input Handling to 'Input System Package (New)' or 'Both' in Player Settings.";

test('isInputSystemMissing 认出上游逐字报文（含大小写/前后缀干扰）', () => {
  assert.strictEqual(isInputSystemMissing(INPUT_SYSTEM_MSG), true);
  assert.strictEqual(isInputSystemMissing('simulate-mouse-input requires the Input System package (com.unity.inputsystem). x'), true);
  assert.strictEqual(isInputSystemMissing('requires the input system package'), true, '大小写不敏感');
  assert.strictEqual(isInputSystemMissing('No EventSystem found in the scene.'), false);
  assert.strictEqual(isInputSystemMissing(undefined), false);
});

test('playMode start 成功：intent {isPlaying:true} → verified:true，argv 用 --action Play', async () => {
  const spy = [];
  const e = await playMode({
    projectPath: 'P', action: 'Play',
    _call: fakeCall({ Success: true, IsPlaying: true, IsPaused: false, Changed: true, Message: 'Play mode started', Warning: 'fresh Play start from Edit-time scene state' }, spy),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(spy[0].args, ['--action', 'Play']);
  assert.strictEqual(e.actual.isPlaying, true);
  assert.strictEqual(e.actual.changed, true);
  assert.ok(e.hint.some((h) => /Edit-time|场景/.test(h)), '上游 Warning 必须进 hint');
});

test('playMode start 没能进入 PlayMode → verified:false（绝不假绿）', async () => {
  const e = await playMode({
    projectPath: 'P', action: 'Play',
    _call: fakeCall({ Success: true, IsPlaying: false, IsPaused: false, Changed: false, BlockedByUnsavedChanges: true, Message: 'blocked' }),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'isPlaying');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.hint.some((h) => /未保存|Untitled|保存/.test(h)), 'BlockedByUnsavedChanges 必须给可操作的 hint');
});

test('playMode stop 成功：intent {isPlaying:false}；status 不设 intent（verified:null）', async () => {
  const stop = await playMode({ projectPath: 'P', action: 'Stop', _call: fakeCall({ Success: true, IsPlaying: false, WasAlreadyStopped: false }) });
  assert.strictEqual(stop.verified, true);
  const status = await playMode({ projectPath: 'P', action: 'Status', _call: fakeCall({ Success: true, IsPlaying: true, IsPaused: false }) });
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.verified, null, 'Status 没有 intent，不许声称 verified');
  assert.strictEqual(status.actual.isPlaying, true);
});

test('playMode 非法 action / 非法 timeout → BAD_ACTION / BAD_TIMEOUT（用法错 2），不调 uloop', async () => {
  for (const [opts, code] of [
    [{ action: 'Nope' }, 'BAD_ACTION'],
    [{ action: 'Play', timeoutSeconds: '0' }, 'BAD_TIMEOUT'],
    [{ action: 'Play', timeoutSeconds: 'x' }, 'BAD_TIMEOUT'],
    [{ action: 'Play', timeoutSeconds: '1.5' }, 'BAD_TIMEOUT'],
  ]) {
    const spy = [];
    const e = await playMode({ projectPath: 'P', _call: fakeCall({ Success: true }, spy), ...opts });
    assert.strictEqual(e.code, code, `${JSON.stringify(opts)} 应落 ${code}`);
    assert.strictEqual(spy.length, 0);
    assert.strictEqual(exitCodeFor(e), 2);
  }
  // 合法的 timeout 透传
  const spy = [];
  await playMode({ projectPath: 'P', action: 'Play', timeoutSeconds: '30', _call: fakeCall({ Success: true, IsPlaying: true }, spy) });
  assert.deepStrictEqual(spy[0].args, ['--action', 'Play', '--timeout-seconds', '30']);
});

test('playKey 命中 Input System 缺失 → INPUT_SYSTEM_UNAVAILABLE + 两条出路 hint（绝不假装可用）', async () => {
  const e = await playKey({
    projectPath: 'P', action: 'Press', key: 'Space',
    _call: fakeCall({ Success: false, Message: INPUT_SYSTEM_MSG, Action: 'Press' }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'INPUT_SYSTEM_UNAVAILABLE');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.hint.some((h) => /com\.unity\.inputsystem/.test(h)));
  assert.ok(e.hint.some((h) => /execute-dynamic-code/.test(h)), '第二条出路：用 execute-dynamic-code 注入（并声明是注入）');
  assert.strictEqual(e.actual.upstreamMessage, INPUT_SYSTEM_MSG, '上游原文不得丢');
});

test('playKey ReleaseAll 不需要 --key；Press 缺 --key → MISSING_KEY（用法错 2）', async () => {
  const spy = [];
  const okRelease = await playKey({ projectPath: 'P', action: 'ReleaseAll', _call: fakeCall({ Success: true, Message: 'released', ReleasedKeys: ['W'] }, spy) });
  assert.strictEqual(okRelease.ok, true);
  assert.deepStrictEqual(spy[0].args, ['--action', 'ReleaseAll']);

  const bad = await playKey({ projectPath: 'P', action: 'Press', _call: fakeCall({ Success: true }, []) });
  assert.strictEqual(bad.code, 'MISSING_KEY');
  assert.strictEqual(exitCodeFor(bad), 2);
});

test('playKey Press 成功：--key/--duration 透传 + 诊断字段进 actual', async () => {
  const spy = [];
  const e = await playKey({
    projectPath: 'P', action: 'Press', key: 'Space', duration: '0.2',
    _call: fakeCall({ Success: true, Action: 'Press', KeyName: 'Space', PressDeliveredToGame: true, PressEdgeObserved: false, Message: 'pressed' }, spy),
  });
  assert.deepStrictEqual(spy[0].args, ['--action', 'Press', '--key', 'Space', '--duration', '0.2']);
  assert.strictEqual(e.verified, null, '动作型命令没有可比对的 intent');
  assert.strictEqual(e.actual.pressEdgeObserved, false);
  assert.ok(e.hint.some((h) => /PressEdgeObserved/.test(h)), 'PressEdgeObserved=false 必须提示「游戏循环可能没看到这次按键」');
});

test('playClick：--x/--y 必填（缺 → BAD_COORD 2）；Drag 需要 --from-x/--from-y', async () => {
  const missing = await playClick({ projectPath: 'P', action: 'Click', _call: fakeCall({ Success: true }, []) });
  assert.strictEqual(missing.code, 'BAD_COORD');
  assert.strictEqual(exitCodeFor(missing), 2);

  const drag = await playClick({ projectPath: 'P', action: 'Drag', x: '10', y: '20', _call: fakeCall({ Success: true }, []) });
  assert.strictEqual(drag.code, 'BAD_COORD');
  assert.match(drag.message, /from-x/);

  const spy = [];
  const ok = await playClick({
    projectPath: 'P', action: 'Click', x: '267', y: '167', targetPath: 'Canvas/Btn',
    _call: fakeCall({ Success: true, Action: 'Click', HitGameObjectName: 'Btn', PositionX: 267, PositionY: 167, Message: 'Clicked' }, spy),
  });
  assert.deepStrictEqual(spy[0].args, ['--action', 'Click', '--x', '267', '--y', '167', '--target-path', 'Canvas/Btn']);
  assert.strictEqual(ok.actual.hitGameObjectName, 'Btn');
});

test('playClick 命中空场景（无 EventSystem / 打不到 uGUI）→ hint 说明它只对 uGUI 生效（U16｜预留号，定稿为 **U25**）', async () => {
  const e = await playClick({
    projectPath: 'P', action: 'Click', x: '10', y: '10',
    _call: fakeCall({ Success: false, Message: 'No EventSystem found in the scene. Ensure an EventSystem GameObject exists.' }),
  });
  assert.strictEqual(e.ok, false);
  assert.ok(e.hint.some((h) => /uGUI|GraphicRaycaster|SpriteRenderer/.test(h)), `hint 必须点明适用范围：${JSON.stringify(e.hint)}`);
});

test('playMouse 非 dry-run 且命中 Input System 缺失 → INPUT_SYSTEM_UNAVAILABLE；--dry-run 不受影响', async () => {
  const e = await playMouse({
    projectPath: 'P', action: 'Click', x: '10', y: '10',
    _call: fakeCall({ Success: false, Message: 'simulate-mouse-input requires the Input System package (com.unity.inputsystem). x' }),
  });
  assert.strictEqual(e.code, 'INPUT_SYSTEM_UNAVAILABLE');

  const spy = [];
  const dry = await playMouse({
    projectPath: 'P', action: 'Click', x: '10', y: '10', dryRun: true,
    _call: fakeCall({ Success: true, Hit: false, CameraName: 'Main Camera', Message: 'no hit' }, spy),
  });
  assert.strictEqual(dry.ok, true);
  assert.deepStrictEqual(spy[0].args, ['--action', 'Click', '--x', '10', '--y', '10', '--dry-run']);
  assert.ok(dry.hint.some((h) => /3D|Physics/.test(h)), '--dry-run 用的是 3D 物理射线，必须写在 hint 里');
});

test('playLogs：--log-type/--max-count/--search-text 透传，日志压成 {type,message}（不带 stack trace）', async () => {
  const spy = [];
  const e = await playLogs({
    projectPath: 'P', logType: 'Log', maxCount: '5', searchText: '[BB]',
    _call: fakeCall({
      Success: true, TotalCount: 7, DisplayedCount: 2, LogType: 'Log', MaxCount: 5, SearchText: '[BB]',
      Logs: [
        { Type: 'Log', Message: '[BB] ready bricks=24', StackTrace: 'long...' },
        { Type: 'Log', Message: '[BB] hit brick=Brick_2_1 score=1', StackTrace: 'long...' },
      ],
    }, spy),
  });
  assert.deepStrictEqual(spy[0].args, ['--log-type', 'Log', '--max-count', '5', '--search-text', '[BB]']);
  assert.strictEqual(e.actual.totalCount, 7);
  assert.deepStrictEqual(e.actual.logs, [
    { type: 'Log', message: '[BB] ready bricks=24' },
    { type: 'Log', message: '[BB] hit brick=Brick_2_1 score=1' },
  ]);
  assert.strictEqual(e.actual.logs[0].stackTrace, undefined, '不主动搬 stack trace（token 成本）');
  assert.ok(e.hint.some((h) => /7|裁剪|TotalCount/.test(h)), 'TotalCount > DisplayedCount 必须提示被裁剪');
});

test('playLogs 非法 --log-type → BAD_ACTION（用法错 2）；缺 --log-type 用默认 All', async () => {
  const bad = await playLogs({ projectPath: 'P', logType: 'Nope', _call: fakeCall({ Success: true }, []) });
  assert.strictEqual(bad.code, 'BAD_ACTION');
  const spy = [];
  await playLogs({ projectPath: 'P', _call: fakeCall({ Success: true, TotalCount: 0, DisplayedCount: 0, Logs: [] }, spy) });
  assert.deepStrictEqual(spy[0].args, ['--log-type', 'All']);
});

test('playView：读写 Game 视图分辨率；只给一半 → BAD_SIZE（2）', async () => {
  const spy = [];
  const e = await playView({
    projectPath: 'P', width: '960', height: '640',
    _call: fakeCall({ Success: true, PreviousWidth: 892, PreviousHeight: 355, CurrentWidth: 960, CurrentHeight: 640, Changed: true, Message: 'changed' }, spy),
  });
  assert.deepStrictEqual(spy[0].args, ['--width', '960', '--height', '640']);
  assert.strictEqual(e.actual.currentWidth, 960);
  assert.strictEqual(e.actual.changed, true);

  const readOnly = await playView({ projectPath: 'P', _call: fakeCall({ Success: true, PreviousWidth: 892, PreviousHeight: 355, CurrentWidth: 892, CurrentHeight: 355, Changed: false }) });
  assert.strictEqual(readOnly.ok, true, '不带 --width/--height 是只读查询');

  const bad = await playView({ projectPath: 'P', width: '960', _call: fakeCall({ Success: true }, []) });
  assert.strictEqual(bad.code, 'BAD_SIZE');
  assert.strictEqual(exitCodeFor(bad), 2);
});

test('CLI play：子动作表与用法错（未知动作 / 未知 --action → 2）', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout, captureStderr } = require('./helpers/capture.js');
  const unknown = await captureStderr(() => main(['play', 'dance']));
  assert.strictEqual(unknown.result, 2);
  assert.match(unknown.out, /usage: unity play/);
  const badAction = await captureStdout(() => main(['play', 'click', '--action', 'Nope', '--x', '1', '--y', '2', '--json']));
  assert.strictEqual(badAction.result, 2);
  assert.strictEqual(JSON.parse(badAction.out).code, 'BAD_ACTION');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/play.test.js`
预期：FAIL —— `Cannot find module '../lib/play.js'`。

- [ ] **步骤 3：编写最少实现代码**

```js
// lib/play.js
'use strict';

const { call } = require('./uloop.js');
const { ok, fail, envelopeFromCall } = require('./envelope.js');
const { compareSubset } = require('./readback.js');

/**
 * `unity play`：PlayMode 试玩闭环（进/出/暂停/步进 + 模拟输入 + 日志 + Game 视图尺寸）。
 *
 * 参数名与响应字段名**全部来自上游 vendor 实证**（全局约束 7 / 任务 7 的探测节）：
 *   - `control-play-mode --action/--timeout-seconds`：ControlPlayMode/Skill/SKILL.md:21-22
 *   - `simulate-mouse-ui --action/--x/--y/--from-x/--from-y/--drag-speed/--duration/--button/--bypass-raycast/--target-path/--drop-target-path`：SimulateMouseUi/Skill/SKILL.md:31-41
 *   - `simulate-mouse-input --action/--x/--y/--button/--duration/--delta-x/--delta-y/--scroll-x/--scroll-y/--dry-run`：SimulateMouseInput/Skill/SKILL.md:37-46
 *   - `simulate-keyboard --action/--key/--duration`：SimulateKeyboard/Skill/SKILL.md:30-32
 *   - `get-logs --log-type/--max-count/--search-text/--include-stack-trace`：GetLogs/Skill/SKILL.md:21-23
 *   - `set-game-view-size --width/--height`：SetGameViewSize/Skill/SKILL.md:21-22
 *
 * **信封口径**：`start`/`stop`/`pause`/`step` 有可比对的 intent（PlayMode 状态），故 `verified` 是布尔；
 * `status` / `click` / `mouse` / `key` / `logs` / `view` 没有 intent → `verified` 恒 `null`（全局约束 15）。
 */

/** `control-play-mode --action` 的合法取值（上游枚举）。 */
const MODE_ACTIONS = ['Play', 'Stop', 'Pause', 'Step', 'Status'];
/** `simulate-mouse-ui --action` 的合法取值。 */
const UI_ACTIONS = ['Click', 'LongPress', 'Drag', 'DragStart', 'DragMove', 'DragEnd'];
/** 需要 `--from-x`/`--from-y` 的 UI 动作（只有一次性 Drag 需要；DragStart/Move/End 从当前位置开始）。 */
const UI_FROM_ACTIONS = ['Drag'];
const BUTTONS = ['Left', 'Right', 'Middle'];
/** `simulate-mouse-input --action` 的合法取值。 */
const MOUSE_ACTIONS = ['Click', 'LongPress', 'MoveDelta', 'SmoothDelta', 'Scroll'];
/** `simulate-keyboard --action` 的合法取值。 */
const KEY_ACTIONS = ['Press', 'KeyDown', 'KeyUp', 'ReleaseAll'];
/** `get-logs --log-type` 的合法取值。 */
const LOG_TYPES = ['All', 'Error', 'Warning', 'Log'];

/**
 * 上游「缺 Input System」的逐字报文识别（出处见文件头注释）。
 * 大小写不敏感，只认关键短语 —— 报文里还带包名与 Active Input Handling 的指引。
 */
function isInputSystemMissing(message) {
  return typeof message === 'string' && /requires the input system package/i.test(message);
}

/** `INPUT_SYSTEM_UNAVAILABLE` 的两条出路（**不许**静默降级成别的调用）。 */
const INPUT_SYSTEM_HINT = [
  "上游要求 Input System 包（com.unity.inputsystem）：装包，并把 Player Settings 的 Active Input Handling 改成 'Input System Package (New)' 或 'Both'（改完需重启编辑器）",
  '不改项目设置的话：用 `execute-dynamic-code` 直接注入运行时状态，**并声明这是注入、不是真实输入**（上游 execute-dynamic-code 的 skill 明确推荐这条）',
  '本命令不会静默降级：拿不到真实输入就如实失败',
];

/** 十进制整数参数：缺省 → `undefined`；非法 → `null`（调用方落用法错）。 */
function intArg(v) {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !/^-?\d+$/.test(v)) return null;
  return Number(v);
}
```

> ⚠️ **同一个文件的续段**：下面这段直接接在上面的文件之后（同属一个文件，中间不能有任何其它内容）。

```js
/** `unity play start|stop|pause|step|status` → `control-play-mode`。 */
async function playMode({ projectPath, env, action = 'Play', timeoutSeconds, _call } = {}) {
  if (!MODE_ACTIONS.includes(action)) {
    return fail({
      code: 'BAD_ACTION',
      message: `play 的 --action 取值非法：${JSON.stringify(action)}`,
      actual: { action, allowed: [...MODE_ACTIONS] },
      hint: ['子动作：start(Play) / stop(Stop) / pause(Pause) / step(Step) / status(Status)'],
    });
  }
  const timeout = intArg(timeoutSeconds);
  if (timeout === null || (timeout !== undefined && timeout <= 0)) {
    return fail({
      code: 'BAD_TIMEOUT',
      message: `--timeout-seconds 需要正整数，收到 ${JSON.stringify(timeoutSeconds)}`,
      actual: { timeoutSeconds },
      hint: ['用法：--timeout-seconds 180（上游默认 180 秒）'],
    });
  }
  const args = ['--action', action];
  if (timeout !== undefined) args.push('--timeout-seconds', String(timeout));
  const r = await (_call || call)('control-play-mode', args, { projectPath, env });
  const envl = envelopeFromCall(r);
  if (!envl.ok) return envl;
  const j = r.json;
  const actual = {
    action,
    isPlaying: j.IsPlaying === true,
    isPaused: j.IsPaused === true,
    changed: j.Changed === true,
    wasAlreadyStopped: j.WasAlreadyStopped === true,
    resumedFromPause: j.ResumedFromPause === true,
    blockedByCompileErrors: j.BlockedByCompileErrors === true,
    blockedByUnsavedChanges: j.BlockedByUnsavedChanges === true,
    compileErrorCount: typeof j.CompileErrorCount === 'number' ? j.CompileErrorCount : null,
    stoppedBy: j.StoppedBy ?? null,
    stoppedAt: j.StoppedAt ?? null,
    message: typeof j.Message === 'string' ? j.Message : '',
  };
  const hint = [];
  if (typeof j.Warning === 'string' && j.Warning !== '') hint.push(`上游警告：${j.Warning}`);
  if (actual.blockedByUnsavedChanges) {
    hint.push('场景有未保存改动且无法静默保存（最常见是未命名场景）—— 先把场景保存到明确路径（或放弃改动）再重试');
  }
  if (actual.blockedByCompileErrors) {
    hint.push(`编译错挡住 PlayMode（CompileErrorCount=${actual.compileErrorCount}）—— 先 \`unity compile\` 修掉`);
  }
  if (actual.wasAlreadyStopped) hint.push('Stop 时本来就没在跑（Changed:false、WasAlreadyStopped:true）—— 这是幂等成功，不是失败');
  // intent：Play/Stop 看 isPlaying；Pause/Step 看 isPaused；Status 只看状态（无 intent）
  const intent = action === 'Play' ? { isPlaying: true }
    : action === 'Stop' ? { isPlaying: false }
      : (action === 'Pause' || action === 'Step') ? { isPaused: true }
        : null;
  if (intent === null) return ok(actual, { hint });
  const mismatches = compareSubset(intent, actual);
  return {
    ...ok(actual, {
      verified: mismatches.length === 0,
      intent,
      hint: mismatches.length
        ? [...hint, 'PlayMode 状态与意图不一致（verified:false）——先看 actual.blockedByUnsavedChanges / blockedByCompileErrors / message']
        : hint,
    }),
    mismatches,
  };
}
```

> ⚠️ **同一个文件的续段**：下面这段直接接在上面的文件之后（同属一个文件，中间不能有任何其它内容）。

```js
/** `unity play click` → `simulate-mouse-ui`（需要 PlayMode + EventSystem + ScreenSpaceOverlay uGUI）。 */
async function playClick({
  projectPath, env, action = 'Click', x, y, fromX, fromY, button, duration, targetPath, bypassRaycast, _call,
} = {}) {
  if (!UI_ACTIONS.includes(action)) {
    return fail({
      code: 'BAD_ACTION',
      message: `play click 的 --action 取值非法：${JSON.stringify(action)}`,
      actual: { action, allowed: [...UI_ACTIONS] },
      hint: ['Click / LongPress / Drag / DragStart / DragMove / DragEnd'],
    });
  }
  if (button !== undefined && !BUTTONS.includes(button)) {
    return fail({ code: 'BAD_ACTION', message: `--button 取值非法：${JSON.stringify(button)}`, actual: { button, allowed: [...BUTTONS] }, hint: ['Left / Right / Middle'] });
  }
  const xi = intArg(x); const yi = intArg(y);
  if (xi === undefined || yi === undefined || xi === null || yi === null) {
    return fail({
      code: 'BAD_COORD',
      message: 'play click 需要 --x 与 --y（Game 视图像素，左上原点；上游默认 0 会点到角落）',
      actual: { x, y },
      hint: ['坐标取自 `unity shot --capture-mode rendering --json` 的 gameViewWidth/Height 与元素标注，或 execute-dynamic-code 算出的 Camera.WorldToScreenPoint'],
    });
  }
  const fxi = intArg(fromX); const fyi = intArg(fromY);
  if (UI_FROM_ACTIONS.includes(action) && (fxi === undefined || fyi === undefined)) {
    return fail({
      code: 'BAD_COORD',
      message: `play click --action ${action} 需要 --from-x 与 --from-y（拖拽起点）`,
      actual: { fromX, fromY },
      hint: ['用法：--action Drag --from-x 100 --from-y 200 --x 300 --y 200'],
    });
  }
  // ⚠️ 已被 R264 取代，见实现（`lib/play.js:173-181`）：成对守卫与 action 无关——
  // 只要给了任一侧，两侧就必须都是整数；`fromGiven` 为真才 push。下面是 R264 前的旧写法。
  if ((fxi === null) !== (fyi === null) || fxi === null) {
    return fail({ code: 'BAD_COORD', message: '--from-x / --from-y 必须成对给整数', actual: { fromX, fromY }, hint: ['用法：--from-x 100 --from-y 200'] });
  }
  const args = ['--action', action, '--x', String(xi), '--y', String(yi)];
  if (fxi !== undefined) args.push('--from-x', String(fxi), '--from-y', String(fyi));
  if (button !== undefined) args.push('--button', button);
  if (duration !== undefined) args.push('--duration', duration);
  if (targetPath !== undefined) args.push('--target-path', targetPath);
  if (bypassRaycast === true) args.push('--bypass-raycast');

  const r = await (_call || call)('simulate-mouse-ui', args, { projectPath, env });
  const envl = envelopeFromCall(r);
  if (!envl.ok) return uiFailureHint(envl);
  const j = r.json;
  const hint = [];
  if (j.HitGameObjectName === null && action === 'Click') {
    hint.push('点击落空（HitGameObjectName 为 null 且 Success:true）——空地上的点击也算成功，业务效果不会发生');
  }
  if (j.InterruptedByPausePoint === true) {
    hint.push('被 pause point 打断：读 message 判断指针事件是否已经派发；本命令不自动恢复');
  }
  return ok({
    action,
    hitGameObjectName: j.HitGameObjectName ?? null,
    positionX: typeof j.PositionX === 'number' ? j.PositionX : null,
    positionY: typeof j.PositionY === 'number' ? j.PositionY : null,
    endPositionX: typeof j.EndPositionX === 'number' ? j.EndPositionX : null,
    endPositionY: typeof j.EndPositionY === 'number' ? j.EndPositionY : null,
    interruptedByPausePoint: j.InterruptedByPausePoint === true,
    pausePointHitCount: typeof j.PausePointHitCount === 'number' ? j.PausePointHitCount : null,
    message: typeof j.Message === 'string' ? j.Message : '',
  }, { hint });
}

/**
 * `simulate-mouse-ui` 的失败补 hint（**按证据分支**，与 M1 的 R109 同源）：
 * 上游的射线只遍历 ScreenSpaceOverlay + GraphicRaycaster 的 uGUI（vendor 出处见任务 7 探测节），
 * 所以「场景里没有 EventSystem」与「点不到 sprite」都必须是**可操作的**提示，而不是让 agent 反复重试。
 */
function uiFailureHint(envelope) {
  const hint = [...envelope.hint];
  if (/No EventSystem found/i.test(envelope.message || '')) {
    hint.push('simulate-mouse-ui 只对 uGUI 生效：需要场景里有 EventSystem，且目标在 ScreenSpaceOverlay 的 Canvas + GraphicRaycaster 下');
    hint.push('SpriteRenderer / 2D 物理对象**打不到**（上游只收集 uGUI 的 Graphic）——要驱动 sprite 游戏请用 `execute-dynamic-code` 注入状态，或改用 uGUI 承载交互');
  }
  return { ...envelope, hint };
}
```

> ⚠️ **同一个文件的续段**：下面这段直接接在上面的文件之后（同属一个文件，中间不能有任何其它内容）。

```js
/** `unity play mouse` → `simulate-mouse-input`（真实注入需要 Input System；`--dry-run` 不需要）。 */
async function playMouse({
  projectPath, env, action = 'Click', x, y, button, duration, deltaX, deltaY, scrollX, scrollY, dryRun, _call,
} = {}) {
  if (!MOUSE_ACTIONS.includes(action)) {
    return fail({
      code: 'BAD_ACTION',
      message: `play mouse 的 --action 取值非法：${JSON.stringify(action)}`,
      actual: { action, allowed: [...MOUSE_ACTIONS] },
      hint: ['Click / LongPress / MoveDelta / SmoothDelta / Scroll'],
    });
  }
  if (button !== undefined && !BUTTONS.includes(button)) {
    return fail({ code: 'BAD_ACTION', message: `--button 取值非法：${JSON.stringify(button)}`, actual: { button, allowed: [...BUTTONS] }, hint: ['Left / Right / Middle'] });
  }
  const args = ['--action', action];
  if (action === 'Click' || action === 'LongPress' || dryRun === true) {
    const xi = intArg(x); const yi = intArg(y);
    if (xi === undefined || yi === undefined || xi === null || yi === null) {
      return fail({ code: 'BAD_COORD', message: `play mouse --action ${action} 需要 --x 与 --y（Game 视图像素）`, actual: { x, y }, hint: ['用法：--x 960 --y 540'] });
    }
    args.push('--x', String(xi), '--y', String(yi));
  }
  if (button !== undefined) args.push('--button', button);
  if (duration !== undefined) args.push('--duration', duration);
  if (deltaX !== undefined) args.push('--delta-x', deltaX);
  if (deltaY !== undefined) args.push('--delta-y', deltaY);
  if (scrollX !== undefined) args.push('--scroll-x', scrollX);
  if (scrollY !== undefined) args.push('--scroll-y', scrollY);
  if (dryRun === true) args.push('--dry-run');

  const r = await (_call || call)('simulate-mouse-input', args, { projectPath, env });
  const envl = envelopeFromCall(r);
  if (!envl.ok) {
    if (isInputSystemMissing(envl.message) && dryRun !== true) {
      return fail({
        code: 'INPUT_SYSTEM_UNAVAILABLE',
        message: envl.message,
        actual: { ...(envl.actual && typeof envl.actual === 'object' ? envl.actual : {}), upstreamMessage: envl.message, action },
        hint: [...INPUT_SYSTEM_HINT, ...envl.hint],
        retryable: false,
      });
    }
    return envl;
  }
  const j = r.json;
  const hint = [];
  if (dryRun === true) {
    hint.push('--dry-run 用的是 **3D Physics 射线**（上游文档），打不到 2D 碰撞体 —— 2D 项目里它的命中结果没有意义');
    hint.push('dry-run 的结果字段：cameraName/cameraPath/hit/hitGameObjectName/hitPoint*（先看 cameraName 对不对，再看有没有命中）');
  }
  return ok({
    action,
    dryRun: dryRun === true,
    button: j.Button ?? null,
    positionX: typeof j.PositionX === 'number' ? j.PositionX : null,
    positionY: typeof j.PositionY === 'number' ? j.PositionY : null,
    cameraName: j.CameraName ?? null,
    cameraPath: j.CameraPath ?? null,
    hit: typeof j.Hit === 'boolean' ? j.Hit : null,
    hitGameObjectName: j.HitGameObjectName ?? null,
    interruptedByPausePoint: j.InterruptedByPausePoint === true,
    pressDeliveredToGame: typeof j.PressDeliveredToGame === 'boolean' ? j.PressDeliveredToGame : null,
    message: typeof j.Message === 'string' ? j.Message : '',
  }, { hint });
}
```

> ⚠️ **同一个文件的续段**：下面这段直接接在上面的文件之后（同属一个文件，中间不能有任何其它内容）。

```js
/** `unity play key` → `simulate-keyboard`（需要 Input System；`ReleaseAll` 是恢复动作）。 */
async function playKey({ projectPath, env, action = 'Press', key, duration, _call } = {}) {
  if (!KEY_ACTIONS.includes(action)) {
    return fail({
      code: 'BAD_ACTION',
      message: `play key 的 --action 取值非法：${JSON.stringify(action)}`,
      actual: { action, allowed: [...KEY_ACTIONS] },
      hint: ['Press / KeyDown / KeyUp / ReleaseAll'],
    });
  }
  if (action !== 'ReleaseAll' && (typeof key !== 'string' || key === '')) {
    return fail({
      code: 'MISSING_KEY',
      message: `play key --action ${action} 需要 --key（Input System Key 枚举名，如 W / Space / LeftShift）`,
      actual: { key },
      hint: ['数字键写 Digit0-Digit9（不是裸的 0-9）', '恢复卡住的按键状态用 --action ReleaseAll（不需要 --key）'],
    });
  }
  const args = ['--action', action];
  if (action !== 'ReleaseAll') args.push('--key', key);
  if (duration !== undefined) args.push('--duration', duration);

  const r = await (_call || call)('simulate-keyboard', args, { projectPath, env });
  const envl = envelopeFromCall(r);
  if (!envl.ok) {
    if (isInputSystemMissing(envl.message)) {
      return fail({
        code: 'INPUT_SYSTEM_UNAVAILABLE',
        message: envl.message,
        actual: { ...(envl.actual && typeof envl.actual === 'object' ? envl.actual : {}), upstreamMessage: envl.message, action, key: key ?? null },
        hint: [...INPUT_SYSTEM_HINT, ...envl.hint],
        retryable: false,
      });
    }
    return envl;
  }
  const j = r.json;
  const hint = [];
  if (typeof j.Warning === 'string' && j.Warning !== '') hint.push(`上游警告：${j.Warning}`);
  if (j.PressEdgeObserved === false) {
    hint.push('PressEdgeObserved:false —— 游戏循环很可能**没看到**这次按键（上游建议先看 PressEdge* 诊断与 pause-point-status，编辑器失焦时先跑 uloop focus-window）');
  }
  if (j.InterruptedByPausePoint === true) {
    hint.push('被 pause point 打断：Press/KeyDown 先读 pressDeliveredToGame 再决定是否重试；状态不一致时用 --action ReleaseAll 恢复');
  }
  return ok({
    action,
    keyName: j.KeyName ?? (key ?? null),
    pressDeliveredToGame: typeof j.PressDeliveredToGame === 'boolean' ? j.PressDeliveredToGame : null,
    pressEdgeObserved: typeof j.PressEdgeObserved === 'boolean' ? j.PressEdgeObserved : null,
    releasedKeys: Array.isArray(j.ReleasedKeys) ? j.ReleasedKeys : null,
    interruptedByPausePoint: j.InterruptedByPausePoint === true,
    warning: typeof j.Warning === 'string' ? j.Warning : '',
    message: typeof j.Message === 'string' ? j.Message : '',
  }, { hint });
}

/** `unity play logs` → `get-logs`（**这是本项目「状态读回」的标准手段**）。 */
async function playLogs({ projectPath, env, logType = 'All', maxCount, searchText, includeStackTrace, _call } = {}) {
  if (!LOG_TYPES.includes(logType)) {
    return fail({
      code: 'BAD_ACTION',
      message: `--log-type 取值非法：${JSON.stringify(logType)}`,
      actual: { logType, allowed: [...LOG_TYPES] },
      hint: ['All / Error / Warning / Log'],
    });
  }
  const mc = intArg(maxCount);
  if (mc === null || (mc !== undefined && mc <= 0)) {
    return fail({ code: 'BAD_ACTION', message: `--max-count 需要正整数，收到 ${JSON.stringify(maxCount)}`, actual: { maxCount }, hint: ['用法：--max-count 50（上游默认 100）'] });
  }
  const args = ['--log-type', logType];
  if (mc !== undefined) args.push('--max-count', String(mc));
  if (searchText !== undefined) args.push('--search-text', searchText);
  if (includeStackTrace === true) args.push('--include-stack-trace');

  const r = await (_call || call)('get-logs', args, { projectPath, env });
  const envl = envelopeFromCall(r);
  if (!envl.ok) return envl;
  const j = r.json;
  if (typeof j.TotalCount !== 'number' || !Array.isArray(j.Logs)) {
    // 字段缺失即失败（U11 的纪律）：绝不打印 ? 假装成功
    return fail({
      code: 'BAD_LOG_RESPONSE',
      message: 'get-logs 响应缺 TotalCount 或 Logs（上游字段可能改名）',
      actual: { keys: Object.keys(j ?? {}) },
      hint: ['对照 docs/CAPABILITIES-*.md §4.7 的字段表；用 `unity doctor --smoke` 复现'],
    });
  }
  const logs = j.Logs.map((l) => ({
    type: typeof l.Type === 'string' ? l.Type : 'Log',
    message: typeof l.Message === 'string' ? l.Message : '',
    ...(includeStackTrace === true && typeof l.StackTrace === 'string' && l.StackTrace !== '' ? { stackTrace: l.StackTrace } : {}),
  }));
  const hint = [];
  const displayed = typeof j.DisplayedCount === 'number' ? j.DisplayedCount : logs.length;
  if (j.TotalCount > displayed) {
    hint.push(`TotalCount=${j.TotalCount} > DisplayedCount=${displayed}：日志被 --max-count 裁剪了，调大它或加 --search-text 缩小范围`);
  }
  if (logs.some((l) => /Exception|NullReference/i.test(l.message))) {
    hint.push('日志里出现过 Exception/NullReference —— PlayMode 里的异常会中断脚本，先用 `play stop` 收场再查因');
  }
  return ok({
    totalCount: j.TotalCount,
    displayedCount: displayed,
    logType: typeof j.LogType === 'string' ? j.LogType : logType,
    maxCount: typeof j.MaxCount === 'number' ? j.MaxCount : (mc ?? null),
    searchText: typeof j.SearchText === 'string' ? j.SearchText : (searchText ?? null),
    logs,
  }, { hint });
}

/** `unity play view` → `set-game-view-size`（读或设 Game 视图分辨率；**不给参数就是只读查询**）。 */
async function playView({ projectPath, env, width, height, _call } = {}) {
  const w = intArg(width); const h = intArg(height);
  if ((w === undefined) !== (h === undefined)) {
    return fail({
      code: 'BAD_SIZE',
      message: '--width 与 --height 必须一起给（只给一个上游会拒绝）',
      actual: { width, height },
      hint: ['用法：--width 960 --height 640；不给任何参数则只读查询当前分辨率'],
    });
  }
  if ((w !== undefined && (w === null || w <= 0)) || (h !== undefined && (h === null || h <= 0))) {
    return fail({
      code: 'BAD_SIZE',
      message: '--width / --height 需要正整数',
      actual: { width, height },
      hint: ['用法：--width 960 --height 640'],
    });
  }
  const args = [];
  if (w !== undefined) args.push('--width', String(w), '--height', String(h));
  const r = await (_call || call)('set-game-view-size', args, { projectPath, env });
  const envl = envelopeFromCall(r);
  if (!envl.ok) return envl;
  const j = r.json;
  const hint = [];
  if (j.Changed === true) {
    hint.push('Game 视图尺寸已改（**只影响本次编辑器会话**，不改项目文件）—— 截图/像素判定的坐标基准随之变化，改完请重新截图');
  }
  return ok({
    previousWidth: typeof j.PreviousWidth === 'number' ? j.PreviousWidth : null,
    previousHeight: typeof j.PreviousHeight === 'number' ? j.PreviousHeight : null,
    currentWidth: typeof j.CurrentWidth === 'number' ? j.CurrentWidth : null,
    currentHeight: typeof j.CurrentHeight === 'number' ? j.CurrentHeight : null,
    changed: j.Changed === true,
    message: typeof j.Message === 'string' ? j.Message : '',
  }, { hint });
}

module.exports = {
  playMode, playClick, playMouse, playKey, playLogs, playView, isInputSystemMissing,
  uiFailureHint, intArg, MODE_ACTIONS, UI_ACTIONS, MOUSE_ACTIONS, KEY_ACTIONS, LOG_TYPES,
};
```

`bin/unity.js` 的 `COMMANDS` 里加（子动作 → 库函数的映射**写在 CLI 里**，库函数只吃枚举值）：

```js
  play: async (rest) => {
    const [sub, ...opts] = rest;
    const { parseArgs } = require('../lib/args.js');
    const args = parseArgs(opts);
    // R203：局部 require（同上，顶层没有 emit/exitCodeFor）
    const { emit, exitCodeFor } = require('../lib/envelope.js');
    const play = require('../lib/play.js');
    const projectPath = args['project-path'];
    let e;
    if (sub === 'start' || sub === 'stop' || sub === 'pause' || sub === 'step' || sub === 'status') {
      const action = { start: 'Play', stop: 'Stop', pause: 'Pause', step: 'Step', status: 'Status' }[sub];
      e = await play.playMode({ projectPath, action, timeoutSeconds: args['timeout-seconds'] });
    } else if (sub === 'click') {
      e = await play.playClick({
        projectPath,
        action: args.action === undefined ? 'Click' : args.action,
        x: args.x, y: args.y, fromX: args['from-x'], fromY: args['from-y'],
        button: args.button, duration: args.duration,
        targetPath: args['target-path'], bypassRaycast: args['bypass-raycast'],
      });
    } else if (sub === 'mouse') {
      e = await play.playMouse({
        projectPath,
        action: args.action === undefined ? 'Click' : args.action,
        x: args.x, y: args.y, button: args.button, duration: args.duration,
        deltaX: args['delta-x'], deltaY: args['delta-y'],
        scrollX: args['scroll-x'], scrollY: args['scroll-y'],
        dryRun: args['dry-run'],
      });
    } else if (sub === 'key') {
      e = await play.playKey({
        projectPath,
        action: args.action === undefined ? 'Press' : args.action,
        key: args.key, duration: args.duration,
      });
    } else if (sub === 'logs') {
      e = await play.playLogs({
        projectPath,
        logType: args['log-type'] === undefined ? 'All' : args['log-type'],
        maxCount: args['max-count'], searchText: args['search-text'],
        includeStackTrace: args['include-stack-trace'],
      });
    } else if (sub === 'view') {
      e = await play.playView({ projectPath, width: args.width, height: args.height });
    } else {
      process.stderr.write('usage: unity play start|stop|pause|step|status|click|mouse|key|logs|view\n');
      return 2;
    }
    emit(e, { json: Boolean(args.json) });
    return exitCodeFor(e);
  },
```

`USAGE` 加：

```
  play                     PlayMode 试玩闭环（参数名与上游一致，见 docs/CAPABILITIES）
    start|stop|pause|step|status
                           进/出/暂停/步进 PlayMode；status 只读（不改状态）
                           --timeout-seconds <n>   等待进入/退出的上限（默认 180）
    click                   UI 点击/长按/拖拽（**只对 ScreenSpaceOverlay + GraphicRaycaster 的 uGUI 生效**）
                           --action Click|LongPress|Drag|DragStart|DragMove|DragEnd
                           --x/--y <px>            Game 视图像素，左上原点（必填）
                           --from-x/--from-y <px>  Drag 的起点（--action Drag 必填）
                           --button Left|Right|Middle / --duration <秒>
                           --target-path <path> --bypass-raycast
    mouse                   真实鼠标注入（需 Input System；--dry-run 不需要，但用的是 3D 物理射线）
                           --action Click|LongPress|MoveDelta|SmoothDelta|Scroll
                           --x/--y --button --duration --delta-x --delta-y --scroll-x --scroll-y --dry-run
    key                     键盘注入（需 Input System）
                           --action Press|KeyDown|KeyUp|ReleaseAll（ReleaseAll 不需要 --key）
                           --key <Key枚举>        W / Space / LeftShift / Digit0-9 …
                           --duration <秒>         Press 的按住时长
    logs                    读 Unity 控制台（**状态读回的标准手段**）
                           --log-type All|Error|Warning|Log / --max-count <n> / --search-text <t>
                           --include-stack-trace
    view                    读/设 Game 视图分辨率（不给参数=只读查询；只影响本次会话）
                           --width <n> --height <n>（必须成对）

  ⚠️ key / mouse（非 --dry-run）需要项目装 com.unity.inputsystem 且 Active Input Handling ≠ Old；
     没有它时本命令**如实失败**（INPUT_SYSTEM_UNAVAILABLE），不会静默降级 —— 改用 execute-dynamic-code 注入状态。
  ⚠️ click 打不到 SpriteRenderer / 2D 物理对象（上游只收集 uGUI 的 Graphic）。
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/play.test.js` → PASS（**15 条**）。

> **R208：用例计数统一为 15**（旧稿的 13/15/18 三个数并存是错的）。`test/play.test.js` 的用例清单（逐字，与上面的片段一致）：
> 1 `isInputSystemMissing`、2 `playMode start 成功`、3 `playMode start 没能进入`、4 `playMode stop 成功`、5 `playMode 非法 action`、6 `playKey 命中 Input System 缺失`、7 `playKey ReleaseAll`、8 `playKey Press 成功`、9 `playClick --x/--y 必填`、10 `playClick 命中空场景`、11 `playMouse`、12 `playLogs`、13 `playLogs 非法 --log-type`、14 `playView`、15 `CLI play`。
> 旧稿里有一个只写了 `const spy = [];` 的**未闭合用例头**与**两条重复用例**（重名），按字面粘贴会直接坏文件 —— 已删除，可逐字粘贴。
运行：`npm test` → PASS（本任务新增 15 条 → 总数应为 279；以实际为准）。

- [ ] **步骤 5：真机验证（必做 —— 两种分支都要落到报告里）**

```bash
P=C:/Users/<用户>/pi-unity-spike/S0Project
md5sum "$P/Assets/Scenes/SampleScene.scene" > /tmp/before.md5
node bin/unity.js play status --project-path $P --json ; echo "exit=$?"
node bin/unity.js play start  --project-path $P --json ; echo "exit=$?"      # 期望 verified:true
node bin/unity.js play status --project-path $P --json
node bin/unity.js play view --project-path $P --width 960 --height 640 --json ; echo "exit=$?"
node bin/unity.js play logs --project-path $P --log-type Log --max-count 5 --json ; echo "exit=$?"
node bin/unity.js play key --project-path $P --action Press --key Space --json ; echo "exit=$?"   # 探测①：预期 INPUT_SYSTEM_UNAVAILABLE
node bin/unity.js play mouse --project-path $P --action Click --x 480 --y 320 --json ; echo "exit=$?"  # 同上
node bin/unity.js play mouse --project-path $P --action Click --x 480 --y 320 --dry-run --json ; echo "exit=$?"  # 预期成功（不需 Input System）
node bin/unity.js play click --project-path $P --action Click --x 480 --y 320 --json ; echo "exit=$?"  # 预期失败（无 EventSystem）+ 适用范围 hint
node bin/unity.js play stop  --project-path $P --json ; echo "exit=$?"
md5sum "$P/Assets/Scenes/SampleScene.scene" > /tmp/after.md5 && (diff /tmp/before.md5 /tmp/after.md5 && echo "场景未被保存" || echo "⚠️ 场景被改动/保存了")
```

**必须写进报告的六条**：
1. `play start` / `play stop` 的 `verified` 真值与 `actual.isPlaying`；
2. `play key` / `play mouse` 的**真实退出码与 `code`**（预期 `INPUT_SYSTEM_UNAVAILABLE`）与上游报文原文 —— 这是「可用性探测①」的结论；
3. `play mouse --dry-run` 的真实结果（`hit` / `cameraName`）；
4. `play click` 的真实失败码与报文（预期与 EventSystem/uGUI 有关）—— 这是探测②的结论；
5. `play logs` 的真实 `totalCount` / `logs` 内容；
6. **PlayMode 进出是否改动了 `SampleScene.scene` 的 md5**（上游文档说 `Play` 在 unsaved changes 无法静默保存时才报错，意味着**能保存时会保存**；实测结论直接决定任务 10/11 的清理纪律与 skill 措辞）。
   若 md5 变了：把这条坑**追加到 `docs/PITFALLS.md` 文件末尾、不写 U 编号**（报告里写「待编号的坑：`unity play start` 会静默保存当前场景」；编号与索引表由任务 13 定稿，R213），并确保任务 10 的 `--smoke`、任务 9 的 `--golden` 的临时节点不在 PlayMode 之前残留。

- [ ] **步骤 6：Commit**

```bash
git add lib/play.js bin/unity.js test/play.test.js docs/PITFALLS.md
git commit -m "feat(play): unity play 试玩闭环（PlayMode 进/出/步进 + UI/键鼠输入按 vendor 参数表接线 + 日志 + Game 视图尺寸）"
```

---

## 任务 8：`unity asset write` + `unity compile` —— 把脚本写进项目并验证编译（集成）

**文件：**
- 创建：`lib/asset.js`
- 修改：`bin/unity.js`（两个命令 + USAGE）
- 创建：`test/asset.test.js`

**决策与依据（本任务是范围补充，理由写在这）**：
- 盲测要的「完整小游戏」需要**运行时逻辑**（球运动/碎砖/计分），而 `execute-dynamic-code` 里定义的 `MonoBehaviour` 属于动态程序集，**不能跨 PlayMode 的域重载存活**（`docs/PITFALLS.md` U8 是同族实证）。所以必须把真实 `.cs` 写进项目 → 新增 `unity asset write`。
- **不需要** `AssetDatabase.Refresh()` 片段：上游 compile skill 原文 *"even when files were edited outside the Editor, a plain `uloop compile` refreshes assets and runs every recompilation the changes require"*（`vendor/uloopmcp/Editor/FirstPartyTools/Compile/Skill/SKILL.md:30`）。
- **不要** 用 `--force-recompile`：上游说它「几乎永远不需要」，且跨域重载后常回 `COMPILE_RESULT_UNKNOWN`（同上 `:32-40`）。
- `compile` 的响应字段：`ErrorCount`/`WarningCount` 出处 `vendor/uloopmcp/Editor/FirstPartyTools/Compile/CompileResponse.cs:28-80` 与 `Compile/Skill/SKILL.md:48-56`。
- **R209（`Success` 的实际类型）**：上游 `Compile/Skill/SKILL.md` 写的是 `Success` 为 **“boolean or null”**，但同仓库的
  `vendor/uloopmcp/Editor/FirstPartyTools/Compile/CompileResponseFactory.cs:80,91` 已把它**强制成 `bool`** —— 即
  **`Success:null` 在当前 vendor 版本生产不可达**。处理口径：
  ① **保留防御分支**（`indeterminate`）：上游文档仍声明可为 null，将来改回去就是真 bug；但要在测试与实现里**降级标注为「生产不可达，除非上游改回 null」**；
  ② `ErrorCount`/`WarningCount` 为 null 仍是**可达**的不确定形态（上游确实可缺字段）——这部分正常测；
  ③ **补一条真机对账**（步骤 5）：真机跑一次裸 `uloop compile`，把响里 `Success` 的**实际类型**（`typeof`）记进报告；若真出现 `null`，把①的标注反过来。
- **写后读回**：`asset write` 写完立刻用 `fs.readFileSync` **读回比对 sha256** —— 这是真正的「写后读回」，所以 `verified` 是布尔（符合全局约束 15）。

- [ ] **步骤 1：编写失败的测试**

> ⚠️ **`_call` 注入缝的 spy 语义**：`spy[0].args` 是**工具级 argv**（不含 `--project-path`/工具名——那两样由 `lib/uloop.js` 的 `call()` 拼，注入缝绕过了它）；工具名在 `spy[0].tool`。所以断言写 `['--action','Play']` 而不是 `['--project-path','P','control-play-mode','--action','Play']`。

```js
// test/asset.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { compile, assetWrite, resolveTemplate } = require('../lib/asset.js');
const { exitCodeFor } = require('../lib/envelope.js');

function fakeCall(json, spy = []) {
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

const OK_COMPILE = { Success: true, ErrorCount: 0, WarningCount: 0, Errors: [], Warnings: [], Message: 'compiled' };

test('compile 成功：errorCount===0 → ok:true、verified:null（读命令），argv 不带 --force-recompile', async () => {
  const spy = [];
  const e = await compile({ projectPath: 'P', _call: fakeCall(OK_COMPILE, spy) });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, null);
  assert.strictEqual(spy[0].tool, 'compile');
  assert.deepStrictEqual(spy[0].args, []);
  assert.strictEqual(e.actual.errorCount, 0);
});

test('compile 有错：ok:false + COMPILE_FAILED + 结构化 errors（文件/行/消息）', async () => {
  const e = await compile({
    projectPath: 'P',
    _call: fakeCall({
      Success: true, ErrorCount: 2, WarningCount: 1,
      Errors: [{ Message: 'CS1002: ; expected', File: 'Assets/X.cs', Line: 12 }, { Message: 'CS0246: 找不到类型', File: 'Assets/X.cs', Line: 20 }],
      Warnings: [{ Message: 'CS0168', File: 'Assets/X.cs', Line: 3 }],
      Message: 'compile failed',
    }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'COMPILE_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(e.actual.errorCount, 2);
  assert.deepStrictEqual(e.actual.errors[0], { message: 'CS1002: ; expected', file: 'Assets/X.cs', line: 12 });
  assert.ok(e.hint.some((h) => /CS1002/.test(h)), 'hint 必须带上第一条错误，省一轮 get-logs');
});

test('compile 不确定（Success:null / ErrorCount:null）→ BAD_COMPILE_RESPONSE（不猜）', async () => {
  // R209 降级标注：`Success: null` 在当前 vendor 上**生产不可达** ——
  //   `CompileResponseFactory.cs:80,91` 把 Success 强制成 bool；保留它是因为上游 SKILL.md 写的是 “boolean or null”，
  //   且 `fromUloop` 会把 `Success:null` 先判成 ULOOP_BAD_PAYLOAD（「这不是 uloop 信封」，误导）。
  //   可达的不确定形态是后两条（ErrorCount/WarningCount 缺失）。
  for (const bad of [
    { Success: null, ErrorCount: null, WarningCount: null, Message: 'COMPILE_RESULT_UNKNOWN' },   // 防御分支（生产不可达）
    { Success: true, ErrorCount: null, WarningCount: 0 },                                          // 可达
    { Success: true, Message: 'no counters' },                                                     // 可达
  ]) {
    const e = await compile({ projectPath: 'P', _call: fakeCall(bad) });
    assert.strictEqual(e.code, 'BAD_COMPILE_RESPONSE', `${JSON.stringify(bad)}`);
    assert.strictEqual(exitCodeFor(e), 1);
  }
});

test('compile 上游报错（ErrorCode/NextActions）→ 直接按上游失败，NextActions 进 hint', async () => {
  const e = await compile({
    projectPath: 'P',
    _call: fakeCall({ Success: false, ErrorCode: 'COMPILE_ALREADY_IN_PROGRESS', Message: 'Unity is busy running "compile"', NextActions: ['Wait and rerun the command.'] }),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'COMPILE_ALREADY_IN_PROGRESS');
  assert.ok(e.hint.some((h) => /Wait and rerun/.test(h)));
});

test('assetWrite 缺 --to / --from 与 --template 都给或都不给 → 用法错 2，不写盘', async () => {
  let writes = 0;
  const w = { _writeFile: () => { writes++; }, _readSource: () => Buffer.from('x'), _exists: () => false, _call: fakeCall(OK_COMPILE) };
  for (const [opts, code] of [
    [{}, 'MISSING_TO'],
    [{ to: 'Assets/X.cs' }, 'MISSING_SOURCE'],
    [{ to: 'Assets/X.cs', from: 'a.cs', template: 'PiBrickBreaker' }, 'BAD_SOURCE'],
  ]) {
    const e = await assetWrite({ projectPath: 'P', ...w, ...opts });
    assert.strictEqual(e.code, code, `${JSON.stringify(opts)}`);
    assert.strictEqual(exitCodeFor(e), 2);
  }
  assert.strictEqual(writes, 0);
});

test('assetWrite 目标路径必须在 Assets/ 下且不含 .. → BAD_TARGET_PATH（2）', async () => {
  for (const to of ['/abs/X.cs', 'Library/X.cs', 'Assets/../X.cs', '']) {
    const e = await assetWrite({ projectPath: 'P', to, from: 'a.cs', _call: fakeCall(OK_COMPILE), _readSource: () => Buffer.from('x'), _writeFile: () => {}, _exists: () => false, _mkdirp: () => {} });
    assert.strictEqual(e.code, 'BAD_TARGET_PATH', to);
  }
});

test('assetWrite 目标已存在且无 --force → ASSET_EXISTS（1），不写盘', async () => {
  let writes = 0;
  const e = await assetWrite({
    projectPath: 'P', to: 'Assets/X.cs', from: 'src.cs',
    _exists: () => true, _writeFile: () => { writes++; }, _readSource: () => Buffer.from('x'),
    _call: fakeCall(OK_COMPILE),
  });
  assert.strictEqual(e.code, 'ASSET_EXISTS');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(writes, 0);
  assert.ok(e.hint.some((h) => /--force/.test(h)));
});

test('assetWrite 成功：写 → 读回 sha256 一致 → verified:true，并串起 compile', async () => {
  const content = 'public class PiBrickBreaker : UnityEngine.MonoBehaviour { }\n';
  const spy = [];
  const e = await assetWrite({
    projectPath: 'P', to: 'Assets/PiBB/PiBrickBreaker.cs', from: 'C:/skill/reference/PiBrickBreaker.cs',
    _readSource: () => Buffer.from(content), _exists: () => false,
    _writeFile: () => {}, _mkdirp: () => {}, _readBack: () => Buffer.from(content),
    _call: fakeCall(OK_COMPILE, spy),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.strictEqual(e.actual.path, 'Assets/PiBB/PiBrickBreaker.cs');
  assert.strictEqual(e.actual.bytes, Buffer.byteLength(content));
  assert.strictEqual(e.actual.sha256, crypto.createHash('sha256').update(content).digest('hex'));
  assert.strictEqual(e.actual.compiled, true);
  assert.strictEqual(spy[0].tool, 'compile');
  assert.deepStrictEqual(spy[0].args, []);
});

test('assetWrite --no-compile：跳过 compile（一条 uloop 调用都不发）', async () => {
  const spy = [];
  const e = await assetWrite({
    projectPath: 'P', to: 'Assets/X.cs', from: 'src.cs', noCompile: true,
    _readSource: () => Buffer.from('x'), _exists: () => false, _writeFile: () => {}, _mkdirp: () => {}, _readBack: () => Buffer.from('x'),
    _call: fakeCall(OK_COMPILE, spy),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.actual.compiled, null);
  assert.strictEqual(spy.length, 0);
});

test('assetWrite 源文件读不了 → SOURCE_NOT_FOUND（1）', async () => {
  const e = await assetWrite({
    projectPath: 'P', to: 'Assets/X.cs', from: 'C:/nope.cs',
    _readSource: () => { throw new Error('ENOENT'); }, _exists: () => false, _writeFile: () => {}, _mkdirp: () => {},
    _call: fakeCall(OK_COMPILE),
  });
  assert.strictEqual(e.code, 'SOURCE_NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('assetWrite 写后读回内容不符 → verified:false + READBACK 差异字段（写盘不完整不谎报）', async () => {
  const e = await assetWrite({
    projectPath: 'P', to: 'Assets/X.cs', from: 'src.cs',
    _readSource: () => Buffer.from('0123456789'), _exists: () => false, _writeFile: () => {}, _mkdirp: () => {},
    _readBack: () => Buffer.from('01234'),
    _call: fakeCall(OK_COMPILE),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.actual.sha256 === e.actual.readBackSha256, false);
  assert.strictEqual(e.actual.readBackBytes, 5);
});

test('assetWrite --template 解析到包内模板；未知模板 → TEMPLATE_NOT_FOUND（1）', () => {
  const p = resolveTemplate('PiBrickBreaker');
  assert.ok(p && p.endsWith(`templates${require('node:path').sep}PiBrickBreaker.cs`), String(p));
  assert.strictEqual(resolveTemplate('NoSuchTemplate'), null);
});

// ─────────────────── R206⑤：CLI 级用例（main([...]) 端到端，照 M1 test/scene.test.js 的写法）───────────────────

/** 写一个假 dispatcher 脚本并运行 fn（**逐字照搬** test/scene.test.js 的 withScriptedDispatcher，含 try/finally 还原 env）。 */
async function withScriptedDispatcher(scriptBody, fn) {
  const fss = require('node:fs');
  const pathh = require('node:path');
  const dir = fss.mkdtempSync(pathh.join(require('node:os').tmpdir(), 'piu-asset-scripted-'));
  const fake = pathh.join(dir, 'fake-uloop.js');
  fss.writeFileSync(fake, scriptBody);
  const saved = process.env.PI_UNITY_ULOOP_CMD;
  process.env.PI_UNITY_ULOOP_CMD = JSON.stringify([process.execPath, fake]);
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.PI_UNITY_ULOOP_CMD;
    else process.env.PI_UNITY_ULOOP_CMD = saved;
  }
}

test('CLI compile：无错 → 退出码 0；有编译错 → 1 且 code=COMPILE_FAILED（main([...]) 端到端）', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout } = require('./helpers/capture.js');
  const okRun = await withScriptedDispatcher(
    "process.stdout.write(JSON.stringify({ Success: true, ErrorCount: 0, WarningCount: 0, Message: 'ok' }) + '\\n');",
    () => captureStdout(() => main(['compile', '--project-path', 'X', '--json'])),
  );
  assert.strictEqual(okRun.result, 0);
  assert.strictEqual(JSON.parse(okRun.out).actual.errorCount, 0);

  const badRun = await withScriptedDispatcher(
    "process.stderr.write(JSON.stringify({ Success: true, ErrorCount: 1, WarningCount: 0, Errors: [{ Message: 'CS1002', File: 'Assets/X.cs', Line: 1 }] }) + '\\n'); process.exitCode = 1;",
    () => captureStdout(() => main(['compile', '--project-path', 'X', '--json'])),
  );
  assert.strictEqual(badRun.result, 1);
  const bad = JSON.parse(badRun.out);
  assert.strictEqual(bad.code, 'COMPILE_FAILED');
  assert.strictEqual(bad.actual.errors[0].line, 1);
});

test('CLI asset write：--from 真文件 → 0 且 verified:true、compiled:true；--to 非 Assets/ → 2 BAD_TARGET_PATH', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout } = require('./helpers/capture.js');
  const fss = require('node:fs');
  const pathh = require('node:path');
  // 写盘走真实 fs：用一个临时「项目目录」，别碰任何真实工程（全局约束 20）
  const proj = fss.mkdtempSync(pathh.join(require('node:os').tmpdir(), 'piu-asset-proj-'));
  const src = pathh.join(proj, 'Probe.cs');
  fss.writeFileSync(src, 'public class Probe {}\n');
  const body = "const a = process.argv.join(' ');"
    + " process.stdout.write(JSON.stringify(a.includes('compile') ? { Success: true, ErrorCount: 0, WarningCount: 0 } : { Success: true, Result: '{}' }) + '\\n');";
  const run = await withScriptedDispatcher(body, () => captureStdout(
    () => main(['asset', 'write', '--project-path', proj, '--to', 'Assets/PiProbe/Probe.cs', '--from', src, '--json']),
  ));
  assert.strictEqual(run.result, 0);
  const e = JSON.parse(run.out);
  assert.strictEqual(e.verified, true);
  assert.strictEqual(e.actual.compiled, true);
  assert.ok(fss.existsSync(pathh.join(proj, 'Assets/PiProbe/Probe.cs')), '文件必须真的落盘');

  const bad = await captureStdout(() => main(['asset', 'write', '--project-path', proj, '--to', '/abs/X.cs', '--from', src, '--json']));
  assert.strictEqual(bad.result, 2);
  assert.strictEqual(JSON.parse(bad.out).code, 'BAD_TARGET_PATH');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/asset.test.js`
预期：FAIL —— `Cannot find module '../lib/asset.js'`。

- [ ] **步骤 3：编写最少实现代码**

```js
// lib/asset.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { call } = require('./uloop.js');
const { ok, fail, envelopeFromCall } = require('./envelope.js');

/**
 * `unity asset write` + `unity compile` —— 把真实 `.cs` 写进项目并验证它能编译。
 *
 * 为什么需要（M2 范围补充，依据写在计划任务 8 的决策节）：运行时逻辑必须是**真 asset**，
 * 动态代码里定义的 MonoBehaviour 不能跨 PlayMode 的域重载存活（PITFALLS U8 同族）。
 * 为什么不需要 `AssetDatabase.Refresh()`：上游 compile skill 明确说 plain `uloop compile`
 * 自己会 refresh（vendor 出处见任务 8 决策节）。
 */

/** 包内模板表（**唯一真值**；`unity asset write --template <名字>` 只能取这里的键）。 */
const TEMPLATES = {
  PiBrickBreaker: path.join(__dirname, '..', 'unity-scripts', 'templates', 'PiBrickBreaker.cs'),
};

/** 模板名 → 包内绝对路径；未知模板返回 `null`。 */
function resolveTemplate(name) {
  return Object.hasOwn(TEMPLATES, name) ? TEMPLATES[name] : null;
}

/** `--timeout-seconds` 透传（`compile` 默认 600s；非法值 → null 由调用方落用法错）。 */
function compileTimeoutArg(v) {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !/^\d+$/.test(v) || Number(v) <= 0) return null;
  return Number(v);
}

/** 把 `compile` 的 `Errors`/`Warnings` 压成 `{message, file, line}`（上游 CompileIssue 字段面）。 */
function compressIssues(list) {
  return (Array.isArray(list) ? list : []).map((i) => ({
    message: typeof i.Message === 'string' ? i.Message : '',
    file: typeof i.File === 'string' ? i.File : null,
    line: typeof i.Line === 'number' ? i.Line : null,
  }));
}

/**
 * `unity compile`：跑一次 plain `uloop compile` 并报告结构化结果。
 *
 * 判据分层（U11 的纪律）：**字段缺失即失败**，绝不把 `ErrorCount:null`（不确定）当成 0。
 * `Success === null` 也是不确定（上游在编译中断时给 null + `COMPILE_RESULT_UNKNOWN`）。
 * 本命令是**读**命令 → `verified` 恒 `null`，成功与否看 `ok`（全局约束 15）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, timeoutSeconds?: string, _call?: typeof call}} [opts]
 * @returns {Promise<object>} 信封
 */
async function compile({ projectPath, env, timeoutSeconds, _call } = {}) {
  const t = compileTimeoutArg(timeoutSeconds);
  if (t === null) {
    return fail({
      code: 'BAD_TIMEOUT',
      message: `--timeout-seconds 需要正整数，收到 ${JSON.stringify(timeoutSeconds)}`,
      actual: { timeoutSeconds },
      hint: ['上游默认 600 秒；超过 1200 会超出 Unity 侧结果保留窗口'],
    });
  }
  const args = [];
  if (t !== undefined) args.push('--timeout-seconds', String(t));
  const r = await (_call || call)('compile', args, { projectPath, env });
  const j = r.json;
  // ⚠️ R209：`compile` 的 `Success` 在上游文档里可为 `null`（编译中断 → `COMPILE_RESULT_UNKNOWN`，
  //    出处 `Compile/Skill/SKILL.md:50-52`），但 `CompileResponseFactory.cs:80,91` 已强制成 bool
  //    → 本分支**生产不可达，除非上游改回 null**（保留防御：文档与实现不一致，且 `fromUloop`
  //    会把 `Success:null` 判成 `ULOOP_BAD_PAYLOAD`（误导），必须在这里单独认）。
  const indeterminate = !r.truncated && Boolean(j) && typeof j === 'object' && j.Success === null;
  if (!indeterminate) {
    const envl = envelopeFromCall(r);
    if (!envl.ok) {
      // 上游自己报错（如 COMPILE_ALREADY_IN_PROGRESS）：直接按码失败，NextActions 已在 hint 里
      if (envl.code === 'COMPILE_ALREADY_IN_PROGRESS') {
        return { ...envl, hint: [...envl.hint, '这是单飞（single-flight）行为，不是失败：等它跑完再重跑本命令，不要重启 Unity'] };
      }
      return envl;
    }
  }
  const uncertain = indeterminate || typeof j.ErrorCount !== 'number' || typeof j.WarningCount !== 'number';
  if (uncertain) {
    return fail({
      code: 'BAD_COMPILE_RESPONSE',
      message: 'compile 的结果不确定（Success/ErrorCount/WarningCount 缺失或为 null）——不猜成 0',
      actual: {
        success: j.Success ?? null,
        errorCount: j.ErrorCount ?? null,
        warningCount: j.WarningCount ?? null,
        message: typeof j.Message === 'string' ? j.Message : '',
      },
      hint: [
        '上游在编译中断时给 Success:null + COMPILE_RESULT_UNKNOWN；Message 里通常带 get-logs 指引与最近的 Console 错误',
        '重跑一次 `unity compile`；仍不确定就用 `unity play logs --log-type Error` 看真实错误',
      ],
    });
  }
  const errors = compressIssues(j.Errors);
  const warnings = compressIssues(j.Warnings);
  const hint = [];
  if (typeof j.Warning === 'string' && j.Warning !== '') hint.push(`上游警告：${j.Warning}`);
  for (const h of (Array.isArray(j.NextActions) ? j.NextActions : [])) hint.push(`上游建议：${h}`);
  if (errors.length > 0) {
    hint.push(`第一条错误：${errors[0].file ?? '?'}:${errors[0].line ?? '?'} ${errors[0].message}`);
    hint.push('改完代码后重跑本命令（plain compile 自己会 refresh 外部改动，不要加 --force-recompile）');
  }
  const actual = {
    errorCount: j.ErrorCount,
    warningCount: j.WarningCount,
    errors,
    warnings,
    message: typeof j.Message === 'string' ? j.Message : '',
    projectRoot: typeof j.ProjectRoot === 'string' ? j.ProjectRoot : null,
  };
  if (j.ErrorCount > 0) {
    return fail({
      code: 'COMPILE_FAILED',
      message: `编译有 ${j.ErrorCount} 个错误（${j.WarningCount} 个警告）`,
      actual,
      hint,
    });
  }
  return ok(actual, { hint });
}
```

> ⚠️ **同一个文件的续段**：下面这段直接接在上面的文件之后（同属一个文件，中间不能有任何其它内容）。

```js
/**
 * `unity asset write`：把本地文件/包内模板写进项目的 `Assets/` 下，**读回比对 sha256**，再跑一次 compile。
 *
 * 契约：
 *   - `--to` 必须形如 `Assets/...` 且不含 `..`（否则 `BAD_TARGET_PATH`）；
 *   - 目标已存在且没给 `--force` → `ASSET_EXISTS`（**覆盖已有脚本属于 skill §5 的停止条件**，必须先问用户）；
 *   - 源：`--from <本地文件>` 或 `--template <包内模板名>`，**恰给一个**；
 *   - 写后读回：`sha256(写回内容) === sha256(源内容)` → `verified:true`；不等 → `verified:false` + 两个哈希（**不谎报**）；
 *   - 除非 `--no-compile`，写完调 `compile()`：有编译错 → `COMPILE_FAILED`（`actual.errors` 带结构化条目）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, to?: string, from?: string, template?: string,
 *   force?: boolean, noCompile?: boolean, timeoutSeconds?: string, _call?: typeof call,
 *   _readSource?: (p: string) => Buffer, _writeFile?: (p: string, b: Buffer) => void,
 *   _readBack?: (p: string) => Buffer, _exists?: (p: string) => boolean, _mkdirp?: (p: string) => void}} [opts]
 * @returns {Promise<object>} 信封
 */
async function assetWrite({
  projectPath, env, to, from, template, force, noCompile, timeoutSeconds, _call,
  _readSource, _writeFile, _readBack, _exists, _mkdirp,
} = {}) {
  if (typeof to !== 'string' || to === '') {
    return fail({
      code: 'MISSING_TO',
      message: '缺少 --to（目标路径，形如 Assets/PiBB/PiBrickBreaker.cs）',
      actual: { to },
      hint: ['用法：unity asset write --to Assets/PiBB/PiBrickBreaker.cs --template PiBrickBreaker'],
    });
  }
  const normalizedTo = to.replace(/\\/g, '/');
  if (!/^Assets\//.test(normalizedTo) || normalizedTo.includes('..')) {
    return fail({
      code: 'BAD_TARGET_PATH',
      message: `--to 必须是 Assets/ 下的项目内路径且不含 ..：${JSON.stringify(to)}`,
      actual: { to },
      hint: ['用法：--to Assets/PiBB/PiBrickBreaker.cs'],
    });
  }
  const hasFrom = typeof from === 'string' && from !== '';
  const hasTemplate = typeof template === 'string' && template !== '';
  if (!hasFrom && !hasTemplate) {
    return fail({
      code: 'MISSING_SOURCE',
      message: '需要 --from <本地文件> 或 --template <包内模板名>',
      actual: { from, template },
      hint: [`包内模板：${Object.keys(TEMPLATES).join(', ')}`],
    });
  }
  if (hasFrom && hasTemplate) {
    return fail({
      code: 'BAD_SOURCE',
      message: '--from 与 --template 只能给一个',
      actual: { from, template },
      hint: ['二选一：--from <本地文件> 或 --template <包内模板名>'],
    });
  }
  let sourcePath = from;
  if (hasTemplate) {
    const resolved = resolveTemplate(template);
    if (!resolved) {
      return fail({
        code: 'TEMPLATE_NOT_FOUND',
        message: `未知模板：${template}`,
        actual: { template, available: Object.keys(TEMPLATES) },
        hint: [`可用模板：${Object.keys(TEMPLATES).join(', ')}`],
      });
    }
    sourcePath = resolved;
  }
  const absTo = path.join(projectPath ?? '', normalizedTo);
  if ((_exists || fs.existsSync)(absTo) && force !== true) {
    return fail({
      code: 'ASSET_EXISTS',
      message: `目标已存在：${normalizedTo}（未给 --force）`,
      actual: { path: normalizedTo },
      hint: [
        '覆盖已有脚本属于停止条件（skill §5）：先向用户确认',
        '确认后用 --force 覆盖；想先看差异就先 `unity node inspect`/直接读文件',
      ],
    });
  }
  let source;
  try {
    source = await (_readSource || ((p) => fs.readFileSync(p)))(sourcePath);
  } catch (err) {
    return fail({
      code: 'SOURCE_NOT_FOUND',
      message: `读不了源文件：${(err && err.message) || String(err)}`,
      actual: { from: hasFrom ? from : null, template: hasTemplate ? template : null, sourcePath },
      hint: ['--from 用绝对路径；--template 只能用包内模板名（见 hint 的列表）'],
    });
  }
  if (!Buffer.isBuffer(source)) {
    return fail({ code: 'SOURCE_NOT_FOUND', message: '源内容不是 Buffer', actual: { sourcePath }, hint: ['内部注入缝用错（测试只）'] });
  }
  let writeResult;
  try {
    (_mkdirp || ((p) => fs.mkdirSync(p, { recursive: true })))(path.dirname(absTo));
    (_writeFile || ((p, b) => fs.writeFileSync(p, b)))(absTo, source);
  } catch (err) {
    return fail({
      code: 'ASSET_WRITE_FAILED',
      message: `写盘失败：${(err && err.message) || String(err)}`,
      actual: { path: normalizedTo },
      hint: ['确认项目目录可写、路径拼写正确（--to 是项目内相对路径）'],
    });
  }
  const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const want = sha256(source);
  let back = null;
  try {
    back = await (_readBack || ((p) => fs.readFileSync(p)))(absTo);
  } catch (err) {
    back = null;
  }
  const got = Buffer.isBuffer(back) ? sha256(back) : null;
  const same = got !== null && got === want;
  const actual = {
    path: normalizedTo,
    bytes: source.length,
    sha256: want,
    readBackBytes: Buffer.isBuffer(back) ? back.length : null,
    readBackSha256: got,
    compiled: null,
  };
  if (!same) {
    return {
      ...ok(actual, {
        verified: false,
        intent: { path: normalizedTo, sha256: want },
        hint: ['写盘后读回的内容与源不一致 —— 不要继续（先查磁盘/权限/杀软拦截），也不要当成写完'],
      }),
      mismatches: [{ key: 'sha256', intent: want, actual: got }],
    };
  }
  if (noCompile === true) return ok(actual, { verified: true, intent: { path: normalizedTo, sha256: want } });
  const c = await compile({ projectPath, env, timeoutSeconds, _call });
  actual.compiled = c.ok && typeof c.actual.errorCount === 'number';
  actual.compile = {
    errorCount: c.actual && typeof c.actual.errorCount === 'number' ? c.actual.errorCount : null,
    warningCount: c.actual && typeof c.actual.warningCount === 'number' ? c.actual.warningCount : null,
  };
  if (!c.ok) {
    return fail({
      code: c.code === 'BAD_COMPILE_RESPONSE' ? 'BAD_COMPILE_RESPONSE' : 'COMPILE_FAILED',
      message: `脚本已写入但编译失败：${c.message}`,
      actual: { ...actual, errors: (c.actual && c.actual.errors) || [] },
      hint: [...(c.hint || []), `文件已写入 ${normalizedTo}；修好错误后重跑 \`unity compile\``],
      phase: 'compile',
    });
  }
  return ok(actual, {
    verified: true,
    intent: { path: normalizedTo, sha256: want },
    hint: c.hint || [],
  });
}

module.exports = { compile, assetWrite, resolveTemplate, TEMPLATES, compressIssues };
```

`bin/unity.js` 的 `COMMANDS` 里加：

```js
  compile: async (rest) => {
    const { parseArgs } = require('../lib/args.js');
    const args = parseArgs(rest);
    const { emit, exitCodeFor } = require('../lib/envelope.js');   // R203：局部 require
    const { compile } = require('../lib/asset.js');
    const e = await compile({ projectPath: args['project-path'], timeoutSeconds: args['timeout-seconds'] });
    emit(e, { json: Boolean(args.json) });
    return exitCodeFor(e);
  },
  asset: async (rest) => {
    const [action, ...opts] = rest;
    const { parseArgs } = require('../lib/args.js');
    const args = parseArgs(opts);
    if (action !== 'write') {
      process.stderr.write('usage: unity asset write --to <Assets/...> (--from <file>|--template <name>) [--force] [--no-compile]\n');
      return 2;
    }
    const { emit, exitCodeFor } = require('../lib/envelope.js');   // R203：局部 require
    const { assetWrite } = require('../lib/asset.js');
    const e = await assetWrite({
      projectPath: args['project-path'],
      to: args.to,
      from: args.from,
      template: args.template,
      force: args.force,
      noCompile: args['no-compile'],
      timeoutSeconds: args['timeout-seconds'],
    });
    emit(e, { json: Boolean(args.json) });
    return exitCodeFor(e);
  },
```

`USAGE` 加：

```
  compile                 编译项目并报告结构化错误（**plain compile 自己会 refresh 外部改动**）
    --timeout-seconds <n> 等待上限（默认 600）；不要用 --force-recompile（上游说几乎永远不需要）
                         退出码：0 无错 / 1 有编译错（code=COMPILE_FAILED）或结果不确定

  asset write             把脚本写进项目（写后读回 sha256 → 再编译）
    --to <Assets/...>     必填：项目内目标路径，必须以 Assets/ 开头且不含 ..
    --from <本地文件>     二选一：源文件绝对路径
    --template <名字>     二选一：包内模板（当前只有 PiBrickBreaker）
    --force               目标已存在时必须显式给（**覆盖已有脚本要先问用户**，见 skill §5）
    --no-compile          只写文件不编译
                         写后读回不一致 → verified:false；编译有错 → 1（code=COMPILE_FAILED）
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/asset.test.js` → PASS（**14 条**：12 条库级 + 2 条 CLI 级，R206⑤）。
运行：`npm test` → PASS（本任务新增 **14 条** → 总数应为 **293**；以实际为准）。

> **计数口径**：这里把旧稿的 13/12 两个数统一为 **14**（旧稿的 13 漏算了 CLI 用例、12 漏算了新加的 2 条 CLI 用例）。新增 2 条 CLI 用例后，后续任务的总数链随之变为 **T9=301 / T10=308 / T11=313**。

- [ ] **步骤 5：真机验证（必做）**

```bash
P=C:/Users/<用户>/pi-unity-spike/S0Project
node bin/unity.js compile --project-path $P --json ; echo "exit=$?"          # 期望 errorCount:0 / exit 0
node bin/unity.js asset write --project-path $P --to Assets/PiProbe/PiProbe.cs \
  --from <(printf 'namespace PiProbe { public static class Ping { public static string Hi() { return "hi"; } } }\n') \
  --json ; echo "exit=$?"
```

> Windows 下没有 `/dev/fd` 的 `<(…)`：**先在临时目录写一个真实文件**再用 `--from`：
> `printf '…' > /tmp/PiProbe.cs` 是不可靠的（U4：原生 Windows 工具不认 MSYS `/tmp`），
> 所以用 `C:/Users/<用户>/pi-unity-spike/PiProbe.cs` 这样的**真实 Windows 路径**。

然后做**反向验证**（证明编译错能被如实报出）：

```bash
printf 'public class Broken { void X() { int a = ; } }\n' > C:/Users/<用户>/pi-unity-spike/Broken.cs
node bin/unity.js asset write --project-path $P --to Assets/PiProbe/Broken.cs \
  --from C:/Users/<用户>/pi-unity-spike/Broken.cs --json ; echo "exit=$?"   # 期望 exit 1 + code=COMPILE_FAILED + errors[0].file/line
node bin/unity.js compile --project-path $P --json ; echo "exit=$?"                # 期望同样报错
# 清理（删掉探针脚本；删资产也要先问用户，这里是本任务自己造的临时文件）：
rm -f "$P/Assets/PiProbe/PiProbe.cs" "$P/Assets/PiProbe/Broken.cs" "$P/Assets/PiProbe/PiProbe.cs.meta" "$P/Assets/PiProbe/Broken.cs.meta"
rmdir "$P/Assets/PiProbe" 2>/dev/null
node bin/unity.js compile --project-path $P --json ; echo "exit=$?"                # 期望回到 errorCount:0
```

判据：① 正常脚本 `exit 0` 且 `verified:true`（`sha256` 与 `readBackSha256` 相等）；② 语法错的脚本 `exit 1` 且
`code=COMPILE_FAILED`、`actual.errors[0]` 带 `file`/`line`/`message`；③ 清理后 `compile` 回到 `errorCount:0`；
④ **报告必须写明**：`uloop compile` 是否真的自动 refresh 了外部新写入的文件（如果不 refresh，第二次 `compile`
会仍报 0 错而 `errors` 为空 → 这时才需要加 `AssetDatabase.Refresh()` 的片段，并把这条坑**追加到 `docs/PITFALLS.md` 文件末尾、不写 U 编号**（报告里写「待编号的坑 + 一句话」，编号与索引表由任务 13 定稿，R213））；
⑤ **R209 真机对账（必做）**：真机跑一次**裸** `uloop compile` 并把响应里的 `Success` 的**实际类型**记进报告：

```bash
U=C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe
"$U" --project-path $P compile | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=s.match(/\{[\s\S]*\}/);const j=JSON.parse(m[0]);console.log('Success typeof =', typeof j.Success, JSON.stringify(j.Success));})"
```

判据：若 `typeof` 为 `'boolean'` → 在报告里写「`Success:null` 确实生产不可达（与 CompileResponseFactory.cs:80,91 一致），防御分支保留但已降级标注」；若为 `'object'`（null）→ **把降级标注反过来**并重开一条修复项（上游又把 null 放回来了）。

- [ ] **步骤 6：Commit**

```bash
git add lib/asset.js bin/unity.js test/asset.test.js docs/PITFALLS.md
git commit -m "feat(asset): unity asset write（写后读回 sha256）+ unity compile（结构化错误，字段缺失即 fail）"
```

---

## 任务 9：`doctor --golden`（判断）

**文件：**
- 创建：`test/helpers/fake-scene.js`（内存场景假后端，任务 10 复用）
- 创建：`lib/golden.js`
- 修改：`lib/scene.js`（`normalizeHierarchy` **additive** 保留 `siblingIndex`/`tag`/`layer`）
- 修改：`lib/doctor.js`（`--golden` 接线 + `--smoke`/`--golden` 互斥）
- 修改：`bin/unity.js`（USAGE）
- 创建：`test/golden.test.js`

**决策与依据：**
- **两轮、无持久基线**（规格 §6.2 原文：同一组确定性指令跑两轮，比对 `get-hierarchy`，报首个分歧路径）→ 不存在「基线过期」问题，也不需要把快照写进仓库。
- **「剥 GUID」在本版本上的实况**：`get-hierarchy` 的真机输出**根本没有 GUID 字段**（实测 `S0Project/.uloop/outputs/HierarchyResults/hierarchy_2026-09-19_01-23-35.json` 的顶层键是 `ExportTimestamp` / `Context` / `Hierarchy`，节点键是 `name/isActive/components/siblingIndex/tag/layer/children`）。唯一易变的是 `ExportTimestamp`。为了对未来版本稳健，**用白名单投影**（只留 `name/active/components/siblingIndex/tag/layer/children`）而不是黑名单删除 —— 上游新增任何字段都不会误判成「变异」。
- **必须保留 `siblingIndex`/`tag`/`layer`**（M1 的 `normalizeHierarchy` 丢弃了它们，JSDoc 已注明「任务 10 需要时自行从 raw 取用」）：它们是结构的一部分（顺序、tag、layer），丢了会让「顺序变了」这类真实变异漏检。改动是 **additive**（既有断言全是逐字段断言，已核对不会破）。
- **`diff` 是结构化的**（不只是字符串）：`{path, kind, a, b}`，`kind ∈ 'value'|'type'|'array-length'|'missing-left'|'missing-right'`；`path` 用 `roots[0].children[1].components[2]` 形式，根为 `<root>`。
- **清理必须可信**：跑完删临时根 + **读回确认**（再取一次 `sceneTree`，确认找不到 `__pi_golden`）；删不掉 → `cleanup.status='failed'` + 显式残留路径 + 手工命令，**绝不谎报成功**。
- **写入副作用要说明**：golden 会向当前场景建临时节点（随后删除），编辑器场景变 dirty；本命令**不保存场景**。

- [ ] **步骤 1：编写失败的测试**

```js
// test/helpers/fake-scene.js
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * 「内存场景」假后端：注入给 lib 的 `_call`，让 golden / smoke 这类多步流程**不碰编辑器**也能测。
 *
 * - `execute-dynamic-code` 按 `--code-file` 的脚本名分派，模拟 node-create / node-set / node-inspect / node-delete；
 * - `get-hierarchy` 把当前内存模型写成临时 JSON 文件并返回路径（`sceneTree` 会去读它）；
 * - 每次调用都记进 `calls`，供断言「有没有发起某次调用」。
 *
 * 它**不 spawn 任何进程**，也不读真实项目（全局约束 13 + 单测密闭要求）。
 */
function makeFakeSceneBackend({ baseScene = [] } = {}) {
  const nodes = new Map();
  for (const n of baseScene) {
    nodes.set(n.path, { name: n.path, active: true, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, components: ['Transform'], ...n });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-fake-scene-'));
  const calls = [];
  let snap = 0;

  const findByPath = (p) => nodes.get(p) || null;

  const hierarchyOf = () => {
    const roots = [];
    const byPath = new Map();
    for (const [p, n] of nodes) {
      const node = {
        name: n.name, isActive: n.active, components: [...n.components],
        siblingIndex: n.siblingIndex ?? 0, tag: n.tag ?? 'Untagged', layer: n.layer ?? 0, children: [],
      };
      byPath.set(p, node);
      const slash = p.lastIndexOf('/');
      if (slash === -1) roots.push(node);
      else { const parent = byPath.get(p.slice(0, slash)); if (parent) parent.children.push(node); else roots.push(node); }
    }
    const count = (list) => list.reduce((n, x) => n + 1 + count(x.children), 0);
    return {
      ExportTimestamp: `2026-09-19 00:00:0${snap}`,
      Context: { sceneType: 'editor', sceneName: '', nodeCount: count(roots), maxDepth: 0 },
      Hierarchy: [{ sceneName: '', stats: { rootCount: roots.length, nodeCount: count(roots), maxDepth: 0 }, roots }],
    };
  };

  const wrap = (json) => ({ code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false });

  const call = async (tool, args) => {
    calls.push({ tool, args });
    // 探活（dispatcher 级命令）：doctor 的 smoke/collectChecks 第一步就是它（R115 的真实形状）
    if (tool === 'list') return wrap({ Version: '3.4.0', Tools: [] });
    if (tool === 'get-hierarchy') {
      const file = path.join(dir, `h${++snap}.json`);
      fs.writeFileSync(file, JSON.stringify(hierarchyOf()));
      return wrap({ Success: true, HierarchyFilePath: file });
    }
    if (tool !== 'execute-dynamic-code') throw new Error(`假后端不认的工具：${tool}`);
    const script = String(args[1] || '').split(/[\\/]/).pop();
    const payload = JSON.parse(JSON.parse(args[3]).p);
    if (script === 'node-create.cs') {
      const p = payload.parent ? `${payload.parent}/${payload.name}` : payload.name;
      if (payload.parent && !findByPath(payload.parent)) return wrap({ Success: true, Result: JSON.stringify({ __error: 'PARENT_NOT_FOUND', parent: payload.parent }) });
      if (findByPath(p)) return wrap({ Success: true, Result: JSON.stringify({ __error: 'NAME_EXISTS' }) });
      nodes.set(p, { name: payload.name, active: true, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, components: ['Transform', ...(payload.components || [])] });
      return wrap({ Success: true, Result: JSON.stringify({ name: payload.name, active: true, path: p }) });
    }
    if (script === 'node-inspect.cs') {
      const n = findByPath(payload.path);
      if (!n) return wrap({ Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) });
      return wrap({ Success: true, Result: JSON.stringify({ ...n, path: payload.path }) });
    }
    if (script === 'node-set.cs') {
      const n = findByPath(payload.path);
      if (!n) return wrap({ Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) });
      const next = { ...n };
      if (payload.patch.name !== undefined) next.name = payload.patch.name;
      if (payload.patch.active !== undefined) next.active = payload.patch.active;
      if (payload.patch.position) next.position = payload.patch.position;
      if (payload.patch.scale) next.scale = payload.patch.scale;
      nodes.set(payload.path, next);
      return wrap({ Success: true, Result: '{"__written":true}' });
    }
    if (script === 'node-delete.cs') {
      const n = findByPath(payload.path);
      if (!n) return wrap({ Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) });
      nodes.delete(payload.path);
      return wrap({ Success: true, Result: JSON.stringify({ __deleted: true, path: payload.path }) });
    }
    throw new Error(`假后端不认的脚本：${script}`);
  };

  return { call, nodes, calls, dir, snapshotCount: () => snap };
}

module.exports = { makeFakeSceneBackend };
```

```js
// test/golden.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { projectNode, projectStructure, firstDiff, formatDiff, runGolden, GOLDEN_ROOT } = require('../lib/golden.js');
const { normalizeHierarchy } = require('../lib/scene.js');
const { makeFakeSceneBackend } = require('./helpers/fake-scene.js');

test('normalizeHierarchy 现在 additive 保留 siblingIndex/tag/layer（M1 丢弃，golden 需要）', () => {
  const n = normalizeHierarchy({
    Hierarchy: [{
      stats: { nodeCount: 1, maxDepth: 0 },
      roots: [{ name: 'Main Camera', isActive: true, components: ['Transform'], siblingIndex: 0, tag: 'MainCamera', layer: 0, children: [] }],
    }],
  });
  assert.strictEqual(n.roots[0].siblingIndex, 0);
  assert.strictEqual(n.roots[0].tag, 'MainCamera');
  assert.strictEqual(n.roots[0].layer, 0);
});

test('projectNode/projectStructure：白名单投影（易变字段一律不进投影）', () => {
  const node = { name: 'A', active: true, components: ['Transform'], siblingIndex: 2, tag: 'Untagged', layer: 5, path: 'A', strange: 1, children: [] };
  assert.deepStrictEqual(projectNode(node), { name: 'A', active: true, components: ['Transform'], siblingIndex: 2, tag: 'Untagged', layer: 5, children: [] });
  const proj = projectStructure({ sceneName: 'S', nodeCount: 1, maxDepth: 0, roots: [node], otherSceneCount: 0, otherSceneNames: [], tooDeep: false });
  assert.deepStrictEqual(proj, { sceneName: 'S', nodeCount: 1, roots: [projectNode(node)] });
});

test('firstDiff：类型/数组长度/缺键/值 四类，路径格式可读', () => {
  assert.strictEqual(firstDiff({ a: 1 }, { a: 1 }), null, '一致时 null');
  assert.deepStrictEqual(firstDiff({ a: 1 }, { a: '1' }), { path: 'a', kind: 'type', a: 1, b: '1' });
  assert.deepStrictEqual(firstDiff({ a: [1, 2] }, { a: [1] }), { path: 'a', kind: 'array-length', a: 2, b: 1 });
  assert.deepStrictEqual(firstDiff({ a: 1 }, {}), { path: 'a', kind: 'missing-right', a: 1, b: undefined });
  assert.deepStrictEqual(firstDiff({}, { a: 1 }), { path: 'a', kind: 'missing-left', a: undefined, b: 1 });
  const d = firstDiff({ roots: [{ children: [{ name: 'B' }] }] }, { roots: [{ children: [{ name: 'C' }] }] });
  assert.deepStrictEqual(d, { path: 'roots[0].children[0].name', kind: 'value', a: 'B', b: 'C' });
  assert.match(formatDiff(d), /roots\[0\]\.children\[0\]\.name/);
  assert.match(formatDiff(d), /"B"/);
});

test('runGolden 两轮一致：ok:true / matched:true / cleanup ok，且临时根被删掉', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const r = await runGolden({ projectPath: 'P', _call: be.call });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.diff, null);
  assert.strictEqual(r.cleanup.status, 'ok');
  assert.strictEqual(r.blocked, null);
  assert.strictEqual(be.nodes.has(GOLDEN_ROOT), false, '临时根必须被删除');
  // R210：两轮 = **2 次** get-hierarchy（每轮跑完 `runRound` 后取一次结构快照；
  // 清理走 `nodeDelete` 的写后读回，成功时**不再**取 `get-hierarchy`）——旧稿写「≥ 4」不可达。
  assert.ok(be.snapshotCount() >= 2, `快照次数 ${be.snapshotCount()}`);
  // 步骤包含嵌套节点（裸名规则）与 setActive(false)（inactive 查找路径）
  assert.ok(be.calls.some((c) => JSON.stringify(c.args).includes('GOLDEN_B')));
});

test('runGolden 检出变异：报首个分歧路径（结构化 diff）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  // R210：`runRound` × 2 = **2 次** get-hierarchy（旧稿的 `>= 3` 不可达 → 用例必绿不红）。
  // 第 2 次（即第 2 轮的快照）时注入变异：它与第 1 轮快照必然不同 → 能真红。
  let snapshots = 0;
  const call = async (tool, args) => {
    const r = await be.call(tool, args);
    if (tool === 'get-hierarchy') {
      snapshots++;
      if (snapshots >= 2) {
        const fs = require('node:fs');
        const raw = JSON.parse(fs.readFileSync(r.json.HierarchyFilePath, 'utf8'));
        const find = (list, name) => { for (const n of list) { if (n.name === name) return n; const h = find(n.children, name); if (h) return h; } return null; };
        const b = find(raw.Hierarchy[0].roots, 'GOLDEN_B');
        if (b) b.components = [...b.components, 'SpriteRenderer'];
        fs.writeFileSync(r.json.HierarchyFilePath, JSON.stringify(raw));
      }
    }
    return r;
  };
  const r = await runGolden({ projectPath: 'P', _call: call });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.matched, false);
  assert.strictEqual(r.diff.kind, 'array-length');
  assert.match(r.diff.path, /GOLDEN_B|components/);
  assert.ok(r.lines.some((l) => /首个分歧/.test(l)));
});

test('runGolden 清理失败：不谎报成功，给出残留路径与手工命令', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const call = async (tool, args) => {
    const r = await be.call(tool, args);
    // 让 node-delete 永远报错 → 清理必然失败
    if (tool === 'execute-dynamic-code' && String(args[1]).endsWith('node-delete.cs')) {
      return { ...r, json: { Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) } };
    }
    return r;
  };
  const r = await runGolden({ projectPath: 'P', _call: call });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.cleanup.status, 'failed');
  assert.strictEqual(r.cleanup.path, GOLDEN_ROOT);
  assert.ok(r.lines.some((l) => /残留|手工|unity node delete/.test(l)));
});

test('runGolden 连不上编辑器：blocked，不谎称 matched', async () => {
  const r = await runGolden({
    projectPath: 'P',
    _call: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, drained: false, json: { Success: false, Error: { ErrorCode: 'UNITY_NOT_REACHABLE', Phase: 'connection', Message: 'nope' } }, truncated: false }),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.matched, null);
  assert.match(r.blocked, /UNITY_NOT_REACHABLE|连不上|doctor/);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/golden.test.js`
预期：FAIL —— `Cannot find module '../lib/golden.js'`；`normalizeHierarchy` 的 additive 断言为 `undefined`。

- [ ] **步骤 3：编写最少实现代码**

`lib/scene.js` 的 `normalizeHierarchy`：把 `walk` 的返回对象改成（**additive**，只加三个字段）：

```js
    return {
      name: n.name,
      path: p,
      active: n.isActive,
      components: n.components || [],
      // M2 additive（golden 的结构比对需要它们；M1 的 JSDoc 曾注明「需要时自行从 raw 取用」）：
      // siblingIndex 是**顺序**信息（丢了会让「顺序变了」这类变异漏检），tag/layer 也是结构的一部分。
      siblingIndex: n.siblingIndex,
      tag: n.tag,
      layer: n.layer,
      children: rawChildren.map((c) => walk(c, p, depth + 1)),
    };
```

并把深度超限那条提前返回也补上同样三个字段（保持一致；那里 `children: []`）。

```js
// lib/golden.js
'use strict';

const { sceneTree, nodeCreate, nodeSet, nodeDelete } = require('./scene.js');

/**
 * `doctor --golden`：**同一组确定性指令搭两轮**，比对 `get-hierarchy` 的**结构投影**，报首个分歧路径。
 *
 * 为什么用白名单投影而不是「剥 GUID」：本版本 `get-hierarchy` 的真机输出**没有 GUID 字段**
 * （实测 2026-09-19，节点键只有 name/isActive/components/siblingIndex/tag/layer/children，
 * 顶层只有 ExportTimestamp/Context/Hierarchy），唯一的易变字段是 ExportTimestamp。
 * 白名单投影对未来新增字段免疫（不会把上游加字段误判成变异），也把「只比结构」这件事写在明处。
 *
 * 清理纪律（照搬 pi-cocos 的 golden）：跑完必须删掉临时根 + **读回确认**；删不掉就显式报残留
 * 路径与手工命令，**绝不谎报成功**，也绝不在有残骸的情况下继续下一轮。
 *
 * ⚠️ 本命令会向**当前场景**写临时节点（随后删除），编辑器场景会变 dirty；本命令**不保存场景**。
 */

/** 临时根名（两轮都用同一个名字，故可整树比对；也是清理的锚点）。 */
const GOLDEN_ROOT = '__pi_golden';

/**
 * 确定性指令集（**写死**；每一步的参数都是常量）。
 * 覆盖：根节点 / 子节点 / 带组件的子节点 / 嵌套子节点（裸名规则的边界）/ `node set` 的 position+scale /
 * `active:false`（**验证删除路径也能命中非激活节点**，R80/R82 的核心）。
 */
const GOLDEN_STEPS = [
  { kind: 'create', name: GOLDEN_ROOT },
  { kind: 'create', name: 'GOLDEN_A', parent: GOLDEN_ROOT },
  { kind: 'create', name: 'GOLDEN_B', parent: GOLDEN_ROOT, components: ['SpriteRenderer'] },
  { kind: 'create', name: 'GOLDEN_C', parent: `${GOLDEN_ROOT}/GOLDEN_B` },
  { kind: 'set', path: GOLDEN_ROOT, patch: { position: { x: 1, y: 2, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
  { kind: 'set', path: `${GOLDEN_ROOT}/GOLDEN_B`, patch: { active: false } },
];

/** 单个节点的结构投影（白名单：只保留结构字段，易变/无关字段一律丢弃）。 */
function projectNode(node) {
  const n = node && typeof node === 'object' ? node : {};
  return {
    name: n.name,
    active: n.active,
    components: Array.isArray(n.components) ? [...n.components] : [],
    siblingIndex: n.siblingIndex,
    tag: n.tag,
    layer: n.layer,
    children: (Array.isArray(n.children) ? n.children : []).map(projectNode),
  };
}

/** 整棵树的投影（`normalizeHierarchy` 的产物 → 可比对的结构）。 */
function projectStructure(normalized) {
  const n = normalized && typeof normalized === 'object' ? normalized : {};
  return {
    sceneName: n.sceneName,
    nodeCount: n.nodeCount,
    roots: (Array.isArray(n.roots) ? n.roots : []).map(projectNode),
  };
}

/**
 * 首个分歧（**结构化**，不只是字符串）。`kind` 语义：
 *   - `'type'`          两侧类型不同（含 `array` vs `object`）
 *   - `'array-length'`  数组长度不同（`a`/`b` 是长度数字）
 *   - `'missing-right'` 只有 a 有该键（b 缺）
 *   - `'missing-left'`  只有 b 有该键（a 缺）
 *   - `'value'`         值不同
 * `path` 形如 `roots[0].children[1].components[2]`；根为 `<root>`。
 */
function firstDiff(a, b, path = '') {
  if (a === b) return null;
  const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  if (kindOf(a) !== kindOf(b)) return { path: path || '<root>', kind: 'type', a, b };
  if (Array.isArray(a)) {
    if (a.length !== b.length) return { path: path || '<root>', kind: 'array-length', a: a.length, b: b.length };
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      const p = path ? `${path}.${k}` : k;
      const ha = Object.hasOwn(a, k);
      const hb = Object.hasOwn(b, k);
      if (ha && !hb) return { path: p, kind: 'missing-right', a: a[k], b: undefined };
      if (!ha && hb) return { path: p, kind: 'missing-left', a: undefined, b: b[k] };
      const d = firstDiff(a[k], b[k], p);
      if (d) return d;
    }
    return null;
  }
  return { path: path || '<root>', kind: 'value', a, b };
}

/** `{path}` 可读化（给人读输出用；JSON 里给的是结构本身）。 */
function formatDiff(d) {
  return `${d.path}（${d.kind}）：${JSON.stringify(d.a)} vs ${JSON.stringify(d.b)}`;
}
```

> ⚠️ **同一个文件的续段**：下面这段直接接在上面的文件之后（同属一个文件，中间不能有任何其它内容）。

```js
/**
 * 「连不上编辑器」这类失败必须报 blocked（不是 step failed）——它们的共同点是
 * **重跑同样的指令也不会成功**，判据是「不是本次指令本身的错」：
 * 传输层截断 / dispatcher 未起 / 连接类 phase / 运行时不可达。
 */
function isConnectivityFailure(e) {
  if (!e) return false;
  if (e.phase === 'connection') return true;
  if (typeof e.code === 'string' && e.code.startsWith('ULOOP_')) return true;
  return ['UNITY_NOT_REACHABLE', 'WRITE_CALL_FAILED', 'CONNECTION_FAILED'].includes(e.code);
}

/** 在 roots 里按名字深找（给清理的读回确认用）。 */
function findByName(roots, name) {
  for (const r of Array.isArray(roots) ? roots : []) {
    if (!r || typeof r !== 'object') continue;
    if (r.name === name) return r;
    const hit = findByName(r.children, name);
    if (hit) return hit;
  }
  return null;
}

/** 跑一轮指令集并取一次结构快照。返回 `{ok, error, errorEnvelope, snapshot}`。 */
async function runRound({ projectPath, env, _call }) {
  for (const s of GOLDEN_STEPS) {
    const e = s.kind === 'create'
      ? await nodeCreate({ projectPath, env, name: s.name, parent: s.parent, components: s.components || [], _call })
      : await nodeSet({ projectPath, env, path: s.path, patch: s.patch, _call });
    // 铁律：写命令必须 verified !== false 才算这一步成功（ok:true + verified:false 也是失败）
    if (!e.ok || e.verified === false) {
      return {
        ok: false,
        error: `${s.kind} ${s.name || s.path} 失败：${e.code || 'verified:false'}${e.message ? ` ${e.message}` : ''}`,
        errorEnvelope: e,
      };
    }
  }
  const tree = await sceneTree({ projectPath, env, _call });
  if (!tree.ok) return { ok: false, error: `读快照失败：${tree.code} ${tree.message}`, errorEnvelope: tree };
  return { ok: true, snapshot: projectStructure(tree.actual) };
}

/** 删临时根并**读回确认**。返回 `{status: 'ok'|'failed', path, recovered?, code?, message?}`。 */
async function cleanupGolden({ projectPath, env, _call }) {
  const del = await nodeDelete({ projectPath, env, path: GOLDEN_ROOT, _call });
  if (del.ok && del.verified === true) return { status: 'ok', path: GOLDEN_ROOT, recovered: false };
  // 二次确认：可能「删除其实生效了但读回抖了一下」
  const tree = await sceneTree({ projectPath, env, _call });
  if (tree.ok && !findByName(tree.actual.roots, GOLDEN_ROOT)) {
    return { status: 'ok', path: GOLDEN_ROOT, recovered: true };
  }
  return {
    status: 'failed',
    path: GOLDEN_ROOT,
    code: del.code || (tree.ok ? null : tree.code),
    message: del.message || (tree.ok ? '删除后仍能在场景里找到临时根' : tree.message),
  };
}

/**
 * `doctor --golden` 的主流程。返回 pi-cocos 同形的结果对象（供 doctor 输出与 `--json` 使用）：
 * `{ok, matched, diff, cleanup, blocked, lines}`；`matched` 为 `null` 表示**没有完成比对**
 * （被 blocked 或清理失败）——不许把「没比成」写成 `matched:false`（那是「比了且不一致」）。
 */
// ⚠️ 已被 R290 / R295 / R289 取代，见实现（`lib/golden.js`）：
//   ① R295①：去掉 `failedStep > 0` 门——只要过了开局预检就**一律** `cleanupGolden`（首个 create
//      可能「写已落场景、读回才失败」，旧门会留残骸却报「未创建节点，无需清理」）；
//   ② R295②：`status:'none'` 只留给「开局预检就 blocked、未发出任何写调用」的早退路径；
//      此后一律走 `mergeCleanup`（跨轮累积 `recovered`）；
//   ③ R290：第 1 轮之前先 `sceneTree` 预检既有 `__pi_golden` 残留；
//   ④ R289：`cleanupLine` 按 `cleanup.confirmed` 区分「确证残留」/「无法确认」（本条下方仍是旧文案）。
async function runGolden({ projectPath, env, _call } = {}) {
  const lines = ['场景回归黄金测试（同一组确定性指令搭两轮，比对 get-hierarchy 的结构投影）'];
  let cleanup = { status: 'none', path: null };

  // R206③：返回值形状**固定 6 个键**（与接口总表逐字一致）——`errorEnvelope` 只用于内部
  // 判断「是不是连不上」，**不进** runGolden 的返回值（否则成功/失败两种路径的键集不同，形状断言无法写）。
  const blockedResult = (reason) => {
    lines.push(`⛔ 无法执行：${reason}`);
    lines.push(cleanupLine(cleanup));
    return { ok: false, matched: null, diff: null, blocked: reason, cleanup, lines };
  };

  // ① 第一轮
  const a = await runRound({ projectPath, env, _call });
  if (!a.ok) {
    cleanup = await cleanupGolden({ projectPath, env, _call });
    if (isConnectivityFailure(a.errorEnvelope)) return blockedResult(a.error);
    lines.push(`❌ ${a.error}`);
    lines.push(cleanupLine(cleanup));
    return { ok: false, matched: null, diff: null, blocked: null, cleanup, lines };
  }
  cleanup = await cleanupGolden({ projectPath, env, _call });
  if (cleanup.status === 'failed') {
    lines.push('❌ 第一轮临时节点删除失败，放弃本轮比对（不带着残骸继续）');
    lines.push(cleanupLine(cleanup));
    return { ok: false, matched: null, diff: null, blocked: null, cleanup, lines };
  }

  // ② 第二轮
  const b = await runRound({ projectPath, env, _call });
  if (!b.ok) {
    const c2 = await cleanupGolden({ projectPath, env, _call });
    if (c2.status === 'failed') cleanup = c2;
    if (isConnectivityFailure(b.errorEnvelope)) return blockedResult(b.error);
    lines.push(`❌ ${b.error}`);
    lines.push(cleanupLine(cleanup));
    return { ok: false, matched: null, diff: null, blocked: null, cleanup, lines };
  }
  const del = await cleanupGolden({ projectPath, env, _call });
  if (del.status === 'failed') cleanup = del;
  else cleanup = { status: 'ok', path: GOLDEN_ROOT, recovered: cleanup.recovered === true || del.recovered === true };

  // ③ 比对
  const diff = firstDiff(a.snapshot, b.snapshot);
  lines.push(`  轮 1 节点数：${countNodes(a.snapshot)}`);
  lines.push(`  轮 2 节点数：${countNodes(b.snapshot)}`);
  if (diff === null) lines.push('✅ 两轮一致：同一组指令产出了相同的场景结构');
  else lines.push(`❌ 检测到结构变异：首个分歧在 ${formatDiff(diff)}`);
  lines.push(cleanupLine(cleanup));

  return {
    ok: diff === null && cleanup.status !== 'failed',
    matched: diff === null,
    diff,
    blocked: null,
    cleanup,
    lines,
  };
}

/** 投影里的节点总数（含投影的 roots）。 */
function countNodes(proj) {
  const walk = (list) => (Array.isArray(list) ? list.reduce((n, x) => n + 1 + walk(x.children), 0) : 0);
  return walk(proj && proj.roots);
}

/** 清理状态的一行说明（绝不把 failed 写成 ok）。 */
function cleanupLine(cleanup) {
  if (cleanup.status === 'ok' && cleanup.recovered) return '清理：直接删除后的读回一度不一致，但二次读回确认临时根已消失（已回收）';
  if (cleanup.status === 'ok') return '清理：无残留（临时节点已删除并读回确认）';
  if (cleanup.status === 'failed') {
    return `❌ 清理：临时根仍在场景里（${cleanup.path}）——请手工执行 \`unity node delete --path ${cleanup.path}\`，或直接在编辑器里删掉它；本命令不保存场景`;
  }
  return '清理：未创建节点，无需清理';
}

module.exports = {
  runGolden, projectNode, projectStructure, firstDiff, formatDiff,
  cleanupGolden, runRound, isConnectivityFailure, GOLDEN_ROOT, GOLDEN_STEPS,
};
```

`lib/doctor.js` 的 `doctor()` 开头（在 `parseArgs` 之后、`args.smoke` 分支**之前**）插入：

```js
  // `--smoke` 与 `--golden` 都会向当前场景写入：混跑会让「谁建的节点」无法归因，直接用退出码 2 拒绝。
  if (args.smoke && args.golden) {
    process.stderr.write('--smoke 与 --golden 不能同时用（两者都会向当前场景写入，混跑无法归因）\n');
    return 2;
  }

  if (args.golden) {
    const { runGolden } = require('./golden.js');
    const r = await runGolden({ projectPath: args['project-path'], env, rootDir, runImpl });
    if (args.json) {
      process.stdout.write(JSON.stringify({
        ok: r.ok,
        mode: 'golden',
        matched: r.matched,
        diff: r.diff,
        cleanup: r.cleanup,
        blocked: r.blocked,
        lines: r.lines,
      }, null, 2) + '\n');
    } else {
      for (const l of r.lines) process.stdout.write(`${l}\n`);
    }
    return r.ok ? 0 : 1;
  }
```

> **R210：块与注释对齐（`_call` 形参要到任务 10 才有）**。`runGolden` 只吃 `{projectPath, env, _call}`；任务 9 的
> `doctor --golden` 分支就按上面那块代码**只传 `{projectPath, env, rootDir, runImpl}`**（`runGolden` 会忽略后两个未知键）——
> **不要**在这一步给 `doctor()` 加 `_call` 形参（那是任务 10 为 `--smoke` 加的事，现在加会让任务 9/10 的文件改动面重叠）。
> `runGolden` 自己的 `_call` 注入缝由 `test/golden.test.js` **直接调 `runGolden({ ..., _call })`** 驱动（它不需要经过 doctor）；
> `doctor --json --golden` 的形状断言则在**任务 10**用新加的 `_call` 透传缝补（见任务 10 的用例清单）。

`bin/unity.js` 的 `USAGE` 里 `doctor` 那行改成：

```
  doctor                 环境检查（--smoke 冒烟 / --golden 场景回归 / --json 机器可读）
                         ⚠️ --smoke 与 --golden **都会向当前场景写入**（临时节点随后删除）；
                            --smoke 建 __pi_smoke，--golden 建 __pi_golden；都不保存场景
                         ⚠️ 两者不能同时用（退出码 2）
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/golden.test.js` → PASS（**8 条**：7 条既有 + 1 条 R206③ 形状断言；R210 计数统一为 8）。
运行：`npm test` → PASS（本任务新增 8 条 → 总数应为 **301**；以实际为准）。

> **R206③④：把实际形状写清楚 + 补一条形状断言**（旧的四个 `GOLDEN_*` 码已从接口总表里删——`runGolden` **从不产错误码**）。
> - `runGolden({projectPath, env, _call})` 实际返回 **恰好这 6 个键**（成功/失败/blocked 三条路径键集相同）：
>   `{ok, matched, diff, cleanup, blocked, lines}`：
>   - `ok:boolean`（`diff===null && cleanup.status!=='failed'`）；
>   - `matched:boolean|null`（`null` = 没比成：被 blocked 或清理失败；**绝不用 `false` 冒充「没比成」**）；
>   - `diff:null | {path,kind,a,b}`；
>   - `cleanup:{status:'none'|'ok'|'failed', path:string|null, recovered?, code?, message?}`；
>     ⚠️ **已被 R289/R295 取代，见实现**：`failed` 还会带 additive 键 `confirmed?:boolean`
>     （`true` = 读到场景且根还在；`false` = 连场景都读不到 → 只能报「无法确认」），见 `lib/golden.js:160-190`。
>   - `blocked:null | string`（连不上编辑器等重跑也不会成功的原因）；
>   - `lines:string[]`。
>   （`runRound` 内部的 `errorEnvelope` 只用于 `isConnectivityFailure` 判断，**不进**返回值。）
> - `doctor --json --golden` 的 JSON 形状（**显式例外**，不叫 `checks`）：
>   `{ok, mode:'golden', matched, diff, cleanup, blocked, lines}` —— 内容与上面 6 键一致。
>
> 追加到 `test/golden.test.js` 的形状断言（不依赖任何上游行为，纯形状）：
>
> ```js
> test('R206③：runGolden 的返回形状固定（逐字键集；成功/blocked 两条路径同形）', async () => {
>   const KEYS = ['blocked', 'cleanup', 'diff', 'lines', 'matched', 'ok'];
>   const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
>   const r = await runGolden({ projectPath: 'P', _call: be.call });
>   assert.deepStrictEqual(Object.keys(r).sort(), KEYS);
>   const blocked = await runGolden({
>     projectPath: 'P',
>     _call: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, drained: false, spawnError: null, truncated: false, json: { Success: false, Error: { ErrorCode: 'UNITY_NOT_REACHABLE', Phase: 'connection', Message: 'nope' } }, tool: 'x', args: [] }),
>   });
>   assert.deepStrictEqual(Object.keys(blocked).sort(), KEYS);
>   assert.strictEqual(blocked.matched, null, '没比成必须是 null，不得写成 false');
> });
> ```
>
> （`doctor --json --golden` 的 doctor 级形状断言放在**任务 10**——那里才有 doctor 的 `_call` 透传缝。）

- [ ] **步骤 5：真机验证（必做 —— golden 的确定性只有真机能证）**

```bash
P=C:/Users/<用户>/pi-unity-spike/S0Project
md5sum "$P/Assets/Scenes/SampleScene.scene" > /tmp/before.md5
node bin/unity.js doctor --project-path $P --golden ; echo "exit=$?"
node bin/unity.js doctor --project-path $P --golden --json ; echo "exit=$?"
node bin/unity.js scene tree --project-path $P --json | grep -c __pi_golden ; echo "grep=$?"   # 期望 0
md5sum "$P/Assets/Scenes/SampleScene.scene" > /tmp/after.md5 && (diff /tmp/before.md5 /tmp/after.md5 && echo "场景未被保存" || echo "⚠️ 场景被保存了")
```

**必须写进报告的**：① 两次运行的退出码；② `matched` 真值；③ 若 `matched:false`，**原样贴出 `diff`**（`{path,kind,a,b}`）与 `lines` —— 这就是「复杂场景 golden 是否成立」的真机答案（规格 R7 只验证过单相机场景）；④ `cleanup.status`；⑤ 场景 md5 是否变化。
**若 `matched:false`**：按全局约束 17 如实登记到 `docs/PITFALLS.md`（U 条目：`get-hierarchy` 的哪个字段不确定 + 适用引擎），**并且**把该分歧路径写进 `lib/golden.js` 的注释与 skill 的「已知不确定性」一节；**不许**为了让 golden 变绿而把那个字段从投影里删掉（那等于把真变异洗掉）——除非有实测证据证明它是**时间戳类**字段（那时才允许按白名单口径把它排除，并在 PITFALLS 里写明理由）。

- [ ] **步骤 6：Commit**

```bash
git add lib/golden.js lib/scene.js lib/doctor.js bin/unity.js test/golden.test.js test/helpers/fake-scene.js
git commit -m "feat(doctor): --golden 场景回归（两轮结构投影 + 结构化首个分歧路径 + 可信清理）"
```

---

## 任务 10：`doctor --smoke` 的写-读回-删自闭环 + `--json` 契约统一（集成）

**文件：**
- 修改：`lib/doctor.js`（smoke 写闭环 + 逐项 `code` + `--json` 键统一 + `_call` 注入缝）
- 修改：`bin/unity.js`（USAGE 说明 `--smoke` 不再只读）
- 修改：`test/doctor.test.js`
- 修改：`skills/unity-game-dev/SKILL.md`（`--smoke` 的语义变化）

**决策与依据：**
- **规格 §6.2 原文**：`doctor --smoke` = 「只读工具逐个跑 + **写-读回-删自闭环**，逐项 pass/fail」。M1 只做了前半句，M2 补后半句。**因此 `--smoke` 从 M2 起不再只读** —— 这一点必须同时写进 skill 与 `USAGE`（用户已确认）。
- 写闭环用**我们自己的库函数**（`nodeCreate`/`nodeSet`/`nodeDelete`/`sceneTree`），不是裸 uloop —— 这样闭环同时验证「信封层 + 读写回 + 删除读回」整条链（比 pi-cocos 的 smoke 更强）。
- **开局清残留**：若上一次跑挂了留下 `__pi_smoke`，先删掉它（并读回确认），否则 `nodeCreate` 会建出同名第二个节点、`nodeInspect` 路径语义变歧义（照搬 pi-cocos golden 的做法）。
- **`--json` 契约统一**（M1 延后项④）：两种模式都用 `{ok, mode, checks}`，每项都带 `code`（pass 为 `null`、skip 为 `'NOT_CONNECTED'`、fail 为具名码）。`ok` 的语义钉死为「**本次检查集通过**」（基础模式 = 无 fail；冒烟模式 = 无 fail 且**无 skip** 且至少一项 pass，沿用 M1 的 R39/R45 口径），并在 `USAGE`/skill 里写明它**不是**信封的 `ok`（信封还有 `verified`）。

- [ ] **步骤 1：编写失败的测试**

> **R205：先逐条列出要改的**既有**断言**（`test/doctor.test.js`，行号以当前工作树为准）。smoke 从 3 项→ 7 项 + `--json` 键名 `results` → `checks`，必然打破下表 ≥ 8 处。
> **改法分两类**：（a）用例意图只是「3 个只读工具的语义」的 → 把断言改成 `results.slice(0, 3)`（保住意图，不再受写闭环干扰）；（b）用例本就要看全量或全局语义（names/总数/JSON 键/人读尾行）的 → 改成 7 项/新键名/新措辞。
>
> | 文件:行 | 旧期望 | 新期望 |
> |---|---|---|
> | `test/doctor.test.js:250` | `results.map(status) === ['pass','pass','pass']` | `results.length === 7` 且 `results.slice(0,3).map(status) === ['pass','pass','pass']` |
> | `test/doctor.test.js:267` | `results.map(status) === ['fail','pass','pass']` | 同上（`slice(0,3)` 保持 `['fail','pass','pass']`，另加 `length === 7`） |
> | `test/doctor.test.js:277–281` | `results.every(skip)` + `results[0]/[1]/[2]` 两两不同 hint | `results.length === 7 && results.every(skip)`；hint 两两不同改为 `new Set(results.map((r) => r.hint)).size === 7` |
> | `test/doctor.test.js:294` | `results.map(name) === ['compile','get-logs','get-hierarchy']` | `['compile','get-logs','get-hierarchy','write-create','write-set','write-delete','write-clean']` |
> | `test/doctor.test.js:295` | `results.map(status) === ['pass','pass','pass']` | `slice(0,3)` → `['pass','pass','pass']`；写闭环四项由新增用例（`_call: makeFakeSceneBackend`）覆盖 |
> | `test/doctor.test.js:299` | `for (const r of results) deepStrictEqual(r.hint, [])` | 只对 `results.slice(0,3)` 断言 `hint === []` |
> | `test/doctor.test.js:305` | `results.map(status) === ['fail','fail','fail']` | `slice(0,3)` → `['fail','fail','fail']`（本用例的注入只覆盖只读三工具） |
> | `test/doctor.test.js:310` | `for (const r of results) deepStrictEqual(r.hint, [])` | 只对 `results.slice(0,3)` 断言 |
> | `test/doctor.test.js:329` | `skippedJson.results.map(status) === ['skip','skip','skip']` | `skippedJson.checks.map(status) === ['skip'×7]`（键名 `results`→`checks`） |
> | `test/doctor.test.js:343` | `passedJson.results.map(status) === ['pass','pass','pass']` | `passedJson.checks`：只读三项 `pass` + 写闭环四项 `pass`（本用例改用 `_call: makeFakeSceneBackend` 驱动） |
> | `test/doctor.test.js:349` | `/冒烟未执行（3 项被跳过）：未能验证任何工具/` | `/冒烟未执行（7 项被跳过）：未能验证任何工具/` |
> | `test/doctor.test.js:362–363` | `results.map(status) === ['fail','fail','fail']` | `slice(0,3)` → 同（drained 注入只覆盖只读三工具） |
> | `test/doctor.test.js:398` | `results.map(status) === ['fail','fail','fail']`（三种文案形态） | `slice(0,3)` → 同 |
> | `test/doctor.test.js:414–415` | `results.map(status) === ['fail','fail','fail']` + 遍历全部 `/无法启动 dispatcher/` | `slice(0,3)` → 同；遍历改为只遍历 `results.slice(0,3)`（spawnError 下写闭环四项的错误码不同） |
> | `test/doctor.test.js:439` | `results.map(status) === ['fail','pass','pass']` | `slice(0,3)` → 同（工具级失败不得自称连接问题） |
>
> 另：所有注入 `runImpl` 的 smoke 用例在写闭环下会多打 4 项，**要么**按上表 `slice(0,3)`，**要么**改用 `_call: makeFakeSceneBackend`（推荐后者给「写闭环全绿/失败/清残留」三条新用例）。

追加到 `test/doctor.test.js`（顶部 import 加 `makeFakeSceneBackend`）：

```js
// ─────────────────── M2 任务 10：--smoke 的写-读回-删自闭环 + --json 契约 ───────────────────

test('smoke 现在的 items 顺序与数量固定：3 个只读工具 + 4 个写闭环项（名字逐字）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const results = await smoke({ env: { ...process.env }, projectPath: 'P', _call: be.call });
  assert.deepStrictEqual(results.map((r) => r.name), [
    'compile', 'get-logs', 'get-hierarchy', 'write-create', 'write-set', 'write-delete', 'write-clean',
  ]);
  for (const r of results) {
    assert.ok(['pass', 'fail', 'skip'].includes(r.status), `${r.name} 状态非法`);
    assert.ok(Object.hasOwn(r, 'code'), `${r.name} 必须带 code（pass 为 null）`);
  }
});

test('写闭环全绿：create/set/delete 都 verified:true，最后一步读回确认无残留', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  // compile / get-logs 由假后端补上（只读工具）
  const call = async (tool, args) => {
    if (tool === 'compile') return { code: 0, json: { Success: true, ErrorCount: 0, WarningCount: 0 }, truncated: false, tool, args };
    if (tool === 'get-logs') return { code: 0, json: { Success: true, TotalCount: 0, DisplayedCount: 0, Logs: [] }, truncated: false, tool, args };
    return be.call(tool, args);
  };
  const results = await smoke({ env: process.env, projectPath: 'P', _call: call });
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  for (const n of ['write-create', 'write-set', 'write-delete', 'write-clean']) {
    assert.strictEqual(byName[n].status, 'pass', `${n}: ${byName[n].message}`);
    assert.strictEqual(byName[n].code, null);
  }
  assert.strictEqual(be.nodes.has('__pi_smoke'), false, '冒烟结束不得留残留');
});

test('写闭环失败要如实报 fail 且带内层 hint（不把假绿当通过）', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const call = async (tool, args) => {
    if (tool === 'compile') return { code: 0, json: { Success: true, ErrorCount: 0, WarningCount: 0 }, truncated: false, tool, args };
    if (tool === 'get-logs') return { code: 0, json: { Success: true, TotalCount: 0, DisplayedCount: 0, Logs: [] }, truncated: false, tool, args };
    const r = await be.call(tool, args);
    // 让 node-set 永远报 BAD_PATCH（带 hint）→ write-set 必须 fail
    if (tool === 'execute-dynamic-code' && String(args[1]).endsWith('node-set.cs')) {
      return { ...r, json: { Success: true, Result: JSON.stringify({ __error: 'BAD_PATCH', detail: 'position 需要完整的数值 x/y/z' }) } };
    }
    return r;
  };
  const results = await smoke({ env: process.env, projectPath: 'P', _call: call });
  const setItem = results.find((r) => r.name === 'write-set');
  assert.strictEqual(setItem.status, 'fail');
  assert.strictEqual(setItem.code, 'WRITE_LOOP_FAILED');
  assert.match(setItem.message, /BAD_PATCH/);
  assert.ok(setItem.hint.length > 0, '失败必须带可操作 hint');
});

test('上一次残留的 __pi_smoke 会先被清掉（并读回确认），不静默叠两个同名节点', async () => {
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }, { path: '__pi_smoke' }] });
  const call = async (tool, args) => {
    if (tool === 'compile') return { code: 0, json: { Success: true, ErrorCount: 0, WarningCount: 0 }, truncated: false, tool, args };
    if (tool === 'get-logs') return { code: 0, json: { Success: true, TotalCount: 0, DisplayedCount: 0, Logs: [] }, truncated: false, tool, args };
    return be.call(tool, args);
  };
  const results = await smoke({ env: process.env, projectPath: 'P', _call: call });
  const create = results.find((r) => r.name === 'write-create');
  assert.strictEqual(create.status, 'pass');
  assert.match(create.message, /残留|清理/, '必须先清残留并说明');
  assert.strictEqual(be.nodes.has('__pi_smoke'), false);
});

test('doctor --json：两种模式都是 {ok, mode, checks}，且逐项带 code（M1 延后项④）', async () => {
  const appData = nonexistent('appdata');
  const basic = await captureStdout(() => doctor(['--project-path', 'P', '--json'], { env: { ...process.env, PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) }, appData }));
  const bj = JSON.parse(basic.out);
  assert.deepStrictEqual(Object.keys(bj), ['ok', 'mode', 'checks']);
  assert.strictEqual(bj.mode, 'basic');
  for (const c of bj.checks) assert.ok(Object.hasOwn(c, 'code'), `${c.name} 必须带 code`);

  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const call = async (tool, args) => {
    if (tool === 'compile') return { code: 0, json: { Success: true, ErrorCount: 0, WarningCount: 0 }, truncated: false, tool, args };
    if (tool === 'get-logs') return { code: 0, json: { Success: true, TotalCount: 0, DisplayedCount: 0, Logs: [] }, truncated: false, tool, args };
    return be.call(tool, args);
  };
  const smokeOut = await captureStdout(() => doctor(['--project-path', 'P', '--json', '--smoke'], { env: process.env, _call: call, appData }));
  const sj = JSON.parse(smokeOut.out);
  assert.deepStrictEqual(Object.keys(sj), ['ok', 'mode', 'checks']);
  assert.strictEqual(sj.mode, 'smoke');
  assert.strictEqual(sj.ok, true);
});

test('doctor --golden 与 --smoke 同时给 → 退出码 2 + stderr 说明', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStderr } = require('./helpers/capture.js');
  const r = await captureStderr(() => main(['doctor', '--smoke', '--golden', '--project-path', 'P']));
  assert.strictEqual(r.result, 2);
  assert.match(r.out, /不能同时用/);
});

// R206③：golden 的 `--json` 形状（doctor 级）——任务 9 已给 runGolden 的形状测试，
// 这里验证透传后的 doctor 输出形状（显式例外：golden 不叫 checks）。
test('doctor --json --golden 的输出形状固定：{ok,mode,matched,diff,cleanup,blocked,lines}（R206③）', async () => {
  const appData = nonexistent('appdata');
  const be = makeFakeSceneBackend({ baseScene: [{ path: 'Main Camera' }] });
  const out = await captureStdout(() => doctor(['--project-path', 'P', '--json', '--golden'], { env: process.env, _call: be.call, appData }));
  const j = JSON.parse(out.out);
  assert.deepStrictEqual(Object.keys(j).sort(), ['blocked', 'cleanup', 'diff', 'lines', 'matched', 'mode', 'ok']);
  assert.strictEqual(j.mode, 'golden');
  assert.strictEqual(j.matched, true);
  assert.strictEqual(j.cleanup.status, 'ok');
  assert.strictEqual(j.blocked, null);
});

// R202：本任务把 `standaloneFailure(r)` 换成 `failureText(r, { standalone: true })`
// （任务 1 已删掉 standaloneFailure —— 旧写法落地即 `ReferenceError`，既有 smoke 用例会直接红）。
// 这个改动由既有的 `smoke per-tool 失败文案是整句（F1/R44）` 用例盖住，不需要新增用例。
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/doctor.test.js`
预期：FAIL —— smoke 的 `results.map(name)` 只有 3 项（缺 `write-*`）；`--json` 冒烟分支的键是 `['ok','results']`（缺 `mode`）；`--golden --smoke` 会去调真实 uloop；`doctor --json --golden` 的 golden 分支还没透传 `_call`（新形状用例会打到真 `call`）。

- [ ] **步骤 3：编写最少实现代码**

`lib/doctor.js`：

1. `collectChecks` 的签名加 `_call`，连接检查改用它，并给**每一项**加 `code`：

```js
async function collectChecks({ env = process.env, appData, projectPath, rootDir, runImpl, _call } = {}) {
  const callFn = _call || ((tool, args, opts) => call(tool, args, { ...opts, rootDir, runImpl }));
  // …原有逻辑不变，但每一处 push 都补 `code`（逐字如下）：
```

```js
  checks.push({ name: 'uloop', status: found ? 'pass' : 'fail', code: found ? null : 'DISPATCHER_NOT_FOUND', message: /* 原样 */, hint: found ? [] : dispatcherHint });
  checks.push({ name: 'editor-install', status: editors.length > 0 ? 'pass' : 'fail', code: editors.length > 0 ? null : 'EDITOR_NOT_FOUND', message: /* 原样 */, hint: /* 原样 */ });
  checks.push({ name: 'editor-language', status: 'pass', code: null, message: /* 原样 */, hint: [] });
  checks.push({ name: 'build-targets', status: engines.length > 0 ? 'pass' : 'fail', code: engines.length > 0 ? null : 'BUILD_TARGETS_NONE', message: /* 原样 */, hint: /* 原样 */ });
  checks.push({ name: 'editor-connection', status: 'fail', code: 'EDITOR_CONNECTION_FAILED', message: '未找到 dispatcher，跳过连接检查', hint: dispatcherHint });
  // 连接成功/失败分支：
  checks.push({ name: 'editor-connection', status: ok ? 'pass' : 'fail', code: ok ? null : 'EDITOR_CONNECTION_FAILED', message: connectionMessage(r, ok), hint: /* 原样 */ });
```

2. `smoke` 改成（**只读三项 + 写闭环四项**）：

```js
/** 冒烟里用到的节点名（临时，跑完必删）。 */
const SMOKE_NODE = '__pi_smoke';

/**
 * 只读冒烟 + **写-读回-删自闭环**（M2：规格 §6.2 的后半句）。
 *
 * ⚠️ **`--smoke` 从 M2 起不再只读**：它会在当前场景建 `__pi_smoke`、改它的 position、再删掉它，
 * 并**读回确认无残留**。编辑器场景会因此变 dirty；本命令**不保存场景**。
 *
 * 写闭环用我们自己的库函数（`nodeCreate`/`nodeSet`/`nodeDelete`/`sceneTree`），所以它验证的是
 * 「信封层 + 写后读回 + 删除读回」整条链，而不是「上游某个工具能跑」。
 */
async function smoke({ env = process.env, projectPath, rootDir, runImpl, _call } = {}) {
  const callFn = _call || ((tool, args, opts) => call(tool, args, { ...opts, rootDir, runImpl }));
  const probe = await callFn('list', [], { env, projectPath });
  const probeOk = isConnectedProbe(probe);
  if (!probeOk) {
    const message = connectionMessage(probe, probeOk);
    const hint = probe.spawnError ? [DISPATCHER_HINT] : errorNextActions(probe.json);
    return SMOKE_ITEMS.map((t) => ({ name: t.name, status: 'skip', code: 'NOT_CONNECTED', message, hint: [...hint] }));
  }

  const out = [];
  for (const t of SMOKE_TOOLS) {
    const r = await callFn(t.name, t.args, { env, projectPath });
    const pass = Boolean(r.code === 0 && r.json && r.json.Success === true);
    const picked = pass ? t.pick(r.json) : null;
    if (picked !== null) out.push({ name: t.name, status: 'pass', code: null, message: picked, hint: [] });
    else if (pass) out.push({ name: t.name, status: 'fail', code: 'SMOKE_FIELD_MISSING', message: `响应缺少 ${t.missing}`, hint: [] });
    else out.push({ name: t.name, status: 'fail', code: 'SMOKE_TOOL_FAILED', message: failureText(r, { standalone: true }), hint: r.spawnError ? [DISPATCHER_HINT] : errorNextActions(r.json) });
  }

  out.push(...await writeLoopItems({ projectPath, env, callFn }));
  return out;
}

/**
 * 写闭环的 4 个冒烟项。顺序固定（create → set → delete → clean），任一步失败后续步仍继续跑
 * （失败细节比「短路」更有诊断价值），但 `write-clean` 的判定独立：只要最后读回还有残留就 fail。
 */
async function writeLoopItems({ projectPath, env, callFn }) {
  const items = [];
  const item = (name, status, code, message, hint = []) => ({ name, status, code, message, hint });

  // ① 开局清残留（上一次跑挂了会留下它；不清掉会让 nodeInspect 的路径语义变歧义）
  let residueNote = '';
  const before = await sceneTree({ projectPath, env, _call: callFn });
  if (before.ok && findNodeByName(before.actual.roots, SMOKE_NODE)) {
    const del = await nodeDelete({ projectPath, env, path: SMOKE_NODE, _call: callFn });
    if (del.ok && del.verified === true) residueNote = '（已清理上一次的残留）';
    else {
      return [
        item('write-create', 'fail', 'WRITE_LOOP_RESIDUE', `上一次的 ${SMOKE_NODE} 清不掉：${del.code} ${del.message}`, del.hint || []),
        item('write-set', 'skip', 'WRITE_LOOP_RESIDUE', '写闭环被残留阻断', []),
        item('write-delete', 'skip', 'WRITE_LOOP_RESIDUE', '写闭环被残留阻断', []),
        item('write-clean', 'fail', 'WRITE_LOOP_RESIDUE', `${SMOKE_NODE} 仍在场景里`, [`unity node delete --path ${SMOKE_NODE}`]),
      ];
    }
  }

  const create = await nodeCreate({ projectPath, env, name: SMOKE_NODE, _call: callFn });
  const createOk = create.ok && create.verified === true;
  items.push(createOk
    ? item('write-create', 'pass', null, `verified: true（建了 ${SMOKE_NODE}）${residueNote}`)
    : item('write-create', 'fail', 'WRITE_LOOP_FAILED', `create 未通过：${create.code}${create.message ? ` ${create.message}` : ''}`, create.hint || []));

  const set = createOk
    ? await nodeSet({ projectPath, env, path: SMOKE_NODE, patch: { position: { x: 1, y: 2, z: 0 } }, _call: callFn })
    : null;
  const setOk = Boolean(set && set.ok && set.verified === true);
  items.push(setOk
    ? item('write-set', 'pass', null, 'verified: true（position {1,2,0}）')
    : item('write-set', set ? 'fail' : 'skip', set ? 'WRITE_LOOP_FAILED' : 'WRITE_LOOP_FAILED',
      set ? `set 未通过：${set.code}${set.message ? ` ${set.message}` : ''}` : 'create 没成功，set 未执行', set ? set.hint || [] : []));

  const del = createOk
    ? await nodeDelete({ projectPath, env, path: SMOKE_NODE, _call: callFn })
    : null;
  const delOk = Boolean(del && del.ok && del.verified === true);
  items.push(delOk
    ? item('write-delete', 'pass', null, 'verified: true（已删除）')
    : item('write-delete', del ? 'fail' : 'skip', 'WRITE_LOOP_FAILED',
      del ? `delete 未通过：${del.code}${del.message ? ` ${del.message}` : ''}` : 'create 没成功，delete 未执行', del ? del.hint || [] : []));

  // 最终读回确认无残留 —— 这一步是「闭环」的闭环
  const after = await sceneTree({ projectPath, env, _call: callFn });
  if (!after.ok) {
    items.push(item('write-clean', 'fail', 'WRITE_LOOP_FAILED', `清理后读回失败：${after.code} ${after.message}`, after.hint || []));
  } else if (findNodeByName(after.actual.roots, SMOKE_NODE)) {
    items.push(item('write-clean', 'fail', 'WRITE_LOOP_RESIDUE', `${SMOKE_NODE} 仍在场景里（残骸）`, [`unity node delete --path ${SMOKE_NODE}`]));
  } else {
    items.push(item('write-clean', 'pass', null, '无残留（读回确认）'));
  }
  return items;
}

/** 在 roots 里按名字深找（清理/残留判定用）。 */
function findNodeByName(roots, name) {
  for (const r of Array.isArray(roots) ? roots : []) {
    if (!r || typeof r !== 'object') continue;
    if (r.name === name) return r;
    const hit = findNodeByName(r.children, name);
    if (hit) return hit;
  }
  return null;
}
```

3. `SMOKE_ITEMS`（skip 时的全量清单）与 import：

```js
const SMOKE_ITEMS = [...SMOKE_TOOLS, { name: 'write-create' }, { name: 'write-set' }, { name: 'write-delete' }, { name: 'write-clean' }];
```

```js
const { sceneTree, nodeCreate, nodeSet, nodeDelete } = require('./scene.js');
```

4. `doctor()`：`--json` 统一成 `{ok, mode, checks}`，并把 `_call` 透传下去：

```js
async function doctor(argv, { env = process.env, runImpl, rootDir, _call } = {}) {
  const { parseArgs } = require('./args.js');
  const args = parseArgs(argv);
  // …--smoke/--golden 互斥…

  if (args.golden) {
    // R210/R206③：任务 9 只传 `{projectPath, env, rootDir, runImpl}`；本任务在这里补上 `_call`
    // （为 `doctor --json --golden` 的形状断言提供注入缝）。`runGolden` 忽略 `rootDir`/`runImpl`，
    // 保留它们只是为了不改任务 9 已经写好的调用面。
    const { runGolden } = require('./golden.js');
    const r = await runGolden({ projectPath: args['project-path'], env, rootDir, runImpl, _call });
    // …原有 `--json` 输出 {ok, mode:'golden', matched, diff, cleanup, blocked, lines} 与人读逐行不变…
    return r.ok ? 0 : 1;
  }

  if (args.smoke) {
    const results = await smoke({ env, projectPath: args['project-path'], rootDir, runImpl, _call });
    // …failed/passed/skipped 与 ok 的判定逻辑不变（R39/R45）…
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok, mode: 'smoke', checks: results }, null, 2) + '\n');
    } else { /* …人读逐行不变… */ }
    return ok ? 0 : 1;
  }

  const checks = await collectChecks({ env, projectPath: args['project-path'], rootDir, runImpl, _call });
  const failed = checks.filter((c) => c.status === 'fail');
  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: failed.length === 0, mode: 'basic', checks }, null, 2) + '\n');
  } else { /* …人读逐行不变… */ }
  return failed.length === 0 ? 0 : 1;
}
```

> **R202**：`smoke` 里的 per-tool 失败文案用 `failureText(r, { standalone: true })`（任务 1 定稿的名字/签名），**不得**再写 `standaloneFailure(r)`。

`module.exports` 加 `writeLoopItems, findNodeByName, SMOKE_NODE`（供测试与任务 11 的 skill 引用）。

`bin/unity.js` 的 `USAGE` 里 `doctor` 段补：

```
  doctor --smoke         冒烟：3 个只读工具 + **写-读回-删自闭环**（建/改/删 __pi_smoke 并读回确认无残留）
                         ⚠️ **从 M2 起 --smoke 不再只读**：会向当前场景写入临时节点（随后删除），不保存场景
```

`skills/unity-game-dev/SKILL.md` 的 `--smoke` 段落改成：

```
工具链冒烟（3 个只读工具 + 写-读回-删自闭环）：

    unity doctor --project-path "<P>" --smoke

- **`--smoke` 从 M2 起不再只读**：它会建一个临时节点 `__pi_smoke`、改它的 position、再删掉它，并**读回确认无残留**。
  编辑器里的场景会因此变 dirty（本命令**不保存**场景）。上一次跑挂了留下的残留会在本轮开头被清掉。
- 七项全 `OK` 才算工具链可用（compile / get-logs / get-hierarchy / write-create / write-set / write-delete / write-clean）。
- 全 `SKIP` = 编辑器没连上，退出码 1（`--smoke` 从不把没验过当成功）。
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/doctor.test.js` → PASS（新增 **7 条**：6 条写闭环/契约 + 1 条 R206③ 的 `doctor --json --golden` 形状）。
运行：`npm test` → PASS（本任务新增 **7 条** → 总数应为 **308**；以实际为准）。

- [ ] **步骤 5：真机验证（必做）**

```bash
P=C:/Users/<用户>/pi-unity-spike/S0Project
node bin/unity.js doctor --project-path $P --smoke ; echo "exit=$?"
node bin/unity.js doctor --project-path $P --smoke --json | head -60
node bin/unity.js scene tree --project-path $P --json | grep -c __pi_smoke ; echo "grep=$?"   # 期望 0
```

判据：① 退出码 0；② **七项全 `pass`**（把真实输出贴进报告）；③ `scene tree` 里 `__pi_smoke` 出现 0 次；
④ `--json` 的顶层键恰好是 `ok` / `mode` / `checks`，每项都有 `code`；⑤ 若哪一项 fail，如实贴原文并写进 PITFALLS。

- [ ] **步骤 6：Commit**

```bash
git add lib/doctor.js bin/unity.js test/doctor.test.js test/helpers/capture.js \
        skills/unity-game-dev/SKILL.md
git commit -m "feat(doctor): --smoke 补写-读回-删自闭环（M2 起不再只读）+ --json 契约统一 {ok,mode,checks}"
```

---

## 任务 11：skill 完整版 + 打砖块参考实现 + USAGE（判断）

**文件：**
- 创建：`unity-scripts/templates/PiBrickBreaker.cs`
- 修改：`skills/unity-game-dev/SKILL.md`（M2 完整版）
- 修改：`bin/unity.js`（USAGE 汇总 M2 命令）
- 修改：`README.md`（状态）
- 创建：`test/template.test.js`（模板的静态契约测试）

**决策与依据：**
- **打砖块的「配方」（节点约定/尺寸/配色/渲染方式/如何验证）写进 SKILL.md**（用户要求），**但游戏脚本本体放 `unity-scripts/templates/`**（包内模板，用 `unity asset write --template PiBrickBreaker` 装入项目）。理由：设计 §6.4 明确反对把上千行 C# 塞进 skill（每次加载都吃满 context）；而模板是**可编译、可审查、可测试**的包内资产（D3 的「高频写操作 → 包内 `.cs`」精神）。盲测协议允许直接装模板，也允许盲测 agent 自己改写它 —— 验收只看结果。
- **分数用 `OnGUI` 而不是 uGUI Text/TMP**：不依赖字体资产与包（决定②的「不碰 TMP/外部图」），也不依赖 `Resources.GetBuiltinResource` 的资源名（要探测、有风险）。`OnGUI` 是纯代码。
- **物理用手写 AABB，不用 `Rigidbody2D`/`Collider2D`**：确定性更好（可预测的首砖命中），不需要 2D 物理模块的额外行为，且 `simulate-mouse-input --dry-run`（3D 物理）本来就用不上。
- **球自动发射 + 挡板默认自动跟随**（`autoPaddle = true`，可用公开字段关掉）：让「画面在变、分数在涨」这件事**不依赖任何输入注入**就能验证 —— 这正是「没有 Input System 的项目里如何证明打得动」的答案（计划前提 7）。真人操作仍然可用（鼠标 + 左右方向键）。
- **模板的静态契约测试**：`.cs` 不能在本仓库编译（没有 Unity），所以用断言把「游戏脚本依赖的字段名/日志前缀/尺寸约定」与 `lib/sprite.js`/skill 配方钉在一起（全局约束 18 的跨语言 tripwire 精神）。

- [ ] **步骤 1：编写失败的测试**

```js
// test/template.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE = path.join(__dirname, '..', 'unity-scripts', 'templates', 'PiBrickBreaker.cs');
const SKILL = path.join(__dirname, '..', 'skills', 'unity-game-dev', 'SKILL.md');
const SPRITE = path.join(__dirname, '..', 'lib', 'sprite.js');

test('打砖块模板存在且是一个 MonoBehaviour（能被 node create --components 挂上）', () => {
  const src = fs.readFileSync(TEMPLATE, 'utf8');
  assert.match(src, /public class PiBrickBreaker\s*:\s*MonoBehaviour/);
  assert.match(src, /using UnityEngine;/);
  assert.match(src, /void Start\(\)/);
  assert.match(src, /void Update\(\)/);
  assert.match(src, /void OnGUI\(\)/);
});

test('模板的日志前缀与状态字段是「可被 CLI 验证」的契约（skill 与 E2E 靠它们断言）', () => {
  const src = fs.readFileSync(TEMPLATE, 'utf8');
  for (const tag of ["[BB] ready bricks=", "[BB] hit brick=", "[BB] ball out lives=", "[BB] CLEARED score="]) {
    assert.ok(src.includes(tag), `模板必须打日志 ${tag}`);
  }
  for (const field of ['public int score', 'public int lives', 'public int bricksAlive', 'public float ballX', 'public float ballY', 'public float paddleX']) {
    assert.ok(src.includes(field), `模板必须有公开字段 ${field}（execute-dynamic-code 读回用）`);
  }
  for (const fn of ['public void SetPaddleX(float x)', 'public void ResetBall()']) {
    assert.ok(src.includes(fn), `模板必须有公开入口 ${fn}`);
  }
});

test('模板的尺寸/坐标约定与 sprite 世界单位约定一致（1x1 基础 sprite + localScale = 世界尺寸）', () => {
  const src = fs.readFileSync(TEMPLATE, 'utf8');
  // 场地半宽/半高必须与配方一致（相机 orthographicSize=5 → 半高 5）
  assert.match(src, /HalfWidth\s*=\s*6f/);
  assert.match(src, /HalfHeight\s*=\s*5f/);
  // 砖块命中盒必须是「半尺寸」口径：1.6x0.5 的砖 → 0.8 / 0.25
  assert.match(src, /0\.8f/);
  assert.match(src, /0\.25f/);
  // 背景色必须是配方里的近黑（#0A0A14）
  assert.match(src, /0x0A,\s*0x0A,\s*0x14/);
});

test('skill 必须写出 M2 的全部命令面与打砖块配方（盲测 agent 只读它）', () => {
  const src = fs.readFileSync(SKILL, 'utf8');
  for (const cmd of ['unity pixels', 'unity sprite set', 'unity play', 'unity asset write',
    'unity compile', 'unity node delete', 'doctor --golden', '--capture-mode', '--match-mode']) {
    assert.ok(src.includes(cmd), `skill 必须提到 ${cmd}`);
  }
  for (const spec of ['Bricks', 'Brick_', 'Paddle', 'Ball', '0A0A14', 'FF2E88', 'orthographic', 'SpriteRenderer']) {
    assert.ok(src.includes(spec), `skill 的配方必须提到 ${spec}`);
  }
  assert.ok(src.includes('--template PiBrickBreaker'), 'skill 必须给出装脚本的命令');
  assert.ok(src.includes('--smoke 不再只读') || src.includes('`--smoke` 从 M2 起不再只读'), 'skill 必须写明 --smoke 的语义变化');
});

test('sprite.js 的 1x1 世界单位约定与 skill 的配方一致（跨文件 tripwire）', () => {
  const js = fs.readFileSync(SPRITE, 'utf8');
  assert.match(js, /new Rect\(0, 0, 1, 1\)/, 'sprite 必须是 1x1 的 Rect');
  assert.match(js, /, 1f\)/, 'pixelsPerUnit 必须是 1f（默认 100 会让方块小到看不见）');
  const skill = fs.readFileSync(SKILL, 'utf8');
  assert.ok(skill.includes('localScale = 世界尺寸') || skill.includes('localScale 就是世界尺寸'), 'skill 必须写明 scale = 世界尺寸');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/template.test.js`
预期：FAIL —— `ENOENT` 读不到 `unity-scripts/templates/PiBrickBreaker.cs`。

- [ ] **步骤 3：编写最少实现代码**

**① 打砖块参考实现**（`unity-scripts/templates/PiBrickBreaker.cs`，逐字）：

```csharp
// unity-scripts/templates/PiBrickBreaker.cs
// 极简霓虹打砖块 —— 参考实现。
// 装入项目：unity asset write --to Assets/PiBrickBreaker/PiBrickBreaker.cs --template PiBrickBreaker
// 挂上组件：unity node create --name GameManager --components '["PiBrickBreaker"]'
//
// 场景由 CLI 搭好（见 skills/unity-game-dev/SKILL.md §3.5 的配方），本脚本只负责运行时行为：
//   球按常量速度直线运动 → 碰墙/挡板/砖块反弹 → 砖块 SetActive(false) 并加分 → 掉出底线扣命 → 清屏重置。
//
// 三个刻意的设计选择（写进 skill，也写在这里）：
//   1) **手写 AABB，不用 Rigidbody2D/Collider2D**：确定性好（首砖命中可预测），不依赖 2D 物理模块；
//   2) **球自动发射 + autoPaddle 默认 true**：不需要任何输入注入就能验证「画面在变、分数在涨」
//      （没有 Input System 包的项目无法注入真实输入，见 docs/PITFALLS.md U16 → 定稿 **U25**）；
//   3) **分数用 OnGUI 画**：不依赖字体资产 / TMP / uGUI（决定②：不碰外部美术与 TMP）。
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class PiBrickBreaker : MonoBehaviour
{
    // ── 可调参数（execute-dynamic-code 可直接改公开字段做实验）──
    public float ballSpeedX = 3.2f;
    public float ballSpeedY = 4.2f;
    public bool autoPaddle = true;
    public float paddleFollowLerp = 12f;
    public float paddleKeySpeed = 8f;
    public float mouseFollowLerp = 18f;

    // ── 运行态（execute-dynamic-code 读回这些字段来证明「游戏在动」）──
    public int score;
    public int lives = 3;
    public int bricksAlive;
    public float ballX;
    public float ballY;
    public float paddleX;

    // 场地边界：与相机 orthographicSize = 5 对应（半高 5、半宽 6）
    private const float HalfWidth = 6f;
    private const float HalfHeight = 5f;
    private const float PaddleY = -4.2f;
    private const float BallStartY = -3.2f;
    private const float PaddleHalfWidth = 1.2f;
    private const float BrickHalfWidth = 0.8f;   // 砖块 1.6 x 0.5 → 半尺寸 0.8 / 0.25
    private const float BrickHalfHeight = 0.25f;
    private const float BallHalfSize = 0.2f;

    private class Brick
    {
        public GameObject go;
        public Vector3 home;
        public bool alive;
    }

    private Transform _ball;
    private Transform _paddle;
    private readonly List<Brick> _bricks = new List<Brick>();
    private Vector2 _velocity;

    void Start()
    {
        Camera cam = Camera.main;
        if (cam != null)
        {
            cam.orthographic = true;
            cam.orthographicSize = HalfHeight;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color32(0x0A, 0x0A, 0x14, 255);   // #0A0A14 近黑底
        }
        _ball = FindTransform("Ball");
        _paddle = FindTransform("Paddle");
        CollectBricks();
        ResetBall();
        Debug.Log("[BB] ready bricks=" + bricksAlive + " lives=" + lives);
    }

    void Update()
    {
        if (_ball == null) return;

        Vector3 p = _ball.localPosition;
        p.x += _velocity.x * Time.deltaTime;
        p.y += _velocity.y * Time.deltaTime;

        // 左右墙 / 天花板
        if (p.x > HalfWidth - BallHalfSize) { p.x = HalfWidth - BallHalfSize; _velocity.x = -Mathf.Abs(_velocity.x); }
        else if (p.x < -HalfWidth + BallHalfSize) { p.x = -HalfWidth + BallHalfSize; _velocity.x = Mathf.Abs(_velocity.x); }
        if (p.y > HalfHeight - BallHalfSize) { p.y = HalfHeight - BallHalfSize; _velocity.y = -Mathf.Abs(_velocity.y); }

        // 挡板
        if (_paddle != null && _velocity.y < 0f
            && p.y <= PaddleY + 0.35f && p.y >= PaddleY - 0.35f
            && Mathf.Abs(p.x - _paddle.localPosition.x) <= PaddleHalfWidth + BallHalfSize)
        {
            p.y = PaddleY + 0.35f;
            _velocity.y = Mathf.Abs(_velocity.y);
        }

        // 砖块（AABB；命中即反竖直方向并 continue 到掉出判定）
        for (int i = 0; i < _bricks.Count; i++)
        {
            Brick brick = _bricks[i];
            if (!brick.alive || brick.go == null) continue;
            Vector3 b = brick.go.transform.localPosition;
            if (Mathf.Abs(p.x - b.x) <= BrickHalfWidth + BallHalfSize
                && Mathf.Abs(p.y - b.y) <= BrickHalfHeight + BallHalfSize)
            {
                brick.alive = false;
                brick.go.SetActive(false);
                bricksAlive = _bricks.Count(x => x.alive);
                score++;
                Debug.Log("[BB] hit brick=" + brick.go.name + " score=" + score + " left=" + bricksAlive);
                _velocity.y = -_velocity.y;
                break;
            }
        }

        // 掉出底线
        if (p.y < -HalfHeight - 0.5f)
        {
            lives--;
            Debug.Log("[BB] ball out lives=" + lives);
            if (lives <= 0)
            {
                Debug.Log("[BB] GAME OVER score=" + score);
                lives = 3;
                score = 0;
                RestoreBricks();
            }
            ResetBall();
            p = _ball.localPosition;
        }

        _ball.localPosition = p;
        ballX = p.x;
        ballY = p.y;

        if (_paddle != null)
        {
            float target = autoPaddle ? Mathf.Clamp(p.x, -HalfWidth + PaddleHalfWidth, HalfWidth - PaddleHalfWidth) : InputTarget();
            Vector3 pp = _paddle.localPosition;
            pp.x = Mathf.Lerp(pp.x, target, Mathf.Clamp01(paddleFollowLerp * Time.deltaTime));
            pp.y = PaddleY;
            _paddle.localPosition = pp;
            paddleX = pp.x;
        }

        if (_bricks.Count > 0 && bricksAlive == 0)
        {
            Debug.Log("[BB] CLEARED score=" + score);
            RestoreBricks();
        }
    }
```

**（下面这段是同一个文件的续段，直接接在上面 `Update()` 的收尾大括号之后；两段之间不能有任何其它内容）**

```csharp
    /// <summary>玩家输入（legacy Input；没有 Input System 包的项目也能用）。autoPaddle 关掉后才生效。</summary>
    float InputTarget()
    {
        float dir = 0f;
        if (Input.GetKey(KeyCode.LeftArrow)) dir -= 1f;
        if (Input.GetKey(KeyCode.RightArrow)) dir += 1f;
        if (Mathf.Abs(dir) < 0.01f)
        {
            Vector3 mouse = Input.mousePosition;
            if (Camera.main != null && Screen.width > 0) return Camera.main.ScreenToWorldPoint(mouse).x;
            return _paddle.localPosition.x;
        }
        return Mathf.Clamp(
            _paddle.localPosition.x + dir * paddleKeySpeed * Time.deltaTime,
            -HalfWidth + PaddleHalfWidth, HalfWidth - PaddleHalfWidth);
    }

    /// <summary>测试入口：直接设挡板 x（execute-dynamic-code 用）。</summary>
    public void SetPaddleX(float x)
    {
        if (_paddle == null) return;
        _paddle.localPosition = new Vector3(
            Mathf.Clamp(x, -HalfWidth + PaddleHalfWidth, HalfWidth - PaddleHalfWidth), PaddleY, 0f);
    }

    /// <summary>测试入口：把球放回起点、按当前速度重新发射。</summary>
    public void ResetBall()
    {
        if (_ball == null) return;
        _ball.localPosition = new Vector3(0f, BallStartY, 0f);
        _velocity = new Vector2(ballSpeedX, ballSpeedY);
    }

    void CollectBricks()
    {
        _bricks.Clear();
        GameObject root = GameObject.Find("Bricks");
        if (root == null) { bricksAlive = 0; return; }
        foreach (Transform child in root.transform)
        {
            _bricks.Add(new Brick { go = child.gameObject, home = child.localPosition, alive = true });
        }
        bricksAlive = _bricks.Count;
    }

    void RestoreBricks()
    {
        foreach (Brick brick in _bricks)
        {
            if (brick.go == null) continue;
            brick.alive = true;
            brick.go.SetActive(true);
            brick.go.transform.localPosition = brick.home;
        }
        bricksAlive = _bricks.Count;
    }

    static Transform FindTransform(string name)
    {
        GameObject go = GameObject.Find(name);
        return go != null ? go.transform : null;
    }

    void OnGUI()
    {
        // 不依赖字体资产 / TMP：GUI.skin 的默认字体足够（决定②：不碰 TMP 与外部资源）
        GUI.Label(new Rect(12f, 10f, 460f, 32f),
            "SCORE " + score + "   LIVES " + lives + "   BRICKS " + bricksAlive);
    }
}
```

**② SKILL.md 的 M2 完整版**（按下面三处改；**配方里的数字必须逐字**，因为盲测 agent 只读它）：

（a）**命令表**替换成 M2 全量（每行含类型与退出码）：

```markdown
| 命令 | 类型 | 退出码 |
|---|---|---|
| `unity doctor [--smoke] [--golden] [--json]` | 只读检查 / **--smoke 与 --golden 会写临时节点** | 0 / 1 / 2 |
| `unity scene tree` | 读场景节点树 | 0 / 1 / 2 |
| `unity node inspect --path <p>` | 读单个节点（含 `sprite` 字段） | 0 / 1 / 2 |
| `unity node create --name <n> [--parent <p>] [--components <json>]` | **写**（写后读回） | 0 且 `verified!==false` / 1 / 2 |
| `unity node set --path <p> --patch <json>` | **写**（写后读回） | 0 且 `verified!==false` / 1 / 2 |
| `unity node delete --path <p>` | **写**（读回必须 NOT_FOUND） | 0 且 `verified!==false` / 1 / 2 |
| `unity sprite set --path <p> --color <#hex> [--sorting-order <n>]` | **写**（写后读回） | 0 且 `verified!==false` / 1 / 2 |
| `unity shot [--out <dir>] [--window-name <n>] [--capture-mode <m>] [--match-mode <m>]` | 读（截图） | 0 / 1 / 2 |
| `unity pixels --file <png> [--at x,y] [--region x,y,w,h] [--expect <hex>] [--count-color <hex>]` | 读（像素判定） | 0 / 1 / 2 |
| `unity play start\|stop\|pause\|step\|status\|click\|mouse\|key\|logs\|view …` | **写**（PlayMode）/ 读（logs） | 0 / 1 / 2 |
| `unity asset write --to <Assets/…> (--from <f>\|--template <n>) [--force]` | **写**（读回 sha256） | 0 且 `verified!==false` / 1 / 2 |
| `unity compile` | 读（编译结果） | 0 无错 / 1 有编译错 / 2 |
```

（b）**§3.5 打砖块配方**（插在 §3 之后，作为 §3.5）：

```markdown
### 3.5 打砖块配方（**盲测与 demo 的标准游戏**，数字逐字照用）

**渲染方式**：全靠**运行时生成的纯色 sprite** + 正交相机。不引入任何外部图片、不用 TMP、不碰 TextureImporter。

**世界单位约定（关键）**：`unity sprite set` 造出来的基础 sprite 是 **1×1 世界单位**，
所以一个方块的**世界尺寸 = 它的 `localScale`**（用 `node set --patch '{"scale":{...}}'` 设）。

**相机**：模板场景里已有 `Main Camera`，正交、`orthographic size = 5`、位置 `(0,0,-10)`。
`PiBrickBreaker` 脚本会在 `Start()` 里把背景色改成 `#0A0A14`（近黑）。

**节点约定与尺寸**（Bricks 是空容器，砖块是它的子节点）：

| 节点 | 路径 | scale（世界尺寸） | position |
|---|---|---|---|
| 容器 | `Bricks` | — | `(0,0,0)` |
| 砖块 ×24 | `Bricks/Brick_<col>_<row>`（col 0..5、row 0..3） | `(1.6, 0.5, 1)` | `x = (col - 2.5) * 1.85`、`y = 3.0 - row * 0.75`、`z = 0` |
| 挡板 | `Paddle` | `(2.4, 0.35, 1)` | `(0, -4.2, 0)` |
| 球 | `Ball` | `(0.4, 0.4, 1)` | `(0, -3.2, 0)` |
| 游戏逻辑 | `GameManager` | — | `(0,0,0)`，挂 `PiBrickBreaker` 组件 |

**配色（`--color` 的 hex）**：砖块按行 —— row0 `#FF2E88`、row1 `#FFE94A`、row2 `#4DFF7A`、row3 `#FF7A2E`；
挡板 `#00FFC8`；球 `#FFFFFF`；背景 `#0A0A14`（脚本设）。四行颜色**互不相同**，便于按颜色计数验证。

**完整搭法**（可整段复制；`P` 是项目路径）：

```bash
P="C:/path/to/Project"
# ① 固定 Game 视图尺寸（像素判定的坐标基准；只影响本次会话）
unity play view --project-path "$P" --width 960 --height 640
# ② 装脚本并编译
unity asset write --project-path "$P" --to Assets/PiBrickBreaker/PiBrickBreaker.cs --template PiBrickBreaker
# ③ 建容器与方块（24 块砖；颜色按行）
unity node create --project-path "$P" --name Bricks
for col in 0 1 2 3 4 5; do
  for row in 0 1 2 3; do
    x=$(awk "BEGIN{printf \"%.3f\", ($col - 2.5) * 1.85}")
    y=$(awk "BEGIN{printf \"%.3f\", 3.0 - $row * 0.75}")
    unity node create --project-path "$P" --name "Brick_${col}_${row}" --parent Bricks --components '["SpriteRenderer"]'
    unity node set --project-path "$P" --path "Bricks/Brick_${col}_${row}" --patch "{\"position\":{\"x\":$x,\"y\":$y,\"z\":0},\"scale\":{\"x\":1.6,\"y\":0.5,\"z\":1}}"
  done
done
# 砖块颜色按行：row0 品红 / row1 黄 / row2 绿 / row3 橙
#   例：unity sprite set --path Bricks/Brick_0_0 --color '#FF2E88'
# ④ 挡板 / 球 / 逻辑节点
unity node create --project-path "$P" --name Paddle --components '["SpriteRenderer"]'
unity node set    --project-path "$P" --path Paddle --patch '{"position":{"x":0,"y":-4.2,"z":0},"scale":{"x":2.4,"y":0.35,"z":1}}'
unity sprite set  --project-path "$P" --path Paddle --color '#00FFC8'
unity node create --project-path "$P" --name Ball --components '["SpriteRenderer"]'
unity node set    --project-path "$P" --path Ball --patch '{"position":{"x":0,"y":-3.2,"z":0},"scale":{"x":0.4,"y":0.4,"z":1}}'
unity sprite set  --project-path "$P" --path Ball --color '#FFFFFF'
unity node create --project-path "$P" --name GameManager --components '["PiBrickBreaker"]'
```

> 每条写命令都会**写后读回**：看到 `[UNVERIFIED]`（`verified:false`）就**停下**，不要继续往下搭。
> 砖块颜色那一步要按行跑 24 次（或按行批量；颜色只与 row 有关）。
```

（c）**§8 验证配方**（新增一节，告诉 agent 怎么**证明**游戏真的成立）：

```markdown
## 8. 验证配方：怎么证明「搭出来了」+「真的在动」

**① 结构**：`unity scene tree --json` → `actual.roots` 里应有 `Bricks`（24 个子节点）、`Paddle`、`Ball`、`GameManager`。

**② 画面（像素判定，不靠肉眼）**：

```bash
unity play start --project-path "$P" --json          # verified:true 才算进入 PlayMode
unity shot --project-path "$P" --capture-mode rendering --json   # rendering 模式下坐标干净（不含工具栏）
# 用上一步返回的 actual.path：
unity pixels --file "<path>" --count-color '#FF2E88' --tolerance 16 --json   # 品红砖块数量 > 0
unity pixels --file "<path>" --at 480,600 --json                             # 采样一个点看真实颜色
```

判据：砖块颜色计数 > 0；背景区域的采样值接近 `#0A0A14`（容差 ≤ 48）。
**再用 `read` 工具打开 PNG 目视确认** —— 像素判定与肉眼两条证据都要。

**③ 在动（试玩闭环）**：

```bash
unity play logs --project-path "$P" --search-text '[BB]' --json     # 应有 ready bricks=24；等几秒后应有 hit brick=
# 用 execute-dynamic-code 读回运行态（**这是状态注入/读取，不是真实输入**，要如实声明）：
#   var g = GameObject.Find("GameManager").GetComponent("PiBrickBreaker"); return g.score + "," + g.bricksAlive;
unity shot --project-path "$P" --capture-mode rendering --json     # 再拍一张
unity pixels --file "<第二张图>" --at 480,600 --json                 # 与第一张的采样值应不同（球/挡板动了）
unity play stop --project-path "$P" --json                          # verified:true
unity play logs --project-path "$P" --log-type Error --json         # totalCount 应为 0
```

**④ 真实输入（只在项目装了 Input System 时）**：`unity play key --action Press --key Space`。
没有 Input System 时它会**如实失败**（`INPUT_SYSTEM_UNAVAILABLE`）——**不要**因此宣称游戏坏了：
没有输入注入时用「球自己在动 + 分数在涨 + 两次截图不同」证明玩法在跑，并**明确声明**输入是注入/自动的。
```

（d）§7 的常见错误表补三行：

```markdown
| `unity play key`/`mouse` 报 `INPUT_SYSTEM_UNAVAILABLE` | 项目没装 Input System（`Active Input Handling` 为 Old）。改用 execute-dynamic-code 注入状态并声明是注入 | **U16**（预留号 → 定稿 **U25**） |
| `unity play click` 点不动 sprite 方块 | `simulate-mouse-ui` 只对 ScreenSpaceOverlay + GraphicRaycaster 的 uGUI 生效，打不到 SpriteRenderer | **U16**（预留号 → 定稿 **U25**） |
| `unity play start` 报 `CONTROL_PLAY_MODE_UNSAVED_CHANGES` | 当前场景有未保存改动（最常见是未命名场景）——先保存场景再进 PlayMode | U17（预留号 → 定稿 **U26**） |
```

**③ `README.md`**：把「M1 已交付」表换成 M2 全量命令表（把上面 SKILL 的那张表复制过去），
并把「尚未实现」一段删掉、改成「M3：`unity build` 命令化 + 产物验证（S8 已手工验证）」。

- [ ] **步骤 4：跑测试并做静态检查**

运行：`node --test test/template.test.js` → PASS（5 条）。
运行：`npm test` → PASS（本任务新增 5 条 → 总数应为 **313**；以实际为准）。
运行（确认模板真的是一个文件、括号平衡）：

```bash
node -e "const s=require('fs').readFileSync('unity-scripts/templates/PiBrickBreaker.cs','utf8');
const b=(s.match(/{/g)||[]).length, c=(s.match(/}/g)||[]).length;
if(b!==c) throw new Error('括号不平衡 '+b+'/'+c);
if((s.match(/class PiBrickBreaker/g)||[]).length!==1) throw new Error('类名/数量不对');
console.log('模板静态检查 OK', b, '行数', s.split('\n').length);"
```

- [ ] **步骤 5：真机验证（必做 —— 这是「游戏真的能跑」的第一次完整验证）**

```bash
P=C:/Users/<用户>/pi-unity-spike/S0Project
md5sum "$P/Assets/Scenes/SampleScene.scene" > /tmp/before.md5
# 按 §3.5 的完整搭法把 24 块砖 + 挡板 + 球 + GameManager 建出来（可写成一个 bash 循环）
node bin/unity.js asset write --project-path $P --to Assets/PiBrickBreaker/PiBrickBreaker.cs --template PiBrickBreaker --json
node bin/unity.js play view --project-path $P --width 960 --height 640 --json
node bin/unity.js play start --project-path $P --json        # verified:true
node bin/unity.js shot --project-path $P --capture-mode rendering --out <abs> --json
# 用返回的 actual.path：
node bin/unity.js pixels --file "<path>" --count-color '#FF2E88' --tolerance 16 --json
node bin/unity.js pixels --file "<path>" --count-color '#4DFF7A' --tolerance 16 --json
sleep 5
node bin/unity.js play logs --project-path $P --search-text '[BB]' --max-count 20 --json
node bin/unity.js shot --project-path $P --capture-mode rendering --out <abs> --json
node bin/unity.js play stop --project-path $P --json
```

**判据（全过才算完成；每条都要真实输出与退出码）**：
1. `asset write` → `verified:true`、`compiled:true`、`errorCount:0`；
2. `play start` → `verified:true`（`isPlaying:true`）；
3. 第一张渲染图的 `#FF2E88` 与 `#4DFF7A` 计数**都 > 0**（四行砖真的渲染出来了）；背景采样接近 `#0A0A14`；
4. `play logs` 里有 `[BB] ready bricks=24`，且等 5 秒后**至少一条** `[BB] hit brick=`（球在动、砖在碎）；
5. 第二张渲染图与第一张的**采样值不同**（球/挡板位置变了）；
6. `play stop` → `verified:true`；`play logs --log-type Error` 的 `totalCount === 0`；
7. 用 `read` 打开第一张图**目视确认**：能看到 4 行彩色砖阵、青色挡板、白球、左上角分数文字；
8. **把「1×1 世界单位 → 屏幕像素」的换算写成实测结论**：`pixelsPerUnit = 图片高度 / (2 × orthographicSize)`；
   960×640 + size 5 → 64 px/单位；世界 `(x,y)` → 图片像素 `(480 + 64x, 320 − 64y)`。
   用一枚已知位置的砖块**验证一次**（报告里写出预期像素与实际命中的容差）。若与实测不符，
   **以实测为准**并把公式与偏差写进 `docs/PITFALLS.md`（U 条目）。
9. 场景 md5 是否变化（`play start` 可能静默保存场景）如实记录。

**清理**：`play stop` 之后删掉本次建的 27 个节点 + 脚本资产（`unity node delete` ×27 + 删 `Assets/PiBrickBreaker/`），
**或**（更简单）在 `S0Project` 里留着它们并在报告里注明「S0Project 已含打砖块探针」——
但**盲测项目必须干净**（任务 12 会新建）。二选一，写进报告，不要含糊。

- [ ] **步骤 6：Commit**

```bash
git add unity-scripts/templates/PiBrickBreaker.cs skills/unity-game-dev/SKILL.md bin/unity.js README.md test/template.test.js
git commit -m "docs(skill): M2 完整版（命令面/打砖块配方/验证配方）+ 打砖块参考实现模板"
```

---

## 任务 12：E2E 盲测（最后一关，判断）

**文件：**
- 创建：`docs/E2E-ACCEPTANCE-m2.md`（**协议 + 执行记录**，对标 pi-cocos `docs/E2E-ACCEPTANCE.md` 的形态）
- 修改：`docs/PITFALLS.md`（盲测暴露的新坑）
- 修改：`skills/unity-game-dev/SKILL.md`（只改盲测暴露的真问题）

**决策与依据：**
- **盲测项目 = `C:/Users/<用户>/pi-unity-m2-blind`**（前提 4）：从编辑器自带 2D 模板解出，装 uloop 包，打开编辑器。
  **不用 `S0Project`**：它带 spike 存档（`.uloop/outputs/` 数百文件、S8 构建产物、`PiBuildScript.cs`），盲测要的是干净起点。
- **盲测执行者 = 全新子代理**，只拿到：`skills/unity-game-dev/SKILL.md`（+ 它引用的 `docs/PITFALLS.md`）、项目路径、`unity` 命令路径、环境变量。
  **不给**任何 M1/M2 会话历史、不给本计划文件、不给 diff、不给「提示性」的额外说明 —— 否则测的就不是 skill 的自足性。
- **四条验收判据必须可观测**（含退出码与截图证据），并且**由本任务的控制者独立复核**（不信盲测 agent 的自述）。

- [ ] **步骤 1：写盲测协议 `docs/E2E-ACCEPTANCE-m2.md`（完整内容）**

```markdown
# pi-unity M2 端到端验收（盲测：只靠 skill 搭一个完整小游戏）

> 执行日期：<填实际日期>
> 项目：`C:/Users/<用户>/pi-unity-m2-blind`（**本次为盲测新建**，从编辑器自带 2D 模板解出）
> 编辑器：团结引擎 2022.3.62t9 + uloop dispatcher 3.5.1 / 包 3.6.3
> 游戏：**极简霓虹打砖块**（配方见 `skills/unity-game-dev/SKILL.md` §3.5）
> 驱动方式：**派一个全新子代理**，只读 SKILL.md（+ PITFALLS.md），按 skill 的黄金流程执行

## 0. 盲测协议（**执行前必须逐字满足**）

**给盲测子代理的 brief（逐字，不加料）**：

```
你是首次使用 `unity` CLI 的 agent。规则：
1. 只允许读两个文件：<包目录>/skills/unity-game-dev/SKILL.md 和 <包目录>/docs/PITFALLS.md。
2. 不许读 docs/superpowers/ 下的任何文件（计划/规格），不许读 git 历史。
3. 项目：C:/Users/<用户>/pi-unity-m2-blind
   命令：node <包目录>/bin/unity.js（下文写 unity）
   环境：每条命令都要带 PI_UNITY_ULOOP_BIN=C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe
4. 任务：按 SKILL §3.5 的配方搭出「极简霓虹打砖块」，并用 SKILL §8 的验证配方**证明它跑起来了**。
5. 不许用裸 uloop（`uloop.exe ...` 直接调用）；所有 Unity 操作走 `unity` 命令。
6. 遇到 SKILL 没覆盖的情况：先按 SKILL 的停止条件停手，把「缺什么」写进报告，不要自己发明流程。
7. 交付一个报告文件 <包目录>/.superpowers/e2e-m2-blind-report.md，内容：
   - 每条命令 + 退出码（逐条）
   - 截图路径 + 你用 read 看图后的结论
   - 你到底有没有看到：4 行砖阵 / 青色挡板 / 白球 / 左上角分数
   - 「打得动」的证据（日志/状态读回/两次截图差异）
   - **你没做成的每一步 + 卡在哪**（这比成功更有价值）
8. 不许修改 SKILL.md / PITFALLS.md（发现问题写进报告，由控制者回写）。
```

**准备干净项目（控制者执行，盲测前一次性）**：

```bash
T="/d/devsoft/unity/unitySoft/2022.3.62t9/Editor/Data/Resources/PackageManager/ProjectTemplates/cn.tuanjie.template.2d-7.0.4.tgz"
B=C:/Users/<用户>/pi-unity-m2-blind
X=C:/Users/<用户>/pi-unity-m2-blind-extract   # 解包临时目录：真实 Windows 路径，在**项目之外**（R212）
rm -rf "$B" "$X" && mkdir -p "$B" "$X"
# 显式前提（R212）：需要 tar（Git Bash / MSYS 自带，或 Windows 10+ 的 bsdtar）——没有就停手，别猜工具
command -v tar >/dev/null || { echo "需要 tar（Git Bash/MSYS 或 Windows 10+ 的 bsdtar）"; exit 1; }
tar xzf "$T" -C "$X"
cp -r "$X/package/ProjectData~/." "$B"/
# 装 uloop 包（codeload vendor 已在本地，见 docs/CAPABILITIES §1；**不走 OpenUPM**，U1）
node -e "
const fs=require('fs');const p='C:/Users/<用户>/pi-unity-m2-blind/Packages/manifest.json';
const m=JSON.parse(fs.readFileSync(p,'utf8'));
m.dependencies['io.github.hatayama.uloopmcp']='file:C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp';
fs.writeFileSync(p, JSON.stringify(m,null,2)+'\n');console.log('manifest OK');"
# 打开编辑器（U6：uloop launch 起不了团结引擎，自己启动）
cmd //c start "" "<引擎安装目录>/2022.3.62t9/Editor/Tuanjie.exe" -projectPath "$B"
# 等它起来（首次编译 44 asmdef 约 1-3 分钟），然后确认工具面可用：
PI_UNITY_ULOOP_BIN=C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe \
  node bin/unity.js doctor --project-path "$B" --smoke
```

> ⚠️ **不要在 `/tmp` 下解包，也不用 `<(…)` 之类 MSYS 伪路径**（U4：原生 Windows 工具不认 MSYS 的 `/tmp`）。上面用 `$X=C:/Users/<用户>/pi-unity-m2-blind-extract` 这样的**真实 Windows 路径**（在项目之外，不污染盲测项目）；`tar` 是**显式前提**（`command -v tar` 检查过才继续，R212）。
> ⚠️ 盲测项目**必须**是「模板刚解出来、只加了 uloop 依赖」的状态：没有 M1/M2 探针节点、没有打砖块脚本。

## 1. 四条验收判据（**控制者独立复核**，不看盲测 agent 的自述）

| # | 判据 | 怎么测（控制者亲自跑） | 通过线 |
|---|---|---|---|
| 1 | **结构**：场景与配方一致 | `unity scene tree --project-path $B --json` | `actual.roots` 含 `Bricks`（子节点数 = 24）、`Paddle`、`Ball`、`GameManager`；`GameManager` 的 `components` 含 `PiBrickBreaker`；退出码 0 |
| 2 | **画面**：截图里真的看得见 | `unity play start` → `unity shot --capture-mode rendering --json` → `unity pixels --file <path> --count-color <每行颜色> --json` ×4 + `read` 看图 | 4 种砖色计数**都 > 0**；`#00FFC8`（挡板）计数 > 0；`#FFFFFF`（球）计数 > 0；背景采样接近 `#0A0A14`；退出码 0 |
| 3 | **可动**：游戏真的在跑 | `unity play logs --search-text '[BB]'` 两次（间隔 ≥5s）+ 两张渲染图的 `pixels --at` 对比 + `unity play logs --log-type Error` | 日志含 `ready bricks=24` 且含 ≥1 条 `hit brick=`；两次采样值不同；Error 日志 `totalCount === 0` |
| 4 | **纪律**：闭环干净、无假绿 | `unity doctor --smoke` + `unity doctor --golden` + `scene tree` 里 grep `__pi_` + 检查盲测报告 | `--smoke` 七项全 pass；`--golden` `matched:true`、`cleanup.status:'ok'`；无 `__pi_*` 残留；盲测报告里**每条命令都带退出码**、**每张图都附 `read` 看图的结论**、**失败步骤如实列出** |

**任何一条不通过** → 判据 1–3 属于「M2 的功能没做到」，判据 4 属于「skill 不自足 / 有假绿」；
两种都要走 §3 的回写流程，**不许**改判据来迁就结果（M1 的 R112 改判据是因为原判据原理上不可能，而不是因为没做到）。

## 2. 执行记录（**边跑边填，不要事后编**）

### 2.1 准备
（粘真实命令 + 真实输出：解包、manifest、编辑器启动、doctor --smoke 的完整输出）

### 2.2 盲测子代理的执行摘要
（盲测 agent 报告的要点；**原样引用它的失败描述**）

### 2.3 四条判据的复核结果
| # | 结果 | 证据（命令 + 退出码 + 截图路径） |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |

### 2.4 截图证据
（列出每一张图：路径、`read` 看到了什么、像素判定的数字）

### 2.5 结论
（四条全过 / 哪条没过 + 原因 + 去向）

## 3. 盲测暴露的问题怎么回写（**这是本任务真正交付的东西**）

1. **先分类**（不要混在一起）：
   - **A. skill 缺信息**（盲测 agent 不知道该干什么 / 猜错）→ 改 `SKILL.md`（补进 §3.5 配方、§8 验证配方、§5 停止条件或 §6 迭代上限）；
   - **B. CLI 缺能力 / 报错误导**（命令做不到、错误码/hint 指错方向）→ **新开一个任务修代码**（不在本任务里顺手改，避免无测试的改动混进盲测记录）；
   - **C. 真机事实与 skill 不符**（例如某颜色渲染出来不一样、坐标公式偏了）→ 改 skill 的配方 + 向 `docs/PITFALLS.md` **追加一条（不写 U 编号，R213）**（**必须标适用引擎**）；
   - **D. 环境问题**（网络、编辑器崩溃、uloop 版本）→ 记录到执行记录 §2.1，不改代码也不改 skill。
2. **每条回写都要有证据**：盲测报告里的原文 + 控制者复核命令 + 退出码。
3. **新坑一律先追加到 `docs/PITFALLS.md` 的**文件末尾**、不写 U 编号**（R213：避免 T7/T8/T12 抢注 U16+）；每条逐字标 `[团结 2022.3.62t9 实测]` / `[Unity 官方未验证]`，并在**报告**里写「待编号的坑 + 一句话」。**编号与索引表统一由任务 13 定稿**。（⚠️ 预留号口径，定稿见下方统一批注：输入模拟 = **U25**、`play start`/未保存场景 = **U26**）
4. **回写完成后重跑本任务的四条判据**（至少判据 1–4 的复核命令要重跑一遍），确认「修文档」没有把结论改坏。
```

- [ ] **步骤 2：准备干净项目并复核环境**

按 `docs/E2E-ACCEPTANCE-m2.md` §0 的「准备干净项目」逐条执行（真实 Windows 路径，**不要用 `/tmp`**）。
判据：`doctor --smoke` 七项全 pass；`scene tree` 只有一个 `Main Camera`（模板原样）。

- [ ] **步骤 3：派盲测子代理执行**

按 §0 的 brief 逐字派发（**只给 SKILL.md + PITFALLS.md + 项目路径 + 命令路径**）。
子代理产出 `.superpowers/e2e-m2-blind-report.md`。**不要**在它执行中途给提示；它卡住就让它如实记录「卡在哪」。

- [ ] **步骤 4：控制者独立复核四条判据**

按 §1 的表逐条亲自跑，把命令、退出码、截图路径、`read` 的结论填进 §2.3 / §2.4。

- [ ] **步骤 5：按 §3 回写（分类 → 出证据 → **追加无编号条目** → 重跑判据；编号由任务 13 定稿，R213）**

- [ ] **步骤 6：Commit**

```bash
git add docs/E2E-ACCEPTANCE-m2.md docs/PITFALLS.md skills/unity-game-dev/SKILL.md
git commit -m "test(e2e): M2 盲测执行记录 + 四条判据复核 + 盲测发现回写"
```

---

## 任务 13：文档收尾（规格偏差表 / PITFALLS 索引 / README / CAPABILITIES）（机械）

**文件：**
- 修改：`docs/superpowers/specs/2026-09-18-pi-unity-design.md`（§9 里程碑 + §9.1 偏差表）
- 修改：`docs/PITFALLS.md`（索引表 + 适用引擎口径 + M2 新条目归属）
- 修改：`docs/CAPABILITIES-tuanjie-2022.3.62t9.md`（新增 §4.7：M2 用到的字段/参数实证）
- 修改：`README.md`（最终状态、测试数、文档表）
- 修改：`skills/unity-game-dev/SKILL.md`（**R213**：把 §7 常见错误表里引用的 U 编号与定稿后的 `docs/PITFALLS.md` 索引对齐）
- 修改：`bin/unity.js`（USAGE 里 `version` 之外的命令清单与实测一致 —— 最后一次对账）

**依据（规格 §6.3 的纪律）**：文档回写**放在真机验证之后**；每次回写扫「工具数 / 坑位数 / 测试数 / 能力清单 / `bin --help` 文案」。本任务是**最后一步**，所以以上五样都要与实况一致。

> **R213：编号与索引表在本任务定稿**。任务 7/8/12 只往 `docs/PITFALLS.md` 末尾追加**不写编号**的条目，并在各自报告里写「待编号的坑 + 一句话」；本任务负责：① 按追加顺序为它们分配编号（M2 新增从 **U16** 起，若 U16–U20 已被其他真机发现占用则顺序后移）；② 把本任务自己新增的条目一并编号；③ 更新索引表；④ **把 `skills/unity-game-dev/SKILL.md` 里引用的 U 编号（T11 写的是预留号）与最终编号对齐**。
>
> ⚠️ **编号已定稿（2026-09-19，任务 13）**：本计划里出现的预留号 **U16** = 输入模拟的可用性边界（定稿 **U25**）、**U17** = `play start`/未保存场景（定稿 **U26**）；一律以 `docs/PITFALLS.md` 索引为准。

- [ ] **步骤 1：规格 §9.1 偏差表补齐**

在 `docs/superpowers/specs/2026-09-18-pi-unity-design.md` 的 §9 里把 M2 行改成已完成（带真实验收结论），并在 §9.1 追加一节 `### 9.2 M2 完成情况与偏差（<日期>）`，内容至少覆盖：

| 后移项/偏差 | 去向 | 结论 |
|---|---|---|
| 视觉闭环（M1 未证明）—— 锚点：规格 §9.1 的「**验收判据 4 的口径修正（R112）**」段（原文：截图只能证明「图 = 真实渲染内容」，M1Probe 在场景里由 `node inspect` + `scene tree` 交叉证明）+ M1 账本（`.superpowers/sdd/2026-09-18-pi-unity-m1-implementation/progress.md`）的「**残留风险**」段 | **M2 已证** | `<真实数字>`：`sprite set` verified:true + `pixels --expect` 退出码 0 + `read` 看图（用 `pixels` 把 R112 的「目视确认」升级为退出码；世界坐标→像素公式见任务 11 真机步骤） |
| `doctor --golden` | **M2 已交付** | `<真实结论>`：两轮 matched=? 首个分歧路径=? 复杂场景确定性结论=? |
| `--smoke` 写-读回-删自闭环 | **M2 已交付** | 七项全 pass；**语义变化已写入 skill**（不再只读） |
| `unity play` 试玩闭环 | **M2 已交付** | 进/出/步进/日志/视图尺寸真机通过；`key`/`mouse` 的 Input System 缺口**如实落 `INPUT_SYSTEM_UNAVAILABLE`**（未验证真实注入） |
| `shot --capture-mode/--match-mode` | **M2 已接线** | 真机：EditMode `window` 仍需本地化名；`rendering` 需 PlayMode |
| **M2 新增需求：`unity asset write` + `unity compile`** | **新增（M2 内）** | 依据：动态代码的 MonoBehaviour 不能跨域重载存活（U8 同族）→ 盲测游戏必须落真 asset |
| **M2 新增需求：`unity node delete`** | **新增（M2 内）** | 依据：`--smoke` 自闭环与 `--golden` 清理都需要它 |
| **M2 新增需求：`unity pixels`** | **新增（M2 内）** | 依据：把「看得见」变成退出码（可观测验收） |
| **M2 新增偏差：`doctor --json` 契约** | M2 | `{ok,mode,checks}` + 逐项 `code`（M1 是 `{ok,checks}`/`{ok,results}` 且无 code） |
| **M2 新增偏差：退出码边界** | M2 | `2`=用法错 / `1`=运行时错（单点 `exitCodeFor`） |
| **仍未验证** | M3+ | `simulate-keyboard`/`simulate-mouse-input` 的真实注入（需 Input System 项目）、`replay-input`、`pause-point`/watch、`record-video`、`run-tests`、WebGL/Android 出包、Unity 官方版全量 |

**要求**：表里每一个「已交付」都要能指向 `docs/E2E-ACCEPTANCE-m2.md` 或某个任务的真机报告（写明 commit 范围）；**不许**写「应该可用」。

- [ ] **步骤 2：`docs/PITFALLS.md` 收口**

1. **先收集、再编号**（R213）：把各任务报告里的「待编号的坑 + 一句话」与盲测发现合并成一张表，**按追加到 `docs/PITFALLS.md` 的顺序**分配编号（M2 新增从 **U16** 起 —— 下列 **U16/U17** 均为预留号，定稿见上文统一批注；至少预留这几类的落点）：
   - **U16**（定稿 **U25**）输入模拟的可用性边界：`simulate-keyboard`/`simulate-mouse-input` 需要 Input System（报文逐字 + 出处）；`simulate-mouse-ui` 只对 ScreenSpaceOverlay + GraphicRaycaster 的 uGUI 生效（出处 `UiRaycastHelper.cs:21-53`），**打不到 SpriteRenderer**；`--dry-run` 用 3D 物理射线，对 2D 项目无意义。
   - **U17**（定稿 **U26**）`unity play start` 与未保存场景：`Play` 在能静默保存时会保存当前场景（真机 md5 结论：未观测到写盘，定稿以 **U26** 为准）；未命名场景会落 `CONTROL_PLAY_MODE_UNSAVED_CHANGES`。
   - **U18**（条件条目）`get-hierarchy` 的确定性：`doctor --golden` 的真机结论（若 matched:false，写出分歧字段与适用引擎）。
   - **U19**（条件条目）渲染回读的色偏：Linear 色彩空间下 sprite 颜色与 `--expect` 的实测差值（若 `pixels` 需要容差 > 16 才命中）。
   - **U20**（条件条目）`uloop compile` 是否自动 refresh 外部新写入的 `.cs`（真机结论）；**R209**：`compile` 的 `Success` 真机实际类型。
   > 上列是「预留位」，**不是**固定编号：以实际发现的多少与顺序为准；任务 7/8/12 追加的无编号条目可能占掉其中某个号。
   > **对齐 SKILL.md**：把 `skills/unity-game-dev/SKILL.md` §7 常见错误表里引用的 U 编号（T11 写的预留号）改成最终编号；锚点以 `docs/PITFALLS.md` 为准。
2. 每条**必须**带「适用引擎」行（`[团结 2022.3.62t9 实测]` / `[Unity 官方未验证]`），并给出**上游出处或本仓库 commit/路径**。
3. 文末的「适用引擎标注口径」段落保持与实况一致（U1–U10 无该行，U11 起有；U7/U9/U10 例外）。

- [ ] **步骤 3：`docs/CAPABILITIES-*.md` 补 §4.7「M2 用到的字段/参数实证」**

新增一张表，把 M2 用到的**每一个**上游参数名/响应字段名与它的 vendor 出处（文件:行）列出来，至少包含：

| 工具 | 参数/字段 | vendor 出处 |
|---|---|---|
| `control-play-mode` | `--action` / `--timeout-seconds`；响应 `IsPlaying`/`IsPaused`/`Changed`/`WasAlreadyStopped`/`ResumedFromPause`/`BlockedByCompileErrors`/`BlockedByUnsavedChanges`/`CompileErrorCount`/`StoppedBy`/`StoppedAt`/`Warning` | `ControlPlayMode/Skill/SKILL.md:21-22`、`ControlPlayMode/ControlPlayModeResponse.cs:11-26` |
| `simulate-mouse-ui` | `--action/--x/--y/--from-x/--from-y/--button/--duration/--target-path/--bypass-raycast`；响应 `HitGameObjectName`/`PositionX`/`PositionY`/`InterruptedByPausePoint`/`PausePointHitCount` | `SimulateMouseUi/Skill/SKILL.md:31-41`、`SimulateMouseUi/SimulateMouseUiResponse.cs:14-21` |
| `simulate-mouse-input` | `--action/--x/--y/--button/--duration/--delta-x/--delta-y/--scroll-x/--scroll-y/--dry-run`；响应 `Hit`/`CameraName`/`CameraPath`/`HitGameObjectName`/`PressDeliveredToGame` | `SimulateMouseInput/Skill/SKILL.md:37-46`、`SimulateMouseInput/SimulateMouseInputResponse.cs:218-254` |
| `simulate-keyboard` | `--action/--key/--duration`；响应 `KeyName`/`PressDeliveredToGame`/`PressEdgeObserved`/`ReleasedKeys`/`ReleasedKeyStates`；缺包报文 | `SimulateKeyboard/Skill/SKILL.md:30-32`、`SimulateKeyboard/SimulateKeyboardResponse.cs:62-96`、`Common/InputSystem/InputSystemPackageRequirementMessage.cs:11-17` |
| `get-logs` | `--log-type/--max-count/--search-text/--include-stack-trace`；响应 `TotalCount`/`DisplayedCount`/`Logs[].Type/Message/StackTrace` | `GetLogs/Skill/SKILL.md:21-23`、`GetLogs/GetLogsResponse.cs:28-63` |
| `set-game-view-size` | `--width/--height`；响应 `PreviousWidth`/`PreviousHeight`/`CurrentWidth`/`CurrentHeight`/`Changed` | `SetGameViewSize/Skill/SKILL.md:21-22,29-31` |
| `compile` | `--timeout-seconds/--force-recompile/--no-wait-for-domain-reload`；响应 `Success`(可 null)/`ErrorCount`(可 null)/`WarningCount`(可 null)/`Errors[]`/`Warnings[]`/`ErrorCode`/`NextActions` | `Compile/Skill/SKILL.md:9-56`、`Compile/CompileResponse.cs:28-80` |
| `screenshot` | `--capture-mode/--match-mode/--window-name/--annotate-elements/--elements-only`；响应顶层 `Screenshots`/`TimedOut`/`ResolvedCaptureMode`/`ScreenshotCount`，每图 `ImagePath`/`GameViewWidth`/`GameViewHeight`/`ScreenshotToInputFormula`/`AnnotatedElements` | `Screenshot/Skill/SKILL.md:21-29,54-66`、`ToolContracts/ScreenshotResponse.cs:10-44` |

> **该表的方法论意义**（M1 的教训 U11）：本包的**每一个**上游参数名/字段名都必须在 vendor 里有出处；靠猜的名字会在健康机器上造成假红。

- [ ] **步骤 4：README 与 USAGE 对账（最后一次）**

```bash
node bin/unity.js --help | head -40
npm test 2>&1 | tail -6
grep -c '^| U[0-9]' docs/PITFALLS.md
```

把三处的真实数字/prose 与 README 的状态段、`docs/PITFALLS.md` 的索引、CAPABILITIES 的「仍未验证」清单逐一对齐；
README 里「M2 未实现」的措辞必须全部消失（`grep -n "尚未实现\|划入后续里程碑" README.md` 应为空或只指向 M3 及以后）。

- [ ] **步骤 5：跑全量测试 + 真机终验**

```bash
npm test                                   # 全绿，记录真实总数
P=C:/Users/<用户>/pi-unity-spike/S0Project
node bin/unity.js doctor --project-path $P            ; echo "exit=$?"
node bin/unity.js doctor --project-path $P --smoke    ; echo "exit=$?"
node bin/unity.js doctor --project-path $P --golden   ; echo "exit=$?"
```

- [ ] **步骤 6：Commit**

```bash
git add docs/superpowers/specs/2026-09-18-pi-unity-design.md docs/PITFALLS.md \
        docs/CAPABILITIES-tuanjie-2022.3.62t9.md README.md bin/unity.js skills/unity-game-dev/SKILL.md
git commit -m "docs(m2): 里程碑与偏差表补齐 + PITFALLS 索引 + CAPABILITIES §4.7 字段实证 + README/USAGE 对账"
```

---

## 自检

**1. 规格覆盖度**（规格 §5 / §6.1 / §6.2 / §6.3 / §9 / §9.1 / §10 逐条 → 落在哪个任务）

| 规格条目 | 落在哪个任务 | 备注 |
|---|---|---|
| §6.1 写后读回铁律 | 全任务（任务 3/5/8 是新增写路径） | `verified:false` 必须停下的纪律写进 skill §2 |
| §6.2 `doctor`（连接/编辑器/项目/目标） | M1 已完成；任务 10 改 `--json` 契约 | — |
| §6.2 `doctor --smoke`（**只读 + 写-读回-删自闭环**） | **任务 10** | 语义变化（不再只读）同步进 skill 与 USAGE |
| §6.2 `doctor --golden`（两轮 + 剥 GUID + 首个分歧路径） | **任务 9** | 实况：只需剥 `ExportTimestamp`，用白名单投影 |
| §6.3 里程碑回写（文档在真机之后） | 任务 13（最后一步） | 每个任务自带的真机步骤 + 各自的 PITFALLS 回写 |
| §5 `preview.start` → PlayMode | **任务 7**（`unity play start/stop/...`） | — |
| §5 `shot` / `play`（模拟点击试玩） | **任务 7** | `simulate-mouse-ui` 的真实适用范围被实测界定（U16 预留号 → 定稿 **U25**） |
| §5 `node.create/inspect/set` | M1 已完成；**任务 3 补 delete**（单闭环/清理需要） | — |
| §5 组件/资产操作 → execute-dynamic-code | **任务 5（sprite）+ 任务 8（asset write/compile）** | 高频写操作仍走包内 `.cs`（D3 分档） |
| §9 M2「E2E 验收：盲测让 Pi 只靠 skill 搭一个完整小游戏」 | **任务 12**（协议 + 执行 + 四判据 + 回写） | 判据 1 结构 / 2 画面 / 3 可动 / 4 纪律 |
| §9.1「M1 未证明的视觉闭环」 | **任务 5**（首次证明）+ **任务 11**（游戏级证明） | 像素判定 + `read` 看图两条证据 |
| §9.1 `shot --match-mode/--capture-mode` | **任务 6** | EditMode 仍需本地化名（结论不变） |
| §9.1 `unity play` | **任务 7** | Input System 缺口如实声明 |
| §10 D3（高频 → 包内 `.cs`） | 任务 3/5/8（新增 `.cs` 全部进包 + 单 JSON 载荷 + `__error` 哨兵） | 跨语言 tripwire：任务 2/11 |
| §10 D5（包名/命令/skill 名） | 不变 | 新增命令都挂在 `unity` 下 |
| §10 D6（团结=验证环境 + 差异标注） | 任务 13（PITFALLS 适用引擎口径）+ 各任务真机步骤 | 新增条目一律标引擎 |
| M1 必修清单（9 项） | 任务 1（①⑤⑥⑦⑧）、任务 2（③⑨）、任务 10（④） | 逐项对得上 |

**未覆盖（明确划出 M2 之外）**：`unity build`（M3，S8 已手工验证）、美术管线/Prefab（M4）、pi 包化与 `/unity-*` 扩展（M5）、Input System 项目里的真实键鼠注入（仍未验证，见规格 §8.1 末）。

**2. 占位符扫描**

- 全文无 `TODO` / 「待定」/ 「类似任务 N」/ 「按上例」/ 「补充细节」/ 「适当的错误处理」。
- 每个代码步骤都给了**可运行/可编译**的完整代码；对既有大文件的修改给了**精确锚点**（函数名 + 相邻代码 + 行号线索）。
- 需要真机才能定的数值（色偏容差、像素计数阈值、golden 是否 matched）**都已写成「先跑再填 + 判据 + 如果不符怎么办」**，而不是写成假数字。
- 唯一「由执行者填」的地方是 `docs/E2E-ACCEPTANCE-m2.md` 的执行记录（`<填实际日期>` / `<真实数字>` 等），它们是**真机记录槽位**而不是设计占位符。

**3. 类型一致性**（逐条核对过）

| 契约 | 定义处 | 使用处 | 一致？ |
|---|---|---|---|
| `envelopeFromCall(r)` | 任务 1 | 任务 3（nodeDelete）、任务 5（spriteSet）、任务 7（play 全族） | ✅ |
| `exitCodeFor(envelope)`（含 `actual.match===false` → 1） | 任务 2 | 任务 3/4/5/6/7/8 的 CLI handler | ✅ |
| `USAGE_FAILURE_CODES`（28 个码） | 任务 2 实现 + 冻结断言 | 错误码总表 + 各任务的码名 | ✅（逐字比对：MISSING_×7、BAD_×19、EMPTY_PATCH、UNKNOWN_PATCH_KEY） |
| `PATCH_KEYS` | 任务 2 导出 | tripwire 测试 + `node-set.cs` | ✅ |
| `parseNodeResult(r, { path })` / `buildPayloadArgs` / `nodeInspect` | 任务 5 在 `scene.js` 落点 | `lib/sprite.js` 的 import（`NOT_FOUND` 的 `actual` 带 `path`，R207） | ✅ |
| `spriteSet` 的 intent 形状 `{sprite:{color,sortingOrder?}}` | 任务 5 | `node-inspect.cs` 的 `sprite` 字段 + 测试 | ✅ |
| `_readFile`（pixels）/ `_readSource`+`_writeFile`+`_readBack`+`_exists`+`_mkdirp`（asset）/ `_call`（全部） | 任务 4/5/7/8 | 各自的测试 | ✅ |
| `smoke` 的 7 项（3 只读 + 4 `write-*`）与 `runGolden` 的 6 键返回 | 任务 10 / 任务 9 | 任务 9 的形状测试 + 任务 10 的 `doctor --json --golden` 形状测试 | ✅（R206③） |
| `makeFakeSceneBackend`（含 `list` 探活） | 任务 9 | 任务 9/10 的测试 | ✅ |
| `SMOKE_NODE='__pi_smoke'` / `GOLDEN_ROOT='__pi_golden'` | 任务 10 / 任务 9 | 互不冲突；都在真机清理判据里被 grep | ✅ |
| `doctor --json` 形状 | 任务 10：`{ok,mode,checks}` | 任务 9 的 golden 是**显式例外** `{ok,mode:'golden',matched,diff,cleanup,blocked,lines}`（已写进计划与 USAGE） | ✅（已文档化） |
| `play <子动作>` → 库函数映射 | 任务 7 的 CLI 块 | `lib/play.js` 的签名 | ✅ |

**4. 任务难度与依赖顺序**

| 任务 | 标题 | 难度 | 依赖 |
|---|---|---|---|
| 1 | M1 必修批 A（死码/重复/措辞） | 机械 | — |
| 2 | tripwire + 退出码边界 | 判断 | 1 |
| 3 | `node delete` | 集成 | 2 |
| 4 | `color`/`png`/`pixels` + fixture | 集成 | 2 |
| 5 | `sprite set` + `node-inspect.sprite` + 视觉闭环 | 集成 | 3, 4 |
| 6 | `shot` 的 capture/match 接线 | 集成 | 4 |
| 7 | `unity play` 试玩闭环 | 集成 | 6 |
| 8 | `asset write` + `compile` | 集成 | 2、**4**（CLI 级用例复用任务 4 抽出的 `test/helpers/capture.js`，R206⑤） |
| 9 | `doctor --golden` | 判断 | 3 |
| 10 | `--smoke` 自闭环 + `--json` 契约 | 集成 | 3, 9 |
| 11 | skill 完整版 + 打砖块模板 | 判断 | 5, 6, 7, 8 |
| 12 | E2E 盲测 | 判断 | 11（+ 全部） |
| 13 | 文档收尾 | 机械 | 12 |

---

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-09-19-pi-unity-m2-implementation.md`。两种执行方式：

**1. 子代理驱动（推荐）** —— 每个任务调度一个新子代理，任务间进行审查，快速迭代
**2. 内联执行** —— 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

选哪种方式？
