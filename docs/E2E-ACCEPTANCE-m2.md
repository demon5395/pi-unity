# pi-unity M2 端到端验收（盲测：只靠 skill 搭一个完整小游戏）

> 执行日期：2026-09-19
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
# 装 uloop 包（codeload vendor 已在本地，见 docs/CAPABILITIES-tuanjie-2022.3.62t9.md §1；**不走 OpenUPM**，U1）
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
# 再确认已打开并保存了场景（否则 play start 会落 CONTROL_PLAY_MODE_UNSAVED_CHANGES，见 §2.1⑦）：
PI_UNITY_ULOOP_BIN=C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe \
  node bin/unity.js scene tree --project-path "$B" --json   # actual.sceneName 必须非空
# sceneName 为空串（未命名/未保存场景）→ 用 M3 的 `unity scene save` 自救（写后读回 verified:true 才算存下），再重跑本条：
#   node bin/unity.js scene save --project-path "$B" --path Assets/Scenes/SampleScene.scene --json
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

**执行环境**：Git Bash（`tar` = GNU tar 1.35）；编辑器实例两个（见下），**S0Project 的编辑器未关闭**。
**本节各命令中**作为**参数占位**的 `...` 指下面这四个**完整值**（照抄即可还原）；
**转录输出里的 `...` 是内容省略**（多为路径，如 `/d/devsoft/.../ProjectTemplates/`、`*.../SampleScene.scene`；
也可能是 `ps` 列或 JSON 字段省略），**不属于**这四个值：
`T = /d/devsoft/unity/unitySoft/2022.3.62t9/Editor/Data/Resources/PackageManager/ProjectTemplates/cn.tuanjie.template.2d-7.0.4.tgz`（模板 tgz）、
`B = C:/Users/<用户>/pi-unity-m2-blind`（盲测项目）、
`X = C:/Users/<用户>/pi-unity-m2-blind-extract`（解包临时目录；真实 Windows 路径，均在仓库之外）、
`PI_UNITY_ULOOP_BIN = C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe`（dispatcher）。

**① 前置检查与清场**

```
$ command -v tar && tar --version | head -1
/usr/bin/tar
tar (GNU tar) 1.35                      exit=0
$ ls -la /d/devsoft/.../ProjectTemplates/
-rw-r--r-- 1 <用户> <组> 17488976  6月  2 13:05 cn.tuanjie.template.2d-7.0.4.tgz
-rw-r--r-- 1 <用户> <组> 16624902  6月  2 13:05 cn.tuanjie.template.3d-8.1.4.tgz
-rw-r--r-- 1 <用户> <组> 29442898  6月  2 13:05 cn.tuanjie.template.universal-2d-2.1.3.tgz   exit=0
$ ls C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp | head
CHANGELOG.md  Documentation~  Editor  Editor.meta  package.json  package.json.meta
project-runner-pin.json  project-runner-pin.json.meta  Runtime                       exit=0
```

**② 解包（逐字执行协议 §0 的命令）**

```
$ T="/d/devsoft/unity/unitySoft/2022.3.62t9/Editor/Data/Resources/PackageManager/ProjectTemplates/cn.tuanjie.template.2d-7.0.4.tgz"
$ B=C:/Users/<用户>/pi-unity-m2-blind
$ X=C:/Users/<用户>/pi-unity-m2-blind-extract
$ rm -rf "$B" "$X" && mkdir -p "$B" "$X"                 exit=0
$ command -v tar >/dev/null || { echo "需要 tar"; exit 1; }   exit=0（tar 存在）
$ tar xzf "$T" -C "$X"                                    exit=0
$ cp -r "$X/package/ProjectData~/." "$B"/                 exit=0
$ ls -A "$B"
Assets  Library  Packages  ProjectSettings                exit=0
$ ls -A "$X" "$X/package"
C:/Users/<用户>/pi-unity-m2-blind-extract:
package
C:/Users/<用户>/pi-unity-m2-blind-extract/package:
.signature  CHANGELOG.md  CHANGELOG.md.meta  Documentation~  LICENSE.md  LICENSE.md.meta
package.json  package.json.meta  ProjectData~  README.md  README.md.meta  Tests  Tests.meta
Third Party Notices.md  Third Party Notices.md.meta        exit=0
```

**③ 加 uloop `file:` 依赖**

```
$ cat "$B/Packages/manifest.json"      # BEFORE：9 条内置依赖（com.unity.feature.2d 等）
$ node -e "
const fs=require('fs');const p='C:/Users/<用户>/pi-unity-m2-blind/Packages/manifest.json';
const m=JSON.parse(fs.readFileSync(p,'utf8'));
m.dependencies['io.github.hatayama.uloopmcp']='file:C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp';
fs.writeFileSync(p, JSON.stringify(m,null,2)+'\n');console.log('manifest OK');"
manifest OK                                               exit=0
$ cat "$B/Packages/manifest.json"      # AFTER：多一行
    "io.github.hatayama.uloopmcp": "file:C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp"   exit=0
```

**④ 启动编辑器（U6：手动启动，不用 `uloop launch`）**

```
$ cmd //c start "" "<引擎安装目录>/2022.3.62t9/Editor/Tuanjie.exe" -projectPath "$B"
                                                          exit=0
$ powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='Tuanjie.exe'\" | Select ProcessId,CommandLine"
37384  ... Tuanjie.exe -projectPath C:\Users\<用户>\pi-unity-spike\S0Project   # 预先存在，**未关闭**
38444  ... Tuanjie.exe -projectPath C:/Users/<用户>/pi-unity-m2-blind          # 本次新建
```

