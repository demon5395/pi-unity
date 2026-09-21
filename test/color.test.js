'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseHexColor, maxChannelDistance, formatHex } = require('../lib/color.js');

test('parseHexColor 接受 #RGB / #RRGGBB / #RRGGBBAA（大小写无关），alpha 缺省 255', () => {
  assert.deepStrictEqual(parseHexColor('#0A0A14'), { r: 10, g: 10, b: 20, a: 255 });
  assert.deepStrictEqual(parseHexColor('#ff2e88'), { r: 255, g: 46, b: 136, a: 255 });
  assert.deepStrictEqual(parseHexColor('#F0A'), { r: 255, g: 0, b: 170, a: 255 });
  assert.deepStrictEqual(parseHexColor('#FF2E8880'), { r: 255, g: 46, b: 136, a: 128 });
});

test('parseHexColor 拒绝非法输入（含缺 # / 长度不对 / 非十六进制 / 非字符串）', () => {
  for (const bad of ['0A0A14', '#12345', '#GGGGGG', '#', '', 123, null, undefined, {}, '#1234567']) {
    assert.strictEqual(parseHexColor(bad), null, `${String(bad)} 应判 null`);
  }
});

test('maxChannelDistance 取三通道 |差| 的最大值', () => {
  assert.strictEqual(maxChannelDistance({ r: 0, g: 255, b: 200 }, { r: 0, g: 255, b: 200 }), 0);
  assert.strictEqual(maxChannelDistance({ r: 0, g: 255, b: 200 }, { r: 8, g: 245, b: 200 }), 10);
});

test('formatHex 产出大写 #RRGGBB', () => {
  assert.strictEqual(formatHex({ r: 10, g: 10, b: 20 }), '#0A0A14');
  assert.strictEqual(formatHex({ r: 255, g: 46, b: 136 }), '#FF2E88');
});
