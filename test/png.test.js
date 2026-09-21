'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { decodePng, encodePng, pixelAt, averageColor, countColor } = require('../lib/png.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'unity-gameview-892x355.png');

test('decodePng 解出真实 Unity 截图（IHDR 892x355 / colorType 2 / bitDepth 8）', () => {
  const img = decodePng(fs.readFileSync(FIXTURE));
  assert.strictEqual(img.width, 892);
  assert.strictEqual(img.height, 355);
  assert.strictEqual(img.channels, 3);
  assert.strictEqual(img.data.length, 892 * 355 * 4);
});

test('pixelAt 的已知取值（滤镜 1/2/4 都被真实数据覆盖）', () => {
  const img = decodePng(fs.readFileSync(FIXTURE));
  assert.deepStrictEqual(pixelAt(img, 446, 177), { r: 49, g: 77, b: 121, a: 255 }); // 相机 SolidColor 背景
  assert.deepStrictEqual(pixelAt(img, 1, 1), { r: 60, g: 60, b: 60, a: 255 });      // Game 视图工具栏灰
  assert.deepStrictEqual(pixelAt(img, 880, 350), { r: 39, g: 39, b: 39, a: 255 });
});

test('averageColor 对纯色区域取平均', () => {
  const img = decodePng(fs.readFileSync(FIXTURE));
  assert.deepStrictEqual(averageColor(img, { x: 400, y: 150, width: 100, height: 50 }), { r: 49, g: 77, b: 121, a: 255 });
  assert.deepStrictEqual(averageColor(img, { x: 0, y: 0, width: 20, height: 10 }), { r: 59, g: 59, b: 59, a: 255 });
});

test('countColor 精确计数（tol 0 与 tol 8 在这张图上相同）', () => {
  const img = decodePng(fs.readFileSync(FIXTURE));
  assert.strictEqual(countColor(img, { r: 49, g: 77, b: 121 }, { tolerance: 0 }), 178356);
  assert.strictEqual(countColor(img, { r: 40, g: 40, b: 40 }, { tolerance: 0 }), 108768);
  assert.strictEqual(countColor(img, { r: 49, g: 77, b: 121 }, { tolerance: 8 }), 178356);
  assert.strictEqual(countColor(img, { r: 1, g: 2, b: 3 }, { tolerance: 0 }), 0);
});

test('pixelAt / averageColor 越界抛 RangeError（不静默返回黑）', () => {
  const img = decodePng(fs.readFileSync(FIXTURE));
  assert.throws(() => pixelAt(img, 892, 0), RangeError);
  assert.throws(() => pixelAt(img, -1, 0), RangeError);
  assert.throws(() => averageColor(img, { x: 800, y: 0, width: 200, height: 10 }), RangeError);
});

test('decodePng 拒绝非 PNG / 不支持的头（响亮失败，不猜）', () => {
  assert.throws(() => decodePng(Buffer.from('not a png')), /不是 PNG/);
  // colorType 3（索引色）不在支持面内 → 必须抛，不许瞎解
  const bad = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080300000000', 'hex');
  assert.throws(() => decodePng(bad), /不支持/);
});

test('decodePng 能解自造的 RGBA 小图（colorType 6；滤镜 0/3/4，含 Average 与 Paeth）', () => {
  // 4x3 图：每行分别用 3 种滤镜；像素刻意选成可预测的渐变
  const img = decodePng(makePng({ width: 4, height: 3, colorType: 6, filters: [0, 3, 4] }));
  assert.strictEqual(img.width, 4);
  assert.strictEqual(img.channels, 4);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 4; x++) {
      assert.deepStrictEqual(
        pixelAt(img, x, y),
        { r: 10 * x + 1, g: 20 * x + 2, b: 30 * x + 3, a: 40 * x + 4 },
        `(${x},${y}) 在 filter=${[0, 3, 4][y]} 下解错`,
      );
    }
  }
  // 反向自检：这些字节确实用到了 filter 3 / 4（否则上面的覆盖是假的）
  const filters = [...new Set([...zlib.inflateSync(collectIdat(makePng({ width: 4, height: 3, colorType: 6, filters: [0, 3, 4] })))]
    .filter((_, i, arr) => i % (4 * 4 + 1) === 0))];
  assert.deepStrictEqual(filters, [0, 3, 4]);
});

