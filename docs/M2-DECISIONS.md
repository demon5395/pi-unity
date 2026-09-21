# pi-unity 决策账本（M2 / M1）

> **状态**：M2 已完成（**369/369** 测试绿；E2E 盲测四条判据全过，独立复核者复现）。落法 = `master` fast-forward + tag `v0.2.0-m2`。
> 本目录两份账本是**每个任务的过程记录**：逐条 `R<编号>` 裁决（含「如果错了的代价」）、每个任务的「延后 Minor」清单、修复轮次与审查结论。
> **为什么进仓库**：原文件在被 gitignore 的 `.superpowers/` 下；`docs/PITFALLS.md` 的「已知问题登记」D 表引用了它，若随工作区删除就会悬空。

## 交付决策（2026-09-19，控制者；用户授权「你决定吧」）

| # | 决策 | 理由 | 若错了的代价 |
|---|---|---|---|
| 1 | **分支落法 = `master` fast-forward 到 `m2-impl` + annotated tag `v0.2.0-m2`**，不开 PR | `master`(`7f16cf0`) 是 `m2-impl`(`4894fcb`) 的**祖先**，可干净 ff；历史本身已是「M1 计划→M1 实现→M2 计划→M2 实现」的线性里程碑结构，再造合并提交是伪历史。**无远端**，且第二双眼睛已由「每任务 spec+code 双审 + 最终整分支审查 + 独立 E2E 复核」给足（17 次审查 / 6 轮修复） | 若日后需要团队背书，补加远端再走一次 PR 即可（历史未污染） |
| 2 | **不做 C# port** | 会**清零已有验证资产**（369 单测 + golden 确定性 + smoke 写读回删 + E2E 盲测），而功能收益为 0；信封层 ~2.3k 行、零第三方依赖，Pi 原生跑 Node，skill 契约就是 `node <包>/bin/unity.js`；真正需要 C# 的部分（`unity-scripts/*.cs` + 模板）已经是 C# | 若将来出现「不装 Node 也要用」或「走 UPM 分发」的硬需求：正确做法是**薄 C# 前端 shell 到同一 CLI**（保持信封契约为唯一真值，黑盒复用现有测试），成本约 1/5，而不是重写 |
| 3 | **M3 第一刀 = `unity exec`**（动态 C#，包住上游 `execute-dynamic-code`） | 盲测暴露的 **#1 缺口**：SKILL §8 曾指向命令面不存在的能力、把 agent 逼向被禁的裸 uloop；有了它，「游戏真的在跑」可用**数值**（`score`/`bricksAlive`）证明而非只靠日志+截图；顺带清掉最终审查唯一搁置项（R349）与 `lib/play.js` 两处残留 hint | 先做 `scene save/open` 或 Unity 官方版兼容性验证也可（见下 backlog），只是「skill 自相矛盾」会多留一轮 |

### M3 backlog（按优先级；详细验收标准在 `docs/E2E-ACCEPTANCE-m2.md` §3.2 的 B 类登记）

1. ✅ **`unity exec`**（P0）—— **已交付 `v0.3.0`**（`--code-file`/`--code`，`verified: null`，编译错映射为 `SCRIPT_COMPILE_ERROR` 带 `file:line`；关闭 E2E B1 + R349）。账本：`docs/M3-DECISIONS.md`
2. ✅ **`unity scene save` / `scene open`**（P0）—— **已交付 `v0.4.0`**（写后读回 + mtime 硬证据防「返回 true 却不写盘」的假绿 + `DIRTY_SCENE` 守卫；关闭 E2E B2「交付物丢过两次」）。账本：`docs/M3-DECISIONS.md`
3. ✅ **`unity build`**（P1）—— **已交付 `v0.5.0`**（目标可用性只问编辑器 `IsBuildTargetSupported`、产物清单**只读磁盘**、写后读回给 `verified` 布尔；真机 `exit 0/verified:true/109.4 MiB/2.02s`，`--target webgl` → `BUILD_TARGET_UNAVAILABLE`；R367 的 `BuildSummary` struct 编译错由真机关闭）。账本：`docs/M3-DECISIONS.md`
4. ✅ **Unity 官方版兼容性验证**（P1）—— **已做（2026-09-20），Q2 = 成立（有条件）**：21 工具全可用、`--smoke` 7/7、`--golden` `matched:true`、信封/编译错误报文逐字一致、`build` 出包可跑。3 处差异在**我们这侧**（SKILL 文案 / 窗口名映射 / `build-targets` 口径），非引擎适配缺失。实测见 `docs/CAPABILITIES-unity-2022.3.62f3c1.md` 与 `docs/UNITY-OFFICIAL-VERIFICATION.md`。**剩余不确定**：真国际版仍未验证（本机两个都是中国构建）
5. `pixels --diff`/质心/bbox（P2）、Input System 项目的真实注入验证（P2）、**只读**验证用户真实大工程（`doctor` + `scene tree`，需用户点头）（P2）。
6. D 表里其余延后 Minor（P3）：最终审查已甄别，只有 D5/D14 需合并前修（已修）。

---

# SDD ledger — plan: docs/superpowers/plans/2026-09-19-pi-unity-m2-implementation.md

工作树：`pi-unity-m2`（分支 `m2-impl`，从 M1 的 `m1-impl@8c27e58` 起）· 基线 `40c898b9`（M2 计划）
M1 账本（不动，共 120 条裁决 + 80 条延后项）：`.superpowers/sdd/2026-09-18-pi-unity-m1-implementation/progress.md`

## 起飞前冲突扫描（M2）

控制者派了一个**只读**子代理通读 5747 行计划并产出两张表（它无 write/bash 能力，正文在会话里；结论已由控制者复核并裁定如下）。
**扫描结论：13 个任务必须全部串行；发现 3 条真冲突、5 处接口总表与任务不符、9/13 任务文本不自洽。**

### 真冲突（会让两个任务互相破坏）
- **C1（A7）** T1 把 `describeFailure`+`standaloneFailure` 合并成 `failureText` 并**删除** `standaloneFailure`，而 T10 的 smoke 片段仍调用 `standaloneFailure(r)` → 落地即 `ReferenceError`，`test/doctor.test.js` 6 组用例会走到该分支 → `npm test` 红。
- **C2（A3）** T2 只给 `bin/unity.js` 顶层加 `exitCodeFor`，但 T4/T5/T7/T8 的 CLI 片段**裸用 `emit`**（M1 的 handler 都是**局部 require**）→ 步骤 4 必 `ReferenceError`；T8 没有 CLI 级用例，会漏到真机。
- **C3（A10/A16/A18）** T6 接线 `--capture-mode`/`--match-mode` 后，三处「未接线」文本没清：`lib/shot.js` 的 hint 出路②③、`SKILL.md:210`、`test/shot.test.js:436` 的断言（断言的正是「必须写未接线」）→ 仓库自相矛盾；而 T12 盲测判据 2 要求 `shot --capture-mode rendering` 且禁止裸 uloop。
- **C4（A17）** T10 把 smoke 从 3 项改到 7 项，**必然打破 `test/doctor.test.js` ≥8 处既有断言**（3 元素状态数组、遍历全结果的 `/无法启动 dispatcher/` 等），而计划只写「追加 6 条」。

### 接口总表（`## M2 新增接口总表`）与任务不符 5 处（A20）
`assetWrite` 的注入名（表写 `_readFile`，实现用 `_readSource/_writeFile/_readBack/_exists/_mkdirp`）；`smoke` 少 `_call`；`lib/scene.js` 段少 `parseNodeResult`；`EXPECT_MISMATCH` 表里有实现从不产；`GOLDEN_BLOCKED/STEP_FAILED/LEFTOVER/MISMATCH` 四个码表里有、`runGolden` 从不产（它返回 `{ok,matched,diff,cleanup,blocked,lines}`）；`doctor --json --golden` 的形状无断言；`unity asset write`/`compile` 无 CLI 级用例。

### 各任务文本不自洽（表 B，重者）
T4 步骤 4 先写 19 条再写 21 条、文件清单漏 `test/doctor.test.js`+`test/shot.test.js`（却要从它们抽 `captureStdout`）；T5 的 `NOT_FOUND` 用例断言 `actual={path}` 而实现给 `{__error}`（必红）；T7 的 `test/play.test.js` 有**重复/未闭合块**（按字面粘贴即坏）+ 计数 13/15/18 三处不一致；T8 的 `compile.Success:null` 与 vendor 实现相反（`CompileResponseFactory.cs:80,91` 强制 bool → 该用例锁的是**不可达形状**，`indeterminate` 是死码）+ 无 CLI 用例；T9 的「检出变异」注入阈值 `snapshots>=3` **不可达**（`runRound` 只 2 次快照）→ 用例必红 + `doctor` 接线块与紧随的注释矛盾（注释要求传 T10 才有的 `_call`）+ 计数 8/7；T10 的 `doctor --json` 用例把 `appData` 传了却被 `doctor` 丢弃（会读真实 APPDATA）；T11 的 tripwire `/, 1f\)/` 过弱；T12 用 `/tmp` 却在下一行说「不要用 /tmp」；T13 的规格 §9.1 引用不准（§9.1 没有「视觉闭环」行）。

### 控制者裁决（R201–R213，全部在派任务 1 之前生效）
- **R201** — `## 全局约束` 段必须是一个**真标题**（现在整行是 `---## 全局约束`，CommonMark 视为段落 → 逐字引用会失败）；内容 = M1 的 14 条**逐字** + M2 新增条目（逐条给出处）。M1 第 10 条不得被并进第 9 条。
- **R202** — C1：T10 一律改用 T1 定稿后的 `failureText`；T1 与 T10 的片段必须一致。
- **R203** — C2：**沿用 M1 风格**——每个新 handler **在自己体内**局部 `require` 它用到的东西（`emit`/`parseArgs`/新模块），**不**改 `bin/unity.js` 的顶层导入面；T4/T5/T7/T8 的片段补齐 require。
- **R204** — C3：T6 必须**同时**清理三处「未接线」文本（`lib/shot.js` hint、`SKILL.md` 对应行、`test/shot.test.js` 那条断言要改成「已接线」的等价断言），并把它们列进 T6 的文件/断言清单。
- **R205** — C4：T10 必须**逐条列出**要改的既有断言（≥8 处）与其新期望，不许只说「追加 6 条」。
- **R206** — A20：接口总表以**实现为准**对齐（改表），并补齐缺失项；`EXPECT_MISMATCH` 与 4 个 `GOLDEN_*` 码：**要么让实现真的产，要么从表里删**（不许留表里有、实现没有的死码）；`doctor --json --golden` 必须补形状断言；`asset write`/`compile` 必须补 CLI 级用例（`main([...])`）。
- **R207** — T4 计数与文件清单修正；T5 的 `NOT_FOUND`：**统一**为 M1 R69 的口径（`actual` 必须带被查的 `path`）→ T5 的实现改走与 T3 相同的 `describeError` 包装，断言语义不变。
- **R208** — T7 的 `test/play.test.js` 必须重写为无重复、无未闭合块的版本，并统一用例计数。
- **R209** — T8 的 `Success:null` 前提：**保留防御**（上游 SKILL.md 写 "boolean or null"）但**降级标注**为「生产不可达，除非上游改回 null」，并**补一条真机对账**（真机跑 `uloop compile` 记录 `Success` 的实际类型）；`indeterminate` 分支保留但注明可达条件。
- **R210** — T9 的变异注入阈值改成**可达**（`snapshots>=2` 或改注入点），使之真能红；`doctor` 的接线块与注释对齐（`_call` 形参在 T10 才有 → T9 只写 `{projectPath, env, rootDir, runImpl}`，注释里的 `_call` 删掉）；计数统一。
- **R211** — T1 的 `npm test` 脚本与 `engines`：`node --test "test/*.test.js"` 的 glob 由 **Node ≥21** 自己展开（Windows 的 npm 用 cmd.exe，不展开 glob）→ `engines` 必须写成 **`>=21`**（或改回 `node --test` 但那样 `test/fixtures/fake-uloop.js` 会被当测试执行，即 M1 那个 207/206 计数问题）。**取 `engines: ">=21"` + 显式 glob**，并把理由写进注释与 README。
- **R212** — T12 的 `/tmp` 与 `tar` 用法清理（改到项目内临时目录；`tar` 若不可用则用 Node 解压或 `node:zlib`）；T13 的规格引用改成**真实存在**的锚点。
- **R213** — `docs/PITFALLS.md` 的**编号竞争**：T7/T8/T12 **只追加条目到文件末尾、不指定 U 编号**（在自己的报告里写「待编号的坑 + 一句话」），**编号与索引表统一由 T13 定稿**。

### 执行顺序（扫描结论）
**全部串行**：T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13。
硬依赖：T3/T4 ← T2；T5 ← T3+T4；T6 ← T4；T7 ← T6；T9 ← T3；T10 ← T3+T9；T11 ← 5/6/7/8；T13 ← 12。

### 进度
（任务完成行由此往下追加）

### 任务 1（M2 必修批 A）

首轮审查：spec ✅ 通过 / code ❌ 需要修复（**1 关键** + 1 重要）→ 修复循环第 1 轮

- R214 — code-reviewer **关键**：`lib/scene.js:20` 出现**新引入的死 import**（`fromUloop` 全文件只出现这一行）。本 commit 把 5 处 `fromUloop(r.json)` 全换成 `envelopeFromCall` 后就死了，而**本任务的主题正是「死码」**，简报那句「`fromUloop` 仍被 `envelopeFromCall` 内部使用，import 保留」混淆了模块作用域（内部使用的是 `lib/envelope.js` 自己的绑定）。
  Ruling：**删掉** `lib/scene.js` 导入里的 `fromUloop`（`lib/shot.js` 已经这么做了，是对的）。这是简报措辞缺陷，不是实现者违规——但结果必须修。
  如果错了：代价为零。
- R215 — code-reviewer 重要：本任务的**交付物**（4+1 处截断感知接入）**没有任何回归网**——所有测试假件都硬写 `truncated: false`，把接入改回 `fromUloop(r.json)` 套件仍全绿 → M1 的假绿行为可以在无人察觉时回潮。
  Ruling：**补 2 条 `_call` 注入用例**（`test/scene.test.js`）：① `sceneTree` 注入 `{code:0, json:{Success:true,HierarchyFilePath:'x'}, truncated:true, drained:true}` → 断言 `ok===false` 且 `code==='ULOOP_TRUNCATED'`；② `nodeSet` 同型注入 → 断言**不落 `ok:true`**（铁律：截断按失败处理）。
  如果错了：代价是 2 条断言；不做则本任务的交付物无人守护。
- R216 — code-reviewer 次要①：`README.md:46-48` 与 `package.json:2` 的因果描述**与实测不符**（把两件事混成一件，且把更危险的那种说轻了）。实测：① 裸 `node --test` 才会递归收 `test/` 并把 fixture 当测试跑；② **传一个不被展开的 glob 是「0 个用例、退出码 0」——静默全绿**，比「多跑几条」危险得多；M1 报 207 的成因是当时脚本就是裸 `node --test`。
  Ruling：改成准确表述（Node<21 不展开 glob → 字面路径 → **0 条静默通过**；M1 的 207 来自裸 `node --test` 收了 fixture），并在注释里点明「这是我们选 `>=21` 的真正原因」。
  如果错了：代价为零。
- R217 — code-reviewer 次要②③：删掉 `test/envelope.test.js` 里被上一行蕴含的冗余断言；`test/readback.test.js` 的用例体内 `require` 改为文件顶部 import（与既有风格一致）。
  如果错了：代价为零。
- 【登记不改】审查者次要④：`nodeCreate`/`nodeSet` 的截断现在统一成 `ULOOP_TRUNCATED`（`retryable:true`），对**已生效的 create** 重试会造重复节点 → 建议给写路径补「写入是否生效未知，先用 `scene tree` 复核」hint。属可选改进（既有 `ULOOP_NO_JSON` 同样 retryable，非回退），登记待 M2 后续任务触碰该代码时一并处理。
- 【登记不改】`lib/doctor.js` 的探活/`smoke` 仍直接读 `r.json`，未接入 `envelopeFromCall`（简报显式限定了接入范围）——截断的 `list` 探活仍产连接措辞（既有 R31 行为，有测试覆盖）。

Task 1: fix round 1/5 (4 addressed, 0 open — F1 **关键**：删 `lib/scene.js` 死 import `fromUloop`（本任务主题就是死码）/ F2 补 2 条 `_call` 注入回归网（经变异证明有牙：把 `envelopeFromCall(r)` 改回 `fromUloop(r.json)` → sceneTree 落 `HIERARCHY_READ_FAILED`、nodeSet **回落 `ok:true` 假绿**，两条都红）/ F3 README+package.json 因果描述改准 / F4 删被蕴含的冗余断言 + `require` 并进顶部; commits 130c456..2a7e25a)
Task 1: complete (commits d2c6b05..2a7e25a, review clean) — **214/214 绿**（真实用例 206 → 212 → 214；`npm test` 脚本已改成显式 glob，fixture 不再被当测试）

**R216 修正（实现者实测推翻了裁定的因果）**：Windows 上 Node 16/18/20 跑 `node --test "test/*.test.js"` 是 `Could not find` + **退出码 1（响亮失败）**，不会「退回收全目录」；「**0 条用例、退出码 0 静默全绿**」只在 **Node ≥21 且 glob 匹配 0 文件**时出现（v22 用 `test/*.zzz.js` 复现）。M1 的 207 来自当时脚本是**裸 `node --test`**（已用 `git show 308955d:package.json` 证实）。三分法已写进 README/package.json 注释。`engines: ">=21"` 仍是对的（16/18/20 上 `npm test` 一条也跑不了）。**复审已独立复现全部三条事实主张，判定修正成立。**

**任务 1 延后的 Minor（留最终整分支审查甄别）：**
- Task 1: minor (deferred): `README.md` 因果连接词不严——把 `engines>=21` 说得像能避开「0 匹配 glob 静默全绿」，而该形态**只在 ≥21 上存在**（避开它靠 glob 写对 + 计数核对，不是引擎下限）
- Task 1: minor (deferred): `test/scene.test.js` 的 `r.actual.roots === undefined` 今日恒真（截断信封永不含 `roots`），仅作形状护栏
- Task 1: minor (deferred): 写路径的截断现在统一成 `ULOOP_TRUNCATED`（`retryable:true`），对**已生效的 create** 重试会造重复节点 → 建议给写路径补「写入是否生效未知，先用 `scene tree` 复核」hint（既有 `ULOOP_NO_JSON` 同样 retryable，非回退）
- Task 1: minor (deferred): `lib/doctor.js` 的探活/`smoke` 仍直接读 `r.json`，未接入 `envelopeFromCall`（简报限定了接入范围）；截断的 `list` 探活仍产连接措辞
- Task 1: minor (deferred): `lib/doctor.js` 的 `DISPATCHER_HINT` 与 `dispatcherHint` 仍是两套近义文案（措辞不同、服务的检查不同）
- Task 1: minor (deferred): `lib/shot.js` 注释仍写「由 `fromUloop` 统一抬起 Message」（技术上成立，但该行上方现在调的是 `envelopeFromCall`）

## 进度总览

| 任务 | 状态 | 测试数 | 修复轮次 |
|---|---|---|---|
| 1 M2 必修批 A | ✅ complete | 214 | 1 |
| 2–13 | ⬜ 待执行 | — | — |

## 用户决策（2026-09-19，编排层）

- **C# port 与分支合并：一律等 M2 收尾再定。** M2 按现状（Node 外壳）继续执行到任务 13（含盲测）。
- M1 的 `m1-impl` 仍未合并（用户此前选「保持不动」）；`m2-impl` 从它分出。收尾时一并决定落法。
- 用户对 M2 的形态确认过三项：① 盲测游戏 = 极简霓虹打砖块 ② 美术 = 运行时纯色 sprite（不碰美术管线）③ 顺手清掉 M1 的「M2 必修」延后项。

## 交接备忘（新会话从这里继续）

