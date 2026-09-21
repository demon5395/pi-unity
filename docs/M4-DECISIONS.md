# pi-unity 决策账本（M4）

> **M4 已完成（2026-09-20）**。交付：**`lib/art.js` 美术纯函数管线 + PNG 编码器** · **`unity asset import`**（宿主图 → 导入设置 → 写后读回）· **`unity sprite assign`**（资产 sprite 绑定 + 世界尺寸）· **`unity prefab create|instantiate`** · **两个未知的真机探测（`docs/M4-PROBES.md`）** · **SKILL §3.6/§3.7 + PITFALLS U28–U47** · **E2E 四判据全过 + 官方版盲测独立复现 + 第三方复核 5/5**。
>
> 本文件是 M4 的过程记录（与 M1/M2/M3 同一形态）：逐条 `R<编号>` 裁决（含「如果错了的代价」）、任务/审查/修复轮次、真机判据、环境事实、**延后的 Minor 与已搁置项**。
> 编号**接 M3 的 R378**。真机原始证据在 `.superpowers/sdd/2026-09-20-pi-unity-m4-exec/`（gitignore 内，可删）。

---

# SDD ledger — plan: docs/superpowers/plans/2026-09-20-pi-unity-m4-implementation.md

工作树：`C:/Users/<用户>/.pi/agent/git/<内部 git 服务器>/pi/pi-unity-m4`（分支 `m4-art`）
基线：`66e20f2`（master，tag v0.6.0@`056bcc0`）+ `3af98f4`（计划）+ `1179edc`（冲突扫描修正）
SDD 工作区（本目录）：`.superpowers/sdd/2026-09-20-pi-unity-m4-implementation/`
真机证据目录（**计划约定的另一个目录**，留作 evidence）：`.superpowers/sdd/2026-09-20-pi-unity-m4-exec/`
测试基线：`npm test` → `# tests 456 / # pass 456 / # fail 0`
环境：`export PI_UNITY_ULOOP_BIN="C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe"`（每条命令都要带）

## 裁决（Ruling）

- **R379**：SDD 产物（账本/简报/报告/审查包）落在技能脚本默认目录 `…-m4-implementation/`，而**计划正文**里给真机证据指定的 `.superpowers/sdd/2026-09-20-pi-unity-m4-exec/` 保持不变（两处都被 gitignore，角色不同：SDD 流程产物 vs 真机 JSON）。为什么：脚本 `task-brief`/`review-package` 的默认输出目录由计划文件名派生，改它会同时偏离 M3 的目录命名习惯（`…-m3-exec`）与计划原文。如果错：只是两个目录名不统一，不影响任何交付物。
- **R380**：本机 `subagent` 工具**不支持指定模型**（agent 定义里只有 `suggested-model` 注释）→ SDD 的「按复杂度选最弱够用模型 / 修复第 4-5 轮升级模型」这条**无法执行**；改为**按 agent 角色固定**（实现者一律 `implementer`，审查一律 `spec-reviewer` + `code-reviewer`，最终审查 `final-reviewer`）。如果错：最坏情况是某轮修复没有换更强的模型，需要多一轮。

## 起飞前冲突扫描（只读子代理 `reviewer`，2026-09-20）

产出三张表（事实冲突 / 接口总表偏差 / 任务文本自洽性）。**8 条阻断 + 9 条重要 + 若干次要**，已**全部裁定并修进计划**（commit `1179edc`）：

| # | 严重度 | 发现 | 裁决 |
|---|---|---|---|
| ①-1 | 重要 | `spriteAlignment=Center` 下 `spritePivot` 读回值 spike **未探测**，计划却写进 intent → 每次不带 `--pivot` 的导入都会假红 | **采纳**：不给 `--pivot` 时这三项**不进 intent**（读回面仍返回，只作 informational）；并加真机观测步骤记录实际值 |
| ①-2 | 重要 | PITFALLS 适用引擎标「两者」，但 NEW-1…7 只在团结测过 | **采纳**：一律标「团结 2022.3.62t9 实测；官方 2022.3 未验证」，官方版复测进 backlog |
| ①-3 | 次要 | 「`maxTextureSize=8` 静默缩到 8×5」的实据被泛化成「一边超上限就不安全」 | **采纳**：文案限定为 spike 原始实据（24×16 + 8） |
| ①-4 | 次要 | `GetAssetPath(runtimeSprite) == ""` 是按文档语义写的，未探测 | **采纳**：注释标明未探测 + 任务 4 真机步骤新增「`sprite set` → `node inspect` 记录 assetPath」的观测 |
| ②-1 | **阻断** | `parseScriptResult` 返回 `{parsed}`，计划写成 `p.value.__read`（会 TypeError → 每次 `READBACK_FAILED`） | **采纳**：改 `p.parsed.__read` |
| ②-2 | **阻断** | `readActual` 把 `__read` 平铺在顶层，而 intent 是 `{asset:{…}}` → 每次 `asset import` 都 `verified:false` | **采纳**：读回投影必须与 intent **同形**（包一层 `asset`） |
| ②-3 | **阻断** | intent 有 `width/height`，`.cs` read 模式只回 `texWidth/texHeight` → 永久分歧 | **采纳**：`.cs` read 模式补 `width/height`（语义：`width` = 我要求的尺寸，`texWidth` = 真实纹理尺寸，**两者不一致正是静默缩放的信号**） |
| ②-4 | **阻断** | `prefab create` 同族形状错误（intent `{prefab:{…}}` vs 平铺读回） | **采纳**：`return { prefab: {...p2.parsed}, guid, file }` |
| ②-5 | **阻断** | `prefab` happy path 测试没注入 `_stat` → 生产侧 `fs.statSync` 抛 → `file=null` → 永远 `verified:false` | **采纳**：测试注入 `_stat`；**不许**放宽生产侧磁盘防线 |
| ②-6 | **阻断** | warning 断言 `includes('0.0')`，而实际文案是「只有 6.3% …」（不含 `0.0`） | **采纳**：断言改 `/6\.3%/` |
| ②-7 | 重要 | `--tolerance 0` 被 `positiveIntArg` 判非法（与 `pixels` 的 0–255 口径分叉） | **采纳**：专用 `zeroTo255Arg` + 补一条 `--tolerance 0` 成功用例 |
| ②-8 | 重要 | `test/envelope.test.js` 是**排序后 `deepStrictEqual`**，而计划让「追加」新码 | **采纳**：改成**按字母序插入**，并给出逐条的插入位置 |
| ②-9 | 次要 | 计划要重新导出 `isValidColor`，而 R251 已裁定不导出 | **采纳**：只导出 `{spriteSet, spriteAssign, parseWorldSizeArg}` |
| ③-1 | **阻断** | `spriteAssign` 的 intent 断言含 `ppu`，实现里没有，注释还说「以测试为准」（三处矛盾，且 JS 侧无从得知 PPU） | **采纳**：intent **不含 ppu**（读回面的 `ppu` 只进 actual） |
| ③-2 | **阻断** | `prefabInstantiate` 测试断言 `e.intent.sprite.assetPath`（`intent` 只有 `{name}` → TypeError） | **采纳**：改成 `deepStrictEqual(e.intent, { name })` |
| ③-3 | 重要 | GDI fixture 用 `Brushes.DeepPink`(`#FF1493`)，而判定一律 `#FF2E88`（绿通道差 26 > 容差 16）→ count 恒 0 → 误判「画面里没有图」 | **采纳**：GDI 图改用 `FromArgb(255,46,136)`，并写死「计色必须对齐」的警告 |
| ③-4 | 次要 | 7 个编号槽塞 8 条（`U31b` 后缀不符合既有形态） | **采纳**：改为 **U28–U35**（8 条），SKILL §7 表与 backlog 引用同步 |
| ③-5 | 次要 | SKILL §8 新条目写成 ⑧（§8 现有 ⓪–⑤） | **采纳**：改为 **⑥** |
| ③-6 | 次要 | 计划给的 SKILL §7 片段是 2 列表头，而 SKILL 里是 3 列（现象/处置/出处） | **采纳**：只给 3 列数据行 |
| ③-7 | 重要 | 盲测用的 `hero-blind.png` 全计划无来源 | **采纳**：任务 8 步骤 2 补「先造 fixture」的命令 |
| ③-8 | 重要 | 探测用 `scene save --path Assets/Scenes/SampleScene.scene` 会覆盖 M3 验收过的 29 节点场景；克隆里没有 `scene open` → `NOT_FOUND` 会被误读成「引用断了」 | **采纳**：改用 `Assets/M4Probe/ProbeScene.scene` + 克隆侧先 `scene open` |
| ③-9 | 次要 | 文件结构表里的 `lib/prefabread.js` 没有任何任务创建 | **采纳**：删掉该行（读回投影内联在 `lib/prefab.js`） |
| ③-10 | 次要 | 测试数预期算错（含漏加任务 2 的 18 条） | **采纳**：改为「只增不减，以实际为准」+ 分段算式 |
| ③-11 | 次要 | 「源图自带透明背景」这条路径 E2E 不覆盖（HANDOFF §4.5 要求带透明背景的 PNG） | **采纳**：判据① 补 `hero-alpha.png`（不给 `--remove-bg`，只 `--trim`） |

**扫描结论**：计划的骨架（任务切分/依赖顺序/TDD 步序/真机门检/`.cs` 的 API 用法/收尾顺序）通过；「读回面与 intent 同形」这一族是系统性缺陷，已统一修掉。

## 任务进度

