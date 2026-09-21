# M5 探针报告：uloop 并发（单飞）的事实基础

> **日期**：2026-09-20（真机）。**目的**：为 `docs/superpowers/plans/2026-09-20-pi-unity-backlog-a.md` 的**项①**
> （并发被拒被误判成编译错 / `UNITY_SERVER_BUSY` 不指向串行重试）提供可复核的原始证据，
> 并订正 `docs/PITFALLS.md` 的 **U46**（原条目称「并行只读 → `ULOOP_TRUNCATED`」，**未复现**）。
>
> **口径**：本文件只记录探针**实测**；结论与计划 **§2 探针结论**表逐条一致，不引入表外数据。
> 原始证据全部落在 `docs/m5-probes-raw/`（本仓库内），并已在下方逐条引用。

## 0. 探针环境

| 项 | 值 |
|---|---|
| 引擎 | Unity **官方版 2022.3.62f3c1**（项目 `C:/Users/<用户>/pi-unity-official-f3c1`，编辑器已在跑） |
| uloop dispatcher | **3.5.1** |
| dispatcher 路径 | `PI_UNITY_ULOOP_BIN=C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe` |
| 探测入口 | `lib/uloop.js` 的 `call()`（Node 侧直接调 dispatcher）；信封命令则走本仓库 CLI（`bin/unity.js`，`bin` 名 `unity`） |
| 并发方式 | 同一 Node 进程 `Promise.all` 发多条命令，以及**多个独立 Node 进程**并行（复现 CLI 的进程级并发） |

> ⚠️ **纪律**：探针**只读**、不碰任何用户工程；并发本身是**故意**制造的（就是要复现被拒）。

## 1. 证据清单（`docs/m5-probes-raw/`）

| 文件 | 内容 | 对应探针 |
|---|---|---|
| `p4-1.json` … `p4-4.json` | 4 条并行 `exec` 的 **CLI 信封**（3 失败 + 1 成功） | P1 |
| `one-a.txt` … `one-f.txt` | 6 个**独立进程**并行 `exec` 的**上游原始 JSON** | P2 |
| `t10-1.json` … `t10-10.json` | 10 条并行 `scene tree` 的 CLI 信封（8 ok + 2 busy） | P3 |
| `victim2.json` | 确定性触发的 `UNITY_SERVER_BUSY` **原始信封** | P4 |
| `probe-one.js` | P2 的探针脚本（单次调用 + 打印原始 JSON，供多进程并行） | P2 |
| `recorder.js` | 只读记录器（把 dispatcher 的原始 stdout/stderr 落 `raw-log.jsonl` 后原样转发） | P2 / P5 |
| `raw-log.jsonl` | `recorder.js` 记录的原始 stdout/stderr（JSONL，一行一次调用） | P2 / P5 |

> **未落盘**（仍在 `C:/Users/<用户>/piu-probe/`，不属本计划要求抄录的集合）：
> `d5-*.json`、`e1-*.json`、`e2-*.json`、`e3-*.json`、`r1-*`…`r6-*.json`（P5 的重跑）、`read-*.json`（P3 的 6 并行那轮）、
> `c5-*.json`、`holder*.json`、`victim.json`、`probe-raw.js`、`probe-raw2.js`。

---

## 2. 探针逐条

### P1 —— 4 条并行 `unity exec` → **复现误判**（3/4 失败，`SCRIPT_COMPILE_ERROR`）

**命令原文（§2 记录；探针会话用 CLI 发 4 条并行 `exec`，各睡 4 秒）**：

```bash
unity exec --code 'System.Threading.Thread.Sleep(4000); return "1";'
unity exec --code 'System.Threading.Thread.Sleep(4000); return "2";'
unity exec --code 'System.Threading.Thread.Sleep(4000); return "3";'
unity exec --code 'System.Threading.Thread.Sleep(4000); return "4";'
# 4 条同时发（并行）
```

