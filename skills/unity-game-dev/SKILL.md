---
name: unity-game-dev
description: Use when building, changing, previewing or shipping a Unity / 团结引擎 game through the unity CLI — 搭场景、建节点、挂组件、写脚本、截图验证、构建出包；用户说「用 Unity 做个游戏」「在团结引擎里搭界面」时。
---

# unity-game-dev —— 用 `unity` CLI 在 Unity / 团结引擎里搭游戏

`unity` 是包在 [uloop](https://github.com/hatayama/unity-cli-loop) 之上的信封 CLI。
它补的**唯一**语义是：uloop 的 `Success:true` 只说明「代码执行了」，`unity` 的写命令会
**写后主动读回**，比对 intent vs actual，给出 `verified`。

**已交付的命令（M2 全量 + M3 + M4）**：

| 命令 | 类型 | 退出码 |
|---|---|---|
| `unity doctor [--smoke] [--golden] [--json]` | 只读检查 / **--smoke 与 --golden 会写临时节点** | 0 / 1 / 2 |
| `unity scene tree` | 读场景节点树 | 0 / 1 / 2 |
| `unity scene save [--path <Assets/…>]` | **写**（写后读回：`scene tree` 的 `sceneName` 比对） | 0 且 `verified!==false` / 1 / 2 |
| `unity scene open --path <Assets/…> [--force]` | **写**（写后读回；脏场景且无 `--force` → `DIRTY_SCENE`） | 0 且 `verified!==false` / 1 / 2 |
| `unity node inspect --path <p> [--sibling-index <n>]` | 读单个节点（含 `sprite`/`components` 字段）；`--sibling-index` = 真实子序号（=`scene tree` 的 `siblingIndex`，**同父下可能不连续**），唯一定位同父同名实例 | 0 / 1 / 2 |
| `unity node create --name <n> [--parent <p>] [--components <json>]` | **写**（写后读回） | 0 且 `verified!==false` / 1 / 2 |
| `unity node set --path <p> --patch <json>` | **写**（写后读回） | 0 且 `verified!==false` / 1 / 2 |
| `unity node delete --path <p>` | **写**（读回必须 NOT_FOUND） | 0 且 `verified!==false` / 1 / 2 |
| `unity sprite set --path <p> --color <#hex> [--sorting-order <n>]` | **写**（写后读回） | 0 且 `verified!==false` / 1 / 2 |
| `unity shot [--out <dir>] [--window-name <n>] [--capture-mode <m>] [--match-mode <m>]` | 读（截图） | 0 / 1 / 2 |
| `unity pixels --file <png> [--at x,y] [--region x,y,w,h] [--expect <hex>] [--count-color <hex>] [--diff <png>] [--centroid <hex>] [--bbox <hex>]` | 读（像素判定；`--diff`/`--centroid`/`--bbox` 让「画面变没变」有一等公民判据） | 0 / 1 / 2（`DIFF_SIZE_MISMATCH` 属 **2 档**用法错） |
| `unity play start\|stop\|pause\|step\|status\|click\|mouse\|key\|logs\|view …` | **写**（PlayMode）/ 读（logs） | 0 / 1 / 2 |
| `unity exec (--code-file <f> \| --code <s>)` | 读/执行（动态 C#；无 intent → `verified` 恒 `null`） | 0 / 1 / 2 |
| `unity asset write --to <Assets/…> (--from <f>\|--template <n>) [--force]` | **写**（读回 sha256） | 0 且 `verified!==false` / 1 / 2 |
| `unity compile` | 读（编译结果） | 0 无错 / 1 有编译错 / 2 |
| `unity build --target <t> --out <dir> [--timeout-seconds <n>]` | **写**（构建 + 写后读回产物：主产物存在且非空 + 总字节数 > 0） | 0 且 `verified!==false` / 1 / 2 |
| `unity asset import --from <png> --to <Assets/…>.png […]` | **写**（写后读回：导入设置 11 项 + 纹理真实尺寸 + 落盘 sha256） | 0 且 `verified!==false` / 1 / 2 |
| `unity sprite assign --path <p> --asset <Assets/….png> [--world-size w,h]` | **写**（写后读回：`assetPath` / `worldSize`） | 0 且 `verified!==false` / 1 / 2 |
| `unity prefab create --from-node <p> --to <Assets/….prefab> [--force]` / `unity prefab instantiate --asset <Assets/….prefab> [--parent <p>] [--name <n>]` | **写**（写后读回：`create` = 资产内容；`instantiate` = 实例） | 0 且 `verified!==false` / 1 / 2 |

**构建出包已有**（M3）：`unity build --target <t> --out <dir>` —— 在你**已打开的那个编辑器里**跑
`BuildPipeline.BuildPlayer`（不往项目里写任何文件），写后读回磁盘产物（`verified` 是布尔）。
可用目标取决于**已装的 PlaybackEngines**（U9）：请求没装的目标 → `BUILD_TARGET_UNAVAILABLE`
（退出码 1 + 列出可用目标），**绝不**改打别的目标。**不要**再为此去调裸 uloop / `-batchmode`（见 §9）。

**动态 C# 执行已有**：`unity exec (--code-file <f> | --code <s>)` —— 脚本 `return` 的值原样在 `actual.result`
（**读/执行**命令，无 intent 可比对 → `verified` 恒 `null`）。这是读运行期**脚本字段**（`score` / `bricksAlive` 等）的正路，
**不要**为此去调裸 uloop（见 §8③）。相关坑：`docs/PITFALLS.md` **U23**。

**场景落盘已有**（M3）：`unity scene save [--path <Assets/…>]` / `unity scene open --path <Assets/…> [--force]`
—— 交付物（搭好的场景）终于能用 `unity` 自己证明已落盘：`scene save` **写后读回** `scene tree` 的
`sceneName` 比对，`verified:true` 才算存下（关闭 E2E **B2**：盲测那份 29 节点游戏曾因此丢过一次）。
进 PlayMode 前不再需要用户手工保存（§8⓪ / §5）；`scene open` 在活动场景 dirty 且无 `--force` 时落
`DIRTY_SCENE`（**不许静默丢改动**）。`node inspect` 读的是**对象状态**（Transform 与 SpriteRenderer
的字段 + 组件短名），与脚本字段**不是一回事**（见 §8③）。相关坑：**U26**（「无自救手段」部分已关闭）。

> **退出码口径**：上表是**命令执行结果**。另有：
> **2 = 用法错**（参数缺失（含缺 `--project-path` = `MISSING_PROJECT_PATH`）/ 类型不符 / 枚举外取值 / JSON 语法错 —— `--patch` 语法错、`--patch` 缺值或裸写、
> `--out` / `--window-name` 裸写都属此类）；**3 = 内部错误**（本包 bug，应上报复现步骤）。
> **1 = 运行时/环境/验证失败**（编辑器未连接、节点不存在、`verified:false`、编译不过）。

**验证环境**：团结引擎 2022.3.62t9 + **Unity 官方中国版 2022.3.62f3c1 / 2022.3.62f1c1** + uloop dispatcher 3.5.1 / 包 3.6.3。
两引擎的 4 处硬差异（场景扩展名 `.scene`/`.unity`、窗口名语言、`doctor` 取值、产物名）见
`docs/PITFALLS.md`「追加：Unity 官方版验证新坑」（官方-1…官方-8）与 `docs/UNITY-OFFICIAL-VERIFICATION.md`；
凡涉及版本/界面差异处见 PITFALLS（U11 起逐条带适用引擎标注）。
> ⚠️ **本轮验证的是 Unity 官方中国版**（本网络拿不到国际版：`download.unity3d.com` 被 302 到中国 CDN）——
> 「兼容 Unity 官方版」的证据强度 = 「团结 vs Unity 中国版」，**不是**「团结 vs Unity 国际版」。

---

## 1. 前置检查：第一条命令永远是 `unity doctor`，不绿不许往下做

`unity` 是本包的 **bin 名**（`package.json` 的 `bin` 映射到 `bin/unity.js`）。**全局 `npm i -g` 后 `unity` 在 PATH 上**；
`pi install` 只装 skill，命令用 `node <包目录>/bin/unity.js`（两者等价，下文示例统一写 `unity`）。

`PI_UNITY_ULOOP_BIN`（或 `PI_UNITY_ULOOP_CMD`）**必须在每个新进程里都带上** —— 环境变量不被 shell 历史继承，
新终端 / Pi 的每条 `bash` 都是新进程；漏掉就会回落到 PATH 里的裸名 `uloop.exe`（通常 ENOENT → `ULOOP_NO_JSON`）。
`doctor` 的 `uloop` 项就是用「解析出的 dispatcher 是**磁盘上真实存在的文件**」来兜这件事（解析失败即 FAIL，不假绿）。

```bash
# dispatcher：uloop.exe 的绝对路径（或 PI_UNITY_ULOOP_CMD='["node","..."]'）
export PI_UNITY_ULOOP_BIN="C:/path/to/uloop-bin/uloop.exe"
# 可选：编辑器发现兜底
export PI_UNITY_EDITOR_BIN="D:/path/to/Tuanjie.exe"

unity doctor --project-path "C:/path/to/Project"
```

**判据：退出码 0 且 5 项全 `OK`。任何一项 `FAIL` 都停下处理，不要继续搭场景。**

> ⚠️ **多引擎共存机上，`editor-language` / `build-targets` 的「取值」不可信**（项仍 pass，但取的是
> **发现顺序里的第一个编辑器**（通常是团结），与「当前连的是哪台」无关 —— `lib/doctor.js` 读 `editors[0]`，
> PITFALLS **官方-3**）：官方版项目上 `doctor` 会误报 `android` 可用（实测 `unity build --target android`
> 落 `BUILD_TARGET_UNAVAILABLE`，`actual.available: ["win64"]`）。**构建目标的真值只看 `unity build` 的
> `actual.available`**（§9.1）；语言取值见 §4①。

> **`editor-connection` 绿能证明什么**（真机实测 2026-09-19）：在 `PI_UNITY_ULOOP_BIN` 指向真 uloop 的前提下，
> 绿 ⇒ **编辑器进程活着且打开了该项目**（把编辑器**关掉**后该项 **FAIL**：`uloop list` 返回 `UNITY_NOT_REACHABLE`，退出码 1），
> 故 `uloop X 已连接` 文案属实；但它**不证明每个工具都能跑通** —— 工具层可用性由 `--smoke` 七项 pass 证明（下一节）。

```bash
# 真实输出（团结 2022.3.62t9 + dispatcher 3.5.1，2026-09-19）
  OK  uloop              dispatcher: C:/.../uloop-bin/uloop.exe
  OK  editor-install     unknown (env:PI_UNITY_EDITOR_BIN), 2022.3.62t9 (tuanjiehub:secondaryInstallPath)
  OK  editor-language    zh_CN（hub: C:\Users\...\AppData\Roaming\TuanjieHub）
  OK  build-targets      AndroidPlayer, WeixinMiniGameSupport, windowsstandalonesupport
       hint: 未安装 WebGL 模块；build 默认目标将取项目当前配置
  OK  editor-connection  uloop 3.4.0 已连接

全部通过。
```

> ⚠️ `editor-connection` 行里的 **`3.4.0` 是 project-runner 版本**（`list` 响应的 `Version` 字段），
> **不是 dispatcher 二进制版本**（本机 dispatcher 是 3.5.1）。两个数字不同**不是** bug。

| 失败项 | 处置 |
|---|---|
| `uloop` FAIL | 设 `PI_UNITY_ULOOP_BIN` 指向真实存在的 `uloop.exe`；见 U1（OpenUPM 不可达，别用官方安装命令） |
| `editor-install` FAIL | 设 `PI_UNITY_EDITOR_BIN`；确认 `%APPDATA%\TuanjieHub\secondaryInstallPath.json` |
| `editor-connection` FAIL | 编辑器没开，或没打开该项目。手动启动（U6：`uloop launch` **起不了团结引擎**）：`cmd //c start "" "<Tuanjie.exe>" -projectPath "<P>"`，再重跑 doctor |
| `editor-connection` FAIL，且进程只有 ~117 MB、连 `-logFile` 都没生成 | **官方版可能阻塞在「Unity is running as administrator.」模态框上**（PITFALLS **官方-4**）：点 **`&I wish to continue at my own risk`**（点 Restart 会重启并**再弹同一个框**）。团结侧**未复测** | **官方-4** |
| `build-targets` 带 hint | 是**提示**不是失败：目标取决于安装时勾选的模块（U9，本机 WebGL 未装） |

工具链冒烟（3 个只读工具 + 写-读回-删自闭环）：

```bash
unity doctor --project-path "C:/path/to/Project" --smoke
```

- **`--smoke` 从 M2 起不再只读**：它会建一个临时节点 `__pi_smoke`、改它的 position、再删掉它，并**读回确认无残留**。
  编辑器里的场景会因此变 dirty（本命令**不保存**场景）。上一次跑挂了留下的残留会在本轮开头被清掉。
- 七项全 `OK` 才算工具链可用（compile / get-logs / get-hierarchy / write-create / write-set / write-delete / write-clean）。
- 全 `SKIP` = 编辑器没连上，退出码 1（`--smoke` 从不把没验过当成功）。
- `--json` 里 skip 的 `code` 是原因：`NOT_CONNECTED` = 没连上 / `WRITE_LOOP_NOT_RUN` = 前置步骤失败未执行 /
  `MISSING_PROJECT_PATH` = 未给项目根（写闭环零写入）。

场景回归（黄金测试）—— **同一组确定性指令搭两轮**，比对 `get-hierarchy` 的结构投影，报首个分歧路径：

```bash
unity doctor --project-path "C:/path/to/Project" --golden
```

- `unity doctor --golden` 同样**会写**：建 `__pi_golden` 探针树（根 + 3 个子节点 + 改写 position/scale/active），
  两轮之间整体删除并**读回确认无残留**，最后再删一次并读回；**不保存场景**（编辑器场景会变 dirty）。
- 与 `--smoke` **不能同时用**（两者都写当前场景，混跑无法归因 → 退出码 2）。
- `--json` 形状是 `{ok, mode:"golden", matched, diff, cleanup, blocked, lines}`；`matched:false` 时读 `diff.path`
  （形如 `roots[0].children[1].components[2]`）定位第一个分歧。
- 有残留（`cleanup.status !== 'ok'`）时退出码 1，并给出**手工清理命令** —— 不要带着残骸继续。

---

## 2. 铁律：`Success:true` **不等于**意图达成；写操作看 `verified`

uloop 对**异常和编译错误**是诚实的，但**不验证意图**：

```csharp
cam.fieldOfView = -100f;   // Unity 钳制为 1e-05
// uloop: Result "intent=-100 actual=1E-05"，Success: true
```

所以对这个 CLI：

| 命令类型 | 看什么 | 语义 |
|---|---|---|
| **写**（`node create` / `node set` / `node delete`） | `verified` | `true` = 写后读回比对通过；**`false` = 意图未达成，必须停下处理**（看 `mismatches[].key/intent/actual`） |
| **读**（`scene tree` / `node inspect` / `shot`） | `ok` | `verified` **恒为 `null`**（没有 intent 可比对，不虚报成功）。**不要等读命令的 `verified === true`** |

- 写命令退出码由 `exitCodeFor` 单点判定（`0` = `verified !== false`；`1` = 运行时/验证失败；`2` = 用法错）
  —— 脚本可据此感知「写成功但意图未达成」。
- **一次只发一条 `unity` 命令（含只读命令），不许并行调用。** 并行会互相踩：并行 `exec` 会落
  `SCRIPT_COMPILE_ERROR: Another execution is already in progress`，并行调用（**含只读**，如 `scene tree`）会落
  `UNITY_SERVER_BUSY`（**uloop 是单飞（single-flight）的**）—— 这两个码的**字面**都不指向真实原因
  （批次 A 起 pi-unity 已在 `hint` 里补上「另一条命令正在执行，请串行重试」，但仍应从源头避免），遇到它们先怀疑
  「另一条命令还在跑」，**串行重试**（PITFALLS **U46** / **U49**）。
- `verified:false` 时**不要把后续命令叠上去**：先按 `mismatches` 定位，必要时问用户。
- `hint` / `mismatches` 是第一手证据；`--json` 拿完整信封：

```bash
unity node set --project-path "<P>" --path M1Probe --patch '{"position":{"x":0,"y":3,"z":0}}' --json
```

**反向验证（确认 `verified` 真的有牙）**：float32 的 ULP 在大坐标上会超过 1e-4 容差：

```bash
# ✅ 正确反例：float32 ULP ≈ 0.0078 ≫ 1e-4 → verified:false
unity node set --project-path "<P>" --path M1Probe --patch '{"position":{"x":100000.123,"y":3,"z":0}}'
# ❌ 不要用 1e30：float32 最短往返不产生 mismatch → 会得到 verified:true（误导）
```

> 大坐标下的 `verified:false` 未必等于「写入失败」，而是 float32 精度（见 PITFALLS U15 / R51）。
> 需要不同容差就直接调 `lib/readback.js` 的 `compareSubset(intent, actual, {tol})`。

---

## 3. 搭场景黄金流程（每一步都可执行）

```bash
P="C:/path/to/Project"

# ① 读现状 —— 永远先读；scene tree 给出可用路径与组件
unity scene tree --project-path "$P"

# ② 建节点 —— 写后读回；只建裸节点（Transform）
unity node create --project-path "$P" --name Brick

# ③ 设属性 —— 写后读回
unity node set --project-path "$P" --path Brick --patch '{"position":{"x":0,"y":3,"z":0}}'

# ④ 截图 —— 然后**真的看图**（见 §4）
unity shot --project-path "$P" --out "C:/path/to/shots"

# 交叉证明（每一步之后都可做）
unity node inspect --project-path "$P" --path Brick --json
```

真实成功输出（2026-09-19 真机）：

```
$ unity node create --project-path "$P" --name M1Probe
[VERIFIED] {"name":"M1Probe","active":true,"path":"M1Probe","position":{"x":0,"y":0,"z":0},
            "scale":{"x":1,"y":1,"z":1},"components":["Transform"]}
$ unity node set --project-path "$P" --path M1Probe --patch '{"position":{"x":0,"y":3,"z":0}}'
[VERIFIED] {"name":"M1Probe","active":true,"path":"M1Probe","position":{"x":0,"y":3,"z":0}, ...}
```

### 参数口径（写错就是失败码，不会静默）

- `scene tree` 的 `path` 由节点名拼接，**不保证唯一**，也不能表示含 `/` 的名字。
- `node create --parent`：**含 `/` 的路径从根写起**（如 `Canvas/Panel`）；**裸名（不含 `/`）只匹配根对象** ——
  节点在嵌套里时会报 `PARENT_NOT_FOUND`（`actual.detail` 会说明「裸名只接受根对象」），不是「不存在」。
- `node create --components`：JSON 数组，元素写 `UnityEngine.X` 或短名 `X`，一律映射到短名比对。
  - `Sprite` 是**资源类型不是 Component** → `NOT_A_COMPONENT`（真机实证）。要挂渲染用 `SpriteRenderer`。
  - 抽象/不可实例化类型（如 `Collider`）→ `COMPONENT_ADD_FAILED`，且**不留残骸**（R106 真机抓到）。
- `node set --patch`：**非空** JSON 对象；支持的键**只有** `name` / `active` / `position` / `scale`。
  - `position` / `scale` 必须给完整 `x/y/z`。
  - 空对象 `{}` → `EMPTY_PATCH`；未知键（如 `components`）→ `UNKNOWN_PATCH_KEY`（用法错，退出码 2）。
  - **JSON 语法错**（如 `--patch '{"active":}'`）退出码是 **2（用法错）**，不是 1；`--patch` 裸写（不给值）则落 `MISSING_PATCH`（用法错，退出码 2）。
- `--out` **建议绝对路径**：相对路径以**编辑器进程的工作目录**为基准（不是当前 shell 的 cwd）。
- `--window-name` / `--out` **裸写**（不给值）会被 `BAD_WINDOW_NAME` / `BAD_OUT_DIR` 当场挡下（不会静默造目录）。
- `scene save --path X` 是 **Save-As**：把**当前活动场景**另存为 `X`，并让 `X` 成为活动场景
  （不是「把内存里的场景保存回它原本的路径」）——**不要**拿它去覆盖用户的验收场景；
  搭完自己的场景后另存成新路径才是它的正常用法（PITFALLS **U37**）。
- **`scene save` 省略 `--path` = 把所有打开的场景各自原地保存**（逐场景 `SaveScene(scene, scene.path)`）——
  **不是** Save-As、也**不是**把当前场景另存到别处；要另存才给 `--path`（R478g；与 PITFALLS U23/U37 同口径）。
  （`--path` 裸写**不会**静默退化成「全部保存」：它是用法错 `BAD_TARGET_PATH`，退出码 2。）

### ⚠️ 裸节点在截图里看不见（不是 bug）

`node create` 建出来的节点只有 `Transform`，**Game 视图不会渲染任何东西**。
`M1Probe` 在建好之后截的图里**本来就应该看不见**。要让它可见得挂 `SpriteRenderer` + 一张 Sprite
（运行时纯色 sprite 的搭法见 §3.5）—— 本节只说裸节点的截图预期，不是命令缺陷。

**证明节点确实在场景里，用这两条，不要靠「图里看得见」**：

```bash
unity scene tree --project-path "$P" --json        # actual.roots 里有 M1Probe
unity node inspect --project-path "$P" --path M1Probe --json   # ok:true（verified:null）
```

### 3.5 打砖块配方（**盲测与 demo 的标准游戏**，数字逐字照用）

**渲染方式**：全靠**运行时生成的纯色 sprite** + 正交相机。不引入任何外部图片、不用 TMP、不碰 TextureImporter。

**世界单位约定（关键）**：`unity sprite set` 造出来的基础 sprite 是 **1×1 世界单位**（PPU=1f），
所以 **`localScale = 世界尺寸`** —— 一个方块的世界尺寸就是它的 `localScale`
（用 `node set --patch '{"scale":{...}}'` 设；默认 PPU 100 会让方块小到看不见）。

> ⚠️ **这条只对「本命令造的 1×1 sprite + 父级无缩放」成立**（M4 补充）：
> 一旦 sprite 是**资产**（`unity sprite assign --asset …`），世界尺寸 = **纹理尺寸 / PPU × 缩放**，
> 父级有缩放时还会再乘一层。**唯一可靠的口径**是读回：`unity node inspect` 的
> `sprite.worldSize` 就是世界空间的真实尺寸；要「正好 w×h」就直接用
> `unity sprite assign --world-size w,h`（它会把父级缩放除掉再反算 localScale）。

**相机**：模板场景里已有 `Main Camera`，正交、`orthographic size = 5`、位置 `(0,0,-10)`。
`PiBrickBreaker` 脚本会在 `Start()` 里把背景色改成 `#0A0A14`（近黑）。

**节点约定与尺寸**（Bricks 是空容器，砖块是它的子节点）：

| 节点 | 路径 | scale（世界尺寸） | position |
|---|---|---|---|
| 容器 | `Bricks` | — | `(0,0,0)` |
| 砖块 ×24 | `Bricks/Brick_<col>_<row>`（col 0..5、row 0..3） | `(1.6, 0.5, 1)` | `x = (col - 2.5) * 1.85`、`y = 3.0 - row * 0.75`、`z = 0` |
| 挡板 | `Paddle` | `(2.4, 0.35, 1)` | `(0, -4.2, 0)` |
| 球 | `Ball` | `(0.4, 0.4, 1)` | `(0, -3.2, 0)` |
| 游戏逻辑 | `GameManager` | — | `(0,0,0)`，挂 `PiBrickBreaker` 组件 |

**配色（`--color` 的 hex）**：砖块按行 —— row0 `#FF2E88`、row1 `#FFE94A`、row2 `#4DFF7A`、row3 `#FF7A2E`；
挡板 `#00FFC8`；球 `#FFFFFF`；背景 `#0A0A14`（脚本设）。四行颜色**互不相同**，便于按颜色计数验证。

**完整搭法**（可整段复制；`P` 是项目路径）：

```bash
P="C:/path/to/Project"
# ① 固定 Game 视图尺寸（像素判定的坐标基准；只影响本次会话）
unity play view --project-path "$P" --width 960 --height 640
# ② 装脚本并编译
unity asset write --project-path "$P" --to Assets/PiBrickBreaker/PiBrickBreaker.cs --template PiBrickBreaker
# ③ 建容器与方块（24 块砖；颜色按行）
unity node create --project-path "$P" --name Bricks
for col in 0 1 2 3 4 5; do
  for row in 0 1 2 3; do
    x=$(awk "BEGIN{printf \"%.3f\", ($col - 2.5) * 1.85}")
    y=$(awk "BEGIN{printf \"%.3f\", 3.0 - $row * 0.75}")
    unity node create --project-path "$P" --name "Brick_${col}_${row}" --parent Bricks --components '["SpriteRenderer"]'
    unity node set --project-path "$P" --path "Bricks/Brick_${col}_${row}" --patch "{\"position\":{\"x\":$x,\"y\":$y,\"z\":0},\"scale\":{\"x\":1.6,\"y\":0.5,\"z\":1}}"
  done
done
# 砖块颜色按行：row0 品红 / row1 黄 / row2 绿 / row3 橙（颜色只与 row 有关）
COLORS=('#FF2E88' '#FFE94A' '#4DFF7A' '#FF7A2E')   # 下标即 row
for row in 0 1 2 3; do
  for col in 0 1 2 3 4 5; do
    unity sprite set --project-path "$P" --path "Bricks/Brick_${col}_${row}" --color "${COLORS[$row]}"
  done
done
# ④ 挡板 / 球 / 逻辑节点
unity node create --project-path "$P" --name Paddle --components '["SpriteRenderer"]'
unity node set    --project-path "$P" --path Paddle --patch '{"position":{"x":0,"y":-4.2,"z":0},"scale":{"x":2.4,"y":0.35,"z":1}}'
unity sprite set  --project-path "$P" --path Paddle --color '#00FFC8'
unity node create --project-path "$P" --name Ball --components '["SpriteRenderer"]'
unity node set    --project-path "$P" --path Ball --patch '{"position":{"x":0,"y":-3.2,"z":0},"scale":{"x":0.4,"y":0.4,"z":1}}'
unity sprite set  --project-path "$P" --path Ball --color '#FFFFFF'
unity node create --project-path "$P" --name GameManager --components '["PiBrickBreaker"]'
# ⑤ 落盘（**必须做**）—— 写后读回：verified:true 才说明场景真的存进了磁盘
#    ⚠️ 扩展名按**引擎**定（**官方版只认 `.unity`；团结用 `.scene`**，PITFALLS 官方-1）：
#      先看项目 Assets/Scenes/ 下**已有**场景资产的扩展名，照它写；没有就先按引擎选：
#        官方版（编辑器在 `Unity\Hub\Editor\…\Unity.exe`）→ Assets/Scenes/SampleScene.unity
#        团结（`Tuanjie.exe`）                          → Assets/Scenes/SampleScene.scene
unity scene save --project-path "$P" --path Assets/Scenes/SampleScene.unity  # 团结改成 .scene
```

> 每条写命令都会**写后读回**：看到 `[UNVERIFIED]`（`verified:false`）就**停下**，不要继续往下搭。
> 砖块颜色那一步就是上面**第二个循环**（**4 行 × 6 列 = 24 次 `sprite set`**）。**不要**只照抄一行示例
> 了事 —— 那样 24 块里只有 1 块上了色、其余 23 块留在默认白 `#FFFFFF`，与「四行颜色互不相同、
> 便于按颜色计数验证」的设计直接冲突。
> `GameManager` 挂在 `Bricks`/`Paddle`/`Ball` 之后：脚本在 `Start()` 里按名字找它们，建早了就找不到。
> **⑤ `scene save` 不能省**：`node create` / `sprite set` 只改**内存** —— 不落盘的话编辑器一退出，
> 交付物就没了（E2E 盲测实证：那份 29 节点游戏因此丢过一次）。`verified:true` 才是「存进磁盘」的证据，
> 反面证据：`grep -c "Brick_" <项目>/Assets/Scenes/SampleScene.<ext>` 应 > 0（`<ext>` = ⑤ 实际用的 `.unity` / `.scene`）。

> ⚠️ **真机教训（必读）：EditMode 里 `sprite set` 挂的 sprite，进 PlayMode 会丢。**
> `unity sprite set` 造的是**运行时对象**（非资产），进 PlayMode 的 **domain reload 会销毁它** ——
> 实测 `node inspect` 的 `sprite.spriteName` 从 `""` 变 `null`，渲染图里**一块砖都不渲染**（只剩背景色 + OnGUI 文字）；
> 而 `sprite.color` 是组件上的**序列化字段**，能活下来。
> 模板 `PiBrickBreaker.cs` 的 `Start()` 已内置 `EnsureSprites()` 兜底：给**任何缺 sprite 的** `SpriteRenderer`
> 补一张共用的 1×1 白 sprite（`pixelsPerUnit = 1f`，与配方同一约定）—— **所以颜色照旧在 EditMode 用 `sprite set` 设就够**。
> 用自己的脚本（不装模板）就必须自己补，否则要在**进 PlayMode 之后**重跑 `sprite set`。
> ⚠️ 进过一次 PlayMode 后，**EditMode 的 Game 视图也看不到方块了**（sprite 已销毁、颜色还在）—— 属正常现象，
> 要验证画面就进 PlayMode 看。
> ⚠️ **这条只对 `sprite set` 造的运行时 sprite 成立**；用 `sprite assign` 挂**资产** sprite（§3.6）时
> EditMode 照样看得见（资产引用会被场景/Prefab 序列化，过 domain reload 不丢）。

### 3.6 美术配方：用户供图 → 导入 → 绑定 → 画面里看得见

> **本链的第 4 步（= §8⑥ 的两条证据）是「证明它真的在画面里」**（`shot` → `pixels --count-color`，再进 PlayMode 复看一次）。
> 链内前三步只保证「资产与导入/绑定真的生效」，**不保证画面可见**；只有 §8⑥ 的两条证据都拿到才算做完。

**链内三步 + 一步证明**（链内三步全是写命令，都要看 `verified`）：

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

> ⚠️ **`--world-size` 的先后顺序（R478d）**：`--world-size` 的单位是**世界单位**，它依赖 `--trim`/`--fit` 之后的
> **最终画布尺寸** —— 也就是 `asset import` 读回里的 `actual.art.output`。**先 `import` 读回来再算**，
> 别拿**原图尺寸**算：裁过边 / contain-fit 过的图，原图尺寸会偏大，反算出来的世界尺寸跟着偏大。

> ⚠️ `scene save --path X` 是 **Save-As**（把**当前活动场景**另存为 X 并让它成为活动场景）。
> 要保存**用户既有的场景**就用**它自己的路径**（先 `unity scene tree --json` 看 `actual.sceneName`），别另起名字。

**命令口径（写错就是失败码，不会静默）**：

| 参数 | 含义 | 默认 |
|---|---|---|
| `--from <本地png>` | 宿主上的源图（`asset import` 专用；**绝对路径**最稳） | 必填 |
| `--to <Assets/...>` | 项目内目标路径（`Assets/` 开头、不含 `..`）。**`asset import` 的 `--to` 必须 `.png` 结尾；`prefab create` 的 `--to` 必须 `.prefab` 结尾**（父目录会被自动创建） | 必填 |
| `--from-node <path>` | `prefab create`：要存成 Prefab 的**源节点路径**（形如 `Brick_0_0`；源是 Prefab 实例 → `SOURCE_IS_PREFAB_INSTANCE`/1） | 必填（`prefab create`） |
| `--name <n>` | `prefab instantiate`：实例名；**不给则用资产读回的「真实根名」**（外部 Prefab 的根名可能 ≠ 文件名） | 资产根名 |
| `--remove-bg auto\|#RRGGBB` | 去底：`auto` = 按**四角**推断背景色；也可显式给色值 | 不去底 |
| `--tolerance <0-255>` | 去底容差（只在给了 `--remove-bg` 时有意义） | 40 |
| `--trim` | 裁掉全透明的外边 | 不裁 |
| `--fit <w,h>` | contain-fit 到该画布（最近邻、保持比例、空白透明） | 不缩放 |
| `--ppu <n>` | 每世界单位多少像素（**决定 sprite 的世界尺寸** = 纹理尺寸/PPU） | 16 |
| `--max-size <n>` | Unity 的 `maxTextureSize`（**小于源尺寸会被静默缩放**，本命令会自动抬到 ≥ 源尺寸的 2 的幂）。上限 **16384**（超 → `BAD_MAX_SIZE`/2）；**源图任一边 > 16384 → `TEXTURE_TOO_LARGE`/1**，先用 `--fit` 缩下来 | 自动 |
| `--filter <point\|bilinear>` | 采样方式（像素画必须 `point`，否则糊） | point |
| `--compression <none\|normal>` | 压缩（像素画必须 `none`，否则糊成 DXT 块） | none |
| `--pivot <x,y>` | 精灵轴心（0–1）；给了就落 `Custom(9)` | Center(0.5,0.5) |
| `--asset <Assets/...>` | **`sprite assign` 是图片资产**（项目内的 `.png`，不是宿主路径！）；**`prefab instantiate --asset` 是 `.prefab`** | 必填 |
| `--world-size <w,h>` | `sprite assign`：把缩放反算成「世界空间里正好 w×h」（父级有缩放会自动除掉）。必须是两个**十进制正数**且都 **> 1e-4**（否则 `BAD_WORLD_SIZE`/2） | 不改缩放 |
| `--force` | 目标已存在时必须显式给（**覆盖已有资产/Prefab 要先问用户**，见 §5） | 不加 |

**怎么证明「真的进去了」**（`asset import` 的 `--json` 里直接有）：

- `intent.asset` = 我们要的设置；`actual.asset` = **读回来的真实设置**（11 项 + `texWidth/texHeight/texFormat/mipmapCount`）；
  `verified:true` 才是「设置真的生效」。
- `actual.art.removeBg.keyColor` = 推断/指定的背景色；`actual.art.trimmed` = 裁边框；
  `actual.art.warning` 非空 = **背景可能不是纯色**（命中率 <10%）→ 先 `read` 看一眼原图再决定。
- `actual.file.sha256` = 落盘文件的哈希（假绿防线：磁盘上真的是我们要写的那份）。
- `actual.maxTextureSizeRaisedFrom` 非空 = 你给的 `--max-size` 太小，被自动抬升了。
- ⚠️ **`texFormat` 的语义（R478b）**：`"RGB24"` **不等于** alpha 丢了 —— 画布**全不透明**时 Unity 会丢掉
  恒定的 alpha 通道（纹理格式随之退回 24 位）。`texFormat` **不在 intent 里、不做判据**；看到 `RGB24` 先按
  「全不透明」理解，**别**当成「去底把 alpha 删了」。

**⚠️ 三条必读的坑**（完整版见 `docs/PITFALLS.md`）：

1. **`sprite set` 与 `sprite assign` 不是一回事**：前者造的是**运行时** 1×1 纯色 sprite
   （进 PlayMode 的 domain reload 就没了 —— 见 §3.5 的血泪教训），后者挂的是**资产**引用
   （会被场景/Prefab 序列化、能随交付物走）。**用户供图必须用 `sprite assign`。**
2. **尺寸口径**：`node inspect` 的 `sprite.worldSize` 才是「这个节点在画面里到底多大」
   （世界空间 AABB = 精灵 bounds × 缩放，父级缩放已含在内）。`--world-size` 只是帮你反算缩放。
   ⚠️ **节点或祖先有旋转时，`--world-size` 会（预期地）落 `verified:false`**（读回用的是 `sr.bounds` 世界 AABB）
   → 出路是**先把旋转清零**或改用 `shot`+`pixels` 判据；**不要**为此放宽容差。
3. **背景不是纯色时**：`--remove-bg auto` 会落 `BACKGROUND_AMBIGUOUS`（退出码 1）——
   这不是 bug，是让你**显式给色值**：`--remove-bg '#RRGGBB'`（用 `read` 工具打开原图取色）。
   - **`--remove-bg` 的判定口径（R478c）**：按 **max 通道差** `d = max(|Δr|,|Δg|,|Δb|)`（对背景色）判定 ——
     `d ≤ --tolerance` → 该像素**全透明**；`tolerance < d ≤ 2×--tolerance` → **羽化** alpha 并做 de-spill
     （把主导通道压回其它通道的水平）。所以**主体里若有与背景相近的颜色**（落进第二个区间）会被部分透明化 +
     改色 —— 去底前先确认主体色离背景色足够远，或显式给 `--remove-bg '#RRGGBB'`。

**⚠️ M4 追加的三条（资产精灵尺寸 / 去底边界）**：

4. **资产 sprite 的尺寸口径只对「本工具的导入产物」可靠**：`unity asset import` 保证
   `spriteMeshType=FullRect` + `spriteImportMode=Single`。`--world-size` 的反算依赖 `SpriteRenderer.bounds`
   （**世界 AABB**，= 精灵 bounds × 缩放）：**旋转会让它（预期地）落 `verified:false`**（已实测，
   出路是先把旋转清零或改用 `shot`+`pixels` 判据，**不要**为此放宽容差）；**非均匀父级缩放**同样会破坏口径
   （部分实测）；`Tight`/`Sliced`/`Tiled` 已由 B-2 真机钉死（见下方第 7/8 条），**图集**对这条判据的影响仍**未探测**
   （`Tight` 的几何行为见 U34：它**并不裁几何**）；**图集（Multiple）→ `AMBIGUOUS_SPRITE`**（退出码 1，硬失败，**不会**随便挑子图）
   （PITFALLS **U43**）。
5. **Screen Space Overlay 的 Canvas 下「世界尺寸」语义与屏幕像素不同**（CanvasScaler 会影响子节点）——
   `--world-size` 写读自洽，但**画面里的视觉尺寸不等于世界单位**（PITFALLS **U43**）。
6. **图本来就带透明背景时别给 `--remove-bg`**：四角**全透明** → `BACKGROUND_AMBIGUOUS`
   （`detail.reason:'transparent-corners'`）——这张图**没有实心背景**，直接 `--trim` 即可；
   `--remove-bg auto` 在**部分角透明**时仍可能误判（**未探测**，PITFALLS **U45**）。

**⚠️ B-2 追加的三条（`drawMode` / `Tight` / UI `Image`，官方 2022.3.62f3c1 实测）**：

7. **`--world-size` 只在 `drawMode=Simple` 下有定义**：`SpriteRenderer.drawMode=Sliced/Tiled` 时读回的是
   `sr.bounds.size = sr.size × scale`（写侧用 `Sprite.bounds`）→ 会（预期地）落 `verified:false`（PITFALLS **U52**）。
   只对 `drawMode=Simple` 用 `--world-size`，或先把 drawMode 改回 Simple 再 assign，或改用 `shot`+`pixels` 判几何。
8. **`Tight`（`spriteMeshType`）不裁几何、对 `--world-size` 无影响**：`Tight` 与 `FullRect` 下 `Sprite.bounds` 全同
   （PITFALLS **U34**；官方 2022.3.62f3c1 实测 `Tight` 下 `--world-size 2,1` 仍 `verified:true`）。要裁边用 Node 侧 `--trim`。
9. **UI 节点走 UI 管线，`sprite assign` 不处理 `Image`**：节点上只有 UI `Image`（无 `SpriteRenderer`）时
   落 `UI_IMAGE_PRESENT`（退出码 1）—— 先删掉 / 挪走 `Image`，或换非 UI 节点；要设 `Image.sprite` 用 `unity exec`
   （PITFALLS **U53**）。

**Prefab 两条命令**：

```bash
unity prefab create --project-path "$P" --from-node Hero --to Assets/Prefabs/Hero.prefab --json
unity prefab instantiate --project-path "$P" --asset Assets/Prefabs/Hero.prefab --parent Bricks --name Hero_1 --json
```

- `prefab create` 的读回是**把资产内容读回来**与源节点比对：**position/scale/spriteAssetPath/components 来自源节点；name = `--to` 的文件名**（Unity 语义）。**`components`** 让空节点（只有 `Transform`）的投影也不再恒真（R448/U51）。
- **`--to` 必须以 `.prefab` 结尾**（在 `Assets/` 下、不含 `..`）；**父目录不存在会被自动创建**
  （本命令在写之前 `mkdir`，照 `asset import` 的既有做法）—— 所以 `--to Assets/Prefabs/Hero.prefab`
  在**没有任何 `Assets/Prefabs/`** 的项目里也**可以照抄生效**（不再落 `PREFAB_SAVE_FAILED`）。
- **同名覆盖 = 更新**：资产 guid 不变 → 引用它的场景/其它 Prefab **不会断**（真机证据：`docs/M4-PROBES.md` 问题②）。
- `prefab instantiate --parent` 用 `SetParent(t, false)` —— **不受父级位置/缩放污染**；
  父节点不存在 → `PARENT_NOT_FOUND` 且**本次不建任何实例**。
- **`prefab create --force` = 更新，不是重建**：三条规则 —— ① 未被 override 的属性**跟随**资产；
  ② 已被 override 的属性**保持实例自己的值**；③ **根 `localPosition` 恒被记为 override → 永不跟随**
  （PITFALLS **U39**；真机落盘证据见 `docs/M4-PROBES.md` §②-8）。
- **`SaveAsPrefabAsset` 不会把源节点变成实例**：源节点仍是普通节点，之后改 Prefab **不会**影响它
  —— 要联动得再 `prefab instantiate`；而实例**沿用资产生成时那个节点的位姿**，所以**多个实例会叠在一起**，
  建完要显式 `unity node set --patch '{"position":…}'` 摆开（PITFALLS **U40**）。
- **`SaveAsPrefabAsset` 会用文件名覆盖 Prefab 根名**（Unity 语义；连文件内 `m_Name` 都不算数 ——
  团结 2022.3.62t9 + 官方 2022.3.62f3c1 均已实测）→ 读回一律以资产读回为准（PITFALLS **U41**）。
- **`unity prefab apply --path <实例根>` / `unity prefab revert --path <实例根>`**：把实例覆盖**写回资产** / **丢弃**实例覆盖
  （写后读回：实例投影 vs 资产投影）。⚠️ **根 `localPosition` 是 Unity 豁免项** —— apply **不**写进资产、revert **不**还原它
  （读回面已排除根 `position`）；`--path` 必须是**实例根**（非根子对象 → `NOT_PREFAB_INSTANCE`，退出码 1）（PITFALLS **U55**）。
- **图集（SpriteAtlas）下的 `--world-size`**：图集**打包不改** `Sprite.bounds` 也不改 `assetPath` → `--world-size` 仍 `verified:true`；**无需 `com.unity.2d.sprite` 包**；`Multiple`（一张图多子 sprite）仍硬失败 `AMBIGUOUS_SPRITE`（PITFALLS **U43**，批次 C-C）。
- **同父下多个同名实例**：用 `unity node inspect --path <p> --sibling-index <n>` 唯一定位 —— `n` 是目标节点的**真实** `GetSiblingIndex()`（就是 `unity scene tree` 读回里该节点的 `siblingIndex` 字段值，**同父下可能不连续**，**不是**「同名命中列表的下标」）。不给参数时仍取第一个（**保持既有行为**），但读回 `matchCount > 1` 会提示；也可用 `prefab instantiate --name` 给不同名（PITFALLS **U42** 订正 / **U50**）。
- **源节点边界**：源是 **Prefab 实例** → `SOURCE_IS_PREFAB_INSTANCE`（退出码 1，不静默产出 Variant）；
  源是**子节点** → 允许，但 Prefab 根保留它的**局部** position/scale（Unity 语义），
  实例化后世界位置与原子节点不同。
- **`--parent <p>` 必须是当前场景里真实存在的路径**（`Bricks` 是 §3.5 的容器）——美术任务先跑
  `unity scene tree --json` 确认，或干脆**不给** `--parent`（实例落到场景根）。

### 3.7 交付：资产 + 引用方 + `.meta` 必须同批提交（M4 实测）

**硬结论**：把美术交给别人（或提交进仓库）时，**PNG + 它的 `.meta` + 引用它的场景/Prefab 必须同批**。

- ✅ **同批提交即可交付**（本机实证）：全新 clone（**完全没有 `Library/`**）之后，
  32-hex 引用 guid（`AssetDatabase.AssetPathToGUID`）、`.meta` 里的 guid、
  场景 YAML 里的 guid 字面量、`unity node inspect` 的整个 `sprite` 子对象**全都不变**，
  `LoadAssetAtPath<Sprite>` 仍能载入 → 引用**不会断**。
  （本探测在**团结**上做：`.meta` 的 guid 是 56 字符 base64、与 32-hex 引用**不是**同一个；
  **官方 2022.3.62f3c1 实测两者是同一个 32-hex** —— 「两套 id」不是普遍规律，见 PITFALLS **U30** / R476。）
- ❌ **`.meta` 缺失 + 收件人没有 `Library/`（= 拿到压缩包的场景）→ 引用真的断**：
  实测 guid 变成**另一个值**、`node inspect` 的 `sprite.assetPath/ppu/worldSize` 全变 `null`。
- ⚠️ **`.meta` 缺失但那条 `Library/` 还在**（只有本机才有的退路）：引用活着，但**导入设置回默认**
  —— `ppu 16 → 100`、世界尺寸 `0.75×0.5 → 0.12×0.08`（像素画直接变糊、尺寸错）。
  **这条退路不可依赖**（交付物里没有 `Library/`）。

```bash
# 交付/提交时一起走的东西（缺一不可）
Assets/Art/hero.png                # 美术资产
Assets/Art/hero.png.meta           # 引用 id + 导入设置（两样都在它里面）
Assets/Scenes/SampleScene.unity    # 引用它的场景（团结 .scene）
Assets/Prefabs/Hero.prefab         # 引用它的 Prefab
```

- **跨机器 / 改过项目根或项目名的情况未验证**（这是本机实证的边界）。
- ⚠️ **「guid 非空」不能当「资产还在」的判据（R477 / PITFALLS U47）**：`AssetDatabase.AssetPathToGUID`
  在 `DeleteAsset` 之后（即使 `Refresh(ForceUpdate)`、磁盘文件已删）**仍返回过期 guid** → 会**假绿**。
  判定「资产还在」一律用 `AssetDatabase.LoadAssetAtPath<Sprite>(path) == null`（或 `GetMainAssetTypeAtPath`）；
  `AssetPathToGUID` 只在「已确认资产存在时取引用 id」时可靠（本节的 clone 对比就属此用法）。
- 完整证据（含反例 A2-3）见 `docs/M4-PROBES.md` 问题①与 `docs/PITFALLS.md` 的
  「M4：全新 clone / 删 `Library/` 之后资产引用是否仍在」。

---

## 4. 截图注意

```bash
unity shot --project-path "$P" --out "C:/path/to/shots"
# 真机输出： [OK] {"path":"...\\游戏_20260919_012315_061.png","width":892,"height":355,"captureMode":"window"}
```

1. **窗口名按界面语言**：uloop 的 `--window-name` 是**按窗口标题精确匹配**的（U7）。
   中文编辑器的标题是 **游戏 / 场景 / 控制台 / 层级 / 项目 / 检查器**
   （⚠️ **Inspector 是「检查器」，不是「属性」** —— R101/R111 真机枚举纠正）。
   `unity shot` 会按 `editor-language` **双向**映射（英文名→中文标题；中文标题→英文名）；映射覆盖不到时给
   `WINDOW_NAME_LOCALIZED` + 出路。
   ⚠️ **与团结共存的机器上，官方版英文界面可能救不回来**（PITFALLS **官方-2**）：`%APPDATA%\TuanjieHub\`
   存在 → `language()` 取到的可能是**团结的** `zh_CN`（与当前连的编辑器无关）→ `Game` 被映射成「游戏」→
   官方版（窗口标题是英文）落 `WINDOW_NAME_LOCALIZED`。`unity shot` 会在本地化失配时**自动用另一种形态重试一次**
   （`游戏` → `Game`，反之亦然）；仍不行就先试 `--window-name Game`（英文原名），**最稳的是进 PlayMode 用
   `--capture-mode rendering`**（此时窗口名被忽略，见下条）。
2. **首选正路（绕开本地化）**：进 **PlayMode** 后，uloop 的 `--capture-mode auto` 会解析为
   `rendering`，此时 **`--window-name` 被上游忽略** —— 天然不受界面语言影响（U7 处理②）。
   `unity shot` 故意**不传** `--capture-mode`（硬传 `rendering` 要求 PlayMode，EditMode 下会失败）。
3. **要切 `--capture-mode` / `--match-mode` 直接用 `unity shot` 的开关**（M2 已接线；`rendering`/`GameView` 需 PlayMode，`--match-mode` 仅在 window 模式生效）。
4. **用响应里的图像路径**：`--json` 下是 `actual.path`（来自上游 `Screenshot.ImagePath`）；
   **不要** `ls -t` 猜「最新」—— 输出目录会累积历史图，那样会拿到旧图。
5. **真的看图**：用 `read` 打开返回的 PNG，确认是**真实渲染内容**（非空、非黑、非异常）。
   - 空/黑：可能窗口不对（U7）、或 PlayMode 暂停在旧帧（重拍前 `Step` 一帧）。
   - 图里有内容但「没看到刚建的节点」：读 §3 的「裸节点看不见」。
6. **首次截图前确保 Game 视图已打开**（PITFALLS **官方-5**）：官方 `-createProject` 的空项目 Game 视图
   **默认没打开** → 连 PlayMode 的 `--capture-mode rendering` 也会失败
   （`ULOOP_ERROR: PlayMode rendering did not produce an image.`，日志里是 `Play Mode view RenderTexture is not available`）。
   用 `exec` 打开（`UnityEditor.GameView` 是 **internal**，直接 `typeof(GameView)` 会落 **CS0122**，必须反射取类型 —— 真机实测）：
   ```bash
   unity exec --project-path "$P" --code 'var t = typeof(UnityEditor.EditorWindow).Assembly.GetType("UnityEditor.GameView"); UnityEditor.EditorWindow.GetWindow(t).Show(); return t != null;'
   ```
7. **默认 `shot` 是 window 模式，图尺寸由 Game 窗口决定**（实测：`play view` 请求 960×640 → 图 **892×355**，
   每单位像素从 64 变 **≈33.3**）。**要做几何对账/可见性判据就显式 `--capture-mode rendering`**（需 PlayMode）；
   否则按图的实际尺寸套 §8⑤ 的公式会对不上（PITFALLS **U36**）。判「颜色在不在 / 有几个像素」这类
   **相对判据**才可以用 window 图。
8. **`retriedFrom` 是机器可读的「换过语言形态」信号（R478e）**：与团结共存的机器上窗口名会**双向**重试
   （PITFALLS **官方-2**）；响应里 `actual.retriedFrom` **非 null** 就表示「第一次用的名字没命中，自动换另一种
   语言形态后才成功」（实测 `retriedFrom:"游戏"` + `windowName:"Game"`；`windowName` 才是真正命中的那个）。
   看到它就知道本地化映射发生了兜底 —— 判「窗口名到底用的哪个」以这两个字段为准。
9. **window 图与 rendering 图的坐标不同源（R478f）**：两者尺寸不同（同一会话实测 906×440 vs 906×419，
   内容上方 chrome 高 **19 px**）→ 跨图复用 `--at` / `--region` 坐标要加偏移（`windowY = renderingY + 19`）；
   更稳的做法是**在同一模式内**取坐标，别跨图搬。
10. **`scene save` 省略 `--path` = 原地保存全部打开场景**（R478g；口径见 §3 参数口径 / PITFALLS U37）。

---

## 5. 停止条件（遇到就先问用户，不要自作主张）

以下操作**必须先取得用户明确同意**：

- **删节点 / 删资产**（`unity node delete` **本身可用** —— 写后读回，读回 `NOT_FOUND` 才算 `verified`；
  但它**不可逆**且按 Unity 语义**连带删掉整个子树**：删除**用户既有内容**前必须先问；
  只有清理**本会话自建的探针 / 临时节点**才可直接删）
- **覆盖已有脚本**（向 `Assets/` 下已存在的 `.cs` 写入）
- **覆盖已有的美术资产 / Prefab**（`asset import --force`、`prefab create --force`）—— 先问用户；
  同名覆盖虽然保 guid（引用不断），但**旧内容不可恢复**。
- **改 Build Settings / Player Settings / `Packages/manifest.json`**（包依赖、目标平台、场景列表）
- **在编辑器里切换场景 / 丢弃未保存改动**：`unity scene open` 会**替换当前场景**，加 `--force` 更会
  **丢弃未保存改动** —— 打开**用户既有**场景、或要丢弃用户改动之前先问用户。
  **`unity scene save` 不属此类**：它就是「搭完就落盘」的正路（§3.5 末步 / §8⓪）—— 搭出来的东西本来就该存下来。
  `unity play start` **需要「已保存」的场景**：进 PlayMode 前先跑 `unity scene tree --project-path "$P" --json`
  看 `actual.sceneName`；**空串 / 未命名**（刚解包 / 新建的项目常见）就用
  `unity scene save --path Assets/Scenes/SampleScene.<ext>` 落盘（**`<ext>` 按引擎：官方版 `.unity`、团结 `.scene`**，
  见 §3.5⑤ / PITFALLS 官方-1；也可 `unity scene open` 打开已存在的场景），
  再继续。不要再走裸 uloop（§8⓪）。
  ⚠️ **`scene open` 会直接替换当前场景**，而它的 `DIRTY_SCENE` 守卫只认 `isDirty` —— 本环境里
  **CLI 自己造的改动不会置 `isDirty`**（U27）→ **切场景前必须先 `unity scene save`**，不要指望守卫提醒你。
- 其它不可逆或跨越项目边界的操作（改 git 历史、删 `Library/`、动其它项目）

原则：写操作前先读现状（`scene tree` / `node inspect`），不确定就问。

---

## 6. 迭代上限：截图不对最多改 3 次

- 「不对」= 画面内容错 / 空 / 黑 / 窗口不对 / 与意图不符。
- 每改一次都要走**写后读回**（`verified`），并重新截图**看图**。
- **3 次仍不对 → 停下**，把以下内容交给用户，不要再猜：
  - 最新截图路径 + 你看到的（期望 vs 实际）
  - 已试过的具体改动（命令 + `verified` / `mismatches`）
- `retryable:true` 的失败码（如 `ULOOP_NO_JSON`）可以**限次**重试（≤3 次 + 退避），
  重试前**先读 `hint`** 排除终态原因（dispatcher 路径错、项目没打开、编辑器没连上）。

---

## 7. 常见错误 → `docs/PITFALLS.md` 的 U 编号

| 现象 | 处置 | 出处 |
|---|---|---|
| `Success:true` 但意图没达成 | 写命令看 `verified`，`false` 就停 | §2 / 设计 §6.1 |
| 中文编辑器窗口名失配（Game/Scene/...） | 用本地化名；或进 PlayMode 走 `rendering` | **U7**（Inspector=「检查器」） |
| `--parent` 裸名找不到嵌套节点 | 父路径从根写起（`Canvas/Panel`）；看 `actual.detail` | §3 |
| `--patch` 报 `EMPTY_PATCH` / `UNKNOWN_PATCH_KEY` | 给非空对象；只支持 name/active/position/scale | §3 |
| `AddComponent` 报 `COMPONENT_ADD_FAILED` / 抽象类型 | 别挂抽象类（如 `Collider`）；已自动清理残骸 | **U13** |
| 工具失败只拿到「未提供 Message」/ 空 hint | 上游失败有**平铺**与**嵌套**两种形状，`fromUloop` 统一承接 | **U12** |
| `uloop launch` 起不了团结引擎 | 手动启动 `Tuanjie.exe -projectPath <P>` | **U6** |
| 编辑器启动后 `editor-connection` 不绿，且进程只有 ~117 MB | **官方版阻塞在管理员模态框**（PITFALLS 官方-4）：点 `&I wish to continue at my own risk`。团结侧未复测 | **官方-4** |
| 冒烟/读回因 upstream 字段改名静默 fail | 字段缺失即 fail（绝不打印 `?`）；对账记录 | **U11** |
| `build` 时目标平台不可用（本机 WebGL 未装） | 别硬编码平台；**真值以 `unity build` 的 `actual.available` 为准**（多引擎机上 `doctor` 的 `build-targets` 可能是另一台编辑器的，官方-3） | **U9** |
| 硬编码场景扩展名 / 播放器 DLL 名 | **双向都挂**：团结是 `.scene` + `TuanjiePlayer.dll`，官方版只认 `.unity` + `UnityPlayer.dll` —— **哪个方向都不能硬编码**。场景扩展名按项目里**已有**资产定，产物名一律读 `actual.mainArtifact` | **U10**（反向：PITFALLS 官方-1） |
| EditMode 加的 `UnityEvent` lambda 进 PlayMode 丢失 | 监听器必须在 PlayMode 运行时添加 | **U8** |
| `uloop package install` 挂起/失败 | `package.openupm.com` 被阻断，走 codeload vendor | **U1** |
| `unity play key`/`mouse` 报 `INPUT_SYSTEM_UNAVAILABLE` | 项目没装 Input System（`Active Input Handling` 为 Old）。改用 §8③ 的日志 + 两次截图证据证明玩法在跑，或用 `unity exec` 读运行期脚本字段，并如实声明「**无真实输入、玩法自动运行**」；**不要**为此去调裸 uloop。✅ 装上 `com.unity.inputsystem` 1.8.2 + `activeInputHandler:2` 后 `key`/`mouse` **可用**（批次 C-D 真机） | **U25** |
| `unity play click` 点不动 sprite 方块 | `simulate-mouse-ui` 只对 ScreenSpaceOverlay + GraphicRaycaster 的 uGUI 生效，打不到 SpriteRenderer | **U25** |
| `unity play start` 报 `CONTROL_PLAY_MODE_UNSAVED_CHANGES` | 当前场景有未保存改动（最常见是未命名场景）。先 `scene tree --json` 看 `sceneName`，空串/未命名就 `unity scene save --path Assets/Scenes/SampleScene.<ext>` 落盘（**`<ext>` 按引擎：官方版 `.unity`、团结 `.scene`**，写后读回 `verified:true` 才算存下），再重试 `play start` | **U26** |
| `scene open` 没报 `DIRTY_SCENE` 就把内存里的场景换掉了 | 本环境里 **CLI 自己造的改动不会置 `isDirty`**（`SaveOpenScenes()` 因此返回 true 却不写盘）→ 守卫只能看见**编辑器 UI 造的**改动。**切场景前先 `unity scene save`**；`scene save` 用**文件 mtime 前进**证明真的落盘 | **U27** |
| `sprite set` 后进 PlayMode，方块**一块都不渲染** | sprite 是运行时对象，domain reload 销毁它（color 会保留）——用模板的 `EnsureSprites()` 兜底 | **U20** |
| `unity scene tree` 的 `components` 为空 | 原因：① 节点确实没挂组件 ② 上游出现**第三种**未知形状（已知两种——内联 `components` 与 `componentsLut`+`componentsIdx`——都已解析）。出路：先 `node inspect` 复核；**`node inspect` 有组件、`scene tree` 没有（两者不一致）才算异常** | **U21** |
| 导入的图糊 / 颜色被改（Bilinear/压缩/透明像素被改写） | 用 `unity asset import`（它显式配 point + uncompressed） | U31 · U33 |
| PNG 导入后 DB 里查不到（没有 `.meta`） | 必须显式触发导入（`asset import` 已内置） | U29 |
| 纹理被静默缩小（长宽不是源尺寸） | 把 `--max-size` 换成 ≥ 源尺寸（或不给，会自动抬） | U32 |
| 去底去不掉 / 裁边裁不掉（想靠 Unity 侧做） | 像素处理只能在 Node 侧做（`--remove-bg`/`--trim`） | U33 · U34 |
| 手改 `.meta` 的 guid 不生效 / 交付后引用断 | **团结新导入资产**：`.meta` 的 guid（56 字符 base64）与引用用的 32-hex 是两套 id；**官方 2022.3.62f3c1 实测两者是同一个字符串**（不是普遍规律，R476） | U30 |
| `asset import` 报 `BAD_PNG`（调色板/隔行 PNG） | 另存为 PNG-24/32（非隔行）再导入 | U35 |

> `docs/PITFALLS.md` 是权威清单；本表只列与本 skill 高频路径相关的条目。
> **U11 起逐条标注适用引擎**（团结 2022.3.62t9 = 实测；Unity 官方版多为**未验证**）；
> U1–U10 **没有**「适用引擎」行（**U7 / U9 / U10 例外** —— 它们本身随引擎/安装环境而变）。
> 表中 U 编号已与 `docs/PITFALLS.md` 的**索引表**对齐（M2 收口定稿：新增条目 U16–U26）。

---

## 8. 验证配方：怎么证明「搭出来了」+「真的在动」

> 场景搭完（**§3.5 / §3.6**）之后跑这一节。**每一步都要留证据**：命令 + 退出码 + 输出；
> 只靠「我看了一眼图」不算验证。

**⓪ 前置：先落盘，再进 PlayMode。** 先跑 `unity scene tree --project-path "$P" --json` 看 `actual.sceneName`，
再 `unity scene save --project-path "$P" --json`（未命名场景用 `unity scene save --path Assets/Scenes/X.<ext>` —— **`<ext>` 按引擎：官方版 `.unity`、团结 `.scene`**，见 §3.5⑤ / PITFALLS 官方-1）；
`verified:true` 才算真的存进磁盘 —— 这同时是**交付物落盘**的证明（E2E **B2** 由此关闭）。
不落盘时 `play start` 会落 `CONTROL_PLAY_MODE_UNSAVED_CHANGES`（当前场景有未保存改动），
下面②③的 rendering 截图与「在动」验证**全部做不了**。`sceneName` 非空才继续。

**① 结构**：`unity scene tree --json` → `actual.roots` 里应有 `Bricks`（24 个子节点）、`Paddle`、`Ball`、`GameManager`。
组件**短名**以 `scene tree` 的 `components` 为准（上游两种形状——小场景内联 `components`、较大/嵌套场景
`componentsLut`+`componentsIdx`——**都已解析**，见 `docs/PITFALLS.md` **U21**）；但组件的**属性**
（颜色/sprite/position）`scene tree` 里没有，必须用 `node inspect --path <p>`。

**② 画面（像素判定，不靠肉眼）**：

> ⚠️ **先确认 Game 视图已打开** —— 官方版新建项目的 Game 视图**默认没开**，未开时 rendering 截图会落
> `PlayMode rendering did not produce an image.`（PITFALLS **官方-5**；打开命令见 §4⑥）。

```bash
unity play start --project-path "$P" --json          # verified:true 才算进入 PlayMode
unity shot --project-path "$P" --capture-mode rendering --json   # rendering 模式下坐标干净（不含工具栏）
# 用上一步返回的 actual.path：
unity pixels --file "<path>" --count-color '#FF2E88' --tolerance 16 --json   # 品红砖块数量 > 0
unity pixels --file "<path>" --at 480,600 --json                             # 采样一个点看真实颜色
```

判据：砖块颜色计数 > 0；背景区域的采样值接近 `#0A0A14`（容差 ≤ 48）。
**再用 `read` 工具打开 PNG 目视确认** —— 像素判定与肉眼两条证据都要。

> ⚠️ **`--count-color` 报 0 时不要立刻下结论**：先**再截一张**（PlayMode 暂停在旧帧/错帧是真实发生过的，
> 见 `docs/PITFALLS.md` **U17**）——
> 用**新返回的 `actual.path`** 重新计数；**连续两张都是 0** 才当作「砖没渲染出来」。
> 命中 0 像素本身**不会**让 `pixels` 退出 1（`--count-color` 不影响退出码）；要靠 `--expect` 判「颜色在不在」。

```bash
unity shot --project-path "$P" --capture-mode rendering --json               # ① 再截一张
unity pixels --file "<新 path>" --count-color '#FF2E88' --tolerance 16 --json  # ② 用新图重新计数
```

**③ 在动（试玩闭环）**：

```bash
# ① 日志（运行期**脚本状态**的唯一读回路径）：应有 ready bricks=24；等 ≥5s 再跑一次，hit brick= 应增加、score 应变大
unity play logs --project-path "$P" --search-text '[BB]' --json
unity shot --project-path "$P" --capture-mode rendering --json     # 图 1（记下 actual.path）
# …等几秒：球/挡板在动、砖块在被吃掉…
unity shot --project-path "$P" --capture-mode rendering --json     # 图 2（记下 actual.path）

# ② 判「位移」：先在**图 1** 里用 `read` 工具**目视量出**球 / 挡板的像素坐标或 bbox，
#    再对**同一个**坐标 / bbox 在两张图上各采样一次 —— 值不同才是位移
# 主判据（区域均色比单点稳）：区域**必须从图 1 用 `read` 目视量出**
#    （挡板宽真值 ≈154 px = 2.4 世界单位 × 64 px/单位，实测 150–152 px；y ≈578–600 @960×640；
#     也可用 §8⑤ 的公式从世界坐标反算）；
#    两张图跑**同一条** --region，比 actual.region.color（形状 {r,g,b,a}）
#    `<…>` 里填你在图 1 里量到的挡板 bbox 左边界 x 与 y（若量到的是中心 x₀，左边界 = x₀ − 77；
#    区域宽取 ≈160 px 略大于挡板本身，保证覆盖）：
unity pixels --file "<图1>" --region <在图 1 里 read 出的挡板 bbox：左边界 x,y,160,22> --json
unity pixels --file "<图2>" --region <在图 1 里 read 出的挡板 bbox：左边界 x,y,160,22> --json  # 与图 1 同区域对比 actual.region.color
# 具体数字只在「你手里的图恰好就是下述这组」时才可直接用：`--region 417,578,160,22`
#    该区域按 `m2-verify-12-rerun` 的图 A′（`Rendering_20260919_135641_893.png`，960×640，挡板 x 417–567）标定；
#    **换图/换分辨率必须按图 1 的 bbox 重取**。分辨率不匹配时：**更小**导致越界才 `BAD_REGION`（退出码 2）；
#    **更大**不会报错，只会静默采到错误位置（`lib/pixels.js` 的越界判定只能挡住越界）。
# 辅助判据（球较小，用图 1 里 read 到的球心坐标做单点采样）：比 actual.at.color（形状 {r,g,b,a}）
#    unity pixels --file "<图1>" --at <图 1 里球的像素坐标> --json
# ⚠️ 不要照抄球的**出生点** `480,525`（世界 (0,-3.2) → 像素，见 §8⑤）：图 1 是开局十几秒后截的，
#    球（半径 12.8 px）早已离开该点（独立复核图 960×640：球心 (650,300) → (497,501)）——
#    在出生点采样两张图都只会拿到背景色，从而误判「球没动」。

# ③ 判「数量」：--count-color 只回答「这个颜色在不在 / 少了几个」
unity pixels --file "<图1>" --count-color '#FF2E88' --tolerance 16 --json   # 砖块计数（基线）
unity pixels --file "<图2>" --count-color '#FF2E88' --tolerance 16 --json   # 应比图 1 **少**
unity pixels --file "<图2>" --count-color '#00FFC8' --tolerance 16 --json   # 挡板 ≈ 3366 px（0 或骤变才算异常）

unity play logs --project-path "$P" --search-text '[BB]' --json     # 再读一次：totalCount / score 应变了
unity play stop --project-path "$P" --json                          # verified:true
unity play logs --project-path "$P" --log-type Error --json         # totalCount 应为 0
```

> ⚠️ **`--count-color` 的计数相同 ≠ 画面没变**（真机实测 2026-09-19）：两张渲染图里青挡板都是
> **3366 px**，但挡板质心从 `x=738` 跑到了 `x=212`（**位移 526 px**）。只按「青挡板 ≈ 3366 px」
> 判「在动」，会得出「两次都是 3366 → 没动」的**错误结论**。
> 反过来，只采样一个**与对象无关**的固定点 / 固定区域（如背景 `480,600`，或与两张图里对象都不相交的区域）
> 同样证明不了位移 —— 它在两张图里都是背景色。
> **判位移 = 对图 1 中对象所在的坐标/区域做两次同点采样；判数量 = `--count-color`；两者不能互相替代。**

> ✅ **运行期脚本字段用 `unity exec` 读**（M3 起命令面已有；值在 `actual.result`，`verified` 恒 `null`）：
> ```bash
> unity exec --project-path "$P" --code 'var g = GameObject.Find("GameManager").GetComponent<PiBrickBreaker>(); return g.score + "," + g.bricksAlive;'
> ```
> ⚠️ **真机教训（2026-09-19）**：动态代码是**静态编译**的 —— `GetComponent("PiBrickBreaker")`（字符串重载）
> 返回 `Component`，`g.score` 会报 **CS1061**（`Component` 没有 `score` 定义）。组件在**全局命名空间**时
> 用泛型重载 `GetComponent<PiBrickBreaker>()`（上图）；组件在命名空间里或类型名未知时改用反射：
> `var g = GameObject.Find("GameManager").GetComponent("PiBrickBreaker"); var t = g.GetType(); return t.GetField("score").GetValue(g) + "," + t.GetField("bricksAlive").GetValue(g);`
> 返回值在 `actual.result`（`--json` 能看到，形如 `"3,21"`；脚本没 `return` 时为 `null`）。这是**读/执行**命令，不是写命令的验证。
> 备选：读 `play logs --search-text '[BB]'` 里 `[BB] hit brick=… score=… left=…` 这些行（`left` 就是剩余砖块数）；
> `node inspect --path <p>` 只读得到 Transform 与 SpriteRenderer 的字段（`color` / `sortingOrder` / `spriteName` 等）
> 与组件**短名**——**脚本字段（无论公有私有）都读不到**；`position` / `scale` 是**局部**坐标（不是世界坐标）。
> ⚠️ 写 `.cs` 时 `GameObject.Find` **找不到非激活对象**（`active:false` 的节点返回 `null`，
> 接着 `.GetComponent` 就是 NullReferenceException）；按路径查要遍历
> `GameObject.GetRootGameObjects()`（含 inactive）或改用 `FindObjectsOfType<Transform>(true)`（PITFALLS **U38**）。
> **不要**为了读回运行态去调裸 uloop 的 `execute-dynamic-code` —— 那会让 §8 的验证脱离 `unity`
> 命令面、无法复现与审计。

> 真机实测（2026-09-19，960×640）：两张渲染图**逐像素差 25083 px（4.08%）**
> （该历史数字由带外工具逐像素算得；现在可直接用 `unity pixels --diff` / `--centroid` / `--bbox` 复算，
> 见 `docs/PITFALLS.md` **U24**（**已关闭**））；
> 白球质心 `(491,509) → (239,531)`、青挡板中心 `x 484 → 222`（autoPaddle 跟着球跑）；
> 砖块总像素 `78336 → 62016`（`score 0→5`、`bricks 24→19`，四行计数 19584/19584/13056/9792）。

**④ 真实输入（只在项目装了 Input System 时）**：`unity play key --action Press --key Space`。
没有 Input System 时它会**如实失败**（`INPUT_SYSTEM_UNAVAILABLE`）——**不要**因此宣称游戏坏了：
没有输入注入时用「球自己在动 + 分数在涨（`play logs`）+ 两次截图同点采样不同（§8③）」证明玩法在跑，
并**明确声明**：**无真实输入，玩法自动运行**（运行期脚本字段用 `unity exec` 读，也**不要**为此去调裸 uloop）。
✅ **装上 Input System 后可用**（批次 C-D 真机）：`Packages/manifest.json` 加 `"com.unity.inputsystem"`，`ProjectSettings.asset` 的 `activeInputHandler` 设 `2`（Both）、重开编辑器；
`play key` 用 `Keyboard.current.<key>.isPressed` 读回验证（真机 `W`：true→false）；`play mouse` 的 `scroll` 是**逐帧 delta**，注入后当帧外读回为 `0` 属正常。

**⑤ 坐标换算（世界单位 ↔ 图片像素）：公式 + 实测**

> ⚠️ **以下公式仅对正交相机成立**。Unity 官方版 `-createProject` 的空项目 `Camera.main` 是**透视**
> （`orthographic=False`、FOV 60 —— `orthographicSize=5` 不参与成像，PITFALLS **官方-7**）→ 公式**不适用**
> （真机：6×6 世界单位的纯色 sprite 在 960×640 里实测 **110224 px**，公式预期 147456 px）。
> 先读相机：`unity exec --project-path "$P" --code 'return Camera.main.orthographic;'`（官方空项目回 `False`）；
> 透视相机下判「渲染对不对」用 `--at` / `--count-color` 这类**相对判据**，不要用本节公式反算像素。

```
pixelsPerUnit = 图片高度 / (2 × orthographicSize)        # **仅正交相机**；图片高度 = Game 视图高
图片像素 x = 图片宽/2 + pixelsPerUnit × 世界 x
图片像素 y = 图片高/2 − pixelsPerUnit × 世界 y            # 图片坐标左上原点，y 向下
```

> **透视相机（官方版空项目）的像素换算（R478a，盲测实测，紧跟上式）**：
> `pxPerUnit = (图高/2) / (tan(fov/2) × 相机到物体的距离)`。
> 实测：906×419 的 rendering 图、`fov=60`、相机距物体 `10` → **36.29 px/单位**，
> 与该 sprite 的 **108×72** 实测像素吻合到 **1 px**。公式只用来**交叉核对**，主判据仍是 `--at` / `--count-color`。


例（真机实测 2026-09-19，960×640 + `orthographicSize=5`）：

- `Bricks/Brick_0_0` 世界 `(-4.625, 3.0)` → 公式像素 `(480 + 64×(-4.625), 320 − 64×3.0) = (184, 128)`；
  `pixels --at 184,128` 实测 **`rgb(255,46,136)` = `#FF2E88`**（预期命中，偏差 **0 px**）。
- 实测该砖包围盒 `x[133,234] × y[112,143]`（102×32 px）；公式预期 `x[132.8,235.2] × y[112,144]`
  （102.4×32 px）→ **边缘偏差 ≤ 1.2 px**（无抗锯齿，硬边缘）。
- 球 `0.4` 世界单位 → 实测 **625 px = 25×25**（公式 25.6 px，偏差 0.6 px）。

**容差口径：±2 px**（覆盖像素取整与中心 pivot 的半像素）。若实测与公式不符：**以实测为准**，
把公式与偏差追加到 `docs/PITFALLS.md` 末尾（**下一个编号顺延**，并同步更新索引表与本节引用）。

### ⑥ 判「用户供的图真的在画面里」（M4 起）

```bash
P="C:/path/to/Project"; SHOTS="C:/path/to/shots"
# 1) 先确认资产与绑定都是 verified:true（见 §3.6）
# 2) 截图（EditMode 也要先把 Game 视图打开，见 §4）
unity shot --project-path "$P" --out "$SHOTS" --json
# 3) 数「这张图独有的颜色」的像素数（用你图里确实存在的颜色，不要用背景色）
unity pixels --file "<上一步返回的 actual.path>" --count-color '#FF2E88' --tolerance 16 --json
#    → actual.count.count > 0 才算「画面里真的有它」；
#      count==0 时**先排除三种可能**再判「没渲染出来」：① 不在相机视锥内；② 被别的 sprite 完全遮住；
#      ③ 颜色在你图上本来就不是成片纯色（改用 --region 均色 + 目视，别只信 --count-color）
# 4) 反证「去底真的生效」：**原图**的背景色不该再出现
#    ⚠️ 反证色**必须**取自上一步 `asset import` 读回的 `actual.art.removeBg.keyColor`
#       （**不要**照抄示例里的 `#00FF00`）—— 用错颜色会让这一步**天然通过**（假绿）。
unity pixels --file "<同上>" --count-color "<asset import 读回的 actual.art.removeBg.keyColor>" --tolerance 8 --json   # 期望 count == 0
```

> ⚠️ **读计数的路径是 `actual.count.count`**：`actual.count` 是个**对象**
> `{color, count, ratio, tolerance}` —— 写成 `actual.count > 0` 恒假（PITFALLS **U22**）。
> ⚠️ **`count>0` 不能单独证明「是你刚建的对象渲染出来的」**：当**源节点与它的 Prefab 实例同时在画面里**
> （或两个对象**同位置同缩放**）时，开关其中一个**不会**改变画面，计数自然也不变 —— 那一步**不构成归属**。
> 归属性判据必须**把实例挪到别处**（或关掉源节点）让目标成为画面里的**唯一变量**，再加一次**负对照**
> （关掉目标后计数应**恰好少掉它那一块**）。完整 8 步模板见 `docs/M4-PROBES.md` §②-9。

负对照的**具体命令**（在同一张图上重数**不算**负对照）：

```bash
unity node set --project-path "$P" --path <目标> --patch '{"active":false}' --json   # 关掉目标（写命令，看 verified）
unity shot --project-path "$P" --out "$SHOTS" --json                                 # **重新截图**（拿新 actual.path）
unity pixels --file "<新图>" --count-color '<同一颜色>' --tolerance 16 --json          # 计数应**恰好少掉它那一块**
```

⚠️ **进 PlayMode 再看一次**：资产 sprite 过 domain reload **必须还在**
（`sprite set` 的运行时 sprite 在这一步会消失 —— 那就是用错命令了）。用
`unity play start` → `unity shot`（`--capture-mode rendering`）→ 同一个 `pixels --count-color`。

---

## 9. 构建出包（`unity build`，M3 起命令面已有）

```bash
# 前置：目标项目的编辑器**必须开着**（`unity doctor` 的 editor-connection = pass）；
#      且**不要**同时开第二个编辑器（单座席 license 会把后来者踢掉）
unity build --project-path "$P" --target win64 --out C:/build-out/win64 --json
```

**读结果**：`exit=0` 且 `verified:true` 才算真的出包；`actual` 里看
`result` / `totalErrors` / `sizeBytes`（**磁盘实测**总字节）/ `reportedSizeBytes`（report 报的，另存备查）/ `artifacts`（输出目录的**实际**内容）/ `mainArtifact` / `durationSeconds`。

`verified:true` 要过**四道读回判据**（缺一 → `ARTIFACT_MISSING` + `verified:false`）：
report 的 `outputPath` 目录必须**逐字等于** `--out` 的绝对路径；主产物存在；主产物**非空**；
主产物 `mtimeMs` **不早于本次构建开始**（容差 2s，覆盖 FAT/网络盘的 mtime 粒度）——
即「`--out` 里恰好留着上一轮的同名产物」不算数。主产物是**目录**时（webgl/weixin 那类）：
`mainArtifact.sizeBytes/fileCount` 是目录内文件的**递归**合计，只校验「非空」——**不校验**目录结构完整性。

### 9.1 目标不是全的（U9）

可用性**只有编辑器说了算**（脚本里问 `BuildPipeline.IsBuildTargetSupported`）。查已装模块：

```bash
unity doctor --project-path "$P" --json      # 看 build-targets 项（读 <Editor>/Data/PlaybackEngines/）
```

> ⚠️ **多引擎共存机上 `doctor` 的 `build-targets` 可能取的是另一台编辑器**（`lib/doctor.js` 读 `editors[0]`，
> 通常是团结；PITFALLS **官方-3**）—— 官方版项目上它会误报 `android` 可用。
> **构建目标的真值请看 `unity build` 失败时的 `actual.available`**（下面那条命令的 `--json` 输出），
> 或直接看**当前那个编辑器**的 `Data/PlaybackEngines/`。

真机实测（2026-09-19，团结 2022.3.62t9）：`PlaybackEngines` 只有
`AndroidPlayer` / `WeixinMiniGameSupport` / `windowsstandalonesupport` →
**可用目标 = `win64` / `android` / `weixin`；`webgl` 未安装**。

```bash
unity build --project-path "$P" --target webgl --out C:/build-out/webgl --json
# → 退出码 1、code=BUILD_TARGET_UNAVAILABLE、hint: 可用目标：win64 / android / weixin
#   （输出目录**根本不会被创建**；不会退化成 win64 假装成功）
```

### 9.2 `--out` 用绝对路径，产物名别猜

`--out` 建议传**项目之外的绝对路径**（相对路径按**当前 shell 的 cwd** 解析成绝对路径后再发给编辑器）。
产物清单**从实际目录读**（`actual.artifacts`），不要照抄任何引擎的产品名 —— **播放器 DLL 名随引擎不同**：

| 产物 | 团结 2022.3.62t9（win64，实测） | Unity 官方版 2022.3.62f3c1（win64，实测） |
|---|---|---|
| 主可执行 | `<Application.productName>.exe`（464 KB） | 同左（`Application.productName`） |
| 数据目录 | `<Application.productName>_Data/` | 同左 |
| 播放器 DLL | **`TuanjiePlayer.dll`**（44 MB） | **`UnityPlayer.dll`**（31.2 MB） |
| 崩溃处理器 | `TuanjieCrashHandler64.exe` | `UnityCrashHandler64.exe` |
| 其余 | `MonoBleedingEdge/`；**首次**构建还有 `<productName>_BurstDebugInformation_DoNotShip/` | 同左（无 Burst 目录） |
| 磁盘总字节（空场景） | 114,718,252 B（109.4 MB） | **71,259,785 B（≈71.3 MB）** |
| 首次端到端 | 13s | **4.8s** |

> ⚠️ **产物名取自 `Application.productName`，不是工程目录名**：S0Project 的 productName 是 **`2D Project`**，
> 产物叫 `2D Project.exe`；S8 的手工脚本把 `S0Project.exe` 写死过。别猜，看 `actual.mainArtifact.name`。
> `lib/build.js` **不硬编码**播放器名（只读磁盘）→ 两个引擎都对，**两种名字都不能写进脚本**。

### 9.3 真实耗时 / 体积（空场景，2026-09-19 / 2026-09-20 实测）

| 项 | 团结 2022.3.62t9（S0Project） | Unity 官方版 2022.3.62f3c1（新建空项目） |
|---|---|---|
| `unity build` 端到端（首次） | **13s**（uloop 往返 12.8s，其中构建本体 11.6s） | **4.82s** |
| 重复构建（同场景、无改动） | **约 2s**（Unity 增量缓存；删掉输出目录也一样快） | 未测 |
| 体积 | **109.4 MB**（114,718,252 B；report 报 114,672,585 B，差的正是 Burst 调试目录） | **71,259,785 B（≈71.3 MB / 67.9 MiB）**（report 值 == 磁盘值） |
| 对比 `-batchmode` 手工路径 | 29s（多出来的主要是**编辑器启动**） | 未测 |

> ⚠️ **空场景也要 ~70–110 MB** —— 默认含完整运行时；体积**随引擎不同**（官方版比团结小 ~38 MB，因为不产出 Burst 调试目录）。
> 要交付前先跟用户确认体积预期。

### 9.4 时间上限与「构建成功 ≠ 能跑」

- `--timeout-seconds <n>`（默认 600）到点 → `BUILD_TIMEOUT`（退出码 1）：
  uloop 客户端退出了，**编辑器可能还在构建**（真机实测：1s 超时后编辑器仍活着，`scene tree` 正常，无孤儿进程）。
  先等一会儿、看 `--out` 里是否已有产物，**再**决定要不要重跑。
- 出包之后**还要证明能跑**：启动主可执行文件并看 `player.log`（`-logFile <p>`），
  至少确认 `Mono path[0]` / `GfxDevice` / `Renderer` 三行、且无 error。真机实测（上述 109 MB 产物）：
  进程存活（146 MB 工作集）、`player.log` 20 行无错误。
- `report.summary.result == Succeeded` **不等于**产物在磁盘上：本命令会写后读回，
  对不上就落 `ARTIFACT_MISSING` + `verified:false`（退出码 1），**不会**给你一个假的成功。
