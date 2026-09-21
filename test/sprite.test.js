'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spriteSet } = require('../lib/sprite.js');
const { exitCodeFor } = require('../lib/envelope.js');

function fakeCall(json, spy = []) {
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

/** 按调用序回放（第 1 次 = sprite-set 写，第 2 次 = node-inspect 读回）。 */
function sequenceCall(results, spy = []) {
  let n = 0;
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    const json = results[Math.min(n, results.length - 1)];
    n++;
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

const READBACK = {
  name: 'Paddle', active: true, path: 'Paddle',
  components: ['Transform', 'SpriteRenderer'],
  position: { x: 0, y: -4.2, z: 0 }, scale: { x: 2.4, y: 0.35, z: 1 },
  sprite: { present: true, color: { r: 0, g: 255, b: 200, a: 255 }, sortingOrder: 0, sortingLayerName: 'Default', spriteName: 'Sprite' },
};

test('spriteSet 缺 --path / 裸 --path → MISSING_PATH，不发起写', async () => {
  for (const p of [undefined, '', true]) {
    const spy = [];
    const e = await spriteSet({ projectPath: 'X', path: p, color: { r: 0, g: 255, b: 200 }, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'MISSING_PATH');
    assert.strictEqual(spy.length, 0);
  }
});

test('spriteSet 缺 color 或 color 非法 → BAD_COLOR（用法错，退出码 2），不发起写', async () => {
  for (const bad of [undefined, null, 'x', { r: 1 }, { r: 0, g: 255, b: 200, a: 999 }]) {
    const spy = [];
    const e = await spriteSet({ projectPath: 'X', path: 'Paddle', color: bad, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'BAD_COLOR', `${JSON.stringify(bad)} 应落 BAD_COLOR`);
    assert.strictEqual(spy.length, 0);
    assert.strictEqual(exitCodeFor(e), 2);
  }
});

test('spriteSet --sorting-order 非整数 / 超 int32 → BAD_SORTING_ORDER（用法错，退出码 2），不发起写', async () => {
  // R247：`3000000000` 曾穿过 `Number.isInteger` 守卫，在 `sprite-set.cs` 的 `(int)` 转换上
  // 抛异常（运行时错，退出码 1），但它本质是**用法错**（2）—— 用法错必须只由 argv 决定（R237）。
  for (const bad of ['x', 1.5, 3000000000, -3000000000]) {
    const spy = [];
    const e = await spriteSet({
      projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 }, sortingOrder: bad,
      _call: fakeCall({ Success: true }, spy),
    });
    assert.strictEqual(e.code, 'BAD_SORTING_ORDER', `${bad} 应落 BAD_SORTING_ORDER`);
    assert.strictEqual(exitCodeFor(e), 2);
    assert.strictEqual(spy.length, 0);
  }
});

test('spriteSet --sorting-order 合法值：进 intent，也进写载荷，且读回一致 → verified:true', async () => {
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __written: true }) },
    { Success: true, Result: JSON.stringify({ ...READBACK, sprite: { ...READBACK.sprite, sortingOrder: 5 } }) },
  ], spy);
  const e = await spriteSet({ projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 }, sortingOrder: 5, _call: call });
  assert.strictEqual(e.intent.sprite.sortingOrder, 5);
  assert.strictEqual(e.verified, true);
  const payload = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.strictEqual(payload.sortingOrder, 5);
});

test('spriteSet 成功：读回颜色一致 → verified:true，intent 是 {sprite:{color}} 子集', async () => {
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __written: true }) },
    { Success: true, Result: JSON.stringify(READBACK) },
  ], spy);
  const e = await spriteSet({ projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 }, _call: call });
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(e.intent, { sprite: { color: { r: 0, g: 255, b: 200 } } });
  assert.deepStrictEqual(e.mismatches, []);
  // 载荷契约：parameters["param0"] 且只有一个 key p
  const payload = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.deepStrictEqual(Object.keys(JSON.parse(spy[0].args[3])), ['p']);
  assert.deepStrictEqual(payload, { path: 'Paddle', color: { r: 0, g: 255, b: 200 } });
  assert.ok(spy[0].args[1].endsWith('sprite-set.cs'));
});

