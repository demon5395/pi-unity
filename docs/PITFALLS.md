# pi-unity 踩坑记录

> 实测结论，每条附证据与实测日期。按发现顺序编号（**U 前缀**，与 pi-cocos 的 P1–P63 区分）。
> 仅记录**会重复踩到**的坑；一次性的环境噪声不收。
>
> **适用引擎标注口径（F7）**：**U11 起逐条标注适用引擎**；**U1–U10 没有**
> 「适用引擎」行（多为引擎版本无关 —— **U7 / U9 / U10 例外**，它们本身随引擎/安装环境而变）。不要在别处声称「每条都标注了适用引擎」。
>
> **M2 编号收口（R213，2026-09-19）**：U16–U24 是 M2 各任务按**发现/追加顺序**补的既有条目，
> U25/U26 是收口任务新补的两条；索引表与 `skills/unity-game-dev/SKILL.md` §7 的引用已同稿对齐。
>
> **M4 编号收口（任务 7，2026-09-20）**：`docs/M4-SPIKE.md` 的 `NEW-1`…`NEW-7` → **U28–U34**（按简报
> 表顺序）；**我们自己的 PNG 支持面限制 = U35**；任务 3–6 的真机新发现 → **U36–U45**；
> **最终修复波（R475/R477）新发现 → U46–U47**；
> 克隆 / `.meta` 交付结论按 M4-SPIKE 先例单列 `### M4：…`（**不抢 U 编号**）。
> ⚠️ **U28–U34 中，仅 U29 仍未在官方 2022.3 上验证** —— **U28/U31/U32/U33 已由批次 C-A（2026-09-20）官方 2022.3.62f3c1 复测**（见各条「适用引擎」行），U30 已由 R476 复核，U35 引擎无关。
> **不要**把未复测的条目写成「两者」。
> **例外（R476，2026-09-20 收紧）：U30 已在官方 2022.3.62f3c1 上复核** —— 「两套 id」只在团结新导入资产上成立，
> 官方版实测 `.meta` 的 `guid:` 与 YAML 引用的 32-hex 是**同一个字符串**；该条已按引擎分开标注。

## 索引

| # | 坑 | 严重度 | 状态 |
|---|---|---|---|
| U1 | `package.openupm.com` 本机不可达 → uloop 官方安装命令必失败 | 高 | 已有绕法 |
| U2 | codeload/git 方式 vendor 会缺空目录，Unity 报 `.meta` 警告 | 低 | 无害，自愈 |
| U3 | GitHub API 的 `size` 字段是仓库体积，不是 tarball 体积（差 20 倍） | 中 | 已知 |
| U4 | 原生 Windows Python 无法解析 MSYS 的 `/tmp/...` 路径 | 中 | 已有绕法 |
| U5 | 上游 README 的工具面与实测不一致（19 vs 21，且缺 watch 子系统） | 中 | 以 `tools.json` 为准 |
| U6 | `uloop launch` 只搜 Unity Hub 路径 → **无法启动团结引擎** | 中 | 手动启动即可，连接不受影响 |
| U7 | `screenshot --window-name Game` 在**中文编辑器**上失效（按标题字符串匹配） | 中 | 用本地化名或进 PlayMode |
| U8 | EditMode 下通过 dynamic-code 加的 **`UnityEvent` lambda 监听器进 PlayMode 丢失** | **高** | 必须运行时添加 |
| U9 | **构建目标不是全的**——取决于安装时勾选的 PlaybackEngines（本机 **WebGL 未装**） | 高 | 需先确认/安装模块 |
| U10 | **团结引擎与 Unity 官方的文件/产物差异**（`.scene` / `yousandi.cn` tag / `TuanjiePlayer.dll`） | **高** | 任何硬编码 Unity 约定的代码都会挂 |
| U11 | 冒烟/读回依赖**上游响应字段名与 CLI 参数名**，改名不报错、只会静默变 `?`/fail | 中 | 字段缺失即 fail（R38）；真机对账 ✅ 2026-09-19 |
| U12 | 上游失败有**两种形状**：first-party 工具级**平铺** `{Success:false,Message,NextActions}` / dispatcher 级**嵌套** `Error:{ErrorCode,...}` | 中 | `fromUloop` 两种都认（R108） |
| U13 | `AddComponent` 对**抽象/不可实例化类型**不抛异常、而返回 `null` → 旧码报成功且场景留残骸 | 中 | 已修：判返回值 + 清理（R106） |
| U14 | `uloop list`（**dispatcher 级**命令）的响应**没有** `Success` 字段 → 拿 first-party 工具的 `Success===true` 判据做探活会**假红** | 中 | 已修：按 `{Version,Tools}` 形状判（R115） |
| U15 | 写后读回的绝对容差 `1e-4` 在 float32 大坐标上必然 `verified:false`（**假红**，不等于写入失败） | 中 | 已知取舍；反向验证用 `100000.123`（**不要用 `1e30`**） |
| U16 | 用 `execute-dynamic-code` **退出编辑器**会报 `UNITY_DISCONNECTED_AFTER_ACCEPT`（命令其实已执行） | 中 | 看进程表，别重试（任务 3 实测） |
| U17 | 首次创建 sprite 后紧随的 `unity shot` 可能拿到整块 `#00FFFF` 的错帧（1 次，未复现） | 中 | `--count-color` 报 0 先再截一张，别急着放宽 tolerance（任务 5 实测） |
| U18 | `control-play-mode` 在**跨 domain reload 的** `Play`/`Stop` 调用上不回 `Success` → `unity play start/stop` 曾假红 | 中 | 已修：仅 `playMode` 窄口径认形状（`ce8df19`）；权威判据是 `play status`（任务 7 实测） |
| U19 | `uloop compile` 在**编译有错时回 `Success:false`**（不是 `Success:true`）→ 直接走 `fromUloop` 会丢掉 `Errors[]` | **高** | 已修：先按「计数是数字且（`Success:true` 或 `Errors` 是数组）」认确定形状（任务 8 实测） |
| U20 | EditMode 用 `unity sprite set` 挂的**运行时 sprite** 进 PlayMode 会丢（`spriteName` 变 null → 方块一个像素都不渲染） | **高** | 模板 `EnsureSprites()` 兜底，或进 PlayMode 后再 `sprite set`（任务 11 实测） |
| U21 | `get-hierarchy` 有**两种响应形状**：小场景内联 `components`，大场景 `componentsLut`+`componentsIdx` | **高** | 已修（R316）：`normalizeHierarchy` 解析两种形状（任务 11 实测） |
| U22 | `--count-color` 计数相同**不能**证明画面没变（挡板 3366→3366 px，质心却位移 526 px） | **高** | 判位移要跨图**同点/同区域**采样；已写进 SKILL §8③。**M4 增补：** 计数在 `actual.count.count`（`actual.count` 是对象）；`count>0` 也不构成归属（要挪开 + 负对照）（任务 12 盲测实测） |
| U23 | `unity` 命令行面曾**没有**动态执行命令（**M3 已交付 `unity exec`**），也**没有** `scene save`/`scene open`（**M3 已交付**） | **高** | 运行期状态用 `unity exec`（值在 `actual.result`）或 `play logs`；交付物落盘用 `unity scene save`（写后读回 `sceneName`；不给 `--path` 保存全部打开场景），切场景用 `unity scene open`（dirty 需 `--force`） |
| U24 | `unity pixels` 只有 `--at`/`--region`/`--count-color`/`--expect`，**没有** diff/质心/bbox | 中 | **已关闭（批次 A，2026-09-20）**：`unity pixels` 已有一等公民 `--diff` / `--centroid` / `--bbox`，差分/质心/包围盒不再需要带外工具（任务 12 盲测实测） |
| U25 | 输入模拟的**可用性边界**：`key`/`mouse` 需 Input System；`click` 只对 uGUI 生效；`--dry-run` 走 3D 物理射线 | **高** | 无 Input System 项目**如实失败**；打砖块模板用自动玩法绕开（任务 7/12 实测）；**装上 Input System 1.8.2 后 `key`/`mouse` 可用**（C-D 真机：`wKey.isPressed` true→false、`mouse scroll` 注入被接受，见 `docs/m5-probes-raw/cd-REPORT.md`） |
| U26 | `unity play start` 与**未保存场景**：未命名场景落 `CONTROL_PLAY_MODE_UNSAVED_CHANGES`；**内存有未保存改动、磁盘文件干净**时 `Play` 未观测到写盘（真正 dirty 未验证） | 中 | 用 `unity scene save` 主动落盘（M3；写后读回 `sceneName`）；dirty 场景是否静默保存**未验证**（任务 7/12 实测） |
| U27 | 动态 C# 代码的场景改动**不置 `Scene.isDirty`** → `EditorSceneManager.SaveOpenScenes()` 返回 true 却**不写盘**（M3 任务 2 真机实证：「报告成功 + 静默不落盘」）；`scene open` 的 `DIRTY_SCENE` 守卫对 **CLI 自己造的**改动也失明 | **高** | 已修 `scene save`：不用 SaveOpenScenes，逐场景 `SaveScene` + **核对文件 mtime 前进**（没前进 → `SAVE_FAILED`）；用 `scene open` 前先 `scene save`；给写脚本补 `MarkSceneDirty` **待裁定**（会改变 `play start` 的写盘行为） |
| U28 | `TextureImporter` **没有** `spriteMeshType`/`spriteExtrude`/`spriteAlignment` → 必须 `TextureImporterSettings` 往返 | 中 | 已按此实现（`asset import`）；`SpriteMeshType` / **`SpriteAlignment` 都在 `UnityEngine`**、`spriteExtrude` 是 `uint` |
| U29 | 外部进程写进 `Assets/` 的文件**不会**被自动导入（必须显式 `ImportAsset`） | 中 | `asset import` 已内置 `ImportAsset`（89 ms）；**不要**借 `asset write`+compile 的副作用 |
| U30 | `.meta` 的 `guid:` 与引用用的 32-hex 的**关系随引擎而异**：团结**新导入**资产是**两套 id**（`.meta` = 56 字符 base64）；**官方 2022.3.62f3c1 实测是同一个字符串**（R476 收紧） | 中 | 手改 `.meta` 的 guid 在团结上不改变引用 id；交付时 `.meta` 必须与资产同批（见 `### M4：…`）。**别把「两套 id」当普遍规律** |
| U31 | **默认导入设置随引擎/工程模板变**（团结=Sprite/压缩/Bilinear/PPU=100/Tight；官方 3D 模板=`Default`/`alphaIsTransparency=false`/`npotScale=ToNearest`） | **高** | 像素画必须逐项显式设置（`unity asset import`） |
| U32 | `maxTextureSize` 小于源尺寸会**静默缩放**（24×16 + 8 → 8×5） | 中 | `--max-size` 自动抬到 ≥ 源尺寸的 2 的幂 + 读回真实尺寸 |
| U33 | `alphaIsTransparency=true`（团结默认）会**改写透明像素 RGB**；`alphaSource=None` 是**丢弃 alpha** | **高** | 像素处理只在 **Node 侧**（`--remove-bg`/`--trim`） |
| U34 | `spriteMeshType=Tight`（默认）**不裁剪几何**（与 FullRect 全同）→ 不能用它裁边 | 中 | 裁边用 Node 侧 `--trim`；与 Unity 官方文档预期不同（官方 2022.3.62f3c1 已复测，见 B-2） |
| U35 | **本包 PNG 支持面**：只吃 bitDepth 8 / colorType 0,2,4,6 / 非隔行；调色板与隔行落 `BAD_PNG` | 中 | 另存为 PNG-24/32（非隔行）再导入 |
| U36 | 默认 `shot` 是 **window 模式**：图尺寸由 Game 窗口决定（960×640 → **892×355**） | **高** | 几何对账/可见性判据显式 `--capture-mode rendering`（需 PlayMode） |
| U37 | `scene save --path X` 是 **Save-As**（当前活动场景另存到 X 并成为活动场景） | **高** | **别**对用户的验收场景用它；要覆盖原本的路径就不带 `--path` |
| U38 | `GameObject.Find` **找不到非激活对象**（返回 `null` → 脚本 NRE） | 中 | 按路径查用 `GetRootGameObjects()`（含 inactive）/ `FindObjectsOfType<Transform>(true)` |
| U39 | `prefab create --force` 是「**更新**」不是「重建」：三条跟随规则（根 `localPosition` **永不跟随**） | 中 | 见 USAGE 的 `prefab create` 段；落盘证据 `docs/M4-PROBES.md` §②-8 |
| U40 | `SaveAsPrefabAsset` **不把源节点变成实例**；实例化**沿用资产生成时的位姿**（多实例叠一起） | 中 | 要联动就 `prefab instantiate`；建完显式 `node set` 摆开 |
| U41 | **用文件名覆盖 Prefab 根名**（连文件内 `m_Name` 都不算数） | 中 | 读写都以 `AssetPathToGUID` / 资产读回为准 |
| U42 | 同父**多个同名实例**时 `node inspect` 只能定位到其中一个（**不会**自动加 `' (1)'`）**（订正：已可用 `--sibling-index <真实子序号>` 唯一定位，见 U50）** | 中 | 用 `--sibling-index` 或 `--name` 区分；多实例验收必须给不同名 |
| U43 | **`--world-size` 依赖 `SpriteRenderer.bounds`（世界 AABB）**：**旋转（已实测）/ 非均匀父级缩放（部分实测）会让它（预期地）落 `verified:false`**；`Tight`/`Sliced`/`Tiled` 与图集对这条判据的影响**未探测**（`Tight` 并不裁几何，见 U34）**（订正：`Tight` 与 FullRect 全同、`Sliced`/`Tiled` 会分叉落 `verified:false` —— 已由 B-2 真机钉死，见 U52；图集（SpriteAtlas）已由 C-C 钉死：打包不改 `Sprite.bounds`/`assetPath`、`--world-size` 仍 `verified:true`）**；图集（Multiple）→ `AMBIGUOUS_SPRITE`（退出码 1，**硬失败**）；Overlay Canvas 的「世界尺寸」≠ 屏幕像素 | 中 | 只用 `asset import` 出的 `FullRect`+`Single`；尺寸以 `node inspect` 的 `sprite.worldSize` 为准，几何判据用 `shot`+`pixels` |
| U44 | payload 类命令的 `.cs` **编译错报文不可读**（只落 `ULOOP_ERROR` 无 Message） | 中 | 旁路诊断：用 `unity exec` 复现同一段代码，或看 `Editor.log`；**已知缺口（backlog）** |
| U45 | `--remove-bg auto`：四角**全透明** → `BACKGROUND_AMBIGUOUS`（`reason:'transparent-corners'`）；部分角透明时推断可能误判 | 中 | 图本来就带透明背景 → **别给** `--remove-bg`，直接 `--trim` |
| U46 | **并行调用 `unity`（含只读命令）会互相踩**：并行 `exec` → `SCRIPT_COMPILE_ERROR: Another execution is already in progress`；并行 `scene tree` 等只读 → `ULOOP_TRUNCATED` —— 两个码都**不指向真实原因** | 中 | 一次只发一条命令、串行重试（SKILL §2 铁律）；**原「只读 → `ULOOP_TRUNCATED`」已被真机证伪（实为 `UNITY_SERVER_BUSY`，见 U49 与 `docs/M5-PROBES.md`）** |
| U47 | `AssetDatabase.AssetPathToGUID` 在 `DeleteAsset` 后**仍返回过期 guid**（`Refresh(ForceUpdate)` / `LoadAssetAtPath==null` / 磁盘已删都不影响）→ 用「guid 非空」判「资产还在 / 引用没断」会**假绿** | **高** | 用 `AssetDatabase.LoadAssetAtPath<T>(path) == null` 判定（**官方版实测 + 团结同类**） |
| U48 | 并发调用报 `SCRIPT_COMPILE_ERROR` + 「动态代码编译失败」—— 空 `CompilationErrors` 导致的误判 | 中 | 判据须要求非空数组；见 `docs/M5-PROBES.md` |
| U49 | 并发调用报 `UNITY_SERVER_BUSY` —— uloop 单飞设计，不是故障 | 中 | 串行重试；已登记进 `RETRYABLE_CODES` |
| U50 | 同父同名实例唯一定位：`--sibling-index` 是**真实 `GetSiblingIndex`**（`scene tree` 的 `siblingIndex` 字段值，**可能不连续**），**不是**命中列表下标；不给参数时取第一个 + `matchCount`/hint；越界 `SIBLING_INDEX_OUT_OF_RANGE`（运行时 1）+ `available` | 中 | 用 `scene tree` 读出目标节点的 `siblingIndex` 再传 `--sibling-index`；跨父同名同序号仍无法区分（hint 已提示） |
| U51 | `prefab create` 读回面纳入 `components` 后，源节点含 **`HideFlags.DontSave`** 组件（`SaveAsPrefabAsset` 不序列化）会如实 `verified:false`；用别的节点 `--force` 覆盖是**自证**（必然 `verified:true`），不能用来验证读回面鉴别力 | 中 | 验证鉴别力要用「源与盘上资产确实不同」的场景；要让组件进 Prefab 先去掉 `DontSave`（官方版实测） |
| U52 | `sprite assign --world-size` 在 `SpriteRenderer.drawMode=Sliced/Tiled` 下会（预期地）落 `verified:false` —— 写侧用 `Sprite.bounds`、读侧 `sr.bounds.size = sr.size × scale`；仅当 `sr.size == sprite.bounds` 时才一致 | 中 | 只对 `drawMode=Simple` 用 `--world-size`，或改回 Simple 再 assign，或改用 `shot`+`pixels`（官方版实测，见 `### U52`） |
| U53 | 节点上**只有 UI `Image`** 时 `sprite assign` 会静默加 `SpriteRenderer` 并假绿（**已修 R481**：现在落 `UI_IMAGE_PRESENT`、退出码 1）；UI 组件短名 `Image` 在 `node create --components` 里 → `COMPONENT_TYPE_NOT_FOUND`（要全名 `UnityEngine.UI.Image`） | **高** | UI 图走 UI 管线，`sprite assign` 只挂 `SpriteRenderer`；要设 `Image.sprite` 用 `unity exec`（官方版实测，见 `### U53`） |
| U54 | **场景未保存**时 `prefab create --force` 会重置实例名与实例覆盖（未 `scene save` → 实例改名成资产根名、`localPos`/`localScale` 覆盖全丢；已 `scene save` → 完整保留） | **高** | 重存被实例引用的 Prefab 前先 `unity scene save`（不带 `--path`）；重存后读回实例确认名/变换未被重置（官方版实测，见 `### U54`） |
| U55 | `prefab apply`/`revert` 对**根 `localPosition` 豁免**：apply **不**把它写进资产、revert **不**还原它（其余字段：根 `scale`、子节点变换、sprite、components 都正常） | 中 | 读回面已排除根 `position`（否则必假红）；根位置要改就显式 `node set`（官方版实测，见 `### U55`） |
| **M4** | 全新 clone / 删 `Library/` 之后资产引用是否仍在（与 `.meta` 同批提交） | **高** | **资产 + 引用方 + `.meta` 同批**即可交付；`.meta` 缺 + 无 `Library/` → 引用**真断**（见文末 `### M4：…`） |

---

## U1. `package.openupm.com` 本机不可达 → uloop 官方安装命令必失败

**现象**

`uloop package install` 会挂起或失败。该命令的职责是「向 `Packages/manifest.json` 添加 OpenUPM scoped registry 和 `io.github.hatayama.uloopmcp` 依赖」，而它要访问的 registry 在本机不可达。

**原因**

网络层面阻断，不是配置问题。

**证据（2026-09-18，三轮，超时 25s/30s）**

| 域名 | 结果 |
|---|---|
| `package.openupm.com` | ❌ 三轮**全部 21s 超时**（http 000） |
| `openupm.com` | ❌ TLS 立即重置（curl exit 35） |
| `raw.githubusercontent.com` | ✅ 301 / 0.28s（三轮稳定） |
| `cdn.jsdelivr.net` | ✅ 301 / 0.72s（三轮稳定） |
| `codeload.github.com` | ✅ 200 / 0.49s |
| `packages.unity.com` | ✅ 200 / 2.50s |
| `packages.unity.cn` | ✅ 200 / **0.32s** |
| `github.com` | ⚠️ 三轮：2 次 30s 超时、1 次 30s 后 200 |

对照组（`raw.githubusercontent.com` 0.28s 稳定）说明**不是整体网络差**，是这些特定域名被阻断。

**处理**