- [ ] 任务 1：PNG 编码器（`lib/png.js`）
  - Task 1: 首轮实现 DONE（commit `c9c2706`，460/460）→ spec ✅ 通过 / code ✅ 通过 + **2 条 Important**（**测试断言口径**，非产品代码 bug）→ 进入修复循环
- [ ] 任务 2：美术纯函数管线（`lib/art.js`）
- [ ] 任务 3：`unity asset import`
- [ ] 任务 4：`unity sprite assign` + node-inspect 扩展
- [ ] 任务 5：两个未知的真机探测（`docs/M4-PROBES.md`）
- [ ] 任务 6：`unity prefab create|instantiate`
- [ ] 任务 7：文档回写（SKILL §3.6 / PITFALLS U28–U35）
- [ ] 任务 8：E2E 验收（四判据 + 独立盲测）
- [ ] 任务 9：收尾（bump 0.7.0 + 账本 + `ff master` + tag）

---

## 任务 1 审查发现与裁定（2026-09-20）

- **审查结果**：spec-reviewer **✅ 通过**（无缺失、无越界，逐字比对简报代码块；断言强度未被削弱）；code-reviewer **✅ 通过** + 2 Important + 2 Minor。
  code-reviewer 自己做了独立验证：用 **PIL/libpng** 解码 `encodePng` 产物（8 张不同尺寸，逐像素 sha256 一致）、独立重算三个 chunk 的 CRC、跨进程确定性复验。
- **F1（Important）→ 裁定：修**。`0xAE426082` 是**空 IEND** 的 CRC → 钉不住「CRC 必须覆盖类型+数据」（IEND 的 type-only 与 type+data 恒等）。修法：结构用例里逐块断言 `readUInt32BE(off+8+len) === crc32(slice(off+4, off+8+len))` + 块序 + `off` 走完 == `png.length`。
- **F2（Important）→ 裁定：修**。`data:'not a buffer'`（13 字节）因**长度不符**而报错，删掉 `isBytes` 守卫后仍绿 → 改用 `'x'.repeat(16)`（长度恰好等于 2*2*4）+ 断言 `/必须是 Buffer/`，守卫一失就静默成功 → 用例必红。
- **F3（Minor，`data instanceof Uint8Array` 拒 `Uint8ClampedArray`/跨 realm Uint8Array）→ 裁定：延后（deferred Minor）**。不假绿、只是报错误导；下游 `lib/art.js` 用 `Buffer.alloc`，当前无消费者。→ 进最终审查的甄别清单。
- **F4（Minor，编码器峰值内存 ≈ 2× 未压缩 + 2× 压缩）→ 裁定：延后（deferred Minor）**。复杂度仍是 O(n)、像素画规模无风险。→ 进最终审查的甄别清单。
- **Ruling R381（spec-reviewer 的范围外备注①：`deflateSync` 默认参数的字节确定性只钉在同一 Node 版本上）→ 不修，登记为下游约束**：M4 的测试**一律不得写死 sha256 字面量**（任务 3 的测试用「现算 vs 磁盘现算」、真机步骤用「现算」，均已是运行时比较）。→ 任务 3/8 的简报里会带上这条提醒。
- **Ruling R382（计划内部措辞冲突：文件结构表把 `crc32` 写成「私有」，而任务 1 步骤 3 明确要求导出它给测试钉已知值）→ 以步骤 3 的显式取值优先**（已按此实现，不修代码）；计划文本已同步订正。
- **Ruling R383（控制者分派失误）**：任务 1 的分派里我写了「简报步骤 5 要求变异自检」，而计划的任务 1 步骤 5 只要求 `version`+`npm test`+`add`+`commit`（变异自检在**任务 2** 的步骤 5）。实现者超额做了并给了证据 → 不判偏离，仅记此失误以免下轮重复。
- Task 1: fix round 1/5（F1 + F2 均 ADDRESSED；F3/F4 延后；R381–R383 已裁定）—— commit `d7a83b6`
  - 定向复审（code-reviewer）：**所有发现已解决 / 修复 diff 里的新破坏：无**；产品代码 `lib/png.js` blob 哈希在两个 rev 间逐字节相同；测试条数仍 15（只加固不加条）；独立推演确认新断言会在两种变异下变红
- Task 1: complete (commits `1179edc`..`d7a83b6`, review clean) —— `npm test` **460/460**，spec ✅ / code ✅ / 定向复审 clean
## 任务 2 首轮：DONE_WITH_CONCERNS（计划自身 4 处自相矛盾）

实现者 `b291a4e`：`node --test test/art.test.js` 18/18、`npm test` **478/478**。它在 TDD 的「测试 = 验收 gate」前提下**只动实现、不动断言**，报了 4 处偏离。控制者裁定如下（**以计划自己的测试为权威**）：

- **R384①（warning 阈值）→ 采纳实现者的修法**：计划里实现写 `nearFraction < 0.02`，而计划自己的测试用例（4×4 图、1 个 key 像素 = **6.25%**）断言「必须有 warning」→ 两者不可兼得。裁定：阈值提为具名常量 **`MIN_KEY_HIT_FRACTION = 0.1`**（10%），保留 18 条断言逐字不动。理由：① 测试是验收 gate；② 10% 对「背景其实不是你说的那个色」这个失败信号**更强**（2% 会放过渐变/抗锯齿背景这类**部分命中**的情形）；③ E2E fixture 的背景占 **93.75%**，不误报。代价：少数「背景只占很小面积」的图会多一条 warning（warning 不失败，只让人多看一眼）。→ **计划正文的三处「<2%」（L441/L731，以及任务 7 的 SKILL §3.6 文案）必须同步改成 10%**（已改）。
- **R384②（测试 10 的表达式算术上不可能）→ 采纳实现者的修法**：`px[0]+px[2]` 对红 `[255,0,0,255]` 与蓝 `[0,0,255,255]` 都等于 255，永远凑不出期望的 `[255,255,510,510]`。改成 `px[2]+px[3]`（b+a：红 0+255=255、蓝 255+255=510）→ fixture 与期望值原样不动，且比原式更能区分红/蓝。代价：无。
- **R384③（containFit 居中：floor → round）→ 采纳**：计划里实现用 `Math.floor`，而计划自己的测试 11（2×1 → 2×2）要求图落在**下**半行（`px(0,0)` 透明、`px(0,1)` 红），与注释「上下各留 0.5 行」一致 → `Math.round(0.5) = 1`。裁定：用 `Math.round`（余数为奇数时偏下/右，确定性）。代价：居中在奇余数时有 1 像素偏置（可接受，且已有测试钉住）。
- **R384④（trim 后也要报 `output`）→ 采纳**：计划里实现只在 `--fit` 时设 `output`，而测试 12（只 trim）断言 `output.width === 2`。裁定：`output` = **最终画布尺寸**（trim 之后、fit 之后都报）。代价：`output` 的语义从「fit 结果」变成「最终画布」，任务 3 的 `actual.art.output` 与本裁定一致。
- **R385（低危，采纳实现者的判断：不在本任务修）→ deferred Minor**：`assertImage` 声明接受 `Uint8Array`，但 `cropImage` 用 `Buffer.prototype.copy` → 非 Buffer 输入会抛 `TypeError`。当前**不可达**（上游 `decodePng` 恒返回 Buffer），且**不假绿**（响亮抛）。约定：**`lib/art.js` 的输入约定 = Buffer**（`decodePng` 的输出），`Uint8Array` 支持只承诺在 `lib/png.js` 的编码器上。→ 进最终审查甄别清单。
- **控制者动作**：计划正文加「任务 2 实现偏离（R384）」注记（不改那两段长代码块 —— 以仓库实际实现为准），并把 SKILL §3.6 的「<2%」改成「<10%」。
- Task 2: 首轮实现 DONE_WITH_CONCERNS（commit `b291a4e`，478/478）→ R384①–④ 已裁定采纳 → 进入任务审查

## 任务 2 审查发现与裁定（2026-09-20）

- **spec-reviewer：✅ 通过**（10 函数 / 10 导出 / 18 条断言逐条落地、无缺失无越界；独立核实：四角推断与 `tolerance` 的三类非法走 `TypeError`、图片内容类错误带 `code`；对 R384①–④ 逐条给出「裁得对」的独立意见）。
- **code-reviewer：❌ 需要修复**（2 Important + 11 Minor），并附了**可复现的输入**与 48841 组 containFit fuzz（整数目标下无异常）；它明确核实 `--tolerance 0` **安全**（`f=(d-0)/0` 不可达，无 NaN）。

### 裁定（全部进修复轮 1/5）