> ⚠️ **准备期真实遇到的一个坑（环境类，D 类；不改代码也不改 skill）**：模板解包后**没有**
> `ProjectSettings/ProjectVersion.txt`（Unity Hub 建项目时才写这个文件），editor 判定为
> 「已保存项目 (5.0 之前)」，弹出**阻塞式模态框**「在不匹配的编辑器安装中打开项目」，
> 编辑器停在 PID 38444 / 231 MB 不动（UIA 找不到该窗口，用 `AppActivate` + `TAB`×2 把焦点挪到
> 「继续」（截图确认焦点）后 `ENTER` 放行）。放行后**编辑器自己写回了** `ProjectVersion.txt`：
>
> ```
> m_EditorVersion: 2022.3.62t9
> m_EditorVersionWithRevision: 2022.3.62t9 (332340d7072c)
> m_TuanjieEditorVersion: 1.9.1
> ```
>
> 证据截图：`C:/Users/<用户>/pi-unity-spike/m2-shots/blind-dialog-check.png`（模态框原文）、
> `blind-dialog-focus2-crop.png`（焦点落在「继续」）。**下次准备同款项目会再遇到**，可用同样手法；
> 若编辑器被重启，该框不会再出现（`ProjectVersion.txt` 已存在）。

**⑤ 等首次编译（44 asmdef）后确认工具面可用 —— `doctor --smoke` 完整输出**

```
$ PI_UNITY_ULOOP_BIN=C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe \
    node bin/unity.js doctor --project-path "C:/Users/<用户>/pi-unity-m2-blind" --smoke
  OK  compile            errors=0 warnings=0
  OK  get-logs           total=0
  OK  get-hierarchy      saved: .uloop\outputs\HierarchyResults\hierarchy_2026-09-19_13-44-19.json
  OK  write-create       verified: true（建了 __pi_smoke）
  OK  write-set          verified: true（position {1,2,0}）
  OK  write-delete       verified: true（已删除）
  OK  write-clean        无残留（读回确认）
                                                          exit=0
```

`--json` 形状复核（同一命令加 `--json`，`ok:true`、7 项 `status:"pass"`）：
`C:/Users/<用户>/pi-unity-spike/m2-shots/blind-doctor-smoke.json`。

**⑥ 模板原样确认 —— `scene tree` 只有一个 `Main Camera`**

```
$ PI_UNITY_ULOOP_BIN=... node bin/unity.js scene tree --project-path "$B" --json
{
  "ok": true, "verified": null, "intent": null,
  "actual": {
    "sceneName": "", "nodeCount": 1, "maxDepth": 0,
    "roots": [
      { "name": "Main Camera", "path": "Main Camera", "active": true,
        "components": ["Transform", "Camera", "AudioListener"],
        "siblingIndex": 0, "tag": "MainCamera", "layer": 0, "children": [] }
    ],
    "otherSceneCount": 0, "otherSceneNames": [], "tooDeep": false
  },
  "hint": []
}
                                                          exit=0
$ grep -c "__pi_" <该 JSON>                                0（退出码 1 = 无匹配）
```

**⑦ 准备阶段补做：让编辑器打开模板自带的 `SampleScene.scene`，并验证 PlayMode 真的可用**

⑥ 暴露了一个**准备阶段的缺口**（不是盲测该考的 skill 能力）：`scene tree` 的 `sceneName` 是**空串**，
而模板自带的 `Assets/Scenes/SampleScene.scene` **确实存在**——编辑器当时停在**未命名/未保存场景**
（上一次准备里那个模态框的放行路径导致的后果）。后果很具体：`unity play start` 会落
`CONTROL_PLAY_MODE_UNSAVED_CHANGES`，而 CLI 命令面里**没有** `scene save` / `scene open`，
盲测会在**判据 2/3（需要 PlayMode 的 rendering 截图）上因环境原因卡住**。

下面这一步是**环境准备**（把「模板原样」恢复成真的模板原样），**不是改判据**，也**没有**在项目里
加任何探针节点或脚本：临时 `.cs` 放在**仓库内** `tmp/`，只通过裸 `uloop execute-dynamic-code` 执行
（裸 uloop 的限制只针对盲测子代理，不针对 facilitator）。

```
$ ls -l "$B/Assets/Scenes/" && md5sum "$B/Assets/Scenes/SampleScene.scene"
-rw-r--r-- 1 <用户> <组> 5549  9月 19 13:41 SampleScene.scene
-rw-r--r-- 1 <用户> <组>  155  9月 19 13:41 SampleScene.scene.meta
cfa039c51ef6e5e41b68fab3d47f329a *C:/Users/<用户>/pi-unity-m2-blind/Assets/Scenes/SampleScene.scene
                                                          exit=0

$ cat .superpowers/sdd/2026-09-19-pi-unity-m2-implementation/tmp/task-12-prep2-open-scene.cs
using UnityEditor.SceneManagement;

var scene = EditorSceneManager.OpenScene("Assets/Scenes/SampleScene.scene", OpenSceneMode.Single);
EditorSceneManager.MarkSceneDirty(scene);
var saved = EditorSceneManager.SaveScene(scene);
return "opened=" + scene.name + " path=" + scene.path + " saveReturned=" + saved + " isDirty=" + scene.isDirty;

$ C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe \
    --project-path "$B" execute-dynamic-code --code-file <上面那个 .cs>
{
  "Result": "opened=SampleScene path=Assets/Scenes/SampleScene.scene saveReturned=True isDirty=False",
  "Logs": [ "Execution completed successfully" ],
  "CompilationErrors": [], "Error": "", "EditorPlaying": false, "Success": true
}
                                                          exit=0
```

**验证（进出一次 PlayMode 的完整闭环）**