1. **不要用** `uloop package install`。改走 codeload tarball → 项目外 vendor → `manifest.json` 写 `file:` 绝对路径（S0 已验证可行）。
2. 上游 README 的「Unity UI 安装」路径提供 git URL 备选：
   `https://github.com/hatayama/unity-cli-loop.git?path=/Packages/src`
   但需 `github.com`，间歇性，**不是可靠路径**。
3. Unity 侧的包 registry 组（`packages.unity.com` / `packages.unity.cn`）**无需绕行**，均可达。

---

## U2. codeload/git 方式 vendor 会缺空目录，Unity 报 `.meta` 警告

**现象**

首次打开项目时日志出现（本例重复 3 次）：

```
A meta data file (.meta) exists but its folder
'Packages/io.github.hatayama.uloopmcp/Editor/FirstPartyTools/ReplayInput/Application'
can't be found, and has been created. Empty directories cannot be stored in version
control, so it's assumed that the meta data file is for an empty directory in version
control. When moving or deleting folders outside of Unity, please ensure that the
corresponding .meta file is moved or deleted along with it.
```

**原因**

git **不跟踪空目录**，但上游仓库里这些空目录有 `.meta` 文件。于是 tarball 里有 `.meta` 却没有对应文件夹。Unity 检测到后自己补建了文件夹。

**影响**：**无**。Unity 自愈，编译 0 error / 0 warning。仅日志噪声。

**为什么记下来**：任何 git 方式的安装（codeload / git URL / OpenUPM）都会有这个问题。将来看到这条警告**不要当成安装失败的信号**去排查。

**处理**：忽略。若要消除噪声，可在 vendor 脚本里根据 `.meta` 里的 `guid` 反推补建空目录（不必要）。

---

## U3. GitHub API 的 `size` 字段是仓库体积，不是 tarball 体积

**现象**

`api.github.com/repos/hatayama/unity-cli-loop` 返回 `"size": 154752`（KB，≈151 MB）。
据此判断「下 150MB tarball 太贵」，差点放弃 codeload 方案改走逐文件拉取（2744 个文件）。

**实际**

branch tarball 只有 **7.8 MB**，2.35 秒下完（3.4 MB/s）。

**原因**

API 的 `size` 是 **git 仓库总体积（含全部历史对象）**，与「某 branch 的 tarball」不是一个量级。

**处理**

判断下载成本时，用 tarball 实测，不要用 API 的 `size`。
也可先用 `codeload` 发起请求看 `content-length`。

---

## U4. 原生 Windows Python 无法解析 MSYS 的 `/tmp/...` 路径

**现象**

```bash
curl -o /tmp/tree.json "..."   # MSYS curl，写入成功（ls 能看到）
python -c "open('/tmp/tree.json')"   # FileNotFoundError
```

**原因**

本机 Python 是原生 Windows 构建（`/d/devsoft/Python/python`），不认识 MSYS 的 `/tmp` 虚拟路径映射。MSYS 工具（curl/ls/grep）认，原生 Python 不认。

**处理**

跨工具传递文件时**用真实 Windows 路径**，例如建一个固定工作目录：

```bash
W=/c/Users/<用户>/pi-unity-spike   # MSYS 视角
# Python 里写 C:/Users/<用户>/pi-unity-spike/...
```

或全程用管道（`curl ... | python -c`）——但那样无法复用中间文件。
**pi-unity 的脚本一律不要依赖 `/tmp`。**

---

## U5. 上游 README 的工具面与实测不一致

**现象**

按上游 README 整理出的工具清单是 **19 个**，实测是 **21 个**，且有结构性差异：

| README | 实测（`.uloop/tools.json`） |
|---|---|
| `pause-point`（单个） | 拆成 `enable-pause-point` / `clear-pause-point` |
| 未提及 watch | 多出 `enable-watch` / `get-watch-values` / `clear-watch` |
| 列了 `focus-window` | **不在** tools.json 里 |

**原因**

README 滞后于实现（上游 V3 迭代频繁，`dispatcher-v3.5.1` / `project-runner 3.4.0`）。

**处理**

**工具面一律以 `.uloop/tools.json` 为准**——它是编辑器加载包时自动生成的，含每个工具的参数 schema：

```bash
python -c "import json;print([t['name'] for t in json.load(open('S0Project/.uloop/tools.json'))['Tools']])"
```

这条也是本项目的方法论要求：**文档必须来自实测**，不能转述上游 README。

---

## U6. `uloop launch` 只搜 Unity Hub 路径 → 无法启动团结引擎

**现象**

```json
{ "Success": false,
  "Error": { "ErrorCode": "INTERNAL_ERROR", "Phase": "execution",
             "Message": "unity 2022.3.62t9 executable not found; searched: C:\\Program Files\\Unity\\Hub\\Editor\\2022.3.62t9\\Editor\\Unity.exe, C:\\Program Files (x86)\\Unity\\Hub\\Editor\\..., C:\Users\<用户>\\AppData\\Local\\Unity\\Hub\\Editor\\..." } }
```

**原因**

`uloop launch` 的编辑器发现逻辑**硬编码 Unity Hub 的标准安装路径**。团结引擎装在 `D:\devsoft\unity\unitySoft\<ver>\Editor\Tuanjie.exe`，不在搜索范围内。

**影响（已实测界定）**

- ❌ `uloop launch` 在团结引擎上**不可用**
- ✅ **连接侧完全不受影响** —— 手动启动 `Tuanjie.exe -projectPath <p>` 后，`uloop list` **第一次尝试（15s）就连接成功**

**处理**

自己启动编辑器，然后只用 uloop 的工具命令：

```bash
# 启动（注意：用 cmd start 且不要接管道，否则会挂住）
cmd //c start "" "D:\devsoft\unity\unitySoft\2022.3.62t9\Editor\Tuanjie.exe" -projectPath "<项目>"
# 等编辑器起来后
uloop --project-path "<项目>" list
```

> ⚠️ 附带的坑：`cmd //c start ... | head` 会**永久挂住**——子进程继承了 stdout，管道不关闭。
> 要么不接管道，要么用 `cmd //c start` 后单独一条命令查进程。

**对 pi-unity 的含义**：`doctor` / `launch` 类命令**必须自己实现编辑器发现**（扫团结 Hub 配置、注册表、`Tuanjie.exe`），不能依赖 uloop 的 `launch`。

---

## U7. `screenshot --window-name` 在中文编辑器上失效

**现象**

```
screenshot --window-name Game  → Success: false
  "Neither Game nor Simulator window found; open the Game view and retry"
screenshot --window-name Scene / Console / Inspector / Project / Hierarchy
  → 全部 "Window 'X' not found (MatchMode: exact)"
```

但桌面上**这些窗口全都开着**（编辑器标题：`S0Project - 无标题 - Tuanjie Editor 1.9.1 <DX11>`）。

**原因**

uloop 的窗口匹配是**按窗口标题字符串**比较的。本机编辑器**界面语言是中文**，窗口标题是「游戏」「场景」「控制台」「层级」「项目」，因此英文名 `Game`/`Scene`/... 精确匹配全部失败。

**证据**

```
screenshot --window-name 游戏  → Success: true，输出 游戏_<ts>.png (892x355)
```

**补充（2026-09-19 真机，R101/R111）**：枚举 `Resources.FindObjectsOfTypeAll<EditorWindow>()` 的窗口标题，
实测 6 个窗口的中文标题是：`SceneView=>场景` / `ConsoleWindow=>控制台` / `GameView=>游戏` /
`SceneHierarchyWindow=>层级` / `ProjectBrowser=>项目` / `InspectorWindow=>检查器`。

> ⚠️ **Inspector 的中文标题是「检查器」，不是「属性」**。
> 此前 `lib/shot.js` 的静态表把 `Inspector` 标成「属性」（当时标了「未实测」）—— **表值错**。
> 真机：`--window-name 检查器` → `Success: true`（276x926）；`--window-name 属性` → not found。
> 已按实测值修正（`lib/shot.js` 的 `ZH` 表 + 单测）。

**处理**

三种办法（按推荐度）：

1. **用本地化标题**：`--window-name 游戏`（需确认当前编辑器语言）
2. **进 PlayMode**：`--capture-mode auto` 在 PlayMode 下解析为 `rendering`，此时**忽略 `--window-name`** —— 绕过整个问题（§6 已验证）
3. `--match-mode contains` 配合片段匹配

**对 pi-unity 的含义**：`doctor` 应**探测当前编辑器语言**并把窗口名映射固化下来，或干脆强制走 `rendering`（需 PlayMode）。这是典型的「本机环境差异」——**必须实测，不能照抄文档**。

---

## U8. EditMode 下加的 `UnityEvent` lambda 监听器进 PlayMode 会丢失

**现象**

在 EditMode 下执行：

```csharp
var btn = go.GetComponent<Button>();
btn.onClick.AddListener(() => Debug.Log("S6_CLICK_OK"));
```

然后进 PlayMode → `simulate-mouse-ui` 点击：

```json
{ "Message": "Clicked 'S6Button' at (267.0, 167.0)",
  "HitGameObjectName": "S6Button", "Success": true }
```

**点击命中了正确对象，但 `onClick` 没触发** —— `get-logs --search-text S6_CLICK_OK` 返回 0 条。

**原因**

lambda 监听器**不可序列化**。进 PlayMode 时 Unity 从**序列化后的场景状态**重建场景，运行时委托不在其中，因此丢失。

**证据（关键对比）**

| 时机 | 结果 |
|---|---|
| EditMode 加监听器 → 进 PlayMode → 点击 | ❌ 无日志，`persistentCount=0` |
| **PlayMode 中**加监听器（`isPlaying=True`）→ 点击 | ✅ 日志出现 `S6_CLICK_OK_RUNTIME` |

**处理**

**监听器必须在 PlayMode 运行时添加**（用 `execute-dynamic-code` 在 PlayMode 中执行），或者用**可序列化的持久监听器**（`UnityEventTools.AddPersistentListener` / Inspector 里拖拽绑定）。

**为什么这条重要**

这是 **Cocos P20/P26 的 Unity 类比**，也是**「为什么必须有 verified 读回」的最佳实证**：

> `simulate-mouse-ui` 返回 `Success: true` + `HitGameObjectName: "S6Button"`，
> 看起来完全成功 —— **但业务效果根本没发生**。

只有 `get-logs` 验证到回调日志，才能说「点了确实动了」。
**「点击已命中」≠「回调已触发」≠「业务生效」。**

---

## U9. 构建目标不是全的 —— 取决于安装时勾选的 PlaybackEngines

**现象**

准备做 WebGL 出包验证时发现：

```
Editor/Data/PlaybackEngines/
  AndroidPlayer
  WeixinMiniGameSupport
  windowsstandalonesupport
  （没有 WebGLSupport）
```

**原因**

团结引擎/Unity 的构建支持是**可选模块**，安装时按需勾选。下载目录里只有：

```
TuanjieSetup-Android-Support-for-Editor-2022.3.62t9.exe
TuanjieSetup-MiniGame-Support-for-Editor-2022.3.62t9.exe
TuanjieSetup64-2022.3.62t9.exe
```

**没有 WebGL 模块。**

**影响**

写 SKILL / 做 `build` 命令时，**不能假定目标平台存在**。pi-cocos 的参考流程是 `web-mobile`，但 Unity 侧 WebGL 默认**不装**。

**处理**

1. `doctor` / `build` 必须**先枚举 `PlaybackEngines/`** 并报可用目标
2. 不可用时给明确指引（用 Hub 安装对应模块），不要直接尝试构建等到报错
3. 本次 S8 改用 **StandaloneWindows64**（可用），已验证

---

## U10. 团结引擎与 Unity 官方的文件/产物差异

**现象**

三处与官方 Unity 不同的硬差异，在 S8 过程中暴露：

| 项 | Unity 官方 | **团结引擎（实测）** |
|---|---|---|
| 场景文件扩展名 | `.unity` | **`.scene`** |
| 场景 YAML 标签 | `%TAG !u! tag:unity3d.com,2011:` | **`%TAG !u! tag:yousandi.cn,2023:`** |
| 播放器核心 DLL | `UnityPlayer.dll` | **`TuanjiePlayer.dll`** |
| 崩溃处理器 | `UnityCrashHandler64.exe` | **`TuanjieCrashHandler64.exe`** |

**证据**

```
S0Project/Assets/Scenes/SampleScene.scene        ← 不是 .unity
  %YAML 1.1
  %TAG !u! tag:yousandi.cn,2023:

build/win64/TuanjiePlayer.dll      44104024 B
build/win64/TuanjieCrashHandler64.exe
```

**影响（严重）**

任何**硬编码 Unity 官方约定**的代码或脚本都会挂：

- 扫 `Assets/**/*.unity` 找场景 → **找不到任何场景**
- 硬编码 `TuanjiePlayer.dll` / `UnityPlayer.dll` → 依赖检查失败
- 正则匹配 `tag:unity3d.com` 解析场景文件 → 失败
- `EditorBuildSettings` 里的路径写法也随之为 `Assets/Scenes/X.scene`

**处理**

1. **不要硬编码场景扩展名**。要走 `EditorBuildSettings.scenes` 或 `AssetDatabase.FindAssets("t:Scene")`
2. 依赖检查用 `*.dll` 通配或 `report.summary`，不要写死文件名
3. 解析 `.scene` 文本时把 tag 正则放宽（或干脆不解析、走 `EditorSceneManager` API）
4. **这条直接影响 D6**：它证明了「本机验证环境是团结」与「兼容 Unity 官方」之间**确实存在差异面**，必须逐条实测入档，不能假设二者等价

---

## U11. 冒烟/读回依赖**上游响应字段名与 CLI 参数名**，改名不会报错、只会静默变 `?`/fail

**适用引擎**：**两/三引擎共有（Unity 家族共有）** —— 团结引擎 **2022.3.62t9** + Unity 官方中国版 **2022.3.62f3c1**
+ uloop 包 **3.6.3**（**实测 + 上游源码**）`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`。
官方版上三处字段逐字段核实通过（`compile` 的 `ErrorCount`/`WarningCount`、`get-logs` 的 `TotalCount` + `--max-count`、
`get-hierarchy` 的 `HierarchyFilePath`）→ `unity doctor --smoke` **7/7 pass**（与团结侧同）。

**现象**

`doctor --smoke` / 读回逻辑取的是 uloop **响应 JSON 的字段名**（`ErrorCount` / `WarningCount` /
`TotalCount` / `HierarchyFilePath`）与 **CLI 参数名**（`get-logs --max-count`）。
uloop 升级、工具改名、字段重命名时这些调用**不会报错**：

- 字段消失 → 取到 `undefined` → 旧写法（`j.TotalCount ?? '?'`）会打印 `?`，看起来「有值」，冒烟**假绿**；
- 参数名变化 → 工具返回 `Success:false`，但那只是一次普通失败，没人会想到是「名字写错了」。

**证据 / 出处**（上游 `uloopmcp` 包内相对路径）

| 工具 | 参数 / 字段 | 上游文件与行号 |
|---|---|---|
| `get-logs` | `--max-count` / `TotalCount` | `Editor/FirstPartyTools/GetLogs/Skill/SKILL.md:22` / `:32` |
| `get-hierarchy` | `HierarchyFilePath` | `Editor/FirstPartyTools/GetHierarchy/GetHierarchyResponse.cs:26` |
| `compile` | `ErrorCount` / `WarningCount` | 团结实测 S3（`CAPABILITIES-tuanjie-2022.3.62t9.md` §0 的 S3 行；规格 `docs/superpowers/specs/2026-09-18-pi-unity-design.md:407`） |

详见 `CAPABILITIES-tuanjie-2022.3.62t9.md` §4.6。

**处理**

本包的**证据工具一律「字段缺失即 fail」**，而不是打印 `?` 假装成功（R38）：

1. `pick` 读不到所需字段时返回 `null` → 该项判 `fail` 并**点名缺失的字段**；
2. **每工具** pass 判据必须是 `Success === true`，不是 `!== false`（无字段的裸对象不得当成功）；
   **探活（`list`）** 则按**响应形状**判（`{Version:string, Tools:array}`，见 U14 / R115）——
   `list` 是 **dispatcher 级**命令，真机**不带** `Success`，把工具级判据套上去会假红。

**为什么方向是安全的**：若字段名与上游不符，后果是 **falsely-fail**（健康机器上冒烟立刻变红、
当场暴露），**不是静默假绿**。

**真机对账已完成（M1 验收，2026-09-19）**：真实 dispatcher 3.5.1 + 团结 2022.3.62t9，
`compile` 的 `ErrorCount`/`WarningCount`、`get-logs` 的 `TotalCount` + `--max-count`、
`get-hierarchy` 的 `HierarchyFilePath` 均逐字段核实通过 —— `unity doctor --smoke` 三项全 `OK`
（`errors=0 warnings=0` / `total=0` / `saved: .uloop\outputs\HierarchyResults\...json`）。
（**M2 起为七项**（3 只读 + 4 写闭环 `write-create`/`write-set`/`write-delete`/`write-clean`），
同类表述见 `docs/CAPABILITIES-tuanjie-2022.3.62t9.md` 的「M2 补充」段。）

---

## U12. 上游失败有**两种形状**：工具级平铺 vs dispatcher 级嵌套

**适用引擎**：**两/三引擎共有（Unity 家族共有）** —— 团结引擎 **2022.3.62t9** + Unity 官方中国版 **2022.3.62f3c1**
+ uloop dispatcher **3.5.1** / 包 **3.6.3** `[团结 2022.3.62t9 实测]`；`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`。
官方版上两种形状都实拍到：dispatcher 级嵌套（`UNITY_NOT_REACHABLE`）与工具级**平铺**
`{"Success":false,"Message":"PlayMode rendering did not produce an image.","NextActions":[…]}`（**无** `Error` 子对象、**无** `ErrorCode`）。

**现象**

uloop 的**失败**响应不是一种形状：

| 层级 | 形状 | 出处 |
|---|---|---|
| **dispatcher 级**（连接/传输类错误） | 嵌套 `Error:{ErrorCode, Message, Phase, Retryable, NextActions}` | U6 实录 |
| **first-party 工具级**（screenshot/compile/… 自己报的失败） | **平铺** `{Success:false, Message, NextActions}`，**无 `Error` 子对象、无 `ErrorCode`，也没有 `Retryable`**（全 vendor 的 `Retryable` 只出现在 Roslyn worker 的内部结构里，不在工具响应 DTO 上） | 上游 `uloopmcp` 包内 `Editor/ToolContracts/ScreenshotResponse.cs:35-42`（DTO 字段面：`Screenshots / TimedOut / Message / Warning / ResolvedCaptureMode / NextActions`；本机 vendor 于 `C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp`，**不在本仓库**） |

只读 `json.Error` 的代码会把**所有**工具级失败落成
`ULOOP_ERROR: uloop 返回失败但未提供 Message` + `hint: []` + `retryable:false`，提示全丢。

**为什么平铺失败一定是 `retryable:false`（F5 修正）**：`lib/envelope.js` 按「`Retryable` 字段缺失即
`false`」处理 —— `Boolean(e.Retryable)` 永远不是 `null`/`undefined`，故不会回落到 `RETRYABLE_CODES`
兜底。平铺失败形状里**本来就没有** `Retryable`，所以它一律落 `false`；
**不是**「上游明说了不可重试」（那是先前的错误推断）。

**证据（2026-09-19 真机）**

```jsonc
// screenshot 窗口名失配（平铺）
{ "Success": false,
  "Message": "Neither Game nor Simulator window found; open the Game view and retry",
  "NextActions": ["Open the requested Unity window, then retry the screenshot."] }
```

**处理**

`lib/envelope.js` 的 `fromUloop` 把两种形状**合并**成同一取值面（嵌套字段优先）再逐字段取：
`const e = json.Error && typeof json.Error === 'object' ? { ...json, ...json.Error } : json;`
（R108）。合并对 dispatcher 级零影响（外层只有 `Success`）。

**顺带**：平铺 `Message` 非字符串/空串时回退到「uloop 返回失败但未提供 Message」，
怪载荷留在 `actual`（否则人读输出会打成 `[object Object]`，R111④）。

---

## U13. `AddComponent` 对抽象类型**不抛异常**、返回 `null` → 旧码报成功且留残骸

**适用引擎**：**两/三引擎共有（Unity 家族共有）** —— 团结引擎 **2022.3.62t9**（`Tuanjie Editor 1.9.1`，Unity 2022.3 同源）
+ Unity 官方中国版 **2022.3.62f3c1** `[团结 2022.3.62t9 实测]`；`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`。
官方版实测：`unity node create --components '["Collider"]'` → `COMPONENT_ADD_FAILED`（`detail: AddComponent 返回 null（类型可能为抽象/不可实例化，如 Collider）`）、
退出码 1，且**无残骸**（随后 `scene tree` 的 `nodeCount` 回到基线 2、节点名列表与操作前逐字相同）。

