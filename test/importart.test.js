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

test('assetImport：缺 --project-path → MISSING_PROJECT_PATH（用法错 2）', async () => {
  const spy = [];
  const e = await assetImport({ from: 'x.png', to: 'Assets/a.png', _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(e.code, 'MISSING_PROJECT_PATH');
  assert.strictEqual(exitCodeFor(e), 2);
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
  const call = sequenceCall([WRITTEN, readEnvelope({ width: 1, height: 1, texWidth: 1, texHeight: 1 })], spy);
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
  const call = sequenceCall([WRITTEN, readEnvelope({ width: 6, height: 4, texWidth: 6, texHeight: 4, maxTextureSize: 32 })], spy);
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
  // R394②：文件已落盘 → 失败面必须点名落点并给出「先删掉再重试」（默认文案只指责 .cs 协议）
  assert.ok(e.intent && e.intent.asset, '写路径失败必须带 intent');
  assert.ok(e.hint.join(' ').includes('DeleteAsset'), e.hint.join(' | '));
  assert.ok(e.hint.join(' ').includes('Assets/Art/hero.png'), e.hint.join(' | '));
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
  // R393：传输层失败的公共 hint 是节点域（scene tree / node inspect）→ 本命令必须补一条**资产域** hint
  assert.ok(e.hint.some((h) => h.includes('TextureImporter')), e.hint.join(' | '));
  assert.ok(e.hint.some((h) => h.includes('--force')), e.hint.join(' | '));
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
  // R392：给了 --remove-bg 才提「换背景色 / 调容差」
  assert.ok(e.hint.join(' ').includes('--remove-bg'), e.hint.join(' | '));
});

test('assetImport：--max-size 本身超过 16384 → BAD_MAX_SIZE（用法错 2，报文不得谎报图片尺寸）', async () => {
  const spy = [];
  const e = await assetImport({ projectPath: 'P', from: 'x.png', to: 'Assets/a.png', maxSize: '20000', _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(e.code, 'BAD_MAX_SIZE');
  assert.strictEqual(exitCodeFor(e), 2);
  assert.strictEqual(spy.length, 0);
  assert.match(e.message, /16384/);
  assert.ok(e.hint.join(' ').includes('16384'), e.hint.join(' | '));
});

test('assetImport：--fit 画布超过 16384 → BAD_FIT（用法错 2，不得先分配巨型缓冲区）', async () => {
  const spy = [];
  const e = await assetImport({ projectPath: 'P', from: 'x.png', to: 'Assets/a.png', fit: '16385,16385', _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(e.code, 'BAD_FIT');
  assert.strictEqual(exitCodeFor(e), 2);
  assert.strictEqual(spy.length, 0);
  assert.match(e.message, /16384/);
});

// M1（最终修复波）：源图**自身**任一边 > 16384 时，自动抬升后的 maxTextureSize 会超 Unity 上限
// → 必须在写之前落 TEXTURE_TOO_LARGE（运行时 1），且**零写盘零调用**。
// 16385×1 RGBA = 65 540 B 原始数据（编码后 PNG 约 65 KB，可接受）。
test('assetImport：源图任一边 > 16384 → TEXTURE_TOO_LARGE（运行时 1，零写盘零调用）', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'huge.png');
  fs.writeFileSync(src, encodePng({ width: 16385, height: 1, data: Buffer.alloc(16385 * 4, 255) }));
  const spy = [];
  const writes = [];
  const e = await assetImport({
    projectPath: dir, from: src, to: 'Assets/Art/huge.png',
    _call: fakeCall({ Success: true }, spy),
    _writeFile: (p, b) => { writes.push(p); fs.writeFileSync(p, b); },
  });
  assert.strictEqual(e.code, 'TEXTURE_TOO_LARGE');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(spy.length, 0, '零调用（尺寸超限不得进 Unity）');
  assert.strictEqual(writes.length, 0, '零写盘（不得在 Assets/ 下落任何东西）');
  assert.match(e.message, /16384/);
  assert.ok(e.hint.join(' ').includes('--fit'), e.hint.join(' | '));
});

test('assetImport：--max-size 100（非 2 的幂且大于源尺寸）→ 抬到 128 再发往 Unity，raisedFrom 记原值 100', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'hero.png');
  fs.writeFileSync(src, fixture());                        // 6x4（不裁边）
  const spy = [];
  const call = sequenceCall([WRITTEN, readEnvelope({ width: 6, height: 4, texWidth: 6, texHeight: 4, maxTextureSize: 128 })], spy);
  const e = await assetImport({ projectPath: dir, from: src, to: 'Assets/Art/hero.png', maxSize: '100', _call: call });
  assert.strictEqual(e.intent.asset.maxTextureSize, 128, '非 2 的幂的上侧也要归一（否则 Unity 自行取整 → 每次合法调用假红）');
  assert.strictEqual(e.actual.maxTextureSizeRaisedFrom, 100, 'raisedFrom 记用户原值');
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  const p0 = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.strictEqual(p0.settings.maxTextureSize, 128);
});

test('assetImport：--to 不以 .png 结尾 → BAD_TARGET_PATH（用法错 2，零调用零写盘）', async () => {
  const spy = [];
  const e = await assetImport({ projectPath: 'P', from: 'x.png', to: 'Assets/Art/hero.txt', _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(e.code, 'BAD_TARGET_PATH');
  assert.strictEqual(exitCodeFor(e), 2);
  assert.strictEqual(spy.length, 0);
  assert.match(e.message, /PNG/);
});

test('assetImport：--force 覆盖已存在目标 —— 真的走写盘（不因 _exists 注入就假定覆盖）', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'hero.png');
  fs.writeFileSync(src, fixture());
  fs.mkdirSync(path.join(dir, 'Assets/Art'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Assets/Art/a.png'), 'old');
  const spy = [];
  const writes = [];
  const call = sequenceCall([WRITTEN, readEnvelope({ path: 'Assets/Art/a.png' })], spy);
  const e = await assetImport({
    projectPath: dir, from: src, to: 'Assets/Art/a.png', force: true,
    removeBg: 'auto', trim: true, _call: call,
    _writeFile: (p, b) => { writes.push(p); fs.writeFileSync(p, b); },
  });
  assert.strictEqual(writes.length, 1, '必须真的调用写盘（覆盖已存在目标）');
  assert.strictEqual(writes[0], path.join(dir, 'Assets/Art/a.png'));
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.notStrictEqual(fs.readFileSync(path.join(dir, 'Assets/Art/a.png'), 'utf8'), 'old');
  assert.strictEqual(e.actual.file.bytes, fs.statSync(path.join(dir, 'Assets/Art/a.png')).size);
});

test('assetImport：--filter bilinear --compression normal 逐字落进写载荷', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'hero.png');
  fs.writeFileSync(src, fixture());                        // 6x4（不裁边）
  const spy = [];
  const call = sequenceCall([WRITTEN, readEnvelope({
    filterMode: 'Bilinear', texFilterMode: 'Bilinear', textureCompression: 'Compressed',
    width: 6, height: 4, texWidth: 6, texHeight: 4,
  })], spy);
  const e = await assetImport({ projectPath: dir, from: src, to: 'Assets/Art/hero.png', filter: 'bilinear', compression: 'normal', _call: call });
  const p0 = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.strictEqual(p0.settings.filterMode, 'Bilinear');
  assert.strictEqual(p0.settings.textureCompression, 'Compressed');
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
});

test('assetImport：写结果缺 __written → BAD_SCRIPT_RESULT（写协议不得形同虚设）', async () => {
  const dir = tmpProject();
  const src = path.join(dir, 'hero.png');
  fs.writeFileSync(src, fixture());
  const spy = [];
  const call = sequenceCall([{ Success: true, Result: JSON.stringify({}) }], spy);
  const e = await assetImport({ projectPath: dir, from: src, to: 'Assets/Art/hero.png', trim: true, _call: call });
  assert.strictEqual(e.code, 'BAD_SCRIPT_RESULT');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.hint.join(' ').includes('__written'), e.hint.join(' | '));
  assert.ok(e.intent && e.intent.asset, '写路径失败必须带 intent');
});

test('assetImport：四角全透明（自带 alpha）→ hint 指出「去掉 --remove-bg，只留 --trim」', async () => {
  const dir = tmpProject();
  const W = 4; const H = 4;
  const d = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i * 4 + 3] = 255; }
  const setCorner = (x, y) => { const o = (y * W + x) * 4; d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0; };
  setCorner(0, 0); setCorner(3, 0); setCorner(0, 3); setCorner(3, 3);
  const src = path.join(dir, 'alpha-bg.png');
  fs.writeFileSync(src, encodePng({ width: W, height: H, data: d }));
  const spy = [];
  const e = await assetImport({ projectPath: dir, from: src, to: 'Assets/Art/a.png', removeBg: 'auto', _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(e.code, 'BACKGROUND_AMBIGUOUS');
  assert.strictEqual(e.actual.reason, 'transparent-corners');
  const hint = e.hint.join(' ');
  assert.ok(hint.includes('--trim'), hint);
  assert.ok(hint.includes('去掉'), hint);
  assert.ok(!hint.includes("'#RRGGBB'"), '自带 alpha 的图不该被引向「显式指定背景色」', hint);
});

test('assetImport：没给 --remove-bg 但源图全透明 → hint 不提 --remove-bg（改说原图没有不透明像素）', async () => {
  const dir = tmpProject();
  const W = 2; const H = 2;
  const d = Buffer.alloc(W * H * 4);                       // 全 0：alpha 全为 0
  const src = path.join(dir, 'clear.png');
  fs.writeFileSync(src, encodePng({ width: W, height: H, data: d }));
  const spy = [];
  const e = await assetImport({ projectPath: dir, from: src, to: 'Assets/Art/a.png', trim: true, _call: fakeCall({ Success: true }, spy) });
  assert.strictEqual(e.code, 'ART_FULLY_TRANSPARENT');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.strictEqual(spy.length, 0);
  assert.ok(!e.hint.join(' ').includes('--remove-bg'), e.hint.join(' | '));
  assert.ok(e.hint.join(' ').includes('不透明像素'), e.hint.join(' | '));
});
