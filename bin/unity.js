#!/usr/bin/env node
'use strict';

const pkg = require('../package.json');
// R222：用法错退出码是**单一常量** —— 裸 `2` 会在 handler 之间漂移。
const { EXIT_USAGE } = require('../lib/envelope.js');

const USAGE = `Usage: unity <command> [options]

命令（M2 全量 + M3 \`exec\`/\`scene save|open\`/\`build\` + M4 \`asset import\`/\`sprite assign\`/\`prefab create|instantiate\` + M5 \`prefab apply|revert\`；类型列：读/执行 = verified 恒 null / 写 = 看 verified）：
  version                打印版本
  doctor                 环境检查：只读 5 项（--smoke 冒烟 / --golden 场景回归 / --json 机器可读）
  doctor --smoke         冒烟：3 个只读工具 + **写-读回-删自闭环**（建/改/删 __pi_smoke 并读回确认无残留）
                         ⚠️ **从 M2 起 --smoke 不再只读**：会向当前场景写入临时节点（随后删除），不保存场景
                         ⚠️ --smoke 与 --golden **都会向当前场景写入**（临时节点随后删除）；
                            --smoke 建 __pi_smoke，--golden 建 __pi_golden；都不保存场景
                         ⚠️ 两者不能同时用（退出码 2）
                         --json 里 skip 的 code：NOT_CONNECTED = 没连上 / WRITE_LOOP_NOT_RUN = 前置步骤失败未执行 /
                         MISSING_PROJECT_PATH = 未给项目根（写闭环零写入）
  doctor --golden        场景回归：同一组确定性指令搭两轮，比对 get-hierarchy 结构投影，报首个分歧路径
                         --json 形状 {ok,mode:"golden",matched,diff,cleanup,blocked,lines}；
                         matched:false 看 diff.path；cleanup 有残留时退出码 1（给手工清理命令），绝不谎报成功
  scene tree             读场景节点树（含 nodeCount / 组件 / 多场景提示）
  scene save             保存场景（**写**后读回：拿 scene tree 的 sceneName 与保存回报的场景名比对）
                         不给 --path → 保存**全部**打开的场景；未命名场景 → NO_SCENE（不弹保存对话框）
  scene open             打开场景（**写**后读回：比对读回的 sceneName 与 --path 的场景名）
                         活动场景 dirty 且未给 --force → DIRTY_SCENE（退出码 1，不静默丢改动）
  node inspect           读单个节点（含 sprite 字段）
  node create            建节点（写后读回验证）
  node set               改节点（写后读回验证）
  node delete            删节点（写后读回验证：读回必须 NOT_FOUND）
  shot                   截图（读）
  pixels                 读 PNG 做像素判定（读；退出码 1 = --expect 不匹配）
  sprite set             给节点挂运行时纯色 sprite（写后读回：颜色 + sortingOrder）
  sprite assign          给节点挂**资产** sprite（写后读回：assetPath/worldSize；只支持单 sprite 资产）
  compile                编译项目并报告结构化错误（读；plain compile 自己会 refresh 外部改动）
  build                  构建出包（**写**后读回：产物真的落在磁盘上才算 verified:true）
                         目标取决于**已安装的 PlaybackEngines**（U9）；请求未装的目标 →
                         BUILD_TARGET_UNAVAILABLE（退出码 1）+ hint 列出可用目标，**绝不**改打别的目标
  asset write            把脚本写进项目（写后读回 sha256 → 再编译）
  play                   PlayMode 试玩闭环（进/出/暂停/步进 + 模拟输入 + 日志 + Game 视图尺寸）
  exec                   动态 C# 执行（读/执行：verified 恒 null）—— 脚本返回值在 actual.result

全局选项：
  --project-path <path>  指定 Unity 项目目录
  --json                 输出机器可读 JSON
  布尔开关（--json/--smoke/--golden/--force/--trim/--no-compile/--bypass-raycast/--dry-run/
  --include-stack-trace）也接受 =1/=0/=true/=false/yes/no（大小写与空白不敏感，D-A2）；
  非法取值报 BAD_FLAG_VALUE（退出码 2）

node create / set 选项：
  --name <name>          （create）节点名，不能为空
  --parent <path>        （create）父节点路径，如 Canvas/Panel；
                         含 / 的路径从根写起；**裸名（不含 /）只匹配根对象**
                         （节点在嵌套里时会报 PARENT_NOT_FOUND，不是「不存在」）
  --components <json>    （create）组件数组，如 '["SpriteRenderer"]'；
                         组件名用 UnityEngine.X 或短名 X（一律映射到短名比对）
                         ⚠️ Sprite 是资源类型不是 Component → 会落 NOT_A_COMPONENT（见 U13）；
                         要挂渲染用 SpriteRenderer
  --path <path>          （inspect/set/delete）目标节点路径，如 Canvas/Btn
  --sibling-index <n>    （inspect）按**真实子序号**精确定位（= \`unity scene tree\`
                         里该节点的 siblingIndex 字段值；同父下可能不连续）；
                         仅在 \`--path\` 命中多个同名节点时用于区分实例
  --patch <json>         （set）非空 JSON 对象，如 '{"active":false}'；
                         position/scale 需要完整 x/y/z；支持的键只有
                         name / active / position / scale
                         （空对象 → 失败码 EMPTY_PATCH；未知键 → UNKNOWN_PATCH_KEY）

node delete 选项：
  node delete --path <p> 删节点（**连同子树**；写后读回：读回必须 NOT_FOUND 才算 verified）
                         ⚠️ 不可逆：删之前先用 \`unity scene tree\` 确认，并按 skill §5 先问用户

scene save / open 选项：
  --path <Assets/...>    场景资产路径（**asset 相对路径**，如 Assets/Scenes/SampleScene.unity；
                         ⚠️ **官方版只认 \`.unity\`，团结用 \`.scene\`**（PITFALLS 官方-1）—— 先看项目里已有资产的扩展名）
                         save：可选 —— 不给就保存当前打开的**全部**场景；给了就只保存当前活动场景到该路径
                               （未命名场景必须给 --path 才能落盘）
                         open：**必填**（本命令不猜要打开哪一个）；路径不存在 → SCENE_NOT_FOUND
  --force                仅 open：丢弃当前场景的未保存改动强行打开（**会丢失改动且不可恢复**）
                         ⚠️ 活动场景 dirty 且没给 --force → DIRTY_SCENE（退出码 1，绝不静默丢改动）
  语义提示：两个子动作都是**写**命令 → --json 的 verified 是**布尔**（写后读回 \`scene tree\` 的 sceneName
           比对通过才为 true）；verified:false / READBACK_FAILED 就是失败（退出码 1），不许继续叠加命令
  退出码：0 成功 / 1 运行时错（NO_SCENE / SAVE_FAILED / SCENE_NOT_FOUND / DIRTY_SCENE /
          OPEN_FAILED / verified:false / 读回失败）/ 2 用法错（open 缺 --path → MISSING_PATH；
          --path 裸写、空串、推不出场景名 → BAD_TARGET_PATH）

shot 选项：
  --out <dir>            截图输出目录（缺省用 .uloop/outputs/Screenshots/；必须带值）
                         ⚠️ 建议传**绝对路径**：相对路径以**编辑器进程的工作目录**
                         （通常是项目根）为基准，不是当前 shell 的 cwd
  --window-name <name>   窗口名（按界面语言**双向**映射：英文名→中文标题、中文标题→英文名；
                         本地化失配时自动用另一种形态重试一次；PlayMode 下被忽略；必须带值）
  --capture-mode <m>     auto|window|rendering|GameView（缺省 auto：EditMode→window，PlayMode→rendering）
                         rendering/GameView 需要 PlayMode；rendering 会忽略 --window-name
  --match-mode <m>       exact|prefix|contains（缺省 exact；仅 window 模式生效）

pixels 选项：
  --file <png>           必填：\`unity shot\` 返回的 actual.path
  --at x,y               取单像素颜色（图片坐标，左上原点）
  --region x,y,w,h       取区域平均色
  --count-color <hex>    统计该颜色（逐通道差 <= --tolerance）的像素数与占比；
                         命中 0 像素**不影响退出码**（仍为 0）——「颜色真的出现了」请用 --expect
  --expect <hex>         与 --at/--region 的取样值比较（**只比较 r/g/b，alpha 不参与**）；
                         配合 --tolerance（默认 0）
  --diff <png>           与另一张同尺寸 PNG 逐像素比对（**只比较 r/g/b，alpha 不参与**）；
                         报 actual.diff（changed/total/ratio/maxChannelDistance，容差内不计入 changed）；
                         **不**置 actual.match（退出码不受影响）；
                         两张图尺寸不等 → DIFF_SIZE_MISMATCH（**用法错，退出码 2**）
  --centroid <hex>       该颜色（逐通道差 <= --tolerance）的像素质心：
                         actual.centroid = {color,count,x,y,tolerance}；命中 0 像素时 x/y 为 null + hint，
                         且**命中 0 像素不影响退出码（仍 0）**
  --bbox <hex>           该颜色的包围盒：actual.bbox = {color,count,x,y,width,height,tolerance}；
                         命中 0 像素时 x/y 为 null、宽高为 0 + hint，且**命中 0 像素不影响退出码（仍 0）**
  说明：--tolerance 对**所有**取样/比对选项同时生效（--at/--region/--expect/--count-color/
        --centroid/--bbox/--diff）；--diff 建议用默认 0

sprite set 选项：
  --path <p>           必填：目标节点路径（形如 Bricks/Brick_0_0）
  --color <#hex>       必填：#RGB / #RRGGBB / #RRGGBBAA
  --sorting-order <n>  可选：int32 整数（-2147483648 … 2147483647）
                       ⚠️ 本命令**没有** --sorting-layer：sortingLayerName 只出现在读回面，永不进 intent
                       ⚠️ 尺寸不是本命令的参数：用 \`node set --patch '{"scale":{"x":1.6,"y":0.5,"z":1}}'\`
                       ⚠️ 基础 sprite 是 1x1 世界单位，所以 localScale = 世界尺寸
                       —— **仅对本命令新建的 sprite 成立**；节点原本已有 sprite 资产时，
                       尺寸由该资产的 PPU 决定

sprite assign 选项：
  --path <p>            必填：目标节点路径
  --asset <Assets/...>  必填：**项目内**的图片资产（先用 \`unity asset import\` 导入为 Sprite）
                        ⚠️ 只支持**单 sprite** 资产：该图被导入成 Multiple（一张多子图）时
                        → AMBIGUOUS_SPRITE（退出码 1，不会随便挑第一个子图）
  --world-size <w,h>    可选：把 localScale 反算成「该 sprite 在世界空间里正好 w×h」
                        （父级有缩放时会自动除掉；只覆盖**大小**，原 localScale 的符号
                        —— 即镜像/翻转 —— 用 Mathf.Sign 保留；不给则**不动**缩放）
                        数值形态：两个十进制正数且都 > 1e-4（读回用绝对容差 1e-4，
                        小于该量级的尺寸无法被验证 → 直接判 BAD_WORLD_SIZE）
                        ⚠️ 与 \`sprite set\` 的区别：那个造的是**运行时** sprite（进 PlayMode 就没），
                           本命令挂的是**资产**引用（会被场景/Prefab 序列化、能随交付物走）
                        ⚠️ 读回口径：\`unity node inspect\` 的 \`sprite.worldSize\` 是**世界空间 AABB 尺寸**
                           （= 精灵 bounds × 缩放），不是 localScale —— SKILL §3.5 的
                           「localScale = 世界尺寸」只对 \`sprite set\` 造的 1×1 且父级无缩放时成立
                        ⚠️ 节点或其祖先有**旋转**时，sr.bounds 是世界 AABB ≠ 精灵宽高 →
                           本命令会（**预期地**）落 verified:false。出路：改用 \`shot\`+\`pixels\` 判据，
                           或先把旋转清零。**不要**为此放宽容差（那会毁掉世界尺寸这条唯一真值）
                           或 SpriteRenderer.drawMode 不是 Simple（Sliced/Tiled 下 sr.bounds = sr.size × scale，见 PITFALLS U52）
                        退出码：0 成功且 verified:true / 1 运行时错（NOT_FOUND / SPRITE_NOT_FOUND /
                        AMBIGUOUS_SPRITE / COMPONENT_ADD_FAILED / 读回不一致 verified:false / UI_IMAGE_PRESENT）/ 2 用法错
                        （缺/裸 --path → MISSING_PATH；没给 --asset → MISSING_ASSET；
                         --asset 空串/非 Assets/ 下/含 .. 段 → BAD_ASSET_PATH；
                         --world-size 非法或 <= 1e-4 → BAD_WORLD_SIZE）
                        节点上只有 UI Image（无 SpriteRenderer）→ UI_IMAGE_PRESENT（本命令只挂 SpriteRenderer；UI 图走 UI 管线，见 PITFALLS U53）

compile 选项：
  compile                  编译项目并报告结构化错误（**plain compile 自己会 refresh 外部改动**）
    --timeout-seconds <n> 等待上限（默认 600，须为正整数）；不要用 --force-recompile（上游说几乎永远不需要）
                         退出码：0 无错 / 1 有编译错（code=COMPILE_FAILED）或结果不确定 / 用法错 → 2

build 选项：
  build                    构建出包（在**已打开的编辑器内**跑 BuildPipeline.BuildPlayer；
                           不往项目里写任何文件；目标项目的编辑器必须先打开并连上）
    --project-path <P>     必填：目标项目根（见全局选项）。不给会落到 uloop 自己的默认工程 ——
                           可能不是你这次要发布的那个 → MISSING_PROJECT_PATH（**缺参数 → 用法错 2**）
    --target <t>           必填：构建目标，当前目标表 win64 / android / webgl / weixin
                           ⚠️ 表内有 ≠ 本机可用：可用性只有编辑器说了算（U9）。
                           未装模块 → BUILD_TARGET_UNAVAILABLE（退出码 1）+ hint 列出可用目标，
                           **不会**自动改打别的目标
    --out <dir>            必填：产物输出目录（**建议绝对路径**；相对路径按当前 shell 的 cwd
                           解析成绝对路径后再发给编辑器）
    --timeout-seconds <n>  等待上限（默认 600，须为正整数）。构建是长任务：超时 → BUILD_TIMEOUT，
                           但 uloop 客户端退出**不代表**编辑器停了（可能还在构建，别立刻重跑）
                           场景清单取自 Build Settings（EditorBuildSettings.scenes，仅 enabled）；
                           清单为空才回退当前打开的场景；本命令**不修改**项目设置
                           verified 是**布尔**：真的去磁盘 stat 产物 —— 四道判据（report 的 outputPath
                           必须落在 --out 内、主产物存在且非空、主产物 mtime 不早于本次构建开始（容差 2s）、
                           总字节数 > 0）；目录型产物（webgl/weixin）的 mainArtifact 只校验**非空**
                           report 说 Succeeded 而磁盘上没有/是上一轮同名产物 → ARTIFACT_MISSING +
                           verified:false（假绿防线）
                           \`actual.sizeBytes\` 是**实测**总字节（\`reportedSizeBytes\` 是 report 的值，另存备查）
                           \`actual.artifacts\` 是输出目录的**实际**内容（不硬编码 Unity 官方产物名）
                         退出码：0 成功且 verified:true / 1 运行时错（BUILD_TARGET_UNAVAILABLE /
                         BUILD_FAILED / BUILD_TIMEOUT / BUILD_NO_SCENES / OUT_DIR_UNWRITABLE /
                         ARTIFACT_MISSING / 没连上编辑器）/
                         2 用法错（--target 缺失 → MISSING_TO、枚举外 → BAD_ACTION、
                         --out 缺失/裸写 → BAD_OUT_DIR、--timeout-seconds 非法 → BAD_TIMEOUT、
                         缺 --project-path → MISSING_PROJECT_PATH）

asset write 选项：
  asset write             把脚本写进项目（写后读回 sha256 → 再编译）
    --to <Assets/...>     必填：项目内目标路径，必须以 Assets/ 开头且不含 ..
    --from <本地文件>     二选一：源文件绝对路径
    --template <名字>     二选一：包内模板（当前只有 PiBrickBreaker = 打砖块参考实现，
                          源码在 unity-scripts/templates/PiBrickBreaker.cs；
                          搭场景的节点约定/尺寸/配色见 skills/unity-game-dev/SKILL.md §3.5）
    --force               目标已存在时必须显式给（**覆盖已有脚本要先问用户**，见 skill §5）
    --no-compile          只写文件不编译
    --timeout-seconds <n> 编译阶段等待上限（默认 600，须为正整数）
                         退出码：0 成功 / 1 目标已存在且无 --force（code=ASSET_EXISTS）或写后读回
                         不一致（verified:false）或编译有错（code=COMPILE_FAILED）/ 用法错 → 2

asset import 选项：
  asset import           把宿主上的 PNG 落进项目并配置为像素画 Sprite（**写**后读回：11 项导入设置
                         + 真实纹理尺寸/格式 + 磁盘 sha256）
                         ⚠️ 与 \`asset write\` 的区别：那个不触发导入（写完没有 .meta），
                            而它的 compile 副作用会用**错设置**（Bilinear/压缩/PPU=100/Tight）导入
    --from <本地png>      必填：宿主上的源图（**绝对路径**最稳）
    --to <Assets/...>     必填：项目内目标路径（Assets/ 开头、不含 ..，**必须以 .png 结尾**）
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

prefab 选项：
  prefab create          把场景里的节点存成 Prefab 资产（**写**后读回：把资产内容读回来，
                         与源节点的 position/scale/spriteAssetPath 逐字段比对）
    --from-node <path>   必填：源节点路径（形如 Brick_0_0）
                         ⚠️ 源节点是 **Prefab 实例** → \`SOURCE_IS_PREFAB_INSTANCE\`（退出码 1，不静默产出 Variant）
                         ⚠️ 源节点是**子节点** → 允许，但 Prefab 根保留它的**局部** position/scale（Unity 语义）
    --to <Assets/...prefab> 必填：必须以 .prefab 结尾、在 Assets/ 下
                         ✅ **父目录不存在会被自动创建**（本命令在写之前 \`mkdir\`；照 \`asset import\` 的既有做法）
                         ⚠️ **Prefab 根节点的名字 = \`--to\` 的文件名**（Unity 语义；**不是**源节点名）——
                            例：--from-node Brick_0_0 --to Assets/Prefabs/Brick.prefab 存出的根名是 \`Brick\`。
                            读回也按文件名断言 name（源节点的绑定由 position/scale/spriteAssetPath 钉住）
    --force              目标已存在时必须显式给（覆盖已有 Prefab 要先问用户，skill §5）
                         ⚠️ **同名覆盖 = 更新**，规则三条（真机证据见 docs/M4-PROBES.md §②-8）：
                            ① 未被 override 的属性**跟随**资产；
                            ② 已被 override 的属性**保持实例自己的值**（不回退）；
                            ③ **根 \`localPosition\` 恒被记为 override → 永不跟随**
                         退出码：0 成功且 verified:true / 1 运行时错（NOT_FOUND / SOURCE_IS_PREFAB_INSTANCE /
                         WRITE_FAILED / PREFAB_SAVE_FAILED / ASSET_EXISTS / READBACK_FAILED / verified:false）/ 2 用法错
                         （缺 --from-node → MISSING_PATH；--to 缺失 → MISSING_TO、非法/非 .prefab → BAD_TARGET_PATH）
  prefab instantiate     把 Prefab 资产实例化进当前场景（**写**后读回：先读**资产**拿真实根名/sprite，
                         再用实例路径 inspect 一次）
    --asset <Assets/...prefab> 必填
    --parent <path>      可选：挂到该节点下（\`.cs\` 用 \`SetParent(parent, false)\`）——
                         实例的**局部** position/scale 保持资产值（**世界**位置/尺寸随父级变换）
                         尾随 \`/\` 会被归一（\`Panel/\` 与 \`Panel\` 等价，与 \`node create --parent\` 同口径）
                         父节点不存在 → PARENT_NOT_FOUND（本次不建任何实例）
    --name <name>        可选：改名（不给则用 **Prefab 根节点的名字** = 资产读回的真实根名，
                         外部 Prefab 可能与文件名不同）
                         退出码：0 成功且 verified:true / 1 运行时错（PREFAB_NOT_FOUND / PARENT_NOT_FOUND /
                         INSTANTIATE_FAILED / READBACK_FAILED / verified:false）/ 2 用法错
                         （缺 --asset → MISSING_ASSET、非法 → BAD_ASSET_PATH；--parent 非法 → BAD_PARENT；
                         --name 非法 → MISSING_NAME）
  prefab apply           把 Prefab 实例的覆盖写回**资产**（写后读回：实例投影 vs 资产投影）
    --path <实例路径>    必填：场景里的 Prefab 实例路径
                         ⚠️ 根 \`localPosition\` 是 Unity 豁免项：**不会**写进资产（PITFALLS U39）
                         ⚠️ \`--path\` 必须是**实例根**（非根子对象 → \`NOT_PREFAB_INSTANCE\`）
                         退出码：0 且 verified:true / 1（NOT_FOUND / NOT_PREFAB_INSTANCE / APPLY_FAILED /
                         READBACK_FAILED / BAD_SCRIPT_RESULT / verified:false；PREFAB_NOT_FOUND 仅出现在 READBACK_FAILED 的 message 内）/ 2（缺 --path → MISSING_PATH）
  prefab revert          丢弃 Prefab 实例的覆盖（写后读回：hasOverrides 必须为 false）
    --path <实例路径>    必填
                         ⚠️ 同样不还原根 \`localPosition\`（豁免项）；\`--path\` 必须是实例根
                         退出码：0 且 verified:true / 1（NOT_FOUND / NOT_PREFAB_INSTANCE / REVERT_FAILED /
                         READBACK_FAILED / BAD_SCRIPT_RESULT / verified:false；PREFAB_NOT_FOUND 仅出现在 READBACK_FAILED 的 message 内）/ 2（缺 --path → MISSING_PATH）

  play                     PlayMode 试玩闭环（参数名与上游一致，见 docs/CAPABILITIES-tuanjie-2022.3.62t9.md §6）
    start|stop|pause|step|status
                           进/出/暂停/步进 PlayMode；status 只读（不改状态）
                           --timeout-seconds <n>   等待进入/退出的上限（默认 180）
    click                   UI 点击/长按/拖拽（**只对 ScreenSpaceOverlay + GraphicRaycaster 的 uGUI 生效**）
                           --action Click|LongPress|Drag|DragStart|DragMove|DragEnd
                           --x/--y <px>            Game 视图像素，左上原点（必填）
                           --from-x/--from-y <px>  Drag 的起点（--action Drag 必填）
                           --button Left|Right|Middle / --duration <秒>
                           --target-path <path> --bypass-raycast
    mouse                   真实鼠标注入（需 Input System；--dry-run 不需要，但用的是 3D 物理射线）
                           --action Click|LongPress|MoveDelta|SmoothDelta|Scroll
                           --x/--y --button --duration --delta-x --delta-y --scroll-x --scroll-y --dry-run
    key                     键盘注入（需 Input System）
                           --action Press|KeyDown|KeyUp|ReleaseAll（ReleaseAll 不需要 --key）
                           --key <Key枚举>        W / Space / LeftShift / Digit0-9 …
                           --duration <秒>         Press 的按住时长
    logs                    读 Unity 控制台（**状态读回的标准手段**）
                           --log-type All|Error|Warning|Log / --max-count <n> / --search-text <t>
                           --include-stack-trace
    view                    读/设 Game 视图分辨率（不给参数=只读查询；只影响本次会话）
                           --width <n> --height <n>（必须成对）

  ⚠️ key / mouse（非 --dry-run）需要项目装 com.unity.inputsystem 且 Active Input Handling ≠ Old；
     没有它时本命令**如实失败**（INPUT_SYSTEM_UNAVAILABLE），不会静默降级 —— 改用 \`unity play logs\`
     读运行期状态（如 \`[BB] … score=… left=…\`），或用 \`unity exec\` 直接读脚本字段；
     **不要**绕开 \`unity\` 去调裸 uloop。
  ⚠️ click 打不到 SpriteRenderer / 2D 物理对象（上游只收集 uGUI 的 Graphic）。

exec 选项：
  exec (--code-file <f> | --code <s>)
                         在编辑器里执行一段**独立 C# 脚本**（内部实现：上游 execute-dynamic-code），
                         脚本的 return 值原样放在 actual.result（脚本没 return → null）
                         恰给一个源：都缺 → MISSING_SOURCE（用法错 2）/ 都给 → BAD_SOURCE（用法错 2）
                         --code-file 按**当前 shell 的 cwd** 解析成绝对路径再发给编辑器；
                         文件不存在 → SOURCE_NOT_FOUND（运行时错，退出码 1）
                         ⚠️ 片段以 \`--\` 开头时会被当成开关（\`--code --count;\` → \`code:true\` → 误报 BAD_SOURCE）
                            → 改用 \`--code=<片段>\` 形式
                         编译错 → SCRIPT_COMPILE_ERROR（运行时错，退出码 1；actual.errors 带 file/line/message）
                         ⚠️ 本命令是**执行/读**命令：没有可比对的 intent，verified **恒为 null**
                         （不要把它当成写命令的验证；执行本身成功 ≠ 你的业务意图达成）

退出码：
  0  成功（写命令另有约束：verified !== false）
  1  运行时/环境/验证失败（编辑器未连接、节点不存在、读回不一致 verified:false、编译不过）
  2  用法错（参数缺失/类型不符/枚举外取值/JSON 语法错）
  3  内部错误（本包 bug，请上报复现步骤）

示例：
  unity doctor --project-path C:/my-game
  unity doctor --project-path C:/my-game --smoke        # 工具链冒烟（会写临时节点）
  unity node create --project-path C:/my-game --name Brick
  unity node create --project-path C:/my-game --name Brick --parent Canvas --components '["SpriteRenderer"]'
  unity node set --project-path C:/my-game --path Canvas/Brick --patch '{"active":false}'
  unity node delete --project-path C:/my-game --path Canvas/Brick
  unity scene save --project-path C:/my-game --path Assets/Scenes/SampleScene.unity  # 交付物落盘（官方版；团结改成 .scene）
  unity scene open --project-path C:/my-game --path Assets/Scenes/SampleScene.unity  # 切场景（dirty 需 --force）
  unity sprite set --project-path C:/my-game --path Brick --color '#FF2E88' --sorting-order 1
  unity sprite assign --project-path C:/my-game --path Brick --asset Assets/Art/hero.png --world-size 1.6,1.2  # 挂资产 + 世界尺寸
  unity prefab create --project-path C:/my-game --from-node Brick_0_0 --to Assets/Prefabs/Brick.prefab --json
  unity prefab instantiate --project-path C:/my-game --asset Assets/Prefabs/Brick.prefab --parent Bricks --name Brick_1_0 --json
  unity shot --project-path C:/my-game --capture-mode rendering --out C:/my-game/shots --json
  unity pixels --file C:/my-game/shots/x.png --count-color '#FF2E88' --tolerance 16 --json
  unity pixels --file C:/my-game/shots/x.png --at 480,600 --expect '#0A0A14' --tolerance 48
  unity pixels --file C:/my-game/shots/a.png --diff C:/my-game/shots/b.png --json  # 两张图变没变
  unity pixels --file C:/my-game/shots/a.png --bbox '#FF2E88' --centroid '#FF2E88' --json

打砖块 demo（完整节点约定/尺寸/配色/验证配方见 skills/unity-game-dev/SKILL.md §3.5 / §8）：
  unity compile --project-path C:/my-game --json
  unity build --project-path C:/my-game --target win64 --out C:/my-game-build/win64 --json
  unity asset write --project-path C:/my-game --to Assets/PiBrickBreaker/PiBrickBreaker.cs --template PiBrickBreaker
  unity asset import --project-path C:/my-game --from C:/pic/hero.png --to Assets/Art/hero.png --remove-bg auto --trim --ppu 16 --json
  unity asset import --project-path C:/my-game --from C:/pic/tiles.png --to Assets/Art/tiles.png --fit 64,64 --json
  unity play view   --project-path C:/my-game --width 960 --height 640
  unity play start  --project-path C:/my-game --json
  unity play logs   --project-path C:/my-game --search-text '[BB]' --json
  unity exec --project-path C:/my-game --code 'return Application.dataPath;' --json
  unity play stop   --project-path C:/my-game --json
`;