**现象**

`unity node create --components '["Collider"]'`（抽象类）时：

- `go.AddComponent(t)` **不抛异常**，而是返回 `null` 并只打一条 Unity 日志；
- 旧实现把「没抛」当成功 → 信封 `ok:true`（读回虽会 `verified:false`，但**残骸已经落在场景里**），
  而**组件一个都没挂上**；
- 更糟：`DestroyImmediate(go)` 在组件循环里只有两处**早于** `AddComponent` 的清理分支
  （类型解析失败 / 非 `Component`，另有 `PARENT_NOT_FOUND` 与 catch 等其它调用点）——
  而 `AddComponent` 返回 `null` **不抛异常**，故 catch 也不会兜到；旧码在这个 null 上
  **没有任何清理路径被跑到**，于是场景里留下一个**缺组件的半成品节点**（残骸）。

**证据**

任务 11 的真机矩阵（6 条）里抓到；与「`Type.GetType("Sprite, Nope")` 会抛异常」的旧注释相反 ——
后者真机**返回 `null`**（走 `COMPONENT_TYPE_NOT_FOUND`，不抛）。

**处理**

`unity-scripts/node-create.cs`：

1. 解析出类型后先判 `typeof(Component).IsAssignableFrom(t)`（不是 Component → `NOT_A_COMPONENT` + 清理）；
2. `AddComponent` 的返回值**判 null** → `COMPONENT_ADD_FAILED` + 清理；
3. 「解析 + 添加」整段包 `try/catch`，异常同样收敛成 `COMPONENT_ADD_FAILED` + 清理
   （catch 守的是 `AddComponent` 内部抛出的情形，如自定义组件构造/Awake 抛）。

> 相关：`Sprite` 是**资源类型不是 Component**，`--components '["Sprite"]'` 真机落 `NOT_A_COMPONENT`；
> 挂渲染要用 `SpriteRenderer`。

---

## U14. `uloop list`（dispatcher 级）响应**没有 `Success` 字段** → 探活假红

**适用引擎**：**两/三引擎共有（Unity 家族共有）** —— 团结引擎 **2022.3.62t9** + Unity 官方中国版 **2022.3.62f3c1**
+ uloop dispatcher **3.5.1** / project-runner **3.4.0** `[团结 2022.3.62t9 实测]`；`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`。
官方版原生调用实测：`uloop --project-path <P> list` → `{"Version":"3.4.0","Tools":[…21 项…]}`，
`Object.hasOwn(json,'Success') === false`（与团结逐字同形）——即 `isConnectedProbe` 的形状判据在官方版上同样必要。

**现象**

`uloop list` 是 **dispatcher 级命令**（列出工具面），不是 first-party 工具，响应是：

```json
{ "Version": "3.4.0", "Tools": [ { "Name": "compile", ... } ] }
```

顶层键只有 `Version` / `Tools`，**没有 `Success`**（`Object.hasOwn(json,'Success') === false`）。

**典型错误**：把 first-party 工具的判据 `Success === true`（见 U11/R16）套在 `list` 探活上 →
编辑器**明明连着**却报 `FAIL editor-connection 无法连接（退出码 0）`：

- `unity doctor` **永远不绿**；
- `unity doctor --smoke` 三项全 `SKIP`（退出码 1；**M2 起为七项**：3 只读 + 4 写闭环）；
- skill 黄金流程的第一步（doctor 不绿不许往下做）被直接堵死。

**根因**

`Success === true` 是**工具级**判据（`compile`/`get-logs`/`get-hierarchy` 真机都带布尔 `Success`，
已逐条核实）；`list` 是**另一层**的响应形状，两者不可混用。

**处理**

`lib/doctor.js` 用专门的探活判据（R115）：

```js
// code===0 且 json 存在时：Success:true 接受；Success:false 拒绝；
// 无 Success 时要求 dispatcher 的具体形状 —— Version 是字符串且 Tools 是数组。
```

**放宽的边界（F1 修正，勿再夸大为「更有鉴别力」）**：新判据 = `Success === true` **OR**
`{Version:string, Tools:array}`，是旧判据的**严格超集** ——

- 放宽**只**针对 `{Version, Tools}` 这一具体形状：`{"hello":1}` 这类**裸对象仍 fail**；
- `{"Success":true}`（code=0）作为 fixture / 历史形状**继续被接受** ——
  所以相对旧判据，鉴别力**没有增强、只是没有退化**（R15「别的程序不许假绿」未被收严）；
- 要真正收严（例如要求 `Version` 形如 semver）需在 M2 讨论。

**绿灯能证明什么（F12，2026-09-19 真机实测）**：把编辑器**关掉**（`Tuanjie.exe`
不在 tasklist）后跑 `unity doctor`，该项**FAIL**（退出码 1）：`uloop list` 返回
`{Success:false, Error:{ErrorCode:'UNITY_NOT_REACHABLE', Phase:'connection', Retryable:true, ...}}`
（`Details.Cause` 是命名管道 `\\.\pipe\uloop-UnityCliLoop-<hash>` 找不到）。
即在 `PI_UNITY_ULOOP_BIN` 指向真 uloop 的前提下，`editor-connection` 绿 ⇒ 编辑器进程活着、
且**打开了该项目**，故 `uloop X 已连接` 文案属实；但它**不证明每个工具都能跑通** ——
工具层可用性由 `unity doctor --smoke` **七项** pass 证明（**M2 起为七项**：3 只读 + 4 写闭环；skill §1）。

> 教训：**探活判据必须按被调命令的响应形状定，不能按「uloop 都带 Success」的假设定。**
> 单测 fixture 的 `ok` 载荷（`{Version,Tools}`）本来就是真实形状，但此前**没有任何用例以真实
> `list` 形状断言 connection pass**（所有 connection-pass 用例都把载荷手写成 `{Success:true,...}`），
> 所以这个假红一直活到 M1 真机验收才暴露。

---

## U15. 写后读回的 `1e-4` 绝对容差在 float32 大坐标上必然 `verified:false`

**适用引擎**：**两/三引擎共有（Unity 家族共有）** —— 引擎无关（浮点语义）`[团结 2022.3.62t9 实测]`；
`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`：官方版上 `node set --patch '{"position":{"x":100000.123,…}}'`
读回 `100000.125` → **`verified:false`、退出码 1**（与团结逐位相同）。

**现象**

`unity node set --path X --patch '{"position":{"x":100000.123,"y":3,"z":0}}'` →
写入 `Success:true`，但读回比对报 `verified:false`（`position.x` intent `100000.123` vs actual `100000.125`）。

**原因**

Unity 的 `Vector3` 是 **float32**。`100000` 附近 float32 的 ULP ≈ **0.0078**，
远大于 `lib/readback.js` 的绝对容差 `1e-4` → 必然 mismatch。

**这不是「写入失败」**，是精度差。方向是 **falsely-fail**（安全且可诊断：`mismatches` 打印出 intent/actual 的具体差异）。

**反向验证怎么写才对**

| 值 | 结果 | 说明 |
|---|---|---|
| `100000.123` | ✅ `verified:false` | float32 ULP ≈ 0.0078 ≫ 1e-4，是**正确**的反例 |
| `1e30` | ❌ `verified:true` | float32 最短往返不产生 mismatch ——**不要用它**。（`1e30` **仍在** float32 可表示范围内，上限 ≈ `3.4028235e38`；真正超上限的是 `1e39`，本表不需要它） |

**处理**

1. 大坐标场景下 `verified:false` 未必是 bug —— 先看 `mismatches` 的数值差；
2. 需要不同容差时直接调 `lib/readback.js` 的 `compareSubset(intent, actual, { tol })`
   （`verifyWrite` **故意不暴露** `tol`：一个「调用方能关掉数值闸门」的逃逸口正是本模块要防的假绿形态，R51）；
3. M1 的实际读回字段（`active` / 小坐标 `position`）不在危险区间。


---

## U16. 用 `execute-dynamic-code` 退出编辑器会报 `UNITY_DISCONNECTED_AFTER_ACCEPT`

**本条非判据失败记录，而是任务 3 真机清理阶段的副产物。**

**适用引擎**：**两/三引擎共有（uloop 桥接层，引擎无关）** `[团结 2022.3.62t9 实测，2026-09-19]`；
`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`：关闭两个官方版编辑器时 `unity exec --code 'EditorApplication.Exit(0); …'`
**同样**落 `UNITY_DISCONNECTED_AFTER_ACCEPT`（退出码 1，但编辑器确实已退出、`tasklist` 为空）。

**现象**

清理真机验证现场时执行：

```bash
uloop-bin/uloop.exe --project-path <P> execute-dynamic-code \
  --code 'UnityEditor.EditorApplication.Exit(0); return "exiting";'
```

uloop **退出码 0**，但响应是失败形状：

```json
{"Success": false,
 "Error": {"ErrorCode": "UNITY_DISCONNECTED_AFTER_ACCEPT", "Phase": "response_waiting",
           "Message": "Unity disconnected after accepting the request.", "Retryable": true,
           "SafeToRetry": false, "Details": {"Cause": "EOF"}}}
```

**原因**

请求**已被编辑器接受并执行**（编辑器随即退出），只是桥接层在等回包时读到 EOF ——
`Success:false` 说的是**桥没了**，不是**命令没跑成**。

**处理**

1. **不要**据此判定退出失败，**不要**重试（`SafeToRetry:false`；编辑器都没了，重试必失败）；
2. 判据看**进程表**：`tasklist | grep "^Tuanjie.exe"` 为空即已退出；
3. 实测（2026-09-19，S0Project 场景**处于 dirty 状态**：刚 create+delete 过探针）：
   `EditorApplication.Exit(0)` **不会弹保存对话框**，退出后场景文件 md5 与操作前**逐字节一致**
   —— 即「退编辑器」不会顺带保存场景；结合「`unity node delete` 只改内存、不写场景文件」，
   验证现场可以做到**零盘面副作用**。

**旁证（同一次实测）**：`unity node delete` 全部跑完后
`Assets/Scenes/SampleScene.scene` 的 md5 与操作前一致；`scene tree --json` 的 `nodeCount` 回到基线 1。

---

## U17. 首次创建 sprite 后紧随的 `unity shot` 可能拿到整块 `#00FFFF` 的错帧（一次，未复现）

**适用引擎**：**仅团结观测到**（**不足以判定引擎归属**）—— 团结 2022.3.62t9 `[2026-09-19 实测，观测 1 次 / 冷路径重试 2 次未复现]`；
`[Unity 官方 2022.3.62f3c1 实测，2026-09-20：同链路（create→sprite set→scale→shot）跑了多轮，**未复现**该青帧]`。
单次未复现的观测**不能**升级成「团结特有」，护栏（`--count-color` 报 0 先再截一张）两边都保留。

**现象**

任务 5 真机闭环（S0Project）中，**第一次**执行下面这条链路：

```bash
node bin/unity.js node create --project-path $P --name __pi_visual --components '["SpriteRenderer"]'
node bin/unity.js sprite set --project-path $P --path __pi_visual --color '#FF2E88'   # verified:true，读回 {r:255,g:46,b:136,a:255}
node bin/unity.js node set  --project-path $P --path __pi_visual --patch '{"position":{"x":0,"y":0,"z":0},"scale":{"x":6,"y":6,"z":1}}'
node bin/unity.js shot      --project-path $P --out $S --json   # → m2-shots/游戏_20260919_113749_049.png
```

截图里方块**位置与尺寸完全正确**（200×200 px = 6×6 世界单位，居中），但整块颜色是
**纯 `#00FFFF`（青）**，不是 `#FF2E88`：`pixels --count-color '#00FFFF'` = **40000** 像素、
`--count-color '#FF2E88'` = **0**。同一节点再执行同样命令后：

| 截图 | `sprite set` 颜色 | 截图中心 40×40 平均色 |
|---|---|---|
| `游戏_20260919_113749_049.png` | `#FF2E88` | `#00FFFF` ← **错帧** |
| `游戏_20260919_113831_360.png` | `#FF0000` | `#FF0000` |
| `游戏_20260919_113842_538.png` | `#FF2E88` | `#FF2E88` |
| 冷路径（delete→create→set）重试 ×2 | `#FF2E88` | `#FF2E88` |

**与读回无关**：同一时刻 `node inspect` 与 raw `execute-dynamic-code` 都确认
`sr.color=RGBA(1.000, 0.180, 0.533, 1.000)`、`texture=1x1 RGBA32`、`GetPixel(0,0)=white`、
`material=Sprites/Default`、相机 `orthographic=True size=5` —— Unity 侧状态正确，
**只有被截下的那一帧**是青的。

**候选原因（两个都未被证实）**

1. **首帧材质/纹理未就绪**：纹理与颜色在同一次 `execute-dynamic-code` 里创建并赋值，
   渲染线程可能先画了一帧「默认材质状态 + 未完成上传的 1×1 纹理」（`Sprites/Default` 默认
   `_Color` 是白，若纹理采样出 `(0,1,1)` 则合成纯青）；
2. **陈旧帧**：`window` 模式截图不强制 Game 视图重绘，可能截到更早的一帧
   （但该帧需同时具备「6×6 位置」与「青色」，本仓库/`pi-unity-spike` 下**找不到**这样的旧产物）。

**处理**

1. **不要把「第一张截图」当唯一判据**：截图判据先跑 `pixels --count-color '<期望色>'`，
   报 0 就**再截一张**（不要立刻放宽 tolerance —— 那会把「截错帧」误诊成「色偏」）；
2. 真机验证记录里**保留两张图与各自的像素数字**，别只保留最后一张（否则事后无法判断是色偏还是错帧）；
3. 本条是**未复现**的观测，但护栏（「`--count-color` 报 0 先再截一张」）有代码侧落点，已写进 SKILL §8（R213 编号收口：本条 = **U17**）。

---

## U18. `control-play-mode` 在**触发 domain reload 的那一次调用**（`Play`/`Stop`）响应没有 `Success` 字段 → `unity play start/stop` 曾假红（`ce8df19` 已窄口径收口）

**适用引擎**：**两/三引擎共有（Unity 家族共有）** —— 团结引擎 **2022.3.62t9** + Unity 官方中国版 **2022.3.62f3c1**
+ uloop dispatcher **3.5.1** / project-runner **3.4.0** `[团结 2022.3.62t9 实测，2026-09-19]`；`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`。

**官方版逐 action 原生复测（R263 的判定性证据）**：`--action Play`（Edit→Play）与 `--action Stop`（Play→Edit）
顶层**都没有 `Success`**（字段序与团结逐字相同：`IsPlaying,IsPaused,Changed,WasAlreadyStopped,ResumedFromPause,
BlockedByCompileErrors,BlockedByUnsavedChanges,CompileErrorCount,CompileErrors,Message,Warning`）；
`--action Pause` / `--action Status` **都有 `Success:true`**。
→ **`lib/play.js` 的那条窄口径例外在官方版上同样必需，不是团结专属补丁**（若不认，`play start/stop` 在官方版上一律假红）。
同时反证：`unity play start` → 退出码 0 / `verified:true` / `isPlaying:true`，`unity play stop` → 退出码 0 / `verified:true`。

> 本条与 U14 同族（**响应形状随被调命令/路径而变**），
> 但触发面**不是** dispatcher 级命令，而是 first-party 工具 `control-play-mode` 的**状态变更路径**。

**现象（可复现，非竞态）**

`uloop --project-path <P> control-play-mode --action <A>` 的原始 stdout，**按 `A` 是否真的改变了
PlayMode 状态**分成两种形状（同一台编辑器、同一分钟内交替实测各 3 次，稳定复现）：

| 调用 | `Changed` | 顶层有 `Success`？ | 顶层有 `Warning`？ | `StoppedBy/StoppedAt` |
|---|---|---|---|---|
| `--action Play`（Edit → Play） | `true` | **没有** | 有（可为 `""`） | 无 |
| `--action Stop`（Play → Edit） | `true` | **没有** | 有（`"Warning": ""`） | 无 |
| `--action Status` | `false` | 有（`true`） | 无 | 有（Stop 后） |
| `--action Stop`（本来就没在跑） | `false` | 有（`true`） | 无 | 有 |
| `--action Pause` / `--action Step` | `true` 或 `false` | 有（`true`） | 无 | 无 |

`Play`/`Stop` 变红形状的逐字样本（`--action Stop`，真实 stdout 去掉缩进）：

```json
{ "IsPlaying": false, "IsPaused": false, "Changed": true, "WasAlreadyStopped": false,
  "ResumedFromPause": false, "BlockedByCompileErrors": false, "BlockedByUnsavedChanges": false,
  "CompileErrorCount": 0, "CompileErrors": [], "Message": "Play mode stopped", "Warning": "" }
```

对照：`--action Pause` 的**同一批字段**末尾带 `"Success": true`，且**没有** `Warning` 键。

**触发条件（已用 Pause/Step 反证）**

`Play`（进 PlayMode）与 `Stop`（退 PlayMode）会触发 **domain reload**；`Pause`/`Step`/`Status`
不会。所以「不回包 `Success`」与「Changed:true」都只是相关量，**真正的分界是这次调用是否跨 domain reload**
（`Pause` 的 `Changed:true` 照样带 `Success`）。

**后果**

本仓库的 uloop 判据是**字面量 `json.Success === true`**（U11/R16；`fromUloop` 对
`Success` 缺失**故意**落 `ULOOP_BAD_PAYLOAD`，用来挡住「别的程序假绿」）。于是：

- **修复前**（任务 7 主体 `a950c31`）：`unity play start` / `unity play stop` 落 `ULOOP_BAD_PAYLOAD`
  （退出码 **1**）、`verified:false`，`actual` 里却是**真的** `IsPlaying:true/false` + `Changed:true`
  —— **PlayMode 其实进/退成功了，命令却报红**；
- **`ce8df19` 起**：`lib/play.js` 的 `playMode` 对这一**具体形状**窄口径收口 ——
  `Success === undefined && typeof IsPlaying === 'boolean' && (action === 'Play' || action === 'Stop')`
  → 接受该载荷为 `actual` 并继续走 intent 比对，`start`/`stop` 正常 `verified:true`、退出码 **0**
  （真机复测：`play start` → exit 0 + `verified:true` + `isPlaying:true`；
  `play stop` → exit 0 + `verified:true` + `isPlaying:false`）。例外**只在 `playMode`**；
  `lib/envelope.js` 的 `fromUloop` 仍只认字面量 `Success === true`（全局判据未放宽）；
- `unity play status` / `pause` / `step` **不受影响**（带 `Success`），`status` 也仍
  `verified:null`（无 intent，不声称验证）。

**处理**

1. 仍建议以 `play status` 的读回为准（带 `Success`，`actual.isPlaying` 如实；`status` 是
   `verified:null` 的纯读回），**不依赖响应路径差异** —— 跨 domain reload 的回包形状是上游
   实现细节，读回才是稳定判据；
2. 已按此实现（`ce8df19`）：在 `lib/play.js` 的 `playMode` 里认第③支条件
   `Success === undefined && typeof IsPlaying === 'boolean' && (action === 'Play' || action === 'Stop')`
   （**不含** `Message` 要求 —— 落地代码不要求它）；**不要**顺手去改 `lib/envelope.js` 的
   `Success === true` 全局判据（会让 U14 那类「探活假绿/假红」重新长回来）；
3. **盘面副作用**：实测（2026-09-19）`play start` → `play stop` 一轮前后
   `Assets/Scenes/SampleScene.scene` 的 md5 **逐字节一致**（`cfa039c5…9a`），
   **没有**静默保存场景 —— 即文档里「Play 在 unsaved changes 无法静默保存时才报错」的
   「能存就存」这一半在本机没有观测到（本次场景是干净的，不能排除 dirty 场景下会存，
   任务 10/11 的临时节点纪律**不要**因此放松）。

> 教训：`Success === true` 是**工具级且路径级**的判据；同一个工具的**不同 action** 可能走
> 不同的回包路径（本例：跨 domain reload 的那次）。写判据前必须把**每个 action**都真机打一遍，
> 不能只打一个 action 就外推。

## U19. `uloop compile` 在**编译有错时回 `Success:false`**（不是 `Success:true`）→ 判成功前必须读 `Errors[]`/`ErrorCount`

