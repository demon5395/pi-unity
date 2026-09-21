// lib/build.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { call } = require('./uloop.js');
const { ok, fail, envelopeFromCall } = require('./envelope.js');
const { compressIssues, compileTimeoutArg } = require('./asset.js');
const { buildPayloadArgs, parseScriptResult } = require('./scene.js');

/**
 * `unity build` —— 构建出包并把**产物真的落在磁盘上**这件事读回来。
 *
 * 这是 M3 的最后一刀（README/SKILL 长期写着「尚未实现：`unity build`」）：
 * 在此之前 agent 只能出工程、出不了包。
 *
 * ## 实现路径（真机探测定型，2026-09-19，见 task-3-report.md）
 *
 * **编辑器内** `execute-dynamic-code` → `BuildPipeline.BuildPlayer`（`unity-scripts/build-player.cs`）。
 * 为什么不走 `Tuanjie.exe -batchmode -executeMethod`（S8 的手工路径）：
 *   - 它需要在**用户工程里放一个 Editor 脚本**（本项目不往用户工程写文件）；而动态代码不需要；
 *   - 它要求该项目**没有别的编辑器开着**（工程锁）；而本命令的其余能力全都跑在已连接的编辑器上。
 * 实测（盲测项目，空场景）：uloop 一次调用 **17.5s** 返回，report 形状完整，未触发任何超时。
 *
 * ## 三条硬约束
 *
 * 1. **U9：不许假定平台存在** —— 构建目标取决于装了哪些 PlaybackEngines。可用性判据是
 *    `BuildPipeline.IsBuildTargetSupported`（在脚本里问编辑器），请求未装的目标 →
 *    `BUILD_TARGET_UNAVAILABLE`（退出码 1）+ hint 列出可用目标，**绝不**静默改打别的目标。
 * 2. **约束 5/24：不硬编码 Unity 官方约定** —— 产物名取自 `Application.productName`（不是
 *    `UnityPlayer.dll`），产物清单是**实际读目录**得到的，`sizeBytes` 是**磁盘实测总字节**
 *    （`report.summary.totalSize` 只作 `reportedSizeBytes` 备查，两者实测差 ~45 KB）。
 * 3. **约束 15：写命令的 `verified` 是布尔** —— `intent = {built:true, target}`，
 *    读回面真的去 stat 产物；`report` 说成功而磁盘上没有 → `ARTIFACT_MISSING` + `verified:false`
 *    （**假绿防线**：`Succeeded` 只代表「Unity 认为构建成功」，不代表「东西在你的磁盘上」）。
 *
 * ## 为什么 CLI 用法错选 `MISSING_TO` / `BAD_ACTION`
 *
 * 冻结的用法错表（`lib/envelope.js` 的 `USAGE_FAILURE_CODES`，本任务不改它）里没有
 * `MISSING_TARGET`/`BAD_TARGET`：`MISSING_TO` 是唯一名字含义为「缺少目标（参数）」的码，
 * `BAD_ACTION` 是该表里「枚举外取值」的既有落点（`unity play --action` 用它）。
 * 两者都在表内 → 退出码 2，且不需要动 `lib/envelope.js`。
 */

/**
 * 支持的目标表（**唯一真值**：`--target` 的合法取值 + 枚举名 + 产物扩展名）。
 *
 * ⚠️ 表内**不代表本机可用** —— 可用性只能问编辑器（U9）。
 * `outputExtension` 是目标定义的一部分（win64 的 `.exe` / android 的 `.apk` / webgl 是目录），
 * 读回面**不依赖**它：主产物名取自 report 的 `outputPath`，磁盘上有没有由 stat 说话。
 */
const TARGETS = Object.freeze({
  win64: Object.freeze({ buildTarget: 'StandaloneWindows64', buildTargetGroup: 'Standalone', outputExtension: '.exe' }),
  android: Object.freeze({ buildTarget: 'Android', buildTargetGroup: 'Android', outputExtension: '.apk' }),
  webgl: Object.freeze({ buildTarget: 'WebGL', buildTargetGroup: 'WebGL', outputExtension: '' }),
  weixin: Object.freeze({ buildTarget: 'WeixinMiniGame', buildTargetGroup: 'WeixinMiniGame', outputExtension: '' }),
});