- **F1（Important）`changed` 漏报 → 裁定：修**。羽化带里 `d == 2*tol` 时 `f=1`、alpha 不变，但 de-spill 已改写 RGB，而 `changed` 只跟 alpha 走 → 信封里的 `art.removeBg.changed:false` 是**假事实**（反假绿纪律）。修法：RGB 任一通道被改写也置 `changed=true`。
- **F2（Important）四角全透明 + `--remove-bg auto` → 裁定：修**（这是最凶的一条：HANDOFF §4.5 要的就是「带透明背景的真实 PNG」，用户一旦多给个 `--remove-bg auto`，暗色主体会被羽化成半透明、且**不告警**）。修法：`inferBackground` 在**四角 alpha 全为 0** 时抛 `BACKGROUND_AMBIGUOUS`（`detail.reason='transparent-corners'`），消息直接给可操作建议「这张图本来就没有实心背景 → 别用 --remove-bg，直接 --trim」。**不新增错误码**（命令层的 `artFailure` 已在此码上，只需补一条 hint —— 计划任务 3 已同步）。
- **F3（Minor）`nearFraction` 把本来就 alpha=0 的像素算作命中 → 裁定：修**。命中率的分母改只算**不透明**像素（`a!==0`）—— 告警要回答的是「你说的背景色在**可见部分**里占多少」，否则虚高的命中率会掩盖「背景色给错了」。已有 18 条用例的 fixture 全是 a=255 → 不影响。
- **F4（Minor）`containFit` 不校验目标尺寸（小数目标产出畸形图、且 `assertImage` 会放行）→ 裁定：修**。加与 `resizeNearest` 同形的正整数守卫（`TypeError`）。
- **F5（Minor）`trimBounds` 的 threshold 静默退化（非 number 当 0、`NaN` 返回 `null` = 静默宣称全透明）→ 裁定：修**。用 0–255 整数守卫（与 `assertTolerance` 同口径）。
- **F6（Minor）`keyOutPixels` 是唯一无入口守卫的导出函数（`tolerance: NaN` → 静默 no-op）→ 裁定：修**。加 `assertTolerance`。
- **F7（Minor，即 R385）`cropImage` 用 `Buffer.prototype.copy` 与 `assertImage` 的 `Uint8Array` 白名单矛盾 → 裁定：修**（一行 `out.set(img.data.subarray(...))`）—— 顺手关掉 R385，不再延后。
- **F8（Minor）测试 13 是自比较（`r.img === img` → 永真）→ 裁定：修**。改成与调用前的副本 `before` 比较，并把用例名里不存在的「decode→encode 往返」删掉（真正的往返在下一用例）。
- **F9（Minor）测试 5 的羽化断言是区间（放过 `f` 斜率被改）→ 裁定：修**。钉死精确值（`data[1] === 60`、`data[3] === 100`；我独立算过：key #00FF00、像素 [60,200,0,200]、tol 40 → d=60 → f=0.5 → a=100，de-spill cap=60）。
- **F10（Minor）用例名仍写 `<2%` → 裁定：修**（改 `<10%`，与 R384① 同口径）。
- **F11（Minor）`output` 在「没给任何 flag」时是 `null`、「给了 trim 但本来就贴边」时是 `{w,h}` → 裁定：按 R384④ 的字面统一为「永远是最终画布尺寸」**（去掉 `geometryRan` 条件）。理由：`output` 是给 agent 读的字段，两种口径会让调用方写分支；想判断「几何有没有变」已有 `trimmed` 与源图宽高可对照。
- **F12（Minor）10% 阈值会让「背景只占 8%」的正常图多发一条告警 → 裁定：接受，不修**。告警不失败、成本是一眼；而调成「相对 + 绝对下限」反而会漏掉小图。已记入 R384① 的代价栏。
- **F13（Minor）`normalizeArt` 里非法 `--remove-bg` 走 `parseColor` 抛**无 code 的裸 Error**（会被告警归到 `ART_FAILED` 内部错）→ 裁定：修**。`normalizeArt` 的 else 分支捕获并转成 `TypeError`（中文消息 + 保留 `parseColor` 给直调者的原语义）；CLI 层今日不可达（`parseRemoveBgArg` 已先校验），但它是个分类陷阱。
- **控制者动作**：计划的任务 2 注记扩充（R384 + 本轮）；任务 3 的 `artFailure` hint 补「原图本来就是透明背景 → 别用 --remove-bg，改用 --trim」；任务 7 的 SKILL §3.6 警告补「图自带 alpha 时别用 `--remove-bg`（部分角透明时推断仍可能误判）」。
- Task 2: fix round 1/5（F1–F11 + F13 全部 ADDRESSED；F12 接受不修）—— commit `d644fa5`
  - 定向复审（code-reviewer）：**所有发现已解决 / 修复 diff 里的新破坏：无**；测试 18→19（只加 F2 的「四角全透明」守卫用例）、`assert.` 计数 50→67（净 +17，无弱化）、`lib/art.js`+`test/art.test.js` 之外零改动、无 `false &&` 变异残留
  - **复审记录的两条行为变化（必须带进任务 3 的简报）**：① `containFit` 现在要求**真 number 目标**（字符串会抛 `TypeError`）→ 任务 3 的 `--fit` 必须 `Number()` 后再传（计划的 `parseFitArg` 已是 number ✓）；② `changed` 现在把「不可见像素的 de-spill」也算作已改（`removeBg.changed` 目前无消费方，仅 informational）
- Task 2: complete (commits `d7a83b6`..`d644fa5`（+ 控制者文档 commit `fd0f7b1`, review clean) —— `npm test` **479/479**，spec ✅ / code ❌→修→定向复审 clean

## 任务 3 首轮：DONE_WITH_CONCERNS（`ffe79d4`，499/499，真机 7/7 符合预期）

- 真机：`.cs` **第一次真机跑就编译执行成功**；①happy exit0/verified true；③`--max-size 8` 抬到 32 且真实纹理 32×24；④无 `--force` → exit1 `ASSET_EXISTS` 且磁盘未变；⑤a/b/c/d（无 pivot 观测 / `--pivot 0.25,0.75` / `--tolerance 0` / `hero-alpha.png` 8×6）全 exit0；清理 `GONE`。编辑器留活（Tuanjie PID 47076，`doctor` 5/5 pass）。
- **R387（D1：简报自相矛盾 —— `intent` 能不能带 `width/height/texWidth/texHeight`）→ 裁定：方案 B（修测试 mock + 去掉实现里多余的归一化），驳回实现者选的方案 A**。原因：简报步骤 6 的实现稿从 `settings`（已 delete 这 4 个键）构造 `intent`，而步骤 4 的用例 9/11 断言 `intent.asset.width === 2` / `intent.asset.texWidth === 6` → **简报自己不可能同时成立**（这是我写计划时的错）。
  · 实现者选了 A：`intent` 从 `artifact` 构造（保留 4 个键）+ 在**读回投影里把 `width/height` 归一成 `texWidth/texHeight`**。真机上两者恒等（`.cs` 的 `width` 就是 `tex.width`），所以 A **不改运行时行为**，但它把「测试 mock 写错了」这件事藏起来了（用例 11 的 mock 覆盖了 `texWidth:6` 却没覆盖基座里的 `width:2`），且让 `actual.asset.width` 变成死字段。
  · **裁定 B**：实现去掉那个归一化（`readActual` 直接透传 `__read`）；把用例 11 的 mock 改成 `readEnvelope({ width: 6, height: 4, texWidth: 6, texHeight: 4, maxTextureSize: 32 })`。**断言一条不改**（只用例 11 的 mock 补齐它自己断言所需的字段）—— 修 mock 不是放宽验收，是修测试数据。
  · 如果错：代价是修复轮多一个 commit；不改的代价是一个永久性的「宽高字段形同虚设 + mock 缺陷不可见」。
- **R388（`texFormat` 真机是 `RGB24` 而非计划里写的 `RGBA32`）→ 采纳事实，修计划的期望文案**：最终画布**全不透明**时 Unity 会丢掉恒定 alpha 通道 → `RGB24`；画布带透明像素时才 `RGBA32`。`texFormat` **不在 intent/读回口径内**（仅 informational）→ **不改代码**。计划任务 3 步骤 11① 的期望文案已同步；任务 8 的判据不得拿 `texFormat` 当判据。
- Task 3: 首轮实现 DONE_WITH_CONCERNS（commit `ffe79d4`，499/499）→ R387/R388 已裁定 → 进入任务审查

## 任务 3 审查发现与裁定（2026-09-20）

- **spec-reviewer：❌ 需要修复**（唯一阻塞 = R387 未按裁定落实；其余逐项核对通过：13 个前置分支、三道假绿防线、`.cs` 11 项设置 + `TextureImporterSettings` 往返、USAGE 插入不破 `test/cli.test.js` 切片、7 码按字母序、`test/asset.test.js` 零改动、真机 7 条逐条对上留存 JSON）。
- **code-reviewer：❌ 需要修复**（1 🔴 + 6 🟡 + 5 💡，全部带可复现输入；它独立实测了下表每一条，并证实**真机记录是真跑的**：`hero-gdi.png` 219 B / `hero-alpha.png` 167 B 与 JSON 里的 `sourceBytes` 逐字相符、`FillRectangle(10,8,12,8)` 与 `trimmed` 相符）。

### 裁定（全部进修复轮 1/5，除非注明）