```
$ node bin/unity.js scene tree --project-path "$B" --json       # sceneName："" → "SampleScene"
  "actual": { "sceneName": "SampleScene", "nodeCount": 1, "maxDepth": 0,
    "roots": [ { "name": "Main Camera", ... "children": [] } ],
    "otherSceneCount": 0, "tooDeep": false }                  exit=0

$ md5sum "$B/Assets/Scenes/SampleScene.scene"                   # 保存后的基线
 a64105b603a7e232d2b4752aa9681748 *.../SampleScene.scene        exit=0
（保存时编辑器按当前序列化器重写了 YAML，故 md5 与 13:41 的模板解包值 cfa039c5… 不同；这不影响任何判据：
  判据 1 只看结构、判据 2/3 只看渲染与像素。）

$ node bin/unity.js play start --project-path "$B" --json
{ "ok": true, "verified": true, "intent": { "isPlaying": true },
  "actual": { "action": "Play", "isPlaying": true, "isPaused": false, "changed": true,
              "wasAlreadyStopped": false, "blockedByCompileErrors": false,
              "blockedByUnsavedChanges": false, "compileErrorCount": 0,
              "message": "Play mode started" },
  "mismatches": [] }                                        exit=0

$ node bin/unity.js shot --project-path "$B" --out C:/Users/<用户>/pi-unity-spike/m2-shots/task-12-prep2 --json
{ "ok": true,
  "actual": { "path": "C:\\...\\task-12-prep2\\Rendering_20260919_134705_987.png",
              "width": 534, "height": 334, "captureMode": "rendering",
              "windowName": "游戏", "fileSizeBytes": 3079, "timedOut": false } }
                                                          exit=0
$ head -c 8 <该 PNG> | od -c
0000000 211   P   N   G  \r  \n 032  \n                        exit=0（合法 PNG 签名）

$ node bin/unity.js play stop --project-path "$B" --json
{ "ok": true, "verified": true, "intent": { "isPlaying": false },
  "actual": { "action": "Stop", "isPlaying": false, "isPaused": false, "changed": true,
              "wasAlreadyStopped": false, "blockedByCompileErrors": false,
              "blockedByUnsavedChanges": false, "message": "Play mode stopped" },
  "mismatches": [] }                                        exit=0

$ md5sum "$B/Assets/Scenes/SampleScene.scene"                   # PlayMode 进出之后
 a64105b603a7e232d2b4752aa9681748 *.../SampleScene.scene        exit=0   ← 与基线**一致**（未静默保存）
$ grep -c "__pi_" <play stop 后的 scene tree JSON>              0（退出码 1 = 无匹配）
$ find "$B/Assets" -type f
Assets/.empty  Assets/Resources/BillingMode.json(+.meta)  Assets/Resources.meta
Assets/Scenes/SampleScene.scene(+.meta)  Assets/Scenes.meta    exit=0（无探针脚本、无探针节点）
```

结论：**盲测项目现在可进 PlayMode**（`play start` → `verified:true` 且 `blockedByUnsavedChanges:false`，
PlayMode 下 `shot --capture-mode rendering` 成功产出合法 PNG，`play stop` → `verified:true`），
判据 2/3 **不再会因环境原因卡住**。留下的一条发现已登记在 **§3.1（待回写时分类裁定）**。

**盲测项目状态快照（准备完成时的事实）**

| 项 | 值 |
|---|---|
| 项目根 | `C:/Users/<用户>/pi-unity-m2-blind` |
| `ProjectSettings/ProjectVersion.txt` | `2022.3.62t9 (332340d7072c)` / `m_TuanjieEditorVersion: 1.9.1`（**编辑器放行模态框后自己写的**） |
| `Packages/manifest.json` | 模板原 9 条 + `io.github.hatayama.uloopmcp: file:.../vendor/uloopmcp` |
| `Assets/` | 模板自带：`Resources/BillingMode.json`、`Scenes/SampleScene.scene`（见 ⑦）；无 `.cs`、无探针节点 |
| 打开的场景 | `SampleScene`（模板自带的 `Assets/Scenes/SampleScene.scene`，**已保存**；见 ⑦ —— 修复前是「无标题」未命名场景） |
| PlayMode 可用性 | `play start` / `play stop` 均 `verified:true`；PlayMode rendering 截图成功（见 ⑦） |
| `.uloop/` | 首次运行 uloop 包 + `--smoke` 产生：`tools.json`、`project-runner-pin.json`、`outputs/HierarchyResults/*.json` ×4（**工具产物，不是探针节点**） |
| `__pi_*` 残留 | 无（`scene tree` 里 `__pi_` 命中 0；`--smoke` 的 write-clean 读回确认） |
| 运行中的编辑器 | PID 37384 = `S0Project`（**未关闭**）、PID 38444 = blind 项目 |
| `npm test`（SKILL 修正后） | **366/366 pass**（`node --test`，exit 0）；**回写后重跑仍 366/366 pass**（exit 0） |

### 2.2 盲测子代理的执行摘要

来源：`.superpowers/e2e-m2-blind-report.md`（盲测子代理交付，**未改写**）；下表与引文均照抄其自述。

> ℹ️ 本节引文里出现的 `U16` / `U17` 是盲测当时的**预留编号**（R213）。M2 收口后的**最终编号**：
> 输入模拟边界 = **U25**、`play start` 与未保存场景 = **U26**（索引见 `docs/PITFALLS.md`）。

**执行概况**

| 项 | 值（盲测自述） |
|---|---|
| 命令总数 | **118 条 `unity` 命令**：117 条退出码 **0**，1 条退出码 **1** |
| 唯一非零退出码 | `unity play key --action Press --key Space` → **1**，`INPUT_SYSTEM_UNAVAILABLE`（项目没装 Input System；SKILL §8④ / U16 预期内的**如实失败**） |
| 裸 uloop | **零**（全程未直接调用 `uloop.exe`） |
| 未改 SKILL / PITFALLS | ✅（发现问题只写进报告） |
| 产物目录 | `C:/Users/<用户>/pi-unity-blind-artifacts/`（截图 3 张 + `cmdlog.txt` 166 行原始回包） |
| 四条「看到没有」 | 4 行砖阵 ✅ / 青色挡板 ✅ / 白球 ✅ / 左上角分数 ✅ |
| 「打得动」 | ✅（三类独立证据：`[BB]` 日志 24 条、两图逐像素差 **64225 px（10.45%）**、砖块计数单调下降 + 球/挡板质心位移） |

**盲测自述的失败/卡点（原样引用，逐字）**

- **G1（最重要）——§8③ 指向的命令不存在**：
  > 我跑了 `unity --help`（exit 0）逐条核对 M2 命令面：`version / doctor / scene tree / node inspect|create|set|delete / shot / pixels / sprite set / compile / asset write / play`。
  > **没有 `exec`、`eval`、`execute`、`dynamic-code` 之类的命令**；`unity play` 的子命令是 `start|stop|pause|step|status|click|mouse|key|logs|view`，也没有读回任意 C# 表达式的能力。
  > 也就是说：**SKILL §8③ 唯一能读 `score` / `bricksAlive` 的那一步，只能靠裸 uloop 的 `execute-dynamic-code`**，
  > 而这正是本任务规则 5 明令禁止的。**SKILL 的验证配方里存在一个「必须用被禁止的手段才能完成」的步骤。**
