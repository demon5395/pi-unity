# pi-unity M1 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 `unity` CLI 跑通「发现编辑器 → `doctor` 全绿 → 读场景 → 建/改节点（带写后读回验证）→ 截图看图」。

**架构：** `bin/unity.js` 做参数解析与命令分发；`lib/` 下每个模块单一职责；**所有** Unity 操作经 `lib/uloop.js` 调上游 uloop（MIT，不 fork）；`lib/readback.js` 提供本项目唯一的自研价值——**写后主动读回，比对 intent vs actual**。C# 片段放 `unity-scripts/*.cs`，经 `--code-file` 执行，数据以单个 JSON 载荷经 `--parameters` 传入。

**技术栈：** Node.js ≥ 18（仅 `node:*` 内置模块 + `node --test`，**零第三方依赖**）；uloop dispatcher 3.5.1 + Unity 侧包 3.6.3；团结引擎 2022.3.62t9（兼容 Unity 官方 2022.3 LTS）。

**规格：** `docs/superpowers/specs/2026-09-18-pi-unity-design.md`
**配套必读：** `docs/CAPABILITIES-tuanjie-2022.3.62t9.md`、`docs/PITFALLS.md`、`docs/TUANJIE-DIVERGENCES.md`

---

## 全局约束

以下每条都来自规格，**每个任务的要求都隐含包含本节**：

1. **零第三方依赖** —— 只用 `node:*` 内置模块与 `node --test`。不要引入 puppeteer/axios/commander。（截图由 uloop 提供，不需要 headless 浏览器）
2. **uloop 输出分流**：**成功 → stdout；失败 → stderr**；退出码 **0 = 成功 / 1 = 失败**。
3. **uloop 输出可能含前置噪声行**（如 `uloop: downloading pinned project runner 3.4.0...`）→ **必须用 JSON 提取器，不能直接 `JSON.parse` 整个输出**。
4. **不 fork uloop、不改上游**；uloop 升级不得破坏信封契约。
5. **不硬编码 Unity 官方约定** —— 场景扩展名是 `.scene`（不是 `.unity`），YAML tag 是 `yousandi.cn`，产物是 `TuanjiePlayer.dll`。一律走 `EditorBuildSettings` / `AssetDatabase` / `report.summary`。见 `TUANJIE-DIVERGENCES.md`。
6. **`get-hierarchy` 不含任何属性值**（只有 name/isActive/components/tag/layer/children）→ **验证属性必须用 `execute-dynamic-code` 读回**。
7. **`Success: true` ≠ 意图达成**（实测：`fieldOfView = -100` 被钳制为 `1e-05` 仍报 `Success:true`）→ **所有写操作默认做 verified 读回**。
8. **C# 片段放 `unity-scripts/*.cs`**，用 `--code-file` 执行（不经 shell 引号）。
9. **传参用单 JSON 载荷**：`--parameters '{"p":"<序列化 JSON>"}'` → C# 读 `parameters["param0"]`，用 `Newtonsoft.Json.Linq` 解析（**已实测可用**）。
10. **不要遍历 `parameters`** —— uloop 会把代码里的字符串字面量驻留为 `__uloop_literal_*`。
11. **窗口名按界面语言**（中文编辑器是「游戏」）；能用 PlayMode 的 `rendering` 模式就优先用它（忽略窗口名）。
12. **新增 `docs/PITFALLS.md` 条目必须标注适用引擎**（团结实测 / 是否已确认 Unity 官方同样成立）。
13. **每个任务一个 commit**；`npm test` 必须保持全绿。
14. **不要按空格切分路径/命令** —— Windows 路径常含空格。测试注入用 `PI_UNITY_ULOOP_CMD`（JSON 数组）。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `bin/unity.js` | CLI 入口：argv 解析、命令表、错误兜底、退出码 |
| `lib/exec.js` | 子进程执行封装（可注入、带超时）—— 唯一 spawn 的地方 |
| `lib/uloop.js` | uloop 后端：定位 dispatcher、调用、stdout/stderr 分流、JSON 提取 |
| `lib/envelope.js` | 信封 `{ok, verified, intent, actual, hint}` + uloop 错误映射 + 输出 |
| `lib/editor-discovery.js` | O5 编辑器发现（env → secondaryInstallPath → hubInfo → Unity 官方路径） |
| `lib/readback.js` | **核心**：写后读回比对 `intent` vs `actual` |
| `lib/doctor.js` | `doctor` 基础检查 + `--smoke` 冒烟 |
| `lib/scene.js` | 场景读（tree）与节点读写（inspect / create / set） |
| `lib/shot.js` | 截图 + O6 窗口名映射 |
| `lib/args.js` | `--key value` / `--flag` / JSON 值解析（供各命令复用） |
| `unity-scripts/node-inspect.cs` | 读节点（返回可比对的实际值） |
| `unity-scripts/node-create.cs` | 建节点 |
| `unity-scripts/node-set.cs` | 改节点 |
| `skills/unity-game-dev/SKILL.md` | 面向 Pi 的工作流铁律 |
| `test/*.test.js` | `node --test` 单测（全部用假 uloop，不依赖编辑器） |

> **测试策略**：所有单测用**假 uloop 可执行文件**（`test/fixtures/fake-uloop.js`）驱动，**不依赖编辑器**。真机验证单独作为验收步骤。

---

### 任务 1：项目骨架 + `bin/unity.js`

**文件：**
- 创建：`bin/unity.js`
- 创建：`lib/args.js`
- 创建：`test/cli.test.js`

- [ ] **步骤 1：编写失败的测试**

```js
// test/cli.test.js
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
});

test('未知命令退出码 2 且提示', () => {
  const r = runCli(['nope']);
  assert.strictEqual(r.code, 2);
  assert.match(r.stderr, /unknown command: nope/);
});

test('parseArgs 解析 --key value 与 --flag', () => {
  const { parseArgs } = require('../lib/args.js');
  assert.deepStrictEqual(
    parseArgs(['--project-path', 'C:/p', '--smoke', '--max', '3']),
    { 'project-path': 'C:/p', smoke: true, max: '3' }
  );
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/cli.test.js`
预期：FAIL，报错 `Cannot find module 'bin/unity.js'`

- [ ] **步骤 3：编写最少实现代码**

```js
// lib/args.js
'use strict';

/** 解析 `--key value` / `--flag` / `--key=value` 为普通对象。 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

module.exports = { parseArgs };
```

```js
#!/usr/bin/env node
'use strict';

const pkg = require('../package.json');

const USAGE = `Usage: unity <command> [options]

命令：
  version                打印版本
  doctor                 环境检查（--smoke 冒烟 / --json 机器可读）
  scene tree             读场景节点树
  node inspect           读单个节点
  node create            建节点（写后读回验证）
  node set               改节点（写后读回验证）
  shot                   截图

全局选项：
  --project-path <path>  指定 Unity 项目目录
  --json                 输出机器可读 JSON

示例：
  unity doctor --project-path C:/my-game
  unity node create --project-path C:/my-game --name Brick
`;

const COMMANDS = {
  version: () => {
    process.stdout.write(`pi-unity ${pkg.version}\n`);
    return 0;
  },
};

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  const handler = COMMANDS[cmd];
  if (!handler) {
    process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}`);
    return 2;
  }
  return (await handler(rest)) ?? 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`internal error: ${err && err.stack ? err.stack : err}\n`);
    process.exit(3);
  });
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/cli.test.js`
预期：PASS（4 个测试）

- [ ] **步骤 5：Commit**

```bash
git add bin/unity.js lib/args.js test/cli.test.js
git commit -m "feat(cli): unity CLI 骨架 + 参数解析"
```

---

### 任务 2：`lib/exec.js` 子进程封装

**文件：**
- 创建：`lib/exec.js`
- 创建：`test/exec.test.js`

- [ ] **步骤 1：编写失败的测试**

```js
// test/exec.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { run } = require('../lib/exec.js');

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
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/exec.test.js`
预期：FAIL，`Cannot find module '../lib/exec.js'`

- [ ] **步骤 3：编写最少实现代码**

```js
// lib/exec.js
'use strict';

const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 120000;

/**
 * 执行子进程并缓冲输出。这是本项目唯一调用 spawn 的地方（便于测试注入）。
 * @returns {Promise<{code:number, stdout:string, stderr:string, timedOut:boolean, spawnError?:Error}>}
 */