**适用引擎**：**两/三引擎共有（Unity 家族共有）** —— 团结引擎 2022.3.62t9 + Unity 官方中国版 2022.3.62f3c1
+ uloop dispatcher 3.5.1 / 包 3.6.3 `[团结 2022.3.62t9 实测，2026-09-19]`；`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`。
官方版实测（磁盘上直接写坏文件、**不经 CLI**、不手动 refresh）：`unity compile` → 退出码 **1** + `COMPILE_FAILED` +
`errors[0] = {message:"Assets\\PiProbe\\Broken.cs(1,42): error CS1525: Invalid expression term ';'", file, line:1}`
—— **与团结侧记录逐字相同**（顺带再次证明 plain `compile` 自己会 refresh 外部改动）。
（上游 uloopmcp 各版本同形：`CompileResultFactory` 的 `success: errorCount == 0`。）

**现象**

真机（2026-09-19，`S0Project`，裸 `uloop --project-path <P> compile`）实录两种形状：

- 编译干净：`{"ErrorCount":0,"WarningCount":0,"Errors":[],"Warnings":[],"Success":true}`；
- 编译有错：`{"ErrorCount":1,"WarningCount":0,"Errors":[{"Message":"Assets\\PiProbe\\Broken.cs(1,42): error CS1525: Invalid expression term ';'","File":"Assets\\PiProbe\\Broken.cs","Line":1}],"Warnings":[],"Success":false}`。

且**有错时进程退出码为 1**（脏载荷仍走 stdout，不是 stderr）。上游出处：
`CompileResultFactory.cs:39` `success: errorCount == 0` → `CompileResponseFactory` 的
`success: result.Success == true`。

**后果**

本仓库的 `fromUloop` 只认字面量 `Success === true`；`Success:false` 会被映射成
`e.ErrorCode || 'ULOOP_ERROR'`，而编译错的响应里 `ErrorCode` 是 `null` → 落 `ULOOP_ERROR`，
**`Errors[]`/`ErrorCount` 被丢掉**。谁先 `envelopeFromCall` 再取结构化错误，谁就在真机上
拿不到 `errors[0].file/line`。

**处理**

`lib/asset.js` 的 `compile()` 先用**形状**判定「这是不是一份确定的 compile 结果」：
`ErrorCount`/`WarningCount` 是数字 **且**（`Success === true` 或 `Errors` 是数组）；
是则直接按 `ErrorCount` 报 `COMPILE_FAILED`/成功，不经过 `fromUloop` 的 `Success` 判据。

非确定形状按落点逐条对齐实现（逐字与 `lib/asset.js` 一致）：

- `Success === null`（非截断）→ 先被 `indeterminate` 认住 → `BAD_COMPILE_RESPONSE`；
- 计数是数字、`Success !== true` 且 `Errors` **是**数组但 `ErrorCount === 0`
  （上游不变量 `success: errorCount == 0` 被破坏的矛盾形态）→ `BAD_COMPILE_RESPONSE`；
- 其余非确定形状走 `envelopeFromCall(r)`：截断 → `ULOOP_TRUNCATED`；
  `Success:false` 且 `Errors` **不是**数组（`indeterminate`/`--force-recompile` 分支会把
  `Errors` 置 `null`）→ 取 `ErrorCode`；`ErrorCode` 为 `null`/缺失时落 **`ULOOP_ERROR`**
  （**不是** `BAD_COMPILE_RESPONSE`）—— 它先被 `fromUloop` 当成一次普通的 `Success:false`
  工具失败（平铺形状，见 U12）；`Success:true` 但计数缺失 → `envelopeFromCall` 认成功，
  再落到 `BAD_COMPILE_RESPONSE`；
- **绝不**把不确定当 0 报成功。

`asset write` 的编译阶段（R279）只把**真正的编译结论类**（`COMPILE_FAILED` /
`BAD_COMPILE_RESPONSE`）当结论，其余错误码（`COMPILE_ALREADY_IN_PROGRESS` /
`COMPILE_RESULT_UNKNOWN` / `ULOOP_TRUNCATED` / `ULOOP_NO_JSON` / `ULOOP_ERROR` …）
**原码透传**并带上原 `retryable`（不再一律折成 `COMPILE_FAILED`）。

---

## U20. EditMode 用 `unity sprite set` 挂的运行时 sprite 进 PlayMode 会丢（`spriteName` 变 null → 画面里方块一个像素都没有）

**适用引擎**：**两/三引擎共有（Unity 家族共有）** —— 团结 2022.3.62t9 + Unity 官方中国版 2022.3.62f3c1
`[团结 2022.3.62t9 实测，可复现]`；`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`。
官方版复现链：EditMode `sprite set` 读回 `spriteName:""` → `play start` 后 `node inspect` 得 **`spriteName:null`**（sprite 被
 domain reload 销毁、`color` 保留）→ 同帧 rendering 图 `--count-color '#FF2E88'` = **0**，中心像素是背景色；
 在 PlayMode 里补跑一次 `sprite set` → 同帧图 `--count-color '#FF2E88'` = **110224 px**、中心 `rgb(255,46,136)`。

> 本条与 U21 是同一次任务 11 真机验证的产物（R213 编号收口：本条 = **U20**，`get-hierarchy` 形状 = **U21**）。

**现象**（真机，S0Project，任务 11 打砖块验证）

1. EditMode：`node create --components '["SpriteRenderer"]'` + `unity sprite set --color '#FF2E88'`，
   `node inspect` 读回 `sprite.present=true`、`color=255,46,136`、**`spriteName=""`**（运行时 sprite 没有名字）；
2. `unity play start` 之后（同一编辑器进程内）再 `node inspect`：**`spriteName=null`**（即 `sr.sprite == null`），
   颜色字段仍在（`color` 未被改动）；
3. 此时 `unity shot --capture-mode rendering`：960×640 里 **613396/614400 像素都是相机背景色 `#0A0A14`**，
   砖块 / 挡板 / 球**一个像素都没有**（只有 `OnGUI` 的白字约 1000 px 渲染出来）；
   `pixels --count-color '#FF2E88'` = **0**，连拍两张都是 0；
4. 进 PlayMode **之后**再跑一次 `sprite set`（同色）→ 立刻 `spriteName=""`，同一帧渲染图里该砖出现：
   `--count-color '#FF2E88'` = **3264** px（1.6×0.5 世界单位 @64 px/单位 = 预期 3276.8 px），
   `--at 184,128` = `rgb(255,46,136)`（像素公式命中，偏差 0 px）。

**原因**

`unity-scripts/sprite-set.cs` 用 `Sprite.Create(tex, new Rect(0,0,1,1), new Vector2(0.5f,0.5f), 1f)` +
`HideFlags.HideAndDontSave` 造的是**运行时对象**（不是资产）。`unity play start` 会触发 **domain reload**
→ 非资产对象被销毁，`SpriteRenderer.sprite` 变 null；而 `SpriteRenderer.color` 是组件上的**序列化字段**，
活了下来 —— 所以「颜色对、但什么都不渲染」。

**处理**

1. **模板 `PiBrickBreaker.cs` 的 `Start()` 已内置 `EnsureSprites()` 兜底**：给**任何缺 sprite 的**
   `SpriteRenderer` 补一张共用的 **1×1 白 sprite（`pixelsPerUnit = 1f`）**，白底 × 组件颜色 = 原色。
   **颜色仍然在 EditMode 用 `unity sprite set` 设**（不需要在 PlayMode 重跑 27 条命令）。
2. 用**自己的脚本**（不装模板）时：要么在 `Start()` 里自建 sprite，要么**进 PlayMode 之后**再跑
   `sprite set`（只在本次 PlayMode 会话有效，`play stop` 后要重跑）。
3. **进过一次 PlayMode 后，EditMode 的 Game 视图也看不到这些方块**（sprite 已销毁、颜色还在）——
   不是「没搭上」，别据此回滚；要验证画面就进 PlayMode 截 `rendering` 图。
4. `--count-color` 报 0 时按 **U17**（整块 `#00FFFF` 错帧）处理：**先再截一张**，别急着放宽 tolerance。

---

## U21. `get-hierarchy` 有**两种响应形状**：小场景逐节点 `components`，大场景 `componentsLut` + `componentsIdx` → 修复前 `unity scene tree` 的 `components` 全变 `[]`（本提交已修）

**适用引擎**：**两/三引擎共有（Unity 家族共有）** —— 团结 2022.3.62t9 + Unity 官方中国版 2022.3.62f3c1
+ uloop dispatcher 3.5.1 / 包 3.6.3 `[团结 2026-09-19 实测]`；`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`。
官方版实测翻转：2–3 个根节点时落盘 JSON 键为 `sceneName,stats,roots`（内联 `components`）；
建成 **34 节点**（1 空容器 + 30 个子节点带 `SpriteRenderer` + 相机 + 光 + 另一根）后键变为
`sceneName,stats,componentsLut,roots`，`componentsLut = ["Transform","Camera","AudioListener","Light","SpriteRenderer"]`，
**全部 34 个节点都走 `componentsIdx`、0 个内联 `components`** —— `unity scene tree` 仍逐节点给出短名（两种形状都解析）。

**现象**

同一台编辑器、同一项目，`uloop get-hierarchy` 落盘的 JSON **按场景大小换形状**：

- 小场景：`Hierarchy[0].roots[].components = ["Transform","Camera","AudioListener"]`（**短名数组**，无 LUT）；
- 大场景：`Hierarchy[0].componentsLut = ["Transform","Camera","AudioListener","SpriteRenderer","PiBrickBreaker"]`
  + 逐节点 `componentsIdx = [0,1,2]`（**索引**），**没有** `components` 键。

本仓库 `lib/scene.js` 的 `normalizeHierarchy` 曾只读 `n.components`（不解析 `componentsIdx`），
于是 `unity scene tree --json` 在**大场景**下**每个节点的 `components` 都是 `[]`** ——
看起来像「组件全没挂上」，其实组件都在（`node inspect` 读回正常）。`doctor --golden` 的结构投影
（`projectNode` 取 `components`）在这种场景下同样丢掉组件维度，**组件差异会漏检**。

> **已修复**（本提交，R316）：`normalizeHierarchy` 现在解析**两种形状** —— `componentsLut`
> 是数组时按逐节点 `componentsIdx` 查表（`lut[i]`，过滤 `undefined`/非字符串），否则回退内联
> `components`；正常分支与深度超限分支都覆盖。畸形输入（LUT/索引非数组、越界、元素非字符串）
> 一律按空数组且不抛。**上方「现象」描述的是修复前的行为**，保留作为上游形状的实测记录。

**实测翻转点**（S0Project，打砖块场景**边删节点边 `scene tree`**，2026-09-19）

| 场景 | 节点数 | 组件引用总数 | 落盘 JSON 字节 | 形状 |
|---|---|---|---|---|
| 24 砖 + 容器 + 挡板 + 球 + GameManager + 相机 | 29 | 58 | 9451 | **componentsIdx** |
| 同上，删掉 GameManager/Ball | 27 | 54 | 8891 | **componentsIdx** |
| 同上，删到 25 节点（删了 Brick_5_3） | 25 | 50 | 未保留 | **componentsIdx** |
| 同上，再删一个（删了 Brick_5_2） | 24 | 48 | 未保留 | components |
| 同上，删到 23 节点 | 23 | 46 | 8043 | components |
| 24 个**裸节点** + 相机（只有 Transform） | 25 | 27 | 6938 | components |

→ **既不是纯节点数**（25 个节点两种形状都出现过：裸节点是 `components`、带砖块是 `componentsIdx`），
也不完全等于组件引用数（46 → components、50 → LUT，翻转点落在 **48 ↔ 50 引用 / 24 ↔ 25 节点**之间，
未逐点逼近）；与**序列化体积**相关最可能（46 引用的 8043 字节仍是 `components`）。
**阈值未定稿，别依赖它**；依赖的是下面「处理」里的口径。

**处理**

1. **`scene tree` 只看结构与命名/组件短名**（`roots` / 子节点数 / `siblingIndex` / `components`）；
   两种形状下 `components` 现在都能给出短名，但**组件属性、颜色、sprite 一律用 `node inspect --path <p>`**
   （本命令内部走 `execute-dynamic-code`，**你不需要**也**不应该**自己调裸 uloop；`scene tree` 的组件维度里**没有属性**）。
2. 写命令的 `--components` 校验走的是**写后 `node inspect` 读回**，不受本条影响（真机 `verified:true` 属实）。
3. 用 `doctor --golden` 比结构时：两条形状的组件维度**都会**进投影，大场景下不再恒为空
   —— **已修复**：`normalizeHierarchy` 解析两种形状（本提交）。

---

## U22. `--count-color` 计数相同**不能**证明画面没变（挡板 3366 → 3366 px，质心却位移 526 px）

**适用引擎**：**引擎无关（判据设计问题），且官方版已复现同一基础面** —— 团结引擎 2022.3.62t9
+ Unity 官方中国版 2022.3.62f3c1 + uloop dispatcher 3.5.1 / 包 3.6.3
`[团结 2022.3.62t9 实测，2026-09-19]`；`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`。
官方版复现的是同一件事的两个面（`#FF2E88` 计数 **0 ↔ 110224** 与中心点颜色 `{240,255,255}` ↔ `{255,46,136}` 互相独立），
**未**复现「计数相同而位置变了」那一对具体图（3366 px 那组来自团结盲测项目）——
结论不变：**判数量用 `--count-color`、判位移用跨图同点/同区域采样，两者不可互替**。
（一句话：`unity pixels --count-color` 只回答「这个颜色在不在 / 有几个像素」，
**不回答「东西还在不在原地」**。）

**现象（盲测真机，`C:/Users/<用户>/pi-unity-m2-blind`）**

打砖块场景里同一个青挡板 `#00FFC8`、同一次 PlayMode 会话，两张 rendering 渲染图：

| 图 | `--count-color '#00FFC8' --tolerance 16` | 挡板质心 x |
|---|---|---|
| 图 1 `Rendering_20260919_135004_836.png` | **3366** | 738.0 |
| 图 2 `Rendering_20260919_135030_164.png` | **3366** | 212.0 |

计数**逐像素相同**（3366 = 3366），但挡板横向跑了 `738 − 212 = **526 px**`
（`autoPaddle` 跟着球跑）。盲测报告 §4 G2 原文：

> 另外 `--count-color` 的**计数相同不代表位置没变**：图 1 与图 2 的 `#00FFC8` 都是 **3366 px**，
> 可挡板质心从 x=738 跑到了 x=212。若只按 SKILL §8③ 里「青挡板 ≈ 3366 px」这一条判「在动」，
> 会得出**「两次都是 3366 → 没动」的错误结论**。

复核（独立复核报告，`m2-verify-12/`）：两张独立复核图（960×640，`Rendering_20260919_135244_562.png` / `Rendering_20260919_135313_932.png`）的 `#00FFC8` 均为 3366，
`pixels --at 589,560 / 589,700 / 589,730` 三点的值在两张图之间**全部翻转**
（`rgb(10,10,20) ↔ rgb(0,255,200)`）—— 退出码全 0。

**处理**

1. **判数量**（颜色在不在、砖块少了几个）→ `--count-color`；
2. **判位移** → 对**图 1 里对象所在的**坐标/区域，在两张图上跑**同一条** `--at` / `--region`，
   比返回的 `actual.at.color` / `actual.region.color`（形状 `{r,g,b,a}`）；只采样一个**与对象无关**的固定点（如背景 `480,600`）或一个**与对象不相交**的固定区域，也证明不了位移
   （它在两张图里都是背景色）；
3. 两者**不能互相替代**：计数相等**不等于**没动；单点相同**不等于**没动过的对象没动。
   SKILL §8③ 已按此改写。
4. **计数怎么读（M4 增补）**：`pixels --count-color` 的数字在 **`actual.count.count`** ——
   `actual.count` 是**对象** `{color, count, ratio, tolerance}`，写成 `actual.count > 0` **恒假**。
5. **`count>0` 不构成归属（M4 增补）**：`count>0` 只说明「这个颜色在画面里出现了」，**不能**证明
   「是你刚建的那个对象渲染出来的」——源节点与 Prefab 实例**同时在画面里**（或两者同位置同缩放）时，
   开关其中一个**不会**改变画面。归属必须**把目标挪到别处 / 关掉源节点**让它是唯一变量 +
   **负对照**（关掉目标后计数应**恰好少掉它那一块**）。完整 8 步模板见 `docs/M4-PROBES.md` §②-9。

---

## U23. `unity` 命令行面**曾没有**动态执行命令（**M3 `unity exec` 已关闭**）与 `scene save` / `scene open`（**M3 已关闭**；盲测实测）

**适用引擎**：**本包命令面（引擎无关）** —— 团结引擎 2022.3.62t9 + Unity 官方中国版 2022.3.62f3c1
+ uloop dispatcher 3.5.1 / 包 3.6.3 `[团结 2022.3.62t9 实测，2026-09-19]`；`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`。
官方版上 `unity exec` / `unity scene save` / `unity scene open` **均可用**（`exec` 读回运行期字段、`scene save` 写回 mtime 前进、
`scene open` 读回 `sceneName`），**但 `scene save` / `scene open` 在官方版只认 `.unity`** —— 见文末「Unity 官方版验证新坑」条目。
（一句话：`unity` 命令面缺少「动态 C# 执行」与「场景保存/打开」两类能力，
凡是需要它们才能完成的验证步骤，在 M2 里**做不了**。）

> **状态（2026-09-19，M3 `m3-exec` / `m3-scene`）**：**现象 1 已关闭** —— 命令面已有
> `unity exec (--code-file <f> | --code <s>)`（执行独立 C# 脚本，`return` 值在 `actual.result`；
> 读/执行命令 → `verified` 恒 `null`），`lib/play.js` 里指向裸 uloop 的两处 hint（R349）也已改指它。
> **现象 2 也已关闭** —— 命令面已有 `unity scene save [--path <Assets/…>]`（写后读回 `scene tree` 的
> `sceneName`；不给 `--path` 保存全部打开场景）与 `unity scene open --path <Assets/…> [--force]`
> （脏场景且无 `--force` → `DIRTY_SCENE`，**不静默丢改动**；`OpenScene` 本身不弹对话框）。
> 以下保留盲测当时的原始记录（**不要**再照它去调裸 uloop）。

**现象 1：没有动态执行命令（读不回运行期脚本字段）—— ✅ 已由 M3 `unity exec` 关闭（见上方状态）**

盲测报告 §4 G1 原文（逐字）：

> 我跑了 `unity --help`（exit 0）逐条核对 M2 命令面：`version / doctor / scene tree / node inspect|create|set|delete / shot / pixels / sprite set / compile / asset write / play`。
> **没有 `exec`、`eval`、`execute`、`dynamic-code` 之类的命令**；`unity play` 的子命令是
> `start|stop|pause|step|status|click|mouse|key|logs|view`，也没有读回任意 C# 表达式的能力。
> 也就是说：**SKILL §8③ 唯一能读 `score` / `bricksAlive` 的那一步，只能靠裸 uloop 的 `execute-dynamic-code`**。

旁证（同报告）：`unity play key` 失败时 CLI 自己打的 hint 也指向裸 uloop ——
「`不改项目设置的话：用 execute-dynamic-code 直接注入运行时状态`」（CLI 报错误导，见 `docs/E2E-ACCEPTANCE-m2.md` §3）。
替代路径：`play logs --search-text '[BB]'`（含 `score=` / `left=`）+ 两张渲染图**同点** `pixels --at` 对比（SKILL §8③）。

**现象 2：曾没有 `scene save` / `scene open`（交付物落盘与进 PlayMode 前的场景准备做不了）—— ✅ 已由 M3 关闭（见上方状态）**

盲测报告 §4 G3 原文（逐字）：

> 写命令只改内存。PITFALLS 里两处都提到 `unity node delete` / `--smoke` 「只改内存、不写场景文件」「不保存场景」。
> SKILL §3.5 / §8 全程没有 `scene save` 这一步，`unity --help` 里也**没有**任何 `scene save` / `asset save` 命令。
> 后果：**我搭出来的这个打砖块场景，理论上在编辑器退出后就没了**；我**无法用 `unity` 证明它已持久化**。

具体拦路：`play start` 在**未命名/未保存**场景上会落 `CONTROL_PLAY_MODE_UNSAVED_CHANGES`
（准备阶段实测 `scene tree` 的 `sceneName` 为**空串**），此时渲染截图与「在动」验证全做不了 ——
而命令面里**没有**任何保存/打开场景的命令可自救（SKILL §8⓪ / §5 已写「停下让用户在编辑器里保存场景」）。

