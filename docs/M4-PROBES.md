# M4 真机探测报告 —— 两个「必须先回答」的未知

> **性质**：M4 的**事实基础**（证据报告，不是设计文档）。本报告回答 `docs/M4-SPIKE.md` 留在「未探测 / 存疑」节
> 与 `docs/HANDOFF.md` §4.3 的两条**必须先回答**的未知，外加 code-reviewer 在任务 4 提出的 R416（跨任务风险）。
> **交付物 = 可复核的事实**：每条结论后面都跟原始证据（文件名 / 命令行 / 读出值）。**本任务不写产品代码、不改任何源码或测试。**
> **环境**：团结引擎 `2022.3.62t9` + uloop dispatcher 3.4.0 连接；探针项目 `S0Project`
> （`C:/Users/<用户>/pi-unity-spike/S0Project`，可写坏）＋ 其**克隆** `CloneProbe`（模拟全新 clone）。
> 宿主仓库 `pi-unity`（分支 `m4-art`，BASE `52ed3fc`）。**用户真实工程 `<真实工程>` 全程未被触碰。**
> **来源**：任务简报 `.superpowers/sdd/2026-09-20-pi-unity-m4-implementation/task-5-brief.md`。
> **纪律**：凡**未探测**一律写「未探测」，**不许**用推理补事实；凡属**推论**（不是实测）一律显式标注「推论」。
> **原始证据目录**：`.superpowers/sdd/2026-09-20-pi-unity-m4-exec/probes/`（gitignored；下文每条结论都给出文件名）。
> 文末有**证据索引**。
>
> **修复轮 1（R420–R428）**：首版（提交 `caf758f`）被两位审查者审过 —— **核心事实成立**，但有 **1 条 Critical**
> （R420：R416 的落盘 YAML 引文引错了文件）与 5 条 Important（R421–R426）+ 1 条 Minor（R428）。
> 本轮**只重取证据、只改本文件**（不改任何源码/测试）。逐条改动见文末「修复轮 1 变更对照（R420–R428）」；
> 新增小节：**§②-8**（`--force` 三条规则）、**§②-9**（可见性判据模板，不可裁剪）、**§②-10**（契约黑洞 R427）、
> **附录：探针源码**（全文，供只拿到 git 的人复现）。

---

## 0. 环境、单座席与门检记录

**单座席约束**（本机同一时刻只允许一个 Unity/团结编辑器）：探测①需要「覆盖复制项目（排除 `Library/`）→ 打开克隆 → 读回」，
`Library/` 有文件锁，**必须先关掉 S0Project 编辑器**。每次切换前后都做 `tasklist` 门检。

| 时刻（约） | 动作 | 编辑器 PID | `tasklist \| grep -iE "^Tuanjie.exe\|^Unity.exe"` 门检 |
|---|---|---|---|
| 12:06 | 进入本任务（门检） | **47076**（S0Project） | 非空：`Tuanjie.exe 47076` |
| 12:06–12:07 | 探测 ①-1：import / create / assign / scene save / 记录 id | 47076 | 非空（同一编辑器） |
| 12:07 | `taskkill /PID 47076`（优雅终止）→ 等 20 s | — | **空 ✅**；另核 `Temp/UnityLockfile` 已消失 |
| 12:07 | `robocopy … /XD Library …` → `CloneProbe` | — | 空 |
| 12:07–12:09 | 拉起编辑器**打开克隆** | **52824**（CloneProbe） | 非空：`Tuanjie.exe 52824` |
| 12:09–12:10 | 探测 ①-2：clone 侧 `doctor` / `scene open` / `inspect` / `exec` / A2 边界 | 52824 | 非空 |
| 12:10 | `taskkill /PID 52824` → 等 20 s | — | **空 ✅**（单座席切换完成） |
| 12:10–12:11 | 拉起编辑器**切回 S0Project** | **27580**（S0Project） | 非空：`Tuanjie.exe 27580` |
| 12:12–12:15 | 探测 ② / R416 | 27580 | 非空 |
| 12:16 | 清理 + 定稿 | **27580（留着不关，交给下一个任务）** | 非空 |
| **12:24–12:33（修复轮 1）** | R420 重取现场 / R427 两条契约黑洞（都在 S0Project） | 27580 | 非空 |
| 12:29 | `taskkill /PID 27580` → 20 s → 门检空 | — | **空 ✅** |
| 12:29–12:32 | R426：`rm -rf CloneProbe/Library` + `.meta` 移出 → 拉起编辑器**打开克隆** | **52136**（CloneProbe） | 非空 |
| 12:32 | `taskkill /PID 52136` → 20 s → 门检空 | — | **空 ✅** |
| 12:31–12:36 | 拉起编辑器**切回 S0Project** → 清理 R420/R427 探针现场 + 终态复核 | **53992**（S0Project） | 非空 |

> 修复轮 1 的门检/切换细节见「修复轮 1 变更对照」§R426 与文末证据索引。

- **`Library/` 未被删除**：`S0Project/Library/` 全程存在（探测①用的是**克隆**）。
  证据：`ls S0Project/Library` 在关掉编辑器后仍列出 `AnnotationManager / APIUpdater / ArtifactDB …`（见 §问题① ①-2）。
  **修复轮 1 依然如此**（R426 删的是**克隆**的 `Library/`，见 §①-5 A2-3）。
- 每次关编辑器后都确认 `Temp/UnityLockfile` 消失再拉下一个（避免「第二次打开同一项目时报锁」）。
- **最终编辑器状态（修复轮 1 结束时）**：`Tuanjie.exe` **PID 53992**，打开着 `S0Project`，`doctor` 五项全 `pass`
  → 下一个任务可直接用（`r420-final-doctor.json`、`r420-final-tree.json`）。
  （首版结束时的 27580 已被 R426 的单座席切换关掉，不再存在。）

---

## 问题① 全新 clone / 删 `Library/` 之后，资产引用会不会断？

### ①-1 方法（做了什么）

1. 在**活着的** S0Project 编辑器上造最小现场：导入一张引用方 PNG → 建节点 → 挂**资产** sprite → `scene save` 到探针自有场景。
2. 记录**两块 id**（`AssetPathToGUID` 的 32-hex、`.meta` 的 56 字符 base64）与**场景 YAML 里的 32-hex 引用字面量**。
3. **关掉编辑器**（单座席 + `Library/` 锁），用 `robocopy /E /XD Library Temp obj Logs .uloop .vs` 做**克隆**（= 全新 clone 的等价物）。
4. **打开克隆**（不碰 S0Project 的 `Library/`），等首次导入 + 44 个 asmdef 重编译完成（以 `doctor` 的 `editor-connection=pass` 为判据）。
5. 显式 `scene open` 探针场景（**必须**：克隆里没有 `Library/`，编辑器打开的是默认空场景，
   不先 open 会让 `node inspect` 报 `NOT_FOUND`，被误读成「引用断了」）→ 读回 `node inspect` 的整个 `sprite` 子对象 + 两块 id + png 字节。
6. 额外（边界）：在克隆里把 `.meta` 移出项目 → 触发导入 → 读回，**再**把 `.meta` 放回 → 再读回，看哪一部分是 `.meta` 携带的。

### ①-2 原始证据

**①-1 造现场（S0Project，编辑器 PID 47076）**

| # | 命令 | 退出码 | 关键原始输出（文件） |
|---|---|---|---|
| 1 | `unity asset import --project-path $P --from …/fixtures/hero-gdi.png --to Assets/M4Probe/refprobe.png --remove-bg auto --trim --ppu 16 --json` | **0** | `actual.asset.guid=a7a041ff0b369274f8b3e3a767833d76`、`width×height=12×8`、`pixelsPerUnit=16`、`texFormat=RGB24`、`hasSprite=true`；`actual.file.bytes=77`、`sha256=982a503f275f8d3d6766f5beb1c0a3442256650aaaf5e27cfb1b8b986d030c29`；`art.removeBg.keyColor=#00FF00/tolerance=40/changed=true`、`art.trimmed=left10,top8,right21,bottom15`（`probeA-import.json`） |
| 2 | `unity node create --project-path $P --name RefProbe --components '["SpriteRenderer"]' --json` | **0** | `ok:true verified:true`（`probeA-create.json`） |
| 3 | `unity sprite assign --project-path $P --path RefProbe --asset Assets/M4Probe/refprobe.png --json` | **0** | `verified:true`；读回 `sprite={present:true, spriteName:"refprobe", assetPath:"Assets/M4Probe/refprobe.png", ppu:16, worldSize:{0.75,0.5}}`（`probeA-assign.json`） |
| 4 | `unity scene save --project-path $P --path Assets/M4Probe/ProbeScene.scene --json` | **0** | `intent:{saved:true,sceneName:"ProbeScene"}`、`actual:{saved:true,sceneName:"ProbeScene",mtimeBefore:"0001-01-01T00:00:00.0000000",mtimeAfter:"2026-09-20T04:06:46.4879078Z"}`、`verified:true`（`probeA-save.json`；**mtimeAfter 带小数秒，原文是 7 位 `4879078`**）。场景扩展名：`ls Assets/Scenes/` → **`SampleScene.scene`（团结用 `.scene`）**，故探针场景用 `.scene` |

- **没碰 `Assets/Scenes/SampleScene.scene`**（M3 验收过的场景）：探针场景是自有的 `Assets/M4Probe/ProbeScene.scene`。

**①-2 克隆前的 id 与引用字面量**

| 项 | 值 | 证据文件 |
|---|---|---|
| 32-hex 引用 guid（`AssetPathToGUID`）+ Sprite 可载入 | `guid=a7a041ff0b369274f8b3e3a767833d76; spriteOk=True` | `probeA-ids-before.json` |
| `.meta` 的 base64 guid | `guid: Xn1OtS6sBS3hcAAenPA+Mzfj69Yt+/7eJqEQhHOwpg9K/q7E7Rf3cCM=` | `probeA-meta-guid-before.txt` |
| 场景 YAML 里的 32-hex 引用字面量（去重） | `0000000000000000e000000000000000`（内置）、`0000000000000000f000000000000000`（内置）、**`a7a041ff0b369274f8b3e3a767833d76`** | `probeA-scene-guids-before.txt` |
| png 字节（前 16 hex of sha256） | `982a503f275f8d3d` | `probeA-png-sha.txt` |

**①-3 关编辑器 + 克隆**

```text
taskkill /PID 47076            → 成功；20 s 后门检空；Temp/UnityLockfile 已消失
rm -rf CloneProbe              （克隆目录已存在，先清掉再拷）
robocopy S0Project CloneProbe /E /XD Library Temp obj Logs .uloop .vs /NFL /NDL /NJH /NJS
                               → robocopy-exit=1（= 「有文件被复制」，不是错误）
ls CloneProbe/Library          → 不存在 ✅「Library 已排除（= 全新 clone）」
```
- ⚠️ 踩坑记录：**在 Git Bash 里直接写 `/E` 会被 MSYS 路径转换吃成 `E:/`**，robocopy 报「无效参数 #3」并以 16 退出
  （克隆根本没建）。必须 `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" robocopy …`。第一次失败的输出与随后的成功输出都留在终端记录里。
- 克隆内 `Assets/M4Probe/` 有 4 个文件：`ProbeScene.scene`、`ProbeScene.scene.meta`、`refprobe.png`、`refprobe.png.meta`；
  克隆内 `.meta` 的 base64 与 png 字节**与源一致**（`grep "^guid:" CloneProbe/…/refprobe.png.meta` →
  `Xn1OtS6sBS3hcAAenPA+Mzfj69Yt+/7eJqEQhHOwpg9K/q7E7Rf3cCM=`；png sha256 全量 = `982a503f…d030c29`）。

**①-4 克隆侧读回（编辑器 PID 52824）**

| # | 命令 | 退出码 | 关键原始输出（文件） |
|---|---|---|---|
| 1 | `unity doctor --project-path $CP --json` | **0** | `editor-connection=pass`（`uloop 3.4.0 已连接`）→ 首次导入 + 编译已完成，可以开始探测（`probeA-clone-doctor-1.json`） |
| 2 | `unity scene open --project-path $CP --path Assets/M4Probe/ProbeScene.scene --json` | **0** | `intent/actual:{opened:true,sceneName:"ProbeScene"}`、`verified:true`（`probeA-clone-open.json`） |
| 3 | `unity node inspect --project-path $CP --path RefProbe --json` | **0** | 见下表（`probeA-clone-inspect.json`） |
| 4 | `unity exec … 'var g=AssetDatabase.AssetPathToGUID("Assets/M4Probe/refprobe.png"); var sp=AssetDatabase.LoadAssetAtPath<Sprite>(…); return "guid="+g+"; spriteOk="+(sp!=null);'` | **0** | `guid=a7a041ff0b369274f8b3e3a767833d76; spriteOk=True`（`probeA-ids-after.json`） |
| 5 | `grep -o "guid: [0-9a-f]\{32\}" $CP/Assets/M4Probe/ProbeScene.scene \| sort -u` + `diff` | 0 | `diff` **无输出** → 「✅ 场景 YAML 里的 guid 字面量没变」（`probeA-clone-scene-guids-after.txt`） |
| 6 | `grep -m1 "^guid:" $CP/Assets/M4Probe/refprobe.png.meta` | 0 | `Xn1OtS6sBS3hcAAenPA+Mzfj69Yt+/7eJqEQhHOwpg9K/q7E7Rf3cCM=`（**与克隆前逐字节相同**）（`probeA-meta-guid-after.txt`） |
| 7 | clone png sha256 | 0 | `982a503f275f8d3d6766f5beb1c0a3442256650aaaf5e27cfb1b8b986d030c29`（`probeA-clone-png-sha.txt`） |

克隆里 `node inspect RefProbe` 的**完整 `sprite` 子对象**（原始 JSON，`probeA-clone-inspect.json` 的 `actual`）：

