# pi-unity backlog 批次 C-A 实现计划（⑩-b 官方版复测：U28/U31–U34/U36/U39–U41 → PITFALLS 订正）

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 关闭 `docs/HANDOFF.md` §7 backlog **⑩ 两半里的「官方版复测」半** —— 把 `docs/PITFALLS.md` 里仍标「团结实测；官方 2022.3 未验证」的**引擎行为类**坑，用真机官方版 `2022.3.62f3c1` 升级为实测结论；并把 ⑩ 的**国际版半**如实登记为「非必要、已知不可得」。**本批次不改任何源码/测试，只订正文档。**

**架构：** 侦察（只读 + 临时资产/节点，**已完成**）见 `docs/m5-probes-raw/ca-REPORT.md` 与 `ca-*` 原始 JSON。结论：8 条坑里 **U28/U32/U40/U41 为「Unity 家族共有」逐字复现**；**U33 机制共有（默认值不同）**；**U31 默认值随引擎/模板变**（官方 `textureType=Default`/`alphaIsTransparency=false`/`npotScale=ToNearest`）；**U36 机制成立 + 官方多一条「Game 视图未开时 rendering 失败」**；**U39 三条跟随规则成立（需场景已保存）**；另有**新坑 U54**（场景未保存时 `prefab create --force` 重置实例名与覆盖）。本批次把这些事实写回 `docs/PITFALLS.md`。

**技术栈：** 无（纯文档订正）；校验用 `npm test`（Node ≥ 21，零依赖）。

**规格：** `docs/HANDOFF.md` §7 backlog ⑩ + `docs/CAPABILITIES-unity-2022.3.62f3c1.md` + `docs/m5-probes-raw/ca-REPORT.md`（本计划 §2 的事实基础）。

**引擎：** **Unity 官方中国版 `2022.3.62f3c1`**（测试工程 `C:/Users/<用户>/pi-unity-official-f3c1`）。

---

## 全局约束

（逐字来自 `docs/HANDOFF.md` §6）

- 零第三方依赖（只用 `node:*` 与 `node --test`）；不 fork uloop。
- 新增 `docs/PITFALLS.md` 条目**只追加到文件末尾、编号由文档任务统一**，**必须标适用引擎**（只在团结测过的**不许**写「两者」）。
- **一次只发一条 `unity` 命令（含只读）**（U46/U49：uloop 单飞）；**不许碰** `<真实工程>`。
- 真机验证不得污染：临时节点/资产要删并读回确认。
- ⭐ **控制者不要手改实现/测试代码**（R372）—— 本批次只改文档。
- ⭐ **不要把 `npm test` 串在 `&&` 链中间、后面还跟一个总是成功的 `grep`**。
- `npm test` 基线 = **621/621**；本批次不改代码，跑完必须仍 **621/621**。

---

## 1. 决策点（需人类伙伴批准）

| # | 决策 | 备选 | 推荐 |
|---|---|---|---|
| **D-CA-1** | backlog ⑩ 的**国际版**半 | (a) 跳过并登记「非必要 + 已知不可得」；(b) 海外出口代下国际版 | **(a)** —— Q2 问的是「是否绑死团结」，已由官方中国版回答；项目从未承诺「与国际版逐字节一致」（`docs/CAPABILITIES-unity-2022.3.62f3c1.md:31`）。**推断（未验证）**：中国版与国际版同 `2022.3.62` 引擎核心、差异在发行渠道 —— 该推断本身不是实测结论，仅作「为何跳过」的辅助理由 |
| **D-CA-2** | U31 的处理 | (a) 改结论为「默认值随引擎/模板变」并保留「像素画须逐项显式设置」；(b) 声称官方默认与团结相同 | **(a)** —— 实测证伪 (b)（官方 `textureType=Default`） |
| **D-CA-3** | 「场景未保存时 `--force` 重置实例」是否记为正式坑 | (a) 追加 **U54**（标「官方版实测、变量已隔离、机制未深挖」）；(b) 只写进 `ca-REPORT.md` | **(a)** —— 两次观测变量已隔离（存/未存场景），对使用者的实际代价高 |

