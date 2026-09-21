'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { extractJson, findDispatcher, call } = require('../lib/uloop.js');
const { run } = require('../lib/exec.js');

const FAKE = path.join(__dirname, 'fixtures', 'fake-uloop.js');

// 约 2MB 输入的性能预算：新实现实测约 20ms，阈值取得很宽松，
// 只用于拦截 O(n²) 退化（旧实现同输入实测约 655ms）。
const BIG_INPUT_BUDGET_MS = 500;

// 病态输入的性能预算：新实现实测约 250ms（已经包含 100 次全量扫描），
// 不封顶时是分钟级，所以这个宽松阈值仍能拦住退化。
const PATHOLOGICAL_BUDGET_MS = 2000;

function fakeEnv(mode) {
  return {
    ...process.env,
    FAKE_MODE: mode,
    PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]),
  };
}

test('extractJson 能从带前置噪声的输出里提取 JSON', () => {
  const text = 'uloop: downloading pinned project runner 3.4.0...\n{"Version":"3.4.0"}\n';
  assert.deepStrictEqual(extractJson(text), { Version: '3.4.0' });
});

test('extractJson 对非 JSON 返回 null', () => {
  assert.strictEqual(extractJson('not json at all'), null);
});

test('成功时从 stdout 取 JSON，退出码 0', async () => {
  const r = await call('list', [], { env: fakeEnv('ok') });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.json.Version, '3.4.0');
  // 完整输出（close 到达）不得被当成截断
  assert.strictEqual(r.drained, false);
  assert.strictEqual(r.truncated, false);
});

test('带噪声的成功输出也能解析', async () => {
  const r = await call('list', [], { env: fakeEnv('noisy') });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.json.Version, '3.4.0');
});

test('失败时从 stderr 取 JSON，退出码 1', async () => {
  const r = await call('list', [], { env: fakeEnv('fail') });
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.json.Error.ErrorCode, 'UNITY_NOT_REACHABLE');
});

test('成功(0)但 stdout 为空、stderr 是垃圾时 json 为 null（调用方据此报错）', async () => {
  const r = await call('list', [], { env: fakeEnv('garbage') });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.json, null);
  assert.strictEqual(r.truncated, false);
});

test('成功(0)且 stdout 非空但无 JSON 时 json 为 null', async () => {
  const r = await call('list', [], { env: fakeEnv('nojson') });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.length > 0, 'fixture 应把垃圾写到 stdout');
  assert.strictEqual(r.json, null);
});

// ── 补充：extractJson 的边界与性能（task-3-report.md 疑虑 1 / 疑虑 2）─────────

test('extractJson 能处理 JSON 之后含 `}` 的噪声行（旧实现的反例）', () => {
  assert.deepStrictEqual(extractJson('{"a":1}\nuloop: hint {x}\n'), { a: 1 });
});

test('extractJson 能处理字符串字面量内含大括号的 JSON', () => {
  const text = '{"a":"}{","b":"{{{"}\nuloop: hint {x}\n';
  assert.deepStrictEqual(extractJson(text), { a: '}{', b: '{{{' });
});

test('extractJson 不会把 `\\"` 误判为字符串结束', () => {
  const text = '{"a":"b\\"c"}\nuloop: hint {x}\n';
  assert.deepStrictEqual(extractJson(text), { a: 'b"c' });
});

test('extractJson 不会把结尾的转义反斜杠当成转义引号', () => {
  // JSON 文本：{"a":"x\\"}，其值 x\
  const text = '{"a":"x\\\\"}\nuloop: hint {x}\n';
  assert.deepStrictEqual(extractJson(text), { a: 'x\\' });
});

test('顶层数组不在契约内，extractJson 返回 null', () => {
  assert.strictEqual(extractJson('[{"a":1}]'), null);
  assert.strictEqual(extractJson('  \n[1,2,3]\n'), null);
});

test('约 2MB JSON + 含大括号的尾部噪声：正确解析且不退化到 O(n²)', () => {
  const count = 60000;
  const payload = { items: [] };
  for (let i = 0; i < count; i++) payload.items.push({ id: i, name: `item-${i}` });
  const text = `${JSON.stringify(payload)}\nuloop: done in 120ms {marker}\n`;

  const started = process.hrtime.bigint();
  const parsed = extractJson(text);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  // 分段断言：避免在失败时对 6 万个元素做大体积 diff（那本身就会卡死测试）。
  assert.ok(parsed !== null, '应能从含大括号尾部噪声的输出中解析出 JSON');
  assert.strictEqual(parsed.items.length, count);
  assert.deepStrictEqual(parsed.items.slice(0, 50), payload.items.slice(0, 50));
  assert.deepStrictEqual(parsed.items.slice(-50), payload.items.slice(-50));
  assert.ok(
    elapsedMs < BIG_INPUT_BUDGET_MS,
    `解析耗时 ${elapsedMs.toFixed(1)}ms，超出预算 ${BIG_INPUT_BUDGET_MS}ms`,
  );
});

test('噪声行内部的 JSON 片段不会遮蔽后面真正的载荷（行首候选优先）', () => {
  // 旧实现按「第一个可解析候选」返回，噪声行里内嵌的 {"id":"noise"} 会遮蔽真载荷，
  // 静默产出错值 —— 比返回 null 更危险。
  const text = 'uloop: config {"id":"noise"} start\n{"Version":"3.4.0","Tools":[]}\n';
  assert.deepStrictEqual(extractJson(text), { Version: '3.4.0', Tools: [] });

  // 同一形态 + 尾部诊断行（含 JSON 片段）：仍取行首的真载荷
  const withTail = 'uloop: {"id":"noise"}\n{"ok":true}\nuloop: tail {"x":1}';
  assert.deepStrictEqual(extractJson(withTail), { ok: true });
});