```json
{"name":"RefProbe","active":true,"path":"RefProbe",
 "position":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1},
 "sprite":{"present":true,"color":{"r":255,"g":255,"b":255,"a":255},"sortingOrder":0,
           "sortingLayerName":"Default","spriteName":"refprobe",
           "assetPath":"Assets/M4Probe/refprobe.png","ppu":16,"worldSize":{"x":0.75,"y":0.5}},
 "components":["Transform","SpriteRenderer"]}
```

### ①-3 必答项（逐行填满，每条跟证据来源）

| # | 必答项 | 克隆前 | 克隆后（无 `Library/`） | 是否变 | 证据来源 |
|---|---|---|---|---|---|
| 1 | **32-hex 引用 guid**（`AssetDatabase.AssetPathToGUID`） | `a7a041ff0b369274f8b3e3a767833d76` | `a7a041ff0b369274f8b3e3a767833d76` | **不变** | `probeA-ids-before.json` vs `probeA-ids-after.json` |
| 2 | **`.meta` 的 56 字符 base64 guid** | `Xn1OtS6sBS3hcAAenPA+Mzfj69Yt+/7eJqEQhHOwpg9K/q7E7Rf3cCM=` | 同左（逐字节相同） | **不变** | `probeA-meta-guid-before.txt` vs `probeA-meta-guid-after.txt` |
| 3 | **场景 YAML 里的 32-hex 引用字面量** | `a7a041ff…`（+2 个内置 guid） | 同左（`diff` 空） | **不变** | `probeA-scene-guids-before.txt` vs `probeA-clone-scene-guids-after.txt` |
| 4 | **克隆后 `node inspect` 的完整 `sprite` 子对象** | `present:true / assetPath:"Assets/M4Probe/refprobe.png" / ppu:16 / worldSize:{0.75,0.5}` | **逐字段相同**（JSON 见上） | **不变** | `probeA-clone-inspect.json`（对照 `probeA-assign.json`） |
| 5 | **S0Project 的 `Library/` 全程未被删除** | — | `S0Project/Library/` 仍在（`AnnotationManager / APIUpdater / ArtifactDB / …`） | **未删** | §0 表；探测用的是 `CloneProbe`；`robocopy /XD Library` 的输出 + `ls CloneProbe/Library → 不存在`。**修复轮 1 依旧**：R426 删的是**克隆**的 `Library/`（A2-3），S0Project 的未动 |
| 附 | 引用方 PNG 的字节 | sha256 `982a503f…d030c29` | 同左（全量 sha256 相等） | 不变 | `probeA-png-sha.txt` / `probeA-clone-png-sha.txt` |

### ①-4 结论

> **结论①：引用可随仓库 / 压缩包迁移。全新 clone（完全没有 `Library/`）之后，
> 32-hex 引用 guid、`.meta` base64 guid、场景 YAML 里的 guid 字面量、`node inspect` 的 `sprite` 子对象**全部不变**，
> `AssetDatabase.LoadAssetAtPath<Sprite>` 仍能载入该 PNG。**
>
> 命中简报三种可能里的**第一种**（「引用可随仓库迁移」），不是「断了」，也不是「介于两者之间」。

- 这条**推翻**了 `M4-SPIKE` Q4 的**风险猜测**（「删 `Library/` 或全新 clone 时 PNG 的 sprite 引用**很可能**被重新指派而断开」）——
  Q4 当时明确标注「未直接验证」。**现在验证了：不会断。**（`docs/M4-SPIKE.md` Q4 的「风险」段应视为已被本条覆盖。）
- 事实层面 `M4-SPIKE` NEW-3 仍然成立（两套 id 独立、手改 `.meta` base64 不影响 32-hex）。
- ⚠️ **本小节首版有一句话已被修复轮 1 推翻，已改写**（原话：「那个 32-hex 在本机是**可由相对路径稳定复现**的」）：
  详见 **§①-5 的 A2-3** —— 32-hex 之所以在首版的 A2-1 里被「重建为原值」，是**克隆里 `Library/` 已经建立过**
  （`Library/SourceAssetDB` 记得 path→guid）；**把 `Library/` 删掉再丢 `.meta`，guid 会变成另一个值，引用直接断**。
  「两套 id 独立」**同时也不等于**「引用不可迁移」：只要 `.meta` 在，引用就随仓库走。

### ①-5 边界（额外子探测 A2：`.meta` 缺失会怎样）

简报要求「介于两者之间时如实写清**边界**（做了什么就活、没做什么就死）」。为把边界钉死，在**克隆**里追加了一组子探测：

| 步骤 | 做了什么 | 32-hex guid | `.meta` base64 | `node inspect` 的 `sprite` | 证据 |
|---|---|---|---|---|---|
| A2-1 | 把 `refprobe.png.meta` **移出项目**（备份到项目外）→ `unity compile`（plain compile 自带 refresh）→ 引擎**自动生成了新的 `.meta`** | **仍是** `a7a041ff0b369274f8b3e3a767833d76` | **仍是** `Xn1OtS6sBS3hcAAenPA+Mzfj69Yt+/7eJqEQhHOwpg9K/q7E7Rf3cCM=`（与原来**逐字节相同**） | `present:true / assetPath:"Assets/M4Probe/refprobe.png"` **但 `ppu:100`、`worldSize:{0.12,0.08}`** | `probeA2-refresh-nometa.json`、`probeA2-ids-nometa.json`、`probeA2-meta-guid-regenerated.txt`、`probeA2-inspect-nometa.json` |
| A2-2 | 把 `.meta` **放回**（`cp` 回去）→ `unity compile` → 读回 | `a7a041ff…` | `Xn1OtS6s…` | `present:true / assetPath:"…/refprobe.png" / ppu:16 / worldSize:{0.75,0.5}`（**恢复原值**） | `probeA2-refresh-metarestored.json`、`probeA2-ids-metarestored.json`、`probeA2-inspect-metarestored.json` |
| **A2-3（修复轮 1 补测，R426）** | **把克隆的 `Library/` 整个删掉 + 把 `refprobe.png.meta` 移出项目** → 重开克隆（首次导入 + 重编译）→ `exec` 读 guid + `scene open` + `node inspect` | **变了**：`a7a041ff0b369274f8b3e3a767833d76` → **`fd04e0928cc9d2647919c3e15d2a9f0c`** | **变了**：`Xn1OtS6sBS3hcAAenPA+Mzfj69Yt+/7eJqEQhHOwpg9K/q7E7Rf3cCM=` → **`WS4fsX+tWnk5UXRUsdh9bMwMQPNge5xR1Nh1Xg91P2T0B53/cEUEpME=`** | **断**：`present:true`、**`spriteName:null / assetPath:null / ppu:null / worldSize:null`**（SpriteRenderer 还在，但引用的 sprite 丢了） | `probeA2-nolib-ids.json`、`r426-meta-guid-regenerated-nolib.txt`、`r426-meta-sha-regenerated-nolib.txt`、`probeA2-nolib-inspect.json`、`r426-nolib-scene-guids.txt`、`r426-nolib-scene-open.json`、`r426-clone-doctor.json` |
| **A2-4（收尾回滚）** | 把原 `.meta` 移回 → `AssetDatabase.ImportAsset(ForceUpdate)` → 读回 → `scene open`（`--force`）→ `node inspect` | `a7a041ff…`（**恢复**） | `Xn1OtS6s…`（**恢复**；`r426-meta-sha-restored.txt` = `83c64d3a…` 与探测前的 `r426-meta-sha-before.txt` **完全相同**） | **恢复**：`present:true / assetPath:"Assets/M4Probe/refprobe.png" / ppu:16 / worldSize:{0.75,0.5}` | `r426-metarestored-ids.json`、`r426-meta-guid-restored.txt`、`r426-meta-sha-restored.txt`、`r426-metarestored-inspect.json` |

**边界结论（事实，修复轮 1 已按 R426 重写）**：

| 做了什么 | 引用是否活 | 导入设置是否活 | 证据 |
|---|---|---|---|
| 资产 + `.meta` + **无** `Library/`（全新 clone） | **活**（结论①） | **活** | `probeA-clone-inspect.json` |
| 资产 + `.meta` + **有** `Library/` | 活 | 活 | 常态 |
| 资产 + **无** `.meta` + **有** `Library/` | **活**（guid 仍是原值） | **丢**（`ppu 16 → 100`、世界尺寸 `0.75×0.5 → 0.12×0.08`） | A2-1 / A2-2 |
| 资产 + **无** `.meta` + **无** `Library/` | ❌ **断**（`assetPath:null`） | ❌ 丢 | **A2-3** |

- **丢 `.meta` 本身不会断引用 —— 前提是那个项目的 `Library/` 曾经建立过。**
  A2-1（首版）观察到「删 `.meta` 后 guid 被原样重建」，那是**观察**，当时**没有区分**下面两种机制：
  ①「按路径 + 内容重算」；②「`Library/SourceAssetDB` 里的 path→guid 记忆」。
- **A2-3 把两种机制区分开了：是 ②，不是 ①。** 同机、同一份 PNG、同一相对路径，只要**同时**拿掉 `.meta` 与 `Library/`，
  重建出的 `.meta` guid 就是**另一个值**（`fd04e092…` / `WS4fsX+t…`），场景里的旧引用 **`assetPath` 直接变 `null`**。
  → 因此「guid 跟路径 + 内容强相关」这句**推论被否证**；可以确定的只有：**`.meta` 里写着的 guid 才是引用的唯一依据。**
- **丢 `.meta` 仍会丢导入设置**（与首版一致）：`ppu` 从 `16` 掉回默认 `100`、世界尺寸 `0.75×0.5 → 0.12×0.08`
  （= 像素画在该工程默认导入设置下**直接变糊、尺寸错**，与 `M4-SPIKE` NEW-4 一致）。
- **`.meta` 放回后两者都恢复**（A2-4：guid / base64 / `ppu` / `worldSize` 全部回原值，`.meta` 文件 sha256 也逐字节回原值）
  → **`.meta` 携带的是「引用 id + 导入设置」两样东西，不是只有导入设置。**

### ①-6 对 M4 / SKILL 的影响

- SKILL **可以**教「资产与其引用方（场景/Prefab）一起提交即可交付」——本机实证支持（结论①）。
- `v0.7.0` 的 E2E 判据③（含「克隆后仍渲染」）**不需要降级**：`.meta` 在，引用就不会断。
- **交付纪律（修复轮 1 后变成硬规则）**：**`.meta` 必须与美术资产同批提交**。两条实测理由：
  ① 丢 `.meta` 会丢导入设置（`ppu 16 → 100`、`0.75×0.5 → 0.12×0.08`，A2-1）；
  ② **`Library/` 不在交付物里**（全新 clone 没有它），所以「有 `Library/` 能靠 path→guid 记忆把引用捡回来」这条退路**不可依赖**——
  收件人一旦拿到的压缩包里只有 png 没有 `.meta`，引用就**断**（A2-3 是硬证据）。这条比「引用会不会断」更容易被用户踩到。
- `docs/M4-SPIKE.md` Q4 末段的「**风险**：…引用很可能被重新指派而断开」应改为「**已由 `docs/M4-PROBES.md` 问题① 实测否定**，
  但条件同样是 **`.meta` 与资产同批提交**」。

---

## 问题② Prefab 覆盖的幂等性 + 实例化后的画面可见性（+ R416）

### ②-1 方法

- `②-1/②-2`：在 S0Project（编辑器 PID 27580）用 `unity exec --code-file` 手搓
  `PrefabUtility.SaveAsPrefabAsset`（任务 6 的 `prefab` 命令还不存在），**第一次**存 `Assets/M4Probe/PfProbe.prefab`
  → 改源节点 position/scale → **第二次存到同一路径（覆盖）** → 读回**资产内容**（不只是文件 stat）。
- `②-3`：`PrefabUtility.InstantiatePrefab` 实例化 → 读回引用 / PPU / 世界尺寸；
  再用 **PlayMode + `shot --capture-mode rendering` + `pixels --count-color '#FF2E88'`** 做**画面可见性**判据，
  并配**负对照**（关掉实例）与**几何核对**（bbox 与「世界坐标 × 每单位像素」对账）。
- `②-4`（额外）：造一个「旧实例」，再覆盖 Prefab，看旧实例跟不跟随。
- `R416`：`unity asset import` + `node create` + `sprite assign` + `unity exec` 手搓 Prefab，
  然后在**Prefab 实例节点**上用 CLI 的 `sprite assign` 改属性 → `scene save` → **切到别的场景再切回来（真重载）** → 再 `node inspect`。
- 探针脚本（`.superpowers/…/probes/`，gitignored，源码即简报给的那四份，另加 ②-4 的三份）：`probe-prefab-1.cs`、`probe-prefab-2.cs`、
  `probe-prefab-read.cs`、`probe-prefab-3-instantiate.cs`、`probe-prefab-4a.cs`、`probe-prefab-4b.cs`、`probe-prefab-4c.cs`。
  **全文已贴在文末「附录：探针源码」（R421）** —— 只拿到 git 里这份报告的人也能复现。
- `R427`（修复轮 1）：`exec --code-file probes/probe-r427.cs`（同样见附录 A.9）。

### ②-2 原始证据 —— 覆盖同一路径