test('spriteSet 颜色不一致（Unity 侧被改）→ verified:false + sprite.color 分歧', async () => {
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __written: true }) },
    { Success: true, Result: JSON.stringify({ ...READBACK, sprite: { ...READBACK.sprite, color: { r: 255, g: 0, b: 0, a: 255 } } }) },
  ]);
  const e = await spriteSet({ projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 }, _call: call });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'sprite.color.r');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('spriteSet 读回没有 sprite 字段（SpriteRenderer 没挂上）→ verified:false', async () => {
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __written: true }) },
    { Success: true, Result: JSON.stringify({ ...READBACK, components: ['Transform'], sprite: null }) },
  ]);
  const e = await spriteSet({ projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 }, _call: call });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.mismatches[0].key, 'sprite');
});

// F3/R348（原延后项 D14）：写路径遇传输层截断 → hint 必须提示「先复核再重试」（否则重试会重复上色），
// 且**只加 hint**：code/retryable/退出码不动。
test('spriteSet 遇 ULOOP_TRUNCATED：hint 提示先复核再重试，code/退出码不变（F3/R348）', async () => {
  let calls = 0;
  const e = await spriteSet({
    projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 },
    _call: async (tool, args) => {
      calls++;
      return { code: 124, stdout: '', stderr: '', timedOut: true, drained: false, json: null, truncated: true, tool, args };
    },
  });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
  assert.strictEqual(e.verified, false);
  assert.strictEqual(e.retryable, true);
  assert.strictEqual(exitCodeFor(e), 1, '只加 hint，不得改退出码');
  assert.strictEqual(calls, 1, '截断后立即短路，不得再发起读回调用');
  assert.ok(
    e.hint.some((h) => /复核/.test(h) && /node inspect/.test(h)),
    `缺「先复核再重试」的 hint：${JSON.stringify(e.hint)}`,
  );
  assert.ok(e.hint.some((h) => /已存在|已改动/.test(h)), `必须点明「可能已生效」：${JSON.stringify(e.hint)}`);
});

test('spriteSet 写调用 reject → WRITE_CALL_FAILED（phase:write，退出码 1），intent 仍在', async () => {
  const e = await spriteSet({
    projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 },
    _call: async () => { throw new Error('编辑器未连接'); },
  });
  assert.strictEqual(e.code, 'WRITE_CALL_FAILED');
  assert.strictEqual(e.phase, 'write');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.deepStrictEqual(e.intent, { sprite: { color: { r: 0, g: 255, b: 200 } } });
});

test('spriteSet 读回返回失败信封 → READBACK_FAILED（phase:readback，退出码 1），residue 是 sprite 专属文案', async () => {
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __written: true }) },
    // 平铺的 first-party 工具级失败形状（R108）：无 Error 子对象、无 NextActions → read.hint 为空
    { Success: false, Message: '读回时编辑器未响应' },
  ]);
  const e = await spriteSet({ projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 }, _call: call });
  assert.strictEqual(e.code, 'READBACK_FAILED');
  assert.strictEqual(e.phase, 'readback');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.deepStrictEqual(e.intent, { sprite: { color: { r: 0, g: 255, b: 200 } } });
  // R245 收口后，这条是**唯一**确保 sprite 的 residue 文案没被 `readBackAndVerify` 的
  // 中性默认文案顶掉的地方（默认文案说的是 create/set 的复核方式，对 sprite 是错的）。
  assert.ok(e.hint.some((h) => h.includes('HideAndDontSave')), `缺 sprite residue 文案：${JSON.stringify(e.hint)}`);
  assert.ok(e.hint.some((h) => h.includes('不随场景保存')), `缺 sprite residue 文案：${JSON.stringify(e.hint)}`);
});