- **R389（🔴 F1，两位审查者都提）`readActual` 未按 R387 直透 `__read`** → **修**。删掉读回投影里 `width/height ← texWidth/texHeight` 的归一（生产语义等价，但把 `asset.width` 变成死字段 + 把自相矛盾的 mock 固化成隐性契约：`test/importart.test.js` 的 mock 同时给 `width:2` 与 `texWidth:6`，现实中不可能）。同时把两个 mock 补成现实同形：用例 11 → `{width:6,height:4,texWidth:6,texHeight:4,maxTextureSize:32}`；用例 10 → `{width:1,height:1,texWidth:1,texHeight:1}`（断言一条不改）。
- **R390（🟡 F2）`--max-size > 16384` 落 `TEXTURE_TOO_LARGE` + 谎言报文**（「图片尺寸 6x4 超过上限」，而图只有 6×4；还把 argv 错判成运行时错）→ **修**：`--max-size` 本身 >16384 在用法面落 `BAD_MAX_SIZE`（exit 2）；`TEXTURE_TOO_LARGE` 只留给**真实画布/源尺寸**超限。
- **R391（🟡 F3）用户给的 `--max-size 100`（非 2 的幂且大于源尺寸）原样发往 Unity** → **修**：`effectiveMax = nextPow2AtLeast(max(maxSizeNum||0, autoMax))`（上侧也归一）；`maxTextureSizeRaisedFrom` 记**用户原值**。理由：若 Unity 把非档位值取整到 64/128，**每一次合法调用都会假红**。真机补一条 `--max-size 100`（验证归一后读回一致）。
- **R392（🟡 F4）`artFailure` 的 hint 与 message 自相矛盾**（四角全透明时 message 说「别用 --remove-bg」，hint 却说「显式指定背景色」；没给 `--remove-bg` 时也讲 `--remove-bg`）→ **修**：按 `err.detail.reason === 'transparent-corners'` 与「用户到底给没给 removeBg」分流 hint（hint 会把人引向死路，本项目有 R366 先例）。
- **R393（🟡 F5）写路径截断 hint 是**节点域**文案**（「用 scene tree / node inspect 复核该节点」）→ 操作者按它重试会被自己的落盘文件挡成 `ASSET_EXISTS` → **修**：本地补一条资产域 hint（「PNG 已落盘；用 `unity exec` 读该资产的 TextureImporter 复核后再决定是否 `--force` 重试」）；不改 `lib/scene.js` 的公共文案。
- **R394（🟡 F6）`--to` 不校验扩展名**：`--to Assets/Art/hero.txt` → Unity 当 TextAsset 导入 → `IMPORTER_NOT_FOUND`、hint 只指责 `.cs`、**文件留在磁盘上** → **修**（两部分）：① 用法面要求 `--to` 以 `.png` 结尾（否则 `BAD_TARGET_PATH`，exit 2，不需新码）；② 写路径的 `__error` 加 `describeError` 映射 `IMPORTER_NOT_FOUND`/`TEXTURE_NOT_FOUND` → 带 `intent` + 「文件已落盘，先删掉它再重试」。
- **R395（💡 F7）`--force` 覆盖路径**在单测与真机**从未被执行**，而 hint 对它作了具体承诺 → **修**：补 1 条单测（目标已存在 + `force:true` → 真的走写盘，`spy.length>=1`；不能只因 `_exists` 注入就假定）+ 真机 1 条（**同路径同尺寸不同内容** 覆盖：`verified:true`、guid 不变、`AssetDatabase.GetAssetDependencyHash(path)` **变化** —— 后者是「内容真的被重导」的唯一可读代理）。
- **R396（💡 F9）写模式不校验 `__written`**（与 R225「写结果必须符合协议」不一致）→ **修**：`__written !== true` → `BAD_SCRIPT_RESULT`（读回仍是唯一判定，但协议不得形同虚设）。
- **R397（💡 F10）`--fit 16385,16385` 会先分配 1.3 GB（852 ms）才报 `TEXTURE_TOO_LARGE`** → **修**：`--fit` 超 16384 在**用法面**落 `BAD_FIT`（argv 可判，不该把内存炸弹留给运行时）。
- **R398（💡 F12）`--filter bilinear` / `--compression normal` 两条非默认映射从未被执行**（Enum.Parse 写错名只会在真机抛，单测全绿）→ **修**：补 1 条单测断言 payload 里逐字是 `Bilinear`/`Compressed`；真机补 1 条 `--filter bilinear --compression normal --ppu 32`（顺便覆盖 `--ppu` 非 16）。
- **R399（控制者新增探针）`--pivot 0.5,0.5`**：与默认 Center 数值相同的 Custom 轴心，**Unity 可能把 `spriteAlignment` 归一回 0** → 若归一，intent 硬编码的 `9` 会让**每次合法调用假红**。→ **真机探针**：`--pivot 0.5,0.5`；**若 verified:false 且分歧在 `asset.spriteAlignment`** → 把 intent 里这三个键的入参条件改成「pivot 与 (0.5,0.5) 不等时才断言」并复跑至绿；若真机归 0 而代码未改 → 停下报 BLOCKED。
- **R400（F8 `--trim=1`/`--force=1` 静默失效 + F11 的 `--project-path` 拼错会造游离目录）→ 裁定：延后（deferred Minor）**。理由：`--flag=1` 的 `=== true` 口径是**全项目既有约定**（`lib/asset.js` 同款），只在本命令改变会让行为分叉；`--project-path` 不校验与 `asset write` 同款（既有行为，非本任务引入）。→ 进最终审查甄别清单。
- **F11 前半（`--to Assets/` 目录本身）→ 已由 R394① 的扩展名校验自然关闭**。
- **其它小项 → 修**：① `bin/unity.js` USAGE 里 import 段尾的双空行；② `__read` 非对象守卫随 R389 自然消失（不单独处理）。
- Task 3: fix round 1/5（R389–R399 全部 ADDRESSED；R400 延后）—— commit `af5fe90`
  - 定向复审（code-reviewer）：**所有发现已解决**；禁改文件零改动；新增 9 条测试无自证断言；用法面新校验经实测**不误伤**合法输入（`.PNG` 放行、`--max-size 16384` 放行、`--fit 16384,16384` 放行、`nextPow2AtLeast(16384)===16384` 不溢出、带额外键的 `{__written:true,…}` 不被误判）；真机 JSON 字段逐条核对一致
- Task 3: complete (commits `fd0f7b1`..`af5fe90`（+ 控制者文档 commit，review clean) —— `npm test` **508/508**，spec ❌→修→定向复审 clean，真机 17 条命令（含 `--max-size 100`、`--pivot 0.5,0.5`、bilinear/normal+ppu 32、`--force` 覆盖 guid 不变 + 依赖哈希变）
  - **deferred Minor（进最终审查甄别）**：① `bin/unity.js:153-154` 把 `asset import 选项：` 前的空行删了（**我的前提有误**：首轮根本没有连续空行；结果它是 12 个顶层「… 选项：」头里唯一前面没空行的）→ 建议还原该行（净效果应为 no-op）；② `TEXTURE_TOO_LARGE` 现在只剩「真实源 >16384」一个出口，而该出口**仍无测试**（`encodePng({width:16385,height:1})` 就能廉价覆盖）；③ 报告里「空行数从 2 回到 1」这句表述失实。

## 任务 4 审查发现与裁定

- Task 4: 首轮实现 DONE_WITH_CONCERNS（commit `dc9ea94`，518/518）—— 真机 6 步全过：`sprite assign` exit0/verified、`assetPath` 命中、`ppu=16`、`worldSize` 误差 1.4e-7、**父级 scale 2,2,1 下仍 verified（localScale 正确除以 2）**、`pixels --count-color '#FF2E88'` = **2120** > 0、**运行时 sprite 的 `assetPath` 实测为 `null`**（关闭了 M4-SPIKE 的未探测项）、清理后 `GONE` + `nodeCount=1`。
- 实现者自报2 处**必要的**简报偏离（均属简报代码片段的缺漏，已接受）：① `lib/sprite.js` 需额外 import `parseScriptResult`；② USAGE 模板串里的反引号必须转义（否则 `bin/unity.js` 直接 `SyntaxError` —— R372 的老坑）。
- 疑虑 → 裁定：
  · **① 旋转下的 `--world-size`**（`sr.bounds.size` 是**世界 AABB**，有旋转时会变大 → 会如实落 `verified:false`）→ **接受行为，但补文档**：USAGE 与 SKILL 里写明「节点/祖先有旋转时 AABB ≠ w×h → 先在无旋转的父级下设尺寸」。（真机只验了父级缩放，旋转未探测 → 登记。）
  · **② `parseWorldSizeArg` 导出但无消费者**（与 R251 精神冲突）→ **补直测用例**（而是不取消导出）：它本来就是简报要求为测试导出的，给它一个真消费者。
  · **③ `sprite-assign.cs` 对非对象形态的 `worldSize` 静默 no-op** → **改成响亮报 `BAD_PAYLOAD`**（JS 侧不可达，但 `.cs` 被单独复用时不能『不报错也不生效』）。
  · **④ `sprite == null` 时 `worldSize` 读回 `{0,0}`** → **改成 `null`**（与 `spriteName` 同口径，免得 agent 把「没 sprite」读成「尺寸是 0」）。
  · **⑤ `shot --out` 用相对路径会写进 S0Project**（实现者已自行拷回并清理）→ **计划里所有真机步骤的 `--out` 改成绝对路径**（`$R` 是相对路径 → 用绝对形式的变量）；这是计划文本的错，非实现缺陷。
- Task 4: fix round 1/5（R401–R412、R414、R415 全 ADDRESSED；R413 按裁定不修）—— commit `640f74b`
  - 定向复审：16/16 ADDRESSED，禁改 5 文件零改动；**新增 1 条 🟡**（R411 的纹理回收判据不全：只判了 sprite 的 hideFlags，`oldSprite.texture` 无条件销毁 → 若旧 sprite 的纹理是**资产纹理**（只能由 `unity exec` 构造），会毁伤该资产的内存对象）+ 6 条 💡（其中 R406④ 的 tripwire **可被注释满足** —— `.cs` 文件头注释里逐字列了那 5 个码与 `__written`；AMBIGUOUS_SPRITE/isImage 两个新分支零单测；除法断言对格式敏感等）。
  - **R418 裁定：再走一轮（round 2/5）**，只收 4 条高价值项：① 纹理回收补 `hideFlags` + `oldTexture != sp.texture` 判据（**防误伤资产的纪律**）；② R406④ 的 tripwire 改成 `"__error":"CODE"` 形态 / 先剥注释（**无牙的断言就是假信心**，本项目有 R322/R328/R246 先例）；③ 为 `AMBIGUOUS_SPRITE` 与 `isImage` 两个新分支各补一条单测；④ 把 R401 的 hint 写得**精确**（`≤1e-4` 无法验证；略大于 1e-4 的值的相对精度仍只有 `1e-4/值`）。其它 💡（除法断言格式脆弱、键集合对重复读取假红、`isImage` 扩展名表缺 webp、1e-4 窗口扩宽）→ **延后**（前者方向安全、后者超出 R401 的逐字裁定）。