| # | 命令 | 退出码 | 关键原始输出（文件） |
|---|---|---|---|
| 0 | 先导图：`unity asset import … --to Assets/M4Probe/hero.png --remove-bg auto --trim --ppu 16` | **0** | `guid=5cdaae87035fd6e4cbacf6f46027c2bf`、`12×8`、`ppu=16`、`RGB24`（`probeB-import.json`） |
| 1 | `exec --code-file probe-prefab-1.cs`（建 `PfProbe`：sprite=hero.png、pos(1,2)、scale(2,2) → 存 Prefab） | **0** | `saved=True; guid=1125f9c7f1e30bc4aae32e4ee2b9b48a`（`probeB-save1.json`） |
| 2 | `exec --code-file probe-prefab-read.cs`（**读回资产内容**） | **0** | `{"name":"PfProbe","position":"1,2","scale":"2,2","spriteAssetPath":"Assets/M4Probe/hero.png","guid":"1125f9c7f1e30bc4aae32e4ee2b9b48a"}`（`probeB-read1.json`） |
| 3 | 文件 stat + `grep guid` | 0 | `size 2436`、`mtime 1789877529401.5798`；`probeB-prefab-guids-1.txt` = {`0000000000000000f000000000000000`(内置), `5cdaae87035fd6e4cbacf6f46027c2bf`(=**hero.png**)} |
| 4 | `exec --code-file probe-prefab-2.cs`（**改源节点为 pos(-3,-3)、scale(4,4)** → **覆盖**同一路径） | **0** | `saved=True; guid=1125f9c7f1e30bc4aae32e4ee2b9b48a`（**guid 未变**）（`probeB-save2.json`） |
| 5 | `exec --code-file probe-prefab-read.cs` | **0** | `{"name":"PfProbe","position":"-3,-3","scale":"4,4","spriteAssetPath":"Assets/M4Probe/hero.png","guid":"1125f9c7f1e30bc4aae32e4ee2b9b48a"}`（**内容真的变了**）（`probeB-read2.json`） |
| 6 | 文件 stat + `grep guid` + `diff` | 0 | `size 2438`、`mtime 1789877534036.4214`（都变了）；`diff probeB-prefab-guids-1.txt probeB-prefab-guids-2.txt` **无输出** → 「✅ 覆盖后引用 guid 没变」（`probeB-prefab-guids-2.txt`） |
| 7 | 第三次覆盖（`probe-prefab-4b.cs`，pos(0,0)/scale(6,6)）后再 `grep` + `diff` | **0** | guid 仍 `1125f9c7…`；`probeB-prefab-guids-3.txt` 与 1 相同（`probeB-stale-4b.json`） |

### ②-3 原始证据 —— 实例化 + 画面可见性

| # | 命令 | 退出码 | 关键原始输出（文件） |
|---|---|---|---|
| 1 | `exec --code-file probe-prefab-3-instantiate.cs` | **0** | `{"instanceName":"PfProbeInstance","spriteAssetPath":"Assets/M4Probe/hero.png","ppu":16.0,"worldSize":"3,2","isPrefabInstance":true,"correspondingSource":true,"position":"-3,-3"}`（`probeB-instantiate.json`） |
| 2 | `unity play view --width 960 --height 640 --json` | **0** | `previous/current 960×640`、`changed:false`（已是该尺寸）（`probeB-playview.json`） |
| 3 | `unity shot --out …`（**默认 = window 模式**） | **0** | `892×355`、`captureMode:"window"`、`windowName:"游戏"`、`fileSizeBytes:12401`（`probeB-shot.json`） |
| 4 | `unity pixels --file <shot> --count-color '#FF2E88' --tolerance 16 --json` | **0** | `count=7000, ratio=0.0221`（`probeB-pixels.json`） |
| 5 | **控制实验（设计有缺陷，见下面 ⚠️）**：关实例 → 再试关 `RefProbe`（**该次 exec `ok:false`**）→ 恢复，各截一次 window 图 | 0 | 4 张 `游戏_*.png` md5 全为 `bffdf4b029c370199c452f3211c9a741`、`count` 恒为 `7000`；bbox 两块：**6600 px = 100×66**（= 源节点 `PfProbe`，3×2 世界单位 @ **≈33.3 px/单位**）+ **400 px = 25×16**（= `RefProbe`）→ 这 4 张是**合法地相同**（见 ⚠️①），**不能**用来分离实例归属 | `probeB-ctl-hideinst.json`、`probeB-ctl-hideref.json`（**`ok:false`**）、`probeB-ctl-restore.json`、`probeB-pixels-{noinstance,instonly,both}.json`、`probeB-window-bbox.json`、`shots/游戏_*.png` |
| 5b | **补做「window 模式会不会刷新」的判据**：清理完成后（`SampleScene` 里已无任何 sprite）再截一张 window 图 | **0** | `count=0`；md5 `d9c6f2a7ab8b8693f31b2270ad23f3d0` **≠** 之前的 `bffdf4b0…` → **window 模式确实会重新截图，不是陈旧帧** | `probeB-window-fresh-test.json`、`probeB-window-fresh-test-pixels.json`、`m4probe-shots/游戏_20260920_121805_874.png` |
| 6 | 改走 M2 的判据：`play start` → `shot --capture-mode rendering` | **0**/**0** | `play start`：`isPlaying:true, blockedByUnsavedChanges:false, compileErrorCount:0`（`probeB-attr-playstart.json`）；shot：**960×640**、`captureMode:"rendering"`（`probeB-render-both.json`） |
| 7 | `pixels --count-color '#FF2E88' --tolerance 16` + 带外 bbox 分析 | **0** | `count=26112`；bbox 两块：**24576 px = 192×128 @ (192,448)**（= 源节点 `PfProbe`，pos(-3,-3) scale 4 → 3×2 世界单位 ×64 px/单位）+ **1536 px = 48×32 @ (456,304)**（= `RefProbe`，0.75×0.5 ×64）（`probeB-render-both-pixels.json`、`probeB-attr-both-bbox.json`、`probe-bbox.js`） |
| 8 | **归属实验**：只留实例（源节点关掉）+ 把实例挪到 (3,2)、scale 2 → `play start` → 渲染截图 → `pixels` + bbox | **0** | `count=7680`；bbox：**6144 px = 96×64 @ (624,160)**（实例：0.75×0.5×2 = 1.5×1.0 世界单位 → 96×64）+ 1536（`RefProbe`）。**几何核对**：blob 中心 = (624+48, 160+32) = **(672,192)** = `(480 + 3×64, 320 − 2×64)` ✔（`probeB-attr-moved-pixels.json`、`probeB-attr-moved-bbox.json`） |
| 9 | **负对照**：把实例 `SetActive(false)`（源节点也关着）→ 渲染截图 → `pixels` + bbox | **0** | `count=1536`，bbox 只剩 **48×32 @ (456,304)**（= `RefProbe`）→ 实例那 6144 px **确实来自实例本身**（`probeB-attr-none-pixels.json`、`probeB-attr-none-bbox.json`） |
| 10 | `play stop` | **0** | `isPlaying:false`（`probeB-play-stop-final.json`） |

> ⚠️ **我第一版控制实验设计有缺陷，并据此下过一个错结论（如实记下，免得下一个人重踩）**：
> ① 我想靠「开关实例可见性」分离归属，但**源节点 `PfProbe` 与实例在同一位置、同一缩放** →
> 开关实例**本来就不会改变画面**；再加上「关 `RefProbe`」那一步 `exec` **失败了**
> （对**非激活**对象调 `GameObject.Find` 返回 `null` → NullReference，见 `probeB-ctl-hideref.json` 的 `ok:false`），
> 所以那 4 张 window 图的可见内容从头到尾**没变过** → 「4 张字节相同」是**合法结果**。
> **我一度据此断言「window 模式给陈旧帧」——这是错的**：清理后补测（上表第 5b 行）证明 window 模式会刷新。
> ② 真正能分离归属的做法是 **把实例挪到别处**（第 8 行）＋ **负对照**（第 9 行），
> 判据走 `play start` + `shot --capture-mode rendering`（与 M2 E2E 一致；`rendering/GameView` **要求 PlayMode**）。

> 📌 **本报告里所有 `count=N` 的读法**（含上表与 §②-4）都是 **`actual.count.count`**（`actual.count` 是对象
> `{color, count, ratio, tolerance}`，**不是**数字）——详见 §②-9 第 3 条与疑虑 ④。

### ②-4 结论表（逐行有原始证据）

| 问题 | 期望（写进任务 6 契约的假设） | **真机结果** | 证据 |
|---|---|---|---|
| 覆盖同一路径：资产 guid 是否不变 | **不变**（= 「同名覆盖=更新」，美术返工安全） | **✅ 不变**：三次覆盖（pos/scale 变两次）guid 恒为 `1125f9c7f1e30bc4aae32e4ee2b9b48a` | `probeB-save1.json` / `probeB-save2.json` / `probeB-stale-4b.json` + `probeB-prefab-guids-{1,2,3}.txt`（`diff` 空） |
| 覆盖同一路径：**资产内容**是否真的更新 | **更新**（读回 position/scale 变成 -3,-3 / 4,4） | **✅ 更新**：读回 `position "1,2"→"-3,-3"`、`scale "2,2"→"4,4"`；文件 `size 2436→2438`、`mtime` 变化 | `probeB-read1.json` vs `probeB-read2.json`（+ stat 输出） |
| 覆盖后 Prefab **资产内部**的 PNG 引用 guid 是否变 | 指向不变 | **✅ 不变**：`probeB-prefab-guids-{1,2,3}.txt` 三次覆盖 `diff` 均**无输出**（引用恒为 `5cdaae87…` = hero.png） | `probeB-prefab-guids-{1,2,3}.txt` |
| 覆盖后场景里**已有实例与 Prefab 的连接**是否还在（`m_SourcePrefab`） | 连接不断 | **✅ 不断**：旧实例 `PfOldInst` 的 `localScale` 在覆盖后**从 4,4 跟到了 6,6**（= 它仍在从资产读值）→ 连接有效 | `probeB-stale-4a.json` → `probeB-stale-4c.json` |
| 实例化的对象：`spriteAssetPath` / `ppu` / `worldSize` | 与源节点一致 | **✅ 一致**：`"Assets/M4Probe/hero.png"` / `16.0` / `"3,2"`（源节点 scale 4 × 0.75×0.5）；`isPrefabInstance:true`、`correspondingSource:true` | `probeB-instantiate.json` |
| 实例化后 `pixels --count-color` 能否数到图 | **count > 0** | **✅ 能，且可精确对账**：实例单独可见时 `#FF2E88` = **6144 px = 96×64**，blob 中心 (672,192) = 世界 (3,2) × 64 px/单位；关掉实例后该颜色只剩 1536 px（`RefProbe`） | `probeB-attr-moved-pixels.json` / `probeB-attr-moved-bbox.json` / `probeB-attr-none-bbox.json` |
| 覆盖时旧实例（已 Instantiate 出来的）会不会跟着变 | 未探测就写「未探测」 | **部分跟随（已实测，见下）**：**scale 跟随**（4,4 → 6,6）、**根节点 position 不跟随**（-3,-3 保持） | `probeB-stale-4a.json`（旧实例 `-3,-3 / 4,4`）→ `probeB-stale-4c.json`（旧实例 `-3,-3 / 6,6`，资产 `0,0 / 6,6`，新实例 `0,0 / 6,6`） |
| **（R416）Prefab 实例**上的 `position`/`scale`/`sprite` 改动能否活过 `scene save` + `scene open` | 在（否则需要补 `RecordPrefabInstancePropertyModifications`） | **✅ 在，不需要补任何 API**（见 §②-6）：主判据是**两次独立 `node inspect` + 中间真切换过场景**（`probeB2-inspect2-before` vs `…-after-reload`，逐字段相同）；落盘 YAML 只作**补充**（修复轮 1 重取：`r416-P2.after-save.scene` 第 319 行命中 `propertyPath: m_Sprite`，见 §②-6b） | `probeB2-inspect2-before.json` vs `probeB2-inspect2-after-reload.json`（+ `r416-P2.after-save.scene` 补充） |
| Prefab 变体 / 嵌套 Prefab / 断开连接 | **本轮不探测**（M4 不做） | **修复轮 1 部分探测（R427①）**：实例源存出的是 **Variant**（见 §②-10）；变体本身的编辑/回写/断开连接**仍未探测** | `r427-result.json` |

### ②-5 额外子探测（旧实例是否跟随覆盖）—— 事实与边界

```text
4a（存前造旧实例）: {"prefabAssetPosScale":"-3,-3 / 4,4","oldInstPosScale":"-3,-3 / 4,4","prefabGuid":"1125f9c7…"}
4b（改源节点为 0,0 / 6,6 后第三次覆盖同一路径）: saved=True; guid=1125f9c7…（未变）
4c（覆盖后读回）: {"assetPosScale":"0,0 / 6,6",
                   "oldInstPosScale":"-3,-3 / 6,6",      ← scale 跟随了，position 没跟随
                   "prefabGuid":"1125f9c7…",
                   "newInstPosScale":"0,0 / 6,6",
                   "spriteAssetPath":"Assets/M4Probe/hero.png"}
```
- **事实**：覆盖 Prefab 资产后，**已存在于场景里的实例**的 `localScale` 会跟随新资产内容；**根节点 `position` 保持实例自己的值**。
- 这是 Unity Prefab 的既有语义（根节点的 transform 位置在实例上是「实例自己的值」），**不是**本项目的 bug；
  但它是 `prefab create --force` 契约必须写清的一条：**`--force` 不会把已有实例的根位置拉回资产的值**。
- **未探测**：旧实例上**已被 override 的属性**（例如手工改过 scale 的实例）在覆盖后是否也跟随（U3）；非根子节点的行为。
- **修复轮 1（R425）把这一节归纳成了三条规则**（含「根 `localPosition` 恒被记为 override」这条硬规则与落盘原文）→ 见 **§②-8**。

### ②-6 R416：Prefab **实例**上的改动能否活过 `scene save` + `scene open`？

**为什么要答**：全仓 `.cs` 里**没有** `PrefabUtility.RecordPrefabInstancePropertyModifications` / `EditorUtility.SetDirty`，
而 `unity-scripts/scene-save.cs` 只调 `EditorSceneManager.SaveScene`。若 Unity 不自动登记 prefab 实例的 override，
则在**实例节点**上跑 `sprite assign` 会 `verified:true` 但 `scene save` + 重开后改动消失 —— 正好命中 M4 的卖点。

| # | 命令 | 退出码 | 关键原始输出（文件） |
|---|---|---|---|
| 1 | `asset import … --to Assets/M4Probe/pfinst.png` | **0** | `guid=0f86aabc44055f047a755014aa3ffd6f`（`probeB2-import.json`） |
| 2 | `node create --name PfSrc --components '["SpriteRenderer"]'` + `sprite assign --asset …/pfinst.png` | **0**/**0** | `worldSize:{0.75,0.5}`（`probeB2-create.json` / `probeB2-assign.json`） |
| 3 | `exec`（手搓）：`SaveAsPrefabAsset(PfSrc,"Assets/M4Probe/PfInst.prefab")` + `InstantiatePrefab` → `PfInst1`，pos(-2,-2) scale(3,3) | **0** | `saved=True; inst=True; isInstance=True`（`probeB2-instantiate.json`） |
| 4 | **在实例上**跑 CLI：`unity sprite assign --path PfInst1 --asset Assets/M4Probe/pfinst.png --world-size 1.6,1.2` | **0** | `verified:true`；读回 `worldSize:{1.60000014,1.2}` → 自动解出 `scale 2.13333344,2.4`（`probeB2-assign-inst.json`） |
| 5 | `node inspect --path PfInst1`（**BEFORE**） | **0** | `{p:{-2,-2,0}, s:{2.13333344,2.4,1}, sp:"Assets/M4Probe/pfinst.png", ws:{1.60000014,1.2}}`（`probeB2-inspect-before.json`） |
| 6 | `scene save --path Assets/M4Probe/ProbeScene.scene` → `scene open --path …ProbeScene.scene` → `node inspect`（同场景内 open） | **0** | BEFORE 与 AFTER **逐字段相同** → 「✅ 实例改动活过了 scene save/open」（`probeB2-save.json` / `probeB2-open.json` / `probeB2-inspect-after.json`） |
| 7 | **加强**：把实例的 sprite 换成**另一个**资产（`sprite assign --path PfInst1 --asset …/hero.png --world-size 1.6,1.2`）→ `scene save` | **0** | `verified:true`、`assetPath:"Assets/M4Probe/hero.png"`（`probeB2-assign-inst-hero.json`、`probeB2-save2.json`）—— 这样实例与源 Prefab **不一致**，才是真正的 override |
| 8 | **强制真重载**：`scene open Assets/Scenes/SampleScene.scene`（确认已离开：`scene tree` → `sceneName SampleScene / nodeCount 1 / 含 PfInst1: false`）→ `scene open …ProbeScene.scene` → `node inspect --path PfInst1`（**AFTER-RELOAD**） | **0** | `BEFORE {p:{-2,-2,0}, s:{2.13333344,2.4,1}, sp:"Assets/M4Probe/hero.png", ws:{1.60000014,1.2}}` / `AFTER-RELOAD` **完全相同** → 「✅ 实例覆盖活过真载」（`probeB2-open-sample2.json`、`probeB2-tree-sample2.json`、`probeB2-open-back2.json`、`probeB2-inspect2-before.json`、`probeB2-inspect2-after-reload.json`） |
| 9 | **补充证据（落盘 YAML，不是主判据）**：`scene save` 后立即 `cp` 出场景文件再读 `m_Modifications` | 0 | **修复轮 1 重取**（见 §②-6b）：`r416-P2.after-save.scene` 第 **319** 行有 `propertyPath: m_Sprite`；该实例文档的 `m_SourcePrefab` guid = `b8264f6099685e7458f99310e35a6b9a` | `r416-P2.after-save.scene`、`r416-modifications-sprite.txt`、`r416-save.json`（旧的 `probeB2-ProbeScene.scene.copy` **是在换 sprite 之前拷的，里面 0 命中**，已在 §②-6b 说明） |

