# pi-unity 决策账本（M2 / M1）

> **状态**：M2 已完成并合并到 `master`（tag `v0.2.0-m2`），369/369 测试绿，E2E 盲测四条判据全过。
> 本目录两份账本是**每个任务的过程记录**：逐条 `R<编号>` 裁决（含「如果错了的代价」）、每个任务的「延后 Minor」清单、修复轮次与审查结论。
> **为什么进仓库**：原文件在被 gitignore 的 `.superpowers/` 下；`docs/PITFALLS.md` 的「已知问题登记」D 表引用了它，若随工作区删除就会悬空。

---

# SDD ledger — plan: docs/superpowers/plans/2026-09-18-pi-unity-m1-implementation.md

工作区：`.superpowers/sdd/2026-09-18-pi-unity-m1-implementation/`
工作树：`pi-unity-m1`（分支 `m1-impl`）· 基线 `f1e0a01`

## 起飞前冲突扫描

### A. 共用文件 / 接口的任务对

| 共用 | 任务 A → B | A 产出、B 消费的东西 | 发现 |
|---|---|---|---|
| `bin/unity.js` | 1 → 6,7,9,10,11 | `COMMANDS` 表 | 一致：各任务只**新增条目**，不重写文件 |
| `lib/uloop.js` | 3 → 6,7,9,10,11 | `call` / `findDispatcher` / `extractJson` | **缺陷①**（见 R1） |
| `lib/scene.js` | 9 → 10 | `buildPayloadArgs` / `nodeInspect` | **缺陷②**（见 R2） |
| `lib/readback.js` | 8 → 10 | `verifyWrite` | 一致（8 先于 10） |
| `lib/envelope.js` | 4 → 9,10,11 | `fromUloop` / `fail` / `emit` | 一致（均已导出） |
| `lib/args.js` | 1 → 6,9,10,11 | `parseArgs` | 一致 |
| `lib/editor-discovery.js` | 5 → 6,11 | `discover` / `language` / `hubRoot` | 一致（均已导出） |
| `unity-scripts/*.cs` | 9,10 → — | 由 `buildPayloadArgs` 拼路径 | **缺陷③**（见 R3） |
| `test/doctor.test.js` | 6 → 7 | 同文件追加 | 一致（顺序执行） |
| `test/scene.test.js` | 9 → 10 | 同文件追加 | 一致 |

### B. 各任务自身文本自洽性

| 任务 | 规定的测试 ↔ 规定的代码 | 发现 |
|---|---|---|
| 1 | 4 测试 ↔ `parseArgs`/`USAGE`；`--help` 期望串与 USAGE 首行匹配 ✅ | OK |
| 2 | 4 测试 ↔ `run()`：spawn error→`-1`、超时→`timedOut` ✅ | OK |
| 3 | 6 测试 ↔ `call`/`extractJson` | **缺陷①** 涉及其测试注入方式 |
| 4 | 5 测试 ↔ `ok`/`fail`/`fromUloop` ✅ | OK |
| 5 | 7 测试 ↔ `discover`/`language`；含 `secondaryInstallPath` 裸字符串用例 ✅ | OK |
| 6 | 4 测试 ↔ `collectChecks`/`playbackEngines` | **缺陷①** 涉及其测试注入方式 |
| 7 | 2 测试 ↔ `smoke`：连接不通 → 全 `skip` ✅ | OK |
| 8 | 7 测试 ↔ `compareSubset`/`verifyWrite` ✅ | OK |
| 9 | 3 测试 ↔ `normalizeHierarchy`/`readHierarchyFile`/`buildPayloadArgs` | **瑕疵④**（见 R4） |
| 10 | 3 测试 ↔ `nodeCreate`/`nodeSet`（注入 `_call`） | **缺陷②** |
| 11 | 5 测试 ↔ `windowNameFor`/`isLocalizedMiss`/`pickScreenshot` | **瑕疵⑤**（见 R4） |
| 12 | 6 步（frontmatter 校验 + 真机 E2E） | OK |

### C. 裁决

- **R1** — `findDispatcher` 原计划用 `PI_UNITY_ULOOP_BIN` + `split(' ')` 切出参数前缀。
  **Ruling: 改为 `PI_UNITY_ULOOP_CMD`（JSON 数组），保留 `PI_UNITY_ULOOP_BIN` 作单路径回落；全局约束新增第 14 条。**
  为什么：Windows 上 node/编辑器路径常含空格（`C:\Program Files\...`），切分会把单个路径拆碎。本机 node 恰好在 `.workbuddy\...` 无空格，所以此缺陷**在本机不会暴露**，属潜在缺陷。
  如果错了：代价是测试注入方式需改一处，局部。
- **R2** — 任务 10 的单测注入 `_call` 并把它传给 `nodeInspect`，但任务 9 的 `nodeInspect`/`sceneTree` 不接收 `_call`，会打到真机。
  **Ruling: 两个函数都加 `_call` 参数并优先使用（`(_call || call)`）。**
  为什么：任务 10 的三个单测必须在无编辑器环境下可跑（计划全局约束：单测不依赖编辑器）。
  如果错了：代价是任务 10 的 3 个测试退化为依赖真机，拖慢迭代。
- **R3** — `node-inspect.cs` 用了 `.Select(...)` 但没有 `using`。
  **Ruling: 片段首行显式加 `using System.Linq;`。**
  为什么：动态片段的隐式 using 集合未经实测，LINQ 不保证可用；显式引入无副作用。
  如果错了：代价为零（重复 using 合法）；若不加而 LINQ 不可用，任务 9 真机验证会立即编译失败。
- **R4** — 未用参数：`normalizeHierarchy(raw, prefix, depth)` 的 `prefix`/`depth`、`shot(..., json)` 的 `json`。
  **Ruling: 一并删掉。**
  为什么：审查标准会把未用参数判为缺陷，且它们对行为无影响。
  如果错了：代价为零。
- **R5 — 工具能力偏差**（非计划缺陷）— 本技能的「模型选择」一节要求**每次分派显式指定模型**，但本环境的 `subagent` 工具**没有 model 参数**。
  **Ruling: 无法指定模型，记录为已知偏差；改为用「任务粒度」控制成本——机械性任务单独分派，避免把大任务派给小模型。**
  如果错了：代价是成本与速度不最优，不影响正确性。
- **R6 — 范围**（承接设计阶段）— 规格里的 M1 过大。
  **Ruling: M1 只做「基础设施 + doctor + 场景读写 + 截图」；`golden`、`unity build` 命令化、`unity play`、skill 完整版 + E2E 盲测划入后续里程碑。**
  为什么：计划技能的范围检查要求每个计划能独立产出可工作、可测试的软件。
  如果错了：代价是里程碑数目与规格的 §9 表不一致，需回写规格。

## 进度

（任务完成行由此往下追加）

### 任务 1

Task 1: fix round 1/5 (2 addressed, 0 open — COMMANDS 原型链查找致 toString/hasOwnProperty 绕过 unknown 分支报退出码3；handler 非整数返回码致 process.exit 抛错被包成退出码3; commits 6f3a58e..9bcc8b1)
Task 1: complete (commits a90e9f0..9bcc8b1, review clean)

**延后的 Minor（留待最终整分支审查甄别）：**
- Task 1: minor (deferred): `lib/args.js` 未处理 `--` 终止符，`parseArgs(['--'])` → `{'':true}`
- Task 1: minor (deferred): `--key=` 产出空串，消费方用 `||` 会误判为"未传"；需文档化「空串 ≠ 未设置」
- Task 1: minor (deferred): `USAGE` 把 `--project-path/--json` 标为"全局选项"，但分发器只认 argv[0] 为命令，选项实际只能写在子命令之后
- Task 1: minor (deferred): `unity doctor --help` 不会打印帮助，会透传给 handler 并可能误触发真实操作
- Task 1: minor (deferred): `lib/args.js` 三条已知限制未文档化（只认长选项、值不能以 `--` 开头、重复 key 后者覆盖）
- Task 1: minor (deferred): `test/cli.test.js` 的 `runCli` 不回传 `signal`/`stderr`，spawn 失败时排错困难
- Task 1: minor (deferred): `--key=value` 分支与退出码 3 分支缺自动化测试
- Task 1: minor (deferred): 用 `process.exit` 而非 `process.exitCode`（大 stdout 可能截断；本机 Node 22 以 1/5/20MB 未复现）
- Task 1: minor (deferred): `USAGE` 提前列出尚未实现的 doctor/scene/node/shot，任务 1–8 间 `unity doctor` 得 "unknown command"，与文案自相矛盾
- Task 1: minor (deferred): 非整数返回码一律收敛为 0 属 fail-open（未来 handler 漏返回码会静默报成功）
- Task 1: minor (deferred): `Object.hasOwn` 需 Node ≥ 16.9，`package.json` 无 `engines` 字段

**本轮新增裁决：**
- R7 — 审查者指出计划架构表把 `lib/args.js` 职责写成含「JSON 值解析」，但实现只做字符串透传（任务 10 的 `--patch '{"a":1}'` 需要它）。
  Ruling: **`parseArgs` 保持纯字符串透传（单一职责）；JSON 解析由消费方就地 `JSON.parse`（`--patch` 只在一处用到）；已回写计划架构表。**
  为什么：避免为单点需求给被 11 个任务复用的公共函数加隐式转换（会让 `--name '{"a":1}'` 这类字符串被意外解析）。
  如果错了：代价是任务 10 多一行 `JSON.parse`，可忽略。
- R8 — 本环境的 `subagent` 工具 **chain 模式只回传最后一位审查者的输出**，规格审查者的结论只能从下游引用中得知。
  Ruling: **任务 1 的规格结论由代码审查者正文引用确认为「不影响规格符合性」，判定为 ✅ 通过；后续任务的两位审查者改为分派两次（不组链），确保两份结论都可见。**
  为什么：技能明确要求「规格合规性和任务质量两者都必须有」，chain 模式让前者不可见。
  如果错了：代价是每个任务多一次工具调用，可忽略。

### 任务 2

Task 2: fix round 1/5 (4 addressed, 0 open — 含 1 Critical：run() 只在 'close' settle 而 'close' 要求 stdio EOF，孤儿孙进程占住管道致永不 resolve；3 Important：timedOut 误报 / 超时无宽限兜底 / UTF-8 跨 chunk 截断; commits 3a1affb..eafc68a)
Task 2: complete (commits 9bcc8b1..eafc68a, review clean)

**延后的 Minor（留待最终整分支审查甄别）：**
- Task 2: minor (deferred): kill 失败可在 child 上触发 'error'，产出 `{code:-1, timedOut:true, spawnError}` 自相矛盾组合
- Task 2: minor (deferred): `timeoutMs` 无校验（0/负数/NaN/Infinity → 立即超时而非不超时）；建议任务 3 在 `lib/uloop.js` 调用层校验
- Task 2: minor (deferred): `taskkill` 走 PATH 解析而非 `%SystemRoot%\System32\taskkill.exe`，PATH 异常时静默退回直杀
- Task 2: minor (deferred): 杀树失败在 4 处被静默吞掉，"为什么没杀掉"不可诊断
- Task 2: minor (deferred): win32 杀树**正分支**在自动化测试里未被直接断言（仅反向用例）
- Task 2: minor (deferred): 一处测试无法证明走的是 catch 兜底路径（只能证明"最终 resolve"）
- Task 2: minor (deferred): `stdio: ['ignore','pipe','pipe']` 的注释不准确（'pipe' 写端仍会被 `stdio:'inherit'` 的孙进程持有，close 仍可能迟到）—— 真正兜底的是 drain 宽限，注释易误导后人删掉 drain
- Task 2: minor (deferred): drain 截断发生时返回值无可辨识标记；建议加可选 `truncated: true` 供任务 3 自保

**本轮新增裁决：**
- R9 — 实现者上报「超时只 kill 直接子进程，Windows 不杀进程树」。
  Ruling: **现在就修（不进延后清单）** —— uloop dispatcher 确实派生子进程 `uloop-project-runner.exe`，且命名管道名按项目路径确定性生成，孤儿 runner 会占住管道使后续调用撞车。修复：Windows 用 `taskkill /PID /T /F`，逻辑可注入。
  如果错了：代价是 exec.js 多约 15 行与一个注入点，可忽略。
- R10 — 修复者主动报告的取舍：drain 宽限（默认 2s）到期即返回，可能给出**不完整**的 stdout/stderr。
  Ruling: **接受此取舍** —— 直接子进程退出后若管道被孤儿孙进程占住，"读完"没有定义终点；唯一替代是永久挂起，对 CLI 而言远比可能不完整更糟。定向复审独立复核后判"可接受"。
  如果错了：代价是超大输出（>2s 才能读完）被静默截断，表现为下游 JSON 解析失败——可诊断、可调大 `drainGraceMs`。

### 任务 3

Task 3: fix round 1/5 (4 addressed, 0 open — 截断输出产出伪 json / 噪声行 JSON 遮蔽真载荷 / dispatcher 不切分零测试 / code=0 无 JSON 零覆盖；外加 R13 跨任务扩展 exec.js 契约; commits 42790b4..f62acd3)
Task 3: complete (commits eafc68a..f62acd3, review clean)

**延后的 Minor（留待最终整分支审查甄别）：**
- Task 3: minor (deferred): `MAX_JSON_CANDIDATES=100` 上限会静默误伤（120 个 `{` 后跟 JSON → null），与「无 JSON 输出」不可区分
- Task 3: minor (deferred): 顶层数组判定只看首个非空白字符，故噪声前缀场景下 R11 的「不退化成数组首元素」在生产形态下等于不生效
- Task 3: minor (deferred): `findDispatcher` 不校验元素类型（`PI_UNITY_ULOOP_CMD='[123]'` → `{cmd:123}`，错误推迟到 spawn）；非法 JSON/非数组/空数组全部静默回落
- Task 3: minor (deferred): 测试里的耗时预算断言（500ms/2000ms）在负载机器上易假红
- Task 3: minor (deferred): `test/fixtures/fake-uloop.js` 被 `node --test` 当测试文件执行并把 JSON 混入 TAP；修需动 `package.json`（改 `node --test test/*.test.js`）
- Task 3: minor (deferred): `extractJson` 第二遍扫描会重复尝试第一遍已失败的行首候选，双倍消耗候选上限（极端病态输入下返回 null；方向安全）
- Task 3: minor (deferred): `lib/exec.js` 中 dispatcher 退出后孤儿 runner 占管道超 2s → 同一调用的**合法**输出也会被标 `truncated`，调用方从「成功」转为「失败」（R13 的保守代价，方向正确）

**⚠️ 带入下游的硬要求（复审提出）：**
- **任务 4+ 必须把 `truncated`/`drained` 当作「可重试错误」而非终态错误** —— 因为它是保守判定，可能把完整输出误报为截断。

**本轮新增裁决：**
- R11 — 实现者上报 `extractJson` 对尾部噪声返回 null（反例 `'{"a":1}\nuloop: hint {x}\n'`）且失败路径 O(n²)（2MB 实测 990ms）。
  Ruling: **改为大括号配对扫描**（尊重字符串与转义）：每个候选先试「到 EOF」再试「配对区间」；候选上限 100；顶层数组返回 null 并写进 JSDoc。
  为什么：真实 uloop 输出当前实现能处理，但「JSON 后有噪声」会返回 null 且 O(n²) 在 MB 级输出上不可接受。
  如果错了：代价是 extractJson 变复杂；实测已把 655ms/null 变为 19.5ms/正确。
- R12 — 审查者/实现者都问是否收紧顶层数组判定（`'uloop: hint\n[{"a":1}]'` 仍返回 `{a:1}`）。
  Ruling: **不收紧**。收紧成「首个 `{` 之前出现 `[` 即 null」会在噪声含方括号时（如 `uloop: [warn] {"a":1}`）产生**误判**，比现状更糟；数组本就在契约外。
  如果错了：代价是某个非契约输入返回了「数组内首个对象」，而真实 uloop 实测只返回对象。
- R13 — 实现者上报 drain 截断路径（`code=0 && timedOut=false`）在 `run()` 原契约下无法与正常输出区分，仍可能返回截断载荷里的伪 json。
  Ruling: **破例跨任务扩展 `lib/exec.js` 契约**，新增 `drained: boolean`；`call()` 在 `timedOut || spawnError || drained` 时 `json = null`；既有字段纯增量不变。
  为什么：静默错误值比 null 更危险，这是本项目立身之本；任务 2 延后清单本已建议过 `truncated` 标记。
  如果错了：代价是 exec.js 多一个字段与两条测试，且**保守代价**：孤儿占管道超 2s 时合法输出也被判截断 → 故已定为「可重试错误」（见上）。
  实测证据：同一截断载荷修复前 `{"id":1}`（静默错值）→ 修复后 `null`。

### 任务 4

Task 4: fix round 1/5 (3 addressed, 0 open — ok() 的 ...extra 可篡改核心语义 / Success 真值判断 / retryable 无界重试风险; commits 2f2ea3b..6f53d5e)
Task 4: complete (commits f62acd3..6f53d5e, review clean)