- Task 4: fix round 2/5（R418 的 4 项）—— commit `d57a243`（524/524）
  - **R419（实现者的疑虑 → 裁定：接受）**：R418① 的「误伤资产」在本机**复现不出** —— 旧代码确实对资产纹理调了 `DestroyImmediate`，但 **Unity 自己拒绝执行**（`Destroying assets is not permitted to avoid data loss.`，Editor.log 有据），对象存活。→ 新判据的价值是「把安全性**显式化**」：不再依赖引擎的日志级保护、不再刷错误日志。它**不是**在修一个已发生的破坏，不得当作「已证实的假绿/毁伤」记入账本。
  - 变异自检（实现者做的，很有价值）：删掉 `AMBIGUOUS_SPRITE` 分支（注释保留）→ **旧 tripwire 14/14 全绿（无牙实证）**、新 tripwire 红 → 证明 R418② 的修改真的加上了牙。
- Task 4: fix round 2 定向复审 → 待填

### 任务 4 审查发现与裁定（完整）

- **spec-reviewer：✅ 通过**（逐项落地、`test/sprite.test.js` 零改动、`node-inspect.cs` 纯 additive、真机 6 步逐条对上 JSON；它另用「35.5 px/unit × 1.6×1.2 世界单位 ≈ 2420 px」与实测 count=2120 交叉验证了「画面里真的看得见」确实是该 sprite 的世界尺寸，不只是 >0）。
- **code-reviewer：❌ 需要修复**：**1 条已复现的假绿** + 4 条已裁定未落地 + 3 条新发现 + 5 条 💡。

裁定（全部进修复轮 1/5，除注明）：
- **R401（假绿，必裁）子 1e-4 世界尺寸会假绿** → **修**：`compareSubset` 用**绝对**容差 1e-4（R50 已裁定不改）→ `--world-size 0.00001` 与读回 `{0,0}` 差 100% 仍 `verified:true`（审查者用真代码路径复现）；生产端可达（`node set` 可造零缩放）。**修法**：`parseWorldSizeArg` 加下界（`x/y <= 1e-4` → `BAD_WORLD_SIZE`，仍是纯 argv 判定）+ hint 写明「读回容差是绝对 1e-4，小于该量级的尺寸无法验证」。**不要**动共享容差。
- **R402（已裁定 ③）`.cs` 对非对象 `worldSize` 静默 no-op**（且 `{}` 会抛 `InvalidCastException` → 变成 uloop 层失败）→ **修**：`ws == null || ws["x"] == null || ws["y"] == null` → 响亮 `BAD_PAYLOAD`（JSON `null` 也判 `BAD_PAYLOAD`）。
- **R403（已裁定 ④）`sprite == null` 时 `worldSize/ppu` 读回成 `0`** → **修**：`sprite == null ? null : {x,y}`（`ppu` 一并改 `null`）。审查者已核过 `compareSubset` 的 F2 路径：不会因此假绿，方向更安全。
- **R404（已裁定 ①）旋转下 `--world-size` 必假红但未写文档** → **修**：USAGE 与 `mismatchHint` 写明「节点/祖先有旋转时 AABB ≠ 精灵宽高 → 预期 `verified:false`；改用 `shot`+`pixels` 或先清旋转」（并明确「不要为此放宽容差」）。
- **R405（新发现，多子 sprite 假绿）`LoadAssetAtPath<Sprite>` 对 Multiple 图会拿到第一个子 sprite，而 `GetAssetPath` 只返回主资产路径** → intent 与 actual 都是 `Assets/…sheet.png` → 用户要第 3 个却挂上第 1 个并 `verified:true`。**修**：`sprite-assign.cs` 判 `AssetDatabase.LoadAllAssetsAtPath(assetPath)` 里 Sprite 数量 >1 → 返回运行时码 `AMBIGUOUS_SPRITE`（不进用法表 → 退出码 1），JS 侧 `describeError` 给可操作 hint（「该资产含多个 Sprite；本命令只支持单 sprite 资产（`asset import` 固定 Single）」）；USAGE 写「只支持单 sprite 资产」。**必真机验**（新增 `.cs` 分支，约束 7；用 `unity exec` 把一张副本改成 `spriteImportMode=Multiple` 再 assign）。
- **R406（新发现，测试保护力缺口）静态契约只查「出现过 `lossyScale` 这个词」→ 注释即可满足**：审查者把 `sprite-assign.cs` 的父级缩放反算整段删掉（保注释），10/10 仍绿；且 `sr ??= go.AddComponent<…>()` 能绕过 `doesNotMatch` 断言。**修**：① 改成断言**表达式**（`Mathf.Abs(parentScale.[xy])` 与 `b.[xy] * Mathf.Abs(parentScale.[xy])` 的除法形态）；② 追 `/\?\?=/` 禁止；③ 照 `test/sprite.test.js` 的范式补 tripwire：payload 键集合相等（`['asset','path','worldSize']`）、`__error` 码集合（`BAD_PAYLOAD/NOT_FOUND/SPRITE_NOT_FOUND/COMPONENT_ADD_FAILED`+新码）、`"__written":true`；④ 显式断言调用顺序（`spy.length===2` + `spy[1].args[1]` 以 `node-inspect.cs` 结尾）。
- **R407（已裁定 ②）`parseWorldSizeArg` 零消费者** → **补直测**；并顺带**收紧**数值形态：每个分量按 `^-?\d+(\.\d+)?$`（trim 后）校验 → `'0x10,1'`/`'1e3,2'`/`'+1,2'`/`'Infinity,1'` 全部落 `BAD_WORLD_SIZE`（现有 `'1e3,2'→1000` 这种“能跑但奇怪”的行为不要）。
- **R408（新发现，`isAssetPath` 过粗）** → **修**：先把路径归一（折叠重复 `/`、去 `./` 段）**再同时进 intent 与 payload**（否则 Unity 回规范路径时会假红）；`..` 改为**按段**判定（不再误拒 `a..b.png`）；`SPRITE_NOT_FOUND` 的 hint 对非图片扩展名不要声称「该 PNG 可能没被导入为 Sprite」。
- **R409（新发现，等于 R274 的反例）`--asset=`（空串）落 `MISSING_ASSET`** → **修**：与 R274 对齐 → 空串 = 「给了值但非法」→ `BAD_ASSET_PATH`（相应测试用例的期望码要改；两个都是退出码 2）。
- **R410（新发现，镜像被静默抹掉）`--world-size` 会用 `+` 覆盖 `localScale` 的符号** → **修**：用 `Mathf.Sign(t.localScale.[xy])` 保原符号（真机 ③ 的正缩放用例结果不变），并在 USAGE 补一句。
- **R411（小泄漏）`sprite assign` 覆盖掉 `sprite set` 造的运行时 sprite 时不回收隐藏纹理** → **修**：覆盖前判 `hideFlags` 含 `HideAndDontSave` → `DestroyImmediate(sprite.texture)` + `DestroyImmediate(sprite)`（只回收我们自己的运行时对象，不碰资产）。
- **R412（`--help` 索引缺命令）** → **修**：命令索引补 `sprite assign` 一行 + 示例段补一条。
- **R413（intent 不包含 `path`，同名节点可能挂错）→ 裁定：不修**。理由：审查者自己指出天真地把 `path` 塞进 intent 会因「裸名 vs 全名路径」造成**假红**；且 `nodeSet`/`nodeDelete` 同属工具级已知性质（R71）。→ `actual.path` 已能暴露真实落点，登记为已知行为。
- **R414（`node-inspect.cs` 里那句「未真机探测」的注释已陈旧）** → **修**（一句话：改成「已在团结 2022.3.62t9 实测为 `null`」）。
- **R415（真机补项）**：① `SPRITE_NOT_FOUND` 真机一条（指向不存在的资产）；② `AMBIGUOUS_SPRITE` 真机一条（Multiple 副本）；③ 真机步骤**不许**把 `play view` 输出重定向到 `/dev/null`（要留证据）。
- **R416（跨任务风险，登记进任务 5）**：审查者发现全仓 `.cs` **没有** `PrefabUtility.RecordPrefabInstancePropertyModifications`/`EditorUtility.SetDirty`，而 `scene-save.cs` 只调 `SaveScene` → **在 Prefab 实例节点上改的 `sprite`/`localScale` 是否会被 `scene save` 落盘**未验证（这恰好命中 M4 的卖点「能随交付物走」）。→ 任务 5 的探测② **增加这一条**；若失败，需要一个后续修复（`sprite-assign.cs` + 可能的 `node-set.cs`）。
- **R417（文档登记，进任务 7）**：手工导入的 `Tight`/`Sliced`/`Tiled`/图集会咬人（本命令只保证 `asset import` 出的 `FullRect`+`Single`）；Screen Space Overlay 的 Canvas 下「世界尺寸」语义与屏幕像素不同。→ SKILL/PITFALLS 各一句。
- **逐任务 Minor 登记（报告表述，不改代码）**：报告说「其余步骤与简报逐字一致」但三个新码的插入位置与简报原文不同（排序断言无关）；报告写「960×640 的 Game 视图」而截图实际 892×355（窗口捕获受窗口尺寸限制）。

## 任务 4 收尾

