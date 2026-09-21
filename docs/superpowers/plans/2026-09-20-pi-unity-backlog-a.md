# pi-unity backlog 批次 A 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。
>
> **本计划已过起飞前冲突扫描**（2026-09-20，13 条问题已逐条裁定并落入正文；裁定记录见 §7）。

**目标：** 关闭 `docs/HANDOFF.md` §7 backlog 的 ①②⑦⑪ 四项（并发误导码 / payload 编译错报文不可读 / `pixels --diff`·质心·bbox / `--flag=1` 与 `MISSING_PROJECT_PATH` 口径统一）。

**架构：** 不新增第三方依赖、不 fork uloop。①②走**信封层**（`lib/envelope.js` 是全项目唯一退出码判定处，也是唯一能一处覆盖全部 payload 命令的插入层）；⑪在 `lib/args.js` + `bin/unity.js` 入口归一；⑦在既有 `lib/pixels.js` 两段式结构内扩展，复用 `lib/png.js` 的 `decodePng` 与 `lib/color.js` 的 `maxChannelDistance`。

**技术栈：** Node.js ≥ 21（CommonJS，`node --test`，零依赖）。

**规格：** 本批次无独立设计文档 —— 依据是 `docs/HANDOFF.md` §7 backlog 表 + `docs/M4-DECISIONS.md` 的 R435（`:240`）/ R475（`:290`）裁决 + **本次真机探针结论（见 §2）**。

---

## 全局约束

（逐字来自 `docs/HANDOFF.md` §6 与 `package.json`，每个任务隐含包含本节）

- 零第三方依赖（只用 `node:*` 与 `node --test`）；不 fork uloop。
- **`verified` 语义不许扩张**：只有「写后读回比对 intent vs actual」才置 `true/false`；无 intent 的读/执行命令恒 `null`。
- **退出码单点**：`lib/envelope.js` 的 `exitCodeFor` 是唯一判定处（`2` 用法错 / `1` 运行时或验证失败 / `0` 成功且 `verified!==false`）；**用法错只由 argv 决定**、在任何写盘/调用之前收敛。
- `USAGE_FAILURE_CODES` 是**冻结数组**（判成员用 `isUsageFailure`）；新增用法错码要同时改它 + `test/envelope.test.js` 的**排序后全等**断言。
- **防假绿三道线**：① `ULOOP_TRUNCATED` 绝不产 `ok:true`；② 磁盘硬证据；③ **读回投影必须与 intent 同形**。
- ⭐ **凡改动/新增 `.cs` 分支，必须真机跑一次**（R367）。本批次**不改任何 `.cs`**（修复全在 JS 侧）；任务 7 仅**临时**改一处 `.cs` 造编译错，改完必须 `git checkout --` 还原并读回确认。
- ⭐ **一次只发一条 `unity` 命令（含只读）**；**不许碰用户真实工程 `<真实工程>`**。
- 新增 `docs/PITFALLS.md` 条目：**索引表同稿补齐**；正文插在 `### U47`（`:1685`）之后、`### M4：…`（`:1704`）之前，层级用 `###`；**必须标适用引擎**。
- ⭐ **控制者不要手改实现/测试代码**（R372）：交给实现者 + 双审。**提交（`git add/commit`）与文档回写属控制者职责**。
- ⭐ **不要把 `npm test` 串在 `&&` 链中间、后面还跟一个总是成功的 `grep`**（失败会被吞掉）。
- **`.cs` 静态契约要有牙**：断言**剥注释后**的源码（`stripComments` + 剥 `/* */`）。
- **测试数据（mock）要与现实同形**：不许让生产代码去迁就 mock。**测试载荷必须逐字对齐真机原始 JSON**（§2 的 P2 形状）。
- 测试里不要用 `.` + `$` 匹配行尾（CRLF 陷阱）；`.gitattributes` 已把行尾定为 LF。
- 测试命令：`npm test`（= `node --test "test/*.test.js"`，Node ≥ 21）。**基线 = 565/565 绿**（实测）。
- 每个任务结束必须 `npm test` 全绿。

---

## 1. 决策点（需人类伙伴批准）

| # | 决策 | 备选 | 推荐 |
|---|---|---|---|
| **D-A1** | 项①「并发」怎么治 | (a) 只修「误判 + 加 hint + 扩展 message 兜底」；(b) 再加专用码 | **(a)** —— 裁定原文只要求「hint 指向串行重试」；`test/dynamic.test.js:165` 钉死码值；`UNITY_SERVER_BUSY` 是上游码，改码会丢上游信息 |
| **D-A2** | 项⑪ `--flag=1` 口径 | (a) **一律报用法错**；(b) **归一化**：`1/true/yes`→`true`、`0/false/no`→`false`，其它报 `BAD_FLAG_VALUE` | **(b)** —— 同时消灭两种静默失败：「`--force=1` 不生效」与「`--json=0` 关不掉」 |
| **D-A3** | 项② 插入层 | (a) `envelopeFromCall` 中央识别（一处覆盖全部 payload 点）；(b) 改 12 个调用点 | **(a)**；循环依赖用「`compressIssues` 下沉到零依赖 `lib/issues.js`」化解 |
| **D-A4** | `fromUloop` 的 message 兜底 | (a) 扩为 `Message ?? ErrorMessage`；(b) 只在门控处读 `ErrorMessage` | **(a)** —— 上游动态代码载荷**根本没有 `Message` 字段**（P2 实测），只认 `Message` 正是 R435「报文不可读」的根因之一 |

**若人类伙伴不批准 D-A2 的 (b)，则任务 6 降级为 (a)**：所有 `--flag=<非空串>`（含 `--json=0`）报 `BAD_FLAG_VALUE`。

---

## 2. 探针结论（项①的事实基础，2026-09-20 真机）

引擎：Unity 官方版 `2022.3.62f3c1`（项目 `pi-unity-official-f3c1`，编辑器已在跑）；uloop dispatcher **3.5.1**；`PI_UNITY_ULOOP_BIN=C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe`。

| # | 探针 | 结果 |
|---|---|---|
| P1 | 4 条并行 `unity exec`（各 `Sleep(4s)`） | **复现**：3/4 失败，`code=SCRIPT_COMPILE_ERROR`，`message='动态代码编译失败：Another execution is already in progress'` |
| P2 | 上游原始 JSON（**成功**载荷，6 进程并行实测 6/6 同形） | `{"Result":"a","Logs":[…],"CompilationErrors":[],"ErrorMessage":"","Error":"","UpdatedCode":null,"DiagnosticsSummary":null,"Diagnostics":[],"EditorPlaying":false,"Success":true}` → **`CompilationErrors` 恒存在（空数组）；且载荷里没有 `Message` 字段，只有 `ErrorMessage`** |
| P3 | 6 / 10 条并行 `unity scene tree` | 6 条全 ok；10 条中 **2 条 `UNITY_SERVER_BUSY`**（`retryable:true`、`phase:'dispatch'`） |
| P4 | **确定性**触发（长 `exec` 占住单飞槽 + 2s 后发只读） | **稳定复现 `UNITY_SERVER_BUSY`**（`victim2.json`） |
| P5 | 3 轮 × 4 并行 `unity exec` 重跑；6 进程并行重跑 | 未复现（**概率性**；P1 是真实样本） |
| P6 | 并行只读 → `ULOOP_TRUNCATED` | **未复现**（6/10 并行均未出现） |

**三条硬事实：**

1. **根因是「uloop 单飞」**：`UNITY_SERVER_BUSY` 的信封自带 `message`「…**uloop is single-flight by design; never run uloop commands in parallel**. The CLI already retried for up to 10 seconds…」、`phase:'dispatch'`、`retryable:true`（`victim2.json` 逐字）。外部依据（本机 vendor，**不在仓库内**）：`C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp/Editor/Application/UnityCliLoopToolBusyException.cs`、`…/Infrastructure/Api/JsonRpcErrorTypes.cs:11`（`ServerBusy = "server_busy"`）、`…/ToolContracts/UnityCliLoopConstants.cs:130`。
2. **`SCRIPT_COMPILE_ERROR` 那条是误判**：R352 判据 `j.Success === false && Array.isArray(j.CompilationErrors)` 被**恒存在的空数组**满足 → 并发被拒被报成「编译失败」（码 + 文案双误导）。
3. **U46 的「并行只读 → `ULOOP_TRUNCATED`」不成立**（P6）→ 需订正，且**不要**给截断路径加并发 hint（无证据，且 `lib/uloop.js` 契约禁止重解析 stdout/stderr）。

**证据落盘**：`C:/Users/<用户>/piu-probe/`（`p4-1..4.json`、`t10-1..10.json`、`victim2.json`、`one-a..f.txt`、`raw-log.jsonl`、`recorder.js`、`probe-one.js`），任务 1 抄入仓库。

---

## 3. 文件结构

| 文件 | 职责 | 本批次动作 |
|---|---|---|
| `lib/issues.js` | **新建**：零依赖纯函数（压缩编译错条目 / 编译失败判据 / 并发文本门控 / 文案常量） | 创建 |
| `lib/envelope.js` | 信封 / 退出码单点 / `RETRYABLE_CODES` / `USAGE_FAILURE_CODES` / `fromUloop` / `envelopeFromCall` | 修改：message 兜底、并发 hint、可重试登记、`scriptCompileFailure`、`MISSING_PROJECT_PATH` 归 2 |
| `lib/dynamic.js` | `unity exec` | 修改：改用共享判据；任务 3 删本地实现 |
| `lib/asset.js` | `compile` / `asset write` | 修改：`compressIssues` 改 re-export |
| `lib/scene.js` | 场景/节点命令 | 修改：`withWriteRecheckHint` 遇 `phase==='compile'` 跳过 |
| `lib/args.js` | `parseArgs` | 修改：新增 `normalizeBooleans` + `BOOLEAN_KEYS`（**9 个键**） |
| `lib/doctor.js` | `doctor` | 修改：自己接 `normalizeBooleans`（**不得** require `bin/`） |
| `bin/unity.js` | CLI 入口 / USAGE / handler | 修改：`parseArgsStrict`、USAGE 文案、pixels 新选项 |
| `lib/pixels.js` | `unity pixels` | 修改：`--diff` / `--centroid` / `--bbox` |
| `docs/M5-PROBES.md` | **新建**：本批次探针报告 | 创建 |
| `docs/PITFALLS.md` | 坑位库 | 修改：追加 U48/U49（正文 + 索引表）+ 订正 U46 + D12 过期标注 |
| `README.md` / `skills/unity-game-dev/SKILL.md` / `docs/HANDOFF.md` | 交付文档 | 修改：命令面、并发话术、backlog 状态 |