**原始输出（CLI 信封，逐字；`p4-1.json` = 失败那份）**：

```json
{
  "ok": false,
  "verified": false,
  "code": "SCRIPT_COMPILE_ERROR",
  "message": "动态代码编译失败：Another execution is already in progress",
  "intent": null,
  "actual": {
    "errors": [],
    "errorMessage": "Another execution is already in progress"
  },
  "hint": [
    "修正 C# 片段后重试；`unity exec` 的代码里不能有编译错误（编辑器控制台也会显示）"
  ],
  "retryable": false
}
```

`p4-2.json`（4 条里唯一成功的那条）：

```json
{
  "ok": true,
  "verified": null,
  "intent": null,
  "actual": {
    "result": "2"
  },
  "hint": [
    "actual.result 是脚本 return 的原样值（脚本没有 return → null）",
    "本命令是执行/读命令：没有可比对的 intent，verified 恒为 null —— 别把它当写命令的验证结果"
  ]
}
```

`p4-3.json` / `p4-4.json` 与 `p4-1.json` **同形**（同为 `SCRIPT_COMPILE_ERROR` + 同一条 message）。

**上游原始 JSON 的失败形状**（§2 硬事实 2，由 `probe-raw2.js` 捕获）：

```json
{"Success":false,"CompilationErrors":[],"ErrorMessage":"Another execution is already in progress"}
```

**结论**：**复现** 3/4 失败、`code=SCRIPT_COMPILE_ERROR`、
`message='动态代码编译失败：Another execution is already in progress'`。
`CompilationErrors` 是**空数组**（`actual.errors: []`）—— 旧判据 `j.Success === false && Array.isArray(j.CompilationErrors)`
被空数组满足，故把「并发被拒」报成「编译失败」（码 + 文案双误导）。同时 `hint` 指向「改 C# 片段」，
**方向完全错**；`retryable:false` 也不对（被拒是瞬时的）。

### P2 —— 上游**成功**载荷的原始 JSON：`CompilationErrors` 恒存在、且**没有 `Message` 字段**

**命令原文**：

```js
// docs/m5-probes-raw/probe-one.js（6 个独立进程并行跑，复现 CLI 的进程级并发）
const { call } = require('C:/Users/<用户>/.pi/agent/git/<内部 git 服务器>/pi/pi-unity/lib/uloop.js');
const P = 'C:/Users/<用户>/pi-unity-official-f3c1';
const id = process.argv[2];
const r = await call('execute-dynamic-code',
  ['--code', `System.Threading.Thread.Sleep(3000); return "${id}";`], { projectPath: P });
console.log(JSON.stringify(r.json));
```

```bash
for id in a b c d e f; do node probe-one.js "$id" & done; wait
```

**原始输出（6/6 同形；`one-a.txt` 逐字）**：

```
=== a truncated=false ===
{"Result":"a","Logs":["Execution completed successfully"],"CompilationErrors":[],"ErrorMessage":"","Error":"","UpdatedCode":null,"DiagnosticsSummary":null,"Diagnostics":[],"EditorPlaying":false,"Success":true}
```

`one-b.txt` … `one-f.txt` 除 `Result` 分别为 `"b"`…`"f"` 外**逐字同形**。

**结论**：**成功**载荷里 `CompilationErrors` **恒存在**（是 `[]`），且载荷里**没有 `Message` 字段**、
只有 `ErrorMessage`（成功时是空串 `""`）。这两点是两个 bug 的事实根：
① 判据必须要求 **非空**数组（P1）；
② `fromUloop` 的 message 兜底必须**再读 `ErrorMessage`**（否则 payload 类命令的报文不可读）。

### P3 —— 6 / 10 条并行 `unity scene tree` → 6 条全 ok；10 条中 **2 条 `UNITY_SERVER_BUSY`**

**命令原文**：

```bash
# 6 并行那轮（证据 read-*.json，未落盘；跑法同下，只把 10 换成 6）
for i in $(seq 1 10); do unity scene tree > "t10-$i.json" & done; wait
```