// ── 补充：findDispatcher / call 的 argv 契约（全局约束 14：不按空格切分）─────

test('findDispatcher 不按空格切分 PI_UNITY_ULOOP_CMD', () => {
  const env = {
    PI_UNITY_ULOOP_CMD: JSON.stringify(['C:/Program Files/node.exe', 'a b.js']),
  };
  assert.deepStrictEqual(findDispatcher({ env }), {
    cmd: 'C:/Program Files/node.exe',
    prefixArgs: ['a b.js'],
  });
  // 多个含空格的前缀参数同样原样保留
  const multi = {
    PI_UNITY_ULOOP_CMD: JSON.stringify(['C:/Program Files/node.exe', 'dir with space/a.js', 'b c']),
  };
  assert.deepStrictEqual(findDispatcher({ env: multi }), {
    cmd: 'C:/Program Files/node.exe',
    prefixArgs: ['dir with space/a.js', 'b c'],
  });
});

test('call 把含空格的 projectPath 原样作为单个 argv 元素传递', async () => {
  const r = await call('list', ['--json'], {
    projectPath: 'C:/My Game/Unity Project',
    env: fakeEnv('echo-argv'),
  });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(r.json.argv, [
    '--project-path', 'C:/My Game/Unity Project', 'list', '--json',
  ]);
});

// ── 补充：截断/超时输出不得产出伪 json（审查 Important 1）───────────────────

test('超时截断的 JSON 片段不会被当成成功结果：json 为 null 且 truncated', async () => {
  const r = await call('list', [], { env: fakeEnv('truncated'), timeoutMs: 500 });
  assert.strictEqual(r.timedOut, true);
  // 断言前先确认 fixture 确实吐出了可被旧实现误解析的截断载荷
  assert.ok(r.stdout.includes('"Items"'), 'fixture 应已写出截断的 JSON');
  assert.strictEqual(r.json, null);
  assert.strictEqual(r.truncated, true);
});

test('dispatcher 启动失败时 json 为 null 且 truncated 为 true', async () => {
  const missing = path.join(__dirname, 'fixtures', 'no-such-uloop-binary.exe');
  const r = await call('list', [], {
    env: { ...process.env, PI_UNITY_ULOOP_CMD: JSON.stringify([missing]) },
  });
  assert.ok(r.spawnError, '应带 spawnError');
  assert.strictEqual(r.json, null);
  assert.strictEqual(r.truncated, true);
});

test('drain 宽限截断（drained=true）时 json 为 null 且 truncated 为 true', async () => {
  const truncatedPayload = '{"Success":true,"Items":[{"id":1},';
  // 先证明该载荷确实会被 extractJson 解析出「看起来合法」的伪对象，
  // 否则本测试无法证明 drained 这条闸门真的拦住了静默错值。
  assert.deepStrictEqual(extractJson(truncatedPayload), { id: 1 });

  const r = await call('list', [], {
    env: fakeEnv('ok'),
    // 注入假 run 结果：模拟 run() 走了 drain 兜底（close 缺席、宽限到期收尾）
    runImpl: async () => ({
      code: 0, stdout: truncatedPayload, stderr: '', timedOut: false, drained: true,
    }),
  });

  assert.strictEqual(r.drained, true, 'drained 应透传到 call() 的返回值');
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.json, null, '输出被截断时不得返回从残缺载荷里解析出的伪对象');
});

test('端到端：exec 的 drained 经 call 透传后拦住残缺载荷（两文件字段不脱节）', async () => {
  // 本用例不断言 mock 行为：跑的是真正的 exec.run，只把子进程换成假实现，
  // 从而验证 lib/exec.js 的 drained 与 lib/uloop.js 的 truncated 真的接在一起。
  const fake = new EventEmitter();
  fake.pid = 4242;
  fake.stdout = new PassThrough();
  fake.stderr = new PassThrough();
  fake.kill = () => true;

  const pending = call('list', [], {
    env: fakeEnv('ok'),
    runImpl: (cmd, args, opts) => run(cmd, args, {
      ...opts, timeoutMs: 10000, drainGraceMs: 20, spawnImpl: () => fake,
    }),
  });

  fake.stdout.write('{"Success":true,"Items":[{"id":1},');
  await new Promise((resolve) => setImmediate(resolve));
  fake.emit('exit', 0, null); // 进程退出，但管道被占住 → close 永不到来

  const r = await pending;
  assert.strictEqual(r.drained, true, 'exec 的 drain 截断信号应经 call 透传出来');
  assert.strictEqual(r.timedOut, false);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.json, null, 'drain 截断时不得把残缺载荷解析成伪结果');
});

test('病态输入（大量未闭合 `{`）下候选数被封顶，不会 O(n²) 爆炸', () => {
  // 10 万个 `{` 且全文无 `}`：每个候选的配对扫描都要跑到 EOF。
  // 若不封顶，约为 100000 × 1.2MB 次字符扫描（分钟级）。
  const text = `${'{'.repeat(100000)}\n${'no closing brace here\n'.repeat(50000)}`;

  const started = process.hrtime.bigint();
  const parsed = extractJson(text);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.strictEqual(parsed, null);
  assert.ok(
    elapsedMs < PATHOLOGICAL_BUDGET_MS,
    `解析耗时 ${elapsedMs.toFixed(1)}ms，超出预算 ${PATHOLOGICAL_BUDGET_MS}ms`,
  );
});