**处理**

1. **本任务内的 skill 侧处置**：SKILL §8③ 改为只用命令面真实可用的证据；§8⓪ / §5 明确
   「`sceneName` 为空串就停下让用户保存场景，**不要**裸 uloop、不要自己发明保存流程」。
2. **代码侧**：`unity exec` **已于 M3 交付**（`lib/dynamic.js` + `bin/unity.js` 的 exec handler + `test/dynamic.test.js`；
   见 `docs/E2E-ACCEPTANCE-m2.md` §3.2 的 B1 状态），`lib/play.js` 的两处残留 hint 同步改指它；
   `unity scene save` / `scene open` **也已于 M3 交付**（`lib/scenefile.js` + `unity-scripts/scene-save.cs` /
   `scene-open.cs` + `test/scenefile.test.js`；`readBackAndVerify` 加了可选 `readActual` 注入缝，验证纪律仍单点）。
   真机验证（2026-09-19，blind 项目）：`scene save` 把一份**重建但从未落盘**的 29 节点场景写了盘
   （磁盘文件 md5 变化且 `grep -c "Brick_"` 0 → 24+）、`--golden` 仍 `matched:true`；
   dirty 场景下 `scene open`（无 `--force`）落 `DIRTY_SCENE`。
3. **适用范围**：本条只针对**运行期状态读回**（读 `score` / `bricksAlive` 这类脚本字段）；
   U8 等场景（EditMode 注入 `UnityEvent` 监听器）仍按原条目走裸 `uloop execute-dynamic-code`，**不受本条限制**。
   （现象 2 的适用范围：`scene save` 只存**当前打开的**场景；打开/切换场景用 `scene open`。）

---

## U24. `unity pixels` 只有 `--at` / `--region` / `--count-color` / `--expect`，**没有** diff / 质心 / bbox 子命令

**适用引擎**：**本包命令面（引擎无关）** —— 团结引擎 2022.3.62t9 + Unity 官方中国版 2022.3.62f3c1
+ uloop dispatcher 3.5.1 / 包 3.6.3 `[团结 2022.3.62t9 实测，2026-09-19]`；`[Unity 官方 2022.3.62f3c1 实测，2026-09-20：pixels --at / --count-color 可用且退出码口径一致，能力面同]`。
（一句话：要回答「画面变没变」这个一等问题，`unity` 侧目前**没有**一等公民判据
—— 只能靠 count / at / region 组合，或带外工具。）

**现象（盲测真机）**

盲测报告 §4 G2 原文（逐字）：

> `unity pixels` 只有 `--at` / `--region` / `--count-color` / `--expect`（`unity --help` 逐字核过）。
> **没有 diff、没有质心、没有 bbox。**
> …我**没有**用 `unity` 完成这一步，而是用**带外的 `python + PIL`** 算了差分与质心（§3.2）。

盲测因此产出：图 1 vs 图 2 差异 **64225 px（10.45%）**、连续两帧 **6089 px（0.99%）**、质心表
（白球 `(722.0,400.0) → (227.5,175.5)`；青挡板 `(738.0,588.5) → (212.0,588.5)`）——
这些数字**全部来自 `python + PIL`**，`unity` 命令面提供不了。独立复核用 `--count-color` +
`--at` 同点采样**独立复现了同一结论**（见上一条），但**差分比例**本身无法用 `unity` 复算。

**处理**

1. **可用组合**（SKILL §8③）：`--count-color` 判数量、`--at` 同点跨图判位移、`--region --expect`（区域平均色在 `actual.region.color`，形状 `{r,g,b,a}`）判区域色；
2. 需要**差分比例 / 质心 / 包围盒**时，明确声明「该数字由带外工具算得，不是 `unity` 的输出」，
   不要把它写成 `unity pixels` 的结果；
3. **M3 候选**：`unity pixels --diff`（登记在 `docs/E2E-ACCEPTANCE-m2.md` §3），让「画面变没变」有一等公民判据。

> **已关闭（批次 A，2026-09-20，见 `docs/HANDOFF.md` §7⑦）**：`unity pixels` 现已提供 `--diff <png>`
> （`actual.diff = {changed,total,ratio,maxChannelDistance,tolerance}`；**不**置 `actual.match`）、
> `--centroid <hex>`（`actual.centroid = {color,count,x,y,tolerance}`）、
> `--bbox <hex>`（`actual.bbox = {color,count,x,y,width,height,tolerance}`）。
> 差分/质心/包围盒不再需要带外工具；尺寸不等 → `DIFF_SIZE_MISMATCH`（**退出码 2**）。

---

## U25. 输入模拟的**可用性边界**：`key`/`mouse` 需 Input System、`click` 只对 uGUI 生效、`--dry-run` 走 3D 物理射线

**适用引擎**：**两/三引擎共有（Unity 家族共有）** —— 团结引擎 2022.3.62t9（`activeInputHandler:0` = Old Input）
+ Unity 官方中国版 2022.3.62f3c1 + uloop dispatcher 3.5.1 / 包 3.6.3 `[团结 2022.3.62t9 实测，2026-09-19]`；
`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`：官方版空项目（未装 `com.unity.inputsystem`）里
`unity play key --action Press --key Space` → **`INPUT_SYSTEM_UNAVAILABLE`、退出码 1**，报文**逐字相同**
（`simulate-keyboard requires the Input System package (com.unity.inputsystem). …`）。

**现象（真机，S0Project 与盲测项目）**

1. **`simulate-keyboard` / `simulate-mouse-input`（非 `--dry-run`）需要项目装 Input System**。项目没装时上游逐字回：
   `"<toolName> requires the Input System package (com.unity.inputsystem). Install it via Package Manager and set Active Input Handling to 'Input System Package (New)' or 'Both' in Player Settings."`
   （出处：vendor `uloopmcp` 的 `Editor/FirstPartyTools/Common/InputSystem/InputSystemPackageRequirementMessage.cs:11-18`；本机未装包，**真实注入从未成功验证**）。
   `unity play key`/`mouse` 把它如实落成 **`INPUT_SYSTEM_UNAVAILABLE`（退出码 1）**，**不静默降级**。
   盲测里 118 条命令中**唯一**非零退出码就是这条 —— 属预期内，不是假红。
2. **`simulate-mouse-ui`（`unity play click`）只对 `ScreenSpaceOverlay` + `GraphicRaycaster` 的 uGUI 生效**，
   **打不到 `SpriteRenderer` / 2D 物理对象**。出处：vendor `Editor/FirstPartyTools/Common/MouseUi/UiRaycastHelper.cs:21-53`
   （`CollectCanvasRaycastSources` 只收 `renderMode == ScreenSpaceOverlay` 且挂了启用中 `GraphicRaycaster` 的 Canvas 的 `Graphic`）。
   真机：空场景 `play click` 落 `ULOOP_ERROR` + `No EventSystem found in the scene.`（退出码 1）。
3. **`--dry-run` 不需要 Input System，但用的是 3D 物理射线**（`Physics.RaycastAll`，出处
   `Editor/FirstPartyTools/Common/GameView/GameViewRaycastUtility.cs:34`，由
   `Editor/FirstPartyTools/SimulateMouseInput/MouseInputDryRunResponseBuilder.cs:11,27` 调用）
   → 对纯 2D（`SpriteRenderer`、无 `Collider`）的打砖块**没有实用价值**（真机 `play mouse --dry-run` 可用但打不到东西）。

**处理**

1. 无 Input System 的项目**不要**把 `key`/`mouse` 的失败当缺陷：改用「日志 + 两张渲染图同点采样」证明玩法在跑，
   并如实声明「**无真实输入、玩法自动运行**」（SKILL §8③）；**不要**为绕过它去调裸 uloop（U23）。
2. 需要「点得动」时用 uGUI（`Canvas` + `Button` + `EventSystem`），**不要**指望点到 `SpriteRenderer`。
3. 本仓库的打砖块模板（`PiBrickBreaker.cs`）刻意用「球自动发射 + 挡板自动跟随」绕开输入注入 —— 这是设计取舍，不是降级。

---

## U26. `unity play start` 与**未保存场景**：未命名场景落 `CONTROL_PLAY_MODE_UNSAVED_CHANGES`；**内存有未保存改动、磁盘文件干净**时 `Play` 未观测到写盘（真正 dirty 未验证）

**适用引擎**：**两/三引擎共有（Unity 家族共有）** —— 团结引擎 2022.3.62t9 + Unity 官方中国版 2022.3.62f3c1
+ uloop dispatcher 3.5.1 / 包 3.6.3 `[团结 2022.3.62t9 实测，2026-09-19]`；`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`。

**官方版的细化（补上「未验证」的那一半）**：守卫的判据是 **`Scene.isDirty`**，不是「场景有没有路径」——

| 官方版探针 | 结果 |
|---|---|
| 脚本 `NewScene(DefaultGameObjects, Single)` 出来的未命名场景（`path=""`，`isDirty=**False**`） | `play start` **成功**（`blockedByUnsavedChanges:false`、`verified:true`）——守卫**看不见** |
| 同一场景 `MarkSceneDirty` 之后（`isDirty=True`） | **`CONTROL_PLAY_MODE_UNSAVED_CHANGES`**、退出码 1，报文同团结：`…Unsaved changes: Scene: Untitled scene` |

→ 结论（两引擎同）：**未命名 ≠ 一定被拦，脏才会被拦**；而「脏」在本环境里又只由编辑器 UI 或显式 `MarkSceneDirty` 产生
（CLI 改动不置 dirty，见 **U27**）。所以「进 PlayMode 前先 `unity scene save`」这条纪律**不能省**。

**现象**

1. **未命名/未保存场景无法进 PlayMode**：模板项目刚打开时 `scene tree --json` 的 `actual.sceneName` 是**空串**，
   此时 `unity play start` 落 **`CONTROL_PLAY_MODE_UNSAVED_CHANGES`**（`actual.blockedByUnsavedChanges:true`，退出码 1），
   ②③的 rendering 截图与「在动」验证**全部做不了**（盲测准备阶段实测，`C:/Users/<用户>/pi-unity-m2-blind`）。
2. **干净场景下 `Play` 不保存场景**：S0Project 一轮 `play start` → `play stop` 前后
   `Assets/Scenes/SampleScene.scene` 的 md5 **逐字节一致**（`cfa039c51ef6e5e41b68fab3d47f329a`）——
   即上游文档「unsaved changes 无法静默保存时才报错」隐含的「能存就存」这一半，**本机在干净场景上没有观测到**。
   ⚠️ **边界声明**：本次场景本来就是干净的（只是内存里 dirty），所以只证伪了「干净场景下 `Play` 也写盘」；
   **真正 dirty 的场景是否会先静默保存，未验证** —— 不要据此放松临时节点纪律。
3. 与 U18 交叉：这条域重载路径的回包形状也不常规（`Success` 缺失），但 `ce8df19` 已窄口径收口。

**处理**

1. 进 PlayMode 前先 `unity scene tree --json` 看 `actual.sceneName`：**空串/未命名就用
   `unity scene save --path Assets/Scenes/X.scene` 落盘**（写后读回 `verified:true` 才算存下；M3 起命令面已有，§8⓪ / §5）；
   场景本身就用了已有文件时也可 `unity scene save`（不给 `--path` 保存全部打开场景）。
2. 交付物能否落盘现在能用 `unity` 自证（`scene save` 的 `verified` + 磁盘上的 .scene 文件）——
   U23 现象 2 已关闭（M3，2026-09-19）。
3. 任务 10/11 的临时节点（`__pi_smoke` / `__pi_golden`）**不得**在 PlayMode 之前残留（纪律不因本条的 md5 结论而放松）。
4. **根因见 U27（M3 任务 2 真机实测）**：动态代码改的场景**不置 `isDirty`**，所以上游的「未保存改动」检测
   看不到 CLI 改动 —— 这就是本条「Play 未观测到写盘」的成因（不是「Play 不会存」，而是「它没看见要存」）。

---

## U27. 动态 C# 代码改的场景**不置 `Scene.isDirty`** → `SaveOpenScenes()` 返回 true 却**不写盘**；脏场景守卫对 CLI 改动失明（M3 任务 2 真机实测）

**适用引擎**：**两/三引擎共有（Unity 家族共有）** —— 团结引擎 2022.3.62t9 + Unity 官方中国版 2022.3.62f3c1
+ uloop dispatcher 3.5.1 / 包 3.6.3 `[团结 2022.3.62t9 实测，2026-09-19]`；`[Unity 官方 2022.3.62f3c1 实测，2026-09-20]`。

**官方版逐条复现**：

| 探针（官方版 f3c1） | 结果 |
|---|---|
| `unity node create --name DirtyProbe` 之后 `GetActiveScene().isDirty` | **`False`**（CLI 改动不置 dirty） |
| 同一场景磁盘文件 mtime（前后） | `2026-09-20T01:20:16.3245744Z` → **逐字未变** |
| `EditorSceneManager.SaveOpenScenes()` | 返回 **`True`**，但文件内容里 `grep -c DirtyProbe` = **0** |
| 有 CLI 未保存改动时 `scene open`（无 `--force`） | **不落 `DIRTY_SCENE`**，静默换掉内存场景（守卫失明） |

→ **R356/R357 不是团结特性**。`unity scene save` 里「**不用** `SaveOpenScenes`、改逐场景 `SaveScene` + 核对文件 mtime 前进」
这条防御在官方版上**同样必需**（**不是**「团结专属补丁」，也不是「官方版上多余的但无害」）。

**现象 1（根因）：`execute-dynamic-code` 里建/改/删节点不会把场景标脏。**
真机（blind 项目 `C:/Users/<用户>/pi-unity-m2-blind`）：`unity node create` 成功后，
`GetActiveScene().GetRootGameObjects().Length` 从 **5 → 6**，但同一次读数里 `isDirty` 仍是 **False**
（`Scene.path = Assets/Scenes/SampleScene.scene`、`isValid=True`）。即「内存里确实变了、编辑器却认为场景是干净的」。
要拿到 true 的脏标记只能显式 `EditorSceneManager.MarkSceneDirty(scene)` —— 本次验证正是用它复现
「编辑器确实有未保存改动」这个状态的。

**现象 2（后果一，最严重）：`EditorSceneManager.SaveOpenScenes()` 返回 `true` 却一个文件都不写。**
它只保存 **dirty** 的场景，而现象 1 让 CLI 造出来的改动永远是「干净的」→ 它什么都不做并回报成功。
真机证据（修复前）：`unity scene save`（不给 `--path`）→ 工具报 `ok:true / verified:true`，
而 `Assets/Scenes/SampleScene.scene` 的 **mtime / size / md5 调用前后完全不变**（`a64105b6…`，
文件里也没有任何新节点）—— 典型的「报告成功 + 静默不落盘」假绿（然后 `scene open` 一换场景，
内存里那 29 个节点就没了）。

**现象 3（后果二）：`scene open` 的脏场景守卫只能看见「编辑器 UI 造的改动」。**
守卫读的是 `isDirty`（与上游 `EditorUnsavedChangesQuietSaver` / `EditorUnsavedChangesDiscarder` 同源），
所以 **CLI 自己造出来的未保存改动不会被拦**：`scene open`（无 `--force`）会直接换场景、把它丢掉。
⚠️ 反过来也成立：上游 `play start` 的「未保存改动」检测同样看不见 CLI 改动（见 U26）。

**处理**

1. `unity scene save` 已按现象 2 处置（`unity-scripts/scene-save.cs`）：**不用 `SaveOpenScenes`**，
   无 `--path` 时逐场景 `EditorSceneManager.SaveScene(scene, scene.path)`（语义同样是「保存全部打开的场景」），
   且每次保存后**核对文件 mtime 必须前进**；没前进 → `SAVE_FAILED`（退出码 1），绝不 `verified:true`。
   有 `--path` 时 `SaveScene(scene, path)` 本身会无条件写盘（真机：md5 `44ff180d…` → `5a08a69a…`、
   `grep -c "Brick_"` **0 → 24**、size 12009 → 68872 B）。
2. **用 `scene open` 之前必须先 `unity scene save`**（SKILL §3.5 已把 `scene save` 写成强制末步；§5 把「切换场景 / 丢弃改动」列入需用户同意的操作）。
3. **未修（登记待裁定）**：`node create` / `node set` / `node delete` / `sprite set` 都没有 `MarkSceneDirty`。
   补它是**另一项决策**：一旦 CLI 改动会置脏，`play start` 就会走上游的「静默保存 dirty 场景」路径
   （`EditorUnsavedChangesQuietSaver.SaveUnsavedEditorChanges`）→ 会开始**自动写盘**，
   M2 实测的「`Play` 不保存场景（md5 不变）」将不再成立。故本任务（M3 任务 2）不改，交给下一步裁定。

---

## 已知问题登记（M2 收尾，**只登记不改代码**，交最终整分支审查甄别）

> 以下是 M2 各任务审查循环里判定为 **Minor / 延后**、且**属代码或测试行为**的条目。
> 收尾任务（任务 13）按控制者裁定**不改代码**，集中登记于此，供最终整分支审查决定是否合并前修。
> 纯文档项已在同稿修正，不在此列。
> **完整清单以 `docs/M2-DECISIONS.md` 的「延后 Minor」为准**（原文件曾在被 gitignore 的 `.superpowers/` 下，现已随仓库跟踪）（下表为其中属代码/测试行为的条目）。
> **D20–D24 为第 1 轮修复补登，尚未计入账本的 19 组汇总。**