> **R416 结论：`position` / `scale` / `sprite`（换成了另一个资产，真 override）在 Prefab 实例上都活过了
> `scene save` + 切场景 + 真重载。`unity-scripts/scene-save.cs` 只调 `EditorSceneManager.SaveScene`
> 是**够的** —— 覆盖清单是 Unity 自己在存盘时算出来写进 `m_Modifications` 的。
> **不需要**补 `RecordPrefabInstancePropertyModifications` / `EditorUtility.SetDirty`。**
>
> **本条结论的证据等级（R420 改写）**：**「两次独立的 `node inspect`
> （`probeB2-inspect2-before.json` → `probeB2-inspect2-after-reload.json`）＋ 中间真切换过场景
> （先 `scene open SampleScene`，`scene tree` 确认已离开）」，落盘 YAML 只作**补充**。**
> 「同一次会话里的 `scene open` 读回」（表格第 6 行）**不足以**验证落盘，已在下面 R424 一条里写明。
>
> **R424（适用条件）**：本结论的观测方式是**真重载**（`scene save` → 切到别的场景 → 切回 → `node inspect`）；
> **同一会话里的读回（包括「同场景 `scene open`」）不足以验证落盘**，因为内存里的对象从来没被销毁过。
> 所以**任何验收（包括任务 6 的 E2E）都必须包含一次真重载**。
>
> 边界（**未探测**）：实例的**子节点**（非根）override、`m_Children` 顺序、Prefab 变体上的 override 未测。

### ②-6b R420：R416 落盘 YAML 证据的重取（修复轮 1）

**为什么重取**：首版（`caf758f`）在表格第 8 行引 `probeB2-ProbeScene.scene.copy`，声称里面 `m_Modifications` 含 `propertyPath: m_Sprite`。
审查者核出：**该文件里 `propertyPath: m_Sprite` 0 命中**（`grep` 退出码 1）；它里面只有 `m_Sprite:` 这个**源/实例自身**的 SpriteRenderer 字段，
不是任何 `m_Modifications` 条目。**引文错**，但结论未受影响 —— 重新取一份就清楚了。

**重取现场（S0Project，编辑器 PID 27580）**：

| # | 命令 | 退出码 | 关键输出 / 文件 |
|---|---|---|---|
| 0 | **两张不同的图**（R420 顺手记录）：`asset import --from …/fixtures/ovr-a.png --to Assets/M4Probe/r420a.png --ppu 16` / `--from …/fixtures/ovr-b.png --to Assets/M4Probe/r420b.png --ppu 16` | **0/0** | a：`guid=81457d8210c52394a8a85ab494047432`、`12×8`、`ppu 16`；b：`guid=8cff5d883eb65184796e41539f4ecde0`、`12×8`、`ppu 16`（内容不同：#0A0A14 底 + `#FF2E88` / `#3366FF`） | `r420-import-a.json`、`r420-import-b.json` |
| 1 | `node create --name R420Src --components '["SpriteRenderer"]'` + `sprite assign --asset …/r420a.png` | **0/0** | `verified:true`（`r420-create.json` / `r420-assign-src.json`） |
| 2 | `exec`（手搓）：`SaveAsPrefabAsset(R420Src,"Assets/M4Probe/R420.prefab")` + `InstantiatePrefab` → `R420Inst`，pos(2,-1) | **0** | `saved=True; inst=True; isInstance=True; instSprite=Assets/M4Probe/r420a.png; prefabGuid=b8264f6099685e7458f99310e35a6b9a`（`r420-instantiate.json`） |
| 3 | **在实例上**跑 CLI 换**另一张**图：`sprite assign --path R420Inst --asset …/r420b.png --world-size 0.75,0.5` | **0** | `verified:true`；读回 `assetPath:"Assets/M4Probe/r420b.png"`；世界尺寸**不变**（`0.75×0.5`）→ 这次唯一的 diff **就是 sprite 引用** | `r420-assign-inst.json` |
| 4 | `node inspect --path R420Inst`（**BEFORE**） | **0** | `{p:{2,-1,0}, s:{1,1,1}, sp:"Assets/M4Probe/r420b.png", ws:{0.75,0.5}, ppu:16}` | `r420-inspect-before.json` |
| 5 | `scene save --path Assets/M4Probe/P2.scene` → **立刻 `cp` 出场景文件** | **0** | `actual.saved:true, sceneName:"P2", mtimeAfter:"2026-09-20T04:27:30.4477894Z"`；拷出的文件 **10939 B** | `r416-save.json`、`r416-P2.after-save.scene` |
| 6 | `grep -n "propertyPath: m_Sprite" r416-P2.after-save.scene` | **0（命中 1 处）** | **`319:      propertyPath: m_Sprite`**；`objectReference: {fileID: 21300000, guid: 8cff5d883eb65184796e41539f4ecde0, type: 3}` = **r420b.png**；`m_SourcePrefab: {fileID: 100100000, guid: b8264f6099685e7458f99310e35a6b9a, type: 3}` = `R420.prefab` | `r416-modifications-sprite.txt` |
| 7 | **真重载**：`scene open Assets/Scenes/SampleScene.scene` → `scene tree` 确认离开（`sceneName SampleScene / nodeCount 1 / hasR420Inst false`）→ `scene open …P2.scene` → `node inspect --path R420Inst`（**AFTER-RELOAD**） | **0** | BEFORE == AFTER-RELOAD（逐字段：`sp:"Assets/M4Probe/r420b.png"`、`ws:{0.75,0.5}`、`ppu:16`）→ **MATCH** | `r420-open-sample.json`、`r420-tree-sample.json`、`r420-open-back.json`、`r416-inspect-after-reload.json` |

**落盘原文（`r416-P2.after-save.scene` 第 310–321 行，即 `m_Modifications` 里的第一条）**：

```yaml
--- !u!1001 &2120124887
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications:
    - target: {fileID: 747367968711747106, guid: b8264f6099685e7458f99310e35a6b9a, type: 3}
      propertyPath: m_Sprite
      value: 
      objectReference: {fileID: 21300000, guid: 8cff5d883eb65184796e41539f4ecde0, type: 3}
```

**为什么旧的 `probeB2-ProbeScene.scene.copy` 里没有这一条（已查清，不是矛盾）**：

| 文件 | mtime | 内容对应哪一步 |
|---|---|---|
| `probeB2-save.json`（第 6 行的 save） | 12:15:20.445 | 那时实例 sprite 还是 **`pfinst.png`（与源 Prefab 相同）** → **无 diff → Unity 正确地不记 `m_Sprite`** |
| `probeB2-ProbeScene.scene.copy` | 12:15:25.847 | **拷在这一步之后**：所以它有 `m_Name / m_LocalScale.x=2.1333334 / m_LocalScale.y=2.4 / m_LocalPosition.x=-2 / m_LocalPosition.y=-2`，但**确实没有** `propertyPath: m_Sprite` |
| `probeB2-assign-inst-hero.json` | 12:15:44.511 | 这时才把实例换成另一个资产（hero.png） |
| `probeB2-save2.json`（第 7 行的 save） | 12:15:49.223 | 这一步之后**没有**再 `cp` 场景 → 首版引错了文件 |

> **结论（R420）**：R416 的结论**成立**，只需把引文换成本次重取的 `r416-P2.after-save.scene`（命中行 **319**）。
> 旧的 `probeB2-ProbeScene.scene.copy` 是**步骤 6 之后、换 sprite 之前**的快照，**不能**用来证明 override 落盘；
> 这一点已在上面用 mtime 逐个对齐。**证据等级**按 §②-6 的口径：主判据是两次独立 `node inspect` + 真重载，YAML 只作补充。

### ②-7 对 M4 / SKILL 的影响

- **`--force` 覆盖 = 更新，不是重建**：guid 不变、内容真更新、引用该资产的实例仍指向同一 PNG → 可以放心把「同名覆盖」当默认语义，
  美术返工不需要重建引用（与 `M4-SPIKE` Q4 的「同名覆盖=更新」一致，且这次是**在 Prefab 上**验证的）。
- **画面判据建议固定为 `play start` + `shot --capture-mode rendering`**（与 M2 E2E 一致）。两条实测到的踩坑点：
  ① 默认 `shot` 是 **window 模式**：Game 窗口被缩小时它给出 **892×355**（而 `play view` 请求的是 960×640），
  每单位像素数随之变成 **≈33.3** 而不是 64 → **算几何必须按图的实际尺寸算，不能假设 960×640**；
  ② **`pixels` 的 count 变不变，本身不能证明「渲染了没有」**：源节点与实例重合时，开关实例不改变画面（本次实测）→
  归属必须靠「**把实例挪开 + 负对照**」。附带：操作**非激活**对象时 `GameObject.Find` 返回 `null`（脚本会抛异常），要改用 `FindObjectsOfType<Transform>(true)`。
- `instantiate` 之后**必须显式定位**：`PrefabUtility.InstantiatePrefab` 出来的实例**沿用资产根的位置/缩放**
  （本例 `position` 直接读回 `-3,-3`），所以「实例化到某处」这一步要显式写 pos，不能依赖默认。

### ②-8 `--force` / 覆盖后实例跟不跟随：三条规则（R425，修复轮 1 改写）

> 首版把这一节写成了「现象描述」（「scale 跟随、根 position 不跟随」）。控制者裁定：应当写成**规则**。
> 下面三条是从实测证据归纳的规则，**每条后面都跟原始数据文件**（规则 ② 有一半是推论，已在表内显式标注）。

| # | 规则 | 证据 |
|---|---|---|
| **①** | **未被 override 的属性 → 跟随资产**：实例上那个属性一旦等于资产值（从未被改过），资产更新后实例会跟着变 | 旧实例 `PfOldInst` 的 `m_Modifications` 里**没有** `m_LocalScale`（= 不是 override）→ 资产从 `scale 4,4` 改成 `6,6` 后，旧实例的 scale **从 4,4 跟到 6,6**（`probeB-stale-4a.json` → `probeB-stale-4c.json`） |
| **②** | **已被 override 的属性 → 保持实例自己的值**（资产更新后不回退） | **实测部分**：同一次探测里 `PfInst1` 的 `m_Modifications` **有** `m_LocalScale.x=2.1333334 / .y=2.4`（= 确实被记成 override；⚠️ 这份场景里 `PfProbeInstance` 的 `m_LocalScale` 是 `2/2`，别把两者混了），而同一份场景里 `PfOldInst` **没有** `m_LocalScale`（两者对照：`r425-pfoldinst-modifications.txt`）。⚠️「资产更新后不回退」这半句是 **Unity 既有语义 + 推论**，本轮**未单独实测**（见未探测项 U3） |
| **③** | **根 `localPosition` 恒被记为 override → 永不跟随**（即使实例从未动过、值恰与资产相同） | `PfOldInst` 的 `m_Modifications` **有** `m_LocalPosition.x=-3 / .y=-3 / .z=0`，但该实例创建时**没有**改过 position（`probe-prefab-4a.cs` 只设了 `name`）→ 说明根位置是 Unity **无条件**登记的 override；对应到 ②-5 的实测：覆盖后根 `position` 恒为 `-3,-3`（资产是 `0,0`） |