---

## 4. 任务

### 任务 1：探针报告落盘 + U46 订正

**文件：**
- 创建：`docs/M5-PROBES.md`、`docs/m5-probes-raw/*`
- 修改：`docs/PITFALLS.md`（正文 U48/U49 + 索引表 2 行 + U46 订正注记）

- [ ] **步骤 1：抄录探针原始证据到仓库**

```bash
mkdir -p docs/m5-probes-raw
cp C:/Users/<用户>/piu-probe/p4-*.json docs/m5-probes-raw/
cp C:/Users/<用户>/piu-probe/t10-*.json docs/m5-probes-raw/
cp C:/Users/<用户>/piu-probe/one-*.txt docs/m5-probes-raw/
cp C:/Users/<用户>/piu-probe/victim2.json docs/m5-probes-raw/
cp C:/Users/<用户>/piu-probe/probe-one.js C:/Users/<用户>/piu-probe/recorder.js docs/m5-probes-raw/
ls docs/m5-probes-raw | wc -l
```

- [ ] **步骤 2：写 `docs/M5-PROBES.md`**

必须包含：探针环境（引擎 / dispatcher 3.5.1 / `PI_UNITY_ULOOP_BIN`）；P1–P6 每条的**命令原文**、**原始输出**、**结论**；P4 的确定性复现脚本（可直接粘跑）；「U46 订正」小节；以及「外部依据不在仓库内」的路径声明。

- [ ] **步骤 3：`docs/PITFALLS.md` 追加 U48 / U49**

**插入位置**：`### U47` 之后、`### M4：…` 之前；层级 `###`。

```markdown
### U48. 并发调用报 `SCRIPT_COMPILE_ERROR: 动态代码编译失败：Another execution is already in progress` —— 码与文案双误导

**适用引擎**：Unity 官方中国版 2022.3.62f3c1 + uloop dispatcher 3.5.1 [Unity 官方 2022.3.62f3c1 实测，2026-09-20]

**现象**：4 条并行 `unity exec` → 3/4 回 `code=SCRIPT_COMPILE_ERROR`、`message='动态代码编译失败：Another execution is already in progress'`。

**根因**：上游动态代码载荷里 `CompilationErrors` **恒存在**（成功时是 `[]`），并发被拒时是 `{Success:false, CompilationErrors:[], ErrorMessage:'Another execution is already in progress'}`。旧判据只要求 `Array.isArray(CompilationErrors)` → 空数组也满足 → 被当成编译错。

**处理**：判据收紧为「**非空**数组」（`lib/issues.js` 的 `isScriptCompileFailure`）；`fromUloop` 的 message 兜底扩为 `Message ?? ErrorMessage`；并给「另一条命令正在执行」加串行重试 hint。
```

```markdown
### U49. 并发调用报 `UNITY_SERVER_BUSY` —— 这是 uloop 的**单飞**设计，不是故障

**适用引擎**：Unity 官方中国版 2022.3.62f3c1 + uloop dispatcher 3.5.1 [Unity 官方 2022.3.62f3c1 实测，2026-09-20]

**现象**：10 条并行 `unity scene tree` → 2 条 `code=UNITY_SERVER_BUSY`、`retryable:true`、`phase:'dispatch'`。

**确定性复现**：先起一条长耗时 `unity exec`（`--code 'System.Threading.Thread.Sleep(25000); return "holder";'`），2 秒后再发 `unity scene tree` → 稳定 `UNITY_SERVER_BUSY`。

**上游依据**（原始信封见 `docs/m5-probes-raw/victim2.json`）：信封 message 逐字含「uloop is single-flight by design; never run uloop commands in parallel」，且 dispatcher 自带 **10 秒**重试。

**处理**：把 `UNITY_SERVER_BUSY` 登记进 `RETRYABLE_CODES`（上游不给 `Retryable` 时也能判可重试），并追加中文串行重试 hint。**一次只发一条命令**（含只读）。
```

- [ ] **步骤 4：索引表补两行**（`docs/PITFALLS.md` 的 U1–U47 表，`:23-80`）

```markdown
| U48 | 并发调用报 `SCRIPT_COMPILE_ERROR` + 「动态代码编译失败」—— 空 `CompilationErrors` 导致的误判 | 中 | 判据须要求非空数组；见 `docs/M5-PROBES.md` |
| U49 | 并发调用报 `UNITY_SERVER_BUSY` —— uloop 单飞设计，不是故障 | 中 | 串行重试；已登记进 `RETRYABLE_CODES` |
```

- [ ] **步骤 5：U46 末尾追加订正注记**

```markdown
> **订正（2026-09-20 真机，见 `docs/M5-PROBES.md`）**：本条目原文称「并行**只读** → `ULOOP_TRUNCATED`」——**未复现**（6 条与 10 条并行 `scene tree` 均未出现 `ULOOP_TRUNCATED`）。真实码是 **`UNITY_SERVER_BUSY`**（见 U49）。`ULOOP_TRUNCATED` 只在 dispatcher 真的起不来（如 `PI_UNITY_ULOOP_CMD` 路径写错）时出现，**不要**据此给截断路径加并发 hint。
```

- [ ] **步骤 6：跑测试确认零回归**

运行：`npm test`
预期：PASS，**565/565**（纯文档任务，用例数不变）

- [ ] **步骤 7：Commit**

```bash
git add docs/M5-PROBES.md docs/m5-probes-raw docs/PITFALLS.md
git commit -m "docs(m5): 探针报告落盘 + U46 订正（真实码是 UNITY_SERVER_BUSY）+ U48/U49"
```

---

### 任务 2：并发被拒不再被误判 + 串行重试 hint（项①）

**文件：**
- 创建：`lib/issues.js`
- 修改：`lib/envelope.js`（`fromUloop` 的 message 兜底 + `RETRYABLE_CODES` + 并发 hint）
- 修改：`lib/dynamic.js`（改用共享判据）
- 修改：`lib/asset.js`（`compressIssues` 改 re-export）
- 测试：`test/issues.test.js`（新建）、`test/envelope.test.js`、`test/dynamic.test.js`

> **本任务不引入 `scriptCompileFailure`**（那是任务 3）。本任务结束后①已完全关闭。

- [ ] **步骤 1：写失败测试 `test/issues.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isScriptCompileFailure, isExecutionInProgress, compressIssues } = require('../lib/issues.js');

test('R475：CompilationErrors 为空数组 + 并发文案 → 不是编译失败（旧判据会误判）', () => {
  // 载荷逐字对齐真机（docs/m5-probes-raw/p4-1.json 的 ErrorMessage 分支）
  const json = { Success: false, CompilationErrors: [], ErrorMessage: 'Another execution is already in progress' };
  assert.strictEqual(isScriptCompileFailure(json), false, '空数组不得算编译失败（成功载荷里它恒存在）');
});

test('R352：CompilationErrors 非空 → 是编译失败', () => {
  const json = { Success: false, CompilationErrors: [{ Message: 'CS1061', File: 'Assets/A.cs', Line: 12 }] };
  assert.strictEqual(isScriptCompileFailure(json), true);
});

test('R352 反证：Success 为真 / 缺 CompilationErrors / 非数组 → 都不是编译失败', () => {
  assert.strictEqual(isScriptCompileFailure({ Success: true, CompilationErrors: [{ Message: 'x' }] }), false);
  assert.strictEqual(isScriptCompileFailure({ Success: false, ErrorMessage: 'boom' }), false);
  assert.strictEqual(isScriptCompileFailure({ Success: false, CompilationErrors: 'nope' }), false);
  assert.strictEqual(isScriptCompileFailure(null), false);
});

test('并发文案门控：命中哨兵 / 不命中', () => {
  assert.strictEqual(isExecutionInProgress('Another execution is already in progress'), true);
  assert.strictEqual(isExecutionInProgress("uloop: Another execution is already in progress. Please wait"), true);
  assert.strictEqual(isExecutionInProgress('动态代码编译失败：Another execution is already in progress'), true);
  assert.strictEqual(isExecutionInProgress('compile failed'), false);
  assert.strictEqual(isExecutionInProgress(undefined), false);
});

test('compressIssues 与 asset.js 原实现同形（下沉后不得改形状）', () => {
  assert.deepStrictEqual(
    compressIssues([{ Message: 'm', File: 'f', Line: 3 }, { Message: 7 }, {}]),
    [{ message: 'm', file: 'f', line: 3 }, { message: '', file: null, line: null }, { message: '', file: null, line: null }],
  );
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/issues.test.js`
预期：FAIL —— `Cannot find module '../lib/issues.js'`

- [ ] **步骤 3：创建 `lib/issues.js`（零依赖，不含 `scriptCompileFailure`）**

```js
'use strict';

/**
 * 把 `CompilationErrors` / `compile` 的条目压成 `{message, file, line}`（上游 CompileIssue 字段面）。
 *
 * R435：本函数原在 `lib/asset.js`。下沉到此（**零依赖**）是因为 `lib/envelope.js` 需要它，
 * 而 `lib/asset.js` 已经 `require('./envelope.js')` —— 留在原处会形成 `envelope ⇄ asset` 环。
 */
function compressIssues(list) {
  return (Array.isArray(list) ? list : []).map((i) => ({
    message: typeof i.Message === 'string' ? i.Message : '',
    file: typeof i.File === 'string' ? i.File : null,
    line: typeof i.Line === 'number' ? i.Line : null,
  }));
}

/**
 * 判据：uloop 信封是不是「**脚本编译失败**」。
 *
 * ⚠️ R475（真机 2026-09-20，见 `docs/M5-PROBES.md` P2）：`CompilationErrors` 在**成功**载荷里
 * 恒存在（实测 `{"Success":true,…,"CompilationErrors":[]}`），并发被拒时也回
 * `{Success:false, CompilationErrors:[], ErrorMessage:'Another execution is already in progress'}`。
 * 旧判据只要求 `Array.isArray` → 空数组也满足 → 把「并发被拒」误报成「编译失败」。故**必须要求非空**。
 *
 * @param {unknown} json uloop 原始 JSON
 * @returns {boolean}
 */
function isScriptCompileFailure(json) {
  return Boolean(json) && typeof json === 'object'
    && json.Success === false
    && Array.isArray(json.CompilationErrors)
    && json.CompilationErrors.length > 0;
}

/** 上游「另一条命令正在执行」的哨兵文案（`UnityCliLoopConstants.ERROR_MESSAGE_EXECUTION_IN_PROGRESS`）。 */
const EXECUTION_IN_PROGRESS_TEXT = 'Another execution is already in progress';

/** 文本门控：该失败是否其实是「另一条命令正在执行」（uloop 单飞）。 */
function isExecutionInProgress(message) {
  return typeof message === 'string' && message.includes(EXECUTION_IN_PROGRESS_TEXT);
}

/**
 * 并发被拒时统一追加的 hint。
 * 措辞**不得**含「写入 / 未生效 / 已经生效」——`test/dynamic.test.js:149` 钉死「不写场景的命令不得套用写入类 hint」。
 */
const CONCURRENT_HINT =
  '另一条 `unity` 命令正在执行 —— uloop 是**单飞**（single-flight）的，并行调用必被拒：请**串行重试**本命令（不要重开编辑器、不要重跑并发的那条）';

module.exports = { compressIssues, isScriptCompileFailure, isExecutionInProgress, EXECUTION_IN_PROGRESS_TEXT, CONCURRENT_HINT };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/issues.test.js`
预期：PASS（5/5）

