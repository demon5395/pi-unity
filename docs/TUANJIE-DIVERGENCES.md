# 团结引擎 vs Unity 官方 —— 差异清单

> **为什么需要这份文件**：本项目在**团结引擎**上做真机验证（D6），但设计目标是**兼容 Unity 官方版**（Q2）。
> 若不逐条记录差异，SKILL / PITFALLS 里的结论会被**错误归属**——把团结特有行为当成 Unity 通用行为。
>
> **证据分级**：`[已实测]` = 本机实测；`[未验证]` = 推断，本机**没有装 Unity 官方版**无法对比。

---

## A. 已实测的差异

| # | 项 | Unity 官方 | **团结引擎** | 证据 |
|---|---|---|---|---|
| D-1 | 场景文件扩展名 | `.unity` | **`.scene`** | `S0Project/Assets/Scenes/SampleScene.scene` |
| D-2 | 场景/资产 YAML 标签 | `%TAG !u! tag:unity3d.com,2011:` | **`%TAG !u! tag:yousandi.cn,2023:`** | 场景文件 + `.dwlt` 布局文件均有 |
| D-3 | 播放器核心 DLL | `UnityPlayer.dll` | **`TuanjiePlayer.dll`** | `build/win64/TuanjiePlayer.dll` (44 MB) |
| D-4 | 崩溃处理器 | `UnityCrashHandler64.exe` | **`TuanjieCrashHandler64.exe`** | `build/win64/` |
| D-5 | 编辑器可执行 | `Unity.exe` | **`Tuanjie.exe`** | `D:\devsoft\unity\unitySoft\2022.3.62t9\Editor\Tuanjie.exe` |
| D-6 | 版本号格式 | `2022.3.x f1` | **`2022.3.62t9`** + Tuanjie Editor **`1.9.1`** | `ProjectVersion.txt` 的 `m_TuanjieEditorVersion` |
| D-7 | Hub 配置目录 | `%APPDATA%\UnityHub` | **`%APPDATA%\TuanjieHub`** | 实测 |
| D-8 | 编辑器数据目录 | `%APPDATA%\Unity` | **`%APPDATA%\Tuanjie`** | 实测 |
| D-9 | 编辑器日志 | `%LOCALAPPDATA%\Unity\Editor\Editor.log` | **`%LOCALAPPDATA%\Tuanjie\Editor\Editor.log`** | 实测 |
| D-10 | 包 registry | `packages.unity.com` | 额外有 **`packages.unity.cn`**（0.32s，比官方快一个量级） | 实测可达 |

### ⚠️ D-11（最高风险）：EditorPrefs 注册表根**相同**

```
HKCU\Software\Unity\UnityEditor\<company>\<product>
```

**团结引擎用的是 `Unity` 这个注册表配置单元，不是 `Tuanjie`。**`[已实测]`

**影响**：若同一台机器同时装了 Unity 官方版与团结引擎，**两者会共享 EditorPrefs**——
窗口布局、偏好设置、last-used 设置可能互相覆盖或冲突。

**行动**：`doctor` 应检测「是否同时存在 Unity 官方版与团结」（D-12），若存在则警告。

### ⚠️ D-12（未验证但需检查）：同装时的相互影响

本机**只有团结引擎**，无法验证同装场景。需在 `doctor` 里做成**主动检测 + 警告**，而非静默。

---

## B. 已确认**相同**的点（好消息）

| 项 | 结论 | 证据 |
|---|---|---|
| 脚本 API / 程序集 | 团结 2022.3.62t9 = Unity 2022.3 LTS 血统，`UnityEngine.*` / `UnityEditor.*` 命名空间不变 | uloop 的 44 个 asmdef 全部编译通过 |
| 编辑器扩展机制（`EditorWindow` / `Editor`） | 相同 | uloop 包正常加载并自动生成 `.uloop/` |
| 布局文件内的窗口类名 | **locale 无关**：`GameView` / `SceneView` / `ProjectBrowser` | `.dwlt` 实测 |
| UPM 包机制（`manifest.json` / `file:` / git URL） | 相同 | `file:` vendor 安装成功 |
| EditorPrefs 存储机制 | 相同（连注册表根都一样） | D-11 |

---

## C. 对本项目设计的具体影响

| 差异 | 影响的设计点 | 处理 |
|---|---|---|
| D-1 / D-2 | 任何扫 `Assets/**/*.unity` 或正则匹配 `tag:unity3d.com` 的代码**必然失败** | **不要硬编码扩展名**：走 `EditorBuildSettings.scenes` 或 `AssetDatabase.FindAssets("t:Scene")` |
| D-3 / D-4 | 依赖/产物检查若写死 `UnityPlayer.dll` 会失败 | 用通配或读 `report.summary` |
| D-5 | `uloop launch` 只找 `Unity.exe` → **团结上不可用**（PITFALLS U6） | `doctor`/`launch` 自实现编辑器发现（见 O5 决策） |
| D-6 | 版本比较不能按 Unity 的 `x.y.zfN` 解析 | 同时读 `m_EditorVersion` 与 `m_TuanjieEditorVersion` |
| D-7 ~ D-9 | 所有路径发现逻辑要按引擎分叉 | 统一走「配置根」抽象，不散落硬编码 |
| D-11 | 同装时会共享 EditorPrefs | `doctor` 主动检测 + 警告 |
| D-10 | registry 选择可能与官方版不同 | 优先国内镜像，失败回落 |

---

## D. 维护约定

1. **新增 PITFALLS 条目时必须标注**：该结论是在**团结**上实测的，是否已确认在 Unity 官方版同样成立
2. 若将来装了 Unity 官方版，**本文件所有 `[未验证]` 项应逐条复核**
3. 本文件不是「团结不好」的清单——D-2/D-3 这类重命名属于品牌化，**功能等价**。真正的风险是**硬编码 Unity 约定的代码**