**现成证据原文**（`probeB2-ProbeScene.scene.copy`，`PfOldInst` 段，`target` guid `1125f9c7f1e30bc4aae32e4ee2b9b48a` = `PfProbe.prefab`）：

```yaml
    m_Modifications:
    - target: {fileID: 1580657944443769699, guid: 1125f9c7f1e30bc4aae32e4ee2b9b48a, type: 3}
      propertyPath: m_Name
      value: PfOldInst
      objectReference: {fileID: 0}
    - target: {fileID: 4991628400704582153, guid: 1125f9c7f1e30bc4aae32e4ee2b9b48a, type: 3}
      propertyPath: m_LocalPosition.x
      value: -3
      objectReference: {fileID: 0}
    - target: {fileID: 4991628400704582153, guid: 1125f9c7f1e30bc4aae32e4ee2b9b48a, type: 3}
      propertyPath: m_LocalPosition.y
      value: -3
      objectReference: {fileID: 0}
```

（该段在文件里的行号：`m_Name` = 509–512、`m_LocalPosition.x` = 513–516、`.y` = 517–520、`.z` = 521–524；
`grep -n "propertyPath: m_LocalPosition\|propertyPath: m_LocalScale"` 的完整输出见 `r425-pfoldinst-modifications.txt` ——
**`PfOldInst` 只命中 `m_LocalPosition` 三行，`m_LocalScale` 一行都没有**。）

> ⚠️ **那份证据文件的头注有误导**（本次顺手记清）：`r425-pfoldinst-modifications.txt` 是**全场景** grep，
> 不是「只 grep 了 `PfOldInst`」—— `PfOldInst` 只占其中的 **514/518/522** 三行；
> 380–396 属 **`PfInst1`**、449–465 属 **`PfProbeInstance`**（`probeB2-ProbeScene.scene.copy` 里逐段可核）。
> 引它时请按行号对实例，不要把头注当成「整份文件都是 `PfOldInst`」。

**任务 6 要写进 hint/文档的**：`prefab create --force` 的读回或 hint 至少要能解释上面三条（尤其是 ③：
「你把实例的 `position` 改回去也没用，它永远是 override」是用户最容易误解的地方）。**契约措辞仍留给任务 6。**

### ②-9 可见性判据模板（**不可裁剪**，R423）

> 这一节是给任务 6 的 E2E 与后续任何「实例化后能不能看到图」的验证用的**最小模板**。
> 它把首版踩过的坑（O1/O2）提炼成硬步骤：**每一条都不能省**。

1. **进 PlayMode**：`unity play start --project-path <P>`。
   渲染模式截图**需要 PlayMode**（`shot --capture-mode rendering` 读的是 GameView 的渲染结果）。
2. **截图（绝对目录）**：`unity shot --project-path <P> --capture-mode rendering --out <**绝对**目录> --json`。
   ⚠️ `--out` 必须**绝对路径**；不要重定向到 `/dev/null`（否则拿不到 `actual.path`）。
3. **读计数**：从 `pixels --file <Shot> --count-color '#FF2E88' --tolerance 16 --json` 的信封里读
   **`actual.count.count`** —— 数字在 `count.count`；`actual.count` 是个**对象**
   `{color, count, ratio, tolerance}`（`lib/pixels.js`；实测原始 JSON 见 `probeB-pixels.json`）。
   顺带：`--count-color` **命中 0 像素也退 0** → **不能看退出码**。
4. **归属**：把实例**挪到别处**（`unity node set --path <实例> --patch '{"position":{"x":3,"y":2,"z":0}}'`）
   或**关掉源节点**，让「实例那一块」成为画面里的**唯一变量**。
   ⚠️ 源节点与实例**重合**时，开关实例**不会改变画面**（首版实测 O2）→ 那一步不构成归属。
5. **负对照**：把实例 `SetActive(false)`（源节点也关着）后再截一次 → 计数应**恰好少掉实例那一块**
   （本报告：`7680 → 1536`，正好少掉 `6144`）。**没有负对照的一组成绩不叫证据。**
6. **几何对账**：`pixelsPerUnit = 图高 / (2 × orthographicSize)`（S0Project 实测 `orthographicSize=5`、
   `play view --width 960 --height 640` → `640 / 10 = 64 px/单位`；`r423-camera.json`），
   或直接用带外 bbox 分析算每个 blob 的宽高（`probe-bbox.js`）。本报告的现成例证：
   - `count=26112` = **24576（192×128）** + **1536（48×32）**；
   - `count=7680` = **6144（96×64）** + **1536（48×32）**；负对照 `count=1536`。
   三组都精确成立 —— 这才是硬判据。
7. **硬话**：**源节点与实例同时在画面里时的 `count>0` 不构成证据**（两张重合的图本来就该逐像素相同；
   首版就是在这里读出了一个错结论 O1/O2）。
8. ⚠️ **不要拿默认 `shot`（window 模式）的图做几何对账**：它的尺寸是窗口大小，**不是** `play view` 请求的尺寸 ——
   实测要 960×640、给回 **892×355**，每单位像素数因此变成 **≈33.3**（而不是 64）——
   **按图的实际尺寸套公式会对不上**（成因**未探测**，U6）。

### ②-10 两条「契约黑洞」（R427，修复轮 1 补测）

> 为什么要测：任务 6 的 `prefab create --from-node <节点路径>` 会接受**任意**节点路径。
> 两个没说清的情况：源节点是 **Prefab 实例**、源节点是**子节点**。命令：`exec --code-file $R/probe-r427.cs`（全文见附录 A.9）。

**① 源节点 = Prefab 实例（嵌套）**（源：`R420Inst`，它自己就是 `R420.prefab` 的实例）：

| 返回值（`r427-result.json` 的 `actual.result`） | 值 |
|---|---|
| `src1_isPrefabInstance` | `true` |
| `src1_pos` / `src1_localScale` | `2,-1` / `1,1` |
| `out1_saved` / `out1_guid` | `true` / `7e71962308a12a749a5536fd08a47a56` |
| `out1_rootName` | **`NestedOut`（= 文件名），不是 `R420Inst`** |
| `out1_pos` | `2,-1`（= 实例当时的位置） |
| `out1_isPrefabInstance` | **`true`（存出来的仍是一个实例）** |
| `out1_assetType` | **`Variant`（Prefab 变体）** |
| `out1_sprite` | `Assets/M4Probe/r420b.png`（= 实例上 override 的那个 sprite） |

落盘佐证：`r427-NestedOut.prefab.copy` 的**第一个文档就是 `PrefabInstance:`**，`m_SourcePrefab: {guid: b8264f6099685e7458f99310e35a6b9a}`（= `R420.prefab`）——
它**不是**一个普通 Prefab，而是一个**变体**。

**② 源节点 = 子节点**（父 `R427Parent` @ 世界 `(5,3)`；子 `R427Child` local `(1,1)` → 世界 `(6,4)`）：

| 返回值 | 值 |
|---|---|
| `src2_localPos` / `src2_worldPos` / `src2_parentName` | `1,1` / `6,4` / `R427Parent` |
| `out2_saved` / `out2_guid` | `true` / `b0833675e09de834dafb35c4be72ba1e` |
| `out2_rootName` | `ChildOut` |
| `out2_position` / `out2_localPosition` | **`1,1` / `1,1`（= 子节点的 local 值，不是世界值 `6,4`）** |
| `out2_parentName` | `null`（存出来的是根） |
| `out2_assetType` | `Regular`（普通 Prefab） |
| `out2_instPos`（实例化它） | **`1,1`**（≠ 子节点原来的世界位置 `6,4`） |

落盘佐证：`r427-ChildOut.prefab.copy` 第 29 行 `m_LocalPosition: {x: 1, y: 1, z: 0}`。

**对任务 6 的影响（事实 → 需控制者裁定）**：
- **①的实测结果不在简报列的「可接受」范围内**：简报说「若行为不可接受（例如子节点存出的根位置是世界坐标）→ 写不支持/报用法错」。
  实际行为是：**实例源会静默产出一个 `Variant`**（`PrefabUtility.GetPrefabAssetType == Variant`），根名改成文件名。
  这是个**副作用**（用户以为存的是普通 Prefab），**建议任务 6 把「源是 Prefab 实例」列为不支持并报用法错**，
  由控制者/任务 6 拍板；本报告**不自己发明换算或降级行为**。
- **②的实测结果是 local（不是世界）**：简报点名的不接受情形（世界坐标）**没有发生**；但它的后果同样硬：
  **子节点存出的 Prefab 根位置 = 子节点的 local 值**，实例化后坐标与原子节点在场景里的世界位置**不同**（本例 `1,1` vs `6,4`）。
  是否可接受（还是要报用法错）**留给任务 6 裁定**；本轮只交事实与两个落盘文件。

---

## 对任务 6 契约的直接影响（逐条）

> 每条都标注是**实测事实**还是**推论**（推论 = 由事实推出、尚未单独实测）。

1. **`prefab create <path>`（首次）**：`PrefabUtility.SaveAsPrefabAsset(node, path)` 可用，返回非空、guid 稳定可查（实测）。
2. **`prefab create --force`（覆盖同一路径）**：**资产 guid 不变、内容更新、引用该资产的实例仍指向同一 PNG**（实测，三次覆盖）。
   → 契约可以写「`--force` = 更新同名资产，不产生新 guid、不断引用」。
3. **`--force` 的语义边界（必须写进 hint/文档）**：覆盖**不会**把场景里已有实例的**根节点 position** 拉回资产的值
   （scale 会跟随）（实测）。这不是缺陷，但用户会误解 → 建议在 `--force` 的读回/hint 里说明。
4. **`prefab instantiate`**：`PrefabUtility.InstantiatePrefab` 毫秒级可用；读回应至少包含
   `spriteAssetPath` / `ppu` / `worldSize` / `isPrefabInstance` / `correspondingSource`（实测字段与值）。
   注意实例**沿用资产根 pos/scale**，所以 `--position` 之类参数若做，必须显式写（实测）。
5. **E2E 判据（画面可见性）**：**固定模板见 §②-9**（不可裁剪：`play start` → `shot --capture-mode rendering --out <绝对目录>` → 读 **`actual.count.count`** → 归属 → 负对照 → 几何对账）。
   实测要点：渲染模式图 `960×640`、`orthographicSize=5` → **64 px/单位**；⚠️ 默认 `shot` 是 **window 模式**，
   本次给出 `892×355`（Game 窗口小于 `play view` 请求的 960×640），每单位像素数 **≈33.3** →
   **不要拿 window 模式的图做几何对账**（U6）。数数字一律读 `actual.count.count`（`actual.count` 是对象，见 §②-9 第 3 条）。
6. **R416 不需要新任务**：实例上的 `sprite`/`scale`/`position` override 会随 `scene save` 落盘并活过**真重载**
   （实测：两次独立 `node inspect` + 中间切场景，`probeB2-inspect2-before` vs `…-after-reload`；落盘 YAML 只作补充 ——
   修复轮 1 重取的 `r416-P2.after-save.scene` 第 319 行命中 `propertyPath: m_Sprite`，见 §②-6b）。
   → 任务 6 **不**需要给 `sprite-assign.cs` / `node-set.cs` 加 `RecordPrefabInstancePropertyModifications`。
   **但验收必须包含一次真重载**（§R424）：同一会话里的读回不足以验证落盘。
   （**推论**：`node set --patch scale` 与 `sprite assign` 同属「改实例上的 Transform/SpriteRenderer 属性」，走同一条存盘路径；
   `scale` 已实测、`position` 已实测，`sprite` 已实测。若任务 6 想更保守，可在 E2E 里把这三种各跑一遍。）
7. **交付/协作（SKILL）**：资产 + 引用方 + **`.meta`** 同批提交。
   ✅ **`.meta` 在 → 引用随仓库/压缩包走**（结论①，全新 clone 实测）；
   ❌ **`.meta` 不在 + `Library/` 也不在（= 用户拿到压缩包的场景）→ 引用断**（A2-3 实测：`assetPath:null`）；
   ⚠️ `.meta` 不在但 `Library/` 曾建立过 → 引用活但**导入设置丢**（PPU 16 → 100）——**这条退路不可依赖**。
8. **`scene save --path` 的用法**：它是「把**当前活动场景**另存到 X」（Save As 语义），
   本次全程用探针自有场景 `Assets/M4Probe/ProbeScene.scene`，**没有**写 `Assets/Scenes/SampleScene.scene`；
   SampleScene 的 sha256 前 16 hex 在探测前后都是 `120d00be434b5573`、mtime 仍是 `1985-10-26T08:15:00Z`（实测，见 §清理结果）。
9. **R425（`--force` / 覆盖后的跟随语义）**：写成**三条规则**（§②-8）：① 未被 override 的属性**跟随**资产；
   ② 已被 override 的属性**保持实例自己的值**；③ **根 `localPosition` 恒被记为 override → 永不跟随**。
   证据：`PfOldInst` 的 `m_Modifications` **有** `m_LocalPosition`、**无** `m_LocalScale`（§②-8 有原文）。
   任务 6 的 `--force` 读回/hint 至少要能解释第 ③ 条（最容易被用户误读）。
10. **R427（源节点是实例 / 子节点）**：两条实测结果（§②-10）——
    ① 实例源会静默产出 **`Variant`（Prefab 变体）**，根名改为**文件名**；
    ② 子节点源存出的根位置是**子节点的 local 值**（不是世界坐标），实例化后世界位置与原来的不同。
    **建议任务 6 把这两种源都列为不支持并报用法错**；具体措辞由控制者/任务 6 裁定（本报告不自行发明换算）。