function run(cmd, args, { timeoutMs = DEFAULT_TIMEOUT_MS, cwd, env } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: env ?? process.env, windowsHide: true });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: '', timedOut: false, spawnError: err });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => finish({ code: -1, stdout, stderr, timedOut, spawnError: err }));
    child.on('close', (code) => finish({ code: code ?? -1, stdout, stderr, timedOut }));
  });
}

module.exports = { run, DEFAULT_TIMEOUT_MS };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/exec.test.js`
预期：PASS（4 个测试）

- [ ] **步骤 5：Commit**

```bash
git add lib/exec.js test/exec.test.js
git commit -m "feat(exec): 子进程封装（可注入、带超时）"
```

---

### 任务 3：`lib/uloop.js` 后端适配

**文件：**
- 创建：`lib/uloop.js`
- 创建：`test/fixtures/fake-uloop.js`
- 创建：`test/uloop.test.js`

- [ ] **步骤 1：编写失败的测试与假后端**

```js
// test/fixtures/fake-uloop.js
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
process.stderr.write('not json at all\n');
process.exit(0);
```

```js
// test/uloop.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { extractJson, call } = require('../lib/uloop.js');

const FAKE = path.join(__dirname, 'fixtures', 'fake-uloop.js');

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

test('成功输出无 JSON 时 json 为 null（调用方据此报错）', async () => {
  const r = await call('list', [], { env: fakeEnv('garbage') });
  assert.strictEqual(r.json, null);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/uloop.test.js`
预期：FAIL，`Cannot find module '../lib/uloop.js'`

- [ ] **步骤 3：编写最少实现代码**

```js
// lib/uloop.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./exec.js');

/**
 * 从可能含前置噪声行的输出中提取第一个可解析的 JSON 对象。
 * uloop 会先打印 "uloop: downloading pinned project runner ..." 之类的行。
 */
function extractJson(text) {
  if (typeof text !== 'string') return null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    const slice = text.slice(i);
    try {
      return JSON.parse(slice);
    } catch { /* 继续尝试下一个 '{' */ }
    const end = slice.lastIndexOf('}');
    if (end > 0) {
      try {
        return JSON.parse(slice.slice(0, end + 1));
      } catch { /* 继续 */ }
    }
  }
  return null;
}

/**
 * 定位 uloop dispatcher。
 * 优先 PI_UNITY_ULOOP_CMD（JSON 数组，如 ["C:/node.exe","fake.js"]）—— 供测试注入；
 * 其次 PI_UNITY_ULOOP_BIN（单个可执行文件路径）；
 * 再次仓库内的 uloop-bin/；最后 PATH 上的 uloop。
 *
 * ⚠️ **不按空格切分** —— Windows 上 node / 编辑器路径常含空格（"C:\\Program Files\\..."），
 * 切分会把单个路径拆碎。（本机 node 恰好无空格，但不得依赖这一点。）
 */
function findDispatcher({ env = process.env, rootDir } = {}) {
  if (env.PI_UNITY_ULOOP_CMD) {
    try {
      const parts = JSON.parse(env.PI_UNITY_ULOOP_CMD);
      if (Array.isArray(parts) && parts.length > 0) {
        return { cmd: parts[0], prefixArgs: parts.slice(1) };
      }
    } catch { /* 落回下面的候选 */ }
  }
  if (env.PI_UNITY_ULOOP_BIN && fs.existsSync(env.PI_UNITY_ULOOP_BIN)) {
    return { cmd: env.PI_UNITY_ULOOP_BIN, prefixArgs: [] };
  }
  const local = path.join(rootDir ?? path.join(__dirname, '..'), 'uloop-bin',
    process.platform === 'win32' ? 'uloop.exe' : 'uloop');
  if (fs.existsSync(local)) return { cmd: local, prefixArgs: [] };
  return { cmd: process.platform === 'win32' ? 'uloop.exe' : 'uloop', prefixArgs: [] };
}

/**
 * 调用一个 uloop Unity 工具。
 * 约定（实测）：成功 → stdout；失败 → stderr；退出码 0/1。
 */
async function call(tool, toolArgs = [], { projectPath, env, rootDir, timeoutMs } = {}) {
  const { cmd, prefixArgs } = findDispatcher({ env, rootDir });
  const args = [...prefixArgs];
  if (projectPath) args.push('--project-path', projectPath);
  args.push(tool, ...toolArgs);

  const r = await run(cmd, args, { timeoutMs, env });

  // 成功读 stdout，失败读 stderr；两条都兜底试一遍
  const primary = r.code === 0 ? r.stdout : r.stderr;
  const secondary = r.code === 0 ? r.stderr : r.stdout;
  const json = extractJson(primary) ?? extractJson(secondary);

  return { ...r, json, tool, args };
}

module.exports = { extractJson, findDispatcher, call };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/uloop.test.js`
预期：PASS（6 个测试）

- [ ] **步骤 5：Commit**

```bash
git add lib/uloop.js test/uloop.test.js test/fixtures/fake-uloop.js
git commit -m "feat(uloop): 后端适配（stdout/stderr 分流 + 噪声容忍 JSON 提取）"
```

---

### 任务 4：`lib/envelope.js` 信封

**文件：**
- 创建：`lib/envelope.js`
- 创建：`test/envelope.test.js`

- [ ] **步骤 1：编写失败的测试**

```js
// test/envelope.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ok, fail, fromUloop } = require('../lib/envelope.js');

test('ok 的信封形状固定', () => {
  const e = ok({ name: 'Brick' });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, null); // 未做读回前不得声称已验证
  assert.deepStrictEqual(e.actual, { name: 'Brick' });
  assert.deepStrictEqual(e.hint, []);
});

test('fail 的信封形状固定', () => {
  const e = fail({ code: 'X', message: 'boom', hint: ['try y'] });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.code, 'X');
  assert.deepStrictEqual(e.hint, ['try y']);
});

test('fromUloop 把 Success:true 映射为 ok 但 verified 仍为 null', () => {
  const e = fromUloop({ Success: true, Result: 'x' });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, null);
});

