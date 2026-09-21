'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { call } = require('./uloop.js');
const { fail, envelopeFromCall } = require('./envelope.js');
const { normalizeAssetTo } = require('./assetpath.js');
const { decodePng, encodePng } = require('./png.js');
const { normalizeArt } = require('./art.js');
const { buildPayloadArgs, parseScriptResult, readBackAndVerify, withWriteRecheckHint } = require('./scene.js');

/**
 * `unity asset import`：把宿主上的 PNG 落进项目 `Assets/`，**显式**配置像素画导入设置，
 * 然后**读回全部设置**比对。
 *
 * 为什么必须专门一条命令（M4-SPIKE「额外」节实测）：
 *   - `asset write` 写完**不触发导入**（9.7 s 后仍 `guid=""`、无 `.meta`）；
 *   - 而它默认那次 `compile` 自带的 refresh 会**顺带**导入，拿到的是**错设置**
 *     （Bilinear + 压缩 + PPU=100 + Tight）→ 时机不可控、设置一律错。
 *   - Unity 侧没有去底 API → 像素必须由 Node 侧定稿后再导入（NEW-6）。
 *
 * 红线（假绿防线）：
 *   - 磁盘上的文件必须**真的**是我们要写的内容（sha256 读回 —— 不信 `verified` 空转）；
 *   - `maxTextureSize` 小于源尺寸会被 Unity **静默缩放**（24×16 + 8 → 8×5，NEW-5）
 *     → 自动抬到 `>= max(w,h)` 的**2 的幂**，并靠读回的**真实纹理尺寸**兜底；
 *   - 读回发生在**写之后**的独立一次调用（不是写调用的返回值）。
 */

/** `--filter` 的取值表（**唯一真值**）：argv 小写 → Unity 枚举名。 */
const FILTERS = { point: 'Point', bilinear: 'Bilinear' };

/** `--compression` 的取值表（唯一真值）：none → 不压缩（像素画唯一正确选择）。 */
const COMPRESSIONS = { none: 'Uncompressed', normal: 'Compressed' };

const MAX_TEXTURE_SIZE_CAP = 16384;

/**
 * R393：写路径传输层失败时的**资产域**复核提示。
 *
 * `lib/scene.js` 的 `withWriteRecheckHint` 是**节点域**文案（`scene tree` / `node inspect`），
 * 对**读**命令够用；本命令的「写入」是 PNG 落盘 + 导入设置，按节点域提示复核/重试会先撞上
 * 自己刚落的文件（`ASSET_EXISTS`）→ 故本地再补这一条（公共文案不动）。
 */
const ASSET_WRITE_RECHECK_HINT =
  'PNG 已落盘；用 `unity exec` 读该资产的 TextureImporter 复核后再决定是否 `--force` 重试';

/** 正整数 argv（`--ppu` / `--max-size`）。非法 → `null`（由调用方落用法错）。 */
function positiveIntArg(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v !== 'string' || !/^\d+$/.test(v) || Number(v) <= 0) return null;
  return Number(v);
}

/** 0–255 的整数 argv（`--tolerance`）。非法 → `null`；**`0` 是合法值**（与 `pixels --tolerance` 同口径）。 */
function zeroTo255Arg(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 255 ? v : null;
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 0 && n <= 255 ? n : null;
}

/** `--fit w,h`：两个正整数。非法 → `null`。 */
function parseFitArg(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d+),(\d+)$/.exec(v);
  if (!m) return null;
  const width = Number(m[1]); const height = Number(m[2]);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/** `--pivot x,y`：两个 0–1 的有限数。非法 → `null`。 */
