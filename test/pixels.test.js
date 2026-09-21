'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pixels } = require('../lib/pixels.js');
const { encodePng } = require('../lib/png.js');
const { exitCodeFor } = require('../lib/envelope.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'unity-gameview-892x355.png');
// 注：变量名必须是 `_readFile`（与 pixels() 的注入形参同名）—— 简报原文写作 `readFile`，
// 但所有调用点都用 `{ ..., _readFile }` 简写，照抄会 `ReferenceError`（8 条用例）。
const _readFile = (p) => fs.readFileSync(p);

// ── 造图 helper（扫描裁定 #2）────────────────────────────────────────────────
// `encodePng` 返回的是**编码后的 PNG**（以 8 字节签名开头）——直接对它做 `buf[0]=…` 会破坏
// 签名让 `decodePng` 抛，改 `img[o]` 又改不到像素。所以必须**先改 raw、最后才 encode**。
/** 造 raw RGBA8 像素缓冲（width*height*4），每像素填同一个 `rgba`。 */
function rawPixels(width, height, rgba) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return data;
}
/** raw → PNG Buffer。 */
function encode(raw, width, height) {
  return encodePng({ width, height, data: raw });
}
/** 改 raw 的某个像素。 */
function setPixel(raw, width, x, y, rgba) {
  raw.set(rgba, (y * width + x) * 4);
}

test('pixels 缺 --file → MISSING_FILE（用法错，退出码 2），一次都不读盘', async () => {
  let reads = 0;
  const e = await pixels({ _readFile: () => { reads++; return Buffer.alloc(0); } });
  assert.strictEqual(e.code, 'MISSING_FILE');
  assert.strictEqual(reads, 0);
  assert.strictEqual(exitCodeFor(e), 2);
});

test('pixels 文件不存在 → FILE_NOT_FOUND（运行时错，退出码 1）', async () => {
  const e = await pixels({ file: 'C:/nope/missing.png', _readFile });
  assert.strictEqual(e.code, 'FILE_NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('用法错在读盘之前判定：坏 --at + 不存在的文件 → BAD_AT（2），不是 FILE_NOT_FOUND', async () => {
  // _readFile 抛错就是为了证明「一次都没读盘」—— 若先读盘，catch 会把它收敛成 FILE_NOT_FOUND(1)
  const e = await pixels({ file: 'C:/nope/missing.png', at: '446', _readFile: () => { throw new Error('不该读盘'); } });
  assert.strictEqual(e.code, 'BAD_AT');
  assert.strictEqual(exitCodeFor(e), 2);
});

test('pixels 非 PNG → BAD_PNG（运行时错）', async () => {
  const e = await pixels({ file: 'x.png', _readFile: () => Buffer.from('nope') });
  assert.strictEqual(e.code, 'BAD_PNG');
  assert.match(e.message, /不是 PNG/);
});

test('pixels --at 采样：ok:true / verified:null / actual.at.color', async () => {
  const e = await pixels({ file: FIXTURE, at: '446,177', _readFile });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, null, '读命令 verified 恒为 null');
  assert.strictEqual(e.actual.width, 892);
  assert.deepStrictEqual(e.actual.at, { x: 446, y: 177, color: { r: 49, g: 77, b: 121, a: 255 } });
  assert.strictEqual(e.actual.match, null);
  assert.strictEqual(exitCodeFor(e), 0);
});

test('pixels --region 取平均色', async () => {
  const e = await pixels({ file: FIXTURE, region: '400,150,100,50', _readFile });
  assert.deepStrictEqual(e.actual.region, {
    x: 400, y: 150, width: 100, height: 50, color: { r: 49, g: 77, b: 121, a: 255 },
  });
});

test('pixels --count-color 计数 + ratio（(49,77,121) 的十六进制是 #314D79）', async () => {
  const e = await pixels({ file: FIXTURE, countColor: '#314D79', _readFile });
  assert.strictEqual(e.actual.count.color, '#314D79');
  assert.strictEqual(e.actual.count.count, 178356);
  assert.ok(Math.abs(e.actual.count.ratio - 178356 / (892 * 355)) < 1e-9);
});

