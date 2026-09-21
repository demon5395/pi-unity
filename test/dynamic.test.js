'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execCode } = require('../lib/dynamic.js');
const { exitCodeFor } = require('../lib/envelope.js');

/** 照 test/play.test.js 的 fakeCall 写法：记录工具级 argv（不含 --project-path 与工具名）。 */
function fakeCall(json, spy = [], extra = {}) {
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    return {
      code: 0, stdout: '', stderr: '', timedOut: false, drained: false,
      json, truncated: false, tool, args, ...extra,
    };
  };
}

/** 写一个临时脚本文件（真实磁盘文件，供 --code-file 的存在性检查）。 */
function tempScript(body = 'return 1;') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-exec-'));
  const f = path.join(dir, 'probe.cs');
  fs.writeFileSync(f, body);
  return f;
}

test('execCode --code-file 成功：verified 恒 null、actual.result 原样、argv 是绝对路径、退出码 0', async () => {
  const file = tempScript();
  const spy = [];
  const e = await execCode({
    projectPath: 'P', codeFile: file,
    _call: fakeCall({ Success: true, Result: '42' }, spy),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, null, '执行/读命令没有 intent：verified 必须恒为 null');
  assert.strictEqual(e.intent, null);
  assert.deepStrictEqual(e.actual, { result: '42' });
  assert.strictEqual(exitCodeFor(e), 0);
  assert.strictEqual(spy.length, 1);
  assert.strictEqual(spy[0].tool, 'execute-dynamic-code');
  assert.deepStrictEqual(spy[0].args, ['--code-file', path.resolve(file)]);
  assert.ok(path.isAbsolute(spy[0].args[1]), '发给 uloop 的必须是绝对路径');
  assert.strictEqual(spy[0].opts.projectPath, 'P');
  assert.ok(e.hint.some((h) => /actual\.result/.test(h)), '成功 hint 要说明取值位置');
});

test('execCode --code 内联：argv 是 [--code, 原文本]（不走 --parameters）', async () => {
  const spy = [];
  const e = await execCode({
    projectPath: 'P', code: 'return 1;',
    _call: fakeCall({ Success: true, Result: '1' }, spy),
  });
  assert.strictEqual(e.ok, true);
  assert.deepStrictEqual(spy[0].args, ['--code', 'return 1;']);
  assert.strictEqual(e.actual.result, '1');
});

test('Result 缺失 → actual.result 为 null（不编造）', async () => {
  const spy = [];
  const e = await execCode({
    projectPath: 'P', code: 'void noop() {}',
    _call: fakeCall({ Success: true }, spy),
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, null);
  assert.strictEqual(e.actual.result, null);
});

test('两种源都缺 → MISSING_SOURCE、退出码 2、不调 uloop', async () => {
  const spy = [];
  const e = await execCode({ projectPath: 'P', _call: fakeCall({ Success: true, Result: 'x' }, spy) });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'MISSING_SOURCE');
  assert.strictEqual(exitCodeFor(e), 2);
  assert.strictEqual(spy.length, 0, '用法错必须在任何 uloop 调用之前收敛');
});

test('两种源都给 → BAD_SOURCE、退出码 2、不调 uloop', async () => {
  const spy = [];
  const e = await execCode({
    projectPath: 'P', codeFile: tempScript(), code: 'return 1;',
    _call: fakeCall({ Success: true, Result: 'x' }, spy),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'BAD_SOURCE');
  assert.strictEqual(exitCodeFor(e), 2);
  assert.strictEqual(spy.length, 0);
});

test('裸写 / 空串 / 非字符串源 → BAD_SOURCE、退出码 2、不调 uloop', async () => {
  // `--code-file` / `--code` 不带值时 parseArgs 给布尔 true；`--code-file=` 给空串。
  const bad = [
    { codeFile: true }, { code: true },
    { codeFile: '' }, { code: '' },
    { codeFile: 42 }, { code: ['return 1;'] },
  ];
  for (const input of bad) {
    const spy = [];
    const e = await execCode({ projectPath: 'P', ...input, _call: fakeCall({ Success: true, Result: 'x' }, spy) });
    assert.strictEqual(e.ok, false, `${JSON.stringify(input)} 必须失败`);
    assert.strictEqual(e.code, 'BAD_SOURCE', `${JSON.stringify(input)} → BAD_SOURCE`);
    assert.strictEqual(exitCodeFor(e), 2, `${JSON.stringify(input)} → 退出码 2`);
    assert.strictEqual(spy.length, 0, `${JSON.stringify(input)} 不得调 uloop`);
  }
});

test('--code-file 指向不存在的文件 → SOURCE_NOT_FOUND（运行时错，退出码 1）、不调 uloop', async () => {
  const spy = [];
  const missing = path.join(os.tmpdir(), 'piu-exec-definitely-missing', 'nope.cs');
  const e = await execCode({
    projectPath: 'P', codeFile: missing,
    _call: fakeCall({ Success: true, Result: 'x' }, spy),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'SOURCE_NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1, 'SOURCE_NOT_FOUND 不在用法错冻结表内 → 1');
  assert.strictEqual(spy.length, 0);
});

test('uloop 输出被截断 → ULOOP_TRUNCATED、ok:false、退出码 1（绝不假绿）', async () => {
  const spy = [];
  const truncatedCall = async (tool, args) => {
    spy.push({ tool, args });
    return {
      code: 0, stdout: '{"Success":true,"Result":"42"', stderr: '', timedOut: false,
      drained: true, json: null, truncated: true, tool, args,
    };
  };
  const e = await execCode({ projectPath: 'P', code: 'return 42;', _call: truncatedCall });
  assert.strictEqual(e.ok, false, '截断绝不产 ok:true');
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
  assert.notStrictEqual(e.actual && e.actual.result, '42');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('uloop 失败 → 原错误码透传、退出码 1（不额外编造写入类 hint）', async () => {
  const spy = [];
  const e = await execCode({
    projectPath: 'P', code: 'boom();',
    _call: fakeCall({ Success: false, Error: { ErrorCode: 'SCRIPT_COMPILE_ERROR', Message: 'boom' } }, spy),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'SCRIPT_COMPILE_ERROR');
  assert.strictEqual(e.message, 'boom');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(!e.hint.some((h) => /写入|未生效|已经生效/.test(h)), '本命令不写场景，不得套用写入类 hint');
});

test('R352 编译错形状（Success:false + CompilationErrors）→ SCRIPT_COMPILE_ERROR、带首条 file:line、退出码 1', async () => {
  // 真机形状（docs/CAPABILITIES-tuanjie-2022.3.62t9.md §4.2）：编译错时**没有** ErrorCode/Message，
  // 诊断全在 CompilationErrors[]。旧路径只读 ErrorCode/Message → 落成 message 为空的 ULOOP_ERROR（报错误导）。
  const spy = [];
  const e = await execCode({
    projectPath: 'P', code: 'g.score',
    _call: fakeCall({
      Success: false,
      Error: 'Compilation error occurred',
      CompilationErrors: [{ Message: "CS1061: 'Component' does not contain 'score'", File: 'Assets/PiDynamic.cs', Line: 12 }],
      ErrorMessage: 'Compilation error occurred',
    }, spy),
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'SCRIPT_COMPILE_ERROR', '编译错必须走专用码，不能落成空 message 的 ULOOP_ERROR');
  assert.strictEqual(exitCodeFor(e), 1, 'SCRIPT_COMPILE_ERROR 不在用法错冻结表内 → 运行时错退出码 1');
  assert.strictEqual(e.actual.errors[0].line, 12);
  assert.strictEqual(e.actual.errors[0].file, 'Assets/PiDynamic.cs');
  assert.match(e.message, /Assets\/PiDynamic\.cs:12/, 'message 必须带首条 file:line，agent 靠它自修');
  assert.ok(e.hint.some((h) => h.includes('CS1061')), 'hint 必须含首条错误信息');
});

test('R352 反证：Success:false + Error.ErrorCode（无 CompilationErrors）→ 仍走 envelopeFromCall 原码透传', async () => {
  const spy = [];
  const e = await execCode({
    projectPath: 'P', code: 'g.score',
    _call: fakeCall({ Success: false, Error: { ErrorCode: 'X', Message: 'boom' } }, spy),
  });
  assert.strictEqual(e.code, 'X', '没有 CompilationErrors 的形状不得被新分支吞掉');
  assert.strictEqual(e.message, 'boom');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('R475/U48：真机并发被拒载荷（Success:false + CompilationErrors:[] + ErrorMessage）→ ULOOP_ERROR 可重试 + 单飞 hint，绝不误报 SCRIPT_COMPILE_ERROR', async () => {
  // 载荷逐字对齐真机上游形（docs/m5-probes-raw/p4-1.json 的 ErrorMessage 分支；docs/M5-PROBES.md P2）：
  // 并发被拒时 CompilationErrors 是**空数组**、且**没有** ErrorCode。旧内联判据
  // `Success === false && Array.isArray(CompilationErrors)` 会把空数组误判成编译失败（U48）。
  const spy = [];
  const e = await execCode({
    projectPath: 'P', code: 'return 1;',
    _call: fakeCall({
      Success: false,
      CompilationErrors: [],
      ErrorMessage: 'Another execution is already in progress',
    }, spy),
  });
  assert.strictEqual(e.code, 'ULOOP_ERROR', '并发被拒不得落成 SCRIPT_COMPILE_ERROR（U48）');
  assert.notStrictEqual(e.code, 'SCRIPT_COMPILE_ERROR');
  assert.match(e.message, /Another execution is already in progress/);
  assert.strictEqual(e.retryable, true, '并发被拒是瞬时的，必须可重试');
  assert.ok(e.hint.some((h) => h.includes('单飞')), '必须给出中文串行重试 hint');
  assert.strictEqual(exitCodeFor(e), 1);
});

// ─────────────────── CLI 级（main([...]) 端到端，照 test/asset.test.js 的 withScriptedDispatcher）───────────────────

async function withScriptedDispatcher(scriptBody, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-exec-scripted-'));
  const fake = path.join(dir, 'fake-uloop.js');
  fs.writeFileSync(fake, scriptBody);
  const saved = process.env.PI_UNITY_ULOOP_CMD;
  process.env.PI_UNITY_ULOOP_CMD = JSON.stringify([process.execPath, fake]);
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.PI_UNITY_ULOOP_CMD;
    else process.env.PI_UNITY_ULOOP_CMD = saved;
  }
}

test('CLI exec --code 成功 → 退出码 0 且 --json 的 actual.result 正确', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout } = require('./helpers/capture.js');
  const run = await withScriptedDispatcher(
    "process.stdout.write(JSON.stringify({ Success: true, Result: 'cli-42' }) + '\\n');",
    () => captureStdout(() => main(['exec', '--project-path', 'X', '--code', 'return 42;', '--json'])),
  );
  assert.strictEqual(run.result, 0);
  const e = JSON.parse(run.out);
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, null);
  assert.strictEqual(e.actual.result, 'cli-42');
});

test('CLI exec 缺源 → 退出码 2 且 code=MISSING_SOURCE', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout } = require('./helpers/capture.js');
  const run = await captureStdout(() => main(['exec', '--project-path', 'X', '--json']));
  assert.strictEqual(run.result, 2);
  const e = JSON.parse(run.out);
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'MISSING_SOURCE');
});

test('CLI exec --code-file：argv 映射到 codeFile，Result 里含 path.resolve 后的绝对路径、退出码 0（R353）', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout } = require('./helpers/capture.js');
  const file = tempScript();
  // 把 dispatcher 收到的 argv 原样回灌进 Result，断言 argv 里确实是绝对路径。
  const body = "const a = process.argv.join(' ');"
    + " process.stdout.write(JSON.stringify({ Success: true, Result: a }) + '\\n');";
  const run = await withScriptedDispatcher(body, () => captureStdout(
    () => main(['exec', '--project-path', 'X', '--code-file', file, '--json']),
  ));
  assert.strictEqual(run.result, 0);
  const e = JSON.parse(run.out);
  assert.strictEqual(e.ok, true);
  assert.ok(e.actual.result.includes(path.resolve(file)), `Result 必须含 path.resolve 后的绝对路径；实际：${e.actual.result}`);
});

test('R354 --code 值以 -- 开头会被 parseArgs 当开关 → BAD_SOURCE 的 hint 给出 --code=<片段> 出路', async () => {
  const { parseArgs } = require('../lib/args.js');
  const spy = [];
  // 复现 CLI 侧的真实解析：`--code --count; return count;` → code:true（误导性「收到 true」）。
  const args = parseArgs(['--code', '--count; return count;']);
  assert.strictEqual(args.code, true, 'parseArgs 把以 -- 开头的值当开关（本用例的前提）');
  const e = await execCode({ projectPath: 'P', code: args.code, _call: fakeCall({ Success: true, Result: 'x' }, spy) });
  assert.strictEqual(e.code, 'BAD_SOURCE');
  assert.ok(
    e.hint.some((h) => h.includes('--code=') && h.includes('开头')),
    '必须给出 `--code=<片段>` 的出路并说明原因（值以 -- 开头会被当开关）',
  );
  assert.strictEqual(spy.length, 0);
});