function parsePivotArg(v) {
  if (typeof v !== 'string') return null;
  const parts = v.split(',');
  if (parts.length !== 2) return null;
  const nums = parts.map((s) => Number(s));
  if (!nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  return { x: nums[0], y: nums[1] };
}

/** `--remove-bg`：`auto` 或 `#RRGGBB`/`#RGB`。非法 → `null`。 */
function parseRemoveBgArg(v) {
  if (v === 'auto') return 'auto';
  if (typeof v !== 'string') return null;
  const s = v.replace(/^#/, '');
  return /^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? `#${s.toUpperCase()}` : null;
}

/** `>= n` 的最小 2 的幂（从 32 起 —— Unity 的 maxTextureSize 是 2 的幂档位）。 */
function nextPow2AtLeast(n) {
  let v = 32;
  while (v < n) v *= 2;
  return v;
}

/**
 * 把 `lib/art.js` 抛出的运行时错误收敛成信封（`BACKGROUND_AMBIGUOUS` / `ART_FULLY_TRANSPARENT`）。
 *
 * R392：hint 必须**按情形分流**，否则会把人引向死路（R366 有先例）——
 *   - `BACKGROUND_AMBIGUOUS` 且 `detail.reason === 'transparent-corners'`（四角全透明）：
 *     这张图**本来就带 alpha**，再 `--remove-bg` 只会把不透明主体羽化 → 该说的是「去掉 `--remove-bg`」；
 *   - `ART_FULLY_TRANSPARENT` 且调用方**没给** `--remove-bg`：源图自己就是全透明的，
 *     提 `--remove-bg` 完全无意义 → 该说的是「原图没有不透明像素」。
 *
 * @param {Error & {code?: string, detail?: object}} err `lib/art.js` 抛出的错误
 * @param {object} intent 失败信封里的 intent
 * @param {{removeBgGiven?: boolean}} [opts] 调用方**是否给了** `--remove-bg`（`removeBgVal !== undefined`）
 */
function artFailure(err, intent, { removeBgGiven = false } = {}) {
  const code = err && err.code === 'BACKGROUND_AMBIGUOUS' ? 'BACKGROUND_AMBIGUOUS'
    : err && err.code === 'ART_FULLY_TRANSPARENT' ? 'ART_FULLY_TRANSPARENT'
      : 'ART_FAILED';
  const reason = err && err.detail && err.detail.reason;
  let hint;
  if (code === 'BACKGROUND_AMBIGUOUS') {
    hint = reason === 'transparent-corners'
      ? ['这张图本来就带透明背景 → **去掉 `--remove-bg`**，只留 `--trim`（对自带 alpha 的图做色键去底，会把不透明主体羽化）']
      : [
        '背景不是纯色（四角不一致）→ 显式指定背景色：--remove-bg \'#RRGGBB\'',
        '或用 `read` 工具看一眼原图，确认背景到底是什么颜色',
      ];
  } else if (code === 'ART_FULLY_TRANSPARENT') {
    hint = removeBgGiven
      ? [
        '去背景色命中太多像素：换一个背景色（--remove-bg \'#RRGGBB\'）或调小 --tolerance',
        '先不加 --trim 看看去底结果',
      ]
      : [
        '原图没有不透明像素 —— 这张源图本身就是全透明的，换一张有内容的图',
        '确认 --from 指向的是不是想要的源文件',
      ];
  } else {
    hint = ['把原图与参数贴进报告；这是 Node 侧像素管线的意外失败'];
  }
  return fail({ code, message: (err && err.message) || String(err), intent, actual: (err && err.detail) || null, hint, phase: 'art' });
}

/**
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, from?: string, to?: string, force?: boolean,
 *   removeBg?: string, tolerance?: string, trim?: boolean, fit?: string, ppu?: string, maxSize?: string,
 *   filter?: string, compression?: string, pivot?: string,
 *   _call?: typeof call, _readSource?: (p: string) => Buffer, _readBack?: (p: string) => Buffer,
 *   _writeFile?: (p: string, b: Buffer) => void, _exists?: (p: string) => boolean,
 *   _mkdirp?: (p: string) => void}} [opts]
 * @returns {Promise<object>} 信封（成功时 `verified` 为布尔）
 */
async function assetImport({
  projectPath, env, from, to, force, removeBg, tolerance, trim, fit, ppu, maxSize, filter, compression, pivot,
  _call, _readSource, _readBack, _writeFile, _exists, _mkdirp,
} = {}) {
  // ---- 用法面：全部在任何写盘/任何 uloop 调用之前收敛（约束 4）----
  if (typeof from !== 'string' || from === '') {
    return fail({
      code: 'MISSING_FILE',
      message: '缺少 --from（宿主上的源图路径）',
      actual: { from },
      hint: ['用法：unity asset import --project-path <P> --from C:/pic/hero.png --to Assets/Art/hero.png'],
    });
  }
  const toCheck = normalizeAssetTo(to, {
    sample: 'Assets/Art/hero.png',
    missingHint: '用法：unity asset import --project-path <P> --from C:/pic/hero.png --to Assets/Art/hero.png',
    badHint: '用法：--to Assets/Art/hero.png（必须在 Assets/ 下、不含 ..）',
  });
  if (!toCheck.ok) return toCheck.envelope;
  const normalizedTo = toCheck.path;
  // R394①：本命令**只产出 PNG** —— 其它扩展名会被 Unity 当 TextAsset/未知类型导入
  // （拿不到 TextureImporter），而那时文件**已经落盘**。argv 可判，必须在用法面挡下。
  if (!/\.png$/i.test(normalizedTo)) {
    return fail({
      code: 'BAD_TARGET_PATH',
      message: `--to 必须以 .png 结尾（本命令只产出 PNG）：${JSON.stringify(to)}`,
      actual: { to },
      hint: ['用法：--to Assets/Art/hero.png', '其它扩展名（.txt/.jpg/无扩展名）会被 Unity 当别的资产类型导入'],
    });
  }

  const ppuNum = ppu === undefined ? 16 : positiveIntArg(ppu);
  if (ppuNum === null) {
    return fail({ code: 'BAD_PPU', message: `--ppu 需要正整数，收到 ${JSON.stringify(ppu)}`, actual: { ppu }, hint: ['像素画常用 16 / 32：PPU 决定「1 个世界单位 = 多少像素」'] });
  }
  const maxSizeNum = maxSize === undefined ? null : positiveIntArg(maxSize);
  if (maxSize !== undefined && maxSizeNum === null) {
    return fail({ code: 'BAD_MAX_SIZE', message: `--max-size 需要正整数，收到 ${JSON.stringify(maxSize)}`, actual: { maxSize }, hint: ['这是 Unity 的 maxTextureSize；小于源尺寸会被**静默缩放**，本命令会自动抬到 >= 源尺寸的 2 的幂'] });
  }
  // R390：`--max-size` 超过 Unity 硬上限是 **argv 可判的用法错**，必须在用法面收敛。
  // 旧实现放它走到运行时，用 `TEXTURE_TOO_LARGE` 报出「图片尺寸 6x4 超过上限 16384」这种
  // **谎言报文**（图根本没超），还把用法错错判成运行时错（退出码 1）。
  if (maxSizeNum !== null && maxSizeNum > MAX_TEXTURE_SIZE_CAP) {
    return fail({
      code: 'BAD_MAX_SIZE',
      message: `--max-size ${maxSizeNum} 超过 Unity 的 maxTextureSize 上限 ${MAX_TEXTURE_SIZE_CAP}`,
      actual: { maxSize },
      hint: [`maxTextureSize 的上限是 ${MAX_TEXTURE_SIZE_CAP}；调小 --max-size，或先用 --fit 缩小画布`],
    });
  }
  const filterName = filter === undefined ? 'Point' : FILTERS[filter];
  if (filter !== undefined && !filterName) {
    return fail({ code: 'BAD_FILTER', message: `--filter 只接受 point|bilinear，收到 ${JSON.stringify(filter)}`, actual: { filter }, hint: ['像素画用 point（最近邻，不糊）；写实照片才用 bilinear'] });
  }
  const compName = compression === undefined ? 'Uncompressed' : COMPRESSIONS[compression];
  if (compression !== undefined && !compName) {
    return fail({ code: 'BAD_COMPRESSION', message: `--compression 只接受 none|normal，收到 ${JSON.stringify(compression)}`, actual: { compression }, hint: ['像素画必须 none（压缩会把颜色糊成 DXT 块）'] });
  }
  const removeBgVal = removeBg === undefined ? undefined : parseRemoveBgArg(removeBg);
  if (removeBg !== undefined && removeBgVal === null) {
    return fail({ code: 'BAD_REMOVE_BG', message: `--remove-bg 只接受 auto 或 #RRGGBB，收到 ${JSON.stringify(removeBg)}`, actual: { removeBg }, hint: ["用法：--remove-bg auto（按四角推断）或 --remove-bg '#00FF00'"] });
  }
  const fitVal = fit === undefined ? null : parseFitArg(fit);
  if (fit !== undefined && fitVal === null) {
    return fail({ code: 'BAD_FIT', message: `--fit 需要 w,h 两个正整数，收到 ${JSON.stringify(fit)}`, actual: { fit }, hint: ['用法：--fit 32,32（contain-fit：保持比例放进该画布，空白处透明）'] });
  }
  // R397：`--fit 16385,16385` 会先在 Node 侧分配 ~1.3 GB 才走到 `TEXTURE_TOO_LARGE`（实测 852 ms）。
  // 画布尺寸是 argv 可判的 → 超上限在用法面挡下，不把内存炸弹留给运行时。
  if (fitVal && (fitVal.width > MAX_TEXTURE_SIZE_CAP || fitVal.height > MAX_TEXTURE_SIZE_CAP)) {
    return fail({
      code: 'BAD_FIT',
      message: `--fit 的画布 ${fitVal.width}x${fitVal.height} 超过 Unity 的纹理上限 ${MAX_TEXTURE_SIZE_CAP}`,
      actual: { fit },
      hint: [`--fit 的宽高都必须 <= ${MAX_TEXTURE_SIZE_CAP}（再大 Unity 也导不进去）`],
    });
  }
  const pivotVal = pivot === undefined ? null : parsePivotArg(pivot);
  if (pivot !== undefined && pivotVal === null) {
    return fail({ code: 'BAD_PIVOT', message: `--pivot 需要 x,y 两个 0–1 的数，收到 ${JSON.stringify(pivot)}`, actual: { pivot }, hint: ['用法：--pivot 0.5,0（底部中心）；不给则用 Unity 默认的 Center(0.5,0.5)'] });
  }
  // ⚠️ `--tolerance 0` 是**合法**值（与 `pixels --tolerance` 的 0–255 同口径）→ 不能复用 `positiveIntArg`（它把 0 判非法）。
  const toleranceNum = tolerance === undefined ? 40 : zeroTo255Arg(tolerance);
  if (toleranceNum === null) {
    return fail({ code: 'BAD_TOLERANCE', message: `--tolerance 需要 0–255 的整数，收到 ${JSON.stringify(tolerance)}`, actual: { tolerance }, hint: ['像素画建议 0–40；只会与 --remove-bg 一起用'] });
  }
  if (typeof projectPath !== 'string' || projectPath === '') {
    return fail({
      code: 'MISSING_PROJECT_PATH',
      message: '需要 --project-path（本命令要按项目根解析 --to 的落地路径）',
      actual: { to: normalizedTo },
      hint: ['用 --project-path <项目根> 指定项目'],
    });
  }

  const absTo = path.join(projectPath, normalizedTo);
  const exists = _exists || fs.existsSync;
  if (exists(absTo) && force !== true) {
    return fail({
      code: 'ASSET_EXISTS',
      message: `目标已存在：${normalizedTo}（未给 --force）`,
      actual: { path: normalizedTo },
      hint: [
        '覆盖已有美术资产属于停止条件（skill §5）：先向用户确认',
        '确认后用 --force 覆盖（同名覆盖 = 更新，GUID 不变，引用不断 —— M4-SPIKE Q4）',
      ],
    });
  }

  // ---- 读源图 + 规范化（Node 侧；Unity 侧只做声明式设置）----
  let source;
  try {
    source = await (_readSource || ((p) => fs.readFileSync(p)))(from);
  } catch (err) {
    return fail({
      code: 'SOURCE_NOT_FOUND',
      message: `读不了源图：${(err && err.message) || String(err)}`,
      actual: { from },
      hint: ['--from 是宿主上的**绝对路径**（相对路径按当前 shell 的 cwd 解析）'],
    });
  }
  let decoded;
  try {
    decoded = decodePng(source);
  } catch (err) {
    return fail({
      code: 'BAD_PNG',
      message: `源图不是本命令支持的 PNG：${(err && err.message) || String(err)}`,
      actual: { from, bytes: source.length },
      hint: [
        '支持面：bitDepth 8、colorType 0/2/4/6（**调色板 colorType 3 与隔行不支持**）',
        '用图片编辑器另存为「PNG-24 / PNG-32（非隔行）」再试',
      ],
    });
  }
  let art;
  try {
    art = normalizeArt(decoded, {
      removeBg: removeBgVal, tolerance: toleranceNum, trim: trim === true, fit: fitVal,
    });
  } catch (err) {
    // R392：把「用户到底给没给 --remove-bg」传进失败面 —— hint 按情形分流的前提。
    return artFailure(err, { asset: { path: normalizedTo, from } }, { removeBgGiven: removeBgVal !== undefined });
  }
  const img = art.img;
  const autoMax = nextPow2AtLeast(Math.max(img.width, img.height));
  // R391：**上侧也归一**到 2 的幂档位 —— `--max-size 100` 这类非档位值若原样发往 Unity，
  // 引擎会自行取整（64/128），读回就与 intent 不等 → **每一次合法调用都假红**。
  const effectiveMax = nextPow2AtLeast(Math.max(maxSizeNum || 0, autoMax));
  if (effectiveMax > MAX_TEXTURE_SIZE_CAP) {
    return fail({
      code: 'TEXTURE_TOO_LARGE',
      message: `图片尺寸 ${img.width}x${img.height} 超过 Unity 的纹理上限 ${MAX_TEXTURE_SIZE_CAP}`,
      actual: { width: img.width, height: img.height },
      hint: ['先用 --fit 缩到 16384 以内（像素画建议 --fit 到游戏里真正需要的尺寸）'],
    });
  }
  const encoded = encodePng(img);
  const sha = crypto.createHash('sha256').update(encoded).digest('hex');

  // `artifact` 是**读回口径**的全集：11 项导入设置 + 纹理事实。
  const artifact = {
    path: normalizedTo,
    width: img.width,
    height: img.height,
    textureType: 'Sprite',
    spriteImportMode: 'Single',
    filterMode: filterName,
    textureCompression: compName,
    mipmapEnabled: false,
    wrapMode: 'Clamp',
    pixelsPerUnit: ppuNum,
    maxTextureSize: effectiveMax,
    npotScale: 'None',
    isReadable: false,
    alphaIsTransparency: false,
    spriteMeshType: 'FullRect',
    spriteExtrude: 0,
    spriteAlignment: pivotVal ? 9 : 0,
    spritePivotX: pivotVal ? pivotVal.x : 0.5,
    spritePivotY: pivotVal ? pivotVal.y : 0.5,
    texWidth: img.width,
    texHeight: img.height,
    texFilterMode: filterName,
    mipmapCount: 1,
    hasSprite: true,
  };
  // 给 `.cs` 的**声明式设置**载荷：只留它能设的键（`path`/尺寸/纹理事实不是设置项，`.cs` 也不读它们）。
  const settings = { ...artifact };
  delete settings.width; delete settings.height; delete settings.path;
  delete settings.texWidth; delete settings.texHeight; delete settings.texFilterMode;
  delete settings.mipmapCount; delete settings.hasSprite;
  // intent 是 `artifact` 的子集（保留 `width`/`height`/`texWidth`/`texHeight`：它们正是「静默缩放」的判据）。
  const intentSettings = { ...artifact };
  if (!pivotVal) {
    // 未探测就不断言（M4-SPIKE 只验过 Custom(9) + pivot(0.25,0.75)）：Center 下 Unity 把 pivot 归一成什么
    // 没有实测证据 → 放进 intent 会让每次不带 --pivot 的导入都 verified:false（假红）。读回面仍会带这三个值（informational）。
    delete intentSettings.spriteAlignment;
    delete intentSettings.spritePivotX;
    delete intentSettings.spritePivotY;
  }
  const intent = { asset: intentSettings };

  // ---- 落盘（写后读回 sha256）----
  try {
    (_mkdirp || ((p) => fs.mkdirSync(p, { recursive: true })))(path.dirname(absTo));
    (_writeFile || ((p, b) => fs.writeFileSync(p, b)))(absTo, encoded);
  } catch (err) {
    return fail({
      code: 'WRITE_FAILED',
      message: `写不进项目：${(err && err.message) || String(err)}`,
      intent,
      actual: { path: absTo },
      hint: ['确认项目目录可写、磁盘有空间'],
      phase: 'write',
    });
  }

  // ---- .cs 写调用（ImportAsset + 配设置 + SaveAndReimport）----
  const callFn = _call || call;
  let w;
  try {
    w = await callFn('execute-dynamic-code', buildPayloadArgs('asset-import', { mode: 'write', path: normalizedTo, settings }), { projectPath, env });
  } catch (err) {
    return fail({
      code: 'WRITE_CALL_FAILED',
      message: `asset-import 写调用失败：${(err && err.message) || String(err)}`,
      intent,
      hint: ['文件已落盘但导入设置是否生效未知；用 `unity exec` 读 TextureImporter 复核后再重试'],
      phase: 'write',
    });
  }
  const envl = envelopeFromCall(w);
  if (!envl.ok) {
    // R393：公共 hint 是节点域的（`scene tree` / `node inspect`）→ 本地再补一条资产域 hint。
    const recheck = withWriteRecheckHint(envl);
    return { ...recheck, hint: [...recheck.hint, ASSET_WRITE_RECHECK_HINT] };
  }
  const parsed = parseScriptResult(w, {
    label: 'asset-import',
    // R394②：这两个码出现时**文件已经落盘**，默认文案只指责 `.cs` 协议（把人引向错误方向）
    // → 点名落点 + 「先删掉再重试」。
    describeError: (code) => {
      if (code === 'IMPORTER_NOT_FOUND' || code === 'TEXTURE_NOT_FOUND') {
        return {
          message: `文件已落盘但导入器不对（${code}）：${normalizedTo}`,
          actual: { path: normalizedTo, code },
          hint: [
            `先删掉该文件再重试：unity exec --project-path <P> --code 'AssetDatabase.DeleteAsset("${normalizedTo}")'`,
            '确认 `--to` 是 .png（本命令只产出 PNG）；该文件是本命令刚写下的，不是用户既有资产',
          ],
        };
      }
      return undefined;
    },
  });
  // 写路径的失败一律带 intent（与 WRITE_FAILED / WRITE_CALL_FAILED 同口径）
  if (parsed.envelope) return { ...parsed.envelope, intent };
  // R396：写结果必须符合协议（与 R225 的 node-delete 同口径）—— `__written` 不是 true 还继续读回，
  // 等于让「写成了没有」的判据全交给读回，协议形同虚设。
  if (parsed.parsed.__written !== true) {
    return fail({
      code: 'BAD_SCRIPT_RESULT',
      message: 'asset-import 的写结果不符合协议（需要 {"__written":true}）',
      intent,
      actual: parsed.parsed,
      hint: [
        '检查 unity-scripts/asset-import.cs：write 模式必须返回 {"__written":true}',
        '确认 --code-file 指向的是 asset-import.cs',
      ],
    });
  }

  // ---- 读回（独立一次调用）+ 磁盘 sha256 + 成功/分歧 ----
  const readBack = _readBack || ((p) => fs.readFileSync(p));
  let diskSha = null;
  let diskBytes = 0;
  try {
    const disk = readBack(absTo);
    diskSha = crypto.createHash('sha256').update(disk).digest('hex');
    diskBytes = disk.length;
  } catch (err) {
    diskSha = null;
  }
  return readBackAndVerify({
    projectPath,
    env,
    callFn,
    intent,
    readActual: async () => {
      const r = await callFn('execute-dynamic-code', buildPayloadArgs('asset-import', { mode: 'read', path: normalizedTo }), { projectPath, env });
      const envr = envelopeFromCall(r);
      if (!envr.ok) {
        const err = new Error(`读回失败（${envr.code}）：${envr.message}`);
        err.envelope = envr;
        throw err;
      }
      const p = parseScriptResult(r, { label: 'asset-import', describeError: () => undefined });
      if (p.envelope) {
        const err = new Error(`读回失败（${p.envelope.code}）：${p.envelope.message}`);
        err.envelope = p.envelope;
        throw err;
      }
      // ⚠️ 必须与 intent **同形**：intent 是 `{asset:{...}}` → 读回投影也要包一层 `asset`
      //（compareSubset 遇到「intent 里是对象、actual 侧不是对象」→ 直接记一条 `key:'asset'` 分歧，
      //  结果是每一次 asset import 都 verified:false）。
      // R389/R387：读回面**直透** `.cs` 的 `__read`（不做任何归一化）—— 真 `.cs` 里 `width` 与
      // `texWidth` 本来就同取 `tex.width`，归一化是恒等变换，只会把 `asset.width` 变成死字段、
      // 并把「mock 与 intent 不同形」的缺陷藏起来。
      return {
        asset: { ...p.parsed.__read },
        file: { path: normalizedTo, sha256: diskSha, bytes: diskBytes },
        art: {
          removeBg: art.art.removeBg,
          trimmed: art.art.trimmed,
          output: art.art.output,
          warning: art.art.warning,
          sourceBytes: source.length,
        },
        maxTextureSizeRaisedFrom: maxSizeNum !== null && effectiveMax !== maxSizeNum ? maxSizeNum : null,
      };
    },
    residue: '文件已经落盘、导入可能也已生效；**不要**盲目重试（先 `unity exec` 读 TextureImporter 复核，或直接删掉该资产重来）',
    mismatchHint: '读回与意图不一致（verified:false）——最常见是**纹理被静默缩放**（查 asset.texWidth/texHeight 与 maxTextureSize）或压缩/滤波没生效；逐条查 mismatches',
    extraCheck: () => {
      if (diskSha !== null && diskSha === sha) return [];
      return [{ key: 'file.sha256', intent: sha, actual: diskSha }];
    },
  });
}

module.exports = {
  assetImport, FILTERS, COMPRESSIONS, nextPow2AtLeast,
  positiveIntArg, zeroTo255Arg, parseFitArg, parsePivotArg, parseRemoveBgArg,
};