- [ ] **步骤 5：写失败测试（`test/envelope.test.js` 追加）**

先在 `test/envelope.test.js:4` 的 require 列表**追加 `isUsageFailure`**（当前没有，任务 5 也要用）：

```js
const { ok, fail, fromUloop, emit, RETRYABLE_CODES, envelopeFromCall, USAGE_FAILURE_CODES, exitCodeFor, isUsageFailure } = require('../lib/envelope.js');
```

```js
test('R475：并发被拒（空 CompilationErrors + ErrorMessage 哨兵）→ ULOOP_ERROR + 串行重试 hint + retryable', () => {
  // 载荷逐字对齐真机：**没有** Message、**没有** ErrorCode（见 docs/m5-probes-raw/p4-1.json）
  const e = fromUloop({ Success: false, CompilationErrors: [], ErrorMessage: 'Another execution is already in progress' });
  assert.strictEqual(e.code, 'ULOOP_ERROR', '上游没给 ErrorCode → 落 ULOOP_ERROR');
  assert.strictEqual(e.message, 'Another execution is already in progress', 'message 兜底必须读 ErrorMessage（上游没有 Message 字段）');
  assert.strictEqual(e.retryable, true, '并发被拒是瞬时的，必须可重试');
  assert.ok(e.hint.some((h) => h.includes('单飞')), '必须给出中文串行重试 hint');
  assert.ok(!e.hint.some((h) => /写入|未生效|已经生效/.test(h)), '不写场景的命令不得套用写入类 hint');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('U49：UNITY_SERVER_BUSY 即使上游不给 Retryable 也可重试，且带串行重试 hint', () => {
  const e = fromUloop({ Success: false, Error: { ErrorCode: 'UNITY_SERVER_BUSY', Message: "Unity is busy running 'compile'." } });
  assert.strictEqual(e.code, 'UNITY_SERVER_BUSY');
  assert.strictEqual(e.retryable, true, '单飞被拒是瞬时的，必须可重试');
  assert.ok(e.hint.some((h) => h.includes('单飞')));
  assert.strictEqual(exitCodeFor(e), 1);
});

test('R111④ 回归：message 兜底扩到 ErrorMessage 后，缺 Message 且缺 ErrorMessage 仍给兜底文案', () => {
  assert.match(fromUloop({ Success: false, NextActions: ['a'] }).message, /未提供 Message/);
  assert.strictEqual(fromUloop({ Success: false, Message: '' }).message, 'uloop 返回失败但未提供 Message');
  assert.deepStrictEqual(fromUloop({ Success: false, Message: { code: 42 } }).actual, { code: 42 });
});

test('U49 附带：RETRYABLE_CODES 扩大后，脚本 __error 与瞬时码撞名仍加 SCRIPT_ 前缀', () => {
  const { scriptErrorCode } = require('../lib/scene.js');
  assert.strictEqual(scriptErrorCode('UNITY_SERVER_BUSY'), 'SCRIPT_UNITY_SERVER_BUSY');
  assert.strictEqual(scriptErrorCode('MY_BUSINESS_ERROR'), 'MY_BUSINESS_ERROR');
});
```

- [ ] **步骤 6：运行测试验证失败**

运行：`node --test test/envelope.test.js`
预期：FAIL（新增 4 条不通过；既有用例仍通过）

- [ ] **步骤 7：改 `lib/envelope.js`**

顶部加：

```js
const { isExecutionInProgress, CONCURRENT_HINT } = require('./issues.js');
```

`RETRYABLE_CODES`（`:47-50`）加一项：

```js
const RETRYABLE_CODES = new Set([
  'ULOOP_NO_JSON',
  'ULOOP_TRUNCATED',
  'UNITY_SERVER_BUSY',
]);
```

`fromUloop` 的失败路径（`:190-200`）改为：

```js
  const e = json.Error && typeof json.Error === 'object' ? { ...json, ...json.Error } : json;
  // R111④ + R435/D-A4：`Message` 必须是非空**字符串**才进信封（真值非字符串会让 emit 打成
  // `[object Object]`）。**兜底必须再读 `ErrorMessage`** —— 上游动态代码载荷（成功与失败都是）
  // **根本没有 `Message` 字段**，只有 `ErrorMessage`（真机实测，docs/M5-PROBES.md P2）；
  // 只认 `Message` 正是「payload 类命令编译错报文不可读」（R435）的根因之一。
  // 回退不是「吞掉」：怪载荷留在 `actual` 里供排障（与 R105「不吞上游字段」一致）。
  const hasMessage = typeof e.Message === 'string' && e.Message !== '';
  const hasErrorMessage = typeof e.ErrorMessage === 'string' && e.ErrorMessage !== '';
  const envelope = fail({
    code: e.ErrorCode || 'ULOOP_ERROR',
    message: hasMessage ? e.Message : (hasErrorMessage ? e.ErrorMessage : 'uloop 返回失败但未提供 Message'),
    actual: e.Details || (hasMessage ? null : (e.Message ?? e.ErrorMessage ?? null)),
    hint: Array.isArray(e.NextActions) ? e.NextActions : [],
    phase: e.Phase,
    retryable: Boolean(e.Retryable),
  });
  // R475/U49：uloop 是**单飞**的 —— 并发被拒有两种外观：
  //   · 动态代码载荷被 Unity 执行槽拒绝 → Success:false + ErrorMessage 含哨兵文案（上游无 ErrorCode）；
  //   · dispatcher 侧直接拒绝 → ErrorCode='UNITY_SERVER_BUSY'。
  // 两者都必须指向「串行重试」，否则 agent 会去查编译错 / 重开编辑器（都是错方向）。
  if (envelope.code === 'UNITY_SERVER_BUSY' || isExecutionInProgress(envelope.message)) {
    return { ...envelope, retryable: true, hint: [...envelope.hint, CONCURRENT_HINT] };
  }
  return envelope;
```

- [ ] **步骤 8：改 `lib/dynamic.js`**

顶部加 `const { isScriptCompileFailure } = require('./issues.js');`，把 `:124` 的判据换成共享判据：

```js
  if (!r.truncated && isScriptCompileFailure(j)) {
```

并把 `:118-123` 的注释块更新为：

```js
  // R352 + R475：编译失败的形状是 `{Success:false, CompilationErrors:[{Message,File,Line}], ErrorMessage}`
  // （CAPABILITIES §4.2），**没有** `ErrorCode`/`Message` —— 直接走 `envelopeFromCall` 会落成 message
  // 为空的 `ULOOP_ERROR`。判据由 `lib/issues.js` 统一提供（**必须非空数组**：R475 真机证明
  // `CompilationErrors:[]` 在成功载荷与并发被拒里都恒存在）。
```

（本任务保留 exec 专属文案「动态代码编译失败：…」；任务 3 会把它交给中央实现。）

- [ ] **步骤 9：改 `lib/asset.js`**

删除 `:43-49` 的 `compressIssues` 函数体（连同 `:42` 的 JSDoc），改为顶部：

```js
const { compressIssues } = require('./issues.js');
```

`module.exports` 里的 `compressIssues` 保持不变 → `lib/build.js:8`、`lib/dynamic.js:7` 与 `test/asset.test.js` 的既有引用零改动。

- [ ] **步骤 10：运行全量测试**

运行：`npm test`
预期：PASS，**565 + 5 + 4 = 574/574**

- [ ] **步骤 11：Commit**

```bash
git add lib/issues.js lib/envelope.js lib/dynamic.js lib/asset.js test/issues.test.js test/envelope.test.js
git commit -m "fix(envelope): R475/U49 并发被拒不再误判为编译错 + message 兜底扩到 ErrorMessage + 串行重试 hint"
```

---

### 任务 3：payload 类命令的 `.cs` 编译错报文可读（项② / R435）

**文件：**
- 修改：`lib/envelope.js`（新增 `scriptCompileFailure` + `scriptNameFromArgs` + 接入 `envelopeFromCall` + 导出）
- 修改：`lib/dynamic.js`（删本地实现）
- 修改：`lib/scene.js`（`withWriteRecheckHint` 遇 `phase==='compile'` 跳过）
- 测试：`test/envelope.test.js`、`test/scenefile.test.js`

> **依赖方向裁定（扫描 #4）**：`scriptCompileFailure` 需要 `fail()`，而 `fail()` 在 `lib/envelope.js`；
> 若放进 `lib/issues.js` 会成环。故**放 `lib/envelope.js`**，`lib/issues.js` 保持零依赖纯函数。
> 本任务**必须**同时把 `scriptCompileFailure` 加进 `lib/envelope.js` 的 `module.exports`（`:256-259` 现有列表没有它）。

- [ ] **步骤 1：写失败测试（`test/envelope.test.js` 追加）**