- **G2（前半：无 diff 子命令 → 见 §3.2 B3；后半：`--count-color` 计数相同 ≠ 没动。本文档按结论重排了 G2 的两半）**：
  > 另外 `--count-color` 的**计数相同不代表位置没变**：图 1 与图 2 的 `#00FFC8` 都是 **3366 px**，
  > 可挡板质心从 x=738 跑到了 x=212。若只按 SKILL §8③ 里「青挡板 ≈ 3366 px」这一条判「在动」，
  > 会得出**「两次都是 3366 → 没动」的错误结论**。
- **G3——没有 `scene save`，交付物落盘无法验证**：
  > 写命令只改内存。PITFALLS 里两处都提到 `unity node delete` / `--smoke` 「只改内存、不写场景文件」「不保存场景」。
  > SKILL §3.5 / §8 全程没有 `scene save` 这一步，`unity --help` 里也**没有**任何 `scene save` / `asset save` 命令。
  > 后果：**我搭出来的这个打砖块场景，理论上在编辑器退出后就没了**；我**无法用 `unity` 证明它已持久化**。
- **G4——输入兜底同样指向不存在的命令**：
  > 实测 `unity play key --action Press --key Space` → 退出码 **1**，`INPUT_SYSTEM_UNAVAILABLE`。
  > …SKILL/U16 给的替代路径（`execute-dynamic-code` 注入）**在 M2 命令面上不存在**（同 G1），
  > 所以我最终只能走「自动运行 + 截图差异」这条路。**这不是我放弃，是 SKILL 给的两条路一条被禁、一条不存在。**
- **G5——§3.5 的 24 次 `sprite set` 是注释不是循环**：
  > 代码块里只有 `#   例：unity sprite set --path Bricks/Brick_0_0 --color '#FF2E88'` 一行注释，
  > 循环体里**没有** `sprite set`。若字面照抄，24 块砖里只有 1 块有颜色、其余 23 块留在默认白（`#FFFFFF`）…
  > **建议 SKILL 把这段补成可执行循环。**
- **G6（次要，本次没踩到）**：`components` 的两种响应形状（内联 vs `componentsLut`+`componentsIdx`）——
  本次 29 节点 / 58 组件引用下 `components` 全部正确，说明该修复在此规模有效，但**不能证明大场景分支**。

**盲测自述里「SKILL 没写错」的部分**（同样照抄，作为「不是 skill 错」的反证）：§1 doctor 判据、§2 `verified` 语义、
§3 参数口径、§3.5 的世界尺寸/配色/坐标、§4 截图（中文窗口名 `游戏` 自动映射）、§8② 像素判据、§8⑤ 坐标公式
—— **逐条真机复现，全部与 SKILL 一致**（§8⑤ 的 `pixels --at 184,128` 实测 `rgb(255,46,136)`、`distance:0`）。

**独立复核报告对报告纪律的两处「证据完备性」提示**（复核者明确**不判假绿**）：

1. 图 3 `Rendering_20260919_135030_021.png` 报告写「**未单独目视**」——按判据 4「每张图都附 `read` 结论」的字面口径，
   这是唯一未满足的子项，但它是报告**主动披露**的；
2. `cmdlog.txt` 只有 **80 个 `EXIT=` 标记且全为 0**，末条是 `GameManager` 创建 —— **未覆盖 PlayMode 阶段**，
   故「118 条」这个总数**无法从留存产物完整复核**（复核者按判据 3 重跑同类命令，结论一致）。

### 2.3 四条判据的复核结果

**复核方式**：控制者/独立复核子代理**亲自跑**（不信盲测自述）；证据目录 `C:/Users/<用户>/pi-unity-spike/m2-verify-12/`（项目外，未改动仓库）。

| # | 结果 | 证据（命令 + 退出码 + 截图路径） |
|---|---|---|
| 1 | ✅ **PASS** | `unity scene tree --project-path $B --json` **EXIT=0**；`sceneName=SampleScene`、`nodeCount=29`、`roots=["Main Camera","Bricks","Paddle","Ball","GameManager"]`、`Bricks.children.length=24`（`Brick_0_0`…`Brick_5_3` 逐个核对无缺无重）、`Paddle`/`Ball` 带 `SpriteRenderer`、`GameManager.components=["Transform","PiBrickBreaker"]`。证据 `m2-verify-12/c1-scene-tree.json`（9821 B）、`c1-scene-tree.err`（0 B） |
| 2 | ✅ **PASS** | `play start` **EXIT=0**（`verified:true isPlaying:true blockedByUnsavedChanges:false compileErrorCount:0`）→ `shot --capture-mode rendering` **EXIT=0** → 图A `m2-verify-12/shots/Rendering_20260919_135244_562.png`（960×640，`windowName:"游戏"`）→ `pixels --count-color` ×6 **全 EXIT=0**：`#FF2E88`=**19648** / `#FFE94A`=**19648** / `#4DFF7A`=**19648** / `#FF7A2E`=**16352** / `#00FFC8`=**3366** / `#FFFFFF`=**676**（全部 > 0）；背景 `pixels --at 480,600 --expect '#0A0A14' --tolerance 48` **EXIT=0** → `match:true distance:0`；`read` 图A 结论：4 行砖阵（品红6/黄6/绿6/橙5）+ 青挡板底部偏右 + 白球中部偏右 + HUD `SCORE 1 LIVES 3 BRICKS 23` |
| 3 | ✅ **PASS** | `play logs --search-text '[BB]'` 两次（间隔 **6s**）**均 EXIT=0**：`totalCount` **14 → 18**，两次都含 `ready bricks=24 lives=3`，`hit brick=` **13 → 17** 条，最新一条从 `left=11` 走到 `left=7`；两张渲染图**同点** `pixels --at` 对比（图B `Rendering_20260919_135313_932.png`）4 点**全翻转**（`650,300` 白→背景；`589,560`/`589,700`/`589,730` 背景↔青）**全 EXIT=0**；`play logs --log-type Error` **EXIT=0** → `totalCount=0 logs=[]`；收尾 `play stop` **EXIT=0**（`verified:true isPlaying:false`），末次 `play status` 读回 `isPlaying=false` |
| 4 | ✅ **PASS**（附一处证据完备性提示） | `doctor --smoke` **EXIT=0**：compile / get-logs / get-hierarchy / write-create / write-set / write-delete / write-clean **7/7 pass**；`doctor --golden` **EXIT=0**：`matched:true`、`diff:null`、`cleanup={"status":"ok","path":"__pi_golden","recovered":false}`、两轮各 33 节点一致；`scene tree --json` 正则 `/__pi_/` 命中 **0**、`grep -rl "__pi_" $B/Assets` **无匹配**（退出码 1）；盲测报告 §1 逐条带退出码、§4 G1–G6 如实列出失败步骤。**提示**：图 3 未单独目视（报告自认，非假绿）、`cmdlog.txt` 未覆盖 PlayMode 阶段（见 §2.2 末） |

