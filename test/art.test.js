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
  // F3：命中率只看**可见**（a !== 0）像素 —— 本来就透明的 key 色像素不算命中
  // （否则命中率虚高，会掩盖「背景色给错了」的告警：全透明像素能凑出一半的分子）
  const holed = rgba(2, 1, (x) => (x === 0 ? [0, 255, 0, 0] : [255, 0, 0, 255]));
  const resHoled = art.keyOutPixels(holed.data, 2, 1, { key: { r: 0, g: 255, b: 0 }, tolerance: 20 });
  assert.strictEqual(resHoled.nearFraction, 0, '透明像素不能算命中');
});

test('keyOutPixels 羽化带削弱 alpha 并 de-spill 主导通道', () => {
  const img = rgba(1, 1, () => [60, 200, 0, 200]);
  const res = art.keyOutPixels(img.data, 1, 1, { key: { r: 0, g: 255, b: 0 }, tolerance: 40 });
  // 精确值（不是区间）：d = max(|60-0|, |200-255|, |0-0|) = 60 → f = (60-40)/40 = 0.5 →
  // a = round(200*0.5) = 100；de-spill 把主导通道 g 压到 max(r,b) = 60
  assert.strictEqual(img.data[1], 60, `de-spill 后绿通道应为 60，实际 ${img.data[1]}`);
  assert.strictEqual(img.data[3], 100, `羽化后 alpha 应为 100，实际 ${img.data[3]}`);
  assert.strictEqual(res.changed, true);
  // F1：d == 2*tol（f = 1 → alpha **不变**）时，de-spill 仍改写了 RGB → changed 必须为 true
  const edge = rgba(1, 1, () => [0, 215, 0, 255]);
  const resEdge = art.keyOutPixels(edge.data, 1, 1, { key: { r: 0, g: 255, b: 0 }, tolerance: 20 });
  assert.deepStrictEqual([...edge.data], [0, 0, 0, 255], 'RGB 应被 de-spill 改写');
  assert.strictEqual(resEdge.changed, true, '只有 RGB 变化时 changed 也必须为 true');
});