**延后的 Minor（留待最终整分支审查甄别）：**
- Task 4: minor (deferred): `RETRYABLE_CODES` 里的 `ULOOP_TRUNCATED` 在本仓库无任何产出点（uloop 的 truncated 走 json=null → ULOOP_NO_JSON），形同装饰，且丢掉了「截断」与「压根没 JSON」的诊断差异
- Task 4: minor (deferred): 失败回退分支零测试（Error 缺失、NextActions 非数组、非对象输入）
- Task 4: minor (deferred): `emit` 人读路径三处粗糙（`.replace('  ',' ')` 脆弱；`JSON.stringify(undefined)` 打印字面量；fail 分支不打印 actual/intent，恰在 verified:false 场景看不到分歧）
- Task 4: minor (deferred): `emit` 的 `for (const h of envelope.hint)` 未做数组防御，下游手写信封漏传 hint 会 TypeError
- Task 4: minor (deferred): 导出的 `RETRYABLE_CODES` 是可变 Set，下游 `.clear()/.add()` 会静默改变全局重试语义；码常量在集合与 fromUloop 中重复硬编码
- Task 4: minor (deferred): 「不丢信息」措辞不准确（失败路径只映射 6 字段）；建议附 `raw: json`
- Task 4: minor (deferred): `RETRYABLE_CODES` 的测试基本是复述实现常量，保护力有限
- Task 4: minor (deferred): `ok()` 白名单会静默丢弃未知键（调用方键名笔误无提示）

**本轮新增裁决：**
- R14 — 实现者上报 `fail()` 在 non-uloop 路径上 `retryable` 为 undefined，下游 `if (e.retryable)` 会把瞬时抖动当终态。
  Ruling: **定义并导出 `RETRYABLE_CODES` 集合**（`ULOOP_NO_JSON` / `ULOOP_TRUNCATED`），`fail()` 改为 `retryable ?? RETRYABLE_CODES.has(code)`；uloop 自身的 `Error.Retryable` 仍优先；JSDoc 写明语义。
  为什么：把「哪些失败可重试」从隐式约定变成显式代码，避免 6/9/10 三处各自猜。
  如果错了：代价是集合需要维护；且**副作用已被复审捕获并追加修复**（见下）。
- R15 — 复审在任务 4 收严口径后指出：计划任务 6/7 用 `Success !== false` 判定，会把无 `Success` 字段的裸对象判 pass。
  Ruling: **修正计划**（非代码）—— 任务 6/7 改为 `Success === true` 才 pass。
  为什么：否则 doctor 会放过「dispatcher 被指到别的程序」这类它本该抓的病，且与任务 9/10 的 `ULOOP_BAD_PAYLOAD` 结论矛盾。
  如果错了：代价是若某个 uloop 工具真的返回无 Success 的裸对象，doctor 会误报 fail（方向安全，falsely-fail 而非 falsely-pass）。
- R16 — 任务 4 修复收严为「缺 `Success` 字段 → `ULOOP_BAD_PAYLOAD`（终态）」。
  Ruling: **接受**，并把「任务 9/10 真机验证时必须确认所用工具都返回布尔 `Success`」作为携带项。
  为什么：已实测的 `get-hierarchy` / `execute-dynamic-code` / `screenshot` / `compile` 响应均含布尔 `Success`（见 CAPABILITIES §4）。
  如果错了：代价是任务 9/10 真机验证时若遇到裸对象会得 `ULOOP_BAD_PAYLOAD`，需回头放宽——届时会立即暴露，不会静默。

**⚠️ 带入下游的硬要求：**
- **任务 6/7**：成功判定必须用 `Success === true`（计划已修正）。
- **任务 9/10**：真机验证时必须确认所用 uloop 工具都返回布尔 `Success`。
- **任务 9/10**：`ok()` 白名单会静默丢弃未知键 —— 不要向 `ok()` 传 `phase`/`message`。
- **任务 4+ 全员**：`retryable: true` 只表示「值得重试」，**必须限次（≤3 + 退避）**，且重试前先读 `hint` 排除终态原因。


### 任务 5

前置裁决（本轮新增）：
- R17 — 简报里 `discover()` 第 4 层读真实 `process.env`，而本机三个官方默认路径实测都不存在，故简报的 `found.length === 1` 在本机成立。
  Ruling（首轮）：**当时裁定「不要改断言语义，若失败则显式传 `programFiles: []`」**；该裁定被本轮审查推翻，见 R19。
  如果错了：代价是——见 R19。
- R18 — **逐字抄简报的实现代码**；若简报代码与其测试矛盾，按「测试是真需求、实现是手段」处理并上报分歧。
  如果错了：代价是多一轮审查。
- R19 — 两位审查者独立命中同一条：**第 4 层绕过注入的 `env` 去读真实 `process.env`**，使 `test:34`/`test:49` 的 `found.length === 1` 取决于开发机是否装了 Unity Hub（本机恰好没装 → 现在绿属偶然）。spec-reviewer 定 **重要**，code-reviewer 定 **关键**。
  Ruling：**采纳，且优先于简报字面**（F1）。**推翻 R17 的首轮口径**——R17 说的「若失败再显式注入」是事后补丁，而计划全局约束 13（`npm test` 必须全绿）与测试策略「单测不依赖编辑器/环境」是**有约束力**的要求，简报字面只是任务内步骤文本；在有约束力约束与简报字面冲突时，前者胜。
  为什么：pi-unity 的目标用户机器上**通常装了 Unity Hub**，那正是这条断言的假红场景；把「被测行为」换成「环境事实」的测试不可信，而这条断言恰好是第 2 层的唯一边界检查。
  如果错了：代价是 `lib/editor-discovery.js` 与简报字面代码差 3 行（改为读 `env`），后续任务读简报代码块时需知道自己写 `env` 而非 `process.env`。
- R20 — code-reviewer 指出简报要求「PASS（7 个测试）」，但审查同时要求**补一条第 4 层正向用例**（否则 `source: 'unity:hub-default'` 全仓无任何断言保护，且 F1 隔离后第 4 层彻底无覆盖）。
  Ruling：**允许测试数 7 → 8**（F2）。简报里的「7 个测试」是对计划作者预期的描述，不是有约束力的验收值；用一条新用例把「第 4 层路径拼接 + source 字符串」钉住，严格优于保留一个无人守护的代码分支。
  如果错了：代价是任务 5 的测试计数与简报字面不符（8 ≠ 7），审查者按计数核对时会看到一条主动登记的偏差。
- R21 — code-reviewer 指出 `lib:46` 的 JSDoc 写「不去重跨来源的同名」，而代码 `lib:37` 的去重检查跑在四层**共享的累加器**上 → **实际是跨来源同路径去重、保留优先级最高的那条**。注释把下游唯一依赖的契约说反了。
  Ruling：**以代码行为为准，改注释，并补一条用例把该契约钉住**（F3）。下游（任务 6/11）按 `found[0]` 取最高优先来源是正确用法，注释必须与之一致。
  如果错了：代价是 JSDoc 与代码同改，方向安全。
- R22 — 两位审查者都点出 `<LOCALAPPDATA>\Unity` 作为第 4 层 base 会拼出 **`<LOCALAPPDATA>\Unity\Unity\Hub\Editor`**（`lib:75` 与 `lib:78` 各拼一次 `Unity`），该路径在任何真实安装上都不可能存在；规格 O5 第 4 层只要求 `C:\Program Files\Unity\Hub\Editor\*\Editor\Unity.exe`。
  Ruling：**删掉 `LOCALAPPDATA` 这一支**，第 4 层只保留 `ProgramFiles` / `ProgramFiles(x86)`（F4）。不采用 code-reviewer 建议的「保留但改为 `path.join(env.LOCALAPPDATA,'Unity')`」——那样仍保留重复段，等于把一个永不命中的分支写得更像对的。
  为什么：规格只约束 Program Files；一个永远不可能命中的分支是纯噪音，且它恰好在 F1 要改的那一行上。
  如果错了：代价是若某个真实用户把编辑器装在 `%LOCALAPPDATA%` 下的非默认位置，需要显式设 `PI_UNITY_EDITOR_BIN`（应急逃生口本就为此存在）。

Task 5: fix round 1/5 → 见下轮修复行

**任务 5 延后的 Minor（两位审查者合并，留待最终整分支审查甄别）：**
- Task 5: minor (deferred): 测试文件无简报首行路径注释，而同 commit 的 `lib/editor-discovery.js:1` 保留了 → 同 commit 内两侧风格不一致（简报强制 vs 仓内既有风格冲突）
- Task 5: minor (deferred): env 覆盖项不做类型校验——`fs.existsSync(manual)` 对**目录**也为真，`PI_UNITY_EDITOR_BIN=<目录>` 会被当最高优先编辑器返回（`version:'unknown'`），到 spawn 阶段才以 EISDIR/EACCES 失败；建议 `fs.statSync(manual).isFile()`
- Task 5: minor (deferred): `programFiles` 缺 `Array.isArray` 守卫——传字符串会按字符迭代扫垃圾路径；传 `[123]` 会让 `path.join` 抛 TypeError，破坏「不抛异常」契约
- Task 5: minor (deferred): `readJsonSafe` 把 ENOENT/EACCES/JSON 损坏/非对象一律压成 `null`，无诊断出口 → 任务 6 doctor「列出所有已尝试路径」无从实现；本机实测过的**对象形态** `secondaryInstallPath.json` 被静默忽略
- Task 5: minor (deferred): `language()` 未校验类型——`{"language":123}` 会原样返回 123，窗口名映射下游拿到垃圾值
- Task 5: minor (deferred): 四个 source 字符串是跨模块字符串契约，既非导出常量也无集中出处，任务 6/11 需逐字重打；`'unity:hub-default'` 原本无任何断言保护（本轮由 F2 补上）
- Task 5: minor (deferred): 去重是精确字符串比较，Windows 大小写不敏感 → 手改过大小写的 secondaryInstallPath 会产生同一文件两条记录
- Task 5: minor (deferred): `readdirSync` 的 `d.isDirectory()` 会跳过 junction/symlink 形态的版本目录
- Task 5: minor (deferred): 返回数组内版本顺序未排序（`readdirSync` 顺序即遍历顺序），下游「取最新版本」无保证（`2022.3.10t9` vs `2022.3.62t9` 字典序会错序）
- Task 5: minor (deferred): 测试不清理临时目录（`piuhub-*`/`piuinst-*`/`empty-*` 累积在 os.tmpdir()；仓内首处使用临时目录的测试，无既有约定）
- Task 5: minor (deferred): `test/editor-discovery.test.js:7` 导入 `hubRoot` 但从未使用（死绑定 + 该导出无测试）

Task 5: fix round 1/5 (4 addressed, 0 open — 关键：第 4 层绕过注入 env 读真实 process.env，致装了 Unity Hub 的机器上 `found.length===1` 假红；+ JSDoc 把去重契约说反；+ 第 4 层 source 零覆盖；+ R22 删除永不命中的 LOCALAPPDATA 分支; commits 9921df0..93910fb)
Task 5: complete (commits cd468ed..93910fb, review clean) — 69/69 绿（60 + 9），1 轮修复

**R20 补充**：加入 F3 的去重契约用例后，任务 5 测试数最终为 **9**（简报字面写 7），属主动登记的偏差。

**任务 5 修复轮 1 复审新增的延后 Minor：**
- Task 5: minor (deferred): F2 的用例把 `programFiles` 直接注入，因此**修复新写的 `env['ProgramFiles']`/`env['ProgramFiles(x86)']` 那一行自身无任何用例经过**——若日后回退成 `process.env[...]`，在未装官方 Unity Hub 的机器上仍全绿（只有 test:34 在装了 Hub 的机器上才红）。建议把该用例改为 `discover({ appData, env: { ProgramFiles: base } })` 并断言 `unity:hub-default`，把「第 4 层只读注入 env」这条修复本身钉住

### 任务 6

起飞前裁决（本轮新增，均属「计划明确要求、但审查标准会判为缺陷」一类，按技能要求在分派前裁定）：

- R23 — 简报的 `uloop` 检查是 **恒真检查**：`const { cmd } = findDispatcher({env}); status: cmd ? 'pass' : 'fail'`，而 `lib/uloop.js:138-157` 的 `findDispatcher` **永远返回非空 `cmd`**（最后一档回落裸名 `uloop.exe`/`uloop`）。即 `doctor` 的第一项检查在「完全没装 uloop」时也会报 OK —— 正是本项目立身之本要防的**静默假绿**。
  Ruling：**必须能真的失败**。在 `lib/doctor.js` 内落地：`const found = Boolean(env.PI_UNITY_ULOOP_CMD || env.PI_UNITY_ULOOP_BIN) || fs.existsSync(cmd)` → `status: found ? 'pass' : 'fail'`；失败 message 必须说明「未配置，且未在 `<仓库根>/uloop-bin` 找到（裸名 `uloop.exe` 只在 PATH 里兜底）」。**不改 `lib/uloop.js`**（不给已审查模块加字段：它的两处 `deepStrictEqual` 断言会因新增键而红，且这是跨任务改接口），**也不在 doctor 里把 findDispatcher 的解析逻辑复制成第二套**。
  为什么：`fs.existsSync(cmd)` 对裸名回落天然为假、对 `uloop-bin/` 的绝对路径为真、env 两条由布尔式覆盖——不需要知道更多内部知识就能区分「找到」与「猜」。
  如果错了：代价是方向保守——若用户把 `uloop.exe` 装在 PATH 上但没设 env，doctor 会 falsely-fail（按本项目口径：falsely-fail 优于 falsely-pass，同 R15/R16 的方向）。

- R24 — 上述失败分支在简报的 4 个用例里**零覆盖**（且任何走 `collectChecks` 的用例都会真去 `call()`，即 spawn 一个裸名 `uloop.exe`——违反测试策略「所有单测用假 uloop 驱动」）。
  Ruling：**当 `found === false` 时跳过 `call()`**，直接产出 `editor-connection: { status: 'fail', message: '未找到 dispatcher，跳过连接检查', hint: [...] }`；并补一条用例断言 `uloop.status === 'fail'` 且 `hint.length > 0`。测试数 4 → **5**（主动登记的偏差）。
  为什么：一箭双雕——失败分支变成可测的（不需要 spawn），且不再去猜 PATH 里的裸名（猜测正是假绿与挂起的来源）。
  如果错了：代价是若用户依赖 PATH 里的裸名 `uloop.exe` 且不设 env，`editor-connection` 会直接 fail 而非尝试连接（同上：falsely-fail 方向）。

- R25 — 简报用例 4「找不到编辑器时 fail」注入 `env: {...process.env}`，因此第 4 层会读**真实** `ProgramFiles`：在装了 Unity Hub 的目标用户机器上 `editor-install` 会变 `pass`，断言 `status === 'fail'` **假红**（本机三个官方默认路径实测都不存在 → 现在绿属偶然）。这与任务 5 的 F1 是同一类病。
  Ruling：该用例的注入 env 必须把 `ProgramFiles` / `ProgramFiles(x86)` 指向不存在的目录（`PI_UNITY_ULOOP_CMD` 仍照简报注入），把第 4 层隔离掉。
  如果错了：代价是该用例多两行 env 覆盖（方向安全，且是任务 5 R19 已确立的口径）。

- R26 — 简报用例 1 `assert.ok(Array.isArray(engines))` 对**任何**数组都成立（含 `[]`），而它传的是一个硬编码的真实路径 `<引擎安装目录>/2022.3.62t9/Editor`——该断言在本机之外永不失败，属「什么都不断言的测试」。
  Ruling：改为**密闭且真的断言契约**：在临时目录造 `<tmp>/Data/PlaybackEngines/WebGLSupport/` → 断言 `deepStrictEqual(playbackEngines(tmp), ['WebGLSupport'])`；再断言不存在的目录 → `[]`（覆盖 `fs.existsSync` 早返回的边界）。用例数不变（仍 4→5）。
  如果错了：代价是该用例不再依赖真实编辑器路径（严格更好），但硬编码路径本身不再被顺带冒烟。


- R27 — 实现者上报疑虑①：简报里 `editor-connection` 的 message 只按「有无 `json`」分流（`r.json ? 'uloop … 已连接' : '无法连接（退出码 …）'`），而失败响应**也带 json**（uloop 失败 → stderr 里是完整错误对象）→ 状态 `fail` 却打印「已连接」，**文案与状态自相矛盾**，且无任何用例断言。
  Ruling：**必须修**（这是正确性问题，按技能「DONE_WITH_CONCERNS 关乎正确性者先处理后审查」）。message 改为按**状态**分流：成功才说「已连接」；失败必须带上 uloop 的错误信息（`r.json.Error.Message`）与退出码；`r.truncated` 时明说「输出被截断（可重试）」。用例 3 追加两条断言：`assert.doesNotMatch(conn.message, /已连接/)` 且 `assert.match(conn.message, /not reachable/)`（fake 的 `Error.Message` 就是 `not reachable`）。
  为什么：`doctor` 是排障入口，状态与文案矛盾等于误导用户；且「空断言」正是本任务 R26 已在修的那类问题。
  如果错了：代价是 message 措辞与简报不同（方向安全，状态判据 `Success === true` 不动）。
- R28 — 实现者上报疑虑②：R23 的 `found` 对「已配置但无效」的 `PI_UNITY_ULOOP_CMD`/`BIN` 判 pass。
  Ruling：**接受，不再收紧**（登记为延后 Minor）。理由：该场景下 `editor-connection` 仍会如实 fail，不存在静默假绿；把「配置了但坏了」与「没配置」在 uloop 项上分开需要 `findDispatcher` 返回来源信息（跨模块改接口，R23 已裁定不做）。
  如果错了：代价是 doctor 首项报 OK 而连接项报 FAIL，用户需自己看出是配置写错（信息量足够，hint 已指向设置 env）。