**「回写后重跑」（§3 步骤 4 要求）** —— 回写完 `SKILL.md` / `PITFALLS.md` 后，控制者**重跑了四条判据的全部复核命令**
（同一盲测项目 `C:/Users/<用户>/pi-unity-m2-blind`，编辑器 PID 38444 仍在；证据目录 `C:/Users/<用户>/pi-unity-spike/m2-verify-12-rerun/`）。
**未搭/删任何节点**，只跑读命令 + `play start/stop` + `doctor --smoke/--golden`（后两者自带临时节点读写回删）。

```bash
# 判据 1
$ node bin/unity.js scene tree --project-path $B --json            # EXIT=0
  sceneName=SampleScene  nodeCount=29  verified=null
  roots=["Main Camera","Bricks","Paddle","Ball","GameManager"]
  Bricks.children=24  Brick_0_0…Brick_5_3
  GameManager.components=["Transform","PiBrickBreaker"]

# 判据 2
$ node bin/unity.js play start --project-path $B --json            # EXIT=0  verified=true isPlaying=true blockedByUnsavedChanges=false
$ node bin/unity.js shot --project-path $B --capture-mode rendering --out $R/shots --json   # EXIT=0
  图A' = m2-verify-12-rerun/shots/Rendering_20260919_135641_893.png  960×640  windowName="游戏"
$ node bin/unity.js pixels --file <图A'> --count-color <C> --tolerance 16 --json ×6        # 全 EXIT=0
  #FF2E88=19648  #FFE94A=19648  #4DFF7A=19648  #FF7A2E=19648  #00FFC8=3388  #FFFFFF=676   ← 全部 > 0
$ node bin/unity.js pixels --file <图A'> --at 480,600 --expect '#0A0A14' --tolerance 48 --json   # EXIT=0
  match=true  sampled rgb(10,10,20)  distance=0

# 判据 3
$ node bin/unity.js play logs --project-path $B --search-text '[BB]' --max-count 30 --json  # EXIT=0
  totalCount=8   newest="[BB] hit brick=Brick_5_3 score=7 left=17"   hasReady=true  hitCount=7
$ sleep 6
$ node bin/unity.js shot --project-path $B --capture-mode rendering --out $R/shots --json   # EXIT=0
  图B' = m2-verify-12-rerun/shots/Rendering_20260919_135659_105.png
$ node bin/unity.js pixels --file <图A'>/<图B'> --at <点> --json ×6                        # 全 EXIT=0
  497,501（图A' 球心）  rgb(255,255,255) → rgb(10,10,20)     ← 球位移了
  492,588（图A' 挡板）  rgb(0,255,200)   → rgb(10,10,20)     ← 挡板位移了
  480,600（背景，与对象无关） rgb(10,10,20) → rgb(10,10,20)   ← 固定背景点证明不了位移（护栏成立）
$ node bin/unity.js play logs --project-path $B --search-text '[BB]' --max-count 40 --json  # EXIT=0
  totalCount=13  newest="[BB] hit brick=Brick_5_2 score=12 left=12"  hasReady=true  hitCount=12
$ node bin/unity.js play logs --project-path $B --log-type Error --json                     # EXIT=0
  totalCount=0  logs=[]
$ node bin/unity.js play stop --project-path $B --json             # EXIT=0  verified=true isPlaying=false

# 判据 4
$ node bin/unity.js doctor --project-path $B --smoke --json        # EXIT=0  ok=true mode=smoke
  pass compile(errors=0 warnings=0) / get-logs(total=0) / get-hierarchy(saved) /
  write-create(verified:true) / write-set(verified:true) / write-delete(verified:true) / write-clean(无残留)  ← 7/7 pass
$ node bin/unity.js doctor --project-path $B --golden --json       # EXIT=0
  ok=true matched=true diff=null cleanup={"status":"ok","path":"__pi_golden","recovered":false}
  轮1=33 节点 / 轮2=33 节点 / 两轮一致 / 清理无残留
$ node bin/unity.js scene tree --project-path $B --json            # EXIT=0  nodeCount=29  /__pi_/ 命中 0
$ grep -rl "__pi_" $B/Assets                                       # 无匹配（退出码 1）
$ node bin/unity.js play status --project-path $B --json           # EXIT=0  isPlaying=false（PlayMode 已收尾）
```

**重跑结论**：四条判据**全部仍然通过**（判据 1 结构一致；判据 2 六种颜色计数全部 > 0、背景 distance 0；
判据 3 两次日志 `8 → 13` 增长、`ready bricks=24` 在、同点采样球/挡板翻转而背景点不动、Error 0；
判据 4 smoke 7/7、golden matched+cleanup ok、无 `__pi_` 残留）——**修文档没有把结论改坏**。
`play stop` 已跑、`play status` 确认 `isPlaying=false`。

### 2.4 截图证据

**盲测子代理的 3 张**（`C:/Users/<用户>/pi-unity-blind-artifacts/shots/`，960×640，`captureMode:"rendering"`）

