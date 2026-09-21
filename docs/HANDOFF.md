# pi-unity 接手文档 —— **新会话从这里开始**

> 生成于 **2026-09-20**（M4 收尾；先后 **批次 A / B-1 / B-2 / C-A / C-B / C-C / C-D / ⑨** 落地后刷新）。当前基线：`master` = **`v1.0.0`（backlog 归零；`git log -1` 看）**。**2026-09-21 补记**：`master` 前进了**一个纯文档提交**（本机环境清理记录，见 §5），故 `git describe` 会显示 `v1.0.0-1-g…` 而 `git diff v1.0.0` 为 **0 行**——**代码 / 测试 / 标签均未变**，本文所有 `v1.0.0` 均指代码基线（`v0.10.0` = 批次 B-2；`v0.9.0` = 批次 B-1；批次 A = `v0.8.0` 指向；C-A…⑨ 见 `git log`）；`npm test` **636/636 绿**。
> 目标：让一个**全新会话**读完本文就能继续开发，**不需要回看任何聊天记录**。

## 0. 给新会话的第一句话（可直接粘）

```
读 docs/HANDOFF.md（现状/纪律/backlog/账本索引）与 docs/M4-DECISIONS.md（M4 逐条裁决与延后项）。
当前基线：master = **v1.0.0**（backlog 归零；`git log -1` 看），`npm test` **636/636 绿**；backlog **全部关闭**（①②③④⑤⑥⑦⑧⑨⑪ + ⑩官方版半 + ⑫）；⑩ 真·国际版已论证非必要跳过。**不要重做 A / B-1 / B-2 / C-A / C-B / C-C / C-D / ⑨**。
然后从 §7 的 backlog 里挑一项，用 writing-plans 出计划
（docs/superpowers/plans/<日期>-pi-unity-<主题>.md）；
出计划后先做一次「起飞前冲突扫描」（照 docs/M3-DECISIONS.md 里 R201–R213 的做法：只读子代理通读计划 + 控制者逐条裁定），
再按 subagent-driven-development 逐任务执行（简报 → 实现 → spec+code 双审 → 修复循环 ≤5 轮 → 收尾时 ff master + 打 tag）。

工作树：C:/Users/<用户>/.pi/agent/git/<内部 git 服务器>/pi/pi-unity（master，**v1.0.0** + 2026-09-21 文档补记，backlog 归零，636/636 绿）
纪律底线：零第三方依赖；写后必读回；用法错只由 argv 决定；.cs 改动必须真机跑一次；
**一次只发一条 unity 命令（含只读）—— 并行调用（含只读）会落 `UNITY_SERVER_BUSY`（uloop 单飞）、并行 exec 会落 `SCRIPT_COMPILE_ERROR`，两个码都不指向真因**；
**不许碰用户真实工程 <真实工程>**。
```

## 1. 这个项目是什么（30 秒）

**pi-unity** = 让 Pi 端到端搭出**可交付** Unity / 团结引擎小游戏的标准 Pi 包。三块：

