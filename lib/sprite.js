'use strict';

const { call } = require('./uloop.js');
const { fail, envelopeFromCall } = require('./envelope.js');
const { buildPayloadArgs, parseNodeResult, parseScriptResult, readBackAndVerify, withWriteRecheckHint } = require('./scene.js');

/** `sortingOrder` 是 Unity 的 `int`（int32）：越界值会在 `.cs` 的 `(int)` 转换上抛异常。 */
const SORTING_ORDER_MIN = -2147483648;
const SORTING_ORDER_MAX = 2147483647;

/** R407：`--world-size` 每个分量（`trim()` 后）只接受**十进制**形态 —— `0x10` / `1e3` / `+1` /
 *  `Infinity` / `NaN` 全部拒。`Number()` 的宽容（`Number('0x10') === 16`）就是假绿的温床：
 *  agent 写 `--world-size 0x10,1` 时会「成功」地设成 16。 */
const WORLD_SIZE_COMPONENT = /^-?\d+(\.\d+)?$/;

/** R401：读回口径是**绝对容差** `1e-4`（`lib/readback.js` 的 `DEFAULT_TOL`，R50 已裁定保持）。
 *  小于等于该量级的世界尺寸根本不可能被验证 —— 与其让它「永远 verified:false」，不如在 argv 层
 *  就判成用法错（纯 argv 判定，R237）。 */
const WORLD_SIZE_MIN = 1e-4;

/** 颜色必须是非空对象且 r/g/b 是 0–255 整数；a 可选（0–255 整数）。 */
function isValidColor(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  const fields = c.a === undefined ? ['r', 'g', 'b'] : ['r', 'g', 'b', 'a'];
  return fields.every((k) => Number.isInteger(c[k]) && c[k] >= 0 && c[k] <= 255);
}

/**
 * `unity sprite set`：给节点挂运行时纯色 sprite + **写后读回**。
 *
 * 依赖 `unity-scripts/sprite-set.cs` 与 `unity-scripts/node-inspect.cs` 的 `sprite` 字段，
 * 三者由本文件与 `test/sprite.test.js` 的载荷断言钉在一起（全局约束 18）。
 *
 * intent 的**形状**就是读回路径的形状：`{sprite:{color:{r,g,b[,a]}, sortingOrder?}}` ——
 * 于是 `compareSubset` 直接递归比对，且「节点没有 SpriteRenderer」（读回 `sprite: null`）
 * 会自然落成一条 `key:'sprite'` 的分歧（F2 类型校验），不需要手写额外判据。
 *
 * 传给 `.cs` 的载荷**不**带 `sprite` 外壳（`.cs` 只认 `{path, color, sortingOrder}`）；
 * 两者的差异由本函数自己的测试钉住（`payload` 与 `intent` 的断言各一条）。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, path?: string,
 *   color?: {r:number,g:number,b:number,a?:number}, sortingOrder?: number, _call?: typeof call}} [opts]
 * @returns {Promise<object>} 信封（成功时 `verified` 为布尔，绝非 null）
 */