**任务 6 延后 Minor（本轮起）：**
- Task 6: minor (deferred): R28 —— `uloop` 项对「已配置但无效」的 CMD/BIN 判 pass（连接项会 fail 兜住）
- Task 6: minor (deferred): 简报 `playbackEngines` 只按目录名枚举，不校验该模块是否真的包含目标平台支持（如 `WebGLSupport` 存在但缺子文件）

Task 6: 首轮审查（spec ✅ 通过 / code ✅ 通过但带 4 条 重要）→ 进入修复循环

修复循环第 1 轮的裁决（R29–R34）：

- R29 — **推翻我自己上一轮的 R28**（当时裁「配置了但无效也判 pass，接受、延后」）。两位审查者独立指出这是与 R23 同型的**假绿**：`PI_UNITY_ULOOP_BIN=C:\typo\uloop.exe` → `findDispatcher` 跳过它、回落裸名 → `Boolean(env...)` 仍判 pass → doctor 首项打印 `OK uloop  dispatcher: uloop.exe`，而**用户配置的那个错误路径在报告里根本不出现**。
  Ruling：`found` 收紧为 **`typeof cmd === 'string' && fs.existsSync(cmd)`**（= 「解析结果是一个磁盘上真实存在的文件」）。删掉 `Boolean(env.PI_UNITY_ULOOP_CMD || env.PI_UNITY_ULOOP_BIN)` 这个析取项。
  为什么：这个式子**不需要复制 `findDispatcher` 的解析逻辑**（R23 禁止的正是复制），却能同时正确区分全部分支——CMD 合法时 `cmd` 就是 `parts[0]`（如 node 绝对路径）→ 存在→pass；BIN 合法 → 存在→pass；`uloop-bin/` 命中 → 绝对路径→pass；CMD/BIN 无效 → 回落裸名→不存在→fail；`PI_UNITY_ULOOP_CMD='[123]'` → `cmd=123` → `typeof` 守卫拦住（**不能把 `fs.existsSync(cmd)` 求值提前**，实测 `fs.existsSync(123)` 会抛 `ERR_INVALID_ARG_TYPE`）。
  如果错了：代价是方向保守——用户把裸名 `uloop`/`uloop.exe` 装在 PATH 上而不设 env 时 doctor 会 falsely-fail（同 R23/R15/R16 的既定方向：falsely-fail 优于 falsely-pass）。
- R30 — code-reviewer 重要①：用例 5（唯一保护 R23 负向分支的用例）之所以绿，靠的是「仓库里没有 `uloop-bin/`」；而 `.gitignore` 恰好把 `uloop-bin/` 列为运行时下载目录 → **任何做过真机冒烟的机器上，该用例恒红**（`findDispatcher` 第三档命中真实文件 → `found=true` → 断言 `status==='fail'` 失败）。
  Ruling：`collectChecks` **增加并透传 `rootDir`**（`findDispatcher` 与 `call` 都早已支持该参数，无需改 `lib/uloop.js`），用例 5 传 `rootDir: <不存在目录>` 使第三档失配。同时把该用例的 `env` 显式补 `APPDATA`（避免 `hubRoot` 退化成相对路径 `AppData/Roaming`）。
  为什么：这是「单测不依赖环境」这条有约束力测试策略的又一次实例（同任务 5 的 F1/R25）；且它顺手让「`uloop-bin/` 命中 → pass」这条正向路径变得可覆盖。
  如果错了：代价是 `collectChecks` 多一个透传参数（纯增量，生产默认不变）。
- R31 — code-reviewer 重要②：`connectionMessage` 把 `spawnError` 一并算进 `r.truncated`（`uloop.js` 的 `truncated = timedOut || spawnError || drained`）→ 「dispatcher 二进制不存在」被报成「输出被截断，可重试」：**重试永远不会成功，且 hint 为空**，属对排障用户的主动误导（正是 R27 要消灭的那一类）。
  Ruling：`connectionMessage` 必须先分流 `r.spawnError`（`无法启动 dispatcher：<spawnError.message>（退出码 N）`），只在 `timedOut || drained` 时追加「输出被截断，可重试」；`spawnError` 时 hint 指向「设置 `PI_UNITY_ULOOP_BIN` / `PI_UNITY_ULOOP_CMD` 指向正确的 dispatcher」。为能测这条分支，**`collectChecks` 增加并透传 `runImpl`**（`call` 早已支持，纯注入缝，与 R2 给任务 9/10 的 `_call` 注入口同一模式）。
  如果错了：代价是 `collectChecks` 多一个仅供测试注入的参数 + 三个文案分支。
- R32 — code-reviewer 重要④：`editor-language` 恒 `pass`，文案无法区分「读到 `languageConfig.json`」与「回落默认 `en_US`」。
  Ruling：**不改，登记为延后 Minor**。为什么：① 简报字面强制 `status:'pass'`，而该值是**信息性**的（不参与 ok/exit code 判定）；② 要消除这种恒绿，要么在 doctor 里复制任务 5 的读取逻辑（R23 明确禁止复制解析逻辑），要么给已审查的 `editor-discovery.js` 加返回来源（跨任务改接口，无正当理由）；③ 文案在语义上是对的——它报告的是**生效值**（后续 O6 窗口名映射用的正是这个值，配置缺失时也确实按 en_US 走）。
  如果错了：代价是用户在 Hub 语言配置缺失时看不到「这是默认值」的提示（信息量问题，不是判断错误）。
- R33 — code-reviewer 次要⑨ / spec-reviewer 次要③：用例 4 的 `{...process.env}` 未中和 `PI_UNITY_EDITOR_BIN`（本项目文档正是教用户设这个变量）→ 任何导出过该变量的机器上 `editor-install` 变 pass、断言假红。
  Ruling：既然本轮已在改该测试文件，**一并硬化**（注入 env 里显式 `PI_UNITY_EDITOR_BIN: undefined`）。同 R25 一类，一行代价。
  如果错了：代价为零。
- R34 — code-reviewer 次要⑤：`hint` 未做 `Array.isArray` 守卫 → `Error.NextActions` 为字符串时会逐字符打印，为 `true`/数字时 `for...of` 抛 TypeError → `internal error` + **退出码 3**（排障入口崩溃）。
  Ruling：**本轮一并加守卫**（`Array.isArray(...) ? ... : []`，与 `lib/envelope.js:124` 既有写法一致），并在 F2 的用例里顺带断言非数组 `NextActions` 不会崩。
  如果错了：代价为零。

**本轮不改、登记为延后 Minor 的其余条目**：`fromUloop` 未被 doctor 复用（--json 消费方拿不到稳定 code）；无编辑器时 `build-targets` 静默缺席（checks 长度 4/5 浮动）；`doctor()` 本身零测试（退出码/--json 结构/--project-path 透传）；用例 2 近似恒真且 pass 文案零覆盖；`mkdtempSync` 不清理；`--project-path` 裸传产出 `true`（任务 1 领域）；`{ok, checks}` 的 `ok` 与 envelope 的 `ok` 语义不同；`uloop ${Version ?? ''}` 在无 Version 时双空格。

Task 6: fix round 1/5 (6 addressed, 0 open — F1 收紧 uloop 判据消灭「配置无效也 pass」假绿 / F2 透传 rootDir 使负向用例密闭（否则真机冒烟过的机器上恒红）/ F3 spawnError 不再被说成「输出被截断，可重试」+ 透传 runImpl 使该分支可测 / F4 hint 加 Array.isArray 守卫（原本会崩成退出码 3）/ F5 用例 env 中和 PI_UNITY_EDITOR_BIN; commits cb67a99..255250c)
Task 6: complete (commits 93910fb..255250c, review clean) — 79/79 绿（74 + 5），1 轮修复

**任务 6 的 commit 计数说明**：本任务共 3 个 commit（`0003f52` 初版 + `cb67a99` R27 审查前修复 + `255250c` 修复轮 1），与全局约束 13「每个任务一个 commit」不符。这是编排流程的既有代价（审查前处理正确性疑虑 + 定向修复轮各需一次提交）；任务 5 是 2 个（初版 + 修复轮）。已在最终整分支审查时合并视图。

**任务 6 修复轮 1 复审新增的延后 Minor：**
- Task 6: minor (deferred): fail 文案无法区分「未配置」与「配置无效」——`PI_UNITY_ULOOP_CMD='[123]'` 会打印「未配置…（裸名 123 只在 PATH 里兜底）」，用户配错的**原因**不可见（状态已正确 fail，非假绿）。根治方向：由 `findDispatcher` 回传「命中档位/无效原因」，**不是**在 doctor 里重解析（R23/R29 禁止）

**任务 6 首轮审查登记的延后 Minor（补记）：**
- Task 6: minor (deferred): `doctor()` 本身零测试（退出码 0|1、`--json` 结构、`--project-path` 透传均无断言），而 `doctor(argv, {env})` 的注入缝无使用者
- Task 6: minor (deferred): 未复用 `lib/envelope.js` 的 `fromUloop` —— dispatcher 被指到「会打印 JSON 的别的程序」时 doctor 只说「无法连接（退出码 0）」且 hint 空，而 `fromUloop` 会给出 `ULOOP_BAD_PAYLOAD` + 指向性提示；`--json` 消费方也拿不到稳定 `code`
- Task 6: minor (deferred): 无编辑器时 `build-targets` 静默缺席（checks 长度在 4/5 间浮动），`--json` 消费方无法区分「跳过」与「未实现」——与 R24 自己「跳过也要产出显式条目」的决定不一致
- Task 6: minor (deferred): 用例 2 近似恒真（`PI_UNITY_ULOOP_CMD` 由测试自己设，`found` 必然为真），且 pass 文案 `dispatcher: …` 零覆盖
- Task 6: minor (deferred): `mkdtempSync` 不清理临时目录（与任务 5 同类）
- Task 6: minor (deferred): `--json` 的 `{ok, checks}` 与 envelope 的 `ok` 语义不同（此处 = 无检查失败），且无逐项 `code`
- Task 6: minor (deferred): `uloop ${r.json.Version ?? ''} 已连接` 在无 `Version` 时产出双空格（纯外观）
- Task 6: minor (deferred): R32 的残留——`<hub>/languageConfig.json` 缺失时 `en_US` 回落仍记 pass（message 已把生效值摊开，不构成被掩盖的失败）

### 任务 7

起飞前裁决（R35–R40，均属「简报会踩的坑」，按技能要求分派前裁定）：

- R35 — 简报的探活判据是 `if (!(probe.code === 0 && probe.json))` → 与 R15 不一致（无 `Success` 字段或 `Success:false` 但 code=0 的载荷会被当成「已连接」，随后每个工具各报一次失败而不是 skip）；且 skip 的 message 一律写「编辑器未连接」，而真正原因可能是 spawnError（dispatcher 不存在）或输出被截断——**正是 R31 刚修掉的「文案误因」**。
  Ruling：探活判据收紧为 `probe.code === 0 && probe.json && probe.json.Success === true`；skip 的 message **复用 `lib/doctor.js` 里已有的 `connectionMessage(probe, ok)`**（同文件内已有，不另写第二套），hint 走同一个守卫助手。
  如果错了：代价是方向保守（假连接会被判 skip 而非逐项 fail，且文案更准）。
- R36 — 简报的 2 条用例只能到达「fail」与「skip」两条分支：**每个工具 pass 后的 `pick` 文案（3 个 pick 函数）与 pass 路径零覆盖**（fixture 的 `ok` 载荷没有 `Success`，永远到不了 pass）。
  Ruling：**用注入的假 `run` 覆盖**（不新增 fixture 模式）：`smoke` 与 `collectChecks` 一样接受 `runImpl`（见 R40），用例按 `args` 里的工具名分派载荷，覆盖 ① 三工具全 pass 且 message 来自 `pick`（含真实数字）② `Success:true` 但缺字段的载荷。
  如果错了：代价是 `smoke` 多一个仅供测试注入的参数（与既有 `call`/`collectChecks` 同模式）。
- R37 — `smoke` 里两处 `hint: (r.json.Error.NextActions) || []` 与 `doctor` 的 hint 是同一个坑（R34）：非数组会让 `for...of` 抛 TypeError → 退出码 3。
  Ruling：抽出局部助手（如 `nextActions(json)`）并让 `doctor` / `smoke` 共用，**不复制第二份守卫**。
  如果错了：代价是同文件内一次小重构（3 行）。
- R38 — `pick` 字面用 `?? '?'` 兜底：若真实载荷缺字段，冒烟会以 `status: 'pass'` 打印「errors=? warnings=?」——**把「不知道」当成「成功」**（证据工具的典型假绿）。字段名本身我已用上游源码核实无误：`compile` → `ErrorCount`/`WarningCount`（`spec §S3` + CAPABILITIES:15）、`get-logs --max-count` → `TotalCount`（`vendor/uloopmcp/Editor/FirstPartyTools/GetLogs/Skill/SKILL.md:22,32`）、`get-hierarchy` → `HierarchyFilePath`（`GetHierarchyResponse.cs:26`）。
  Ruling：`pick(j)` 读不到所需字段时**返回 `null`**，调用方据此判 `fail`，message 点名缺哪个字段；不得用 `?` 伪装成 pass。
  如果错了：代价是冒烟对上游字段改名更敏感（这是有意的：改名就该响）。
- R39 — 简报的 `return failed.length === 0 ? 0 : 1`（以及 `--json` 的 `ok`）在**全部 skip** 时给出**退出码 0 / ok:true** —— 编辑器没连上、什么都没跑，却报成功（同一个命令的基础检查在同样场景下返回 1，自相矛盾）。
  Ruling：`--smoke` **至少一项 pass 且无 fail** 才返回 0 / `ok: true`；全 skip → 返回 1 / `ok:false`，并在人读输出末尾打印一行说明（如「冒烟未执行：N 项被跳过」）。
  如果错了：代价是 `--smoke` 在编辑器未连接时返回 1（方向：falsely-fail 优于 falsely-pass，同 R15/R16/R29）。
- R40 — `smoke` 需要与 `collectChecks` 相同的注入缝才能密闭测试（不 spawn 真实进程、不依赖仓库里有无 `uloop-bin/`）。
  Ruling：`smoke({env, projectPath, rootDir, runImpl})` 接受并透传到 `findDispatcher`/`call`（纯增量；生产默认行为不变）。
  如果错了：代价同 R36。


- R41 — 实现者疑虑①：R39（全 skip 不得报成功）**无任何断言**，只有真机 CLI 证据；根因是 `doctor(argv, {env})` 只接受 `env`，无法注入假 `run` 与假 `rootDir`，因此 `doctor()` 分支（退出码 + 输出）在本仓**从来不可测**（任务 6 已登记「`doctor()` 零测试」）。
  Ruling：`doctor(argv, {env, runImpl, rootDir})` 接受并透传 `runImpl`/`rootDir` 给 `smoke`/`collectChecks`（纯增量，生产默认不变），并补断言把 R39 钉住：**全 skip → 退出码 1 且 `--json` 的 `ok:false`；至少一项 pass 且无 fail → 退出码 0 且 `ok:true`**。
  为什么：这是我自己裁定的行为（R39），没断言的裁定等于没落地；顺带把任务 6 那条「`doctor()` 零测试」的延后 Minor 覆盖掉 `--smoke` 这一半。
  如果错了：代价是 `doctor` 多一个仅供测试注入的参数。
- R42 — 实现者疑虑②：per-tool 失败文案只按「有 `Error.Message` 吗」分流，遇到 `drained`（`code===0`，输出被截断）会打印「无法连接（退出码 0）」之类**说不清原因**的字样——与 R27/R31/R35 已经确立的「文案不得误因」同一类。
  Ruling：per-tool 的失败 message **复用 `connectionMessage(r, false)`**（同文件已有，不另写第三套分流），并补一条 `drained` 用例断言文案含「截断」且不含「退出码 0」式误述（具体措辞由 `connectionMessage` 决定，断言它含「截断」即可）。
  如果错了：代价是失败文案与 `connectionMessage` 绑定（同源是好事）。


- R43 — 实现者疑虑（R42 的连带）：直接复用 `connectionMessage(r, false)` 后，**每工具**的失败文案都带上了「无法连接：」前缀。编辑器明明连着、只是 `compile` 报错时，文案会把工具级失败说成连接失败（用户会去查错方向）——与 R27/R31/R35/R42 同类的**误因**。
  Ruling：抽出 `describeFailure(r)`（不含「无法连接」措辞的失败描述：`spawnError` → 「无法启动 dispatcher：…」；`timedOut||drained` → 追加「输出被截断，可重试」；否则带 `Error.Message` + 退出码），`connectionMessage` 在其上加「无法连接：」前缀（**连接检查文案不变**），per-tool 失败改用 `describeFailure(r)`（前缀用工具名已在同一行，不再自称连接问题）。补断言：per-tool 语义失败文案**不得**含「无法连接」，且 `drained` 仍含「截断」。
  如果错了：代价是同文件内一次小重构（约 6 行），两处共用同一细节构建器（同源是好事）。

Task 7: 首轮审查（spec ✅ 通过带 1 条重要 / code ❌ 需要修复带 2 条重要）→ 修复循环第 1 轮