| # | 位置 | 一句话 |
|---|---|---|
| D1 | `lib/golden.js` `mergeCleanup` | 缺 `prev.status === 'failed'` 守卫、且用重建对象而非 `{...next}`（今天不可达，但已 export 供 `doctor` 复用） |
| D2 | `lib/doctor.js` | `findNodeByName` 已无调用方（死公开面）；新的唯一真值 `SMOKE_ITEM_NAMES` 反而不在导出里；`writeLoopItems` 形参名 `callFn` 与全库 `_call` 不一致 |
| D3 | `lib/doctor.js` | 部分 skip 的尾行固定写「因前置步骤失败未执行」，但 `MISSING_PROJECT_PATH` 也产生部分 skip（原因是缺参数） |
| D4 | `lib/golden.js` `isConnectivityFailure` | 把 `WRITE_CALL_FAILED` 归为 blocked（可只在 `phase==='connection'`/`ULOOP_*`/`UNITY_NOT_REACHABLE` 时判）；`cleanupGolden`/`runRound`/`GOLDEN_STEPS` 死导出 |
| D5 | `lib/asset.js` | 编译失败透传时丢上游 `actual`/`phase`（`ULOOP_TRUNCATED` 的 `timedOut/drained/tool/args` 与 `phase:'transport'` 在 `asset write` 路径不可见）；非结论类失败的 message 对「结果未知」不诚实；合法 `--timeout-seconds` 下传无 tripwire |
| D6 | `lib/scene.js` `parseNodeResult` | `label` 硬编码成 `'sprite-set'`（当前唯一调用方正确；第三个调用方出现时应提成形参） |
| D7 | `lib/sprite.js` | `mismatchHint` 无断言（删掉整行 271 条仍全绿）；运行时 `Texture2D`/`Sprite` 只有 `HideAndDontSave`、无销毁路径 |
| D8 | `lib/pixels.js` | `actual.at ? actual.at.color : actual.region.color` 依赖第一段不变量（将来改赋值才脆）；`lib/png.js` 的 chunk 遍历不校验 `len` 边界与 CRC（`RangeError` 而非描述性 `Error`） |
| D9 | `lib/play.js` | 若干净导出（`intArg`/`MODE_ACTIONS`/`UI_ACTIONS`/`uiFailureHint` 等）；`playMode` 未把 `CompileErrors[]` 明细放进 `actual`；`playLogs` 对 `Logs:[{}]` 会编造 `{type:'Log',message:''}`；坐标失败 message 不区分「没给」与「非整数」 |
| D10 | `lib/play.js` | `simulate-keyboard` 的 `ReleasedKeyStates` 未透传（简报正文列了它、代码片段用 `ReleasedKeys`；结果 Y 本机未验证）；文件头注释列的 `--drag-speed`/`--drop-target-path` 未标注「刻意未接线」 |
| D11 | `lib/shot.js` | 失败路径（`NO_SCREENSHOT`/`WINDOW_NAME_LOCALIZED`）仍吞掉上游 `TimedOut`/`ResolvedCaptureMode`/`ScreenshotCount`；`CAPTURE_MODES`/`MATCH_MODES` 未 `Object.freeze` |
| D12 | `lib/envelope.js` | `USAGE_FAILURE_CODES` 的 28 码里 18 个当前无产出点（属计划冻结的跨任务接口，不算死码）；USAGE 图例写「2 = 参数缺失」而 `MISSING_PROJECT_PATH` 归 1。**已解决（2026-09-20 R477，批次 A）**：`MISSING_PROJECT_PATH` 已归 **2 档**，USAGE 图例已同步（`bin/unity.js`）；该数组现为 **41 码**（批次 A 新增 `BAD_FLAG_VALUE` / `DIFF_SIZE_MISMATCH`） |
| D13 | `lib/doctor.js` | 探活/`smoke` 仍直接读 `r.json`，未接入 `envelopeFromCall`（简报限定了接入范围）；`DISPATCHER_HINT` 与 `dispatcherHint` 两套近义文案 |
| D14 | 写路径（`scene`/`sprite`/`asset`） | 截断统一成 `ULOOP_TRUNCATED`（`retryable:true`）→ 对**已生效的 create** 重试会造重复节点；建议补「写入是否生效未知，先用 `scene tree` 复核」hint |
| D15 | `test/template.test.js` | F6 断言（行内含 `mouseFollowLerp` + `Mathf.Lerp` + `Time.deltaTime`）一句注释也能满足 → 更硬可断言 `Mathf.Lerp\(\s*_paddle\.localPosition\.x\s*,\s*mouseX` |
| D16 | `test/scene.test.js` | `r.actual.roots === undefined` 今日恒真（仅形状护栏）；畸形用例注释仍写「`componentsIdx` 不是数组 → `[]`」（R323 后实际是「回退内联」） |
| D17 | `test/golden.test.js` / `test/doctor.test.js` | `/或本就无残留/` 断言对 `recovered` 分支有隐性耦合；guard 用例名按新语义应改名；golden 形状覆盖两文件重叠（入口不同，可接受）；`be.nodes.size === 1` 依赖假后端 path-key 内部实现 |
| D18 | 模板 `PiBrickBreaker.cs` | `FindObjectsOfType<SpriteRenderer>()` 不含未激活对象（砖块预先 `active:false` 时 `RestoreBricks()` 后仍无 sprite）；`HalfWidth=6f` 与 960×640+ortho5（半宽 7.5）不自洽（左右各留 1.5 单位黑边，玩法无碍） |
| D19 | 若干测试 | `test/png.test.js` 的 IHDR width/height 连写两遍 + `.filter((_, i, arr)=>…)` 的 `arr` 未使用；`test/asset.test.js` 的 compile 用例插在 assetWrite 用例中间；`test/shot.test.js` 中部重复 `require`；缺 IDAT 一行的断言强度略低 |
| D20 | `test/shot.test.js` / `lib/shot.js` / `SKILL.md` | `test/shot.test.js:419` 分节注释仍写「三条出路必须写明需裸 uloop」，与本任务断言（不得含裸 uloop）相反；`lib/shot.js` 文件头注释（`:115`）/ `SKILL.md` §4 第 2 条（`:309`）的「不要硬传 `--capture-mode rendering`」「故意不传」与新接线口径有语气张力（均带 EditMode 限定、事实仍成立） |
| D21 | `test/play.test.js` / `lib/play.js` | F1 正例（合法 `Drag` 两侧 from 的 argv 透传）无断言 → 误删 `push` 不会变红；自由字符串参数裸写（`--duration`/`--search-text`/`--target-path`…）会把 `true` 透传上游 → 落上游参数错而非用法错（**全仓既有模式**，非本任务引入） |
| D22 | `lib/asset.js` | `TEMPLATES` / `compressIssues` 两个额外导出（任务 11 落地后若用不到可收窄）；`_readSource` 非 Buffer 误用落 `SOURCE_NOT_FOUND`（仅测试面）；任务 11 落地前 `--template` 落 `SOURCE_NOT_FOUND` 而 hint 未点明「模板文件尚未随包发布」 |
| D23 | `lib/golden.js` | `projectStructure` 保留 `nodeCount` 却排除 `maxDepth`/`otherSceneNames`；`missing-left` / `missing-right` 两种 kind 经投影路径不可达；`GOLDEN_STEPS` 注释里 R80/R82 归因措辞 |
| D24 | `bin/unity.js` / `lib/doctor.js` | USAGE 里 `**…**` 星号在纯文本中原样输出（可读性）；`sceneTree` 注入缝抛错会冒成退出码 3（建议包 try/catch 收敛） |

---

## M3 任务 3（`unity build`）真机新发现（**只追加、不编号**；编号由后续文档任务定）

1. **同时开两个团结编辑器 → 后来者会被单座席 license 踢掉。** 实测：第二个编辑器（S0Project）
   启动后能连上、能跑动态代码，约 **2.5 分钟**后被踢（`UNITY_NOT_REACHABLE`；日志里只有正常的
   `Application.Shutdown.*`，licensing 反复回 `Found 1 entitlement groups and 0 free entitlements`）。
   → 跑 `unity build` 前确认**目标项目的编辑器是唯一开着的那个**（`unity doctor` 的 editor-connection）。
2. **产物名是 `Application.productName`，不是工程目录名。** S0Project 的 productName 是 **`2D Project`**
   → 产物 `2D Project.exe` / `2D Project_Data/`；S8 的手工 `PiBuildScript` 曾把 `S0Project.exe` 写死。
   凡按「工程名 + .exe」猜产物名的代码都会静默找错文件（本命令改为读 report 的 `outputPath` + 磁盘 stat）。
3. **团结的 build target 枚举有别名**：`BuildTarget.WeixinMiniGame.ToString()` 回 **`"MiniGame"`**
   （同一个值有别名）。→ 可用性判定走 `Enum.Parse(typeof(BuildTarget), "WeixinMiniGame")`（能解析成 true），
   但把名字回给用户时必须用**我们自己的候选名**，不能用 `ToString()`。
4. **失败的 `BuildReport` 仍然给 `outputPath`**（`result:Failed`、`totalErrors:1`、`totalSize:0`）——
   **不能**用「outputPath 有没有值」判成败；错误消息在 `report.steps[].messages[]`
   （`m.type.ToString() == "Error"`），`File`/`Line` 为 null（可复用上游 compile 的 `Message/File/Line` 形状）。
5. **`report.summary.totalSize` ≠ 磁盘实测总字节**：实测差 **45,667 B**（首次构建额外产出
   `<productName>_BurstDebugInformation_DoNotShip/`，增量构建不再产出）。→ `sizeBytes` 必须真去磁盘**递归**求和，
   report 的值只作 `reportedSizeBytes` 备查（只算顶层会少报 ~100 MB）。
6. **编辑器内构建很快**：空场景首次 **11.6s**（端到端 13s），重复构建（同场景、无改动，甚至删掉输出目录）**约 2s**；
   S8 的 `-batchmode` 是 29s（差的主要是**编辑器启动**）。→「构建要几十秒」只对 batchmode 成立。
7. **uloop 超时 kill 不会弄死编辑器**：`--timeout-seconds 1` 触发 `BUILD_TIMEOUT` 后，编辑器仍活着
   （`scene tree` 正常），且**没有**孤儿 `uloop.exe` / `uloop-project-runner.exe`。
   → 超时按「构建可能仍在跑」处理，别立刻重跑。
8. **不装模块的目标连输出目录都不会被创建**：`--target webgl` 时脚本在 `IsBuildTargetSupported` 处就返回
   （早于 `Directory.CreateDirectory`）—— 这是「不假装成功」的一个可观察证据（`--out` 目录不存在）。

> ⚠️ **M4 开路探测的 7 条新坑**（`NEW-1`…`NEW-7`）在 `docs/M4-SPIKE.md` 里逐条给出（含真机读数）；**编号与索引表待文档任务统一**（R213 的同一纪律：只追加、不抢注编号）。其中两条最要紧：① 团结把资产身份拆成**两套 id**（`.meta` 的 56 字符 base64 vs YAML/API 的 32-hex）→ **删 `Library/` 或全新 clone 有断引用风险**（未测，最高优先级）；② `alphaIsTransparency` 会**改写透明像素的 RGB**、`maxTextureSize` 不足会**静默缩放** → **去底/裁边必须在 Node 侧做**（复用 `lib/png.js`）。

---

## 追加：Unity 官方版验证新坑（2026-09-20，**暂不编号**）

> 本轮是**验证**任务（Unity 官方中国版 2022.3.62f3c1 + 2022.3.62f1c1 ↔ 团结 2022.3.62t9 对照），
> 发现的差异**只记录不改代码**。以下条目按 **M4-SPIKE 的同一纪律**处理：**只追加、不抢注 U 编号**
> （编号与索引表由后续文档任务统一）。完整实测数据见 `docs/CAPABILITIES-unity-2022.3.62f3c1.md`
> 与 `docs/UNITY-OFFICIAL-VERIFICATION.md`。

### 官方-1. **官方版场景文件只认 `.unity`**：`.scene` 一律被拒（**SKILL 现文案会把人引向必失败的命令**）

**现象（真机，f3c1 与 f1 都复现）**

| 命令 | 结果 |
|---|---|
| `unity scene save --path Assets/Scenes/SampleScene.scene` | ❌ `SAVE_FAILED`（退出码 1）：`SaveScene 返回 false（确认路径形如 Assets/Scenes/X.scene，且父目录存在）` —— **父目录存在也一样** |
| `unity scene save --path Assets/Scenes/SampleScene.unity` | ✅ `verified:true`，`mtimeBefore 0001-01-01 → mtimeAfter …`，文件真落盘 |
| `unity scene open --path Assets/Scenes/FromTuanjie.scene`（团结的场景） | ❌ `OPEN_FAILED`：`Scene file path not valid: '….scene'. **Extension should be '.unity'**` |
| 同一份团结场景**改名** `FromTuanjie.unity` | ❌ 仍 `OPEN_FAILED`：`Cannot open scene with path …`（团结场景的 YAML `%TAG !u! tag:yousandi.cn,2023:` 不被官方版接受；官方版是 `tag:unity3d.com,2011`） |

**后果**

- SKILL §3.5 / §5 / §8⓪ 里 `unity scene save --path Assets/Scenes/SampleScene.scene` 的示例、
  以及 `scene save` / `scene open` / `build` 的 **hint 文案**（`用 unity scene save --path Assets/Scenes/X.scene`）
  在官方版上**直接指向必失败的命令**（U10 说的「硬编码 Unity 约定会挂」在这里是**反向**：SKILL 硬编码了**团结**约定）；
- **两个引擎的场景资产不能互读**（`.scene` ↔ `.unity` 双向都不行：官方读不了团结场景已被证明，反向未测）。

### 官方-2. **`unity shot` 在「团结 + 官方共存」的机器上对官方英文界面必失败**（U7 的镜像）

**现象（真机）**：官方版编辑器界面是**英文**（`exec` 枚举 `EditorWindow.titleContent`：`GameView=>Game / SceneView=>Scene /
ConsoleWindow=>Console / SceneHierarchyWindow=>Hierarchy / ProjectBrowser=>Project / InspectorWindow=>Inspector`），
但默认 `unity shot` 落 `WINDOW_NAME_LOCALIZED`（退出码 1）：`Window '游戏' not found (MatchMode: exact)` ——
`--window-name Game` 也照样失败（先被映射成 `游戏`），`--match-mode contains/prefix` **救不回来**，
`--capture-mode GameView` 在 EditMode 又直接报 `Rendering screenshots require PlayMode`。
**EditMode 下没有任何一条出路；只有进 PlayMode 走 `rendering`**（此时上游忽略窗口名）。

**根因**：`lib/editor-discovery.js` 的 `hubRoot()` **写死 `%APPDATA%\TuanjieHub`**，
`language()` 只读它的 `languageConfig.json`（本机 `{"language":"zh_CN"}`）——**与「当前连的是哪个编辑器」无关**。
反证：`windowNameFor('Game','en_US') === 'Game'`（恒等），即**机器上只有官方版、没有 TuanjieHub 目录时默认 `shot` 是好的**；
本缺陷只在双引擎共存的机器上暴露（本机正是如此）。