11. **可见性判据不可裁剪**（R423）：任务 6 的 E2E 必须按 §②-9 的 8 步模板，**尤其是第 4、5、7 步**
    （归属 + 负对照 + 「源与实例同时在场时的 `count>0` 不算证据」）——这三步是首版错结论的直接来源。

---

## 未探测项（显式登记，不许当已知）

| # | 未探测的事 | 为什么没测 / 影响 |
|---|---|---|
| U1 | 32-hex 引用 guid 在**别的机器**或**改了项目根路径 / 项目名**后是否仍稳定 | 本机单座席 + 只有一份团结安装；探测①只覆盖了「同机、同项目根、完全无 `Library/`」的 clone。跨机器协作仍建议「资产与引用方 + `.meta` 同批提交」 |
| U2 | 32-hex / base64 guid 的**生成算法** | `M4-SPIKE` Q4 已穷举否定若干变体；**修复轮 1 又否证了一条**：「跟路径 + 内容强相关」不成立（A2-3：同机同路径同内容，删掉 `.meta` + `Library/` 后重算出的 guid **不同**）。“有 `Library/` 时回到原值”只能解释为 `Library/SourceAssetDB` 的 **path→guid 记忆**，具体算法仍未探测 |
| U3 | **旧实例上已被 override 的属性**在 Prefab 覆盖后是否跟随 | **仍未探测**。§②-8 规则①（未 override → 跟随）、③（根 position 恒为 override → 不跟随）是**实测**；规则②的「不回退」半句只是 Unity 语义 + 推论 |
| U4 | Prefab **变体** / **嵌套 Prefab** / `UnpackPrefabInstance`（断开连接） | **修复轮 1 部分探测（R427①）**：拿一个 Prefab 实例当 `SaveAsPrefabAsset` 的源，会**静默产出 Variant**（`GetPrefabAssetType==Variant`，`m_SourcePrefab` = 原 Prefab）。但**变体本身的编辑/回写/断开连接仍未探测** |
| U5 | **非根子节点**上的 override 能否活过 `scene save` / `scene open` | R416 只覆盖了**实例根**上的 position/scale/sprite。（R427② 只测了「子节点当源存 Prefab」，**不是** override） |
| U6 | 默认 `shot`（window 模式）的**窗口内容区尺寸**由什么决定（本次 = `892×355`，而 `play view` 请求 960×640），以及它是否影响 `--window-name` 的鼠标坐标换算 | 只观察到「尺寸不等 + 每单位像素数 ≈33.3」；M2 已留有 `screenshotToInputFormula: unavailable` 的注解 |
| U7 | `doctor --golden` 在清理后的 S0Project 上是否仍 `matched:true` | 本轮不要求；SampleScene 未被改动（sha256 前后一致），**推论**不受影响 |
| U8 | `.meta` 缺失时**场景里已有的引用**是否会因「导入设置变化导致 sprite 重建」而在**渲染层**变化 | A2 只读了 CLI 侧字段（`ppu` / `worldSize`），没有截图对照 |
| U9 | `SaveAsPrefabAsset` 在**同名路径已存在但不是 Prefab**（例如同名 `.png` 目录冲突）时的行为 | 属于任务 6 的参数校验设计，不是本轮的未知 |

---

## 与我预期不符的观察（全部已查清，附解释）

| # | 观察 | 与什么不符 | 查清后的解释 |
|---|---|---|---|
| O1 | 不同时刻的 4 张 window 截屏**字节完全相同**，切换可见性也不变 | 我一度据此断言「window 模式给陈旧帧」 | **断言错了，已更正**：那 4 张图的可见内容**本来就没变**（源节点与实例同位置同缩放 + 「关 `RefProbe`」那步 exec 失败）→ 合法地相同。**补测**（清空场景后再截）得 `count=0`、md5 `d9c6f2a7…` ≠ `bffdf4b0…` → **window 模式会刷新** |
| O2 | 「关掉实例」后 `#FF2E88` 计数**一点没变** | 以为能靠开关可见性分离归属 | 源节点 `PfProbe` 与实例**同位置同缩放**，两张图本来就该逐像素相同（**不是**陈旧帧）。把实例挪到 (3,2)/scale 2 后才分离出 6144 px 归属；再关实例得 1536（负对照） |
| O3 | 我第一版 R416 里，实例 sprite override **没有**出现在 `m_Modifications` 里 | 以为「做了 override 就该有 m_Sprite」 | 那次 `sprite assign` 赋的是**与源 Prefab 相同**的资产（`pfinst.png`）→ 没有 diff，Unity 正确地**不记**修改项。换成 `hero.png` 后 `m_Sprite` 立刻出现在落盘 YAML 里（落盘证据见 §②-6b 重取的那份） |
| O4 | `robocopy` 以 **16** 退出、克隆根本没建 | 简报的 `robocopy … /E …` 可直接跑 | Git Bash 把 `/E` 转成了 `E:/`。需 `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"`。重跑得 `robocopy-exit=1`（= 有文件被复制，正常） |
| O5 | `unity scene open --path Assets/SampleScene.scene` 失败（`SCENE_NOT_FOUND`）；我一度以为它「退出码 0」 | 以为路径对、且以为失败命令给 0 | ① 路径错：S0Project 的场景在 `Assets/Scenes/SampleScene.scene`。② 复核后发现**退出码确实是 1**（我上一行的 `$?` 取的是别的命令）——CLI 行为正常，没有异常 |
| O6 | 会话开始时 `scene tree` 就报 `ProbeScene`（而不是 `SampleScene`） | 以为探针改动污染了 M3 场景 | `scene save --path X` 是 Save As：它把**当前活动场景**另存为 `X` 并让 `X` 成为活动场景。`SampleScene.scene` 本身全程未被写（sha256 前后一致、mtime 1985-10-26）。另：**S0Project 的 `SampleScene` 一直只有 1 个节点** ——**本报告自己的实测**：`probe-final-tree.json`（`sceneName:"SampleScene"`、`nodeCount:1`、`roots:["Main Camera"]`）、`probeB2-tree-sample2.json`、`r420-cleanup-tree.json`、`r420-final-tree.json` 四次读数一致（**不再引 `docs/CAPABILITIES` 的 5 节点 golden**；那个数字属于另一个项目/场景） |
| O7 | `pixels --count-color` 命中 7000 时我一度准备直接当判据 | — | 几何对账才是硬判据：`26112 = 24576 + 1536`、`7680 = 6144 + 1536`、负对照 `1536`，三组都精确成立（完整模板见 §②-9） |
| **O8（修复轮 1）** | 首版引的 `probeB2-ProbeScene.scene.copy` 里 `propertyPath: m_Sprite` **0 命中**（审查者核出） | 以为「引了自己拷的场景 = 就有落盘原文」 | **拷得太早**：它在 `probeB2-save.json`（12:15:20）之后、`probeB2-assign-inst-hero.json`（12:15:44）之前（`cp` mtime 12:15:25）→ 那时实例 sprite 与源 Prefab **相同**，Unity 正确地**不记** `m_Sprite`。重取（`scene save` → **立刻** `cp`）后命中第 **319** 行，见 §②-6b |

---

## 清理结果

| 项 | 结果 | 证据 |
|---|---|---|
| 探针节点 | **0 残留**。`exec` 清理时报 `killed=[]`，因为清理前已切到 `SampleScene`（探针节点都在 `ProbeScene` 里，随场景资产一起被删） | `probe-final-cleanup.json` |
| `Assets/M4Probe` | **GONE**：`AssetDatabase.IsValidFolder("Assets/M4Probe")=False`；盘上 `ls S0Project/Assets/M4Probe` → 不存在（`Assets/` 下只剩 `.empty / Editor / Editor.meta / PiSpike / PiSpike.meta / Scenes / Scenes.meta`，没有 `M4Probe.meta` 残渣） | `probe-final-cleanup.json`、`ls -la S0Project/Assets/` |
| 场景树 | `sceneName=SampleScene`、`nodeCount=1`、`roots=["Main Camera"]` | `probe-final-tree.json` |
| `SampleScene.scene` 未被改 | sha256 前 16 hex 清理前/后都是 `120d00be434b5573`；mtime 仍是 `1985-10-26T08:15:00Z`。**修复轮 1 重采**（补回 mtime 字段、与 `before` 同格式）：`sha256 120d00be434b5573 mtime 1985-10-26T08:15:00.000Z` —— 与 before **逐字相同** | `probe-final-samplescene-before.txt` / `probe-final-samplescene-after.txt`（轮 1 重写后两者格式一致） |
| 项目健康 | `doctor` 五项全 `pass`（`uloop` / `editor-install` / `editor-language` / `build-targets` / `editor-connection`） | `probe-final-doctor.json` |
| 项目外的探针残留 | 已删 `C:/Users/<用户>/pi-unity-spike/refprobe.png.meta.bak`（A2 的 `.meta` 备份） | 命令输出「已删 refprobe.png.meta.bak」 |
| **克隆目录** | **留着**：`C:/Users/<用户>/pi-unity-spike/CloneProbe`（含首次导入生成的 `Library/`）。它不在任何仓库里，留给复核者/下一个任务随时复核问题①；要清掉直接 `rm -rf` 即可 | — |
| 截图目录 | **留着**：`C:/Users/<用户>/pi-unity-spike/m4probe-shots/`（10 张：5 张 window 模式 + 5 张 rendering 模式）；全部已复制到证据目录 `probes/shots/` | `probes/shots/`（10 个文件） |
| 编辑器 | **留着不关**：`Tuanjie.exe` **PID 27580**，打开着 `S0Project`，`doctor` 全 pass → 下一个任务可直接用 | `tasklist`、`probe-final-doctor.json` |
| **轮 1 重建的探针现场（R420/R427）** | **已全部清掉**：`scene open SampleScene --force`（丢弃 P2 未保存改动）→ `AssetDatabase.DeleteAsset("Assets/M4Probe")` → `preGone=False; postValid=False`；盘上 `ls S0Project/Assets/` 只剩 `.empty / Editor / Editor.meta / PiSpike / PiSpike.meta / Scenes / Scenes.meta` | `r420-cleanup-open-sample.json`、`r420-cleanup-delete.json`、`r420-cleanup-tree.json` |
| **轮 1 终态** | `sceneName=SampleScene`、`nodeCount=1`、`roots=["Main Camera"]`；`doctor` 五项全 `pass`；编辑器 **PID 53992**（S0Project） | `r420-final-tree.json`、`r420-final-doctor.json`、`tasklist` |

---

## 疑虑

1. **问题①的结论只覆盖「同机 + 同项目根 + 无 `Library/`」**（U1）。跨机器 / 改项目根 / 改项目名都**未探测**，
   所以 SKILL 里「一起提交即可交付」应当写成**本机实证**的口径，跨机器那段仍按「同批提交」的保守建议走。
2. **默认 `shot`（window 模式）的尺寸与 `play view` 请求不一致**：要 960×640，window 回 **892×355**，
   每单位像素数 ≈ **33.3**（渲染模式是 64）。**未探测**（U6）：这个窗口内容区由什么决定、
   以及它是否影响 `--window-name` 相关的鼠标坐标换算（M2 已留有 `screenshotToInputFormula: unavailable` 的注解）。
   我一度把它误判成「陈旧帧」，已在 O1 更正；**可见性判据仍建议按 M2 的 PlayMode + rendering 模式走**。
   我认为**值得**进 `docs/PITFALLS.md` 的是另一条：「`pixels` 的 count 变不变**不能单独**证明渲染与否，归属要靠挪开 + 负对照」——
   那属于任务 6 之外的文档改动，**我没有自行改**。
3. **旧实例「scale 跟随、根 position 不跟随」**（②-5）我不确定任务 6 的 `--force` 想怎么对外描述；
   我只把事实写清，**契约措辞留给任务 6**。
4. **`pixels --count-color` 的 JSON 形状**：**计数在 `actual.count.count`**（`actual.count = {color, count, ratio, tolerance}`；
   `lib/pixels.js` 的赋值语句与 `probeB-pixels.json` 的原始 JSON 都逐字对得上）。成功/失败在顶层 `ok`。
   本报告的判据一律**不看退出码、看 `actual.count.count` + 几何对账**（CLI 既定行为：`--count-color` 命中 0 像素也退 0）。
   （修复轮 1 修正：首版把这里的字段名写成了 `actual.count`，会让读者以为那个对象本身就是数字。）
5. **A2 子探测是我在简报之外追加的**（用克隆做、`.meta` 备份放项目外、结束后放回并读回确认恢复）。
   它改了克隆的瞬时状态（现已恢复原值：`.meta` sha256 与探测前**逐字节相同**，`r426-meta-sha-before/restored.txt`），
   **S0Project 全程未被它触碰**（R426 删的是**克隆**的 `Library/`，已重建）。若不希望以后有这类追加，请在简报里写明。
6. **R427 的两条结果都指向「任务 6 应报用法错」**（实例源 → 静默出 Variant；子节点源 → 根位置取 local），
   但这两条都超出了任务 6 简报的参数校验设想。我只交事实与落盘文件，**没有**自行定契约（见 §②-10）。
7. **修复轮 1 重建过探针现场**（`Assets/M4Probe` 在轮内重新创建又删除）。终态已复核：
   `Assets/` 下无 `M4Probe`、无 `M4Probe.meta`；`scene tree` = `SampleScene / 1 节点`；`doctor` 五项全 `pass`
   （`r420-cleanup-open-sample.json`、`r420-cleanup-delete.json`、`r420-cleanup-tree.json`、`r420-final-tree.json`、`r420-final-doctor.json`）。

---

## 证据索引

**目录**：`R = .superpowers/sdd/2026-09-20-pi-unity-m4-exec/probes/`（gitignored）
截图另外留一份在 `C:/Users/<用户>/pi-unity-spike/m4probe-shots/`；克隆留在 `C:/Users/<用户>/pi-unity-spike/CloneProbe`。