```js
test('R435：scriptCompileFailure 形状（message 带 文件:行 与首条；hint 带首条与脚本名；actual 带 errors/script；phase=compile）', () => {
  const e = scriptCompileFailure({
    Success: false,
    CompilationErrors: [{ Message: 'CS1061: does not contain a definition', File: 'Assets/PiPrefab.cs', Line: 12 }],
    ErrorMessage: 'Compilation error occurred',
  }, 'prefab-create.cs');
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'SCRIPT_COMPILE_ERROR');
  assert.strictEqual(e.phase, 'compile');
  assert.strictEqual(e.actual.errors[0].line, 12);
  assert.strictEqual(e.actual.errors[0].file, 'Assets/PiPrefab.cs');
  assert.strictEqual(e.actual.script, 'prefab-create.cs');
  assert.match(e.message, /Assets\/PiPrefab\.cs:12/);
  assert.ok(e.hint.some((h) => h.includes('CS1061')));
  assert.ok(e.hint.some((h) => h.includes('prefab-create.cs')), 'hint 必须点名是哪个 .cs 脚本');
  assert.strictEqual(exitCodeFor(e), 1, '编译错是运行时错（不在冻结用法表内）');
});

test('R435：没有可读条目时回落到 ErrorMessage', () => {
  const e = scriptCompileFailure({ Success: false, CompilationErrors: [{}], ErrorMessage: 'Compilation error occurred' }, null);
  assert.strictEqual(e.code, 'SCRIPT_COMPILE_ERROR');
  assert.match(e.message, /Compilation error occurred/);
});

test('R435：scriptNameFromArgs 从 --code-file 取脚本名（Windows 反斜杠也要认）', () => {
  assert.strictEqual(scriptNameFromArgs({ args: ['--code-file', 'C:/a/b/unity-scripts/scene-save.cs', '--parameters', '{}'] }), 'scene-save.cs');
  assert.strictEqual(scriptNameFromArgs({ args: ['--code-file', 'C:\\a\\b\\node-inspect.cs'] }), 'node-inspect.cs');
  assert.strictEqual(scriptNameFromArgs({ args: ['--code', 'return 1;'] }), null);
  assert.strictEqual(scriptNameFromArgs({ args: ['--code-file'] }), null);
  assert.strictEqual(scriptNameFromArgs(null), null);
});

test('R435 截断 tripwire 回归：truncated:true 且 json 是编译错形状 → 仍落 ULOOP_TRUNCATED', () => {
  const e = envelopeFromCall({
    truncated: true, tool: 'execute-dynamic-code', args: [], code: 0, timedOut: false, drained: true,
    json: { Success: false, CompilationErrors: [{ Message: 'CS1002' }] },
  });
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED', '识别必须排在截断判定之后');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/envelope.test.js`
预期：FAIL —— `scriptCompileFailure is not defined` / `scriptNameFromArgs is not defined`

- [ ] **步骤 3：在 `lib/envelope.js` 加两个函数（紧跟 `fail` 之后，`:134` 下方）**

```js
/**
 * 从 `call()` 的 argv 里取载荷脚本名（`--code-file <abs>/scene-save.cs` → `scene-save.cs`）。
 * 只为把 hint 说得更具体（「修正 unity-scripts/<name>.cs」），取不到就返回 null。
 */
function scriptNameFromArgs(r) {
  const args = r && Array.isArray(r.args) ? r.args : [];
  const i = args.indexOf('--code-file');
  if (i === -1 || typeof args[i + 1] !== 'string') return null;
  const parts = args[i + 1].split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

/**
 * 把「脚本编译失败」的 uloop 载荷收敛成**可读**的 `SCRIPT_COMPILE_ERROR` 信封。
 *
 * R435：原先只有 `unity exec` 认这个形状，payload 类命令（node / sprite / prefab / asset / scene 写）
 * 只落 `ULOOP_ERROR` + 空 message —— agent 拿不到 CS 码/行号，只能去翻 Editor.log。
 *
 * `phase: 'compile'` 是**给写路径看的**：编译失败意味着脚本**从未执行**，`withWriteRecheckHint`
 * 不得再追加「写入是否生效未知」（见 `lib/scene.js`）。
 *
 * @param {object} json uloop 原始 JSON（调用方保证 `isScriptCompileFailure(json) === true`）
 * @param {string|null} scriptName 出错的载荷脚本名，可为 null
 * @returns {object} 失败信封
 */
function scriptCompileFailure(json, scriptName) {
  const errors = compressIssues(json.CompilationErrors);
  const first = errors[0];
  const fallback = json.ErrorMessage || json.Error || '见 actual.errors';
  return {
    ...fail({
      code: 'SCRIPT_COMPILE_ERROR',
      message: `C# 脚本编译失败：${first ? `${first.file ?? scriptName ?? '<unknown>'}:${first.line ?? '?'} ${first.message}` : fallback}`,
      actual: {
        errors,
        errorMessage: typeof json.ErrorMessage === 'string' ? json.ErrorMessage : null,
        script: scriptName ?? null,
      },
      hint: [
        ...(first ? [`首条：${first.message}`] : []),
        scriptName ? `修正 unity-scripts/${scriptName} 后重试（编辑器控制台也会显示）` : '修正 C# 片段后重试（编辑器控制台也会显示）',
      ],
    }),
    phase: 'compile',
  };
}
```

顶部 require 追加：

```js
const { isScriptCompileFailure, compressIssues, isExecutionInProgress, CONCURRENT_HINT } = require('./issues.js');
```

`module.exports`（`:256-259`）追加 `scriptCompileFailure, scriptNameFromArgs`。

- [ ] **步骤 4：接入 `envelopeFromCall`（`:217-239`）**

```js
function envelopeFromCall(r) {
  if (r && r.truncated === true) {
    // ……既有截断分支**一字不动**（tripwire：test/envelope.test.js 的「truncated:true 且 json 非空」用例）……
  }
  const json = r ? r.json : null;
  // R435：编译失败的识别必须在**截断判定之后**（截断时 json 恒为 null，进不来），
  // 且放在 fromUloop 之前 —— 这是唯一能一处覆盖全部 payload 命令的位置（14 个调用点）。
  if (isScriptCompileFailure(json)) {
    return scriptCompileFailure(json, scriptNameFromArgs(r));
  }
  return fromUloop(json);
}
```

> 执行时把 `// ……既有截断分支**一字不动**……` 换成**真实存在的原代码**（`fail({ code: 'ULOOP_TRUNCATED', … })` 那一整块），不得留省略。

- [ ] **步骤 5：改 `lib/dynamic.js`：删本地实现**

删除 `:124-136` 的整个 `if (...)` 块，`require('./issues.js')` 一并删掉，只留一行注释：

```js
  // R435：编译失败已由 `envelopeFromCall` 中央识别（`lib/envelope.js` 的 `scriptCompileFailure`），
  // 本命令不再自建实现（避免两份判据漂移）。
```

- [ ] **步骤 6：改 `lib/scene.js` 的 `withWriteRecheckHint`（`:56-58`）**

```js
function withWriteRecheckHint(envl) {
  // R435：`phase === 'compile'` 表示脚本**根本没执行**（编译就失败了）→ 不可能有写入，
  // 再追加「写入是否生效未知」就是把人往错方向引（与 R475 同一条纪律）。
  if (envl && envl.phase === 'compile') return envl;
  return { ...envl, hint: [...(Array.isArray(envl.hint) ? envl.hint : []), WRITE_OUTCOME_UNKNOWN_HINT] };
}
```

- [ ] **步骤 7：写失败测试（payload 路径，`test/scenefile.test.js` 追加）**

> `sceneSave()` **直接返回信封**（`lib/scenefile.js:230`），不是 `{envelope}`；本文件已有 `exitCodeOf`（`:17-19`），**不要**引 `exitCodeFor`。

```js
test('R435：scene save 的 .cs 编译失败 → SCRIPT_COMPILE_ERROR（可读），不是空 message 的 ULOOP_ERROR', async () => {
  const e = await sceneSave({
    projectPath: 'C:/p',
    callFn: async () => ({
      code: 0, stdout: '', stderr: '', timedOut: false, drained: false, truncated: false,
      tool: 'execute-dynamic-code',
      args: ['--code-file', 'C:/p/unity-scripts/scene-save.cs', '--parameters', '{}'],
      json: {
        Success: false,
        CompilationErrors: [{ Message: 'CS1002: ; expected', File: 'Assets/PiSceneSave.cs', Line: 7 }],
        ErrorMessage: 'Compilation error occurred',
      },
    }),
  });
  assert.strictEqual(e.code, 'SCRIPT_COMPILE_ERROR');
  assert.match(e.message, /Assets\/PiSceneSave\.cs:7/);
  assert.strictEqual(e.actual.script, 'scene-save.cs');
  assert.ok(e.hint.some((h) => h.includes('scene-save.cs')));
  assert.ok(!e.hint.some((h) => /写入是否生效未知/.test(h)), '编译失败时脚本从未执行，不得追加写入复核 hint');
  assert.strictEqual(exitCodeOf(e), 1);
});
```

- [ ] **步骤 8：运行测试验证通过**

运行：`node --test test/scenefile.test.js test/envelope.test.js test/dynamic.test.js`
预期：PASS。**重点自查**：`test/dynamic.test.js` 的 R352 用例（`assert.match(e.message, /Assets\/PiDynamic\.cs:12/)` 与 hint 含 `CS1061`）**必须原样通过** —— 中央文案 `C# 脚本编译失败：Assets/PiDynamic.cs:12 …` 仍匹配该正则。

- [ ] **步骤 9：跑全量测试**

运行：`npm test`
预期：PASS，**574 + 4 + 1 = 579/579**

- [ ] **步骤 10：Commit**

```bash
git add lib/envelope.js lib/dynamic.js lib/scene.js test/envelope.test.js test/scenefile.test.js
git commit -m "fix(envelope): R435 编译错识别推广到全部 payload 命令（可读 CS 码/行号/脚本名 + 不追加写入复核 hint）"
```

---

### 任务 4：`unity pixels --diff` / `--centroid` / `--bbox`（项⑦）

**文件：**
- 修改：`lib/pixels.js`
- 修改：`lib/envelope.js`（`USAGE_FAILURE_CODES` 加 `DIFF_SIZE_MISMATCH`）
- 修改：`bin/unity.js`（handler + USAGE）
- 测试：`test/pixels.test.js`、`test/envelope.test.js`

- [ ] **步骤 1：写失败测试（`test/pixels.test.js` 追加）**

> **扫描 #2 修正**：`encodePng` 返回的是**编码后的 PNG**（以 8 字节签名开头），对它做 `buf[0]=…` 会破坏签名、`decodePng` 直接抛。**必须先改原始像素、最后才编码**。

