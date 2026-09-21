# M4 验收记录（E2E-ACCEPTANCE-m4）

> **协议**：照 `docs/E2E-ACCEPTANCE-m2.md` 的形态 —— **四条判据**（结构 / 画面 / 可动·持久 / 纪律）+ **一个只读 SKILL 的独立子代理盲测** + **另一个子代理独立复核产物**。
> **日期**：2026-09-20 ｜ **代码基线**：`c089b1c`（分支 `m4-art`，`npm test` **564/564 绿**）
> **引擎**：主验收 = 团结 `2022.3.62t9`（项目 `pi-unity-spike/S0Project`）；盲测 = Unity 官方版 `2022.3.62f3c1`（项目 `pi-unity-official-f3c1`）
> **证据目录**（gitignore 内）：`.superpowers/sdd/2026-09-20-pi-unity-m4-exec/e2e/`（主验收）、`…/blind/`（盲测）
> **纪律**：全程单座席（同一时刻只有一个编辑器；`tasklist` 门检过）；**全程未碰** `<真实工程>`（复核者用 `find -newermt` 确认 0 个新文件）。

---

## 结论

**四条判据全过**（无降级项阻断），**盲测独立复现成功**，**独立复核 5/5 项成立**。

| 判据 | 结论 | 关键证据（原始文件在 `…/e2e/`） |
|---|---|---|
| ① 结构 | ✅ 过 | `crit1-*.json`：`asset import` `verified:true`；`actual.art.removeBg.keyColor="#00FF00"`；`actual.art.trimmed={left:10,top:8,width:12,height:8}`；`actual.file.sha256=982a503f…` 与**独立重算**一致；`.meta` 在；透明背景那条 `art.removeBg=null` 且 **8×6**；`scene save` `verified:true` 且磁盘 YAML 里 `grep` 到节点名（1）与该 PNG 的 32-hex guid（1） |
| ② 画面 | ✅ 过 | `crit2-*.json`：EditMode 窗口图 `actual.count.count=2120`；PlayMode rendering 图 **`count.count=7752`**（= 102×76，与透视/正交几何公式逐像素吻合）；**反证**（用 `actual.art.removeBg.keyColor` 而非硬编码）两种容差下均 **0** |
| ③ 可动·持久 | ✅ 过 | `crit3-*.json`：`play start` 后 rendering 图仍 `count>0`（资产引用过 domain reload 未丢）；`prefab create/instantiate` `verified:true`；**负对照 delta = 7752**（恰好一块，证明可见性归属）；**真重载**：实例改动经 `scene save` → 切场景 → 切回后 `node inspect` 逐字段相同；`build --target win64` `verified:true`、`sizeBytes=114,674,632`、主产物 `2D Project.exe`、`player.log` 21 行 **0 error** |
| ④ 纪律 | ✅ 过 | 全链每步 `verified:true`、无 `[UNVERIFIED]`；四次**故意失败**的码与退出码：`SPRITE_NOT_FOUND`/1、`BAD_TARGET_PATH`/2、`ASSET_EXISTS`/1、`--remove-bg '#123456'` → exit 0 但 `art.warning` 非空；探针节点/资产/场景**清理并读回**（`Assets/E2E=GONE`、`nodeCount=1`） |

**判据③ 的第 ⑤ 项（克隆去 `Library/` 后引用仍在）本轮未复跑**（需第二个编辑器，与单座席冲突）→ **由任务 5 的探测① 真机证据覆盖**（`docs/M4-PROBES.md` 问题①；克隆 `pi-unity-spike/CloneProbe` 仍在，`probeA-clone-inspect.json`）。**这是一条降级登记，不是未验证。**

---

## 盲测（独立复现）

**方式**：一个**全新子代理**，任务描述里只给：SKILL 路径、项目路径（官方版）、一张它没见过的图（`hero-blind.png`，24×16 绿底 + 居中三色小人）、以及操作纪律（单座席 / 不许碰真实工程 / 不许改工具代码）。**没有**给它计划、`M4-SPIKE`、`M4-PROBES`、任何实现细节。

**结果：✅ 成功**（`…/blind/blind-report.md`）