test('pixels --expect 命中 → match:true / 退出码 0；不命中 → match:false / 退出码 1（不产出错误码）', async () => {
  const hit = await pixels({ file: FIXTURE, at: '446,177', expect: '#314D79', tolerance: '0', _readFile });
  assert.strictEqual(hit.ok, true);
  assert.strictEqual(hit.actual.match, true);
  assert.strictEqual(exitCodeFor(hit), 0);

  const miss = await pixels({ file: FIXTURE, at: '446,177', expect: '#FF2E88', tolerance: '0', _readFile });
  assert.strictEqual(miss.ok, true, 'ok 只表示命令跑通；不匹配由 match + 退出码表达');
  assert.strictEqual(miss.actual.match, false);
  assert.strictEqual(miss.actual.expected, '#FF2E88');
  assert.strictEqual(miss.actual.tolerance, 0);
  // 最大通道差 = max(|49-255|, |77-46|, |121-136|) = 206
  assert.strictEqual(miss.actual.distance, 206);
  assert.strictEqual(exitCodeFor(miss), 1);
});

test('pixels --expect 容差内算命中', async () => {
  const e = await pixels({ file: FIXTURE, region: '400,150,100,50', expect: '#314D7A', tolerance: '4', _readFile });
  assert.strictEqual(e.actual.match, true);
});

test('pixels 用法错：BAD_AT / BAD_REGION / BAD_EXPECT / BAD_TOLERANCE / BAD_COLOR', async () => {
  for (const [opt, code] of [
    [{ at: '446' }, 'BAD_AT'],
    [{ at: '446,-1' }, 'BAD_AT'],
    [{ at: '892,0' }, 'BAD_AT'],
    [{ region: '1,2,3' }, 'BAD_REGION'],
    [{ region: '0,0,0,10' }, 'BAD_REGION'],
    [{ region: '0,0,2000,10' }, 'BAD_REGION'],
    [{ expect: '#FF2E88' }, 'BAD_EXPECT'],
    [{ at: '0,0', expect: 'nope' }, 'BAD_EXPECT'],
    [{ countColor: 'nope' }, 'BAD_COLOR'],
    [{ at: '0,0', tolerance: '-1' }, 'BAD_TOLERANCE'],
  ]) {
    const e = await pixels({ file: FIXTURE, _readFile, ...opt });
    assert.strictEqual(e.code, code, `${JSON.stringify(opt)} 应落 ${code}`);
    assert.strictEqual(exitCodeFor(e), 2);
  }
});

test('CLI pixels --expect 命中 → 0 / 不命中 → 1（含 --json 载荷）', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout: cap } = require('./helpers/capture.js'); // 见下方「测试辅助」说明
  const hit = await cap(() => main(['pixels', '--file', FIXTURE, '--at', '446,177', '--expect', '#314D79', '--json']));
  assert.strictEqual(hit.result, 0);
  assert.strictEqual(JSON.parse(hit.out).actual.match, true);
  const miss = await cap(() => main(['pixels', '--file', FIXTURE, '--at', '446,177', '--expect', '#FF2E88', '--json']));
  assert.strictEqual(miss.result, 1);
  assert.strictEqual(JSON.parse(miss.out).actual.match, false);
});

