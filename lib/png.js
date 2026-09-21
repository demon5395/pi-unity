'use strict';

const zlib = require('node:zlib');

/**
 * 最小 PNG 解码器（零依赖，只用 `node:zlib`）。
 *
 * 支持面（**实测需要的最小面**）：bitDepth 8、colorType 0/2/4/6、interlace 0、**滤镜 0–4 全部**。
 * 为什么必须支持全部滤镜：真机 Unity 截图 892x355 的 355 行里出现了滤镜 1/2/4
 * （`游戏_20260919_012315_061.png`，2026-09-19 实测），只实现 filter 0 会静默产出错色。
 * **不支持的一律抛**（响亮失败）：抛出会被命令路径收敛成 `BAD_PNG`，绝不猜。
 */

/** 每通道字节数与「一个像素占几字节」的映射（bitDepth 固定 8）。 */
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 解析 PNG → `{width, height, channels, data}`，`data` 是 RGBA8 的 Buffer（每像素 4 字节）。 */
function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.slice(0, 8).equals(SIGNATURE)) {
    throw new Error('不是 PNG：签名不符');
  }
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('latin1');
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (!ihdr) throw new Error('不是 PNG：缺 IHDR');
  // PNG 规范禁止 0 尺寸；放行会让 data 为空、`--count-color` 的 ratio 变成 0/0 = NaN
  if (!(ihdr.width > 0 && ihdr.height > 0)) throw new Error('不支持的 PNG：尺寸必须大于 0');
  if (ihdr.bitDepth !== 8) throw new Error(`不支持的 PNG：bitDepth=${ihdr.bitDepth}（只支持 8）`);
  if (CHANNELS[ihdr.colorType] === undefined) throw new Error(`不支持的 PNG：colorType=${ihdr.colorType}（只支持 0/2/4/6）`);
  if (ihdr.interlace !== 0) throw new Error(`不支持的 PNG：interlace=${ihdr.interlace}（只支持 0）`);
  if (idat.length === 0) throw new Error('不支持的 PNG：没有 IDAT 数据');

  const channels = CHANNELS[ihdr.colorType];
  const { width, height } = ihdr;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) {
    throw new Error(`不支持的 PNG：像素数据长度不足（${raw.length} < ${height * (stride + 1)}）`);
  }

  const data = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    if (ft > 4) throw new Error(`不支持的 PNG：第 ${y} 行的滤镜类型 ${ft}`);
    const row = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = row[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += Math.floor((a + b) / 2);
      else if (ft === 4) v += paeth(a, b, c);
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (channels >= 3) {
        data[o] = cur[x * channels];
        data[o + 1] = cur[x * channels + 1];
        data[o + 2] = cur[x * channels + 2];
        data[o + 3] = channels === 4 ? cur[x * channels + 3] : 255;
      } else {
        // colorType 0（灰）/4（灰 + alpha）：三通道取同一灰度值
        data[o] = cur[x * channels];
        data[o + 1] = cur[x * channels];
        data[o + 2] = cur[x * channels];
        data[o + 3] = channels === 2 ? cur[x * channels + 1] : 255;
      }
    }
    prev = cur;
  }
  return { width, height, channels, data };
}

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

/** 取一个像素（top-left 原点）。越界抛 `RangeError`（不静默返回黑）。 */
function pixelAt(img, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= img.width || y >= img.height) {
    throw new RangeError(`像素越界：(${x},${y}) 不在 ${img.width}x${img.height} 内`);
  }
  const o = (y * img.width + x) * 4;
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2], a: img.data[o + 3] };
}

/** 区域平均色（四舍五入到整数）。区域越界抛 `RangeError`。 */
function averageColor(img, { x, y, width, height }) {
  if (![x, y, width, height].every(Number.isInteger) || width <= 0 || height <= 0
    || x < 0 || y < 0 || x + width > img.width || y + height > img.height) {
    throw new RangeError(`区域越界：${x},${y},${width},${height} 不在 ${img.width}x${img.height} 内`);
  }
  let r = 0; let g = 0; let b = 0; let a = 0;
  for (let yy = y; yy < y + height; yy++) {
    for (let xx = x; xx < x + width; xx++) {
      const o = (yy * img.width + xx) * 4;
      r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; a += img.data[o + 3];
    }
  }
  const n = width * height;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: Math.round(a / n) };
}

/** 逐通道差 <= tolerance 的像素数（只看 r/g/b；抗锯齿边缘靠 tolerance 吸收）。 */
function countColor(img, color, { tolerance = 0 } = {}) {
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (Math.abs(img.data[i] - color.r) <= tolerance
      && Math.abs(img.data[i + 1] - color.g) <= tolerance
      && Math.abs(img.data[i + 2] - color.b) <= tolerance) n++;
  }
  return n;
}

module.exports = { decodePng, encodePng, crc32, pixelAt, averageColor, countColor };