- R44 — code-reviewer 重要②：`SMOKE_TOOLS` 的三个字段/参数名（`ErrorCount`/`WarningCount`、`TotalCount`、`HierarchyFilePath`、`--max-count`）**在本仓库内查不到实证**（仓内只有 `ErrorCount`/`WarningCount` 的记载）。控制者已对**上游 vendor 源码**核实（`vendor/uloopmcp/Editor/FirstPartyTools/GetLogs/Skill/SKILL.md:22,32` 给出 `--max-count` 与 `TotalCount`；`GetHierarchyResponse.cs:26` 给出 `HierarchyFilePath`），但那份 vendor 源码**不在本仓库**，审查者无法从 diff 核实。
  Ruling：**把实证落进仓库**——在 `docs/CAPABILITIES-tuanjie-2022.3.62t9.md` 增加一小节「工具字段/参数实证」，逐条给出字段名 + 上游文件路径与行号（`get-logs`/`get-hierarchy`/`compile`），**并顺带落进 `docs/PITFALLS.md` 的字段名风险一条**（全局约束 12：PITFALLS 新条目必须标注适用引擎）。真机（真实 dispatcher + 编辑器）对账**不在本任务内**，划入计划既有的真机验证阶段（任务 9/10/11 的验收步 + M1 验收）——并在账本写明：若某个名字与上游不符，后果是 **falsely-fail**（健康机器上冒烟变红、立刻暴露），不是静默假绿，方向安全。
  如果错了：代价是一节文档；若真机对账发现名字不符，改的是一行字符串。
- R45 — code-reviewer 次要⑤：`ok = failed.length === 0 && passed.length > 0` 把「部分 skip」算成功（今天 skip 只可能是三项全 skip，故等价；将来某工具因版本不支持而单项 skip 时会给 `ok:true` 而有一项根本没验过）。
  Ruling：改成 `ok = failed.length === 0 && skipped.length === 0 && passed.length > 0`，尾行说明的触发条件改成 `skipped.length > 0`（并改措辞为「冒烟未执行（N 项被跳过）：未能验证任何工具」）。与 R39 同一条原则：没验过就不能报成功。
  如果错了：代价是将来单项 skip 时 `ok:false`（方向安全）。
- R46 — code-reviewer 次要③：per-tool 的 `hint` 在 `spawnError` 时恒空（`call` 契约保证 `json=null`），而探活与 `collectChecks` 都会给 `[DISPATCHER_HINT]`。
  Ruling：对齐为 `hint: r.spawnError ? [DISPATCHER_HINT] : errorNextActions(r.json)`，并补一条注入 `spawnError` 的 per-tool 用例。
  如果错了：代价为零。


Task 7: fix round 1/5 (5 addressed, 0 open — F1 per-tool 失败文案从「残句」改整句 + 换掉 R43 后已恒真的失效断言（经变异 M1/M2 验证有牙）/ F2 字段名实证落进仓内 docs（CAPABILITIES §4.6 + PITFALLS U11）+ 真机对账划入任务 9/10/11 / F3 per-tool spawnError 补 DISPATCHER_HINT / F4 ok 收紧为「无 fail 且无 skip 且有 pass」+ 尾行措辞 / F5 汇总用例真走 fail 分支 + skip 的 hint 不再共享数组; commits 65e56e1..29d7288)
Task 7: complete (commits 255250c..29d7288, review clean) — 88/88 绿（83 + 5），1 轮修复

**任务 7 延后 Minor（两轮审查合并）：**
- Task 7: minor (deferred): **文档引用不准确**——`docs/CAPABILITIES-tuanjie-2022.3.62t9.md:230` 与 `docs/PITFALLS.md:382` 把 `compile` 的 `ErrorCount`/`WarningCount` 出处之一指向「§4.3」，但 §4.3 只记录**单条错误条目**结构（`Message/Line/Column/ErrorCode/...`），不含顶层计数。**正确锚点**：同文件 `:15`（§0 的 S3 行，原文「结构化（ErrorCount/WarningCount）」）与 `docs/superpowers/specs/2026-09-18-pi-unity-design.md:407`。修法：删掉 `§4.3` 这个引用（**留给任务 12 的文档回写一并处理**）
- Task 7: minor (deferred): 无用例覆盖「`code === 0` **且有** `Error.Message`」这一格（变异 M3 在 19/19 下存活，即 `工具报告失败：boom（退出码 0）` 这种错法抓不到）；实现本身正确
- Task 7: minor (deferred): `describeFailure`（中缀）与 `standaloneFailure`（整句）**两份分流逻辑重复**，后续改「截断」措辞或分流规则必须两处同步
- Task 7: minor (deferred): `standaloneFailure` 的 `spawnError` 分支不受「`code===0` 不拼码」约束（会输出 `（退出码 0）`）；因 `lib/exec.js` 恒给 `-1`，生产不可达，仅一致性瑕疵
- Task 7: minor (deferred): `R45` 新增的 `skipped.length === 0` 子句无独立断言（「部分 skip」在当前实现里不可达，属防御性子句）
- Task 7: minor (deferred): `test/doctor.test.js` 的 `captureStdout` 猴补全局 `process.stdout`，依赖 `node --test` 输出协议的类型区分（Buffer=协议 / string=被测），跨 Node 版本与并发跑法脆弱；建议改为 `spawn(process.execPath, ['bin/unity.js', ...])` 读子进程输出（顺带覆盖 `bin/unity.js` 的整数收敛）或给 `doctor` 加 `write` 注入缝
- Task 7: minor (deferred): 混合结果（有 fail 有 pass）时人读路径无收尾统计行（只有全 skip 才打尾行），与基础检查路径的「N 项失败。」风格不一致
- Task 7: minor (deferred): `--json` 两种模式的载荷键不同（基础检查 `{ok, checks}` vs 冒烟 `{ok, results}`），下游统一消费需分支

### 任务 8（`lib/readback.js` —— 本项目唯一自研价值）

起飞前裁决（R47–R50）：

- R47 — 简报的数值分支 `if (Math.abs(iv - av) > tol)` 对 **NaN 静默假绿**：`Math.abs(NaN - x) > tol` 恒为 `false` → `{fieldOfView: NaN}` vs `{fieldOfView: 5}`、以及 `NaN` vs `NaN`，都会**不产生任何 mismatch**、`verified:true`。这是本项目立身之本（不静默）最不能接受的形态，且 Unity 侧 float 未初始化/序列化出 NaN 是真实可能的。
  Ruling：数值分支先判 NaN——**任一侧是 NaN 就必须按「不相等」处理**（NaN 不等于任何值，包括它自己）：`if (Number.isNaN(iv) || Number.isNaN(av)) { if (!(Number.isNaN(iv) && Number.isNaN(av))) push mismatch; continue; }`。注意语义：双侧都是 NaN 视为一致（同一份读数），单侧 NaN 必 mismatch。补断言把两种情形都钉住。
  如果错了：代价是 3 行代码 + 2 条断言；方向安全（NaN 从「静默通过」变成「如实报分歧」）。
- R48 — 简报的数组分支用 `JSON.stringify` 比较，有两个坑：① `NaN`/`undefined` 会被序列化成 `null` → `[NaN]` vs `[null]`、`[undefined]` vs `[null]` **假绿**；② 对象元素**键序敏感** → `[{a:1,b:2}]` vs `[{b:2,a:1}]` **假红**（方向安全但会误导）。
  Ruling：数组比较改为「**长度不同即 mismatch；长度相同则逐元素比较**」，元素是普通对象时递归走同一套 subset 比较，其余元素走与标量相同的比较（含 R47 的 NaN 规则）。**不使用 `JSON.stringify`。**
  为什么：这不是新功能，而是把「同一语义」用在数组元素上；顺带消灭一类假绿与一类假红。
  如果错了：代价是数组分支代码从 3 行变成约 8 行；行为差异只在数组元素为对象/NaN 时出现（今日无上游使用者，属预防）。
- R49 — 简报里 `if (!isPlainObject(intent)) return out` 等价于「intent 不是对象 → 无分歧 → verified:true」（假绿路径）。
  Ruling：**本轮不改，登记为延后 Minor**。理由：只有调用方传错类型（任务 10 不会）才可达，而计划没给「非对象 intent」的分歧条目形状（多一个 `reason` 键会破坏 `{key,intent,actual}` 的统一形状，留给最终审查或任务 10 真机时按需裁定）。
  如果错了：代价是一次调用方类型错误会静默通过——但它会同时在读回路径上表现为「什么都没验」。
- R50 — 简报用**绝对容差** `tol = 1e-4`。大坐标（如 `12345.678` 经 float32 往返后差 ~1e-3）会产生 falsely-fail。
  Ruling：**保持绝对容差 1e-4 不变**（简报字面），并把这条风险登记为已知取舍。理由：方向是 falsely-fail（安全且可诊断——用户能看到 intent/actual 的具体差异），而 M1 的验收场景（S5 的 `fieldOfView` 钳制、布尔与小数）不受影响；改成相对容差会在 0 附近失去意义（相对容差对小量放大误差）。任务 10 真机时若遇到大坐标失败，届时按需裁一次。
  如果错了：代价是远距离节点的写后读回可能报 falsely-fail，用户看到差异后可据此调整。


Task 8: 首轮审查（spec ✅ 通过带 2 条重要 / code ✅ 通过带 5 条重要）→ 修复循环第 1 轮

- R51 — code-reviewer 重要③（承接 R50）：绝对容差 `1e-4` 在 Unity float32 大坐标（1e6 量级 ULP≈0.0625）上必然 falsely-fail，而 `verifyWrite` 不接受 `tol` → 消费方（任务 10）即使知道原因也调不了容差。审查者建议给 `verifyWrite` 加可选 `tol` 透传。
  Ruling：**不加**（R50 维持）。理由：① 一个「调用方能自己关掉数值闸门」的逃逸口，正是本模块要防的形态（传 `tol:1e9` → 永远 `verified:true`）；② 出口其实已存在——需要调容差的消费方可以直接调 `compareSubset(intent, actual, {tol})`（已导出）；③ M1 的实际读回字段（`active`/`fieldOfView`/小坐标 position）不在危险区间，属**推测性需求**。
  Ruling 的补偿：必须在 JSDoc 里写明「大坐标（float32 ULP > 1e-4）场景下 `verified:false` 未必等于写入失败；需要不同容差就直接调 `compareSubset({tol})`」；并在账本留下触发条件——**任务 10/11 真机若真遇到该噪音，届时按实测证据加 `tol` 透传**。
  如果错了：代价是任务 10 真机遇到大坐标噪音时要绕 `verifyWrite` 或回头补透传（可诊断、非静默）。
- R52 — spec-reviewer 重要① / code-reviewer 重要②：**intent 的值是空普通对象时静默通过**，与文件头 JSDoc「actual 缺字段、类型不符……一律算分歧」直接矛盾。实测 `compareSubset({a:{}}, {a:'hello'})` → `[]`；`{a:{}}` vs `{}` → `[]`。
  Ruling：**在递归前要求 actual 侧也是普通对象**（顶层递归与数组元素递归两处）：`if (isPlainObject(iv)) { if (!isPlainObject(av)) { push mismatch; continue; } recurse... }`。理由：这 2 行把「intent 有约束、actual 类型不符」这条真实可达的假绿堵死（任务 10 把某字段塞成 `{}` 就会命中），且方向为 falsely-fail，不新增假红（`{position:{x,y}}` vs 对象仍走递归，现有测试不受影响）。
  Ruling 的边界：`{a:{}}` vs `{a:{}}`（两侧都是空对象）**仍判一致**——空对象在 subset 语义下确实没有约束，这条不改，但必须写进 JSDoc（不再宣称「一律」）。
  如果错了：代价是 2 行 + 2 条断言。
- R53 — **推翻我自己的 R49**（当时裁「非对象 intent → verified:true，不改，留给任务 10 兜」）。两位审查者独立指出这是经 `verifyWrite` 可达的假绿（`verifyWrite({intent: undefined, ...})` → `verified:true`），且都给出**形状不变的最小修法**（我原先「没有形状可用」的理由不成立）。
  Ruling：**在模块内堵住**——`compareSubset` 开头若 `!isPlainObject(intent)`，返回 **1 条分歧**（`{ key: prefix || '<root>', intent, actual }`），不再是空列表；JSDoc 同步写明「返回空列表 ≠ 验证通过」。
  为什么：闸门应当长在闸门模块里，而不是靠下游调用方自觉（调用方正是唯一会被 LLM 参数污染的地方）；`<root>` 键沿用现有条目形状，零新增字段。
  如果错了：代价是 3 行 + 1 条断言；若某调用方故意传非对象 intent 想「不验证」，它会得到一次 falsely-fail（安全方向）。
- R54 — code-reviewer 重要⑤：`readActual` 抛出/拒绝时 `verifyWrite` 原样上抛（方向安全），但**这个传播契约没有任何测试固定**，未来有人加 `try/catch` 就会静默改变语义（「写成功 + 读回从未发生 + 信封仍 ok」）。
  Ruling：JSDoc 写明「`readActual` 抛出/拒绝时 `verifyWrite` 必须拒绝；调用方必须落 `fail()`，**不得**产出 `ok` 信封」，并补 `assert.rejects` 断言把契约钉住。不改实现。
  如果错了：代价为零。
- R55 — code-reviewer 次要⑧：三条**承重分支零覆盖**（经独立变异验证存活）：① 数组元素是否走 `isMismatch` 的容差/NaN 规则（把 `isMismatch` 换成 `!==` 后 10/10 仍绿）；② `!Array.isArray(av)` 守卫（删掉后仍 10/10 绿，而 `{tags:[1]}` vs `{}` 会抛 TypeError）；③ 任务 10 依赖的 `items.0.a` 路径形状从未被断言。
  Ruling：**三条都补断言**（这是核心模块，承重分支不许无覆盖）。
  如果错了：代价是 3 条断言。
- R56 — spec-reviewer 次要③ / code-reviewer 次要⑨：`tol` 无校验——`{tol: NaN}` 会让**所有数值比较静默通过**（一个字符关掉整道数值闸门）；`{tol:-1}` 则全判分歧。
  Ruling：在 `compareSubset` 入口加守卫，非有限数或负数 → **抛 `TypeError`**（响亮失败优于静默）。理由：`tol` 是公开参数，静默失效是假绿；抛错是安全方向且立刻暴露。
  如果错了：代价是调用方传错 `tol` 会崩而不是静默走默认容差（若日后觉得太硬，可改为落到 `DEFAULT_TOL` + 记一条警告）。
- R57 — 审查者指出的 JSDoc 过度承诺（`:10-11`「一律算分歧」、`:21`「普通对象」与实际不符、`:105` 未写读回拒绝契约）→ **必须随 F1/F2/F3 一起校准**，否则文档在骗后来的维护者。
  如果错了：代价为零。


Task 8: fix round 1/5 (6 addressed, 0 open — F1 `isPlainObject` 严格化（Date/Map/Set/类实例不再假绿）/ F2 递归前校验 actual 侧类型（空对象 intent 不再假绿；两侧空对象仍判一致）/ F3 **推翻我自己的 R49**：非普通对象 intent 返回 1 条 `<root>` 分歧 / F4 三条承重分支补断言（审查者变异 A/B/K 均被新断言杀死）/ F5 `tol` 非有限或负数抛 TypeError / F6 JSDoc 校准（「空列表 ≠ 验证通过」、readActual 拒绝契约、R51 大坐标提示）; commits 26b0bbd..fde522c)
Task 8: complete (commits 29d7288..fde522c, review clean) — 107/107 绿（88 + 10 + 9），1 轮修复

**任务 8 带入下游的硬要求（任务 10 必须做）：**
- **`verifyWrite` 的 intent 必须是普通对象**（R53 已在模块内堵住非对象 intent：会返回 1 条 `<root>` 分歧 → 落 `fail()`，但任务 10 仍应在入口显式校验并给出可读 hint）
- **`readActual` 抛出/拒绝时 `verifyWrite` 会拒绝**：任务 10 必须捕获并落 `fail()`，**不得**让「写成功 + 读回从未发生」产出 `ok()` 信封（`envelope.ok()` 只白名单接收 `verified`/`intent`，忘传 `verified` 会得到 `verified:null` 而不是 false）
- 空 intent（`{}`）会让 `verified:true`——只表示「无需比对」，不表示「写入被验证」；任务 10 不得用空对象充当 intent

**任务 8 延后 Minor（两轮审查合并）：**
- Task 8: minor (deferred): JSDoc `:21-23` 后半句「只要 intent 是普通对象，`verified:true` 就只可能来自真实比对」被同段反例推翻（`verifyWrite({intent:{}})` → `verified:true`，零次比对）→ 应把「顶层空对象」补进例外清单
- Task 8: minor (deferred): 文件头「actual 缺字段…算分歧」对 intent 侧值为 `undefined`（`{a:undefined}` vs `{}` → `[]`）不成立，属 JS 语义固有歧义，建议加一句说明
- Task 8: minor (deferred): `test/readback.test.js` 的 `{tags:'no'}` 半条对变异 B 无区分力（只有 `{}` 那半条承重）
- Task 8: minor (deferred): 嵌套数组假红（`[[1,2]]` vs `[[1,2]]` → 1 条分歧且 intent/actual 打印相同）——方向安全，M1 字段不涉及；顺带可消除顶层循环与数组元素分支的派发重复
- Task 8: minor (deferred): `prefix` 是公开参数（可伪造 key 后缀，但压不掉任何分歧）；建议改名 `_prefix` 或拆私有递归
- Task 8: minor (deferred): key 用 `.` 拼接 → 键名自带 `.` 时路径歧义（`{'a.b':1, a:{b:2}}` 两条条目 key 都是 `a.b`）
- Task 8: minor (deferred): 环状 intent → 栈溢出（JSON 构造不出环）；`-0` vs `0` 判一致
- Task 8: minor (deferred): `verifyWrite` 返回值是原始引用（调用方不得就地修改），JSDoc 未注明

