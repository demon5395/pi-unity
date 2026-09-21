# ce-REPORT —— ⑨ 用户真实工程的**静态只读**兼容评估（未打开、未修改）

**日期**：2026-09-21
**对象**：`<真实工程>`（注意**双层**目录；外层是容器）
**方式**：**只读文件系统扫描**（`ls`/`cat`/`grep`/`find`）。**未打开编辑器、未改任何文件、未装任何包。**
**为什么是静态**：backlog ⑨ 想要 `doctor` + `scene tree`，而这两者都要经 **uloop** 连编辑器；该工程**没有** uloop（见下），连上必须往它的 `Packages/manifest.json` 加包 = **修改工程**，与「绝不碰 `<真实工程>`」冲突。

## 1. 关键事实

| 维度 | 值 | 证据 |
|---|---|---|
| 引擎 | **团结引擎 `2022.3.62t9`**（`m_TuanjieEditorVersion: 1.9.1`） | `ProjectSettings/ProjectVersion.txt` |
| Active Input Handling | `activeInputHandler: 0`（**Old Input**）→ `play key/mouse` 不会可用 | `ProjectSettings/ProjectSettings.asset:962` |
| 依赖 | 40 项，含 `com.unity.2d.sprite@1.0.0`、`com.unity.textmeshpro`、`com.unity.timeline`、`com.unity.ugui`、`com.unity.ads`、`com.unity.ai.navigation`、团结专属 `com.unity.modules.infinity` | `Packages/manifest.json` |
| **uloop** | **无**（manifest 里无 `io.github.hatayama.uloopmcp`） | `grep -i uloop` → 空 |
| 资产规模 | 4 场景 / **172 Prefab** / **296 PNG** / **1018 `.cs`** / 3520 `.meta` | `find Assets` |
| 场景 | `Assets/CreateUI.unity`、`Assets/CreateUI3D.unity`、`Assets/Scene/allMap/ui/ThirdPartyUI.unity`、`Assets/Sprite/Game.unity` | `find` |
| `Library/` | 存在（888 MB）→ 开编辑器不会冷导入 | `du` |

## 2. 兼容性判断（静态、非实测）

- pi-unity 的兼容性基线**正是团结 2022.3.62t9**（`docs/CAPABILITIES-tuanjie-2022.3.62t9.md`、Q2 验证）→ 命令面**结构上适配**该引擎。
- 工程已有 `com.unity.2d.sprite` → `unity asset import` / `sprite assign` 的 Sprite 面无须额外装包。
- 1018 个 `.cs` → 首次编译可能较慢；`unity compile` 用 `--timeout-seconds` 放宽即可。
- 4 个场景均为 `.unity`（团结侧 `.scene`/`.unity` 均可，见 U10；本工程用 `.unity`）。
- `activeInputHandler: 0` → 真实输入注入（C-D 那套）在本工程上**不会**开箱可用。

## 3. 阻塞与选项（需用户决策）

**阻塞**：连上唯一途径是往该工程 `Packages/manifest.json` 加 uloop（+ 触发一次包解析/编译）——**这是修改**。

| 选项 | 做法 | 代价 / 风险 |
|---|---|---|
| **1 跳过（现状）** | 不动工程 | ⑨ 保持「未实测」，但**零风险**；本报告已给出静态结论 |
| **2 临时装 uloop 连一次** | 备份 manifest → 加 `io.github.hatayama.uloopmcp`（`file:` 指向 vendor）→ 开编辑器 `doctor`+`scene tree` → 还原 manifest | 会**改工程**（加包 + 包解析）；7.9 GB 工程重开有耗时；**需明确授权**，且要接受「改过」 |
| **3 拷副本再连** | 复制到临时目录（7.9 GB + Library 888 MB）加 uloop 后连 | 验的是**副本**非原件；磁盘/时间成本高 |

## 4. 结论

- 静态看：这是一个**结构正常、且正好落在 pi-unity 兼容基线上**的团结工程；`doctor`/`scene tree` **很可能**能跑通，但**未经实测**，本报告**不宣称**它能跑通。
- 要把它从「很可能」变成「实测」，只能在选项 2/3 中选一个并授权 —— 在拿到授权前，⑨ 按纪律**保持未做**。

---

## 5. ✅ 实测（选项 2：临时装 uloop，读只读，验完还原）

**用户已明确授权**后执行（2026-09-21）：

1. 备份 `Packages/manifest.json` + `Packages/packages-lock.json` → 加 `"io.github.hatayama.uloopmcp": "file:C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp"`（依赖 42→43）。
2. 用**团结编辑器** `<引擎安装目录>/2022.3.62t9/Editor/Tuanjie.exe` 打开该工程。
3. **只读**跑 `unity doctor`（`ce-10-doctor.json`）与 `unity scene tree`（`ce-11-tree.json`）。
4. 关编辑器 → **还原** `manifest.json` + `packages-lock.json` → 删除 `.bak`（校验：依赖数 **42**、`uloop` 计数 **0**）。

| 命令 | 结果 |
|---|---|
| `unity doctor` | **`ok:true`，5/5 pass**：`uloop`（dispatcher）、`editor-install`（**2022.3.62t9** 团结）、`editor-language`（zh_CN）、`build-targets`（**AndroidPlayer / WeixinMiniGameSupport / windowsstandalonesupport**）、`editor-connection`（uloop 3.4.0） |
| `unity scene tree` | **`ok:true`**：活动场景 `ThirdPartyUI`、`nodeCount:22`、`maxDepth:3`；根 `Camera / EventSystem / VersionUpdatePanel / GameStart / CoreRoot` |

**结论：pi-unity 在用户的真实 7.9 GB 团结工程上读面可用（doctor + scene tree 实测通过）。**

**副作用（如实）**：打开编辑器会（团结/Unity 固有行为）刷新 `Library/`、`Temp/`、`Logs/` 等派生目录；本次唯一**源级**改动是 `Packages/manifest.json`（已还原）。未保存任何场景、未改任何 Assets。