> **补充（探测顺序的边界）**：`7bb2164` 起 `language()` 改为**多 Hub 探测**
> （`lib/editor-discovery.js` 的 `HUB_DIRS = ['TuanjieHub','UnityHub']`，依次读 `languageConfig.json`，
> 取第一个能读到的）。**探测顺序（团结优先）是兼容既有行为的选择，不等于「所连编辑器的语言」** ——
> 官方版英文界面上仍可能报出团结的 `zh_CN`（本机 `%APPDATA%\UnityHub\` 没有 `languageConfig.json`）。
> 「**按所连编辑器选 Hub**」（或直接读所连编辑器的界面语言）**留作后续接口**，本轮不改探测语义。

### 官方-3. **`doctor` 的 `build-targets` / `editor-language` 在多引擎机上取自 `editors[0]`（团结在前）→ 会骗人**

**现象（真机）**：官方版项目上 `unity doctor` 报

```
OK  editor-install     2022.3.62t9 (tuanjiehub:secondaryInstallPath), 2022.3.62f1 (unity:hub-default), 2022.3.62f3c1 (unity:hub-default)
OK  editor-language    zh_CN（hub: …\AppData\Roaming\TuanjieHub）
OK  build-targets      AndroidPlayer, WeixinMiniGameSupport, windowsstandalonesupport
```

但**真正连着的那个编辑器**（f3c1）的 `Editor/Data/PlaybackEngines/` **只有 `windowsstandalonesupport`**，
界面也是英文。判据被 `lib/doctor.js` 的 `playbackEngines(path.dirname(editors[0].path))` 决定 ——
`editors[0]` 是**发现顺序里的第一个**（团结），不是连接中的那个。

**后果（实测，不是推测）**：`doctor` 说 `android` 可用 → `unity build --target android` 落
`BUILD_TARGET_UNAVAILABLE`（`actual.available:["win64"]`，退出码 1）。
→ **多引擎机上 `doctor` 的 `build-targets` 不可信**；构建目标的真值只有 `unity build` 的 `actual.available`
（或直接看那个编辑器的 `PlaybackEngines` 目录）。

### 官方-4. 官方版 GUI 启动有**阻塞式管理员对话框**（脚本化必踩）

以管理员身份启动时，Unity 在**创建 `-logFile` 之前**弹模态框（实测：不点它，`editor.log` **根本不存在**、
进程停在 ~117 MB 不动，`uloop` 侧表现为「连不上」）：

```
[#32770] "Unity is running as administrator."
  "&Restart Unity as a standard user"        ← 别点：会重启并**再次弹同一个框**（管理员会话里循环）
  "&I wish to continue at my own risk"       ← 点它才会继续
```

处置：对标题为 `&I wish to continue at my own risk` 的按钮发 `BM_CLICK`（`0x00F5`）。
（团结侧**没有**这个框——但本轮没开团结，**未复测**。）

### 官方-5. 新建官方版项目的 **Game 视图默认没打开** → PlayMode 的 `rendering` 截图也会失败

**现象（真机，f3c1 新建项目）**：`play start` 成功后 `unity shot --capture-mode rendering` →
`ULOOP_ERROR: PlayMode rendering did not produce an image.`（退出码 1），
`unity play logs` 里能看到 `[EditorWindowCaptureUtility] Play Mode view RenderTexture is not available`。
用 `exec` 执行 `EditorWindow.GetWindow(typeof(GameView)).Show()` 打开 Game 视图后，**同一条命令立刻成功**（960×640）。

**未定论**：团结侧的盲测项目是 Hub 模板建的（Game 视图本来就在布局里），因此**不能断定这是官方版独有**。
可操作结论一致：**先确保 Game 视图打开，再指望 rendering 截图**。

### 官方-6. 官方版空项目**不含 `com.unity.test-framework`** → 一个 asmdef 被**条件跳过**（42/44 DLL）

`UnityCLILoop.FirstPartyTools.RunTests.TestFramework.Editor.asmdef` 带
`defineConstraints:["ULOOP_HAS_TEST_FRAMEWORK"]` + `versionDefines: com.unity.test-framework`；
`-createProject` 出来的官方空项目没有该包（团结 S0Project 是 Hub 模板建的，带 `1.1.33`）→
**44 asmdef 只产出 42 个 `UnityCLILoop.*.dll`**（另 2 个是 Unity 提供的 `Unity.InternalAPIEditorBridge.024` 与这个被跳过的）。
**这不是缺陷**：`0 error / 0 warning`，`.uloop/tools.json` 仍是 **21 个工具**（与团结逐字相同）。

### 官方-7. 官方版 `-createProject` 的空项目是 **3D 透视相机 + 没有场景文件**

- `Assets/` 为空（**没有 `SampleScene`**）→ 不先 `scene save` 就 `unity build` 会落 **`BUILD_NO_SCENES`**（退出码 1）；
- `Camera.main` 是**透视**（`orthographic=False`、`position (0,1,-10)`、FOV 60，`orthographicSize=5` 不参与成像）→
  **SKILL §8⑤ 的 `pixelsPerUnit = 高/(2×orthographicSize)` 公式不适用**。真机：6×6 世界单位的纯色 sprite 在 960×640
  rendering 图里是 **110224 px**（≈332×332），而正交公式预期 147456 px（384×384）——
  **像素坐标换算必须以实际相机为准**，判「渲染对不对」用 `--at` / `--count-color` 这类相对判据。

### 官方-8. `build` / `scene save` 的 **hint 文案写死 `.scene`**

`unity build` 的 `BUILD_NO_SCENES` hint 是「先用 `unity scene save --path Assets/Scenes/X.scene` 把场景落盘」，
`lib/scenefile.js` 的几处 hint 也写 `…X.scene` —— 在官方版上这些文案**指向必失败的命令**（见官方-1）。
**属于文案/文档面**（本轮不改代码），交后续任务一并处置。

---

## M4（美术导入层）：团结 2022.3.62t9 真机新坑 U28–U35

> **来源**：`docs/M4-SPIKE.md`（团结 2022.3.62t9 真机 spike 的 `NEW-1`…`NEW-7`）+ 本任务
> （任务 7）的统一编号。
> ⚠️ **U28–U34 中，仅 U29 仍未在官方 2022.3 上验证** —— **U28/U31/U32/U33 已由批次 C-A（2026-09-20）官方 2022.3.62f3c1 复测**。
> **例外（R476）：U30 已在官方 2022.3.62f3c1 上复核** —— 「两套 id」只在团结新导入资产上成立，官方版实测同一个 32-hex。
> U35 是**本包自身**的 PNG 支持面限制（引擎无关）。

### U28. `TextureImporter` **没有** `spriteMeshType`/`spriteExtrude`/`spriteAlignment` → 必须 `TextureImporterSettings` 往返

**适用引擎**：**两引擎共有（Unity 家族共有）** —— 团结 2022.3.62t9 + Unity 官方中国版 2022.3.62f3c1（`docs/m5-probes-raw/ca-04-u28-direct.json` CS1061 逐字复现、`ca-04b-u28-settings.json` 往返成功）[2026-09-20 实测]。

**现象**：`ti.spriteMeshType = SpriteMeshType.FullRect;` 等写法在真机上落 **CS1061**（成员不存在）；
`UnityEditor.SpriteMeshType` 落 **CS0234**（该枚举在 **`UnityEngine`** 命名空间）；`spriteExtrude` 是 **`uint`**
（字面量必须写 `0u`）。**`SpriteAlignment` 也在 `UnityEngine` 命名空间**（写 `UnityEditor.SpriteAlignment` 同样落 **CS0234**）。

**处理**：这三个值走 settings 往返 ——

```csharp
var s = new TextureImporterSettings();
ti.ReadTextureSettings(s);
s.spriteMeshType = SpriteMeshType.FullRect;   // UnityEngine
s.spriteExtrude = 0u;                          // uint
s.spriteAlignment = (int)SpriteAlignment.Center;
ti.SetTextureSettings(s);
ti.SaveAndReimport();
```

**为什么重要**：静态契约测试测不出（测试里写对名字就行，真机编译不过）；只能真机编译验证。
本包的 `unity asset import` 已按此实现。

### U29. 外部进程写进 `Assets/` 的文件**不会**被自动导入 → 必须显式 `ImportAsset`

**适用引擎**：团结 2022.3.62t9 实测；官方 2022.3 未验证。

**现象**：用 shell 拷贝 / `unity asset write --no-compile` 写进 `Assets/` 的 PNG，**9.7 s 后**读回仍是
`guid=""` / **没有 `.meta`** / `loadable=false`（文件在盘上、AssetDatabase 里不存在）。

**处理**：必须显式 `AssetDatabase.ImportAsset(relPath)`（实测 **89 ms**），不要用 `Refresh()`
（首轮全量 **3540 ms**）；`unity asset import` 已内置这一步。**不要**借 `asset write` + `compile` 的
`refresh` 副作用 —— 它虽然会顺带导入，但拿到的是一整套**错误默认设置**（见 U31）。

### U30. `.meta` 的 `guid:` 与引用用的 32-hex 是**两套 id** —— **只在团结新导入资产上成立**（官方实测是同一个字符串）

**适用引擎（R476 收紧，2026-09-20）**：
- **团结 2022.3.62t9 新导入资产实测**：`.meta` 的 `guid:` 是 **56 字符 base64**，与 `AssetPathToGUID` /
  YAML 引用用的 **32-hex** 是**两套 id**。
- **官方 2022.3.62f3c1 实测**（M4 第三方复核者实读：`hero-blind.png.meta:2` 与 `SampleScene.unity:183`）：
  `.meta` 的 `guid:` 与 YAML 引用的 **32-hex 就是同一个字符串**（`26420c8d342448e43b747360ee134d7d`）
  → **「两套 id」不是普遍规律**，随引擎 / 导入器版本而异。
- 另：**老资产**（如模板场景的 `.meta`）在团结上也是 32-hex —— 两种形态本来就都存在，别假设统一。

**现象（团结 2022.3.62t9）**：PNG 的 YAML 引用写的是 `guid: 0e6760542563e834ba84aaf6cb1fb4ae`（**32-hex**），
而 `.meta` 里是 `guid: Dy8ZsiytVn8eFGLDNO3RSsqCBSoXs3klvy5IrAbJpfpb89U/xOyIQ4k=`（**56 字符 base64**）。
把 `.meta` 的 guid 手改成别的值：引擎**接受并保留**，但 **32-hex 引用 guid 一动不动** → 手改 `.meta`
**不能**改变引用 id。

**处理**：不要指望「手写 `.meta` 把引用指过去」。交付/迁移只认「同批提交」（见文末 `### M4：…`）。
⚠️ 这条**不要**写成「所有引擎都这样」：官方版上 `.meta` 的 guid 就是引用用的那个 32-hex（上面的复核证据）。

### U31. **默认导入设置随引擎/工程模板变**（团结=Sprite；官方 3D 模板=Default）→ 像素画必须逐项显式设置

**适用引擎**：**默认值随引擎/工程模板变** —— 团结 2022.3.62t9 默认 `textureType=Sprite`；Unity 官方中国版 2022.3.62f3c1（3D 模板）默认 `textureType=Default`、`alphaIsTransparency=false`、`npotScale=ToNearest`、`spriteImportMode=None`（`docs/m5-probes-raw/ca-01-defaults.json`）[2026-09-20 实测]。**结论不变：像素画必须逐项显式设置。**

**现象**：首次导入得 `textureType=Sprite / filterMode=Bilinear / textureCompression=Compressed /
spritePixelsPerUnit=100 / spriteMeshType=Tight / spriteExtrude=1 / isReadable=false /
alphaIsTransparency=true`；实测 8×8、24×16 分别落地为 **`DXT1`、`DXT5` + `Bilinear`** —— 像素画直接糊。

**处理**：像素画必须逐项显式设置（`filterMode=Point`、`textureCompression=Uncompressed`、
`spritePixelsPerUnit`、`spriteMeshType=FullRect`、`spriteExtrude=0`、`mipmapEnabled=false`、
`wrapMode=Clamp`、`npotScale=None`、`spriteImportMode=Single`）—— `unity asset import` 已固定这一套。
默认值**随工程模板变**，不要依赖「没写就是对的」。

⚠️ 官方版默认 **`npotScale=ToNearest`**：会把 NPOT 源静默放大到最近的 2 的幂（24→**32**，`docs/m5-probes-raw/ca-01-defaults.json`）—— 这与 **U32** 是**两个不同的缩放变量**；团结侧该默认值**未实测**，故一律显式设 `npotScale=None`。

### U32. `maxTextureSize` 小于源尺寸会**静默缩放**（无警告、无失败）

**适用引擎**：**两引擎共有（Unity 家族共有）** —— 团结 2022.3.62t9 + Unity 官方中国版 2022.3.62f3c1（24×16 + `maxTextureSize=8` → 8×5，`docs/m5-probes-raw/ca-02-maxsize.json`；**前置 `npotScale=None`**，否则先被 U31 的 `ToNearest` 放大到 32）[2026-09-20 实测]。

**现象**：源 **24×16** + `maxTextureSize=8` → 导入后真实纹理 **8×5**。

**处理**：`unity asset import` 把 `--max-size` 自动抬到 ≥ `max(w,h)` 的 2 的幂，并**读回真实尺寸**
（`actual.asset.texWidth/texHeight`），`actual.maxTextureSizeRaisedFrom` 记用户原值。

### U33. `alphaIsTransparency=true`（团结默认）会**改写透明像素 RGB**；`alphaSource=None` 是**丢弃 alpha**

**适用引擎**：**机制两引擎共有、默认值不同** —— `alphaIsTransparency=true` 时透明像素 `(0,0,0,0)`→`(1,0,0,0)`（被邻居填充），Unity 官方中国版 2022.3.62f3c1 实测 `docs/m5-probes-raw/ca-03b-alpha.json` [2026-09-20]；**默认值**：团结=`true`、官方=`false`。

**现象**：磁盘上 `(0,0,0,a=0)`，`alphaIsTransparency=true` 导入后是 `(1.0,0,0,a=0)`（被邻居红填充）；
`false` 才回到原值。`alphaSource=None` 不是去底，而是**丢弃 alpha**（格式退回 `DXT1`）。

**处理**：**像素处理只在 Node 侧做**（`--remove-bg` / `--trim` / `--fit`，`lib/art.js`）；
Unity 侧只做声明式导入设置。生产图 `isReadable=false`。

### U34. `spriteMeshType=Tight`（默认）在 66% 透明边界的精灵上**不裁剪几何** → 不能用它裁边

**适用引擎**：团结 2022.3.62t9 实测；**Unity 官方中国版 2022.3.62f3c1 已于批次 B-2（2026-09-20）复测：`Tight` 下 `Sprite.bounds` 与 FullRect 全同（`{0.375,0.25}`）、`--world-size` 仍 `verified:true`（`docs/m5-probes-raw/b2t2-tight-*`）**。

**现象**：24×16、四周全透明、中心 6×4 不透明红块的 fixture，`Tight` 与 `FullRect` 读回**全同**
（`verts=4 / tris=6 / rect=全图 / textureRect=全图`），透明像素仍在纹理里。

**处理**：裁边用 Node 侧 `--trim`（`unity asset import` 固定 `spriteMeshType=FullRect`）；
**不要**指望 `Tight` 帮你缩小纹理或裁几何。

### U35. **PNG 支持面（本包自身限制）**：调色板 / 隔行 PNG 落 `BAD_PNG`

**适用引擎**：**pi-unity 自身限制（引擎无关）**。

**现象**：`lib/png.js` 只吃 **bitDepth 8 / colorType 0,2,4,6 / 非隔行**；
**调色板（colorType 3）**与**隔行（interlace=1）** 的 PNG 解码时落 **`BAD_PNG`**（退出码 1）。

**处理**：让用户把图**另存为 PNG-24 / PNG-32（非隔行）** 再导入 —— hint 已给出这条出路。
（与 pi-cocos 的 PNG 支持面同源，属于已知取舍。）

---

## M4（命令面 / Prefab / 交付）：任务 3–6 真机新坑 U36–U45 + 最终修复波 U46–U47

> 本节是任务 3（`asset import`）/ 4（`sprite assign`）/ 5（探测报告）/ 6（`prefab`）审查与真机里的
> 累积发现。每条已标适用引擎；未特别说明时仍以团结 2022.3.62t9 为实测面。
> **批次 C-A（2026-09-20）已在官方 2022.3.62f3c1 上复测 U36/U39/U40/U41/U42**（见各条「适用引擎」行）；其余条目官方版**仍未验证**。

### U36. 默认 `shot` 是 **window 模式**：图尺寸由 Game 窗口决定，不是 `play view` 请求的尺寸

**适用引擎**：**两引擎共有（Unity 家族共有）** —— Unity 官方中国版 2022.3.62f3c1 `--capture-mode window` → 1101×540（请求 960×640，`docs/m5-probes-raw/ca-13-shot-window.json`）[2026-09-20 实测]；团结 2022.3.62t9 观测 892×355。

**现象**：`play view --width 960 --height 640` 之后跑默认 `unity shot`，回的是 **892×355**
（`captureMode:"window"`、窗口名「游戏」）—— 每单位像素数从 **64 变 ≈33.3**。
**成因未探测**（`docs/M4-PROBES.md` 未探测项 U6），但后果确定：拿 window 模式的图做几何对账会**对不上**。

**处理**：要判几何/可见性就**显式** `--capture-mode rendering`（需 PlayMode），
并**按图的实际尺寸**算 `pixelsPerUnit`（不要假设 960×640）；判「颜色在不在 / 有几个像素」这类
**相对判据**才可以用 window 图。指标位置别猜，看 `actual.path`。

⚠️ **官方版差异**（`docs/UNITY-OFFICIAL-VERIFICATION.md` 差异表 **S8**）：Game 视图未打开时，PlayMode 默认（auto→rendering）会**直接失败** —— S8 记录的报文是 `Play Mode view RenderTexture is not available`，批次 C-A 实测的是 `ULOOP_ERROR: PlayMode rendering did not produce an image`（`docs/m5-probes-raw/ca-12-shot-auto.json`）；两条都是「先确保 Game 视图已开」的同一类问题。

### U37. `scene save --path X` 是 **Save-As**（不是「存回原路径」）

**适用引擎**：命令面（引擎无关）；团结 2022.3.62t9 实测。

**现象**：跑了 `unity scene save --path Assets/M4Probe/ProbeScene.scene` 之后，
`scene tree` 从 `SampleScene` 变成了 `ProbeScene` —— 该命令把**当前活动场景**另存为 `X`，
并让 `X` 成为活动场景（`docs/M4-PROBES.md` 观察 O6）。

**处理**：**别**对用户的验收场景用 `--path`；想存回场景自己的路径就不带 `--path`
（`scene save` 无 `--path` = 保存全部打开的场景）。搭自己的新场景后另存成新路径是正常用法。

### U38. `GameObject.Find` **找不到非激活对象**（返回 `null` → 脚本里 NRE）

**适用引擎**：Unity 家族共有（文档语义）；团结 2022.3.62t9 实测观测（真机 `exec` 对非激活对象
调 `GameObject.Find` → `ok:false`，NullReference）。

**现象**：`GameObject.Find("X")` 对 `active:false` 的节点返回 `null`；紧接着 `.GetComponent<…>()`
就是 NullReferenceException（探测时一度被误读成「操作没生效」）。

**处理**：写 `.cs` / `unity exec` 时按路径查要用**含 inactive** 的遍历 ——
`GameObject.GetRootGameObjects()` 逐层下钻，或 `FindObjectsOfType<Transform>(true)`（`includeInactive:true`）；
本包的 `node-inspect` / `node-set` / `sprite-assign` 已按这条处理。

> 与 M1 的 **R63/R80** 同源（`docs/M1-DECISIONS.md`）：`scene tree` **会**列出非激活节点，
> 所以「看得见却 inspect 不到」是误导 —— 用 `GameObject.Find` 的实现会把 `NOT_FOUND` 引向错误方向。

### U39. `prefab create --force` 是「**更新**」不是「重建」：三条跟随规则

**适用引擎**：**两引擎共有（Unity 家族共有）** —— 官方 2022.3.62f3c1 三条规则复现（`docs/m5-probes-raw/ca-49-after-force.json` / `ca-31-root-dump.json`）[2026-09-20 实测]；**前提：实例覆盖已随 `scene save` 落盘**（否则见 **U54**）。

**现象**：三次覆盖同一路径，资产 **guid 不变**、内容真更新、引用该资产的旧实例仍在读值；
但实例的跟随行为分三种：

| # | 规则 | 证据 |
|---|---|---|
| ① | 未被 override 的属性 → **跟随**资产 | `PfOldInst` 无 `m_LocalScale` → 资产 `4,4→6,6` 后实例跟着变 |
| ② | 已被 override 的属性 → **保持实例自己的值**（不回退） | 同场景 `PfInst1` 有 `m_LocalScale.x=2.1333334/.y=2.4`（实测部分；「不回退」是 Unity 语义 + 推论） |
| ③ | **根 `localPosition` 恒被记为 override → 永不跟随** | `PfOldInst` 有 `m_LocalPosition`（-3/-3/0）却从未改过 position |

**处理**：`--force` 不会把已有实例的根位置拉回资产值（③ 是用户最容易误解的一条）；
写完 Prefab 后如果实例位置重要，显式 `unity node set --patch '{"position":…}'`。
完整落盘原文见 `docs/M4-PROBES.md` §②-8。

⚠️ **前提（批次 C-A 实测）**：以上三条成立的前提是**实例覆盖已随 `scene save` 落盘** —— 未保存场景时 `prefab create --force` 会重置实例名与全部覆盖（**U54**）。

### U40. `SaveAsPrefabAsset` **不把源节点变成实例**；`InstantiatePrefab` **沿用资产生成时的位姿**

**适用引擎**：**两引擎共有（Unity 家族共有）** —— 官方 2022.3.62f3c1：源节点 `prefabInstanceStatus=NotAPrefab`、实例初始位姿=资产生成位姿（`docs/m5-probes-raw/ca-49-after-force.json`）[2026-09-20 实测]。

**现象**：`prefab create` 之后源节点仍是**普通节点**（不是 Prefab 实例）—— 之后改 Prefab
**不会**影响它；要联动必须再 `prefab instantiate`。而 `InstantiatePrefab` 出来的实例**沿用**
资产生成时那个节点的 position/scale（源节点在 `-3,-3` 时，实例直接读回 `-3,-3`）→ 连续实例化多个
会**叠在一起**。

**处理**：建完实例显式设位置；`prefab instantiate` 的 `--parent` 用 `SetParent(t, false)`，
实例的**局部** position/scale 保持资产值（世界位置/尺寸随父级变换）—— 父级不存在落
`PARENT_NOT_FOUND` 且**本次不建任何实例**。

### U41. **用文件名覆盖 Prefab 根名**（连文件内 `m_Name` 都不算数）

**适用引擎**：**两引擎共有（Unity 家族共有）** —— 官方 2022.3.62f3c1：`--to CaDifferent.prefab` → 根名 `CaDifferent`（`docs/m5-probes-raw/ca-21-prefab-create.json`）[2026-09-20 实测]。

**现象**：`--from-node Brick_0_0 --to Assets/Prefabs/Brick.prefab` 存出的根名是 **`Brick`**（文件名），
不是源节点名；尝试构造「根名 ≠ 文件名」（文件内写 `m_Name: Enemy`）**也失败** —— 仍被读成
`Enemy Variant`。

**处理**：`prefab create` 的 name intent **按 `--to` 的 basename**（`lib/prefab.js` 已如此）；
`prefab instantiate` 不给 `--name` 时用**资产读回的真实根名**（不是猜 basename）；
所有读写都以 `AssetPathToGUID` / 资产读回为准。

### U42. 同父下**多个同名实例**时 `node inspect` 只能定位到其中一个（**不会**自动加 `' (1)'`）

**适用引擎**：**两引擎共有（Unity 家族共有）** —— 团结 2022.3.62t9 实测；官方 2022.3.62f3c1 已由批次 B-1（R480）复测（见 **U50**）。

**现象**：真机与「Unity 会自动加 `(1)`」的假設**相反** —— `InstantiatePrefab` + `SetParent(false)` 直接
造出两个**同名**节点；`GameObject.Find` 同名有歧义，读回只能命中其中一个（方向安全 = 假红，
但砖块阵列这种可预期用法会撞上）。

**处理**：要**精确归属**就用 `prefab instantiate --name` 区分；多实例验收里**必须**给不同 `--name`
（否则 `node inspect` / `pixels` 的归属都会含糊）。

**订正（2026-09-20，批次 B-1；Unity 官方中国版 2022.3.62f3c1 实测）**：`unity node inspect`
现已支持 `--sibling-index <真实子序号>` **唯一定位**同父同名实例（`siblingIndex` 就是
`unity scene tree` 读回里该节点的 `siblingIndex` 字段值 = `transform.GetSiblingIndex()`，
**同父下可能不连续**，**不是**「同名命中列表的下标」）；命中多个且不给参数时仍取第一个（**保持既有行为**，
`--name` 用法不受影响），但读回面新增 `matchCount`，并追加一条精确定位的 hint。详见 **U50**。

### U43. 资产 sprite 的尺寸口径：`--world-size` 依赖 `SpriteRenderer.bounds`（世界 AABB）——**旋转（已实测）/ 非均匀缩放（部分实测）会（预期地）落 `verified:false`**；`Tight`/`Sliced`/`Tiled` 与图集的影响**未探测**；图集（Multiple）→ `AMBIGUOUS_SPRITE`

**适用引擎**：**pi-unity 自身行为**（Node 侧反算）+ 引擎面已实测（`Tight` 的几何行为见 U34）。

**现象**：`sprite assign --world-size` 写侧用 `Sprite.bounds.size`（`sprite-assign.cs`）、读侧用
`SpriteRenderer.bounds.size`（`node-inspect.cs`）反算/回读 —— 两者是**同一个量**（世界 AABB = 精灵 bounds × 缩放，
`Tight` 与 `FullRect` 的 `Sprite.bounds` 是同一个 rect）。恒等只在 **无旋转 + 无（非均匀）缩放**时成立：

- **旋转**：`sr.bounds` 是**世界 AABB**，旋转后它不等于精灵宽高 → 如实落 `verified:false`
  （**已实测**，这是预期行为、不是 bug：口径不成立就拒绝假绿）。
- **非均匀父级缩放**：同样会破坏写读口径（**部分实测**）。
- **`Tight` / `Sliced` / `Tiled`**：写侧与读侧用的是同一个量，**旋转/非均匀缩放之外恒等成立** →
  **没有实测证据支持「它们让 `--world-size` 落 `verified:false`」**；`Tight` 甚至**不裁几何**
  （与 `FullRect` 全同，见 **U34**）。这条判据在它们下的影响**未探测**（真机上只测过 `make-multiple`）。
- **图集（Multiple）**：资产直接落 **`AMBIGUOUS_SPRITE`**（退出码 1，**硬失败** —— **不会**随便挑一个子图）。

另：**Screen Space Overlay 的 Canvas** 下 `CanvasScaler` 会缩放子节点 → `--world-size` 写读自洽，
但**画面里的视觉尺寸不等于世界单位**。

**处理**：只保证 `unity asset import` 出的 `spriteMeshType=FullRect` + `spriteImportMode=Single`；
尺寸以 `unity node inspect` 的 `sprite.worldSize` 为准，几何判据改用 `shot` + `pixels`。

**订正（2026-09-20，批次 B-2；Unity 官方中国版 2022.3.62f3c1 实测）**：上面「`Tight`/`Sliced`/`Tiled` 写侧与读侧用的是同一个量」的说法**只对 `Tight` 成立**，`Sliced`/`Tiled` 会分叉：
- **`Tight`**：`Sprite.bounds` 与 `FullRect` 全同（`{0.375,0.25}`），`--world-size 2,1` 仍 `verified:true`（`docs/m5-probes-raw/b2t2-tight-*`）。
- **`Sliced` / `Tiled`**：读侧 `sr.bounds.size = sr.size × scale`，写侧用 `Sprite.bounds` —— 仅当 `sr.size == sprite.bounds` 时才一致；否则**如实落 `verified:false`**（`b2-a7c-assign-sliced-size5.json` / `b2-a8c-assign-tiled-size5.json`）。机制与出路见 **U52**。
- **图集（SpriteAtlas）—— 已于批次 C-C（2026-09-21）钉死**：图集**打包不改** `Sprite.bounds.size`，也不改 `AssetDatabase.GetAssetPath(sprite)`（打包后 `node inspect` 的 `sprite.assetPath` 仍是原 PNG）；因此 `sprite assign --asset <原PNG> --world-size` 仍 **`verified:true`**（`docs/m5-probes-raw/cc-21`/`cc-22`/`cc-23`）。且**无需 `com.unity.2d.sprite` 包**（`SpriteAtlas`/`SpriteAtlasAsset`/`SpriteAtlasUtility` 都在核心程序集，`cc-01`）。`Multiple`（一张图多子 sprite）仍硬失败 `AMBIGUOUS_SPRITE`（退出码 1，`count:2`；`cc-31`/`cc-32`）。

完整探测报告见 `docs/M5-PROBES.md` §9/§12。

### U44. payload 类命令的 `.cs` **编译错报文不可读**（只落 `ULOOP_ERROR` 无 Message）

**适用引擎**：**pi-unity 命令面**（引擎无关）；团结 2022.3.62t9 实测形状。

**现象**：`prefab` / `sprite assign` / `node *` 这类走 **payload 调用**的命令，
`.cs` 编译错时上游不透出 `CompilationErrors`，只落 `ULOOP_ERROR` 且 **Message 为空/怪** ——
与 M3 的 **R352** 同形状，但 R352 只在 `unity exec`（`lib/dynamic.js`）里认了形状，
**没推广到 payload 调用**。

**处理（旁路诊断）**：① 用 `unity exec --code '<同一段代码>'` 复现同一段代码 ——
它会给出 `SCRIPT_COMPILE_ERROR` + `file:line:message`；② 直接看项目目录的 `Editor.log`。
**这是一个已知缺口**（已登 backlog，要改共享的 `lib/envelope.js`/`lib/scene.js` 路径，需单独走一轮）。

### U45. `--remove-bg auto` 的两个陷阱（四角全透明 / 部分角透明）

**适用引擎**：**pi-unity 自身行为**（`lib/art.js` 的四角推断，Node 侧；引擎无关）。

**现象 / 处理**：

1. **四角全透明** → 落 **`BACKGROUND_AMBIGUOUS`**（退出码 1，`detail.reason:'transparent-corners'`）——
   这张图**本来就没有实心背景**：**别给** `--remove-bg`，直接 `--trim` 即可（hint 已这么写）。
2. **部分角透明**时四角推断**仍可能误判**（**未探测**）→ 自动去底不可靠时改用
   `--remove-bg '#RRGGBB'`（用 `read` 打开原图取色）或干脆不去底。

### U46. **并行调用 `unity` 会互相踩**（两个错误码都不指向真实原因）

**适用引擎 / 证据等级**：团结 + 官方版实测；**单源证据（盲测者单方报告，未被第三方复核者复现）** ——
复核者刻意串行，未复现本条（见 `docs/E2E-ACCEPTANCE-m4.md` 的「未过项 / 降级项」）。

**现象**：
- 并行两条 `unity exec` → `SCRIPT_COMPILE_ERROR: Another execution is already in progress`；
- 并行两条**只读**命令（如 `unity scene tree`）→ `ULOOP_TRUNCATED`。

**为什么危险**：这两个码**都不指向真实原因** —— 前者看着像「C# 编译错」（会误导去改脚本 / 查代码），
后者看着像「dispatcher 路径错 / 传输截断」（会误导去查环境）。实际唯一成因是「另一条命令还在跑」。

**处理**：
1. **一次只发一条 `unity` 命令（含只读命令），不许并行调用**（SKILL §2 铁律）。
2. 遇到这两个码先怀疑**并发**：等前一条跑完，**串行重试**；不要先去改 C#、也不要先查 dispatcher 路径。
3. hint 层面的改进（让 `SCRIPT_COMPILE_ERROR` / `ULOOP_TRUNCATED` 直接指向并发）**已登 backlog** ——
   要改共享的 `lib/dynamic.js` / `lib/uloop.js`，不在本轮范围。

> **订正（2026-09-20 真机，见 `docs/M5-PROBES.md`）**：本条目原文称「并行**只读** → `ULOOP_TRUNCATED`」——**未复现**（6 条与 10 条并行 `scene tree` 均未出现 `ULOOP_TRUNCATED`）。真实码是 **`UNITY_SERVER_BUSY`**（见 U49）。`ULOOP_TRUNCATED` 只在 dispatcher 真的起不来（如 `PI_UNITY_ULOOP_CMD` 路径写错）时出现，**不要**据此给截断路径加并发 hint。

### U47. `AssetDatabase.AssetPathToGUID` 在 `DeleteAsset` 后**仍返回过期 guid** → 用「guid 非空」判「资产还在」会**假绿**

**适用引擎**：**官方版 2022.3.62f3c1 实测** + 团结同类（`AssetPathToGUID` 是同一 API）。

**现象**（真机证据：`.superpowers/sdd/2026-09-20-pi-unity-m4-exec/e2e/crit4-20-loadcheck.json`）：
资产被 `DeleteAsset` 之后，即使 `AssetDatabase.Refresh(ForceUpdate)`、`LoadAssetAtPath<Sprite>(path) == null`、
磁盘文件**已消失**，`AssetDatabase.AssetPathToGUID(path)` **仍返回过期 guid**。
该证据里 `actual.result` 是 `loadHero=null|neverExisted=|deletedPathGuid=[47c0150f…]` ——
`LoadAssetAtPath` 判 null（资产真没了），而 `deletedPathGuid` **非空**（过期 guid 还在）。

**为什么危险**：拿「guid 非空」当「资产还在 / 引用没断」的判据会**假绿** ——
删除后的路径也过，等于这条判据**没有牙**（SKILL §3.7 的 clone 判据正好依赖它做交叉证明）。

**处理**：判定「资产还在」用 **`AssetDatabase.LoadAssetAtPath<T>(path) == null`**
（或 `AssetDatabase.GetMainAssetTypeAtPath(path)`），**不要**用 `AssetPathToGUID` 的非空性。
`AssetPathToGUID` 只在「资产**已确认存在**时取引用 id」这种用法下才可靠。

### U48. 并发调用报 `SCRIPT_COMPILE_ERROR: 动态代码编译失败：Another execution is already in progress` —— 码与文案双误导

**适用引擎**：Unity 官方中国版 2022.3.62f3c1 + uloop dispatcher 3.5.1 [Unity 官方 2022.3.62f3c1 实测，2026-09-20]

**现象**：4 条并行 `unity exec` → 3/4 回 `code=SCRIPT_COMPILE_ERROR`、`message='动态代码编译失败：Another execution is already in progress'`。

**根因**：上游动态代码载荷里 `CompilationErrors` **恒存在**（成功时是 `[]`），并发被拒时是 `{Success:false, CompilationErrors:[], ErrorMessage:'Another execution is already in progress'}`。旧判据只要求 `Array.isArray(CompilationErrors)` → 空数组也满足 → 被当成编译错。

**处理**：判据收紧为「**非空**数组」（`lib/issues.js` 的 `isScriptCompileFailure`）；`fromUloop` 的 message 兜底扩为 `Message ?? ErrorMessage`；并给「另一条命令正在执行」加串行重试 hint。

### U49. 并发调用报 `UNITY_SERVER_BUSY` —— 这是 uloop 的**单飞**设计，不是故障

**适用引擎**：Unity 官方中国版 2022.3.62f3c1 + uloop dispatcher 3.5.1 [Unity 官方 2022.3.62f3c1 实测，2026-09-20]

**现象**：10 条并行 `unity scene tree` → 2 条 `code=UNITY_SERVER_BUSY`、`retryable:true`、`phase:'dispatch'`。

**确定性复现**：先起一条长耗时 `unity exec`（`--code 'System.Threading.Thread.Sleep(25000); return "holder";'`），2 秒后再发 `unity scene tree` → 稳定 `UNITY_SERVER_BUSY`。

**上游依据**（原始信封见 `docs/m5-probes-raw/victim2.json`）：信封 message 逐字含「uloop is single-flight by design; never run uloop commands in parallel」，且 dispatcher 自带 **10 秒**重试。

**处理**：把 `UNITY_SERVER_BUSY` 登记进 `RETRYABLE_CODES`（上游不给 `Retryable` 时也能判可重试），并追加中文串行重试 hint。**一次只发一条命令**（含只读）。

---

### M4：全新 clone / 删 `Library/` 之后资产引用是否仍在（真机探测，详见 `docs/M4-PROBES.md`）

**结论（一句话）**：**资产 + 引用它的场景/Prefab + `.meta` 同批提交即可交付** ——
全新 clone（**完全没有 `Library/`**）之后，32-hex 引用 guid、`.meta` base64、场景 YAML 字面量、
`node inspect` 的整个 `sprite` 子对象**全都不变**（本机实证）；但 **`.meta` 必须与美术资产同批提交**，
否则收件人（没有 `Library/`）那边的引用会**真断**（实测 guid 变另一个值、`sprite.assetPath:null`）。

**可操作规则**：

1. 交付/提交**务必带上 `.meta`** —— 它携带「引用 id + 导入设置」两样东西（缺它 → 引用断 或 ppu 16→100）；
2. 若收件人已经拿到没有 `.meta` 的包 → **重跑 `unity sprite assign`** 重新绑定（旧的 32-hex 引用已失效）；
3. **跨机器 / 改项目根 / 改项目名未验证**（`docs/M4-PROBES.md` 未探测项 U1）——
   这条只覆盖「同机、同项目根、完全无 `Library/`」的 clone。
4. 完整证据（含 A2-3「无 `Library/` + 无 `.meta` → 引用断」与 A2-4 恢复）见 `docs/M4-PROBES.md` 问题①。

---

### U50. 同父同名实例的唯一定位：`node inspect --sibling-index <真实子序号>`

**适用引擎**：Unity 官方中国版 2022.3.62f3c1 实测（2026-09-20）；团结复测延后。

**背景**：U42 记录的口径 —— 同父多个同名实例时 `node inspect --path <p>` 只能命中一个。批次 B-1 关闭该缺口（backlog ⑤ / R480）。

**行为**：

- 载荷新增**可选** `--sibling-index <n>`；`n` = 目标节点的**真实** `transform.GetSiblingIndex()`（就是 `unity scene tree` 读回里该节点的 `siblingIndex` 字段值 —— **同父下可能不连续**，**不是**「同名命中列表的下标」）。
- 读回面 additive 新增 `siblingIndex` / `instanceId` / `matchCount`。
- **不给参数**且命中多个：仍取第一个（**保持既有行为**，不破坏 U42 的 `--name` 用法），但 `matchCount > 1`，并追加一条 hint 指出本次命中的是哪个 `siblingIndex`、如何精确定位（D-B2 纯 additive）。
- **给了参数但无节点匹配**：`code: SIBLING_INDEX_OUT_OF_RANGE`（**运行时码，退出码 1，不是用法错**），`actual.available` 回传该路径下**可用的真实序号列表**（可自修）。
- `--sibling-index` 形状/范围错（非 `0..2147483647` 的整数，含 `parseArgs` 裸写）→ `BAD_SIBLING_INDEX`（**用法错，退出码 2**），在任何 uloop 调用**之前**收敛。

**给 agent 的用法**：先用 `unity scene tree` 读出目标节点的 `siblingIndex`，再 `unity node inspect --path <p> --sibling-index <该值>`。

**⚠️ 跨父同名同序号仍无法区分**：`--path` 是按名字段匹配（`Root/Brick` 可同时命中两个不同 `Root` 下的 `Brick`，两者真实序号可能都是 `0`）→ 此时 `--sibling-index` 退化为 first-wins；hint 已提示「路径命中 N 个（可能来自不同父）」。

**默认选取保持不变（`GameObject.Find` 激活优先）**：不给定位键时，若 `Find` 命中且它在同名集合里则置于首位（跨场景 / `DontDestroyOnLoad` 里的激活对象仍可查 —— `NOT_FOUND` 前也回退一次 `Find`）。

---

### U51. `prefab create` 读回面纳入 `components`：空节点投影不再恒真；源含 `HideFlags.DontSave` 组件会如实 `verified:false`

**适用引擎**：Unity 官方中国版 2022.3.62f3c1 实测（2026-09-20）；团结复测延后。

**背景（R448）**：空节点（默认 transform + 无 sprite）的 Prefab 投影原先只有四个**常量默认值**字段（`name` 由 `--to` 文件名覆盖、`position=0,0,0`、`scale=1,1,1`、`spriteAssetPath=null`）→ 任何空 Prefab 都能满足同一 intent，`verified:true` 的**证伪力 ≈ 0**。

**行为**：`unity prefab create` 的读回面（`prefab-create.cs` read 模式）与 intent（`lib/prefab.js` 的 `nodeProjection`）**双向**新增 `components`（组件名列表：`GetComponents<Component>()` 过滤 `null` 后取类型名，与 `node inspect` 同形）。空节点因此带 `["Transform"]`；Prefab 里丢/多组件会被检出（`mismatches` 含 `key:'prefab.components'`、`verified:false`）。**顺序敏感**（`compareSubset` 对数组「长度不等即分歧、等长逐元素比」）。

**⚠️ 已知的行为外溢（正向、安全）**：源节点上若存在 **`HideFlags.DontSave`** 的组件（或仅运行时会话才有的组件），`SaveAsPrefabAsset` **不序列化**它 → 读回面如实报 `prefab.components` 分歧、`verified:false`（**不是** bug，是证伪力）。要让该组件进 Prefab，先去掉 `DontSave`。

**⚠️ `--force` 覆盖是「自证」**：用另一个节点 `--force` 覆盖同一 `--to` 时，`SaveAsPrefabAsset` 会**替换**资产内容 → 写后读回**必然自洽**（`verified:true`）。要验证「读回面有鉴别力」**不能**靠覆盖路径，必须构造「源节点与盘上资产确实不同」的场景（如上面的 `DontSave`）。

---

### U52. `sprite assign --world-size` 在 `SpriteRenderer.drawMode=Sliced/Tiled` 下会（预期地）落 `verified:false`

**适用引擎**：Unity 官方中国版 2022.3.62f3c1 实测（2026-09-20，批次 B-2）；团结复测延后。

**现象**：节点 `SpriteRenderer.drawMode` 为 `Sliced`/`Tiled` 且 `sr.size ≠ sprite.bounds` 时，
`unity sprite assign --world-size 2,1` 会 `verified:false`（**退出码 1**），
`mismatches` 两条：`sprite.worldSize.x` `2→26.6667`、`sprite.worldSize.y` `1→20`。

**机制（真机实测，非假绿、是诚实的 `verified:false`）**：

- 写侧 `sprite-assign.cs` 用 **`Sprite.bounds.size`**（精灵自身在「世界单位」下的尺寸，= 纹理尺寸 / PPU）反算 `localScale`；
- 读侧 `node-inspect.cs` 读 **`sr.bounds`（世界 AABB）**，而 **Sliced/Tiled 下 `sr.bounds.size = sr.size × lossyScale`**，与 `sprite.bounds` 是**两个量**；
- 实测：`sr.size={5,5}`、`lossyScale={5.3333,4}` → `sr.bounds={26.6667,20}`（`5×5.3333=26.6667`、`5×4=20`）；`sprite.bounds={0.375,0.25}`。
- **仅当 `sr.size == sprite.bounds` 时**两侧才一致 → 那种巧合下仍会 `verified:true`（如刚切过 drawMode、`sr.size` 未被动过）。

**证据**：`docs/m5-probes-raw/b2-a7c-assign-sliced-size5.json`、`b2-a8c-assign-tiled-size5.json`、
机制读回 `b2-a7b-dump-sliced-size5.json` / `b2-a8b-dump-tiled-size5.json`、报告 `docs/m5-probes-raw/b2-REPORT.md`。

**出路**：`--world-size` 只对 `drawMode=Simple` 有定义 —— 只对 Simple 用 `--world-size`；
需要 Sliced/Tiled 时，先把 drawMode 改回 Simple 再 assign；或几何判据改用 `shot`+`pixels`。

---

### U53. 节点上**只有 UI `Image`** 时 `sprite assign` 会静默加 `SpriteRenderer` 并假绿（**已修 R481**：落 `UI_IMAGE_PRESENT`）

**适用引擎**：Unity 官方中国版 2022.3.62f3c1 实测（2026-09-20，批次 B-2；R481 修复随该批次落地）；团结复测延后。

**现象（修复前的假绿）**：节点上只有 `UnityEngine.UI.Image`、没有 `SpriteRenderer` 时，
旧实现的 `sprite-assign.cs` 会**静默 `AddComponent<SpriteRenderer>()`** —— sprite 挂到新组件、
原 `Image.sprite` **原封不动仍是 `null`**，而读回面（`node-inspect.cs`）**只读 `SpriteRenderer`**
→ `verified:true`、退出码 0（**假绿**：真正被改的 UI `Image` 无人比对）。
真机实证：`docs/m5-probes-raw/b2-b11-assign-ui.json`（`actual.components` 多出 `SpriteRenderer`）、
`b2-b12-dump-ui-after.json`（事后 `Image.sprite` 仍为 `null`）。

**已修（R481 / D-B2-1）**：`sprite-assign.cs` 在 `AddComponent<SpriteRenderer>()` **之前**用**反射**
探测 UI `Image`（程序集限定名 `UnityEngine.UI.Image, UnityEngine.UI`，零编译期依赖）；
命中则返回运行时码 **`UI_IMAGE_PRESENT`**（**退出码 1**，不进 `USAGE_FAILURE_CODES` 冻结表），
`lib/sprite.js` 映射出 message + actual(`component: Image`) + hint（本命令只挂 `SpriteRenderer`，
UI 图走 UI 管线；要设 `Image.sprite` 用 `unity exec` 直接赋值）。

**顺带**：`node create --components` 里的 UI 组件要用**全名** `UnityEngine.UI.Image` ——
短名 `Image` → `COMPONENT_TYPE_NOT_FOUND`（退出码 1）。
证据：`docs/m5-probes-raw/b2-b9-try-create-m5ui-fullname.json`（全名成功，组件 `[RectTransform,CanvasRenderer,Image]`）、
`b2-b9-create-m5ui-image.json`（短名失败 → `COMPONENT_TYPE_NOT_FOUND`）。

**出路**：UI 节点（Canvas 下的图片）走 UI 管线，`sprite assign` **不处理** `Image` ——
先删掉 / 挪走 UI `Image` 再挂 `SpriteRenderer`，或换非 UI 节点；要设 `Image.sprite` 用 `unity exec`。

---

### U54. **场景未保存**时 `prefab create --force` 会重置实例名与实例覆盖

**适用引擎**：Unity 官方中国版 2022.3.62f3c1 实测（2026-09-20；变量已隔离：同一序列「存场景 / 未存场景」两次）。

**现象**：
- **未** `scene save`：对 Prefab 实例设了根 `position`/`scale` 覆盖后跑 `prefab create --force` 重存资产 →
  实例**改名成资产根名（文件名）**、`localPos` 回到 `0,0,0`、`localScale` 回到资产值 —— **覆盖全丢**
  （`docs/m5-probes-raw/ca-31-root-dump.json`：两实例均名 `CaDifferent`、`localPos:"0,0,0"`、`localScale:"2,2,1"`）。
- **已** `scene save`：同样覆盖在 `--force` 后**完整保留**（`docs/m5-probes-raw/ca-49-after-force.json`：`CaA` 保留 `localPos=5,5,0`、`localScale=3,3,1`）。

**处理**：重存一个**已被实例引用**的 Prefab 之前，先 `unity scene save`（不带 `--path` = 原地保存全部打开场景）把实例覆盖落盘；
重存后**读回实例**确认名与变换未被重置。**务必**先看实例名是否被改成资产根名（同名多实例会连成一片，见 U42/U50）。

**证据**：`docs/m5-probes-raw/ca-REPORT.md` §3。

---

### U55. `prefab apply` / `revert` 对根 `localPosition` 豁免

**适用引擎**：Unity 官方中国版 2022.3.62f3c1 实测（2026-09-20）。

**现象**：
- `PrefabUtility.ApplyPrefabInstance(go, …)` **会**把根 `scale`、子节点变换、sprite、components 等覆盖写进资产，但**不写根 `localPosition`**（实例 `5,5`、资产仍 `0,0`）。
- `PrefabUtility.RevertPrefabInstance(go, …)` **不还原根 `localPosition`**（回到场景保存值而非资产值）；其余字段回归资产值（根 `scale` `9,9→3,3`）。
- 两者执行后 `HasPrefabInstanceAnyOverrides(go, false)` 均为 `false`（覆盖被清空）。

**处理**：`unity prefab apply`/`revert` 的读回面**必须排除根 `position`**（否则必假红，与 **U39 规则③** 同源）；本包已按此实现。根位置要改就显式 `node set`（或 `--force` 重建 Prefab）。

**证据**：`docs/m5-probes-raw/cb-REPORT.md` · `cb-60-apply.json` · `cb2-12-revert.json` · `cb2-13-state.json`（真机验收 `docs/m5-probes-raw/cb3-*`）。