test('fromUloop 保留 uloop 的 ErrorCode / NextActions / Retryable', () => {
  const e = fromUloop({
    Success: false,
    Error: { ErrorCode: 'UNITY_NOT_REACHABLE', Phase: 'connection', Message: 'nope',
             Retryable: true, NextActions: ['run uloop launch'] },
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'UNITY_NOT_REACHABLE');
  assert.strictEqual(e.phase, 'connection');
  assert.strictEqual(e.retryable, true);
  assert.deepStrictEqual(e.hint, ['run uloop launch']);
});

test('fromUloop 对 null 给出可诊断的错误', () => {
  const e = fromUloop(null);
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_NO_JSON');
  assert.ok(e.hint.length > 0);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/envelope.test.js`
预期：FAIL，`Cannot find module '../lib/envelope.js'`

- [ ] **步骤 3：编写最少实现代码**

```js
// lib/envelope.js
'use strict';

/**
 * 统一信封：{ok, verified, intent, actual, hint, ...}
 *
 * 核心语义（本项目唯一自研价值）：
 *   - uloop 的 `Success:true` 只表示「代码执行了」，**不表示「意图达成了」**
 *   - 因此 ok:true 时 verified 仍为 null；只有写后读回比对通过才置 true
 */

function ok(actual, extra = {}) {
  return { ok: true, verified: null, intent: null, actual, hint: [], ...extra };
}

function fail({ code, message, intent = null, actual = null, hint = [], phase, retryable } = {}) {
  return { ok: false, verified: false, code, message, intent, actual, hint, phase, retryable };
}

/** 把 uloop 的 JSON 结果映射成本项目信封（不丢信息）。 */
function fromUloop(json) {
  if (!json || typeof json !== 'object') {
    return fail({
      code: 'ULOOP_NO_JSON',
      message: 'uloop 未返回可解析的 JSON',
      hint: [
        '确认 uloop dispatcher 路径正确（PI_UNITY_ULOOP_BIN）',
        '确认编辑器已打开目标项目',
        '用 `unity doctor` 查看完整环境状态',
      ],
    });
  }
  if (json.Success) {
    return ok(json);
  }
  const e = json.Error || {};
  return fail({
    code: e.ErrorCode || 'ULOOP_ERROR',
    message: e.Message || 'uloop 返回失败但未提供 Message',
    actual: e.Details || null,
    hint: Array.isArray(e.NextActions) ? e.NextActions : [],
    phase: e.Phase,
    retryable: Boolean(e.Retryable),
  });
}

/** 输出信封。人类可读或 --json。 */
function emit(envelope, { json = false, stream = process.stdout } = {}) {
  if (json) {
    stream.write(JSON.stringify(envelope, null, 2) + '\n');
    return;
  }
  if (envelope.ok) {
    const mark = envelope.verified === true ? 'VERIFIED' : envelope.verified === false ? 'UNVERIFIED' : 'OK';
    stream.write(`[${mark}] ${envelope.code || ''} ${JSON.stringify(envelope.actual)}\n`.replace('  ', ' '));
  } else {
    stream.write(`[FAIL] ${envelope.code}: ${envelope.message}\n`);
    for (const h of envelope.hint) stream.write(`  hint: ${h}\n`);
  }
}

module.exports = { ok, fail, fromUloop, emit };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/envelope.test.js`
预期：PASS（5 个测试）

- [ ] **步骤 5：Commit**

```bash
git add lib/envelope.js test/envelope.test.js
git commit -m "feat(envelope): 统一信封（ok/verified/intent/actual/hint）+ uloop 错误映射"
```

---

### 任务 5：`lib/editor-discovery.js` 编辑器发现（O5）

**文件：**
- 创建：`lib/editor-discovery.js`
- 创建：`test/editor-discovery.test.js`

- [ ] **步骤 1：编写失败的测试**

```js
// test/editor-discovery.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discover, language, hubRoot } = require('../lib/editor-discovery.js');

/** 造一个假 Hub 目录结构 */
function makeHub({ secondary, hubExe } = {}) {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-'));
  const hub = path.join(appData, 'TuanjieHub');
  fs.mkdirSync(hub, { recursive: true });
  if (secondary) fs.writeFileSync(path.join(hub, 'secondaryInstallPath.json'), JSON.stringify(secondary));
  if (hubExe) fs.writeFileSync(path.join(hub, 'hubInfo.json'), JSON.stringify({ executablePath: hubExe }));
  fs.writeFileSync(path.join(hub, 'languageConfig.json'), JSON.stringify({ language: 'zh_CN' }));
  return { appData, hub };
}

/** 在 root 下造 <ver>/Editor/<exeName> */
function makeEditor(root, ver, exeName) {
  const dir = path.join(root, ver, 'Editor');
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, exeName);
  fs.writeFileSync(exe, '');
  return exe;
}

test('从 secondaryInstallPath.json 发现编辑器（实测的真实形态）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piuinst-'));
  const exe = makeEditor(root, '2022.3.62t9', 'Tuanjie.exe');
  const { appData } = makeHub({ secondary: root });
  const found = discover({ appData, env: {} });
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].path, exe);
  assert.strictEqual(found[0].version, '2022.3.62t9');
  assert.strictEqual(found[0].source, 'tuanjiehub:secondaryInstallPath');
});

test('secondaryInstallPath.json 是裸 JSON 字符串也能解析', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piuinst-'));
  makeEditor(root, '2022.3.62t9', 'Tuanjie.exe');
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-'));
  const hub = path.join(appData, 'TuanjieHub');
  fs.mkdirSync(hub, { recursive: true });
  // 裸字符串（不带引号包裹的对象），与实测一致
  fs.writeFileSync(path.join(hub, 'secondaryInstallPath.json'), JSON.stringify(root));
  const found = discover({ appData, env: {} });
  assert.strictEqual(found.length, 1);
});

test('env override 优先且排在第一位', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piuinst-'));
  makeEditor(root, '2022.3.62t9', 'Tuanjie.exe');
  const { appData } = makeHub({ secondary: root });
  const manual = path.join(root, 'manual', 'Editor', 'Tuanjie.exe');
  fs.mkdirSync(path.dirname(manual), { recursive: true });
  fs.writeFileSync(manual, '');
  const found = discover({ appData, env: { PI_UNITY_EDITOR_BIN: manual } });
  assert.strictEqual(found[0].path, manual);
  assert.strictEqual(found[0].source, 'env:PI_UNITY_EDITOR_BIN');
});

test('从 hubInfo.json 的 executablePath 推 Hub 目录', () => {
  const hubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhubdir-'));
  const exe = makeEditor(path.join(hubDir, 'Editor'), '2022.3.62t9', 'Tuanjie.exe');
  const { appData } = makeHub({ hubExe: path.join(hubDir, 'Tuanjie Hub.exe') });
  const found = discover({ appData, env: {} });
  assert.ok(found.some((f) => f.path === exe && f.source === 'tuanjiehub:hubInfo'));
});

test('同时认 Tuanjie.exe 与 Unity.exe', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piuinst-'));
  const t = makeEditor(root, '2022.3.62t9', 'Tuanjie.exe');
  const u = makeEditor(root, '2022.3.62t9', 'Unity.exe');
  const { appData } = makeHub({ secondary: root });
  const paths = discover({ appData, env: {} }).map((f) => f.path);
  assert.ok(paths.includes(t) && paths.includes(u));
});

test('找不到任何编辑器时返回空数组（不抛异常）', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'piuhub-'));
  assert.deepStrictEqual(discover({ appData, env: {}, programFiles: [] }), []);
});

