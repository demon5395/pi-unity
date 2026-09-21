'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { run, defaultKillTree } = require('../lib/exec.js');

/**
 * 伪造子进程：只实现 run() 会用到的部分（pid / kill / stdout / stderr / 事件）。
 * 用它来精确制造「父进程已退出但管道 EOF 永不到来」「kill 完全打空且进程永不退出」
 * 这类真实进程极难稳定复现（跨平台行为不一致、需真孙进程）的场景。
 */
class FakeChild extends EventEmitter {
  constructor({ pid = 4242 } = {}) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.signals = [];
  }

  kill(signal) {
    this.signals.push(signal);
    return true;
  }
}

/** 给 run() 套一个期限：挂起时快速失败，而不是把整个测试进程拖死。 */
function withDeadline(promise, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 未在 ${ms}ms 内 resolve（疑似永久挂起）`)), ms);
    timer.unref();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

test('捕获 stdout 与退出码', async () => {
  const r = await run(process.execPath, ['-e', 'process.stdout.write("hi")']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, 'hi');
});

test('捕获 stderr 与非零退出码', async () => {
  const r = await run(process.execPath, ['-e', 'process.stderr.write("bad");process.exit(1)']);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.stderr, 'bad');
});

test('命令不存在时返回 code -1 且带 spawnError', async () => {
  const r = await run('definitely-not-a-real-binary-xyz', []);
  assert.strictEqual(r.code, -1);
  assert.ok(r.spawnError instanceof Error);
});

test('超时会被杀掉并标记 timedOut', async () => {
  const r = await run(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { timeoutMs: 300 });
  assert.strictEqual(r.timedOut, true);
});

test('超时走杀进程树分支（注入 killTree 断言）', async () => {
  const calls = [];
  const r = await run(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], {
    timeoutMs: 300,
    killTree: (child, { platform }) => {
      calls.push({ pid: child.pid, platform });
      child.kill();
    },
  });
  assert.strictEqual(r.timedOut, true);
  assert.strictEqual(calls.length, 1);
  assert.ok(Number.isInteger(calls[0].pid) && calls[0].pid > 0);
  assert.strictEqual(calls[0].platform, process.platform);
});

test('杀进程树抛异常时仍 resolve，timedOut 仍为 true', async () => {
  const r = await run(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], {
    timeoutMs: 300,
    killTree: () => { throw new Error('taskkill 不可用'); },
  });
  assert.strictEqual(r.timedOut, true);
  assert.strictEqual(r.spawnError, undefined);
  assert.strictEqual(typeof r.code, 'number');
});

test('默认杀树：非 Windows 或缺失 pid 时退回 child.kill()', () => {
  const makeFake = () => {
    const fake = { pid: 4321, killed: false, kill() { fake.killed = true; } };
    return fake;
  };
  const nonWin = makeFake();
  defaultKillTree(nonWin, { platform: 'linux' });
  assert.strictEqual(nonWin.killed, true);

  const noPid = makeFake();
  noPid.pid = undefined;
  defaultKillTree(noPid, { platform: 'win32' });
  assert.strictEqual(noPid.killed, true);
});

test('父进程已退出但管道被占住（close 永不到来）时仍 resolve，不误报 timedOut，且 drained 为 true', async () => {
  const fake = new FakeChild();
  const started = Date.now();
  const pending = run(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], {
    timeoutMs: 10000,
    drainGraceMs: 50,
    spawnImpl: () => fake,
  });

  fake.stdout.write('前半');
  await new Promise((resolve) => setImmediate(resolve));
  // 直接子进程已退出，但 stdout/stderr 管道句柄被孙进程继承 → 'close' 永不触发
  fake.emit('exit', 0, null);

  const r = await withDeadline(pending, 2000, 'run()');
  const elapsed = Date.now() - started;
  assert.strictEqual(r.timedOut, false, '进程是正常退出，不应因为 close 缺席而被误报超时');
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '前半');
  // drain 宽限到期即收尾：此时输出可能被截断，必须如实标记，
  // 否则调用方无法把「被截断的正常退出」与「完整输出」区分开。
  assert.strictEqual(r.drained, true, '未等到 close 就走了 drain 兜底，必须标记 drained');
  assert.ok(elapsed < 1000, `应在 drain 宽限（50ms）附近收尾，实际 ${elapsed}ms`);
});

test('超时后 kill 完全打空且进程永不退出时，仍在宽限内无条件 resolve 且 timedOut 为 true', async () => {
  const fake = new FakeChild();
  const started = Date.now();
  const r = await withDeadline(
    run('fake-cmd', [], {
      timeoutMs: 50,
      killGraceMs: 50,
      killTree: () => {}, // 模拟 taskkill 打空：pid 已死、命令缺失、权限不足……
      spawnImpl: () => fake,
    }),
    2000,
    'run()',
  );
  const elapsed = Date.now() - started;
  assert.strictEqual(r.timedOut, true);
  assert.strictEqual(r.code, -1);
  assert.ok(elapsed < 1000, `超时后应在 kill 宽限内收尾，实际 ${elapsed}ms`);
});

test('非 Windows 下 SIGTERM 被忽略时升级 SIGKILL，并仍然 resolve', async () => {
  const fake = new FakeChild();
  const r = await withDeadline(
    run('fake-cmd', [], {
      timeoutMs: 30,
      killGraceMs: 30,
      platform: 'linux',
      killTree: () => {}, // 直接子进程忽略 SIGTERM 且永不退出
      spawnImpl: () => fake,
    }),
    2000,
    'run()',
  );
  assert.strictEqual(r.timedOut, true);
  assert.ok(fake.signals.includes('SIGKILL'), `应升级为 SIGKILL，实际信号：${JSON.stringify(fake.signals)}`);
});

test('多字节字符跨 chunk 边界不被截断', async () => {
  const text = '中文节点名'.repeat(20000);
  const buf = Buffer.from(text, 'utf8');
  const CHUNK = 65536; // 64KB 管道块；65536 % 3 === 1，必然切在 3 字节中文字符中间
  assert.notStrictEqual(CHUNK % 3, 0, 'chunk 大小需为 3 的非倍数，否则切不出半个字符');

  const fake = new FakeChild();
  const pending = run('fake-cmd', [], { timeoutMs: 10000, spawnImpl: () => fake });
  for (let off = 0; off < buf.length; off += CHUNK) {
    fake.stdout.write(buf.subarray(off, off + CHUNK));
    await new Promise((resolve) => setImmediate(resolve));
  }
  fake.emit('close', 0, null);

  const r = await withDeadline(pending, 5000, 'run()');
  assert.strictEqual(r.stdout.length, text.length);
  assert.ok(!r.stdout.includes('\uFFFD'), '不得出现替换字符 U+FFFD');
  assert.strictEqual(r.stdout, text);
});

test('spawnImpl 同步抛错时 resolve（不 reject、不挂起）', async () => {
  const r = await withDeadline(
    run('fake-cmd', [], {
      spawnImpl: () => { throw new Error('spawn 同步炸了'); },
    }),
    1000,
    'run()',
  );
  assert.strictEqual(r.code, -1);
  assert.strictEqual(r.timedOut, false);
  assert.ok(r.spawnError instanceof Error);
});

test('只收到 error 事件（close 永不到来）也 resolve', async () => {
  const fake = new FakeChild();
  const pending = run('fake-cmd', [], { timeoutMs: 10000, spawnImpl: () => fake });
  fake.emit('error', new Error('ENOENT'));
  const r = await withDeadline(pending, 1000, 'run()');
  assert.strictEqual(r.code, -1);
  assert.strictEqual(r.timedOut, false);
  assert.ok(r.spawnError instanceof Error);
});

test('正常等到 close 的路径 drained 为 false（输出完整）', async () => {
  const fake = new FakeChild();
  const pending = run('fake-cmd', [], { timeoutMs: 10000, drainGraceMs: 5000, spawnImpl: () => fake });
  fake.stdout.write('完整输出');
  await new Promise((resolve) => setImmediate(resolve));
  fake.emit('close', 0, null);

  const r = await withDeadline(pending, 1000, 'run()');
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '完整输出');
  // close 已到达 = 管道 EOF = 缓冲完整；此时不得标记为截断，
  // 否则会把正常输出也拖进「不可信」分支。
  assert.strictEqual(r.drained, false);
});

test('超时前已产生的 stdout/stderr 被保留', async () => {
  const r = await run(
    process.execPath,
    ['-e', 'process.stdout.write("partial-out");process.stderr.write("partial-err");setTimeout(()=>{},60000)'],
    { timeoutMs: 400 },
  );
  assert.strictEqual(r.timedOut, true);
  assert.strictEqual(r.stdout, 'partial-out');
  assert.strictEqual(r.stderr, 'partial-err');
});