**原始输出（`t10-4.json` 逐字 —— 失败那份）**：

```json
{
  "ok": false,
  "verified": false,
  "code": "UNITY_SERVER_BUSY",
  "message": "'get-hierarchy' was not executed because Unity is busy running 'execute-dynamic-code' (running for 1s). uloop is single-flight by design; never run uloop commands in parallel. The CLI already retried for up to 10 seconds, so wait for 'execute-dynamic-code' to complete and run the command again.",
  "intent": null,
  "actual": {
    "Code": -32603,
    "Data": {
      "isPaused": false,
      "isPlaying": false,
      "message": "Unity is busy running 'execute-dynamic-code'. Retry 'get-hierarchy' after the running tool completes.",
      "requestedToolName": "get-hierarchy",
      "runningToolElapsedSeconds": 1,
      "runningToolName": "execute-dynamic-code",
      "secondsSinceLastMainThreadTick": 1.7428553,
      "type": "server_busy"
    },
    "EditorActivity": {
      "secondsSinceLastMainThreadTick": 1.7428553
    },
    "Message": "Unity is busy running 'execute-dynamic-code'. Retry 'get-hierarchy' after the running tool completes."
  },
  "hint": [
    "Wait for the running Unity command to complete.",
    "Retry the command after Unity reports it is no longer busy."
  ],
  "phase": "dispatch",
  "retryable": true
}
```

`t10-5.json` 与 `t10-4.json` 同形（仅 `secondsSinceLastMainThreadTick` 为 `1.7486799`）。
其余 8 份（`t10-1/2/3/6/7/8/9/10.json`）是正常成功的 `scene tree` 信封
（`ok:true`、`actual.sceneName:"SampleScene"`、`actual.nodeCount:3`、`hint:[]`）。

**结论**：**复现** 10 条里 2 条 `UNITY_SERVER_BUSY`（`retryable:true`、`phase:'dispatch'`）；
6 条并行那轮**全 ok**。注意 `UNITY_SERVER_BUSY` 只在**被拒**时出现（8 条成功），是概率性的。

### P4 —— **确定性**触发：长 `exec` 占住单飞槽 + 2s 后发只读 → 稳定 `UNITY_SERVER_BUSY`

**命令原文**：

```bash
unity exec --code 'System.Threading.Thread.Sleep(25000); return "holder";' &
sleep 2
unity scene tree
```

**原始输出（`victim2.json` 逐字）**：

```json
{
  "ok": false,
  "verified": false,
  "code": "UNITY_SERVER_BUSY",
  "message": "'get-hierarchy' was not executed because Unity is busy running 'execute-dynamic-code' (running for 12s). uloop is single-flight by design; never run uloop commands in parallel. The CLI already retried for up to 10 seconds, so wait for 'execute-dynamic-code' to complete and run the command again.",
  "intent": null,
  "actual": {
    "Code": -32603,
    "Data": {
      "isPaused": false,
      "isPlaying": false,
      "message": "Unity is busy running 'execute-dynamic-code'. Retry 'get-hierarchy' after the running tool completes.",
      "requestedToolName": "get-hierarchy",
      "runningToolElapsedSeconds": 12,
      "runningToolName": "execute-dynamic-code",
      "secondsSinceLastMainThreadTick": 12.0320602,
      "type": "server_busy"
    },
    "EditorActivity": {
      "secondsSinceLastMainThreadTick": 12.0320602
    },
    "Message": "Unity is busy running 'execute-dynamic-code'. Retry 'get-hierarchy' after the running tool completes."
  },
  "hint": [
    "Wait for the running Unity command to complete.",
    "Retry the command after Unity reports it is no longer busy.",
    "Run a light command such as `uloop get-logs --max-count 1` to check whether Unity is still responsive before treating this as a freeze."
  ],
  "phase": "dispatch",
  "retryable": true
}
```