- **下一任务 = 任务 2**（跨语言真值 tripwire + 退出码边界统一；硬依赖：任务 3/4 等它）。
- 起手：读本账本 → `scripts/task-brief docs/superpowers/plans/2026-09-19-pi-unity-m2-implementation.md 2` → 记 BASE（`git rev-parse HEAD` = `2a7e25a`）→ 派 implementer → `scripts/review-package <计划> <BASE> <HEAD>` → 规格/代码审查**分两次**派 → 修复循环（≤5 轮）→ 追加账本完成行。
- 技能脚本目录：`C:\Users\<用户>\.pi\agent\npm\node_modules\superpowers-zh\skills\subagent-driven-development\scripts\`
- 上游实证只在仓外：`C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp/`。
- 本 harness 偏差：`subagent` 无 model 参数；chain 只回传最后一位 → 审查者分两次派（R8）。
- `docs/PITFALLS.md` 新条目只追加不编号，编号由任务 13 统一（R213）。

Task 2: fix round 1/5 (5 addressed, 0 open — F1 **关键**：tripwire 正向断言因模板字面量 `\[` 被 cooked 成 `[` → 正则退化成字符类 → **恒真**（两位审查者各自跑 4-5 个变异均存活）；改为「一次集合相等」双向断言 + 3 个变异复核变红 / F2 `SKILL.md` 的 `scene tree` 行 `/2` 不可达 → `0 / 1` / F3 USAGE 一致性断言从整文件子串改为锚定单行 / F4 `Object.freeze(new Set())` 是假冻结 + `PATCH_KEYS` 是活数组（push 会放宽白名单，违 R104③）→ 改冻结数组 + 私有 Set + 补「真冻结」断言 / F5 `exitCodeFor` JSDoc 收窄 + 导出 `EXIT_USAGE=2` 替换 4 处裸魔法数; commits 87a5b66..f223f1f)
Task 2: complete (commits 2a7e25a..f223f1f, review clean) — **222/222 绿**（214 + 8），1 轮修复

**任务 2 的跨任务携带项（后续任务开工前必须知道）：**
- **R223**：`exitCodeFor` 的 `actual.match === false → 1` 分支**目前无生产产出点** → **任务 4（`unity pixels --expect`）必须接线**；若任务 4 砍掉该功能，**任务 13 必须删除该分支**（否则违铁律⑯「不许留表里有、实现从不产的死码」）。
- **计划文档滞后**：`docs/superpowers/plans/2026-09-19-pi-unity-m2-implementation.md` 的 `:185`（接口总表）、`:534`（标题）、`:611`（参考实现 `new Set([`）仍写「`USAGE_FAILURE_CODES`（冻结的 `Set`）」，而实现已改成**冻结数组 + 私有 `USAGE_SET`**（R221）→ **任何照抄计划参考实现的任务会写出 `.has()` → 运行时 TypeError**。任务 4/5 及之后的任务派发时必须带上这条修正（或由任务 13 统一回写计划）。
- **R203 的一处例外**：`bin/unity.js:5-6` 现在有了**顶层** `require('../lib/envelope.js')`（为取 `EXIT_USAGE` 常量），与计划明文「不改顶层导入面」冲突。行为无风险（envelope.js 无依赖/无循环），但**后续任务不得据此以为顶层可用 `emit`/`exitCodeFor`**——handler 仍需体内 require。

**任务 2 延后的 Minor：**
- Task 2: minor (deferred): `test/scene.test.js` 的 USAGE 断言仍是**源文本**匹配（把该行挪进注释/字符串仍绿）→ 更硬写法是用已有的 `captureStdout` 断言 `main(['--help'])` 的真实输出
- Task 2: minor (deferred): `bin/unity.js` 的 USAGE 写「2 = 参数缺失」，而 `MISSING_PROJECT_PATH` 不在冻结码表内 → `unity scene tree`（无 `--project-path`）实际落 1；要不要把它纳入用法错码会动冻结码表，留待最终审查裁定
  - 订正（2026-09-20 R477，批次 A）：`MISSING_PROJECT_PATH` 已改为 **2 档**（已纳入冻结用法错码表），`bin/unity.js` 的 USAGE 图例同步，见 `docs/HANDOFF.md` §7⑪。
- Task 2: minor (deferred): `USAGE_FAILURE_CODES` 的 28 码里 18 个当前无产出点（属计划冻结的跨任务接口，不算死码，但需在任务 13 对账）

## 进度总览（更新）

| 任务 | 状态 | 测试数 | 修复轮次 |
|---|---|---|---|
| 1 M2 必修批 A | ✅ complete | 214 | 1 |
| 2 tripwire + 退出码统一 | ✅ complete | 222 | 1 |
| 3 `unity node delete` | ⬜ 待执行（下一任务） | — | — |
| 4–13 | ⬜ 待执行 | — | — |

Task 3: 首轮审查（spec ✅ 通过 / code ✅ 通过带 3 条重要）→ 修复循环第 1 轮

- R224 — code-reviewer 重要①：`lib/scene.js` 的「读回**落其它失败码** → `READBACK_FAILED`」分支**零测试防线**——把 `if (read.code === 'NOT_FOUND')` 改成 `if (true)`（等价于让该分支不可达、任何读回失败都被当成功），7 条新用例**全部通过**。生产可达（编辑器中途掉线），且任务 9/10 会依赖它。
  Ruling：补 1 条用例钉住该分支（读回返回 `Success:false` → 断言 `code==='READBACK_FAILED'`、`phase==='readback'`、`intent` 形状）。
  如果错了：代价是一条断言；不做则删除命令最危险的分支无护栏。
- R225 — code-reviewer 重要②：`lib/scene.js` 在读回结果里**只取 `.path`**，`.cs` 没回报 `path` 时**静默回落到调用方入参**，且 `__deleted` **从未被校验** → 协议不符的响应（未来改 `.cs`、`--code-file` 指错脚本）会产出**无证据的 `verified:true` / `deleted:true`**（违反 R51「宁可 falsely-fail，绝不静默假绿」）。该行是简报逐字给的。
  Ruling：**收口**——`res.parsed.__deleted !== true || typeof res.parsed.path !== 'string' || res.parsed.path === ''` → `fail({code:'BAD_SCRIPT_RESULT', ...})`（该码不在用法错表 → 退出码 1，方向安全）+ 补 1 条单测（`{__deleted:true}` 无 `path` → `BAD_SCRIPT_RESULT`）。
  如果错了：代价是 1 行 + 1 条断言；收益是删除命令不再可能凭「入参」自称成功。
- R226 — code-reviewer 重要③：`verified:false` 的分歧条目 `intent:null` 与**同一信封**的 `intent`（`{path, absent:true}`）自相矛盾：下游读到的是「想要 path=X，实际 path=X」却 `verified:false`；而成功分支的 `intent:null` 又与 create/set（一律带 intent）不一致。
  Ruling：**统一成「一条规则、零手写分歧」**——delete 的 intent 一律表达为 **`{ path: null }`**（语义 = 该路径理应不存在），成功与失败信封都带它；这样 `verified:false` 的那条分歧恰好是 `compareSubset({path:null}, actual)` 的**真产物**，不再手写 `{key:'path', intent:null, actual:...}`。同步改相关断言。
  如果错了：代价是 intent 形状变化（1 行 + 断言），但换来与 create/set 一致的跨命令不变量。
- R227 — 五条次要一并修：① `verified:false` 的 hint 补「路径按名字拼接、不保证唯一——若存在同名兄弟，被删的可能不是本次想要的那个，先 `scene tree` 核对」（删除不可逆，这是第一批证据）；② `SKILL.md` 的表头「**M1 已交付的命令**」→「**已交付的命令**」（表内已含 M2 的 `node delete`，而紧邻段落还写「M1 还没有」）；③ `docs/PITFALLS.md` 新增条目的标题不要以 `U` 开头（R213 要求不写编号，`## U（…）` 会被当编号前缀），改成陈述式并注明「本条非判据失败记录，是任务 3 真机清理阶段的副产物」（是否保留交任务 13）；④ `test/scene.test.js` 里用例名承诺「不冒成退出码 3」但正文未断言退出码 → 补 `exitCodeOf(e) === 1`；⑤ `node-delete.cs` 的注释与 skill §5 口径对齐（「删**用户既有内容**前先问」，不是「删之前都先问」）。
- 【登记不改】code-reviewer 范围外：`README.md` 的命令表/测试数（214→229）/「尚未实现」段、`node-delete.cs` 的 `BAD_REQUEST` 分支在 CLI 下不可达（契约明列的防御分支）、`PITFALLS.md` 索引与编号 → 全部归**任务 13** 定稿。


Task 3: fix round 1/5 (3 重要 + 5 次要 全部 addressed, 0 open；定向复审：R228 可接受、无新破坏) — F1 补「读回其它失败码 → READBACK_FAILED」用例（变异复核：改 `if (true)` 时 71/72 仅新用例红）/ F2 校验 `__deleted===true` + `path` 非空串 → `BAD_SCRIPT_RESULT`（堵住「静默回落调用方入参」的无证据 verified:true）/ F3 intent 统一 `{path:null}`，`verified:false` 的分歧改 `compareSubset` 真产物（全库无 `absent` 残留）/ F4 五条（hint 同名兄弟、SKILL 表头去 M1、PITFALLS 去 U 标题、退出码断言、`.cs` 注释口径）; commits d2c34ad..8a8d816
Task 3: complete (commits f223f1f..8a8d816, review clean) — **231/231 绿**（222 + 7 + 2），1 轮修复

- R228（**接受为已知不一致，登记延后**）：delete 的 `.cs` 报错/传输层失败信封经 spread 带了 `intent:{path:null}`，而 create/set 同类失败信封是 `intent:null`。裁定接受——失败信封携带「我本来想要什么」信息量更大，且 `ok`/`verified`/`code`/`phase`/`retryable`/`actual`/退出码全不受影响（`exitCodeFor` 只读 `ok`/`verified`/`actual.match`/`code`）；`emit` 人读路径不渲染 `intent`。复审判定：**可接受**（纯增量 + 已文档化）。
  如果错了：代价是同一类失败信封的 `intent` 形状跨命令不一致（任务 13 或最终审查可统一）。

**任务 3 延后的 Minor（含一条要带给任务 10 的覆盖缺口）：**
- Task 3: minor (deferred) ⚠️ **带给任务 10**：`lib/scene.js` 的 **`__deleted !== true` 子句零测试防线**——把守卫放宽成 `if (typeof res.parsed.path !== 'string' || res.parsed.path === '')`，`test/scene.test.js` **72/72 全绿**，而同一输入会产出 `{ok:true, verified:true, actual:{path:'B',deleted:true}}` 的**无证据假绿**（正是 F2 要堵的形态）。建议补 1 条：写结果 `{"path":"B"}`（缺 `__deleted`）→ 断言 `code==='BAD_SCRIPT_RESULT'`、`ok:false`、`intent:{path:null}`、`exitCodeOf===1`。任务 10 的 smoke 写-读回-删自闭环会用到 `node delete`，在那里补最自然。
- Task 3: minor (deferred): F3 的「`compareSubset` 真产物」无**判别性**测试（换回手写条目整套仍绿，因读回 `actual.path === deletedPath` 时两者输出逐字相同）→ 建议加一条「写报 `path:'B'` 而读回对象 `path:'Canvas/B'`（同名兄弟/裸名错位）」的用例钉死。
- Task 3: minor (deferred): `lib/scene.js` 的 `if (!envl.ok) return { ...envl, intent }`（delete 传输层失败）无测试覆盖（改动前既有缺口），使 R228 的不一致只在 `.cs` 报错侧被钉住。
- Task 3: minor (deferred): `docs/PITFALLS.md` 新增条目仍未进索引表（U1–U15 都在表内）→ 任务 13 收口；另 `skills/unity-game-dev/SKILL.md` 仍有「超出 M1 范围」的里程碑口径残留。
- Task 3: minor (deferred): `README.md` 的命令表/测试数/「尚未实现」段、`node-delete.cs` 的 `BAD_REQUEST` 分支在 CLI 下不可达（契约明列的防御分支）→ 归任务 13 定稿。

## 进度总览（更新）

| 任务 | 状态 | 测试数 | 修复轮次 |
|---|---|---|---|
| 1 M2 必修批 A | ✅ complete | 214 | 1 |
| 2 tripwire + 退出码统一 | ✅ complete | 222 | 1 |
| 3 `unity node delete` | ✅ complete | 231 | 1 |
| 4 像素判定（color/png/pixels） | ⬜ 待执行（**下一任务**） | — | — |
| 5–13 | ⬜ 待执行 | — | — |

**下一任务（4）开工前必须带上的三条携带项**：① **R223**：`exitCodeFor` 的 `actual.match === false → 1` 分支**目前无产出点** → 任务 4（`unity pixels --expect`）**必须接线**（砍掉则任务 13 删分支）；② 计划文档 3 处仍写 `USAGE_FAILURE_CODES` 是「冻结的 `Set`」，实现已是**冻结数组**（用 `includes`/`isUsageFailure`，**不得** `.has()`）；③ `bin/unity.js` 顶层只有一个取 `EXIT_USAGE` 的 envelope import，handler 仍需**体内** require（不得以为顶层有 `emit`/`exitCodeFor`）。

## 任务 4（像素判定）起飞前裁定（控制者，2026-09-19 续）

BASE = `8a8d816`（`git rev-parse HEAD`，分支 `m2-impl`，231/231 绿）。简报：`task-4-brief.md`（765 行，由 `scripts/task-brief` 抽取）。

- **R229** — **R223 的接线点确认**：`lib/envelope.js:103` 已有 `actual.match === false → 1` 分支，此前无产出点。任务 4 的 `unity pixels --expect` 不匹配时产 `ok:true` + `actual.match:false` → 该分支**本任务首次被真实产出**。同时核对：简报要用的用法错码 `MISSING_FILE`/`BAD_AT`/`BAD_REGION`/`BAD_EXPECT`/`BAD_TOLERANCE`/`BAD_COLOR` **已全部在冻结表 `USAGE_FAILURE_CODES` 内**（`lib/envelope.js:71-76`），`BAD_PNG`/`FILE_NOT_FOUND` 不在表内 → 运行时码，退出码 1 —— **本任务不需要改 `lib/envelope.js`**。
  如果错了：代价是退出码分档与全局约束 16 不符（审查可检出）。
- **R230** — **简报步 4 的「总数应为 248」是过期数字**：它按 M1 的 227 基线写的，实际基线是 **231**（任务 1-3 已加 25 条）。裁定：预期总数 = **231 + 21 = 252**，实际以 `npm test` 为准；计数不得减少（全局约束 21）。
  如果错了：代价为零（只是报告里的一个期望值）。
- **R231** — **`test/helpers/capture.js` 的抽取范围按「三处」执行**：简报「文件」行只写了 `test/doctor.test.js` / `test/shot.test.js`，但同段明确说「把 scene/doctor/shot 三处各自本地的…抽到新文件」，且步 6 的 `git add` 含 `test/scene.test.js`。裁定：三个文件都抽、都删本地副本、都从 `./helpers/capture.js` import（函数体逐字照搬 `test/scene.test.js` 的版本，含非字符串 chunk 原样转发）。已核对：三处 `captureStdout` 函数体行为一致（doctor 的 JSDoc 更长，属注释差异）。
  如果错了：代价是 doctor/shot 少抽一处 → 仓库留重复，审查可检出。
- **R232** — **两处计划笔误，照抄即可、不影响行为**：① `makePng` 里 `ihdr.writeUInt32BE(width,0)` / `(height,4)` 各写了两遍（同一个 13 字节 IHDR，重复写同值无副作用）；② `decodePng 能解自造的 filter 0–4 小图` 的注释写「24x1 的三行图」而实参是 `width:4,height:3`。**不许**为此改断言或实现。
  如果错了：代价为零。
- **R233** — **fixture 已核实**：源文件 `C:/Users/<用户>/pi-unity-spike/shots/游戏_20260919_012315_061.png` 存在，`sha256 = 2621ba6cff6684ff504447cff83fb940d1db7849923ccc115a4b7a4382f0702b`，与简报期望一致。`.gitignore` 不排除 PNG → 可入库。
  如果错了：代价为零。
- **携带项（任务 2/3 遗留，派发时已带上）**：① 顶层的 `bin/unity.js` 只有取 `EXIT_USAGE` 的 envelope import，新 handler 一律**体内 require**（R203）；② `USAGE_FAILURE_CODES` 是**冻结数组** + `isUsageFailure()`，不得 `.has()`（R221）；③ `EXPECT_MISMATCH` 已从接口表删除（R206），不匹配只走 `ok:true`+`match:false`+退出码 1。
- 本 harness 无 `model` 参数（延续 M1/M2 已登记偏差），实现者用 global `implementer`。

Task 4 首轮实现（DONE_WITH_CONCERNS，commit `41a77c5`，252/252 绿）—— 控制者对三条疑虑的裁定：

- **R234（接受偏离）** — 简报 `test/pixels.test.js` 声明 `const readFile = ...` 而调用点全用 `_readFile` → 照抄会 8 条 `ReferenceError`。实现者改名为 `_readFile`（注入语义不变）是对的：这是简报笔误，不是违规。R232 漏列了这条。
  如果错了：代价为零（重命名只影响测试内部）。
- **R235（审查前处理，范围缺口）** — 实现者指出：`test/png.test.js` 的用例标题声称覆盖「灰阶/带 alpha 色彩类型」，但自造图只有 `colorType:6`、fixture 是 `colorType:2` → **`lib/png.js` 的 colorType 0（灰）/4（灰+alpha）分支零覆盖**，而**全局约束 23 明确要求支持 0/2/4/6**。裁定：**补 2 条测试**（colorType 0 与 4，经测试本地 `makePng` 扩展支持 1/2 通道；仍与被测解码器零共享代码），断言灰度三通道取同值、alpha 通道正确。总数预期 252 → **254**（以实际为准）。
  如果错了：代价是 2 条测试 + 测试本地 helper 的几行扩展；不做则约束 23 有一条无护栏分支。
- **R236（延后 Minor）** — `MISSING_FILE` 信封的 `actual` 在 JSON 里是 `{}`（`{file: undefined}` 的键被 `JSON.stringify` 丢弃）。是简报原样代码，退出码/`code` 不受影响 → 登记延后，交最终审查甄别。
  如果错了：代价为零。

Task 4 首轮审查（spec ✅ 通过 / code ✅ 通过带 **1 条重要** + 6 条次要）→ 修复循环第 1 轮

- **控制者自行解决两条 ⚠️（spec 审查者无法从 diff 核实）**：① fixture sha256 = `2621ba6c…702b` 已用 `sha256sum` 复核，与简报期望一致；② 滤镜直方图 `{1:5, 2:322, 4:28}` 已用独立 `node -e` 脚本从 fixture 重算，与报告 §3.6 逐字一致（`IHDR 892x355 bd8 ct2 il0`、`raw=950335`）。两条均**核实成立**，不构成缺口。
- **R237（重要①，裁定：修）** — code-reviewer：`lib/pixels.js` 的用法错校验被 I/O 掩盖 —— `--count-color`(:84) / `--at`(:99) / `--region`(:121) / `--expect`(:143) 的**格式**校验排在 `:59` 读盘 + `:73` 解码之后，导致 `--file <不存在> --at 446` 落 `FILE_NOT_FOUND`(1) 而同一 argv 在文件存在时落 `BAD_AT`(2)。这是一个**真实缺陷**，不是可争议项：全局约束 16 规定「2 = 用法错」，而用法错必须**只由 argv 决定**、不随环境漂移；计划自己把 `MISSING_FILE`/`BAD_TOLERANCE` 放在 I/O 前，已表明这个意图。裁定：**两段式**——纯语法校验（`parsePair` 的格式部分、`parseHexColor`、`--expect` 缺少取样点）提到读盘之前；需要 `img.width/height` 的**范围**校验留在解码后。必须补 1 条判别性用例：`pixels({file:'C:/nope/missing.png', at:'446'})` → `BAD_AT`(2)、**不得**落 `FILE_NOT_FOUND`。
  如果错了：代价是 ~10 行重排 + 1 条断言（现有断言全部沿用存在的 fixture，语义不变）。
- **R238（次要①，裁定：修 —— 与 R235 同一取向）** — code-reviewer：约束 23 的「不支持的一律响亮抛错」在 `lib/png.js` 有 5 条 guard（bitDepth≠8 / interlace≠0 / 缺 IDAT / 数据长度不足 / 滤镜字节>4）**零用例**——删掉任一条测试仍全绿。这与 R235 是同一个问题（约束 23 的分支无护栏），故一并补：1 条表驱动 `assert.throws` 覆盖 5 条 guard（在 `makePng` 产物上打补丁：`IHDR[8]=16` / `IHDR[12]=1` / 去掉 IDAT / 首行滤镜字节改 9 / 截断 Buffer）。同时补 1 行 guard：**零尺寸 PNG**（`width/height` 必须 > 0）也抛 `Error`（PNG 规范禁止 0 尺寸，且现会静默 `ok:true` + `ratio=NaN`）。
  如果错了：代价是 1 条表驱动用例 + 1 行 guard；不做则约束 23 的响亮失败面有 5 条无护栏分支。
- **R239（次要②，裁定：改文档，不改语义）** — code-reviewer：`--expect '#RRGGBBAA'` 的 alpha 被静默丢弃（`maxChannelDistance`/`formatHex` 只看 r/g/b，`actual.expected` 回显时 alpha 消失）。`parseHexColor` 的 8 位接受面是跨命令共享契约，**不改**；裁定在 USAGE 的 `--expect` 行与 `--count-color` 行**写明**：① `--expect` 只比较 r/g/b，alpha 不参与；② `--count-color` 命中 0 像素**不影响退出码**（仍 0），「看得见」判据必须用 `--expect`。
  如果错了：代价为零（纯文档）。
- **登记延后（Minor，不进循环，交最终整分支审查甄别）**：
  - Task 4: minor (deferred): USAGE 的 `pixels 选项` 段缩进由简报 4 空格改为 2 空格（与同文件既有风格一致）——纯排版。
  - Task 4: minor (deferred): 报告 §6 把「代码已处理」与「已有断言」混列（R238 会补上断言，措辞仍需在任务 13 对账）。
  - Task 4: minor (deferred): 报告 §1/§7.2 的「21 → 252」是补测前快照，§9.2 的 254 才是最终值（报告文字层面）。
  - Task 4: minor (deferred): `lib/png.js` 的 chunk 遍历不校验 `len` 边界与 CRC；签名正确但被截断的文件会抛 `RangeError` 而非描述性 `Error`（CLI 路径仍收敛为 `BAD_PNG`，口径不受影响）。
  - Task 4: minor (deferred): `test/png.test.js` 里 IHDR width/height 连写两遍（简报草稿死代码）+ `.filter((_, i, arr)=>…)` 的 `arr` 未使用 —— R232 裁定「照抄不修」，登记待最终审查。
  - Task 4: minor (deferred): `README.md:41` 与 `skills/unity-game-dev/SKILL.md:22` 的命令表未登记 `pixels`（简报文件清单不含它们）→ 归任务 11/13。
- 本 harness 无 `model` 参数（延续已登记偏差）；R237/R238 的修复由**全新** implementer 带简报 + 报告 + 本清单执行（无法唤回已结束的实现者会话）。

Task 4: fix round 1/5 (3 addressed, 0 open — F1 用法错前置（`:59-105` 纯 argv 校验在读盘 `:110` 之前，实跑 reads=0）/ F2a 5 条 guard 表驱动（in-memory 变异逐条确认会红）/ F2b 零尺寸 guard 在分配之前 / F3 USAGE 两处口径；不许动清单零触碰; commits 216ddee..5c6e0b4)
Task 4: complete (commits 8a8d816..5c6e0b4, review clean) — **257/257 绿**（231 基线 + 26：color 4 / png 11 / pixels 11）

**任务 4 新增的延后 Minor（交最终整分支审查甄别）：**
- Task 4: minor (deferred) 💡：`lib/pixels.js:168` 的 `actual.at ? actual.at.color : actual.region.color` 依赖第一段不变量（给了 `--expect` 必有 `--at`/`--region` 且越界者已提前返回）；当前四条到达路径穷举后不可能命中 `undefined.color`，仅将来改赋值才脆。
- Task 4: minor (deferred) 💡：表驱动里「缺 IDAT」一行靠 message 正则变红（zlib 仍抛但文案不匹配），强度略低于其余四行（其余为 NO-THROW）。
- （此前已登记：USAGE 缩进、报告 §6 措辞、报告计数快照、chunk 边界/CRC 未校验、IHDR 连写两遍 + 未用 `arr`、README/SKILL 命令表未登记 `pixels`。）

## 进度总览（更新）

| 任务 | 状态 | 测试数 | 修复轮次 |
|---|---|---|---|
| 1 M2 必修批 A | ✅ complete | 214 | 1 |
| 2 tripwire + 退出码统一 | ✅ complete | 222 | 1 |
| 3 `unity node delete` | ✅ complete | 231 | 1 |
| 4 像素判定（color/png/pixels） | ✅ complete | 257 | 1 |
| 5 `unity sprite set` | ⬜ 待执行（**下一任务**） | — | — |
| 6–13 | ⬜ 待执行 | — | — |

**下一任务（5）开工前必须带上的携带项**：① 任务 4 已把 `exitCodeFor` 的 `actual.match === false → 1` 分支接入（R223 关闭），任务 5 若也用 `actual.match` 走同一口径；② `USAGE_FAILURE_CODES` 是**冻结数组**（`includes` / `isUsageFailure`，不得 `.has()`）；③ 新 handler 一律**体内** require（顶层只有取 `EXIT_USAGE` 的 envelope import）；④ `lib/color.js` 已存在且被 `pixels`/后续 `sprite set` 共用（`parseHexColor` 接受 `#RGB/#RRGGBB/#RRGGBBAA`，比较只用 r/g/b）；⑤ `test/helpers/capture.js` 已存在（`captureStdout`/`captureStderr`），新测试直接 import，**不要**再复制；⑥ 真机验证用 `S0Project`，用户真实工程一律不许碰。

## 任务 5（`unity sprite set`）起飞前裁定（控制者）

BASE = `5c6e0b4`（257/257 绿）。简报：`task-5-brief.md`（534 行）。**真机环境已由控制者预先拉起**：`Tuanjie.exe -projectPath S0Project` 已启动并编译完，`PI_UNITY_ULOOP_BIN=C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe`、`PI_UNITY_EDITOR_BIN=<引擎安装目录>/2022.3.62t9/Editor/Tuanjie.exe`，`unity doctor` 5 项全 OK（`editor-connection uloop 3.4.0 已连接`）——实现者可直接做步骤 5。

- **R240** — 简报步 4 的「总数应为 258」是过期数字（按 248 基线写的）。实际基线 **257**，预期 = 257 + 10 = **267**；以 `npm test` 为准，**只增不减**。
  如果错了：代价为零。
- **R241** — 简报步 5 的 `md5sum … > /tmp/before.md5` 里的 `/tmp` 按 R212 纪律改到**仓库内**工作区临时目录：`.superpowers/sdd/2026-09-19-pi-unity-m2-implementation/tmp/`（该目录被 gitignore，已由控制者创建）。报告里贴出的 `diff` 证据不变。
  如果错了：代价为零。
- **R242** — 步骤 5 的真机循环**允许适度迭代**：简报里的 `--region 420,160,60,40` 是**起始猜测**（窗口模式下截图含 Game 视图工具栏，位置随窗口尺寸变）。正确做法：先用 `--count-color '#FF2E88' --tolerance 16` 确认颜色存在及其占比，再用 `read` 打开 PNG 目视定位色块，然后选一个**完全落在色块内部**的 `--region` 去跑 `--expect`。判据 3 的 `exit=0` 必须真拿到；**不许**把没命中写成通过（简报已写明，控制者重申）。
  如果错了：代价为零（只是多几条真机命令）。
- **R243（计划缺陷，裁定：删死码）** — 简报给 `lib/sprite.js` 的 `const path = require('node:path')` + `const SCRIPTS_DIR = …` + 导出 `SCRIPTS_DIR` **全文件无任何使用**（`buildPayloadArgs` 自带 `scriptsDir` 默认值，`--code-file` 的路径由它拼）。任务 1 的主题恰是「死码」，不许新引入。裁定：**不保留**这两个绑定与导出；若实现者发现确有用途，则保留并在报告说明。
  如果错了：代价为零（纯删除）。
- **R244（先说明，避免误报）** — `lib/scene.js` 的 `nodeInspect` **已有**一份 `NOT_FOUND` 的 `describeError`，与新增的 `parseNodeResult` 文案高度重合。简报只要求**追加** `parseNodeResult`、**不要求**改造 `nodeInspect`。裁定：本任务**只追加**，不改 `nodeInspect`（改造会动 M1 的既有断言语义）；重合登记为延后 Minor，交最终审查甄别。
  如果错了：代价是仓库里两份近义文案（已在 M2 起飞前扫描中登记为既有现象）。

Task 5 首轮审查（spec ✅ 通过 / code ✅ 通过带 **1 条重要** + 若干次要）→ 修复循环第 1 轮

- **控制者自行解决 spec 审查者的 ⚠️（verify.log 缺 `pixels` 两条命令）**：对既有截图 `C:/Users/<用户>/pi-unity-spike/m2-shots/游戏_20260919_113956_671.png` 独立重跑 —— `--count-color '#FF2E88' --tolerance 16` → `count=40000` / `ratio=0.12631844880944862` / exit 0；`--region 420,160,60,40 --expect '#FF2E88' --tolerance 16` → `match:true` / `distance:0` / exit 0。**判据 3/4 独立复现成立**，不构成缺口。
- **R245（重要①，裁定：修）** — code-reviewer：`lib/sprite.js:87-122` 重抄了一份 `lib/scene.js:409` 的 `readBackAndVerify`（~30 行：`verifyWrite` + `err.envelope` + `READBACK_FAILED` + `ok(...)` 组装）。裁定：**收口成单一真值** —— 把 `readBackAndVerify` 加进 `lib/scene.js` 的 `module.exports`，并给它加一个**可选**形参承载「不一致」时的 hint（默认值必须**逐字**保持 `lib/scene.js:451-453` 的现有 nodeSet/nodeCreate 文案，否则会动 M1 断言），`lib/sprite.js` 改为调用它并传自己的 `residue`（HideAndDontSave 那段）与自定义 mismatch hint。项目已有同类先例（删 `isPlainObject` 本地副本、冻结 `USAGE_FAILURE_CODES`）。
  如果错了：代价是动到 M1 的共享 helper（有 268 条测试 + 全量 `npm test` 兜底）；不做则 `READBACK_FAILED` 的口径有两处真值，改一处不改另一处。
- **R246（次要②，两位审查者各自独立提出 → 提级为本轮必修）** — 约束 18 的「**回读字段名成对**」只做了一半：`test/sprite.test.js:179` 的正则 `Math\.Round\(sr\.color\.[rgb] \* 255f\)` 是**字符类**，只需命中一个通道；把 `unity-scripts/node-inspect.cs` 的 `["a"]` 行删掉，268 条**全绿**，而 CLI 路径的 intent **恒带 `a`**（`lib/color.js` 对 3/6 位 hex 也返回 `a:255`）→ 每次 `sprite set` 都会 `verified:false`。裁定：① 把读回侧颜色通道改成**集合相等**断言 `['a','b','g','r']`；② 修正 alpha 用例——现在它给的读回 `a=255` 而意图 `a=128`（实际是 `verified:false` 却无人断言），改成读回与意图 `a` 一致并断言 `verified:true`，把 8bit alpha 往返钉死。
  如果错了：代价是 1 条断言重写；不做则一个真实字段可被静默删掉。
- **R247（次要③，裁定：修 —— 与 R237 同类）** — `lib/sprite.js:49` 只校验 `Number.isInteger`，**未校验 int32 范围**：`--sorting-order 3000000000` 穿过守卫，在 `sprite-set.cs` 的 `(int)` 转换上抛异常（`AddComponent` 之后、写色之前）→ 落成 uloop 层运行时错（退出码 1），而不是 `BAD_SORTING_ORDER`（退出码 2）。这与 R237「用法错必须只由 argv 决定」是同一条铁律。裁定：加 int32 范围校验（`-2147483648 … 2147483647`），message/hint 写明取值范围。
  如果错了：代价是 1 个条件 + 断言；不做则 `BAD_SORTING_ORDER` 名不副实。
- **R248（次要④，裁定：修）** — 两条错误路径 0 覆盖：`WRITE_CALL_FAILED`（`_call` reject → `phase:'write'`、退出码 1）与 `READBACK_FAILED`（读回那次调用失败 → `phase:'readback'`、退出码 1、且 sprite 的 HideAndDontSave residue hint 仍在）；加上 `sortingOrder` **合法值**路径（`spriteSet({sortingOrder: 5})` → intent 与 payload 都带它）。补 3 条。
  如果错了：代价是 3 条测试；不做则本任务 ~40 行错误处理无护栏。
- **R249（次要⑤，裁定：修）** — `test/sprite.test.js:132-134` 的 `main(['sprite','bogus','--json'])` 只用 `captureStdout`，usage 行漏到 runner stderr（测试输出不干净）。改用 `captureStderr`（`test/helpers/capture.js` 已提供，`test/scene.test.js` 有既有范式）。
- **R250（次要⑥，裁定：只改文案，不改契约）** — 三处措辞：① `bin/unity.js` 命令列表「写后读回：颜色/排序**层**」→「颜色/sortingOrder」（`sortingLayerName` 只在读回面、永不在 intent，本命令没有 `--sorting-layer`）；② USAGE「基础 sprite 是 1x1 世界单位，所以 localScale = 世界尺寸」**加上限定**「仅对本命令新建的 sprite 成立；节点原本已有 sprite 资产时尺寸由该资产的 PPU 决定」；③ `test/sprite.test.js` 那条「8 位 hex 才带 a」的用例名与 CLI 实际（恒带 a，缺省 255）对齐。
  **不加** `node-inspect.cs` 的 `pixelsPerUnit` 读回字段（additive 但当前无消费者，YAGNI；任务 11 若需要再加）。
  如果错了：代价为零。
- **R251（次要⑦，裁定：收成模块私有）** — `lib/sprite.js` 导出 `isValidColor` 但全仓库无外部消费者（测试只 import `spriteSet`），与 R243「无用途的导出就删」同源。裁定：从 `module.exports` 移除（函数体保留，`spriteSet` 内部仍用）。
  如果错了：代价为零。
- **登记延后（Minor，不进循环）**：
  - Task 5: minor (deferred)：`lib/scene.js` 的 `parseNodeResult` 把 `label` 硬编码成 `'sprite-set'`（当前唯一调用方就是 sprite.js，文案全部正确）→ 等第三个调用方出现时提成形参。⭐ 两位审查者都判为**次要**（只影响诊断文本，不影响退出码/数据）。
  - Task 5: minor (deferred)：运行时创建的 `Texture2D`/`Sprite` 只有 `HideAndDontSave`、无销毁路径 → 同一编辑会话内 `delete → create → sprite set` 每轮泄漏一张 1×1 纹理（字节量可忽略，域重载回收）；属决策四固有代价。
  - Task 5: minor (deferred)：`docs/PITFALLS.md` 的错帧条目（首张截图整块 `#00FFFF`，未复现）——code-reviewer 判定「本任务范围内没有有证据的代码护栏」，建议把「`--count-color` 报 0 就再截一张」落到**任务 11 的验证配方**里（有代码侧落点）。⭐ **携带给任务 11**。
  - Task 5: minor (deferred)：`docs/PITFALLS.md` 新条目未编号（R213，任务 13 统一）。
  - Task 5: minor (deferred)：`lib/sprite.js` 的 `verified` 由 `r.mismatches.length === 0` 自算而非取 `verifyWrite` 的 `verified` 字段（两者严格等价，纯风格）——R245 收口后会消失。
- 本 harness 无 `model` 参数；修复由**全新** implementer 带简报 + 报告 + 本清单执行。

Task 5: fix round 1/5 (F1–F7 + 不许动清单 11 项全部 ADDRESSED，0 open; commits 3f1ba4a..ce32137)
Task 5: complete (commits 5c6e0b4..ce32137, review clean) — **271/271 绿**（268 + 3）

**任务 5 新增的延后 Minor（交最终整分支审查甄别）：**
- Task 5: minor (deferred) 💡：`lib/sprite.js:109` 的 `mismatchHint`（sprite 专属「检查该节点是否真有 SpriteRenderer…」）**无断言** —— 删掉整行 271 条仍全绿。修法一行：在「颜色不一致 → verified:false」用例里加 `assert.ok(e.hint[0].includes('SpriteRenderer'))`。
- Task 5: minor (deferred) 💡：F1 收口后 `READBACK_FAILED` 且 `read.hint` 为空时的兜底文案由「…复核**该节点**」变成共享默认「…复核」（丢三字）。复审判定：**不算回归**（指向的动作正确、机器可读字段全同、F4② 已把真正有差异的 residue 钉住）。可选修法：让兜底文案带上 `readPath` 实例信息。
- Task 5: minor (deferred)：`lib/scene.js` 的 `parseNodeResult` 把 `label` 硬编码成 `'sprite-set'`（当前唯一调用方正确；第三个调用方出现时提成形参）。
- Task 5: minor (deferred)：运行时 `Texture2D`/`Sprite` 只有 `HideAndDontSave`、无销毁路径（同一编辑会话内 delete→create→sprite set 每轮泄漏一张 1×1 纹理，字节量可忽略）。
- Task 5: minor (deferred)：`docs/PITFALLS.md` 首张截图 `#00FFFF` 错帧条目未编号（R213 → 任务 13）。
- ⭐ **携带给任务 11（重要，复审范围外发现）**：计划 `docs/superpowers/plans/2026-09-19-pi-unity-m2-implementation.md:5251-5258` 的 tripwire 用 `fs.readFileSync('lib/sprite.js')` 去断言 `/new Rect\(0, 0, 1, 1\)/` 与 `/, 1f\)/`，但这两个字符串实际位于 **`unity-scripts/sprite-set.cs:46`**（`lib/sprite.js` 全文不含 `Rect`/`1f`）→ **照抄计划会假红**。任务 11 派发时必须改指 `sprite-set.cs`。
- ⭐ **携带给任务 11（来自 code-reviewer 的护栏建议）**：`docs/PITFALLS.md` 的错帧条目建议把「`--count-color` 报 0 就再截一张」写进**任务 11 的验证配方**（有代码侧落点）。

## 进度总览（更新）

| 任务 | 状态 | 测试数 | 修复轮次 |
|---|---|---|---|
| 1 M2 必修批 A | ✅ complete | 214 | 1 |
| 2 tripwire + 退出码统一 | ✅ complete | 222 | 1 |
| 3 `unity node delete` | ✅ complete | 231 | 1 |
| 4 像素判定（color/png/pixels） | ✅ complete | 257 | 1 |
| 5 `unity sprite set` | ✅ complete | 271 | 1 |
| 6 `shot --capture-mode/--match-mode` 接线 + 坐标元数据 | ⬜ 待执行（**下一任务**） | — | — |
| 7–13 | ⬜ 待执行 | — | — |

**下一任务（6）开工前必须带上的携带项**：① **C3/R204**：任务 6 **必须同时清理三处「未接线」文本**——`lib/shot.js` 的 hint 出路②③、`skills/unity-game-dev/SKILL.md` 的对应行、`test/shot.test.js` 里那条断言（断言的正是「必须写未接线」），否则仓库自相矛盾且 T12 盲测判据 2 会失败；② `readBackAndVerify` 已从 `lib/scene.js` 导出（`{projectPath, env, callFn, readPath, intent, extraCheck, residue, mismatchHint}`），后续写命令直接复用；③ `exitCodeFor` 的 `actual.match === false → 1` 分支已接入（任务 4）；④ `USAGE_FAILURE_CODES` 是冻结数组（`includes`/`isUsageFailure`，不得 `.has()`）；⑤ 新 handler 一律体内 require；⑥ `test/helpers/capture.js` 已存在；⑦ 真机用 `S0Project`（编辑器仍在运行），用户真实工程不许碰；⑧ `lib/color.js`/`lib/png.js`/`lib/pixels.js` 已交付可复用。

## 任务 6（`shot --capture-mode` / `--match-mode` 接线 + 坐标元数据）起飞前裁定（控制者）

BASE = `ce32137`（271/271 绿）。简报：`task-6-brief.md`（329 行）。编辑器仍在运行，`doctor` 绿。

- **R252** — 简报步 4 的「总数应为 264」是过期数字（按 258 基线写的）。实际基线 **271**；预期 = 271 + 6 = **277**（步 1 新增 6 条 + R204③ 是**改写**既有 1 条、不增数）。以 `npm test` 为准，**只增不减**。
  如果错了：代价为零。
- **R253（计划缺陷，裁定：改注入值）** — 简报两条新用例把 `appData: enAppData()` 与期望 `windowName: '游戏'` 写在一起，但 `enAppData()`（`test/shot.test.js:89`）造的是**没有语言配置**的目录 → `language()` 回落 `en_US` → `windowNameFor('Game','en_US') === 'Game'`，**不是**「游戏」。裁定：凡期望 `'游戏'` 的用例改用 `zhAppData()`（或把期望改成 `'Game'`，保持断言意图即可）。不许为了让断言过而改 `windowNameFor`/`language` 的语义。
  如果错了：代价是 2 条用例的注入值（不改生产行为）。
- **R254** — `BAD_CAPTURE_MODE` / `BAD_MATCH_MODE` **已在冻结表** `lib/envelope.js:74` 内（M2 任务 1 前就登记过）→ **不需要改 `lib/envelope.js`**；两码退出码为 2。
  如果错了：代价是退出码分档错（有断言兜底）。
- **R204（C3）是本任务的硬要求**：三处「未接线」文本必须**同任务**清掉——① `lib/shot.js` 的失败 hint 出路②③（含其上方那句注释）；② `skills/unity-game-dev/SKILL.md` 的两处（命令表下方那句 + §4 第 3 条）；③ `test/shot.test.js` 的 `R110①②` 用例（它断言的正是「必须写需裸 uloop」）。**注意**：新增的成功路径字段是 **additive**（M1 的 `path`/`width`/`height`/`captureMode` 一字不改），且 `pickScreenshot` 的 `NO_SCREENSHOT` 判据必须保留（不许改成直接从 `Screenshots[0]` 取）。
  如果错了：代价是仓库自相矛盾 + T12 盲测判据 2 失败（该判据要求 `shot --capture-mode rendering` 且禁止裸 uloop）。
- **登记携带**：`lib/shot.js` 里另有两句「（可试 `--match-mode contains`，或用裸 uloop 枚举真实标题）」——R204 只要求清「需**裸 uloop**」的出路②③；这两句不含「需**裸 uloop**」措辞，**本任务不动**（改它们会动 R109 的证据分支断言）。登记为延后 Minor 交最终审查。

Task 6: complete (commits ce32137..ff786e0, review clean) — **277/277 绿**（271 + 6）。**无 Important 发现 → 未触发修复循环。**
- **控制者自行解决 spec 审查者的 ⚠️（真机一次性证据不可重放）**：① 重取 `S0Project/Assets/Scenes/SampleScene.scene` 的 md5 = `cfa039c51ef6e5e41b68fab3d47f329a`，与报告 BEFORE/AFTER **一致**（PlayMode 进出未静默保存场景）；② 独立复跑「EditMode 强行 rendering」反例 → `ok:false` / `code:ULOOP_ERROR` / 报文 `Rendering screenshots require PlayMode, but Unity is currently in EditMode.` / **exit 1**，与报告逐字一致。两条均核实成立。

**任务 6 延后的 Minor（交最终整分支审查甄别）：**
- Task 6: minor (deferred)：`test/shot.test.js:419` 的分节注释仍写「三条出路必须写明「需裸 uloop」」，与新用例（断言「不得含需裸 uloop」）自相矛盾（注释级）。
- Task 6: minor (deferred)：`lib/shot.js:118` / `skills/unity-game-dev/SKILL.md:212` 仍写「不要硬传 `--capture-mode rendering`」「故意不传」，与新接线口径有语气张力（两句都带 EditMode 限定、事实仍成立）。
- Task 6: minor (deferred)：新 `TimedOut` hint 提到 `unity play step`（该命令任务 7 才存在）；任务 7 落地后自动消解。
- Task 6: minor (deferred)：元数据测试未锁 `resolutionScale`/`unityInputFormula`，且 fixture 的 `GameViewWidth/Height` 与图宽高相同（把 `gameViewWidth` 错接成 `s.Width` 也能过）。
- Task 6: minor (deferred)：`CAPTURE_MODES`/`MATCH_MODES` 导出且同时用作校验源（未 `Object.freeze`）→ 外部误改会静默改变合法性判定。
- Task 6: minor (deferred)：`--out` + 新开关的 argv 顺序无逐字断言；R204③ 的**正面**断言对旧文案恒真（真正变红的是负面断言）。
- Task 6: minor (deferred)：多个用法错并存时的优先级由「capture → match → windowName → outDir」决定（M1 时 `--out` 错优先），退出码都是 2、只有 `code`/`message` 变；若要保持 M1 优先级可把两个新守卫挪到 `outDir` 之后。
- Task 6: minor (deferred)：失败路径（`NO_SCREENSHOT`/`WINDOW_NAME_LOCALIZED`）仍吞掉上游的 `TimedOut`/`ResolvedCaptureMode`/`ScreenshotCount`（简报只要求 `Success:true` 路径）。
- Task 6: minor (deferred)：`test/shot.test.js:485` 中部重复 `require('../lib/shot.js')`（顶部 :8 已有）。
- Task 6: minor (deferred)：`docs/superpowers/specs/2026-09-18-pi-unity-design.md:509` 的 M2 待办行仍写「需要时用裸 uloop」（文档同步，归任务 13）。

## 进度总览（更新）

| 任务 | 状态 | 测试数 | 修复轮次 |
|---|---|---|---|
| 1–3 | ✅ complete | 214 / 222 / 231 | 各 1 |
| 4 像素判定 | ✅ complete | 257 | 1 |
| 5 `unity sprite set` | ✅ complete | 271 | 1 |
| 6 `shot --capture-mode/--match-mode` | ✅ complete | 277 | 0（无 Important） |
| 7 `unity play` 试玩闭环 | ⬜ 待执行（**下一任务**） | — | — |
| 8–13 | ⬜ 待执行 | — | — |

**下一任务（7）开工前必须带上的携带项**：① **R208**：`test/play.test.js` 在计划里有**重复/未闭合块**（按字面粘贴即坏）+ 用例计数 13/15/18 三处不一致 → 派发时必须钉死「以实现为准、写完自洽」；② `lib/shot.js` 已接线 `--capture-mode`/`--match-mode`，且真机确认 `rendering` 模式给 `screenshotToInputFormula` / `gameViewWidth` / `gameViewHeight`（**任务 7 的坐标输入**），EditMode 下 `rendering` 会失败（必须先 Play）；③ 任务 6 的真机确认：PlayMode 进出**不**保存场景（md5 不变）；④ 新 `TimedOut` hint 里引用了 `unity play step` —— 任务 7 落地后需确认该引用成立（或由任务 13 整理）；⑤ `readBackAndVerify` 已从 `lib/scene.js` 导出；⑥ `USAGE_FAILURE_CODES` 是冻结数组（`includes`/`isUsageFailure`）；⑦ 新 handler 一律体内 require；⑧ `test/helpers/capture.js` 已存在；⑨ 真机用 `S0Project`（编辑器仍在运行），用户真实工程不许碰；⑩ `docs/PITFALLS.md` 新条目只追加、不编号（R213 → 任务 13）。

## 任务 7（`unity play` 试玩闭环）起飞前裁定（控制者）

BASE = `ff786e0`（277/277 绿）。简报：`task-7-brief.md`（**847 行，已由控制者手工截断**）。

- **⚠️ 计划缺陷（工具链级，登记）**：计划 `docs/superpowers/plans/2026-09-19-pi-unity-m2-implementation.md` 的**任务 7 区段缺一个闭合 ```**（R208 改稿时留下的围栏不平衡）→ `scripts/task-brief` 的 awk 在 `## 任务 8` 处仍认为「在代码块里」，于是**把任务 8 的文本一起抽了出来**（原抽取 1511 行）。控制者已把 `task-7-brief.md` 手工截断到 **847 行**（止于任务 7 的「步骤 6：Commit」+ `---`），并删掉泄漏副本。**后续任务（8–13）生成简报后必须核对末尾是否止于下一个任务标题**，否则同样截断。计划本身的围栏由任务 13 修（R213 已把计划回写归它；现在改会平移所有已登记的 `计划:行号` 引用）。
- **R257** — 简报步 4 的「总数应为 279」是过期数字（按 264 基线写的）。实际基线 **277**；预期 = 277 + 15 = **292**（R208 已把用例计数统一为 15，清单见简报）。以 `npm test` 为准，**只增不减**。
  如果错了：代价为零。
- **R258** — 简报步 5 的 `/tmp/before.md5` / `/tmp/after.md5` 按 R212 改到仓库内 `.superpowers/sdd/2026-09-19-pi-unity-m2-implementation/tmp/`。证据形式（`diff` + 「场景未被保存」）不变。
- **R259** — 简报 `bin/unity.js` 的 `play` handler 在未知子动作分支写 `return 2`（裸魔法数），违反 R222「用法错退出码用 `EXIT_USAGE` 常量」。裁定：改成 `return EXIT_USAGE`（顶层已 import，值仍 2，测试 `unknown.result === 2` 不受影响）。
  如果错了：代价为零。
- **R261（真机分支钉死）** — S0Project 的 `activeInputHandler: 0`（只有 legacy Input）→ **预期命中「结果 X」**：`play key` / `play mouse`（非 `--dry-run`）必须落 `INPUT_SYSTEM_UNAVAILABLE`（`ok:false`、退出码 1）、hint 给两条出路（装包改 Active Input Handling / 用 `execute-dynamic-code` 注入并**声明是注入**），**不得**假装可用、不得静默降级。若撞上第三种报文 → 如实记录原文、按原码失败、并把坑追加到 `docs/PITFALLS.md` 末尾（不写 U 编号，R213）。
- **R262（不得漏的真机结论）** — 简报要求判定 **PlayMode 进出是否改动 `SampleScene.scene` 的 md5**。任务 6 已实测「进/出 PlayMode 前后 md5 相同（`cfa039c5…`）」，但**任务 7 的 `play start` 是另一条路径**（uloop `control-play-mode`），必须独立复测并写进报告；若变了 → 追加 PITFALLS 条目，并在报告里点名对任务 9/10/11 清理纪律的影响。
  如果错了：代价是任务 9/10/11 的清理纪律建立在未验证的假设上。
- **接口携带**：`MISSING_KEY` / `BAD_ACTION` / `BAD_COORD` / `BAD_TIMEOUT` / `BAD_SIZE` **已在冻结表** `lib/envelope.js:71-79` 内（退出码 2）；新增的 `INPUT_SYSTEM_UNAVAILABLE` / `BAD_LOG_RESPONSE` 是**运行时码**（不在表内 → 退出码 1），这是对的。`exitCodeFor` 是唯一判定处；handler 体内局部 require；`test/helpers/capture.js` 已存在。

Task 7 首轮实现（DONE_WITH_CONCERNS，commit `a950c31`，292/292 绿）—— 控制者**审查前**裁定（该疑虑关乎正确性且承重）：

- **控制者已独立复现证据**（裸 `uloop.exe control-play-mode`，2026-09-19）：`--action Status` → `Success:true`；**`--action Play` → 完整合法载荷但没有 `Success` 字段**（`{"IsPlaying":true,"IsPaused":false,"Changed":true,"WasAlreadyStopped":false,"ResumedFromPause":false,"BlockedByCompileErrors":false,"BlockedByUnsavedChanges":false,"CompileErrorCount":0,"CompileErrors":[],"Message":"Play mode started","Warning":"…"}`）；**`--action Stop` 同样无 `Success`**。→ `envelopeFromCall` 只认字面量 `Success === true`（设计如此，M1 的 `'false'` 漏洞教训），故 Play/Stop 恒落 `ULOOP_BAD_PAYLOAD`、退出码 1、`verified:false`。这是**上游真实形状**，不是实现者写错。
- **R263（裁定：在 `lib/play.js` 内窄口径收口，不动 `envelope.js`）** — 不许放宽 `envelopeFromCall`（会波及全局判据，U14 教训）。改法：
  - `playMode` 的响应处理按**证据**分四支：① `Success === false` → 按既有错误映射失败；② `Success === true` → 正常；③ **`Success === undefined` 且 `typeof json.IsPlaying === 'boolean'`** → 视为合法的 `control-play-mode` 载荷（Play/Stop 的 domain-reload 形状），把该载荷当 `actual` 继续走 intent 比对；④ 其余（如 `{}`）→ 仍落 `ULOOP_BAD_PAYLOAD`（安全网不变）。
  - 该例外只允许出现在 `control-play-mode` 的专用路径上（`lib/play.js`），**不得**写进 `lib/envelope.js` 或其它工具的通用路径。
  - 补断言（至少 3 条）：缺 `Success` + `IsPlaying:true` → `ok:true`/`verified:true`；缺 `Success` + `IsPlaying:false` → `ok:true`/`verified:false`（不许假绿）；`{}`（两者皆无）→ `ULOOP_BAD_PAYLOAD`（安全网仍有牙）。
  - **必须真机复测**：修后 `play start` / `play stop` 应 `exit=0` 且 `verified:true`；并再次确认 `SampleScene.scene` 的 md5 前后一致（R262）。把真实输出与退出码写进报告。
  如果错了：代价是 `playMode` 多一个窄分支 + 3 条断言；不做则 **M2 试玩闭环的退出码恒为 1**，任务 11/12 的验收无法成立。
- 其余真机结论（结果 X 逐字命中、`play click` 无 EventSystem、dry-run `hit:false`、md5 不变）**已由控制者复核**（R261/R262 关闭）。

Task 7 首轮审查（spec ✅ 通过 / code ✅ 通过带 **3 条重要** + 若干次要）→ 修复循环第 1 轮

- **控制者自行解决 spec 审查者的 ⚠️①（「ce8df19 是否只改 playMode」）**：`git show ce8df19 --stat` = `lib/play.js` 18 行 + `test/play.test.js` 54 行（**只 2 个文件**）；`git show ce8df19 -- lib/play.js` 的改动点只有 `playMode` 里新增 `isPlayStopShape` 与 `if (!isPlayStopShape) { envelopeFromCall ... }`。**零泄漏到其它工具、`lib/envelope.js` 不在其中**。核实成立。
- **R264（重要①，裁定：修）** — code-reviewer：`lib/play.js` 的 `--from-x/--from-y` 成对校验只在 `action === 'Drag'` 时要求成对 → 非 Drag 下 `fromX` 单给会把字面量 **`--from-y undefined`** 发给上游；`fromY` 单给则**静默丢弃**。这是「畸形 argv 而不是用法错」，违反约束 16 的收敛面（真机上会得到上游的 `undefined` 参数错误、退出码 1，误导排障方向）。裁定：把「成对」收敛成**与 action 无关**的一条守卫（`fromGiven && (任一为 undefined/null)` → `BAD_COORD`），`Drag` 的「必须有」守卫保留在它之前；补 2 条断言（`Click + --from-x only`、`Click + --from-y only` → `BAD_COORD` + 退出码 2 + `spy.length === 0`）。
- **R265（重要②，裁定：修）** — code-reviewer：`playLogs` 只校验 `Logs` 是数组、**不校验元素形状** → `Logs:[null]` 抛 TypeError 冒成**退出码 3 内部错误**（把上游载荷问题错分类成本包 bug）；`Logs:['oops']` 静默编造 `{type:'Log',message:''}`（正是 `BAD_LOG_RESPONSE` 这道闸门要防的形态）。裁定：逐个元素校验（`null`/非对象/数组 → `BAD_LOG_RESPONSE`，退出码 1、不抛）；补 1 条载荷级断言（`Logs:[null]` → `BAD_LOG_RESPONSE`、`exitCodeFor === 1`）。
- **R266（重要③，裁定：修）** — 两位审查者都指出 `docs/PITFALLS.md` 的 p8 条目**在同一个 head 内已被 `ce8df19` 推翻**：它仍写「`play start` 落 `ULOOP_BAD_PAYLOAD`、退出码 1」「不要把退出码当失败信号」「修它超出任务 7 的授权」，而真机复测已是 `exit 0` + `verified:true`；它举的判据「`IsPlaying` 布尔 **+ `Message` 字符串**」也与落地代码（不要求 Message）不一致。裁定：**改这条条目让文档与交付状态一致**（保留「修复前的症状」作为历史 + 写明「`ce8df19` 起在 `lib/play.js` 窄口径收口、`envelope.js` 的 `Success===true` 全局判据不变」+ 仍建议以 `play status` 读回为准）。编号仍留空（R213 → 任务 13）。
  如果错了：代价为零；不做则任务 10/11/12 会照它写出与已交付行为相反的判据。
- **R267（次要，采纳 code-reviewer 问题 4）** — 第③支再收窄一层：加 `&& (action === 'Play' || action === 'Stop')`。真机证据**只**覆盖 Play/Stop（Pause/Step/Status 恒带 `Success`），收窄**严格更安全且不丢任何已观测形状**（U11「别的程序假绿」窗口再缩小）。
- **R268（次要，采纳 code-reviewer 问题 5）** — 测试深度补齐：① `truncated:true` 优先于形状判定（`ULOOP_TRUNCATED`、退出码 1）；② `{Success:false, IsPlaying:true}` 仍走①支（上游错误码、退出码 1）；③ `click/mouse/logs/view` 各补 `assert.strictEqual(e.verified, null)`；④ 把 5 处「构造了 spy 却没断言」的用法错用例补 `spy.length === 0`（「调用前收敛」的回归网，本任务最看重的性质）。
- **登记延后（Minor，不进循环）**：自由字符串参数裸写会把 `true` 透传上游（**全仓既有模式**，非本任务引入）；坐标失败的 message 不区分「没给」与「给了但不是整数」；USAGE 的 `play` 块头格式与悬空路径 `docs/CAPABILITIES`（应为 `docs/CAPABILITIES-*.md`）；`lib/play.js` 的若干死导出（`intArg`/`MODE_ACTIONS`/…/`uiFailureHint`）；`playMode` 未把 `CompileErrors[]` 明细放进 `actual`（简报强制，只有 count）；文件头注释列的 `--drag-speed`/`--drop-target-path` 未标注「刻意未接线」。
- 预期测试数：296 + 5（R264 2 + R265 1 + R268①② 2）→ **约 301**；以实际为准，只增不减。

Task 7: fix round 1/5 (F1–F5(4) + 不许动清单全部 ADDRESSED，0 open；定向复审对 F1/F2/F4 做了只读探针实证; commits ce8df19..983b873)
Task 7: complete (commits ff786e0..983b873, review clean) — **301/301 绿**（296 + 5）

**任务 7 新增的延后 Minor（交最终整分支审查甄别）：**
- Task 7: minor (deferred)：`playLogs` 对「对象元素但缺 `Type`/`Message`」（`Logs:[{}]`）仍会编造 `{type:'Log',message:''}` —— F2 的裁定范围只含 null/非对象/数组。
- Task 7: minor (deferred)：F1 的**正例**（合法 `Drag` 两侧 from 的 argv 透传）无断言 → 误删 push 不会变红。
- Task 7: minor (deferred)：`docs/PITFALLS.md` 引用的第③支条件省略了代码里的 `raw !== null && typeof raw === 'object'` 前缀（语义不变）。
- Task 7: minor (deferred)：`simulate-keyboard` 的 `ReleasedKeyStates` 未透传（简报自相矛盾：正文列了它、代码片段用 `ReleasedKeys`；结果 Y 本机未验证）。
- Task 7: minor (deferred)：自由字符串参数裸写（`--duration`/`--search-text`/`--target-path`…）会把 `true` 透传上游 → 落上游参数错而非用法错（**全仓既有模式**，非本任务引入）。
- Task 7: minor (deferred)：坐标失败的 message 不区分「没给」与「给了但不是整数」。
- Task 7: minor (deferred)：`bin/unity.js` USAGE 的 `play` 块头格式，以及**悬空路径** `见 docs/CAPABILITIES`（实际文件名是 `docs/CAPABILITIES-tuanjie-2022.3.62t9.md`）。
- Task 7: minor (deferred)：`lib/play.js` 的若干死导出（`intArg`/`MODE_ACTIONS`/`UI_ACTIONS`/…/`uiFailureHint`）；`playMode` 未把 `CompileErrors[]` 明细放进 `actual`；文件头注释列的 `--drag-speed`/`--drop-target-path` 未标注「刻意未接线」。
- Task 7: minor (deferred)：计划文档 `docs/superpowers/plans/2026-09-19-pi-unity-m2-implementation.md:3096` 仍是 R264 前的旧 from 守卫写法（计划漂移 → 任务 13 回写）。

## 进度总览（更新）

| 任务 | 状态 | 测试数 | 修复轮次 |
|---|---|---|---|
| 1–3 | ✅ complete | 214 / 222 / 231 | 各 1 |
| 4 像素判定 | ✅ complete | 257 | 1 |
| 5 `unity sprite set` | ✅ complete | 271 | 1 |
| 6 `shot --capture-mode/--match-mode` | ✅ complete | 277 | 0 |
| 7 `unity play` 试玩闭环 | ✅ complete | 301 | 1 |
| 8 `unity asset write` + `unity compile` | ⬜ 待执行（**下一任务**） | — | — |
| 9–13 | ⬜ 待执行 | — | — |

**下一任务（8）开工前必须带上的携带项**：① **R209**：T8 的 `compile.Success:null` 前提 —— 保留 `indeterminate` 防御但**降级标注为「生产不可达，除非上游改回 null」**，并**补一条真机对账**（真机跑 `uloop compile` 记录 `Success` 的实际类型）；② T8 **没有 CLI 级用例**（A20/R206④ 要求补 `main([...])` 级用例）；③ `lib/envelope.js` 的 `USAGE_FAILURE_CODES` 已含 `MISSING_SOURCE` / `MISSING_TO` / `BAD_SOURCE` / `BAD_TARGET_PATH`（任务 1 前登记）→ 新用法错码**先查表**，不要重复登记；④ `readBackAndVerify` 已从 `lib/scene.js` 导出可复用；⑤ `USAGE_FAILURE_CODES` 是冻结数组（`includes`/`isUsageFailure`）；⑥ 新 handler 一律体内 require；⑦ `test/helpers/capture.js` 已存在；⑧ 真机用 `S0Project`（编辑器仍在运行），用户真实工程不许碰；⑨ `docs/PITFALLS.md` 新条目只追加、不编号（R213 → 任务 13）；⑩ **计划有未闭合 ```（任务 7 区段）→ 生成任务 8 简报后必须核对末尾是否止于任务 9 标题**。

## 任务 8（`unity asset write` + `unity compile`）起飞前裁定（控制者）

BASE = `983b873`（301/301 绿）。简报：`task-8-brief.md`（**663 行，控制者按计划行号 3504–4166 抽取**——计划有未闭合围栏，`scripts/task-brief` 对任务 8 及之后**完全失效**，后续任务一律用 `grep -n "^## 任务"` + `sed -n 'A,Bp'` 抽取）。
- **⚠️ 工具链登记**：计划 `docs/superpowers/plans/2026-09-19-pi-unity-m2-implementation.md` 的任务 7 区段缺一个闭合 ``` → awk 式的 `infence` 从任务 8 起**整体反相**，任务 8–13 的标题都不再被识别。已记；计划围栏由任务 13 修。

- **R269（计划缺陷，裁定：**不**创建模板文件）** — 简报/接口表把 `unity-scripts/templates/PiBrickBreaker.cs` 列为「新」，但**它属于任务 11**（计划 `:5177` 的任务 11 文件清单明确「创建」）。任务 8 的 `lib/asset.js` 的 `TEMPLATES` 表只是**前向引用**。裁定：任务 8 **不得**创建该 `.cs`（也不得建空文件占位）；`test/asset.test.js` 的 `resolveTemplate('PiBrickBreaker')` 只断言**路径字符串**（不要求文件存在），照简报即可；真机步用 `--from`，不依赖模板存在。若实现者顺手建了 → 审查会判「多余」。
  如果错了：代价是任务 11 的文件被提前建出、内容与任务 11 逐字给定的模板冲突。
- **R270** — 简报步 4 的「新增 14 条 → 总数 293」是过期数字（按 279 基线写的）。实际基线 **301**；预期 = 301 + 14 = **315**。简报那句「后续任务的总数链 → T9=301 / T10=308 / T11=313」**整条作废**（每个任务的**新增条数**仍以各自简报为准，总数以 `npm test` 实际为准，只增不减）。
  如果错了：代价为零。
- **R271** — 真机步的临时探针脚本（`PiProbe.cs` / `Broken.cs`）放**仓库内** `.superpowers/sdd/2026-09-19-pi-unity-m2-implementation/tmp/`（真实 Windows 路径，符合 U4「原生工具不认 MSYS `/tmp`」），不要放 `C:/Users/<用户>/pi-unity-spike/` 根目录，也不要用 `<(…)` 进程替换。清理步骤照简报（本任务自造的探针文件可直接删，**不碰用户既有内容**）。
- **R272** — `MISSING_TO` / `BAD_TARGET_PATH` / `MISSING_SOURCE` / `BAD_SOURCE` / `BAD_TIMEOUT` **已在冻结表** `lib/envelope.js` 内（退出码 2）；`BAD_COMPILE_RESPONSE` / `COMPILE_FAILED` / `TEMPLATE_NOT_FOUND` / `SOURCE_NOT_FOUND` / `ASSET_EXISTS` / `ASSET_WRITE_FAILED` 是**运行时码**（不在表内 → 退出码 1）。**不要改 `lib/envelope.js`**。
- **R209 落实**：`Success: null` 的 `indeterminate` 防御**保留**但**降级标注为「生产不可达，除非上游改回 null」**（依据 `vendor/uloopmcp/Editor/FirstPartyTools/Compile/CompileResponseFactory.cs:80,91` 强制成 bool）；**必须**做真机对账（裸 `uloop compile` 记录 `Success` 的实际 `typeof`）并写进报告；若真是 `null` → 把标注反过来并报告为修复项。
- **真机 ≠ 只有 happy path**：步 5 的**反向验证**（故意写一个语法错的 `.cs` → `exit 1` + `COMPILE_FAILED` + `errors[0].file/line`）与**清理后回到 `errorCount:0`** 都是判据，必须真做。

Task 8 首轮审查（spec ❌ 需要修复（1 重要）/ code ❌ 需要修复（2 重要 + 6 次要））→ 修复循环第 1 轮

- **控制者已独立复现 R275（实现者的真机发现）**：写一个语法错的 `.cs` 到 `S0Project` 后裸 `uloop compile` → `typeof Success = boolean`、`value = false`、`ErrorCount = 1`、`Errors[0] = {Message, File, Line}`。→ 简报实现稿会把结构化 `Errors[]` 换成通用 `ULOOP_ERROR`；实现者的「计数 +（`Success:true` 或 `Errors` 是数组）」判据是**必要**的。已清理探针（`Assets/PiProbe` 全删 + 复核 `Success=true/ErrorCount=0`）。
- **形式化实现者自贴的两个标签**：**R274** = `--to ''` 落 `BAD_TARGET_PATH`（简报的**测试**期望它，而简报的**实现片段**会落 `MISSING_TO`）→ 裁定以**测试期望**为准（`''` 是「给了但非法」，不是「没给」）；**R276** = 把 R275 的坑追加到 `docs/PITFALLS.md` 末尾、不写 U 编号（R213）→ 接受。
- **R277（重要①，裁定：修 —— 与 R237/R247/R264 同一条铁律）** — 两位审查者都指出：`asset write` 的 `--timeout-seconds` 非法值**在写盘之后**才被 `compile()` 校验，且被折成 `COMPILE_FAILED`/退出码 1；带 `--no-compile` 时甚至**静默成功**（`verified:true`）。同一非法 argv 的退出码/副作用取决于 `--no-compile` —— 直接违反约束 16。裁定：`assetWrite` **顶部**复用 `compileTimeoutArg` 预校验，非法即 `BAD_TIMEOUT`（退出码 2）**且零写盘**；补 1 条 lib 级用例（断言 `code==='BAD_TIMEOUT'`、`exitCodeFor===2`、`writes===0`）。
- **R278（重要②，裁定：修 —— 与 M1 R68 同族）** — code-reviewer：`lib/asset.js` 缺 `projectPath` 守卫 → ① 裸写 `--project-path`（`parseArgs` 给 `true`）在 `path.join(true, …)` 抛 TypeError → 顶层 catch → **退出码 3**（把 argv 失误报成「本包 bug」）；② 完全不给 → `path.join('', …)` 是相对路径 → 写到**进程 CWD** 的 `Assets/`，而随后的 `compile` 走调度器默认工程 → 可能 `verified:true/compiled:true` 的**假绿**（脚本根本没进工程）+ 污染 CWD。裁定：加 `MISSING_PROJECT_PATH` 守卫（不在冻结用法表 → 退出码 1，与 `lib/scene.js` 的 R68 完全一致，**不动 `lib/envelope.js`**）；补 2 条用例（缺省 / 裸写），照 `test/scene.test.js` 的既有范式。
  - 订正（2026-09-20 R477，批次 A）：当时裁定的「不在冻结用法表 → 退出码 1」已被推翻 —— `MISSING_PROJECT_PATH` 现为 **2 档**，见 `docs/HANDOFF.md` §7⑪。
- **R279（重要③，裁定：修）** — code-reviewer：`asset write` 把编译阶段的**任何**失败一律折成 `COMPILE_FAILED`，于是 `COMPILE_ALREADY_IN_PROGRESS` / `COMPILE_RESULT_UNKNOWN` / `ULOOP_TRUNCATED` / `ULOOP_NO_JSON` 的**原码与 `retryable` 语义**被抹掉（可重试 → 不可重试）—— 而「刚写完 `.cs` 紧接着 compile」撞上 single-flight 是**常见**情形，任务 10/11 若按 `code` 判定会把「编辑器忙/输出被截断」误判成「脚本编译不过」。裁定：只折叠真正的编译结论类（`COMPILE_FAILED` / `BAD_COMPILE_RESPONSE`），其余**原码透传**并**透传 `retryable`**（`fail()` 已支持该形参）；补 1 条用例（`truncated:true` → 上层 `retryable===true` 且 `code !== 'COMPILE_FAILED'`）。
- **R280（采纳 code-reviewer 次要 4）** — `asset write` 的**成功**信封缺 `mismatches`（只有不一致路径才有）。项目约定（`lib/readback.js:160`、`lib/scene.js` 显式补 `mismatches: []`）要求写命令成功信封一律带它。补 `mismatches: []`。
- **R281（采纳 code-reviewer 次要 5）** — CLI 级「有编译错」用例把载荷写 **stderr**，而本任务新增的 PITFALLS 条目亲口记录真机形状是「脏载荷走 **stdout** + 退出码 1」（`lib/uloop.js` 的 secondary 兜底）。裁定：把该用例改成与真机/PITFALLS 逐字一致的 stdout+exitCode=1 变体（真机那条路径在库级与 CLI 级都无覆盖）。
- **R282（采纳 code-reviewer 次要 6(b)(c)）** — 补 2 条：① `Success!==true` 且 `ErrorCount===0` 的矛盾分支 → `BAD_COMPILE_RESPONSE`（新分支无 tripwire）；② `--to 'Assets\X.cs'` 的反斜杠归一化（无用例，报告自认未验证）。
- **R283（采纳 code-reviewer 次要 8）** — `docs/PITFALLS.md` 的措辞与实现不符：`Success:false` 且 `Errors` 非数组时实际走 `envelopeFromCall`；`ErrorCode` 缺失时落 **`ULOOP_ERROR`**（不是 `BAD_COMPILE_RESPONSE`、也不是 `COMPILE_RESULT_UNKNOWN`）。R279 改完后按**新行为**重写该段。
- **R284（采纳 code-reviewer 次要 9）** — 编译失败信封里 `verified:false` 与 `actual`（`sha256 === readBackSha256`）自相矛盾、且 `intent` 被丢成 `null`（正是 M1 R226 消除过的形态）。裁定：**不动 `verified`**（约束 15 不许把它扩张成「编译通过」），改为传 `intent: {path, sha256}` 并加 `actual.writeVerified: true` / `compileVerified: false`，让「写盘已验、编译没过」在结构上无歧义。
- **R285（采纳 code-reviewer 次要 7）** — USAGE 给 `compile` / `asset write` **独立标题**（`compile 选项：` / `asset write 选项：`，与既有风格一致），补 `--timeout-seconds`、`ASSET_EXISTS`、用法错 2 的退出码行。
- **登记延后（Minor，不进循环）**：`TEMPLATES`/`compressIssues` 两个额外导出（任务 11 若用不到可收窄）；`_readSource` 非 Buffer 误用落 `SOURCE_NOT_FOUND`（仅测试面）；`--template` 在任务 11 落地前落 `SOURCE_NOT_FOUND` 而 hint 未点明「模板文件尚未随包发布」；裸写 `--project-path` 对 scene/play/pixels/sprite 的**既有**同类问题（M1 面，非本任务引入）。
- 预期测试数：316 + 7（R277 1 + R278 2 + R279 1 + R281 1 + R282 2）→ **约 323**；以实际为准，只增不减。

Task 8: fix round 1/5 (F1–F9 + 不许动清单全部 ADDRESSED，0 open；复审实跑 `test/asset.test.js` 21/21; commits 9ad82fe..657316a)
Task 8: complete (commits 983b873..657316a, review clean) — **322/322 绿**（316 + 6）

**任务 8 新增的延后 Minor：**
- Task 8: minor (deferred)：编译失败透传时丢上游 `actual`/`phase`（`ULOOP_TRUNCATED` 的 `timedOut/drained/tool/args` 与 `phase:'transport'` 在 `asset write` 路径不可见）→ 建议 `actual: {...actual, compileFailure: c.actual}` + `phase: c.phase ?? 'compile'`。
- Task 8: minor (deferred)：非编译结论类失败的 message「脚本已写入但编译未通过」对 `ULOOP_TRUNCATED`/`ULOOP_NO_JSON`（结果**未知**）不诚实（U11 方向）。
- Task 8: minor (deferred)：合法 `--timeout-seconds` 经 `asset write` 下传无 tripwire（数字分支 `timeoutSeconds:'600'` 无用例经过）。
- Task 8: minor (deferred)：`TEMPLATES`/`compressIssues` 额外导出（任务 11 若用不到可收窄）；`_readSource` 非 Buffer 误用落 `SOURCE_NOT_FOUND`；任务 11 落地前 `--template` 落 `SOURCE_NOT_FOUND` 而 hint 未点明「模板文件尚未随包发布」。
- Task 8: minor (deferred)：`bin/unity.js` USAGE 的退出码图例仍写「2 用法错（参数缺失/…）」而 `MISSING_PROJECT_PATH` 归 1（M1 延后项，非本轮引入）。
  - 订正（2026-09-20 R477，批次 A）：`MISSING_PROJECT_PATH` 已改为 **2 档**，USAGE 图例不再矛盾，见 `docs/HANDOFF.md` §7⑪。
- Task 8: minor (deferred)：`test/asset.test.js` 的 compile 用例插在 assetWrite 用例中间（可读性）；USAGE `compile 选项：` 小标题下重复列一次命令行。

## 进度总览（更新）

| 任务 | 状态 | 测试数 | 修复轮次 |
|---|---|---|---|
| 1–3 | ✅ complete | 214 / 222 / 231 | 各 1 |
| 4 像素判定 | ✅ complete | 257 | 1 |
| 5 `sprite set` | ✅ complete | 271 | 1 |
| 6 `shot` 接线 | ✅ complete | 277 | 0 |
| 7 `unity play` | ✅ complete | 301 | 1 |
| 8 `asset write` + `compile` | ✅ complete | 322 | 1 |
| 9 `doctor --golden` | ⬜ 待执行（**下一任务**） | — | — |
| 10–13 | ⬜ 待执行 | — | — |

**下一任务（9）开工前必须带上的携带项**：① **R210**（M2 起飞前扫描）：T9 的「变异注入阈值 `snapshots>=3` 不可达（`runRound` 只 2 次快照）→ 用例必红」必须修成**可达**（`snapshots>=2` 或改注入点）；`doctor` 的接线块与注释对齐（注释里的 `_call` 形参 T10 才有 → T9 只写 `{projectPath, env, rootDir, runImpl}`）；计数统一。② **约束 25**：`get-hierarchy` 的节点键含 `siblingIndex`（真机实测 `name/isActive/components/siblingIndex/tag/layer/children`），golden 的规范化必须保留它（丢弃会让「顺序变了」这类真实变异漏检）。③ **R206③**：`doctor --json --golden` 必须补**形状断言**。④ **A20/R206**：`GOLDEN_BLOCKED/STEP_FAILED/LEFTOVER/MISMATCH` 四个码「要么让实现真的产，要么从表里删」（不许留表里有、实现没有的死码）；`runGolden` 实际返回 `{ok,matched,diff,cleanup,blocked,lines}`。⑤ 任务 8 的真机确认：`uloop compile` **确实**自动 refresh 外部新写入的文件（无需 `AssetDatabase.Refresh()`）。⑥ 任务 7/8 的真机确认：PlayMode 进出不保存场景。⑦ `USAGE_FAILURE_CODES` 冻结数组（`includes`/`isUsageFailure`）；⑧ 新 handler 一律体内 require；⑨ 真机用 `S0Project`（编辑器仍在运行），用户真实工程不许碰；⑩ PITFALLS 新条目只追加、不编号（R213 → 任务 13）；⑪ **计划有未闭合围栏**：任务 9 简报已由控制者按行号 4167–4783 抽取。

## 任务 9（`doctor --golden`）起飞前裁定（控制者）

BASE = `657316a`（322/322 绿）。简报：`task-9-brief.md`（617 行，按计划行号 4167–4783 抽取）。

- **R286** — 简报步 4 的「总数应为 301」是过期数字。实际基线 **322** → 预期 = 322 + 8 = **330**（7 条既有 + 1 条 R206③ 形状断言）。以 `npm test` 为准，**只增不减**。
- **R287** — 步 5 的 `/tmp/before.md5` / `/tmp/after.md5` 改到仓库内 `.superpowers/sdd/2026-09-19-pi-unity-m2-implementation/tmp/`（R212）。
- **R288（预防性裁定，避免误报）** — `lib/doctor.js` 的 `--golden` 分支写 `return r.ok ? 0 : 1`。这**不违反**约束 16：`runGolden` **不产错误码**（R206④ 已把四个 `GOLDEN_*` 码从接口表删除），因此没有信封可供 `exitCodeFor` 判定。约束 16 约束的是「有信封的命令」。审查者若按字面把它报为违反 → 以本裁定为准。
- **R210 已落实核对**：简报里变异注入阈值已是 `snapshots >= 2`（**可达**，`runRound` 两次快照）；`doctor()` 的接线块**只传** `{projectPath, env, rootDir, runImpl}`、**不**加 `_call` 形参（那是任务 10 的事）；`doctor --json --golden` 的 doctor 级形状断言明确划给任务 10。
- **约束 25 落实**：`normalizeHierarchy` 的 additive 投影必须保留 `siblingIndex`/`tag`/`layer`（简报已给逐字代码）。
- **真机纪律**：`--golden` 会向当前场景建临时节点（随后删除并读回确认）→ 场景变 dirty；**不保存场景**。若 `matched:false` **不许**为了让 golden 变绿而删投影字段（除非有实测证据证明是时间戳类字段）。

Task 9 首轮审查（spec ✅ 通过带 5 次要 / code ❌ 需要修复带 **2 重要** + 若干次要）→ 修复循环第 1 轮

- **R289（重要①，裁定：修）** — code-reviewer（实跑探针复现）：`cleanupLine` 只按 `status` 分支、忽略 `cleanup.message/code` → 编辑器连不上（第 1 步 create 就失败、**从未创建任何节点**）时人读行硬编码「❌ 清理：临时根仍在场景里（`__pi_golden`）——请手工执行 `unity node delete`」，与同一封信的 `blocked` 行**自相矛盾**，且把用户指去跑一条必然 `NOT_FOUND` 的命令。这与本任务「绝不谎报」的立意反向，且「编辑器未连接」恰恰是 `--golden` 最常见的失败形态。裁定：**保持 cleanup 枚举 `'none'|'ok'|'failed'` 不变**（契约稳定，任务 10 会用），但：① `cleanupLine` 必须用 `cleanup.code`/`message` 区分「读到场景且根还在」（确证残留）与「读场景失败，无法确认」（措辞改成「无法确认是否残留（读场景失败：<code>）——连接恢复后用 `unity scene tree` 复核」）；② `runRound`/`runGolden` 在**第一个 step 之前**就失败（未发出任何建节点调用）时返回 `{status:'none', path:null}`。
- **R290（重要②，裁定：修）** — code-reviewer：`runGolden` **开局不检查既有 `__pi_golden` 残留** → 上次跑挂留下的同名节点会被叠加（Unity 允许同名兄弟；`node-create.cs` 无同名检查），之后的 `Find("__pi_golden")` / `__pi_golden/GOLDEN_B` 解析变歧义 → 可能改/验到旧节点（假红）或**删掉本轮从未创建的那个**。计划自己为姊妹命令（`--smoke`）写了同样的分析（计划 `:4795`）。裁定：照搬任务 10 的 smoke 做法——`runGolden` 第 1 轮之前先取一次 `sceneTree`，`findByName(roots, GOLDEN_ROOT)` 命中时先 `cleanupGolden` 并在 `lines`/`cleanup` 里说明「已清理上一次残留」；清不掉 → `blocked`/失败 + 手工命令。
- **R291（次要，采纳 code-reviewer 3 + spec 3）** — `matched` 的 JSDoc（写「blocked **或清理失败** → null」）与实际（末次清理失败且两轮一致时是 `matched:true` + `ok:false`）不一致（**简报内部矛盾：文案 vs 它自己给的代码**）。裁定：**行为保留**（信息量更大：两轮结构确实一致，失败由 `ok`/`cleanup` 表达），**改 JSDoc 与接口文案**；并补 1 条覆盖「两轮跑完、末次清理失败 → `{ok:false, matched:true, cleanup.status:'failed'}`」的用例（该组合零回归网）。
- **R292（次要，采纳 code-reviewer 4）** — 假后端 `test/helpers/fake-scene.js` 的 `NAME_EXISTS` 在真机 `.cs` 里**没有对应物**（node-create.cs 的错误码只有 BAD_REQUEST/PARENT_NOT_FOUND/COMPONENT_TYPE_NOT_FOUND/NOT_A_COMPONENT/COMPONENT_ADD_FAILED）。裁定：**保留**该分支（它是夹具 path-keyed 模型自洽所必需），但**加注释写明「真机不产此码，夹具专用」**，并补 1 条「场景里已存在 `__pi_golden`」的用例（正好驱动 R290）。 **（2026-09-20 批次 B-1 取代）**：该守卫已**删除** —— 夹具已改为 `Map<path,node[]>`（同 path 数组模型），R292 所惧的「path-keyed Map 静默覆盖同一 key」已被消除；真机 `unity-scripts/node-create.cs` 本就**无**此守卫、**允许同父同名叠加**。夹具与真机同形（见 `docs/superpowers/plans/2026-09-20-pi-unity-backlog-b1.md` §7 裁定 #14）。
- **R293（次要，采纳 code-reviewer 5）** — `firstDiff` 的 `a`/`b` 可为 `undefined`，`JSON.stringify` 会**整键丢掉**（`--json` 消费方读到 `undefined`）。裁定：在 diff 里把 `undefined` 规范成 `null` 并在 JSDoc 注明「`a`/`b` 恒存在（可能为 null）」。
- **R294（次要，采纳 code-reviewer 6 的测试卫生四小点）** — ① `snapshotCount() >= 2` 改 `strictEqual(…, 2)`；② `calls.some(...includes('GOLDEN_B'))` 近乎恒真 → 改断言「确实对 `__pi_golden/GOLDEN_B` 发起过 `node-set`（`active:false`）」；③ 互斥用例传 `{env:{}}`（或 `runImpl`）保持密闭，别让它在回归时真 spawn uloop；④ 清理失败用例补 `assert.strictEqual(r.matched, null)`。
- **登记延后（Minor，不进循环）**：`isConnectivityFailure` 把 `WRITE_CALL_FAILED` 归为 blocked（可只在 `phase==='connection'`/`ULOOP_*`/`UNITY_NOT_REACHABLE` 时判）；`cleanupGolden/runRound/isConnectivityFailure/GOLDEN_STEPS` 死导出；`projectStructure` 保留 `nodeCount` 却排除 `maxDepth`/`otherSceneNames`；`missing-left/missing-right` 两种 kind 经投影路径不可达（仅单测覆盖）；`GOLDEN_STEPS` 注释里 R80/R82 的归因措辞；`bin/unity.js` 的 `--smoke` **前瞻**描述在**本 commit 上不成立**（`--smoke` 目前只读；任务 10 上线写入闭环后才成立）—— 归任务 10/13。
- 预期测试数：331 + 4（R290 1 + R291 1 + R292 1 + 可能 1）→ **约 334–335**；以实际为准，只增不减。

Task 9: fix round 1/5 (F1① / F2 / F3 / F4 / F5 / F6①–④ / 不许动清单 ADDRESSED；**F1② NOT ADDRESSED**，且修复引入 1 条 Important 破坏; commits 7579048..2668cd1) — 336/336 绿

- **R295（第 2 轮必改：F1② + 修复引入的 Important）** — 复审者用内存探针实证：F1② 要求「未发出任何建节点调用时 → `{status:'none'}`」，但实现用 `failedStep > 0` 作判据，**语义相反**——`failedStep === 0` 表示第 1 个 `nodeCreate` **已发出并失败**，而 `nodeCreate` 可以在**写入已落场景之后**才失败（`READBACK_FAILED` / `WRITE_CALL_FAILED` / `ok:true + verified:false`，见 `lib/scene.js` 的 residue 语义）。后果：**残留一个 `__pi_golden` 根却谎报「未创建节点，无需清理」**——比修复基线更危险（旧代码无条件调 `cleanupGolden`，会把它删掉）。第二轮有同构问题（`cleanup` 保留第一轮的 `'ok'`，而第二轮首个 create 可能已落场景）。裁定：
  ① **去掉 `failedStep > 0` 门** —— 只要过了开局预检，**一律调 `cleanupGolden`**（无论第几步失败）；「真没建成」时 `nodeDelete` 的 `NOT_FOUND` + 二次读回会自然落 `ok`；
  ② `status:'none'` **只保留**给「开局预检就 blocked、任何写调用都没发出」的早退路径；
  ③ `ok + recovered` 的文案不得只写「已回收」（那会暗示发生过删除）→ 改成同时覆盖「删除读回一度不一致但二次读回确认无残留**或**本就无残留」；
  ④ 复审另一条 Minor：`matched === null` 的 JSDoc 括号枚举不穷尽（漏「任一轮指令/快照失败」）→ 补全；
  ⑤ 复审另一条 Minor：开局预检的 `sceneTree` 失败被一律报成 `blocked`（`blocked` 的契约文案是「连不上编辑器」）→ 措辞收束成「**读场景失败，无法确认基线**（<code>）」，行为（写前失败、退出码 1）不变。
  如果错了：代价是 cleanup 多一次 `nodeDelete`/`sceneTree`（真机多一次往返）；不做则「绝不谎报」的立意被打破、且残留节点会污染后续 golden 与任务 11/12 的场景。
- **登记**：任务 9 简报/接口总表的 `cleanup` 键集未登记新增的 `confirmed?`（additive）→ 任务 10 若要逐字断言 doctor 级 `cleanup` 键集需知；归任务 10/13。
- 预期测试数：336 + 约 2 → **约 338**；以实际为准，只增不减。

Task 9: fix round 2/5 (F1②①②③④ / F7 / F8 / 不许动清单 全部 ADDRESSED，0 open；复审实跑 golden 16/16; commits 2668cd1..661a622)
Task 9: complete (commits 657316a..661a622, review clean) — **338/338 绿**（336 + 2）

**任务 9 新增的延后 Minor：**
- Task 9: minor (deferred)：`mergeCleanup` 缺 `prev.status === 'failed'` 守卫、且用重建对象而非 `{...next}`（今天不可达，但已 export 供任务 10 复用）→ 建议 `if (prev.status === 'failed') return prev;` + 成功分支 `{...next, status:'ok', ...}`，避免 future「failed 被升级成 ok」或 additive 字段被吞。
- Task 9: minor (deferred)：`test/golden.test.js` 的 `/或本就无残留/` 断言对 `cleanupGolden` 的 `recovered` 分支有**隐性耦合**（若清理改为只看 `del.verified` 会翻红）→ 建议注释点明。
- Task 9: minor (deferred)：`test/golden.test.js` 的用例名「连不上编辑器（从未建过节点）…走『无需清理』」按新语义应改名（现在覆盖的是「**预检就 blocked**」这条 `'none'` 唯一来源）。
- Task 9: minor (deferred)：`isConnectivityFailure` 把 `WRITE_CALL_FAILED` 归为 blocked；`cleanupGolden/runRound/isConnectivityFailure/GOLDEN_STEPS` 死导出；`projectStructure` 保留 `nodeCount` 却排除 `maxDepth`/`otherSceneNames`；`missing-left/missing-right` 两种 kind 经投影路径不可达；`GOLDEN_STEPS` 注释里 R80/R82 归因措辞。
- Task 9: minor (deferred)：计划 `:4598-4671` 仍内嵌 pre-R295 的 `runGolden` 片段（`failedStep` 门 + 「已回收」文案），`:4735` 的 cleanup 键集未含 `confirmed` → 任务 13 回写计划时同步（否则照该片段重放会复现 F1②）。

## 进度总览（更新）

| 任务 | 状态 | 测试数 | 修复轮次 |
|---|---|---|---|
| 1–3 | ✅ complete | 214 / 222 / 231 | 各 1 |
| 4 像素判定 | ✅ complete | 257 | 1 |
| 5 `sprite set` | ✅ complete | 271 | 1 |
| 6 `shot` 接线 | ✅ complete | 277 | 0 |
| 7 `unity play` | ✅ complete | 301 | 1 |
| 8 `asset write` + `compile` | ✅ complete | 322 | 1 |
| 9 `doctor --golden` | ✅ complete | 338 | 2 |
| 10 `doctor --smoke` 写-读回-删 + `--json` 契约 | ⬜ 待执行（**下一任务**） | — | — |
| 11–13 | ⬜ 待执行 | — | — |

**下一任务（10）开工前必须带上的携带项**：① **R202**：T10 的 smoke 片段一律用 T1 定稿的 **`failureText`**（**绝不再用**已删除的 `standaloneFailure`）；② **R205（C4）**：T10 把 smoke 从 3 项改到 7 项**必然打破 `test/doctor.test.js` ≥8 处既有断言**（3 元素状态数组、遍历全结果的 `/无法启动 dispatcher/` 等）→ **必须逐条列出要改的既有断言与其新期望**，不许只说「追加 6 条」；③ **R206③**：`doctor --json --golden` 必须补**形状断言**（T9 明确留给 T10）；④ **T3 遗留带过来**：`lib/scene.js` 的 `__deleted !== true` 子句**零测试防线** → 在 T10 的 smoke 写-读回-删自闭环里补 1 条（写结果 `{"path":"B"}` 缺 `__deleted` → `BAD_SCRIPT_RESULT`、`ok:false`、`intent:{path:null}`、`exitCodeOf===1`）；⑤ T9 的 `cleanup` 新增 additive 键 `confirmed`（只在 `status:'failed'` 上出现）——若 T10 逐字断言 doctor 级 `cleanup` 键集需知；⑥ T9 新增的 `mergeCleanup` 已 export（见其延后 Minor）；⑦ `USAGE_FAILURE_CODES` 冻结数组；⑧ 新 handler 一律体内 require；⑨ 真机用 `S0Project`（编辑器仍在运行），用户真实工程不许碰；⑩ PITFALLS 新条目只追加、不编号（R213）；⑪ **计划有未闭合围栏**：任务 10 简报已由控制者按行号 4784–5173 抽取。

## 任务 10（`doctor --smoke` 写-读回-删自闭环 + `--json` 契约统一）起飞前裁定（控制者）

BASE = `661a622`（338/338 绿）。简报：`task-10-brief.md`（390 行，按计划行号 4784–5173 抽取）。

- **R296（T3 遗留携带项，裁定：本任务内补上）** — 任务 3 的延后 Minor：`lib/scene.js` 的 **`__deleted !== true` 子句零测试防线**（把守卫放宽成 `if (typeof res.parsed.path !== 'string' || res.parsed.path === '')`，`test/scene.test.js` 全绿，而同一输入会产出 `{ok:true, verified:true, actual:{path:'B',deleted:true}}` 的**无证据假绿**）。任务 3 的账本明确指定「任务 10 的 smoke 写-读回-删自闭环会用到 `node delete`，在那里补最自然」。裁定：**在 `test/scene.test.js` 补 1 条**——写结果 `{"path":"B"}`（**缺 `__deleted`**）→ 断言 `code === 'BAD_SCRIPT_RESULT'`、`ok:false`、`intent` 为 `{path:null}`、`exitCodeOf(e) === 1`；把 `test/scene.test.js` 加进本任务的 commit。
  如果错了：代价是 1 条断言；不做则删除命令最危险的那条分支在 M2 收尾时仍无护栏。
- **R297** — 简报步 4 的「总数应为 308」是过期数字。实际基线 **338** → 预期 = 338 + 7（简报 7 条）+ 1（R296）= **346**。以 `npm test` 为准，**只增不减**。
- **R202 落实核对**：简报已在 `lib/doctor.js` 的 smoke 片段里用 `failureText(r, { standalone: true })`（任务 1 定稿的签名），**没有** `standaloneFailure` 残留 → 一致。
- **R205（C4）落实核对**：简报步 1 已给出**逐条**的既有断言改动表（**14 行**，≥8 的要求满足），含 `results.slice(0,3)` 与 `results→checks` 两类改法 —— 实现者必须**逐行**按表改，不许只追加。
- **R206③ 落实核对**：`doctor --json --golden` 的形状断言（`{ok, mode:'golden', matched, diff, cleanup, blocked, lines}`）在本任务补（T9 明确留给 T10）。
- **契约变更（用户已确认）**：`--smoke` **从 M2 起不再只读**（建/改/删 `__pi_smoke`，不保存场景）；`doctor --json` 的顶层键从 `{ok, results}` 改成 **`{ok, mode, checks}`**。USAGE 与 `skills/unity-game-dev/SKILL.md` 必须同步（简报已给逐字文案）。
- **T9 携带**：`cleanup` 新增 additive 键 `confirmed`（只在 `status:'failed'` 上出现）；`mergeCleanup` 已 export。若本任务逐字断言 golden 的 `cleanup` 键集需知。

Task 10 首轮审查（spec ✅ 通过带 3 次要 / code ❌ 需要修复带 **3 重要** + 若干次要）→ 修复循环第 1 轮

- **控制者判定实现者两条疑虑**：① 假后端补 `compile`/`get-logs` 常量响应 = **必要 additive 夹具**（简报逐字用例直连 `be.call`，T9 假后端对未知工具 throw）；② `skip` + `WRITE_LOOP_FAILED` 是**简报自身矛盾**（决策段说 skip ⇒ `NOT_CONNECTED`，实现片段却给具名码）→ 由 R300 统一裁定。
- **R298（重要①，裁定：修）** — code-reviewer：`lib/doctor.js` 的三处写闭环失败文案 `create 未通过：${create.code}${create.message ? … : ''}` 在 **`ok:true + verified:false`**（Unity 改名/钳制数值等**真实可达**路径）时会打出字面 **`undefined`**（`ok()` 信封没有 `message`/`code`），并且**丢掉 `mismatches`**（唯一的证据，在 `readBackAndVerify` 的返回里）。裁定：抽一个 `writeFailMessage(name, e)` 覆盖三分支（pass / `ok:true+verified:false` → 展开 `mismatches` 的 `key=actual` / 真失败 → `code + message`）；补 1 条用例（让 `node-inspect` 回一个与 intent 不一致的 position → 断言文案**不含 `undefined`** 且含分歧 key）。三处同构（create/set/delete）一并改。
- **R299（重要②，裁定：修）** — `lib/doctor.js` 的尾行「冒烟未执行（N 项被跳过）：未能验证任何工具」在本任务后**首次可在“部分 skip”时出现**（create 失败 → set/delete skip；残留阻断 → set/delete skip），此时只读三工具可能全 pass，尾行却是假话（破坏 R45 的「措辞与 `ok` 语义一致」）。裁定：**全 skip** 才打原句；**部分 skip** 另给「N 项因前置步骤失败未执行（这几项未验证）」。既有 `/冒烟未执行（7 项被跳过）/` 断言在全 skip 下仍须绿。
- **R300（重要③，裁定：修）** — skip 项的 `code` 违反已写死的码表（`--json` 消费者会用 `code==='NOT_CONNECTED'` 判「没连上」），且 `lib/doctor.js` 有两处**恒等三元**（`set ? 'WRITE_LOOP_FAILED' : 'WRITE_LOOP_FAILED'`）把「本该分叉」藏起来。裁定：**统一口径为「`status` = 是否执行、`code` = 原因」**——`NOT_CONNECTED` 只留给探活失败的 skip；前置步骤失败产生的 skip 用新码 **`WRITE_LOOP_NOT_RUN`**；恒等三元拆成分支；同步更新 `--json` 契约说明（USAGE/skill 的码表句）并补 1 条断言（前置失败时 skip 项的 `code === 'WRITE_LOOP_NOT_RUN'`）。
- **R301（采纳 code-reviewer 次要④）** — `before.ok === false`（残留预检的 `sceneTree` 读失败）被**静默吞掉**：残留守卫根本没被评估且失败不留痕（无 code/hint）→ 若该失败是瞬时的会带着「可能存在的残留」去 create。裁定：把 `before.code/message` 并进 `write-create` 的 hint（至少「清理前读回失败：<code> <message>」）。
- **R302（采纳 次要⑤）** — `write-clean` 的 pass 丢弃 `after.hint`（`sceneTree` 在 `otherSceneCount>0` 时会给「还有 N 个场景未读」）→ 结论范围被隐去。裁定：pass 分支带上 `after.hint`。
- **R303（采纳 次要⑥）** — `findNodeByName` 递归匹配任意深度，而删除用**根路径**（裸名）→ 若工程里有 `Canvas/__pi_smoke`，会「检测到 → 删不掉 → 每次 `--smoke` 都失败」且手工命令无效。裁定：smoke 的残留/write-clean 检测**限定根层**（`roots.some(r => r.name === SMOKE_NODE)`），与「smoke 只在根建节点」的自有约定一致。
- **R304（采纳 次要⑦⑧，测试卫生）** — ⑦ 项名两份真值（`SMOKE_ITEMS` vs `writeLoopItems`）→ 由一份 `SMOKE_ITEM_NAMES` 派生，并在全 skip 用例里也断言名字；⑧ 5 处 `slice(0,3)` 未同时钉 `length === 7` → 统一补上。
- **R305（采纳 次要⑨，补 3 条守门用例）** — (a) 残留清不掉的提前返回（create fail + set/delete skip + clean fail + 手工命令）；(b) 写闭环 `verified:false`（R298 的路径）；(c) `write-clean` 残留 fail。
- **R306（采纳 code-reviewer 的 💡「`--smoke` 缺 `--project-path` 仍会走到写入」）** — 与 R278 同类：读写路径必须先确定项目根。裁定：**不强加退出码 2**（避免破坏 M1 的 `doctor --smoke` 无 project-path 行为），而是当 `projectPath` 不是非空字符串时，把 4 个写闭环项置 `status:'skip'` + `code:'MISSING_PROJECT_PATH'` + hint（**零写入**），并补 1 条断言。
- **登记延后（Minor，不进循环）**：`sceneTree` 注入缝抛错会冒成退出码 3（建议包 try/catch 收敛）；`writeLoopItems` 的形参名 `callFn` 与全库 `_call` 不一致且缺省静默回落真实 `call`；USAGE 里 `**…**` 星号在纯文本中原样输出；`README.md` 的「--smoke 只读」与「三项」过期（归任务 11/13）；`test/doctor.test.js` 与 `test/golden.test.js` 的 golden 形状覆盖重叠（入口不同，可接受）。
- 预期测试数：346 + 约 7（R298 1 + R300 1 + R305 3 + R306 1 + R299 1）→ **约 353**；以实际为准，只增不减。

Task 10: fix round 1/5 (F1–F10 + 不许动清单全部 ADDRESSED，0 open；复审聚焦实跑 doctor 39/39; commits 191f16a..1bdf1ae)
Task 10: complete (commits 661a622..1bdf1ae, review clean) — **356/356 绿**（346 + 10）

**任务 10 新增的延后 Minor：**
- Task 10: minor (deferred)：部分 skip 的尾行固定写「**因前置步骤失败**未执行」，但 F10 新增的 `MISSING_PROJECT_PATH` 也产生部分 skip（原因是缺参数）→ 措辞在那一场景不精确（不构成假绿，退出码仍 1）。
  - 订正（2026-09-20 R477，批次 A）：`MISSING_PROJECT_PATH` 已改为 **2 档**（退出码不再为 1），见 `docs/HANDOFF.md` §7⑪。
- Task 10: minor (deferred)：`findNodeByName` 被导出但全仓已无调用方（R303 后 smoke 改用 `hasRootNode`）= 死公开面；新的唯一真值 `SMOKE_ITEM_NAMES` 反而不在导出里。
- Task 10: minor (deferred)：残留清理项复用 `writeFailMessage('delete', del)` 后文案出现「上一次的 __pi_smoke 清不掉：**delete 未通过**：…」的双重标签（可读性）。
- Task 10: minor (deferred)：`test/doctor.test.js` 的 `be.nodes.size === 1` 依赖假后端以 path 为 key 的内部实现（夹具耦合，可接受）。
- Task 10: minor (deferred)：`sceneTree` 注入缝抛错会冒成退出码 3（建议包 try/catch 收敛）；`writeLoopItems` 形参名 `callFn` 与全库 `_call` 不一致且缺省静默回落真实 `call`；USAGE 里 `**…**` 星号在纯文本原样输出。

## 进度总览（更新）

| 任务 | 状态 | 测试数 | 修复轮次 |
|---|---|---|---|
| 1–3 | ✅ complete | 214 / 222 / 231 | 各 1 |
| 4 像素判定 | ✅ complete | 257 | 1 |
| 5 `sprite set` | ✅ complete | 271 | 1 |
| 6 `shot` 接线 | ✅ complete | 277 | 0 |
| 7 `unity play` | ✅ complete | 301 | 1 |
| 8 `asset write` + `compile` | ✅ complete | 322 | 1 |
| 9 `doctor --golden` | ✅ complete | 338 | 2 |
| 10 `doctor --smoke` 写闭环 | ✅ complete | 356 | 1 |
| **11 skill 完整版 + 打砖块模板 + USAGE** | ⬜ 待执行（**下一任务**） | — | — |
| 12–13 | ⬜ 待执行 | — | — |

**下一任务（11）开工前必须带上的携带项**：
① ⭐ **计划缺陷（T5 复审发现）**：计划 `:5251-5258` 的模板 tripwire 用 `fs.readFileSync('lib/sprite.js')` 去断言 `/new Rect\(0, 0, 1, 1\)/` 与 `/, 1f\)/`，但这两个字符串实际在 **`unity-scripts/sprite-set.cs:46`**（`lib/sprite.js` 全文不含 `Rect`/`1f`）→ **必须改指 `sprite-set.cs`**，否则照抄计划会假红。
② ⭐ **T5 复审建议**：把「`--count-color` 报 0 就再截一张」的护栏写进**任务 11 的验证配方**（PITFALLS 的错帧条目的代码侧落点）。
③ 任务 5 遗留：`lib/sprite.js` 的 `mismatchHint` 无断言（可在本任务顺手补）；`parseNodeResult` 的 `label` 硬编码。
④ 任务 9/10 遗留：`README.md` 的「--smoke 只读」「三项」等过期文案归本任务（计划 `:5624`）。
⑤ 任务 8：`unity-scripts/templates/PiBrickBreaker.cs` **由本任务创建**（R269 明确留给任务 11）；模板的静态契约测试 `test/template.test.js` 用断言把「游戏脚本依赖的字段名/日志前缀/尺寸约定」与 `lib/sprite.js`/skill 配方钉在一起（约束 18 精神）。
⑥ 任务 7 真机结论：**没有 Input System 的项目里**真实输入不可用 → 模板用「球自动发射 + 挡板默认自动跟随（`autoPaddle = true`）」让「画面在变、分数在涨」不依赖输入注入。
⑦ 任务 6 真机结论：PlayMode 进出不保存场景；`shot --capture-mode rendering` 给 `gameViewWidth/Height` + `screenshotToInputFormula`（坐标基准）。
⑧ 任务 4/5：`unity pixels --region/--count-color --expect` 的判据与 `unity sprite set` 的 1×1 世界单位约定（`localScale` = 世界尺寸）。
⑨ `USAGE_FAILURE_CODES` 冻结数组；新 handler 体内 require；真机用 `S0Project`（编辑器仍在运行），用户真实工程不许碰；PITFALLS 新条目只追加、不编号（R213 → 任务 13）。

## 任务 11（skill 完整版 + 打砖块模板 + USAGE）起飞前裁定（控制者）

BASE = `1bdf1ae`（356/356 绿）。简报：`task-11-brief.md`（513 行，按计划行号 5174–5686 抽取）。这是**用户要求的「unity skill 完整版」**。

- **R307（计划缺陷，必改 —— T5 复审发现）** — 简报步 1 的第 5 条 tripwire 把 `SPRITE` 指向 **`lib/sprite.js`** 并断言 `/new Rect\(0, 0, 1, 1\)/` 与 `/, 1f\)/`，但控制者已核实：`lib/sprite.js` **全文不含** `Rect`/`1f`，这两个字符串实际在 **`unity-scripts/sprite-set.cs:46`**。裁定：把该 tripwire 的读取目标改成 `unity-scripts/sprite-set.cs`（常量可改名 `SPRITE_CS`），**断言不变**；同一条里「skill 必须写明 `localScale = 世界尺寸`」的断言保留（控制者已核实 SKILL.md 目前**没有**这句 → 正是本任务要补的）。
  如果错了：代价是 1 条测试的读取路径；不做则照抄计划**必然假红**（`ENOENT`/断言失败），或实现者为了让测试绿而去改 `lib/sprite.js`（错方向）。
- **R308** — 简报步 4 的「总数应为 313」是过期数字。实际基线 **356** → 预期 = 356 + 5 = **361**。以 `npm test` 为准，**只增不减**。
- **R312** — 真机步的 `/tmp/before.md5` 改到仓库内 `.superpowers/sdd/2026-09-19-pi-unity-m2-implementation/tmp/`（R212）。
- **R313（清理二选一 → 钉死为「删」）** — 简报允许「删掉 27 个节点 + 脚本资产」或「留着并注明」。裁定：**删掉**（本次建的 27 个节点 + `Assets/PiBrickBreaker/`），并**验证**：`unity scene tree` 里不再有它们、`unity compile` 回到 `errorCount:0`。理由：S0Project 是后续复验（含任务 13 的文档对账、以及任何重跑 golden/smoke）的基准场景，留 27 个探针节点会让「首个分歧路径」类结论不再可复现。报告里必须明确写出删了什么、验证结果。
- **R314（T5 复审建议落地）** — 把「`--count-color` 报 0 就**再截一张**（可能是暂停在旧帧/错帧）」这条护栏写进 SKILL 的**验证配方**里（有代码侧落点，不是散文）。它对应 `docs/PITFALLS.md` 的错帧条目（任务 5 观测：首张截图整块 `#00FFFF`、未复现）。
- **R315（文档携带项落地）** — 本任务同时更新 `README.md`（状态：M2 命令表 / 测试数 / `--smoke` 不再只读 / 去掉「三项」与「M1 已交付」的过期表述）与 `bin/unity.js` 的 USAGE 汇总 M2 命令（简报文件清单已含这两项）。任务 9/10 账本里登记的 README 过期文案（`:36`/`:41`/`:63` 等）在此收口。
- **模板进仓库前的静态检查**：简报步 4 给了 `node -e` 的静态检查（类名唯一、无 `static` 局部函数等）——必须真跑并把输出写进报告（`.cs` 在本仓库**无法编译**，静态契约测试是唯一的防线，约束 18 精神）。
- **格式/口径沿用**：`USAGE_FAILURE_CODES` 冻结数组；新 handler 体内 require；真机只用 `S0Project`（编辑器仍在运行），**用户真实工程一律不许碰**；`docs/PITFALLS.md` 新条目只追加、不编号（R213 → 任务 13）。

Task 11 首轮实现（DONE_WITH_CONCERNS，commit `334e4a5`，361/361 绿）—— 控制者**审查前**裁定（三条疑虑都关乎正确性）：

- **控制者已独立复核疑虑③（`componentsLut`）**：从 `S0Project/.uloop/outputs/HierarchyResults/` 的**真实导出**里确认——**扁平的 25 节点**场景是逐节点 `components` 内联形；**嵌套的 27/29 节点**场景是 `Hierarchy[0].componentsLut = [...]` + 逐节点 **`componentsIdx`**（无 `components` 键），`normalizeHierarchy` 只读 `n.components` → 这些场景的 `components` 全变 `[]`。**这不止影响 golden**：**用户真实工程（几百节点）每次 `scene tree` 都会丢组件维度**，直接违反 Q2「兼容用户真实 Unity 工程」与约束 6 的意图。模板自带的 `componentsIdx` 证据也表明翻转点**不是纯节点数**（25 节点两种形状都出现过）。
- **R316（.cs 之外的核心读取路径缺陷，裁定：本任务内修）** — 在 `lib/scene.js` 的 `normalizeHierarchy` 里解析**两种形状**：优先 `componentsLut` + `componentsIdx`（索引 → 名字），否则回退 `n.components`；两处 `walk` 分支（含深度超限分支）都要覆盖；`null`/越界索引/非数组一律按空数组且**不抛**（与 R71 的宽容口径一致）。补测试：① LUT 形（照真实导出形状造）；② 内联形（既有）；③ LUT 缺 `componentsIdx` / 索引越界 / LUT 不是数组的畸形输入。并更新 `docs/PITFALLS.md` 那条目（把「这是本 CLI 待修项」改成「已由本提交修复」）。
  **必须真机复验**：用你会话里已有的搭场景配方重建 ≥27 个嵌套节点 → `unity scene tree --json` 断言组件非空（例如 `Bricks/Brick_0_0` 的 components 含 `SpriteRenderer`）→ 再按 R313 清理。若脚本已丢，重建一次（代价几分钟）——这是本修复唯一的决定性证据。
  如果错了：代价是 ~15 行 + 3 条断言；不做则**用户真实工程的 `scene tree` 恒缺组件**，且任务 12 的盲测 agent 会看到 `components: []` 而被误导。
- **R317（接受偏离）** — 简报的模板逐字稿有**致命缺陷**：EditMode 里 `sprite set` 挂的 sprite 是**运行时对象**，进 PlayMode 的 domain reload 会销毁它（`spriteName→null`）→ 按简报逐字跑**一块砖都不渲染**。实现者在模板里加 `EnsureSprites()`（运行时给缺 sprite 的 `SpriteRenderer` 补 1×1 白 sprite/PPU=1f）是**必要且最小的**功能偏离，有真机 + 变异证据支撑。**接受**，并要求 SKILL 里的警告保留（已确认 SKILL `:271-279`/`:352` 写了）。
- **R318（接受偏离）** — SKILL §8 ③ 的「固定单点采样 480,600」实测两张图都是背景色（会误判「画面没变」）→ 改成按颜色计数。**接受**（判据必须给「公式 + 实测值」，固定点是错的证据）。
- **R319** — R314 已落地（SKILL 的验证配方里有「`--count-color` 报 0 就再截一张」，SKILL `:385`）。
- 预期测试数：361 + 约 3 → **约 364**；以实际为准，只增不减。

Task 11 首轮审查（spec ❌ 需要修复（2 重要）/ code ❌ 需要修复（3 重要））→ 修复循环第 1 轮

- **R320（重要①②，两位审查者都提）** — `63fe527` 修好 `normalizeHierarchy` 之后，`skills/unity-game-dev/SKILL.md` **仍有两处**写「`scene tree` 的 `components` 在节点较多时**本 CLI 未解析 → 恒为空数组 `[]`**」（§7 常见错误表 `:353` 与 §8 ① `:369-370`）——与同提交的 `PITFALLS`「已修复」自相矛盾。**SKILL 是任务 12 盲测 agent 唯一读物**，按字面读会让它**主动不信**正确的 `components` 输出（等于把刚修好的能力在文档层作废）。裁定：两处改为「组件**短名**以 `scene tree` 的 `components` 为准（两种形状都已解析，含 LUT 形）；但组件的**属性**（颜色/sprite/position）`scene tree` 里没有，仍须 `node inspect`」；§7 那行的症状与出路同步改。**必须在任务 12 之前修**（这正是 R316 的裁定理由）。
- **R321（重要②，采纳 spec 重要 2 / code ②）** — `README.md:59` 的测试数仍写 `361/361`，而 HEAD 是 **364**（`63fe527` +3）。R315 明确把「测试数」列为本任务必交内容。裁定：改成 `364/364`。
- **R322（重要③，采纳 code 重要 ③）** — 约束 18 的 tripwire **只钉住一半**：模板侧的几何常量有断言（`HalfWidth=6f`/`0.8f`/`0.25f`/`0x0A,0x0A,0x14`），但 **SKILL 那一侧的数字没有任何断言**（第 4 条只 `includes` 了 `Bricks`/`Paddle`/… 这些 token）→ 有人把 SKILL 里砖块 scale 从 `(1.6, 0.5, 1)` 改成 `(2.0,0.5,1)` 时测试**全绿**，而模板的 AABB 立刻与可见方块错位（球在空气里反弹）。裁定补 2 组断言：① 第 4 条加 SKILL 侧几何 token（`(1.6, 0.5, 1)` / `(2.4, 0.35, 1)` / `(0.4, 0.4, 1)` / `(0, -4.2, 0)` / `(0, -3.2, 0)` / `(col - 2.5) * 1.85` / `orthographic size = 5`）；② 第 3 条把裸正则改成**锚定常量**（`BrickHalfWidth\s*=\s*0\.8f` 等，且补 `PaddleHalfWidth=1.2f`/`BallHalfSize=0.2f`/`PaddleY=-4.2f`/`BallStartY=-3.2f`/`HalfWidth\s*=\s*6f`）。
- **R323（采纳 code 次要 ④）** — `lib/scene.js` 的 LUT 分支「有 LUT 就完全放弃内联 `components`」→ 混合形（LUT + 个别节点内联）会把那批节点的组件静默变 `[]`（与 R316 要消灭的假阴性同类）。裁定：改成**逐节点降级**——`lut && Array.isArray(n.componentsIdx)` 才走 LUT，否则回退 `Array.isArray(n.components) ? n.components : []`；补 1 条「LUT 存在 + 该节点无 `componentsIdx` + 有内联 `components` → 回退内联」用例（保留「两者都在时以 LUT 为准」的已测语义）。
- **R324（采纳 code 次要 ⑤）** — `lib/scene.js` JSDoc 写「实测 27 节点起」，但 `docs/PITFALLS.md` 的表明确「25 个节点两种形状都出现过」「翻转点未逐点逼近、阈值未定稿，别依赖它」。裁定：JSDoc 改成「较大/嵌套场景（实测 **25 节点已出现**；阈值与序列化体积相关，**未定稿、勿依赖**）」。
- **R325（采纳 code 次要 ⑦）** — 模板的 `public float mouseFollowLerp = 18f` **声明后从未被读** = 死公开 API（模板头注释还鼓励用公开字段做实验，盲测 agent 设了会毫无效果）。裁定：**在 `InputTarget()` 的鼠标分支里真正用它**（`Mathf.Lerp` + `Time.deltaTime` 平滑），让字段诚实；模板行为会有轻微变化 → 在报告里注明（任务 12 会重新验证）。
- **R326（采纳 code 次要 ⑧）** — 模板用 `localPosition` 与世界空间常量（`HalfWidth/HalfHeight/PaddleY`）混算 → 只在「节点都在世界原点」时成立。裁定：在字段/方法注释里**显式写明该假设**（「本参考实现假设关卡根在世界原点、只用 localPosition；移动关卡根会失效」）。
- **R327（采纳 code 次要 ⑨）** — `README.md` 把「E2E 盲测」列进「划入 M3」，但它是 **M2 的任务 12**。裁定：改成「尚未实现：`unity build`（M3）」+ 盲测标注为 M2 进行中。
- **R328（采纳 code 次要 ⑥）** — `/0\.8f/`、`/0\.25f/` 无锚定（`10.8f` 也会命中，且常量改名后断言仍绿）→ 并入 R322 的锚定改写。
- **登记延后（Minor，不进循环）**：`FindObjectsOfType<SpriteRenderer>()` 不含未激活对象（若砖块预先 `active:false`，`RestoreBricks` 后仍无 sprite）；`HalfWidth=6f` 与 960×640+ortho5（半宽 7.5）不自洽（左右各留 1.5 单位黑边，玩法无碍，SKILL 未写场地尺寸）；`SKILL.md:204` 的「超出 M1 范围」残留（已在 M1 账本登记 → 任务 13）。
- 预期测试数：364 + 约 3（R322 1 + R323 1 + 可能 1）→ **约 367**；以实际为准，只增不减。

Task 11: fix round 1/5 (F1 / F2 / F3① / F3② / F4 / F5 / F6 / F7 / F8 + 不许动清单全部 ADDRESSED，0 open；复审静态计数 366 与全量一致、F3/F4 的变异靶点判断成立; commits 63fe527..95ec92c)
Task 11: complete (commits 1bdf1ae..95ec92c, review clean) — **366/366 绿**（364 + 2）

**任务 11 新增的延后 Minor（**必须在任务 12 的盲测之前修** —— SKILL 是盲测 agent 唯一读物）：**
- ⭐ Task 11: minor (deferred) **【前置修复项】**：`skills/unity-game-dev/SKILL.md:353`（§7 常见错误表那行）的**出路逻辑反了**——写「两者都不为空才算异常」，正确应为「`node inspect` 有、`scene tree` 没有（两者**不一致**）才算异常」；同行的**原因②**「上游形状异常」与括号里「本 CLI 都已解析」自相矛盾 → 应改成「② 上游出现**第三种**未知形状（已知两种都已解析）」或删掉。复审给了逐字建议措辞。
- Task 11: minor (deferred)：`test/template.test.js` 的 F6 断言（行内含 `mouseFollowLerp` + `Mathf.Lerp` + `Time.deltaTime`）一句注释也能满足 → 更硬可断言 `Mathf.Lerp\(\s*_paddle\.localPosition\.x\s*,\s*mouseX`。
- Task 11: minor (deferred)：`test/scene.test.js` 的畸形用例注释仍写「`componentsIdx` 不是数组 → `[]`」，R323 后实际是「回退内联、无内联才 `[]`」（断言结果不变）。
- Task 11: minor (deferred)：SKILL 侧 token 与模板常量是**两侧各自独立**钉住（无「2.4/2 → 1.2」的推导断言）→ 两侧同时改错仍全绿（该 tripwire 形态的固有上限）。
- Task 11: minor (deferred)：`lib/scene.js` 的 `componentsIdx: []`（合法空数组）+ 内联 `components` 并存时走 LUT 得 `[]`（F4 指定条件的直接结果，上游未观察到此混合形）。
- Task 11: minor (deferred)：模板 `FindObjectsOfType<SpriteRenderer>()` **不含未激活对象**（若砖块预先 `active:false`，`RestoreBricks()` 后仍无 sprite）；`HalfWidth=6f` 与 960×640+ortho5（半宽 7.5）不自洽（左右各留 1.5 单位黑边，玩法无碍，SKILL 未写场地尺寸）；`SKILL.md:204` 的「超出 M1 范围」残留 → 任务 13。
- Task 11: minor (deferred)：`.superpowers/.../tmp/scene.js.r316bak` 备份文件未删（未跟踪目录，卫生问题）。

## 进度总览（更新）

| 任务 | 状态 | 测试数 | 修复轮次 |
|---|---|---|---|
| 1–3 | ✅ complete | 214 / 222 / 231 | 各 1 |
| 4 像素判定 | ✅ complete | 257 | 1 |
| 5 `sprite set` | ✅ complete | 271 | 1 |
| 6 `shot` 接线 | ✅ complete | 277 | 0 |
| 7 `unity play` | ✅ complete | 301 | 1 |
| 8 `asset write` + `compile` | ✅ complete | 322 | 1 |
| 9 `doctor --golden` | ✅ complete | 338 | 2 |
| 10 `doctor --smoke` 写闭环 | ✅ complete | 356 | 1 |
| 11 skill 完整版 + 打砖块模板 | ✅ complete | 366 | 1 |
| **12 E2E 盲测（最后一关）** | ⬜ 待执行（**下一任务**） | — | — |
| 13 文档收尾 | ⬜ 待执行 | — | — |

**下一任务（12）开工前必须带上的携带项**：
① ⭐ **前置修复（T11 复审的 2 条 SKILL Minor）必须在盲测开始前落地**：`SKILL.md:353` 的出路逻辑反了 + 原因②自相矛盾 —— SKILL 是盲测 agent 唯一读物。
② **盲测协议（计划 `:5712` 起，逐字）**：只有**新项目**才允许（S0Project 已含全部真机探针痕迹，不可用于盲测）；协议要求**执行者逐字满足**、**控制者独立复核四条判据**（不看盲测 agent 自述）。
③ 计划 `:5742`：需要 `tar`（Git Bash/MSYS 自带或 Windows 10+ bsdtar）——**没有就停手**，别猜工具。
④ 计划 `:5746`：装 uloop 包走 **codeload vendor**（不走 OpenUPM，U1）。
⑤ 计划 `:5752`：`uloop launch` 起不了团结引擎 → 手动启动 `Tuanjie.exe -projectPath <新项目>`（U6）；首次编译 44 asmdef 约 1–3 分钟。
⑥ 计划 `:5762`：四条验收判据由**控制者独立复核**；`:5796`：盲测暴露的问题回写方式（新坑先追加 `docs/PITFALLS.md` 末尾、不写 U 编号，R213）。
⑦ 真机环境：`PI_UNITY_ULOOP_BIN=C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe`；编辑器当前打开的是 S0Project —— 盲测需要**另一个项目**，要注意编辑器实例/端口与 S0Project 的冲突（`uloop list` 的 project-runner 是**按项目**的）。
⑧ 任务 8 的 `asset write --template PiBrickBreaker` 现在**真正可用**（T11 已创建模板）；任务 7 的真机结论：无 Input System → 真实注入不可用，模板靠 `autoPaddle` 自动跑。

## 任务 12（E2E 盲测）执行计划（控制者，BASE = `95ec92c`）

**前置核实（已做）**：模板 `cn.tuanjie.template.2d-7.0.4.tgz` 存在（17.5 MB）；`tar` = GNU tar 1.35；vendor `uloopmcp` 存在；盲测项目 `C:/Users/<用户>/pi-unity-m2-blind` **尚不存在**（可从零新建）。

**执行拆解（控制者编排）**：
1. **T11 的 2 条 SKILL Minor 前置修复**（`SKILL.md:353` 的出路逻辑反了 + 原因②自相矛盾）—— 盲测前必须落地（SKILL 是盲测 agent 唯一读物）。包含在任务 12 的 diff 范围内（BASE = `95ec92c`）。
2. **写 `docs/E2E-ACCEPTANCE-m2.md`**（协议 §0 + 四条判据 §1 + 回写流程 §3，逐字用简报内容）+ 真实执行记录 §2.1/§2.2/§2.3/§2.4/§2.5 边跑边填。
3. **准备干净项目**（解包 → manifest 加 `file:` uloop 依赖 → 启动编辑器 → `doctor --smoke` 七项全 pass → `scene tree` 只有一个 `Main Camera`）。
4. **派盲测子代理**（只给 SKILL.md + PITFALLS.md + 项目路径 + 命令路径 + 环境变量；产出 `.superpowers/e2e-m2-blind-report.md`；**执行中途不给提示**）。
5. **独立复核四条判据**（不信盲测 agent 自述）——由**另一个**与盲测无关的子代理按 §1 表逐条跑并落盘原始证据，控制者抽读关键行。
6. **按 §3 回写**（分类 A/B/C/D → 出证据 → PITFALLS 追加无编号条目 → 重跑判据）。
7. **Commit**（`docs/E2E-ACCEPTANCE-m2.md` + `docs/PITFALLS.md` + `skills/unity-game-dev/SKILL.md`）。

⚠️ 两个引擎同时开（S0Project + blind）会占 ~3.6 GB；若 blind 项目连接异常，**允许关掉 S0Project 的编辑器**（记录之）——S0Project 在任务 13 不需要编辑器。

## 任务 12 盲测结果（控制者编排，2026-09-19）

- **准备**：`5d19c01`（SKILL §7 组件排障行修正）+ `afad854`（协议文档 + 干净项目准备）+ `2ed5101`（打开模板场景并验证 PlayMode）。盲测项目 `C:/Users/<用户>/pi-unity-m2-blind`：`doctor --smoke` 7/7、`scene tree` 只有 `Main Camera`、`sceneName=SampleScene`、PlayMode 进出 md5 一致（`a64105b6…`）。
- **盲测子代理（全新，只给 SKILL.md + PITFALLS.md + 项目路径 + 命令路径 + 环境变量）**：状态 **DONE_WITH_CONCERNS**，118 条 `unity` 命令 / 117 条退出码 0（唯一非 0 是 `play key` → `INPUT_SYSTEM_UNAVAILABLE`，SKILL 预期内），**全程零裸 uloop**，搭出 29 节点，PlayMode 闭环成功，四条目视全见（4 行砖阵 / 青色挡板 / 白球 / 左上角 SCORE）。报告：`.superpowers/e2e-m2-blind-report.md`（247 行）。
- **控制者派独立复核者（expert，与盲测无关）**：四条判据**全部 PASS**，并 `read` 打开渲染图确认为「4 行砖 + 青色挡板 + 白球 + 左上 SCORE 1 LIVES 3 BRICKS 23」（图 B：SCORE 17 / BRICKS 7），与盲测自述逐字一致（无假绿）。判据数字：砖色 `#FF2E88/#FFE94A/#4DFF7A` 各 19648、`#FF7A2E` 16352、`#00FFC8` 3366、`#FFFFFF` 676、背景 `rgb(10,10,20)` distance=0；日志 `ready bricks=24` + 17 条 `hit brick=`；Error `totalCount=0`；`--smoke` 7/7；`--golden` `matched:true`/`cleanup ok`；`__pi_` 残留 0。
- **盲测暴露的 5 条缺口（待回写分类）**：
  1. ⭐ **`execute-dynamic-code` 在 `unity` 命令面上不存在**，但 SKILL §8③ 让 agent 用它读回 `score`/`bricksAlive` → agent 被逼向「裸 uloop」（规则 5 禁止）；CLI 自己的 hint 也指向同一被禁兜底。→ **A（skill 指了不存在的路）+ B（CLI 缺 `unity exec` 能力）**。
  2. **没有 `scene save` / `scene open` 命令** → 交付物能否落盘无法验证（准备阶段 P1）。→ **B（CLI 缺能力）+ A（skill 没说先确认已保存场景）**。
  3. **`pixels` 没有 diff；且「count 相同 ≠ 没动」**（挡板两次都是 3366 却位移 526 px）→ SKILL §8 必须写「用 `--at`/`--region` 采样或质心证位移，别只看 count」。→ **A**（+ 可选 B：`pixels --diff`）。
  4. **§3.5 的 24 次 `sprite set` 是注释不是可复制循环** → agent 得自己写循环。→ **A**。
  5. 次要：报告/HUD 命名口径不够明确。
- **待办的 CLI 缺口（B 类，§3 要求新开任务而非本任务顺手改）**：`unity exec`（动态 C# 执行）与 `unity scene save/open` —— 登记为 **M3 候选**（连同任务 8 的 `unity build`），不进本任务的 commit。

Task 12 首轮审查（spec ❌ 需要修复（1 重要）/ code ❌ 需要修复（3 重要））→ 修复循环第 1 轮

- **R329（重要①，两位审查者都提 —— 与本次回写要修的 G1 同类）** — 改写后的配方指向**不存在的字段名 `meanColor`**：`SKILL.md:430`「比 `actual.meanColor`」、`PITFALLS.md:919`「比返回的 `rgb`/`meanColor`」、`PITFALLS.md:989`「`--region --expect/meanColor`」。真值：`lib/pixels.js` 返回 `actual.at = {x,y,color}` / `actual.region = {x,y,width,height,color}`，`color` 是 `{r,g,b,a}`（`lib/png.js` 的 `averageColor`）；全仓 grep `meanColor` 除这三行文档外零命中。→ **把 `execute-dynamic-code` 换成了另一个不存在的东西**。裁定：三处统一改成 `actual.at.color` / `actual.region.color`（附「形状为 `{r,g,b,a}`」）。
- **R330（重要②，裁定：修）** — `SKILL.md:428-429` 的 `--at 480,525` 是**球的出生点**，而同行规则要求采样「图 1 里对象所在的坐标」；图 1 是在开局十几秒后截的，球（半径 12.8 px）早已离开（真机数据：图 A 球心 `(650,300)`、图 A′ 球心 `(497,501)`，距出生点 29.4 px > 12.8）。照抄该示例 → 两张图都采到背景 → 得出「球没动」的**假阴性**（正是同行护栏要防的镜像错误；task-11 也踩过一次 `480,600` 的同类坑）。裁定：改成「先在**图 1**里用 `read` 找到球/挡板的像素坐标，再对**那个坐标**在两张图上各采样一次」，并把 `--region 400,560,160,60`（挡板，跨图均色）提为主判据；若保留坐标示例，注释必须写明「这是出生点，图 1 时通常已离开」。
- **R331（重要③，裁定：恢复）** — `SKILL.md` §5 **被误删**一条与盲测无关的既有停止条件：`- **改 Build Settings / Player Settings / `Packages/manifest.json`**（包依赖、目标平台、场景列表）`（`95ec92c` 有、HEAD 无；全仓 grep 该三词 0 命中）。它是「改配置文件/包依赖前必须先问用户」的唯一书面约束（M2 命令面无包安装命令，agent 最可能的动作正是编辑 `Packages/manifest.json`）→ 违反简报「只改盲测暴露的真问题」。裁定：**恢复该行**，与新加的「在编辑器里打开/保存场景」条并列。
- **R332（次要④，采纳 code 次要 4）** — `SKILL.md` 的 `node inspect` 能力描述偏窄：写「读不到脚本**私有**字段」，实际 `node-inspect.cs` **任何脚本字段（公有私有）都读不到**，且 `position`/`scale` 是**局部**坐标。改成「只读得到 Transform 与 SpriteRenderer 的字段 + 组件短名；脚本字段（无论公有私有）都读不到；`position`/`scale` 是局部坐标」。
- **R333（次要⑤）** — `SKILL.md:421`「日志（唯一的状态读回路径）」绝对化 → 限定为「运行期**脚本状态**的唯一读回路径」（`play status`/`pixels`/`node inspect` 也是读回，只是读别的层）。
- **R334（次要⑥）** — `E2E-ACCEPTANCE-m2.md` §2.5 对 A① 的描述含「+ `node inspect` 可读字段」，但 SKILL §8③ 的证据步骤里 `node inspect` 只出现在能力限制说明中 → 删掉该短语或改注「（并说明 node inspect 读不到脚本字段）」。
- **R335（次要⑦）** — `E2E-ACCEPTANCE-m2.md` §2.2 把 **G2** 标成「count 相同 ≠ 没动」，而盲测报告 `:190` 的 G2 标题是「两张渲染图逐像素差在 `unity pixels` 里没有对应子命令」（后者在本文件登记为 B3）→ 注明「本文档按结论重排了 G2 的两半」或拆开引用。
- **R336（次要⑧）** — `PITFALLS.md` 新条目的「不要调裸 uloop」禁令需与既有 U8（指导用裸 `execute-dynamic-code` 加监听器）隔离 → 在新条目处理里补一句「本条只针对**运行期状态读回**；U8 等场景仍按原条目走裸 uloop」。
- **R337（次要⑨）** — `E2E-ACCEPTANCE-m2.md:43` 的 `docs/CAPABILITIES §1` 是**失效路径**（实际文件名 `docs/CAPABILITIES-tuanjie-2022.3.62t9.md`）→ 补全文件名（该行逐字继承自简报，属计划强制）。
- **R338（次要⑩）** — `SKILL.md` §7 新增两行的出处列格式不统一（`**U16 / §8③**` vs 其它纯编号）→ 编号列只留 `**U16**`／`**U17**`，出处并入第二列。
- **R339（次要，spec 的协议缺口）** — `E2E-ACCEPTANCE-m2.md` §0 的准备步骤止于 `doctor --smoke`，照 §0 逐字重跑**必然**重踩「未命名场景 → `play start` 失败」的坑（补做步骤只写在 §2.1⑦）。裁定：在 §0 准备块末尾加一步「`scene tree --json` 确认 `sceneName` 非空；空串则先打开并保存 `Assets/Scenes/SampleScene.scene`」，并指向 §2.1⑦。
- **R340（次要，spec 次要 3）** — §2.1 多条命令用 `...` 省略路径无法照抄 → 在 §2.1 开头给出 `$T`/`$B`/`$X`/`PI_UNITY_ULOOP_BIN` 四个完整值一次。
- **登记延后（Minor，不进循环）**：判据 4 的通过线「每张图都附 read 结论」与本次图 3「未单独目视」的口径风险（后续盲测简报宜写成硬约束并要求 `cmdlog` 覆盖全部命令）；`.superpowers/.../tmp/task-12-prep2-open-scene.cs` 未入库（文档已内联，可复现性不受影响）。
- 本轮**只改文档**（SKILL.md / PITFALLS.md / E2E-ACCEPTANCE-m2.md），测试数仍 **366**。

Task 12: fix round 1/5 (F1–F12 + 不许动清单全部 ADDRESSED；**但引入 1 条新的 Important**; commits d84feb9..0ac9623)

- **R341（第 2 轮必改：F2 的补丁本身复现了它要防的假阴性）** — 复审实证：被提为「主判据」的 `--region 400,560,160,60` 是**按复核者的图**（挡板 x 417–567）标定的，而**盲测自己的图 1/图 2** 的挡板分别在 x≈661–815 / x≈135–289（宽 2.4 世界单位 ≈153.6 px）→ **两个区域都不相交** → 两图区域均色都等于背景 `#0A0A14` → 照抄得「没位移」（正是同段护栏要防的镜像错误）。裁定：**主判据改成从图 1 派生的占位符**（如「在图 1 里 `read` 出挡板 bbox → `--region <x−77>,<y>,160,22`」），若保留具体数字必须**逐字标注**「按哪两张图标定；换图/换分辨率必须按图 1 的 bbox 重取；分辨率不匹配会 `BAD_REGION`(2)」。
  如果错了：代价是一段文案；不做则盲测配方会**主动教出错误结论**。
- **R342（Minor，采纳复审 Minor 1）** — `SKILL.md` 引用 `图 A`/`图 A′` 但这两个标签只在 `docs/E2E-ACCEPTANCE-m2.md` 定义 → 改成自足表述（如「独立复核图（960×640）：球心 `(650,300) → (497,501)`」）或标注出处文件。
- **R343（Minor，采纳复审 Minor 2）** — `E2E-ACCEPTANCE-m2.md` 的「`...` 均指这四个完整值」声明过宽（转录输出里的路径省略不是这四个值）→ 改为「作为**参数占位**的 `...`…；转录输出里的 `...` 是路径省略」。
- **登记延后（Minor，进任务 13）**：`SKILL.md:34`「运行期状态只能从 `play logs`/`node inspect` 读」与 F4/F5 口径的轻微冲突（应区分「对象状态」vs「脚本字段」）；`PITFALLS.md:885`「组件属性…用 `node inspect`（走 `execute-dynamic-code`）」的同类误导残留；`bin/unity.js:104` 的失效路径 `见 docs/CAPABILITIES`；三处图标签命名不统一（图A/图B vs 图 A/图 A′）。

Task 12: fix round 2/5 (F1/F2/F3 + 不许动清单全部 ADDRESSED，0 open；核心假阴性路径已由「图 1 派生占位符」堵死; commits 0ac9623..c445ec8)
Task 12: complete (commits 95ec92c..c445ec8, review clean) — **366/366 绿**（本轮全部为文档改动）

**任务 12 的延后 Minor（**并入任务 13 的文档收尾**）：**
- ⭐ Task 12: minor (deferred)：`SKILL.md` §8③ 保留的示例数字 `417,578,160,22` **未点名标定用的图**（写「某两张特定图」+ 自指的「下述这组」）→ 应点名 `m2-verify-12-rerun` 的 `图A'`（`Rendering_20260919_135641_893.png`，960×640，挡板 417–567）。
- Task 12: minor (deferred)：`SKILL.md` §8③ 的「分辨率不匹配会 `BAD_REGION`（退出码 2）」应加条件——**分辨率更小**导致越界才 2；**更大**不报错、只会静默采错位置（`lib/pixels.js` 的越界判定）。
- Task 12: minor (deferred)：`E2E-ACCEPTANCE-m2.md` §2.1 的「转录输出里的 `...` 是路径省略」全称过宽（反例：`ps` 列省略、JSON 字段省略）→ 改成「内容省略（多为路径…）」；并恢复「**本节**各命令中」的作用域。
- Task 12: minor (deferred)：`SKILL.md` 的「挡板宽 ≈160 px」「左边界 = x₀ − 80」偏大（真值 2.4×64 = 153.6 px、半宽 ≈77；实测 150–152 px）。
- Task 12: minor (deferred)：`PITFALLS.md` 新条目处理第 2 条只写「固定**点**」，未含「固定**区域**」（与 SKILL 口径差一档）；`E2E` 图 B 行未记录 `#00FFC8` 计数而 PITFALLS 断言两图均 3366。
- Task 12: minor (deferred)：`SKILL.md:34`「运行期状态只能从 `play logs`/`node inspect` 读」与 F4/F5 口径冲突（应区分「对象状态」vs「脚本字段」）；`PITFALLS.md:885`「组件属性…用 `node inspect`（走 `execute-dynamic-code`）」的同类误导残留；`bin/unity.js:104` 的失效路径 `见 docs/CAPABILITIES`；三处图标签命名不统一。

## 进度总览（更新）

| 任务 | 状态 | 测试数 | 修复轮次 |
|---|---|---|---|
| 1–3 | ✅ complete | 214 / 222 / 231 | 各 1 |
| 4 像素判定 | ✅ complete | 257 | 1 |
| 5 `sprite set` | ✅ complete | 271 | 1 |
| 6 `shot` 接线 | ✅ complete | 277 | 0 |
| 7 `unity play` | ✅ complete | 301 | 1 |
| 8 `asset write` + `compile` | ✅ complete | 322 | 1 |
| 9 `doctor --golden` | ✅ complete | 338 | 2 |
| 10 `doctor --smoke` 写闭环 | ✅ complete | 356 | 1 |
| 11 skill 完整版 + 打砖块模板 | ✅ complete | 366 | 1 |
| 12 E2E 盲测 | ✅ complete | 366 | 2 |
| **13 文档收尾** | ⬜ 待执行（**下一任务，最后一个**） | — | — |

---

## 交接备忘（任务 13 + 最终审查，新会话从这里继续）

**工作树**：`C:/Users/<用户>/.pi/agent/git/<内部 git 服务器>/pi/pi-unity-m2`，分支 `m2-impl`，HEAD `c445ec8`，`npm test` = **366/366 绿**，工作树干净。基线：M2 计划起点 `40c898b`；M1 起点见 M1 账本（`pi-unity-m1` 分支 `m1-impl@8c27e58`）。

**任务 13 的简报必须手工抽取**（计划有未闭合围栏，`scripts/task-brief` 对任务 8+ 完全失效）：
`sed -n '5833,$p' docs/superpowers/plans/2026-09-19-pi-unity-m2-implementation.md > .superpowers/sdd/2026-09-19-pi-unity-m2-implementation/task-13-brief.md`

**任务 13 已知必做（R213 + 各任务登记）：**
1. **PITFALLS 编号定稿**：M2 新增条目**从 U16 起**（若 U16–U20 已被真机发现占用则顺序后移）；把任务 7/8/12 追加的**无编号**条目 + 任务 13 自己的新条目一并编号；更新**索引表**；把 `SKILL.md` §7 表里引用的预留号（**U16/U17**）与最终编号对齐。
2. **修计划的未闭合围栏**（任务 7 区段缺一个 ```）—— 修完计划行号会整体 +1，**注意已登记的行号引用会平移**。
3. **规格偏差表**（计划要求）+ `README.md` / `docs/CAPABILITIES-*.md` 的对账（CAPABILITIES 仍标 golden 复杂场景 `[未验证]`、`--smoke` 三项等）。
4. **`plan :4598-4671` 的 pre-R295 `runGolden` 片段**、`:4735` 的 cleanup 键集（缺 `confirmed`）、`:3096` 的旧 from 守卫、`USAGE_FAILURE_CODES` 写成 `Set` 的三处 —— 全部按实现回写（否则照计划重放会复现已修的缺陷）。
5. **任务 12 的 6 条延后 Minor**（见上，含 §8③ 示例图标定、`BAD_REGION` 条件句、`...` 措辞、挡板半宽 77 vs 80、`PITFALLS` 固定区域口径、`SKILL.md:34` 与 `bin/unity.js:104`）。
6. 任务 11 遗留：`SKILL.md:204` 的「超出 M1 范围」残留、`test/template.test.js` 的 F6 断言可更硬、`test/scene.test.js` 的畸形用例注释；任务 10 遗留：部分 skip 尾行措辞、`findNodeByName` 死导出、`writeLoopItems` 形参名、USAGE 星号；任务 9 遗留：`mergeCleanup` 守卫、test 用例名、死导出；任务 5 遗留：`mismatchHint` 无断言、`parseNodeResult` 的 label 硬编码；任务 8 遗留：编译失败透传丢 `actual`/`phase`、message 措辞、合法 timeout 无 tripwire；任务 4 遗留：`pixels` 的 `actual.at ? … : …` 脆性、缺 IDAT 断言强度。

**然后走 SDD 的收尾**：
- **最终整分支审查**（最强模型）：`scripts/review-package <计划> <MERGE_BASE> HEAD`（MERGE_BASE = `git merge-base main HEAD`；本分支基线见上），把账本里**所有**「延后 Minor」与「已搁置」条目交给它甄别哪些必须合并前修；用 `requesting-code-review` 的 `code-reviewer.md`。
- 若有发现：**一个**修复者带**完整**清单 → **恰好一次**定向复审 → 残留按熔断规则裁定。**没有第二波修复。**
- 删除本计划的工作区（`.superpowers/sdd/2026-09-19-pi-unity-m2-implementation/`）。
- 用 `finishing-a-development-branch`，并把「我作出的裁决」清单（本账本里所有 `Ruling:` / `R<数字>` 记录）呈现给用户 —— **合并/落法由用户定**（用户此前明确：「C# port 与分支合并：一律等 M2 收尾再定」；M1 的 `m1-impl` 仍未合并）。

**待办事项（M3 候选，来自任务 12 的 B 类登记与任务 8/7 的缺口）**：`unity exec`（动态 C# 执行）、`unity scene save`/`scene open`、`unity pixels --diff`、`unity build` 命令化、产物验证（S8 手工验证过 StandaloneWindows64；WebGL 未装模块）。

## 任务 13（文档收尾）首轮实现（DONE_WITH_CONCERNS，commits `652090c`/`3a8bfe7`/`b79e3ca`，366/366 绿）

- **PITFALLS 编号定稿：U16–U26**（9 条既有无编号条目按追加顺序定稿 U16–U24；本任务新补 **U25** = 输入模拟可用性边界、**U26** = `play start` 与未保存场景）；索引表 26 行与 26 个二级标题一一对应。
- **SKILL 引用对齐 9 处**（U16/U17 预留号 → U25/U26；2 条文字锚 → U20/U21；内联 U17/U21/U24/U23+U26；删掉「预留编号」段）；README 1 处 + CAPABILITIES/规格/SKILL 若干内联引用同步。
- **计划文件**：修了**两处**未闭合围栏（任务 7 + 任务 8，比登记的多一处）→ 行号平移 +1/+2；4 处「已被实现推翻」的片段加了「⚠️ 已被 R<编号> 取代」批注（不重写正文）。
- **代码类延后 Minor 19 组（D1–D19）只登记不改**，交最终整分支审查甄别。
- **真机终验（S0Project）**：`doctor` 5/5 OK；`--smoke` 7/7 pass；`--golden` `matched:true`/`diff:null`/`cleanup ok`；`npm test` 366/366。未碰用户真实工程。

Task 13 首轮审查（spec ✅ 通过带 4 次要 / code ✅ 通过带 **3 重要** + 5 次要）→ 修复循环第 1 轮

- **R344（重要①）** — `docs/CAPABILITIES-tuanjie-2022.3.62t9.md:334` 把**盲测项目**的「两轮各 33 节点」安到了 **S0Project** 上；任务 13 的 S0Project 真机输出是各 **5** 节点。裁定：改成实测数并注明项目；同段 29 vs 33 两套节点数补一句解释。
- **R345（重要②）** — `README.md:89`「场景 md5 未变（**dirty 场景下** `Play` 不写盘）」与 `PITFALLS` U26（「真正 dirty 的场景是否会先静默保存，**未验证**」）及 U18 §3（「本次场景是干净的」）直接矛盾。裁定：README 改成与 U26 同口径（干净场景已验证；dirty 场景未验证）。
- **R346（重要③）** — 计划里仍有 **5 处**用**预留号** U16/U17（`:5638-5640`、`:5889-5890`、`:5959`、`:5300`、`:2839`），与定稿语义冲突（U16 = 退编辑器、U26 = 未保存场景），其中 `:5300` 的 `// docs/PITFALLS.md U16` 现在指向错误的坑。裁定：在这些行（或计划 §编号段）加一行「预留号已改 U25/U26，见 PITFALLS 索引」的批注。
- **R347（次要，一并修）**：① `E2E-ACCEPTANCE-m2.md:471,491` 的「不写 U 编号（编号交任务 13）」加收口注（M2 已收口 U1–U26，后续顺延）；② `PITFALLS.md` 的「已知问题登记」D 表补上缺的代码/测试类 Minor（Task 6/7/8/9/10 各若干）或写明「完整清单以账本为准」；③ `design.md` §9.2 的证据列补 commit 范围；④ `PITFALLS.md` U20 处理第 4 条的文字锚改成「见 **U17**」；⑤ `CAPABILITIES` §4.7 表头与内容范围不符（点名了 sprite set/node delete/pixels/doctor 但表内没有对应行）+ vendor 路径前缀不一致 + `:277` 的悬空 `R329` 引用；⑥ `PITFALLS.md` U26 标题「干净场景下 Play 不写盘」与正文「只是内存里 dirty」措辞统一。
- 预期：**只改文档**，`npm test` 仍 **366/366**。

## 最终整分支审查（BASE `40c898b` → HEAD `c3ff02f`，36 commits / 41 files / +7668−426）+ 任务 13 定向复审

- **最终审查结论：M2 达标、可交付**（`npm test` 实跑 366/366；命令面全部存在且接线正确；`verified:true` 只有两个产出点；退出码单点判定无漏洞；**未发现假绿路径**；**.关键：无**）。
- **任务 13 定向复审**：F1/F2/F3、F4①–⑥、不许动清单 **全部 ADDRESSED**，无新 Critical/Important（3 条 Minor：D20 锚点行号过期、§9.2 的任务 11 commit 范围、PITFALLS 的 D20–D24 计数说明）。
- **最终审查的 5 条「重要」（均为 1–3 行提示/文案修正 → 合并前一次定向修复搞定）**：
  1. `docs/PITFALLS.md` 三处仍写 `--smoke`「**三项**」（`:563`/`:430`/`:532`）与 SKILL 的「七项」直接矛盾 → 加「M2 起为七项（3 只读 + 4 写闭环）」。
  2. **`unity-scripts/templates/PiBrickBreaker.cs:12` 引用 `PITFALLS.md U16`**（定稿后 U16 = 退编辑器；应为 **U25**）—— 该文件会**随 `asset write --template` 落进用户工程**。
  3. 写路径遇 `ULOOP_TRUNCATED` 直接透传传输层信封（`lib/scene.js` 的 create/set/delete + `lib/sprite.js`），hint 只说可重试，而 **create 的写入可能已生效** → 照 hint 重试会造重复节点（延后项 **D14** 被提上合并前）→ 4 处 `!envl.ok` 分支补「写入是否生效未知；重试前先 `unity scene tree` 复核」。
  4. `lib/asset.js` 对**非结论类**编译失败（`ULOOP_TRUNCATED`/`COMPILE_RESULT_UNKNOWN`）也写「脚本已写入但**编译未通过**」，与 `code`/`retryable:true` 打架（延后项 **D5** 提上）→ 按 code 分支成「编译结果**未知**」。
  5. `lib/play.js` 与 `bin/unity.js` 的 hint 仍把用户指向**裸 uloop** 的 `execute-dynamic-code`，而 SKILL 明令禁止、E2E 记为「报错误导（B1）」→ 改一行提示即可（不依赖 `unity exec` 落地）。
- **延后 Minor 甄别结论（最终审查）**：80 条里**只有 D14 与 D5 需合并前修**（已并入上面 3/4）；其余可真正延后（死导出、不可达防御分支、既有全仓模式、诊断文案等）。⭐ 另建议顺手删掉 `test/scene.test.js` 的一条恒真断言 D16。**M3 候选**：`unity build`、`unity exec`、`scene save/open`、`pixels --diff`。
- **流程**：按 SDD「最终审查有发现 → **一个**修复者带完整清单 → **恰好一次**定向复审 → 残留按熔断规则裁定；**没有第二波修复**」。

Task 13: complete (commits c445ec8..4894fcb, review clean + 1 parked) — **369/369 绿**

## 最终审查修复波 + 唯一一次定向复审

- 修复波 commit `4894fcb`（F1–F9，369/369）。
- **定向复审**：F1/F2/F3/F4/F6/F7/F8/F9 全部 ADDRESSED；无新 Critical/Important；**F5 未完全解决** —— `lib/play.js` 另有两处用户可见 hint 仍推荐裸 uloop 的 `execute-dynamic-code`（`:163` 的 `BAD_COORD` hint、`:222` 的 `uiFailureHint`）。
- **R349（熔断裁定：搁置，不启第二波修复）** — 按 SDD 规则「最终审查只允许一波修复 + 一次定向复审，没有第二波」。F5 的两处残留判定为**可搁置**：① 纯 hint 文案，**不影响退出码、不产假绿**（正是「关键」与「重要」的分界）；② 其底层能力缺口（`unity exec`）**已在 E2E 的 B 类登记为 M3 候选**，届时一并收口更自然；③ 这两处 hint **在事实层面没有错**（在没有 Input System 的项目里，裸 `execute-dynamic-code` 确实是当时唯一能驱动 sprite 游戏的手段），只是与 skill 的「禁止裸 uloop」纪律冲突。
  如果错了：代价是 M2 合并后 `unity play --action Drag/Click` 的两条 hint 仍会指向一个被 skill 禁止的手段（用户按其操作会违反 skill 纪律，但不会得到错误结论）。
- **复审的 3 条 Minor（同样搁置，登记在案）**：`lib/scene.js` 的 hint 追加范围注释口径（称「传输层失败」实为「非 ok 失败信封」）；统一文案「复核该节点是否已存在/已改动」对 **delete** 语义反了（删除后应问「是否已被删除」）；新增导出 `withWriteRecheckHint` 与 D2 同族的公开面问题。
## M2 全部 13 个任务完成

| # | 任务 | 状态 | 测试数 | 修复轮次 |
|---|---|---|---|---|
| 1 | M2 必修批 A（死码/重复/措辞） | ✅ | 214 | 1 |
| 2 | 跨语言 tripwire + 退出码统一 | ✅ | 222 | 1 |
| 3 | `unity node delete` | ✅ | 231 | 1 |
| 4 | 像素判定（color/png/pixels） | ✅ | 257 | 1 |
| 5 | `unity sprite set` | ✅ | 271 | 1 |
| 6 | `shot --capture-mode/--match-mode` 接线 | ✅ | 277 | 0 |
| 7 | `unity play` 试玩闭环 | ✅ | 301 | 1 |
| 8 | `asset write` + `compile` | ✅ | 322 | 1 |
| 9 | `doctor --golden` | ✅ | 338 | 2 |
| 10 | `doctor --smoke` 写-读回-删自闭环 | ✅ | 356 | 1 |
| 11 | skill 完整版 + 打砖块模板 | ✅ | 366 | 1 |
| 12 | E2E 盲测（**四条判据全过**） | ✅ | 366 | 2 |
| 13 | 文档收尾（U16–U26 / 偏差表 / README / CAPABILITIES） | ✅ | 369 | 1 |
| — | 最终整分支审查 + 修复波 + 定向复审 | ✅ 可交付 | 369 | — |

**M2 最终状态**：**369/369 绿**；HEAD `4894fcb`；分支 `m2-impl`；工作树干净；M2 范围 = `40c898b..4894fcb`（37 commits）。
**E2E 盲测结论**：全新子代理只读 SKILL + PITFALLS，**四条判据（结构/画面/可动/纪律）全部 PASS**，由独立复核者复现（4 行砖阵 / 青色挡板 / 白球 / 左上角分数；`[BB]` 日志 17 条 hit；Error 日志 0；smoke 7/7；golden matched）。
**待用户决定**（不在本会话擅自执行）：`m2-impl` 与 `m1-impl` 的**落法**（合并到 `master` / 开 PR / 保持分支 / 是否做 C# port）—— 用户此前明确「一律等 M2 收尾再定」。