async function spriteSet({ projectPath, env, path: nodePath, color, sortingOrder, _call } = {}) {
  if (typeof nodePath !== 'string' || nodePath === '') {
    return fail({
      code: 'MISSING_PATH',
      message: '缺少 --path（形如 Canvas/Brick_0_0）',
      actual: { path: nodePath },
      hint: ['用 `unity scene tree` 取可用路径'],
    });
  }
  if (!isValidColor(color)) {
    return fail({
      code: 'BAD_COLOR',
      message: '--color 需要 #RGB / #RRGGBB / #RRGGBBAA 形式的合法颜色',
      actual: { color },
      hint: ['用法：--color \'#00FFC8\'（8 位写法带 alpha：\'#00FFC880\'）'],
    });
  }
  // R247：`Number.isInteger` 只挡小数/字符串 —— `--sorting-order 3000000000` 会穿过守卫，
  // 在 `sprite-set.cs` 的 `(int)` 转换上抛异常（运行时错，退出码 1），而它本质是**用法错**（2）。
  // 用法错必须只由 argv 决定（R237），所以范围在调用**之前**收敛。
  if (sortingOrder !== undefined
    && (!Number.isInteger(sortingOrder) || sortingOrder < SORTING_ORDER_MIN || sortingOrder > SORTING_ORDER_MAX)) {
    return fail({
      code: 'BAD_SORTING_ORDER',
      message: `--sorting-order 需要 int32 整数（${SORTING_ORDER_MIN} … ${SORTING_ORDER_MAX}）`,
      actual: { sortingOrder },
      hint: [
        '用法：--sorting-order 0',
        `取值范围 ${SORTING_ORDER_MIN} … ${SORTING_ORDER_MAX}（Unity 的 sortingOrder 是 32 位有符号整数）`,
      ],
    });
  }

  const intent = { sprite: { color: { r: color.r, g: color.g, b: color.b, ...(color.a === undefined ? {} : { a: color.a }) } } };
  if (sortingOrder !== undefined) intent.sprite.sortingOrder = sortingOrder;

  const payload = { path: nodePath, color: { ...color } };
  if (sortingOrder !== undefined) payload.sortingOrder = sortingOrder;

  const callFn = _call || call;
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('sprite-set', payload), { projectPath, env });
  } catch (err) {
    return fail({
      code: 'WRITE_CALL_FAILED',
      message: `sprite-set 写调用失败：${(err && err.message) || String(err)}`,
      intent,
      hint: [
        '写入是否生效未知；用 `unity node inspect` 复核该节点的 components/sprite',
        '确认编辑器已打开目标项目（用 `unity doctor` 查看环境）',
      ],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  // F3/R348：写路径的传输层失败不是纯读故障 —— sprite 可能已上色，重试前必须先复核。
  if (!envl.ok) return withWriteRecheckHint(envl);
  // R207：不再裸用 `parseNodeResult(w)` —— 给它传被查的 `path`，使 NOT_FOUND 的 `actual` 带 `{path}`
  // （与 T3 的 nodeDelete 同一口径，M1 R69），而不是原样的 `{__error:'NOT_FOUND'}`。
  const res = parseNodeResult(w, { path: nodePath });
  if (res.envelope) return res.envelope;

  // R245：读回段收口到 `lib/scene.js` 的共享 helper（单一真值）—— 此前这里是
  // `verifyWrite` + `err.envelope` + `READBACK_FAILED` + `ok(...)` 的第二次手抄，
  // 两份实现会在「读回失败的 hint 兜底」「mismatches 附加方式」等细节上漂移。
  // sprite 专属的差异化只通过 helper 的两个形参传入：`residue`（读回失败时的复核指引）
  // 与 `mismatchHint`（读回成功但不一致时的查错方向）。
  return readBackAndVerify({
    projectPath,
    env,
    callFn,
    readPath: nodePath,
    intent,
    residue: '写入可能已生效；sprite 的纹理由运行时创建（HideAndDontSave），**不随场景保存** —— 场景重开后需重跑本命令或由游戏脚本在运行时生成',
    mismatchHint: '读回结果与意图不一致（verified:false）——检查该节点是否真有 SpriteRenderer、颜色是否被改写；逐条查 mismatches',
  });
}

/**
 * `--asset` 的路径校验 + **归一**（R408）。
 *
 * 归一（折叠重复 `/`、去掉 `.` 段）的结果**同时用于 intent 与 payload** —— Unity 的
 * `AssetDatabase` 回的是规范路径，不归一会「写进去一个样、读回来又一个样」→ 假红。
 *
 * `..` **按段**判（`split('/').includes('..')`）：`Assets/a..b.png` 里的 `..` 不是独立段，
 * 用 `String.includes('..')` 会把它误拒。
 *
 * 首段空（`/Assets/...`、`//Assets/...`）**保留** —— 归一不得把宿主绝对路径洗成合法资产路径。
 *
 * 与 `normalizeAssetTo` 同一口径，但**不共用**：那里的错误码是 MISSING_TO/BAD_TARGET_PATH，
 * 这里的 `--asset` 要有自己的码，否则 agent 分不清是「要写进去的目标」错还是「要读的资产」错。
 *
 * @returns {string|null} 归一后的 `Assets/…` 路径；非法 → `null`
 */
function normalizeAssetPath(v) {
  if (typeof v !== 'string') return null;
  const segs = v.replace(/\\/g, '/').split('/');
  if (segs.includes('..')) return null;
  const kept = [];
  for (let i = 0; i < segs.length; i += 1) {
    // `''` 只在**非首段**丢弃（首段空 = 绝对路径，必须留着让它落 BAD_ASSET_PATH）
    if (segs[i] === '.' || (segs[i] === '' && i !== 0)) continue;
    kept.push(segs[i]);
  }
  const normalized = kept.join('/');
  return /^Assets\//.test(normalized) ? normalized : null;
}

/** `--world-size w,h`：两个 >1e-4 的有限十进制数（R401 下界 / R407 形态）。非法 → null。 */
function parseWorldSizeArg(v) {
  if (typeof v !== 'string') return null;
  const parts = v.split(',');
  if (parts.length !== 2) return null;
  const texts = parts.map((s) => s.trim());
  if (!texts.every((s) => WORLD_SIZE_COMPONENT.test(s))) return null;
  const [x, y] = texts.map((s) => Number(s));
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return null;
  if (x <= WORLD_SIZE_MIN || y <= WORLD_SIZE_MIN) return null;
  return { x, y };
}

/**
 * `unity sprite assign`：把**资产**里的 sprite 挂到节点（+ 可选世界尺寸），**写后读回**。
 *
 * intent 的形状就是读回路径的形状（`node-inspect.cs` 的 `sprite` 子对象）：
 * `{sprite: {assetPath[, worldSize:{x,y}]}}` → `compareSubset` 直接递归比对。
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
  if (typeof asset !== 'string') {
    return fail({
      code: 'MISSING_ASSET',
      message: '缺少 --asset（必须是 Assets/ 下的图片资产路径）',
      actual: { asset },
      hint: ['用法：unity sprite assign --path Brick --asset Assets/Art/hero.png（先用 `unity asset import` 把它导入为 Sprite）'],
    });
  }
  // R409：`--asset=''` 是「给了值但值为空」→ BAD_ASSET_PATH（与 R274 的 `--to=''` 同口径），
  // 不是 MISSING_ASSET；`normalizeAssetPath` 对空串也返回 null，这里一并收口。
  const assetPath = normalizeAssetPath(asset);
  if (assetPath === null) {
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
      message: `--world-size 需要 w,h 两个十进制的正数（且都 > ${WORLD_SIZE_MIN.toExponential()}），收到 ${JSON.stringify(worldSize)}`,
      actual: { worldSize },
      hint: [
        '用法：--world-size 1.6,0.5（单位是**世界单位**；不给则不改缩放）',
        // R418④：hint 必须**精确**，不许夸大 —— 只有 ≤1e-4 才「无法验证」；略大于 1e-4 的值
        //   （如 1.1e-4 vs 读回 2.1e-4）仍能穿过**绝对**容差 1e-4，其相对精度只有 `1e-4/值`。
        `读回用**绝对**容差 ${WORLD_SIZE_MIN.toExponential()}（\`lib/readback.js\` 的 DEFAULT_TOL）：≤ ${WORLD_SIZE_MIN.toExponential()} 的尺寸无法验证；略大于该值的尺寸其**相对**精度也只有 ${WORLD_SIZE_MIN.toExponential()}/值（如 1.1e-4 vs 2.1e-4 仍会穿过）。建议用 ≥0.001 量级的世界尺寸，或改用 \`shot\`+\`pixels\` 判定`,
      ],
    });
  }

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
        // R408：hint 不许对非图片扩展名声称「该 PNG 可能没被导入为 Sprite」—— 那是误导。
        const isImage = /\.(png|jpe?g|bmp|tga|tif{1,2}|psd|gif|exr|hdr)$/i.test(assetPath);
        return {
          message: `资产里没有 Sprite：${(parsed && parsed.asset) || assetPath}`,
          actual: { asset: assetPath },
          hint: [
            isImage
              ? '该图片可能还没被导入为 Sprite/Single —— 用 `unity asset import` 导入它（它会显式配 textureType=Sprite）'
              : '该路径可能不是图片资产（扩展名不是 png/jpg/bmp/tga/tif/psd/gif/exr/hdr）—— 本命令只挂图片导入的 Sprite，核对 --asset 拼写',
            // F2/R477：**不要**推荐 `AssetDatabase.AssetPathToGUID` 复核 —— 它在 `DeleteAsset` 后
            // 仍返回过期 guid（假绿）。判定「资产还在」用 `LoadAssetAtPath<Sprite>(path) == null`。
            '或路径写错/资产已被删除 —— 用 `unity exec --code \'return AssetDatabase.LoadAssetAtPath<Sprite>("…") == null;\'` 判定'
              + '（**不要**用 `AssetPathToGUID` 判「资产还在」：它删除后仍返回过期 guid → 假绿，见 PITFALLS **U47** / R477）',
          ],
        };
      }
      if (code === 'AMBIGUOUS_SPRITE') {
        return {
          message: `该资产含多个 Sprite（${(parsed && parsed.count) ?? '?'} 个）：${(parsed && parsed.asset) || assetPath}`,
          actual: { asset: assetPath, count: parsed && parsed.count },
          hint: [
            '该资产含多个 Sprite；本命令只支持单 sprite 资产 —— 用 `unity asset import` 导入（它固定 spriteImportMode=Single），或手工把该图改成 Single',
          ],
        };
      }
      if (code === 'UI_IMAGE_PRESENT') {
        return {
          message: `节点上只有 UI Image、没有 SpriteRenderer：${nodePath}`,
          actual: { path: nodePath, component: (parsed && parsed.component) || 'Image' },
          hint: [
            '`sprite assign` 只挂 `SpriteRenderer`，不处理 UI `Image`（Canvas 下的图片走 UI 管线）',
            '确实要在该节点挂 SpriteRenderer：先删掉 / 挪走 UI `Image`，或换个非 UI 节点',
            '要设 UI `Image.sprite`：本包暂无该命令（backlog）—— 用 `unity exec` 直接赋值',
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
    // R404：世界尺寸读回用的是 `sr.bounds`（世界 AABB）。节点或其祖先有**旋转**时
    // AABB ≠ 精灵宽高 → 本命令会（预期地）落 verified:false。这里必须把出路写清，
    // 否则 agent 会去调容差 —— 那会毁掉「世界尺寸」这条唯一的真值判据。
    mismatchHint: '读回与意图不一致（verified:false）——assetPath 为 null 说明没挂上资产；worldSize 不符说明父级有缩放/旋转（节点或其祖先有**旋转**时 sr.bounds 是世界 AABB ≠ 精灵宽高 → 本命令会**预期地**落 verified:false：改用 `shot`+`pixels` 判据，或先把旋转清零）；或 **SpriteRenderer.drawMode 不是 Simple**（Sliced/Tiled 下 `sr.bounds.size = sr.size × scale`，与写侧用的 `Sprite.bounds` 是两个量 —— 真机实测 `docs/m5-probes-raw/b2-REPORT.md`；把 drawMode 改回 Simple 再 assign，或用 `shot`+`pixels` 判几何）；逐条查 mismatches，**不要**为此放宽容差',
    // ⚠️ intent **只含 assetPath[/worldSize]**：读回面还会带 `ppu`/`spriteName`/`color`…，那些只进 actual。
    //    尤其 **ppu 不能进 intent** —— 值来自资产自身，JS 侧无从得知；想在 JS 侧断言它就是要重实现 Unity 的 PPU 语义。
  });
}

// R251 纪律：`isValidColor` / `normalizeAssetPath` **不导出**（全仓库无外部消费者）；
// `parseWorldSizeArg` 导出**仅供测试**直测边界（R407：它此前零直接消费者，边界只靠 spriteAssign 间接覆盖）。
module.exports = { spriteSet, spriteAssign, parseWorldSizeArg };
