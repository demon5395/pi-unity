# pi-unity M4 实现计划 —— 美术管线（`lib/art.js`）+ 资产导入 + Prefab 工作流

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让「**用户供图 → 自动去底/裁边/规范化 → 导入 Unity（正确的像素画设置）→ 绑定到场景/Prefab → 截图里真的看得见**」这条链在团结与 Unity 官方版上都能一条命令走完，且每一步都有**写后读回**的证据。

**架构：**
- **Node 侧**（引擎无关，零依赖）：`lib/png.js` 补零依赖 **PNG 编码器**；`lib/art.js` 移植 pi-cocos 的**纯函数**美术管线（色键去底/裁边/contain-fit），新增「四角推断背景色」与最近邻缩放。像素处理**全部在 Node 侧**完成（M4-SPIKE 实证：Unity 没有去底 API，`alphaIsTransparency` 还会改写透明像素 RGB）。
- **Unity 侧**：新增三个命令 —— `unity asset import`（把宿主 PNG 落进 `Assets/` + 显式配置 `TextureImporter` 11 项 + 写后读回全部设置）、`unity sprite assign`（把**资产** sprite 挂到节点，`--world-size` 按 PPU 反算缩放）、`unity prefab create|instantiate`（`PrefabUtility`）。
- **纪律不变**：`ok:true` 只代表「代码执行了」；`verified` 只在**写后读回比对通过**时为 `true`；防假绿是最高优先级。

**技术栈：** Node ≥21（零第三方依赖，只用 `node:*` 与 `node --test`）· C# 载荷脚本经 uloop `execute-dynamic-code` 执行 · Unity / 团结 2022.3.62。

**规格：** `docs/M4-SPIKE.md`（M4 的事实基础，真机 spike）· `docs/HANDOFF.md` §4（M4 起手式与建议命令面）· `docs/superpowers/specs/2026-09-18-pi-unity-design.md` 的 **D4** 与 §4/§5 · `skills/unity-game-dev/SKILL.md` §3.5。执行者**两份都要读**（计划 + 规格），冲突时以规格与真机证据为准，并**停下上报**。

---

## 全局约束

> 每条隐含包含在**每个任务**里。数值与措辞逐字来自 `docs/HANDOFF.md` §6 与 `docs/M3-DECISIONS.md`，不得改写。

1. **零第三方依赖**：只用 `node:*`；不 fork uloop；`package.json` 的 `dependencies` 必须保持 `{}`。
2. **`verified` 语义不许扩张**：只有「写后读回比对 intent vs actual」才置 `true/false`；无 intent 的读/执行命令恒 `null`。
3. **退出码单点**：`lib/envelope.js` 的 `exitCodeFor` 是唯一判定处（`2` 用法错 / `1` 运行时或验证失败 / `0` 成功且 `verified !== false`）；**handler 不得手写 `e.ok ? 0 : 1`**。
4. **用法错只由 argv 决定**（R237）：参数形状/取值非法必须在**任何写盘、任何 uloop 调用之前**收敛。**凡结论依赖于文件内容/图片内容/编辑器状态的一律不是用法错**（退出码 1）。
5. **新增用法错码必须同时改两处**：`lib/envelope.js` 的 `USAGE_FAILURE_CODES`（冻结数组，判成员走 `isUsageFailure`，不得 `.has()`）与 `test/envelope.test.js` 的成员断言。
6. **防假绿**：`ULOOP_TRUNCATED` 绝不产 `ok:true`；report 说成功但磁盘没产物 → `ARTIFACT_MISSING` + `verified:false`。
7. **⚠️ 凡新增/改动 `.cs` 分支，必须真机跑一次**（R367：`BuildSummary` 是 struct，`== null` 静态测试全绿、真机 CS0019 整条命令挂掉）。静态契约测试**测不出编译错误**。
8. **单座席**：本机团结/官方版同一时刻只能一个编辑器实例。跑任何 Unity/团结进程前先 `tasklist | grep -iE "^Tuanjie.exe|^Unity.exe"` 门检（两处拼写都要查：`Tuanjie.exe` 与 `Unity.exe`）。
9. **绝不碰**用户真实工程 `<真实工程>`。
10. **控制者不要手改 JS**（R372）；`npm test` **不许**串在 `&&` 链中间、后面还跟一个总是成功的 `grep`（失败会被吞掉）。
11. **`docs/PITFALLS.md` 只追加到文件末尾、不写 U 编号**（编号由任务 7 统一分配），且**必须标适用引擎**。
12. **测试基线 456**（`npm test` → `# tests 456 / # pass 456 / # fail 0`）；M4 只增不减。测试里不要用 `.`+`$` 匹配行尾（CRLF 陷阱，`.gitattributes` 已把行尾定为 LF）。
13. **每个写命令必须真机走一次**，并留下可复核的原始 JSON（真机日志进 `.superpowers/sdd/2026-09-20-pi-unity-m4-exec/`，该目录被 gitignore）。
14. **工作树**：`C:/Users/<用户>/.pi/agent/git/<内部 git 服务器>/pi/pi-unity-m4`（分支 **`m4-art`**，从 `master = 66e20f2` 起）。
15. **环境变量每条命令都要带**（新进程不继承）：`export PI_UNITY_ULOOP_BIN="C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe"`。
16. **提交粒度**：每个任务内部的「步骤」按小步提交（见各任务的 Commit 步骤）；任务内的提交不追求可发布，**任务完成时该任务必须整体自洽**（测试全绿）。

### 真机与凭据（照 `docs/HANDOFF.md` §5）

```bash
export PI_UNITY_ULOOP_BIN="C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe"
# 团结主编译器：<引擎安装目录>/2022.3.62t9/Editor/Tuanjie.exe
# 团结测试项目：S0Project = C:/Users/<用户>/pi-unity-spike/S0Project（可写坏）
# Unity 官方版（已装 + 已激活）：C:/Program Files/Unity/Hub/Editor/2022.3.62f3c1/Editor/Unity.exe
# 官方版验证项目：C:/Users/<用户>/pi-unity-official-f3c1（`.unity` 扩展名！）
# 许可证：C:/ProgramData/Unity/Unity_lic.ulf
# uloop launch 起不了团结（U6）→ 手动：cmd //c start "" "<Tuanjie.exe>" -projectPath <P>
```

### M4 的四个已裁决设计选择（用户 2026-09-20 批准，逐条不得翻案）

| 编号 | 裁决 | 理由（如果错了的代价） |
|---|---|---|
| **D-M4-1** | 绑定用**新命令** `unity sprite assign`，不往 `sprite set` 里塞 `--asset` | 真实资产引用才能熬过 PlayMode 的 domain reload（`sprite set` 造的运行时 1×1 sprite 会丢）；`sprite set` 的 M2 语义已被 265 行测试冻结，不动它。代价：多一个命令 + `node-inspect.cs` 的 sprite 读回面要 additive 扩展 |
| **D-M4-2** | 美术规范化**不做独立命令**，折进 `unity asset import --remove-bg/--trim/--fit` | YAGNI：一条命令走完「供图 → 规范化 → 落库 → 设置 → 读回」；纯函数仍在 `lib/art.js` 单测覆盖。代价：「只规范化不导入」暂时没有直接命令（进 backlog） |
| **D-M4-3** | Prefab **只做 `create` + `instantiate`**，`apply`/`revert` 进 backlog | `apply` 的读回面（证明 prefab **资产**真的被改）成本高，M4 验收不需要它。代价：改 Prefab 只能重建 |
| **D-M4-4** | `--remove-bg auto` 四角推断不一致 → **运行时码 `BACKGROUND_AMBIGUOUS`（exit 1）**，不是用法错 | 结论依赖**图片内容**，不依赖 argv → 一旦算用法错就违反约束 4（R237）。代价：agent 要按 hint 显式给 `--remove-bg '#RRGGBB'` 重试一次 |

---

## 文件结构（先锁定分解决策）

| 文件 | 动作 | 职责 |
|---|---|---|
| `lib/png.js` | 修改 | **纯编解码器**：现有 `decodePng` + 新增 `encodePng`（+ 私有 `crc32`/`chunk`）。不放进任何像素运算 |
| `lib/art.js` | **创建** | **纯像素管线**（无 IO、无 env）：`parseColor`/`colorDistance`/`keyOutPixels`/`trimBounds`/`fitSize`（移植 pi-cocos）+ `inferBackground`/`cropImage`/`resizeNearest`/`containFit`/`normalizeArt`。入出参一律 `{width,height,data}`（与 `decodePng` 同形） |
| `lib/assetpath.js` | **创建** | `--to` 的**唯一**校验实现（`Assets/` 前缀、禁 `..`、`MISSING_TO` vs `BAD_TARGET_PATH` 的 R274 边界），被 `asset write` 与 `asset import` 共用（消除逐字重复，R366② 的同族问题） |
| `lib/asset.js` | 修改 | 把 `--to` 校验换成 `lib/assetpath.js`（行为逐字不变——既有 401 行测试是判据）；`assetWrite` 其余不动 |
| `lib/importart.js` | **创建** | `unity asset import`：argv 用法面 → 读源图 → `lib/art.js` 规范化 → 落盘（sha256 读回）→ `.cs` 写模式 → `.cs` 读模式读回比对 → 信封 |
| `lib/sprite.js` | 修改 | 新增 `spriteAssign`（资产 sprite 绑定）；`spriteSet` 一行不动 |
| `lib/prefab.js` | **创建** | `unity prefab create` / `unity prefab instantiate`（两个导出函数 + 共用的路径/存在性校验 + **prefab 资产的读回投影**） |
| `bin/unity.js` | 修改 | 三个新命令的 dispatch + USAGE（命令清单/选项/退出码/hint 文案）+ 示例 |
| `unity-scripts/asset-import.cs` | **创建** | `ImportAsset` + `TextureImporter` 11 项 + `TextureImporterSettings` 往返 + `SaveAndReimport`；read 模式返回全部读回面 |
| `unity-scripts/sprite-assign.cs` | **创建** | `AssetDatabase.LoadAssetAtPath<Sprite>` → `SpriteRenderer.sprite` + `--world-size` 反算 `localScale` |
| `unity-scripts/node-inspect.cs` | 修改 | sprite 读回面 **additive** 扩展：`assetPath` / `ppu` / `worldSize`（既有字段一个不改） |
| `unity-scripts/prefab-create.cs` | **创建** | `PrefabUtility.SaveAsPrefabAsset`（write）+ 资产投影（read 模式） |
| `unity-scripts/prefab-instantiate.cs` | **创建** | `PrefabUtility.InstantiatePrefab` + 可选 `SetParent`/改名 + 返回实例路径 |
| `test/png.test.js` | 修改 | 追加编码器用例（往返、CRC 已知值、结构、抛错面） |
| `test/art.test.js` | **创建** | 移植 pi-cocos 的纯函数用例 + 新增（四角推断/最近邻/containFit/规范化端到端） |
| `test/assetpath.test.js` | **创建** | `--to` 校验的边界（含 R274「空串 ≠ 缺参」） |
| `test/importart.test.js` | **创建** | 用法错零调用、载荷形状、读回一致/不一致、sha256 磁盘防线、maxTextureSize 抬升、`BACKGROUND_AMBIGUOUS` |
| `test/sprite-assign.test.js` | **创建** | `spriteAssign` 的用法错、intent 形状、读回一致/不一致、世界尺寸反算 |
| `test/prefab.test.js` | **创建** | `prefab create`/`instantiate` 的用法错、投影比对、父级不存在、`--force` |
| `scripts/make-m4-fixture.js` | **创建** | 生成 E2E 用的「用户供图」PNG（绿底 + 三色图形，24×16、四周留边），零依赖、用 `lib/png.js` 的编码器 |
| `skills/unity-game-dev/SKILL.md` | 修改 | 新 §3.6 美术配方；修 §3.5 的尺寸口径；§5 停止条件；§7 错误码表；§8 验证配方加「画面里有这张图」 |
| `docs/PITFALLS.md` | 修改 | NEW-1…NEW-7 编号为 **U28–U34**（`U35` = 我们对 PNG 支持面的自有限制）+ 适用引擎标注 |
| `docs/M4-PROBES.md` | **创建** | 两个未知的真机探测报告（任务 5 交付物） |
| `docs/E2E-ACCEPTANCE-m4.md` | **创建** | 任务 8 的四条判据 + 盲测记录 |
| `docs/M4-DECISIONS.md` | **创建** | 任务 9：M4 账本（照 M1/M2/M3 形态） |
| `README.md` · `docs/HANDOFF.md` | 修改 | 命令清单/测试数/节数小尾巴；HANDOFF 基线订正（任务 9） |

**明确不做（YAGNI，进 backlog）**：`unity art normalize` 独立命令（D-M4-2）· `unity prefab apply`/`revert`（D-M4-3）· `unity pixels --diff`/质心 · `Multiple`/`Polygon`/sprite sheet/预写 `.meta` · Input System 真实注入 · 国际版验证。

---

## 任务总览（依赖顺序，逐任务执行）

| # | 任务 | 交付物 | 真机必需 | 依赖 |
|---|---|---|---|---|
| 1 | PNG 编码器 | `lib/png.js` 的 `encodePng` + 测试 | 否（无 `.cs`） | — |
| 2 | 美术纯函数管线 | `lib/art.js` + `test/art.test.js` | 否 | 1 |
| 3 | `unity asset import` | `lib/importart.js` + `lib/assetpath.js` + `.cs` + 测试 + 真机 | **是** | 1,2 |
| 4 | `unity sprite assign` + node-inspect 扩展 | `lib/sprite.js` + `.cs` + 测试 + 真机 | **是** | 3 |
| 5 | 两个未知的真机探测 | `docs/M4-PROBES.md` | **是** | 4 |
| 6 | `unity prefab create\|instantiate` | `lib/prefab.js` + `.cs` + 测试 + 真机 | **是** | 5 |
| 7 | 文档回写（SKILL/USAGE/PITFALLS 编号） | SKILL/USAGE/PITFALLS 更新 | 否 | 6 |
| 8 | E2E 验收（四条判据 + 独立盲测） | `docs/E2E-ACCEPTANCE-m4.md` | **是** | 7 |
| 9 | 收尾：bump 0.7.0 + 账本 + `ff master` + tag | `docs/M4-DECISIONS.md` + `v0.7.0` | 否 | 8 |

> **任务 0（控制者，不入审查）**：`m4-art` 分支 + `pi-unity-m4` worktree 已建好（`git worktree add ../pi-unity-m4 -b m4-art master`，HEAD `66e20f2`，`npm test` 456/456 绿）。
> **`v0.6.0` tag 不前移**：它指向 `056bcc0`，其后只有一次 `docs/HANDOFF.md` 提交；tag 标注发布点，不追文档提交 —— 订正写进 HANDOFF §2（任务 9）。

---

### 任务 1：零依赖 PNG 编码器（`lib/png.js`）

**文件：**
- 修改：`lib/png.js`（在 `decodePng` 之后新增编码器；`module.exports` 追加 `encodePng`）
- 测试：`test/png.test.js`（追加，不改既有用例）

- [ ] **步骤 1：编写失败的测试**

追加到 `test/png.test.js` 末尾（**顶部已有** `const { decodePng, pixelAt, averageColor, countColor } = require('../lib/png.js');` —— 把它改成同时引入 `encodePng`）：

```js
// --- 编码器（M4 任务 1）---

test('encodePng：decodePng(encodePng(x)) 逐字节往返一致', () => {
  const { encodePng } = require('../lib/png.js');
  const width = 5; const height = 3;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = (i * 37) & 255;
    data[i * 4 + 1] = (i * 91) & 255;
    data[i * 4 + 2] = (i * 53) & 255;
    data[i * 4 + 3] = (i * 17) & 255;
  }
  const png = encodePng({ width, height, data });
  const back = decodePng(png);
  assert.strictEqual(back.width, width);
  assert.strictEqual(back.height, height);
  assert.deepStrictEqual([...back.data], [...data]);
});

test('encodePng：CRC32 命中已知值（独立判据，不是自证）', () => {
  const { encodePng, crc32 } = require('../lib/png.js');
  // 标准校验值：CRC-32/ISO-HDLC("123456789") = 0xCBF43926
  assert.strictEqual(crc32(Buffer.from('123456789', 'latin1')), 0xCBF43926);
  const png = encodePng({ width: 1, height: 1, data: Buffer.from([1, 2, 3, 4]) });
  // 空 IEND chunk 的 CRC 是 PNG 规范里的常量 0xAE426082（最后 12 字节 = len(0)+"IEND"+crc）
  assert.strictEqual(png.readUInt32BE(png.length - 4), 0xAE426082);
});

test('encodePng：结构合法 —— 8 字节签名 + IHDR + IDAT + IEND，且 IDAT 可被 zlib 解出原扫描线', () => {
  const { encodePng } = require('../lib/png.js');
  const zlib = require('node:zlib');
  const width = 3; const height = 2;
  const data = Buffer.from([
    10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255,
    11, 21, 31, 255, 41, 51, 61, 255, 71, 81, 91, 255,
  ]);
  const png = encodePng({ width, height, data });
  assert.strictEqual(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
  // IHDR：宽 3 / 高 2 / bitDepth 8 / colorType 6（RGBA）/ 压缩 0 / 滤镜 0 / 隔行 0
  assert.strictEqual(png.readUInt32BE(16), 3);
  assert.strictEqual(png.readUInt32BE(20), 2);
  assert.deepStrictEqual([...png.slice(24, 29)], [8, 6, 0, 0, 0]);
  // 只找 IDAT（本编码器恒用滤镜 0，故扫描线 = 1 字节 0 + 每行像素）
  let off = 8; let idat = null;
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.slice(off + 4, off + 8).toString('latin1');
    if (type === 'IDAT') idat = png.slice(off + 8, off + 8 + len);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(idat);
  assert.strictEqual(raw.length, height * (1 + width * 4));
  assert.strictEqual(raw[0], 0);                     // 第 0 行的滤镜字节
  assert.strictEqual(raw[1 + width * 4], 0);         // 第 1 行的滤镜字节
  assert.deepStrictEqual([...raw.slice(1, 1 + width * 4)], [...data.slice(0, width * 4)]);
  assert.deepStrictEqual([...raw.slice(2 + width * 4)], [...data.slice(width * 4)]);
});

test('encodePng：非法输入响亮抛错（不猜、不截断）', () => {
  const { encodePng } = require('../lib/png.js');
  const d = Buffer.alloc(16);
  assert.throws(() => encodePng({ width: 2, height: 2, data: Buffer.alloc(15) }), /data 长度/);
  assert.throws(() => encodePng({ width: 0, height: 2, data: Buffer.alloc(0) }), /尺寸/);
  assert.throws(() => encodePng({ width: 2.5, height: 2, data: Buffer.alloc(20) }), /尺寸/);
  assert.throws(() => encodePng({ width: 2, height: 2, data: 'not a buffer' }), /data/);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/png.test.js`
预期：FAIL —— `TypeError: encodePng is not a function`（4 条新用例全红，既有用例仍绿）

- [ ] **步骤 3：编写最少实现代码**

在 `lib/png.js` 的 `decodePng` 之后、`pixelAt` 之前插入：

```js
/**
 * CRC-32（PNG 用的 ISO-HDLC）：表驱动会多 4 KB 常量，这里用**位运算**版 ——
 * 每次编码只跑几 KB，性能无关紧要；已知校验值 CRC32("123456789") = 0xCBF43926（测试钉住）。
 */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 拼一个 PNG chunk：长度（4B BE）+ 类型 + 数据 + CRC（覆盖「类型 + 数据」）。 */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([len, typed, crc]);
}

/**
 * 把 RGBA8 像素编码成 PNG（colorType 6 / bitDepth 8 / 无隔行 / **恒用滤镜 0**）。
 *
 * 为什么恒用滤镜 0：**确定性**优先 —— 同一份像素永远产出同一串字节，于是
 * 「磁盘上的 sha256 == 我写进去的 sha256」这条假绿防线才可复核；压缩率对小图无意义。
 * 为什么零依赖：`node:zlib` 已经提供 deflate（本项目的纪律：只用 `node:*`）。
 *
 * @param {{width: number, height: number, data: Buffer|Uint8Array}} img RGBA8，长度必须是 width*height*4
 * @returns {Buffer} PNG 字节
 * @throws {Error} 尺寸非正整数、data 长度不符、data 非 Buffer/Uint8Array —— 一律响亮抛（不猜）
 */
function encodePng(img) {
  const { width, height, data } = img || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`不支持的尺寸：${width}x${height}（宽高必须是正整数）`);
  }
  const isBytes = Buffer.isBuffer(data) || data instanceof Uint8Array;
  if (!isBytes) throw new Error('data 必须是 Buffer/Uint8Array（RGBA8 像素）');
  if (data.length !== width * height * 4) {
    throw new Error(`data 长度不符：${data.length} != ${width * height * 4}（应为 width*height*4）`);
  }
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                                  // 滤镜 0 = None
    buf.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bitDepth
  ihdr[9] = 6;    // colorType 6 = RGBA
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
```

并把 `module.exports` 改成：

```js
module.exports = { decodePng, encodePng, crc32, pixelAt, averageColor, countColor };
```

（`crc32` 导出**只为**让测试用独立已知值钉住它，不是给业务用的。）

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/png.test.js`
预期：PASS（既有 11 条 + 新 4 条全绿）

- [ ] **步骤 5：全量测试 + 提交**

```bash
node bin/unity.js version
npm test 2>&1 | tail -8      # 必须 # tests 460 / # pass 460 / # fail 0
git add lib/png.js test/png.test.js
git commit -m "feat(png): 零依赖 PNG 编码器 encodePng（滤镜 0 / CRC32 已知值钉住）"
```

---
### 任务 2：美术纯函数管线（`lib/art.js`）

> **任务 2 实现偏离（R384，控制者裁定 —— 本节的代码块已过时，以仓库里的实际实现为准）**：本节计划稿里「实现」与「测试」自相矛盾 4 处，实现者按 TDD 优先级（**测试 = 验收 gate**）只改实现：
> ① warning 阈值 `0.02` → 具名常量 `MIN_KEY_HIT_FRACTION = 0.1`（本节的 warning 测试用例命中率是 6.25%）；
> ② 测试 10 的 `px[0]+px[2]` 算术上永远凑不出 `[255,255,510,510]` → 改成 `px[2]+px[3]`（b+a）；
> ③ `containFit` 居中 `Math.floor` → `Math.round`（测试 11 要求落下半行）；
> ④ `output` 改成「**最终画布尺寸**」（只 trim、不 fit 时也要报，测试 12 断言它）。
> 其余逐字照本节实现。逐条理由与代价见账本 `R384①–④`。

**文件：**
- 创建：`lib/art.js`
- 测试：`test/art.test.js`
- 可参考（**移植源，只读**）：`~/.pi/agent/git/<内部 git 服务器>/pi/pi-cocos/editor-extension/art/pipeline.js` 与其测试 `test/art-pipeline.test.js`

> **移植决定（写进报告）**：只移植 `parseColor` / `colorDistance` / `keyOutPixels` / `trimBounds` / `fitSize` 五个纯函数
> （语义已被 pi-cocos 的 63 行测试钉住）；**不移植** `resolveBackground`（item/style/manifest 三层继承是 pi-cocos 的
> manifest 概念，本仓库没有 → YAGNI）与 `process.js`（它绑死 sharp；我们用自写编码器 + 纯 Buffer）。

- [ ] **步骤 1：编写失败的测试**

创建 `test/art.test.js`：

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const art = require('../lib/art.js');
const { decodePng, encodePng } = require('../lib/png.js');

/** px(x,y) -> [r,g,b,a]，构造 RGBA8 Buffer（与 lib/png.js 的 data 同形）。 */
function rgba(w, h, px) {
  const d = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = px(x, y);
      const o = (y * w + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3];
    }
  }
  return { width: w, height: h, data: d };
}
const px = (img, x, y) => {
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
};

// --- 移植自 pi-cocos editor-extension/art/pipeline.js 的用例（语义逐字保留）---

test('parseColor 支持 #RRGGBB 与 #RGB，非法输入抛错', () => {
  assert.deepStrictEqual(art.parseColor('#FF00FF'), { r: 255, g: 0, b: 255 });
  assert.deepStrictEqual(art.parseColor('#0f0'), { r: 0, g: 255, b: 0 });
  assert.throws(() => art.parseColor('nope'), /invalid color/);
});

test('colorDistance 取最大通道差', () => {
  assert.strictEqual(art.colorDistance(255, 0, 255, { r: 255, g: 0, b: 255 }), 0);
  assert.strictEqual(art.colorDistance(255, 10, 255, { r: 255, g: 0, b: 255 }), 10);
});

test('keyOutPixels 把 key 色像素变透明并统计 nearFraction', () => {
  const img = rgba(2, 1, (x) => (x === 0 ? [0, 255, 0, 255] : [255, 0, 0, 255]));
  const res = art.keyOutPixels(img.data, 2, 1, { key: { r: 0, g: 255, b: 0 }, tolerance: 20 });
  assert.strictEqual(img.data[3], 0);
  assert.strictEqual(img.data[7], 255);
  assert.strictEqual(res.nearFraction, 0.5);
});

test('keyOutPixels 羽化带削弱 alpha 并 de-spill 主导通道', () => {
  const img = rgba(1, 1, () => [60, 200, 0, 200]);
  const res = art.keyOutPixels(img.data, 1, 1, { key: { r: 0, g: 255, b: 0 }, tolerance: 40 });
  assert.ok(img.data[3] < 200 && img.data[3] > 0, `alpha 应在 (0,200) 之间，实际 ${img.data[3]}`);
  assert.ok(img.data[1] <= 60, `de-spill 后绿通道应 <= 60，实际 ${img.data[1]}`);
  assert.strictEqual(res.changed, true);
});

test('trimBounds 取 alpha>threshold 的包围盒；全透明返回 null', () => {
  const img = rgba(4, 4, (x, y) => (x >= 1 && x <= 2 && y === 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
  assert.deepStrictEqual(art.trimBounds(img.data, 4, 4, 0), { left: 1, top: 2, right: 2, bottom: 2, width: 2, height: 1 });
  assert.strictEqual(art.trimBounds(Buffer.alloc(4 * 4 * 4), 4, 4, 0), null);
});

test('fitSize 保持比例做 contain-fit；target 任一为 0 则原样', () => {
  assert.deepStrictEqual(art.fitSize(24, 16, 8, 8), { width: 8, height: 5 });
  assert.deepStrictEqual(art.fitSize(24, 16, 0, 8), { width: 24, height: 16 });
});

// --- M4 新增：四角推断背景色 ---

test('inferBackground：四角一致 → 返回该颜色（整数）', () => {
  const img = rgba(4, 4, (x, y) => {
    const corner = (x === 0 || x === 3) && (y === 0 || y === 3);
    return corner ? [0, 255, 0, 255] : [200, 10, 10, 255];
  });
  assert.deepStrictEqual(art.inferBackground(img, { tolerance: 8 }).color, { r: 0, g: 255, b: 0 });
});

test('inferBackground：四角不一致 → 抛 BACKGROUND_AMBIGUOUS（运行时错，不是用法错）', () => {
  const img = rgba(4, 4, (x, y) => {
    if (x === 0 && y === 0) return [0, 255, 0, 255];
    if (x === 3 && y === 0) return [255, 0, 0, 255];
    return [0, 0, 0, 255];
  });
  let err = null;
  try { art.inferBackground(img, { tolerance: 8 }); } catch (e) { err = e; }
  assert.ok(err, '必须抛');
  assert.strictEqual(err.code, 'BACKGROUND_AMBIGUOUS');
  assert.ok(Array.isArray(err.detail.corners) && err.detail.corners.length === 4);
});

// --- M4 新增：裁剪 / 最近邻缩放 / contain-fit ---

test('cropImage 取子矩形（左上原点，右/下边界不含）', () => {
  const img = rgba(3, 2, (x, y) => [x * 10, y * 10, 0, 255]);
  const out = art.cropImage(img, { left: 1, top: 0, width: 2, height: 2 });
  assert.strictEqual(out.width, 2);
  assert.strictEqual(out.height, 2);
  assert.deepStrictEqual(px(out, 0, 0), [10, 0, 0, 255]);
  assert.deepStrictEqual(px(out, 1, 1), [20, 10, 0, 255]);
});

test('resizeNearest 是最近邻（整数放大小块不插值），且 2x2 → 4x4 每个像素复制 2x2', () => {
  const img = rgba(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
  const out = art.resizeNearest(img, 4, 1);
  assert.deepStrictEqual([0, 1, 2, 3].map((x) => px(out, x, 0)[0] + px(out, x, 0)[2]), [255, 255, 510, 510]);
});

test('containFit：输出画布恰好是目标尺寸，图按比例居中，空白处全透明', () => {
  const img = rgba(2, 1, () => [255, 0, 0, 255]);
  const out = art.containFit(img, 2, 2);          // 2x1 → 放进 2x2 → 上下各留 0.5 行
  assert.strictEqual(out.width, 2);
  assert.strictEqual(out.height, 2);
  assert.deepStrictEqual(px(out, 0, 0), [0, 0, 0, 0]);
  assert.deepStrictEqual(px(out, 0, 1), [255, 0, 0, 255]);
});

// --- M4 新增：端到端规范化 ---

test('normalizeArt：绿底 + 居中红块 → 去底 + 裁边后只剩红块（含警告面）', () => {
  const img = rgba(6, 4, (x, y) => {
    const inner = x >= 2 && x <= 3 && y >= 1 && y <= 2;
    return inner ? [255, 0, 0, 255] : [0, 255, 0, 255];
  });
  const r = art.normalizeArt(img, { removeBg: 'auto', tolerance: 20, trim: true, fit: null });
  assert.strictEqual(r.img.width, 2);
  assert.strictEqual(r.img.height, 2);
  assert.deepStrictEqual(px(r.img, 0, 0), [255, 0, 0, 255]);
  assert.deepStrictEqual(r.art.removeBg.keyColor, '#00FF00');
  assert.deepStrictEqual(r.art.trimmed, { left: 2, top: 1, right: 3, bottom: 2, width: 2, height: 2 });
  assert.strictEqual(r.art.output.width, 2);
  assert.strictEqual(r.art.warning, null);
});

test('normalizeArt：去底后命中率 <10% → 给出 warning（不失败），并如实报 nearFraction', () => {
  // 只有 1/16 像素是 key 色（背景其实是蓝的）→ 明显「背景不是纯色」的信号
  const img = rgba(4, 4, (x, y) => (x === 0 && y === 0 ? [0, 255, 0, 255] : [0, 0, 255, 255]));
  const r = art.normalizeArt(img, { removeBg: '#00FF00', tolerance: 20, trim: false, fit: null });
  // 文案是「只有 6.3% 的像素命中背景色 #00FF00 …」（1/16 = 6.25% → toFixed(1) = 6.3）
  assert.ok(r.art.warning, '必须有 warning');
  assert.match(r.art.warning, /6\.3%/, r.art.warning);
  assert.strictEqual(r.art.removeBg.nearFraction, 1 / 16);
});

test('normalizeArt：去底后全透明 → 抛 ART_FULLY_TRANSPARENT（带 hint 素材）', () => {
  const img = rgba(2, 2, () => [0, 255, 0, 255]);
  let err = null;
  try { art.normalizeArt(img, { removeBg: 'auto', tolerance: 20, trim: true, fit: null }); } catch (e) { err = e; }
  assert.ok(err);
  assert.strictEqual(err.code, 'ART_FULLY_TRANSPARENT');
});

test('normalizeArt：--fit 走 contain-fit，输出画布 = 目标尺寸', () => {
  const img = rgba(4, 2, () => [255, 0, 0, 255]);
  const r = art.normalizeArt(img, { removeBg: undefined, tolerance: 40, trim: false, fit: { width: 2, height: 2 } });
  assert.strictEqual(r.img.width, 2);
  assert.strictEqual(r.img.height, 2);
  assert.strictEqual(r.art.output.width, 2);
});

test('normalizeArt：不传 removeBg/trim/fit → 原图原样（只做一次 decode→encode 的字节级往返）', () => {
  const img = rgba(3, 1, (x) => [x, x, x, 255]);
  const r = art.normalizeArt(img, { tolerance: 40, trim: false, fit: null });
  assert.deepStrictEqual([...r.img.data], [...img.data]);
  assert.strictEqual(r.art.removeBg, null);
  assert.strictEqual(r.art.trimmed, null);
});

test('normalizeArt 的输出能被 lib/png.js 编码 → 解码后逐字节一致（跨模块闭环）', () => {
  const img = rgba(4, 4, (x, y) => (x < 2 ? [0, 255, 0, 255] : [12, 34, 56, 255]));
  const r = art.normalizeArt(img, { removeBg: '#00FF00', tolerance: 10, trim: true, fit: { width: 4, height: 4 } });
  const back = decodePng(encodePng(r.img));
  assert.deepStrictEqual([...back.data], [...r.img.data]);
});

test('inferBackground / normalizeArt 的 tolerance 非法 → TypeError（不静默）', () => {
  const img = rgba(2, 2, () => [0, 255, 0, 255]);
  assert.throws(() => art.inferBackground(img, { tolerance: NaN }), TypeError);
  assert.throws(() => art.normalizeArt(img, { tolerance: -1 }), TypeError);
  assert.throws(() => art.normalizeArt(img, { tolerance: 1.5 }), TypeError);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/art.test.js`