// 约束 23 要求支持 colorType 0/2/4/6；上面两条自造图 + 真实 fixture 只覆盖 2/6，
// 下面两条把解码器里 `channels >= 3 ? ... : ...` 的 else 分支（灰 / 灰+alpha）钉住。
test('decodePng 解自造 colorType 0（8bit 灰阶，1 通道）：三通道同灰度值、alpha 恒 255', () => {
  const img = decodePng(makePng({ width: 4, height: 3, colorType: 0, filters: [0, 1, 2] }));
  assert.strictEqual(img.channels, 1);
  assert.strictEqual(img.data.length, 4 * 3 * 4, 'data 统一是 RGBA8，每像素 4 字节');
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 4; x++) {
      const gray = 10 * x + 1;
      assert.deepStrictEqual(
        pixelAt(img, x, y),
        { r: gray, g: gray, b: gray, a: 255 },
        `(${x},${y}) 在 filter=${[0, 1, 2][y]} 下解错`,
      );
    }
  }
});

test('decodePng 解自造 colorType 4（8bit 灰阶+alpha，2 通道）：灰度三通道同值、a 取源 alpha', () => {
  const img = decodePng(makePng({ width: 4, height: 3, colorType: 4, filters: [0, 1, 2] }));
  assert.strictEqual(img.channels, 2);
  assert.strictEqual(img.data.length, 4 * 3 * 4);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 4; x++) {
      const gray = 10 * x + 1;
      assert.deepStrictEqual(
        pixelAt(img, x, y),
        { r: gray, g: gray, b: gray, a: 40 * x + 4 },
        `(${x},${y}) 在 filter=${[0, 1, 2][y]} 下解错`,
      );
    }
  }
});

// 约束 23「不支持就响亮抛」：下面 5 条 guard 的实现分支各由表里一行钉住
// （暂停任一 guard，对应行立刻变红）。补丁都打在**测试本地编码器**的产物上，不 import 解码器内部函数。
test('decodePng 对不支持/损坏的 PNG 响亮抛错（bitDepth/交织/缺 IDAT/长度不足/滤镜越界，表驱动）', () => {
  const base = makePng({ width: 4, height: 3, colorType: 6, filters: [0, 1, 2] });
  const patchByte = (offset, value) => { const copy = Buffer.from(base); copy[offset] = value; return copy; };
  const raw = zlib.inflateSync(collectIdat(base));
  const badFilter = Buffer.from(raw);
  badFilter[0] = 9;
  const cases = [
    ['bitDepth=16', patchByte(24, 16)],                        // IHDR 的第 8 字节
    ['interlace=1', patchByte(28, 1)],                         // IHDR 的第 12 字节
    ['缺 IDAT', dropIdat(base)],
    ['解压后长度不足', replaceIdat(base, raw.slice(0, raw.length - 8))],
    ['首行滤镜字节=9', replaceIdat(base, badFilter)],
  ];
  for (const [name, buf] of cases) {
    assert.throws(() => decodePng(buf), /不支持|不是 PNG/, `${name} 必须响亮抛错（不许静默产出错色）`);
  }
});

test('decodePng 拒绝零尺寸 PNG（PNG 规范禁止 width/height 为 0，否则 ratio 会变 NaN）', () => {
  const base = makePng({ width: 4, height: 3, colorType: 6, filters: [0, 1, 2] });
  const zeroWidth = Buffer.from(base);
  zeroWidth.writeUInt32BE(0, 16);
  assert.throws(() => decodePng(zeroWidth), /不支持/);
  const zeroHeight = Buffer.from(base);
  zeroHeight.writeUInt32BE(0, 20);
  assert.throws(() => decodePng(zeroHeight), /不支持/);
});