**结论**：**稳定复现** `UNITY_SERVER_BUSY`。信封 message **逐字**含
「**uloop is single-flight by design; never run uloop commands in parallel**」与
「The CLI already retried for up to **10 seconds**」，`phase:'dispatch'`、`retryable:true`。
→ 这就是「并发被拒」的**唯一真实成因**：uloop 是**单飞**的，不是编译错、不是传输截断。

### P5 —— 3 轮 × 4 并行 `exec` 重跑；6 进程并行重跑 → **未复现**

**命令原文**：同 P1（4 并行 `exec`）与 P2（6 进程并行），连跑 3 轮。

**原始输出**：全部成功（`ok:true`），未再出现 `SCRIPT_COMPILE_ERROR`——
`d5-*.json`（1 轮 4 并行，`actual.result` 为 `"1"`…）与
`e1-*.json` / `e2-*.json` / `e3-*.json`（3 轮 4 并行，`actual.result` 形如 `"11"`/`"21"`/`"31"`）、
`r1-*.json`…`r6-*.json`（6 进程并行轮次）**均为成功信封**。
（这些文件未在 `docs/m5-probes-raw/` 内，仍在 `C:/Users/<用户>/piu-probe/`。）

**结论**：**未复现** —— 并发被拒是**概率性**的；P1 是真实样本，不能靠重跑把它稳定重现
（要稳定重现请用 **P4 的确定性脚本**）。

### P6 —— 并行只读 → `ULOOP_TRUNCATED` → **未复现**

**命令原文**：同 P3（6 条 / 10 条并行 `unity scene tree`）。

**原始输出**：**没有任何** `ULOOP_TRUNCATED` —— 6 并行那轮全 ok；10 并行那轮的失败是
`UNITY_SERVER_BUSY`（`t10-4.json` / `t10-5.json`）。落盘证据里**没有**一条
`code:"ULOOP_TRUNCATED"` 的只读信封。

**结论**：**未复现**。U46 原文「并行**只读** → `ULOOP_TRUNCATED`」**不成立** ——
真实码是 **`UNITY_SERVER_BUSY`**（P3/P4）。**不要**据此给截断路径加并发 hint。

---

## 3. P4 的确定性复现脚本（可直接粘跑）

```bash
#!/usr/bin/env bash
# 前提：编辑器已打开 C:/Users/<用户>/pi-unity-official-f3c1；
#       PI_UNITY_ULOOP_BIN=C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe
set -u

# 1) 起一条长耗时 exec，占住 uloop 的「单飞」执行槽（25 秒远超下面的 2 秒）
unity exec --code 'System.Threading.Thread.Sleep(25000); return "holder";' &
HOLDER=$!

# 2) 2 秒后发一条只读命令 —— 必被单飞拒绝
sleep 2
unity scene tree

# 3) 收尾：等长 exec 自己跑完（别 kill，避免留下半截执行）
wait "$HOLDER"
echo "--- 预期：第 2 步落 code=UNITY_SERVER_BUSY / retryable:true / phase:dispatch"
echo "--- 同形信封见 docs/m5-probes-raw/victim2.json"
```

> 只读复现不写任何工程文件；`victim2.json` 那轮另有一条 `uloop get-logs --max-count 1` 的 hint
> （官方给的旁观探活建议），实际未执行，不影响结论。

## 4. 三条硬事实

1. **根因是「uloop 单飞」**：`UNITY_SERVER_BUSY` 的信封自带
   `message`「…uloop is single-flight by design; never run uloop commands in parallel.
   The CLI already retried for up to 10 seconds…」、`phase:'dispatch'`、`retryable:true`（`victim2.json` 逐字）。
2. **`SCRIPT_COMPILE_ERROR` 那条是误判**：R352 判据 `j.Success === false && Array.isArray(j.CompilationErrors)`
   被**恒存在的空数组**满足 → 并发被拒被报成「编译失败」（码 + 文案双误导）。