### 任务 9（读路径：`scene tree` / `node inspect`）

起飞前裁决（R59–R66）：

- R59 — 简报的 CLI 处理器硬编码 `emit(e, { json: true })` → `--json` 形同虚设、「人读路径」永不执行，而任务 1 的 `USAGE` 明写 `--json 输出机器可读 JSON`。
  Ruling：改为 `emit(e, { json: Boolean(args.json) })`（与 `doctor` 一致：默认人读、`--json` 才机器可读）。
  如果错了：代价是脚本调用方必须显式加 `--json`（本来就该加）。
- R60 — 简报的 `sceneTree` 把 `readHierarchyFile()` 直接放进 `ok` 信封：文件缺失/损坏时**同步抛异常** → `bin/unity.js` 捕获 → `internal error` + **退出码 3**，而不是一个可诊断的失败信封。
  Ruling：读文件/解析必须包 try/catch → `fail({code:'HIERARCHY_READ_FAILED', message, actual:{path}, hint:[...]})`。理由：uloop 给了路径但文件还没落盘/被清理是真实可能的；退出码 3 是「本工具自己坏了」，与事实不符。
  如果错了：代价是 5 行 + 1 条断言。
- R61 — 简报 `normalizeHierarchy` 取 `raw.Hierarchy[0]`：多场景（`Hierarchy.length > 1`）时**静默丢弃其余场景**，读者会以为树是完整的。
  Ruling：保留 `Hierarchy[0]` 为 M1 主路径（单场景），但**丢弃必须可见**——返回值加一个 additive 字段（如 `otherSceneCount`，及可选的场景名列表），并在 >0 时把「还有 N 个场景未读」放进 hint/消息。补断言。
  如果错了：代价是 1 个字段 + 1 条断言；收益是「静默丢数据」变成可见。
- R62 — 简报的 `nodeInspect` 直接 `JSON.parse(r.json.Result)`：`Result` 缺失或不是 JSON 时**抛异常** → 退出码 3。
  Ruling：解析失败落 `fail({code:'BAD_SCRIPT_RESULT', message, actual:{raw: r.json.Result}, hint})`，不得抛。
  如果错了：代价同 R60。
- R63 — 简报 `node-inspect.cs` 用 `GameObject.Find(p)`：它**找不到非激活对象**（对 inactive 节点返回 null），而 `get-hierarchy` 恰好会列出非激活节点（`isActive` 字段存在本身就是证据）→ 「scene tree 里看得见的节点 inspect 不到」是误导，且 `NOT_FOUND` 的 hint 会把用户引向错误方向。
  Ruling：`.cs` 必须能读到非激活节点——`GameObject.Find` 失败后回退遍历当前场景的**所有根对象（含 inactive）**按路径查找（例如 `scene.GetRootGameObjects()` + 递归 `Find`）。M1 无法单测 .cs，因此要求把「回退路径」写进报告的真机验证项。
  如果错了：代价是 .cs 多约 10 行；若回退也没找到，仍返回 `NOT_FOUND`（方向不变）。
- R64 — 简报 .cs 用字段名 `position` 但读的是 `rt.localPosition`（世界坐标 `position` 与局部坐标 `localPosition` 语义不同，静默混淆会让任务 10 的 patch 打偏）。
  Ruling：**保持字段名 `position`（任务 10 的 patch 与之对齐）**，但 `.cs` 注释与 `lib/scene.js` 的 JSDoc 必须写明「`position` = `localPosition`（局部坐标）」。
  如果错了：代价为零（文档）。
- R65 — 简报只有 3 条用例，且全是**纯函数**（`normalizeHierarchy`/`readHierarchyFile`/`buildPayloadArgs`）——`sceneTree`/`nodeInspect` 这两条**真正的命令路径零覆盖**，而计划自己在 R2 裁定里为它们预留了 `_call` 注入缝。
  Ruling：必须用 `_call` 注入补用例，至少覆盖：① `sceneTree` 成功（含 `ok`/`verified`/`actual.roots`）② `fromUloop` 失败（`Success:false`）③ `NO_HIERARCHY_PATH` ④ R60 的读文件失败 ⑤ `nodeInspect` 成功 ⑥ `NOT_FOUND` ⑦ R62 的 `Result` 非 JSON。测试数 3 → 约 9~10。
  如果错了：代价是若干条断言；收益是本任务的核心行为真的被验过。
- R66 — **计划内部自相矛盾**：计划自己的信封契约写「`ok:true` 时 `verified` 仍为 `null`；**只有写后读回比对通过才置 `true`**」（计划 `:596`），规格也定义 `verified` = 「意图是否达成」（设计文档 `:245`）；但任务 9/11 的成功信封写的是 `verified: true`。读命令**没有 intent 可比对**，声称 `verified:true` 就是虚报。
  Ruling：读路径（`sceneTree`/`nodeInspect`，以及后续任务 11 的 `shot`）一律 **`verified: null`**，并**用 `ok(actual, {hint})` 构造信封**（不手写对象字面量，保持单一构造点与白名单行为一致）。
  为什么：规格是有约束力的权威，计划内部冲突以规格裁；信封层的 `verified` 是本项目唯一自研语义（`verified:false` 就是失败，必须停下），虚报 `true` 会污染这条铁律。
  如果错了：代价是下游若按 `verified === true` 判断「读成功」会看到 `null`（但正确判据是 `ok`）；任务 10/11 需知道读命令的 `verified` 是 `null`。


- R67（**实现者自提、控制者事后接受并补登记**——审查者指出账本缺这一条）：`Result` 为 `null`/`"x"`/`1`/`[1,2]` 等非对象也落 `BAD_SCRIPT_RESULT`，避免「`ok` 但没节点」的假成功。
  Ruling：接受，理由与 R38（字段缺失即 fail，不得用占位符假装成功）同源。
  如果错了：代价为零。

Task 9: 首轮审查（spec ❌ 需要修复（1 关键）/ code ❌ 需要修复（1 关键 + 2 重要））→ 修复循环第 1 轮

- R68 — 两位审查者独立命中同一条**关键**：`sceneTree` 的 catch 块**自己会抛**。缺 `--project-path` 时 `readHierarchyFile` 里 `path.join(undefined, rel)` 先抛 TypeError，catch 内又调 `toAbs(projectPath, ...)` 走同一条 `path.join(undefined, ...)` **第二次抛**，无人接管 → 冒到 `bin/unity.js` 顶层 → `internal error` + **退出码 3**。**这正是 R60 要消灭的形态**（「退出码 3 是『本工具自己坏了』，与事实不符」），而 `--project-path` 在 USAGE 里是可选选项、`HierarchyFilePath` 又是项目相对路径 → 正常可达用法。
  Ruling：① 在 try **之前**显式守卫：`if (!projectPath) return fail({code:'MISSING_PROJECT_PATH', message, actual:{hierarchyFilePath: r.json.HierarchyFilePath}, hint:['用 --project-path <项目根> 指定项目；HierarchyFilePath 是项目相对路径']})`；② 绝对路径只算一次并复用（`readHierarchyFile` 与 catch 里的 `actual.path` 共用同一份 abs），**catch 体内不得再有任何可抛调用**；③ 补一条 `_call` 注入用例（**不传** `projectPath`）断言「不抛且 `ok===false`、`code==='MISSING_PROJECT_PATH'`」——现有 13 条没有一条传缺失的 `projectPath`，所以这个洞全绿通过。
  为什么：失败路径的提示必须指向真因（缺参数 ≠ 文件没落盘），且「读路径失败绝不退化成 internal error」是 R60 立条的目的本身。
  如果错了：代价是 5 行 + 1 条断言 + 一个新的错误码。
- R69 — 审查者重要：`node inspect` 缺 `--path` 无守卫（实测 `buildPayloadArgs('node-inspect',{path:undefined})` → 载荷 `{}`；`parseArgs(['--path'])` → `{path:true}` → C# 里 `Find("True")`）。失败信号会误导（Unity 异常栈或「节点不存在：undefined」）。
  Ruling：**在 `lib/scene.js` 的 `nodeInspect` 内守卫**（不只挡 CLI——任务 10 复用同一函数）：`typeof nodePath !== 'string' || nodePath === ''` → `fail({code:'MISSING_PATH', message:'缺少 --path（形如 Canvas/Btn）', actual:{path:nodePath}, hint:['用 `unity scene tree` 取可用路径']})`；并把 `NOT_FOUND` 的 `actual` 补上 `{path}`。
  为什么：任务 10 拿它做写后读回的读回端，更需要这个前置失败；守卫只在恒非法输入上触发，不影响正常调用。
  如果错了：代价是 4 行 + 1 条断言。
- R70 — 审查者重要：`normalizeHierarchy` 对**缺字段静默默认**——`raw` 为 `null`/`{}`/`{Hierarchy:[]}`/`{Hierarchy:[{}]}` 一律返回 `ok` + `{roots:[],nodeCount:0}` + exit 0，与「空场景」不可区分；且 `nodeCount` 取 `stats.nodeCount` 而非从树里数出来 → 上游改名时会给出「`nodeCount:0` 而 `roots` 有 N 个节点」的**自相矛盾结果**。这与本项目纪律相反（R38：读不到所需字段就 fail 并点名，绝不用占位符假装成功）。
  Ruling：**在命令路径（`sceneTree`）校验 `raw` 形状**：`Hierarchy` 必须是数组且 `Hierarchy[0]` 必须含 `stats` 与 `roots`（数组）；不符 → `fail({code:'BAD_HIERARCHY', actual:{keys:Object.keys(raw)}, hint:[...]})`。`normalizeHierarchy` 本身保持宽容纯函数（任务 10 也用它），但它的 JSDoc 必须写明「宽容规范化：字段缺失按空处理，形状校验在 `sceneTree`」。区分标准：**真正的空场景**（`Hierarchy:[{stats:{rootCount:0,nodeCount:0},roots:[]}]`）仍 `ok`。补断言（空场景 ok / 缺 `stats` fail）。
  如果错了：代价是 6 行 + 2 条断言；收益是「空场景」与「schema 不符」不再混为一谈。
- R71 — 审查者次要（与 R70 同路径，一并做）：`walk` 对 `children` 非数组会 `.map is not a function` 抛；名字含 `/` 时 `path` 有歧义（这条**只写文档**：`path` 由名字拼接、不保证唯一、不能表示含 `/` 的名字；`siblingIndex`/`tag`/`layer` 是上游提供却被本实现丢弃的消歧信息，留待任务 10 按需取用）。
  Ruling：`children: Array.isArray(node.children) ? … : []`（防抛）；歧义性写进 JSDoc。其余（`roots:[null]`、节点缺 `name`）由 R70 的结构校验 + 宽容 walk 兜住，不再单独加固。
  如果错了：代价是 1 行。
- R72 — 审查者次要：`__error` 协议只认 `NOT_FOUND` → `{__error:'FUTURE_CODE'}` 会变成 `ok:true`（与 R67 自陈理由同类）；`.cs` 只发 `NOT_FOUND`，今日不可达但明天就会。
  Ruling：泛化为**任何字符串** `__error` 一律 `fail({code: parsed.__error, message, actual: parsed})`。补断言。
  如果错了：代价是 2 行。
- R73 — 审查者次要：`node` 的 CLI 粘合零覆盖（把 `path: args.path` 写成 `args.name`、把 `node` 分支改回 `json:true`、把 `return 2` 改成 `return 0`，120 条全绿）。
  Ruling：补 3 条 CLI 级用例（用 `main([...])` 注入）：`node inspect --path X --json` 返回 0 且输出 JSON、未知子动作/缺子动作返回 2、缺 `--path` 时落 `MISSING_PATH` 且返回 1。
  如果错了：代价是 3 条断言。
- R74 — 审查者次要（.cs 两处）：① `GetComponents<Component>()` 可能含 `null`（Missing Script）→ `.Select(c => c.GetType().Name)` 直接 NRE，而「缺脚本」恰是 agent 想 inspect 的场景；② 回退只在**当前激活场景**内，非激活场景/`DontDestroyOnLoad` 里的节点仍 `NOT_FOUND`，而提示说「用 scene tree 看路径」（tree 里确实有）。
  Ruling：① 加 `.Where(c => c != null)`（1 行）；② 本轮**不扩到全部场景**（M1 单场景），但 `NOT_FOUND` 的 hint 必须写明「仅查当前激活场景（含 inactive 节点）」，把「tree 里有、inspect 不到」的原因摊开。两处都要写进报告的真机验证项（若不便真机验证，如实说明）。
  如果错了：代价是 1 行 + 一句 hint。
- R75 — 审查者次要：R61 的 hint 在 `sceneName` 为空时打出断尾句（「还有 1 个场景未读（M1 只读第一个场景）：」）。Ruling：空名退化为「场景 #2」之类可读标识。代价为零。


Task 9: fix round 1/5 (8 addressed, 0 open — F1 **关键**：缺 `--project-path` 时 catch 块二次抛出（退出码 3 复活）/ F2 `node inspect` 补 MISSING_PATH 守卫（放在 lib 层供任务 10 复用）/ F3 `sceneTree` 校验 Hierarchy 形状（`BAD_HIERARCHY`，与「真·空场景」区分）/ F4 `children` 防抛 + `path` 不唯一的文档 / F5 `__error` 泛化 / F6 补 3 条 CLI 级用例（经变异实证承重）/ F7 `.cs` 过滤 null 组件 + NOT_FOUND hint 写范围 / F8 空场景名退化; commits 27cab0a..4af2d59)
Task 9: complete (commits fde522c..4af2d59, review clean) — 131/131 绿（107 + 13 + 11），1 轮修复

**任务 9 带入下游的硬要求（任务 10/11）：**
- `readHierarchyFile(projectPath, relPath)` **仍会抛**（JSDoc 已写明由调用方收敛）→ 任务 10 直接调用必须自己 try（`sceneTree` 已按 R68 收敛）
- `nodeInspect` 的 `MISSING_PATH` / `NOT_FOUND` 守卫已在 lib 层 → 任务 10 的写后读回可直接依赖
- 审查者建议「任务 10 顺手修」的三条（见下 R76）

**任务 9 复审新增的延后 Minor（审查者建议并入任务 10，控制者已采纳为 R76）：**
- Task 9: minor：**`normalizeHierarchy` 的可抛路径仍在 try 之外**——深度 ~3000 的嵌套 hierarchy JSON 会让 `walk` 栈溢出 → `internal error` + 退出码 3（实测：`JSON.parse` OK 而 `walk` RangeError）。非本轮引入，但「读路径无抛」这条目标未完全达成 → 给 `walk` 加深度上限并 `fail({code:'HIERARCHY_TOO_DEEP'})`
- Task 9: minor：F5 泛化的三个语义缺口——`__error:''` → `code:''`；`__error` 非字符串 → 仍 `ok:true`（F5 想消灭的形态）；`__error:'ULOOP_NO_JSON'` 会被 `fail()` 归类成 `retryable:true` → 建议外来码加前缀（如 `SCRIPT_${code}`）或至少排除空串
- Task 9: minor：`stats` 存在但 `nodeCount` 缺失/非数字仍 `ok`（`actual` 里没有 `nodeCount` 键 / 是字符串）→ 与 R38「读不到所需字段就 fail 并点名」同源
- Task 9: minor：`{Hierarchy:[]}` 现在落 `BAD_HIERARCHY`——**需真机确认** uloop 在「无已加载场景」等合法状态下是否会回空列表（任务 10 真机时顺带查）
- Task 9: minor：`.cs` 过滤 `null` 组件后，「Missing Script」槽位在 `components` 里彻底消失（信息损失，agent 恰想诊断它）→ 建议任务 10/11 追加 `missingScriptCount`
- Task 9: minor：`NOT_FOUND` hint 里「其它场景/DontDestroyOnLoad 里的节点会报 NOT_FOUND」是未测散文，且比代码保证更强（`GameObject.Find` 对激活的跨场景对象可能仍命中）→ 真机验证后再固化措辞
- Task 9: minor：`bin/unity.js` 的 `USAGE` 未写 `node inspect` 需要 `--path`，`--path` 也不在「全局选项」列表（`--help` 看不出怎么用）
- Task 9: minor：测试临时目录不清理（仓库既有约定，五处文件同风格）

### 任务 10（写路径 + verified —— 信封层价值的兑现点）

起飞前裁决（R77–R89）：