test('language 读 languageConfig.json，缺省回落 en_US', () => {
  const { appData } = makeHub({});
  assert.strictEqual(language({ appData }), 'zh_CN');
  assert.strictEqual(language({ appData: fs.mkdtempSync(path.join(os.tmpdir(), 'empty-')) }), 'en_US');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/editor-discovery.test.js`
预期：FAIL，`Cannot find module '../lib/editor-discovery.js'`

- [ ] **步骤 3：编写最少实现代码**

```js
// lib/editor-discovery.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXE_NAMES = ['Tuanjie.exe', 'Unity.exe'];

function appDataRoot(env) {
  return env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
}

function hubRoot({ appData, env = process.env } = {}) {
  return path.join(appData ?? appDataRoot(env), 'TuanjieHub');
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** 扫描 <root>/<version>/Editor/(Tuanjie|Unity).exe */
function scanInstallRoot(root, source, out) {
  if (!root || !fs.existsSync(root)) return;
  let versions;
  try {
    versions = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return;
  }
  for (const v of versions) {
    for (const name of EXE_NAMES) {
      const exe = path.join(root, v.name, 'Editor', name);
      if (fs.existsSync(exe) && !out.some((f) => f.path === exe)) {
        out.push({ path: exe, version: v.name, source });
      }
    }
  }
}

/**
 * 编辑器发现（O5 决策）：env → secondaryInstallPath → hubInfo → Unity 官方默认路径。
 * 顺序即优先级；返回全部命中项（不去重跨来源的同名）。
 */
function discover({ env = process.env, appData, programFiles } = {}) {
  const out = [];

  // 1. 环境变量覆盖
  const manual = env.PI_UNITY_EDITOR_BIN;
  if (manual && fs.existsSync(manual)) {
    out.push({ path: manual, version: 'unknown', source: 'env:PI_UNITY_EDITOR_BIN' });
  }

  const hub = hubRoot({ appData, env });

  // 2. secondaryInstallPath.json（实测内容是裸 JSON 字符串）
  const secondary = readJsonSafe(path.join(hub, 'secondaryInstallPath.json'));
  if (typeof secondary === 'string') {
    scanInstallRoot(secondary, 'tuanjiehub:secondaryInstallPath', out);
  }

  // 3. hubInfo.json → Hub 安装目录下的 Editor/
  const info = readJsonSafe(path.join(hub, 'hubInfo.json'));
  if (info && typeof info.executablePath === 'string') {
    scanInstallRoot(path.join(path.dirname(info.executablePath), 'Editor'), 'tuanjiehub:hubInfo', out);
  }

  // 4. Unity 官方默认路径（为兼容 Unity 官方版）
  const bases = programFiles ?? [
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Unity'),
  ].filter(Boolean);
  for (const base of bases) {
    scanInstallRoot(path.join(base, 'Unity', 'Hub', 'Editor'), 'unity:hub-default', out);
  }

  return out;
}

/** 读编辑器界面语言（实测 zh_CN）。不影响发现，仅用于窗口名映射回退。 */
function language({ appData, env = process.env } = {}) {
  const cfg = readJsonSafe(path.join(hubRoot({ appData, env }), 'languageConfig.json'));
  return (cfg && cfg.language) || 'en_US';
}

module.exports = { discover, language, hubRoot };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/editor-discovery.test.js`
预期：PASS（7 个测试）

- [ ] **步骤 5：Commit**

```bash
git add lib/editor-discovery.js test/editor-discovery.test.js
git commit -m "feat(discovery): 编辑器发现（O5 四层：env/secondaryInstallPath/hubInfo/Unity 默认）"
```

---

### 任务 6：`unity doctor` 基础检查

**文件：**
- 创建：`lib/doctor.js`
- 修改：`bin/unity.js`（注册 `doctor` 命令）
- 创建：`test/doctor.test.js`

- [ ] **步骤 1：编写失败的测试**

```js
// test/doctor.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { collectChecks, playbackEngines } = require('../lib/doctor.js');

const FAKE = path.join(__dirname, 'fixtures', 'fake-uloop.js');

test('playbackEngines 枚举已安装的构建目标', () => {
  const engines = playbackEngines('<引擎安装目录>/2022.3.62t9/Editor');
  assert.ok(Array.isArray(engines));
});

test('uloop 可用时对应检查项 pass', async () => {
  const checks = await collectChecks({
    env: { ...process.env, FAKE_MODE: 'ok', PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
  });
  const uloop = checks.find((c) => c.name === 'uloop');
  assert.strictEqual(uloop.status, 'pass');
});

test('uloop 连不上时对应检查项 fail 且带上 hint', async () => {
  const checks = await collectChecks({
    env: { ...process.env, FAKE_MODE: 'fail', PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
  });
  const conn = checks.find((c) => c.name === 'editor-connection');
  assert.strictEqual(conn.status, 'fail');
  assert.ok(conn.hint && conn.hint.length > 0);
});

test('找不到编辑器时 fail 并列出已尝试路径', async () => {
  const checks = await collectChecks({
    env: { ...process.env, FAKE_MODE: 'fail', PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
    appData: path.join(require('node:os').tmpdir(), 'nonexistent-appdata-xyz'),
  });
  const ed = checks.find((c) => c.name === 'editor-install');
  assert.strictEqual(ed.status, 'fail');
  assert.match(ed.message, /PI_UNITY_EDITOR_BIN/);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/doctor.test.js`
预期：FAIL，`Cannot find module '../lib/doctor.js'`

- [ ] **步骤 3：编写最少实现代码**

```js
// lib/doctor.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { call, findDispatcher } = require('./uloop.js');
const { discover, language, hubRoot } = require('./editor-discovery.js');

/** 枚举已安装的构建目标（U9：目标不是全的，取决于安装时勾选的模块）。 */
function playbackEngines(editorDir) {
  const dir = path.join(editorDir, 'Data', 'PlaybackEngines');
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

async function collectChecks({ env = process.env, appData, projectPath } = {}) {
  const checks = [];

  // 1. uloop dispatcher 是否存在
  const { cmd } = findDispatcher({ env });
  checks.push({
    name: 'uloop',
    status: cmd ? 'pass' : 'fail',
    message: `dispatcher: ${cmd}`,
    hint: cmd ? [] : ['设置 PI_UNITY_ULOOP_BIN 指向 uloop 可执行文件'],
  });

  // 2. 编辑器安装（O5）
  const editors = discover({ env, appData });
  checks.push({
    name: 'editor-install',
    status: editors.length > 0 ? 'pass' : 'fail',
    message: editors.length > 0
      ? editors.map((e) => `${e.version} (${e.source})`).join(', ')
      : '未发现编辑器。已尝试：PI_UNITY_EDITOR_BIN → %APPDATA%\\TuanjieHub\\secondaryInstallPath.json → hubInfo.json → Unity 官方默认路径',
    hint: editors.length > 0 ? [] : [
      '设置 PI_UNITY_EDITOR_BIN 指向 Tuanjie.exe / Unity.exe',
      '确认 %APPDATA%\\TuanjieHub\\secondaryInstallPath.json 存在',
    ],
  });

  // 3. 界面语言（O6 的输入）
  checks.push({
    name: 'editor-language',
    status: 'pass',
    message: `${language({ appData, env })}（hub: ${hubRoot({ appData, env })}）`,
    hint: [],
  });

  // 4. PlaybackEngines（U9）
  if (editors.length > 0) {
    const engines = playbackEngines(path.dirname(editors[0].path));
    checks.push({
      name: 'build-targets',
      status: engines.length > 0 ? 'pass' : 'fail',
      message: engines.join(', ') || '无',
      hint: engines.includes('WebGLSupport') ? [] : ['未安装 WebGL 模块；build 默认目标将取项目当前配置'],
    });
  }

  // 5. 编辑器连接（真机）
  const r = await call('list', [], { env, projectPath });
  checks.push({
    name: 'editor-connection',
    // ⚠️ 必须是 `=== true`，不是 `!== false` —— 否则无 Success 字段的裸对象会被判 pass，
    //    既放过「dispatcher 被指到别的程序」这类病，又与任务 9/10 的 ULOOP_BAD_PAYLOAD 结论相矛盾。
    status: r.code === 0 && r.json && r.json.Success === true ? 'pass' : 'fail',
    message: r.json ? `uloop ${r.json.Version ?? ''} 已连接` : `无法连接（退出码 ${r.code}）`,
    hint: r.json && r.json.Error && r.json.Error.NextActions ? r.json.Error.NextActions : [],
  });

  return checks;
}

async function doctor(argv, { env = process.env } = {}) {
  const { parseArgs } = require('./args.js');
  const args = parseArgs(argv);
  const checks = await collectChecks({ env, projectPath: args['project-path'] });
  const failed = checks.filter((c) => c.status === 'fail');

  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: failed.length === 0, checks }, null, 2) + '\n');
  } else {
    for (const c of checks) {
      process.stdout.write(`${c.status === 'pass' ? '  OK ' : 'FAIL '} ${c.name.padEnd(18)} ${c.message}\n`);
      for (const h of c.hint) process.stdout.write(`       hint: ${h}\n`);
    }
    process.stdout.write(failed.length === 0 ? '\n全部通过。\n' : `\n${failed.length} 项失败。\n`);
  }
  return failed.length === 0 ? 0 : 1;
}

module.exports = { doctor, collectChecks, playbackEngines };
```

同时在 `bin/unity.js` 的 `COMMANDS` 里注册：

```js
  doctor: (rest) => require('../lib/doctor.js').doctor(rest),
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/doctor.test.js`
预期：PASS（4 个测试）

- [ ] **步骤 5：真机验证（可选但有价值）**

```bash
node bin/unity.js doctor --project-path C:/Users/<用户>/pi-unity-spike/S0Project
```
预期：`uloop` / `editor-install` / `editor-language` / `build-targets` 均为 `OK`

- [ ] **步骤 6：Commit**

```bash
git add lib/doctor.js bin/unity.js test/doctor.test.js
git commit -m "feat(doctor): 环境检查（uloop/编辑器发现/语言/构建目标/连接）"
```

---

### 任务 7：`unity doctor --smoke` 只读冒烟

**文件：**
- 修改：`lib/doctor.js`（新增 `smoke`）
- 修改：`bin/unity.js`
- 修改：`test/doctor.test.js`

- [ ] **步骤 1：编写失败的测试**

```js
// 追加到 test/doctor.test.js
const { smoke } = require('../lib/doctor.js');

test('smoke 汇总每项结果，失败的记为 fail 并带 hint', async () => {
  const results = await smoke({
    env: { ...process.env, FAKE_MODE: 'ok', PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
  });
  assert.ok(results.length >= 3);
  for (const r of results) {
    assert.ok(['pass', 'fail', 'skip'].includes(r.status), `${r.name} 状态非法`);
  }
});

test('smoke 在连不上编辑器时全部 skip（不抛异常）', async () => {
  const results = await smoke({
    env: { ...process.env, FAKE_MODE: 'fail', PI_UNITY_ULOOP_CMD: JSON.stringify([process.execPath, FAKE]) },
  });
  assert.ok(results.every((r) => r.status === 'skip'));
  assert.ok(results[0].hint.length > 0);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/doctor.test.js`
预期：FAIL，`smoke is not a function`

- [ ] **步骤 3：编写最少实现代码**

```js
// 追加到 lib/doctor.js

/** 只读冒烟：逐个跑只读工具，报告 pass/fail。绝不写场景。 */
const SMOKE_TOOLS = [
  { name: 'compile', args: [], pick: (j) => `errors=${j.ErrorCount ?? '?'} warnings=${j.WarningCount ?? '?'}` },
  { name: 'get-logs', args: ['--max-count', '1'], pick: (j) => `total=${j.TotalCount ?? '?'}` },
  { name: 'get-hierarchy', args: [], pick: (j) => (j.HierarchyFilePath ? 'saved' : 'no path') },
];

async function smoke({ env = process.env, projectPath } = {}) {
  // 先探连接；不通则全部 skip，避免每个工具都报一次同样的错
  const probe = await call('list', [], { env, projectPath });
  if (!(probe.code === 0 && probe.json)) {
    const hint = (probe.json && probe.json.Error && probe.json.Error.NextActions) || [];
    return SMOKE_TOOLS.map((t) => ({
      name: t.name,
      status: 'skip',
      message: '编辑器未连接',
      hint,
    }));
  }

  const out = [];
  for (const t of SMOKE_TOOLS) {
    const r = await call(t.name, t.args, { env, projectPath });
    const pass = r.code === 0 && r.json && r.json.Success === true; // 同任务 6：必须是 === true
    out.push({
      name: t.name,
      status: pass ? 'pass' : 'fail',
      message: pass ? t.pick(r.json) : (r.json && r.json.Error ? r.json.Error.Message : `退出码 ${r.code}`),
      hint: pass ? [] : ((r.json && r.json.Error && r.json.Error.NextActions) || []),
    });
  }
  return out;
}
```

在 `doctor()` 开头加入分发：

```js
  if (args.smoke) {
    const results = await smoke({ env, projectPath: args['project-path'] });
    const failed = results.filter((r) => r.status === 'fail');
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: failed.length === 0, results }, null, 2) + '\n');
    } else {
      for (const r of results) {
        process.stdout.write(`${r.status === 'pass' ? '  OK ' : r.status === 'skip' ? 'SKIP ' : 'FAIL '} ${r.name.padEnd(18)} ${r.message}\n`);
        for (const h of r.hint) process.stdout.write(`       hint: ${h}\n`);
      }
    }
    return failed.length === 0 ? 0 : 1;
  }
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/doctor.test.js`
预期：PASS（6 个测试）

- [ ] **步骤 5：Commit**

```bash
git add lib/doctor.js test/doctor.test.js
git commit -m "feat(doctor): --smoke 只读冒烟（连接不通则整体 skip）"
```

---

### 任务 8：`lib/readback.js` 写后读回（**核心**）

**文件：**
- 创建：`lib/readback.js`
- 创建：`test/readback.test.js`

- [ ] **步骤 1：编写失败的测试**

```js
// test/readback.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { compareSubset, verifyWrite } = require('../lib/readback.js');

test('完全一致时无 mismatch', () => {
  assert.deepStrictEqual(compareSubset({ name: 'A' }, { name: 'A' }), []);
});

test('值不同时报告 intent 与 actual', () => {
  const m = compareSubset({ name: 'A' }, { name: 'B' });
  assert.strictEqual(m.length, 1);
  assert.deepStrictEqual(m[0], { key: 'name', intent: 'A', actual: 'B' });
});

test('数值用容差比较（浮点）', () => {
  assert.deepStrictEqual(compareSubset({ x: 1.0 }, { x: 1.0000001 }), []);
  assert.strictEqual(compareSubset({ x: 1.0 }, { x: 1.1 }).length, 1);
});

test('嵌套对象递归比较', () => {
  const m = compareSubset({ position: { x: 1, y: 2 } }, { position: { x: 1, y: 9 } });
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].key, 'position.y');
});

test('actual 缺字段算 mismatch（不得静默通过）', () => {
  const m = compareSubset({ name: 'A' }, {});
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].actual, undefined);
});