```js
const { encodePng } = require('../lib/png.js');

/** 造 raw RGBA8 像素缓冲（width*height*4）。 */
function rawPixels(width, height, rgba) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return data;
}
/** raw → PNG Buffer。 */
function encode(raw, width, height) {
  return encodePng({ width, height, data: raw });
}
/** 改 raw 的某个像素。 */
function setPixel(raw, width, x, y, rgba) {
  raw.set(rgba, (y * width + x) * 4);
}

test('pixels --diff：两张图逐像素比对（changed / ratio / maxChannelDistance）', async () => {
  const rawA = rawPixels(4, 2, [255, 0, 0, 255]);
  const rawB = rawPixels(4, 2, [255, 0, 0, 255]);
  setPixel(rawB, 4, 0, 0, [0, 0, 255, 255]);          // 只改第 1 个像素为蓝
  const e = await pixels({
    file: 'A.png', diff: 'B.png',
    _readFile: (p) => (p === 'A.png' ? encode(rawA, 4, 2) : encode(rawB, 4, 2)),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.actual.diff.width, 4);
  assert.strictEqual(e.actual.diff.height, 2);
  assert.strictEqual(e.actual.diff.changed, 1);
  assert.strictEqual(e.actual.diff.ratio, 1 / 8);
  assert.strictEqual(e.actual.diff.maxChannelDistance, 255);
  assert.strictEqual(e.actual.diff.tolerance, 0);
  assert.strictEqual(e.actual.match, null, '--diff 不抢 --expect 的 match 判定权');
});

test('pixels --diff 容差：容差内不计入 changed', async () => {
  const rawA = rawPixels(2, 1, [100, 100, 100, 255]);
  const rawB = rawPixels(2, 1, [100, 100, 100, 255]);
  setPixel(rawB, 2, 0, 0, [110, 100, 100, 255]);       // 差 10
  const e = await pixels({ file: 'A.png', diff: 'B.png', tolerance: '16', _readFile: (p) => (p === 'A.png' ? encode(rawA, 2, 1) : encode(rawB, 2, 1)) });
  assert.strictEqual(e.actual.diff.changed, 0);
  assert.strictEqual(e.actual.diff.maxChannelDistance, 10);
});

test('pixels --diff 尺寸不等 → DIFF_SIZE_MISMATCH（用法错 2，读盘之后判定）', async () => {
  const e = await pixels({
    file: 'A.png', diff: 'B.png',
    _readFile: (p) => (p === 'A.png' ? encode(rawPixels(4, 2, [0, 0, 0, 255]), 4, 2) : encode(rawPixels(3, 2, [0, 0, 0, 255]), 3, 2)),
  });
  assert.strictEqual(e.code, 'DIFF_SIZE_MISMATCH');
  assert.strictEqual(exitCodeFor(e), 2);
});

test('pixels --diff 的第二张图读不了 / 不是 PNG → 运行时错 1', async () => {
  const a = encode(rawPixels(2, 1, [0, 0, 0, 255]), 2, 1);
  const bad = await pixels({ file: 'A.png', diff: 'B.png', _readFile: (p) => { if (p === 'A.png') return a; throw new Error('nope'); } });
  assert.strictEqual(bad.code, 'FILE_NOT_FOUND');
  assert.strictEqual(exitCodeFor(bad), 1);
  const notPng = await pixels({ file: 'A.png', diff: 'B.png', _readFile: (p) => (p === 'A.png' ? a : Buffer.from('nope')) });
  assert.strictEqual(notPng.code, 'BAD_PNG');
  assert.strictEqual(exitCodeFor(notPng), 1);
});

test('pixels --centroid：像素质心（含 count 与颜色）', async () => {
  const raw = rawPixels(4, 2, [0, 0, 0, 255]);
  setPixel(raw, 4, 1, 0, [255, 255, 255, 255]);
  setPixel(raw, 4, 3, 0, [255, 255, 255, 255]);
  const e = await pixels({ file: 'A.png', centroid: '#FFFFFF', _readFile: () => encode(raw, 4, 2) });
  assert.strictEqual(e.actual.centroid.count, 2);
  assert.strictEqual(e.actual.centroid.x, 2);
  assert.strictEqual(e.actual.centroid.y, 0);
  assert.strictEqual(e.actual.centroid.color, '#FFFFFF');
  assert.strictEqual(e.actual.centroid.tolerance, 0);
});

test('pixels --centroid 该色不存在 → count 0、x/y 为 null + hint（不是崩溃）', async () => {
  const e = await pixels({ file: 'A.png', centroid: '#123456', _readFile: () => encode(rawPixels(2, 1, [0, 0, 0, 255]), 2, 1) });
  assert.strictEqual(e.actual.centroid.count, 0);
  assert.strictEqual(e.actual.centroid.x, null);
  assert.strictEqual(e.actual.centroid.y, null);
  assert.ok(e.hint.length > 0);
});

test('pixels --bbox：包围盒（min/max 与宽高，含 tolerance 键）', async () => {
  const raw = rawPixels(4, 3, [0, 0, 0, 255]);
  for (const [x, y] of [[1, 1], [2, 1], [1, 2]]) setPixel(raw, 4, x, y, [255, 255, 255, 255]);
  const e = await pixels({ file: 'A.png', bbox: '#FFFFFF', _readFile: () => encode(raw, 4, 3) });
  assert.deepStrictEqual(e.actual.bbox, { color: '#FFFFFF', count: 3, x: 1, y: 1, width: 2, height: 2, tolerance: 0 });
});

test('pixels --bbox 该色不存在 → count 0、宽高 0、x/y null', async () => {
  const e = await pixels({ file: 'A.png', bbox: '#123456', _readFile: () => encode(rawPixels(2, 1, [0, 0, 0, 255]), 2, 1) });
  assert.deepStrictEqual(e.actual.bbox, { color: '#123456', count: 0, x: null, y: null, width: 0, height: 0, tolerance: 0 });
});

test('pixels --centroid / --bbox 颜色非法 → BAD_COLOR（2），且在读盘之前判定', async () => {
  const boom = () => { throw new Error('不该读盘'); };
  for (const opt of [{ centroid: 'nope' }, { bbox: '#GG' }]) {
    const e = await pixels({ file: 'C:/nope/missing.png', _readFile: boom, ...opt });
    assert.strictEqual(e.code, 'BAD_COLOR');
    assert.strictEqual(exitCodeFor(e), 2);
  }
});

test('pixels --diff 空串 → BAD_SOURCE（2），且不读盘', async () => {
  const e = await pixels({ file: 'C:/nope/missing.png', diff: '', _readFile: () => { throw new Error('不该读盘'); } });
  assert.strictEqual(e.code, 'BAD_SOURCE');
  assert.strictEqual(exitCodeFor(e), 2);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/pixels.test.js`
预期：FAIL（新用例不通过；既有 11 条仍通过）

- [ ] **步骤 3：改 `lib/pixels.js`**

顶部 require 加 `maxChannelDistance`（既有 `lib/color.js:27`，与 `:171` 的既有风格一致）：

```js
const { parseHexColor, maxChannelDistance, formatHex } = require('./color.js');
```

形参加三个键：

```js
async function pixels({ file, at, region, expect, tolerance, countColor: countHex, diff, centroid, bbox, _readFile } = {}) {
```

第一段（`--expect` 的两处检查之后、`// ── 第二段` 之前）追加**纯 argv** 校验：

```js
  if (diff !== undefined && (typeof diff !== 'string' || diff === '')) {
    return fail({
      code: 'BAD_SOURCE',
      message: `--diff 需要另一张 PNG 的路径，收到 ${JSON.stringify(diff)}`,
      actual: { diff },
      hint: ['用法：--diff C:/shots/b.png'],
    });
  }
  const centroidValue = centroid === undefined ? undefined : parseHexColor(centroid);
  if (centroid !== undefined && !centroidValue) {
    return fail({
      code: 'BAD_COLOR',
      message: `--centroid 需要 #RGB/#RRGGBB/#RRGGBBAA，收到 ${JSON.stringify(centroid)}`,
      actual: { centroid },
      hint: ["用法：--centroid '#FFFFFF'"],
    });
  }
  const bboxValue = bbox === undefined ? undefined : parseHexColor(bbox);
  if (bbox !== undefined && !bboxValue) {
    return fail({
      code: 'BAD_COLOR',
      message: `--bbox 需要 #RGB/#RRGGBB/#RRGGBBAA，收到 ${JSON.stringify(bbox)}`,
      actual: { bbox },
      hint: ["用法：--bbox '#FFFFFF'"],
    });
  }
```

第二段末尾（`return ok(actual, { hint });` 之前）追加：

```js
  if (diff !== undefined) {
    let buf2;
    try {
      buf2 = await (_readFile || ((p) => fs.readFileSync(p)))(diff);
    } catch (err) {
      return fail({
        code: 'FILE_NOT_FOUND',
        message: `读不了 --diff 的 PNG：${(err && err.message) || String(err)}`,
        actual: { file, diff },
        hint: ['--diff 的值也要是宿主上的 PNG 路径'],
      });
    }
    let img2;
    try {
      img2 = decodePng(buf2);
    } catch (err) {
      return fail({
        code: 'BAD_PNG',
        message: `--diff 的 PNG 解码失败：${(err && err.message) || String(err)}`,
        actual: { file, diff, bytes: Buffer.isBuffer(buf2) ? buf2.length : null },
        hint: ['只支持 bitDepth 8 / colorType 0,2,4,6 / 非交织的 PNG'],
      });
    }
    // 尺寸必须相等才能逐像素对账。宽高只有解码后才知道 → 属「范围类用法错」，
    // 按既有 BAD_AT/BAD_REGION 的先例（本文件顶部注释已声明该例外）归 2 档。
    if (img2.width !== img.width || img2.height !== img.height) {
      return fail({
        code: 'DIFF_SIZE_MISMATCH',
        message: `--diff 的两张图尺寸不等：${img.width}x${img.height} vs ${img2.width}x${img2.height}`,
        actual: { file, diff, a: { width: img.width, height: img.height }, b: { width: img2.width, height: img2.height } },
        hint: ['两张图必须同尺寸（同一 Game 窗口、同一 --capture-mode 下截取）'],
      });
    }
    let changed = 0;
    let maxDist = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const d = maxChannelDistance(
        { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2], a: 255 },
        { r: img2.data[i], g: img2.data[i + 1], b: img2.data[i + 2], a: 255 },
      );
      if (d > maxDist) maxDist = d;
      if (d > tol) changed++;
    }
    const total = img.width * img.height;
    actual.diff = {
      file, other: diff, width: img.width, height: img.height,
      changed, total, ratio: changed / total, maxChannelDistance: maxDist, tolerance: tol,
    };
    if (changed === 0) hint.push('两张图在容差内完全一致');
  }

  if (centroidValue !== undefined) {
    let count = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const o = (y * img.width + x) * 4;
        const d = maxChannelDistance(
          { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2], a: 255 },
          centroidValue,
        );
        if (d <= tol) { count++; sx += x; sy += y; }
      }
    }
    actual.centroid = {
      color: formatHex(centroidValue), count,
      x: count ? sx / count : null, y: count ? sy / count : null, tolerance: tol,
    };
    if (count === 0) hint.push(`画面里一个 ${formatHex(centroidValue)} 像素都没有 —— 质心无从谈起（该颜色可能没被渲染出来，或容差太小）`);
  }

  if (bboxValue !== undefined) {
    let count = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const o = (y * img.width + x) * 4;
        const d = maxChannelDistance(
          { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2], a: 255 },
          bboxValue,
        );
        if (d <= tol) {
          count++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    actual.bbox = count === 0
      ? { color: formatHex(bboxValue), count: 0, x: null, y: null, width: 0, height: 0, tolerance: tol }
      : { color: formatHex(bboxValue), count, x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, tolerance: tol };
    if (count === 0) hint.push(`画面里一个 ${formatHex(bboxValue)} 像素都没有 —— 包围盒为空（该颜色可能没被渲染出来，或容差太小）`);
  }