- R77 — 简报在 `nodeCreate`/`nodeSet` 里**复制**了任务 9 已经写好的「脚本结果解析」语义（`Result` 缺失/非 JSON/非对象/`__error` 哨兵 = R62/R67/R72）。而 `nodeCreate` 的写法更糟：`envl.actual.Result.includes('__error')` 之后直接 `JSON.parse(...)` → `Result` 不是 JSON 时会**抛**（退出码 3 复活，正是 R60/R68 的形态）。
  Ruling：抽出**一个**局部 helper（如 `parseScriptResult(r.json, {tool})`）返回 `{ok:false, envelope}` 或 `{ok:true, value}`，把 R62/R67/R72（含 R89 的收严）集中在一处，`nodeInspect`/`nodeCreate`/`nodeSet` 三处共用。**禁止三份复制。**
  如果错了：代价是同文件内一次小重构。
- R78 — **简报的 `nodeCreate` 与简报自己的测试 1 自相矛盾**：它对写结果不比对任何 intent，只把 `nodeInspect(...)` 的信封直接返回；而 `nodeInspect` 返回的是 `ok(parsed)`（R66 定案：读命令 `verified: null`）→ 测试 1 断言 `e.verified === true` **在简报代码下必然失败**。
  Ruling：**以测试/规格为准**——`nodeCreate` 必须真的做写后读回比对：显式构造 `intent`（至少 `{ name, active: true }`，有 `parent` 时追加 `path`，见 R79），走 `lib/readback.js` 的 `verifyWrite({intent, readActual})`，返回 `{ok:true, verified, intent, actual, mismatches, hint}`。
  为什么：`verified` 是本项目唯一自研语义，create 若返回 `verified:null` 就等于把「建了没建、建对没建对」交给 uloop 的 `Success`——正是整条 M0 结论要否定的东西。
  如果错了：代价是 create 的返回形状比简报多了 `intent`/`mismatches`（信封本来就该有）。
- R78b — 组件参数是**静默假绿**：简报 `.cs` 用 `System.Type.GetType((string)c + ", UnityEngine")`，而它自己的示例写 `["cc.Sprite"]` → 解析为 null → `if (t != null)` **静默跳过** → 用户要的组件一个没加，`Success:true`，且（按 R78）也不会出现在 intent 里。
  Ruling：① `.cs` 遇到解析不出的类型必须返回 `__error: 'COMPONENT_TYPE_NOT_FOUND'`（带上是哪个名字），**不得静默跳过**；② 请求的每个组件**短名**必须出现在读回的 `components` 里，否则产出一条 `{key:'components', intent, actual}` 分歧（`verified:false`）；③ 文档写明组件名写法（`UnityEngine.X` 或短名 `X`，两者都映射到短名比对）。
  如果错了：代价是 .cs 与 JS 各几行；收益是「加了组件」这件事真的被读回验证过。
- R79 — create 的「建在哪」无法读回验证：`node-inspect` 的输出只有 `name/active/position/scale/components`，没有路径信息（parent 是否生效无法证明，脚本自报的 `path` 属弱证据）。
  Ruling：`unity-scripts/node-inspect.cs` **增加 `path` 字段**（沿 `transform` 向上拼 `parent/child`），于是 create 的 intent 可含 `path`（`parent ? parent + '/' + name : name`）并被真读回验证；`nodeInspect` 的 JSDoc 同步写明该字段与 R71 的「不保证唯一」约定。
  如果错了：代价是 .cs 增加约 8 行 + 文档；任务 9 的 JS 测试用假载荷驱动，不受影响。
- R80 — `node-set.cs` 用 `GameObject.Find(p)`：与任务 9 的 R63 同病——**非激活节点找不到**。而 R82 让这一点变成致命：`node set --patch '{"active":false}'` 之后读回用的还是 `Find` → NOT_FOUND → 读回 `{}` → 全部键 mismatch → **「把节点设为非激活」永远 `verified:false`**（常见的正确操作被报成失败）。
  Ruling：`node-set.cs` 的查找必须与 `node-inspect.cs` 共用同一套「`Find` 失败 → 回退遍历当前激活场景所有根对象（含 inactive）按路径递归查找」。
  如果错了：代价是 .cs 多约 10 行；不做则写路径的核心用例之一永远假红。
- R81 — 改名的读回路径错误：patch 含 `name` 时节点被改名，而简报仍用**旧** `nodePath` 读回 → NOT_FOUND → `{}` → 全部 mismatch → 改名永远 `verified:false`。
  Ruling：读回路径 = `patch.name ? (父前缀 ? 父前缀 + '/' + patch.name : patch.name) : nodePath`（父前缀 = `nodePath` 去掉最后一段）。
  如果错了：代价是 2 行。
- R82 — 见 R80 的后果说明：**`active:false` 的读回必须走 inactive 回退**，并把「设为非激活 → `verified:true`」列为**验收项**（简报测试 3 已经断言了这一点，实现必须真的满足它）。
- R83 — `node-set.cs` 的 `(float)v["x"]` 在部分 patch（`{"position":{"x":1}}` 缺 y/z）时会 NRE/InvalidCast → 用户看到 Unity 异常栈。
  Ruling：`position`/`scale` 子对象缺字段 → `__error: 'BAD_PATCH'`（点名缺哪个字段），不得抛。
  如果错了：代价是 .cs 几行。
- R84 — `nodeSet` **不检查**写结果的 `__error`（`nodeCreate` 检查了）：`node-set.cs` 返回 `{"__error":"NOT_FOUND"}` 时 `Success:true` → 继续读回 → 读回 `{}` → 一堆 mismatch → 用户看到的是「值不对」而不是「节点不存在」（误因，R27/R31/R43 一路在治的病）。
  Ruling：`nodeSet` 与 `nodeCreate` 走**同一个**结果解析 helper（R77），`__error` 一律 `fail({code, message, hint})`。
  如果错了：代价为零（复用）。
- R85 — CLI 退出码与设计铁律不一致：设计文档写「**`verified:false` 就是失败，必须停下处理**」，而简报的处理器 `return e.ok ? 0 : 1` → 语义偏离（`ok:true, verified:false`）会**退出码 0**，脚本无法察觉。
  Ruling：写命令的退出码改为 `e.ok && e.verified !== false ? 0 : 1`（读命令 `verified` 为 `null` → 不受影响，仍 `0`）。
  如果错了：代价是脚本对「写成功但意图未达成」能感知到失败——这正是设计要的；若有人依赖旧的 0，属修复了错误行为。
- R86 — `name` 缺失/空 → 简报会 `new GameObject("")`（合法但无用）。Ruling：JS 侧守卫 `typeof name !== 'string' || name === ''` → `fail({code:'MISSING_NAME', hint:[...]})`。
- R87 — `--patch` 的 `JSON.parse` 由 CLI 就地做（账本 R7：`parseArgs` 只做字符串透传）。Ruling：解析失败 → 走 usage（`return 2`，stderr 说明 JSON 非法），**不得抛**。
- R88 — `patch` 非普通对象（缺 `--patch`、`--patch '[]'`、裸写 `--patch` → `true`）→ 简报会在 C# 里 `(JObject)req["patch"]` 得 null → `patch["name"]` NRE。Ruling：JS 侧守卫 → `fail({code:'MISSING_PATCH', hint:['--patch 需要一个 JSON 对象，如 --patch \'{"active":false}\'']})`（顺带满足任务 8 R53：verifyWrite 的 intent 必须是普通对象）。
- R89 — 顺带修任务 9 复审遗留的三条（审查者建议并入本任务，控制者采纳）：
  ① `normalizeHierarchy` 的 `walk` 加**深度上限**（如 200），超限 → `fail({code:'HIERARCHY_TOO_DEEP'})`（实测深度 ~3000 会栈溢出逃到顶层 → `internal error` + 退出码 3）；
  ② `__error` 三个缺口收严：空串不算错误码、非字符串 `__error` 也判失败、外来错误码加前缀（如 `SCRIPT_${code}`）以免被 `fail()` 误归入 `RETRYABLE_CODES`；
  ③ `stats` 存在但 `nodeCount` 缺失/非数字 → `fail({code:'BAD_HIERARCHY'})` 并点名（与 R38「读不到所需字段即 fail」同源）。
  另：**真机确认** uloop 在「无已加载场景」等合法状态下是否会返回 `Hierarchy: []`（若会，R70 的判定要放宽）。
  如果错了：代价是若干行；不做则留下「深度攻击 → 退出码 3」与一条静默缺键。


Task 10: 首轮审查（spec ✅ 通过带 1 重要 / code ❌ 需要修复带 1 关键 + 3 重要）→ 修复循环第 1 轮

- R90 — code-reviewer **关键**：`node-set.cs` **先改后验**——`:43` 改名、`:55` `SetActive` 在 position/scale 的 `BAD_PATCH` 校验**之前**执行。反例：`node set --path Brick --patch '{"name":"New","position":{"x":1}}'`（缺 y/z）→ 节点**已被改名**，然后才报 `BAD_PATCH`；而这条失败路径**永不读回** → 改动对调用者不可见；agent 修好 patch 重试时旧 `--path` 已 NOT_FOUND，会把「改名成功」误判成「节点消失」。
  Ruling：`.cs` 改成**两遍式**——先只做全量校验（name/active 类型、position/scale 含 x/y/z 且为数值），全部通过后再统一赋值；**校验分支内不得出现任何 `go.` 赋值**。不用「改完再回滚」（要记旧值，更脆）。
  如果错了：代价是 .cs 结构从单遍变两遍（可读性略降）。
- R91 — code-reviewer 重要 / spec-reviewer 次要③：**空 patch `{}` → `ok:true` + `verified:true` + 退出码 0**（`verifyWrite` 对空 intent 返回空 mismatch → 「什么都没比」却宣称 VERIFIED）。实测：加「空对象即失败」的守卫后 **49 条测试全绿** → 该行为既无护栏、也无任何用例依赖它。
  Ruling：`nodeSet` 在 `isPlainPatch` 之后加 `Object.keys(patch).length === 0` → `fail({code:'EMPTY_PATCH', message:'--patch 不能是空对象（没有可比对的字段）', actual:{patch}, hint})` + **补测试**。
  为什么：这是本模块唯一「零信息 `verified:true`」；`--patch '{}'` 很容易由模板/配置序列化产生。
  如果错了：代价是 3 行 + 1 条断言。
- R92 — code-reviewer 重要：**patch 键集合不封闭**——`node-set.cs` 只认 `name`/`active`/`position`/`scale`，其余静默丢弃；而与 `node-inspect` 输出**同名**的键（`components`/`path`）会「空验证」：实测 `--patch '{"components":["Transform"]}'` 打在只有 Transform 的节点上 → `ok:true, verified:true`，而 `node-set.cs` 根本没有组件逻辑。
  Ruling：`nodeSet` 加**键白名单** `['name','active','position','scale']`；未知键 → `fail({code:'UNKNOWN_PATCH_KEY', actual:{unknown, allowed}, hint:['node set 支持的字段：name/active/position/scale；加组件用 node create --components']})` + 补测试。
  为什么：不封闭键集既有假绿面，又有「静默丢弃 + 同一 patch 里其它键照样生效」（= R90 的部分生效同类）。
  如果错了：代价是 ~6 行 + 1 条断言；收益是 patch 的语义被写死并可测。
- R93 — code-reviewer 重要：`node-create.cs:77` 的 `AddComponent(t)` 对**非 Component 类型**（如 `System.String`，`GetType` 会解析成功）会抛 `ArgumentException`，而两处 `DestroyImmediate(go)` 都在它之前 → 异常穿出 → **场景留下半成品节点**（报告里「失败会清理」的声明覆盖不到这条）。
  Ruling：解析出 `t` 后先判 `typeof(Component).IsAssignableFrom(t)`，不满足 → `COMPONENT_TYPE_NOT_FOUND`（或 `NOT_A_COMPONENT`）并走既有的 `DestroyImmediate(go)`；`AddComponent` 外再套 try/catch 兜底并清理。
  确认（审查者已核）：`DestroyImmediate(go)` **不会**误删既有节点（`go` 恒为新建实例）。
  如果错了：代价是 .cs 几行。
- R94 — spec-reviewer 重要：`--parent` 传**裸名/非根路径**时口径不一致——`.cs` 的 `GameObject.Find(parentPath)` 按 Unity 语义命中**任意深度**同名对象并正确 `SetParent`（意图达成），但 JS 用同一串拼读回路径 `Panel/Brick` → `FindByPath` 从根逐名匹配失败 → `READBACK_FAILED`（exit 1），**且节点留在场景里**（`.cs` 只在 `PARENT_NOT_FOUND`/组件失败时清理），hint 也不提残骸 → agent 重试会造重复节点（而任务 11 的黄金流程正是连续 create）。
  Ruling：① `.cs` 侧统一口径——当 `parentPath` **不含 `/`** 时只接受**根对象**（`parent.transform.parent == null`），否则 `PARENT_NOT_FOUND` + hint「父路径需从根写起（如 Canvas/Panel）」；② JS 侧加 `parent` 类型守卫（非字符串/空 → `BAD_PARENT`）并去掉尾随 `/`（`--parent Canvas/` 现在会拼出 `Canvas//Brick` → 假红）；③ `readBackAndVerify` 的读回失败分支的 hint 必须写明「**写入可能已生效**；create 可能已在场景里留下新节点，用 `unity scene tree` 复核并清理」。
  如果错了：代价是 .cs/JS 各几行；不做则留下「已建成却报失败 + 残骸不可见」这个唯一的真·副作用。
- R95 — 三条便宜的收尾（审查者次要）：
  ① `nodeSet`/`nodeCreate` 的**写调用**也包一层 try/catch（与 `readBackAndVerify` 同构）→ `fail({code:'WRITE_CALL_FAILED'})`，消除「`call` 若 reject → internal error + 退出码 3」的不对称（审查者已确认生产上 `run()` 不 reject，属双保险）；② `.cs` 的 `position`/`scale` 值类型校验（`{"x":"abc"}` → `BAD_PATCH` + `field`，现在会落到 Unity 异常）；③ `_call` 注入测试补 `spy.length === 2`（现在多余的调用会复用最后一帧、永不被发现）；④ `.cs` 静态正则测试加注释标明是**字符串 tripwire**、不是行为测试（它测不出 CS0136 这类真缺陷）。
  如果错了：代价是各 1-3 行。
- 【登记不改】审查者次要：名字路径不唯一（同名父/同名目标对读回不可见）→ 已在 JSDoc/hint 声明，无便宜解法；`node-inspect.cs` 的 `pathSegs.Insert(0,…)` 是 O(depth²)（有深度上限兜底）；报告行号卫生。


Task 10: fix round 1/5 (6 addressed, 0 open — F1 **关键**：`node-set.cs` 改两遍式，失败的 set 不再部分改动场景 / F2 `EMPTY_PATCH` / F3 `UNKNOWN_PATCH_KEY` 白名单（堵掉与 node-inspect 同名键的空验证）/ F4 `NOT_A_COMPONENT`+`COMPONENT_ADD_FAILED` 清理残骸 / F5 `--parent` 口径统一（裸名只收根对象）+ `BAD_PARENT` + 去尾 `/` + 残骸 hint / F6 `WRITE_CALL_FAILED`+`spy.length===2`+tripwire 注释; commits c2765fe..a8b1f46)
Task 10: complete (commits 4af2d59..a8b1f46, review clean) — 162/162 绿（131 + 25 + 6），1 轮修复

**任务 10 带入下游的硬要求（任务 11/12）：**
- 写命令退出码 = `e.ok && e.verified !== false ? 0 : 1`（R85）；读命令 `verified` 仍为 `null`（R66）
- `readBackAndVerify` 的读回失败 hint 现在带「写入可能已生效」——但它对 `node set` 说成「create 可能留下新节点」是错的（见下 R96①）
- **简报步骤 5 的反向验证值 `1e30` 是错的**（float32 最短往返不产生 mismatch，实测 `verified:true`）。**正确的反例是 `100000.123`**（float32 ULP≈0.0078 ≫ tol=1e-4）；`1e39` 是「超 float 上限被忽略」而非「钳制」。任务 11/12 与 skill 文档引用反向验证时**必须用 `100000.123`**。

- R96（控制者采纳审查者建议，**折进任务 11 一并修**，避免为 5 条小项单开一轮）：
  ① `readBackAndVerify` 的残骸 hint 对 `node set` 说成「create 可能留下新节点」→ 误导（set 不会新建节点）。改为**中性表述**（如「写入可能已生效；用 `unity scene tree` 复核本次改动的落点，必要时清理」）或由调用方传入 `residueLabel`；测试里固化的那段文案同步改。
  ② `nodeSet` 对 `patch.name === ''` 不校验 → `.cs` 会把节点改成**无名**，而读回路径仍用旧路径 → `READBACK_FAILED` + 旧的无名残骸难寻址（真值判断 `patch.name ? … : nodePath` 是 R81 遗留）。改：`patch.name === ''` → `BAD_PATCH`（`actual:{field:'name'}`）；并把 `:734` 的真值判断改成 `Object.hasOwn(patch,'name')`。
  ③ `actual.allowed` 直接外泄模块级数组引用（调用方 `push` 会**静默放宽白名单**）→ `allowed: [...PATCH_KEYS]`；hint 里的键名列表改用 `PATCH_KEYS.join('/')`（避免两份真值漂移）。
  ④ `PARENT_NOT_FOUND` 丢了 `.cs` 返回的 `detail`（「裸名只接受根对象」）→ message/actual 带上它，否则「节点存在但在嵌套里」会被读成「不存在」。
  ⑤ `node-create.cs` 的组件类型解析（`Type.GetType("Sprite, Nope")` 这类畸形程序集限定名）**可能抛异常且清理在其后** → 把「解析 + 添加」整段包 try/catch 并清理（与 F4 同类残骸路径）；裸名守卫的顺序（先 `Find` 再判根）在同名根/嵌套共存时会误拒 → 改成裸名直接走根锚定查找。
  ⑥ `test/scene.test.js` 里 `assert.notStrictEqual(e.code, 'BAD_PARENT')` 近乎失效（任何其它错误码都能过）→ 改成断言 `e.ok === true` 或断言写入载荷里没有 `parent`。
  ⑦ 【留给任务 12】`bin/unity.js` 的 usage 未同步：`--parent` 现在「裸名只匹配根对象」、`--patch` 新增 `EMPTY_PATCH`/`UNKNOWN_PATCH_KEY` 两个失败码。