**已由控制者先行裁定（人类伙伴回「你决定吧」，未否决）**：按推荐执行（a/a/a）。

---

## 2. 侦察结论（真机事实，2026-09-20，官方版 2022.3.62f3c1）

完整表见 `docs/m5-probes-raw/ca-REPORT.md` §1。要点：

| 坑 | 官方版实测 | 证据 |
|---|---|---|
| U28 | `ti.spriteMeshType` → **CS1061**；settings 往返成功 | `ca-04-u28-direct.json` · `ca-04b-u28-settings.json` |
| U31 | 默认 `textureType=Default`（非 Sprite）、`alphaIsTransparency=false`、`npotScale=ToNearest`（24→32）、`spriteImportMode=None`、`mipmapEnabled=true`、`wrapMode=Repeat`；`filterMode=Bilinear`/`Compressed`/`PPU=100`/`Tight`/`extrude=1`/`isReadable=false` 同 | `ca-01-defaults.json` |
| U32 | 24×16 + `maxTextureSize=8` → **8×5** | `ca-02-maxsize.json` |
| U33 | `alphaIsTransparency=true` 时透明像素 `(0,0,0,0)`→**`(1,0,0,0)`**（邻居红）；默认 `false` 则保持 | `ca-03b-alpha.json` |
| U36 | `--capture-mode window` → **1101×540**（请求 960×640）；PlayMode 默认 rendering **因 Game 视图未开失败**（`ULOOP_ERROR`） | `ca-13-shot-window.json` · `ca-12-shot-auto.json` |
| U39 | 已存场景：实例保留 `localPos=5,5,0`③ 与 `localScale=3,3,1`②；未覆盖的 scale 跟随① | `ca-49-after-force.json` · `ca-31-root-dump.json` |
| U40 | 源节点 `prefabInstanceStatus=NotAPrefab`；实例初始位姿=资产生成位姿 | `ca-49-after-force.json` · `ca-22-inst-a.json` |
| U41 | `--to CaDifferent.prefab` → 根名 **`CaDifferent`** | `ca-21-prefab-create.json` |
| **U54（新）** | 场景未 `scene save` 时，`prefab create --force` 把实例改名成资产根名、覆盖全丢；已存场景则保留 | 未存场景：`ca-31-root-dump.json`（两实例 `localPos=0,0,0`、`localScale=2,2,1`、均名 `CaDifferent`）；已存场景：`ca-49-after-force.json`（`localPos=5,5,0`、`localScale=3,3,1`） |

---

## 3. 文件结构

| 文件 | 职责 | 本批次动作 |
|---|---|---|
| `docs/PITFALLS.md` | 坑位库（U1–U53 + 官方-1…官方-8） | 修改：U28/U31/U32/U33/U36/U39/U40/U41 的「适用引擎」行 + 追加 **U54** + 索引表 |
| `docs/M5-PROBES.md` | M5 真机探针报告 | 修改：追加 **§10 批次 C-A** |
| `docs/HANDOFF.md` | 单一事实源 | 修改：§3 里程碑 + §7 backlog ⑩ 拆分登记 + §0 基线 |
| `docs/m5-probes-raw/ca-REPORT.md` · `ca-*` | 证据 | **已落盘（本次）** |
| `docs/superpowers/plans/2026-09-20-pi-unity-backlog-ca.md` | 本计划 | 新建（本次） |

---

## 4. 任务

### 任务 1：`docs/PITFALLS.md` 逐条订正 + 新条目 U54

**文件：** 修改 `docs/PITFALLS.md`

- [ ] **步骤 1：U28 适用引擎行**

把：

```
**适用引擎**：团结 2022.3.62t9 实测；官方 2022.3 未验证。
```