test('spriteSet .cs 报 SPRITE_CREATE_FAILED → 直接按码失败（退出码 1）', async () => {
  const e = await spriteSet({
    projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200 },
    _call: fakeCall({ Success: true, Result: JSON.stringify({ __error: 'SPRITE_CREATE_FAILED', detail: 'null texture' }) }),
  });
  assert.strictEqual(e.code, 'SPRITE_CREATE_FAILED');
  assert.strictEqual(exitCodeFor(e), 1);
});

test('spriteSet 节点不存在 → NOT_FOUND（退出码 1）', async () => {
  const e = await spriteSet({
    projectPath: 'X', path: 'Nope', color: { r: 0, g: 255, b: 200 },
    _call: fakeCall({ Success: true, Result: JSON.stringify({ __error: 'NOT_FOUND' }) }),
  });
  assert.strictEqual(e.code, 'NOT_FOUND');
  assert.deepStrictEqual(e.actual, { path: 'Nope' });
});

test('spriteSet 显式带 alpha → intent 与载荷都含 a，8bit alpha 往返读回 verified:true（lib 直调路径：a 缺省时不进 intent）', async () => {
  const spy = [];
  const call = sequenceCall([
    { Success: true, Result: JSON.stringify({ __written: true }) },
    // 读回侧必须是 a=128：旧用例给了 a=255（=缺省值）却无人断言 verified，
    // 于是「alpha 被 Unity 吞掉」这条路径实际是 verified:false 而无测试覆盖（R246）。
    { Success: true, Result: JSON.stringify({ ...READBACK, sprite: { ...READBACK.sprite, color: { r: 0, g: 255, b: 200, a: 128 } } }) },
  ], spy);
  const e = await spriteSet({ projectPath: 'X', path: 'Paddle', color: { r: 0, g: 255, b: 200, a: 128 }, _call: call });
  assert.strictEqual(e.verified, true);
  assert.deepStrictEqual(e.intent, { sprite: { color: { r: 0, g: 255, b: 200, a: 128 } } });
  const payload = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.deepStrictEqual(payload.color, { r: 0, g: 255, b: 200, a: 128 });
});

test('CLI sprite set 的 --color 解析：合法 hex 走通、非法 → 2；子动作非 set → 2（usage 走 stderr）', async () => {
  const { main } = require('../bin/unity.js');
  const { captureStdout, captureStderr } = require('./helpers/capture.js');
  const bad = await captureStdout(() => main(['sprite', 'set', '--project-path', 'X', '--path', 'P', '--color', 'not-a-color', '--json']));
  assert.strictEqual(bad.result, 2);
  assert.strictEqual(JSON.parse(bad.out).code, 'BAD_COLOR');
  // R249：usage 行是写 stderr 的 —— 只 captureStdout 会让它漏到 runner 的 stderr（脏输出）。
  const noSub = await captureStderr(() => main(['sprite', 'bogus', '--json']));
  assert.strictEqual(noSub.result, 2);
  assert.match(noSub.out, /usage: unity sprite set/);
});