- Task 4: complete (commits `517c292`..`d57a243`（另有控制者文档 commit）, review clean) —— `npm test` **524/524**；spec ✅ / code ❌→修两轮→定向复审 clean；真机覆盖父级缩放/旋转假红/镜像/`SPRITE_NOT_FOUND`/`AMBIGUOUS_SPRITE`/纹理回收计数回落。
- **deferred Minor（进最终审查修复波）**：`test/sprite-assign.test.js` 的 R418① tripwire 把 `cs` 换 `csCode`（:279-280 两行）—— `csCode` 已算好，现在断言 raw 文件会被注释满足（复审者已实测：删真实条件后仍 PASS）。

## 任务 5 首轮与审查发现（探测报告 `docs/M4-PROBES.md`）

- 首轮 DONE_WITH_CONCERNS（commit `caf758f`，仅新增 `docs/M4-PROBES.md`，524/524 不变）。核心事实：**探测① clone 后引用不断**（4 条独立量 + `LoadAssetAtPath` 成功）；**探测② 覆盖幂等（guid 不变 + 内容真更新）与可见性判据成立**；**R416 实例 override 活过真重载**。
- **R420（Critical，两位审查者都指出）R416 的「落盘原文含 `propertyPath: m_Sprite`」在被引文件里 0 命中** → 实现者读错了行（那是**源节点自己**的 SpriteRenderer `m_Sprite:` 字段，不是 `m_Modifications` 条目），且探针场景已删 → 不可回补。**修**：① 该行证据降级为「真重载读回链」，把「落盘 `m_Modifications` 原文」标为**待重取**；② **重取**并真命中（`grep -n "propertyPath: m_Sprite"`）；若重取后**仍不命中** → R416 结论要翻，**停下报 BLOCKED**。
- **R421（Important，spec）报告里没有探针源码**（简报步骤 2 明写「报告里贴完整源码」）→ **修**：7 个 `.cs` + R416 的 `exec` 片段贴进报告**文末附录**。
- **R422（Important）`pixels` 的计数路径写错**：写在 `actual.count`，实为 **`actual.count.count`** → 任务 6/8 照抄会得到**恒假断言**。**修**：全文改正 + 写进「可见性判据模板」。
- **R423（Important）可见性判据不够硬**（源节点与实例同时在画面里时 `count>0` **无法归属**）+ 默认 `shot` 是 window 模式（实测 892×355）→ **修**：新增一节「**可见性判据模板（不可裁剪）**」：`play start` + `shot --capture-mode rendering` + 读 `actual.count.count` + **挪开实例/关掉源节点** + **负对照** + `pixelsPerUnit = 图高/(2×orthographicSize)`；明写「源节点与实例重合时的 `count>0` 不构成证据」。
- **R424（Important）R416 的否定结论证据等级 + 任务 6 验收缺口**（任务 6 全在同一会话里读回，无真重载）→ **修**：① 报告写明证据等级是「两次独立 `node inspect` + 真切换」；② **控制者改计划任务 6**：加一条「实例改 sprite → `scene save` → 切走 → 切回 → 再 inspect 仍指向新资产」。
- **R425（Important）`--force` 语义边界只给现象、没给规则** → **修**：改成规则（未 override 的属性跟随；已 override 的保持；**根 `localPosition` 恒被记为 override → 永不跟随**），证据直接用已有的 `probeB2-ProbeScene.scene.copy`（`PfOldInst` 有 `m_LocalPosition`、无 `m_LocalScale`）。
- **R426（Important）A2 的机制断言超出证据**（「刪 `.meta` 后 guid 被确定性重建」——可能是 `Library` 的 path→guid 记忆）→ **修**：降级为「观察：同机 + `Library/` 已建立的前提下逐字节相同（重算 vs `Library` 记忆**未区分**）」；SKILL 口径改成**不依赖**它。
- **R427（Important）`prefab create --from-node` 收到「Prefab 实例」/「子节点」时行为未定义** → **修**：两条真机探测 + 写进结论表/未探测项（审查者已给配方），明确任务 6 该拒绝/换算还是声明不支持。
- **R428（Minor，本次顺手修）**：md5 落盘、②-4 拆两行 + 「scale 跟随 ⇒ `m_SourcePrefab` 连接未断」、`after` 侧 mtime、O6 改引 `probe-final-tree.json`、§①-2 引文截断。
- **R429（进任务 7）**：审查者给的 9 条「发现 → PITFALLS/SKILL 去处」清单（clone 可交付 + `.meta` 必同批 + `pixels` 计数路径与归属 + window 尺寸 + `scene save` 是 Save-As + `GameObject.Find` 不找非激活 + `--force` 是更新不是重建 + `SaveAsPrefabAsset` 不把源节点变成实例 + `InstantiatePrefab` 沿用资产位姿）。
- Task 5: fix round 1/5（R420 含**重取证据** + R421–R428）—— commit `9e8531b`（`docs/M4-PROBES.md` +534/−40，908 行）
  - **R420 重取命中**：新拷的 `r416-P2.after-save.scene:319` 有 `propertyPath: m_Sprite`（`objectReference guid=8cff5d88…` = 实例上换的 `r420b.png`），grep 退出码 0；旧副本 0 命中的原因查清（**拷在换 sprite 之前**，用 mtime 逐个对齐）。R416 结论**成立**，证据等级已改为「两次独立 `node inspect` + 中间真切场景」为主。
  - **R426 反转（重要）**：删掉克隆的 `Library/` **且**移出 `.meta` 后 gu id 从 `a7a041ff…` → **`fd04e092…`**，`node inspect` 的 `assetPath/ppu/worldSize` 均为 `null`（**引用真断**）；`.meta` 放回后逐字节回原值。→ 首版的「确定性重建」是 **`Library/SourceAssetDB` 的 path→guid 记忆**，不是重算；**「`.meta` 必须与资产同批提交」因此是硬结论**（收件人手里没有 `Library/`）。
  - **R427 两条契约黑洞**（→ 控制者裁定 R430 已写入计划任务 6）：① 源是 Prefab 实例 → `SaveAsPrefabAsset` 静默产出 **Variant**；② 源是子节点 → 根 `position` 取 **local**（`1,1`）而非世界（`6,4`）。
  - 定向复审：R420–R428 **逐条 ADDRESSED**（复审者实读了所有新证据：hit 行/两张图 guid/`count.count` 字段名/三条规则引文/`probeA2-nolib-*`/`r427-result.json`/附录 7 份源码与磁盘**逐字节一致**）。但新引入 **4 处「报告文字 vs 落盘原文」小错**（同一类缺陷）→ **裁定：延后到最终审查的修复波**（精确改法已记于下）。
- Task 5: complete (commits `52ed3fc`..`9e8531b`, 4 parked/deferred Minors) —— 仅新增 `docs/M4-PROBES.md`，`npm test` 524/524 不变
  - **deferred Minor（最终审查修复波，带精确改法）**：① `M4-PROBES.md:393` 规则② 的证据栏把 `m_LocalScale 2.1333334/2.4` 归给 `PfProbeInstance`（实为 **`PfInst1`**；`PfProbeInstance` 是 `2/2`）→ 改实例名或改值；② `:343` 标注「313–321 行」而引文块实为 **310–321**；③ O3 行仍写「`m_Sprite` 立刻出现在落盘 YAML 里」但未指向新证据（应加「落盘证据见 §②-6b 重取的那份」），且变更对照写「O3 → O8」而 O3 是**保留**；④ `probes/r425-pfoldinst-modifications.txt` 头注误导（它是**全场景 grep**，`PfOldInst` 只占 514/518/522 三行）。
- **R430（控制者裁定，已写入计划任务 6）**：`prefab create --from-node` —— 源是 **Prefab 实例** → 拒绝（`SOURCE_IS_PREFAB_INSTANCE`，退出码 1，不静默产出 Variant）；源是**子节点** → 允许 + USAGE 写明「根保留局部变换」+ 真机覆盖；同名歧义与 R71 同口径不修。
- Task 6: 待派（计划已打四块补丁：`count.count` / 可见性归属与负对照 / 真重载判据 / `--force` 三条规则 + R430）

## 任务 6 首轮：DONE_WITH_CONCERNS（`f6e0b51`，547/547，真机 8/8）

真机亮点：① `verified:true` 且读回逐字段一致；② 覆盖后 guid 不变 `09406617…` + 位置更新；③ `ASSET_EXISTS`/1”；④ 实例 `verified:true` + `sprite.assetPath` 命中；⑤ **rendering 960×640 `count.count` 18432 → 12288（负对照 delta 恰好 6144 = 96×64）**；⑥ 实例 `position` + **真 sprite override** 活过 `scene save` + 真切场景；⑦ `PARENT_NOT_FOUND` 且节点数不变；⑧ 无残留、`SampleScene` 逐字节未改。

