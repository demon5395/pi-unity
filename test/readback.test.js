'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { compareSubset, verifyWrite, isPlainObject } = require('../lib/readback.js');

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

test('NaN 参与数值比较时不静默假绿（单侧 NaN 算 mismatch，双侧视为一致）', () => {
  // R47：`Math.abs(NaN - 5) > tol` 恒为 false，简报字面实现会漏判。
  const m = compareSubset({ fieldOfView: NaN }, { fieldOfView: 5 });
  assert.strictEqual(m.length, 1);
  assert.ok(Number.isNaN(m[0].intent));
  assert.strictEqual(m[0].actual, 5);
  // 同一份读数两侧都是 NaN：视为一致，否则每次读回都报分歧。
  assert.deepStrictEqual(compareSubset({ fieldOfView: NaN }, { fieldOfView: NaN }), []);
});

test('数组比较：长度不同算 mismatch，元素不得因序列化把 NaN/undefined 变成 null 而假绿', () => {
  const longer = compareSubset({ tags: [1, 2] }, { tags: [1, 2, 3] });
  assert.strictEqual(longer.length, 1);
  assert.strictEqual(longer[0].key, 'tags');
  assert.deepStrictEqual(longer[0].intent, [1, 2]);
  assert.deepStrictEqual(longer[0].actual, [1, 2, 3]);
  // R48：JSON.stringify 会把 [NaN] / [undefined] 都变成 [null]，与 [null] 假绿。
  assert.strictEqual(compareSubset({ tags: [NaN] }, { tags: [null] }).length, 1);
  assert.strictEqual(compareSubset({ tags: [undefined] }, { tags: [null] }).length, 1);
});

test('数组元素为普通对象时逐元素递归，不受键序影响', () => {
  // R48：JSON.stringify 对对象元素键序敏感 → 等价数据被误报为分歧。
  assert.deepStrictEqual(
    compareSubset({ items: [{ a: 1, b: 2 }] }, { items: [{ b: 2, a: 1 }] }),
    []
  );
});

test('intent 里的非普通对象值（Date/Map/Set/RegExp/类实例）必须报分歧', () => {
  // F1：旧 isPlainObject 只判「非 null + object + 非数组」，`Object.entries(new Date())`
  // 是空数组 → 递归返回 [] → verified:true 假绿。
  class Box {
    constructor(v) {
      this.v = v;
    }
  }
  const pairs = [
    [new Date(0), new Date(1)],
    [new Map([['a', 1]]), new Map([['a', 2]])],
    [new Set([1]), new Set([2])],
    [/a/, /b/],
    [new Box(1), new Box(2)],
  ];
  for (const [iv, av] of pairs) {
    const m = compareSubset({ d: iv }, { d: av });
    assert.strictEqual(m.length, 1, `${iv.constructor.name} 应报 1 条分歧`);
    assert.strictEqual(m[0].key, 'd');
    assert.strictEqual(m[0].intent, iv);
    assert.strictEqual(m[0].actual, av);
  }
  // 严格化不得误伤 null 原型对象（按 F1 定义仍属普通对象，仍递归）。
  const nullProto = Object.assign(Object.create(null), { x: 1 });
  assert.deepStrictEqual(compareSubset({ d: nullProto }, { d: { x: 1 } }), []);
});

test('intent 为空对象时仍要校验 actual 侧类型；两侧都是空对象才算一致', () => {
  // F2：旧实现递归进空对象 → Object.entries({}) 为空 → 静默通过。
  const toScalar = compareSubset({ a: {} }, { a: 'hello' });
  assert.strictEqual(toScalar.length, 1);
  assert.strictEqual(toScalar[0].key, 'a');
  assert.deepStrictEqual(toScalar[0].intent, {});
  assert.strictEqual(toScalar[0].actual, 'hello');

  const missing = compareSubset({ a: {} }, {});
  assert.strictEqual(missing.length, 1);
  assert.strictEqual(missing[0].key, 'a');
  assert.strictEqual(missing[0].actual, undefined);

  // 边界：两侧都是空对象 —— 空对象在 subset 语义下确实没有约束，判一致。
  assert.deepStrictEqual(compareSubset({ a: {} }, { a: {} }), []);
  assert.deepStrictEqual(compareSubset({ a: {} }, { a: {}, extra: 1 }), []);

  // 数组元素递归同样要校验 actual 侧类型（F2 第二处）。
  const inArray = compareSubset({ items: [{}] }, { items: ['x'] });
  assert.strictEqual(inArray.length, 1);
  assert.strictEqual(inArray[0].key, 'items.0');
  assert.strictEqual(inArray[0].actual, 'x');
});

test('intent 本身不是普通对象时返回 1 条分歧（返回空列表 ≠ 验证通过）', () => {
  // F3：旧实现返回 [] → verifyWrite 假绿。
  const arrRoot = compareSubset([1, 2], [1, 3]);
  assert.strictEqual(arrRoot.length, 1);
  assert.strictEqual(arrRoot[0].key, '<root>');
  assert.deepStrictEqual(arrRoot[0].intent, [1, 2]);
  assert.deepStrictEqual(arrRoot[0].actual, [1, 3]);

  const undef = compareSubset(undefined, {});
  assert.strictEqual(undef.length, 1);
  assert.strictEqual(undef[0].key, '<root>');
  assert.strictEqual(undef[0].intent, undefined);
  assert.deepStrictEqual(undef[0].actual, {});

  const strRoot = compareSubset('a', 'b');
  assert.strictEqual(strRoot.length, 1);
  assert.strictEqual(strRoot[0].key, '<root>');
});

