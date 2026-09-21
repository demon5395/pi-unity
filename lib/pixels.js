'use strict';

const fs = require('node:fs');
const { ok, fail } = require('./envelope.js');
const { parseHexColor, maxChannelDistance, formatHex } = require('./color.js');
const { decodePng, pixelAt, averageColor, countColor } = require('./png.js');

/** 解析 `x,y`（n=2）或 `x,y,w,h`（n=4）——只接受十进制整数；非法返回 `null`。 */
function parsePair(text, n) {
  if (typeof text !== 'string') return null;
  const parts = text.split(',');
  if (parts.length !== n) return null;
  const nums = parts.map((p) => (/^-?\d+$/.test(p.trim()) ? Number(p.trim()) : NaN));
  return nums.every(Number.isInteger) ? nums : null;
}

/** `--tolerance`：缺省 0；非字符串或非负整数返回 `null`（调用方落 BAD_TOLERANCE）。 */
function parseTolerance(raw) {
  if (raw === undefined) return 0;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * `unity pixels`：读 PNG 做**可断言的像素判定**（M2 的第一条验收靠它）。
 *
 * 为什么不设 `verified`：这是**读**命令，没有 intent 与 actual 的「写后比对」（全局约束 15）。
 * 判定结论放在 `actual.match`（给了 `--expect` 时才有），退出码由 `exitCodeFor` 统一给出。
 *
 * 用法错的边界（都是 argv 形状问题 → 退出码 2）：缺 `--file`、`--at`/`--region` 格式或范围非法、
 * `--expect` 没有可比较的取样点、`--tolerance` 非非负整数、颜色值非法、`--diff` 空串/非字符串。
 * **纯语法类用法错只由 argv 决定，在读盘之前判定**（否则退出码会随文件是否可读漂移，
 * 违反全局约束 16）；范围类用法错需要图片宽高，只能落在读盘之后（`BAD_AT`/`BAD_REGION`，
 * 以及 `--diff` 的 `DIFF_SIZE_MISMATCH` 都属后者）。
 * 运行时错的边界（退出码 1）：文件读不了、PNG 不支持/损坏（`--diff` 的第二张图同样如此）。
 *
 * `--diff` 只报「变没变」（`actual.diff`），**不置** `actual.match` —— `match` 只属 `--expect`，
 * `exitCodeFor` 也只认 `actual.match === false`（否则改图差异会悄悄把退出码从 0 拉成 1）。
 *
 * @param {{file?: string, at?: string, region?: string, expect?: string, tolerance?: string,
 *   countColor?: string, diff?: string, centroid?: string, bbox?: string,
 *   _readFile?: (p: string) => Buffer}} [opts]
 * @returns {Promise<object>} 信封（`ok:true` 时 `actual` 有 `width`/`height`/`match` 及命中的采样字段）
 */
async function pixels({ file, at, region, expect, tolerance, countColor: countHex, diff, centroid, bbox, _readFile } = {}) {
  if (typeof file !== 'string' || file === '') {
    return fail({
      code: 'MISSING_FILE',
      message: '缺少 --file（PNG 路径）',
      actual: { file },
      hint: ['用法：unity pixels --file C:/shots/x.png --at 100,50 --expect \'#FF2E88\''],
    });
  }
  const tol = parseTolerance(tolerance);
  if (tol === null) {
    return fail({
      code: 'BAD_TOLERANCE',
      message: `--tolerance 需要非负整数，收到 ${JSON.stringify(tolerance)}`,
      actual: { tolerance },
      hint: ['用法：--tolerance 16'],
    });
  }

  // ── 第一段：纯 argv 语法校验（只用 argv、不碰文件）─────────────────────────
  // 必须排在读盘之前：否则同一个 argv 形状错的退出码会随文件是否可读漂移
  // （文件不存在落 FILE_NOT_FOUND(1)、文件存在落 BAD_AT(2)），违反全局约束 16「2 = 用法错」。
  const countColorValue = countHex === undefined ? undefined : parseHexColor(countHex);
  if (countHex !== undefined && !countColorValue) {
    return fail({
      code: 'BAD_COLOR',
      message: `--count-color 需要 #RGB/#RRGGBB/#RRGGBBAA，收到 ${JSON.stringify(countHex)}`,
      actual: { countColor: countHex },
      hint: ['用法：--count-color \'#FF2E88\''],
    });
  }
  const atPair = at === undefined ? undefined : parsePair(at, 2);
  if (at !== undefined && !atPair) {
    return fail({
      code: 'BAD_AT',
      message: `--at 需要 x,y（十进制整数），收到 ${JSON.stringify(at)}`,
      actual: { at },
      hint: ['用法：--at 446,177'],
    });
  }
  const regionQuad = region === undefined ? undefined : parsePair(region, 4);
  if (region !== undefined && !regionQuad) {
    return fail({
      code: 'BAD_REGION',
      message: `--region 需要 x,y,w,h（十进制整数），收到 ${JSON.stringify(region)}`,
      actual: { region },
      hint: ['用法：--region 400,150,100,50'],
    });
  }
  const want = expect === undefined ? undefined : parseHexColor(expect);
  if (expect !== undefined && !want) {
    return fail({
      code: 'BAD_EXPECT',
      message: `--expect 需要 #RGB/#RRGGBB/#RRGGBBAA，收到 ${JSON.stringify(expect)}`,
      actual: { expect },
      hint: ['用法：--expect \'#FF2E88\''],
    });
  }
  if (expect !== undefined && at === undefined && region === undefined) {
    return fail({
      code: 'BAD_EXPECT',
      message: '--expect 必须配合 --at 或 --region（否则没有可比较的取样点）',
      actual: { expect },
      hint: ['用法：--at 446,177 --expect \'#314D79\'（--region 时比较的是区域平均色）'],
    });
  }
  if (diff !== undefined && (typeof diff !== 'string' || diff === '')) {
    return fail({
      code: 'BAD_SOURCE',
      message: `--diff 需要另一张 PNG 的路径，收到 ${JSON.stringify(diff)}`,
      actual: { diff },
      hint: ['用法：--diff C:/shots/b.png'],
    });
  }
  const centroidValue = centroid === undefined ? undefined : parseHexColor(centroid);
  if (centroid !== undefined && !centroidValue) {
    return fail({
      code: 'BAD_COLOR',
      message: `--centroid 需要 #RGB/#RRGGBB/#RRGGBBAA，收到 ${JSON.stringify(centroid)}`,
      actual: { centroid },
      hint: ["用法：--centroid '#FFFFFF'"],
    });
  }
  const bboxValue = bbox === undefined ? undefined : parseHexColor(bbox);
  if (bbox !== undefined && !bboxValue) {
    return fail({
      code: 'BAD_COLOR',
      message: `--bbox 需要 #RGB/#RRGGBB/#RRGGBBAA，收到 ${JSON.stringify(bbox)}`,
      actual: { bbox },
      hint: ["用法：--bbox '#FFFFFF'"],
    });
  }

  // ── 第二段：读盘 + 解码（运行时错 → 退出码 1）──────────────────────────────
  let buf;
  try {
    buf = await (_readFile || ((p) => fs.readFileSync(p)))(file);
  } catch (err) {
    return fail({
      code: 'FILE_NOT_FOUND',
      message: `读不了 PNG：${(err && err.message) || String(err)}`,
      actual: { file },
      hint: ['用 `unity shot` 的返回信封里的 actual.path 作为 --file（不要 ls -t 猜最新图）'],
    });
  }
  let img;
  try {
    img = decodePng(buf);
  } catch (err) {
    return fail({
      code: 'BAD_PNG',
      message: `PNG 解码失败：${(err && err.message) || String(err)}`,
      actual: { file, bytes: Buffer.isBuffer(buf) ? buf.length : null },
      hint: ['只支持 bitDepth 8 / colorType 0,2,4,6 / 非交织的 PNG（Unity 截图实测就是这个形态）'],
    });
  }

  const actual = { file, width: img.width, height: img.height, match: null };
  const hint = [];

  if (countHex !== undefined) {
    const n = countColor(img, countColorValue, { tolerance: tol });
    actual.count = { color: formatHex(countColorValue), count: n, ratio: n / (img.width * img.height), tolerance: tol };
    if (n === 0) hint.push(`画面里一个 ${formatHex(countColorValue)} 像素都没有 —— 该颜色可能没被渲染出来，或容差太小`);
  }

  if (at !== undefined) {
    const [x, y] = atPair;
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) {
      return fail({
        code: 'BAD_AT',
        message: `--at ${at} 越界（图 ${img.width}x${img.height}）`,
        actual: { at, width: img.width, height: img.height },
        hint: ['坐标是**图片像素**、左上原点；用 `unity shot` 返回的 width/height 校验'],
      });
    }
    actual.at = { x, y, color: pixelAt(img, x, y) };
  }

  if (region !== undefined) {
    const [x, y, w, h] = regionQuad;
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > img.width || y + h > img.height) {
      return fail({
        code: 'BAD_REGION',
        message: `--region ${region} 无效或越界（图 ${img.width}x${img.height}，要求 w>0 且 h>0 且完全在图内）`,
        actual: { region, width: img.width, height: img.height },
        hint: ['用法：--region 400,150,100,50'],
      });
    }
    actual.region = { x, y, width: w, height: h, color: averageColor(img, { x, y, width: w, height: h }) };
  }

  if (expect !== undefined) {
    // 第一段已保证「给了 --expect 就必有 --at/--region」，越界的 at/region 也在上面提前返回
    const sampled = actual.at ? actual.at.color : actual.region.color;
    actual.expected = formatHex(want);
    actual.tolerance = tol;
    actual.distance = maxChannelDistance(sampled, want);
    actual.match = actual.distance <= tol;
    if (!actual.match) {
      hint.push(`取样值 ${formatHex(sampled)} 与期望 ${formatHex(want)} 的最大通道差 ${actual.distance} > 容差 ${tol}`);
    }
  }

  if (diff !== undefined) {
    let buf2;
    try {
      buf2 = await (_readFile || ((p) => fs.readFileSync(p)))(diff);
    } catch (err) {
      return fail({
        code: 'FILE_NOT_FOUND',
        message: `读不了 --diff 的 PNG：${(err && err.message) || String(err)}`,
        actual: { file, diff },
        hint: ['--diff 的值也要是宿主上的 PNG 路径'],
      });
    }
    let img2;
    try {
      img2 = decodePng(buf2);
    } catch (err) {
      return fail({
        code: 'BAD_PNG',
        message: `--diff 的 PNG 解码失败：${(err && err.message) || String(err)}`,
        actual: { file, diff, bytes: Buffer.isBuffer(buf2) ? buf2.length : null },
        hint: ['只支持 bitDepth 8 / colorType 0,2,4,6 / 非交织的 PNG'],
      });
    }
    // 尺寸必须相等才能逐像素对账。宽高只有解码后才知道 → 属「范围类用法错」，
    // 按既有 BAD_AT/BAD_REGION 的先例（本文件顶部注释已声明该例外）归 2 档。
    if (img2.width !== img.width || img2.height !== img.height) {
      return fail({
        code: 'DIFF_SIZE_MISMATCH',
        message: `--diff 的两张图尺寸不等：${img.width}x${img.height} vs ${img2.width}x${img2.height}`,
        actual: { file, diff, a: { width: img.width, height: img.height }, b: { width: img2.width, height: img2.height } },
        hint: ['两张图必须同尺寸（同一 Game 窗口、同一 --capture-mode 下截取）'],
      });
    }
    let changed = 0;
    let maxDist = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const d = maxChannelDistance(
        { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2], a: 255 },
        { r: img2.data[i], g: img2.data[i + 1], b: img2.data[i + 2], a: 255 },
      );
      if (d > maxDist) maxDist = d;
      if (d > tol) changed++;
    }
    const total = img.width * img.height;
    actual.diff = {
      file, other: diff, width: img.width, height: img.height,
      changed, total, ratio: changed / total, maxChannelDistance: maxDist, tolerance: tol,
    };
    if (changed === 0) hint.push('两张图在容差内完全一致');
  }

  if (centroidValue !== undefined) {
    let count = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const o = (y * img.width + x) * 4;
        const d = maxChannelDistance(
          { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2], a: 255 },
          centroidValue,
        );
        if (d <= tol) { count++; sx += x; sy += y; }
      }
    }
    actual.centroid = {
      color: formatHex(centroidValue), count,
      x: count ? sx / count : null, y: count ? sy / count : null, tolerance: tol,
    };
    if (count === 0) hint.push(`画面里一个 ${formatHex(centroidValue)} 像素都没有 —— 质心无从谈起（该颜色可能没被渲染出来，或容差太小）`);
  }

  if (bboxValue !== undefined) {
    let count = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const o = (y * img.width + x) * 4;
        const d = maxChannelDistance(
          { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2], a: 255 },
          bboxValue,
        );
        if (d <= tol) {
          count++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    actual.bbox = count === 0
      ? { color: formatHex(bboxValue), count: 0, x: null, y: null, width: 0, height: 0, tolerance: tol }
      : { color: formatHex(bboxValue), count, x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, tolerance: tol };
    if (count === 0) hint.push(`画面里一个 ${formatHex(bboxValue)} 像素都没有 —— 包围盒为空（该颜色可能没被渲染出来，或容差太小）`);
  }

  return ok(actual, { hint });
}

module.exports = { pixels, parsePair, parseTolerance };