疑虑 → 裁定（全部进修复轮 1/5）：
- **R431（简报与 mock 自相矛盾）**：step 4 写 `{...p2.parsed}` 而 step 1 的 mock 是 `{__read:…}`（与 asset-import.cs 同构）→ 实现者按「注意②」在 JS 侧解包 `__read`。**采纳**（这是 R387/R389 同一族错误的第三个实例：读回投影必须解包 `.cs` 的 `__read` envelope）。
- **R432（真机新发现：Prefab 根名 = 文件名）**：`SaveAsPrefabAsset` 把 Prefab **根节点的名字改成 `--to` 的文件名**（源节点名不变）→ 只要 basename ≠ 源节点名，`intent.prefab.name`（源节点名）与读回就不一致 → **每次合法调用都假红**（简报的示例 `Brick_0_0 → Brick.prefab` 正踩这条）。**裁定：把「名字」的 intent 改成 `path.basename(to, '.prefab')`**（那是 Unity 会写进去的名字），**不再拿源节点名去断言**；源节点的绑定靠 `position`/`scale`/`spriteAssetPath` 三项钉住。USAGE 写明「Prefab 根名 = `--to` 的文件名（Unity 语义，不是源节点名）」。真机补一条：源节点名 ≠ 文件名时也 `verified:true`、且读回的 `asset.name` == 文件名。
- **R433（`prefab instantiate` 不给 `--name` 时恒假红）**：`intent={}` → `verifyWrite` 的 F1/R117「顶层空 intent = 无约束 → `verified:false`」→ 而 USAGE 写「`--name` 可选」。**裁定：intent 恒为 `{name: name ?? path.basename(asset, '.prefab')}`**（实例默认名 = Prefab 根名 = 资产文件名，Unity 语义），这样既有非空约束、也不需把 `--name` 改成必填。测试同步（不给 `--name` 的用例断言 `intent.name === '<basename>'` 且 mock 的读回 `name` 同值）。
- **R434（次要，顺手修）**：`--parent Panel/` 尾随斜杠 → 现在落 `PARENT_NOT_FOUND`（与 `node create --parent` 的 R94 口径不一致）→ 在 JS 用法面归一（去掉尾随 `/` 与其后的空白），并补一条用例。
- **R435（deferred Minor，进 backlog）**：payload 类命令的 `.cs` **编译错**只落 `ULOOP_ERROR` 且无 Message（不透出 `CompilationErrors`）—— 就是 M3 的 **R352** 那个形状，但 R352 只在 `lib/dynamic.js`（`unity exec`）里认了形状，**没推广到 payload 调用**。→ 登记为 independent backlog 项（要改共享的 `lib/envelope.js`/`lib/scene.js` 路径，需单独走一轮简报+双审）；任务 7 的 PITFALLS 里给一句旁路诊断建议（用 `unity exec` 复现或看 Editor.log）。

## 任务 6 审查发现与裁定（2026-09-20）

- **spec-reviewer：❌**（1 阻塞：判据⑤⑥的真机证据**生成于修复轮之前** → 「用旧证据背书新代码」；+ 静态契约缺牙 B1、磁盘防线无负向用例 B2、R430 的 `NOT_CREATED` 附加主张缺档）。功能面 28 项逐条 ✅（11 个错误码、载荷形状、`__read` 解包、R430/R432/R433/R434、真机①–④⑦⑧ 均逐字段复核）。
- **code-reviewer：✅ 通过**（无 🔴；5 🟡 + 7 💡）。

裁定（全部进**修复轮 2/5**，除注明）：
- **R436（spec 阻塞）⑤⑥ 必须重跑**：修复轮改了 `lib/prefab.js` → 可见性（含负对照）/真重载的产物必须是 `task6fix2-*`。（审查者已逐路径分析旧证据不被推翻，但规则就是规则。）
- **R437（🟡 最重要：instantiate 的读回几乎没有证伪力）**：现在 intent 只有 `name`、extraCheck 只比路径末段 → 实测「读回对象在 `position(99,99)`、`sprite:null`」也 `verified:true`；`--parent` 报错路径/落错父级也 `verified:true`。**修**：实例化**前**先用 `prefab-create.cs` 的 read 模式读一次**资产**（拿到真实根名 `name` 与 `spriteAssetPath`），把 intent 扩成：
  · `--name` 给了 → `{name, path: parent ? `${parent}/${name}` : name}`（`path` 是 **JS 侧算出的期望路径**，不是拄 `.cs` 的自报）；
  · `--name` 未给 → **只放 `sprite.assetPath`**（仅当资产读回的 `spriteAssetPath` 是非空字符串；否则退回 `{name: <资产根名>}` 并**登记同父重名时 Unity 会加 `' (1)'` 的假红窗口**）；
  · 该 read 的 `PREFAB_NOT_FOUND` 要映到 instantiate 的同一码（不许出现 `prefab-create 返回错误`）。
  → **顺带解决 R438**：不再用 `basename(asset)` 猜根名（外部 Prefab 根名 ≠ 文件名 → 现在无 `--name` 会假红），而是**用资产读回的真实根名**；并订正 `lib/prefab.js:267` 与 `prefab-instantiate.cs:5` 里「根名未必等于文件名」与 R432 相矛盾的注释。
- **R438（🟡）见 R437 后半**（未 `--name` + 外来 Prefab 根名≠文件名 → 现在 exit 1）。
- **R439（🟡）`--to` 的路径归一**：`Assets//P/a.prefab` / `Assets/P/./a.prefab` 与 Unity 回的规范路径不一致 → 可能假红。**修**：在 `lib/assetpath.js` 的 `normalizeAssetTo` 里就折叠重复 `/`、去掉 `./` 段（`..` 仍拒；`asset write`/`asset import` 共用同一实现 → 三处一起受益；`test/assetpath.test.js`/`test/asset.test.js` 必须保持全绿，若有红就先停下报 BLOCKED）。**不许**改 `lib/readback.js` 容差。
- **R440（🟡）`.cs` 静态契约无牙**（`SOURCE_IS_PREFAB_INSTANCE`/`instancePath` 仅靠文件头注释即可满足）→ **修**：照 `test/sprite-assign.test.js` 的范式（`stripComments` + 转义归一）后断言 `"__error":"CODE"` 形态的码集合、`"__written":true`、`o["instancePath"]`、payload 键集合（create：`['fromNode','mode','path','to']`；instantiate：`['asset','name','parent']`）、`SetParent(parent.transform,\s*false)`、以及 `assert.doesNotMatch(code, /\?\?/)`。
- **R441（🟡）磁盘防线/协议守卫无负向用例** → **修**：7 条负向用例（`_stat` 抛 `EACCES` / `{size:0}` → `verified:false` 且 `mismatches` 含 `file.bytes`；读回缺 `__read` → `READBACK_FAILED`/1；`.cs` 静态断言 `DestroyImmediate(` 与 `PREFAB_SAVE_FAILED`）。
- **R442（💡）`--parent` 归一超集**（多剥尾随空白）→ **修**：与 R94 逐字对齐（只 `replace(/\/+$/,'')`）。
- **R443（💡）USAGE 措辞**：「不受父级位置/缩放污染」→ 改成「实例的**局部** position/scale 保持资产值（**世界**位置/尺寸随父级变换）」；退出码段按 create/instantiate 拆开，删掉 instantiate 列里不可达的 `NOT_FOUND`。
- **R444（💡）guid 双读零断言** → **修**：`extraCheck` 加一条 `actual.guid === actual.prefab.guid`（不等则记 `guid` 分歧）—— 让「覆盖不改 guid」这个卖点在工具内可证伪。
- **R445（💡）`file.bytes` 失败时 hint 指向内容不符** → **修**：mismatchHint 补一句（分歧键是 `file.bytes` 说明 Unity 侧内容对但**盘上**文件没读到/为空 → 核对 `--project-path`）。
- **R446（💡）`SOURCE_IS_PREFAB_INSTANCE` 的 hint 在 CLI 里不可执行**（让用户「断开连接」但无此命令）→ **修**：改成可执行路径（在编辑器里 Unpack，或用 `unity node create` 重建一个普通节点）。
- **R447（💡，文档）**报告 §⑤ 误写「`intent.prefab.asset` 来自 `GetAssetPath`」（实为 argv）→ **修**报告表述（代码比报告写得更好）。
- **R448（💡，延后）**空节点（默认 transform + 无 sprite）的投影几乎无内容（可选：把 `components` 纳入读回面）→ **defer**（要改 `.cs` + 真机；写路径确定，先记 backlog）。
- **R449（范围外，延后）**`prefab instantiate` 没有 `MISSING_PROJECT_PATH` 守卫（与 `node create`/`sprite *` 同款既有形态）→ **defer**（要统一处理，另开小任务）。
- **R450（驳回）**审查者说 `node-inspect.cs` 的 `sp["assetPath"] = cond ? null : path` 会**删键** → **驳回**：任务 4 的定向复审者已用真机证据核实过（三元表达式编译期为 `string` → 走 `implicit operator JToken(string)` → 写的是 **Null JValue**，键存在且为 `null`；证据 `task4-runtime-inspect.json` 的 `"assetPath": null, "ppu": 1`）。**不改代码**。
- Task 6: fix round 2/5（R436–R447）—— commit `2c26d9e`（560/560）
  - 真机重跑产物 `task6fix2-*`：可见性归属 `count.count` 12288→6144（delta 恰好 6144=96×64）+ 真重载逐字段相同 + 三条反例（`verified:false`）；R440 变异自检两组均红并已还原。
  - **R451（疑虑①→裁定：接受 + 文档 + backlog）**：测试里「同父重名 → Unity 加 `' (1)'`」的假设**真机不成立**（`InstantiatePrefab` + `SetParent(false)` 不改名，直接造出两个同名节点）→ 读回退化为「`GameObject.Find` 猜同名节点中的一个」（方向安全 = 假红，但砖块阵列这种可预期用法会撞上）。**裁定**：① USAGE/报告写明「同父下多个同名实例时读回只能定位到其中一个；要精确归属请用 `--name` 区分」；② 任务 8 的 E2E 里凡多实例必须用**不同 `--name`**；③ 登 backlog：「实例唯一定位（`GetInstanceID`/`siblingIndex`）」需要 `node-inspect` 加一种定位模式（超出 M4）。
  - **R452（疑虑②→裁定：接受，登记引擎事实）**：`LoadAssetAtPath` 面上「Prefab 根名 ≠ 文件名」**在团结上构造不出来**（文件内 `m_Name: Enemy` 也会被读成 `Enemy Variant`）→ 说明**团结会用文件名覆盖 Prefab 根名**（连文件内 `m_Name` 都不算数）。我们的实现改成**从资产读回取根名**（单测 mock 验证），比 `basename` 更稳。→ 这条引擎事实要进任务 7 的 PITFALLS。
  - **R453（疑虑③→裁定：采纳）**：R437 字面之外，用 `extraCheck` 加了「资产读回的局部 position/scale」校验 —— 没它「位置不同 → `verified:false`」就不成立（单测+真机反例都依赖它）。**保留**。
  - **R454（疑虑④→裁定：采纳）**：R442 逐字对齐 R94 后，`--parent 'Panel/ '`/`'  /  '` 不再落 `BAD_PARENT`（与 `nodeCreate` 行为一致），旧用例按裁定移除、换成「与 `nodeCreate` 逐个输入比对」的加强用例。