test('verifyWrite 通过时 verified=true 并回传 intent/actual', async () => {
  const r = await verifyWrite({ intent: { active: true }, readActual: async () => ({ active: true }) });
  assert.strictEqual(r.verified, true);
  assert.deepStrictEqual(r.intent, { active: true });
  assert.deepStrictEqual(r.actual, { active: true });
  assert.deepStrictEqual(r.mismatches, []);
});

test('verifyWrite 不符时 verified=false 并保留分歧（钳制场景）', async () => {
  const r = await verifyWrite({ intent: { fieldOfView: -100 }, readActual: async () => ({ fieldOfView: 1e-5 }) });
  assert.strictEqual(r.verified, false);
  assert.strictEqual(r.mismatches[0].intent, -100);
  assert.strictEqual(r.mismatches[0].actual, 1e-5);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/readback.test.js`
预期：FAIL，`Cannot find module '../lib/readback.js'`

- [ ] **步骤 3：编写最少实现代码**

```js
// lib/readback.js
'use strict';

/**
 * 写后读回比对 —— 本项目唯一自研价值。
 *
 * 背景（实测）：uloop 的 `Success:true` 只表示「你的代码执行了」。
 * 例：`cam.fieldOfView = -100f;` 被 Unity 钳制为 `1e-05`，工具仍报 Success:true。
 * 所以写操作必须主动读回，比对 intent vs actual。
 */

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 按 intent 的字段子集递归比较 actual，返回分歧列表。 */
function compareSubset(intent, actual, { tol = 1e-4, prefix = '' } = {}) {
  const out = [];
  if (!isPlainObject(intent)) return out;
  const a = isPlainObject(actual) ? actual : {};

  for (const [key, iv] of Object.entries(intent)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const av = a[key];

    if (isPlainObject(iv)) {
      out.push(...compareSubset(iv, av, { tol, prefix: path }));
      continue;
    }
    if (Array.isArray(iv)) {
      if (JSON.stringify(iv) !== JSON.stringify(av)) out.push({ key: path, intent: iv, actual: av });
      continue;
    }
    if (typeof iv === 'number' && typeof av === 'number') {
      if (Math.abs(iv - av) > tol) out.push({ key: path, intent: iv, actual: av });
      continue;
    }
    if (iv !== av) out.push({ key: path, intent: iv, actual: av });
  }
  return out;
}

/** 写后读回：调用 readActual() 拿真实值，与 intent 比对。 */
async function verifyWrite({ intent, readActual }) {
  const actual = await readActual();
  const mismatches = compareSubset(intent, actual);
  return { verified: mismatches.length === 0, intent, actual, mismatches };
}

module.exports = { compareSubset, verifyWrite };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/readback.test.js`
预期：PASS（7 个测试）

- [ ] **步骤 5：Commit**

```bash
git add lib/readback.js test/readback.test.js
git commit -m "feat(readback): 写后读回比对（intent vs actual）—— 信封层核心价值"
```

---

### 任务 9：`unity scene tree` + `unity node inspect`（读路径）

**文件：**
- 创建：`lib/scene.js`
- 创建：`unity-scripts/node-inspect.cs`
- 修改：`bin/unity.js`
- 创建：`test/scene.test.js`

- [ ] **步骤 1：编写失败的测试**

```js
// test/scene.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeHierarchy, readHierarchyFile, buildPayloadArgs } = require('../lib/scene.js');

const SAMPLE = {
  ExportTimestamp: '2026-09-18 17:38:54',
  Context: { sceneType: 'editor', sceneName: '', nodeCount: 2, maxDepth: 1 },
  Hierarchy: [{
    sceneName: '',
    stats: { rootCount: 1, nodeCount: 2, maxDepth: 1 },
    roots: [{
      name: 'Canvas', isActive: true, components: ['RectTransform', 'Canvas'],
      siblingIndex: 0, tag: 'Untagged', layer: 5,
      children: [{ name: 'Btn', isActive: true, components: ['RectTransform', 'Button'], children: [] }],
    }],
  }],
};

test('normalizeHierarchy 抽出可读结构', () => {
  const n = normalizeHierarchy(SAMPLE);
  assert.strictEqual(n.nodeCount, 2);
  assert.strictEqual(n.roots[0].name, 'Canvas');
  assert.strictEqual(n.roots[0].children[0].name, 'Btn');
  assert.strictEqual(n.roots[0].path, 'Canvas');
  assert.strictEqual(n.roots[0].children[0].path, 'Canvas/Btn');
});

test('readHierarchyFile 能把相对路径解析到项目根', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'piu-proj-'));
  const rel = path.join('.uloop', 'outputs', 'HierarchyResults', 'h.json');
  fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
  fs.writeFileSync(path.join(project, rel), JSON.stringify(SAMPLE));
  const n = readHierarchyFile(project, rel);
  assert.strictEqual(n.roots[0].name, 'Canvas');
});