test('verifyWrite：intent 非普通对象时不得 verified:true', async () => {
  const r = await verifyWrite({ intent: undefined, readActual: async () => ({ x: 1 }) });
  assert.strictEqual(r.verified, false);
  assert.strictEqual(r.mismatches.length, 1);
  assert.strictEqual(r.mismatches[0].key, '<root>');
  assert.strictEqual(r.intent, undefined);
  assert.deepStrictEqual(r.actual, { x: 1 });
});

test('verifyWrite：intent 是顶层空对象时不得 verified:true（零次比对 ≠ 验证通过）', async () => {
  // F1（R117）：顶层空对象没有任何可比字段 → 旧实现 mismatches=[] → 假绿。
  const r = await verifyWrite({ intent: {}, readActual: async () => ({ anything: 42 }) });
  assert.strictEqual(r.verified, false);
  assert.strictEqual(r.mismatches.length, 1);
  assert.strictEqual(r.mismatches[0].key, '<root>');
  assert.deepStrictEqual(r.mismatches[0].intent, {});
  assert.deepStrictEqual(r.mismatches[0].actual, { anything: 42 });
  assert.deepStrictEqual(r.intent, {});
  assert.deepStrictEqual(r.actual, { anything: 42 });

  // R117：compareSubset 保持纯比较语义 —— 无约束 = 无分歧（≠ 验证通过）。
  assert.deepStrictEqual(compareSubset({}, { anything: 42 }), []);
  // 顶层空对象 + actual 为空对象同样不构成「验证通过」。
  const emptyOnBoth = await verifyWrite({ intent: {}, readActual: async () => ({}) });
  assert.strictEqual(emptyOnBoth.verified, false);
  assert.strictEqual(emptyOnBoth.mismatches[0].key, '<root>');
});

test('数组元素也走容差与 NaN 规则（不能被 !== 替换）', () => {
  // F4①：把元素比较换成 `iv[i] !== av[i]` 后旧 10 条仍全绿 —— 这里钉住。
  assert.deepStrictEqual(compareSubset({ tags: [1.0] }, { tags: [1.0000001] }), []);

  const nan = compareSubset({ tags: [NaN] }, { tags: [5] });
  assert.strictEqual(nan.length, 1);
  assert.strictEqual(nan[0].key, 'tags.0');
  assert.ok(Number.isNaN(nan[0].intent));
  assert.strictEqual(nan[0].actual, 5);

  assert.deepStrictEqual(compareSubset({ tags: [NaN] }, { tags: [NaN] }), []);
});

test('actual 不是数组时报告 1 条分歧而不是抛 TypeError', () => {
  // F4②：删掉 `!Array.isArray(av)` 守卫后旧 10 条仍全绿（没测过缺字段的数组）。
  const m = compareSubset({ tags: [1] }, {});
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].key, 'tags');
  assert.deepStrictEqual(m[0].intent, [1]);
  assert.strictEqual(m[0].actual, undefined);

  const nonArray = compareSubset({ tags: [1] }, { tags: 'no' });
  assert.strictEqual(nonArray.length, 1);
  assert.strictEqual(nonArray[0].actual, 'no');
});

test('数组对象元素的路径形状为 items.0.a（任务 10 依赖）', () => {
  // F4③
  const m = compareSubset({ items: [{ a: 1 }] }, { items: [{ a: 2 }] });
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].key, 'items.0.a');
  assert.strictEqual(m[0].intent, 1);
  assert.strictEqual(m[0].actual, 2);
});

test('tol 非有限数或负数时抛 TypeError（不得静默关掉数值闸门）', () => {
  // F5：{tol:NaN} 会让所有数值比较静默通过；{tol:-1} 则全判分歧。
  assert.throws(() => compareSubset({ x: 1 }, { x: 1 }, { tol: NaN }), TypeError);
  assert.throws(() => compareSubset({ x: 1 }, { x: 1 }, { tol: Infinity }), TypeError);
  assert.throws(() => compareSubset({ x: 1 }, { x: 1 }, { tol: -1 }), TypeError);
  assert.throws(() => compareSubset({ x: 1 }, { x: 1 }, { tol: '1' }), TypeError);
  // 合法 tol 仍可用（含 0 与自定义放大）。
  assert.deepStrictEqual(compareSubset({ x: 1 }, { x: 1 }, { tol: 0 }), []);
  assert.deepStrictEqual(compareSubset({ x: 1 }, { x: 1.5 }, { tol: 1 }), []);
});

test('verifyWrite 传播 readActual 的抛出/拒绝（调用方必须落 fail，不得产 ok 信封）', async () => {
  await assert.rejects(
    () =>
      verifyWrite({
        intent: { a: 1 },
        readActual: async () => {
          throw new Error('read failed');
        },
      }),
    /read failed/
  );
  await assert.rejects(
    () =>
      verifyWrite({
        intent: { a: 1 },
        readActual: () => {
          throw new Error('sync boom');
        },
      }),
    /sync boom/
  );
});

// ─────────────────── M2 任务 1：isPlainObject 成为跨模块唯一真值 ───────────────────

test('isPlainObject 对普通对象/空原型对象为真，对 Date/Map/数组/标量为假（scene.js 复用同一实现）', () => {
  assert.strictEqual(isPlainObject({}), true);
  assert.strictEqual(isPlainObject({ a: 1 }), true);
  assert.strictEqual(isPlainObject(Object.create(null)), true);
  assert.strictEqual(isPlainObject([]), false);
  assert.strictEqual(isPlainObject(new Date()), false);
  assert.strictEqual(isPlainObject(new Map()), false);
  assert.strictEqual(isPlainObject(null), false);
  assert.strictEqual(isPlainObject(1), false);
  assert.strictEqual(isPlainObject('x'), false);
});