test('trimBounds 取 alpha>threshold 的包围盒；全透明返回 null', () => {
  const img = rgba(4, 4, (x, y) => (x >= 1 && x <= 2 && y === 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
  assert.deepStrictEqual(art.trimBounds(img.data, 4, 4, 0), { left: 1, top: 2, right: 2, bottom: 2, width: 2, height: 1 });
  assert.strictEqual(art.trimBounds(Buffer.alloc(4 * 4 * 4), 4, 4, 0), null);
  // F5：threshold 非法要响亮抛（非 number 静默当 0、NaN 让比较恒假 → 静默宣称「全透明」）
  assert.throws(() => art.trimBounds(img.data, 4, 4, NaN), TypeError);
  assert.throws(() => art.trimBounds(img.data, 4, 4, '0'), TypeError);
  assert.throws(() => art.trimBounds(img.data, 4, 4, 1.5), TypeError);
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
  // F7：Uint8Array（assertImage 白名单内的形状）也要能裁 —— 不能用 Buffer.prototype.copy
  const outBytes = art.cropImage(
    { width: 3, height: 2, data: new Uint8Array(img.data) },
    { left: 1, top: 0, width: 2, height: 2 },
  );
  assert.deepStrictEqual(px(outBytes, 0, 0), [10, 0, 0, 255]);
  assert.deepStrictEqual(px(outBytes, 1, 1), [20, 10, 0, 255]);
});

test('resizeNearest 是最近邻（整数放大小块不插值），且 2x1 → 4x1 每个像素复制 2 份', () => {
  const img = rgba(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
  const out = art.resizeNearest(img, 4, 1);
  // 用 b+a 作判据：红 = 0+255 = 255、蓝 = 255+255 = 510 → [红,红,蓝,蓝] 正好证明「不插值 + 每个像素复制 2 份」
  //（简报原文是 `[0] + [2]`，两者在本 fixture 上都是 255，永远凑不出期望的 510 —— 见 report 偏离②）
  assert.deepStrictEqual([0, 1, 2, 3].map((x) => px(out, x, 0)[2] + px(out, x, 0)[3]), [255, 255, 510, 510]);
});

test('containFit：输出画布恰好是目标尺寸，图按比例居中，空白处全透明', () => {
  const img = rgba(2, 1, () => [255, 0, 0, 255]);
  const out = art.containFit(img, 2, 2);          // 2x1 → 放进 2x2 → 上下各留 0.5 行
  assert.strictEqual(out.width, 2);
  assert.strictEqual(out.height, 2);
  assert.deepStrictEqual(px(out, 0, 0), [0, 0, 0, 0]);
  assert.deepStrictEqual(px(out, 0, 1), [255, 0, 0, 255]);
  // F4：目标尺寸必须是正整数（小数目标会产出 width*height*4 恰好整除的畸形图，而 assertImage 会放行）
  assert.throws(() => art.containFit(img, 2.5, 2.5), TypeError);
  assert.throws(() => art.containFit(img, 0, 2), TypeError);
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

test('normalizeArt：去底后全透明 → 抛 ART_FULLY_TRANSPARENT', () => {
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

test('normalizeArt：不传 removeBg/trim/fit → 原图原样', () => {
  const img = rgba(3, 1, (x) => [x, x, x, 255]);
  const before = Buffer.from(img.data);          // 调用前的副本：无 flag 时 `r.img === img`，自比较恒真（F8）
  const r = art.normalizeArt(img, { tolerance: 40, trim: false, fit: null });
  assert.deepStrictEqual([...r.img.data], [...before]);
  assert.strictEqual(r.art.removeBg, null);
  assert.strictEqual(r.art.trimmed, null);
  // F11：output 永远是最终画布尺寸（什么都没给 → 原图尺寸，不是 null）
  assert.deepStrictEqual(r.art.output, { width: 3, height: 1 });
});

test('normalizeArt：四角全透明 + --remove-bg auto → 抛 BACKGROUND_AMBIGUOUS（不把主体羽化掉）', () => {
  // 图本来就带透明背景：四角 a=0（RGB=0）→ 若当成 key #000000 去羽化，
  // 不透明主体 [30,30,60,255] 会被削成半透明，且 nearFraction 远高于告警阈值 → 不告警（F2）
  const img = rgba(4, 4, (x, y) => {
    const corner = (x === 0 || x === 3) && (y === 0 || y === 3);
    return corner ? [0, 0, 0, 0] : [30, 30, 60, 255];
  });
  let err = null;
  try { art.normalizeArt(img, { removeBg: 'auto', tolerance: 40, trim: true, fit: null }); } catch (e) { err = e; }
  assert.ok(err, '必须抛');
  assert.strictEqual(err.code, 'BACKGROUND_AMBIGUOUS');
  assert.strictEqual(err.detail.reason, 'transparent-corners');
  assert.deepStrictEqual(px(img, 1, 1), [30, 30, 60, 255], '主体像素不许被改写');
});

test('normalizeArt 的输出能被 lib/png.js 编码 → 解码后逐字节一致（跨模块闭环）', () => {
  const img = rgba(4, 4, (x, y) => (x < 2 ? [0, 255, 0, 255] : [12, 34, 56, 255]));
  const r = art.normalizeArt(img, { removeBg: '#00FF00', tolerance: 10, trim: true, fit: { width: 4, height: 4 } });
  const back = decodePng(encodePng(r.img));
  assert.deepStrictEqual([...back.data], [...r.img.data]);
});

test('inferBackground / normalizeArt / keyOutPixels：非法 tolerance 与非法 --remove-bg → TypeError（不静默）', () => {
  const img = rgba(2, 2, () => [0, 255, 0, 255]);
  assert.throws(() => art.inferBackground(img, { tolerance: NaN }), TypeError);
  assert.throws(() => art.normalizeArt(img, { tolerance: -1 }), TypeError);
  assert.throws(() => art.normalizeArt(img, { tolerance: 1.5 }), TypeError);
  // F6：keyOutPixels 也要有入口守卫（NaN 让 d<=tol 恒假 → 静默 no-op）
  assert.throws(() => art.keyOutPixels(img.data, 2, 2, { key: { r: 0, g: 255, b: 0 }, tolerance: NaN }), TypeError);
  // F13：非法 --remove-bg 转成中文 TypeError（而不是 parseColor 的无 code 裸 Error → 会被归类成内部错）
  assert.throws(() => art.normalizeArt(img, { removeBg: 'nope', tolerance: 8 }), TypeError);
});