test('buildPayloadArgs 生成 --code-file 与单 JSON 载荷参数', () => {
  const args = buildPayloadArgs('node-inspect', { path: 'Canvas/Btn' });
  assert.deepStrictEqual(args[0], '--code-file');
  assert.ok(args[1].endsWith('node-inspect.cs'));
  assert.deepStrictEqual(args[2], '--parameters');
  const parsed = JSON.parse(args[3]);
  assert.deepStrictEqual(Object.values(parsed), [JSON.stringify({ path: 'Canvas/Btn' })]);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/scene.test.js`
预期：FAIL，`Cannot find module '../lib/scene.js'`

- [ ] **步骤 3：编写最少实现代码**

```js
// unity-scripts/node-inspect.cs
// 入参：parameters["param0"] = {"path":"Canvas/Btn"}
// 出参：JSON 字符串，字段与 node.set 的 patch 对齐，便于直接比对
using System.Linq;
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var p = (string)req["path"];
var go = GameObject.Find(p);
if (go == null) return "{\"__error\":\"NOT_FOUND\"}";
var rt = go.transform;
var o = new Newtonsoft.Json.Linq.JObject();
o["name"] = go.name;
o["active"] = go.activeSelf;
o["position"] = new Newtonsoft.Json.Linq.JObject { ["x"] = rt.localPosition.x, ["y"] = rt.localPosition.y, ["z"] = rt.localPosition.z };
o["scale"] = new Newtonsoft.Json.Linq.JObject { ["x"] = rt.localScale.x, ["y"] = rt.localScale.y, ["z"] = rt.localScale.z };
o["components"] = new Newtonsoft.Json.Linq.JArray(go.GetComponents<Component>().Select(c => c.GetType().Name).ToArray());
return o.ToString(Newtonsoft.Json.Formatting.None);
```

```js
// lib/scene.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { call } = require('./uloop.js');
const { fromUloop, fail } = require('./envelope.js');

const SCRIPTS_DIR = path.join(__dirname, '..', 'unity-scripts');

/** 生成 execute-dynamic-code 的参数：--code-file <cs> --parameters {"p":"<json>"} */
function buildPayloadArgs(scriptName, payload, { scriptsDir = SCRIPTS_DIR } = {}) {
  return [
    '--code-file', path.join(scriptsDir, `${scriptName}.cs`),
    '--parameters', JSON.stringify({ p: JSON.stringify(payload) }),
  ];
}

/** 把 uloop 的 hierarchy JSON 规范化成可读结构（带 path，便于后续引用）。 */
function normalizeHierarchy(raw) {
  const h = raw.Hierarchy && raw.Hierarchy[0] ? raw.Hierarchy[0] : { stats: {}, roots: [] };
  const walk = (node, parentPath) => {
    const p = parentPath ? `${parentPath}/${node.name}` : node.name;
    return {
      name: node.name,
      path: p,
      active: node.isActive,
      components: node.components || [],
      children: (node.children || []).map((c) => walk(c, p)),
    };
  };
  return {
    sceneName: h.sceneName || '',
    nodeCount: h.stats ? h.stats.nodeCount : 0,
    maxDepth: h.stats ? h.stats.maxDepth : 0,
    roots: (h.roots || []).map((r) => walk(r, '')),
  };
}

/** uloop 返回的是相对项目根的路径（形如 .uloop\outputs\...） */
function readHierarchyFile(projectPath, relPath) {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(projectPath, relPath);
  return normalizeHierarchy(JSON.parse(fs.readFileSync(abs, 'utf8')));
}

async function sceneTree({ projectPath, env, _call } = {}) {
  const r = await (_call || call)('get-hierarchy', [], { projectPath, env });
  const envl = fromUloop(r.json);
  if (!envl.ok) return envl;
  if (!r.json.HierarchyFilePath) {
    return fail({ code: 'NO_HIERARCHY_PATH', message: 'get-hierarchy 未返回 HierarchyFilePath', actual: r.json });
  }
  return { ok: true, verified: true, actual: readHierarchyFile(projectPath, r.json.HierarchyFilePath), hint: [] };
}

/** 读单个节点（属性值必须走 execute-dynamic-code —— get-hierarchy 不含属性） */
async function nodeInspect({ projectPath, env, path: nodePath, _call } = {}) {
  const r = await (_call || call)('execute-dynamic-code', buildPayloadArgs('node-inspect', { path: nodePath }), { projectPath, env });
  const envl = fromUloop(r.json);
  if (!envl.ok) return envl;
  const parsed = JSON.parse(r.json.Result);
  if (parsed.__error === 'NOT_FOUND') {
    return fail({ code: 'NOT_FOUND', message: `节点不存在：${nodePath}`, hint: ['用 `unity scene tree` 查看可用路径'] });
  }
  return { ok: true, verified: true, actual: parsed, hint: [] };
}

module.exports = { buildPayloadArgs, normalizeHierarchy, readHierarchyFile, sceneTree, nodeInspect, SCRIPTS_DIR };
```

在 `bin/unity.js` 注册子命令（`scene` / `node` 带子动作）：

```js
  scene: async (rest) => {
    const [action, ...opts] = rest;
    const { parseArgs } = require('../lib/args.js');
    const args = parseArgs(opts);
    if (action !== 'tree') { process.stderr.write('usage: unity scene tree\n'); return 2; }
    const { sceneTree } = require('../lib/scene.js');
    const { emit } = require('../lib/envelope.js');
    const e = await sceneTree({ projectPath: args['project-path'] });
    emit(e, { json: true });
    return e.ok ? 0 : 1;
  },
  node: async (rest) => {
    const [action, ...opts] = rest;
    const { parseArgs } = require('../lib/args.js');
    const args = parseArgs(opts);
    const { emit } = require('../lib/envelope.js');
    if (action === 'inspect') {
      const { nodeInspect } = require('../lib/scene.js');
      const e = await nodeInspect({ projectPath: args['project-path'], path: args.path });
      emit(e, { json: true });
      return e.ok ? 0 : 1;
    }
    process.stderr.write(`usage: unity node inspect|create|set\n`);
    return 2;
  },
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/scene.test.js`
预期：PASS（3 个测试）

- [ ] **步骤 5：Commit**

```bash
git add lib/scene.js unity-scripts/node-inspect.cs bin/unity.js test/scene.test.js
git commit -m "feat(scene): scene tree + node inspect（读路径，属性走 execute-dynamic-code）"
```

---

### 任务 10：`unity node create` / `unity node set`（写路径 + **verified**）

**文件：**
- 创建：`unity-scripts/node-create.cs`
- 创建：`unity-scripts/node-set.cs`
- 修改：`lib/scene.js`
- 修改：`bin/unity.js`
- 修改：`test/scene.test.js`

- [ ] **步骤 1：编写失败的测试**

```js
// 追加到 test/scene.test.js
const { nodeCreate, nodeSet } = require('../lib/scene.js');

test('nodeCreate 读回一致时 verified=true', async () => {
  const fakeCall = async () => ({ code: 0, json: { Success: true, Result: '{"name":"Brick","active":true}' } });
  const e = await nodeCreate({ projectPath: 'X', name: 'Brick', _call: fakeCall });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(e.actual, { name: 'Brick', active: true });
});

test('nodeSet 读回不一致时 verified=false 并保留分歧（钳制场景）', async () => {
  // 第一次调用执行写，第二次调用读回
  let n = 0;
  const fakeCall = async () => {
    n++;
    return n === 1
      ? { code: 0, json: { Success: true, Result: '{"__written":true}' } }
      : { code: 0, json: { Success: true, Result: '{"name":"Brick","active":true,"position":{"x":0,"y":1e-5,"z":0}}' } };
  };
  const e = await nodeSet({
    projectPath: 'X', path: 'Brick', patch: { position: { x: 0, y: -100, z: 0 } }, _call: fakeCall,
  });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'position.y');
});

test('nodeSet 读回一致时 verified=true', async () => {
  let n = 0;
  const fakeCall = async () => {
    n++;
    return n === 1
      ? { code: 0, json: { Success: true, Result: '{"__written":true}' } }
      : { code: 0, json: { Success: true, Result: '{"name":"Brick","active":false}' } };
  };
  const e = await nodeSet({ projectPath: 'X', path: 'Brick', patch: { active: false }, _call: fakeCall });
  assert.strictEqual(e.verified, true);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/scene.test.js`
预期：FAIL，`nodeCreate is not a function`

- [ ] **步骤 3：编写最少实现代码**

```csharp
// unity-scripts/node-create.cs
// 入参：parameters["param0"] = {"name":"Brick","parent":"Canvas","components":["cc.Sprite"]}
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var name = (string)req["name"];
var parentPath = (string)req["parent"];
var go = new GameObject(name);
if (!string.IsNullOrEmpty(parentPath))
{
    var parent = GameObject.Find(parentPath);
    if (parent == null) return "{\"__error\":\"PARENT_NOT_FOUND\"}";
    go.transform.SetParent(parent.transform, false);
}
foreach (var c in (Newtonsoft.Json.Linq.JArray)(req["components"] ?? new Newtonsoft.Json.Linq.JArray()))
{
    var t = System.Type.GetType((string)c + ", UnityEngine");
    if (t != null && go.GetComponent(t) == null) go.AddComponent(t);
}
var o = new Newtonsoft.Json.Linq.JObject();
o["name"] = go.name;
o["active"] = go.activeSelf;
o["path"] = parentPath == null || parentPath == "" ? go.name : parentPath + "/" + go.name;
return o.ToString(Newtonsoft.Json.Formatting.None);
```

```csharp
// unity-scripts/node-set.cs
// 入参：parameters["param0"] = {"path":"Brick","patch":{"active":false,"position":{"x":1,"y":2,"z":0}}}
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var p = (string)req["path"];
var go = GameObject.Find(p);
if (go == null) return "{\"__error\":\"NOT_FOUND\"}";
var patch = (Newtonsoft.Json.Linq.JObject)req["patch"];
if (patch["name"] != null) go.name = (string)patch["name"];
if (patch["active"] != null) go.SetActive((bool)patch["active"]);
if (patch["position"] != null)
{
    var v = (Newtonsoft.Json.Linq.JObject)patch["position"];
    go.transform.localPosition = new Vector3((float)v["x"], (float)v["y"], (float)v["z"]);
}
if (patch["scale"] != null)
{
    var v = (Newtonsoft.Json.Linq.JObject)patch["scale"];
    go.transform.localScale = new Vector3((float)v["x"], (float)v["y"], (float)v["z"]);
}
return "{\"__written\":true}";
```

```js
// 追加到 lib/scene.js
const { verifyWrite } = require('./readback.js');

/** 建节点。uloop 的 Success 只说明代码跑了，因此**必须**读回验证。 */
async function nodeCreate({ projectPath, env, name, parent, components = [], _call } = {}) {
  const callFn = _call || call;
  const w = await callFn('execute-dynamic-code', buildPayloadArgs('node-create', { name, parent, components }), { projectPath, env });
  const envl = fromUloop(w.json);
  if (!envl.ok) return envl;
  if (envl.actual && envl.actual.Result && envl.actual.Result.includes('__error')) {
    return fail({ code: JSON.parse(envl.actual.Result).__error, message: `建节点失败：${name}` });
  }
  return nodeInspect({ projectPath, env, path: parent ? `${parent}/${name}` : name, _call: callFn });
}

/** 改节点，然后读回比对 intent vs actual。 */
async function nodeSet({ projectPath, env, path: nodePath, patch, _call } = {}) {
  const callFn = _call || call;
  const w = await callFn('execute-dynamic-code', buildPayloadArgs('node-set', { path: nodePath, patch }), { projectPath, env });
  const envl = fromUloop(w.json);
  if (!envl.ok) return envl;

  const r = await verifyWrite({
    intent: patch,
    readActual: async () => {
      const read = await nodeInspect({ projectPath, env, path: nodePath, _call: callFn });
      return read.ok ? read.actual : {};
    },
  });
  return { ok: true, ...r, hint: [] };
}
```

在 `bin/unity.js` 的 `node` 分支加入 `create` / `set`（`set` 的 patch 从 `--patch <json>` 取）。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/scene.test.js`
预期：PASS（6 个测试）

- [ ] **步骤 5：真机验证（必做）**

```bash
P=C:/Users/<用户>/pi-unity-spike/S0Project
node bin/unity.js node create --project-path $P --name PiProbe
node bin/unity.js node set --project-path $P --path PiProbe --patch '{"position":{"x":1,"y":2,"z":0}}'
```
预期：两条都输出 `"verified": true`
**反向验证**（证明 verified 不是摆设）：`--patch '{"position":{"x":1e30,"y":0,"z":0}}'` 应报 `verified: false`

- [ ] **步骤 6：Commit**

```bash
git add unity-scripts/node-create.cs unity-scripts/node-set.cs lib/scene.js bin/unity.js test/scene.test.js
git commit -m "feat(scene): node create/set 写路径 + 写后读回验证"
```

---

### 任务 11：`unity shot` 截图（含 O6 窗口名映射）

**文件：**
- 创建：`lib/shot.js`
- 修改：`bin/unity.js`
- 创建：`test/shot.test.js`

- [ ] **步骤 1：编写失败的测试**

```js
// test/shot.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { windowNameFor, isLocalizedMiss, pickScreenshot } = require('../lib/shot.js');

test('窗口名按语言映射（实测 zh_CN 的 Game 是「游戏」）', () => {
  assert.strictEqual(windowNameFor('Game', 'zh_CN'), '游戏');
  assert.strictEqual(windowNameFor('Scene', 'zh_CN'), '场景');
  assert.strictEqual(windowNameFor('Game', 'en_US'), 'Game');
});

test('未知语言回落到英文原名', () => {
  assert.strictEqual(windowNameFor('Game', 'ja_JP'), 'Game');
});

test('识别本地化导致的窗口找不到（U7）', () => {
  assert.strictEqual(isLocalizedMiss("Window 'Game' not found (MatchMode: exact)"), true);
  assert.strictEqual(isLocalizedMiss('Some other error'), false);
});

test('pickScreenshot 从结果里取第一张图路径', () => {
  const j = { Success: true, Screenshots: [{ ImagePath: 'C:/a.png', Width: 100, Height: 50 }] };
  assert.deepStrictEqual(pickScreenshot(j), { path: 'C:/a.png', width: 100, height: 50 });
});

test('pickScreenshot 无图时返回 null', () => {
  assert.strictEqual(pickScreenshot({ Success: true, Screenshots: [] }), null);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/shot.test.js`
预期：FAIL，`Cannot find module '../lib/shot.js'`

- [ ] **步骤 3：编写最少实现代码**

```js
// lib/shot.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { call } = require('./uloop.js');
const { fromUloop, fail } = require('./envelope.js');
const { language } = require('./editor-discovery.js');

/**
 * 窗口名映射（O6）。
 * 实测：uloop 的 --window-name 是**按标题字符串**比较的，中文编辑器上英文名全部失效（U7）。
 * 完整映射应由运行时枚举 EditorWindow 得到；此处提供覆盖常见窗口的静态表作为可用起点，
 * 并在 miss 时给出可操作的 hint。
 */
const ZH = {
  Game: '游戏',
  Scene: '场景',
  Console: '控制台',
  Hierarchy: '层级',
  Project: '项目',
  Inspector: '检查器',
};

function windowNameFor(name, lang) {
  if (lang === 'zh_CN') return ZH[name] || name;
  return name;
}

/** 识别「窗口名因本地化而失配」（U7） */
function isLocalizedMiss(message) {
  return typeof message === 'string' && /Window '.*' not found/i.test(message);
}

function pickScreenshot(json) {
  const s = json && Array.isArray(json.Screenshots) ? json.Screenshots[0] : null;
  if (!s || !s.ImagePath) return null;
  return { path: s.ImagePath, width: s.Width, height: s.Height };
}

/**
 * 截图。优先走 PlayMode 的 rendering 模式（忽略窗口名，彻底绕开 U7）。
 * 否则按界面语言换算窗口名。
 */
async function shot({ projectPath, env, outDir, windowName = 'Game' } = {}) {
  const lang = language({ env });
  const args = [];
  if (outDir) args.push('--output-directory', outDir);
  args.push('--window-name', windowNameFor(windowName, lang));

  const r = await call('screenshot', args, { projectPath, env });
  const envl = fromUloop(r.json);
  if (!envl.ok) {
    const msg = (r.json && r.json.Error && r.json.Error.Message) || '';
    if (isLocalizedMiss(msg)) {
      return fail({
        code: 'WINDOW_NAME_LOCALIZED',
        message: msg,
        hint: [
          `当前界面语言：${lang}；已尝试窗口名：${windowNameFor(windowName, lang)}`,
          '改用对应语言的窗口名（--window-name 传本地化名）',
          '或进入 PlayMode 后再截图（capture-mode auto 会切到 rendering，忽略窗口名）',
        ],
      });
    }
    return envl;
  }

  const picked = pickScreenshot(r.json);
  if (!picked) {
    return fail({ code: 'NO_SCREENSHOT', message: 'screenshot 未返回图像路径', actual: r.json });
  }
  return { ok: true, verified: true, actual: picked, hint: [] };
}

module.exports = { shot, windowNameFor, isLocalizedMiss, pickScreenshot };
```

在 `bin/unity.js` 注册：

```js
  shot: async (rest) => {
    const { parseArgs } = require('../lib/args.js');
    const { emit } = require('../lib/envelope.js');
    const args = parseArgs(rest);
    const { shot } = require('../lib/shot.js');
    const e = await shot({
      projectPath: args['project-path'],
      outDir: args.out,
      windowName: args['window-name'] || 'Game',
    });
    emit(e, { json: true });
    return e.ok ? 0 : 1;
  },
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/shot.test.js`
预期：PASS（5 个测试）

- [ ] **步骤 5：真机验证（必做）**

```bash
P=C:/Users/<用户>/pi-unity-spike/S0Project
node bin/unity.js shot --project-path $P --out C:/Users/<用户>/pi-unity-spike/shots
# 然后用 read 工具**真的看图**，确认画面正确
```
预期：返回 PNG 路径；若报 `WINDOW_NAME_LOCALIZED` 说明映射表需按实际语言补全

- [ ] **步骤 6：Commit**

```bash
git add lib/shot.js bin/unity.js test/shot.test.js
git commit -m "feat(shot): 截图 + 窗口名本地化映射（U7）"
```

---

### 任务 12：`SKILL.md` v1 + 文档回写

**文件：**
- 创建：`skills/unity-game-dev/SKILL.md`
- 修改：`docs/PITFALLS.md`（补新坑并标注适用引擎）
- 修改：`README.md`（更新状态）
- 修改：`docs/superpowers/specs/2026-09-18-pi-unity-design.md`（§9 里程碑标注 M1 完成）

- [ ] **步骤 1：写 `skills/unity-game-dev/SKILL.md`**

必须包含（每条都要有可执行命令，不写空话）：

1. **前置检查**：第一条命令永远是 `unity doctor`；不绿不许往下做
2. **铁律**：uloop 的 `Success:true` **不等于**意图达成；写操作看 `verified`，`false` 就停下处理
3. **搭场景黄金流程**：`unity scene tree` 读现状 → `unity node create` → `unity node set` → `unity shot` **真的看图**
4. **截图注意**：窗口名按语言；优先 PlayMode rendering
5. **停止条件**：删节点 / 覆盖已有脚本 / 改 Build Settings 要先问用户
6. **迭代上限**：截图不对最多改 3 次，仍不对就把图给用户
7. **常见错误**：引用 `docs/PITFALLS.md` 的 U 编号

`description` 字段必须写成**触发条件**（不是能力总结），至少覆盖：

```
Use when building, changing, previewing or shipping a Unity / 团结引擎 game through the unity CLI —
搭场景、建节点、挂组件、写脚本、截图验证、构建出包；用户说「用 Unity 做个游戏」「在团结引擎里搭界面」时。
```

- [ ] **步骤 2：验证 skill 能被 Pi 加载**

```bash
node -e "const f=require('fs').readFileSync('skills/unity-game-dev/SKILL.md','utf8'); \
  const m=f.match(/^---\n([\s\S]*?)\n---/); \
  if(!m) throw new Error('缺 frontmatter'); \
  if(!/^name: /m.test(m[1])) throw new Error('缺 name'); \
  if(!/^description: /m.test(m[1])) throw new Error('缺 description'); \
  console.log('frontmatter OK, description 长度 =', m[1].match(/description: (.*)/)[1].length);"
```
预期：`frontmatter OK`，description 长度 < 1024

- [ ] **步骤 3：回写 `docs/PITFALLS.md`**

本次 M1 实现中新发现（若有）按 U11 起编号追加，**每条必须标注**：
`[团结 2022.3.62t9 实测]` 以及是否已确认在 Unity 官方版同样成立（未装官方版时写 `[Unity 官方未验证]`）。

同时更新索引表。

- [ ] **步骤 4：跑全量测试**

运行：`npm test`
预期：全部 PASS，无失败

- [ ] **步骤 5：真机端到端验收**

```bash
P=C:/Users/<用户>/pi-unity-spike/S0Project
node bin/unity.js doctor --project-path $P          # 全绿
node bin/unity.js doctor --project-path $P --smoke  # 全 pass
node bin/unity.js node create --project-path $P --name M1Probe
node bin/unity.js node set --project-path $P --path M1Probe --patch '{"position":{"x":0,"y":3,"z":0}}'
node bin/unity.js shot --project-path $P --out C:/Users/<用户>/pi-unity-spike/shots
```
四条判据：
1. `doctor` 退出码 0
2. `--smoke` 全 `pass`
3. `node create` / `node set` 均 `verified: true`
4. **用 `read` 真的看图**，画面里能看到 `M1Probe`

- [ ] **步骤 6：Commit**

```bash
git add skills/unity-game-dev/SKILL.md docs/PITFALLS.md README.md \
        docs/superpowers/specs/2026-09-18-pi-unity-design.md
git commit -m "docs(m1): SKILL v1 + 坑位回写 + 里程碑标注"
```

---

## 自检

**1. 规格覆盖度**

| 规格条目 | 落在哪个任务 |
|---|---|
| D1 主选 uloop | 任务 3（后端适配） |
| D3 C# 放包内 + JSON 契约 | 任务 9/10（`unity-scripts/*.cs` + `buildPayloadArgs`） |
| D5 包名/命令/skill 名 | 任务 1（`bin/unity.js`）+ 任务 12（`skills/unity-game-dev`） |
| D6 团结=验证环境、差异标注 | 任务 12 步骤 3（PITFALLS 标注约定） |
| O5 编辑器发现四层 | 任务 5 |
| O6 窗口名/语言 | 任务 11 |
| O9 构建目标枚举 | 任务 6（`playbackEngines`） |
| §3.2 ① 信封层 = 写后读回比对 | 任务 4（信封）+ 任务 8（readback） |
| §6.1 写后读回铁律 | 任务 8 + 任务 10 反向验证 |
| §6.2 doctor/smoke | 任务 6 + 任务 7 |
| §6.3 里程碑回写 | 任务 12 |

**未覆盖（明确划出 M1 之外）**：`golden` 黄金测试（R7 只做了初步验证）、构建命令 `unity build`（S8 已手工验证，命令化留 M3）、试玩闭环 `unity play`、skill 完整版与 E2E 盲测。

**2. 占位符扫描**：无 `TODO` / `待定` / 「类似任务 N」；每个代码步骤都给了可运行的完整代码。

**3. 类型一致性**：`buildPayloadArgs(scriptName, payload)` / `verifyWrite({intent, readActual})` / `fromUloop(json)` / `emit(envelope, {json})` / `compareSubset(intent, actual)` 在定义处与使用处签名一致；`nodeInspect` 的 `_call` 注入口在任务 10 复用任务 9 的签名。

---

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-09-18-pi-unity-m1-implementation.md`。两种执行方式：

**1. 子代理驱动（推荐）** —— 每个任务调度一个新子代理，任务间进行审查，快速迭代
**2. 内联执行** —— 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

选哪种方式？