3. **U46 的「并行只读 → `ULOOP_TRUNCATED`」不成立**（P6）→ 需订正；
   且**不要**给截断路径加并发 hint（无证据，且 `lib/uloop.js` 契约禁止重解析 stdout/stderr）。

## 5. U46 订正

> **订正（2026-09-20 真机，见本文件 P3/P4/P6）**：
>
> `docs/PITFALLS.md` 的 U46 原文称「并行**只读**命令（如 `unity scene tree`）→ `ULOOP_TRUNCATED`」——
> **未复现**：6 条与 10 条并行 `scene tree` 均**未出现** `ULOOP_TRUNCATED`
> （10 条里出现的失败是 `UNITY_SERVER_BUSY`，见 U49 与本文件 P3）。
>
> 真实码是 **`UNITY_SERVER_BUSY`**（信封逐字含「uloop is single-flight by design」、
> `phase:'dispatch'`、`retryable:true`）。
>
> `ULOOP_TRUNCATED` 只在 dispatcher **真的起不来**时出现（例如 `PI_UNITY_ULOOP_BIN` / `PI_UNITY_ULOOP_CMD`
> 路径写错），**与并发无关** —— **不要**据此给截断路径加并发 hint。

## 6. 上游依据（在 vendor 目录、**不在本仓库内**）

以下上游源码是「单飞」与 `server_busy` 的**权威依据**，位于**本机 vendor 副本**，
**不在本仓库内**（无 vendored 源码，`git ls-files` 里没有）：

- `C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp/Editor/Application/UnityCliLoopToolBusyException.cs`
- `C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp/Editor/Infrastructure/Api/JsonRpcErrorTypes.cs:11`
  （`ServerBusy = "server_busy"`）
- `C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp/Editor/ToolContracts/UnityCliLoopConstants.cs:130`

→ 引用这些结论时**必须**标注「上游 vendor（本机、仓库外）」，
**不要**把它当成仓库内可追踪的源码（复现需自行 vendor uloop dispatcher）。

## 7. 未落盘 / 未探测项（如实登记）

- **未落盘**：P3 的 6 并行那轮（`read-*.json`）、P5 的重跑（`d5-*` / `e1-*`…`e3-*` / `r1-*`…`r6-*`）——
  仍在 `C:/Users/<用户>/piu-probe/`；本报告按其结论引用，文件未纳入 `docs/m5-probes-raw/`。
- **未探测**：`UNITY_SERVER_BUSY` 的**重试上限/退避**行为、`uloop` 除 `execute-dynamic-code` 外
  还有哪些工具会占住单飞槽、以及 10 秒重试窗口在高负载下的实际成功率。
- **未探测**：`ULOOP_TRUNCATED` 的真正触发面（本报告只证「并发**不是**它的成因」，
  未去构造 dispatcher 路径错来正面复现它）。

---

## 8. 批次 A 真机验收

以下为**逐条实测结果**（2026-09-20，真机；数字为原始观测值，**未改写**）。