**问题①**
- `probeA-import.json`、`probeA-create.json`、`probeA-assign.json`、`probeA-save.json`
- `probeA-ids-before.json`、`probeA-scene-guids-before.txt`、`probeA-meta-guid-before.txt`、`probeA-png-sha.txt`
- `probeA-clone-doctor-1.json`、`probeA-clone-open.json`、`probeA-clone-inspect.json`、`probeA-ids-after.json`、
  `probeA-clone-scene-guids-after.txt`、`probeA-meta-guid-after.txt`、`probeA-clone-png-sha.txt`
- A2 边界：`probeA2-refresh-nometa.json`、`probeA2-ids-nometa.json`、`probeA2-meta-guid-regenerated.txt`、
  `probeA2-inspect-nometa.json`、`probeA2-refresh-metarestored.json`、`probeA2-ids-metarestored.json`、`probeA2-inspect-metarestored.json`
- **A2-3 / A2-4（修复轮 1，R426）**：`r426-clone-doctor.json`、`r426-meta-guid-before.txt`、`r426-meta-sha-before.txt`、
  `r426-scene-guids-before.txt`、`probeA2-nolib-ids.json`、`r426-meta-guid-regenerated-nolib.txt`、`r426-meta-sha-regenerated-nolib.txt`、
  `probeA2-nolib-inspect.json`、`r426-nolib-scene-guids.txt`、`r426-nolib-scene-open.json`、
  `r426-metarestored-ids.json`、`r426-meta-guid-restored.txt`、`r426-meta-sha-restored.txt`、`r426-metarestored-inspect.json`、`r426-metarestored-scene-open.json`

**问题②（覆盖 / 实例化 / 可见性 / 旧实例）**
- `probe-prefab-1.cs`、`probe-prefab-2.cs`、`probe-prefab-read.cs`、`probe-prefab-3-instantiate.cs`、`probe-prefab-4a.cs`、`probe-prefab-4b.cs`、`probe-prefab-4c.cs`
- `probeB-import.json`、`probeB-save1.json`、`probeB-read1.json`、`probeB-save2.json`、`probeB-read2.json`、
  `probeB-prefab-guids-{1,2,3}.txt`、`probeB-instantiate.json`
- 可见性：`probeB-playview.json`、`probeB-shot.json`、`probeB-pixels.json`、`probeB-ctl-*.json`、
  `probeB-render-both.json`、`probeB-render-both-pixels.json`、`probeB-attr-playstart.json`、`probeB-attr-setup.json`、
  `probeB-attr-move.json`、`probeB-attr-moved-{shot,pixels,bbox}.json`、`probeB-attr-instoff.json`、
  `probeB-attr-none-{shot,pixels,bbox}.json`、`probeB-play-stop-{1,2,final}.json`、`probe-bbox.js`
- 旧实例：`probeB-stale-4{a,b,c}.json`
- 补做判据：`probeB-window-fresh-test.json`、`probeB-window-fresh-test-pixels.json`、`probeB-window-bbox.json`
- 截图（共 10 张，全部在 `shots/`）：`Rendering_20260920_121309_487.png`（源+RefProbe，26112）、`Rendering_20260920_121411_779.png`（实例挪位，7680）、
  `Rendering_20260920_121441_778.png`（负对照，1536）、`游戏_20260920_121224_735.png`（window 模式，7000 = 6600+400）、
  `游戏_20260920_121805_874.png`（清理后补测，`count=0`）
  （md5：rendering `26800dab…`×3 / `054dbd77…` / `cb063f5d…`；window `bffdf4b0…`×4 / `d9c6f2a7…`）
- **截图 md5 清单（R428）**：`probeB-shots-md5.txt`（`md5sum *.png` 的原始输出，10 行）——上述「md5：…」就是它的摘要；引 md5 时引这份文件

**R416**
- `probeB2-import.json`、`probeB2-create.json`、`probeB2-assign.json`、`probeB2-instantiate.json`、
  `probeB2-assign-inst.json`、`probeB2-inspect-before.json`、`probeB2-save.json`、`probeB2-open.json`、`probeB2-inspect-after.json`、
  `probeB2-assign-inst-hero.json`、`probeB2-save2.json`、`probeB2-open-sample.json`（失败的路径）、`probeB2-open-sample2.json`、
  `probeB2-tree-sample2.json`、`probeB2-open-back2.json`、`probeB2-inspect2-before.json`、`probeB2-inspect2-after-reload.json`、
  `probeB2-guids.json`（四个资产的 hex guid 对照）、`probeB2-ProbeScene.scene.copy`（**是 `probeB2-save.json` 之后、换 sprite 之前的快照，里面没有 `m_Sprite` —— 不能用作 override 落盘证据**，见 §②-6b）；
  失败的 open 复核：`probeB2-open-nonexistent.json`（`ok:false / code:SCENE_NOT_FOUND / 退出码 1`）
- **R420 重取（修复轮 1）**：`r420-import-a.json`、`r420-import-b.json`、`r420-create.json`、`r420-assign-src.json`、
  `r420-instantiate.json`、`r420-assign-inst.json`、`r420-inspect-before.json`、`r416-save.json`、
  **`r416-P2.after-save.scene`（落盘场景副本，命中行 319）**、`r416-modifications-sprite.txt`、
  `r420-open-sample.json`、`r420-tree-sample.json`、`r420-open-back.json`、`r416-inspect-after-reload.json`
- **R423 相机参数**：`r423-camera.json`（`orthographicSize=5 / 960×640`）
- **R425 规则证据**：`r425-pfoldinst-modifications.txt`
- **R427 契约黑洞**：`probe-r427.cs`（探针源码，见附录）、`r427-result.json`、`r427-create-parent.json`、`r427-set-parent.json`、
  `r427-create-child.json`、`r427-set-child.json`、`r427-inspect-child.json`、`r427-NestedOut.prefab.copy`、`r427-ChildOut.prefab.copy`
- **轮 1 清理/终态**：`r420-cleanup-open-sample.json`、`r420-cleanup-delete.json`、`r420-cleanup-tree.json`、`r420-final-tree.json`、`r420-final-doctor.json`

**清理与终态**
- `probe-final-cleanup.json`、`probe-final-tree.json`、`probe-final-samplescene-before.txt`、`probe-final-samplescene-after.txt`、`probe-final-doctor.json`、`probe-final-open-sample.json`

---

## 修复轮 1 变更对照（R420–R428）

> 首版 `docs/M4-PROBES.md`（提交 `caf758f`）被两位审查者审过 → 控制者裁定 **1 Critical + 5 Important + 1 Minor**。
> 本轮**只改本文件**，**未改任何源码/测试**；新增证据全部落在 `$R`（gitignored）。

| R | 级别 | 改了什么（章节） | 新证据 / 字段 |
|---|---|---|---|
| **R420** | **Critical** | §②-4 表（拆行 + 改引文）、§②-6 表第 7/8/9 行重排、§②-6 结论（证据等级改写）、**新增 §②-6b**、O3 **保留** + 新增 **O8** | **`r416-P2.after-save.scene` 第 319 行命中 `propertyPath: m_Sprite`**（`r416-modifications-sprite.txt`，grep 退出码 0）；两张图：`Assets/M4Probe/r420a.png`（guid `81457d82…`，源 fixtures `ovr-a.png`）/ `r420b.png`（guid `8cff5d88…`，源 `ovr-b.png`）；两次独立 `node inspect`：`r420-inspect-before.json` vs `r416-inspect-after-reload.json`（**MATCH**，中间真切过场景） |
| **R421** | Important | **新增「附录：探针源码」**（文末） | 7 份 `probe-prefab-*.cs` + R416 的内联 `exec --code` 片段 + `probe-r427.cs`，全文 |
| **R422** | Important | 疑虑 ④、任务 6 契约第 5 条、§②-9 第 3 条 | `actual.count` → **`actual.count.count`**；并写明 `actual.count = {color, count, ratio, tolerance}`（`lib/pixels.js` + `probeB-pixels.json` 原文） |
| **R423** | Important | **新增 §②-9「可见性判据模板（不可裁剪）」**（8 步） | 现成数字：`26112 = 24576(192×128) + 1536(48×32)`、`7680 = 6144(96×64) + 1536`、负对照 `1536`；`pixelsPerUnit = 图高 / (2×orthographicSize)`，S0Project 实测 `orthographicSize=5`、`960×640` → 64（`r423-camera.json`）；window 模式 `892×355`、≈33.3 px/单位 |
| **R424** | Important | §②-6 结论 blockquote 内加「R424 适用条件」 | 「同一次会话里的读回（含同场景 `scene open`）**不足以**验证落盘；任何验收都必须包含一次真重载」 |
| **R425** | Important | **新增 §②-8「`--force` 三条规则」**；任务 6 契约新增第 9 条 | `PfOldInst` 的 `m_Modifications` **有** `m_LocalPosition`（-3/-3/0）、**无** `m_LocalScale`（`r425-pfoldinst-modifications.txt` + §②-8 贴的 YAML 原文 3–5 行） |
| **R426** | Important | §①-4 改写过时句、§①-5 表加 **A2-3/A2-4** 并把「边界结论」改成四象限表、§①-6 改成硬规则、U2/U4 更新；§0 表加轮 1 切换记录 | **guid 前后值**：`a7a041ff0b369274f8b3e3a767833d76` →（无 `Library/` + 无 `.meta`）**`fd04e0928cc9d2647919c3e15d2a9f0c`**；base64 `Xn1OtS6s…` → `WS4fsX+tWnk5UXRUsdh9bMwMQPNge5xR1Nh1Xg91P2T0B53/cEUEpME=`；`node inspect` → **`assetPath:null / ppu:null / worldSize:null`**（`probeA2-nolib-ids.json`、`probeA2-nolib-inspect.json`）；放回 `.meta` 后全部恢复（`r426-metarestored-inspect.json`，meta sha256 逐字节回原值） |
| **R427** | Important | **新增 §②-10「两条契约黑洞」**；任务 6 契约新增第 10 条；U4 更新 | ① 实例源 → **`Variant`**、根名 `NestedOut`（文件名）、`out1_isPrefabInstance=true`、`out1_guid=7e71962308a12a749a5536fd08a47a56`；② 子节点源 → 根 `position` = **`1,1`（local，不是世界 `6,4`）**、`out2_assetType=Regular`、`out2_guid=b0833675e09de834dafb35c4be72ba1e`（见 `r427-result.json` 与两个 `.prefab.copy`） |
| **R428** | Minor | ① `probeB-shots-md5.txt` 落盘 + 证据索引引用；② §②-4 表把「覆盖后引用实例」**拆成两行**；③ `probe-final-samplescene-after.txt` 重采（补 mtime）；④ **O6** 引文改用 `probe-final-tree.json` / `probeB2-tree-sample2.json`（不再引 `CAPABILITIES` 的 5 节点 golden）；⑤ §①-2 的 `mtimeAfter` 补全小数秒（`…46.4879078Z`） | `probeB-shots-md5.txt`（10 行）、`probe-final-samplescene-after.txt`（`sha256 120d00be434b5573 mtime 1985-10-26T08:15:00.000Z`）、`r420-final-tree.json` |

**未做的事（如实登记）**：
- **没有**为了「让报告好看」而调整任何结论 —— R416 的结论**保留原样**，只是把引文换成本次重取的文件（R420 的两个分支里命中的是「**命中**」那一支）。
- **没有**改 `docs/M4-SPIKE.md`、`docs/PITFALLS.md`、任何 `.cs`、任何测试。
- **没有**把 R427 的两条结果自行翻译成任务 6 的契约措辞（§②-10 只交事实与落盘文件，建议也标成了「建议」）。

---

## 附录：探针源码（R421）

> **目的**：只拿到 git 里这份报告的人也能复现探测。以下源码/片段与探测现场用的**逐字节相同**
> （原文件在 `$R = .superpowers/sdd/2026-09-20-pi-unity-m4-exec/probes/`，该目录 gitignored）。
> 运行方式：`export PI_UNITY_ULOOP_BIN="…/uloop.exe"`（**每条命令都要带**）后，
> `node bin/unity.js exec --project-path <P> --json --code-file $R/<文件>.cs`。
> `exec` 是执行/读命令 → 信封的 `verified` 恒为 `null`，脚本返回值在 **`actual.result`**（字符串）。

### A.1 `probe-prefab-1.cs` —— 建节点（挂资产 sprite）→ 存 Prefab → 报 guid

```csharp
// probe-prefab-1.cs —— 建节点（挂资产 sprite）→ 存 Prefab → 报 guid/size
var go = new GameObject("PfProbe");
var sr = go.AddComponent<SpriteRenderer>();
sr.sprite = AssetDatabase.LoadAssetAtPath<Sprite>("Assets/M4Probe/hero.png");
go.transform.position = new Vector3(1f, 2f, 0f);
go.transform.localScale = new Vector3(2f, 2f, 1f);
var saved = PrefabUtility.SaveAsPrefabAsset(go, "Assets/M4Probe/PfProbe.prefab");
return "saved=" + (saved != null) + "; guid=" + AssetDatabase.AssetPathToGUID("Assets/M4Probe/PfProbe.prefab");

```

### A.2 `probe-prefab-2.cs` —— 改「源节点」的 position/scale 后再存到**同一路径**（覆盖语义）

```csharp
// probe-prefab-2.cs —— 改「源节点」的 position/scale 后再存到**同一路径**（覆盖语义）
var go = GameObject.Find("PfProbe");
if (go == null) return "{\"__error\":\"NOT_FOUND\"}";
go.transform.position = new Vector3(-3f, -3f, 0f);
go.transform.localScale = new Vector3(4f, 4f, 1f);
var saved = PrefabUtility.SaveAsPrefabAsset(go, "Assets/M4Probe/PfProbe.prefab");
return "saved=" + (saved != null) + "; guid=" + AssetDatabase.AssetPathToGUID("Assets/M4Probe/PfProbe.prefab");

```

### A.3 `probe-prefab-read.cs` —— **读回资产内容**（证明「覆盖真的改了内容」，而不是只改了 mtime）

