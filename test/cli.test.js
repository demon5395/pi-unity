'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'unity.js');

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

test('version 打印版本号', () => {
  const r = runCli(['version']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /^pi-unity \d+\.\d+\.\d+/);
});

test('--help 打印用法且退出码 0', () => {
  const r = runCli(['--help']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /Usage: unity <command>/);
  // R477：build 段必须写明 --project-path 必填，且 MISSING_PROJECT_PATH 落在**退出码 2** 那一档
  // （缺参数 = 用法错；此前误归 1 档，与 2 档的定义自相矛盾）
  assert.match(r.stdout, /--project-path <P>\s+必填/, 'build 段必须标出 --project-path 必填');
  assert.doesNotMatch(r.stdout, /ARTIFACT_MISSING \/ MISSING_PROJECT_PATH/, 'R477：1 档清单不得再把 MISSING_PROJECT_PATH 与 ARTIFACT_MISSING 并列');
  // 定位到 build 段（其他命令的说明里也有 MISSING_PROJECT_PATH，不能全局 grep）：
  // 它必须出现在「2 用法错」之后（即 2 档），否则会误导「缺 project-path = 运行时错 1」。
  const buildSection = r.stdout.slice(
    r.stdout.indexOf('build 选项：'),
    r.stdout.indexOf('asset write 选项：'),
  );
  const usageIdx = buildSection.indexOf('2 用法错');
  assert.ok(buildSection.lastIndexOf('MISSING_PROJECT_PATH') > usageIdx, 'build 段里 MISSING_PROJECT_PATH 必须在 2 档之后（属于 2 用法错）');
});

test('未知命令退出码 2 且提示', () => {
  const r = runCli(['nope']);
  assert.strictEqual(r.code, 2);
  assert.match(r.stderr, /unknown command: nope/);
});

test('原型链上的名字一律视为未知命令（退出码 2）', () => {
  // 覆盖 Object.prototype 上的全部名字（含 toString/constructor/hasOwnProperty 等），
  // 它们不是 COMMANDS 的自有属性，必须走 "unknown command" 分支而不是内部错误 3。
  for (const name of Object.getOwnPropertyNames(Object.prototype)) {
    const r = runCli([name]);
    assert.strictEqual(r.code, 2, `命令 ${name} 应以退出码 2 结束`);
    assert.match(r.stderr, /unknown command: /);
  }
});

test('handler 返回非整数时收敛为退出码 0（而不是内部错误 3）', async () => {
  const { main } = require('../bin/unity.js');
  const nonInteger = ['oops', [1, 2], {}, NaN, Infinity, 2.5, null, undefined];
  for (const value of nonInteger) {
    const code = await main(['probe'], { probe: () => value });
    assert.strictEqual(code, 0, `handler 返回 ${String(value)} 时应为 0`);
  }
});

test('handler 返回整数时原样作为退出码', async () => {
  const { main } = require('../bin/unity.js');
  assert.strictEqual(await main(['probe'], { probe: () => 7 }), 7);
});

test('parseArgs 解析 --key value 与 --flag', () => {
  const { parseArgs } = require('../lib/args.js');
  assert.deepStrictEqual(
    parseArgs(['--project-path', 'C:/p', '--smoke', '--max', '3']),
    { 'project-path': 'C:/p', smoke: true, max: '3' }
  );
});

test('D-A2：--flag=1/0/true/false 归一成布尔；非法值 → BAD_FLAG_VALUE（2）', () => {
  const { normalizeBooleans } = require('../lib/args.js');
  const ok1 = normalizeBooleans({ force: '1', json: '0', trim: 'true', smoke: 'false', golden: 'yes', 'no-compile': 'no' });
  assert.strictEqual(ok1.error, undefined);
  assert.deepStrictEqual(ok1.args, { force: true, json: false, trim: true, smoke: false, golden: true, 'no-compile': false });
  const ok2 = normalizeBooleans({ force: true, at: '446,177' });
  assert.deepStrictEqual(ok2.args, { force: true, at: '446,177' }, '带值参数与裸写布尔不受影响');
  const ok3 = normalizeBooleans({ ppu: '1', 'sorting-order': '0', 'max-count': '1', tolerance: '0', duration: '1' });
  assert.deepStrictEqual(ok3.args, { ppu: '1', 'sorting-order': '0', 'max-count': '1', tolerance: '0', duration: '1' },
    '带值参数（数值）不被布尔归一吞掉/改写');
  for (const bad of ['maybe', '', '2', 'yes!']) {
    const r = normalizeBooleans({ force: bad });
    assert.strictEqual(r.error.code, 'BAD_FLAG_VALUE', `--force=${JSON.stringify(bad)} 必须报用法错`);
  }
});

