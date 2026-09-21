#!/usr/bin/env node
'use strict';
/**
 * 生成 M4 的「用户供图」PNG：24×16、**不透明绿底** #00FF00、居中一块 6×4 的三色主体。
 *
 * 为什么要有它：M4 的验收要从「用户给的、带纯色背景的图」开始，而这张图必须**可复现**
 * （E2E 与真机步骤都引用它）→ 用零依赖的 `lib/png.js` 编码器现场生成，不入库二进制。
 * 事实（断言用）：背景 #00FF00；主体 bbox = x 9..14 / y 6..9（6×4）；
 * 主体左 2 列 #FF2E88、中 2 列 #FFE94A、右 2 列 #4DFF7A；全图无 alpha=0 的像素。
 * 用法：node scripts/make-m4-fixture.js [输出路径]
 */
const fs = require('node:fs');
const path = require('node:path');
const { encodePng } = require('../lib/png.js');

const W = 24;
const H = 16;
const data = Buffer.alloc(W * H * 4);
const set = (x, y, r, g, b) => {
  const o = (y * W + x) * 4;
  data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
};
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (x >= 9 && x <= 14 && y >= 6 && y <= 9) {
      const band = x <= 10 ? [255, 46, 136] : x <= 12 ? [255, 233, 74] : [77, 255, 122];
      set(x, y, band[0], band[1], band[2]);
    } else {
      set(x, y, 0, 255, 0);
    }
  }
}
const out = process.argv[2] || path.join(__dirname, '..', '.superpowers', 'sdd', '2026-09-20-pi-unity-m4-exec', 'fixtures', 'hero.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng({ width: W, height: H, data }));
process.stdout.write(`${out}\n`);
process.stdout.write('背景 #00FF00 / 主体 bbox 9,6,6,4 / 去底+裁边后 = 6x4\n');