| 图 | 路径 | `read` 看到了什么（复核者亲自开图，不转述） | 像素数字 |
|---|---|---|---|
| 图 1 | `Rendering_20260919_135004_836.png` | 深蓝黑背景；**4 行砖阵**（品红6/黄6/绿6/橙**5**——橙行第 5 列缺 `Brick_4_3`）；**青挡板**底部偏右；**白球**中部偏右（约 722,400）；HUD `SCORE 1  LIVES 3  BRICKS 23`；无花屏、无整块 `#00FFFF` | `#FF2E88`=19648 / `#FFE94A`=19648 / `#4DFF7A`=19648 / `#FF7A2E`=16352 / `#00FFC8`=3366 / `#FFFFFF`=**625** / `#0A0A14`=534258 |
| 图 2 | `Rendering_20260919_135030_164.png` | 只剩 **6 块砖**（品红 5 + 黄 1），绿/橙行**全清空**；青挡板跑到**左下**（x≈212）；白球 (227,175)；HUD `SCORE 18  LIVES 3  BRICKS 6` | `#FF2E88`=16384 / `#FFE94A`=3264 / `#4DFF7A`=**0** / `#FF7A2E`=**0** / `#00FFC8`=**3366** / `#FFFFFF`=676 |
| 图 3 | `Rendering_20260919_135030_021.png` | 报告写「**未单独目视**」（用于证明「连续两帧也在变」，与图 2 相差 143 ms） | 带外 PIL 差分：图 3 vs 图 2 = **6089 px（0.99%）** |

**独立复核的 2 张**（`m2-verify-12/shots/`）

| 图 | 路径 | `read` 结论 | 像素数字 |
|---|---|---|---|
| 图A | `Rendering_20260919_135244_562.png` | 4 行砖阵（品红6/黄6/绿6/橙5）、青挡板底部偏右（约 x 589–741）、白球中部偏右（约 650,300）、HUD `SCORE 1 LIVES 3 BRICKS 23`；无错帧 | `#FF2E88`=19648 / `#FFE94A`=19648 / `#4DFF7A`=19648 / `#FF7A2E`=16352 / `#00FFC8`=3366 / `#FFFFFF`=**676**（=26×26，与盲测 625=25×25 的差是 25.6 px 取整方向不同） |
| 图B | `Rendering_20260919_135313_932.png` | HUD `SCORE 17 LIVES 3 BRICKS 7`；品红剩 5、黄剩 2、绿/橙全清空；青挡板底部中间；白球 (575,310) | `#4DFF7A`=0 / `#FF7A2E`=0 / `#FFE94A`=6528 / `#FF2E88`=16352（复核报告未单列 `#00FFC8`，同组图A 为 3366） |

**回写后重跑的 2 张**（`m2-verify-12-rerun/shots/`）

| 图 | 路径 | `read` 结论 | 像素数字 |
|---|---|---|---|
| 图A' | `Rendering_20260919_135641_893.png` | **24 块砖全在**（品红6/黄6/绿6/橙6）、青挡板底部居中（约 417–567）、白球约 (497,501)、HUD `SCORE 0 LIVES 3 BRICKS 24`（PlayMode 刚起步） | 四行各 19648；`#00FFC8`=**3388**；`#FFFFFF`=676；背景 `--at 480,600` `rgb(10,10,20)` distance 0 |
| 图B' | `Rendering_20260919_135659_105.png` | HUD `SCORE 12 LIVES 3 BRICKS 12`；品红 6、黄 5、绿 1、橙 **0**；白球约 (650,450)；青挡板**底部偏右**（约 592–742） | `#FF2E88`=19648 / `#FFE94A`=16384 / `#4DFF7A`=3264 / `#FF7A2E`=**0** / `#00FFC8`=**3366** / `#FFFFFF`=676 |

> 三批图的「砖块计数单调下降 + HUD 分数上涨 + `[BB]` 日志逐条吻合」互相印证；
> 挡板计数 3388 → 3366 只差 22 px，但同点采样证明它**真的位移了** —— 正是 §2.2 G2 那条护栏的现场复现。

### 2.5 结论

**四条判据全部通过**（复核 + 回写后重跑两次独立确认）：

| # | 判据 | 结果 |
|---|---|---|
| 1 | 结构 | ✅ PASS（29 节点、`Bricks` 24 子、`PiBrickBreaker` 在） |
| 2 | 画面 | ✅ PASS（4 行砖色 + 挡板 + 球计数全 > 0；背景 distance 0；看图确认） |
| 3 | 可动 | ✅ PASS（`ready bricks=24` + `hit brick=` 递增 + 同点采样翻转 + Error 0） |
| 4 | 纪律 | ✅ PASS（smoke 7/7、golden matched+cleanup ok、无 `__pi_` 残留、报告如实列失败） |

**盲测暴露的问题已按 §3 分类回写完毕**：

- **A 类（skill 缺信息）4 条，全部改在 `skills/unity-game-dev/SKILL.md`**：
  ① §8③ 删掉不存在的 `execute-dynamic-code` 指示、改为命令面真实可用的证据组合（`play logs` + 两次截图同点采样），并说明 `node inspect` 读不到脚本字段（无论公有私有）；
  并明确「M2 命令面没有动态执行命令，不要为此调裸 uloop」；② §8③ 补「`--count-color` 计数相同 ≠ 没动」护栏；
  ③ §3.5 的 24 次 `sprite set` 换成可直接复制的 bash 循环（4 行 × 6 列，颜色按行）；
  ④ §8⓪ / §5 补「PlayMode 需要已保存场景」（`sceneName` 空串就停下让用户保存，不裸 uloop）。
- **B 类（CLI 缺能力）3 条，只登记不修** —— 见 §3.2：`unity exec`（**✅ M3 已关闭**）、`unity scene save`/`scene open`（**✅ M3 已关闭**）、`unity pixels --diff`（仍 **M3 候选**）。
- **C 类（真机事实）3 条，已追加到 `docs/PITFALLS.md` 末尾、不写 U 编号**（编号交任务 13；**M2 已收口为 U1–U26，后续新增顺延**）：
  ① `--count-color` 计数相同不能证明画面没变；② `unity` 命令面没有动态执行 / 场景保存命令；
  ③ `unity pixels` 没有 diff / 质心 / bbox 子命令。