（该串在文件中多处出现，**仅替换 U28/U31/U32/U33/U36/U39/U40/U41 各自段落内的那一处**；用行号/上下文定位，勿全局替换）改为：

- U28 → `**适用引擎**：Unity 家族共有 —— 团结 2022.3.62t9 + Unity 官方中国版 2022.3.62f3c1（`ca-04-u28-direct.json` CS1061 逐字复现、`ca-04b-u28-settings.json` 往返成功）。`

- [ ] **步骤 2：U31 适用引擎行 + 追加官方默认值**

U31 行改为：`**适用引擎**：默认值随引擎/工程模板变 — 团结 2022.3.62t9 默认 Sprite；Unity 官方中国版 2022.3.62f3c1（3D 模板）默认 `textureType=Default`、`alphaIsTransparency=false`、`npotScale=ToNearest`、`spriteImportMode=None`（`ca-01-defaults.json`）。结论不变：像素画必须逐项显式设置。`
并在 U31 正文追加一句：`⚠️ 官方版另有 **`npotScale=ToNearest`** —— 会把 NPOT 源静默放大到最近的 2 的幂（24→32，`ca-01-defaults.json`）；这与 U32 是**两个不同的缩放变量**。`

- [ ] **步骤 3：U32 适用引擎行**

改为：`**适用引擎**：Unity 家族共有 —— 团结 2022.3.62t9 + 官方 2022.3.62f3c1（24×16 + `maxTextureSize=8` → 8×5，`ca-02-maxsize.json`）。`

- [ ] **步骤 4：U33 适用引擎行**

改为：`**适用引擎**：机制 Unity 家族共有（`alphaIsTransparency=true` 时透明像素 `(0,0,0,0)`→`(1,0,0,0)`，官方 2022.3.62f3c1 实测 `ca-03b-alpha.json`）；**默认值不同** —— 团结默认 `true`、官方默认 `false`。`

- [ ] **步骤 5：U36 适用引擎行 + 追加官方差异**

改为：`**适用引擎**：Unity 家族共有（官方 2022.3.62f3c1 `--capture-mode window` → 1101×540，请求 960×640，`ca-13-shot-window.json`）；团结 2022.3.62t9 观测 892×355。`
并在 U36 正文「处理」后追加：`⚠️ 官方版差异（HANDOFF S8）：Game 视图未打开时 PlayMode 默认（auto→rendering）会**直接失败** `ULOOP_ERROR: PlayMode rendering did not produce an image`（`ca-12-shot-auto.json`）—— 首次截图前确保 Game 视图已开（或显式 `--capture-mode window`）。`

- [ ] **步骤 6：U39 适用引擎行 + 追加保存前提**

改为：`**适用引擎**：Unity 家族共有（官方 2022.3.62f3c1 三条规则复现，`ca-49-after-force.json` / `ca-31-root-dump.json`），**前提：实例覆盖已随 `scene save` 落盘**（否则见 **U54**）。`
并在 U39 三条规则表后追加：`⚠️ **前提**：以上三条成立的前提是**实例覆盖已随 `scene save` 落盘**；未保存场景时 `prefab create --force` 会重置实例名与覆盖（**U54**）。`

- [ ] **步骤 7：U40 / U41 适用引擎行**

- U40 → `**适用引擎**：Unity 家族共有（官方 2022.3.62f3c1：源节点 `prefabInstanceStatus=NotAPrefab`、实例初始位姿=资产生成位姿，`ca-49-after-force.json`）。`
- U41 → `**适用引擎**：Unity 家族共有（官方 2022.3.62f3c1：`--to CaDifferent.prefab` → 根名 `CaDifferent`，`ca-21-prefab-create.json`）。`

- [ ] **步骤 8：追加新条目 U54（文件末尾；层级 `###`；紧跟 U53 之后）**

