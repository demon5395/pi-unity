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

/**
 * 「背景可能不是纯色」的告警阈值：命中率低于它 → 给 `warning`（**不**失败）。
 *
 * 取值说明（本文件与简报的**唯一**偏离）：简报的 `lib/art.js` 写的是 `nearFraction < 0.02`，
 * 但简报自己的测试 `normalizeArt：去底后命中率 <2% → 给出 warning` 用的 fixture 是
 * 4×4 里 1 个 key 色像素（命中率 1/16 = **6.25%**），并断言"必须有 warning" ——
 * 6.25% 不 < 2%，两者不可能同时成立（简报自相矛盾）。按 TDD 优先级（测试定义行为、是验收 gate）
 * 保留 18 条测试**逐字不变**，把这个阈值抬到 0.1：它低于真实素材的背景覆盖率
 * （M4 的 E2E 供图 24×16 / 主体 6×4 → 背景占 93.75%，不误报），又高于 6.25%（可告警）。
 */
const MIN_KEY_HIT_FRACTION = 0.1;

/** 构造带 code 的运行时错误（调用方据此落信封；**不是**用法错）。 */
function artError(code, message, detail) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  return err;
}

/** 0–255 的整数守卫（NaN/负数/小数都直接抛 —— 一个字符不能关掉整道闸门）。 */
function assertByte255(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new TypeError(`${name} 必须是 0–255 的整数，收到 ${String(value)}`);
  }
}

/** tolerance 守卫（与 `trimBounds` 的 threshold 同口径）。 */
function assertTolerance(tolerance) {
  assertByte255(tolerance, 'tolerance');
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
 *
 * 返回 `{ changed, nearFraction }`：
 * - `changed` = 真的改过像素（alpha **或** RGB 任一被改写）；
 * - `nearFraction` = 命中 key 的像素占**可见**像素（`a !== 0`）的比例，用于「背景可能不是纯色」的警告。
 *   本来就 `a === 0` 的像素既不算可见、也不算命中 —— 否则命中率虚高，会掩盖「背景色给错了」。
 *
 * @throws {TypeError} `opts.tolerance` 不是 0–255 的整数
 */
function keyOutPixels(data, width, height, opts) {
  const { key, tolerance } = opts || {};
  assertTolerance(tolerance);
  const tol = tolerance;
  const total = width * height;
  let domIdx = 0;                                   // key 的主导通道
  if (key.g >= key.r && key.g >= key.b) domIdx = 1;
  else if (key.b >= key.r && key.b >= key.g) domIdx = 2;
  let near = 0;                                     // 命中 key 且**可见**的像素
  let visible = 0;                                  // a !== 0 的像素（分母）
  let changed = false;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const r = data[o]; const g = data[o + 1]; const b = data[o + 2];
    const visibleBefore = data[o + 3] !== 0;
    if (visibleBefore) visible++;
    const d = colorDistance(r, g, b, key);
    if (d <= tol) {
      if (visibleBefore) near++;
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
      // RGB 任一通道被改写也算 changed：`d == 2*tol` 时 f = 1 → alpha 不变，只有 RGB 变
      if (data[o] !== chans[0] || data[o + 1] !== chans[1] || data[o + 2] !== chans[2]) changed = true;
      data[o] = chans[0]; data[o + 1] = chans[1]; data[o + 2] = chans[2];
      if (data[o + 3] !== a) { data[o + 3] = a; changed = true; }
    }
  }
  return { changed, nearFraction: visible ? near / visible : 0 };
}

/**
 * alpha > threshold 的包围盒；全透明返回 `null`。
 *
 * @param {number} threshold 0–255 的整数（非法值**响亮抛**，不静默当 0 —— `NaN` 会让比较恒假、
 *   静默宣称「整张图全透明」）
 * @throws {TypeError} `threshold` 不是 0–255 的整数
 */