预期：FAIL —— `Cannot find module '../lib/art.js'`

- [ ] **步骤 3：编写最少实现代码**

创建 `lib/art.js`：

```js
'use strict';

/**
 * 美术管线的**纯函数**层：色键去底 / 四角推断背景 / 裁透明边 / 最近邻缩放 / contain-fit。
 *
 * 只操作 `{width, height, data}`（RGBA8，与 `lib/png.js` 的 `decodePng` 同形），
 * **不做 IO、不读 env、不碰 Unity**。移植自 pi-cocos 的
 * `editor-extension/art/pipeline.js`（保留其函数语义与测试口径）。
 *
 * 为什么像素处理必须在 Node 侧（M4-SPIKE 实证）：Unity **没有去底 API**
 * （`alphaSource=None` 是丢弃 alpha；`alphaIsTransparency=true` 会**改写透明像素的 RGB**），
 * 也没有裁边旋钮（`Tight` mesh 在 66% 透明边界上不裁几何）→ Unity 侧只做声明式导入设置。
 */

/** 构造带 code 的运行时错误（调用方据此落信封；**不是**用法错）。 */
function artError(code, message, detail) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  return err;
}

/** tolerance 必须是 0–255 的整数（NaN/负数/小数都直接抛 —— 一个字符不能关掉整道闸门）。 */
function assertTolerance(tolerance) {
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255) {
    throw new TypeError(`tolerance 必须是 0–255 的整数，收到 ${String(tolerance)}`);
  }
}

/** 检查图像形状（纯函数层的入口守卫；畸形输入响亮抛，不静默返回空图）。 */
function assertImage(img) {
  const { width, height, data } = img || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError(`图像尺寸非法：${width}x${height}`);
  }
  const isBytes = Buffer.isBuffer(data) || data instanceof Uint8Array;
  if (!isBytes || data.length !== width * height * 4) {
    throw new TypeError(`图像 data 非法：应为 width*height*4 字节的 RGBA8`);
  }
}

// "#RRGGBB" / "#RGB" -> { r, g, b }
function parseColor(hex) {
  let s = String(hex || '').replace(/^#/, '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-fA-F]{6}$/.test(s)) {
    throw new Error(`invalid color: ${hex} (expected #RRGGBB or #RGB)`);
  }
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
}

/** 最大通道差（0–255）：可预测、易测。 */
function colorDistance(r, g, b, key) {
  return Math.max(Math.abs(r - key.r), Math.max(Math.abs(g - key.g), Math.abs(b - key.b)));
}

/**
 * 原地去底：`d <= tol` → alpha 0；`tol < d <= 2tol` → 羽化 + de-spill 主导通道。
 * 返回 `{ changed, nearFraction }`（`nearFraction` = 命中 key 的像素占比，用于「背景可能不是纯色」的警告）。
 */
function keyOutPixels(data, width, height, opts) {
  const key = opts.key;
  const tol = opts.tolerance;
  const total = width * height;
  let domIdx = 0;                                   // key 的主导通道
  if (key.g >= key.r && key.g >= key.b) domIdx = 1;
  else if (key.b >= key.r && key.b >= key.g) domIdx = 2;
  let near = 0;
  let changed = false;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const r = data[o]; const g = data[o + 1]; const b = data[o + 2];
    const d = colorDistance(r, g, b, key);
    if (d <= tol) {
      near++;
      if (data[o + 3] !== 0) { data[o + 3] = 0; changed = true; }
      continue;
    }
    if (d <= tol * 2) {
      const f = (d - tol) / tol;                    // 0..1
      const a = Math.round(data[o + 3] * f);
      const chans = [r, g, b];                       // de-spill：主导通道压到其它通道的最大值
      const others = [r, g, b];
      others.splice(domIdx, 1);
      const cap = Math.max(others[0], others[1]);
      if (chans[domIdx] > cap) chans[domIdx] = cap;
      data[o] = chans[0]; data[o + 1] = chans[1]; data[o + 2] = chans[2];
      if (data[o + 3] !== a) { data[o + 3] = a; changed = true; }
    }
  }
  return { changed, nearFraction: total ? near / total : 0 };
}

/** alpha > threshold 的包围盒；全透明返回 `null`。 */
function trimBounds(data, width, height, threshold) {
  const th = typeof threshold === 'number' ? threshold : 0;
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > th) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** contain-fit 的目标尺寸（保持比例）；target 任一为 0 则原样返回。 */
function fitSize(srcW, srcH, targetW, targetH) {
  if (!targetW || !targetH) return { width: srcW, height: srcH };
  const scale = Math.min(targetW / srcW, targetH / srcH);
  return { width: Math.max(1, Math.round(srcW * scale)), height: Math.max(1, Math.round(srcH * scale)) };
}

/**
 * 四角推断背景色：取四个角像素，若**任一通道**在四角间的极差 > tolerance，
 * 就说明「背景不是纯色」→ 抛 `BACKGROUND_AMBIGUOUS`（**运行时错**：结论依赖图片内容，
 * 不依赖 argv，按 R237 不能算用法错）。
 *
 * @returns {{color: {r,g,b}, corners: Array<{r,g,b,a}>}}
 */
function inferBackground(img, { tolerance }) {
  assertImage(img);
  assertTolerance(tolerance);
  const { width, height, data } = img;
  const at = (x, y) => {
    const o = (y * width + x) * 4;
    return { r: data[o], g: data[o + 1], b: data[o + 2], a: data[o + 3] };
  };
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  let spread = 0;
  for (const ch of ['r', 'g', 'b']) {
    const vals = corners.map((c) => c[ch]);
    spread = Math.max(spread, Math.max(...vals) - Math.min(...vals));
  }
  if (spread > tolerance) {
    throw artError(
      'BACKGROUND_AMBIGUOUS',
      `四角颜色不一致（最大通道极差 ${spread} > 容差 ${tolerance}）——推不出唯一的背景色`,
      { corners, spread, tolerance },
    );
  }
  const avg = (k) => Math.round(corners.reduce((s, c) => s + c[k], 0) / corners.length);
  return { color: { r: avg('r'), g: avg('g'), b: avg('b') }, corners };
}

/** 取子矩形（左上原点，`width`/`height` 是**尺寸**不是右下坐标）。返回新图。 */
function cropImage(img, bounds) {
  assertImage(img);
  const { left, top, width, height } = bounds || {};
  if (![left, top, width, height].every(Number.isInteger)
    || width <= 0 || height <= 0
    || left < 0 || top < 0 || left + width > img.width || top + height > img.height) {
    throw new RangeError(`裁剪区域越界：${left},${top},${width},${height} 不在 ${img.width}x${img.height} 内`);
  }
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcStart = ((top + y) * img.width + left) * 4;
    img.data.copy(out, y * width * 4, srcStart, srcStart + width * 4);
  }
  return { width, height, data: out };
}

/** 最近邻缩放（像素画唯一正确的缩放方式：不插值、不产生新颜色）。 */
function resizeNearest(img, width, height) {
  assertImage(img);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError(`目标尺寸非法：${width}x${height}`);
  }
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / width));
      const s = (sy * img.width + sx) * 4;
      const d = (y * width + x) * 4;
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2]; out[d + 3] = img.data[s + 3];
    }
  }
  return { width, height, data: out };
}

/** contain-fit 到**恰好** `targetW x targetH` 的画布（保持比例、最近邻、居中、空白全透明）。 */
function containFit(img, targetW, targetH) {
  assertImage(img);
  const s = fitSize(img.width, img.height, targetW, targetH);
  const scaled = resizeNearest(img, s.width, s.height);
  const out = Buffer.alloc(targetW * targetH * 4);
  const offX = Math.floor((targetW - s.width) / 2);
  const offY = Math.floor((targetH - s.height) / 2);
  for (let y = 0; y < s.height; y++) {
    scaled.data.copy(out, ((offY + y) * targetW + offX) * 4, y * s.width * 4, (y + 1) * s.width * 4);
  }
  return { width: targetW, height: targetH, data: out };
}

/**
 * 规范化一张图（`unity asset import` 的 Node 侧主体）：**去底 → 裁边 → contain-fit**。
 *
 * 顺序不可换：先去掉背景才谈得上「裁掉透明边」；`--fit` 放在最后，因为它决定的是**最终画布**。
 *
 * @param {{width,height,data}} img 解码后的 RGBA8 图（**会被就地修改**：去底阶段原地改 alpha）
 * @param {{removeBg?: 'auto'|'#RRGGBB'|undefined, tolerance?: number, trim?: boolean,
 *   fit?: {width:number,height:number}|null}} opts
 * @returns {{img: object, art: {removeBg: object|null, trimmed: object|null, output: {width,height}|null, warning: string|null}}}
 * @throws {Error & {code?: string}} `BACKGROUND_AMBIGUOUS` / `ART_FULLY_TRANSPARENT`；非法 tolerance → `TypeError`
 */
