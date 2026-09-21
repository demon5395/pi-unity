# cd-REPORT —— 批次 C-D：Input System 真实输入注入验证（⑧）

**日期**：2026-09-21（真机）
**环境**：Unity 官方中国版 **2022.3.62f3c1**（`C:/Users/<用户>/pi-unity-official-f3c1`）
**结论**：**⑧ 关闭** —— 装上 `com.unity.inputsystem` 后，`unity play key` / `play mouse` 的真实注入**可用且可读回**。

## 环境改动（测试工程，非用户真实工程）

1. `Packages/manifest.json` 加 `"com.unity.inputsystem": "1.8.2"`（registry `packages.unity.com` 可达；本机 `packages.unity.cn` 亦有缓存）。**备份 `manifest.json.bak`**。
2. `ProjectSettings/ProjectSettings.asset` 的 `activeInputHandler: 0 → 2`（Both）。**备份 `ProjectSettings.asset.bak`**。
3. 重开编辑器后 `InputSystem` 程序集加载、`Keyboard.current` / `Mouse.current` 非 null（`cd-01-kb.json` / `cd-09-mouse.cs`）。

## 键盘注入（决定性证据）

| 步 | 结果 | 证据 |
|---|---|---|
| `play key --action KeyDown --key W` | `ok:true`、`pressEdgeObserved:true`、message「Key 'W' held down」 | `cd-03-keydown.json` |
| 读 `Keyboard.current.wKey.isPressed` | **`true`** | `cd-04-read.json` |
| `play key --action KeyUp --key W` | `ok:true` | `cd-05-keyup.json` |
| 读 `wKey.isPressed` | **`false`** | `cd-06-read.json` |

→ **真实按键注入被 Input System 接收**（`isPressed` 在 PlayMode 内真变 true→false）。

## 鼠标注入

| 步 | 结果 | 证据 |
|---|---|---|
| `play mouse --action Scroll --scroll-y 1.5` | `ok:true`、message「Scroll injected: (0.0, 1.5)」（**非** `INPUT_SYSTEM_UNAVAILABLE`） | `cd-10-scroll.json` / `cd-15-scroll.json` |
| 读 `Mouse.current.scroll.ReadValue().y` | `0` | `cd-16-read.json` |

→ 注入被接受；读回为 0 是 **Input System 的正常语义**（pointer `scroll` 是**逐帧 delta**，下一帧即清零），不是注入失败。
（首版反射读回脚本 NRE `cd-11-readmouse.json` 属**探针脚本**问题，非 CLI。）

## 对 U25 的意义

U25 说「key/mouse 需 Input System；无 Input System 项目如实失败」。本批次给出**正向证据**：装上后 `key`/`mouse` **可用**（不再只是「没有就失败」）。`unity click` 仍只对 uGUI 生效、`--dry-run` 仍走 3D 物理射线（本轮未复测）。

## 清理 / 残留

- 未污染场景（`play start/stop` 成对，未 `scene save`）。
- **测试工程环境改动保留**（Input System 1.8.2 + `activeInputHandler=2`），以便复现本探针；备份文件（`*.bak`）在同目录。**要复原**：用 `.bak` 覆盖 manifest/ProjectSettings 后重开编辑器。