```csharp
// probe-prefab-read.cs —— **读回资产内容**（证明「覆盖真的改了内容」，而不是只改了 mtime）
var asset = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/M4Probe/PfProbe.prefab");
if (asset == null) return "{\"__error\":\"PREFAB_NOT_FOUND\"}";
var sr = asset.GetComponent<SpriteRenderer>();
var o = new Newtonsoft.Json.Linq.JObject();
o["name"] = asset.name;
o["position"] = asset.transform.position.x + "," + asset.transform.position.y;
o["scale"] = asset.transform.localScale.x + "," + asset.transform.localScale.y;
o["spriteAssetPath"] = sr != null && sr.sprite != null ? AssetDatabase.GetAssetPath(sr.sprite) : null;
o["guid"] = AssetDatabase.AssetPathToGUID("Assets/M4Probe/PfProbe.prefab");
return o.ToString(Newtonsoft.Json.Formatting.None);

```

### A.4 `probe-prefab-3-instantiate.cs` —— 实例化 + 读回（引用/PPU/世界尺寸）

```csharp
// probe-prefab-3-instantiate.cs —— 实例化 + 读回（引用/PPU/世界尺寸）
var asset = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/M4Probe/PfProbe.prefab");
if (asset == null) return "{\"__error\":\"PREFAB_NOT_FOUND\"}";
var inst = PrefabUtility.InstantiatePrefab(asset) as GameObject;
if (inst == null) return "{\"__error\":\"INSTANTIATE_FAILED\"}";
inst.name = "PfProbeInstance";
var sr = inst.GetComponent<SpriteRenderer>();
var o = new Newtonsoft.Json.Linq.JObject();
o["instanceName"] = inst.name;
o["spriteAssetPath"] = sr != null && sr.sprite != null ? AssetDatabase.GetAssetPath(sr.sprite) : null;
o["ppu"] = sr != null && sr.sprite != null ? sr.sprite.pixelsPerUnit : 0f;
o["worldSize"] = sr != null ? (sr.bounds.size.x + "," + sr.bounds.size.y) : null;
o["isPrefabInstance"] = PrefabUtility.IsPartOfPrefabInstance(inst);
o["correspondingSource"] = PrefabUtility.GetCorrespondingObjectFromSource(inst) != null;
o["position"] = inst.transform.position.x + "," + inst.transform.position.y;
return o.ToString(Newtonsoft.Json.Formatting.None);

```

### A.5 `probe-prefab-4a.cs` —— 先在**当前** Prefab 内容上造一个实例（旧实例），记录其 pos/scale

```csharp
// probe-prefab-4a.cs —— 先在**当前** Prefab 内容上造一个实例（旧实例），记录其 pos/scale
var src = UnityEngine.Object.FindObjectsOfType<Transform>(true).FirstOrDefault(x => x.name == "PfProbe");
if (src == null) return "{\"__error\":\"SRC_NOT_FOUND\"}";
src.gameObject.SetActive(true);
src.position = new Vector3(5f, 0f, 0f);
src.localScale = new Vector3(0.5f, 0.5f, 1f);
var asset = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/M4Probe/PfProbe.prefab");
var old = PrefabUtility.InstantiatePrefab(asset) as GameObject;
old.name = "PfOldInst";
var o = new Newtonsoft.Json.Linq.JObject();
o["prefabAssetPosScale"] = asset.transform.position.x + "," + asset.transform.position.y + " / " + asset.transform.localScale.x + "," + asset.transform.localScale.y;
o["oldInstPosScale"] = old.transform.position.x + "," + old.transform.position.y + " / " + old.transform.localScale.x + "," + old.transform.localScale.y;
o["prefabGuid"] = AssetDatabase.AssetPathToGUID("Assets/M4Probe/PfProbe.prefab");
return o.ToString(Newtonsoft.Json.Formatting.None);

```

### A.6 `probe-prefab-4b.cs` —— 改源节点后**第三次覆盖**同一路径

```csharp
// probe-prefab-4b.cs —— 改源节点后**第三次覆盖**同一路径（看旧实例会不会跟着变）
var src = UnityEngine.Object.FindObjectsOfType<Transform>(true).FirstOrDefault(x => x.name == "PfProbe");
if (src == null) return "{\"__error\":\"SRC_NOT_FOUND\"}";
src.position = new Vector3(0f, 0f, 0f);
src.localScale = new Vector3(6f, 6f, 1f);
var saved = PrefabUtility.SaveAsPrefabAsset(src.gameObject, "Assets/M4Probe/PfProbe.prefab");
AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
return "saved=" + (saved != null) + "; guid=" + AssetDatabase.AssetPathToGUID("Assets/M4Probe/PfProbe.prefab");

```

### A.7 `probe-prefab-4c.cs` —— 读回：旧实例是否跟随新内容 + 资产内容 + 新实例

```csharp
// probe-prefab-4c.cs —— 读回：旧实例是否跟随新内容 + 资产内容 + 新实例
var asset = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/M4Probe/PfProbe.prefab");
if (asset == null) return "{\"__error\":\"PREFAB_NOT_FOUND\"}";
var old = GameObject.Find("PfOldInst") ?? UnityEngine.Object.FindObjectsOfType<Transform>(true).FirstOrDefault(x => x.name == "PfOldInst").gameObject;
var o = new Newtonsoft.Json.Linq.JObject();
o["assetPosScale"] = asset.transform.position.x + "," + asset.transform.position.y + " / " + asset.transform.localScale.x + "," + asset.transform.localScale.y;
o["oldInstPosScale"] = old.transform.position.x + "," + old.transform.position.y + " / " + old.transform.localScale.x + "," + old.transform.localScale.y;
o["prefabGuid"] = AssetDatabase.AssetPathToGUID("Assets/M4Probe/PfProbe.prefab");
var fresh = PrefabUtility.InstantiatePrefab(asset) as GameObject;
fresh.name = "PfNewInst";
o["newInstPosScale"] = fresh.transform.position.x + "," + fresh.transform.position.y + " / " + fresh.transform.localScale.x + "," + fresh.transform.localScale.y;
o["spriteAssetPath"] = fresh.GetComponent<SpriteRenderer>().sprite != null ? AssetDatabase.GetAssetPath(fresh.GetComponent<SpriteRenderer>().sprite) : null;
return o.ToString(Newtonsoft.Json.Formatting.None);

```

### A.8 R416 的 `unity exec --code '…'` 片段（内联，无 code-file）

> 现场实际跑的就是下面这一行（输出 = `probeB2-instantiate.json` 的 `actual.result`：`saved=True; inst=True; isInstance=True`）。

```bash
node bin/unity.js exec --project-path "$P" --json --code 'var go=GameObject.Find("PfSrc"); var saved=PrefabUtility.SaveAsPrefabAsset(go,"Assets/M4Probe/PfInst.prefab"); var inst=PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>("Assets/M4Probe/PfInst.prefab")) as GameObject; inst.name="PfInst1"; inst.transform.position=new Vector3(-2f,-2f,0f); inst.transform.localScale=new Vector3(3f,3f,1f); return "saved="+(saved!=null)+"; inst="+(inst!=null)+"; isInstance="+PrefabUtility.IsPartOfPrefabInstance(inst);' > $R/probeB2-instantiate.json
```

### A.9 `probe-r427.cs`（修复轮 1 新增，R427 的两条契约黑洞）

```csharp
var o = new Newtonsoft.Json.Linq.JObject();

// ── ① 源节点 = Prefab 实例（嵌套）
var srcInst = GameObject.Find("R420Inst");
if (srcInst == null) { o["err1"] = "R420Inst NOT_FOUND"; }
else {
  o["src1_isPrefabInstance"] = PrefabUtility.IsPartOfPrefabInstance(srcInst);
  o["src1_pos"] = srcInst.transform.position.x + "," + srcInst.transform.position.y;
  o["src1_localScale"] = srcInst.transform.localScale.x + "," + srcInst.transform.localScale.y;
  var out1 = PrefabUtility.SaveAsPrefabAsset(srcInst, "Assets/M4Probe/NestedOut.prefab");
  o["out1_saved"] = out1 != null;
  if (out1 != null) {
    var sr1 = out1.GetComponent<SpriteRenderer>();
    o["out1_rootName"] = out1.name;
    o["out1_pos"] = out1.transform.position.x + "," + out1.transform.position.y;
    o["out1_isPrefabInstance"] = PrefabUtility.IsPartOfPrefabInstance(out1);
    o["out1_sprite"] = sr1 != null && sr1.sprite != null ? AssetDatabase.GetAssetPath(sr1.sprite) : null;
    o["out1_guid"] = AssetDatabase.AssetPathToGUID("Assets/M4Probe/NestedOut.prefab");
    var out1Type = PrefabUtility.GetPrefabAssetType(out1);
    o["out1_assetType"] = out1Type.ToString();
  }
}

// ── ② 源节点 = 子节点（父 R427Parent@(5,3)，子 local (1,1) → 世界 (6,4)）
var parent = GameObject.Find("R427Parent");
var child = parent != null ? parent.transform.Find("R427Child") : null;
if (child == null) { o["err2"] = "R427Child NOT_FOUND"; }
else {
  o["src2_localPos"] = child.localPosition.x + "," + child.localPosition.y;
  o["src2_worldPos"] = child.position.x + "," + child.position.y;
  o["src2_parentName"] = child.parent != null ? child.parent.name : null;
  var out2 = PrefabUtility.SaveAsPrefabAsset(child.gameObject, "Assets/M4Probe/ChildOut.prefab");
  o["out2_saved"] = out2 != null;
  if (out2 != null) {
    o["out2_rootName"] = out2.name;
    o["out2_position"] = out2.transform.position.x + "," + out2.transform.position.y;
    o["out2_localPosition"] = out2.transform.localPosition.x + "," + out2.transform.localPosition.y;
    o["out2_parentName"] = out2.transform.parent != null ? out2.transform.parent.name : null;
    o["out2_guid"] = AssetDatabase.AssetPathToGUID("Assets/M4Probe/ChildOut.prefab");
    o["out2_assetType"] = PrefabUtility.GetPrefabAssetType(out2).ToString();
    // 再把 ChildOut.prefab 实例化，看它落地后的位置
    var inst2 = PrefabUtility.InstantiatePrefab(out2) as GameObject;
    o["out2_instPos"] = inst2 != null ? (inst2.transform.position.x + "," + inst2.transform.position.y) : null;
    if (inst2 != null) UnityEngine.Object.DestroyImmediate(inst2);
  }
}
return o.ToString(Newtonsoft.Json.Formatting.None);

```

### A.10 R420 的复核现场（修复轮 1，全部是现成 CLI，无 code-file）

```bash
P="C:/Users/<用户>/pi-unity-spike/S0Project"
R=".superpowers/sdd/2026-09-20-pi-unity-m4-exec/probes"
# 0) 两张不同的图（同尺寸 12×8 / ppu 16，内容不同 → 只有 sprite 引用会差）
node bin/unity.js asset import --project-path "$P" --from .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/ovr-a.png --to Assets/M4Probe/r420a.png --ppu 16 --json > "$R/r420-import-a.json"
node bin/unity.js asset import --project-path "$P" --from .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/ovr-b.png --to Assets/M4Probe/r420b.png --ppu 16 --json > "$R/r420-import-b.json"
# 1) 源节点 + 存 Prefab + 实例化（手搓；任务 6 的 prefab 命令还不存在）
node bin/unity.js node create --project-path "$P" --name R420Src --components '["SpriteRenderer"]' --json > "$R/r420-create.json"
node bin/unity.js sprite assign --project-path "$P" --path R420Src --asset Assets/M4Probe/r420a.png --json > "$R/r420-assign-src.json"
node bin/unity.js exec --project-path "$P" --json --code 'var go=GameObject.Find("R420Src"); var saved=PrefabUtility.SaveAsPrefabAsset(go,"Assets/M4Probe/R420.prefab"); var inst=PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>("Assets/M4Probe/R420.prefab")) as GameObject; inst.name="R420Inst"; inst.transform.position=new Vector3(2f,-1f,0f); var sr=inst.GetComponent<SpriteRenderer>(); return "saved="+(saved!=null)+"; inst="+(inst!=null)+"; isInstance="+PrefabUtility.IsPartOfPrefabInstance(inst)+"; instSprite="+(sr.sprite!=null?AssetDatabase.GetAssetPath(sr.sprite):null)+"; prefabGuid="+AssetDatabase.AssetPathToGUID("Assets/M4Probe/R420.prefab");' > "$R/r420-instantiate.json"
# 2) **在实例上**换成另一张图（世界尺寸保持不变 → 唯一 diff 就是 sprite 引用）
node bin/unity.js sprite assign --project-path "$P" --path R420Inst --asset Assets/M4Probe/r420b.png --world-size 0.75,0.5 --json > "$R/r420-assign-inst.json"
node bin/unity.js node inspect --project-path "$P" --path R420Inst --json > "$R/r420-inspect-before.json"
# 3) 落盘 → **立刻**把场景文件拷出来（这一步首版漏了，R420 的根因）
node bin/unity.js scene save --project-path "$P" --path Assets/M4Probe/P2.scene --json > "$R/r416-save.json"
cp "$P/Assets/M4Probe/P2.scene" "$R/r416-P2.after-save.scene"
grep -n "propertyPath: m_Sprite" "$R/r416-P2.after-save.scene" > "$R/r416-modifications-sprite.txt"; echo "grep-exit=$?"   # → 0，命中 319 行
grep -n -A3 -B3 "propertyPath: m_Sprite" "$R/r416-P2.after-save.scene"
# 4) 真重载（R424：同一会话里的读回不算）
node bin/unity.js scene open --project-path "$P" --path Assets/Scenes/SampleScene.scene --json > "$R/r420-open-sample.json"
node bin/unity.js scene tree --project-path "$P" --json > "$R/r420-tree-sample.json"   # 确认已离开：SampleScene / 1 节点
node bin/unity.js scene open --project-path "$P" --path Assets/M4Probe/P2.scene --json > "$R/r420-open-back.json"
node bin/unity.js node inspect --project-path "$P" --path R420Inst --json > "$R/r416-inspect-after-reload.json"
```