```markdown
### U54. **场景未保存**时 `prefab create --force` 会重置实例名与实例覆盖

**适用引擎**：Unity 官方中国版 2022.3.62f3c1 实测（变量已隔离：同一序列「存场景 / 未存场景」两次）。

**现象**：
- **未** `scene save`：对 Prefab 实例设了根 `position`/`scale` 覆盖后跑 `prefab create --force` 重存资产 →
  实例**改名成资产根名（文件名）**、`localPos` 回到 `0,0,0`、`localScale` 回到资产值 —— **覆盖全丢**
  （`docs/m5-probes-raw/ca-30-tree-after-force.json`：两个实例均成 `CaDifferent`）。
- **已** `scene save`：同样覆盖在 `--force` 后**完整保留**（`docs/m5-probes-raw/ca-49-after-force.json`：`localPos=5,5,0`、`localScale=3,3,1`）。

**处理**：重存一个**已被实例引用**的 Prefab 之前，先 `unity scene save`（不带 `--path` = 原地保存全部打开场景）把实例覆盖落盘；
重存后**读回实例**确认名与变换未被重置。**务必**先看实例名是否被改成资产根名（同名多实例会连成一片，见 U42/U50）。

**证据**：`docs/m5-probes-raw/ca-REPORT.md` §3。
```

- [ ] **步骤 9：索引表同步**

在 `docs/PITFALLS.md` 顶部/索引表补 **U54** 一行（若索引表按条目列出）。

---

### 任务 2：`docs/M5-PROBES.md` §10 + `docs/HANDOFF.md` backlog ⑩ 拆分

**文件：** 修改 `docs/M5-PROBES.md`、`docs/HANDOFF.md`

- [ ] **步骤 1：`docs/M5-PROBES.md` 末尾追加 §10**

```markdown
## 10. 批次 C-A：官方版复测（U28/U31–U33/U36/U39–U41 + 新坑 U54，2026-09-20）

**环境**：Unity 官方中国版 2022.3.62f3c1（`C:/Users/<用户>/pi-unity-official-f3c1`，3D 模板）。
原始证据 `docs/m5-probes-raw/ca-*` + `ca-REPORT.md`。全部串行，临时资产/节点已删并读回零污染。

| 坑 | 官方版结论 | 证据 |
|---|---|---|
| U28 | CS1061 复现；settings 往返成功 | `ca-04-u28-direct` · `ca-04b-u28-settings` |
| U31 | 默认 `Default`/`alphaIsTransparency=false`/`npotScale=ToNearest`（24→32） | `ca-01-defaults` |
| U32 | 24×16+8 → 8×5 | `ca-02-maxsize` |
| U33 | `alphaIsTransparency=true` → 透明像素填充邻居红 | `ca-03b-alpha` |
| U36 | window 1101×540；PlayMode 默认 rendering 因 Game 视图未开失败 | `ca-13-shot-window` · `ca-12-shot-auto` |
| U39 | 三规则成立（需已存场景） | `ca-49-after-force` · `ca-31-root-dump` |
| U40 | 源节点非实例；实例沿用资产位姿 | `ca-49-after-force` |
| U41 | 根名=文件名 | `ca-21-prefab-create` |
| U54（新） | 未存场景时 `--force` 重置实例名与覆盖 | `ca-30-tree-after-force` vs `ca-49-after-force` |

**清理**：`ca-40b-cleanup.json`（三资产 `LoadAssetAtPath==null`）+ `ca-50-tree-final.json`（`nodeCount=3`）。
```

- [ ] **步骤 2：`docs/HANDOFF.md` §7 backlog ⑩ 拆分登记**

把 ⑩ 行改为：

