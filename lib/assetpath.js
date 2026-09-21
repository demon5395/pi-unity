'use strict';

const { fail } = require('./envelope.js');

/**
 * 折叠重复 `/`、去掉 `.` 段（R439）。
 *
 * 为什么要归一：Unity 的 `AssetDatabase` 回的是**规范路径**，`Assets//P/./a.png`
 * 不归一就会「写进去一个样、读回来又一个样」→ 写后读回**假红**（R439）。
 *
 * 边界：
 *   - `..` **不在这里**处理 —— 由调用方拒绝（本文件沿用 R274 的 `includes('..')` 子串判，
 *     `lib/prefab.js` 按段判）。
 *   - 首段空（`/Assets/…`、`//Assets/…`）**保留** —— 归一不得把宿主绝对路径洗成合法资产路径。
 *
 * 与 `lib/sprite.js` 的 `normalizeAssetPath`（R408）同一口径，但那份自带错误码，未共用。
 *
 * @param {string} p 已把 `\` 换成 `/` 的路径（调用方保证是字符串）
 * @returns {string} 折叠后的路径
 */
function foldAssetSlashes(p) {
  const segs = p.split('/');
  const kept = [];
  for (let i = 0; i < segs.length; i += 1) {
    // `''` 只在**非首段**丢弃（首段空 = 绝对路径，必须留着让它落 BAD_TARGET_PATH）
    if (segs[i] === '.' || (segs[i] === '' && i !== 0)) continue;
    kept.push(segs[i]);
  }
  return kept.join('/');
}

/**
 * `--to` 的**唯一**校验实现（`unity asset write` 与 `unity asset import` 共用）。
 *
 * 为什么单独一个文件：两处逐字重复的校验会在「空串算不算缺参」「hint 文案」这些
 * 细节上各自漂移（`docs/M3-DECISIONS.md` 的 R366② 就是同族问题的登记项）。
 *
 * R274 边界（**逐字保留**）：空串 **不是**「缺 --to」—— `--to=` 给了值（只是值为空），
 * 语义是「目标路径非法」→ `BAD_TARGET_PATH`；只有「没给 / 裸写 flag（`true`）/ 非字符串」
 * 才是 `MISSING_TO`。两者都是用法错（退出码 2），但**错误码不同**，调用方靠它分流。
 *
 * @param {*} to `--to` 的原始 argv 值
 * @param {{sample: string, missingHint: string, badHint: string}} msg
 *   `sample` 进 `MISSING_TO` 的 message；两个 hint 分别给缺参与非法路径用
 *   （参数化的唯一目的是让既有命令的输出**逐字不变**）
 * @returns {{ok: true, path: string} | {ok: false, envelope: object}}
 */
function normalizeAssetTo(to, { sample, missingHint, badHint }) {
  if (typeof to !== 'string') {
    return {
      ok: false,
      envelope: fail({
        code: 'MISSING_TO',
        message: `缺少 --to（目标路径，形如 ${sample}）`,
        actual: { to },
        hint: [missingHint],
      }),
    };
  }
  const normalized = to.replace(/\\/g, '/');
  if (!/^Assets\//.test(normalized) || normalized.includes('..')) {
    return {
      ok: false,
      envelope: fail({
        code: 'BAD_TARGET_PATH',
        message: `--to 必须是 Assets/ 下的项目内路径且不含 ..：${JSON.stringify(to)}`,
        actual: { to },
        hint: [badHint],
      }),
    };
  }
  // R439：折叠重复 `/` 与 `./` 段 —— 与 Unity 回的**规范路径**对齐，否则读回假红。
  // （校验在折叠**之前**做，所以 `/Assets/…`、`//Assets/…` 仍落 BAD_TARGET_PATH。）
  return { ok: true, path: foldAssetSlashes(normalized) };
}

module.exports = { normalizeAssetTo, foldAssetSlashes };