function normalizeArt(img, { removeBg, tolerance = 40, trim = false, fit = null } = {}) {
  assertImage(img);
  assertTolerance(tolerance);
  let cur = img;
  let removeInfo = null;
  let warning = null;

  if (removeBg !== undefined && removeBg !== null && removeBg !== 'none') {
    let key; let keyColor;
    if (removeBg === 'auto') {
      const inferred = inferBackground(cur, { tolerance });
      key = inferred.color;
      keyColor = `#${[key.r, key.g, key.b].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
    } else {
      keyColor = String(removeBg).toUpperCase();
      key = parseColor(keyColor);
    }
    const keyed = keyOutPixels(cur.data, cur.width, cur.height, { key, tolerance });
    // R384①：阈值 = MIN_KEY_HIT_FRACTION = 0.1（10%）。计划原稿写 0.02，与本节测试用例的 6.25% 命中率冲突
    // → 以测试（验收 gate）为准；10% 也更能拦住「背景是渐变/抗锯齿」这类**部分命中**的情形。
    if (keyed.nearFraction < 0.1) {
      warning = `只有 ${(keyed.nearFraction * 100).toFixed(1)}% 的像素命中背景色 ${keyColor} —— 背景可能不是纯色（去底结果可能不对）`;
    }
    removeInfo = { key, keyColor, tolerance, nearFraction: keyed.nearFraction, changed: keyed.changed };
  }

  let trimmed = null;
  if (trim) {
    const bounds = trimBounds(cur.data, cur.width, cur.height, 0);
    if (!bounds) {
      throw artError(
        'ART_FULLY_TRANSPARENT',
        '去底后整张图全透明 —— 没有可导入的内容',
        { removeBg: removeInfo },
      );
    }
    trimmed = bounds;
    if (bounds.width !== cur.width || bounds.height !== cur.height) cur = cropImage(cur, bounds);
  }

  let output = null;
  if (fit && fit.width > 0 && fit.height > 0) {
    cur = containFit(cur, fit.width, fit.height);
    output = { width: cur.width, height: cur.height };
  }

  return { img: cur, art: { removeBg: removeInfo, trimmed, output, warning } };
}

module.exports = {
  parseColor, colorDistance, keyOutPixels, trimBounds, fitSize,
  inferBackground, cropImage, resizeNearest, containFit, normalizeArt,
};
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/art.test.js`
预期：PASS（18 条全绿）

- [ ] **步骤 5：变异自检（证明测试真的在防）**

临时把 `trimBounds` 的 `maxX - minX + 1` 改成 `maxX - minX` → 运行 `node --test test/art.test.js` 应有 ≥2 条红；
把 `inferBackground` 的 `spread > tolerance` 改成 `spread > tolerance * 100` → 应有 1 条红。
**改完全部还原**，再跑一次确认全绿。

- [ ] **步骤 6：全量测试 + 提交**

```bash
node bin/unity.js version
npm test 2>&1 | tail -8      # 预期 # tests 478 / # pass 478 / # fail 0（= 456 + 任务1 的 4 + 本任务 18）
git add lib/art.js test/art.test.js
git commit -m "feat(art): 美术纯函数管线 lib/art.js（色键去底/四角推断/裁边/最近邻 contain-fit）"
```

---
### 任务 3：`unity asset import`（宿主 PNG → Assets/ + 显式导入设置 + 写后读回）

> **R387（控制者裁定，与本节实现稿不同 —— 以裁定为准）**：本节 `lib/importart.js` 实现稿里从 `settings`（已 delete 宽高 4 键）构造 `intent`，而本节测试用例 9/11 断言 `intent.asset.width === 2` / `intent.asset.texWidth === 6` → **两者不可能同时成立**（计划自身的错）。裁定：`intent` 从 `artifact` 构造（保留 `width/height/texWidth/texHeight`，仅 pivot 三项在没给 `--pivot` 时删掉）；`readActual` **直接透传** `__read`（**不要**把 `width/height` 归一成 `texWidth/texHeight`）；用例 11 的 mock 补成 `readEnvelope({ width: 6, height: 4, texWidth: 6, texHeight: 4, maxTextureSize: 32 })`。断言一条不改。

**文件：**
- 创建：`lib/assetpath.js`（`--to` 的唯一校验实现）、`lib/importart.js`（命令主体）、`unity-scripts/asset-import.cs`、`scripts/make-m4-fixture.js`、`test/assetpath.test.js`、`test/importart.test.js`
- 修改：`lib/asset.js`（`--to` 校验换成共享实现，**输出逐字不变**）、`lib/envelope.js`（`USAGE_FAILURE_CODES` 加 7 个码）、`bin/unity.js`（dispatch + USAGE）、`test/envelope.test.js`（成员断言加 7 个码）

- [ ] **步骤 1：先写共享校验 + 它的测试（TDD，不改 `lib/asset.js`）**

创建 `lib/assetpath.js`：

```js
'use strict';

const { fail } = require('./envelope.js');

/**
 * `--to` 的**唯一**校验实现（`unity asset write` 与 `unity asset import` 共用）。
 *
 * 为什么单独一个文件：两处逐字重复的校验会在「空串算不算缺参」「hint 文案」这些
 * 细节上各自漂移（`docs/M3-DECISIONS.md` 的 R366② 就是同族问题的登记项）。
 *
 * R274 边界（**逐字保留**）：空串 **不是**「缺 --to」—— `--to=` 给了值（只是值为空），
 * 语义是「目标路径非法」→ `BAD_TARGET_PATH`；只有「没给 / 裸写 flag（`true`）/ 非字符串」
 * 才是 `MISSING_TO`。两者都是用法错（退出码 2），但**错误码不同**，调用方靠它分流。
 *
 * @param {*} to `--to` 的原始 argv 值
 * @param {{sample: string, missingHint: string, badHint: string}} msg
 *   `sample` 进 `MISSING_TO` 的 message；两个 hint 分别给缺参与非法路径用
 *   （参数化的唯一目的是让既有命令的输出**逐字不变**）
 * @returns {{ok: true, path: string} | {ok: false, envelope: object}}
 */
function normalizeAssetTo(to, { sample, missingHint, badHint }) {
  if (typeof to !== 'string') {
    return {
      ok: false,
      envelope: fail({
        code: 'MISSING_TO',
        message: `缺少 --to（目标路径，形如 ${sample}）`,
        actual: { to },
        hint: [missingHint],
      }),
    };
  }
  const normalized = to.replace(/\\/g, '/');
  if (!/^Assets\//.test(normalized) || normalized.includes('..')) {
    return {
      ok: false,
      envelope: fail({
        code: 'BAD_TARGET_PATH',
        message: `--to 必须是 Assets/ 下的项目内路径且不含 ..：${JSON.stringify(to)}`,
        actual: { to },
        hint: [badHint],
      }),
    };
  }
  return { ok: true, path: normalized };
}

module.exports = { normalizeAssetTo };
```

创建 `test/assetpath.test.js`：

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeAssetTo } = require('../lib/assetpath.js');
const { exitCodeFor } = require('../lib/envelope.js');

const MSG = { sample: 'Assets/X/y.png', missingHint: 'h1', badHint: 'h2' };

test('normalizeAssetTo：缺参/裸写/非字符串 → MISSING_TO（用法错 2）', () => {
  for (const bad of [undefined, null, true, 123, {}]) {
    const r = normalizeAssetTo(bad, MSG);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.envelope.code, 'MISSING_TO');
    assert.strictEqual(exitCodeFor(r.envelope), 2);
  }
});

test('normalizeAssetTo：空串 → BAD_TARGET_PATH（R274：空串不是缺参）', () => {
  const r = normalizeAssetTo('', MSG);
  assert.strictEqual(r.envelope.code, 'BAD_TARGET_PATH');
  assert.strictEqual(exitCodeFor(r.envelope), 2);
});

test('normalizeAssetTo：反斜杠归一 + 合法路径透传', () => {
  assert.deepStrictEqual(normalizeAssetTo('Assets\\Art\\a.png', MSG), { ok: true, path: 'Assets/Art/a.png' });
  assert.deepStrictEqual(normalizeAssetTo('Assets/Art/a.png', MSG), { ok: true, path: 'Assets/Art/a.png' });
});

test('normalizeAssetTo：不在 Assets/ 下或含 .. → BAD_TARGET_PATH（用法错 2）', () => {
  for (const bad of ['Art/a.png', '/Assets/a.png', 'Assets/../x.png', 'assets/a.png']) {
    const r = normalizeAssetTo(bad, MSG);
    assert.strictEqual(r.envelope.code, 'BAD_TARGET_PATH', bad);
    assert.strictEqual(exitCodeFor(r.envelope), 2);
  }
});
```

- [ ] **步骤 2：运行新测试 + 把 `lib/asset.js` 换成共享实现（既有测试必须全绿）**

先 `node --test test/assetpath.test.js` → PASS。

然后改 `lib/asset.js`：删除 `assetWrite` 里从 `if (typeof to !== 'string') {` 到 `const normalizedTo = to.replace(...)` 那三段，
换成（**参数逐字取自被删掉的三处文案**，位置不变 —— 顺序影响哪个错误先报）：

```js
  // R274/R366②：`--to` 校验收口到 `lib/assetpath.js`（asset import 共用同一实现）。
  // 下面三个文案参数**逐字**保留本命令原有输出（既有测试是判据）。
  const toCheck = normalizeAssetTo(to, {
    sample: 'Assets/PiBB/PiBrickBreaker.cs',
    missingHint: '用法：unity asset write --to Assets/PiBB/PiBrickBreaker.cs --template PiBrickBreaker',
    badHint: '用法：--to Assets/PiBB/PiBrickBreaker.cs',
  });
  if (!toCheck.ok) return toCheck.envelope;
  const normalizedTo = toCheck.path;
```

并在文件顶部 require 区加 `const { normalizeAssetTo } = require('./assetpath.js');`。

运行：`node --test test/asset.test.js` → 预期 **全绿（401 行既有用例一条都不许改）**。
若出现红：说明文案参数没取对 —— 按失败用例的实际期望值订正参数，**不要改测试**。

- [ ] **步骤 3：写冻结数组的 7 个新码 + 成员测试**

`lib/envelope.js` 的 `USAGE_FAILURE_CODES` 里，在 `'BAD_SIZE', 'BAD_SOURCE', 'BAD_TARGET_PATH',` 之后补一行：

```js
  'BAD_PPU', 'BAD_FILTER', 'BAD_COMPRESSION', 'BAD_MAX_SIZE', 'BAD_REMOVE_BG', 'BAD_FIT', 'BAD_PIVOT',
```

⚠️ **`test/envelope.test.js` 的成员断言是 `deepStrictEqual([...USAGE_FAILURE_CODES].sort(), [...])`（排序后逐字相等）**
→ 期望数组必须**按字母序插入**这 7 个字符串（不是追加到末尾）：`BAD_COMPRESSION` 紧跟 `BAD_COMPONENTS`；
`BAD_FILTER` / `BAD_FIT` 紧跟 `BAD_EXPECT`；`BAD_MAX_SIZE` 紧跟 `BAD_MATCH_MODE`；`BAD_PIVOT` 紧跟 `BAD_PATCH`；
`BAD_PPU` 紧跟 `BAD_PIVOT`；`BAD_REMOVE_BG` 紧跟 `BAD_REGION`。
运行 `node --test test/envelope.test.js` → PASS。

- [ ] **步骤 4：编写 `lib/importart.js` 的失败测试（先写用法面）**

创建 `test/importart.test.js`：

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { assetImport } = require('../lib/importart.js');
const { exitCodeFor } = require('../lib/envelope.js');
const { encodePng, decodePng } = require('../lib/png.js');

function fakeCall(json, spy = []) {
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}
/** 按调用序回放（1 = 写，2 = 读回）。 */
function sequenceCall(results, spy = []) {
  let n = 0;
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    const json = results[Math.min(n, results.length - 1)];
    n++;
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

/** 6x4 绿底 + 2x2 红块（去底 + 裁边后 = 2x2 全红）。 */
function fixture() {
  const W = 6; const H = 4;
  const d = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const inner = x >= 2 && x <= 3 && y >= 1 && y <= 2;
      d[o] = inner ? 255 : 0; d[o + 1] = inner ? 0 : 255; d[o + 2] = 0; d[o + 3] = 255;
    }
  }
  return encodePng({ width: W, height: H, data: d });
}

/** 临时项目目录（只用来放 Assets/，不跑编辑器）。 */
function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4-import-'));
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true });
  return dir;
}

const READBACK = {
  path: 'Assets/Art/hero.png',
  textureType: 'Sprite', spriteImportMode: 'Single', filterMode: 'Point',
  textureCompression: 'Uncompressed', mipmapEnabled: false, wrapMode: 'Clamp',
  pixelsPerUnit: 16, maxTextureSize: 32, npotScale: 'None',
  isReadable: false, alphaIsTransparency: false,
  spriteMeshType: 'FullRect', spriteExtrude: 0, spriteAlignment: 0,
  spritePivotX: 0.5, spritePivotY: 0.5,
  width: 2, height: 2,
  texWidth: 2, texHeight: 2, texFormat: 'RGBA32', texFilterMode: 'Point',
  mipmapCount: 1, hasSprite: true, guid: 'abc123',
};
const WRITTEN = { Success: true, Result: JSON.stringify({ __written: true }) };
const readEnvelope = (patch) => ({
  Success: true, Result: JSON.stringify({ __read: { ...READBACK, ...patch } }),
});

test('assetImport：缺 --from → MISSING_FILE（用法错 2），零调用零写盘', async () => {
  const spy = [];
  for (const from of [undefined, true, '']) {
    const e = await assetImport({ projectPath: 'P', from, to: 'Assets/Art/a.png', _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'MISSING_FILE', JSON.stringify(from));
    assert.strictEqual(exitCodeFor(e), 2);
  }
  assert.strictEqual(spy.length, 0);
});

test('assetImport：缺/非法 --to → MISSING_TO / BAD_TARGET_PATH（用法错 2）', async () => {
  const spy = [];
  const a = await assetImport({ projectPath: 'P', from: 'x.png', to: undefined, _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(a.code, 'MISSING_TO');
  assert.strictEqual(exitCodeFor(a), 2);
  const b = await assetImport({ projectPath: 'P', from: 'x.png', to: 'Art/a.png', _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(b.code, 'BAD_TARGET_PATH');
  assert.strictEqual(exitCodeFor(b), 2);
  assert.strictEqual(spy.length, 0);
});

test('assetImport：缺 --project-path → MISSING_PROJECT_PATH（运行时错 1）', async () => {
  const spy = [];
  const e = await assetImport({ from: 'x.png', to: 'Assets/a.png', _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(e.code, 'MISSING_PROJECT_PATH');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(spy.length, 0);
});

test('assetImport：7 个新用法码各自的非法取值（全部零调用）', async () => {
  const cases = [
    ['--ppu', { ppu: '0' }, 'BAD_PPU'], ['--ppu', { ppu: '1.5' }, 'BAD_PPU'], ['--ppu', { ppu: true }, 'BAD_PPU'],
    ['--filter', { filter: 'nearest' }, 'BAD_FILTER'], ['--filter', { filter: true }, 'BAD_FILTER'],
    ['--compression', { compression: 'zip' }, 'BAD_COMPRESSION'], ['--compression', { compression: true }, 'BAD_COMPRESSION'],
    ['--max-size', { maxSize: '0' }, 'BAD_MAX_SIZE'], ['--max-size', { maxSize: '-8' }, 'BAD_MAX_SIZE'],
    ['--remove-bg', { removeBg: 'green' }, 'BAD_REMOVE_BG'], ['--remove-bg', { removeBg: '#12345' }, 'BAD_REMOVE_BG'],
    ['--fit', { fit: '8' }, 'BAD_FIT'], ['--fit', { fit: '8,0' }, 'BAD_FIT'], ['--fit', { fit: 'a,b' }, 'BAD_FIT'],
    ['--pivot', { pivot: '1,2,3' }, 'BAD_PIVOT'], ['--pivot', { pivot: 'x,y' }, 'BAD_PIVOT'],
    ['--tolerance', { tolerance: '300' }, 'BAD_TOLERANCE'], ['--tolerance', { tolerance: '-1' }, 'BAD_TOLERANCE'],
  ];
  for (const [flag, patch, code] of cases) {
    const spy = [];
    const e = await assetImport({ projectPath: 'P', from: 'x.png', to: 'Assets/a.png', _call: fakeCall({ Success: true }, spy), ...patch });
    assert.strictEqual(e.code, code, `${flag} ${JSON.stringify(patch)} → 期望 ${code}，实际 ${e.code}`);
    assert.strictEqual(exitCodeFor(e), 2, `${flag} 必须是用法错`);
    assert.strictEqual(spy.length, 0, `${flag} 不得发起调用`);
  }
});

test('assetImport：--tolerance 0 合法（与 pixels 同口径）；只有 >255 / 负数 / 非整数才是 BAD_TOLERANCE', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'hero.png');
  fs.writeFileSync(src, fixture());            // 背景恰好是纯 #00FF00 → 容差 0 也能去干净
  const spy = [];
  const call = sequenceCall([WRITTEN, readEnvelope({ texWidth: 2, texHeight: 2, width: 2, height: 2 })], spy);
  const e = await assetImport({
    projectPath: dir, from: src, to: 'Assets/Art/hero.png',
    removeBg: 'auto', tolerance: '0', trim: true, _call: call,
  });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(e.actual.art.removeBg.tolerance, 0);
});

test('assetImport：源文件不存在 → SOURCE_NOT_FOUND（运行时 1），零调用', async () => {
  const spy = [];
  const e = await assetImport({ projectPath: 'P', from: 'C:/nope/none.png', to: 'Assets/a.png', _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(e.code, 'SOURCE_NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(spy.length, 0);
});

test('assetImport：非 PNG 字节 → BAD_PNG（运行时 1），不写盘', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'bad.png');
  fs.writeFileSync(src, Buffer.from('not a png at all'));
  const spy = [];
  const e = await assetImport({ projectPath: dir, from: src, to: 'Assets/Art/a.png', _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(e.code, 'BAD_PNG');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(spy.length, 0);
  assert.strictEqual(fs.existsSync(path.join(dir, 'Assets/Art/a.png')), false);
});

test('assetImport：目标已存在且无 --force → ASSET_EXISTS（运行时 1），零写盘零调用', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'hero.png');
  fs.writeFileSync(src, fixture());
  fs.mkdirSync(path.join(dir, 'Assets/Art'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Assets/Art/a.png'), 'old');
  const spy = [];
  const e = await assetImport({ projectPath: dir, from: src, to: 'Assets/Art/a.png', _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(e.code, 'ASSET_EXISTS');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(spy.length, 0);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'Assets/Art/a.png'), 'utf8'), 'old');
});

test('assetImport：happy path —— 去底+裁边落盘、11 项设置读回一致 → verified:true', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'hero.png');
  fs.writeFileSync(src, fixture());
  const spy = [];
  const call = sequenceCall([WRITTEN, readEnvelope()], spy);
  const e = await assetImport({
    projectPath: dir, from: src, to: 'Assets/Art/hero.png',
    removeBg: 'auto', tolerance: '20', trim: true, ppu: '16', _call: call,
  });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(exitCodeFor(e), 0);
  // 落盘的确实是「规范化之后」的图（2x2 全红），不是原图
  const onDisk = decodePng(fs.readFileSync(path.join(dir, 'Assets/Art/hero.png')));
  assert.strictEqual(onDisk.width, 2);
  assert.strictEqual(onDisk.height, 2);
  // intent 是 asset 子集；actual 里带 art/file 证据
  assert.strictEqual(e.intent.asset.width, 2);
  assert.strictEqual(e.intent.asset.textureType, 'Sprite');
  assert.strictEqual(e.intent.asset.isReadable, false);
  // **未给 --pivot 时，spriteAlignment/spritePivotX/Y 不进 intent**（M4-SPIKE 只探过 Custom(9) 的情形，
  // Center 的 pivot 读回值未探测 —— 当成已知会导致每次不带 --pivot 的导入都假红）
  assert.strictEqual(e.intent.asset.spriteAlignment, undefined);
  assert.strictEqual(e.intent.asset.spritePivotX, undefined);
  assert.strictEqual(e.actual.art.removeBg.keyColor, '#00FF00');
  assert.strictEqual(e.actual.art.trimmed.width, 2);
  assert.strictEqual(e.actual.file.bytes, fs.statSync(path.join(dir, 'Assets/Art/hero.png')).size);
  assert.match(e.actual.file.sha256, /^[0-9a-f]{64}$/);
  // 写调用是 write 模式、读回是 read 模式（同一支 .cs），且读回发生在写之后
  const p0 = JSON.parse(JSON.parse(spy[0].args[3]).p);
  const p1 = JSON.parse(JSON.parse(spy[1].args[3]).p);
  assert.strictEqual(p0.mode, 'write');
  assert.strictEqual(p1.mode, 'read');
  assert.strictEqual(p0.settings.spriteMeshType, 'FullRect');
  assert.strictEqual(p0.settings.spriteExtrude, 0);
  assert.strictEqual(p0.asset, undefined);
});

test('assetImport：读回不一致（纹理被静默缩放）→ verified:false + 具体分歧键', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'hero.png');
  fs.writeFileSync(src, fixture());
  const spy = [];
  const call = sequenceCall([WRITTEN, readEnvelope({ texWidth: 1, texHeight: 1 })], spy);
  const e = await assetImport({ projectPath: dir, from: src, to: 'Assets/Art/hero.png', trim: true, _call: call });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeFor(e), 1);
  const keys = e.mismatches.map((m) => m.key);
  assert.ok(keys.includes('asset.texWidth'), keys.join(','));
});

test('assetImport：--max-size 小于源尺寸会被抬到 >= max(w,h) 的 2 的幂，并读回校验真实尺寸', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'hero.png');
  fs.writeFileSync(src, fixture());                       // 6x4（不裁边）
  const spy = [];
  const call = sequenceCall([WRITTEN, readEnvelope({ texWidth: 6, texHeight: 4, maxTextureSize: 32 })], spy);
  const e = await assetImport({ projectPath: dir, from: src, to: 'Assets/Art/hero.png', maxSize: '8', _call: call });
  assert.strictEqual(e.intent.asset.maxTextureSize, 32, '必须抬到 2 的幂（spike 只验过「源某边超上限」：24×16 + 8 → 8×5；本命令统一抬到 >= max(w,h) 的 2 的幂（下限 32）以免踩档位歧义）');
  assert.strictEqual(e.intent.asset.texWidth, 6);
  assert.strictEqual(e.verified, true);
  assert.strictEqual(e.actual.maxTextureSizeRaisedFrom, 8);
});

test('assetImport：磁盘 sha256 与写回内容不符 → verified:false（假绿防线）', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'hero.png');
  fs.writeFileSync(src, fixture());
  const spy = [];
  const call = sequenceCall([WRITTEN, readEnvelope()], spy);
  const e = await assetImport({
    projectPath: dir, from: src, to: 'Assets/Art/hero.png', trim: true, _call: call,
    _readBack: () => Buffer.from('tampered'),
  });
  assert.strictEqual(e.verified, false);
  const keys = e.mismatches.map((m) => m.key);
  assert.ok(keys.includes('file.sha256'), keys.join(','));
});

test('assetImport：.cs 报 __error → 失败信封（不产 ok:true）', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'hero.png');
  fs.writeFileSync(src, fixture());
  const spy = [];
  const call = sequenceCall([{ Success: true, Result: JSON.stringify({ __error: 'IMPORTER_NOT_FOUND' }) }], spy);
  const e = await assetImport({ projectPath: dir, from: src, to: 'Assets/Art/hero.png', trim: true, _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'IMPORTER_NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('assetImport：传输层截断 → ULOOP_TRUNCATED（写路径必须提示先复核）', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'hero.png');
  fs.writeFileSync(src, fixture());
  const call = async (tool, args, opts) => ({
    code: 1, stdout: '', stderr: '', timedOut: true, drained: false, json: null, truncated: true, tool, args,
  });
  const e = await assetImport({ projectPath: dir, from: src, to: 'Assets/Art/hero.png', trim: true, _call: call });
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
  assert.ok(e.hint.some((h) => h.includes('复核')), e.hint.join(' | '));
});

test('assetImport：四角不一致的 --remove-bg auto → BACKGROUND_AMBIGUOUS（运行时 1，不是用法错）', async () => {
  const dir = tmpProject();
  const W = 4; const H = 4;
  const d = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i * 4 + 3] = 255; }
  const set = (x, y, c) => { const o = (y * W + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; };
  set(0, 0, [0, 255, 0]); set(3, 0, [255, 0, 0]); set(0, 3, [0, 0, 255]); set(3, 3, [255, 255, 0]);
  const src = path.join(dir, 'mixed.png');
  fs.writeFileSync(src, encodePng({ width: W, height: H, data: d }));
  const spy = [];
  const e = await assetImport({
    projectPath: dir, from: src, to: 'Assets/Art/a.png', removeBg: 'auto', _call: fakeCall({ Success: true }, spy),
  });
  assert.strictEqual(e.code, 'BACKGROUND_AMBIGUOUS');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(spy.length, 0);
  assert.ok(e.hint.join(' ').includes('--remove-bg'), e.hint.join(' | '));
});

test('assetImport：去底后全透明 → ART_FULLY_TRANSPARENT（运行时 1）', async () => {
  const dir = tmpProject();
  const W = 2; const H = 2;
  const d = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i * 4 + 1] = 255; d[i * 4 + 3] = 255; }
  const src = path.join(dir, 'green.png');
  fs.writeFileSync(src, encodePng({ width: W, height: H, data: d }));
  const spy = [];
  const e = await assetImport({
    projectPath: dir, from: src, to: 'Assets/Art/a.png', removeBg: 'auto', trim: true, _call: fakeCall({ Success: true }, spy),
  });
  assert.strictEqual(e.code, 'ART_FULLY_TRANSPARENT');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(spy.length, 0);
});
```

- [ ] **步骤 5：运行测试验证失败**

运行：`node --test test/importart.test.js`
预期：FAIL —— `Cannot find module '../lib/importart.js'`（外部依赖：本条测试里 `fixture()` 还会用到任务 1 的 `encodePng`）

- [ ] **步骤 6：实现 `lib/importart.js`**

创建 `lib/importart.js`：

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { call } = require('./uloop.js');
const { fail, ok, envelopeFromCall } = require('./envelope.js');
const { normalizeAssetTo } = require('./assetpath.js');
const { decodePng } = require('./png.js');
const { normalizeArt } = require('./art.js');
const { buildPayloadArgs, parseScriptResult, readBackAndVerify, withWriteRecheckHint } = require('./scene.js');

/**
 * `unity asset import`：把宿主上的 PNG 落进项目 `Assets/`，**显式**配置像素画导入设置，
 * 然后**读回全部设置**比对。
 *
 * 为什么必须专门一条命令（M4-SPIKE「额外」节实测）：
 *   - `asset write` 写完**不触发导入**（9.7 s 后仍 `guid=""`、无 `.meta`）；
 *   - 而它默认那次 `compile` 自带的 refresh 会**顺带**导入，拿到的是**错设置**
 *     （Bilinear + 压缩 + PPU=100 + Tight）→ 时机不可控、设置一律错。
 *   - Unity 侧没有去底 API → 像素必须由 Node 侧定稿后再导入（NEW-6）。
 *
 * 红线（假绿防线）：
 *   - 磁盘上的文件必须**真的**是我们要写的内容（sha256 读回 —— 不信 `verified` 空转）；
 *   - `maxTextureSize` 小于源尺寸会被 Unity **静默缩放**（24×16 + 8 → 8×5，NEW-5）
 *     → 自动抬到 `>= max(w,h)` 的**2 的幂**，并靠读回的**真实纹理尺寸**兜底；
 *   - 读回发生在**写之后**的独立一次调用（不是写调用的返回值）。
 */

/** `--filter` 的取值表（**唯一真值**）：argv 小写 → Unity 枚举名。 */
const FILTERS = { point: 'Point', bilinear: 'Bilinear' };

/** `--compression` 的取值表（唯一真值）：none → 不压缩（像素画唯一正确选择）。 */
const COMPRESSIONS = { none: 'Uncompressed', normal: 'Compressed' };

const MAX_TEXTURE_SIZE_CAP = 16384;

/** 正整数 argv（`--ppu` / `--max-size`）。非法 → `null`（由调用方落用法错）。 */
function positiveIntArg(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v !== 'string' || !/^\d+$/.test(v) || Number(v) <= 0) return null;
  return Number(v);
}

/** 0–255 的整数 argv（`--tolerance`）。非法 → `null`；**`0` 是合法值**（与 `pixels --tolerance` 同口径）。 */
function zeroTo255Arg(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 255 ? v : null;
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 0 && n <= 255 ? n : null;
}

/** `--fit w,h`：两个正整数。非法 → `null`。 */
function parseFitArg(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d+),(\d+)$/.exec(v);
  if (!m) return null;
  const width = Number(m[1]); const height = Number(m[2]);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/** `--pivot x,y`：两个 0–1 的有限数。非法 → `null`。 */
function parsePivotArg(v) {
  if (typeof v !== 'string') return null;
  const parts = v.split(',');
  if (parts.length !== 2) return null;
  const nums = parts.map((s) => Number(s));
  if (!nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  return { x: nums[0], y: nums[1] };
}

/** `--remove-bg`：`auto` 或 `#RRGGBB`/`#RGB`。非法 → `null`。 */
function parseRemoveBgArg(v) {
  if (v === 'auto') return 'auto';
  if (typeof v !== 'string') return null;
  const s = v.replace(/^#/, '');
  return /^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? `#${s.toUpperCase()}` : null;
}

/** `>= n` 的最小 2 的幂（从 32 起 —— Unity 的 maxTextureSize 是 2 的幂档位）。 */
function nextPow2AtLeast(n) {
  let v = 32;
  while (v < n) v *= 2;
  return v;
}

/** 把 `lib/art.js` 抛出的运行时错误收敛成信封（`BACKGROUND_AMBIGUOUS` / `ART_FULLY_TRANSPARENT`）。 */
function artFailure(err, intent) {
  const code = err && err.code === 'BACKGROUND_AMBIGUOUS' ? 'BACKGROUND_AMBIGUOUS'
    : err && err.code === 'ART_FULLY_TRANSPARENT' ? 'ART_FULLY_TRANSPARENT'
      : 'ART_FAILED';
  const hint = code === 'BACKGROUND_AMBIGUOUS'
    ? [
      '背景不是纯色（四角不一致）→ 显式指定背景色：--remove-bg \'#RRGGBB\'',
      '或用 `read` 工具看一眼原图，确认背景到底是什么颜色',
    ]
    : code === 'ART_FULLY_TRANSPARENT'
      ? ['换一张背景色出现得更多的图，或显式给 `--remove-bg \'#RRGGBB\'`', '先不加 --trim 看看去底结果']
      : ['把原图与参数贴进报告；这是 Node 侧像素管线的意外失败'];
  return fail({ code, message: (err && err.message) || String(err), intent, actual: (err && err.detail) || null, hint, phase: 'art' });
}

/**
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, from?: string, to?: string, force?: boolean,
 *   removeBg?: string, tolerance?: string, trim?: boolean, fit?: string, ppu?: string, maxSize?: string,
 *   filter?: string, compression?: string, pivot?: string,
 *   _call?: typeof call, _readSource?: (p: string) => Buffer, _readBack?: (p: string) => Buffer,
 *   _writeFile?: (p: string, b: Buffer) => void, _exists?: (p: string) => boolean,
 *   _mkdirp?: (p: string) => void}} [opts]
 * @returns {Promise<object>} 信封（成功时 `verified` 为布尔）
 */
async function assetImport({
  projectPath, env, from, to, force, removeBg, tolerance, trim, fit, ppu, maxSize, filter, compression, pivot,
  _call, _readSource, _readBack, _writeFile, _exists, _mkdirp,
} = {}) {
  // ---- 用法面：全部在任何写盘/任何 uloop 调用之前收敛（约束 4）----
  if (typeof from !== 'string' || from === '') {
    return fail({
      code: 'MISSING_FILE',
      message: '缺少 --from（宿主上的源图路径）',
      actual: { from },
      hint: ['用法：unity asset import --project-path <P> --from C:/pic/hero.png --to Assets/Art/hero.png'],
    });
  }
  const toCheck = normalizeAssetTo(to, {
    sample: 'Assets/Art/hero.png',
    missingHint: '用法：unity asset import --project-path <P> --from C:/pic/hero.png --to Assets/Art/hero.png',
    badHint: '用法：--to Assets/Art/hero.png（必须在 Assets/ 下、不含 ..）',
  });
  if (!toCheck.ok) return toCheck.envelope;
  const normalizedTo = toCheck.path;

  const ppuNum = ppu === undefined ? 16 : positiveIntArg(ppu);
  if (ppuNum === null) {
    return fail({ code: 'BAD_PPU', message: `--ppu 需要正整数，收到 ${JSON.stringify(ppu)}`, actual: { ppu }, hint: ['像素画常用 16 / 32：PPU 决定「1 个世界单位 = 多少像素」'] });
  }
  const maxSizeNum = maxSize === undefined ? null : positiveIntArg(maxSize);
  if (maxSize !== undefined && maxSizeNum === null) {
    return fail({ code: 'BAD_MAX_SIZE', message: `--max-size 需要正整数，收到 ${JSON.stringify(maxSize)}`, actual: { maxSize }, hint: ['这是 Unity 的 maxTextureSize；小于源尺寸会被**静默缩放**，本命令会自动抬到 >= 源尺寸的 2 的幂'] });
  }
  const filterName = filter === undefined ? 'Point' : FILTERS[filter];
  if (filter !== undefined && !filterName) {
    return fail({ code: 'BAD_FILTER', message: `--filter 只接受 point|bilinear，收到 ${JSON.stringify(filter)}`, actual: { filter }, hint: ['像素画用 point（最近邻，不糊）；写实照片才用 bilinear'] });
  }
  const compName = compression === undefined ? 'Uncompressed' : COMPRESSIONS[compression];
  if (compression !== undefined && !compName) {
    return fail({ code: 'BAD_COMPRESSION', message: `--compression 只接受 none|normal，收到 ${JSON.stringify(compression)}`, actual: { compression }, hint: ['像素画必须 none（压缩会把颜色糊成 DXT 块）'] });
  }
  const removeBgVal = removeBg === undefined ? undefined : parseRemoveBgArg(removeBg);
  if (removeBg !== undefined && removeBgVal === null) {
    return fail({ code: 'BAD_REMOVE_BG', message: `--remove-bg 只接受 auto 或 #RRGGBB，收到 ${JSON.stringify(removeBg)}`, actual: { removeBg }, hint: ["用法：--remove-bg auto（按四角推断）或 --remove-bg '#00FF00'"] });
  }
  const fitVal = fit === undefined ? null : parseFitArg(fit);
  if (fit !== undefined && fitVal === null) {
    return fail({ code: 'BAD_FIT', message: `--fit 需要 w,h 两个正整数，收到 ${JSON.stringify(fit)}`, actual: { fit }, hint: ['用法：--fit 32,32（contain-fit：保持比例放进该画布，空白处透明）'] });
  }
  const pivotVal = pivot === undefined ? null : parsePivotArg(pivot);
  if (pivot !== undefined && pivotVal === null) {
    return fail({ code: 'BAD_PIVOT', message: `--pivot 需要 x,y 两个 0–1 的数，收到 ${JSON.stringify(pivot)}`, actual: { pivot }, hint: ['用法：--pivot 0.5,0（底部中心）；不给则用 Unity 默认的 Center(0.5,0.5)'] });
  }
  // ⚠️ `--tolerance 0` 是**合法**值（与 `pixels --tolerance` 的 0–255 同口径）→ 不能复用 `positiveIntArg`（它把 0 判非法）。
  const toleranceNum = tolerance === undefined ? 40 : zeroTo255Arg(tolerance);
  if (toleranceNum === null) {
    return fail({ code: 'BAD_TOLERANCE', message: `--tolerance 需要 0–255 的整数，收到 ${JSON.stringify(tolerance)}`, actual: { tolerance }, hint: ['像素画建议 0–40；只会与 --remove-bg 一起用'] });
  }
  if (typeof projectPath !== 'string' || projectPath === '') {
    return fail({
      code: 'MISSING_PROJECT_PATH',
      message: '需要 --project-path（本命令要按项目根解析 --to 的落地路径）',
      actual: { to: normalizedTo },
      hint: ['用 --project-path <项目根> 指定项目'],
    });
  }

  const absTo = path.join(projectPath, normalizedTo);
  const exists = _exists || fs.existsSync;
  if (exists(absTo) && force !== true) {
    return fail({
      code: 'ASSET_EXISTS',
      message: `目标已存在：${normalizedTo}（未给 --force）`,
      actual: { path: normalizedTo },
      hint: [
        '覆盖已有美术资产属于停止条件（skill §5）：先向用户确认',
        '确认后用 --force 覆盖（同名覆盖 = 更新，GUID 不变，引用不断 —— M4-SPIKE Q4）',
      ],
    });
  }

  // ---- 读源图 + 规范化（Node 侧；Unity 侧只做声明式设置）----
  let source;
  try {
    source = await (_readSource || ((p) => fs.readFileSync(p)))(from);
  } catch (err) {
    return fail({
      code: 'SOURCE_NOT_FOUND',
      message: `读不了源图：${(err && err.message) || String(err)}`,
      actual: { from },
      hint: ['--from 是宿主上的**绝对路径**（相对路径按当前 shell 的 cwd 解析）'],
    });
  }
  let decoded;
  try {
    decoded = decodePng(source);
  } catch (err) {
    return fail({
      code: 'BAD_PNG',
      message: `源图不是本命令支持的 PNG：${(err && err.message) || String(err)}`,
      actual: { from, bytes: source.length },
      hint: [
        '支持面：bitDepth 8、colorType 0/2/4/6（**调色板 colorType 3 与隔行不支持**）',
        '用图片编辑器另存为「PNG-24 / PNG-32（非隔行）」再试',
      ],
    });
  }
  let art;
  try {
    art = normalizeArt(decoded, {
      removeBg: removeBgVal, tolerance: toleranceNum, trim: trim === true, fit: fitVal,
    });
  } catch (err) {
    return artFailure(err, { asset: { path: normalizedTo, from } });
  }
  const img = art.img;
  const autoMax = nextPow2AtLeast(Math.max(img.width, img.height));
  const effectiveMax = Math.max(maxSizeNum || 0, autoMax);
  if (effectiveMax > MAX_TEXTURE_SIZE_CAP) {
    return fail({
      code: 'TEXTURE_TOO_LARGE',
      message: `图片尺寸 ${img.width}x${img.height} 超过 Unity 的纹理上限 ${MAX_TEXTURE_SIZE_CAP}`,
      actual: { width: img.width, height: img.height },
      hint: ['先用 --fit 缩到 16384 以内（像素画建议 --fit 到游戏里真正需要的尺寸）'],
    });
  }
  const encoded = require('./png.js').encodePng(img);
  const sha = crypto.createHash('sha256').update(encoded).digest('hex');

  const artifact = {
    path: normalizedTo,
    width: img.width,
    height: img.height,
    textureType: 'Sprite',
    spriteImportMode: 'Single',
    filterMode: filterName,
    textureCompression: compName,
    mipmapEnabled: false,
    wrapMode: 'Clamp',
    pixelsPerUnit: ppuNum,
    maxTextureSize: effectiveMax,
    npotScale: 'None',
    isReadable: false,
    alphaIsTransparency: false,
    spriteMeshType: 'FullRect',
    spriteExtrude: 0,
    spriteAlignment: pivotVal ? 9 : 0,
    spritePivotX: pivotVal ? pivotVal.x : 0.5,
    spritePivotY: pivotVal ? pivotVal.y : 0.5,
    texWidth: img.width,
    texHeight: img.height,
    texFilterMode: filterName,
    mipmapCount: 1,
    hasSprite: true,
  };
  const settings = { ...artifact };
  delete settings.width; delete settings.height; delete settings.path;
  delete settings.texWidth; delete settings.texHeight; delete settings.texFilterMode;
  delete settings.mipmapCount; delete settings.hasSprite;
  const intentSettings = { ...settings };
  if (!pivotVal) {
    // 未探测就不断言（M4-SPIKE 只验过 Custom(9) + pivot(0.25,0.75)）：Center 下 Unity 把 pivot 归一成什么
    // 没有实测证据 → 放进 intent 会让每次不带 --pivot 的导入都 verified:false（假红）。读回面仍会带这三个值（informational）。
    delete intentSettings.spriteAlignment;
    delete intentSettings.spritePivotX;
    delete intentSettings.spritePivotY;
  }
  const intent = { asset: intentSettings };

  // ---- 落盘（写后读回 sha256）----
  try {
    (_mkdirp || ((p) => fs.mkdirSync(p, { recursive: true })))(path.dirname(absTo));
    (_writeFile || ((p, b) => fs.writeFileSync(p, b)))(absTo, encoded);
  } catch (err) {
    return fail({
      code: 'WRITE_FAILED',
      message: `写不进项目：${(err && err.message) || String(err)}`,
      intent,
      actual: { path: absTo },
      hint: ['确认项目目录可写、磁盘有空间'],
      phase: 'write',
    });
  }

  // ---- .cs 写调用（ImportAsset + 配设置 + SaveAndReimport）----
  const callFn = _call || call;
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('asset-import', { mode: 'write', path: normalizedTo, settings }), { projectPath, env });
  } catch (err) {
    return fail({
      code: 'WRITE_CALL_FAILED',
      message: `asset-import 写调用失败：${(err && err.message) || String(err)}`,
      intent,
      hint: ['文件已落盘但导入设置是否生效未知；用 `unity exec` 读 TextureImporter 复核后再重试'],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  if (!envl.ok) return withWriteRecheckHint(envl);
  const parsed = parseScriptResult(w, { label: 'asset-import', describeError: () => undefined });
  if (parsed.envelope) return parsed.envelope;

  // ---- 读回（独立一次调用）+ 磁盘 sha256 + 成功/分歧 ----
  const readBack = _readBack || ((p) => fs.readFileSync(p));
  let diskSha = null;
  let diskBytes = 0;
  try {
    const disk = readBack(absTo);
    diskSha = crypto.createHash('sha256').update(disk).digest('hex');
    diskBytes = disk.length;
  } catch (err) {
    diskSha = null;
  }
  return readBackAndVerify({
    projectPath,
    env,
    callFn,
    intent,
    readActual: async () => {
      const r = await callFn('execute-dynamic-code', buildPayloadArgs('asset-import', { mode: 'read', path: normalizedTo }), { projectPath, env });
      const envr = envelopeFromCall(r);
      if (!envr.ok) {
        const err = new Error(`读回失败（${envr.code}）：${envr.message}`);
        err.envelope = envr;
        throw err;
      }
      const p = parseScriptResult(r, { label: 'asset-import', describeError: () => undefined });
      if (p.envelope) {
        const err = new Error(`读回失败（${p.envelope.code}）：${p.envelope.message}`);
        err.envelope = p.envelope;
        throw err;
      }
      // ⚠️ 必须与 intent **同形**：intent 是 `{asset:{...}}` → 读回投影也要包一层 `asset`
      //（compareSubset 遇到「intent 里是对象、actual 侧不是对象」→ 直接记一条 `key:'asset'` 分歧，
      //  结果是每一次 asset import 都 verified:false）。
      return {
        asset: { ...p.parsed.__read },
        file: { path: normalizedTo, sha256: diskSha, bytes: diskBytes },
        art: {
          removeBg: art.art.removeBg,
          trimmed: art.art.trimmed,
          output: art.art.output,
          warning: art.art.warning,
          sourceBytes: source.length,
        },
        maxTextureSizeRaisedFrom: maxSizeNum !== null && effectiveMax !== maxSizeNum ? maxSizeNum : null,
      };
    },
    residue: '文件已经落盘、导入可能也已生效；**不要**盲目重试（先 `unity exec` 读 TextureImporter 复核，或直接删掉该资产重来）',
    mismatchHint: '读回与意图不一致（verified:false）——最常见是**纹理被静默缩放**（查 asset.texWidth/texHeight 与 maxTextureSize）或压缩/滤波没生效；逐条查 mismatches',
    extraCheck: () => {
      if (diskSha !== null && diskSha === sha) return [];
      return [{ key: 'file.sha256', intent: sha, actual: diskSha }];
    },
  });
}

module.exports = {
  assetImport, FILTERS, COMPRESSIONS, nextPow2AtLeast,
  positiveIntArg, zeroTo255Arg, parseFitArg, parsePivotArg, parseRemoveBgArg,
};
```

> **实现者注意（三处必须核对，别照抄盲信）**：
> 1. `parseScriptResult` 的真实签名/返回形状以 `lib/scene.js` 为准（`{value, envelope}` 还是别的）——查源码后按实际改；
>    若它不适合，就照 `lib/sprite.js` 的用法来（**不许**自己复制第三份 `JSON.parse(r.json.Result)`）。
> 2. `_readSource`/`_writeFile`/`_readBack` 的注入缝**必须存在**（测试靠它做假绿防线用例）。
> 3. `ok` 未用到就删掉 require（lint 不是强制的，但别留死 import）。

- [ ] **步骤 7：`.cs` 载荷脚本（真机前先静态自检）**

创建 `unity-scripts/asset-import.cs`（**完整代码，注意每一处注释里的真机教训**）：

```csharp
// unity-scripts/asset-import.cs
// 入参：parameters["param0"] = {"mode":"write","path":"Assets/Art/hero.png","settings":{...}}
//                            {"mode":"read","path":"Assets/Art/hero.png"}
// 出参：write → {"__written":true}
//       read  → {"__read":{...全部设置 + 纹理事实...}}
// 失败：{"__error":"BAD_PAYLOAD"|"IMPORTER_NOT_FOUND"|"TEXTURE_NOT_FOUND"}
//
// ⚠️ 真机教训（M4-SPIKE，团结 2022.3.62t9 实测，改本文件前必读）：
//   NEW-1：spriteMeshType/spriteExtrude/spriteAlignment **不在** TextureImporter 上（真机 CS1061）
//          → 必须 TextureImporterSettings 往返；SpriteMeshType 在 UnityEngine 命名空间（不是 UnityEditor.*）；
//          spriteExtrude 是 **uint**（字面量/转换都要 uint）。
//   NEW-2：外部进程写进 Assets/ 的文件**不会**被自动导入 → 必须显式 ImportAsset（89ms，别用 Refresh 的 3540ms）。
//   SaveAndReimport() 之后**旧 importer 实例作废** → 读回必须重新 GetAtPath（read 模式天然满足）。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var p = (string)req["path"];
var mode = (string)req["mode"];
if (string.IsNullOrEmpty(p) || !p.StartsWith("Assets/") || (mode != "write" && mode != "read"))
    return "{\"__error\":\"BAD_PAYLOAD\"}";

if (mode == "write")
{
    var s = req["settings"] as Newtonsoft.Json.Linq.JObject;
    if (s == null) return "{\"__error\":\"BAD_PAYLOAD\"}";

    // NEW-2：显式、同步、按单路径导入（比 Refresh 快 40 倍，且不需要等帧）
    AssetDatabase.ImportAsset(p, ImportAssetOptions.ForceSynchronousImport);
    var ti = AssetImporter.GetAtPath(p) as TextureImporter;
    if (ti == null) return "{\"__error\":\"IMPORTER_NOT_FOUND\"}";

    ti.textureType = (TextureImporterType)System.Enum.Parse(typeof(TextureImporterType), (string)s["textureType"]);
    ti.spriteImportMode = (SpriteImportMode)System.Enum.Parse(typeof(SpriteImportMode), (string)s["spriteImportMode"]);
    ti.filterMode = (FilterMode)System.Enum.Parse(typeof(FilterMode), (string)s["filterMode"]);
    ti.textureCompression = (TextureImporterCompression)System.Enum.Parse(typeof(TextureImporterCompression), (string)s["textureCompression"]);
    ti.mipmapEnabled = (bool)s["mipmapEnabled"];
    ti.wrapMode = (TextureWrapMode)System.Enum.Parse(typeof(TextureWrapMode), (string)s["wrapMode"]);
    ti.spritePixelsPerUnit = (float)s["pixelsPerUnit"];
    ti.maxTextureSize = (int)s["maxTextureSize"];
    ti.npotScale = (TextureImporterNPOTScale)System.Enum.Parse(typeof(TextureImporterNPOTScale), (string)s["npotScale"]);
    ti.isReadable = (bool)s["isReadable"];
    ti.alphaIsTransparency = (bool)s["alphaIsTransparency"];

    // NEW-1：精灵几何相关的三项走 settings 往返（并把 fallback physics shape 关掉）
    var ts = new TextureImporterSettings();
    ti.ReadTextureSettings(ts);
    ts.spriteMeshType = (UnityEngine.SpriteMeshType)System.Enum.Parse(typeof(UnityEngine.SpriteMeshType), (string)s["spriteMeshType"]);
    ts.spriteExtrude = (uint)(int)s["spriteExtrude"];
    ts.spriteAlignment = (int)s["spriteAlignment"];
    ts.spritePivot = new Vector2((float)s["spritePivotX"], (float)s["spritePivotY"]);
    ts.spriteGenerateFallbackPhysicsShape = false;
    ti.SetTextureSettings(ts);
    ti.SaveAndReimport();   // 实测 40ms；同调用内读回即新值，但**旧实例作废**（读回在 read 模式里重新 GetAtPath）
    return "{\"__written\":true}";
}

// ---- read 模式：**独立一次调用**（写后读回纪律），且必须重新 GetAtPath ----
var ti2 = AssetImporter.GetAtPath(p) as TextureImporter;
if (ti2 == null) return "{\"__error\":\"IMPORTER_NOT_FOUND\"}";
var ts2 = new TextureImporterSettings();
ti2.ReadTextureSettings(ts2);
var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(p);
if (tex == null) return "{\"__error\":\"TEXTURE_NOT_FOUND\"}";
var sp = AssetDatabase.LoadAssetAtPath<Sprite>(p);

var o = new Newtonsoft.Json.Linq.JObject();
o["path"] = p;
o["textureType"] = ti2.textureType.ToString();
o["spriteImportMode"] = ti2.spriteImportMode.ToString();
o["filterMode"] = ti2.filterMode.ToString();
o["textureCompression"] = ti2.textureCompression.ToString();
o["mipmapEnabled"] = ti2.mipmapEnabled;
o["wrapMode"] = ti2.wrapMode.ToString();
o["pixelsPerUnit"] = ti2.spritePixelsPerUnit;
o["maxTextureSize"] = ti2.maxTextureSize;
o["npotScale"] = ti2.npotScale.ToString();
o["isReadable"] = ti2.isReadable;
o["alphaIsTransparency"] = ti2.alphaIsTransparency;
o["spriteMeshType"] = ts2.spriteMeshType.ToString();
o["spriteExtrude"] = (int)ts2.spriteExtrude;
o["spriteAlignment"] = ts2.spriteAlignment;
o["spritePivotX"] = ts2.spritePivot.x;
o["spritePivotY"] = ts2.spritePivot.y;
o["width"] = tex.width;              // intent 里「我要求的尺寸」的读回对应项
o["height"] = tex.height;
o["texWidth"] = tex.width;           // **真实**纹理尺寸 —— 静默缩放会让它与 width/height 不一致（NEW-5）
o["texHeight"] = tex.height;
o["texFormat"] = tex.format.ToString();
o["texFilterMode"] = tex.filterMode.ToString();
o["mipmapCount"] = tex.mipmapCount;
o["hasSprite"] = sp != null;
o["guid"] = AssetDatabase.AssetPathToGUID(p);
var root = new Newtonsoft.Json.Linq.JObject();
root["__read"] = o;
return root.ToString(Newtonsoft.Json.Formatting.None);
```

静态自检（**不许**只看一眼就过）：`grep -n "spriteMeshType\|spriteExtrude\|TextureImporterSettings\|ImportAssetOptions" unity-scripts/asset-import.cs`
+ 通读一遍确认没有 `.summary == null` 式的 struct 比较、没有 `UnityEditor.SpriteMeshType`、`spriteExtrude` 用了 `uint`。

> **uloop 动态代码的 4 条已核实事实**（来源：vendor `uloopmcp/Editor/FirstPartyTools/ExecuteDynamicCode/DynamicCompilation/WrapperTemplate.cs`，2026-09-20 实读）：
> ① 脚本体被包进 `async Task<object> ExecuteAsync(Dictionary<string,object> parameters, CancellationToken ct)` **方法体**里
> → **可以在顶层 `return`**（本仓库所有 `.cs` 都靠这点），但**不能在片段里写 `using`**（文件头部的 `using` 会被抽取成 using 指令）；
> ② 包装器**自动加** `using System; System.Linq; System.Collections.Generic; System.Threading; System.Threading.Tasks; UnityEngine; UnityEditor;`
> → `AssetDatabase` / `TextureImporter` / `TextureImporterSettings` / `ImportAssetOptions` / `PrefabUtility` 等**可以裸写**；
> ③ 它还会加两个**别名**：`Object` → `UnityEngine.Object`、`Random` → `UnityEngine.Random`
> → 片段里写 `Object` 指的是 **UnityEngine.Object**（要 `System.Object` 得写全）；
> ④ 局部函数不能加 `static`（会 CS8421）——本仓库每个 `.cs` 都踩过。

- [ ] **步骤 8：`bin/unity.js` 接线 + USAGE**

`asset` handler 改成同时接受 `write` / `import`（**保留 write 的原样分支**）：

```js
  asset: async (rest) => {
    const [action, ...opts] = rest;
    const { parseArgs } = require('../lib/args.js');
    const args = parseArgs(opts);
    const { emit, exitCodeFor } = require('../lib/envelope.js');   // R203：局部 require
    if (action === 'import') {
      const { assetImport } = require('../lib/importart.js');
      // 参数原样透传（不做兜底）：缺 / 裸写 true / 空串 / 枚举外取值
      // 全部由 lib/importart.js 在**任何写盘、任何 uloop 调用之前**判错。
      const e = await assetImport({
        projectPath: args['project-path'],
        from: args.from,
        to: args.to,
        force: args.force,
        removeBg: args['remove-bg'],
        tolerance: args.tolerance,
        trim: args.trim,
        fit: args.fit,
        ppu: args.ppu,
        maxSize: args['max-size'],
        filter: args.filter,
        compression: args.compression,
        pivot: args.pivot,
      });
      emit(e, { json: Boolean(args.json) });
      return exitCodeFor(e);
    }
    if (action !== 'write') {
      process.stderr.write('usage: unity asset write --to <Assets/...> (--from <file>|--template <name>) [--force] [--no-compile]\n'
        + '       unity asset import --from <本地png> --to <Assets/...> [--force] [--remove-bg auto|#RRGGBB]\n'
        + '                           [--tolerance <0-255>] [--trim] [--fit <w,h>] [--ppu <n>] [--max-size <n>]\n'
        + '                           [--filter point|bilinear] [--compression none|normal] [--pivot <x,y>]\n');
      return EXIT_USAGE;
    }
    const { assetWrite } = require('../lib/asset.js');
    const e = await assetWrite({ ... });   // ← 原样保留，一行不动
    emit(e, { json: Boolean(args.json) });
    return exitCodeFor(e);
  },
```

USAGE 字符串里在 `asset write 选项：` 之后插入一整段（**照 `sprite set` 段的风格**）：

```
asset import 选项：
  asset import           把宿主上的 PNG 落进项目并配置为像素画 Sprite（**写**后读回：11 项导入设置
                         + 真实纹理尺寸/格式 + 磁盘 sha256）
                         ⚠️ 与 `asset write` 的区别：那个不触发导入（写完没有 .meta），
                            而它的 compile 副作用会用**错设置**（Bilinear/压缩/PPU=100/Tight）导入
    --from <本地png>      必填：宿主上的源图（**绝对路径**最稳）
    --to <Assets/...>     必填：项目内目标路径（Assets/ 开头、不含 ..）
    --force               目标已存在时必须显式给（覆盖已有美术资产要先问用户，skill §5）
    --remove-bg <v>       auto（按四角推断背景色）或 #RRGGBB；不给则不做去底
                         ⚠️ 像素处理只在 **Node 侧**发生（Unity 没有去底 API；alphaIsTransparency 会改写透明像素 RGB）
    --tolerance <0-255>   去底容差（默认 40，仅在给了 --remove-bg 时有意义）
    --trim                裁掉全透明的外边（去底之后用）
    --fit <w,h>           contain-fit 到该画布（最近邻，保持比例，空白透明）
    --ppu <n>             每世界单位多少像素（默认 16；Unity 默认的 100 会让小图小到看不见）
    --max-size <n>        Unity 的 maxTextureSize；**小于源尺寸会被静默缩放**（24×16 + 8 → 8×5）
                         → 本命令自动抬到 >= max(w,h) 的 2 的幂，并读回真实尺寸兜底
    --filter <point|bilinear>        默认 point（像素画不糊）
    --compression <none|normal>      默认 none（压缩会糊成 DXT 块）
    --pivot <x,y>                    0–1 的精灵轴心；给了就落 Custom(9)，不给是 Center
                         退出码：0 成功且 verified:true / 1 运行时错（SOURCE_NOT_FOUND / BAD_PNG /
                         BACKGROUND_AMBIGUOUS / ART_FULLY_TRANSPARENT / ASSET_EXISTS / TEXTURE_TOO_LARGE /
                         WRITE_FAILED / 读回不一致 verified:false / IMPORTER_NOT_FOUND）/ 2 用法错
                         （缺 --from → MISSING_FILE；--to 缺失 → MISSING_TO、非法 → BAD_TARGET_PATH；
                          --ppu/--max-size/--filter/--compression/--remove-bg/--fit/--pivot/--tolerance → BAD_*）
  成功时 actual 带：asset（读回的全部设置 + 真实纹理尺寸）、art（推断出的背景色/裁剪框/警告）、
                    file（落盘 sha256 与字节数）、maxTextureSizeRaisedFrom（被自动抬升时的原值）
```

并在 `示例：` 段补两行：

```bash
  unity asset import --project-path C:/my-game --from C:/pic/hero.png --to Assets/Art/hero.png --remove-bg auto --trim --ppu 16 --json
  unity asset import --project-path C:/my-game --from C:/pic/tiles.png --to Assets/Art/tiles.png --fit 64,64 --json
```

- [ ] **步骤 9：运行测试 + 全量**

```bash
node --test test/assetpath.test.js test/importart.test.js
node bin/unity.js version
npm test 2>&1 | tail -8
```

预期：新用例全绿；全量 `# tests` = 456 + 4(assetpath) + 13(importart) + 1(envelope 成员) + 0(既有不变) ≈ **474**（以实际为准，只增不减）。
若有**既有**用例变红：只允许改「断言了 USAGE 里命令清单全等」或「membership 列表」这两类，**其它一律视为实现 bug**。

- [ ] **步骤 10：造 E2E 用的「用户供图」脚本（进仓库，零依赖）**

创建 `scripts/make-m4-fixture.js`（`scripts/` 目录在新检出里不存在，`mkdir -p scripts` 由本步骤建立）：

```js
#!/usr/bin/env node
'use strict';
/**
 * 生成 M4 的「用户供图」PNG：24×16、**不透明绿底** #00FF00、居中一块 6×4 的三色主体。
 *
 * 为什么要有它：M4 的验收要从「用户给的、带纯色背景的图」开始，而这张图必须**可复现**
 * （E2E 与真机步骤都引用它）→ 用零依赖的 `lib/png.js` 编码器现场生成，不入库二进制。
 * 事实（断言用）：背景 #00FF00；主体 bbox = x 9..14 / y 6..9（6×4）；
 * 主体左 2 列 #FF2E88、中 2 列 #FFE94A、右 2 列 #4DFF7A；全图无 alpha=0 的像素。
 * 用法：node scripts/make-m4-fixture.js [输出路径]
 */
const fs = require('node:fs');
const path = require('node:path');
const { encodePng } = require('../lib/png.js');

const W = 24;
const H = 16;
const data = Buffer.alloc(W * H * 4);
const set = (x, y, r, g, b) => {
  const o = (y * W + x) * 4;
  data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
};
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (x >= 9 && x <= 14 && y >= 6 && y <= 9) {
      const band = x <= 10 ? [255, 46, 136] : x <= 12 ? [255, 233, 74] : [77, 255, 122];
      set(x, y, band[0], band[1], band[2]);
    } else {
      set(x, y, 0, 255, 0);
    }
  }
}
const out = process.argv[2] || path.join(__dirname, '..', '.superpowers', 'sdd', '2026-09-20-pi-unity-m4-exec', 'fixtures', 'hero.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng({ width: W, height: H, data }));
process.stdout.write(`${out}\n`);
process.stdout.write('背景 #00FF00 / 主体 bbox 9,6,6,4 / 去底+裁边后 = 6x4\n');
```

自检：`node scripts/make-m4-fixture.js /tmp/hero.png && node -e "const{decodePng}=require('./lib/png.js');const i=decodePng(require('fs').readFileSync('/tmp/hero.png'));console.log(i.width,i.height)"` → 期望 `24 16`。

- [ ] **步骤 11：真机（必需；`.cs` 新脚本不真机不算完成）**

准备（**单座席门检**）：

```bash
tasklist | grep -iE "^Tuanjie.exe|^Unity.exe" || echo "没有编辑器在跑"
# 没有就拉起来（U6：uloop launch 起不了团结）：
cmd //c start "" "<引擎安装目录>/2022.3.62t9/Editor/Tuanjie.exe" -projectPath C:/Users/<用户>/pi-unity-spike/S0Project
export PI_UNITY_ULOOP_BIN="C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe"
P="C:/Users/<用户>/pi-unity-spike/S0Project"
node bin/unity.js doctor --project-path "$P"     # editor-connection 必须 pass
```

**造两张「用户供图」**（其中一张**故意用别的编码器**，证明我们能吃外部 PNG）：

```bash
mkdir -p .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures
node scripts/make-m4-fixture.js .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero.png
powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; \
  \$b = New-Object System.Drawing.Bitmap(32,24); \
  \$g = [System.Drawing.Graphics]::FromImage(\$b); \$g.Clear([System.Drawing.Color]::FromArgb(255,0,255,0)); \
  \$br = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,46,136)); \
  \$g.FillRectangle(\$br, 10, 8, 12, 8); \$g.Dispose(); \$br.Dispose(); \
  \$b.Save('C:/Users/<用户>/.pi/agent/git/<内部 git 服务器>/pi/pi-unity-m4/.superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-gdi.png', [System.Drawing.Imaging.ImageFormat]::Png); \$b.Dispose()"
```

> ⚠️ **计色必须对齐**：这张 GDI 图的主体色是 **`#FF2E88`**（`FromArgb(255,46,136)`），与
> `scripts/make-m4-fixture.js` 的左列同色 —— 任务 4/5/6/8 里的 `pixels --count-color '#FF2E88'` 全靠这一点。
> **不许**用 `Brushes.DeepPink`（它是 `#FF1493`，绿通道比 `#FF2E88` 高 26 > `--tolerance 16` → count 恒为 0，
> 会被误读成「画面里没有这张图」）。

真机四连（**逐条记录 exit code 与完整 `--json`**）：

```bash
# ① happy path（GDI+ 造的外部 PNG：绿底 + 品红矩形，去底 auto + trim → 12x8）
node bin/unity.js asset import --project-path "$P" --from .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-gdi.png \
  --to Assets/M4Probe/hero.png --remove-bg auto --trim --ppu 16 --json > .superpowers/sdd/2026-09-20-pi-unity-m4-exec/real-machine/task3-happy.json; echo "exit=$?"
#   期望：exit 0；verified true；actual.asset.width/height = 12/8；actual.art.removeBg.keyColor="#00FF00"；
#         actual.art.trimmed = {left:10,top:8,width:12,height:8}；hasSprite true；filterMode/texFilterMode Point
#         ⚠️ R388：`texFormat` 由**画布内容**决定 —— 全不透明 → `RGB24`（Unity 丢掉恒定 alpha 通道）；
#            带透明像素 → `RGBA32`。它**不在 intent/读回口径内**（仅 informational）→ 不要把它当判据。
python -c "import json;d=json.load(open('.superpowers/sdd/2026-09-20-pi-unity-m4-exec/real-machine/task3-happy.json'));print(d['verified'],d['actual']['asset']['width'],d['actual']['art']['removeBg']['keyColor'],d['actual']['file']['sha256'][:12])"
# ② 磁盘独立复核（不信信封）：文件在、.meta 在、sha256 与信封一致
node -e "const fs=require('fs'),c=require('crypto');const p='$P/Assets/M4Probe/hero.png';const b=fs.readFileSync(p);console.log('bytes',b.length,'sha',c.createHash('sha256').update(b).digest('hex').slice(0,12),'meta',fs.existsSync(p+'.meta'))"
# ③ 静默缩放陷阱：不裁边的 32x24 + --max-size 8 → 必须抬到 32 且真实纹理仍是 32x24
node bin/unity.js asset import --project-path "$P" --from .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-gdi.png \
  --to Assets/M4Probe/full.png --max-size 8 --json > .superpowers/sdd/2026-09-20-pi-unity-m4-exec/real-machine/task3-maxsize.json; echo "exit=$?"
#   期望：exit 0；intent.asset.maxTextureSize=32；actual.asset.texWidth/texHeight=32/24；actual.maxTextureSizeRaisedFrom=8
# ④ 幂等/覆盖与新码：再跑①（无 --force）→ exit 1 ASSET_EXISTS；跑 --remove-bg '#123456'（背景是绿的）→ exit 0 + warning 非空
node bin/unity.js asset import --project-path "$P" --from .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-gdi.png \
  --to Assets/M4Probe/hero.png --remove-bg auto --trim --json > .superpowers/sdd/2026-09-20-pi-unity-m4-exec/real-machine/task3-exists.json; echo "exit=$?"
#   期望：exit 1、code=ASSET_EXISTS（且磁盘内容未变）
# ⑤ **未探测面的观测**（不是断言，只为把事实记进报告）：
#    a) 不给 --pivot 时读回的 spriteAlignment/spritePivotX/Y 到底是什么（M4-SPIKE 只验过 Custom(9) 的情形）
node bin/unity.js asset import --project-path "$P" --from .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-gdi.png \
  --to Assets/M4Probe/nopivot.png --remove-bg auto --trim --force --json > .superpowers/sdd/2026-09-20-pi-unity-m4-exec/real-machine/task3-nopivot.json; echo "exit=$?"
node -e "const d=require('./.superpowers/sdd/2026-09-20-pi-unity-m4-exec/real-machine/task3-nopivot.json');console.log('verified',d.verified,'alignment',d.actual.asset.spriteAlignment,'pivot',d.actual.asset.spritePivotX,d.actual.asset.spritePivotY)"
#    → 把这三个值写进报告（若 alignment !== 0，说明 intent 里不做断言是对的；若确实 === 0，下一轮可以把它们加回 intent）
#    b) --pivot 0.25,0.75（已探测的情形，应当 verified:true）
node bin/unity.js asset import --project-path "$P" --from .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-gdi.png \
  --to Assets/M4Probe/pivot.png --remove-bg auto --trim --pivot 0.25,0.75 --force --json > .superpowers/sdd/2026-09-20-pi-unity-m4-exec/real-machine/task3-pivot.json; echo "exit=$?"
#    c) --tolerance 0 合法（背景恰好是纯色）
node bin/unity.js asset import --project-path "$P" --from .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-gdi.png \
  --to Assets/M4Probe/tol0.png --remove-bg auto --tolerance 0 --trim --force --json > .superpowers/sdd/2026-09-20-pi-unity-m4-exec/real-machine/task3-tol0.json; echo "exit=$?"
#    d) **带透明背景的源图**（不给 --remove-bg，直接 trim）：这条路径单测覆盖了，真机也跑一次
powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; \
  \$b = New-Object System.Drawing.Bitmap(20,12); \
  \$g = [System.Drawing.Graphics]::FromImage(\$b); \$g.Clear([System.Drawing.Color]::Transparent); \
  \$br = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,46,136)); \
  \$g.FillRectangle(\$br, 4, 3, 8, 6); \$g.Dispose(); \$br.Dispose(); \
  \$b.Save('C:/Users/<用户>/.pi/agent/git/<内部 git 服务器>/pi/pi-unity-m4/.superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-alpha.png', [System.Drawing.Imaging.ImageFormat]::Png); \$b.Dispose()"
node bin/unity.js asset import --project-path "$P" --from .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-alpha.png \
  --to Assets/M4Probe/alpha.png --trim --ppu 16 --json > .superpowers/sdd/2026-09-20-pi-unity-m4-exec/real-machine/task3-alpha.json; echo "exit=$?"
#   期望：exit 0、verified true、actual.asset.width/height = 8/6（trim 掉透明边）、art.removeBg = null
```

**若 `verified:false` 或 `.cs` 编译错**：把完整报文贴进报告，**不要**自己改测试去迁就实现；按 `docs/PITFALLS.md` 末尾追加一条（不写 U 编号、标引擎），再修。

清理（真机验证不得污染项目）：

```bash
node bin/unity.js exec --project-path "$P" --code 'AssetDatabase.DeleteAsset("Assets/M4Probe"); return AssetDatabase.IsValidFolder("Assets/M4Probe") ? "STILL_THERE" : "GONE";' --json
```

- [ ] **步骤 12：提交**

```bash
git add lib/assetpath.js lib/importart.js lib/asset.js lib/envelope.js bin/unity.js unity-scripts/asset-import.cs scripts/make-m4-fixture.js test/assetpath.test.js test/importart.test.js test/envelope.test.js
git commit -m "feat(asset): unity asset import —— 宿主 PNG 落库 + 11 项导入设置 + 写后读回（含静默缩放防线）"
```

---
### 任务 4：`unity sprite assign`（把**资产** sprite 挂到节点）+ `node-inspect` 读回面扩展

**文件：**
- 创建：`unity-scripts/sprite-assign.cs`、`test/sprite-assign.test.js`
- 修改：`lib/sprite.js`（新增 `spriteAssign`，`spriteSet` **一行不改**）、`unity-scripts/node-inspect.cs`（sprite 子对象 **additive** 三字段）、`lib/envelope.js` + `test/envelope.test.js`（3 个新用法码）、`bin/unity.js`（`sprite assign` dispatch + USAGE）

> **为什么必须新命令（D-M4-1）**：`sprite set` 造的是**运行时对象**（`HideAndDontSave`），
> 进 PlayMode 的 domain reload 就销毁（SKILL §3.5 有血泪记录）→「用户供图 → 画面里看得见」必须走
> **资产引用**（`AssetDatabase.LoadAssetAtPath<Sprite>`），它会被场景/Prefab 序列化、能随交付物走。

- [ ] **步骤 1：新增 3 个用法码**

`lib/envelope.js` 的 `USAGE_FAILURE_CODES` 在 `'BAD_SIZE', 'BAD_SOURCE', 'BAD_TARGET_PATH',` 之后补：

```js
  'MISSING_ASSET', 'BAD_ASSET_PATH', 'BAD_WORLD_SIZE',
```

`test/envelope.test.js` 的成员断言里同步加这 3 个 —— ⚠️ **按字母序插入**（那里是排序后 `deepStrictEqual`）：
`BAD_ASSET_PATH` 紧跟 `BAD_ACTION`；`BAD_WORLD_SIZE` 紧跟 `BAD_WINDOW_NAME`；`MISSING_ASSET` 紧跟 `EMPTY_PATCH`。
运行 `node --test test/envelope.test.js` → PASS。

- [ ] **步骤 2：编写失败的测试**

创建 `test/sprite-assign.test.js`：

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { spriteAssign } = require('../lib/sprite.js');
const { exitCodeFor } = require('../lib/envelope.js');

function fakeCall(json, spy = []) {
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}
/** 按调用序回放（1 = sprite-assign 写，2 = node-inspect 读回）。 */
function sequenceCall(results, spy = []) {
  let n = 0;
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    const json = results[Math.min(n, results.length - 1)];
    n++;
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

const ASSET = 'Assets/Art/hero.png';
const WRITTEN = { Success: true, Result: JSON.stringify({ __written: true }) };
const READBACK = {
  name: 'Brick_0_0', active: true, path: 'Brick_0_0',
  components: ['Transform', 'SpriteRenderer'],
  position: { x: 0, y: 0, z: 0 }, scale: { x: 2.1333333, y: 2.1333333, z: 1 },
  sprite: {
    present: true, color: { r: 255, g: 255, b: 255, a: 255 },
    sortingOrder: 0, sortingLayerName: 'Default', spriteName: 'hero',
    assetPath: ASSET, ppu: 16, worldSize: { x: 1.6, y: 1.2 },
  },
};
const inspectEnvelope = (patch = {}) => ({
  Success: true,
  Result: JSON.stringify({ ...READBACK, sprite: { ...READBACK.sprite, ...patch } }),
});

test('spriteAssign：缺/裸 --path → MISSING_PATH，零调用', async () => {
  for (const p of [undefined, '', true]) {
    const spy = [];
    const e = await spriteAssign({ projectPath: 'P', path: p, asset: ASSET, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'MISSING_PATH');
    assert.strictEqual(exitCodeFor(e), 2);
    assert.strictEqual(spy.length, 0);
  }
});

test('spriteAssign：缺/非法 --asset → MISSING_ASSET / BAD_ASSET_PATH，零调用', async () => {
  const spy = [];
  for (const asset of [undefined, true, '']) {
    const e = await spriteAssign({ projectPath: 'P', path: 'N', asset, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'MISSING_ASSET', JSON.stringify(asset));
    assert.strictEqual(exitCodeFor(e), 2);
  }
  for (const asset of ['Art/a.png', 'Assets/../a.png', '/Assets/a.png']) {
    const e = await spriteAssign({ projectPath: 'P', path: 'N', asset, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'BAD_ASSET_PATH', asset);
    assert.strictEqual(exitCodeFor(e), 2);
  }
  assert.strictEqual(spy.length, 0);
});

test('spriteAssign：非法 --world-size → BAD_WORLD_SIZE，零调用', async () => {
  for (const bad of ['1.6', 'a,b', '1,2,3', '0,1', '-1,2', true]) {
    const spy = [];
    const e = await spriteAssign({ projectPath: 'P', path: 'N', asset: ASSET, worldSize: bad, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'BAD_WORLD_SIZE', JSON.stringify(bad));
    assert.strictEqual(exitCodeFor(e), 2);
    assert.strictEqual(spy.length, 0);
  }
});

test('spriteAssign：happy path —— intent 带 assetPath/worldSize，写载荷不带 sprite 外壳', async () => {
  const spy = [];
  const call = sequenceCall([WRITTEN, inspectEnvelope()], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, worldSize: '1.6,1.2', _call: call });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(exitCodeFor(e), 0);
  // intent **不含 ppu**：PPU 来自资产自身，JS 侧无从得知（读回面的 sprite.ppu 只进 actual）
  assert.deepStrictEqual(e.intent, { sprite: { assetPath: ASSET, worldSize: { x: 1.6, y: 1.2 } } });
  const payload = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.deepStrictEqual(payload, { path: 'Brick_0_0', asset: ASSET, worldSize: { x: 1.6, y: 1.2 } });
  assert.strictEqual(payload.sprite, undefined);
});

test('spriteAssign：不给 --world-size → intent 只有 assetPath（不动缩放），载荷无 worldSize', async () => {
  const spy = [];
  const call = sequenceCall([WRITTEN, inspectEnvelope()], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, _call: call });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.deepStrictEqual(e.intent, { sprite: { assetPath: ASSET } });
  const payload = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.strictEqual(payload.worldSize, undefined);
});

test('spriteAssign：节点没挂上资产（assetPath=null）→ verified:false + key sprite.assetPath', async () => {
  const spy = [];
  const call = sequenceCall([WRITTEN, inspectEnvelope({ assetPath: null })], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, _call: call });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.mismatches.map((m) => m.key).includes('sprite.assetPath'), JSON.stringify(e.mismatches));
});

test('spriteAssign：世界尺寸读回不符（父级有缩放等）→ verified:false + key sprite.worldSize.x', async () => {
  const spy = [];
  const call = sequenceCall([WRITTEN, inspectEnvelope({ worldSize: { x: 3.2, y: 1.2 } })], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, worldSize: '1.6,1.2', _call: call });
  assert.strictEqual(e.verified, false);
  assert.ok(e.mismatches.map((m) => m.key).includes('sprite.worldSize.x'), JSON.stringify(e.mismatches));
});

test('spriteAssign：.cs 报 SPRITE_NOT_FOUND → 失败信封 + 查错 hint（不产 ok:true）', async () => {
  const spy = [];
  const call = sequenceCall([{ Success: true, Result: JSON.stringify({ __error: 'SPRITE_NOT_FOUND', asset: ASSET }) }], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'SPRITE_NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.hint.join(' ').includes('asset import'), e.hint.join(' | '));
});

test('spriteAssign：传输层截断 → ULOOP_TRUNCATED + 「先复核」hint', async () => {
  const call = async (tool, args) => ({
    code: 1, stdout: '', stderr: '', timedOut: true, drained: false, json: null, truncated: true, tool, args,
  });
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, _call: call });
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
  assert.ok(e.hint.some((h) => h.includes('复核')), e.hint.join(' | '));
});

test('sprite-assign.cs 的静态契约：父级缩放要除掉、`??` 不许用在 UnityEngine.Object 上、只在 sprite 为空时不动', () => {
  const cs = fs.readFileSync(require('node:path').join(__dirname, '..', 'unity-scripts', 'sprite-assign.cs'), 'utf8');
  assert.match(cs, /LoadAssetAtPath<Sprite>/, '必须走 AssetDatabase.LoadAssetAtPath<Sprite>');
  assert.match(cs, /lossyScale/, '父级缩放必须参与反算（否则挂到有缩放的父级下世界尺寸就错）');
  assert.match(cs, /worldSize/);
  assert.doesNotMatch(cs, /\?\?\s*go\.AddComponent|\?\?\s*new /, 'UnityEngine.Object 的「假 null」不能用 ?? 兜底');
  // 读回面契约：node-inspect.cs 的 sprite 子对象必须含这三个新字段（additive）
  const inspect = fs.readFileSync(require('node:path').join(__dirname, '..', 'unity-scripts', 'node-inspect.cs'), 'utf8');
  for (const key of ['assetPath', 'ppu', 'worldSize']) {
    assert.ok(inspect.includes(`sp["${key}"]`), `node-inspect.cs 的 sprite 子对象必须含 ${key}`);
  }
});
```

- [ ] **步骤 3：运行测试验证失败**

运行：`node --test test/sprite-assign.test.js`
预期：FAIL —— `spriteAssign is not a function`（最后一条静态契约用例也会红：`sprite-assign.cs` 不存在）

- [ ] **步骤 4：`.cs` —— 写脚本 + 扩展读回面**

创建 `unity-scripts/sprite-assign.cs`：

```csharp
// unity-scripts/sprite-assign.cs
// 入参：parameters["param0"] = {"path":"Brick_0_0","asset":"Assets/Art/hero.png","worldSize":{"x":1.6,"y":0.5}}
//   asset 必须是 **Assets/ 下的资产路径**（.png 需已被 `unity asset import` 配成 Sprite/Single）
//   worldSize 可选：给了就把 localScale 反算成「该 sprite 在**世界空间**里正好 x×y」
// 出参：成功 {"__written":true}；失败 {"__error":"BAD_PAYLOAD"|"NOT_FOUND"|"SPRITE_NOT_FOUND"|"COMPONENT_ADD_FAILED"}
// ⚠️ 本脚本**不做验证**：是否真的挂上、世界尺寸对不对，由 lib/sprite.js 读回 node-inspect.cs 比对（verified 布尔）。
//
// ⚠️ 与 `sprite set` 的本质区别：那个造的是**运行时** 1x1 sprite（HideAndDontSave，进 PlayMode 就没），
//   本脚本挂的是**资产**引用（会被场景/Prefab 序列化、能随交付物走）。这条区别是 M4 的立身之本。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var p = (string)req["path"];
var assetPath = (string)req["asset"];
if (string.IsNullOrEmpty(p) || string.IsNullOrEmpty(assetPath)) return "{\"__error\":\"BAD_PAYLOAD\"}";

var sp = AssetDatabase.LoadAssetAtPath<Sprite>(assetPath);
if (sp == null)
{
    var nf = new Newtonsoft.Json.Linq.JObject();
    nf["__error"] = "SPRITE_NOT_FOUND";
    nf["asset"] = assetPath;
    return nf.ToString(Newtonsoft.Json.Formatting.None);
}

// 同 node-inspect.cs：Find 找不到非激活对象，回退遍历当前激活场景的全部根对象（含 inactive）。
GameObject go = GameObject.Find(p);
if (go == null)
{
    string[] segs = p.Split('/');
    foreach (GameObject root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
    {
        GameObject hit = FindByPath(root.transform, segs, 0);
        if (hit != null) { go = hit; break; }
    }
}
if (go == null) return "{\"__error\":\"NOT_FOUND\"}";

var sr = go.GetComponent<SpriteRenderer>();
if (sr == null) sr = go.AddComponent<SpriteRenderer>();
if (sr == null)
{
    var addErr = new Newtonsoft.Json.Linq.JObject();
    addErr["__error"] = "COMPONENT_ADD_FAILED";
    addErr["component"] = "SpriteRenderer";
    return addErr.ToString(Newtonsoft.Json.Formatting.None);
}

sr.sprite = sp;

if (req["worldSize"] != null)
{
    var ws = req["worldSize"] as Newtonsoft.Json.Linq.JObject;
    if (ws != null)
    {
        var t = go.transform;
        // 父级缩放必须除掉：lossyScale 是父链累积缩放；不除的话挂到有缩放的父级下
        // 「世界尺寸」就不等于用户要的值（读回 sr.bounds.size 会立刻暴露 → verified:false）。
        Vector3 parentScale = t.parent != null ? t.parent.lossyScale : Vector3.one;
        Vector3 b = sp.bounds.size;                       // 精灵自身在「世界单位」下的尺寸（= 纹理尺寸 / PPU）
        float wantX = (float)ws["x"];
        float wantY = (float)ws["y"];
        float sx = (b.x > 0f && Mathf.Abs(parentScale.x) > 0f) ? wantX / (b.x * Mathf.Abs(parentScale.x)) : t.localScale.x;
        float sy = (b.y > 0f && Mathf.Abs(parentScale.y) > 0f) ? wantY / (b.y * Mathf.Abs(parentScale.y)) : t.localScale.y;
        t.localScale = new Vector3(sx, sy, t.localScale.z);
    }
}
return "{\"__written\":true}";

// ⚠️ 不能加 static（uloop 会把字面量提升成外层局部变量，静态局部函数引用会 CS8421）。
GameObject FindByPath(Transform t, string[] segs, int i)
{
    if (t.name != segs[i]) return null;
    if (i == segs.Length - 1) return t.gameObject;
    for (int k = 0; k < t.childCount; k++)
    {
        GameObject hit = FindByPath(t.GetChild(k), segs, i + 1);
        if (hit != null) return hit;
    }
    return null;
}
```

改 `unity-scripts/node-inspect.cs`：在 `sp["spriteName"] = sr.sprite != null ? sr.sprite.name : null;` 之后插入（**既有字段一行不改**）：

```csharp
    // M4（additive）：资产 sprite 的读回面 —— `unity sprite assign` 的验证依赖它。
    // assetPath：运行时 sprite（`sprite set` 造的）返回 "" → 写成 JSON null，
    //   于是「intent 要资产 A、实际是运行时 sprite」会被 compareSubset 记成一条分歧（不是假绿）。
    //   ⚠️ `GetAssetPath(非资产对象) == ""` 是 **Unity 文档语义，未真机探测**（任务 4 的真机步骤⑥ 会实测记录）；
    //   若真机给出非空值，按实测改本行与测试。
    // ppu：精灵自己的 pixelsPerUnit（证明加载的确实是那张资产）。
    // worldSize：`sr.bounds.size` —— **世界空间的 AABB 尺寸**（父级缩放已含在内）。
    //   这是「这个节点在画面里到底多大」的唯一真值，也是 SKILL 里「localScale = 世界尺寸」
    //   那条旧说法在「父级有缩放 / sprite 是资产」两种情形下的修正口径。
    var spriteAssetPath = sr.sprite != null ? AssetDatabase.GetAssetPath(sr.sprite) : "";
    sp["assetPath"] = string.IsNullOrEmpty(spriteAssetPath) ? null : spriteAssetPath;
    sp["ppu"] = sr.sprite != null ? sr.sprite.pixelsPerUnit : 0f;
    sp["worldSize"] = new Newtonsoft.Json.Linq.JObject
    {
        ["x"] = sr.bounds.size.x,
        ["y"] = sr.bounds.size.y,
    };
```

- [ ] **步骤 5：JS —— `lib/sprite.js` 新增 `spriteAssign`**

在 `lib/sprite.js` 末尾（`module.exports` 之前）追加：

```js
/** `--asset` 必须是 Assets/ 下的项目内路径且不含 ..（与 `--to` 同一口径，但**不共用** normalizeAssetTo：
 *  那里的错误码是 MISSING_TO/BAD_TARGET_PATH，这里的 `--asset` 要有自己的码，否则 agent 分不清是
 *  「要写进去的目标」错还是「要读的资产」错）。 */
function isAssetPath(v) {
  return typeof v === 'string' && /^Assets\//.test(v.replace(/\\/g, '/')) && !v.includes('..');
}

/** `--world-size w,h`：两个 >0 的有限数。非法 → null。 */
function parseWorldSizeArg(v) {
  if (typeof v !== 'string') return null;
  const parts = v.split(',');
  if (parts.length !== 2) return null;
  const [x, y] = parts.map((s) => Number(s));
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return null;
  return { x, y };
}

/**
 * `unity sprite assign`：把**资产**里的 sprite 挂到节点（+ 可选世界尺寸），**写后读回**。
 *
 * intent 的形状就是读回路径的形状（`node-inspect.cs` 的 `sprite` 子对象）：
 * `{sprite: {assetPath, ppu[, worldSize:{x,y}]}}` → `compareSubset` 直接递归比对。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, path?: string, asset?: string,
 *   worldSize?: string, _call?: typeof call}} [opts]
 * @returns {Promise<object>} 信封（成功时 `verified` 为布尔）
 */
async function spriteAssign({ projectPath, env, path: nodePath, asset, worldSize, _call } = {}) {
  if (typeof nodePath !== 'string' || nodePath === '') {
    return fail({
      code: 'MISSING_PATH',
      message: '缺少 --path（形如 Bricks/Brick_0_0）',
      actual: { path: nodePath },
      hint: ['用 `unity scene tree` 取可用路径'],
    });
  }
  if (typeof asset !== 'string' || asset === '') {
    return fail({
      code: 'MISSING_ASSET',
      message: '缺少 --asset（必须是 Assets/ 下的图片资产路径）',
      actual: { asset },
      hint: ['用法：unity sprite assign --path Brick --asset Assets/Art/hero.png（先用 `unity asset import` 把它导入为 Sprite）'],
    });
  }
  if (!isAssetPath(asset)) {
    return fail({
      code: 'BAD_ASSET_PATH',
      message: `--asset 必须是 Assets/ 下的项目内路径且不含 ..：${JSON.stringify(asset)}`,
      actual: { asset },
      hint: ['用法：--asset Assets/Art/hero.png（**不是**宿主上的绝对路径 —— 那是 `asset import --from`）'],
    });
  }
  const ws = worldSize === undefined ? null : parseWorldSizeArg(worldSize);
  if (worldSize !== undefined && ws === null) {
    return fail({
      code: 'BAD_WORLD_SIZE',
      message: `--world-size 需要 w,h 两个正数，收到 ${JSON.stringify(worldSize)}`,
      actual: { worldSize },
      hint: ['用法：--world-size 1.6,0.5（单位是**世界单位**；不给则不改缩放）'],
    });
  }

  const assetPath = asset.replace(/\\/g, '/');
  const intent = { sprite: { assetPath } };
  const payload = { path: nodePath, asset: assetPath };
  if (ws) {
    intent.sprite.worldSize = { x: ws.x, y: ws.y };
    payload.worldSize = { x: ws.x, y: ws.y };
  }

  const callFn = _call || call;
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('sprite-assign', payload), { projectPath, env });
  } catch (err) {
    return fail({
      code: 'WRITE_CALL_FAILED',
      message: `sprite-assign 写调用失败：${(err && err.message) || String(err)}`,
      intent,
      hint: ['写入是否生效未知；用 `unity node inspect` 复核该节点的 sprite', '确认编辑器已打开目标项目（用 `unity doctor` 查看环境）'],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  if (!envl.ok) return withWriteRecheckHint(envl);
  const res = parseScriptResult(w, {
    label: 'sprite-assign',
    describeError: (code, parsed) => {
      if (code === 'NOT_FOUND') {
        return {
          message: `节点不存在：${nodePath}`,
          actual: { path: nodePath },
          hint: ['用 `unity scene tree` 查看可用路径', '仅查当前激活场景（含 inactive 节点）'],
        };
      }
      if (code === 'SPRITE_NOT_FOUND') {
        return {
          message: `资产里没有 Sprite：${(parsed && parsed.asset) || assetPath}`,
          actual: { asset: assetPath },
          hint: [
            '该 PNG 可能还没被导入为 Sprite/Single —— 用 `unity asset import` 导入它（它会显式配 textureType=Sprite）',
            '或路径写错/资产已被删除 —— 用 `unity exec --code \'return AssetDatabase.AssetPathToGUID("…");\'` 复核',
          ],
        };
      }
      return undefined;
    },
  });
  if (res.envelope) return res.envelope;

  return readBackAndVerify({
    projectPath,
    env,
    callFn,
    readPath: nodePath,
    intent,
    residue: '写入可能已生效；用 `unity node inspect` 复核该节点的 sprite（assetPath/ppu/worldSize）',
    mismatchHint: '读回与意图不一致（verified:false）——assetPath 为 null 说明没挂上资产；worldSize 不符说明父级有缩放/旋转；逐条查 mismatches',
    // ⚠️ intent **只含 assetPath[/worldSize]**：读回面还会带 `ppu`/`spriteName`/`color`…，那些只进 actual。
    //    尤其 **ppu 不能进 intent** —— 值来自资产自身，JS 侧无从得知；想在 JS 侧断言它就是要重实现 Unity 的 PPU 语义。
  });
}

// R251 纪律：`isValidColor` **不导出**（全仓库无外部消费者）。`parseWorldSizeArg` 导出**仅供测试**直测边界。
module.exports = { spriteSet, spriteAssign, parseWorldSizeArg };
```

- [ ] **步骤 6：`bin/unity.js` 接线 + USAGE**

`sprite` handler 里 `if (action !== 'set')` 那个分支改成同时接受 `assign`（`set` 分支**一行不动**）：

```js
    if (action === 'assign') {
      const { spriteAssign } = require('../lib/sprite.js');
      const e = await spriteAssign({
        projectPath: args['project-path'],
        path: args.path,
        asset: args.asset,
        worldSize: args['world-size'],
      });
      emit(e, { json: Boolean(args.json) });
      return exitCodeFor(e);
    }
    if (action !== 'set') {
      process.stderr.write('usage: unity sprite set --path <p> --color <#hex> [--sorting-order <n>]\n'
        + '       unity sprite assign --path <p> --asset <Assets/...png> [--world-size <w,h>]\n');
      return EXIT_USAGE;
    }
```

USAGE 里在 `sprite set 选项：` 段之后插入：

```
sprite assign 选项：
  --path <p>            必填：目标节点路径
  --asset <Assets/...>  必填：**项目内**的图片资产（先用 `unity asset import` 导入为 Sprite）
  --world-size <w,h>    可选：把 localScale 反算成「该 sprite 在世界空间里正好 w×h」
                        （父级有缩放时会自动除掉；不给则**不动**缩放）
                        ⚠️ 与 `sprite set` 的区别：那个造的是**运行时** sprite（进 PlayMode 就没），
                           本命令挂的是**资产**引用（会被场景/Prefab 序列化、能随交付物走）
                        ⚠️ 读回口径：`unity node inspect` 的 `sprite.worldSize` 是**世界空间 AABB 尺寸**
                           （= 精灵 bounds × 缩放），不是 localScale —— SKILL §3.5 的
                           「localScale = 世界尺寸」只对 `sprite set` 造的 1×1 且父级无缩放时成立
                        退出码：0 成功且 verified:true / 1 运行时错（NOT_FOUND / SPRITE_NOT_FOUND /
                        COMPONENT_ADD_FAILED / 读回不一致 verified:false）/ 2 用法错
                        （缺 --path → MISSING_PATH；缺 --asset → MISSING_ASSET；非法 → BAD_ASSET_PATH；
                         --world-size 非法 → BAD_WORLD_SIZE）
```

- [ ] **步骤 7：运行测试 + 全量**

```bash
node --test test/sprite-assign.test.js test/sprite.test.js test/envelope.test.js
node bin/unity.js version
npm test 2>&1 | tail -8
```

预期：新用例全绿；`test/sprite.test.js`（265 行既有）**一条都不改也全绿**（additive 扩展）；全量只增不减。

- [ ] **步骤 8：真机（必需）**

```bash
tasklist | grep -iE "^Tuanjie.exe|^Unity.exe"
export PI_UNITY_ULOOP_BIN="C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe"
P="C:/Users/<用户>/pi-unity-spike/S0Project"
R=.superpowers/sdd/2026-09-20-pi-unity-m4-exec/real-machine
# ① 先把图导进去（任务 3 的命令），再建节点、挂资产、读回
node bin/unity.js asset import --project-path "$P" --from .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-gdi.png \
  --to Assets/M4Probe/hero.png --remove-bg auto --trim --ppu 16 --json > $R/task4-import.json; echo "exit=$?"
node bin/unity.js node create --project-path "$P" --name SpriteProbe --components '["SpriteRenderer"]' --json > $R/task4-create.json; echo "exit=$?"
node bin/unity.js sprite assign --project-path "$P" --path SpriteProbe --asset Assets/M4Probe/hero.png \
  --world-size 1.6,1.2 --json > $R/task4-assign.json; echo "exit=$?"
#   期望：exit 0、verified true、intent.sprite.assetPath="Assets/M4Probe/hero.png"、intent.sprite.worldSize={1.6,1.2}
#         actual.sprite.worldSize ≈ {1.6,1.2}（容差 1e-4）、actual.sprite.ppu=16、actual.sprite.assetPath 同上
node bin/unity.js node inspect --project-path "$P" --path SpriteProbe --json > $R/task4-inspect.json; echo "exit=$?"
# ② 画面里真的看得见（**这是 M4 的核心判据**）：截图 → 数「主体色」的像素
node bin/unity.js play view --project-path "$P" --width 960 --height 640 --json > /dev/null
node bin/unity.js shot --project-path "$P" --out "$R/shots" --json > $R/task4-shot.json; echo "exit=$?"
SHOT=$(node -e "console.log(require('./$R/task4-shot.json').actual.path)")
node bin/unity.js pixels --file "$SHOT" --count-color '#FF2E88' --tolerance 16 --json > $R/task4-pixels.json; echo "exit=$?"
#   期望：exit 0；actual.count > 0（12x8 的品红矩形在 960x640 的 Game 视图里至少有几百像素）
# ③ 尺寸反算的真机反证：给一个**有缩放的父节点**（scale 2,2,1）再挂一次，世界尺寸仍须 ≈1.6x1.2
node bin/unity.js node create --project-path "$P" --name ParentScale --json > /dev/null
node bin/unity.js node set --project-path "$P" --path ParentScale --patch '{"scale":{"x":2,"y":2,"z":1}}' --json > /dev/null
node bin/unity.js node create --project-path "$P" --name ChildProbe --parent ParentScale --components '["SpriteRenderer"]' --json > /dev/null
node bin/unity.js sprite assign --project-path "$P" --path ParentScale/ChildProbe --asset Assets/M4Probe/hero.png \
  --world-size 1.6,1.2 --json > $R/task4-assign-scaled-parent.json; echo "exit=$?"
#   期望：exit 0 + verified true（lossyScale 已除掉）；若实现没除 → verified:false，这就是本步的意义
# ④ **未探测面观测**（不是断言，只为把事实记进报告）：运行时 sprite（`sprite set`）的 `assetPath` 是不是 null
node bin/unity.js node create --project-path "$P" --name RuntimeProbe --components '["SpriteRenderer"]' --json > /dev/null
node bin/unity.js sprite set --project-path "$P" --path RuntimeProbe --color '#00FF00' --json > $R/task4-spriteset.json; echo "exit=$?"
node bin/unity.js node inspect --project-path "$P" --path RuntimeProbe --json > $R/task4-runtime-inspect.json; echo "exit=$?"
node -e "const d=require('./$R/task4-runtime-inspect.json');console.log('assetPath',JSON.stringify(d.actual.sprite.assetPath),'worldSize',JSON.stringify(d.actual.sprite.worldSize),'ppu',d.actual.sprite.ppu)"
#   → assetPath 期望 null；把实际值写进报告（若不是 null，node-inspect.cs 那一行与 M4 的 intent 都要按实测改）
# ⑤ 清理（真机不得污染）：删节点 + 删资产，并读回确认
node bin/unity.js node delete --project-path "$P" --path RuntimeProbe --json > /dev/null; echo "exit=$?"
node bin/unity.js node delete --project-path "$P" --path SpriteProbe --json > $R/task4-del1.json; echo "exit=$?"
node bin/unity.js node delete --project-path "$P" --path ParentScale --json > $R/task4-del2.json; echo "exit=$?"
node bin/unity.js exec --project-path "$P" --code 'AssetDatabase.DeleteAsset("Assets/M4Probe"); return AssetDatabase.IsValidFolder("Assets/M4Probe") ? "STILL_THERE" : "GONE";' --json
# ⑥ 收尾：删掉刚才建的全部探针节点后，场景里不得留残留
node bin/unity.js scene tree --project-path "$P" --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('nodeCount',j.actual.nodeCount)})"
```

⚠️ 若 ③ 落 `verified:false`：**不要**改测试放宽容差 —— 那正是「父级缩放没除掉」的真实缺陷，改 `.cs`。

- [ ] **步骤 9：提交**

```bash
git add lib/sprite.js lib/envelope.js bin/unity.js unity-scripts/sprite-assign.cs unity-scripts/node-inspect.cs test/sprite-assign.test.js test/envelope.test.js
git commit -m "feat(sprite): unity sprite assign —— 资产 sprite 绑定 + 世界尺寸反算（含父级缩放）；node-inspect 读回面 additive 扩展"
```

---
### 任务 5：两个「必须先回答」的未知 —— 真机探测（产出 `docs/M4-PROBES.md`）

**文件：**
- 创建：`docs/M4-PROBES.md`（探测报告，**进仓库**）、`.superpowers/sdd/2026-09-20-pi-unity-m4-exec/probes/`（原始 JSON，gitignored）
- 不改任何源码/测试

> **性质**：这是**证据任务**（照 M3 的 `docs/M4-SPIKE.md` 形态）：交付物 = 一份**可复核的事实报告**，
> 由 spec 审查者核对「证据链是否闭合」。**不写代码、不写测试**。两个问题都来自
> `docs/M4-SPIKE.md` 的「未探测 / 存疑」节与 `docs/HANDOFF.md` §4.3。

- [ ] **步骤 1：探测 ①：全新 clone / 删 `Library/` 之后，资产引用会不会断**

**为什么要答**：`M4-SPIKE` Q4 实测「`.meta` 里的 guid 是 56 字符 base64、YAML 引用用 32-hex，**两套 id 独立**，
且该 hex 在磁盘上只出现在引用它的 YAML 里」→ **删 `Library/` 或全新 clone 时引用很可能会被重新指派而断开**（未验证）。
这条直接决定「交付物能否随仓库/压缩包迁移」以及 SKILL 要教用户怎么交付。

前置：编辑器开着 S0Project（单座席门检），`export PI_UNITY_ULOOP_BIN=...`。

```bash
P="C:/Users/<用户>/pi-unity-spike/S0Project"
R=.superpowers/sdd/2026-09-20-pi-unity-m4-exec/probes
mkdir -p $R
# ①-1 造一个「资产 + 引用它的场景」的最小现场
node bin/unity.js asset import --project-path "$P" --from .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-gdi.png \
  --to Assets/M4Probe/refprobe.png --remove-bg auto --trim --ppu 16 --json > $R/probeA-import.json; echo "exit=$?"
node bin/unity.js node create --project-path "$P" --name RefProbe --components '["SpriteRenderer"]' --json > $R/probeA-create.json
node bin/unity.js sprite assign --project-path "$P" --path RefProbe --asset Assets/M4Probe/refprobe.png --json > $R/probeA-assign.json
# 场景扩展名：**先看项目里已有场景的扩展名**（团结 S0Project = .scene；官方版只认 .unity）
ls "$P/Assets/Scenes/"
# ⚠️ `scene save --path X` 是「把**当前活动场景**另存到 X」→ **不要**写 SampleScene.scene（那会把 M3 那份
#    29 节点的验收场景盖成探针场景，并可能影响 `doctor --golden` 的基线）。用探针自有的场景名：
node bin/unity.js scene save --project-path "$P" --path Assets/M4Probe/ProbeScene.scene --json > $R/probeA-save.json; echo "exit=$?"
# ①-2 记录两块 id 与 YAML 里的引用（三份原始证据）
node bin/unity.js exec --project-path "$P" --json --code 'var g=AssetDatabase.AssetPathToGUID("Assets/M4Probe/refprobe.png"); var sp=AssetDatabase.LoadAssetAtPath<Sprite>("Assets/M4Probe/refprobe.png"); return "guid=" + g + "; spriteOk=" + (sp!=null);' > $R/probeA-ids-before.json
grep -o "guid: [0-9a-f]\{32\}" "$P/Assets/M4Probe/ProbeScene.scene" | sort -u > $R/probeA-scene-guids-before.txt
grep -m1 "^guid:" "$P/Assets/M4Probe/refprobe.png.meta" > $R/probeA-meta-guid-before.txt
node -e "const fs=require('fs');const p='$P/Assets/M4Probe/refprobe.png';const b=fs.readFileSync(p);console.log('png sha', require('crypto').createHash('sha256').update(b).digest('hex').slice(0,16))" | tee $R/probeA-png-sha.txt
```

**关掉编辑器**（必须 —— 单座席 + `Library/` 文件锁），然后把项目**除 `Library/` 等生成目录**之外复制一份：

```bash
tasklist | grep -iE "^Tuanjie.exe|^Unity.exe"          # 必须为空（或先手动关掉）
# robocopy：/XD 排除生成目录；退出码 1 = 「有文件被复制」，不是错误
robocopy "$P" "C:/Users/<用户>/pi-unity-spike/CloneProbe" /E /XD Library Temp obj Logs .uloop .vs /NFL /NDL /NJH /NJS; echo "robocopy-exit=$?"
ls "C:/Users/<用户>/pi-unity-spike/CloneProbe/Library" 2>/dev/null && echo "❌ Library 没排干净" || echo "✅ Library 已排除（= 全新 clone）"
# 重新拉起编辑器（**打开的是克隆**，不碰 S0Project 的 Library）
cmd //c start "" "<引擎安装目录>/2022.3.62t9/Editor/Tuanjie.exe" -projectPath C:/Users/<用户>/pi-unity-spike/CloneProbe
# 首次导入 + 44 asmdef 重新编译：等 1–3 分钟，然后
CP="C:/Users/<用户>/pi-unity-spike/CloneProbe"
node bin/unity.js doctor --project-path "$CP"          # editor-connection 必须 pass（说明编译完了）
# ⚠️ 克隆里**没有 Library** → 编辑器打开的可能是默认空场景 → 必须先显式打开探针场景，
#    否则 `node inspect` 会 NOT_FOUND，被误读成「引用断了」。
node bin/unity.js scene open --project-path "$CP" --path Assets/M4Probe/ProbeScene.scene --json > $R/probeA-clone-open.json; echo "exit=$?"
node bin/unity.js node inspect --project-path "$CP" --path RefProbe --json > $R/probeA-clone-inspect.json; echo "exit=$?"
#   关键判据：sprite.assetPath 是否为 "Assets/M4Probe/refprobe.png"、sprite.present 是否 true
node bin/unity.js exec --project-path "$CP" --json --code 'var g=AssetDatabase.AssetPathToGUID("Assets/M4Probe/refprobe.png"); return "guid=" + g;' > $R/probeA-ids-after.json
grep -o "guid: [0-9a-f]\{32\}" "$CP/Assets/M4Probe/ProbeScene.scene" | sort -u > $R/probeA-clone-scene-guids-after.txt
diff $R/probeA-scene-guids-before.txt $R/probeA-clone-scene-guids-after.txt && echo "✅ 场景 YAML 里的 guid 字面量没变"
# 克隆里的 PNG 是否还在、字节是否一致
node -e "const fs=require('fs');const p='$CP/Assets/M4Probe/refprobe.png';const b=fs.readFileSync(p);console.log('clone png sha', require('crypto').createHash('sha256').update(b).digest('hex').slice(0,16))"
```

- [ ] **步骤 2：把 ① 的结论写进报告（三种可能，都要有原始证据）**

在 `docs/M4-PROBES.md` 里逐条填：

| 观察 | 结论 | 对 SKILL/M4 的影响 |
|---|---|---|
| `node inspect` 的 `sprite.assetPath` 在克隆里**仍指向该文件**、且 `AssetPathToGUID` 的 hex **与克隆前相同** | **引用可随仓库迁移** | SKILL 可以教「资产与引用方一起提交即可交付」；`v0.7.0` 的 E2E 判据③ 含「克隆后仍渲染」 |
| `assetPath` 变 `null` / hex **变了** | **引用会断**（两套 id 的后果） | SKILL **必须**写明：交付/协作时把美术资产与引用它的场景/Prefab **同批**提交，或交付后**重跑 `sprite assign`** 重建引用；E2E 判据③ 降级为「同机重开仍渲染」并把「克隆后引用」记为已知缺陷 + backlog 项 |
| 介于两者之间（例如 hex 稳定但 `LoadAssetAtPath<Sprite>` 为 null、或需一次 reimport） | 如实写清**边界**（做了什么就活、没做什么就死） | 按实际情况给 SKILL 一条可操作规则 |

**必答项（报告里不许含糊）**：① hex 前后值；② `.meta` 的 base64 guid 前后值；③ 场景 YAML 里的 guid 字面量是否变化；
④ 克隆后 `node inspect` 的完整 `sprite` 子对象；⑤ **S0Project 的 `Library/` 全程未被删除**（探测用的是克隆）。

- [ ] **步骤 3：探测 ②：Prefab 覆盖的幂等性 + 实例化后的画面可见性**

**为什么要答**：`M4-SPIKE` 只证明了 `SaveAsPrefabAsset` + `InstantiatePrefab` **可达**（0.3 ms、引用/PPU 完整），
但**没证明**「往同一路径再存一次」的语义（guid 会不会变、内容会不会真的更新）与「实例化后 `pixels` 能断言到图」。
`unity prefab create --force` 的契约必须建立在真机事实上（任务 6 会引用本节的结论）。

仍然在 **S0Project**（把编辑器切回去；单座席：先关掉克隆那个）：

```bash
tasklist | grep -iE "^Tuanjie.exe|^Unity.exe"    # 关掉克隆的编辑器后应为空
cmd //c start "" "<引擎安装目录>/2022.3.62t9/Editor/Tuanjie.exe" -projectPath "$P"
export PI_UNITY_ULOOP_BIN="C:/Users/<用户>/pi-unity-spike/uloop-bin/uloop.exe"
P="C:/Users/<用户>/pi-unity-spike/S0Project"
R=.superpowers/sdd/2026-09-20-pi-unity-m4-exec/probes
# ②-1 造节点（带资产 sprite）并第一次存 Prefab
node bin/unity.js exec --project-path "$P" --json --code-file $R/probe-prefab-1.cs > $R/probeB-save1.json; echo "exit=$?"
node bin/unity.js exec --project-path "$P" --json --code-file $R/probe-prefab-read.cs > $R/probeB-read1.json
node -e "const fs=require('fs');const p='$P/Assets/M4Probe/PfProbe.prefab';const s=fs.statSync(p);console.log('size',s.size,'mtime',s.mtimeMs)"
grep -o "guid: [0-9a-f]\{32\}" "$P/Assets/M4Probe/PfProbe.prefab" | sort -u > $R/probeB-prefab-guids-1.txt
# ②-2 **改节点**（位置/缩放）后再存到**同一路径**（覆盖）→ 对比 guid / size / mtime / 读回内容
node bin/unity.js exec --project-path "$P" --json --code-file $R/probe-prefab-2.cs > $R/probeB-save2.json; echo "exit=$?"
node bin/unity.js exec --project-path "$P" --json --code-file $R/probe-prefab-read.cs > $R/probeB-read2.json
node -e "const fs=require('fs');const p='$P/Assets/M4Probe/PfProbe.prefab';const s=fs.statSync(p);console.log('size',s.size,'mtime',s.mtimeMs)"
grep -o "guid: [0-9a-f]\{32\}" "$P/Assets/M4Probe/PfProbe.prefab" | sort -u > $R/probeB-prefab-guids-2.txt
diff $R/probeB-prefab-guids-1.txt $R/probeB-prefab-guids-2.txt && echo "✅ 覆盖后引用 guid 没变（= 同名覆盖=更新）"
# ②-3 实例化 + **画面可见性**（M4 的核心判据，用 pixels 断言，不靠目视）
node bin/unity.js exec --project-path "$P" --json --code-file $R/probe-prefab-3-instantiate.cs > $R/probeB-instantiate.json; echo "exit=$?"
node bin/unity.js play view --project-path "$P" --width 960 --height 640 --json > /dev/null
node bin/unity.js shot --project-path "$P" --out "$R/shots" --json > $R/probeB-shot.json
SHOT=$(node -e "console.log(require('./$R/probeB-shot.json').actual.path)")
node bin/unity.js pixels --file "$SHOT" --count-color '#FF2E88' --tolerance 16 --json > $R/probeB-pixels.json
node -e "const d=require('./$R/probeB-pixels.json');console.log('count',d.actual.count,'ratio',d.actual.ratio)"
```

三个探针脚本（**建在 `.superpowers/.../probes/` 下，gitignored**；报告里贴完整源码）：

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

```csharp
// probe-prefab-2.cs —— 改「源节点」的 position/scale 后再存到**同一路径**（覆盖语义）
var go = GameObject.Find("PfProbe");
if (go == null) return "{\"__error\":\"NOT_FOUND\"}";
go.transform.position = new Vector3(-3f, -3f, 0f);
go.transform.localScale = new Vector3(4f, 4f, 1f);
var saved = PrefabUtility.SaveAsPrefabAsset(go, "Assets/M4Probe/PfProbe.prefab");
return "saved=" + (saved != null) + "; guid=" + AssetDatabase.AssetPathToGUID("Assets/M4Probe/PfProbe.prefab");
```

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

**结论表（必须逐行有原始证据）**：

| 问题 | 期望（写进任务 6 契约的假设） | 真机结果 |
|---|---|---|
| 覆盖同一路径：资产 guid 是否不变 | **不变**（= 「同名覆盖=更新」，美术返工安全） | 填 |
| 覆盖同一路径：**资产内容**是否真的更新 | **更新**（读回 position/scale 变成 -3,-3 / 4,4） | 填 |
| 覆盖后引用该资产的实例是否仍指向同一 PNG guid | **指向不变** | 填 |
| 实例化的对象：`spriteAssetPath` / `ppu` / `worldSize` | 与源节点一致 | 填 |
| 实例化后 `pixels --count-color` 能否数到图 | **count > 0** | 填 |
| 覆盖时旧实例（已 Instantiate 出来的）会不会跟着变 | 未探测就写「未探测」 | 填 |
| **（R416）Prefab 实例**上的 `position`/`scale`/`sprite` 改动能否活过 `scene save` + `scene open` | 在（否则需要补 `RecordPrefabInstancePropertyModifications`） | 填（见步骤 3b） |
| Prefab 变体 / 嵌套 Prefab / 断开连接 | **本轮不探测**（M4 不做） | 写「未探测」 |

**门槛（硬）**：若「覆盖后 guid 变了」或「覆盖后内容没更新」——**停下并上报控制者**（任务 6 的
`prefab create --force` 契约要重写），**不要**自行改契约往下做。

- [ ] **步骤 3b（R416，跨任务风险）：Prefab **实例**上改的属性会不会被 `scene save` 落盘？**

**为什么要答**（code-reviewer 在任务 4 审查里发现的）：全仓 `.cs` **没有任何** `PrefabUtility.RecordPrefabInstancePropertyModifications` / `EditorUtility.SetDirty`，而 `unity-scripts/scene-save.cs` 只调 `EditorSceneManager.SaveScene`。若 Unity 不自动登记 prefab 实例的 override，则在 **Prefab 实例节点**上跑 `sprite assign`（或 `node set --patch scale`）会 `verified:true`、但 `scene save` + 重开后**改动消失** —— 这恰好命中 M4 的卖点「资产引用能随交付物走」。**这条不依赖任务 6 的命令**（用任务 3 的 `asset import` + 任务 4 的 `sprite assign` + `unity exec` 手搓 `PrefabUtility` 即可）。

```bash
P="C:/Users/<用户>/pi-unity-spike/S0Project"
R=.superpowers/sdd/2026-09-20-pi-unity-m4-exec/probes
# 1) 导图 → 建源节点 → 挂资产 sprite → 存 Prefab（手搓 exec，因为任务 6 的命令还没写）
node bin/unity.js asset import --project-path "$P" --from .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-gdi.png --to Assets/M4Probe/pfinst.png --remove-bg auto --trim --ppu 16 --json > $R/probeB2-import.json
node bin/unity.js node create --project-path "$P" --name PfSrc --components '["SpriteRenderer"]' --json > $R/probeB2-create.json
node bin/unity.js sprite assign --project-path "$P" --path PfSrc --asset Assets/M4Probe/pfinst.png --json > $R/probeB2-assign.json
# 手搓存 Prefab + 实例化（一行 exec；任务 5 阶段还没有 prefab 命令）
node bin/unity.js exec --project-path "$P" --json --code 'var go=GameObject.Find("PfSrc"); var saved=PrefabUtility.SaveAsPrefabAsset(go,"Assets/M4Probe/PfInst.prefab"); var inst=PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>("Assets/M4Probe/PfInst.prefab")) as GameObject; inst.name="PfInst1"; inst.transform.position=new Vector3(-2f,-2f,0f); inst.transform.localScale=new Vector3(3f,3f,1f); return "saved="+(saved!=null)+"; inst="+(inst!=null)+"; isInstance="+PrefabUtility.IsPartOfPrefabInstance(inst);' > $R/probeB2-instantiate.json
# 2) 在**实例**上再改一次（走 CLI，模拟真实用法）
node bin/unity.js sprite assign --project-path "$P" --path PfInst1 --asset Assets/M4Probe/pfinst.png --world-size 1.6,1.2 --json > $R/probeB2-assign-inst.json
node bin/unity.js node inspect --project-path "$P" --path PfInst1 --json > $R/probeB2-inspect-before.json
# 3) 落盘 → 重新打开同一场景 → 再 inspect（**这一步才是判据**；场景名用探针自有的，别动 SampleScene）
node bin/unity.js scene save --project-path "$P" --path Assets/M4Probe/ProbeScene.scene --json > $R/probeB2-save.json
node bin/unity.js scene open --project-path "$P" --path Assets/M4Probe/ProbeScene.scene --json > $R/probeB2-open.json
node bin/unity.js node inspect --project-path "$P" --path PfInst1 --json > $R/probeB2-inspect-after.json
node -e "const a=require('./$R/probeB2-inspect-before.json').actual, b=require('./$R/probeB2-inspect-after.json').actual; const pick=(x)=>({p:x.position,s:x.scale,sp:x.sprite?x.sprite.assetPath:null,ws:x.sprite?x.sprite.worldSize:null}); console.log('BEFORE',JSON.stringify(pick(a))); console.log('AFTER ',JSON.stringify(pick(b))); console.log(JSON.stringify(pick(a))===JSON.stringify(pick(b)) ? '✅ 实例改动活过了 scene save/open' : '❌ 实例改动丢了（= 需要 RecordPrefabInstancePropertyModifications）');"
```

**结论表新增一行（必填）**：

| 问题 | 期望 | 真机结果 |
|---|---|---|
| Prefab **实例**上的 `position`/`scale`/`sprite` 改动，`scene save` + `scene open` 后是否仍在 | 在（否则必须补 `RecordPrefabInstancePropertyModifications`） | 填 |

**若丢了（= 判据失败）**：**不要**自行改 `.cs` —— 把这事实与最小复现写进报告，**停下上报控制者**（它会影响任务 6 的契约，并可能需要补一个「给 `sprite-assign.cs`/`node-set.cs` 加 `RecordPrefabInstancePropertyModifications`」的任务）。

- [ ] **步骤 4：清理 + 报告定稿 + 提交**

```bash
# 清理：删探针节点 + 探针资产（读回确认），S0Project 不得留残留
node bin/unity.js exec --project-path "$P" --json --code 'foreach (var n in new string[]{"PfProbe","PfProbeInstance","RefProbe"}) { var g=GameObject.Find(n); if (g!=null) UnityEngine.Object.DestroyImmediate(g); } AssetDatabase.DeleteAsset("Assets/M4Probe"); return "cleaned";'
node bin/unity.js scene tree --project-path "$P" --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('nodeCount',JSON.parse(s).actual.nodeCount))"
```

`docs/M4-PROBES.md` 结构（**照 `docs/M4-SPIKE.md` 的形态**）：
`> 性质/环境/来源/纪律` → `## 问题① …（方法 / 原始证据 / 结论 / 对 M4 的影响）` → `## 问题② …（同上）` →
`## 对任务 6 契约的直接影响（逐条）` → `## 未探测项`。
**纪律**：凡「未探测」一律写「未探测」，**不许**用推理补事实；原始 JSON 路径写进文末证据索引。

```bash
git add docs/M4-PROBES.md
git commit -m "docs(m4): 真机探测报告 —— 全新 clone 后引用是否断 + Prefab 覆盖幂等性与画面可见性"
```

---

### 任务 6：`unity prefab create|instantiate`

**文件：**
- 创建：`lib/prefab.js`、`unity-scripts/prefab-create.cs`、`unity-scripts/prefab-instantiate.cs`、`test/prefab.test.js`
- 修改：`bin/unity.js`（`prefab` dispatch + USAGE）

> **契约来源**：任务 5 的 `docs/M4-PROBES.md` 问题②。**若该文档的结论与下面的假设冲突 → 停下上报控制者。**
> 假设（来自 M4-SPIKE + 任务 5 待验）：① 同路径 `SaveAsPrefabAsset` = 覆盖且 **guid 不变、内容更新**；
> ② `InstantiatePrefab` 出来的实例带完整资产引用、`pixels` 能数到图。
> **新增用法码：0 个**（复用 `MISSING_PATH` / `MISSING_TO` / `BAD_TARGET_PATH` / `MISSING_ASSET` / `BAD_ASSET_PATH` / `ASSET_EXISTS`）。

- [ ] **步骤 1：编写失败的测试**

创建 `test/prefab.test.js`：

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { prefabCreate, prefabInstantiate } = require('../lib/prefab.js');
const { exitCodeFor } = require('../lib/envelope.js');

function sequenceCall(results, spy = []) {
  let n = 0;
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    const json = results[Math.min(n, results.length - 1)];
    n++;
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}
const nodeResult = (obj) => ({ Success: true, Result: JSON.stringify(obj) });
const SRC_NODE = {
  name: 'Brick_0_0', active: true, path: 'Brick_0_0',
  components: ['Transform', 'SpriteRenderer'],
  position: { x: 1, y: 2, z: 0 }, scale: { x: 2, y: 2, z: 1 },
  sprite: { present: true, color: { r: 255, g: 255, b: 255, a: 255 }, sortingOrder: 0, sortingLayerName: 'Default', spriteName: 'hero', assetPath: 'Assets/Art/hero.png', ppu: 16, worldSize: { x: 1.6, y: 1.2 } },
};
const PREFAB_READ = {
  asset: 'Assets/Prefabs/Brick.prefab', name: 'Brick_0_0',
  position: { x: 1, y: 2, z: 0 }, scale: { x: 2, y: 2, z: 1 },
  spriteAssetPath: 'Assets/Art/hero.png', guid: 'guid-abc',
};

test('prefabCreate：缺 --from-node / --to / --project-path → 各自的码，零调用', async () => {
  const spy = [];
  const a = await prefabCreate({ projectPath: 'P', fromNode: undefined, to: 'Assets/Prefabs/a.prefab', _call: sequenceCall([], spy) });
  assert.strictEqual(a.code, 'MISSING_PATH');
  assert.strictEqual(exitCodeFor(a), 2);
  const b = await prefabCreate({ projectPath: 'P', fromNode: 'N', to: undefined, _call: sequenceCall([], spy) });
  assert.strictEqual(b.code, 'MISSING_TO');
  assert.strictEqual(exitCodeFor(b), 2);
  const c = await prefabCreate({ fromNode: 'N', to: 'Assets/Prefabs/a.prefab', _call: sequenceCall([], spy) });
  assert.strictEqual(c.code, 'MISSING_PROJECT_PATH');
  assert.strictEqual(exitCodeFor(c), 1);
  assert.strictEqual(spy.length, 0);
});

test('prefabCreate：--to 不以 .prefab 结尾 / 不在 Assets/ 下 → BAD_TARGET_PATH（用法错 2）', async () => {
  const spy = [];
  for (const to of ['Assets/Prefabs/a.txt', 'Prefabs/a.prefab', 'Assets/../a.prefab']) {
    const e = await prefabCreate({ projectPath: 'P', fromNode: 'N', to, _call: sequenceCall([], spy) });
    assert.strictEqual(e.code, 'BAD_TARGET_PATH', to);
    assert.strictEqual(exitCodeFor(e), 2);
  }
  assert.strictEqual(spy.length, 0);
});

test('prefabCreate：源节点不存在 → 直接把 node inspect 的失败信封透传（NOT_FOUND，退出码 1），不写盘', async () => {
  const spy = [];
  const call = sequenceCall([nodeResult({ __error: 'NOT_FOUND' })], spy);
  const e = await prefabCreate({ projectPath: 'P', fromNode: 'Nope', to: 'Assets/Prefabs/a.prefab', _call: call });
  assert.strictEqual(e.code, 'NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(spy.length, 1, '只许发生「读源节点」这一次调用');
});

test('prefabCreate：happy path —— intent 是源节点投影；写→读两次调用；verified:true', async () => {
  const spy = [];
  const call = sequenceCall([
    nodeResult(SRC_NODE),                                                        // 1) 读源节点（建 intent）
    { Success: true, Result: JSON.stringify({ __written: true, guid: 'guid-abc' }) }, // 2) 写 prefab
    { Success: true, Result: JSON.stringify({ __read: PREFAB_READ }) },          // 3) 读回 prefab 资产
  ], spy);
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab', _call: call,
    // ⚠️ 必须注入 `_stat`：生产侧用 fs.statSync(absTo) 做磁盘防线，而这里没有真项目目录 → 会抛 → `file=null`
    //   → extraCheck 报 `file.bytes` 分歧 → verified:false。**不许**为了过测试放宽生产侧的防线。
    _stat: () => ({ size: 2437, mtimeMs: 1700000000000 }),
  });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(exitCodeFor(e), 0);
  assert.deepStrictEqual(e.intent.prefab.name, 'Brick_0_0');
  assert.deepStrictEqual(e.intent.prefab.position, { x: 1, y: 2, z: 0 });
  assert.strictEqual(e.intent.prefab.spriteAssetPath, 'Assets/Art/hero.png');
  assert.strictEqual(e.actual.guid, 'guid-abc');
  const w = JSON.parse(JSON.parse(spy[1].args[3]).p);
  const r = JSON.parse(JSON.parse(spy[2].args[3]).p);
  assert.deepStrictEqual(w, { mode: 'write', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab' });
  assert.deepStrictEqual(r, { mode: 'read', path: 'Assets/Prefabs/Brick.prefab' });
});

test('prefabCreate：Prefab 内容与源节点不符 → verified:false + 具体分歧键', async () => {
  const spy = [];
  const call = sequenceCall([
    nodeResult(SRC_NODE),
    { Success: true, Result: JSON.stringify({ __written: true, guid: 'g' }) },
    { Success: true, Result: JSON.stringify({ __read: { ...PREFAB_READ, position: { x: 9, y: 9, z: 0 }, spriteAssetPath: null } }) },
  ], spy);
  const e = await prefabCreate({ projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab', _call: call });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeFor(e), 1);
  const keys = e.mismatches.map((m) => m.key);
  assert.ok(keys.includes('prefab.position.x'), keys.join(','));
  assert.ok(keys.includes('prefab.spriteAssetPath'), keys.join(','));
});

test('prefabCreate：目标已存在且无 --force → ASSET_EXISTS（运行时 1），零调用', async () => {
  const spy = [];
  const e = await prefabCreate({
    projectPath: 'P', fromNode: 'Brick_0_0', to: 'Assets/Prefabs/Brick.prefab', _call: sequenceCall([], spy),
    _exists: () => true,
  });
  assert.strictEqual(e.code, 'ASSET_EXISTS');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(spy.length, 0);
});

test('prefabInstantiate：缺 --asset → MISSING_ASSET；非 .prefab / 非 Assets → BAD_ASSET_PATH（用法错 2）', async () => {
  const spy = [];
  const a = await prefabInstantiate({ projectPath: 'P', asset: undefined, _call: sequenceCall([], spy) });
  assert.strictEqual(a.code, 'MISSING_ASSET');
  assert.strictEqual(exitCodeFor(a), 2);
  for (const asset of ['Assets/Prefabs/a.png', 'Prefabs/a.prefab']) {
    const e = await prefabInstantiate({ projectPath: 'P', asset, _call: sequenceCall([], spy) });
    assert.strictEqual(e.code, 'BAD_ASSET_PATH', asset);
    assert.strictEqual(exitCodeFor(e), 2);
  }
  assert.strictEqual(spy.length, 0);
});

test('prefabInstantiate：happy path —— 用 .cs 返回的 instancePath 读回，sprite/name 一致 → verified:true', async () => {
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __written: true, instancePath: 'Panel/Brick_0_0', name: 'Brick_0_0' }) },
    nodeResult({ ...SRC_NODE, path: 'Panel/Brick_0_0', name: 'Brick_0_0' }),
  ], spy);
  const e = await prefabInstantiate({
    projectPath: 'P', asset: 'Assets/Prefabs/Brick.prefab', parent: 'Panel', name: 'Brick_0_0', _call: call,
  });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.deepStrictEqual(e.intent, { name: 'Brick_0_0' }, 'prefabInstantiate 的 intent 只含我们确定的东西（--name 给了才断言名字）');
  assert.strictEqual(e.actual.path, 'Panel/Brick_0_0');
  const w = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.deepStrictEqual(w, { asset: 'Assets/Prefabs/Brick.prefab', parent: 'Panel', name: 'Brick_0_0' });
});