```
| ⑩ 真·Unity 国际版验证 · 官方版复测 U28/U31–U34/U36–U45 | **✅ 官方版复测完成（批次 C-A，2026-09-20）**：U28/U31–U33/U36/U39–U41 已用官方 2022.3.62f3c1 升级为实测（U34 批次 B-2 已做），新增坑 **U54**；**⏸ 真·国际版验证 → 跳过**（Q2 已由官方中国版回答，项目未承诺「与国际版逐字节一致」，中国版与国际版同 `2022.3.62` 核心；本网络 302 到中国 CDN 不可得）—— 见 `docs/m5-probes-raw/ca-REPORT.md` |
```

- [ ] **步骤 3：`docs/HANDOFF.md` §3 里程碑表追加一行**

```
| **M5（批次 C-A）** | backlog ⑩-b：官方版复测 U28/U31–U33/U36/U39–U41 → PITFALLS 订正（4 条「家族共有」+ U31 默认值订正 + U33 默认值订正 + U36 官方差异）+ 新坑 U54 | `docs/PITFALLS.md` U28/U31–U33/U36/U39–U41/U54 · `docs/M5-PROBES.md` §10 · `docs/m5-probes-raw/ca-REPORT.md` |
```

- [ ] **步骤 4：`docs/HANDOFF.md` §0 基线句话**

把 §0 的「剩余 **③④图集半⑧⑨⑩⑫**」更新为「剩余 **③④图集半⑧⑨⑫**（⑩ 已拆分：官方复测完成、国际版跳过）」。

---

### 任务 3：收尾（校验 + 提交）

- [ ] **步骤 1：跑全量测试**

运行：`npm test`
预期：**621/621 绿**（本批次不改代码/测试 → 数字不变）。

- [ ] **步骤 2：本计划补「冲突扫描裁定」与「执行结果」两节**（见 §7/§8）。

- [ ] **步骤 3：Commit（由控制者执行）**

```bash
git add docs/PITFALLS.md docs/M5-PROBES.md docs/HANDOFF.md docs/m5-probes-raw/ca-* docs/superpowers/plans/2026-09-20-pi-unity-backlog-ca.md
git commit -m "docs(pitfalls): 批次 C-A 官方版复测订正 U28/U31-U33/U36/U39-U41 + 新坑 U54（场景未存时 --force 重置实例）"
```

---

## 5. 自检

| backlog 项 | 对应任务 |
|---|---|
| ⑩-b 官方版复测 U28/U31–U34/U36–U45 | 任务 1（U28/U31/U32/U33/U36/U39/U40/U41；U34 已由 B-2 完成；U35/U37/U38/U42–U45 为引擎无关或已订正） |
| ⑩-a 国际版 | D-CA-1 跳过（任务 2 步骤 2 登记） |
| `.cs` 改动必须真机跑一次 | 本批次**不改 `.cs`** |
| 新增 PITFALLS 条目只追加末尾 + 标适用引擎 | 任务 1 步骤 8（U54） |
| 零依赖 / 测试不退化 | 任务 3 步骤 1 |

**占位符扫描**：无「待定/TODO」；U54 全文具体、可执行。
**类型一致性**：本批次无代码，无类型问题。
**命名一致性**：`ca-*` 前缀与 `ca-REPORT.md` 在计划/HANDOFF/证据间同名。

---

## 6. 执行方式

**1. 子代理驱动（推荐）** —— 每个任务调度一个新子代理，任务间进行 spec + code 双审
**2. 内联执行**

**起飞前冲突扫描**：见 §7。

---

## 7. 起飞前冲突扫描裁定记录（2026-09-20）

只读子代理（`reviewer`）通读本计划 + `ca-REPORT.md` + `PITFALLS/HANDOFF/M5-PROBES/README/SKILL` 后报 **2🔴 + 6🟡 + 9💡**，**全部成立**。裁定与落点：