- Task 6: fix round 2 定向复审 → **所有发现已解决**（R436–R447 全 ADDRESSED；新增 5 条低危项：`' (1)'` 归因措辞、“`WRITE_FAILED` 未进 USAGE 枚举、新副作用留空目录、`stripComments` 不剥块注释、`isPrefabPath` 死导出 → **全部延后到最终波**）
- Task 6: complete (commits `931024b`..`2c26d9e`, 5 parked Minors) —— `npm test` **560/560**；真机 8 条判据 + 三条反例全过；spec ❌→修两轮→定向复审 clean

## 任务 7：文档回写（SKILL §3.6/§3.7 + PITFALLS U28–U45 + USAGE/README）

- Task 7: 首轮 `d4aadec`（561/561）→ spec ✅ 通过 / 文档可用性审查 **⚠️ 需补几句话**（2 条 **P0 阻断盲测**：SKILL 顶部命令清单无 M4 命令；§3.6 没把「证明看得见」接进链路；+ `prefab create --to` 父目录不存在会死路）。
- **R455（P0，真解）**：`prefab create` 现在在写调用**之前**自动 `mkdirSync(dirname(--to), {recursive:true})`（照 `asset import` 的 `_mkdirp` 缝）+ hint/USAGE 同步。真机反证：裸 `SaveAsPrefabAsset` → `ArgumentException: Given path does not exist`（审查者的假设**成立**）；修后 `Assets/M4Probe-new/deep/Hero.prefab` `verified:true`、两层目录都建出。
- **R456–R468**：P0/P1/P2 补句全部落地（命令清单 + 可见性指针 + `scene save` Save-As + 反证色取 `removeBg.keyColor` + 旋转警告 + `count==0` 三排除 + 命令口径约束 + 图集→`AMBIGUOUS_SPRITE` …）→ commit `49f8e7b`（563/563）。
- **R469（定向复审抓到的事实错误：我上一轮的指令本身错了）**：SKILL/U43 曾写「`Tight`/`Sliced`/`Tiled` → `--world-size` 预期 `verified:false`」——但写侧 `sp.bounds.size` 与读侧 `sr.bounds.size` 是**同一个量**（且 U34 实测 `Tight` 并不裁几何）→ **与实现相反**。已改成：「旋转（已实测）/ 非均匀缩放（部分实测）会破坏 AABB 口径；`Tight`/`Sliced`/`Tiled`/图集对这条判据的影响**未探测**；图集 → `AMBIGUOUS_SPRITE`（已实测硬失败）」。
- **R470–R474**：hint 自相矛盾、`WRITE_FAILED` 未进 USAGE 枚举、三步/四步措辞、`_mkdirp` 生产默认分支的单测、README 测试数 → commit `c089b1c`（564/564）；定向复审：**R469–R474 全 ADDRESSED**（静态复算确认 564），新增 1 条低危（hint 括号归因）→ 延后到最终波。
- Task 7: complete (commits `2c26d9e`..`c089b1c`, review clean) —— `npm test` **564/564**

## 任务 8：E2E 验收（四条判据 + 盲测 + 独立复核）—— **全过**

- **主验收（团结，S0Project）**：① 结构 ✅（`trimmed={10,8,12,8}`、sha256 独立重算一致、透明背景那条 8×6 且 `removeBg=null`、场景 YAML grep 到节点名与 32-hex guid）；② 画面 ✅（EditMode 2120；PlayMode rendering **7752** = 102×76 与公式逐像素吻合；用 `removeBg.keyColor` 反证 0）；③ 可动·持久 ✅（domain reload 后仍在；**负对照 delta=7752**；真重载逐字段相同；`build` 114,674,632 B + `player.log` 0 error）；④ 纪律 ✅（四次故意失败的码/退出码全对；清理干净）。**判据③⑤（clone）未复跑 → 降级登记，由任务 5 探测① 覆盖**。
- **盲测（官方版 `pi-unity-official-f3c1`，只读 SKILL 的全新子代理）**：✅ **成功**（三色各 2592 px = 108×72 三等分、绿底 0、负对照三色全归 0、交付 PNG tolerance 0 下 24/24 纯色）。
- **独立复核（第三方，只读产物）**：✅ **声称成立 5/5**（它自己重拍的图与盲测主证据 **sha256 逐字节相同**；自己跑负对照；额外查出 `Scene.isDirty=False`；确认 `git` 干净 / 图确由 fixture 派生 / 用户工程 0 新文件 / 只 1 个编辑器进程）。
- **R475（盲测坑 1，Important）并发调用 `unity` 必炸**：并行 `exec` → `SCRIPT_COMPILE_ERROR: Another execution is already in progress`；并行**只读** `scene tree` → `ULOOP_TRUNCATED`；**两个码都把人往错方向引**。→ **裁定**：① SKILL 铁律加「一次只发一条命令（含只读），不许并行」；② PITFALLS 新条目；③ hint 改进（指向「另一条命令正在执行，请串行重试」）**登记 backlog**（要改共享的 `lib/dynamic.js`/`lib/uloop.js` 路径）。
- **R476（引擎差异，收紧标注）**：`M4-SPIKE` 的「`.meta` guid = 56 字符 base64」**在官方版 2022.3.62f3c1 上不成立**（`.meta` 与 YAML 引用的 32-hex 是同一个字符串，复核者实读）→ **U30 的适用引擎收紧为「团结新导入资产实测；官方版实测为同一个 32-hex」**。
- **R477（新事实，进 PITFALLS）**：`AssetDatabase.AssetPathToGUID` 在 `DeleteAsset` 后（即使 `Refresh(ForceUpdate)`、`LoadAssetAtPath==null`、磁盘已 GONE）**仍返回过期 guid** → 用「guid 非空」当「资产还在/引用未断」会**假绿**（SKILL §3.7 的 clone 判据正好依赖它）→ PITFALLS 新条目 + SKILL §3.7 警告。
- **R478（盲测坑 2–8 → 回写 SKILL）**：透视相机 `pxPerUnit = (图高/2)/(tan(fov/2)×距离)`（盲测者自推、实测吻合到 1 px）；`texFormat=RGB24 ≠ alpha 丢了`；`--remove-bg` 的判定口径（max 通道差 + `(tol,2tol]` 羽化/de-spill）；`--world-size` 依赖 `import` 读回的 `art.output`（先后顺序）；`retriedFrom:"游戏"` 机器可读信号（官方-2）；window↔rendering 的 **19 px** chrome 偏移（复核者更正 21→19）；`scene save` 省略 `--path` = 原地保存。
- **交付物**：`docs/E2E-ACCEPTANCE-m4.md`（commit `cd52866`）—— 含四判据表、盲测记录、独立复核表、降级项、待回写清单。
## 任务 9：收尾（bump 0.7.0 + 账本 + `ff master` + tag）

- **本文件 `docs/M4-DECISIONS.md`**：由控制者把 SDD 账本原样固化进仓库（M1/M2/M3 同形态），头部加上「M4 已完成」摘要。
- **`package.json` 0.6.0 → 0.7.0**；`README.md`：测试数 **565**、PITFALLS 范围 **U1–U47**、命令表含 M4 三条。
- **`docs/HANDOFF.md` 刷到 M5 起手式**（基线/里程碑表/backlog/账本索引/“新会话第一句话”）。
- **`docs/E2E-ACCEPTANCE-m4.md` 的「给 M4 收尾的动作」改为「已落地」**（那 3 条已在最终修复波与任务 7 完成）。
- **搁置（parked）的 non-load-bearing Minor（带裁定，不再进循环）**：
  · ① `test/prefab.test.js` 的用例名仍写「mock 成 **Unity 的** `" (1)"` 形态」——与 F1 的订正口径（Unity **不会**改名）措辞相抵；它是 mock 场景描述、不影响断言 → **搁置**（裁定：纯文案，下次碰该文件时顺手改）。
  · ② `test/sprite-assign.test.js` 的 `stripComments` 只剥 `//`（`test/prefab.test.js` 已剥 `/* */`）→ **搁置**（当前 `sprite-assign.cs` 零个块注释，风险=0；具体化条件：一旦该 `.cs` 引入块注释就必须补）。
  · ③ `docs/PITFALLS.md` 的 U41 索引行「读写都以 `AssetPathToGUID`/资产读回为准」与 U47 有轻微张力 → **已在本轮补「存在性判定见 U47」消解**。
- **合并与 tag**：**先把全部文档做完并 commit**，再 `git checkout master && git merge --ff-only m4-art && git tag -a v0.7.0`（吸取 `v0.6.0` 早于 HANDOFF 提交而与文档脱节的教训）。
- Task 9: **complete** —— 本文件（`docs/M4-DECISIONS.md`）与 `docs/HANDOFF.md`、`README.md`（565/U1–U47）、`package.json`（**0.7.0**）同批提交；`[已落地]`。
