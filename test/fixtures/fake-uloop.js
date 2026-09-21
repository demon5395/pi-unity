#!/usr/bin/env node
'use strict';
// 假 uloop：按 FAKE_MODE 决定输出流与退出码，用于单测（不依赖编辑器）
const mode = process.env.FAKE_MODE || 'ok';
const payloads = {
  ok: { Version: '3.4.0', Tools: [{ Name: 'compile' }] },
  noisy: null, // 见下：前置噪声 + JSON
  fail: { Success: false, Error: { ErrorCode: 'UNITY_NOT_REACHABLE', Phase: 'connection',
            Message: 'not reachable', Retryable: true,
            NextActions: ['If Unity is closed, run `uloop launch`.'] } },
};
if (mode === 'ok') {
  process.stdout.write(JSON.stringify(payloads.ok, null, 2) + '\n');
  process.exit(0);
}
if (mode === 'noisy') {
  process.stdout.write('uloop: downloading pinned project runner 3.4.0 for windows-amd64...\n');
  process.stdout.write(JSON.stringify(payloads.ok, null, 2) + '\n');
  process.exit(0);
}
if (mode === 'fail') {
  process.stderr.write(JSON.stringify(payloads.fail, null, 2) + '\n');
  process.exit(1);
}
if (mode === 'nojson') {
  // 非 JSON 垃圾写到 **stdout**（与下面的兜底分支写 stderr 相对），
  // 覆盖「code=0 且 stdout 非空但无 JSON」这一被点名关注的场景。
  process.stdout.write('not json at all\n');
  process.exit(0);
}
if (mode === 'echo-argv') {
  // 回显收到的 argv（剔除 node 与脚本自身），用于断言含空格的参数不被按空格切分。
  process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }) + '\n');
  process.exit(0);
}
if (mode === 'truncated') {
  // 截断的 JSON：若能解析会产出 {"id":1} 这种「看起来合法」的伪结果。
  // 写完不退出，让调用方超时杀掉 —— 覆盖「超时/截断下 json 必须为 null」。
  process.stdout.write('{"Success":true,"Items":[{"id":1},');
  setInterval(() => {}, 1000);
  return;
}
process.stderr.write('not json at all\n');
process.exit(0);