| # | 扫描发现 | 裁定 | 落入 |
|---|---|---|---|
| F1 🔴 | `**适用引擎**：团结 2022.3.62t9 实测；官方 2022.3 未验证。` 实际出现 **10 处**（U28:1433 / U29:1456 / U31:1485 / U32:1498 / U33:1507 / U36:1544 / U39:1582 / U40:1599 / U41:1612 / U42:1624），计划只列 8 处且无行号 | **成立**。任务 1 改按**行号锚点**逐处替换；**U29 保持不动**（本批未在官方版测过）；**U42 一并订正**（B-1 已在官方版测过，索引行已注 U50） | 任务 1 步骤 1 |
| F2 🔴 | 章节横幅 `:16` / `:1427` / `:1539-1540` 仍写「U28–U34…官方未验证／不要写成两者」，与订正后自相矛盾 | **成立**。横幅收窄为「U29/U35 等仍未在官方版验证」，并点明 U28/U31–U33/U42 已由 C-A 官方复测 | 任务 1 步骤 1b（新增） |
| F3 🟡 | 编号计数 `U1–U53` 在 `HANDOFF.md:31`、`HANDOFF.md:140`、`README.md:153` 三处会过期；README 未列入 `git add` | **成立**。三处改 `U1–U54`；README 逐批说明补 C-A/U54 段；`git add` 补 `README.md` | 任务 2 步骤 5（新增）；任务 3 步骤 3 |
| F4 🟡 | `skills/unity-game-dev/SKILL.md:469-470` 仍写 U41「官方 2022.3 未验证」 | **成立**。删「官方…未验证」，改为官方已复测 | 任务 2 步骤 6（新增） |
| F5 🟡 | 索引行 `:54`(U31)/`:64`(U41) 与标题 `:1483`/`:1610` 仍写「团结…」 | **成立**。U31 索引/标题改「默认值随引擎/模板变」；U41 索引/标题去掉「团结」限定 | 任务 1 步骤 2b/7b（新增） |
| F6 🟡 | U54 变换证据误指 `ca-30`（`scene tree` 无变换字段）；§2「vs」对象不对称 | **成立**。改用 `ca-31-root-dump.json`（未存）vs `ca-49-after-force.json`（已存） | §2（已改）+ 任务 1 步骤 8 |
| F7 🟡 | U32 复现条件缺「`npotScale=None`」前置（否则先被 U31 的 ToNearest 放大到 32） | **成立**。U32 行补前置说明 | 任务 1 步骤 3 |
| F8 🟡 | U31 追加句「另有 `npotScale=ToNearest`」隐含「团结不是」—— 团结侧该默认值**未实测** | **成立**。改为「团结侧未实测，故一律显式设 `npotScale=None`」 | 任务 1 步骤 2 |
| F9 💡 | HANDOFF §0 `:10`「已关闭」清单也需补 ⑩-b；括注「均各有外部前置」不再成立 | **成立**。两行一起重写 | 任务 2 步骤 4 |
| F10 💡 | D-CA-1 文件名少 `unity-` 前缀 | **成立**。已改 `docs/CAPABILITIES-unity-2022.3.62f3c1.md` | §1（已改） |
| F11 💡 | 「HANDOFF S8」标签错（S8 在 `UNITY-OFFICIAL-VERIFICATION.md`），且两次报文不同 | **成立**。标签改引该文件 S8；**两个报文都留**（S8 的 `Play Mode view RenderTexture is not available` 与本次 `PlayMode rendering did not produce an image`） | 任务 1 步骤 5 |
| F12 💡 | 引擎标注句式与 U11–U27/U34 既有两种句式不一致、缺实测日期 | **成立**。沿用既有句式并补「2026-09-20 实测」 | 任务 1 各步骤 |
| F13 💡 | 替换块用行内反引号包裹会误导粘贴 | **成立**。执行时用 fenced block 逐行替换（本计划步骤已按行号锚定，不整块粘贴） | 执行注意 |
| F14 💡 | 索引表确实存在，未给 U54 插入点与严重度 | **成立**。U54 插在 `:76`(U53) 之后、`:77`(`\| **M4** \|`) 之前；严重度 **高** | 任务 1 步骤 9 |
| F15 💡 | §5 称「U42 已订正」但 `:1624` 仍在 | **成立**。见 F1：U42 适用引擎行一并订正；U29 保留并在横幅登记为未验证 | 任务 1 步骤 1/1b |
| F16 💡 | D-CA-1「同 2022.3.62 核心」是未验证推断 | **成立**。已标「推断（未验证）」 | §1（已改） |
| F17 💡 | HANDOFF §3 既有行名「M5（批次 A/B-1/B-2）」，新增行名「M5（批次 C-A）」；建议点明 C-A=⑩-b | **成立**。§3 新行后缀「（= ⑩-b 官方版复测）」 | 任务 2 步骤 3 |