- **D 类（环境）**：模板解包后无 `ProjectVersion.txt` → 编辑器弹「不匹配的编辑器安装」模态框（准备阶段已处置），
  记在 §2.1；不改代码、不改 skill。

**两处证据完备性提示（不影响判据结论，不判假绿）**：图 3 未单独目视（报告主动披露）；
`cmdlog.txt` 只含 80 个 `EXIT=` 标记、未覆盖 PlayMode 阶段（「118 条」总数无法从留存产物完整复核，
复核者重跑同类命令结论一致）。**后续盲测建议**：要求原始 `cmdlog` 覆盖**全部**命令的退出码、每张图都写 `read` 结论。

**未改动 `lib/`、`bin/`、`test/`、`unity-scripts/`**（B 类新开任务）；未碰 `<真实工程>`。

## 3. 盲测暴露的问题怎么回写（**这是本任务真正交付的东西**）

1. **先分类**（不要混在一起）：
   - **A. skill 缺信息**（盲测 agent 不知道该干什么 / 猜错）→ 改 `SKILL.md`（补进 §3.5 配方、§8 验证配方、§5 停止条件或 §6 迭代上限）；
   - **B. CLI 缺能力 / 报错误导**（命令做不到、错误码/hint 指错方向）→ **新开一个任务修代码**（不在本任务里顺手改，避免无测试的改动混进盲测记录）；
   - **C. 真机事实与 skill 不符**（例如某颜色渲染出来不一样、坐标公式偏了）→ 改 skill 的配方 + 向 `docs/PITFALLS.md` **追加一条（不写 U 编号，R213；M2 已收口为 U1–U26，后续新增顺延）**（**必须标适用引擎**）；
   - **D. 环境问题**（网络、编辑器崩溃、uloop 版本）→ 记录到执行记录 §2.1，不改代码也不改 skill。
2. **每条回写都要有证据**：盲测报告里的原文 + 控制者复核命令 + 退出码。
3. **新坑一律先追加到 `docs/PITFALLS.md` 的**文件末尾**、不写 U 编号**（R213：避免 T7/T8/T12 抢注 U16+；**M2 已收口：U1–U26 定稿，后续新增顺延**）；每条逐字标 `[团结 2022.3.62t9 实测]` / `[Unity 官方未验证]`，并在**报告**里写「待编号的坑 + 一句话」。**编号与索引表统一由任务 13 定稿**。
4. **回写完成后重跑本任务的四条判据**（至少判据 1–4 的复核命令要重跑一遍），确认「修文档」没有把结论改坏。

### 3.1 待裁定登记（准备阶段发现，**只登记不处理**）

> 本小节只登记事实与候选分类，**不改 `SKILL.md`、不改 `lib/`/`bin/`/`test/`**；裁定交给盲测/回写阶段
> （§3 步骤 1–3）一起做。

| ID | 发现（事实） | 证据 | 候选分类 | 状态 |
|---|---|---|---|---|
| P1 | 模板项目首次打开时编辑器可能停在**未命名/未保存场景**（`scene tree` 的 `sceneName` 为空串），而 CLI 命令面**没有** `scene save` / `scene open`；此时 `play start` 会落 `CONTROL_PLAY_MODE_UNSAVED_CHANGES`，判据 2/3（需 PlayMode 的 rendering 截图）会**因环境原因**不可执行 | §2.1 ⑥（`sceneName: ""`）与 §2.1 ⑦（`sceneName: ""` → `"SampleScene"`；修复后 `play start` 的 `blockedByUnsavedChanges:false`）；`SKILL.md` §7 的 **U26** 行（回写时是预留号 U17）说「`CONTROL_PLAY_MODE_UNSAVED_CHANGES` → 先保存场景再进 PlayMode」，但命令面里**没有**保存/打开场景的命令 | **已裁定**：**A**（skill 缺信息）+ **B**（CLI 缺能力）**两者都成立** —— A 部分已回写 `SKILL.md` §8⓪ / §5 / §7；B 部分登记为 §3.2 的 M3 候选（**M3 已关闭**：`unity scene save` / `scene open`，见 §3.2 B2） | **已回写（A）/ ✅ 已关闭（B）** |

### 3.2 B 类登记：CLI 能力缺口（**只登记，不在本任务内修**）

> 依据 §3 步骤 1 的分类规则：**B 类 = CLI 缺能力 / 报错误导 → 新开一个任务修代码**。
> 因此本任务**不动 `lib/`、`bin/`、`test/`、`unity-scripts/`**，只把缺口登记清楚，作为 **M3 候选**。

