'use strict';

/**
 * 颜色小工具：与 PNG 解码、`unity sprite set`、`unity pixels` 共用（零依赖，纯函数）。
 * 内部统一用 **0–255 整数** 表示通道 —— 与 `Texture2D` 的字节、PNG 的取样值、`SpriteRenderer`
 * 读回时 `Math.round(c * 255)` 的约定一致，避免 float↔byte 的往返误差变成假红。
 */

/** 解析 `#RGB` / `#RRGGBB` / `#RRGGBBAA`（大小写无关）→ `{r,g,b,a}`；非法返回 `null`（不抛）。 */
function parseHexColor(text) {
  if (typeof text !== 'string') return null;
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(text);
  if (!m) return null;
  const h = m[1];
  if (h.length === 3) {
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 255 };
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255,
  };
}

/** 两个颜色的最大通道差（只看 r/g/b；判定「像素是不是这个颜色」时用）。 */
function maxChannelDistance(a, b) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

/** `{r,g,b}` → `'#RRGGBB'`（大写；alpha 不进字符串，避免 `#RRGGBBAA` 的歧义）。 */
function formatHex(c) {
  const hex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

module.exports = { parseHexColor, maxChannelDistance, formatHex };