const TARGET_NAMES = Object.keys(TARGETS);

/** 默认等待上限（秒）——与 `unity compile` 同口径；构建是长任务，可显式调大。 */
const DEFAULT_TIMEOUT_SECONDS = 600;

/**
 * 主产物「本轮是否被重写」的**容差**（毫秒，R364 引入 / R371 降级为 hint 阈值）。
 *
 * ⚠️ **R371：mtime 不是判据** —— 它不再进 `mismatches`、不再影响 `verified`。
 * 同一个 `--out` 连跑第二次时，工程没改、Unity 判定「已最新」**不重写产物**是**正确语义**，
 * 拿 `mtimeMs >= startedAt` 判红会把完好的产物误报成 `ARTIFACT_MISSING`（真机误红）。
 * 判据仍是：`outputPath` 的目录 == `--out`、主产物存在/非空、`fileCount > 0`、`sizeBytes > 0`。
 *
 * 本容差只决定那条 **hint** 出不出现：`mtimeMs` 落在「构建开始时间 - 2s」之后视为「本轮写的」，
 * 不提示；否则提示「未在本轮被重写」。留 2 秒的理由：
 *   - 文件系统的 mtime 粒度：FAT 2s / exFAT 10ms / 网络盘更粗；
 *   - 时钟取整（`utimes` 秒级 API、`SetFileTime` 取整）会让「刚写出」落在开始时间前几毫秒。
 * 不加容差会在这些盘上刷出**假 hint**（hint 不是失败，但会误导人以为产物是旧的）。
 */
const MTIME_SLACK_MS = 2000;

/**
 * 主产物未被本轮重写的提示（R371，**不是**失败）：要一字不改地传达三件事 ——
 * ① 这是 Unity 判定「已最新」因而没重写；② 产物仍然可用（不是残缺/过期数据）；
 * ③ 真想强制重建时的出路是换 `--out` 或先清空旧产物。
 */
const MAIN_NOT_REWRITTEN_HINT = '产物未在本轮被重写（Unity 判定已最新）：它是上一轮构建的结果，'
  + '仍可用；要强制重建请换一个 `--out` 目录或先清空旧产物';

/**
 * 目录比较键（R368）：**只**用来判「report 说的目录是不是 `--out`」。
 *
 * Windows 的文件系统**大小写不敏感**（`C:\out` 与 `c:\OUT` 是同一目录），Unity/团结回传的
 * `outputPath` 大小写不保证与我们发过去的 `--out` 逐字相同 —— 逐字比较会**误红**
 * （方向保守，但会把真成功报成失败）。win32 下按小写归一。
 *
 * ⚠️ 不用 `fs.realpathSync`：目标目录可能**还不存在**（构建没写盘 / 被删），realpath 会抛；
 * 而短名（8.3）与大小写不同：这里的 `--out` 就是原样发给编辑器的那个路径，短名/长名由调用方
 * 自己保持一致，本函数只负责抹平大小写。
 *
 * @param {string} p 目录路径（可为相对路径，按当前 shell 的 cwd 解析）
 * @returns {string} 比较键（同一目录 → 同一个键）
 */