| 它交出的 | 数字 |
|---|---|
| 画面证据（EditMode 窗口图 906×440） | `#FF2E88` / `#FFE94A` / `#4DFF7A` 各 **2592** px（= 108×72 三等分，与几何预测逐位相等）；`#00FF00` **0** |
| 负对照（关掉 Hero 后重拍） | 三色一起归 **0** |
| 交付的 PNG 自身 | tolerance 0 下 `8+8+8 = 24/24` 纯色、绿 0 |
| PlayMode rendering 图 | 906×419，三色各 2592 |

它留下的成果（**未清理，供复核**）：`Assets/Art/hero-blind.png`（+ `.meta`）、节点 `Hero`、`Assets/Prefabs/Hero.prefab`、`Assets/Scenes/SampleScene.unity`（已落盘）。

### 盲测暴露的文档缺口（8 条，全部要回写 SKILL/PITFALLS）

| # | 缺口 | 严重度 |
|---|---|---|
| 1 | **并发调用 `unity` 必炸**：并行 2×`exec` → `SCRIPT_COMPILE_ERROR: Another execution is already in progress`；并行 2×**只读** `scene tree` → `ULOOP_TRUNCATED`。**两个码都把人往错方向引**（去改 C# / 去查 dispatcher 路径）。→ SKILL 铁律「一次只发一条命令（含只读）」+ hint 改进（见账本 R475） | **Important** |
| 2 | 官方版空项目是**透视相机**，SKILL 只有正交的 `pxPerUnit` 公式，而「sprite 在屏幕上多大」是选 `--world-size` 的唯一依据。它自己推出 `pxPerUnit=(图高/2)/(tan(fov/2)×距离)=36.29`，**实测吻合到 1 px** → 应补进 §8⑤ | **Important** |
| 3 | `asset import` 读回 `texFormat:"RGB24"` **不等于 alpha 丢了**（裁完 24 px 全不透明），它第一眼误判「去底失败」→ 文档要解释该字段语义（纪律：**它不是判据**） | 中 |
| 4 | `--remove-bg` 的判定口径（max 通道差 + `(tol, 2tol]` 羽化/de-spill）只写在代码里 → 文档补口径与否决自查法 | 中 |
| 5 | `--world-size` 依赖 `--trim` 的读回值（先有鸡后有蛋）：必须先 `import` 读回 `art.output` 再按比例给 `--world-size` | 中 |
| 6 | **官方-2 真机复现**：`doctor` 的 `editor-language` 报团结的 `zh_CN`，官方版编辑器是英文 → `shot` 先找「游戏」扑空、自动重试 `Game` 成功；响应里有机器可读的 `"retriedFrom":"游戏"`（文档没提） | 中 |
| 7 | **window 图与 rendering 图坐标不同源**（906×440 vs 906×419）→ 复用 `--at` 坐标要自己加偏移（复核者更正：内容上方 chrome 是 **19 px**，不是 21 —— `windowY = renderingY + 19`） | 中 |
| 8 | `scene save` **省略 `--path` = 原地保存**；U37 的 Save-As 警告 + 示例都带 `--path` → 容易被误读成「必须另存」 | 低 |

它**未遇到**：`verified:false`（全程 0 次）、`WINDOW_NAME_LOCALIZED` 终态失败、构建/导入类错误码。

---

## 独立复核（第三方子代理，只读产物）

**结论：✅ 声称成立（5/5 项独立复现）**，且它**自己重拍的两张图与盲测者的主证据 sha256 逐字节相同**（`5b881cf3…`）—— 两条独立路径拍出同一画面。