test('pixels --diff：两张图逐像素比对（changed / ratio / maxChannelDistance）', async () => {
  const rawA = rawPixels(4, 2, [255, 0, 0, 255]);
  const rawB = rawPixels(4, 2, [255, 0, 0, 255]);
  setPixel(rawB, 4, 0, 0, [0, 0, 255, 255]);          // 只改第 1 个像素为蓝
  const e = await pixels({
    file: 'A.png', diff: 'B.png',
    _readFile: (p) => (p === 'A.png' ? encode(rawA, 4, 2) : encode(rawB, 4, 2)),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.actual.diff.width, 4);
  assert.strictEqual(e.actual.diff.height, 2);
  assert.strictEqual(e.actual.diff.changed, 1);
  assert.strictEqual(e.actual.diff.ratio, 1 / 8);
  assert.strictEqual(e.actual.diff.maxChannelDistance, 255);
  assert.strictEqual(e.actual.diff.tolerance, 0);
  assert.strictEqual(e.actual.match, null, '--diff 不抢 --expect 的 match 判定权');
});

test('pixels --diff 容差：容差内不计入 changed', async () => {
  const rawA = rawPixels(2, 1, [100, 100, 100, 255]);
  const rawB = rawPixels(2, 1, [100, 100, 100, 255]);
  setPixel(rawB, 2, 0, 0, [110, 100, 100, 255]);       // 差 10
  const e = await pixels({ file: 'A.png', diff: 'B.png', tolerance: '16', _readFile: (p) => (p === 'A.png' ? encode(rawA, 2, 1) : encode(rawB, 2, 1)) });
  assert.strictEqual(e.actual.diff.changed, 0);
  assert.strictEqual(e.actual.diff.maxChannelDistance, 10);
});

test('pixels --diff 容差边界：d === tol 不计入 changed，d === tol + 1 计入', async () => {
  const run = (delta, tol) => {
    const rawA = rawPixels(1, 1, [100, 100, 100, 255]);
    const rawB = rawPixels(1, 1, [100, 100, 100, 255]);
    setPixel(rawB, 1, 0, 0, [100 + delta, 100, 100, 255]);
    return pixels({ file: 'A.png', diff: 'B.png', tolerance: String(tol), _readFile: (p) => (p === 'A.png' ? encode(rawA, 1, 1) : encode(rawB, 1, 1)) });
  };
  const atTol = await run(10, 10);
  assert.strictEqual(atTol.actual.diff.maxChannelDistance, 10);
  assert.strictEqual(atTol.actual.diff.changed, 0, 'd === tol 属容差内，不计入 changed');
  const overTol = await run(11, 10);
  assert.strictEqual(overTol.actual.diff.maxChannelDistance, 11);
  assert.strictEqual(overTol.actual.diff.changed, 1, 'd === tol + 1 必须计入 changed');
});

test('pixels --diff 尺寸不等 → DIFF_SIZE_MISMATCH（用法错 2，读盘之后判定）', async () => {
  const e = await pixels({
    file: 'A.png', diff: 'B.png',
    _readFile: (p) => (p === 'A.png' ? encode(rawPixels(4, 2, [0, 0, 0, 255]), 4, 2) : encode(rawPixels(3, 2, [0, 0, 0, 255]), 3, 2)),
  });
  assert.strictEqual(e.code, 'DIFF_SIZE_MISMATCH');
  assert.strictEqual(exitCodeFor(e), 2);
});

test('pixels --diff 的第二张图读不了 / 不是 PNG → 运行时错 1', async () => {
  const a = encode(rawPixels(2, 1, [0, 0, 0, 255]), 2, 1);
  const bad = await pixels({ file: 'A.png', diff: 'B.png', _readFile: (p) => { if (p === 'A.png') return a; throw new Error('nope'); } });
  assert.strictEqual(bad.code, 'FILE_NOT_FOUND');
  assert.strictEqual(exitCodeFor(bad), 1);
  // 失败信封必须指向**第二张图**：把第一张图的 actual 塞进来（或漏掉 diff 字段）会变红。
  assert.strictEqual(bad.actual.diff, 'B.png');
  // 失败信封不得带 match（match 只属成功比对结果，凭空带出会污染 exitCodeFor 的判定口径）。
  assert.strictEqual(bad.actual.match, undefined);
  const notPng = await pixels({ file: 'A.png', diff: 'B.png', _readFile: (p) => (p === 'A.png' ? a : Buffer.from('nope')) });
  assert.strictEqual(notPng.code, 'BAD_PNG');
  assert.strictEqual(exitCodeFor(notPng), 1);
  // bytes 必须是第二张图的长度（Buffer.from('nope') = 4），**不是**第一张 PNG 的长度。
  assert.strictEqual(notPng.actual.bytes, 4);
});

test('pixels --centroid：像素质心（含 count 与颜色）；非对称布局与包围盒中心明显不同', async () => {
  // 白像素取 (0,0) (1,0) (1,1)（4×2 图，其余全黑）：
  //   像素质心 = 坐标平均 = (2/3, 1/3)；包围盒中心 = ((minX+maxX)/2, (minY+maxY)/2) = (0.5, 0.5)。
  // 两者明显不同 → 把质心变异成包围盒中心时本用例必须变红。
  // （旧的对称布局 x=1/x=3 质心恰为 2 == 包围盒中心，变异后仍全绿，是**无牙**的。）
  const raw = rawPixels(4, 2, [0, 0, 0, 255]);
  setPixel(raw, 4, 0, 0, [255, 255, 255, 255]);
  setPixel(raw, 4, 1, 0, [255, 255, 255, 255]);
  setPixel(raw, 4, 1, 1, [255, 255, 255, 255]);
  const e = await pixels({ file: 'A.png', centroid: '#FFFFFF', _readFile: () => encode(raw, 4, 2) });
  assert.strictEqual(e.actual.centroid.count, 3);
  // 必须**精确**比较（不用 closeTo/容差）：与包围盒中心 0.5 的差就是这条用例的牙。
  assert.strictEqual(e.actual.centroid.x, 2 / 3);
  assert.strictEqual(e.actual.centroid.y, 1 / 3);
  assert.strictEqual(e.actual.centroid.color, '#FFFFFF');
  assert.strictEqual(e.actual.centroid.tolerance, 0);
});

test('pixels --centroid 该色不存在 → count 0、x/y 为 null + hint（不是崩溃）', async () => {
  const e = await pixels({ file: 'A.png', centroid: '#123456', _readFile: () => encode(rawPixels(2, 1, [0, 0, 0, 255]), 2, 1) });
  assert.strictEqual(e.actual.centroid.count, 0);
  assert.strictEqual(e.actual.centroid.x, null);
  assert.strictEqual(e.actual.centroid.y, null);
  assert.ok(e.hint.length > 0);
});

test('pixels --bbox：包围盒（min/max 与宽高，含 tolerance 键）', async () => {
  const raw = rawPixels(4, 3, [0, 0, 0, 255]);
  for (const [x, y] of [[1, 1], [2, 1], [1, 2]]) setPixel(raw, 4, x, y, [255, 255, 255, 255]);
  const e = await pixels({ file: 'A.png', bbox: '#FFFFFF', _readFile: () => encode(raw, 4, 3) });
  assert.deepStrictEqual(e.actual.bbox, { color: '#FFFFFF', count: 3, x: 1, y: 1, width: 2, height: 2, tolerance: 0 });
});

test('pixels --bbox 该色不存在 → count 0、宽高 0、x/y null', async () => {
  const e = await pixels({ file: 'A.png', bbox: '#123456', _readFile: () => encode(rawPixels(2, 1, [0, 0, 0, 255]), 2, 1) });
  assert.deepStrictEqual(e.actual.bbox, { color: '#123456', count: 0, x: null, y: null, width: 0, height: 0, tolerance: 0 });
});

test('pixels --centroid / --bbox 颜色非法 → BAD_COLOR（2），且在读盘之前判定', async () => {
  const boom = () => { throw new Error('不该读盘'); };
  for (const opt of [{ centroid: 'nope' }, { bbox: '#GG' }]) {
    const e = await pixels({ file: 'C:/nope/missing.png', _readFile: boom, ...opt });
    assert.strictEqual(e.code, 'BAD_COLOR');
    assert.strictEqual(exitCodeFor(e), 2);
  }
});

test('pixels --diff 空串 → BAD_SOURCE（2），且不读盘', async () => {
  const e = await pixels({ file: 'C:/nope/missing.png', diff: '', _readFile: () => { throw new Error('不该读盘'); } });
  assert.strictEqual(e.code, 'BAD_SOURCE');
  assert.strictEqual(exitCodeFor(e), 2);
});

test('pixels --diff 裸写（parseArgs 给布尔 true）→ BAD_SOURCE（2），且不读盘', async () => {
  // 覆盖 `typeof diff !== 'string'` 那一半守卫：删掉 typeof 判断后，裸写 --diff 的布尔 true
  // 会漏过空串检查直接进读盘路径 → 本用例变红。
  const e = await pixels({ file: 'C:/nope/x.png', diff: true, _readFile: () => { throw new Error('不该读盘'); } });
  assert.strictEqual(e.code, 'BAD_SOURCE');
  assert.strictEqual(exitCodeFor(e), 2);
});

test('USAGE（--help 输出）逐字列出 --diff / --centroid / --bbox 选项行与 DIFF_SIZE_MISMATCH', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout } = require('./helpers/capture.js');
  const r = await captureStdout(() => main(['--help']));
  assert.strictEqual(r.result, 0);
  // 锁定**选项行**（^ 行首 + 具体形态）：裸 includes('--diff') 会被「示例」段里的
  // `--diff C:/...` 命中，把整条选项行删掉仍绿 —— 那样就没有牙。
  // worktree 是 CRLF，故只用 ^ 锚行首，**不**写 `$` 行尾。
  assert.match(r.out, /^  --diff <png>/m, 'USAGE 必须逐字列出 --diff 选项行');
  assert.match(r.out, /^  --centroid <hex>/m, 'USAGE 必须逐字列出 --centroid 选项行');
  assert.match(r.out, /^  --bbox <hex>/m, 'USAGE 必须逐字列出 --bbox 选项行');
  assert.match(r.out, /DIFF_SIZE_MISMATCH/, 'USAGE 必须写明尺寸不等时的失败码');
});

test('CLI pixels --bbox 端到端：透传生效（退出码 0，actual.bbox.count 读自 fixture 底色）', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout } = require('./helpers/capture.js');
  // fixture 的全屏底色 #314D79 共 178356 像素（与既有 --count-color 用例同源）。
  const r = await captureStdout(() => main(['pixels', '--file', FIXTURE, '--bbox', '#314D79', '--json']));
  assert.strictEqual(r.result, 0);
  assert.strictEqual(JSON.parse(r.out).actual.bbox.count, 178356);
});