function dirCompareKey(p) {
  const abs = path.resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

const USAGE = 'unity build --project-path <P> --target <t> --out <dir> [--timeout-seconds <n>] [--json]';

/** 本命令的失败都要说清「构建走的是已连接的编辑器」。 */
const NEEDS_EDITOR_HINT = '本命令在**已打开的编辑器内**构建（编辑器内 BuildPipeline.BuildPlayer，不往项目里写文件）'
  + '—— 目标项目的编辑器必须先打开且已连接（`unity doctor` 的 editor-connection 必须是 pass）';

/** `--timeout-seconds` 校验：正整数（数字或纯数字串）；非法 → `null`（调用方落 BAD_TIMEOUT）。
 *
 * ⚠️ 校验本体复用 `lib/asset.js` 的 `compileTimeoutArg`（**不复制第二份**）：
 * 它缺省给 `undefined`，本命令的缺省是 600s，故这里只补缺省值，不重述合法性判据。 */
function parseTimeoutSeconds(v) {
  const t = compileTimeoutArg(v);
  return t === undefined ? DEFAULT_TIMEOUT_SECONDS : t;
}

/** `fs.Dirent` 的最小读取（注入缝用）。 */
function isDirEntry(e) {
  return typeof e.isDirectory === 'function' && e.isDirectory();
}

/**
 * 读回面：真的去磁盘看产物（存在 / 总字节数 / 主可执行名 / 顶层清单）。
 *
 * **不硬编码任何 Unity 官方产物名**（约束 5/24）：只认「report 说的那个主产物 + 真的在磁盘上」。
 * 总字节数是**递归求和**（团结的 standalone 产物有 `*_Data/` 与 `MonoBleedingEdge/` 子目录，
 * 只算顶层会少报 ~100 MB）。
 *
 * @param {{dir: string, mainName: string|null, _exists?: Function, _readDir?: Function, _stat?: Function}} opts
 * @returns {{dirExists: boolean, fileCount: number, sizeBytes: number, artifacts: object[],
 *   mainArtifact: {name: string|null, exists: boolean, sizeBytes: number, fileCount: number,
 *     mtimeMs: number|null, isDirectory: boolean}}}
 */
function readBackArtifacts({ dir, mainName, _exists, _readDir, _stat }) {
  const exists = _exists || ((p) => fs.existsSync(p));
  const readDir = _readDir || ((p) => fs.readdirSync(p, { withFileTypes: true }));
  const stat = _stat || ((p) => fs.statSync(p));
  const main = {
    name: mainName || null, exists: false, sizeBytes: 0, fileCount: 0, mtimeMs: null, isDirectory: false,
  };
  if (!exists(dir)) return { dirExists: false, fileCount: 0, sizeBytes: 0, artifacts: [], mainArtifact: main };

  /** 递归列出 `root` 下的**文件**（目录本身不算）；读不动的目录当空（保守方向：不会把缺失算成存在）。 */
  const walk = (root) => {
    const files = [];
    const recurse = (d) => {
      let entries = [];
      try {
        entries = readDir(d) || [];
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (isDirEntry(e)) recurse(full);
        else files.push(full);
      }
    };
    recurse(root);
    return files;
  };

  /** 文件列表的字节总和；读不到大小的文件按 0 计（不会把缺失算成存在）。 */
  const sumSizes = (files) => {
    let total = 0;
    for (const f of files) {
      try {
        const s = stat(f);
        if (s && typeof s.size === 'number') total += s.size;
      } catch {
        // 按 0 计
      }
    }
    return total;
  };

  const files = walk(dir);
  const sizeBytes = sumSizes(files);

  let top = [];
  try {
    top = readDir(dir) || [];
  } catch {
    top = [];
  }
  const artifacts = top.map((e) => ({ name: e.name, type: isDirEntry(e) ? 'directory' : 'file' }));

  if (main.name) {
    const full = path.join(dir, main.name);
    main.exists = Boolean(exists(full));
    if (main.exists) {
      try {
        const s = stat(full);
        if (s) {
          if (typeof s.mtimeMs === 'number') main.mtimeMs = s.mtimeMs;
          main.isDirectory = typeof s.isDirectory === 'function' && s.isDirectory();
          if (main.isDirectory) {
            // 目录型产物（webgl/weixin 那类）：`stat(dir).size` 在 Windows 上恒 0，
            // 递归求和才是「目录非空」；目录自身的 mtime 在**覆盖写**文件时不更新，
            // 故取目录内文件的**最新** mtime（没有文件时才退回目录自身的 mtime）。
            // ⚠️ R371：这个值只用来判「本轮是否重写」（→ hint），**不**参与 verified。
            const inner = walk(full);
            main.fileCount = inner.length;
            main.sizeBytes = sumSizes(inner);
            for (const f of inner) {
              try {
                const fs2 = stat(f);
                if (fs2 && typeof fs2.mtimeMs === 'number' && (main.mtimeMs === null || fs2.mtimeMs > main.mtimeMs)) {
                  main.mtimeMs = fs2.mtimeMs;
                }
              } catch {
                // 读不到就当没有这个证据（不声称本轮重写过）
              }
            }
          } else {
            main.sizeBytes = typeof s.size === 'number' ? s.size : 0;
            main.fileCount = 1;
          }
        }
      } catch {
        main.sizeBytes = 0;
      }
    }
  }
  return { dirExists: true, fileCount: files.length, sizeBytes, artifacts, mainArtifact: main };
}

/**
 * `unity build`：构建出包 + 写后读回产物。
 *
 * @param {{projectPath?: string, env?: NodeJS.ProcessEnv, target?: string, outDir?: string,
 *   timeoutSeconds?: string|number, _call?: typeof call, _exists?: Function, _readDir?: Function,
 *   _stat?: Function}} [opts] 后四个仅供测试注入（`_call` 之外的读回缝；`_stat` 需提供 `mtimeMs`）。
 * @returns {Promise<object>} 信封；成功时 `verified:true` + `actual.sizeBytes/artifacts` 实测
 */
async function buildGame({
  projectPath, env, target, outDir, timeoutSeconds, _call, _exists, _readDir, _stat,
} = {}) {
  // ── 用法错：全部在**任何 uloop 调用之前**收敛（约束 16）──
  if (typeof projectPath !== 'string' || projectPath === '') {
    return fail({
      code: 'MISSING_PROJECT_PATH',
      message: '需要 --project-path（构建哪个项目不能靠 uloop 默认兜底）',
      actual: { target: target ?? null },
      hint: [
        `用法：${USAGE}`,
        '不给时 uloop 会解析到它自己的默认工程 —— 可能不是你这次要发布的那个',
      ],
    });
  }
  if (target === undefined) {
    return fail({
      code: 'MISSING_TO',
      message: '缺少 --target（构建目标）',
      actual: { target: null },
      hint: [
        `用法：${USAGE}`,
        `目标表：${TARGET_NAMES.join(' / ')}（还要本机**真的装了**对应模块才可用，用 \`unity doctor\` 的 build-targets 看）`,
      ],
    });
  }
  if (typeof target !== 'string' || !Object.hasOwn(TARGETS, target)) {
    return fail({
      code: 'BAD_ACTION',
      message: `--target 不在支持的目标表内：${JSON.stringify(target)}`,
      actual: { target, availableInTable: TARGET_NAMES },
      hint: [`目标表：${TARGET_NAMES.join(' / ')}`, '目标名必须逐字一致（小写）'],
    });
  }
  if (typeof outDir !== 'string' || outDir === '') {
    return fail({
      code: 'BAD_OUT_DIR',
      message: `--out 需要非空字符串目录，收到 ${JSON.stringify(outDir)}`,
      actual: { outDir: outDir === undefined ? null : outDir },
      hint: [
        `用法：${USAGE}`,
        '建议传**绝对路径**并放在项目之外（相对路径按当前 shell 的 cwd 解析成绝对路径后再发给编辑器）',
      ],
    });
  }
  const timeout = parseTimeoutSeconds(timeoutSeconds);
  if (timeout === null) {
    return fail({
      code: 'BAD_TIMEOUT',
      message: `--timeout-seconds 需要正整数，收到 ${JSON.stringify(timeoutSeconds)}`,
      actual: { timeoutSeconds },
      hint: ['上游默认 600 秒；大场景/首次切平台会明显更慢，按需调大'],
    });
  }

  const absOut = path.resolve(outDir);
  const spec = TARGETS[target];
  const candidates = TARGET_NAMES.map((name) => ({ name, ...TARGETS[name] }));
  const payload = { target, outDir: absOut, outputExtension: spec.outputExtension, candidates };
  const intent = { built: true, target };

  const startedAt = Date.now();
  const r = await (_call || call)(
    'execute-dynamic-code',
    buildPayloadArgs('build-player', payload),
    { projectPath, env, timeoutMs: timeout * 1000 },
  );
  const roundTripSeconds = Math.round((Date.now() - startedAt) / 10) / 100; // 秒，两位小数（含 uloop 传输开销）

  // 超时优先：uloop 客户端已退出 ≠ 编辑器停了 —— 报 BUILD_TIMEOUT（比泛化的 ULOOP_TRUNCATED 精确）。
  if (r && r.timedOut === true) {
    return fail({
      code: 'BUILD_TIMEOUT',
      message: `构建超时（--timeout-seconds ${timeout} 到点，uloop 客户端已退出）`,
      intent,
      actual: { target, outDir: absOut, timeoutSeconds: timeout },
      hint: [
        'uloop 客户端超时**不代表编辑器停了** —— BuildPipeline 可能仍在编辑器里继续跑',
        `先等一会儿，再用 \`unity scene tree\` / \`unity doctor\` 确认编辑器恢复；并检查 ${absOut} —— 它可能只有**半成品**（那次构建从未被读回校验），`
          + '先按 `fileCount` / `sizeBytes` / `mainArtifact` 口径核对是否完整；**不确定就直接重跑本命令**（Unity 增量缓存下约 2s），别拿它冒充本次产物',
        `大场景请把 --timeout-seconds 调大（当前 ${timeout}s）`,
      ],
      phase: 'build',
    });
  }
  const envl = envelopeFromCall(r);
  if (!envl.ok) {
    return { ...envl, intent, hint: [...(Array.isArray(envl.hint) ? envl.hint : []), NEEDS_EDITOR_HINT] };
  }

  const res = parseScriptResult(r, {
    label: 'build-player',
    describeError: (code, parsed) => {
      if (code === 'BUILD_TARGET_UNAVAILABLE') {
        const available = Array.isArray(parsed.available) ? parsed.available : [];
        return {
          message: `构建目标不可用：${parsed.target}（本机没装这个 PlaybackEngines 模块）`,
          actual: { target: parsed.target ?? null, available },
          hint: [
            `可用目标：${available.length ? available.join(' / ') : '（无）'}`,
            '用 `unity doctor` 的 build-targets 项看已装模块；缺的要去团结 Hub 给这个编辑器版本补装',
            '绝不自动改打别的目标 —— 目标必须由你显式指定',
          ],
        };
      }
      if (code === 'BUILD_NO_SCENES') {
        return {
          message: '没有可构建的场景（Build Settings 里没有启用的场景，当前也没有打开已保存的场景）',
          hint: [
            '先用 `unity scene save --path Assets/Scenes/X.scene` 把场景落盘，并在 Build Settings 里勾上它',
            '场景清单取自 EditorBuildSettings.scenes；本命令不修改项目设置',
          ],
        };
      }
      if (code === 'OUT_DIR_UNWRITABLE') {
        return {
          message: `输出目录建不了/写不进去：${absOut}${parsed.detail ? ` —— ${parsed.detail}` : ''}`,
          actual: { outDir: absOut, detail: typeof parsed.detail === 'string' ? parsed.detail : null },
          hint: [
            `换一个可写目录：${absOut} 建不了/写不进去（例如项目之外的绝对路径，如 C:/build-out）`,
            '确认磁盘空间/权限/杀软拦截；路径含空格时整条 argv 用引号包住',
          ],
        };
      }
      if (code === 'BUILD_FAILED') {
        return {
          message: `构建过程抛异常：${typeof parsed.detail === 'string' ? parsed.detail.split('\n')[0] : '见 actual.detail'}`,
          actual: { target, outDir: absOut, detail: typeof parsed.detail === 'string' ? parsed.detail : null },
          hint: [
            '看编辑器控制台（`unity play logs --log-type Error`）定位完整栈',
            '产物未产出 —— 不要拿上一次的旧产物冒充本次结果',
          ],
        };
      }
      return undefined;
    },
  });
  if (res.envelope) {
    return { ...res.envelope, intent, hint: [...(res.envelope.hint || []), NEEDS_EDITOR_HINT] };
  }

  const p = res.parsed;
  // 协议漂移（脚本换了形状）→ 不猜：字段缺失即失败（U11 的纪律）
  if (typeof p.result !== 'string' || typeof p.totalErrors !== 'number') {
    return fail({
      code: 'BAD_SCRIPT_RESULT',
      message: 'build-player 的返回值缺少决定性字段（result / totalErrors）——不猜成成功',
      intent,
      actual: { raw: p, roundTripSeconds },
      hint: ['检查 unity-scripts/build-player.cs 的返回协议与 lib/build.js 读取的字段是否一致'],
    });
  }

  const errors = compressIssues(p.Errors);
  const warnings = compressIssues(p.Warnings);
  const actual = {
    target,
    outDir: absOut,
    result: p.result,
    totalErrors: p.totalErrors,
    totalWarnings: typeof p.totalWarnings === 'number' ? p.totalWarnings : null,
    sizeBytes: null, // 由写后读回填（实测）
    artifacts: [], // 由写后读回填（实际目录内容）
    durationSeconds: typeof p.durationSeconds === 'number' ? p.durationSeconds : null,
    roundTripSeconds,
    reportedSizeBytes: typeof p.totalSize === 'number' ? p.totalSize : null,
    outputPath: typeof p.outputPath === 'string' ? p.outputPath : null,
    productName: typeof p.productName === 'string' ? p.productName : null,
    scenes: Array.isArray(p.scenes) ? p.scenes : [],
    sceneCount: typeof p.sceneCount === 'number' ? p.sceneCount : null,
    stepsTruncated: p.stepsTruncated === true,
    errors,
    warnings,
  };

  // ── 构建结论：result 不是 Succeeded、或有错误 → 失败（矛盾形态按失败处理，不猜）──
  if (p.result !== 'Succeeded' || p.totalErrors > 0) {
    const contradictory = p.result === 'Succeeded';
    const hint = [];
    if (errors.length > 0) hint.push(`首条错误：${errors[0].file ?? '?'}:${errors[0].line ?? '?'} ${errors[0].message}`);
    hint.push('看编辑器控制台（`unity play logs --log-type Error`）拿完整错误');
    hint.push('修完重跑本命令；产物未产出 —— 不要拿旧产物冒充');
    return fail({
      code: 'BUILD_FAILED',
      message: contradictory
        ? `构建报告自相矛盾：result=Succeeded 却有 ${p.totalErrors} 个错误 —— 按失败处理`
        : `构建失败：result=${p.result}，errors=${p.totalErrors}，warnings=${p.totalWarnings ?? '?'}`,
      intent,
      actual,
      hint,
      phase: 'build',
    });
  }

  // ── 写后读回（约束 15 / 假绿防线）：report 说什么都不算数，磁盘上有才算 ──
  //    四道判据（R364/R371）：① 目录一致 ② 主产物存在 ③ 主产物非空 ④ fileCount/sizeBytes > 0。
  //    主产物「本轮是否被重写」（mtime）**不是**判据，只产出 hint（R371）。
  const mainName = actual.outputPath ? path.basename(actual.outputPath) : null;
  const rb = readBackArtifacts({ dir: absOut, mainName, _exists, _readDir, _stat });
  actual.sizeBytes = rb.sizeBytes;
  actual.artifacts = rb.artifacts;
  actual.fileCount = rb.fileCount;
  actual.mainArtifact = rb.mainArtifact;

  const mismatches = [];
  if (!rb.dirExists) mismatches.push({ key: 'outDir', intent: absOut, actual: null });
  if (!mainName) {
    mismatches.push({ key: 'outputPath', intent: '非空（report 必须给出主产物路径）', actual: actual.outputPath });
  } else {
    // R364①：outputPath 只比 basename 不够 —— report 把它指到**别的目录**时，
    // `--out` 里恰好留着上一轮的同名产物就会假绿。目录必须等于 --out 的绝对路径
    // （R368：win32 下按小写比较 —— 只有大小写不同的是**同一个目录**，不许误红）。
    const declaredDir = path.dirname(path.resolve(actual.outputPath));
    if (dirCompareKey(declaredDir) !== dirCompareKey(absOut)) {
      mismatches.push({ key: 'outputPath.dir', intent: absOut, actual: declaredDir });
    }
    if (rb.dirExists && !rb.mainArtifact.exists) {
      mismatches.push({ key: 'mainArtifact', intent: mainName, actual: null });
    }
    // R364② / D-fix：主产物**非空**（目录型产物同样要求递归非空 —— 空目录不算产物）。
    if (rb.mainArtifact.exists && rb.mainArtifact.sizeBytes === 0) {
      mismatches.push({ key: 'mainArtifact.sizeBytes', intent: '> 0', actual: 0 });
    }
  }

  // R371：主产物**未被本轮重写**不是失败 —— 同 `--out` 增量/无改动重跑时 Unity 判定「已最新」
  // 而不重写产物是**正确行为**（R364 要防的「别的目录里的上一轮同名产物」已由上面的目录一致性堵死，
  // 「压根没产出」由存在/非空/count/size 堵死）。mtime 只用来在成功信封里加一句 hint。
  // mtime 非数字 = 证据缺失：不判红、也**不说**「未在本轮被重写」（拿不到证据就不声称）。
  const mainNotRewritten = mainName !== null && rb.mainArtifact.exists
    && typeof rb.mainArtifact.mtimeMs === 'number'
    && rb.mainArtifact.mtimeMs < startedAt - MTIME_SLACK_MS;
  if (rb.dirExists && rb.fileCount === 0) mismatches.push({ key: 'fileCount', intent: '> 0', actual: 0 });
  if (rb.dirExists && rb.sizeBytes === 0) mismatches.push({ key: 'sizeBytes', intent: '> 0', actual: 0 });

  if (mismatches.length > 0) {
    return {
      ...fail({
        code: 'ARTIFACT_MISSING',
        message: `report 说构建成功（result=Succeeded）但磁盘上没有可用产物：${mismatches.map((m) => m.key).join(', ')}`,
        intent,
        actual,
        hint: [
          `读回的目录：${absOut}（实测 ${rb.fileCount} 个文件 / ${rb.sizeBytes} 字节）`,
          '不要谎报成功、也不要拿旧产物冒充：先确认 --out 指向的目录是不是 report 的 outputPath 所在目录、'
            + '构建是否真的写盘（看编辑器控制台）；主产物 mtime 早于本轮**不构成**失败理由，只说明这一轮没重写它',
          'report 的 Succeeded 只说明「Unity 认为构建成功」，不说明「东西在你的磁盘上」',
        ],
        phase: 'readback',
      }),
      mismatches,
    };
  }

  const hint = [
    `产物实测：${rb.fileCount} 个文件 / ${rb.sizeBytes} 字节（report 报 ${actual.reportedSizeBytes ?? '?'}，两者口径不同）`,
    'artifacts 是输出目录的**实际**内容（不硬编码 Unity 官方产物名）；主产物见 actual.mainArtifact',
    '「构建成功 ≠ 能跑」：要交付前请启动主可执行文件并看 player.log（见 SKILL 的构建出节）',
  ];
  if (mainNotRewritten) hint.push(MAIN_NOT_REWRITTEN_HINT);

  return {
    ...ok(actual, { verified: true, intent, hint }),
    mismatches: [],
  };
}

module.exports = {
  buildGame, TARGETS, readBackArtifacts, parseTimeoutSeconds, DEFAULT_TIMEOUT_SECONDS, MTIME_SLACK_MS,
};