| 块 | 说明 |
|---|---|
| `bin/unity.js` + `lib/*.js` | **薄信封 CLI**：包在第三方 MIT CLI [uloop](https://github.com/hatayama/unity-cli-loop) 之上。**唯一自研价值 = 写后主动读回、比对 intent vs actual 给出 `verified`** |
| `skills/unity-game-dev/SKILL.md` | **主交付物**：命令面 + 打砖块配方（§3.5）+ **美术/Prefab 配方（§3.6）** + **交付与 `.meta`（§3.7）** + 验证配方（§8，含 §8⑥「判图真的在画面里」）+ 停止条件/迭代上限/常见错误表 |
| `docs/PITFALLS.md` | **坑位库**（**U1–U55** + 官方-1…官方-8），每条带**适用引擎**标注。这是本项目最值钱的资产 |

其余：`unity-scripts/*.cs`（uloop 载荷脚本：单 JSON 载荷 + `__error` 哨兵）· `test/`（621 条，零依赖 `node --test`）· `docs/`（账本 + 能力清单 + 探测报告 + 验收记录）。

**M4 新增的能力面**：`unity asset import`（宿主 PNG → 去底/裁边（Node 侧）→ 落库 → 11 项像素画导入设置 → 写后读回 + 磁盘 sha256）· `unity sprite assign`（把**资产** sprite 挂到节点 + `--world-size` 反算，过 PlayMode 不丢）· `unity prefab create|instantiate`（覆盖=更新（guid 不变）/ 实例化 + 真实根名读回）。

## 2. 现状（硬事实，别猜）

```
仓库/工作树   ~/.pi/agent/git/<内部 git 服务器>/pi/pi-unity   （另有 -m1/-m2/-m4 三个 linked worktree，留作审计）
分支          master = **v1.0.0 + 1 个纯文档补记提交**（2026-09-21；backlog 归零，代码/测试与 `v1.0.0` 逐字节一致）（全部批次直接提交在 master，未开分支）
版本/标签     v0.3.0 exec · v0.4.0 scene save/open · v0.5.0 build · v0.6.0 官方版验证 · v0.7.0 M4（美术管线 + 资产导入 + Prefab）· v0.8.0 M5 批次 A（并发单飞/编译错报文可读/pixels diff·质心·bbox/退出码与布尔开关口径统一）· **v0.9.0 M5 批次 B-1（`node inspect --sibling-index` 实例唯一定位 / `prefab create` 读回面含 `components`）** · **v0.10.0 M5 批次 B-2（backlog ④ 官方半：`--world-size` 在 `Tight`/`Sliced`/`Tiled` 下的结论 + UI `Image` 假绿修正；图集半延后）** · **v1.0.0 backlog 归零（C-A 官方版复测 / C-B `prefab apply|revert` / C-C 图集半 + `/unity-*` 扩展 / C-D Input System 真机注入 / ⑨ 用户真实团结工程 doctor 5/5 + scene tree）**
测试          npm test → 636/636（Node ≥21；package.json 的 engines 与 test 脚本有注释解释原因）
行尾          .gitattributes 已加（* text=auto eol=lf）→ 工作树形态不再依赖 core.autocrlf
```

## 3. 已经做完的（一行一个里程碑 + 账本位置）

| 里程碑 | 内容 | 账本 |
|---|---|---|
| **M1** | 信封层 + `doctor`/`--smoke` + `scene tree`/`node inspect`/`create`/`set` | `docs/M1-DECISIONS.md` |
| **M2** | 13 个任务：`node delete` / `pixels` / `sprite set` / `shot` / `play` / `asset write` / `compile` / `doctor --golden` / **skill 完整版 + 打砖块模板** / **E2E 盲测（四判据全过）** | `docs/M2-DECISIONS.md` · `docs/E2E-ACCEPTANCE-m2.md` |
| **M3 三刀** | `unity exec` · `unity scene save`/`open` · `unity build`（构建+产物读回） | `docs/M3-DECISIONS.md` |
| **Q2 验证** | **Unity 官方版兼容性 = 成立（有条件）**（两个官方中国版构建、21 工具全可用、报文逐字一致、build 出包可跑） | `docs/UNITY-OFFICIAL-VERIFICATION.md` · `docs/CAPABILITIES-unity-2022.3.62f3c1.md` |
| **M4** | `lib/art.js`（色键去底/四角推断/裁边/最近邻 contain-fit）+ PNG 编码器 · **`unity asset import`**（+ 静默缩放防线、sha256 磁盘线）· **`unity sprite assign`**（资产绑定 + 世界尺寸 + 多子 sprite/亚容差/镜像等防线）· **`unity prefab create\|instantiate`**（读回投影 + 期望路径 + 资产根名 + `--force` 三条规则）· **两个未知的真机探测**（clone 后引用不断；Prefab 覆盖幂等 + 可见性判据模板）· SKILL §3.6/§3.7 + PITFALLS U28–U47 · **E2E 四判据全过 + 官方版盲测 + 第三方复核 5/5** | `docs/M4-DECISIONS.md` · `docs/M4-PROBES.md` · `docs/E2E-ACCEPTANCE-m4.md` |
| **M5（批次 A）** | backlog **①②⑦⑪**：并发被拒不再误判编译错 + 串行重试 hint（`UNITY_SERVER_BUSY` / uloop 单飞）· 编译错报文可读（信封层中央识别，覆盖全部 payload 命令）· `unity pixels --diff` / `--centroid` / `--bbox` · `--flag=1` 归一 + `MISSING_PROJECT_PATH` 归 2 档 | `docs/M5-PROBES.md` · `docs/M4-DECISIONS.md` R435（`:240`）/ R475（`:290`） · `docs/superpowers/plans/2026-09-20-pi-unity-backlog-a.md` |
| **M5（批次 B-1）** | backlog **⑤⑥**：`unity node inspect --sibling-index` 实例唯一定位（真实 `GetSiblingIndex` + `matchCount`/`instanceId` 读回，**R480** 关闭 U42）· `unity prefab create` 读回面纳入 `components`（空节点投影不再恒真，**R448** 关闭） | `docs/PITFALLS.md` U50/U51 · `docs/superpowers/plans/2026-09-20-pi-unity-backlog-b1.md` · `docs/m5-probes-raw/`（`b1*`） |
| **M5（批次 B-2）** | backlog **④ 官方半**：`--world-size` 在 `Tight`/`Sliced`/`Tiled` 下的真机结论（`Tight` 同 FullRect；`Sliced`/`Tiled` 分叉落 `verified:false`）· UI `Image` 假绿修正（**R481/R482**） | `docs/PITFALLS.md` U52/U53 · `docs/M5-PROBES.md` §9 · `docs/superpowers/plans/2026-09-20-pi-unity-backlog-b2.md` · `docs/m5-probes-raw/`（`b2*`） |
| **M5（批次 C-A = ⑩-b 官方版复测）** | backlog **⑩-b**：U28/U31–U33/U36/U39–U41 用官方 2022.3.62f3c1 复测 → PITFALLS 订正（U28/U32/U40/U41 判「家族共有」+ U31/U33 默认值订正 + U36 官方差异）+ 新坑 **U54**（场景未存时 `--force` 重置实例）；**⑩-a 国际版 → 跳过** | `docs/PITFALLS.md` U28/U31–U33/U36/U39–U41/U54 · `docs/M5-PROBES.md` §10 · `docs/superpowers/plans/2026-09-20-pi-unity-backlog-ca.md` · `docs/m5-probes-raw/`（`ca-*`） |
| **M5（批次 C-B = ③）** | backlog **③**：`unity prefab apply`/`revert`（写后读回：实例投影 vs 资产投影，**排除根 `localPosition`**；revert 另判 `hasOverrides==false`）· 新坑 **U55** | `docs/PITFALLS.md` U55 · `docs/M5-PROBES.md` §11 · `docs/superpowers/plans/2026-09-20-pi-unity-backlog-cb.md` · `docs/m5-probes-raw/`（`cb-*`/`cb3-*`） |
| **M5（批次 C-C = ④图集半 + ⑫）** | backlog **④图集半**：图集打包**不改** `Sprite.bounds`/`assetPath` → `--world-size` 仍 `verified:true`、**无需装包**、`Multiple` 仍 `AMBIGUOUS_SPRITE`；backlog **⑫**：`/unity-doctor` `/unity-tree` 扩展（零依赖，薄封装 CLI） | `docs/PITFALLS.md` U43 订正 · `docs/M5-PROBES.md` §12 · `docs/m5-probes-raw/`（`cc-*`） · `pi-extension/index.ts` |
| **M5（批次 C-D = ⑧）** | backlog **⑧**：装 `com.unity.inputsystem` 1.8.2 + `activeInputHandler:2` 后，`play key`/`play mouse` 真实注入真机可用（`wKey.isPressed` true→false） | `docs/PITFALLS.md` U25 补充 · `docs/M5-PROBES.md` §13 · `docs/m5-probes-raw/`（`cd-*`） |
| **⑨ 用户真实工程验证** | **✅ 已完成（2026-09-21，用户授权选项 2）**：临时装 uloop → `unity doctor` **5/5 pass** + `unity scene tree` **ok**（团结 2022.3.62t9，工程 `<真实工程>`，`ThirdPartyUI` 22 节点）→ 已还原 manifest | `docs/m5-probes-raw/ce-REPORT.md` §5 |

## 4. M4 留下的三条最有价值的结论（跨里程碑复用）

1. **交付规则**：美术资产必须与**引用它的场景/Prefab 一起、且带 `.meta`** 提交/打包 —— 全新 clone（无 `Library/`）时引用**不断**（32-hex guid、场景字面量、`node inspect` 的 sprite 全不变）；但**丢了 `.meta` 且没有 `Library/`** 时 guid 会变、**引用真断**（`assetPath:null`）。
2. **「画面里看得见」的判据模板**（`docs/M4-PROBES.md` 的「可见性判据模板（不可裁剪）」）：`play start` + `shot --capture-mode rendering` + 读 **`actual.count.count`**（不是 `actual.count`）+ **挪开/关掉让被测对象成为唯一变量** + **负对照**（计数应恰好少掉它那一块）+ 几何对账（正交：`pxPerUnit = 图高/(2×orthographicSize)`；**透视**：`pxPerUnit = (图高/2)/(tan(fov/2)×距离)`）。
3. **Prefab 语义**：`--force` 是**更新不是重建**（guid 不变、引用不断；未被 override 的属性跟随、已 override 的保持、**根 `localPosition` 恒被记为 override → 永不跟随**）；`SaveAsPrefabAsset` 用**文件名**覆盖 Prefab 根名；**实例上的 override 会随 `scene save` 落盘**（前提：验收必须包含一次**真重载**，同一会话里的读回不算）。

## 5. 环境与凭据（新会话直接用，别再摸索）

```bash
export PI_UNITY_ULOOP_BIN="C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe"   # 必须每条命令都带（新进程不继承）
# 团结引擎（主编译器）：<引擎安装目录>/2022.3.62t9/Editor/Tuanjie.exe
# uloop 包 vendor（file: 引用用）：C:/Users/<用户>/pi-unity-spike/vendor/uloopmcp
# Unity 官方版（已装 + 已激活）：C:/Program Files/Unity/Hub/Editor/2022.3.62f3c1/Editor/Unity.exe
#                                C:/Program Files/Unity/Hub/Editor/2022.3.62f1/Editor/Unity.exe（f1c1，中国构建）
# 许可证：C:/ProgramData/Unity/Unity_lic.ulf
# 测试项目：S0Project   = C:/Users/<用户>/pi-unity-spike/S0Project（可写坏）
#           blind      = C:/Users/<用户>/pi-unity-m2-blind（M2 盲测项目）
#           CloneProbe = C:/Users/<用户>/pi-unity-spike/CloneProbe（M4 探测①的「无 Library」克隆）
#           official   = C:/Users/<用户>/pi-unity-official-f3c1（官方版；M4 盲测现场，里面有 Hero 节点与 Assets/Art/hero-blind.png）
```

**硬约束**：
- **团结与官方版都是单座席**（同一时刻只能一个编辑器实例）→ 跑任何 Unity/团结进程前先 `tasklist | grep -iE "^Tuanjie.exe|^Unity.exe"`；切换引擎要**先关再开**（`taskkill //IM Tuanjie.exe //F`）。
- **一次只发一条 `unity` 命令（含只读）**：并行 `exec` → `SCRIPT_COMPILE_ERROR: Another execution is already in progress`；并行调用（**含只读**）→ `UNITY_SERVER_BUSY`（**uloop 单飞（single-flight）**；批次 A 已补串行重试 hint）。两个码都不指向真因，见 PITFALLS **U46** / **U49**。
- **绝不碰**用户真实工程 `<真实工程>`（M4 复核者用 `find -newermt` 确认过没碰）。
- 本网络**拿不到 Unity 国际版**（`download.unity3d.com` 全部 302 到中国 CDN）；官方版安装器是 **NSIS**（`/S /D=<路径>`）。
- `uloop launch` **起不了团结**（U6）→ 手动 `cmd //c start "" "<Tuanjie.exe>" -projectPath <P>`；首次编译 44 asmdef 约 1–3 分钟。

### 5.1 本机环境变更（2026-09-21 清理，释放 ~7.18 GB）

- **已清理（可再生 / 零引用）**：
  - **Unity 可再生缓存** `Library/` + `Temp/`：`S0Project`（1962M）、`CloneProbe`（1875M）、`pi-unity-m2-blind`（2122M）、`pi-unity-official-f1`（86M）、`pi-unity-official-f3c1`（136M）—— **这些项目下次在编辑器里打开会重新导入（首次编译 44 asmdef 约 1–3 分钟）**；`Assets/` + `ProjectSettings/` + `Packages/` **均未动**（`official-f3c1` 的 `Assets/Art/hero-blind.png` 已复核仍在）。
  - **零引用构建产物**：`pi-unity-spike/` 的 `m3-build-out`、`m3-build-out-r367`、`m3-build-out-r367-verify`、`m4-e2e-build`，以及 `pi-unity-official-f1-buildout`、`pi-unity-official-f3c1-buildout`、`pi-unity-clone2`、`pi-unity-m2-blind-extract`（即 `E2E-ACCEPTANCE-m2.md` 里那个解包临时目录）。**账本里对这些路径的引用是历史陈述，勿再当现存路径使用。**
  - `.superpowers/` 只删了 `sdd/2026-09-19-pi-unity-m3-exec/tmp/UnityHubSetup.exe`（127M，当初下载的 Unity Hub 安装包）；**审计留档本体保留**（132M → 5.0M），`E2E-ACCEPTANCE-m2/m4`、`M1-DECISIONS`、`CAPABILITIES-*` 的引用**仍然有效**。
- **刻意保留（删了会坏功能）**：`pi-unity-spike/uloop-bin/uloop.exe`（上面的 `PI_UNITY_ULOOP_BIN` 指向它）、`pi-unity-spike/vendor/uloopmcp`、各项目的 `Assets`/`ProjectSettings`/`Packages`、`m2-shots` / `m4probe-shots` / `pi-unity-blind-artifacts`（验收证据）。
- **本机遗留（与项目无关，需人工执行一次）**：`E:\GitHub\<仓库名>` 下**两个空目录**——内容已删净，只剩空壳，因当时 pi 会话的 cwd 就在其中（Windows 不允许删进程的 cwd）→ 退出 pi 后跑 `rmdir /s /q E:\GitHub\<仓库名>`。

## 6. 纪律与已踩过的坑（务必遵守）

**信封与退出码**
- 零第三方依赖（只用 `node:*` 与 `node --test`）；不 fork uloop。
- **`verified` 语义不许扩张**：只有「写后读回比对 intent vs actual」才置 `true/false`；无 intent 的读/执行命令恒 `null`。
- **退出码单点**：`lib/envelope.js` 的 `exitCodeFor` 是唯一判定处（`2` 用法错 / `1` 运行时或验证失败 / `0` 成功且 `verified!==false`）；**用法错只由 argv 决定**、在任何写盘/调用之前收敛。
- `USAGE_FAILURE_CODES` 是**冻结数组**（判成员用 `isUsageFailure`）；新增用法错码要同时改它 + `test/envelope.test.js` 的**排序后全等**断言。
- **防假绿三道线**：① `ULOOP_TRUNCATED` 绝不产 `ok:true`；② 磁盘硬证据（`asset import` 的 sha256、`prefab create` 的 `file.bytes`、`scene save` 的 mtime 前进、`build` 的产物 stat）；③ **读回投影必须与 intent 同形**（`.cs` 的 `__read` 要解包；`intent` 是对象而 actual 不是 → 一条永久分歧）。

**真机**
- ⭐ **凡改动/新增 `.cs` 分支，必须真机跑一次**（R367：struct `== null` 静态测试全绿、真机 CS0019 整条命令挂掉）。**静态契约测试测不出编译错误**。
- ⭐ **一次只发一条命令**（U46 / U49：并行调用（含只读）→ `UNITY_SERVER_BUSY`，uloop 单飞）；**`AssetPathToGUID` 在 `DeleteAsset` 后仍返回过期 guid**（U47）→ 判「资产还在」要用 `LoadAssetAtPath<T>(path) == null`。
- 新增 `docs/PITFALLS.md` 条目**只追加到文件末尾、编号由文档任务统一**，且**必须标适用引擎**（只在团结测过的**不许**写「两者」）。
- 真机验证不得污染：临时节点/资产要删并读回确认；**不要**对用户的验收场景用 `scene save --path`（那是 **Save-As**；省略 `--path` 才是把所有打开的场景各自**原地**保存）。
- 截图/坐标：默认 `shot` 是 **window 模式**（图尺寸由 Game 窗口决定，实测 892×355 / 906×440）；要做几何对账就用 `--capture-mode rendering`（需 PlayMode）；两张图不能跨模式复用坐标（内容上方 chrome 差 **19 px**）。

**流程（血泪）**
- ⭐ **控制者不要手改实现/测试代码**（R372）：交给实现者 + 双审。
- ⭐ **不要把 `npm test` 串在 `&&` 链中间、后面还跟一个总是成功的 `grep`**（失败会被吞掉）。
- **`.cs` 静态契约要有牙**：断言**剥注释后**的源码（`stripComments` + 剥 `/* */`），否则注释即可满足（R418②/R440）。
- **测试数据（mock）要与现实同形**：M4 有一族 bug 都是「mock 自相矛盾 → 让生产代码去迁就 mock」（R387/R389/R431）。
- 测试里不要用 `.` + `$` 匹配行尾（CRLF 陷阱）；`.gitattributes` 已把行尾定为 LF。

## 7. 剩余 backlog（按建议优先级）

| 项 | 状态 / 代价 |
|---|---|
| **① 并发调用的 hint 改进**（R475 的第三半）：把 `SCRIPT_COMPILE_ERROR: Another execution is already in progress` 与并发下的 `UNITY_SERVER_BUSY` 指向「另一条命令正在执行，请串行重试」 | **✅ 已完成（批次 A，2026-09-20；`49c5222`）**：并发被拒不再误判为编译错；`UNITY_SERVER_BUSY` 登记进 `RETRYABLE_CODES` 并追加串行重试 hint（真机验收见 `docs/M5-PROBES.md` §8①）。**U46 已由真机探针订正**：并行只读的真实码是 `UNITY_SERVER_BUSY`，不是 `ULOOP_TRUNCATED` |
| **② payload 类命令的 `.cs` 编译错报文不可读**（R435）：只落 `ULOOP_ERROR` 无 Message、不透出 `CompilationErrors`（R352 只在 `unity exec` 里认了形状） | **✅ 已完成（批次 A；`921c3b0`）**：`scriptCompileFailure` 在信封层中央识别，覆盖全部 payload 命令；报文含 `文件:行 CS 码`，写路径不再误加「写入是否生效未知」hint（真机验收见 `docs/M5-PROBES.md` §8②） |
| ③ `unity prefab apply`/`revert`（D-M4-3 砍掉的） | **✅ 已完成（批次 C-B，2026-09-20）**：`unity prefab apply --path <实例根>`（把实例覆盖写回资产）/ `unity prefab revert --path <实例根>`（丢弃实例覆盖）；写后读回 = **实例投影 vs 资产投影**（排除根 `localPosition`），revert 另判 `hasOverrides==false`；真机验收 `verified:true`，非实例/非实例根→`NOT_PREFAB_INSTANCE`（退出码 1）；新坑 **U55** —— 见 `docs/m5-probes-raw/cb-REPORT.md` / `cb3-*` |
| ④ 手工导入的图集/`Tight`/`Sliced`/`Tiled` 下 `--world-size` 的行为 | **✅ 已完成（批次 B-2 官方半 + 批次 C-C 图集半，2026-09-20/21）**：`Tight` 与 FullRect 全同（`verified:true`）、`Sliced`/`Tiled` 分叉如实落 `verified:false`（**U52**）、UI `Image` 假绿已修（**U53**/R481）；**图集半已闭环**：图集打包不改 `Sprite.bounds`/`assetPath` → `--world-size` 仍 `verified:true`，**无需装包**，`Multiple` 仍 `AMBIGUOUS_SPRITE`（`docs/m5-probes-raw/cc-*`） |
| ⑤ 「实例唯一定位」：同父多同名实例时 `node inspect` 只能命中一个 → 给 `node-inspect` 加一种定位模式（`GetInstanceID`/`siblingIndex`） | **✅ 已完成（批次 B-1，2026-09-20；`01b0b70`）**：`node inspect --sibling-index <真实子序号>`（= `scene tree` 的 `siblingIndex` 字段值）+ `matchCount`/`instanceId` 读回 + 越界 `SIBLING_INDEX_OUT_OF_RANGE`/`available`（D-B2 纯 additive，`--name` 用法不破）。正式关闭 **U42**（已加订正注记），见 **U50** |
| ⑥ 空节点（默认 transform + 无 sprite）的 Prefab 投影几乎无内容 → 把 `components` 纳入读回面 | **✅ 已完成（批次 B-1；`08861fc`）**：`prefab create` 读回面（`prefab-create.cs` read 模式 + `nodeProjection`）纳入 `components`，空节点投影 `["Transform"]` 不再恒真（**R448** 关闭），见 **U51** |
| ⑦ `unity pixels --diff` / 质心 / bbox（`exec` 已能部分替代） | **✅ 已完成（批次 A；`19c2d2b`）**：`--diff` / `--centroid` / `--bbox`，差分/质心/包围盒不再需要带外工具（真机验收见 `docs/M5-PROBES.md` §8③） |
| ⑧ Input System 项目的**真实输入注入**验证 | **✅ 已完成（批次 C-D，2026-09-21）**：装上 `com.unity.inputsystem` 1.8.2 + `activeInputHandler:2` 后，`play key`（`Keyboard.current.wKey.isPressed` true→false）/ `play mouse`（scroll 注入被接受）真机可用 —— 见 `docs/m5-probes-raw/cd-REPORT.md` |
| ⑨ **只读**验证用户真实大工程（`doctor` + `scene tree`） | **✅ 已完成（2026-09-21；用户授权选项 2：临时装 uloop → 读只读 → 还原 manifest）**：`unity doctor` **5/5 pass**（团结 2022.3.62t9；build-targets = Android/微信小游戏/Windows）、`unity scene tree` **ok**（`ThirdPartyUI`、22 节点）；验完已还原（依赖 42、无 uloop）—— 见 `docs/m5-probes-raw/ce-REPORT.md` §5 |
| ⑩ 真·Unity 国际版验证 · 官方版复测 U28/U31–U34/U36–U45 | **✅ 官方版复测完成（批次 C-A，2026-09-20）**：U28/U31–U33/U36/U39–U41 已用官方 2022.3.62f3c1 升级为实测（U34 由批次 B-2 已做），新增坑 **U54**；**⏸ 真·国际版验证 → 跳过**（Q2 已由官方中国版回答，项目未承诺「与国际版逐字节一致」；本网络 `download.unity3d.com` 302 到中国 CDN 不可得）—— 见 `docs/m5-probes-raw/ca-REPORT.md` |
| ⑪ `--flag=1` 静默 no-op（全项目既有约定）与 `MISSING_PROJECT_PATH` 归 1 档 → 统一口径 | **✅ 已完成（批次 A；`b5064b4` + `5fc3776`）**：`--flag=1/0/true/false/yes/no` 归一（非法值报 `BAD_FLAG_VALUE`，退出码 2）；`MISSING_PROJECT_PATH` 归 **2 档**，USAGE 图例同步 |
| ⑫ M5（可选）：`/unity-*` 扩展命令 | **✅ 已完成（批次 C-C，2026-09-21）**：`pi-extension/index.ts` 提供 `/unity-doctor` / `/unity-tree`（薄封装：`pi.exec` 调 CLI，零第三方依赖），`package.json` 声明 `pi.extensions`；用法见 README |

## 8. 账本索引（每条裁决的查询入口）

| 想查什么 | 去哪 |
|---|---|
| 某个里程碑的逐条裁决（含「如果错了的代价」）、延后 Minor、修复轮次 | `docs/M1-DECISIONS.md` · `docs/M2-DECISIONS.md` · `docs/M3-DECISIONS.md` · **`docs/M4-DECISIONS.md`** |
| M2 / M4 的 E2E 协议与四条判据的真实记录（含盲测与独立复核） | `docs/E2E-ACCEPTANCE-m2.md` · **`docs/E2E-ACCEPTANCE-m4.md`** |
| M4 的真机事实基础（导入层 spike / 两个未知探测 / 可见性判据模板 / `--force` 规则） | `docs/M4-SPIKE.md` · **`docs/M4-PROBES.md`** |
| M5（批次 A）的真机事实基础（并发 P1–P6 探针 / U46 订正 / 批次 A 真机验收） | **`docs/M5-PROBES.md`** · `docs/m5-probes-raw/` |
| M5（批次 B-1）的真机事实基础（实例定位三轮复验原始 JSON / Prefab `components` 反向验证） | `docs/superpowers/plans/2026-09-20-pi-unity-backlog-b1.md` · `docs/m5-probes-raw/`（`b1`/`b1r1`/`b1r2`/`b1r3`/`b1t2-` 前缀） |
| M5（批次 B-2）的真机事实基础（drawMode/Tight 下 `--world-size` / UI Image 假绿 / 清理） | `docs/M5-PROBES.md` §9 · `docs/superpowers/plans/2026-09-20-pi-unity-backlog-b2.md` · `docs/m5-probes-raw/`（`b2`/`b2t1-`/`b2t2-` 前缀） |
| M5（批次 C-A）的真机事实基础（官方版复测 U28–U41 + 新坑 U54） | `docs/m5-probes-raw/ca-REPORT.md` · `docs/m5-probes-raw/`（`ca-*`） · `docs/superpowers/plans/2026-09-20-pi-unity-backlog-ca.md` |
| M5（批次 C-B）的真机事实基础（`prefab apply`/`revert` 值语义 + 新坑 U55） | `docs/m5-probes-raw/cb-REPORT.md` · `docs/m5-probes-raw/`（`cb-*`/`cb3-*`） · `docs/superpowers/plans/2026-09-20-pi-unity-backlog-cb.md` |
| M5（批次 C-C）的真机事实基础（图集打包下 `--world-size` / `Multiple` / ⑫ 扩展形态） | `docs/m5-probes-raw/cc-REPORT.md` · `docs/m5-probes-raw/`（`cc-*`） |
| M5（批次 C-D）的真机事实基础（Input System 真实注入） | `docs/m5-probes-raw/cd-REPORT.md` · `docs/m5-probes-raw/`（`cd-*`） |
| ⑨ 用户真实大工程的**静态只读 + 实测**（doctor 5/5 + scene tree） | `docs/m5-probes-raw/ce-REPORT.md`（§5 实测）· `ce-10-doctor.json` · `ce-11-tree.json` |
| Unity 官方版验证清单（已填实测）与 Q2 结论 | `docs/UNITY-OFFICIAL-VERIFICATION.md` |
| 各引擎的实测能力面 | `docs/CAPABILITIES-tuanjie-2022.3.62t9.md` · `docs/CAPABILITIES-unity-2022.3.62f3c1.md` |
| 坑位库（含适用引擎标注） | `docs/PITFALLS.md`（**U1–U55** + 官方-1…官方-8） |
| 审计留档（任务简报/报告/审查 diff/真机日志/探测原始 JSON/盲测证据） | `.superpowers/sdd/2026-09-20-pi-unity-m4-exec/` 与 `.superpowers/sdd/2026-09-20-pi-unity-m4-implementation/`（**被 gitignore**，可删） |