### 任务 11（`unity shot` 截图 + O6 窗口名映射）

**上游实证（控制者已核，供实现者当依据，不必再猜）**
- `uloop screenshot [--window-name <name>] [--resolution-scale <s>] [--match-mode <exact|prefix|contains>] [--capture-mode <auto|window|rendering|GameView>] [--annotate-elements] [--annotate-raycast-grid] [--raycast-layer-mask] [--elements-only] [--output-directory <path>]`（`vendor/uloopmcp/Editor/FirstPartyTools/Screenshot/Skill/SKILL.md:14`）
- `--window-name` 默认 `Game`；**当解析出的模式是 `rendering` 时被忽略**（PlayMode 下 `auto` 解析为 `rendering`）；Game 页签是 Device Simulator 时默认 `Game` 回落 `Simulator`（同文件 `:21`、`:24`）
- `--capture-mode` 默认 `auto`（`auto` = PlayMode 用 rendering、否则用 window；`rendering` 需要 PlayMode）（`:24`）
- `--output-directory` 合法，空则用 `.uloop/outputs/Screenshots/`（`:25`）
- 响应形状 ✅ 与简报一致：`Screenshots[]`，每项含 `ImagePath`（**永远打开这里给的文件**——目录会累积历史截图，用 `ls -t` 猜最新会拿到陈图）/`FileSizeBytes`/`Width`/`Height`/`ImageCoordinateSystem`/`ResolutionScale`/…；顶层还有 `ScreenshotCount`/`ResolvedCaptureMode`/`Warning`（`:52-68`）

起飞前裁决（R97–R105）：
- R97 — 简报硬编码 `emit(e, { json: true })` → `--json` 形同虚设（同任务 9 的 R59）。Ruling：`emit(e, { json: Boolean(args.json) })`。
- R66 适用 — 简报的 `return { ok: true, verified: true, actual: picked, hint: [] }`：**截图是读命令，没有 intent 可比对** → 一律 `ok(picked, { hint })`（`verified: null`）。R66 早就把 `shot` 写进适用范围了。
- R98 — 简报 5 条用例全是**纯函数**，`shot()` 这条命令路径**零覆盖**。Ruling：用 `_call` 注入补至少 7 条（成功 / U7 两种报文各一 / `NO_SCREENSHOT` / `fromUloop` 失败 / 参数拼装（`--out`、`--window-name`、本地化名）/ `Warning` 进 hint / `captureMode` 进 actual）。
- R99 — 简报 JSDoc 声明「优先走 PlayMode 的 rendering 模式（忽略窗口名）」但代码并未显式处理。Ruling：**不传 `--capture-mode`**（uloop 默认 `auto` 在 PlayMode 下解析为 `rendering`，此时 `--window-name` 被上游忽略——这就是绕开 U7 的机制），并把这段机制与**上游出处**写进 JSDoc（消除「声明了却没实现」的错觉）。**不要**硬传 `--capture-mode rendering`（它要求 PlayMode，EditMode 下会失败）。
- R100 — 简报 `language({ env })` 未传 `appData` → 生产可读真实 APPDATA，但**窗口名映射不可注入测试**。Ruling：`shot({..., appData})` 透传给 `language({ appData, env })`（与 doctor 一致）。
- R101 — `windowNameFor` 的静态表必须**以实测为准**：`PITFALLS.md` U7 只实证了 5 个中文标题（**游戏/场景/控制台/层级/项目**），简报表里的 `Inspector: '属性'` **无实测证据**。Ruling：表里保留的每一项都要有实测出处；`Inspector` 必须显式注释「**未实测**（U7 只实证 5 个）」，并在真机验证时尽量补测。注释里给出 `docs/PITFALLS.md` U7 的出处。
- R102 — **简报的 `isLocalizedMiss` 漏掉最常见的那个**：正则 `/Window '.*' not found/i` 对 Game 窗口**不匹配**——U7 实录 Game 的报文是 `"Neither Game nor Simulator window found; open the Game view and retry"`（另外 5 个窗口才是 `"Window 'X' not found (MatchMode: exact)"`）。Ruling：两种报文都必须识别，并各补一条断言。
- R103 — 本地化 miss 的 hint 必须给出 U7 的**三条真实出路**：① 传本地化名（并报出当前语言与已尝试的名字）② 进 PlayMode（`auto` → `rendering`，窗口名被忽略）③ 「`--match-mode contains|prefix`」（**上游真实旋钮**，见 `SKILL.md:23`）。
- R104 — 顺带修**任务 10 复审遗留的 6 条**（细节见 R96 的行）：
  ① `readBackAndVerify` 的残骸 hint 中性化（不再对 `node set` 说成 create 残骸）+ 同步测试里固化的文案；② `patch.name === ''` → `BAD_PATCH`，并把改名读回的真值判断改成 `Object.hasOwn(patch,'name')`；③ `allowed: [...PATCH_KEYS]` + hint 用 `PATCH_KEYS.join('/')`；④ `PARENT_NOT_FOUND` 带上 `.cs` 的 `detail`；⑤ `node-create.cs` 把「组件类型解析 + 添加」整段包 try/catch 并清理（畸形程序集限定名会抛且清理在其后），裸名守卫改成根锚定查找（避免同名根/嵌套共存时误拒）；⑥ `test/scene.test.js` 里 `assert.notStrictEqual(e.code,'BAD_PARENT')` 换成有牙的断言（`e.ok === true` 或断言载荷无 `parent`）。
- R105 — 上游的 `Warning` 字段（PlayMode 暂停/窗口截图时画面可能是旧帧）与 `ResolvedCaptureMode` 不得被吞：`Warning`（非空时）进 `hint`，`ResolvedCaptureMode` 进 `actual.captureMode`（additive，供排障与后续 annotation 流程）。


Task 11: 首轮审查（spec ✅ 通过带 2 重要 / code ✅ 通过带 **1 关键** + 3 重要）→ 修复循环第 1 轮

- R106 — code-reviewer **关键**：本轮为 R94/R104⑤ 重写了 `unity-scripts/node-create.cs`（新增 `FindParentByPath` + 组件段整体 try/catch），而**它没有任何可执行验证面**——唯一「测试」是 `assert.match(create, /FindParentByPath/)`，审查者用两个变异证明该 tripwire 无鉴别力（回退调用点 / 删掉函数定义，58 条仍全绿）；而本轮真机只验了 screenshot。**若 `.cs` 编译失败，整条写路径直接崩且无测试会红。**
  Ruling：**先补真机矩阵，再判本任务完成**（不是代码缺陷，是验证缺口）：① `create --name X --parent Canvas --components '["Sprite"]'`（编译 + happy path）② `create --name X --parent <嵌套节点的裸名>` → `PARENT_NOT_FOUND` 且 message/actual 带 `detail` ③ `--components '["Nope"]'` → `COMPONENT_TYPE_NOT_FOUND` ④ `--components '["Sprite, Nope"]'` → `COMPONENT_ADD_FAILED`、**不留残骸**、且**不是退出码 3** ⑤ 同名根 + 嵌套共存时裸名命中根（R104⑤ 的正题）⑥ `set --patch '{"active":false}'`（顺带验证中性 residue hint）。
  如果错了：代价是真机跑一轮（几分钟）；不做则等于把一个无法验证的核心脚本改动合进分支。
- R107 — code-reviewer 重要②：**裸写开关把「用法错」诊断成「环境/本地化错」**。实测 `unity shot --window-name`（裸写）→ `tried` 是布尔 `true` → argv `--window-name true` → 上游回 `Window 'true' not found` → **落 `WINDOW_NAME_LOCALIZED`**，`actual.windowName` 是非字符串；`unity shot --out`（裸写）→ `--output-directory true` → 上游 `Directory.CreateDirectory("true")` 在**编辑器 CWD（项目根）造出一个 `true/` 目录**并把图写进去，而我们的信封报 `ok:true`。
  Ruling：`shot()` 入口加同构守卫——`typeof windowName !== 'string' || windowName === ''` → `fail({code:'BAD_WINDOW_NAME', actual:{windowName}, hint})`；`outDir !== undefined && (typeof outDir !== 'string' || outDir === '')` → `fail({code:'BAD_OUT_DIR', actual:{outDir}, hint})`；补「裸写不退化成 uloop 调用」的用例（断言 `_call` 未被调用，同 R104② 的 `spy.length===0` 风格）。
  为什么：项目一路在治「文案误因」（R69/R86/R94），且 `--out` 裸写会**静默在项目里造目录**（真副作用）。
  如果错了：代价是 8 行 + 2 条断言。
- R108 — code-reviewer 重要③ + 实现者疑虑①：**平铺失败只修了「本地化」这一支**。上游的**所有 first-party 工具**失败都是平铺（`{Success:false, Message, NextActions, Retryable}`，`ScreenshotCaptureResults.cs:28-37` 实证），嵌套 `Error.ErrorCode` 只出现在 dispatcher 层。而 `fromUloop` 的失败分支只读 `json.Error` → 平铺失败会落成 `ULOOP_ERROR: uloop 返回失败但未提供 Message` + `hint: []` + `retryable:false`（实测），**上游明说「Retry」却被标成不可重试**，正是 R105「不吞上游字段」的反面。
  Ruling：**根治 `lib/envelope.js` 的 `fromUloop`**——失败分支改为认两种形状（`const e = json.Error || json;`），让 `Message`/`NextActions`/`Retryable`/`ErrorCode` 在平铺形态下也能取到；并补测试（平铺形状、嵌套形状、`NextActions` 非数组、`Error` 缺失）。这是**跨模块契约修正**（先例：R13 给 `exec.js` 加 `drained`、R16 收严 `ULOOP_BAD_PAYLOAD`），理由：逐命令短路（在 shot/scene 里各写一段）等于把同一条契约复制 N 份。
  为什么：这条让**所有**命令的失败可诊断（M1 有 6 个命令走 `fromUloop`）；任务 4 的延后清单里恰好写着「失败回退分支零测试（Error 缺失、NextActions 非数组、非对象输入）」，说明这条路径本来就没有断言在守。
  如果错了：代价是 envelope 一处改动 + 若干断言；若某命令依赖「平铺失败没有 message」的旧行为（无此依赖，已 grep 确认无人读该 message）需回头收紧。
- R109 — code-reviewer 重要④：`isLocalizedMiss` **过宽**——`--window-name Gam`（笔误）、裸写、以及「**已经试过本地化名**仍 not found」都会落 `WINDOW_NAME_LOCALIZED`，hint① 建议的正是**已经试过**的名字（审查者造出了这一例）。错误码断言了原因，agent 会按原因走 → 又是文案误因。
  Ruling：保留错误码（R102 指定），但 hint 必须**有证据感**：仅当 `tried === windowName`（即没做过映射替换）才出「改传本地化窗口名」这条出路；否则改成「已试过本地化名 `<tried>`：窗口可能没打开，或该窗口标题不在映射表内（可试 `--match-mode contains` 或裸 uloop 枚举标题）」；并 additive 暴露 `actual.substituted = tried !== windowName`。
  如果错了：代价是 hint 分支 + 1 个字段。
- R110 — 审查者次要（便宜的，一并做）：① hint②③ 必须写明「**需裸 uloop**（`unity shot` 未接线 `--capture-mode`/`--match-mode`）」，否则 agent 试 `unity shot --capture-mode rendering` 会**静默收下**（`parseArgs` 不报未知开关）并给出 window 截图却以为切成功了；② 语言判定放宽为 `String(lang).toLowerCase().startsWith('zh')`（`zh_TW`/`zh-Hans` 现在会回落英文名 → 必然 miss），并对非 `zh_CN` 的中文变体给不同提示；③ `.cs` 的 tripwire 换成**有鉴别力**的断言（审查者已逐个验证：`/FindParentByPath\(parentPath\)/` + 函数定义形状 + `doesNotMatch(/GameObject\.Find\(parentPath\)/)`）；④ R104① 的中性化把 create 侧有用的信息也丢了 → 把 `residue` 变成 `readBackAndVerify` 的**参数**（create 传「可能已留下新节点，用 scene tree 复核后删除多余项」，set 传中性文案）；⑤ 测试临时目录清理（`fs.rmSync(..., {recursive:true, force:true})` 放 finally）；⑥ 删掉与 `message` 重复的 `actual.upstreamMessage`。
  如果错了：代价是各处 1-3 行。
- 【登记不改】多窗口与坐标元数据（`ScreenshotCount`/`ScreenshotToInputFormula`/`GameViewWidth|Height`）被丢弃——M1 只需 path/width/height，M2 的 `simulate-mouse-*` 需要它；`--match-mode`/`--capture-mode` 接线留给 M2；设计 O6 的「运行时枚举 EditorWindow → `.pi-unity/window-map.json`」在 M1 无落点；`docs/PITFALLS.md` 应补一条「失败侧形状因工具而异（平铺 Message=工具级 / 嵌套 Error=dispatcher 级）」→ **留给任务 12 的文档回写**。


Task 11: fix round 1/5 (5 addressed, 0 open — F1 **关键**：补 6 条真机矩阵（其中抓到两处「简报预期 ≠ 真机事实」+ 一处真实缺陷：`AddComponent` 对抽象类型不抛而返回 null，旧码报成功且留残骸 → 现 `COMPONENT_ADD_FAILED` + 清理）/ F2 裸写守卫 `BAD_WINDOW_NAME`/`BAD_OUT_DIR` / F3 **根治 `fromUloop`**（失败分支认平铺与嵌套两种形状，R108 跨模块修正）/ F4 hint 按证据分支 + `substituted` / F5 六条; commits 75bed35..81fed2e)
Task 11: complete (commits a8b1f46..81fed2e, review clean) — 202/202 绿（162 + 22 + 18），1 轮修复

**任务 11 的真机发现（已在仓内留下痕迹的）：**
- **R101 的 `Inspector: '属性'` 是错的**——真机枚举 `EditorWindow` 得「**检查器**」（`属性` not found）→ 表已改 + 补单测；`docs/PITFALLS.md` 的 U7 需同步（见 R111①）
- 简报 `["Sprite"]` 真机落 `NOT_A_COMPONENT`（`Sprite` 是资源类型不是 Component）；畸形程序集名 `["Sprite, Nope"]` 在本运行时 `Type.GetType` 返回 null（**不抛**）→ 落 `COMPONENT_TYPE_NOT_FOUND`
- `AddComponent` 对**抽象类型**（如 `Collider`）不抛而返回 **null** → 旧码会报成功并留残骸（真机抓到，已修）
- 上游平铺失败形状（`{Success:false, Message, NextActions}`）已由 `fromUloop` 统一承接

- R111（折进任务 12 一并修；控制者采纳复审建议）：
  ① `docs/PITFALLS.md` U7 同步本轮真机发现（Inspector 的中文标题是「检查器」；并新增一条「失败侧形状因工具而异：平铺 `Message`=工具级 / 嵌套 `Error`=dispatcher 级」，按全局约束 12 标注适用引擎）；
  ② `unity-scripts/node-create.cs:49-53` 的注释与真机事实相反（它称畸形程序集限定名会**抛异常**，实测返回 null 走 `TYPE_NOT_FOUND`）→ 改成实测口径，并说明 catch 分支仍在守什么（`AddComponent` 抛异常，如自定义组件构造/Awake 抛）；
  ③ `test/scene.test.js:725` 的注释宣称了第三个变异，但断言抓不到（复审实测：把裸名分支改回 `GameObject.Find(path)` 三条断言全绿）→ 补一条有鉴别力的断路（如断言 `GameObject.Find(` 在文件里只出现 1 次），使注释与断言对齐；
  ④ `lib/envelope.js` 的平铺 `Message` 非字符串时原样进信封（人读会打成 `[object Object]`）→ 非字符串回退到「uloop 返回失败但未提供 Message」字符串（怪载荷留在 `actual`）；
  ⑤ `lib/shot.js` 的本地化失配分支丢掉了上游 `NextActions`（现在它是平铺失败里唯一被可靠抬起的提示）→ `hint: [...hint, ...envl.hint]`，与 R105「不吞上游字段」一致；
  ⑥【留给任务 12 的文档同步】`bin/unity.js` 的 USAGE：`--parent` 现在「裸名只匹配根对象」、`--patch` 新增 `EMPTY_PATCH`/`UNKNOWN_PATCH_KEY`、`--out` 建议绝对路径（相对路径以编辑器 CWD 为基准）；`--match-mode`/`--capture-mode` 未接线要写明（R110① 已部分做了）；
  ⑦ 任务 7 复审遗留：`docs/CAPABILITIES-*.md:230` 与 `docs/PITFALLS.md:382` 把 `compile` 的 `ErrorCount`/`WarningCount` 出处指向「§4.3」（错，应为 §0 的 S3 行与规格 `:407`）→ 删掉 `§4.3`。