function trimBounds(data, width, height, threshold) {
  assertByte255(threshold, 'threshold');
  const th = threshold;
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
 * 四角推断背景色：取四个角像素。两种「推不出背景色」都抛 `BACKGROUND_AMBIGUOUS`
 * （**运行时错**：结论依赖图片内容，不依赖 argv，按 R237 不能算用法错）：
 * - **任一通道**在四角间的极差 > tolerance（背景不是纯色）；
 * - **四角 alpha 全为 0**（`detail.reason === 'transparent-corners'`）：图本来就带透明背景，
 *   没有实心背景色可推断 —— 若拿 RGB 去 key，只会把不透明主体羽化掉。
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
  // 四角全透明 → 这张图自带透明背景，没有「实心背景色」可推断。取 RGB（多为 0,0,0）去 key 只会
  // 把 tol<d<=2tol 的**不透明主体**羽化成半透明（且 nearFraction 远高于告警阈值 → 不告警）→ 直接抛。
  if (corners.every((c) => c.a === 0)) {
    throw artError(
      'BACKGROUND_AMBIGUOUS',
      '四角全透明：这张图本来就没有实心背景（别用 --remove-bg auto，直接 --trim 即可）',
      { corners, reason: 'transparent-corners' },
    );
  }
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
    // 用 set/subarray（而不是 Buffer.prototype.copy）：Buffer 与 Uint8Array 都支持（F7）
    out.set(img.data.subarray(srcStart, srcStart + width * 4), y * width * 4);
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

/**
 * contain-fit 到**恰好** `targetW x targetH` 的画布（保持比例、最近邻、居中、空白全透明）。
 *
 * 偏移用 `Math.round`（不是 `Math.floor`）：上下/左右各留半行时，多出来的那半行走上/左
 * ——`2x1` 放进 `2x2` 时图落在**下**半行（简报的测试就是这么断言的）。
 *
 * @throws {TypeError} 目标尺寸不是**正整数**（小数目标会产出畸形图，而 `width*height*4` 恰好整除时
 *   `assertImage` 会放行 —— 所以这里必须挡在最前面）
 */
function containFit(img, targetW, targetH) {
  assertImage(img);
  if (!Number.isInteger(targetW) || !Number.isInteger(targetH) || targetW <= 0 || targetH <= 0) {
    throw new TypeError(`目标尺寸非法：${targetW}x${targetH}（必须是正整数）`);
  }
  const s = fitSize(img.width, img.height, targetW, targetH);
  const scaled = resizeNearest(img, s.width, s.height);
  const out = Buffer.alloc(targetW * targetH * 4);
  const offX = Math.round((targetW - s.width) / 2);
  const offY = Math.round((targetH - s.height) / 2);
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
 * @returns {{img: object, art: {removeBg: object|null, trimmed: object|null, output: {width:number,height:number}, warning: string|null}}}
 *   `art.output` **永远**是**最终画布尺寸**（跑完裁边/contain-fit 之后的那张画布）；没给任何几何 flag 时
 *   就等于原图尺寸 —— 调用方不必为 `null` 写分支（想知道「几何有没有变」看 `trimmed` 或对照源图宽高）。
 * @throws {Error & {code?: string}} `BACKGROUND_AMBIGUOUS` / `ART_FULLY_TRANSPARENT`；非法 tolerance 或非法 `--remove-bg` → `TypeError`
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
      try {
        key = parseColor(keyColor);
      } catch {
        // `parseColor` 对直调者保持原语义（裸 Error + 英文消息）；命令层需要的是**用法错**分类 →
        // 这里转成中文 TypeError（否则会被归到「Node 侧管线意外失败」）。
        throw new TypeError(`--remove-bg 只接受 auto 或 #RRGGBB，收到 ${String(removeBg)}`);
      }
    }
    const keyed = keyOutPixels(cur.data, cur.width, cur.height, { key, tolerance });
    if (keyed.nearFraction < MIN_KEY_HIT_FRACTION) {
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

  if (fit && fit.width > 0 && fit.height > 0) {
    cur = containFit(cur, fit.width, fit.height);
  }

  // `output` 与 `trimmed` 正交：**永远**报**最终**画布（裁边后没给 --fit 也要报、什么都没动也要报
  // 原图尺寸）—— 调用方不必为「有没有给 flag」写 null 分支（F11 / R384④）。
  const output = { width: cur.width, height: cur.height };

  return { img: cur, art: { removeBg: removeInfo, trimmed, output, warning } };
}

module.exports = {
  parseColor, colorDistance, keyOutPixels, trimBounds, fitSize,
  inferBackground, cropImage, resizeNearest, containFit, normalizeArt,
};