// ─────────── M2 任务 5：sprite-set.cs / node-inspect.cs ↔ JS 契约 tripwire ───────────
// 全局约束 18：新增 `.cs` 与它的 JS 契约（载荷字段名 / `__error` 码 / 回读字段名）
// 必须有断言把两边钉在一起。⚠️ 这是**字符串 tripwire，不是行为测试**：它测不出
// CS0136/CS8421 这类编译错误，也测不出真机上「纹理没上传/方块看不见」——
// 那些只能靠上报的真机验证（见 task-5-report.md 步骤 5）。
test('跨语言 tripwire：sprite-set.cs 载荷/错误码 与 node-inspect.cs 的 sprite 读回字段逐字一致', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'unity-scripts');
  const set = fs.readFileSync(path.join(dir, 'sprite-set.cs'), 'utf8');
  const inspect = fs.readFileSync(path.join(dir, 'node-inspect.cs'), 'utf8');

  // 载荷走恒定的 param0 槽位（uloop 丢弃 key、按 key 排序位置化）
  assert.match(set, /parameters\["param0"\]/);
  // `.cs` 从载荷里读的字段必须与 `lib/sprite.js` 组装的 payload 键集合逐字一致
  // （少一个 = 该参数被静默忽略，读回却可能碰巧一致 → 假绿；多一个 = 读了没人写的字段）
  const payloadReads = [...new Set([...set.matchAll(/req\["([^"]+)"\]/g)].map((m) => m[1]))].sort();
  assert.deepStrictEqual(payloadReads, ['color', 'path', 'sortingOrder']);
  // color 的通道：a 可选（缺省 255），r/g/b 必读。⚠️ 用 matchAll 抽取而不是
  // `new RegExp(\`colorTok\["${ch}"\]\`)` —— 模板字面量里的 `\[` 是 NonEscapeCharacter，
  // 编出的正则是 `colorTok["r"]`，`["r"]` 是**字符类**（恒不命中），R218 已实证过这种无牙断言。
  const colorReads = [...new Set([...set.matchAll(/colorTok\["([^"]+)"\]/g)].map((m) => m[1]))].sort();
  assert.deepStrictEqual(colorReads, ['a', 'b', 'g', 'r']);
  // 错误码契约：`lib/sprite.js` 的 parseNodeResult 只认这些 `__error`
  for (const code of ['BAD_PAYLOAD', 'NOT_FOUND', 'COMPONENT_ADD_FAILED', 'SPRITE_CREATE_FAILED']) {
    assert.match(set, new RegExp(`"${code}"`), `sprite-set.cs 必须保留 __error 码 ${code}`);
  }
  assert.match(set, /"__written":true/);
  // 决策三：pixelsPerUnit **必须是 1f**（默认 100 会让 1x1 纹理只有 0.01 世界单位 → 看不见）
  assert.match(set, /new Rect\(0, 0, 1, 1\), new Vector2\(0\.5f, 0\.5f\), 1f\)/);
  // 决策四：只在 sprite 为空时造纹理/sprite（否则每次改色都泄漏一张 Texture2D）
  assert.match(set, /if \(sr\.sprite == null\)/);
  assert.match(set, /HideFlags\.HideAndDontSave/);

  // 读回面：intent 形状 `{sprite:{color:{...},sortingOrder?}}` 必须能在 node-inspect 的输出里找到
  assert.match(inspect, /o\["sprite"\]/);
  const spriteKeys = [...new Set([...inspect.matchAll(/sp\["([^"]+)"\]/g)].map((m) => m[1]))].sort();
  for (const key of ['color', 'present', 'sortingLayerName', 'sortingOrder', 'spriteName']) {
    assert.ok(spriteKeys.includes(key), `node-inspect.cs 的 sprite 子对象必须含 ${key}`);
  }
  // 颜色 8bit 往返：写入用 Color32（byte），读回用 Math.round(c * 255f)。
  // R246：`/Math\.Round\(sr\.color\.[rgb] \* 255f\)/` 是**字符类**，只需命中一个通道 ——
  // 删掉 `node-inspect.cs` 的 `["a"]` 读回行仍全绿，而 CLI 路径的 intent 恒带 a
  // （`lib/color.js` 对 3/6 位 hex 也返回 a:255）→ 每次 `sprite set` 都会 verified:false。
  // 必须做**集合相等**断言（正反两向都拦）。
  assert.match(set, /sr\.color = new Color32\(/);
  const colorReadsBack = [...new Set([...inspect.matchAll(/sr\.color\.([rgba]) \* 255f/g)].map((m) => m[1]))].sort();
  assert.deepStrictEqual(colorReadsBack, ['a', 'b', 'g', 'r']);
  // F2：没有 SpriteRenderer 时必须写 JSON null（省略字段 = compareSubset 记一条 key:'sprite' 分歧，正是所需）
  assert.match(inspect, /o\["sprite"\] = null;/);
});