- 【登记不改 / 已知取舍】`shot` 的字面量 `'true'` 作为 `--out`/`--window-name` 的值仍合法（那是用户显式给的名字，不是裸旗标；裸旗标已被 F2 守卫拦下）；`shot` 与读路径的 `_call` reject 未收敛；多窗口与坐标元数据丢弃（M2 需要）；`--match-mode`/`--capture-mode` 接线留给 M2；设计 O6 的运行时枚举窗口表（`.pi-unity/window-map.json`）在 M1 无落点；`lib/doctor.js` 仍只读嵌套 `Error.Message`（与 R108 同类，但 doctor 不走 `fromUloop`）。


### 任务 12（`SKILL.md` v1 + 文档回写）

- **R112**（承接任务简报）—— 简报步骤 5 判据 4「画面里能看到 `M1Probe`」**原理上做不到**：`node create` 建的是只有 `Transform` 的裸节点，Game 视图不渲染任何东西。
  Ruling：**改判据** —— 用 `read` 真的看图确认「真实渲染内容（非空/非黑/非异常）」，并用 `node set` 的 `verified:true` + `scene tree --json` 交叉证明 `M1Probe` 在场景里；在报告中诚实说明为什么裸节点不可见。**不许伪造图或改措辞糊弄。**
- **R113** —— `package.json` 的 `pi.extensions` 指向不存在的 `./pi-extension`，与「可 `pi install` 的标准包」这一设计前提冲突。
  Ruling：**删掉 `pi.extensions` 键**（M1 没有扩展）。实证：pi 对不存在的扩展路径**不失败**（临时包 `pi install -l` + `pi --print` 均正常），故「可能安装失败」未复现；但保留死配置无收益，删键亦不丢能力（convention 目录只在无 manifest 时自动发现，本包声明了 `skills`）。删后 `pi install <repo> -l` 复测正常。若控制者要保留扩展位，加回一个键并给最小占位即可。
- **R114** —— `--smoke` 全 pass 需要前提：dispatcher 磁盘存在（R29）**且**编辑器已打开项目。
  Ruling：本机已满足两个前提；跑完把真实输出贴进报告。若某条做不到，如实说明是哪条、为什么，不许跳过。
- **R115（实现者裁定，真机 E2E 抓到，修正 R15/R16 对 `list` 的误用）** —— `uloop list` 是 **dispatcher 级命令**，真机响应 `{"Version":"3.4.0","Tools":[...]}`，**没有 `Success` 字段**；而 `lib/doctor.js` 的探活（`collectChecks` 的 `editor-connection` 与 `smoke` 的 probe）复用了为 **first-party 工具**定的 `Success === true` 判据 → 编辑器明明连着却报 `FAIL 无法连接（退出码 0）`：**假红**，`unity doctor` 永远不绿、`--smoke` 三项全 SKIP，skill 黄金流程第一步被直接堵死。
  Ruling：**新增探活判据 `isConnectedProbe(r)`**（`code===0 && json` 前提下：`Success:true` 接受 / `Success:false` 拒绝 / 无 `Success` 时要求 dispatcher 的确定形状 `typeof Version==='string' && Array.isArray(Tools)`）。first-party 工具的 `Success === true` 判据**一字未动**（R16 对工具仍成立）。理由与先例：① R15 的本意（「dispatcher 被指到别的程序不许假绿」）被更有鉴别力的形状判据保住；② 单测 fixture `test/fixtures/fake-uloop.js` 的 `ok` 载荷本就是真实形状 `{Version,Tools}`，但**没有任何用例断言连接 pass**（连接 pass 的注入载荷全手写 `Success:true`），所以假红活到真机验收才暴露；③ 先例 R29 推翻 R28、R53 推翻 R49——真机证据推翻先前裁定的前提。
  **偏差登记**：此改动超出任务 12 的文件 allowlist（`lib/doctor.js` + `test/doctor.test.js`），理由是它**阻断任务 12 自身的验收判据 1/2**；已补 3 条 RED→GREEN 用例（真实形状 pass / smoke 探活同形状 pass / 显式 `Success:false` 与裸对象 fail）。若控制者判应回退，回滚单位是本 commit 中这两个文件的 hunk。

Task 12: 完成（四文档 + 顺带修 R111①–⑦ + R113 + R115）——`npm test` **206/206 绿**；真机 E2E 四条判据按 R112 改判口径全过（doctor exit 0 / smoke 三项 pass / create+set verified:true / shot + `read` 看图确认真实渲染）；清理：探针删除、场景未保存（md5 前后一致 `cfa039c5…`）、编辑器已退出。报告：`.superpowers/sdd/2026-09-18-pi-unity-m1-implementation/task-12-report.md`

- R115（实现者自提、控制者接受并登记）：真机 E2E 首次 `doctor` **假红**——`uloop list` 是 **dispatcher 级**命令，真机响应 `{Version, Tools}` **无 `Success` 字段**，而探活沿用了 first-party 工具的 `Success === true` 判据（R15/R16）→ `unity doctor` 永不绿，skill 黄金流程第一步被堵死。实现者新增 `isConnectedProbe(r)`（`Success===true` → pass；`Success===false` → fail；无 `Success` 时要求 `Version` 是字符串且 `Tools` 是数组），`collectChecks` 与 `smoke` 两处探活都用它，**每工具 pass 判据仍是 `Success === true`**。
  Ruling：接受。**这是判据分层，不是对 R15/R16 的放松**（两位审查者独立复核：显式 `Success:false` 仍 fail、裸对象 `{hello:1}` 仍 fail、每工具判据未动）；它修的是任务 6 就潜伏的假红（fixture 的 `ok` 载荷本来就是 `{Version,Tools}`，只是此前没有任何用例以真实形状断言 connection pass，所以单测永远测不出来）。
  如果错了：代价是探活判据比旧多接受一种具体形状；若上游 `list` 恢复 `Success`，旧路径仍在。

Task 12: 首轮审查（spec ❌ 需要修复（2 重要）/ code ❌ 需要修复（3 关键 + 8 重要））→ 修复循环第 1 轮

- R116（新裁定，来自 spec-reviewer 的边界发现）：R115 让 `editor-connection` **第一次可能 pass**，于是暴露了一个语义缺口——该判据证明的是「**dispatcher 有响应**」，不等于「**编辑器已打开该项目**」，而检查项名、成功文案（`uloop X 已连接`）与 SKILL 的表述都在暗示后者。
  Ruling：**先在真机上验证（编辑器关闭时跑 `doctor`）**：① 若 `uloop list` 在编辑器关闭时仍返回 `{Version,Tools}` → `editor-connection` 是**假绿**，必须改：成功文案改成「dispatcher 可达（编辑器连通性由 `--smoke` 证明）」，且 SKILL 必须写明「`editor-connection` 绿 ≠ 编辑器已打开，`--smoke` 三项 pass 才是连通证明」；② 若编辑器关闭时 `uloop list` 失败 → 保持现状，但 SKILL 仍应补一句两者关系。
  为什么：这是本项目一路在治的「文案断言了未被证明的事实」（R27/R31/R35/R43/R109 同一族），而且它现在正好坐落在 skill 黄金流程的第一道闸门上。
  如果错了：代价是文案更保守（方向安全）。


Task 12: fix round 1/5 (13 addressed, 0 open — F1/F2/F3 **关键**（假鉴别力论据、§8→§9、USAGE 示例用被证否的 `Sprite`）+ F4–F13（探活/工具判据分层口径、U12 的 `Retryable` 上游不存在、U15 的 float 上限、引擎标注口径、skill 的 `unity` 来源/env/`actual.path`/退出码 2&3、U13 现象口径、R116 真机验证与两项关系）; commits 308955d..e8b0e4c)
Task 12: complete (commits 81fed2e..e8b0e4c, review clean) — 206/206 绿，1 轮修复

**R116 真机结论（重要）：** 编辑器关闭时 `uloop list` 返回 `{Success:false, Error:{UNITY_NOT_REACHABLE}}`（命名管道找不到，exit 1）→ `editor-connection` **FAIL**。所以 R115 的探活判据**不会**在「编辑器没开」时假绿，`uloop X 已连接` 的文案保留是有据的。（复审另实测：把 dispatcher 指向一个只打印 `{"Success":true}` 的程序时 `doctor` 会全绿——这是 R15 本就知道的残余面，不是新洞。）

**最终审查前遗留（控制者已知、留给最终审查甄别或随最终修复波一并处理）：**
- F12 新写入的两处**自相矛盾**：`SKILL.md:56-58` 与 `docs/PITFALLS.md:542-546` 同时写「绿 ⇔ 编辑器已打开」与「它只证明 dispatcher 有响应」；应改为「（在 `PI_UNITY_ULOOP_BIN` 指向真 uloop 的前提下）绿 ⇒ 编辑器已打开；但它不证明每个工具都能跑通——工具层由 `--smoke` 三项 pass 证明」
- `docs/PITFALLS.md:6-7` 新增的笼统归因「U1–U10 不随引擎变化」与 U10（团结 vs Unity 官方差异）相反 → 改成「多为引擎版本无关（U7/U10 例外）」
- `docs/PITFALLS.md:475` 的「`DestroyImmediate` **只**存在于两个分支」不精确（`node-create.cs` 的 PARENT_NOT_FOUND 与 catch 也调用它；承重结论仍成立）
- `unity-scripts/node-create.cs:2` 的入参示例仍写 `{"components":["Sprite"]}`（应 `SpriteRenderer`）
- `.superpowers/sdd/.../progress.md:683` 里残留 F1 已判定为假的「更有鉴别力」表述（控制者本轮在此行后追加修正说明）


## 最终整分支审查（merge-base 7f16cf0 → e8b0e4c，33 commit）

**结论：可合并（带一次文档修复）。** M1 四条判据在**代码层面全部成立**；`verified` 只有 6 个写入点且读路径恒 `null`；六个命令的 exit 3 路径系统性收敛；33 个错误码无重名；零依赖/无 `split(' ')`/`parameters["param0"]` 全局一致；115 条裁定抽查未发现错误裁定。**四条阻塞项**（1 条核心假绿 + 3 条「断言强于证据」的文案），另有一批可留 M2 的延后项。

- R117 — 最终审查阻塞①（**唯一 🔴**）：`lib/readback.js` 的**顶层空 intent 假绿**——`verifyWrite({intent:{}})` → `verified:true`、零次比对；而同一文件的 JSDoc `:21-23` 恰写「只要 intent 是普通对象，`verified:true` 就只可能来自真实比对」，被自身反例推翻。M1 的 CLI 路径不可达（`EMPTY_PATCH` 挡着），但 `verifyWrite`/`compareSubset` 是**导出 API**，SKILL 还教用户直接调 `compareSubset`；M2 的 `golden`/`build` 必然复用这层。
  Ruling：**在 `verifyWrite` 里堵（不破坏 `compareSubset` 的纯比较语义）**——`verifyWrite` 检测「intent 非普通对象 **或** 顶层空对象」时，返回 `verified:false` 并产出一条 key 为 `<root>` 的分歧（message 说明「intent 为空对象：没有可比对的字段」）；`compareSubset({}, x)` **保持返回 `[]`**（纯比较语义 = 无约束即无分歧）。JSDoc 按此分工写清（`compareSubset` 的空列表 ≠ 验证通过；`verifyWrite` 才是判定入口），并补断言 `verifyWrite({intent:{}}).verified === false`。
  为什么：本文件已有先例——`tol` 非有限数直接抛（F5「一个字符关掉整道数值闸门」）；但 intent 用「返回一条分歧」而非抛，是为了不破坏已发布的 `compareSubset` 契约与既有断言。
  如果错了：代价是 `compareSubset` 与 `verifyWrite` 对空 intent 的结论不同（已文档化）；若某调用方依赖旧行为（无），会得到一次 falsely-fail。
- R118 — 最终审查阻塞②③④（三条「断言强于证据」，全坐在 skill 黄金流程的第一道闸门上）：
  ② `SKILL.md:56-58` 与 `docs/PITFALLS.md:542-546` 同时写「绿 ⇔ 编辑器已打开」与「只证明 dispatcher 有响应」（自相矛盾）→ 改为「（在 `PI_UNITY_ULOOP_BIN` 指向真 uloop 的前提下）绿 ⇒ 编辑器进程活着且打开了该项目；但它**不证明每个工具都能跑通**——工具层由 `--smoke` 三项 pass 证明」，小标题改陈述式。
  ③ `docs/PITFALLS.md:6-7`（与 `README` 同句）的「U1–U10 不随引擎变化」与 U10（团结 vs Unity 官方差异）相反 → 改成「多为引擎版本无关（**U7/U9/U10 例外**）」。
  ④ `SKILL.md:38` 的「`pi install` 或全局安装后**可直接调** `unity`」没有证据（pi 文档没有 `bin` 进 PATH 的承诺）→ 改成有据措辞（全局 `npm i -g` 后 `unity` 在 PATH；`pi install` 只装 skill，命令用 `node <包目录>/bin/unity.js`；两者等价，下文示例统一写 `unity`）。
  如果错了：代价是文案更保守（方向安全）。
- R119 — 最终审查建议顺手做的两处（各 ≤1 行）：`docs/PITFALLS.md:475` 的「`DestroyImmediate` **只**存在于两个分支」不精确（`.cs` 里共 6 处调用点，含 PARENT_NOT_FOUND 与 catch；承重结论仍成立）；`unity-scripts/node-create.cs:2` 的入参示例仍写 `{"components":["Sprite"]}`（真机 `Sprite` 落 `NOT_A_COMPONENT`）→ 改 `SpriteRenderer`。
- 【账本腐化，控制者自记】R43 原文说 per-tool 失败用 `describeFailure`，代码实际是后来加的 `standaloneFailure`；R101 原文说「`Inspector` 未实测」，而真机已实测为「检查器」。两处**原文保留**（账本是历史记录），以本行说明为准。

**M1 的已知残留风险（最终审查点名，交 M2）：M1 没有证明「搭出来的东西能在图里被看见」**——R112 把判据 4 改判为「真实渲染 + 交叉证据」是诚实修正，但裸节点（只有 `Transform`）在 Game 视图里本就不渲染，所以「截图能力可用」成立、「截图能验证意图」尚未成立。建议作为 M2 第一条验收（挂 `SpriteRenderer` + 资源后跑一次视觉闭环）。


## 最终修复波（唯一一波）复审结论

F1–F6 全部 ADDRESSED（F1 六态实测：`{}`/`undefined`/`null`/`[1]`/`0` → `verified:false` + 1 条 `<root>`；`{a:1}` 正常；`{a:{}}` 嵌套空对象未被误伤；`compareSubset({},x)` 仍 `[]`；既有断言零调整（diff 为 19 行纯新增））；无新破坏；三条连带自主判断均裁定合理。

- R120 — 两条**搁置到 M2**（复审的 🟡，带裁定）：
  ① `lib/readback.js` 新 JSDoc 的绝对措辞「零次比对不算验证通过 / `verified:true` 只可能来自真实比对」与同文件明确保留的例外（**两侧都是空对象 → 判一致**，即 `verifyWrite({intent:{a:{}}})` 的叶级比对次数为 0 但仍 `verified:true`）不完全相容 → 收窄为「**顶层**空 intent / 非普通对象 intent 的零约束不算通过」；
  ② `lib/scene.js` 三处用户可见 hint 仍以 `Sprite` 作组件名范例（与 U13/`bin/unity.js` 的 `SpriteRenderer` 相反）→ 顺手改。
  Ruling：搁置，不进第二波（技能明确禁止第二波修复；两者都不影响行为与可合并性）。
  如果错了：代价是 M2 里两处措辞不一致（无行为影响）。

## M1 完成

**分支 `m1-impl`：33 + 4 = 37 个 commit（7f16cf0..8c27e58），全仓 207/207 绿，工作区干净。**
- 交付物：`bin/unity.js`（6 命令：`version`/`doctor`/`scene tree`/`node inspect`/`node create`/`node set`/`shot`）+ `lib/{args,exec,uloop,envelope,editor-discovery,readback,doctor,scene,shot}.js` + `unity-scripts/{node-inspect,node-create,node-set}.cs` + `skills/unity-game-dev/SKILL.md` + 三份文档回写
- 真机 E2E（团结 2022.3.62t9 + uloop dispatcher 3.5.1）：`doctor` exit 0 / `--smoke` 三项 pass / `create`+`set` `verified:true` / `shot` 出图并**用 `read` 看过**
- **M1 未证明的**（交 M2）：视觉闭环（「搭出来的东西能在图里被看见」需要挂可渲染组件 + 资源；R112 的改判是诚实修正）
- 账本：`.superpowers/sdd/2026-09-18-pi-unity-m1-implementation/progress.md`（120 条裁决 + 80 条延后项 + 每轮审查与复审记录）
- **工作区保留**（技能默认在最终审查干净后 `rm -rf` 本计划工作区）：控制者裁定保留——它是 gitignored 的本地资料，120 条裁决与 80 条延后项只在这里；用户要清就 `rm -rf .superpowers/sdd/`。