```
① 并发（确定性触发：25s holder + 2s 后发只读）
   code=UNITY_SERVER_BUSY | retryable=true | phase=dispatch
   hint[3] = 「另一条 `unity` 命令正在执行 —— uloop 是**单飞**（single-flight）的…请**串行重试**本命令…」→ 含「单飞」= true

② 编译错可读性（临时在 unity-scripts/node-inspect.cs 末尾注入 `public static int __M5_BREAK( { return 1; }`，测完已还原，sha256 前后一致、git diff 空）
   code=SCRIPT_COMPILE_ERROR | phase=compile
   message = 「C# 脚本编译失败：node-inspect.cs:145 CS0106: The modifier 'public' is not valid for this item」
   actual.script = node-inspect.cs
   hint 含「写入是否生效未知」= false（R435 的写路径修复生效）
   hint[1] = 「修正 C:\Users\...\pi-unity\unity-scripts\node-inspect.cs 后重试…」（完整路径）

③ pixels 新选项（真机，官方版 2022.3.62f3c1，898x593 截图）
   --count-color/--centroid/--bbox '#E0FFFF' → count=309
     centroid = {x:304.12297734627833, y:292.65695792880257}（bbox 中心是 311/295.5 → 二者不同）
     bbox     = {x:0, y:287, width:622, height:17}
   两张同内容截图 --diff → changed=0 | maxChannelDistance=0 | match=null（不抢 --expect 判定权）
   带外造「已知改动 3 像素」的图 → unity --diff 报 changed=3 | ratio=3/532514（逐位一致）| maxChannelDistance=187
   尺寸不等（898x593 vs 4x4）→ code=DIFF_SIZE_MISMATCH | exit=2
   非 PNG 作为 --diff → code=BAD_PNG | exit=1
```

---

## 9. 批次 B-2 真机探测（`--world-size` 边界 + UI `Image` 假绿，2026-09-20）

**环境**：Unity 官方中国版 2022.3.62f3c1（`C:/Users/<用户>/pi-unity-official-f3c1`）；资产 `Assets/Art/hero-blind.png`（ppu=16，`sprite.bounds.size={0.375,0.25}`）。命令全串行（uloop 单飞）。原始证据 `docs/m5-probes-raw/b2-*`（含 `b2-REPORT.md`）。

### 9.1 `SpriteRenderer.drawMode=Sliced/Tiled` 下 `sprite assign --world-size`

| 观测 | 结果 | 证据 |
|---|---|---|
| Simple + `--world-size 2,1` | `verified:true`；`sr.size == sprite.bounds == {0.375,0.25}`、`sr.bounds={2,1}` | `b2-a4-assign-simple.json` |
| 切 Sliced（不动 `sr.size`） | 仍 `verified:true`（两侧恰好不叉） | `b2-a6-assign-sliced.json` |
| `sr.size=5,5`（Sliced） | **`verified:false`、退出码 1**；mismatches `worldSize.x 2→26.6667`、`.y 1→20` | `b2-a7c-assign-sliced-size5.json` |
| Tiled（`sr.size=5,5`） | 与 Sliced 完全相同 | `b2-a8c-assign-tiled-size5.json` |

**机制**：Sliced/Tiled 下 `sr.bounds.size = sr.size × lossyScale`（`5×5.3333=26.6667`、`5×4=20`），写侧用 `sp.bounds`。**这是诚实行为（不是假绿）→ 只文档化 + hint，不改代码**（PITFALLS **U52**）。

### 9.2 `Tight`（backlog ④ 原文点名）

| 观测 | 结果 | 证据 |
|---|---|---|
| 基线 `spriteMeshType=FullRect` | `sprite.bounds={0.375,0.25}` | `b2t2-tight-01-baseline.json` |
| 设 `Tight` + Reimport | `sprite.bounds` **不变** `{0.375,0.25}` | `b2t2-tight-02-set-tight.json` |
| `Tight` 下 `--world-size 2,1` | **`verified:true`**（与 U34 预测一致） | `b2t2-tight-04-assign-tight.json` |
| 复原 `FullRect` | `spriteMeshType=FullRect`（`.meta` `spriteMeshType: 0`） | `b2t2-tight-05/06` |

### 9.3 UI `Image` 假绿（真 bug，已修 R481）

| 观测 | 结果 | 证据 |
|---|---|---|
| 节点只有 `UnityEngine.UI.Image`、无 SR | `sprite assign` **`verified:true`**，`actual.components` 多出 `SpriteRenderer`，事后 `Image.sprite` **仍 null** | `b2-b11-assign-ui.json`、`b2-b12-dump-ui-after.json` |
| UI 组件短名 `Image` | `node create --components '["Image"]'` → `COMPONENT_TYPE_NOT_FOUND`（**要全名** `UnityEngine.UI.Image`） | `b2-b9-create-m5ui-image.json` / `b2-b9-try-create-m5ui-fullname.json` |
| 修后（R481）真机 | M5UI → `code:UI_IMAGE_PRESENT`（退出码 1）、事后无 SpriteRenderer；M5Plain → `verified:true` | `b2t1-*` |

**未探测（如实）**：图集（SpriteAtlas）—— 需团结 `com.unity.2d.sprite`（官方工程 `Packages/manifest.json` 无 `com.unity.2d.*`）。

**清理**：三次探测均读回确认 M5 残留 = 0（`b2-c13-cleanup-tree.json` / `b2t1-08-scene-tree-after-cleanup.json` / `b2t2-tight-08-cleanup-tree.json`）。

---

## 10. 批次 C-A：官方版复测（U28/U31–U33/U36/U39–U41 + 新坑 U54，2026-09-20）

**环境**：Unity 官方中国版 **2022.3.62f3c1**（`C:/Users/<用户>/pi-unity-official-f3c1`，3D 模板，默认透视相机）。
原始证据 `docs/m5-probes-raw/ca-*`（含 `ca-REPORT.md`）。全部串行（uloop 单飞）；临时资产/节点已删并读回零污染（`ca-40b-cleanup.json` 三资产 `LoadAssetAtPath==null`、`ca-50-tree-final.json` `nodeCount=3`）。

| 坑 | 官方版结论 | 证据 |
|---|---|---|
| U28 | `ti.spriteMeshType` → **CS1061** 逐字复现；settings 往返成功 | `ca-04-u28-direct` · `ca-04b-u28-settings` |
| U31 | 默认 **`textureType=Default`**、`alphaIsTransparency=false`、`npotScale=ToNearest`（24→**32**）、`spriteImportMode=None`、`mipmapEnabled=true`、`wrapMode=Repeat`；`filterMode=Bilinear`/`Compressed`/`PPU=100`/`Tight`/`extrude=1`/`isReadable=false` 同 | `ca-01-defaults` |
| U32 | 24×16 + `maxTextureSize=8` → **8×5**（前置 `npotScale=None`） | `ca-02-maxsize` |
| U33 | `alphaIsTransparency=true` → 透明像素 `(0,0,0,0)`→`(1,0,0,0)`；默认 `false` 则保持 | `ca-03b-alpha` |
| U36 | `--capture-mode window` → **1101×540**（请求 960×640）；PlayMode 默认 rendering **因 Game 视图未开失败**（`ULOOP_ERROR`） | `ca-13-shot-window` · `ca-12-shot-auto` |
| U39 | 三规则成立（**需已 `scene save`**）；未覆盖 scale 跟随①、覆盖 scale 保留②、根 pos 保留③ | `ca-49-after-force` · `ca-31-root-dump` |
| U40 | 源节点 `prefabInstanceStatus=NotAPrefab`；实例初始位姿=资产生成位姿 | `ca-49-after-force` · `ca-22-inst-a` |
| U41 | `--to CaDifferent.prefab` → 根名 **`CaDifferent`** | `ca-21-prefab-create` |
| **U54（新）** | **场景未保存**时 `prefab create --force` 把实例改名成资产根名、`localPos`/`localScale` 覆盖全丢；**已 `scene save`** 则完整保留 | 对比 `ca-31-root-dump`（未存） vs `ca-49-after-force`（已存） |

---

## 11. 批次 C-B 真机验收（`prefab apply`/`revert`，2026-09-20）

**环境**：官方 2022.3.62f3c1（`C:/Users/<用户>/pi-unity-official-f3c1`）。全部串行。原始证据 `docs/m5-probes-raw/cb3-*`；侦察见 `docs/m5-probes-raw/cb-REPORT.md`。

| 步 | 结果 | 证据 |
|---|---|---|
| `prefab apply --path CbI`（首次，编译新 `.cs`） | **`verified:true`** | `cb3-08-apply1.json` |
| `prefab apply --path CbI`（no-op，已无覆盖） | **`verified:true`**（D-CB-5） | `cb3-09-apply-noop.json` |
| `prefab revert --path CbI`（先覆盖 scale=9,9） | **`verified:true`**，实例 scale 回 `3,3` | `cb3-11-revert.json` · `cb3-12-inspect.json` |
| `prefab apply --path CbSrc`（普通节点） | `NOT_PREFAB_INSTANCE`（退出码 1） | `cb3-13-noninst.json` |
| `prefab apply --path CbI/CbChild`（非实例根） | `NOT_PREFAB_INSTANCE`（退出码 1） | `cb3-14-nonroot.json` |

**清理**：`cb3-99-cleanup.json`（CbP 资产 `LoadAssetAtPath==null`）+ `cb3-99-tree.json`（`nodeCount=3`）。

---

## 12. 批次 C-C：图集半 + ⑫ 扩展可行性（2026-09-21）

**环境**：官方 2022.3.62f3c1。原始证据 `docs/m5-probes-raw/cc-*` + `cc-REPORT.md`。

| 问题 | 结论 | 证据 |
|---|---|---|
| 图集类型是否需装包 | **不需要**（`SpriteAtlas`/`SpriteAtlasAsset`/`SpriteAtlasUtility` 在核心程序集；工程 `com.unity.2d.*` 计数 0） | `cc-01-atlas-type.json` |
| 打包后 `--world-size` | **仍 `verified:true`**；`node inspect` 的 `sprite.assetPath` 仍是原 PNG（不是 `.spriteatlas`） | `cc-21`/`cc-22`/`cc-23` |
| `Multiple` | 仍硬失败 `AMBIGUOUS_SPRITE`（退出码 1，`count:2`） | `cc-31`/`cc-32` |
| 图集创建 API | `SpriteAtlasAsset` **非** ScriptableObject；反射 `Internal_Create` + `CreateAsset`/`AddObjectToAsset` + `PackAtlases` 可造出，但**刷控制台断言 → 不产品化** | `cc-07`…`cc-13b` |
| ⑫ `/unity-*` 扩展 | 最小形态可行：`pi-extension/index.ts` + `package.json` 的 `pi.extensions` + `pi.registerCommand` + `pi.exec`，**零第三方依赖** | `cc-REPORT.md` §5 |

**清理**：`cc-98-*`/`cc-99-*`（图集资产 `LoadAssetAtPath==null`、`nodeCount=3`、hero `.meta` 与探针前逐字节相同）。
**已知副作用**：探针按指令 `scene save`，改写了官方**测试**工程 `SampleScene.unity`（非用户真实工程）。

---

## 13. 批次 C-D：Input System 真实输入注入（⑧，2026-09-21）

**环境**：官方 2022.3.62f3c1 + `com.unity.inputsystem` 1.8.2 + `activeInputHandler: 2`（Both）。原始证据 `docs/m5-probes-raw/cd-*` + `cd-REPORT.md`。

| 步 | 结果 | 证据 |
|---|---|---|
| `play key --action KeyDown --key W` | `ok:true`、`pressEdgeObserved:true` | `cd-03-keydown.json` |
| 读 `Keyboard.current.wKey.isPressed` | **`true`** | `cd-04-read.json` |
| `KeyUp` → 再读 | **`false`** | `cd-05`/`cd-06` |
| `play mouse --action Scroll --scroll-y 1.5` | `ok:true`、「Scroll injected: (0.0, 1.5)」（**非** `INPUT_SYSTEM_UNAVAILABLE`） | `cd-10`/`cd-15` |
| 读 `Mouse.current.scroll` | `0`（**正常**：pointer scroll 是逐帧 delta） | `cd-16` |

**结论**：⑧ 关闭。环境改动（测试工程加 Input System + `activeInputHandler=2`）保留并附 `.bak` 备份（要复原用 `.bak` 覆盖后重开编辑器）。