```

同时更新 `lib/pixels.js` 顶部的函数 JSDoc：写明新增三个选项、`DIFF_SIZE_MISMATCH` 属「有先例的范围类用法错（读盘后判定）」、以及 `--diff` **不置** `actual.match`。

- [ ] **步骤 4：`lib/envelope.js` 的 `USAGE_FAILURE_CODES` 加 `DIFF_SIZE_MISMATCH`**

插到 `'BAD_WORLD_SIZE',` 与 `'EMPTY_PATCH',` 之间。

- [ ] **步骤 5：改 `bin/unity.js`**

handler（`:424-440`）加三个透传：

```js
        diff: args.diff,
        centroid: args.centroid,
        bbox: args.bbox,
```

USAGE：`pixels 选项：` 段加三行；示例加两行；并写明 `DIFF_SIZE_MISMATCH` 属 **2 用法错**。

- [ ] **步骤 6：同步 `test/envelope.test.js` 的排序后全等断言**

在 `'BAD_WORLD_SIZE'` 与 `'EMPTY_PATCH'` 之间插入 `'DIFF_SIZE_MISMATCH'`。

- [ ] **步骤 7：跑全量测试**

运行：`npm test`
预期：PASS，**579 + 10 + 1 = 590/590**（若 `test/cli.test.js` 的 USAGE 断言因新选项而挂，同批修正并记录真实总数）

- [ ] **步骤 8：Commit**

```bash
git add lib/pixels.js lib/envelope.js bin/unity.js test/pixels.test.js test/envelope.test.js
git commit -m "feat(pixels): --diff / --centroid / --bbox（一等公民的画面变没变判据）"
```

---

### 任务 5：`MISSING_PROJECT_PATH` 归 2 档（项⑪ 前半）

**文件：**
- 修改：`lib/envelope.js`（`USAGE_FAILURE_CODES`）
- 修改：`bin/unity.js`（USAGE 文案 `:143` / `:163` + handler 注释 `:494`）
- 测试：`test/envelope.test.js`、`test/asset.test.js`、`test/importart.test.js`、`test/prefab.test.js`、`test/cli.test.js`、`test/build.test.js`、`test/scene.test.js`

- [ ] **步骤 1：写失败测试（`test/envelope.test.js` 追加；`isUsageFailure` 已在任务 2 导入）**

```js
test('R477：MISSING_PROJECT_PATH 是「缺参数」→ 用法错 2 档（不再是 1）', () => {
  assert.strictEqual(isUsageFailure('MISSING_PROJECT_PATH'), true);
  assert.strictEqual(exitCodeFor(fail({ code: 'MISSING_PROJECT_PATH', message: 'x' })), 2);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/envelope.test.js`
预期：FAIL —— 实际 `isUsageFailure` 为 `false`、退出码 1

- [ ] **步骤 3：改 `lib/envelope.js`**

`USAGE_FAILURE_CODES` 里插到 `'MISSING_PATCH',` 与 `'MISSING_SOURCE',` 之间：

```js
  'MISSING_PROJECT_PATH',
```

并更新该数组上方 JSDoc 的边界规则：明确「缺 `--project-path` = 参数缺失 = 2」，注明此前误归 1 档、本次按 R477 订正。同步 `test/envelope.test.js:318-325` 的排序后全等断言。

- [ ] **步骤 4：改 `bin/unity.js` 的三处文案**

| 行 | 改什么 |
|---|---|
| `:143` | `MISSING_PROJECT_PATH（**不在冻结用法表内 → 退出码 1**）` → 移入 2 档表述 |
| `:163` | 把 `MISSING_PROJECT_PATH` 从「1 档」清单移入「2 用法错」清单 |
| `:494` | handler 注释同步（`MISSING_PROJECT_PATH **不在冻结用法表内 → 1**` → `→ 2`） |

**不改** `:19`（`MISSING_PROJECT_PATH = 未给项目根（写闭环零写入）`）—— 那是 `doctor --json` 的 **skip code 图例**，不是退出码声明。

- [ ] **步骤 5：改既有断言（口径反转）+ 补两处缺口**

| 位置 | 改动 |
|---|---|
| `test/asset.test.js:242`、`:257` | `exitCodeFor(...), 1` → `2`；用例名里的「（1）」→「（用法错 2）」 |
| `test/importart.test.js:87/91` | 同上（用例名「（运行时错 1）」→「（用法错 2）」） |
| `test/prefab.test.js:57` | `1` → `2`（该用例名无「（1）」标记，只需改断言） |
| `test/cli.test.js:28-40` | 注释与两条断言反转（`/ARTIFACT_MISSING \/ MISSING_PROJECT_PATH \//` 的位置要求随之调整） |
| **`test/build.test.js`（`MISSING_PROJECT_PATH` 用例内）** | **补** `assert.strictEqual(exitCodeFor(e), 2, '缺 project-path 是用法错（R477）')` —— 否则本处口径变化零覆盖 |
| **`test/scene.test.js`（`MISSING_PROJECT_PATH` 用例内）** | 同上补一条 `exitCodeFor === 2`；**必须保留**「绝对路径时不报错」的既有不变量（`test/scene.test.js:291` 那条） |

（`test/doctor.test.js:694-706` **不动** —— doctor 的退出码是自报的，`MISSING_PROJECT_PATH` 在它那里只是 `checks[]` 的 skip code。）

- [ ] **步骤 6：跑全量测试**

运行：`npm test`
预期：PASS

- [ ] **步骤 7：Commit**

```bash
git add lib/envelope.js bin/unity.js test/envelope.test.js test/asset.test.js test/importart.test.js test/prefab.test.js test/cli.test.js test/build.test.js test/scene.test.js
git commit -m "fix(envelope): R477 MISSING_PROJECT_PATH 归 2 档（缺参数=用法错）+ USAGE 口径同步 + 补两处覆盖缺口"
```

---

### 任务 6：`--flag=1` 口径统一（项⑪ 后半 / D-A2）

**文件：**
- 修改：`lib/args.js`（`normalizeBooleans` + `BOOLEAN_KEYS`）
- 修改：`bin/unity.js`（`parseArgsStrict` + **11 个** handler 接线 + USAGE）
- 修改：`lib/doctor.js`（自己接 `normalizeBooleans`）
- 测试：`test/cli.test.js`、`test/envelope.test.js`

> **扫描 #7 修正**：`bin/unity.js` 里 `parseArgs` 调用点共 **11 处**，**不是 12 处**，且只有 **5 处**用 `rest`：
> `:407`(shot, rest) `:426`(pixels, rest) `:480`(compile, rest) `:489`(build, rest) `:637`(exec, rest)
> `:327`(scene) `:356`(node) `:444`(sprite) `:508`(asset) `:555`(prefab) `:586`(play) —— 这 6 处是 `parseArgs(opts)`。
> 第 12 处在 `lib/doctor.js:465`（`parseArgs(argv)`），**doctor 必须自己实现**（`lib` 不得依赖 `bin`）。

- [ ] **步骤 1：写失败测试（`test/cli.test.js` 追加）**

```js
test('D-A2：--flag=1/0/true/false 归一成布尔；非法值 → BAD_FLAG_VALUE（2）', () => {
  const { normalizeBooleans } = require('../lib/args.js');
  const ok1 = normalizeBooleans({ force: '1', json: '0', trim: 'true', smoke: 'false' });
  assert.strictEqual(ok1.error, undefined);
  assert.deepStrictEqual(ok1.args, { force: true, json: false, trim: true, smoke: false });
  const ok2 = normalizeBooleans({ force: true, at: '446,177' });
  assert.deepStrictEqual(ok2.args, { force: true, at: '446,177' }, '带值参数与裸写布尔不受影响');
  for (const bad of ['maybe', '', '2', 'yes!']) {
    const r = normalizeBooleans({ force: bad });
    assert.strictEqual(r.error.code, 'BAD_FLAG_VALUE', `--force=${JSON.stringify(bad)} 必须报用法错`);
  }
});

test('D-A2：CLI 上 --json=0 真的关掉 JSON（人读模式不以 { 开头）', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout: cap } = require('./helpers/capture.js');
  const { exitCodeFor } = require('../lib/envelope.js');
  const fixture = path.join(__dirname, 'fixtures', 'unity-gameview-892x355.png');
  const human = await cap(() => main(['pixels', '--file', fixture, '--json=0']));
  assert.strictEqual(human.result, 0);
  assert.ok(!human.out.trim().startsWith('{'), `--json=0 必须输出人读模式，实际：${human.out.slice(0, 40)}`);
});

test('D-A2：CLI 上非法布尔值 → 退出码 2（不经信封）', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStderr: capErr } = require('./helpers/capture.js');
  const r = await capErr(() => main(['pixels', '--file', 'x.png', '--json=maybe']));
  assert.strictEqual(r.result, 2);
  assert.match(r.err, /BAD_FLAG_VALUE/);
});
```

（`test/cli.test.js` 顶部若无 `path` require 需补 `const path = require('node:path');`。）

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/cli.test.js`
预期：FAIL —— `normalizeBooleans is not a function`

- [ ] **步骤 3：在 `lib/args.js` 加 `normalizeBooleans` + `BOOLEAN_KEYS`**

```js
/** 布尔开关的取值归一表（D-A2）。 */
const TRUE_VALUES = new Set(['1', 'true', 'yes']);
const FALSE_VALUES = new Set(['0', 'false', 'no']);

/**
 * **全项目布尔开关清单（9 个）**。`bin/unity.js` 与 `lib/doctor.js` 共用。
 * 消费点（供将来核对）：json（bin 16 处 + doctor 3 处）、smoke/golden（doctor）、
 * force（asset/importart/prefab/scenefile）、no-compile（asset）、trim（importart）、
 * bypass-raycast/dry-run/include-stack-trace（play）。
 */
const BOOLEAN_KEYS = Object.freeze([
  'json', 'smoke', 'golden', 'force', 'trim', 'no-compile',
  'bypass-raycast', 'dry-run', 'include-stack-trace',
]);

/**
 * 把布尔开关的 `--flag=<值>` 归一成真布尔（D-A2）。
 *
 * 为什么必须有这一层：`parseArgs` 对 `--flag=1` 给的是**字符串** `'1'`，而各命令的消费点
 * 分两族 —— 严格族（`x === true`，如 `--force`/`--trim`/`--dry-run`）会**静默 no-op**，
 * 真值族（`Boolean(x)`，如 `--json`）则**关不掉**（`--json=0` 仍输出 JSON）。
 * 两族都是「用户说了话、工具没照做」的静默失败（`--dry-run=1` 甚至**真的注入输入**）。
 * 归一后：`1/true/yes`→`true`、`0/false/no`→`false`，其余值报 `BAD_FLAG_VALUE`（用法错 2）。
 *
 * 只遍历 {@link BOOLEAN_KEYS} → **带值参数（`--ppu 1` / `--sorting-order 0` / `--max-count 1` …）不受影响**。
 *
 * @param {Record<string, unknown>} args `parseArgs` 的输出
 * @param {string[]} [keys] 布尔开关键名；缺省用 {@link BOOLEAN_KEYS}
 * @returns {{args: Record<string, unknown>, error?: {code: string, message: string, hint: string[]}}}
 */
function normalizeBooleans(args, keys = BOOLEAN_KEYS) {
  const out = { ...args };
  for (const key of keys) {
    const v = out[key];
    if (v === undefined || typeof v === 'boolean') continue;
    const s = String(v).trim().toLowerCase();
    if (TRUE_VALUES.has(s)) out[key] = true;
    else if (FALSE_VALUES.has(s)) out[key] = false;
    else {
      return {
        args,
        error: {
          code: 'BAD_FLAG_VALUE',
          message: `--${key} 是布尔开关，只接受 1/0/true/false/yes/no，收到 ${JSON.stringify(v)}`,
          hint: [`用法：--${key}（等价于 --${key}=1）或不写`],
        },
      };
    }
  }
  return { args: out };
}

module.exports = { parseArgs, normalizeBooleans, BOOLEAN_KEYS };
```

- [ ] **步骤 4：运行测试验证通过（库级）**

运行：`node --test test/cli.test.js`
预期：前两条通过；CLI 级两条仍 FAIL（尚未接线）

- [ ] **步骤 5：`bin/unity.js` 接线**

在 `COMMANDS` 定义之前加：

```js
/**
 * D-A2：解析 + 布尔归一。归一失败时按既有 argv 形状错的做法**直接返回 EXIT_USAGE**
 * （不经信封 —— 与 `bin/unity.js` 现有的 `MISSING_*` 子动作分支一致）。
 */
function parseArgsStrict(argv) {
  const { parseArgs, normalizeBooleans } = require('../lib/args.js');
  const r = normalizeBooleans(parseArgs(argv));
  if (r.error) {
    process.stderr.write(`[FAIL] ${r.error.code}: ${r.error.message}\n`);
    for (const h of r.error.hint) process.stderr.write(`  hint: ${h}\n`);
    return { error: true };
  }
  return { args: r.args };
}
```

把上面列的 **11 处**调用改为（`rest` / `opts` 变量名各自保留）：

```js
      const parsed = parseArgsStrict(rest);   // 或 parseArgsStrict(opts)
      if (parsed.error) return EXIT_USAGE;
      const args = parsed.args;
```

- [ ] **步骤 6：`lib/doctor.js` 自己接（不得 require `bin/`）**

`lib/doctor.js:465` 附近改为：

```js
  const { parseArgs, normalizeBooleans } = require('./args.js');
  const { EXIT_USAGE } = require('./envelope.js');
  const normalized = normalizeBooleans(parseArgs(argv));
  if (normalized.error) {
    process.stderr.write(`[FAIL] ${normalized.error.code}: ${normalized.error.message}\n`);
    for (const h of normalized.error.hint) process.stderr.write(`  hint: ${h}\n`);
    return EXIT_USAGE;
  }
  const args = normalized.args;
```

（若 `EXIT_USAGE` 在 doctor 内已有局部引入，复用之；`lib/doctor.js:472-473` 已有局部 require 的先例。）

- [ ] **步骤 7：`lib/envelope.js` 的 `USAGE_FAILURE_CODES` 加 `BAD_FLAG_VALUE`**

插到 `'BAD_FIT',` 之后（字典序 `BAD_FILTER` < `BAD_FIT` < `BAD_FLAG_VALUE` < `BAD_MATCH_MODE`），并同步 `test/envelope.test.js` 的排序后全等断言。

- [ ] **步骤 8：USAGE 文案 + 既有注释失真**

- `bin/unity.js` 选项说明加一句：「布尔开关也接受 `=1/=0/=true/=false`（D-A2）；非法取值报 `BAD_FLAG_VALUE`（退出码 2）」。
- `lib/scenefile.js:282` 的注释（「`--force=abc` 这类取值一律当 false」）补一句：「**CLI 侧**由 `normalizeBooleans` 提前挡下（`BAD_FLAG_VALUE`）；本库级分支仍保留，供直接调用库的调用方使用」。

- [ ] **步骤 9：跑全量测试**

运行：`npm test`
预期：PASS

- [ ] **步骤 10：Commit**

```bash
git add lib/args.js lib/envelope.js bin/unity.js lib/doctor.js lib/scenefile.js test/cli.test.js test/envelope.test.js
git commit -m "fix(args): D-A2 布尔开关归一（--flag=1 生效 / --json=0 关得掉 / 非法值报 BAD_FLAG_VALUE）"
```

---

### 任务 7：真机验收 + 文档回写

**文件：**
- 修改：`README.md`、`skills/unity-game-dev/SKILL.md`、`docs/HANDOFF.md`、`docs/PITFALLS.md`

- [ ] **步骤 1：真机验收 ①（确定性并发触发，验证新 hint）**

```bash
export PI_UNITY_ULOOP_BIN="C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe"
P="C:/Users/<用户>/pi-unity-official-f3c1"
node bin/unity.js exec --project-path "$P" --code 'System.Threading.Thread.Sleep(25000); return "holder";' --json &
sleep 2
node bin/unity.js scene tree --project-path "$P" --json
wait
```

预期：受害者 `code=UNITY_SERVER_BUSY`、`retryable=true`，且 `hint` 里出现 `单飞`。

- [ ] **步骤 2：真机验收 ②（编译错可读性）**

**临时**在 `unity-scripts/node-inspect.cs` 里造一处编译错（例：把某处 `var` 改成 `var var`），跑：

```bash
node bin/unity.js node inspect --project-path "$P" --path "Hero" --json
```

预期：`code=SCRIPT_COMPILE_ERROR`、`message` 带 `文件:行` 与 CS 码、`actual.script='node-inspect.cs'`、`hint` 点名该 `.cs`，且 **hint 里没有**「写入是否生效未知」。

**收尾（必做）**：

```bash
git checkout -- unity-scripts/node-inspect.cs
git status --porcelain    # 必须只剩预期的未提交改动，且不含 unity-scripts/
```

- [ ] **步骤 3：真机验收 ③（pixels 新选项）**

```bash
node bin/unity.js shot --project-path "$P" --out C:/Users/<用户>/piu-probe/shots --json
node bin/unity.js pixels --file <步骤输出的 actual.path> --centroid '#FFFFFF' --bbox '#FFFFFF' --count-color '#FFFFFF' --json
# 再截一张（内容应相同）→ --diff 应报 changed 0；改一处再截 → changed > 0
node bin/unity.js pixels --file <图A> --diff <图B> --json
```

预期：三个新键出现在 `actual`；`--diff` 的 `changed/ratio` 与**带外复算**一致（用 `--count-color` + `--at` 独立复现，照 `docs/E2E-ACCEPTANCE-m2.md` §3.2 B3 的做法；`docs/PITFALLS.md` U24 的真机数值锚点：64225 px（10.45%）、连续两帧 6089 px（0.99%））。

- [ ] **步骤 4：文档回写**

| 文件 | 改什么 |
|---|---|
| `README.md:46` | 命令表 `pixels` 行加 `--diff/--centroid/--bbox` |
| `README.md:115` | 删掉「**尚未实现**：`unity pixels --diff`」那句 |
| `README.md:154` | 「踩坑记录 **U1–U47**」→ **U1–U49** |
| `skills/unity-game-dev/SKILL.md:26` | 命令表同 README:46 |
| `skills/unity-game-dev/SKILL.md:732` | 「差分由带外工具算得」→ 改为「用 `unity pixels --diff`」 |
| `skills/unity-game-dev/SKILL.md:165-168` | ⚠️ **并发话术订正**：原文写「并行只读 → `ULOOP_TRUNCATED`」→ 改为 `UNITY_SERVER_BUSY` + 「uloop 单飞，串行重试」 |
| `skills/unity-game-dev/SKILL.md` §8 | 重审 §8 里所有「带外算差分/质心」的话术（`:650,660,664,684-699,780,787,802,807`） |
| `docs/PITFALLS.md:47`（U24 索引行） | 「M3 候选 `pixels --diff`」→ **已关闭**（指向本批次） |
| `docs/PITFALLS.md:1253`（D12 登记） | 标注**已解决**（`MISSING_PROJECT_PATH` 已归 2 档，USAGE 图例不再矛盾） |
| `docs/HANDOFF.md` §7 | ①②⑦⑪ 标为**已做**（附版本号）；⑫ M5 顺延 |
| `docs/HANDOFF.md` §2 | 「测试 565/565」→ 新总数；`§6` 的并发条目补 `UNITY_SERVER_BUSY` |

- [ ] **步骤 5：跑全量测试 + 收尾**

运行：`npm test`
预期：PASS（新总数）

```bash
git add -A
git commit -m "docs(m5): 批次 A 收尾 —— README/SKILL/PITFALLS/HANDOFF 回写 + 真机验收记录"
```

---

## 5. 自检

| 规格 / backlog 项 | 对应任务 |
|---|---|
| ① 并发调用的 hint 改进（R475 第三半） | 任务 2（+ 任务 1 探针前提 + 任务 7 真机验收） |
| ② payload 类命令的 `.cs` 编译错报文不可读（R435） | 任务 3 |
| ⑦ `pixels --diff` / 质心 / bbox | 任务 4 |
| ⑪ `--flag=1` 静默 no-op + `MISSING_PROJECT_PATH` 归 1 档 | 任务 5（归 2）+ 任务 6（`--flag=1`） |
| U46 订正 | 任务 1 |
| 退出码单点 / 冻结数组同步 / 防假绿 / 控制者不改代码 | 全局约束，每个任务隐含 |

**占位符扫描**：任务 3 步骤 4 的 `// ……既有截断分支**一字不动**……` 是**执行时必须替换成真实原码**的提示（已在同步骤显式说明）；任务 7 步骤 3 的 `<图A>` 是运行时才产生的路径。其余无占位符。

**类型一致性**：`compressIssues` / `isScriptCompileFailure` / `isExecutionInProgress` / `CONCURRENT_HINT` / `EXECUTION_IN_PROGRESS_TEXT` / `scriptCompileFailure` / `scriptNameFromArgs` / `normalizeBooleans` / `BOOLEAN_KEYS` / `DIFF_SIZE_MISMATCH` / `BAD_FLAG_VALUE` 在各任务间同名同形。

**顺序耦合声明**：任务 5 与任务 6 都改 `lib/envelope.js` 的 `USAGE_FAILURE_CODES` 与 `test/envelope.test.js` 的同一断言 → **必须按 5 → 6 顺序执行**（同批改动，勿并行）。

---

## 6. 执行方式

**1. 子代理驱动（推荐）** —— 每个任务调度一个新子代理，任务间进行 spec + code 双审，快速迭代
**2. 内联执行** —— 在当前会话中用 executing-plans 执行任务，批量执行并设有检查点

---

## 7. 起飞前冲突扫描裁定记录（2026-09-20）

| # | 扫描发现 | 裁定 | 落入 |
|---|---|---|---|
| 1 | 🔴 并发 hint 门控读错字段（哨兵在 `ErrorMessage`，`fromUloop` 只读 `Message`）→ hint 永不触发，且 exec 报文会**退化** | **成立**（已亲自核实 `lib/envelope.js:192-200` 与 `piu-probe` 证据）。裁定：`fromUloop` 的 message 兜底扩为 `Message ?? ErrorMessage`（**D-A4**）；测试载荷删掉真机不存在的 `ErrorCode` | 任务 2 步骤 5/7 |
| 2 | 🔴 `makePngBuffer` 返回编码后的 PNG，测试却对其做像素写入 → 破坏签名 | **成立**。改为 `rawPixels`/`setPixel`/`encode` 三段式 | 任务 4 步骤 1 |
| 3 | 🔴 bbox 的 `deepStrictEqual` 缺 `tolerance` 键 | **成立**。断言补 `tolerance: 0` | 任务 4 步骤 1 |
| 4 | 🔴 `scriptCompileFailure` 依赖方向自相矛盾 + 未加进 `module.exports` | **成立**。裁定：放 `lib/envelope.js` + 显式导出；`lib/issues.js` 保持零依赖 | 任务 3 步骤 3 |
| 5 | 🔴 scenefile 测试 `r.envelope` 不存在、`exitCodeFor` 未导入 | **成立**。改用 `e.code` + 既有 `exitCodeOf` | 任务 3 步骤 7 |
| 6 | 🔴 任务 5 用了未导入的 `isUsageFailure` | **成立**。在任务 2 步骤 5 就补上该 import（任务 5 复用） | 任务 2 步骤 5 |
| 7 | 🔴 「12 处 `parseArgs(rest)`」不成立（实为 11 处：5×rest + 6×opts；doctor 另算） | **成立**。逐个列行号；doctor 自己实现（不得 require `bin/`） | 任务 6 步骤 5/6 |
| 8 | 🟡 编译错信封会被 `withWriteRecheckHint` 追加「写入是否生效未知」（脚本从未执行） | **成立**。`scriptCompileFailure` 带 `phase:'compile'`，`withWriteRecheckHint` 遇之跳过 | 任务 3 步骤 3/6 |
| 9 | 🟡 任务 5 遗漏 build/scene 的退出码覆盖缺口 + 文档过期项 | **成立**。补 2 条断言 + 文档表加 `README.md:154`、`PITFALLS.md:1253` | 任务 5 步骤 5、任务 7 步骤 4 |
| 10 | 🟡 任务 7 漏改 `SKILL.md:165-168` 的并发话术（与 U46 订正自相矛盾） | **成立**。加入文档表 | 任务 7 步骤 4 |
| 11 | 🟡 PITFALLS 索引表未补 U48/U49；追加位置与层级不一致 | **成立**。插在 `### U47` 后、`### M4：…` 前，层级 `###`，索引表同稿补 2 行 | 任务 1 步骤 3/4 |
| 12 | ⚪ `docs/M3-DECISIONS.md` 的 R201–R213 引用错误（实际在 `docs/M2-DECISIONS.md:48`） | **成立**。本计划已不再引用该处 | — |
| 13 | ⚪ 若干不精确（`lib/asset.js:42-48` 实为 43–49；`BOOLEAN_KEYS` 注释「12 个」实为 9；`maxChannelDistance` 未复用；`test/play.test.js:110` 误分类） | **成立**。逐条订正 | 任务 2/4/6 |
| — | 扫描建议：任务 2/3 之间有「写后即删」返工 | **采纳**。任务 2 只做①（含判据收紧），任务 3 只做②的中央化 —— 中间态无退化 | 任务 2/3 |

---

## 8. 执行结果与计划偏差

> 本节为**执行后回写**（2026-09-20）：如实记录实际 commit、实际测试基线，以及计划自身的缺陷与执行中的计划外加固。

### 8.1 实际 commit

批次 A 实际落地 **6 个 commit**（计划正文按任务切分为 6 个；开头写的「4 个 commit」是笔误）：

| # | commit | 标题 | 对应任务 |
|---|---|---|---|
| 1 | `ccc0f80` | docs(m5): 探针报告落盘 + U46 订正（真实码是 `UNITY_SERVER_BUSY`）+ U48/U49 + 批次 A 计划 | 任务 1（探针/订正/计划） |
| 2 | `49c5222` | fix(envelope): R475/U49 并发被拒不再误判为编译错 + message 兜底扩到 `ErrorMessage` + 串行重试 hint | 任务 2（项①） |
| 3 | `921c3b0` | fix(envelope): R435 编译错识别推广到全部 payload 命令（可读 CS 码/行号/完整脚本路径 + 写路径不再误加复核 hint） | 任务 3（项②） |
| 4 | `19c2d2b` | feat(pixels): `--diff` / `--centroid` / `--bbox`（一等公民的画面变没变判据） | 任务 4（项⑦） |
| 5 | `b5064b4` | fix(envelope): R477 `MISSING_PROJECT_PATH` 归 2 档（缺参数=用法错）+ USAGE 口径同步 + 补两处覆盖缺口 | 任务 5（项⑪前半） |
| 6 | `5fc3776` | fix(args): D-A2 布尔开关归一（`--flag=1` 生效 / `--json=0` 关得掉 / 非法值报 `BAD_FLAG_VALUE`）+ 11 handler 接线护栏 | 任务 6（项⑪后半） |

### 8.2 实际测试基线

`npm test` 最终 **606/606 绿**（Node ≥21，零依赖 `node --test "test/*.test.js"`）。

计划里给出的 572/574/575/579/590/603 是**估算**；实际基线随任务滚动，**逐条实际值**如下：

| 节点 | 计划预期 | 实际 |
|---|---|---|
| 任务 2 结束 | 572 | **575** |
| 任务 3 结束 | 574 | **585** |
| 任务 4 结束 | 575 | **599** |
| 任务 5 结束 | 579 | **600** |
| 任务 6 结束 | 603 | **606** |

（差异原因：计划低估了「判据收紧 + 中央识别」类改动的用例增补量；后续一律**以 `npm test` 实跑为准**。）

### 8.3 计划自身的 4 个 bug（执行时由实现者发现并修正）

| # | 计划缺陷 | 执行时的修正 |
|---|---|---|
| (a) | 任务 3 步骤 4 的代码块里留了 `// ……既有截断分支一字不动……` 省略号 | 替换为真实原码（计划同步骤已标注「执行时必须替换」，但正文确实留了占位） |
| (b) | 任务 3 步骤 1 的断言与步骤 3 的实现自相矛盾：断言取 `errors[0]`，实现按 `errors.find(x => x.message !== '')` | **按断言为准**，实现改为 `find`（避免空 message 条目抢占） |
| (c) | 任务 6 步骤 1 的测试用了 `r.err`，但 `test/helpers/capture.js` 的 `captureStderr` 返回 `{result, out}` | 改为 `r.out` |
| (d) | 任务 5 / 6 的用例数算式与实际基线不符 | 以 `npm test` 实际输出为准（见 §8.2） |

### 8.4 双审发现的计划外加固

| # | 加固 | 原因 |
|---|---|---|
| 1 | `phase: 'compile'` 与 `lib/asset.js` 既有同名字面量撞车 → 跳过条件改绑 `code === 'SCRIPT_COMPILE_ERROR'` | 只按 `phase` 判会误伤 `lib/asset.js` 既有的 `phase:'compile'` 语义 |
| 2 | `scriptNameFromArgs` 的 hint 硬编码 `unity-scripts/` → 改为**完整路径** | 硬编码相对目录会误导用户去错误位置找脚本 |
| 3 | 11 个 handler 的**接线护栏**（表驱动用例） | 归一化接线若漏接某个 handler 会静默失效；表驱动用例把 11 处一次钉死 |