| 复核项 | 它的独立做法 | 结果 |
|---|---|---|
| ① 资产与设置 | 自己 `unity exec` 读 `TextureImporter` + 自己算 sha256 | 11 项全对；`sha256=e7f9f7fe…` 与盲测报告**逐字符一致** |
| ② 绑定 | 自己 `node inspect` | `assetPath/ppu=16/worldSize={3,2}/position/scale` 全对 |
| ③ 场景落盘 | 自己取 `AssetPathToGUID` + `grep` 磁盘 YAML | `m_Name: Hero` 1 命中、`guid: 26420c8d…` 1 命中；**额外**：`Scene.isDirty=False`（比盲测者的判据更硬） |
| ④ 画面 | **自己截图 + 自己 `pixels` + 自己算几何 + 自己跑负对照** | 三色各 2592、绿 0；预测 108.86×72.57 vs 实测 108×72（下取整，点采样）；负对照 0 → 恢复 2592×3 |
| ⑤ 未作弊 | `git status/log`、图像同一性（PIL 逐像素 + 重跑 fixture 脚本比 sha256）、用户工程 `find -newermt` | 仓库干净（HEAD=`c089b1c`）、资产确由那张图派生（非绿区逐像素相同）、`<真实工程>` **0 个新文件**、只有 1 个编辑器进程 |

**它更正/补充的 3 条**（已采纳）：
1. 盲测报告说 window/rendering 的 y 差 **21 px** —— 那是**总高差**；内容上方 chrome 实际 **19 px**（bbox y 229–300 vs 210–281）。
2. 108.87×72.58 → 108×72 的 **1.6% 面积差**未被盲测报告解释（点采样只取到 `floor(w)×floor(h)`）。
3. 所谓「用户的图」是**剧本设定**（`task-8-brief.md` 让控制者用 `scripts/make-m4-fixture.js` 现场生成），不是外部用户素材 —— 对盲测者而言成立，但文档措辞要诚实。

**它纠正的一条既有事实（引擎差异）**：`M4-SPIKE` 记的「`.meta` 的 guid 是 56 字符 base64」**在本项目不成立** —— 官方版 `2022.3.62f3c1` 上 `.meta` 的 `guid:` 与 YAML 引用的 **32-hex 就是同一个字符串**（`hero-blind.png.meta:2` 与 `SampleScene.unity:183` 都是 `26420c8d342448e43b747360ee134d7d`）。→ **U30 的「两套 id」是团结新导入资产的表现，官方版未复现**；适用引擎标注要收紧（账本 R476）。

---

## 未过项 / 降级项

| 项 | 状态 | 代价 |
|---|---|---|
| 判据③⑤「克隆后引用仍在」本轮未复跑 | **降级**（由任务 5 探测① 覆盖；克隆与 JSON 仍在） | 若任务 5 的证据本身有误，这条就没人兜底；但那份证据有 4 条独立量 + `LoadAssetAtPath` 成功 |
| 盲测只跑了 1 个引擎（官方版）；团结侧是控制者自跑 | 如实登记 | 「同一个只读 SKILL 在两个引擎上都能盲复现」只验证了一半（团结侧非盲测） |
| `texFormat`/`mipmapCount` 等个别 `asset import` 读回字段未由复核者重跑（重跑=写操作） | 如实登记 | 复核者只独立确认了磁盘 PNG 是 RGBA / 6×4 / 83 B |
| 并发调用那条（盲测坑 1）**未被复核者复现**（刻意串行） | 如实登记 | 它是盲测者单方报告 + 两个错误码的形状证据 |

---

## 收尾动作（**已全部落地**）

1. **SKILL 回写 ✕ 已做**（任务 7 + 最终修复波）：8 条缺口全部进 `SKILL.md`（并发铁律 §铁律 / 透视相机公式 §8⑤ / `texFormat` 语义 / `--remove-bg` 口径 / `--world-size` 的先后顺序 / `retriedFrom` / window↔rendering 的 **19 px** 偏移 / `scene save` 省略 `--path` = 全部原地保存）。
2. **PITFALLS ✕ 已做**：**U46** 并行调用（**已标「单源证据、未被第三方复现」**）、**U47** `AssetPathToGUID` 在 `DeleteAsset` 后仍返回过期 guid（假绿）、U30 适用引擎收紧（团结 56-base64 / 官方 32-hex 同一字符串）。
3. **产品面 ✕ 已做 / 已裁定**：`prefab create` 现在**自动建 `--to` 的父目录**（R455，真机反证过裸 API 会抛 `ArgumentException`）；并发两个错码的 **hint 改进**（把它们指向「另一条命令正在执行，请串行重试」）**登记 backlog**（要改共享的 `lib/dynamic.js`/`lib/uloop.js`，见 `docs/HANDOFF.md` §7 ①）。
