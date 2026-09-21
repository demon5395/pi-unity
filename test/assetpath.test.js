'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeAssetTo } = require('../lib/assetpath.js');
const { exitCodeFor } = require('../lib/envelope.js');

const MSG = { sample: 'Assets/X/y.png', missingHint: 'h1', badHint: 'h2' };

test('normalizeAssetTo：缺参/裸写/非字符串 → MISSING_TO（用法错 2）', () => {
  for (const bad of [undefined, null, true, 123, {}]) {
    const r = normalizeAssetTo(bad, MSG);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.envelope.code, 'MISSING_TO');
    assert.strictEqual(exitCodeFor(r.envelope), 2);
  }
});

test('normalizeAssetTo：空串 → BAD_TARGET_PATH（R274：空串不是缺参）', () => {
  const r = normalizeAssetTo('', MSG);
  assert.strictEqual(r.envelope.code, 'BAD_TARGET_PATH');
  assert.strictEqual(exitCodeFor(r.envelope), 2);
});

test('normalizeAssetTo：反斜杠归一 + 合法路径透传', () => {
  assert.deepStrictEqual(normalizeAssetTo('Assets\\Art\\a.png', MSG), { ok: true, path: 'Assets/Art/a.png' });
  assert.deepStrictEqual(normalizeAssetTo('Assets/Art/a.png', MSG), { ok: true, path: 'Assets/Art/a.png' });
});

test('normalizeAssetTo：不在 Assets/ 下或含 .. → BAD_TARGET_PATH（用法错 2）', () => {
  for (const bad of ['Art/a.png', '/Assets/a.png', 'Assets/../x.png', 'assets/a.png']) {
    const r = normalizeAssetTo(bad, MSG);
    assert.strictEqual(r.envelope.code, 'BAD_TARGET_PATH', bad);
    assert.strictEqual(exitCodeFor(r.envelope), 2);
  }
});

test('normalizeAssetTo：折叠重复 `/`、去掉 `./` 段（R439，与 Unity 规范路径对齐）', () => {
  assert.strictEqual(normalizeAssetTo('Assets//P/a.png', MSG).path, 'Assets/P/a.png');
  assert.strictEqual(normalizeAssetTo('Assets/P/./a.png', MSG).path, 'Assets/P/a.png');
  assert.strictEqual(normalizeAssetTo('Assets///P//././a.png', MSG).path, 'Assets/P/a.png');
  // 首段空仍必须落 BAD_TARGET_PATH（归一不得把宿主绝对路径洗成合法资产路径）
  for (const lead of ['/Assets/a.png', '//Assets/a.png', './Assets/a.png']) {
    assert.notStrictEqual(normalizeAssetTo(lead, MSG).ok, true, lead);
  }
  // `..` 仍拒（折叠不改变这条）
  for (const bad of ['Assets/./../a.png', 'Assets/P/../../a.png']) {
    assert.strictEqual(normalizeAssetTo(bad, MSG).envelope.code, 'BAD_TARGET_PATH', bad);
  }
});