/**
 * D-A2：解析 + 布尔归一。归一失败时按既有 argv 形状错的做法**直接返回 EXIT_USAGE**
 * （不经信封 —— 与 `bin/unity.js` 现有的 `MISSING_*` 子动作分支一致）。
 */
function parseArgsStrict(argv) {
  const { parseArgs, normalizeBooleans } = require('../lib/args.js');
  const r = normalizeBooleans(parseArgs(argv));
  if (r.error) {
    process.stderr.write(`[FAIL] ${r.error.code}: ${r.error.message}\n`);
    for (const h of r.error.hint) process.stderr.write(`  hint: ${h}\n`);
    return { error: true };
  }
  return { args: r.args };
}

const COMMANDS = {
  version: () => {
    process.stdout.write(`pi-unity ${pkg.version}\n`);
    return 0;
  },
  doctor: (rest) => require('../lib/doctor.js').doctor(rest),
  scene: async (rest) => {
    const [action, ...opts] = rest;
    const parsed = parseArgsStrict(opts);
    if (parsed.error) return EXIT_USAGE;
    const args = parsed.args;
    if (action === 'save' || action === 'open') {
      // R203：局部 require（顶层没有 emit/exitCodeFor）
      const { emit, exitCodeFor } = require('../lib/envelope.js');
      const { sceneSave, sceneOpen } = require('../lib/scenefile.js');
      // 参数原样透传：缺 / 裸写 true / 空串全部由 lib/scenefile.js 在**任何 uloop 调用之前**
      // 判成用法错（MISSING_PATH / BAD_TARGET_PATH → 2）。
      const e = action === 'save'
        ? await sceneSave({ projectPath: args['project-path'], path: args.path })
        : await sceneOpen({ projectPath: args['project-path'], path: args.path, force: args.force });
      emit(e, { json: Boolean(args.json) });
      // 退出码只由 exitCodeFor 判定（约束 16）：不手写 e.ok ? 0 : 1。
      return exitCodeFor(e);
    }
    if (action !== 'tree') {
      process.stderr.write('usage: unity scene tree\n');
      return EXIT_USAGE;
    }
    const { sceneTree } = require('../lib/scene.js');
    const { emit, exitCodeFor } = require('../lib/envelope.js');
    const e = await sceneTree({ projectPath: args['project-path'] });
    // R59：--json 必须真的生效（默认人读，与 doctor 一致）；硬编码 json:true 会让
    // 任务 1 的 USAGE 承诺（--json 输出机器可读 JSON）形同虚设。
    emit(e, { json: Boolean(args.json) });
    return exitCodeFor(e);
  },
  node: async (rest) => {
    const [action, ...opts] = rest;
    const parsed = parseArgsStrict(opts);
    if (parsed.error) return EXIT_USAGE;
    const args = parsed.args;
    const { emit, exitCodeFor } = require('../lib/envelope.js');
    if (action === 'inspect') {
      const { nodeInspect } = require('../lib/scene.js');
      // R480：定位参数是可选的；缺省时不进 payload（与 `parseArgs` 的 undefined 一致）
      const e = await nodeInspect({ projectPath: args['project-path'], path: args.path, siblingIndex: args['sibling-index'] });
      emit(e, { json: Boolean(args.json) });
      return exitCodeFor(e);
    }
    if (action === 'delete') {
      const { nodeDelete } = require('../lib/scene.js');
      const e = await nodeDelete({ projectPath: args['project-path'], path: args.path });
      emit(e, { json: Boolean(args.json) });
      return exitCodeFor(e);
    }
    if (action === 'create' || action === 'set') {
      // R87：CLI 只负责 JSON.parse —— 语法错是用法错误（退出码 2），**不得抛**。
      // 非字符串（缺 / `--patch` 裸写 → true）不进 JSON.parse：那些交给库守卫落
      // MISSING_PATCH / BAD_COMPONENTS 失败信封（退出码 2，由 exitCodeFor 判定）。
      const jsonFlag = (raw, flag) => {
        if (typeof raw !== 'string') return { value: raw };
        try {
          return { value: JSON.parse(raw) };
        } catch (err) {
          process.stderr.write(`${flag} 不是合法 JSON：${err.message}\n`);
          return { error: EXIT_USAGE };
        }
      };
      const patchArg = jsonFlag(args.patch, '--patch');
      if (patchArg.error) return patchArg.error;
      const compArg = jsonFlag(args.components, '--components');
      if (compArg.error) return compArg.error;

      const { nodeCreate, nodeSet } = require('../lib/scene.js');
      const e = action === 'create'
        ? await nodeCreate({
          projectPath: args['project-path'], name: args.name, parent: args.parent, components: compArg.value,
        })
        : await nodeSet({ projectPath: args['project-path'], path: args.path, patch: patchArg.value });
      emit(e, { json: Boolean(args.json) });
      // 退出码统一由 `exitCodeFor` 判定（2=用法错 / 1=运行时错 / 0=成功）。
      // R85 设计铁律「verified:false 就是失败，必须停下处理」由该函数承接：
      // ok:true + verified:false 不得静默退出 0。
      // 读命令 verified 恒为 null，故不受影响（既不虚报成功也不误报失败）。
      return exitCodeFor(e);
    }
    process.stderr.write('usage: unity node inspect|create|set|delete\n');
    return EXIT_USAGE;
  },
  shot: async (rest) => {
    const parsed = parseArgsStrict(rest);
    if (parsed.error) return EXIT_USAGE;
    const args = parsed.args;
    const { emit, exitCodeFor } = require('../lib/envelope.js');
    const { shot } = require('../lib/shot.js');
    // R107：不传 `--window-name` 时**不要**自己兜 'Game'（`||` 会把空串也吞掉）——
    // 默认值写在 shot() 的形参上；这里原样透传，让「缺 / 裸写 true / 空串」三种形态
    // 在库里被区分（后两者落 BAD_WINDOW_NAME / BAD_OUT_DIR，且在调用 uloop 前挡下）。
    const e = await shot({
      projectPath: args['project-path'],
      outDir: args.out,
      windowName: args['window-name'],
      captureMode: args['capture-mode'],
      matchMode: args['match-mode'],
    });
    // R97：`--json` 必须真的控制输出（同任务 9 的 R59）——硬编码 json:true 会让
    // USAGE 的「--json 输出机器可读 JSON」形同虚设。截图是读命令，退出码由 exitCodeFor 判定。
    emit(e, { json: Boolean(args.json) });
    return exitCodeFor(e);
  },
  pixels: async (rest) => {
    const parsed = parseArgsStrict(rest);
    if (parsed.error) return EXIT_USAGE;
    const args = parsed.args;
    // R203：M1 风格 —— 新 handler 在自己体内局部 require 它用到的一切（顶层没有 emit/exitCodeFor）
    const { emit, exitCodeFor } = require('../lib/envelope.js');
    const { pixels } = require('../lib/pixels.js');
    const e = await pixels({
      file: args.file,
      at: args.at,
      region: args.region,
      expect: args.expect,
      tolerance: args.tolerance,
      countColor: args['count-color'],
      diff: args.diff,
      centroid: args.centroid,
      bbox: args.bbox,
    });
    emit(e, { json: Boolean(args.json) });
    return exitCodeFor(e);
  },
  sprite: async (rest) => {
    const [action, ...opts] = rest;
    const parsed = parseArgsStrict(opts);
    if (parsed.error) return EXIT_USAGE;
    const args = parsed.args;
    // R203：局部 require（同上，顶层没有 emit/exitCodeFor）
    const { emit, exitCodeFor } = require('../lib/envelope.js');
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
      // R222：用法错退出码是单一常量（裸 2 会在 handler 之间漂移）
      return EXIT_USAGE;
    }
    const { spriteSet } = require('../lib/sprite.js');
    const { parseHexColor } = require('../lib/color.js');
    const e = await spriteSet({
      projectPath: args['project-path'],
      path: args.path,
      // `--color` 裸写 → parseArgs 给布尔 true → parseHexColor 判 null → BAD_COLOR（用法错，退出码 2）
      color: parseHexColor(args.color) ?? { bad: args.color },
      sortingOrder: args['sorting-order'] === undefined
        ? undefined
        : (/^-?\d+$/.test(args['sorting-order']) ? Number(args['sorting-order']) : args['sorting-order']),
    });
    emit(e, { json: Boolean(args.json) });
    return exitCodeFor(e);
  },
  compile: async (rest) => {
    const parsed = parseArgsStrict(rest);
    if (parsed.error) return EXIT_USAGE;
    const args = parsed.args;
    const { emit, exitCodeFor } = require('../lib/envelope.js');   // R203：局部 require
    const { compile } = require('../lib/asset.js');
    const e = await compile({ projectPath: args['project-path'], timeoutSeconds: args['timeout-seconds'] });
    emit(e, { json: Boolean(args.json) });
    return exitCodeFor(e);
  },
  build: async (rest) => {
    const parsed = parseArgsStrict(rest);
    if (parsed.error) return EXIT_USAGE;
    const args = parsed.args;
    const { emit, exitCodeFor } = require('../lib/envelope.js');   // R203：局部 require
    const { buildGame } = require('../lib/build.js');
    // 参数原样透传（不做兜底）：缺 / 裸写 true / 空串 / 枚举外取值
    // 全部由 lib/build.js 在**任何 uloop 调用之前**判错（MISSING_TO / BAD_ACTION /
    // BAD_OUT_DIR / BAD_TIMEOUT → 用法错 2；MISSING_PROJECT_PATH **缺参数 → 用法错 2**）。
    const e = await buildGame({
      projectPath: args['project-path'],
      target: args.target,
      outDir: args.out,
      timeoutSeconds: args['timeout-seconds'],
    });
    emit(e, { json: Boolean(args.json) });
    // 退出码只由 exitCodeFor 判定（约束 16）：`verified:false`（含 ARTIFACT_MISSING）就是失败。
    return exitCodeFor(e);
  },
  asset: async (rest) => {
    const [action, ...opts] = rest;
    const parsed = parseArgsStrict(opts);
    if (parsed.error) return EXIT_USAGE;
    const args = parsed.args;
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
    const e = await assetWrite({
      projectPath: args['project-path'],
      to: args.to,
      from: args.from,
      template: args.template,
      force: args.force,
      noCompile: args['no-compile'],
      timeoutSeconds: args['timeout-seconds'],
    });
    emit(e, { json: Boolean(args.json) });
    return exitCodeFor(e);
  },
  prefab: async (rest) => {
    const [action, ...opts] = rest;
    const parsed = parseArgsStrict(opts);
    if (parsed.error) return EXIT_USAGE;
    const args = parsed.args;
    const { emit, exitCodeFor } = require('../lib/envelope.js');   // R203：局部 require
    if (action === 'create' || action === 'instantiate' || action === 'apply' || action === 'revert') {
      const { prefabCreate, prefabInstantiate, prefabApply, prefabRevert } = require('../lib/prefab.js');
      // 参数原样透传（不做兜底）：缺 / 裸写 true / 空串 / 枚举外取值
      // 全部由 lib/prefab.js 在**任何写盘、任何 uloop 调用之前**判成用法错（MISSING_PATH /
      // MISSING_TO / BAD_TARGET_PATH / MISSING_ASSET / BAD_ASSET_PATH / BAD_PARENT / MISSING_NAME → 2）。
      let e;
      if (action === 'create') {
        e = await prefabCreate({
          projectPath: args['project-path'],
          fromNode: args['from-node'],
          to: args.to,
          force: args.force,
        });
      } else if (action === 'instantiate') {
        e = await prefabInstantiate({
          projectPath: args['project-path'],
          asset: args.asset,
          parent: args.parent,
          name: args.name,
        });
      } else {
        const fn = action === 'apply' ? prefabApply : prefabRevert;
        e = await fn({ projectPath: args['project-path'], path: args.path });
      }
      emit(e, { json: Boolean(args.json) });
      // 退出码只由 exitCodeFor 判定（约束 16）：`verified:false` 就是失败（退出码 1）。
      return exitCodeFor(e);
    }
    process.stderr.write('usage: unity prefab create --from-node <节点路径> --to <Assets/...prefab> [--force]\n'
      + '       unity prefab instantiate --asset <Assets/...prefab> [--parent <节点路径>] [--name <名字>]\n'
      + '       unity prefab apply  --path <实例路径>\n'
      + '       unity prefab revert --path <实例路径>\n');
    return EXIT_USAGE;
  },
  play: async (rest) => {
    const [sub, ...opts] = rest;
    const parsed = parseArgsStrict(opts);
    if (parsed.error) return EXIT_USAGE;
    const args = parsed.args;
    // R203：局部 require（同上，顶层没有 emit/exitCodeFor）
    const { emit, exitCodeFor } = require('../lib/envelope.js');
    const play = require('../lib/play.js');
    const projectPath = args['project-path'];
    let e;
    if (sub === 'start' || sub === 'stop' || sub === 'pause' || sub === 'step' || sub === 'status') {
      const action = { start: 'Play', stop: 'Stop', pause: 'Pause', step: 'Step', status: 'Status' }[sub];
      e = await play.playMode({ projectPath, action, timeoutSeconds: args['timeout-seconds'] });
    } else if (sub === 'click') {
      e = await play.playClick({
        projectPath,
        action: args.action === undefined ? 'Click' : args.action,
        x: args.x, y: args.y, fromX: args['from-x'], fromY: args['from-y'],
        button: args.button, duration: args.duration,
        targetPath: args['target-path'], bypassRaycast: args['bypass-raycast'],
      });
    } else if (sub === 'mouse') {
      e = await play.playMouse({
        projectPath,
        action: args.action === undefined ? 'Click' : args.action,
        x: args.x, y: args.y, button: args.button, duration: args.duration,
        deltaX: args['delta-x'], deltaY: args['delta-y'],
        scrollX: args['scroll-x'], scrollY: args['scroll-y'],
        dryRun: args['dry-run'],
      });
    } else if (sub === 'key') {
      e = await play.playKey({
        projectPath,
        action: args.action === undefined ? 'Press' : args.action,
        key: args.key, duration: args.duration,
      });
    } else if (sub === 'logs') {
      e = await play.playLogs({
        projectPath,
        logType: args['log-type'] === undefined ? 'All' : args['log-type'],
        maxCount: args['max-count'], searchText: args['search-text'],
        includeStackTrace: args['include-stack-trace'],
      });
    } else if (sub === 'view') {
      e = await play.playView({ projectPath, width: args.width, height: args.height });
    } else {
      process.stderr.write('usage: unity play start|stop|pause|step|status|click|mouse|key|logs|view\n');
      // R259：用法错退出码用单一常量（简报原稿在此写了裸魔法数 2）
      return EXIT_USAGE;
    }
    emit(e, { json: Boolean(args.json) });
    return exitCodeFor(e);
  },
  exec: async (rest) => {
    const parsed = parseArgsStrict(rest);
    if (parsed.error) return EXIT_USAGE;
    const args = parsed.args;
    // R203：M1 风格 —— 新 handler 在自己体内局部 require 它用到的一切（顶层没有 emit/exitCodeFor）
    const { emit, exitCodeFor } = require('../lib/envelope.js');
    const { execCode } = require('../lib/dynamic.js');
    // 源参数原样透传（不做兜底）：缺 / 裸写 true / 空串 / 两者都给，
    // 全部由 lib/dynamic.js 在**任何 uloop 调用之前**判成用法错（MISSING_SOURCE / BAD_SOURCE → 2）。
    const e = await execCode({
      projectPath: args['project-path'],
      codeFile: args['code-file'],
      code: args.code,
    });
    emit(e, { json: Boolean(args.json) });
    // 退出码只由 exitCodeFor 判定（约束 16）：不手写 e.ok ? 0 : 1。
    return exitCodeFor(e);
  },
};

async function main(argv, commands = COMMANDS) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  // 用自有属性判定：否则 toString/constructor/hasOwnProperty 等 Object.prototype
  // 上的名字会沿原型链命中，绕过 "unknown command" 分支。
  const handler = Object.hasOwn(commands, cmd) ? commands[cmd] : undefined;
  if (typeof handler !== 'function') {
    process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  const code = await handler(rest);
  // 收敛为合法退出码：非整数（字符串/数组/NaN/undefined...）按成功 0 处理，
  // 避免 process.exit() 抛 ERR_INVALID_ARG_TYPE/ERR_OUT_OF_RANGE 被误报为内部错误 3。
  return Number.isInteger(code) ? code : 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`internal error: ${err && err.stack ? err.stack : err}\n`);
      process.exit(3);
    });
}

module.exports = { main };
