'use strict';

const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 120000;
/**
 * `'exit'` 之后等管道 EOF（`'close'`）的宽限。
 * Node 的 `'close'` 要求 stdio 全部 EOF：uloop dispatcher 派生的 runner 会继承
 * stdout/stderr 管道句柄，此时即便直接子进程已正常退出，`'close'` 也可能永不到来。
 */
const DEFAULT_DRAIN_GRACE_MS = 2000;
/** 超时 kill 之后等进程退出的宽限；到期无条件 resolve，杜绝永久挂起。 */
const DEFAULT_KILL_GRACE_MS = 2000;
const WIN32 = 'win32';
const TASKKILL = 'taskkill';
const SIGKILL = 'SIGKILL';

/** 兜底：直接杀子进程；任何失败都吞掉（进程可能已退出）。 */
function safeKill(child, signal) {
  try {
    child.kill(signal);
  } catch {
    // 进程已退出等场景，忽略
  }
}

/**
 * 超时的默认杀进程实现。
 *
 * Windows 上用 `taskkill /PID <pid> /T /F` 杀整棵进程树：uloop dispatcher 会派生
 * `uloop-project-runner` 子进程，且 runner 的命名管道名由项目路径确定性生成，
 * 只杀直接子进程会留下孤儿 runner 占住管道、毒化下一次调用。
 * 其他平台没有进程树原语，退回 `child.kill()`。
 *
 * taskkill 自身失败（可执行文件缺失、进程已退出、pid 不存在）不应抛异常，
 * 也不应影响 `run()` 的返回语义：错误事件与失败退出码只触发兜底直杀。
 *
 * @param {{ pid?: number, kill: (signal?: string) => unknown }} child
 * @param {{ platform?: string }} [opts]
 */
function defaultKillTree(child, { platform = process.platform } = {}) {
  if (platform !== WIN32 || !child.pid) {
    safeKill(child);
    return;
  }
  try {
    const killer = spawn(TASKKILL, ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => safeKill(child));
    killer.on('close', (code) => {
      if (code !== 0) safeKill(child);
    });
    killer.unref();
  } catch {
    safeKill(child);
  }
}

/**
 * 执行子进程并缓冲输出。这是本项目唯一调用 spawn 的地方（便于测试注入）。
 *
 * 收敛保证：`run()` 在任何情况下都会 resolve，不存在永久挂起的路径——
 * `'close'`（管道 EOF）、`'error'`、`'exit'` + drain 宽限、超时 + kill 宽限
 * 四条路径都通向 `finish()`，且 `finish()` 幂等。
 *
 * 完整性信号：`drained` 为 `true` 表示「未等到 `'close'`（管道 EOF）就因 drain
 * 宽限到期而收尾」——此时直接子进程已退出（`timedOut` 仍为 false、`code` 为真实
 * 退出码），但 stdout/stderr **可能被截断**（管道句柄被孤儿孙进程占住，宽限内没读完）。
 * 只有真正等到 `'close'` 的路径 `drained` 才为 `false`。调用方若从输出里解析结构化
 * 数据，必须把 `drained === true` 当作「输出不可信」处理（残缺的 JSON 片段可能恰好
 * 能解析出「看起来合法」的错值）。该字段是纯增量，不影响既有字段语义。
 *
 * 注入点（默认值即生产行为）：
 * - `platform` / `killTree`：测试可断言超时确实走了杀树分支。
 * - `spawnImpl`：测试可伪造子进程，制造「close 永不到来」「kill 完全打空」等
 *   真实进程难以稳定复现的场景。
 * - `drainGraceMs` / `killGraceMs`：宽限可调，测试无需真等 2 秒。
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ timeoutMs?: number, cwd?: string, env?: NodeJS.ProcessEnv,
 *           platform?: string, killTree?: typeof defaultKillTree,
 *           spawnImpl?: typeof spawn, drainGraceMs?: number, killGraceMs?: number }} [opts]
 * @returns {Promise<{code:number, stdout:string, stderr:string, timedOut:boolean,
 *   drained:boolean, spawnError?:Error}>}
 */
function run(cmd, args, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cwd,
  env,
  platform = process.platform,
  killTree = defaultKillTree,
  spawnImpl = spawn,
  drainGraceMs = DEFAULT_DRAIN_GRACE_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
} = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(cmd, args, {
        cwd,
        env: env ?? process.env,
        windowsHide: true,
        // 显式忽略 stdin 并自持 stdout/stderr 管道：阻断子进程/孙进程继承外层句柄，
        // 也让「close 缺席」时的行为可预期。
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: '', timedOut: false, drained: false, spawnError: err });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let drained = false;
    let settled = false;
    let exited = false;
    let exitCode = null;
    let timer = null;
    let drainTimer = null;
    let killTimer = null;

    // setEncoding 走 StringDecoder：跨 chunk 的多字节序列会被正确拼接，
    // 不会像逐 chunk `d.toString('utf8')` 那样在 64KB 边界被切成 U+FFFD。
    if (child.stdout) child.stdout.setEncoding('utf8');
    if (child.stderr) child.stderr.setEncoding('utf8');
    if (child.stdout) child.stdout.on('data', (d) => { stdout += d; });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d; });

    /** 当前已缓冲的输出 + 已知退出码。 */
    const currentResult = () => ({
      code: exitCode ?? -1,
      stdout,
      stderr,
      timedOut,
      drained,
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (drainTimer) clearTimeout(drainTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };

    const finishFromExit = () => finish(currentResult());

    // 超时 kill 之后的收尾：宽限到期先尝试 SIGKILL 升级，再宽限到期无条件 resolve。
    const onKillGrace = () => {
      killTimer = null;
      if (settled) return;
      if (!exited && platform !== WIN32) {
        // 非 Windows 的 child.kill() 是 SIGTERM，可被子进程忽略：升级为 SIGKILL
        safeKill(child, SIGKILL);
        killTimer = setTimeout(finishFromExit, killGraceMs);
        return;
      }
      finishFromExit();
    };

    const scheduleKillSettle = () => {
      if (killTimer) return;
      killTimer = setTimeout(onKillGrace, killGraceMs);
    };

    child.on('error', (err) => finish({ code: -1, stdout, stderr, timedOut, drained: false, spawnError: err }));

    child.on('exit', (code) => {
      exited = true;
      exitCode = code;
      if (settled) return;
      // 进程已退出，但 close 可能被孙进程占住的管道拖住：给一个 drain 宽限兜底
      if (drainTimer) return;
      drainTimer = setTimeout(() => {
        // 没等到 close 就收尾 = 管道可能还没读完：如实标记输出不完整
        drained = true;
        finishFromExit();
      }, drainGraceMs);
    });

    child.on('close', (code) => {
      exited = true;
      if (code !== null && code !== undefined) exitCode = code;
      finish(currentResult());
    });

    timer = setTimeout(() => {
      if (exited) return; // 进程早已正常退出，只是在等管道 EOF：不是超时，交给 drain 宽限
      timedOut = true;
      try {
        killTree(child, { platform });
      } catch {
        // 杀树实现抛错：退回直杀，避免子进程存活导致 close 永不到来
        safeKill(child);
      }
      // kill 可能完全打空（pid 已死、SIGTERM 被忽略、taskkill 失败）：
      // 宽限到期必须无条件 resolve，否则就是永久挂起。
      scheduleKillSettle();
    }, timeoutMs);
  });
}

module.exports = { run, defaultKillTree, DEFAULT_TIMEOUT_MS };