test('prefabInstantiate：父节点不存在 → PARENT_NOT_FOUND（运行时 1）+ 可用路径 hint', async () => {
  const spy = [];
  const call = sequenceCall([{ Success: true, Result: JSON.stringify({ __error: 'PARENT_NOT_FOUND', parent: 'Nope' }) }], spy);
  const e = await prefabInstantiate({ projectPath: 'P', asset: 'Assets/Prefabs/a.prefab', parent: 'Nope', _call: call });
  assert.strictEqual(e.code, 'PARENT_NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.hint.join(' ').includes('scene tree'), e.hint.join(' | '));
});

test('prefabInstantiate：实例读不到（.cs 说建了、inspect 找不到）→ READBACK_FAILED（绝不 ok:true）', async () => {
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __written: true, instancePath: 'Brick_0_0', name: 'Brick_0_0' }) },
    nodeResult({ __error: 'NOT_FOUND' }),
  ], spy);
  const e = await prefabInstantiate({ projectPath: 'P', asset: 'Assets/Prefabs/a.prefab', _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('两个 .cs 的静态契约：走 PrefabUtility、不用 ?? 兜 UnityEngine.Object、不许有 SaveOpenScenes 式的空转', () => {
  const dir = path.join(__dirname, '..', 'unity-scripts');
  const createCs = fs.readFileSync(path.join(dir, 'prefab-create.cs'), 'utf8');
  const instCs = fs.readFileSync(path.join(dir, 'prefab-instantiate.cs'), 'utf8');
  assert.match(createCs, /PrefabUtility\.SaveAsPrefabAsset\(/);
  assert.match(createCs, /AssetDatabase\.LoadAssetAtPath<GameObject>/);
  assert.match(instCs, /PrefabUtility\.InstantiatePrefab\(/);
  assert.match(instCs, /SetParent\(/);
  assert.doesNotMatch(createCs, /\?\?\s*new |\?\?\s*go\./, 'UnityEngine.Object 不能用 ??');
  assert.doesNotMatch(instCs, /\?\?\s*new |\?\?\s*go\./, 'UnityEngine.Object 不能用 ??');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/prefab.test.js`
预期：FAIL —— `Cannot find module '../lib/prefab.js'`

- [ ] **步骤 3：写两个 `.cs`**

创建 `unity-scripts/prefab-create.cs`：

```csharp
// unity-scripts/prefab-create.cs
// 入参：{"mode":"write","fromNode":"Brick_0_0","to":"Assets/Prefabs/Brick.prefab"}
//       {"mode":"read","path":"Assets/Prefabs/Brick.prefab"}
// 出参：write → {"__written":true,"guid":"<32-hex>"}
//       read  → {"__read":{asset,name,position:{x,y,z},scale:{x,y,z},spriteAssetPath,guid}}
// 失败：{"__error":"BAD_PAYLOAD"|"NOT_FOUND"|"PREFAB_SAVE_FAILED"|"PREFAB_NOT_FOUND"}
//
// ⚠️ 同名覆盖 = 更新（任务 5 真机探测结论）：guid 不变、资产内容更新 → 美术/关卡返工安全。
// ⚠️ 读回在**独立一次调用**里（写后读回纪律）：SaveAsPrefabAsset 的返回值只说明「它返回了非空」。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var mode = (string)req["mode"];
if (mode != "write" && mode != "read") return "{\"__error\":\"BAD_PAYLOAD\"}";

if (mode == "write")
{
    var fromNode = (string)req["fromNode"];
    var to = (string)req["to"];
    if (string.IsNullOrEmpty(fromNode) || string.IsNullOrEmpty(to)) return "{\"__error\":\"BAD_PAYLOAD\"}";
    GameObject go = GameObject.Find(fromNode);
    if (go == null)
    {
        string[] segs = fromNode.Split('/');
        foreach (GameObject root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
        {
            GameObject hit = FindByPath(root.transform, segs, 0);
            if (hit != null) { go = hit; break; }
        }
    }
    if (go == null) return "{\"__error\":\"NOT_FOUND\"}";
    var saved = PrefabUtility.SaveAsPrefabAsset(go, to);
    if (saved == null) return "{\"__error\":\"PREFAB_SAVE_FAILED\"}";
    var w = new Newtonsoft.Json.Linq.JObject();
    w["__written"] = true;
    w["guid"] = AssetDatabase.AssetPathToGUID(to);
    return w.ToString(Newtonsoft.Json.Formatting.None);
}

var p = (string)req["path"];
if (string.IsNullOrEmpty(p)) return "{\"__error\":\"BAD_PAYLOAD\"}";
var asset = AssetDatabase.LoadAssetAtPath<GameObject>(p);
if (asset == null) return "{\"__error\":\"PREFAB_NOT_FOUND\"}";
var sr = asset.GetComponent<SpriteRenderer>();
var o = new Newtonsoft.Json.Linq.JObject();
o["asset"] = p;
o["name"] = asset.name;
o["position"] = new Newtonsoft.Json.Linq.JObject { ["x"] = asset.transform.position.x, ["y"] = asset.transform.position.y, ["z"] = asset.transform.position.z };
o["scale"] = new Newtonsoft.Json.Linq.JObject { ["x"] = asset.transform.localScale.x, ["y"] = asset.transform.localScale.y, ["z"] = asset.transform.localScale.z };
o["spriteAssetPath"] = (sr != null && sr.sprite != null) ? AssetDatabase.GetAssetPath(sr.sprite) : null;
o["guid"] = AssetDatabase.AssetPathToGUID(p);
var root = new Newtonsoft.Json.Linq.JObject();
root["__read"] = o;
return root.ToString(Newtonsoft.Json.Formatting.None);

// ⚠️ 不能加 static（uloop 会把字面量提升成外层局部变量 → CS8421）
GameObject FindByPath(Transform t, string[] segs, int i)
{
    if (t.name != segs[i]) return null;
    if (i == segs.Length - 1) return t.gameObject;
    for (int k = 0; k < t.childCount; k++)
    {
        GameObject hit = FindByPath(t.GetChild(k), segs, i + 1);
        if (hit != null) return hit;
    }
    return null;
}
```

创建 `unity-scripts/prefab-instantiate.cs`：

```csharp
// unity-scripts/prefab-instantiate.cs
// 入参：{"asset":"Assets/Prefabs/Brick.prefab","parent":"Panel","name":"Brick_0_0"}（parent/name 可选）
// 出参：成功 {"__written":true,"instancePath":"Panel/Brick_0_0","name":"Brick_0_0"}
// 失败：{"__error":"BAD_PAYLOAD"|"PREFAB_NOT_FOUND"|"PARENT_NOT_FOUND"|"INSTANTIATE_FAILED"}
// ⚠️ 为什么由本脚本返回 instancePath：预fab 根节点的名字来自**存 Prefab 时的节点名**，
//   与 `--to` 的文件名未必一致（`--to a.prefab` 存的是名字叫 Brick_0_0 的根）→ 让调用方去猜路径会假红。
//   本脚本返回自己造出来的实例路径，调用方**再**用它读回校验（写后读回纪律不变）。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var assetPath = (string)req["asset"];
if (string.IsNullOrEmpty(assetPath)) return "{\"__error\":\"BAD_PAYLOAD\"}";
var asset = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
if (asset == null) return "{\"__error\":\"PREFAB_NOT_FOUND\"}";

var inst = PrefabUtility.InstantiatePrefab(asset) as GameObject;
if (inst == null) return "{\"__error\":\"INSTANTIATE_FAILED\"}";

var parentPath = (string)req["parent"];
if (!string.IsNullOrEmpty(parentPath))
{
    GameObject parent = GameObject.Find(parentPath);
    if (parent == null)
    {
        string[] segs = parentPath.Split('/');
        foreach (GameObject root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
        {
            GameObject hit = FindByPath(root.transform, segs, 0);
            if (hit != null) { parent = hit; break; }
        }
    }
    if (parent == null) { UnityEngine.Object.DestroyImmediate(inst); return "{\"__error\":\"PARENT_NOT_FOUND\"}"; }
    inst.transform.SetParent(parent.transform, false);   // worldPositionStays=false：局部坐标不被父级缩放/位置污染
}

var wantedName = (string)req["name"];
if (!string.IsNullOrEmpty(wantedName)) inst.name = wantedName;

var o = new Newtonsoft.Json.Linq.JObject();
o["__written"] = true;
o["instancePath"] = InstancePath(inst.transform);
o["name"] = inst.name;
return o.ToString(Newtonsoft.Json.Formatting.None);

// 实例在场景里的 <name>/<name> 路径（与 node-inspect.cs 的路径口径一致）
string InstancePath(Transform t)
{
    string s = t.name;
    Transform cur = t.parent;
    while (cur != null) { s = cur.name + "/" + s; cur = cur.parent; }
    return s;
}

// ⚠️ 不能加 static（CS8421）
GameObject FindByPath(Transform t, string[] segs, int i)
{
    if (t.name != segs[i]) return null;
    if (i == segs.Length - 1) return t.gameObject;
    for (int k = 0; k < t.childCount; k++)
    {
        GameObject hit = FindByPath(t.GetChild(k), segs, i + 1);
        if (hit != null) return hit;
    }
    return null;
}
```

⚠️ 本脚本里出现了**两个**局部函数（`InstancePath` / `FindByPath`）—— 若 uloop 的封装对同名/多局部函数有冲突，
按真机报错调整（**先真机，再改**）。

- [ ] **步骤 4：实现 `lib/prefab.js`**

创建 `lib/prefab.js`（结构照 `lib/sprite.js`：用法面 → 写调用 → 解析 `__error` → `readBackAndVerify`）：

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { call } = require('./uloop.js');
const { fail, envelopeFromCall } = require('./envelope.js');
const { normalizeAssetTo } = require('./assetpath.js');
const { nodeInspect, buildPayloadArgs, parseScriptResult, readBackAndVerify, withWriteRecheckHint } = require('./scene.js');

/** `Assets/` 下、`.prefab` 结尾、不含 `..`。 `kind` 只用于文案（`--to` / `--asset`）。 */
function isPrefabPath(v) {
  return typeof v === 'string' && /^Assets\//.test(v.replace(/\\/g, '/')) && !v.includes('..') && v.endsWith('.prefab');
}

/** 从 node inspect 的读回里抽出「Prefab 该长成什么样」的投影（**intent 的唯一来源**）。 */
function nodeProjection(node) {
  return {
    name: node.name,
    position: node.position,
    scale: node.scale,
    spriteAssetPath: node.sprite && node.sprite.assetPath ? node.sprite.assetPath : null,
  };
}

/**
 * `unity prefab create`：把场景里的节点存成 Prefab 资产（**覆盖 = 更新**，guid 不变）。
 *
 * 写后读回分两段：① 写调用只证明「SaveAsPrefabAsset 返回了非空」；
 * ② **独立一次** read 调用把**资产里的内容**读回来，与「源节点的投影」比对 —— 这才证明
 * 「Prefab 里装的确实是那个节点」（而不是一个空壳）。extraCheck 再补一条磁盘防线（文件真的在、非空）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, fromNode?: string, to?: string, force?: boolean,
 *   _call?: typeof call, _exists?: (p: string) => boolean, _stat?: (p: string) => import('node:fs').Stats}} [opts]
 * @returns {Promise<object>} 信封
 */
async function prefabCreate({ projectPath, env, fromNode, to, force, _call, _exists, _stat } = {}) {
  if (typeof fromNode !== 'string' || fromNode === '') {
    return fail({
      code: 'MISSING_PATH',
      message: '缺少 --from-node（要存成 Prefab 的节点路径）',
      actual: { fromNode },
      hint: ['用 `unity scene tree` 取可用路径'],
    });
  }
  const toCheck = normalizeAssetTo(to, {
    sample: 'Assets/Prefabs/Brick.prefab',
    missingHint: '用法：unity prefab create --project-path <P> --from-node Brick_0_0 --to Assets/Prefabs/Brick.prefab',
    badHint: '用法：--to Assets/Prefabs/Brick.prefab',
  });
  if (!toCheck.ok) return toCheck.envelope;
  const normalizedTo = toCheck.path;
  if (!normalizedTo.endsWith('.prefab')) {
    return fail({
      code: 'BAD_TARGET_PATH',
      message: `--to 必须以 .prefab 结尾：${JSON.stringify(to)}`,
      actual: { to },
      hint: ['用法：--to Assets/Prefabs/Brick.prefab'],
    });
  }
  if (typeof projectPath !== 'string' || projectPath === '') {
    return fail({
      code: 'MISSING_PROJECT_PATH',
      message: '需要 --project-path（本命令要按项目根解析 --to 的落地路径）',
      actual: { to: normalizedTo },
      hint: ['用 --project-path <项目根> 指定项目'],
    });
  }
  const absTo = path.join(projectPath, normalizedTo);
  const exists = _exists || fs.existsSync;
  if (exists(absTo) && force !== true) {
    return fail({
      code: 'ASSET_EXISTS',
      message: `目标已存在：${normalizedTo}（未给 --force）`,
      actual: { path: normalizedTo },
      hint: [
        '覆盖已有 Prefab 属于停止条件（skill §5）：先向用户确认',
        '确认后用 --force（同名覆盖 = 更新，**引用它的实例/场景不会断** —— 见 docs/M4-PROBES.md 问题②）',
      ],
    });
  }

  const callFn = _call || call;
  // ① 先读源节点 → intent（**必须在写之前**：intent 不能从写的结果倒推）
  const readSrc = await nodeInspect({ projectPath, env, path: fromNode, _call: callFn });
  if (!readSrc.ok) return readSrc;
  const intent = { prefab: { asset: normalizedTo, ...nodeProjection(readSrc.actual) } };

  // ② 写
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('prefab-create', { mode: 'write', fromNode, to: normalizedTo }), { projectPath, env });
  } catch (err) {
    return fail({
      code: 'WRITE_CALL_FAILED',
      message: `prefab-create 写调用失败：${(err && err.message) || String(err)}`,
      intent,
      hint: ['Prefab 是否已写出未知；先看 AssetDatabase 里有没有该文件，再决定是否重试'],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  if (!envl.ok) return withWriteRecheckHint(envl);
  const res = parseScriptResult(w, {
    label: 'prefab-create',
    describeError: (code) => (code === 'NOT_FOUND'
      ? { message: `节点不存在：${fromNode}`, actual: { path: fromNode }, hint: ['用 `unity scene tree` 查看可用路径'] }
      : undefined),
  });
  if (res.envelope) return res.envelope;
  const guid = res.parsed && res.parsed.guid ? res.parsed.guid : null;

  // ③ 独立读回资产内容 + 磁盘防线
  const stat = _stat || ((p) => fs.statSync(p));
  return readBackAndVerify({
    projectPath,
    env,
    callFn,
    intent,
    readActual: async () => {
      const r = await callFn('execute-dynamic-code', buildPayloadArgs('prefab-create', { mode: 'read', path: normalizedTo }), { projectPath, env });
      const e2 = envelopeFromCall(r);
      if (!e2.ok) {
        const err = new Error(`读回失败（${e2.code}）：${e2.message}`);
        err.envelope = e2;
        throw err;
      }
      const p2 = parseScriptResult(r, { label: 'prefab-create', describeError: () => undefined });
      if (p2.envelope) {
        const err = new Error(`读回失败（${p2.envelope.code}）：${p2.envelope.message}`);
        err.envelope = p2.envelope;
        throw err;
      }
      let file = null;
      try {
        const s = stat(absTo);
        file = { path: normalizedTo, bytes: s.size, mtimeMs: s.mtimeMs };
      } catch (err) { file = null; }
      // ⚠️ 与 `prefabCreate` 同一条纪律：读回投影必须与 intent **同形**（intent 是 `{prefab:{…}}`）。
      return { prefab: { ...p2.parsed }, guid, file };
    },
    residue: 'Prefab 可能已经写出；先用 `unity exec` 看 AssetDatabase 里有没有它，再决定是否重试',
    mismatchHint: '读回与源节点不一致（verified:false）——Prefab 里装的内容与场景节点不同；逐条查 mismatches（position/scale/spriteAssetPath）',
    extraCheck: (actual) => (actual.file && actual.file.bytes > 0
      ? []
      : [{ key: 'file.bytes', intent: '>0', actual: actual.file }]),
  });
}

/**
 * `unity prefab instantiate`：把 Prefab 资产实例化进当前场景（可选挂到父节点下/改名）。
 *
 * 读回面 = `node inspect`（复用既有 helper）；读回的路径来自 `.cs` 自己返回的 `instancePath`
 * （Prefab 根名未必等于文件名，让调用方猜路径会假红 → 见 `prefab-instantiate.cs` 的注释）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, asset?: string, parent?: string, name?: string,
 *   _call?: typeof call}} [opts]
 * @returns {Promise<object>} 信封
 */
async function prefabInstantiate({ projectPath, env, asset, parent, name, _call } = {}) {
  if (typeof asset !== 'string' || asset === '') {
    return fail({
      code: 'MISSING_ASSET',
      message: '缺少 --asset（要实例化的 Prefab 资产路径）',
      actual: { asset },
      hint: ['用法：unity prefab instantiate --project-path <P> --asset Assets/Prefabs/Brick.prefab'],
    });
  }
  if (!isPrefabPath(asset)) {
    return fail({
      code: 'BAD_ASSET_PATH',
      message: `--asset 必须是 Assets/ 下、.prefab 结尾的项目内路径：${JSON.stringify(asset)}`,
      actual: { asset },
      hint: ['用法：--asset Assets/Prefabs/Brick.prefab'],
    });
  }
  if (parent !== undefined && (typeof parent !== 'string' || parent === '')) {
    return fail({
      code: 'BAD_PARENT',
      message: `--parent 需要非空的节点路径，收到 ${JSON.stringify(parent)}`,
      actual: { parent },
      hint: ['用 `unity scene tree` 取可用路径；不给则实例化在场景根'],
    });
  }
  if (name !== undefined && (typeof name !== 'string' || name === '')) {
    return fail({
      code: 'MISSING_NAME',
      message: `--name 需要非空字符串，收到 ${JSON.stringify(name)}`,
      actual: { name },
      hint: ['不给 --name 就用 Prefab 根节点自己的名字'],
    });
  }

  const assetPath = asset.replace(/\\/g, '/');
  const payload = { asset: assetPath };
  if (parent !== undefined) payload.parent = parent;
  if (name !== undefined) payload.name = name;

  const callFn = _call || call;
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('prefab-instantiate', payload), { projectPath, env });
  } catch (err) {
    return fail({
      code: 'WRITE_CALL_FAILED',
      message: `prefab-instantiate 写调用失败：${(err && err.message) || String(err)}`,
      hint: ['实例是否已建出未知；用 `unity scene tree` 复核后再决定是否重试'],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  if (!envl.ok) return withWriteRecheckHint(envl);
  const res = parseScriptResult(w, {
    label: 'prefab-instantiate',
    describeError: (code, parsed) => {
      if (code === 'PARENT_NOT_FOUND') {
        return {
          message: `父节点不存在：${(parsed && parsed.parent) || parent}`,
          actual: { parent },
          hint: ['用 `unity scene tree` 查看可用路径', '本次没有建出任何实例（脚本在挂父级失败时已销毁它）'],
        };
      }
      if (code === 'PREFAB_NOT_FOUND') {
        return {
          message: `Prefab 资产不存在：${assetPath}`,
          actual: { asset: assetPath },
          hint: ['先用 `unity prefab create` 生成它，或核对路径（必须以 .prefab 结尾、在 Assets/ 下）'],
        };
      }
      return undefined;
    },
  });
  if (res.envelope) return res.envelope;
  const instancePath = res.parsed && res.parsed.instancePath ? res.parsed.instancePath : null;
  if (!instancePath) {
    return fail({
      code: 'INSTANTIATE_FAILED',
      message: 'prefab-instantiate 没有返回实例路径（协议不符）',
      actual: res.parsed,
      hint: ['检查 unity-scripts/prefab-instantiate.cs 的返回协议'],
    });
  }

  // intent 只包含「我们能确定的东西」：给了 --name 才断言名字；sprite 面靠读回自证
  const intent = {};
  if (name !== undefined) intent.name = name;

  return readBackAndVerify({
    projectPath,
    env,
    callFn,
    readPath: instancePath,
    intent,
    residue: '实例可能已经建出来了；用 `unity scene tree` 复核，必要时空场景重来',
    mismatchHint: '读回与意图不一致（verified:false）——实例名被 Unity 改写或读错了对象；逐条查 mismatches',
    extraCheck: () => {
      if (name === undefined) return [];
      if (instancePath === name || instancePath.endsWith(`/${name}`)) return [];
      return [{ key: 'instance.path', intent: `…/${name}`, actual: instancePath }];
    },
  });
}

module.exports = { prefabCreate, prefabInstantiate, isPrefabPath, nodeProjection };
```

> **实现者注意（两处必须核对）**：
> 1. `parseScriptResult` 的返回形状（`.parsed` / `.value` / `.envelope`）以 `lib/scene.js` 为准，按实际改（**不许**复制第三份 `JSON.parse`）。
> 2. `intent` 里**不要**放 `worldSize`/`ppu` 之类要靠 Unity 计算的字段（会在 JS 侧重复实现 Unity 的语义）。
>    若实现中发现读回面与 intent 的键名不一致 → 改**读回脚本的键名**，不要改 intent 去迁就读回（或反之，二选一并写进报告）。

- [ ] **步骤 5：`bin/unity.js` 接线 + USAGE**

新增 `prefab` handler（放在 `asset` handler 之后）：

```js
  prefab: async (rest) => {
    const [action, ...opts] = rest;
    const { parseArgs } = require('../lib/args.js');
    const args = parseArgs(opts);
    const { emit, exitCodeFor } = require('../lib/envelope.js');   // R203：局部 require
    if (action === 'create' || action === 'instantiate') {
      const { prefabCreate, prefabInstantiate } = require('../lib/prefab.js');
      const e = action === 'create'
        ? await prefabCreate({
          projectPath: args['project-path'],
          fromNode: args['from-node'],
          to: args.to,
          force: args.force,
        })
        : await prefabInstantiate({
          projectPath: args['project-path'],
          asset: args.asset,
          parent: args.parent,
          name: args.name,
        });
      emit(e, { json: Boolean(args.json) });
      return exitCodeFor(e);
    }
    process.stderr.write('usage: unity prefab create --from-node <节点路径> --to <Assets/...prefab> [--force]\n'
      + '       unity prefab instantiate --asset <Assets/...prefab> [--parent <节点路径>] [--name <名字>]\n');
    return EXIT_USAGE;
  },
```

USAGE 里在 `asset import 选项：` 段之后插入：

```
prefab 选项：
  prefab create          把场景里的节点存成 Prefab 资产（**写**后读回：把资产内容读回来，
                         与源节点的 name/position/scale/spriteAssetPath 逐字段比对）
    --from-node <path>   必填：源节点路径（形如 Brick_0_0）
                         ⚠️ 源节点是 **Prefab 实例** → `SOURCE_IS_PREFAB_INSTANCE`（退出码 1，不静默产出 Variant）
                         ⚠️ 源节点是**子节点** → 允许，但 Prefab 根保留它的**局部** position/scale（Unity 语义）
    --to <Assets/...prefab> 必填：必须以 .prefab 结尾、在 Assets/ 下
    --force              目标已存在时必须显式给（覆盖已有 Prefab 要先问用户，skill §5）
                         ⚠️ **同名覆盖 = 更新**，规则三条（真机证据见 docs/M4-PROBES.md §②-8）：
                            ① 未被 override 的属性**跟随**资产；
                            ② 已被 override 的属性**保持实例自己的值**（不回退）；
                            ③ **根 `localPosition` 恒被记为 override → 永不跟随**
  prefab instantiate     把 Prefab 资产实例化进当前场景（**写**后读回：用返回的实例路径再 inspect 一次）
    --asset <Assets/...prefab> 必填
    --parent <path>      可选：挂到该节点下（worldPositionStays=false，**不受父级位置/缩放污染**）
                         父节点不存在 → PARENT_NOT_FOUND（本次不建任何实例）
    --name <name>        可选：改名（不给则用 Prefab 根节点自己的名字）
                         退出码：0 成功且 verified:true / 1 运行时错（NOT_FOUND / PREFAB_NOT_FOUND /
                         PARENT_NOT_FOUND / PREFAB_SAVE_FAILED / INSTANTIATE_FAILED / ASSET_EXISTS /
                         READBACK_FAILED / verified:false）/ 2 用法错（缺 --from-node → MISSING_PATH；
                         --to 缺失 → MISSING_TO、非法/非 .prefab → BAD_TARGET_PATH；缺 --asset →
                         MISSING_ASSET、非法 → BAD_ASSET_PATH；--parent 非法 → BAD_PARENT；
                         --name 非法 → MISSING_NAME）
```

示例段补：

```bash
  unity prefab create --project-path C:/my-game --from-node Brick_0_0 --to Assets/Prefabs/Brick.prefab --json
  unity prefab instantiate --project-path C:/my-game --asset Assets/Prefabs/Brick.prefab --parent Bricks --name Brick_1_0 --json
```

- [ ] **步骤 6：运行测试 + 全量**

```bash
node --test test/prefab.test.js
node bin/unity.js version
npm test 2>&1 | tail -8
```

- [ ] **步骤 7：真机（必需）**

```bash
P="C:/Users/<用户>/pi-unity-spike/S0Project"
R=.superpowers/sdd/2026-09-20-pi-unity-m4-exec/real-machine
# 现场：导入资产 + 建带资产 sprite 的节点（同任务 4）
node bin/unity.js asset import --project-path "$P" --from .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-gdi.png --to Assets/M4Probe/hero.png --remove-bg auto --trim --ppu 16 --json > $R/task6-import.json
node bin/unity.js node create --project-path "$P" --name PfSource --components '["SpriteRenderer"]' --json > $R/task6-create-node.json
node bin/unity.js sprite assign --project-path "$P" --path PfSource --asset Assets/M4Probe/hero.png --world-size 1.6,1.2 --json > $R/task6-assign.json
# ① 存 Prefab → verified:true（读回资产内容与源节点一致）
node bin/unity.js prefab create --project-path "$P" --from-node PfSource --to Assets/M4Probe/PfSource.prefab --json > $R/task6-prefab1.json; echo "exit=$?"
node -e "const d=require('./$R/task6-prefab1.json');console.log(d.verified,d.intent.prefab.name,JSON.stringify(d.actual.position),d.actual.guid)"
# ② 覆盖语义：改节点 → --force 再存 → guid **不变**、内容**更新**（这是 --force 契约的真机证据）
node bin/unity.js node set --project-path "$P" --path PfSource --patch '{"position":{"x":-2,"y":-2,"z":0}}' --json > /dev/null
node bin/unity.js prefab create --project-path "$P" --from-node PfSource --to Assets/M4Probe/PfSource.prefab --force --json > $R/task6-prefab2.json; echo "exit=$?"
node -e "const a=require('./$R/task6-prefab1.json'),b=require('./$R/task6-prefab2.json');console.log('guid 不变:',a.actual.guid===b.actual.guid,'位置已更新:',JSON.stringify(b.actual.position))"
# ③ 无 --force 再存 → exit 1 ASSET_EXISTS
node bin/unity.js prefab create --project-path "$P" --from-node PfSource --to Assets/M4Probe/PfSource.prefab --json > $R/task6-prefab3.json; echo "exit=$?"
# ④ 实例化（挂到父节点下 + 改名）→ verified:true
node bin/unity.js node create --project-path "$P" --name PfParent --json > /dev/null
node bin/unity.js prefab instantiate --project-path "$P" --asset Assets/M4Probe/PfSource.prefab --parent PfParent --name PfClone --json > $R/task6-inst1.json; echo "exit=$?"
node -e "const d=require('./$R/task6-inst1.json');console.log(d.verified,d.actual.path,d.actual.sprite.assetPath,d.actual.sprite.worldSize)"
# ⑤ 画面里看得见（实例化的 Prefab 也要能数到图）
#    ① 用 `--capture-mode rendering`（默认 window 模式的图尺寸=窗口大小，不能做几何对账）；
#    ② 读 **`actual.count.count`**（`actual.count` 是对象！写成 `actual.count > 0` 恒假）；
#    ③ **归属**：先把实例挪开（下方 ⑤b），让「多出来的那一块」成为唯一变量；
#    ④ 用 `--bbox` 或 px/单位 对账（`px/单位 = 图高/(2×orthographicSize)`，S0Project 正交 size=5、640 高 → 64 px/单位）。
#    ⚠️ **源节点与实例同时在画面里时的 `count>0` 不构成证据**（见 docs/M4-PROBES.md 的「可见性判据模板」）。
node bin/unity.js play start --project-path "$P" --json > $R/task6-play.json
node bin/unity.js shot --project-path "$P" --capture-mode rendering --out "$R/shots" --json > $R/task6-shot.json
SHOT=$(node -e "console.log(require('./$R/task6-shot.json').actual.path)")
node bin/unity.js pixels --file "$SHOT" --count-color '#FF2E88' --tolerance 16 --json > $R/task6-pixels.json
node -e "const d=require('./$R/task6-pixels.json');console.log('size',d.actual.width+'x'+d.actual.height,'count',d.actual.count.count)"
# ⑤b 负对照：关掉实例 → 计数必须恰好少掉实例那一块（这是「归属」的硬证据）
node bin/unity.js exec --project-path "$P" --json --code 'GameObject.Find("PfParent/PfClone").SetActive(false); return "off";' > $R/task6-inst-off.json
node bin/unity.js shot --project-path "$P" --capture-mode rendering --out "$R/shots" --json > $R/task6-shot-off.json
SHOT2=$(node -e "console.log(require('./$R/task6-shot-off.json').actual.path)")
node bin/unity.js pixels --file "$SHOT2" --count-color '#FF2E88' --tolerance 16 --json > $R/task6-pixels-off.json
node -e "const a=require('./$R/task6-pixels.json').actual.count.count, b=require('./$R/task6-pixels-off.json').actual.count.count; console.log('inst',a,'off',b,'delta',a-b,'（delta 应 ≈ 实例的像素数，例如 1.5x1.0 世界单位 @64px/单位 = 96x64 = 6144）')"
node bin/unity.js exec --project-path "$P" --json --code 'GameObject.Find("PfParent/PfClone").SetActive(true); return "on";' > /dev/null
# ⑤c **真重载**判据（R424：实例上的 override 必须活过 scene save + 真切场景；同一会话里的读回不算）
node bin/unity.js node set --project-path "$P" --path PfParent/PfClone --patch '{"position":{"x":1.5,"y":1.5,"z":0}}' --json > $R/task6-inst-move.json
node bin/unity.js scene save --project-path "$P" --path Assets/M4Probe/PfScene.scene --json > $R/task6-save.json
node bin/unity.js node inspect --project-path "$P" --path PfParent/PfClone --json > $R/task6-inst-before-reload.json
node bin/unity.js scene open --project-path "$P" --path Assets/Scenes/SampleScene.scene --json > /dev/null
node bin/unity.js scene open --project-path "$P" --path Assets/M4Probe/PfScene.scene --json > /dev/null
node bin/unity.js node inspect --project-path "$P" --path PfParent/PfClone --json > $R/task6-inst-after-reload.json
node -e "const a=require('./$R/task6-inst-before-reload.json').actual,b=require('./$R/task6-inst-after-reload.json').actual; const k=JSON.stringify({p:a.position,s:a.scale,sp:a.sprite&&a.sprite.assetPath}); const k2=JSON.stringify({p:b.position,s:b.scale,sp:b.sprite&&b.sprite.assetPath}); console.log(k===k2?'✅ 实例 override 活过真重载':'❌ 丢了：'+k+' vs '+k2)"
node bin/unity.js play stop --project-path "$P" --json > /dev/null
# ⑥ 父节点不存在 → PARENT_NOT_FOUND 且**不留半成品**
node bin/unity.js prefab instantiate --project-path "$P" --asset Assets/M4Probe/PfSource.prefab --parent NOPE --json > $R/task6-inst2.json; echo "exit=$?"
node bin/unity.js scene tree --project-path "$P" --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('nodeCount',JSON.parse(s).actual.nodeCount))"
# ⑦ 清理
node bin/unity.js node delete --project-path "$P" --path PfParent --json > /dev/null
node bin/unity.js node delete --project-path "$P" --path PfSource --json > /dev/null
node bin/unity.js exec --project-path "$P" --json --code 'AssetDatabase.DeleteAsset("Assets/M4Probe"); return AssetDatabase.IsValidFolder("Assets/M4Probe") ? "STILL_THERE" : "GONE";'
```

判据（缺一条即未完成）：① `verified:true` 且读回内容与源节点一致；② 覆盖后 **guid 相同 + 位置已更新**；
③ 无 `--force` → `ASSET_EXISTS` / exit 1；④ 实例化 `verified:true` 且 `sprite.assetPath` 指向该 PNG；
⑤ **可见性归属**：`rendering` 模式下 `actual.count.count > 0`，且**关掉实例后的负对照恰好少掉实例那一块**；
⑥ **真重载**：实例上的 `position`/`sprite` override 活过 `scene save` + 真切场景（`task6-inst-after-reload.json` 与 before 逐字段相同）；
⑦ `PARENT_NOT_FOUND` + 节点数不变；⑧ 项目无残留。

**R430（控制者裁定，来自任务 5 的 R427 探测）—— `--from-node` 的源节点类型契约**：
- **源节点是 Prefab 实例** → `SaveAsPrefabAsset` 会**静默产出 Variant**（不是普通 Prefab）→ 本命令**必须拒绝**：`.cs` 里 `PrefabUtility.IsPartOfPrefabInstance(go)` 为真 → `{"__error":"SOURCE_IS_PREFAB_INSTANCE"}`（**运行时码**，不进冻结用法表 → 退出码 1），JS 侧 hint：「源节点是 Prefab 实例；请先用普通节点，或先在场景里 `Instantiate` 后**断开连接**再存」。（代价：想存 Variant 的人要等 backlog 的显式选项；好处：不会在 `verified:true` 下交出另一种工件。）
- **源节点是子节点** → **允许**（Unity 语义：Prefab 根保留该子节点的**局部** `position`/`scale`）——但必须：① USAGE 写明「源是子节点时，Prefab 根保留**局部**变换（不是世界坐标），实例化后落在该局部位置」；② 真机覆盖一条子节点用例（任务 5 已验 `local 1,1` 而非世界 `6,4`）；③ 读回面语义自洽（`node-inspect.cs` 的 `position`/`scale` 就是 local，所以 intent/actual 天然对齐，**不会假红**）。
- **U 注册**：`prefab create --from-node` 的**同名歧义**（裸名命中多层同名节点）与 `R71` 同口径（工具级已知行为，靠 `actual.path` 暴露）——不修。

- [ ] **步骤 8：提交**

```bash
git add lib/prefab.js bin/unity.js unity-scripts/prefab-create.cs unity-scripts/prefab-instantiate.cs test/prefab.test.js
git commit -m "feat(prefab): unity prefab create|instantiate —— 资产投影读回 + 覆盖=更新（guid 不变）+ 实例画面可见"
```

---
### 任务 7：文档回写（SKILL / USAGE 头部 / PITFALLS 编号 / README 小尾巴）

**文件：**
- 修改：`skills/unity-game-dev/SKILL.md`、`bin/unity.js`（USAGE 头部一行）、`docs/PITFALLS.md`（追加 + 编号）、`README.md`、`test/template.test.js`（加 M4 命令面 tripwire）

> **纪律**：`docs/PITFALLS.md` 的新条目**由本任务统一编号**（前面任务只许追加**不带编号**的条目，R213）。
> SKILL 是**主交付物**（盲测 agent 只读它）→ 新命令必须进 SKILL，且要有一条测试钉住它。

- [ ] **步骤 1：SKILL 新增 §3.6（美术配方）**

在 `skills/unity-game-dev/SKILL.md` 的 `## 4. 截图注意` **之前**插入（保留 `### 3.5` 原文一字不动）：

````markdown
### 3.6 美术配方：用户供图 → 导入 → 绑定 → 画面里看得见

**整条链只有三步**（全部是写命令，都要看 `verified`）：

```bash
P="C:/path/to/Project"
# ① 把用户的图规范化后导入（去底 + 裁边 + 像素画设置；**像素处理只在 Node 侧发生**）
unity asset import --project-path "$P" --from "C:/pic/hero.png" --to Assets/Art/hero.png \
  --remove-bg auto --trim --ppu 16 --json
# ② 把资产挂到节点上（可选 --world-size 直接给「世界尺寸」）
unity node create --project-path "$P" --name Hero --components '["SpriteRenderer"]' --json
unity sprite assign --project-path "$P" --path Hero --asset Assets/Art/hero.png --world-size 1.6,1.2 --json
# ③ 存场景 / 存 Prefab（**必须做**，否则编辑器一退出交付物就没了）
unity scene save --project-path "$P" --path Assets/Scenes/SampleScene.unity --json   # 团结改成 .scene
unity prefab create --project-path "$P" --from-node Hero --to Assets/Prefabs/Hero.prefab --json
```

**命令口径（写错就是失败码，不会静默）**：

| 参数 | 含义 | 默认 |
|---|---|---|
| `--from <本地png>` | 宿主上的源图（`asset import` 专用；**绝对路径**最稳） | 必填 |
| `--to <Assets/...>` | 项目内目标路径（`Assets/` 开头、不含 `..`） | 必填 |
| `--remove-bg auto\|#RRGGBB` | 去底：`auto` = 按**四角**推断背景色；也可显式给色值 | 不去底 |
| `--tolerance <0-255>` | 去底容差（只在给了 `--remove-bg` 时有意义） | 40 |
| `--trim` | 裁掉全透明的外边 | 不裁 |
| `--fit <w,h>` | contain-fit 到该画布（最近邻、保持比例、空白透明） | 不缩放 |
| `--ppu <n>` | 每世界单位多少像素（**决定 sprite 的世界尺寸** = 纹理尺寸/PPU） | 16 |
| `--max-size <n>` | Unity 的 `maxTextureSize`（**小于源尺寸会被静默缩放**，本命令会自动抬到 ≥ 源尺寸的 2 的幂） | 自动 |
| `--filter <point\|bilinear>` | 采样方式（像素画必须 `point`，否则糊） | point |
| `--compression <none\|normal>` | 压缩（像素画必须 `none`，否则糊成 DXT 块） | none |
| `--pivot <x,y>` | 精灵轴心（0–1）；给了就落 `Custom(9)` | Center(0.5,0.5) |
| `--asset <Assets/...>` | `sprite assign`：**项目内**的图片资产（不是宿主路径！） | 必填 |
| `--world-size <w,h>` | `sprite assign`：把缩放反算成「世界空间里正好 w×h」（父级有缩放会自动除掉） | 不改缩放 |
| `--force` | 目标已存在时必须显式给（**覆盖已有资产/Prefab 要先问用户**，见 §5） | 不加 |

**怎么证明「真的进去了」**（`asset import` 的 `--json` 里直接有）：

- `intent.asset` = 我们要的设置；`actual.asset` = **读回来的真实设置**（11 项 + `texWidth/texHeight/texFormat/mipmapCount`）；
  `verified:true` 才是「设置真的生效」。
- `actual.art.removeBg.keyColor` = 推断/指定的背景色；`actual.art.trimmed` = 裁边框；
  `actual.art.warning` 非空 = **背景可能不是纯色**（命中率 <10%）→ 先 `read` 看一眼原图再决定。
- `actual.file.sha256` = 落盘文件的哈希（假绿防线：磁盘上真的是我们要写的那份）。
- `actual.maxTextureSizeRaisedFrom` 非空 = 你给的 `--max-size` 太小，被自动抬升了。

**⚠️ 三条必读的坑**（完整版见 `docs/PITFALLS.md`）：

1. **`sprite set` 与 `sprite assign` 不是一回事**：前者造的是**运行时** 1×1 纯色 sprite
   （进 PlayMode 的 domain reload 就没了 —— 见 §3.5 的血泪教训），后者挂的是**资产**引用
   （会被场景/Prefab 序列化、能随交付物走）。**用户供图必须用 `sprite assign`。**
2. **尺寸口径**：`node inspect` 的 `sprite.worldSize` 才是「这个节点在画面里到底多大」
   （世界空间 AABB = 精灵 bounds × 缩放，父级缩放已含在内）。`--world-size` 只是帮你反算缩放。
3. **背景不是纯色时**：`--remove-bg auto` 会落 `BACKGROUND_AMBIGUOUS`（退出码 1）——
   这不是 bug，是让你**显式给色值**：`--remove-bg '#RRGGBB'`（用 `read` 工具打开原图取色）。

**Prefab 两条命令**：

```bash
unity prefab create --project-path "$P" --from-node Hero --to Assets/Prefabs/Hero.prefab --json
unity prefab instantiate --project-path "$P" --asset Assets/Prefabs/Hero.prefab --parent Bricks --name Hero_1 --json
```

- `prefab create` 的读回是**把资产内容读回来**与源节点比对（name/position/scale/spriteAssetPath 逐字段）。
- **同名覆盖 = 更新**：资产 guid 不变 → 引用它的场景/其它 Prefab **不会断**（真机证据：`docs/M4-PROBES.md` 问题②）。
- `prefab instantiate --parent` 用 `SetParent(t, false)` —— **不受父级位置/缩放污染**；
  父节点不存在 → `PARENT_NOT_FOUND` 且**本次不建任何实例**。
````

- [ ] **步骤 2：修正 §3.5 的尺寸口径（**必须保留原句**，它有 tripwire 钉着）**

把 §3.5 里这段：

```markdown
**世界单位约定（关键）**：`unity sprite set` 造出来的基础 sprite 是 **1×1 世界单位**（PPU=1f），
所以 **`localScale = 世界尺寸`** —— 一个方块的世界尺寸就是它的 `localScale`
（用 `node set --patch '{"scale":{...}}'` 设；默认 PPU 100 会让方块小到看不见）。
```

改成（**`localScale = 世界尺寸` 这八个字必须原样留在文里** —— `test/template.test.js` 有断言）：

```markdown
**世界单位约定（关键）**：`unity sprite set` 造出来的基础 sprite 是 **1×1 世界单位**（PPU=1f），
所以 **`localScale = 世界尺寸`** —— 一个方块的世界尺寸就是它的 `localScale`
（用 `node set --patch '{"scale":{...}}'` 设；默认 PPU 100 会让方块小到看不见）。

> ⚠️ **这条只对「本命令造的 1×1 sprite + 父级无缩放」成立**（M4 补充）：
> 一旦 sprite 是**资产**（`unity sprite assign --asset …`），世界尺寸 = **纹理尺寸 / PPU × 缩放**，
> 父级有缩放时还会再乘一层。**唯一可靠的口径**是读回：`unity node inspect` 的
> `sprite.worldSize` 就是世界空间的真实尺寸；要「正好 w×h」就直接用
> `unity sprite assign --world-size w,h`（它会把父级缩放除掉再反算 localScale）。
```

- [ ] **步骤 3：§5 停止条件 + §7 错误码表 + §8 验证配方**

`## 5. 停止条件` 的列表末尾加一条：

```markdown
- **覆盖已有的美术资产 / Prefab**（`asset import --force`、`prefab create --force`）—— 先问用户；
  同名覆盖虽然保 guid（引用不断），但**旧内容不可恢复**。
```

`## 7. 常见错误 → PITFALLS 的 U 编号` 的表里补行（**SKILL 里那张表是 3 列：现象 / 处置 / 出处**，所以只给**数据行**，不要连表头一起贴）：

```markdown
| 导入的图糊 / 颜色被改（Bilinear/压缩/透明像素被改写） | 用 `unity asset import`（它显式配 point + uncompressed） | U31 · U33 |
| PNG 导入后 DB 里查不到（没有 `.meta`） | 必须显式触发导入（`asset import` 已内置） | U29 |
| 纹理被静默缩小（长宽不是源尺寸） | 把 `--max-size` 换成 ≥ 源尺寸（或不给，会自动抬） | U32 |
| 去底去不掉 / 裁边裁不掉（想靠 Unity 侧做） | 像素处理只能在 Node 侧做（`--remove-bg`/`--trim`） | U33 · U34 |
| 手改 `.meta` 的 guid 不生效 / 交付后引用断 | `.meta` 的 guid 与引用用的 32-hex 是两套 id | U30 |
| `asset import` 报 `BAD_PNG`（调色板/隔行 PNG） | 另存为 PNG-24/32（非隔行）再导入 | U35 |
```

`## 8. 验证配方` 末尾（`⑥` 之后）追加：

````markdown
### ⑥ 判「用户供的图真的在画面里」（M4 起）

```bash
P="C:/path/to/Project"; SHOTS="C:/path/to/shots"
# 1) 先确认资产与绑定都是 verified:true（见 §3.6）
# 2) 截图（EditMode 也要先把 Game 视图打开，见 §4）
unity shot --project-path "$P" --out "$SHOTS" --json
# 3) 数「这张图独有的颜色」的像素数（用你图里确实存在的颜色，不要用背景色）
unity pixels --file "<上一步返回的 actual.path>" --count-color '#FF2E88' --tolerance 16 --json
#    → actual.count > 0 才算「画面里真的有它」；count==0 说明没渲染出来（不是「颜色差一点」）
# 4) 反证「去底真的生效」：原图的背景色不该再出现
unity pixels --file "<同上>" --count-color '#00FF00' --tolerance 8 --json   # 期望 count == 0
```

⚠️ **进 PlayMode 再看一次**：资产 sprite 过 domain reload **必须还在**
（`sprite set` 的运行时 sprite 在这一步会消失 —— 那就是用错命令了）。用
`unity play start` → `unity shot`（`--capture-mode rendering`）→ 同一个 `pixels --count-color`。
````

- [ ] **步骤 4：`docs/PITFALLS.md` 编号 + 追加**

把任务 3/5/6 追加的**无编号**条目统一编号为 **U28–U35**（NEW-1…NEW-7 顺次落在 U28/U29/U30/U31/U32/U33/U34，第 8 条 `U35` 是我们自己的 PNG 支持面边界），
每条**必须标适用引擎**（规律：**M4-SPIKE 里的 NEW-1…NEW-7 均只在团结 2022.3.62t9 上实测** ——
写「团结 2022.3.62t9 实测；官方 2022.3 **未验证**」，**不要**写「两者」），并追加两条新条目（同样标引擎）：

| 编号 | 内容（要点，正文自己写足） |
|---|---|
| U28 | `TextureImporter` 没有 `spriteMeshType/spriteExtrude/spriteAlignment`，必须 `TextureImporterSettings` 往返；`SpriteMeshType` 在 `UnityEngine`、`spriteExtrude` 是 `uint`（NEW-1，团结实测；官方未验证） |
| U29 | 外部进程写进 `Assets/` 的文件**不会**被自动导入：必须显式 `ImportAsset`（89ms）而非 `Refresh`（首轮 3540ms）（NEW-2，团结实测） |
| U30 | `.meta` 的 `guid:` 是 56 字符 base64，与 `AssetPathToGUID` 的 32-hex **是两套 id**；手改 `.meta` 不改变引用 id（NEW-3，团结实测） |
| U31 | 团结的**默认导入设置**就是压缩 + Bilinear + PPU=100 + Tight（实测 DXT1/DXT5）→ 像素画必须逐项显式设置（NEW-4，团结实测） |
| U32 | `maxTextureSize` 小于源尺寸会**静默缩放**（24×16 + 8 → 8×5）（NEW-5，团结实测） |
| U33 | `alphaIsTransparency=true`（团结默认）会**改写透明像素 RGB**（`(0,0,0,0)` → `(1,0,0,0)`）；`alphaSource=None` 是**丢弃 alpha**、不是去底（NEW-6，团结实测） |
| U34 | `spriteMeshType=Tight`（默认）在 66% 透明边界的精灵上**不裁剪几何**（4 顶点/全图 rect，与 FullRect 相同）→ 不能用它裁边；**与 Unity 官方文档预期不同**（NEW-7，团结实测；官方待复测） |
| U35 | **PNG 支持面**（我们自己的限制）：`lib/png.js` 只吃 bitDepth 8 / colorType 0,2,4,6 / 非隔行；**调色板（colorType 3）与隔行 PNG 落 `BAD_PNG`**（标「pi-unity 自身限制」） |

并把任务 5 的克隆结论作为一条**指向性**条目追加（**不抢 U 编号**，照 M4-SPIKE 先例）：

```markdown
### M4：全新 clone / 删 `Library/` 之后资产引用是否仍在（真机探测，详见 `docs/M4-PROBES.md`）
<一句话结论 + 指向该文档问题①，写清「同批提交」或「重跑 sprite assign」的可操作规则>
```

- [ ] **步骤 5：USAGE 头部命令清单 + README 小尾巴**

`bin/unity.js` 的 USAGE 第一行：

```js
命令（M2 全量 + M3 \`exec\` / \`scene save|open\` / \`build\`；类型列：读/执行 = verified 恒 null / 写 = 看 verified）：
```

改成（**只加 M4 的三个命令**）：

```js
命令（M2 全量 + M3 \`exec\`/\`scene save|open\`/\`build\` + M4 \`asset import\`/\`sprite assign\`/\`prefab create|instantiate\`；类型列：读/执行 = verified 恒 null / 写 = 看 verified）：
```

`README.md`：把「SKILL 8 节」改成「SKILL 9 节」（现在是 9 个 `## N.` 一级节）；命令清单/示例里补 M4 三条命令；
测试计数改成**本任务跑出来的真实数**（不许估）。

- [ ] **步骤 6：给 SKILL 加 M4 命令面 tripwire**

`test/template.test.js` 的「skill 必须写出 M2 的全部命令面」那条用例里，命令数组补 M4 项：

```js
  for (const cmd of ['unity pixels', 'unity sprite set', 'unity play', 'unity asset write',
    'unity compile', 'unity node delete', 'doctor --golden', '--capture-mode', '--match-mode',
    // M4：盲测 agent 只读 SKILL —— 新命令不进 SKILL 就等于不存在
    'unity asset import', 'unity sprite assign', 'unity prefab create', 'unity prefab instantiate',
    '--remove-bg', '--world-size', '--ppu']) {
    assert.ok(src.includes(cmd), `skill 必须提到 ${cmd}`);
  }
```

并补一条**跨语言 tripwire**（SKILL §3.6 的默认值与实现一致）：

```js
test('SKILL §3.6 的默认值与 asset import 的实现一致（跨语言 tripwire）', () => {
  const skill = fs.readFileSync(SKILL, 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'lib', 'importart.js'), 'utf8');
  assert.match(js, /ppu === undefined \? 16/, 'PPU 默认值必须是 16（SKILL 表里写的就是 16）');
  assert.match(skill, /\| `--ppu <n>`.*\| 16 \|/, 'SKILL 必须把 PPU 默认值写成 16');
  assert.match(js, /tolerance === undefined \? 40/, '容差默认值必须是 40');
  assert.match(skill, /\| `--tolerance <0-255>`.*\| 40 \|/, 'SKILL 必须把容差默认值写成 40');
});
```

- [ ] **步骤 7：全量测试 + 手动核对（文档任务也要跑测试）**

```bash
node bin/unity.js version
node bin/unity.js --help | head -5
npm test 2>&1 | tail -8
git diff --stat
```

预期：全绿。**若 SKILL 相关断言变红**：只允许改两类 —— ① 被断言的那句话的**措辞**（断言必须继续通过）；
② 本任务新增的断言。**不许**为了让测试过而删掉 SKILL 里的内容。

- [ ] **步骤 8：提交**

```bash
git add skills/unity-game-dev/SKILL.md docs/PITFALLS.md README.md bin/unity.js test/template.test.js
git commit -m "docs(m4): SKILL §3.6 美术配方 + PITFALLS U28–U35 编号 + USAGE/README 回写"
```

---

### 任务 8：E2E 验收（四条判据 + 独立盲测）

**文件：**
- 创建：`docs/E2E-ACCEPTANCE-m4.md`
- 证据：`.superpowers/sdd/2026-09-20-pi-unity-m4-exec/e2e/`（gitignored）

> **不许放宽**（照 `docs/E2E-ACCEPTANCE-m2.md` 的形态）：四条判据 + **一个只读 SKILL 的独立子代理**复现。

- [ ] **步骤 1：控制者亲自跑四条判据（团结，S0Project）**

环境：`tasklist | grep -iE "^Tuanjie.exe|^Unity.exe"` 只允许 S0Project 那一个；`export PI_UNITY_ULOOP_BIN=...`。

| 判据 | 怎么判（**证据必须落盘**） |
|---|---|
| **① 结构** | `asset import` 的 `verified:true` + `actual.asset` 全项 = `intent.asset`；`actual.file.sha256` == 独立重算的磁盘 sha256；`actual.art.trimmed` 与 fixture 的预期框一致（`hero-gdi.png`：绿底 + `10,8,12,8` 的品红块 `#FF2E88`）；`Assets/...png.meta` 存在；场景 YAML 里能 grep 到 `AssetPathToGUID` 的 32-hex；**再加一条「源图自带透明背景」的路**（`hero-alpha.png`，不给 `--remove-bg`、只 `--trim`）→ `verified:true` 且 `actual.art.removeBg === null`（M4-SPIKE 的原始验收就要求「带透明背景的真实 PNG」） |
| **② 画面** | `unity shot` → `pixels --count-color '#FF2E88'` **count > 0**；反证 `--count-color '#00FF00'`（原背景色）**count == 0** |
| **③ 可动/持久** | ① `unity play start` → `shot --capture-mode rendering` → 同一个 `pixels --count-color` 仍 **count > 0**（资产引用过了 domain reload 还在 —— 运行时 sprite 在这一步会丢，这条就是二者的分水岭）；② `prefab instantiate` 出来的实例同样 count > 0；③ `unity scene save` 落盘（md5 前进 + grep 到引用）；④ `unity build --target win64 --out <项目外>` 出包可跑（`player.log` 无 error）；⑤ 任务 5 问题① 若证明「克隆后引用仍在」→ 追加一条：**把项目复制成克隆（去 `Library/`）后 `node inspect` 的 `sprite.assetPath` 仍指向该文件** |
| **④ 纪律** | 全链每一步 `verified:true`（无 `[UNVERIFIED]`）；**故意制造 4 次失败并记录退出码**：`--asset` 指向不存在的资产 → `SPRITE_NOT_FOUND`/1；`--remove-bg` 指向非背景色 → exit 0 但 `actual.art.warning` 非空；`--to` 写成 `Art/a.png` → `BAD_TARGET_PATH`/2；`--force` 缺失时覆盖 → `ASSET_EXISTS`/1。且：探针节点/资产**全部清理并读回确认**、**没碰** `<真实工程>` |

- [ ] **步骤 2：造盲测 fixture + 派**只读 SKILL 的独立子代理**做盲测（官方版项目，独立复现）**

```bash
# 盲测用**另一张**同名不同文的图（不给它主验收用过的 hero-gdi.png，避免它猜到主线中间产物）
node scripts/make-m4-fixture.js .superpowers/sdd/2026-09-20-pi-unity-m4-exec/fixtures/hero-blind.png
# 上面会打印**绝对路径** → 盲测简报里只给这个路径
```

派发方式（照 M2）：一个**全新**子代理，任务描述里**只给**：
① 「读 `skills/unity-game-dev/SKILL.md`，按 §3.6 的配方，在这个项目里把用户给的这张图搭进画面并证明它看得见」；
② 盲测项目路径 `C:/Users/<用户>/pi-unity-official-f3c1`（**官方版**，`.unity` 扩展名）+ 步骤 2 造出的那张 fixture 的路径；
③ 纪律（写命令看 `verified`、不许碰真实工程、单座席、`.cs` 不许改）。
**禁止**给它：本计划、`docs/M4-SPIKE.md`、`docs/M4-PROBES.md`、`docs/M3-DECISIONS.md`、任何实现细节。
它必须自己得出「用 `asset import` + `sprite assign` + `shot`/`pixels`」这条路径 —— **若它走不出来，是 SKILL 的缺陷**。

- [ ] **步骤 3：独立复核（另一个子代理，只读产物）**

再派一个子代理：给它**盲测 agent 的报告 + 项目路径 + 截图路径**，让它独立复核四条判据
（自己跑 `pixels`、自己重算 sha256、自己 grep 场景 YAML），**不许相信报告里的结论**。

- [ ] **步骤 4：写 `docs/E2E-ACCEPTANCE-m4.md` + 提交**

结构：`> 协议/环境/日期/参与方` → `## 判据①…④（逐条的原始证据：命令、退出码、JSON 片段、文件路径）` →
`## 盲测记录（原文 + 我复核的差异）` → `## 未过项/降级项（如有，逐条写清代价）` → `## 结论`。

```bash
git add docs/E2E-ACCEPTANCE-m4.md
git commit -m "docs(e2e): M4 验收 —— 四条判据全过 + 独立盲测（官方版）"
```

---

### 任务 9：收尾（bump 0.7.0 + 账本 + `ff master` + tag）

**文件：**
- 创建：`docs/M4-DECISIONS.md`
- 修改：`package.json`（0.6.0 → 0.7.0）、`docs/HANDOFF.md`（基线/里程碑/backlog/账本索引 → 指向 M5）、`README.md`（版本/命令/测试数）

- [ ] **步骤 1：`package.json` bump**

`"version": "0.6.0"` → `"version": "0.7.0"`；`node bin/unity.js version` → `pi-unity 0.7.0`。

- [ ] **步骤 2：写 `docs/M4-DECISIONS.md`（照 M1/M2/M3 形态）**

内容（**编号接 M3 的 R378 → 从 R379 起**）：逐任务的首轮结论、`R<编号>` 裁决（每条带「如果错了的代价」）、
修复轮次、真机判据与原始数字、登记的 Minor/延后项、以及这四条 M4 设计裁决（D-M4-1…D-M4-4，逐字引用本计划）。
**必须收录**：任务 5 的克隆结论对交付方式的影响、任务 8 的四条判据结论、以及所有「未探测」的显式登记。

- [ ] **步骤 3：`docs/HANDOFF.md` 更新（它是下一个会话的唯一入口）**

- §2 基线：`master = <M4 合并后的 commit>`、tag `v0.7.0`、测试数、分支/工作树现状、**`v0.6.0` tag 未含 HANDOFF 提交**这条订正。
- §3 里程碑表加一行 **M4**（三个命令 + 美术管线 + 账本位置）。
- §4 换成 **M5 起手式**（或「下一步 = backlog 优先级」）；把 M4 已完成的事实基础指向 `docs/M4-PROBES.md` 与 `docs/M4-DECISIONS.md`。
- §7 backlog 更新：**M4 新增** —— `unity prefab apply|revert`、`unity art normalize` 独立命令、
  `Multiple`/`Polygon`/sprite sheet/预写 `.meta`、`lib/png.js` 支持调色板/隔行 PNG、
  Unity 官方版上复测 NEW-1/3/6/7（U28/U30/U33/U34）、真国际版验证、`pixels --diff`（P2）、
  Input System 真实注入（P2）、只读验证用户真实大工程（P2，需用户点头）。
- §8 账本索引加 `docs/M4-DECISIONS.md` / `docs/M4-PROBES.md` / `docs/E2E-ACCEPTANCE-m4.md`。

- [ ] **步骤 4：合并 + tag（**先验证再合并**）**

```bash
cd C:/Users/<用户>/.pi/agent/git/<内部 git 服务器>/pi/pi-unity-m4
node bin/unity.js version
npm test 2>&1 | tail -8          # 必须全绿，且测试数只增不减
git status --short                # 必须干净
git log --oneline master..HEAD | wc -l

cd C:/Users/<用户>/.pi/agent/git/<内部 git 服务器>/pi/pi-unity
git checkout master
git merge --ff-only m4-art
git tag -a v0.7.0 -m "M4：美术管线（lib/art.js）+ asset import + sprite assign + prefab create|instantiate（真机验证 + E2E 四条判据）"
# 合并后**再**在全量上跑一次（防止「分支绿、master 红」）
npm test 2>&1 | tail -8
```

**全新 clone 体检**（M3 的教训：LF 绿 / CRLF 红）：

```bash
cd /tmp && rm -rf piunity-m4-check && git clone -q C:/Users/<用户>/.pi/agent/git/<内部 git 服务器>/pi/pi-unity piunity-m4-check && cd piunity-m4-check && node --test "test/*.test.js" 2>&1 | tail -6 && node bin/unity.js version
```

- [ ] **步骤 5：收尾提交（若步骤 2–3 的文档是在合并后再改的）**

```bash
git add -A && git commit -m "chore(release): v0.7.0 —— 账本 M4-DECISIONS + HANDOFF 刷到 M5 + README/版本"
git tag -f -a v0.7.0 -m "..."   # 只有当 tag 必须先于文档提交时；优先保持 tag 指向含文档的提交
```

⚠️ **顺序纪律**：先把账本/HANDOFF 文档做完并 commit，**再** `ff master` + `tag`（M3 的 `v0.6.0` 就是因为
tag 早于 HANDOFF 提交而与文档脱节）→ 本次 `v0.7.0` 必须**包含** `docs/M4-DECISIONS.md` 与 HANDOFF 更新。

- [ ] **步骤 6：向用户报告（控制者的最后一步）**

报告必须含：`master = <sha>`、`v0.7.0`、测试数、四条判据结论（**有/降级**）、盲测是否独立复现成功、
M4 新增 backlog 清单、以及**一句话的「怎么用」**（§3.6 的三步命令）。

---

## 自检（写完计划后我做过的三项检查）

**1. 规格覆盖度**（对标 `docs/HANDOFF.md` §4 与 `docs/M4-SPIKE.md`）：

| 规格要求 | 落在哪个任务 |
|---|---|
| `lib/art.js` 去底/裁边/缩放（Node 侧） | 任务 2（纯函数）+ 任务 3（接线到命令） |
| `lib/png.js` 补编码器（SPIKE 明说「M4 需补，工作量已知很小」） | 任务 1 |
| `unity asset import` + `--from/--to/--force/--ppu/--max-size/--filter/--compression/--pivot` | 任务 3 |
| 固定约定 `textureType=Sprite`/`Single`/`Clamp`/`FullRect`/`npotScale=None`/`isReadable=false` | 任务 3 的 `artifact`（并作为 intent 被读回比对） |
| `maxTextureSize` 自动抬到 ≥max(w,h) 并读回校验 | 任务 3（`nextPow2AtLeast` + `texWidth/texHeight` 进 intent） |
| 写后读回全部设置 → `verified` 布尔 | 任务 3（**独立第二次调用**读回） |
| Prefab `create`/`instantiate` | 任务 6；`apply` **显式不做**（D-M4-3，进 backlog） |
| `sprite set` 的尺寸口径修正（`localScale ≠ 世界尺寸`） | 任务 4（`--world-size` + `worldSize` 读回）+ 任务 7（SKILL 措辞） |
| 两个必须先回答的未知 | 任务 5（+ 结论影响任务 6/8） |
| 验收四判据 + 独立盲测 | 任务 8 |
| 账本 `docs/M4-DECISIONS.md` + bump 0.7.0 + `ff master` + tag | 任务 9 |
| PITFALLS 新条目统一编号 | 任务 7 |

**2. 占位符扫描**：无「待定 / TODO / 类似任务 N / 添加适当的错误处理」。每个代码步骤都给了可复制的代码或精确的替换锚点；
每个真机步骤都给了命令、期望的退出码/字段与「不一致时怎么办」。**唯一**允许执行者自行决定的写法差异（`parseScriptResult`
的返回形状）已在任务 3/6 显式标注「查源码后按实际改，不许复制第三份 JSON.parse」——这是**接口事实**而非占位符。

**3. 类型/命名一致性**（含冲突扫描后的修正）：`normalizeArt` 的返回 `{img, art:{removeBg,trimmed,output,warning}}` 在任务 2/3 一致；
**读回投影必须与 intent 同形**（`readActual` 返回 `{asset:{…}}` / `{prefab:{…}}`，不能把 `__read` 平铺在顶层 ——
`compareSubset` 对「intent 里是对象、actual 侧不是对象」直接记一条分歧）；`artifact` 的键名在任务 3 的
intent/`.cs` read 模式/SKILL 表三处一致（且 `spriteAlignment/spritePivotX/Y` **只在给了 `--pivot` 时**进 intent）；
`assetPath`/`ppu`/`worldSize` 在任务 4 的 `.cs`/`node-inspect.cs`/intent/SKILL 四处一致（**`ppu` 不进 intent**）；
`__written`/`__read`/`__error` 的两种模式协议在任务 3/4/6 一致；
退出码分类（新增用法码进 `USAGE_FAILURE_CODES`，`BACKGROUND_AMBIGUOUS`/`ART_FULLY_TRANSPARENT`/`SOURCE_NOT_FOUND`/
`BAD_PNG`/`ASSET_EXISTS`/`TEXTURE_TOO_LARGE`/`PARENT_NOT_FOUND`/`SPRITE_NOT_FOUND` 一律**不进**冻结表 → 退出码 1）。
M4 新增用法码共 **10 个**：`BAD_PPU`/`BAD_FILTER`/`BAD_COMPRESSION`/`BAD_MAX_SIZE`/`BAD_REMOVE_BG`/`BAD_FIT`/`BAD_PIVOT`（任务 3）
+ `MISSING_ASSET`/`BAD_ASSET_PATH`/`BAD_WORLD_SIZE`（任务 4）；任务 6 **零新增**。
**测试数**：基线 456 → 任务 1 +4 → 任务 2 +18 → 任务 3 +4+15+1(+1 新增的 tolerance=0 用例)→ +21 → 任务 4/6 各自新增。
**不写死总数**（以 `npm test` 实际输出为准，只增不减）。

---

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-09-20-pi-unity-m4-implementation.md`。执行方式（用户已选定）：

**子代理驱动（subagent-driven-development）** —— 每个任务一个**全新实现者** + **spec 与 code 双审** + ≤5 轮修复循环；
任务 9 由控制者执行。

**起飞前必须先做一次「冲突扫描」**（照 `docs/M3-DECISIONS.md` 里 R201–R213 的做法）：
派一个**只读**子代理通读本计划，产出三张表 —— ① 与 `docs/M4-SPIKE.md`/`docs/M4-PROBES.md` 的**事实冲突**；
② 与既有代码的**接口总表偏差**（`parseScriptResult`/`readBackAndVerify`/`buildPayloadArgs` 的真实签名与返回形状、
`bin/unity.js` 的 handler 约定、USAGE 段的插入位置）；
③ 任务文本**自洽性**（前后任务用到的类型/键名/码名是否一致）。
控制者逐条裁定后记进 `docs/M4-DECISIONS.md`（R379 起）。

**每个任务的简报里必须原样带上**：本计划的「全局约束」整节 + 该任务整节 + `docs/M4-SPIKE.md`（有 `.cs` 的任务再加
`docs/PITFALLS.md` 末尾与 `docs/M4-PROBES.md`）+ 工作树路径。
