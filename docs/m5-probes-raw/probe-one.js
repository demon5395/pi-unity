'use strict';
// 单次调用 + 打印**原始 JSON**（用于 6 个独立进程并行，复现 CLI 的进程级并发）
const { call } = require('C:/Users/<用户>/.pi/agent/git/<内部 git 服务器>/pi/pi-unity/lib/uloop.js');
const P = 'C:/Users/<用户>/pi-unity-official-f3c1';
const id = process.argv[2];
(async () => {
  const r = await call('execute-dynamic-code',
    ['--code', `System.Threading.Thread.Sleep(3000); return "${id}";`], { projectPath: P });
  console.log('=== ' + id + ' truncated=' + r.truncated + ' ===');
  console.log(JSON.stringify(r.json));
})();