test('D-A2：CLI 上 --json=0 真的关掉 JSON（人读模式不以 { 开头）', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout: cap } = require('./helpers/capture.js');
  const fixture = path.join(__dirname, 'fixtures', 'unity-gameview-892x355.png');
  const human = await cap(() => main(['pixels', '--file', fixture, '--json=0']));
  assert.strictEqual(human.result, 0);
  assert.ok(!human.out.trim().startsWith('{'), `--json=0 必须输出人读模式，实际：${human.out.slice(0, 40)}`);
});

test('D-A2：CLI 上非法布尔值 → 退出码 2（不经信封）', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStderr: capErr } = require('./helpers/capture.js');
  const r = await capErr(() => main(['pixels', '--file', 'x.png', '--json=maybe']));
  assert.strictEqual(r.result, 2);
  assert.match(r.out, /BAD_FLAG_VALUE/);
});

test('D-A2：opts 型 handler（scene）也接了 parseArgsStrict —— 非法布尔值 → 退出码 2', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStderr: capErr } = require('./helpers/capture.js');
  const r = await capErr(() => main(['scene', 'tree', '--json=maybe']));
  assert.strictEqual(r.result, 2);
  assert.match(r.out, /BAD_FLAG_VALUE/);
});

test('D-A2：全部 11 个 handler 都接了 parseArgsStrict —— --json=maybe → 退出码 2 且 BAD_FLAG_VALUE', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStderr: capErr } = require('./helpers/capture.js');
  // 每个形状都要能走到 parseArgsStrict（用法错在 uloop 之前收敛，故不连 Unity）。
  // ⚠️ 必须断言 BAD_FLAG_VALUE（不能只断 2）：别的用法错也会返回 2，只断 2 会「假绿」。
  const shapes = [
    ['scene', 'tree'],
    ['node', 'inspect'],
    ['shot'],
    ['pixels'],
    ['sprite', 'set'],
    ['compile'],
    ['build'],
    ['asset', 'write'],
    ['prefab', 'create'],
    ['play', 'status'],
    ['exec'],
  ];
  assert.strictEqual(shapes.length, 11, '必须覆盖全部 11 个接 parseArgsStrict 的 handler');
  for (const shape of shapes) {
    const argv = [...shape, '--json=maybe'];
    const r = await capErr(() => main(argv));
    assert.strictEqual(r.result, 2, `${argv.join(' ')} 应以退出码 2 结束`);
    assert.match(r.out, /BAD_FLAG_VALUE/, `${argv.join(' ')} 必须报 BAD_FLAG_VALUE`);
  }
});

test('D-A2：BOOLEAN_KEYS 全部 9 个键逐一二值 + 非法值归一', () => {
  const { normalizeBooleans, BOOLEAN_KEYS } = require('../lib/args.js');
  // 直接遍历 BOOLEAN_KEYS（而非手抄 9 个名字）：将来加键自动被覆盖。
  assert.ok(BOOLEAN_KEYS.length >= 9, `布尔键清单不应少于 9 个，实际 ${BOOLEAN_KEYS.length}`);
  for (const key of BOOLEAN_KEYS) {
    const t = normalizeBooleans({ [key]: '1' });
    assert.strictEqual(t.error, undefined, `--${key}=1 不应报错`);
    assert.strictEqual(t.args[key], true, `--${key}=1 应归一为 true`);
    const f = normalizeBooleans({ [key]: '0' });
    assert.strictEqual(f.error, undefined, `--${key}=0 不应报错`);
    assert.strictEqual(f.args[key], false, `--${key}=0 应归一为 false`);
    const bad = normalizeBooleans({ [key]: 'maybe' });
    assert.strictEqual(bad.error && bad.error.code, 'BAD_FLAG_VALUE', `--${key}=maybe 必须报 BAD_FLAG_VALUE`);
  }
});