| # | 缺口（现象） | 盲测原文引用 | 复核证据 | 阻碍的能力 | 去向 |
|---|---|---|---|---|---|
| B1（**已关闭**） | **`unity exec`（动态 C# 执行）缺失**：`unity` 命令面没有 `exec` / `eval` / `execute` / `dynamic-code`；`unity play` 子命令只有 `start\|stop\|pause\|step\|status\|click\|mouse\|key\|logs\|view`，读不回任意 C# 表达式。**报错误导**：`unity play key` 失败时 CLI 自己的 hint 指向「用 `execute-dynamic-code` 直接注入运行时状态」——那正是裸 uloop 的能力，`unity` 侧不存在 | G1：「我跑了 `unity --help`（exit 0）逐条核对 M2 命令面：…**没有 `exec`、`eval`、`execute`、`dynamic-code` 之类的命令**」；G4：「SKILL/U16 给的替代路径（`execute-dynamic-code` 注入）**在 M2 命令面上不存在**」 | `unity --help` 逐条核对（退出码 0）；本任务回写后重跑 §2.3 用的是 `play logs --search-text '[BB]'`（`score=` / `left=` 都在日志里）—— 退出码全 0，**证明缺 `exec` 不妨碍「可动」判据，只妨碍「任意运行期字段读回」** | **运行期状态读回**（`score` / `bricksAlive` 精确值） | **✅ 已由 M3 `unity exec` 关闭**（2026-09-19，分支 `m3-exec`）：新增 `unity exec (--code-file <f> \| --code <s>)`（脚本 `return` 值在 `actual.result`；读/执行命令 → `verified` 恒 `null`）；`play key` 的 hint 与 `lib/play.js` 两处残留 hint（R349）同步改指 `unity exec`，不再指向裸 uloop |
| B2（**已关闭**） | **`unity scene save` / `scene open` 缺失**：写命令只改内存、不写场景文件；命令面里没有任何保存 / 打开场景的命令。后果一：交付物（搭好的场景）**无法用 `unity` 证明已落盘**。后果二：`sceneName` 为空串（未命名 / 未保存场景）时 `play start` 落 `CONTROL_PLAY_MODE_UNSAVED_CHANGES`，且**无法自救** | G3：「SKILL §3.5 / §8 全程没有 `scene save` 这一步，`unity --help` 里也**没有**任何 `scene save` / `asset save` 命令」「我**无法用 `unity` 证明它已持久化**」；另见 §3.1 P1 | `unity --help` 逐条核对（退出码 0）；准备阶段实测 `sceneName: ""` → `play start` 会被挡（§2.1 ⑥⑦），用裸 uloop 保存场景后 `sceneName` 才变 `"SampleScene"` | **交付物落盘** 与 **进 PlayMode 前的场景准备** | **✅ 已由 M3 `unity scene save` / `scene open` 关闭**（2026-09-19，分支 `m3-scene`）：`scene save` 写后读回 `scene tree` 的 `sceneName` 比对（`verified` 布尔），不给 `--path` 保存全部打开场景；`scene open` 脏场景且无 `--force` → `DIRTY_SCENE`（退出码 1，不静默丢改动）。真机证据（blind 项目）：用 CLI 重建 29 节点后 `scene save` → `Assets/Scenes/SampleScene.scene` 的 md5 `44ff180d…` → `5a08a69a…`、`grep -c "Brick_"` **0 → 24**、size 12009 → 68872 B，保存后 `scene tree` 仍 29 节点、`--golden` 仍 `matched:true`；脏场景（`isDirty=True`，用 `MarkSceneDirty` 复现）下 `scene open` 无 `--force` → `DIRTY_SCENE`（退出码 1）+ 给两条出路，`--force` 才丢弃改动。⚠️ **本任务的真机验证又撞上一次 B2 本身**：编辑器在验证开始前（17:56–17:57）**自行退出**（`Editor.log` 是干净的 `Application.Shutdown`，非崩溃），那份「重建但从未落盘」的 29 节点场景**再一次消失** —— 只能按 R351 先例拉起编辑器 + 用 CLI 重建（`node create`/`set`/`sprite set` 共 81 条，全 exit 0）。另暴露 **U27（高）**：动态代码的改动**不置 `isDirty`** → `SaveOpenScenes()` 返回 true 却**不写盘**（修复前 `scene save` 假绿）→ 已改为逐场景 `SaveScene` + 核对文件 mtime；SKILL §3.5 已把 `scene save` 写成强制末步，§8⓪ / §5 / §7 同步改掉「让用户手工保存」的旧说法 |
| B3 | **`unity pixels --diff`（可选）缺失**：`pixels` 只有 `--at` / `--region` / `--count-color` / `--expect`，**没有 diff / 质心 / bbox**；「画面变没变」在 `unity` 侧没有一等公民判据 | G2：「`unity pixels` 只有 `--at` / `--region` / `--count-color` / `--expect`（`unity --help` 逐字核过）。**没有 diff、没有质心、没有 bbox。**…我**没有**用 `unity` 完成这一步，而是用**带外的 `python + PIL`** 算了差分与质心」 | `unity --help` 逐条核对（退出码 0）；盲测的「64225 px（10.45%）」「连续两帧 6089 px（0.99%）」「质心表」全部来自 `python + PIL`；复核用 `--count-color` + `--at` 同点采样**独立复现了结论**，但**差分比例本身无法用 `unity` 复算** | **「画面变没变」的一等公民判据** | **M3 候选**：`unity pixels --diff <pngA> <pngB>`（可选返回差异像素数与比例）；**本任务内**已把「可用组合 + 必须声明差分是带外算的」写进 SKILL §8③ 与 `docs/PITFALLS.md` 末尾 |

**结论**：B1–B3 **均不在本任务内修**（§3 步骤 1 的分类规则）；本任务只做 skill 侧回写（A 类）与登记（B 类），
使盲测暴露的问题**不依赖未交付的 CLI 能力也能被 skill 正确处置**。修代码由**新开的任务**承接（M3 候选）。

> **M3 更新（2026-09-19，分支 `m3-exec` / `m3-scene`）**：**B1 已由 `unity exec` 关闭**（`lib/dynamic.js` + `bin/unity.js` 的 exec handler + `test/dynamic.test.js`）；
> **B2 已由 `unity scene save` / `scene open` 关闭**（`lib/scenefile.js` + `unity-scripts/scene-save.cs` / `scene-open.cs` + `test/scenefile.test.js`；
> SKILL §3.5 / §8⓪ / §5 / §7 同步改写）；B3（`unity pixels --diff`）仍为 **M3 候选**。
>
> **`m3-scene` 的真机新发现（已登记 `docs/PITFALLS.md` U27，高）**：`execute-dynamic-code` 里的场景改动
> **不置 `Scene.isDirty`**（实测 roots 5→6 而 `isDirty` 仍 False）⇒ ① `EditorSceneManager.SaveOpenScenes()`
> 只保存 dirty 场景，因此**返回 true 却一个文件都不写**（修复前 `scene save` 报 `verified:true` 而 md5 未变 —— 假绿）；
> ② `scene open` 的 `DIRTY_SCENE` 守卫（与上游 `EditorUnsavedChangesQuietSaver` 同源，也是 `play start`
> 未保存检测的依据）**看不见 CLI 自己造的改动**。处置：`scene save` 改逐场景 `SaveScene(scene, scene.path)`
> + 写后核对**文件 mtime 前进**；「给写脚本补 `MarkSceneDirty`」因会改变 `play start` 的写盘行为（静默保存脏场景）
> 而**留给下一步裁定**。