**裁定后新增步骤**：任务 1 步骤 1b（横幅）、2b/7b（索引/标题）、任务 2 步骤 5（计数三处 + README）、步骤 6（SKILL）。

---

## 8. 执行结果与计划偏差（2026-09-20）

**结论：任务 1 / 任务 2 / 任务 3 全部完成；本批次**不改源码/测试**，仅文档；新增 PITFALLS **U54**。**

### 8.1 交付物

- `docs/PITFALLS.md`：U28/U31/U32/U33/U36/U39/U40/U41/U42 的「适用引擎」行升级 + U31 标题/索引行 + U41 标题/索引行 + 三处章节横幅收窄 + U31 追加 `npotScale` 说明 + U36 追加官方差异 + U39 追加「已存场景」前提 + 新增 **U54** 正文与索引行。
- `docs/M5-PROBES.md`：追加 **§10**。
- `docs/HANDOFF.md`：§0 基线、§1 坑库计数 `U1–U54`、§3 批次 C-A 里程碑行、§7 backlog ⑩ 拆分、§8 索引加 C-A 行。
- `README.md`：坑位记录 `U1–U54` + C-A 逐批说明。
- `skills/unity-game-dev/SKILL.md`：U41 行去掉「官方未验证」。
- `docs/m5-probes-raw/ca-*`（含 `ca-REPORT.md`）：原始证据。

### 8.2 偏离计划的地方（均已由冲突扫描交叉确认）

| # | 计划写的 | 实际做的 | 理由 |
|---|---|---|---|
| 1 | 任务 1 只列 8 处 `适用引擎` 行 | 按行号锚点处理 **9 处**（+U42） | 冲突扫描 F1：U42 已由 B-1 在官方版测过，其注释行不该继续写「未验证」 |
| 2 | 未提章节横幅 | 收窄 `:16` / `:1427` / `:1539` 三处横幅 | 冲突扫描 F2：否则同文件自相矛盾 |
| 3 | 受影响文件只列 PITFALLS/M5-PROBES/HANDOFF | 增 `README.md` 与 `skills/unity-game-dev/SKILL.md` | 冲突扫描 F3/F4：`U1–U53` 计数与 U41 章句会过期 |
| 4 | U54 证据指 `ca-30-tree-after-force.json` | 改指 `ca-31-root-dump.json` | 冲突扫描 F6：`scene tree` 输出无变换字段 |
| 5 | 未提 U32 复现前置 | U32 行补「前置 `npotScale=None`」 | 冲突扫描 F7：否则先被 U31 的 ToNearest 放大到 32 |
| 6 | U31 追加句写「另有」 | 改为「团结侧该默认值未实测，故一律显式设 `npotScale=None`」 | 冲突扫描 F8：不假设团结默认 |
| 7 | 执行时一次性大块 edit | 拆成小批 | 工具对含 `「」` 的整行匹配失败一次（已用尾串锚点绕过），非内容问题 |

### 8.3 测试与审查

- `npm test`：**621/621 绿**（本批不改代码/测试，数字不变）。
- 审查：起飞前只读冲突扫描（`reviewer`）报 **2🔴 + 6🟡 + 9💡**，**全部成立并已落入**（见 §7）。