// ── 测试自带的 PNG 编码器（只用于造 filter 用例；与被测解码器**不共享任何代码**）──
function collectIdat(buf) {
  const parts = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('latin1');
    if (type === 'IDAT') parts.push(buf.slice(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

/** 去掉 PNG 里所有 IDAT chunk（其余原样）—— 打「缺 IDAT」补丁用。 */
function dropIdat(png) {
  const parts = [png.slice(0, 8)];
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.slice(off + 4, off + 8).toString('latin1');
    if (type !== 'IDAT') parts.push(png.slice(off, off + 12 + len));
    off += 12 + len;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

/** 用给定的（未压缩）像素数据替换 IDAT —— 打「解压后长度不足 / 滤镜字节非法」补丁用。 */
function replaceIdat(png, raw) {
  const idat = chunk('IDAT', zlib.deflateSync(raw));
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.slice(off + 4, off + 8).toString('latin1');
    if (type === 'IDAT') return Buffer.concat([png.slice(0, off), idat, png.slice(off + 12 + len)]);
    off += 12 + len;
  }
  throw new Error('测试造图有误：找不到 IDAT');
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.slice(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** colorType → 每像素通道数（**独立复写**，不 import 被测解码器的映射）。 */
const CH_BY_COLOR_TYPE = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** 自造图的源像素：按 colorType 给出可预测的 8bit 渐变（值域远小于 256）。 */
function pixelFor(colorType, x) {
  if (colorType === 0) return [10 * x + 1];                             // 灰
  if (colorType === 4) return [10 * x + 1, 40 * x + 4];                 // 灰 + alpha
  if (colorType === 2) return [10 * x + 1, 20 * x + 2, 30 * x + 3];     // RGB
  return [10 * x + 1, 20 * x + 2, 30 * x + 3, 40 * x + 4];             // RGBA
}

/** 造一张 width×height、8bit、指定 colorType(0/2/4/6) 与每行滤镜的合法 PNG。 */
function makePng({ width, height, colorType, filters }) {
  const ch = CH_BY_COLOR_TYPE[colorType];
  const raw = Buffer.alloc(height * (width * ch + 1));
  let prev = Buffer.alloc(width * ch);
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * ch);
    for (let x = 0; x < width; x++) {
      const px = pixelFor(colorType, x);
      for (let c = 0; c < ch; c++) row[x * ch + c] = px[c];
    }
    const ft = filters[y % filters.length];
    const base = y * (width * ch + 1);
    raw[base] = ft;
    for (let i = 0; i < row.length; i++) {
      const a = i >= ch ? row[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = row[i];
      if (ft === 1) v -= a;
      else if (ft === 2) v -= b;
      else if (ft === 3) v -= Math.floor((a + b) / 2);
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v -= (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      raw[base + 1 + i] = v & 255;
    }
    prev = row;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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
  const { encodePng, crc32: libCrc32 } = require('../lib/png.js');
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
  // 走完每个 chunk，逐块断言 CRC 覆盖「类型 + 数据」，并钉死块序与总长。
  // 为什么必须逐块：IEND 的 data 为空 → crc32("IEND") 与 crc32("IEND"+空) **恒等**，
  // 所以最后 4 字节的常量 0xAE426082 抓不住「CRC 只喂类型、不喂数据」这类回归
  // （IHDR/IDAT 的 CRC 会全错，落盘产物被 Unity/PIL 拒绝，而用例仍绿）。
  // 覆盖范围用两个独立实现交叉核对：被测模块的 crc32（由 0xCBF43926 向量独立钉住）
  // + 本文件底部自带的独立实现（不 import 被测代码）。
  const chunks = [];
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.slice(off + 4, off + 8).toString('latin1');
    const body = png.slice(off + 4, off + 8 + len);           // 类型 + 数据 = CRC 的覆盖范围
    const stored = png.readUInt32BE(off + 8 + len);
    assert.strictEqual(stored, libCrc32(body), `${type} 的 CRC 必须覆盖「类型 + 数据」（不只类型）`);
    assert.strictEqual(stored, crc32(body), `${type} 的 CRC 与独立实现不一致（覆盖范围/多项式）`);
    chunks.push({ type, data: png.slice(off + 8, off + 8 + len) });
    off += 12 + len;                                           // len(4) + type(4) + data + crc(4)
  }
  assert.strictEqual(off, png.length, 'chunk 走完后必须恰好落在 PNG 末尾（不多不少）');
  assert.deepStrictEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND'], '块序必须是 IHDR → IDAT → IEND');
  const idat = chunks.find((c) => c.type === 'IDAT').data;
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
  // 长度**恰好**等于 width*height*4 的字符串：一旦 isBytes 守卫被删/放宽，
  // 它会走进 Buffer.from(data) 把 ASCII 当像素静默编码成 PNG。
  // （用 'not a buffer' 则长度 13 != 16，会因「data 长度不符」抛错而假绿 —— /data/ 也匹配。）
  assert.throws(() => encodePng({ width: 2, height: 2, data: 'x'.repeat(16) }), /必须是 Buffer/);
});
