'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { spriteAssign, parseWorldSizeArg } = require('../lib/sprite.js');
const { exitCodeFor } = require('../lib/envelope.js');

function fakeCall(json, spy = []) {
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}
/** 按调用序回放（1 = sprite-assign 写，2 = node-inspect 读回）。 */
function sequenceCall(results, spy = []) {
  let n = 0;
  return async (tool, args, opts) => {
    spy.push({ tool, args, opts });
    const json = results[Math.min(n, results.length - 1)];
    n++;
    return { code: 0, stdout: '', stderr: '', timedOut: false, drained: false, json, truncated: false, tool, args };
  };
}

const ASSET = 'Assets/Art/hero.png';
const WRITTEN = { Success: true, Result: JSON.stringify({ __written: true }) };
const READBACK = {
  name: 'Brick_0_0', active: true, path: 'Brick_0_0',
  components: ['Transform', 'SpriteRenderer'],
  position: { x: 0, y: 0, z: 0 }, scale: { x: 2.1333333, y: 2.1333333, z: 1 },
  sprite: {
    present: true, color: { r: 255, g: 255, b: 255, a: 255 },
    sortingOrder: 0, sortingLayerName: 'Default', spriteName: 'hero',
    assetPath: ASSET, ppu: 16, worldSize: { x: 1.6, y: 1.2 },
  },
};
const inspectEnvelope = (patch = {}) => ({
  Success: true,
  Result: JSON.stringify({ ...READBACK, sprite: { ...READBACK.sprite, ...patch } }),
});

test('spriteAssign：缺/裸 --path → MISSING_PATH，零调用', async () => {
  for (const p of [undefined, '', true]) {
    const spy = [];
    const e = await spriteAssign({ projectPath: 'P', path: p, asset: ASSET, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'MISSING_PATH');
    assert.strictEqual(exitCodeFor(e), 2);
    assert.strictEqual(spy.length, 0);
  }
});

test('spriteAssign：缺/非法 --asset → MISSING_ASSET / BAD_ASSET_PATH，零调用', async () => {
  const spy = [];
  // 只有「没给 / 裸写 flag（true）/ 非字符串」才是 MISSING_ASSET（R274 / R409 口径）
  for (const asset of [undefined, true]) {
    const e = await spriteAssign({ projectPath: 'P', path: 'N', asset, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'MISSING_ASSET', JSON.stringify(asset));
    assert.strictEqual(exitCodeFor(e), 2);
  }
  // R409：`--asset=''` 给了值（只是值为空）→ 与 R274 的 `--to=''` 对齐，落 BAD_ASSET_PATH（不是 MISSING_ASSET）
  for (const asset of ['', 'Art/a.png', 'Assets/../a.png', 'Assets/a/../../b.png', '/Assets/a.png', '//Assets/a.png']) {
    const e = await spriteAssign({ projectPath: 'P', path: 'N', asset, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'BAD_ASSET_PATH', asset);
    assert.strictEqual(exitCodeFor(e), 2);
  }
  assert.strictEqual(spy.length, 0);
});

test('spriteAssign：--asset 路径归一（折叠重复 /、去掉 ./ 段）→ intent 与载荷同源；`..` 按段判', async () => {
  // 归一：`Assets//Art///./hero.png` → `Assets/Art/hero.png`（Unity 回的是规范路径，不归一就假红）
  const spy = [];
  const call = sequenceCall([WRITTEN, inspectEnvelope({ assetPath: 'Assets/Art/hero.png' })], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: 'Assets//Art///./hero.png', _call: call });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(e.intent.sprite.assetPath, 'Assets/Art/hero.png');
  assert.strictEqual(JSON.parse(JSON.parse(spy[0].args[3]).p).asset, 'Assets/Art/hero.png');
  // `..` 按段判：`a..b.png` 里的 `..` 不是独立段 → 不再误拒
  for (const asset of ['Assets/a..b.png', './Assets/Art/hero.png']) {
    const s = [];
    const c = sequenceCall([WRITTEN, inspectEnvelope({ assetPath: asset.replace(/^\.\//, '') })], s);
    const r = await spriteAssign({ projectPath: 'P', path: 'N', asset, _call: c });
    assert.notStrictEqual(r.code, 'BAD_ASSET_PATH', `${asset} 不该被判成 BAD_ASSET_PATH`);
    assert.strictEqual(r.verified, true, `${asset}: ${JSON.stringify(r.mismatches)}`);
  }
});

test('spriteAssign：非法 --world-size → BAD_WORLD_SIZE，零调用', async () => {
  for (const bad of ['1.6', 'a,b', '1,2,3', '0,1', '-1,2', true]) {
    const spy = [];
    const e = await spriteAssign({ projectPath: 'P', path: 'N', asset: ASSET, worldSize: bad, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'BAD_WORLD_SIZE', JSON.stringify(bad));
    assert.strictEqual(exitCodeFor(e), 2);
    assert.strictEqual(spy.length, 0);
  }
});

test('spriteAssign：happy path —— intent 带 assetPath/worldSize，写载荷不带 sprite 外壳，读回走 node-inspect.cs', async () => {
  const spy = [];
  const call = sequenceCall([WRITTEN, inspectEnvelope()], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, worldSize: '1.6,1.2', _call: call });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.strictEqual(exitCodeFor(e), 0);
  // intent **不含 ppu**：PPU 来自资产自身，JS 侧无从得知（读回面的 sprite.ppu 只进 actual）
  assert.deepStrictEqual(e.intent, { sprite: { assetPath: ASSET, worldSize: { x: 1.6, y: 1.2 } } });
  const payload = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.deepStrictEqual(payload, { path: 'Brick_0_0', asset: ASSET, worldSize: { x: 1.6, y: 1.2 } });
  assert.strictEqual(payload.sprite, undefined);
  // R406⑤：把「读回发生在写之后、且读回用的是 node-inspect.cs」显式钉住
  assert.strictEqual(spy.length, 2);
  assert.ok(spy[1].args[1].endsWith('node-inspect.cs'), spy[1].args[1]);
});

test('spriteAssign：--world-size 亚容差（<= 1e-4）→ BAD_WORLD_SIZE（读回只到 1e-4，这种尺寸无法被验证）', async () => {
  for (const bad of ['0.00001,0.00001', '0.0001,0.0001', '1e-5,1']) {
    const spy = [];
    const e = await spriteAssign({ projectPath: 'P', path: 'N', asset: ASSET, worldSize: bad, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'BAD_WORLD_SIZE', JSON.stringify(bad));
    assert.strictEqual(exitCodeFor(e), 2);
    assert.ok(e.hint.join(' ').includes('1e-4'), `hint 必须讲明 1e-4 容差：${e.hint.join(' | ')}`);
    // R418④：hint 不许**夸大** —— 只有 ≤1e-4 才「无法验证」；略大于 1e-4 的值（如 1.1e-4 vs 2.1e-4）
    //   仍能穿过绝对容差 1e-4，其相对精度只有 `1e-4/值` → hint 必须讲明，并给可操作的建议量级。
    const tip = e.hint.join(' ');
    assert.ok(tip.includes('相对'), `hint 必须讲明「略大于 1e-4 时的相对精度」：${tip}`);
    assert.ok(tip.includes('0.001'), `hint 必须给出可操作的建议量级（≥0.001）：${tip}`);
    assert.strictEqual(spy.length, 0);
  }
  // 下界之上仍合法（0.0002 > 1e-4）
  const spy = [];
  const call = sequenceCall([WRITTEN, inspectEnvelope({ worldSize: { x: 0.0002, y: 1 } })], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'N', asset: ASSET, worldSize: '0.0002,1', _call: call });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
});

test('spriteAssign：--world-size 数值形态收紧（十六进制/科学计数/正号/Infinity/NaN 全拒）', async () => {
  for (const bad of ['0x10,1', '1e3,2', '+1,2', 'Infinity,1', 'NaN,1', '.5,1', '1.,2']) {
    const spy = [];
    const e = await spriteAssign({ projectPath: 'P', path: 'N', asset: ASSET, worldSize: bad, _call: fakeCall({ Success: true }, spy) });
    assert.strictEqual(e.code, 'BAD_WORLD_SIZE', JSON.stringify(bad));
    assert.strictEqual(exitCodeFor(e), 2);
    assert.strictEqual(spy.length, 0);
  }
});

test('parseWorldSizeArg 直测（R407：导出面唯一消费者是 spriteAssign，边界在这里逐条钉住）', () => {
  assert.deepStrictEqual(parseWorldSizeArg('1.6,1.2'), { x: 1.6, y: 1.2 });
  assert.deepStrictEqual(parseWorldSizeArg(' 2 , 3.5 '), { x: 2, y: 3.5 });
  assert.deepStrictEqual(parseWorldSizeArg('0.0002,1'), { x: 0.0002, y: 1 });
  for (const bad of [
    undefined, null, true, 1, {}, [], ['1', '2'],
    '', ',', '1,', ',2', '1.6', 'a,b', '1,2,3',
    '0,1', '-1,2', '-0.5,1',
    '0x10,1', '1e3,2', '+1,2', 'Infinity,1', '-Infinity,1', 'NaN,1', '.5,1', '1.,2',
    '0.00001,0.00001', '0.0001,0.0001', '1,0.0001',
  ]) {
    assert.strictEqual(parseWorldSizeArg(bad), null, JSON.stringify(bad));
  }
});

test('spriteAssign：不给 --world-size → intent 只有 assetPath（不动缩放），载荷无 worldSize', async () => {
  const spy = [];
  const call = sequenceCall([WRITTEN, inspectEnvelope()], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, _call: call });
  assert.strictEqual(e.verified, true, JSON.stringify(e.mismatches));
  assert.deepStrictEqual(e.intent, { sprite: { assetPath: ASSET } });
  const payload = JSON.parse(JSON.parse(spy[0].args[3]).p);
  assert.strictEqual(payload.worldSize, undefined);
});

test('spriteAssign：节点没挂上资产（assetPath=null）→ verified:false + key sprite.assetPath', async () => {
  const spy = [];
  const call = sequenceCall([WRITTEN, inspectEnvelope({ assetPath: null })], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, _call: call });
  assert.strictEqual(e.verified, false);
  assert.strictEqual(exitCodeFor(e), 1);
  assert.ok(e.mismatches.map((m) => m.key).includes('sprite.assetPath'), JSON.stringify(e.mismatches));
});

test('spriteAssign：世界尺寸读回不符（父级有缩放等）→ verified:false + key sprite.worldSize.x', async () => {
  const spy = [];
  const call = sequenceCall([WRITTEN, inspectEnvelope({ worldSize: { x: 3.2, y: 1.2 } })], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, worldSize: '1.6,1.2', _call: call });
  assert.strictEqual(e.verified, false);
  assert.ok(e.mismatches.map((m) => m.key).includes('sprite.worldSize.x'), JSON.stringify(e.mismatches));
});

test('spriteAssign：.cs 报 SPRITE_NOT_FOUND → 失败信封 + 查错 hint（不产 ok:true）', async () => {
  const spy = [];
  const call = sequenceCall([{ Success: true, Result: JSON.stringify({ __error: 'SPRITE_NOT_FOUND', asset: ASSET }) }], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'SPRITE_NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
  const tip = e.hint.join(' ');
  assert.ok(tip.includes('asset import'), tip);
  // F2/R477：SPRITE_NOT_FOUND 的 hint **不得**再给出 `AssetDatabase.AssetPathToGUID(…)` 复核命令
  // （DeleteAsset 后仍回过期 guid → 假绿；提它作**禁用反例**可以，作**推荐命令**不行）
  assert.ok(!tip.includes('AssetDatabase.AssetPathToGUID('), `hint 不得推荐 AssetPathToGUID（U47/R477）：${tip}`);
  assert.ok(tip.includes('LoadAssetAtPath<Sprite>'), `hint 必须给出「用 LoadAssetAtPath<Sprite>(…) == null 判定」的出路：${tip}`);
});

test('spriteAssign：.cs 报 AMBIGUOUS_SPRITE（Multiple 导入）→ count 进 actual + 只支持单 sprite 的 hint（R418③）', async () => {
  const spy = [];
  const call = sequenceCall([{ Success: true, Result: JSON.stringify({ __error: 'AMBIGUOUS_SPRITE', asset: ASSET, count: 2 }) }], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, _call: call });
  assert.strictEqual(e.ok, false, '分支必须落失败信封，不许产 ok:true');
  assert.strictEqual(e.code, 'AMBIGUOUS_SPRITE');
  assert.strictEqual(exitCodeFor(e), 1, 'AMBIGUOUS_SPRITE 是运行时错（不在 USAGE_FAILURE_CODES 里）');
  assert.deepStrictEqual(e.actual, { asset: ASSET, count: 2 }, 'count 必须进 actual（agent 要能看出是几个子 sprite）');
  assert.ok(e.message.includes('2'), `message 必须带上 count：${e.message}`);
  const tip = e.hint.join(' ');
  assert.ok(tip.includes('单 sprite'), `hint 必须讲明只支持单 sprite 资产：${tip}`);
  assert.ok(tip.includes('asset import'), `hint 必须给出出路（asset import 固定 Single）：${tip}`);
  assert.strictEqual(spy.length, 1, '拒了就不该产生写调用');
});

test('spriteAssign：SPRITE_NOT_FOUND 的 hint 按扩展名分流（非图片扩展名不声称「该图片可能没被导入为 Sprite」）（R418③）', async () => {
  const spy = [];
  const notImage = 'Assets/Art/hero.txt';
  const call = sequenceCall([{ Success: true, Result: JSON.stringify({ __error: 'SPRITE_NOT_FOUND', asset: notImage }) }], spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: notImage, _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'SPRITE_NOT_FOUND');
  assert.strictEqual(exitCodeFor(e), 1);
  assert.deepStrictEqual(e.actual, { asset: notImage });
  const tip = e.hint.join(' ');
  assert.ok(tip.includes('扩展名不是'), `非图片分支必须给出「扩展名不是图片」的查错方向：${tip}`);
  assert.ok(!tip.includes('该图片可能还没被导入'), `非图片扩展名不许说「该图片…」（误导）：${tip}`);
  // 对照组：图片扩展名仍走图片分支（证明分流真的按扩展名走，不是恒走一支）
  const imgSpy = [];
  const imgCall = sequenceCall([{ Success: true, Result: JSON.stringify({ __error: 'SPRITE_NOT_FOUND', asset: ASSET }) }], imgSpy);
  const e2 = await spriteAssign({ projectPath: 'P', path: 'N', asset: ASSET, _call: imgCall });
  assert.ok(e2.hint.join(' ').includes('该图片可能还没被导入'), e2.hint.join(' | '));
});

test('spriteAssign：传输层截断 → ULOOP_TRUNCATED + 「先复核」hint', async () => {
  const call = async (tool, args) => ({
    code: 1, stdout: '', stderr: '', timedOut: true, drained: false, json: null, truncated: true, tool, args,
  });
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, _call: call });
  assert.strictEqual(e.code, 'ULOOP_TRUNCATED');
  assert.ok(e.hint.some((h) => h.includes('复核')), e.hint.join(' | '));
});

test('sprite-assign.cs 的静态契约：父级缩放要除掉（表达式级）、`??`/`??=` 不许用、载荷键集合、错误码集合', () => {
  const path = require('node:path');
  const cs = fs.readFileSync(path.join(__dirname, '..', 'unity-scripts', 'sprite-assign.cs'), 'utf8');
  assert.match(cs, /LoadAssetAtPath<Sprite>/, '必须走 AssetDatabase.LoadAssetAtPath<Sprite>');
  assert.match(cs, /lossyScale/, '父级缩放必须参与反算（否则挂到有缩放的父级下世界尺寸就错）');
  assert.match(cs, /worldSize/);
  // R406①：**表达式级**断言 —— 注释里写「除掉了」不算数，必须真的出现在算式里。
  // 两个轴各钉一条（只写 `[xy]` 字符类的正则在「只把 x 轴写错」时会漏判 —— 变异自检实证过）。
  assert.match(cs, /Mathf\.Abs\(parentScale\.[xy]\)/, '父级缩放必须真的出现在反算表达式里');
  assert.match(cs, /\/\s*\(b\.x \* Mathf\.Abs\(parentScale\.x\)\)/, 'x 轴反算必须是 want / (bounds.x × |父级缩放.x|)');
  assert.match(cs, /\/\s*\(b\.y \* Mathf\.Abs\(parentScale\.y\)\)/, 'y 轴反算必须是 want / (bounds.y × |父级缩放.y|)');
  // R410：镜像符号必须用 Mathf.Sign 保留（只覆盖大小，不把负缩放洗成正的）
  assert.match(cs, /Mathf\.Sign\(t\.localScale\.x\)/, 'x 轴必须用 Mathf.Sign 保留原镜像符号');
  assert.match(cs, /Mathf\.Sign\(t\.localScale\.y\)/, 'y 轴必须用 Mathf.Sign 保留原镜像符号');
  // R406②：`??` / `??=` 都不许出现在这个脚本里（UnityEngine.Object 的「假 null」是 Unity 特有的坑）
  assert.doesNotMatch(cs, /\?\?\s*go\.AddComponent|\?\?\s*new /, 'UnityEngine.Object 的「假 null」不能用 ?? 兜底');
  assert.doesNotMatch(cs, /\?\?=/, '`??=` 同样不许（赋值兜底会绕过 Unity 的假 null）');
  // R406③：载荷键集合 —— 多一个少一个都要红（正则只数 `req["…"]` 读取点）
  assert.deepStrictEqual([...cs.matchAll(/req\["([^"]+)"\]/g)].map((m) => m[1]).sort(), ['asset', 'path', 'worldSize']);
  // R418②：**先剥注释**再匹配 —— 文件头注释逐字列了这 5 个码与 `{"__written":true}`，
  //   不剥注释的 `assert.match(cs, /"CODE"/)` 是**无牙**的：删掉整个 return 分支后测试仍全绿
  //   （变异自检实证过）。剥注释的范式照 `test/scenefile.test.js`（行尾必须容错 —— CRLF 检出下
  //   `\r` 也是行终止符）。转义引号先归一成裸引号，好让下面的「绑定形态」正则两种发射点都认。
  const stripComments = (src) => src.split(/\r?\n/).map((l) => l.replace(/\/\/[^\r\n]*/, '')).join('\n');
  const csCode = stripComments(cs).replace(/\\"/g, '"');
  // R406④（R418② 加固）：逐条断言「`__error` **绑定到**该码」的形态，而不是「文件里出现过这个词」：
  //   两种发射形态都认 —— `x["__error"] = "CODE"` 与 `{"__error":"CODE"}`。
  for (const code of ['BAD_PAYLOAD', 'NOT_FOUND', 'SPRITE_NOT_FOUND', 'AMBIGUOUS_SPRITE', 'COMPONENT_ADD_FAILED', 'UI_IMAGE_PRESENT']) {
    assert.match(
      csCode,
      new RegExp(`\\["__error"\\]\\s*=\\s*"${code}"|\\{"__error":"${code}"`),
      `sprite-assign.cs 必须有一个把 __error 绑到 ${code} 的返回点（剥注释后）`,
    );
  }
  assert.match(csCode, /"__written":true/, '成功返回 `{"__written":true}` 必须在真实代码里（剥注释后）');
  // R418①：旧纹理的回收**必须**判它自己的 hideFlags，且必须排除「它就是新挂的那张」——
  //   旧 sprite 的 `texture` 可能是**资产纹理**（`unity exec` 能构造出这种组合：运行时 sprite + 资产图），
  //   无条件 `DestroyImmediate(oldTexture)` 把资产纹理交给引擎的「不许销毁资产」保护
  //   （真机实测：团结 2022.3.62t9 会拒绝并写 Editor.log，对象存活）—— 资产安全不该依赖引擎内部行为。
  //   安全优先级：宁可漏收，绝不误伤资产。
  assert.match(csCode, /oldTexture\s*!=\s*sp\.texture/, '回收纹理前必须排除「它就是新挂的那张」（sp.texture）');
  assert.match(csCode, /oldTexture\.hideFlags\s*&\s*HideFlags\.HideAndDontSave/, '回收纹理前必须判纹理自己的 hideFlags');
  assert.match(csCode, /UnityEngine\.UI\.Image,\s*UnityEngine\.UI/, '必须用程序集限定名反射探测 UI Image（零编译期依赖）');
  // A-2（任务 1 复审 🟡）：顺序断言要有牙 —— `indexOf` 取的是**首个**出现点，守卫前塞死代码
  //   （`if (false) AddComponent<SpriteRenderer>();`）能骗过它。改为：只允许 1 处 AddComponent，
  //   且守卫码必须落在这一处之前。
  const addCalls = [...csCode.matchAll(/AddComponent<SpriteRenderer>/g)];
  assert.strictEqual(addCalls.length, 1, 'AddComponent<SpriteRenderer> 只允许出现 1 处（多出来的死代码会骗过首个出现点）');
  const uiGuardAt = csCode.indexOf('"UI_IMAGE_PRESENT"');
  assert.ok(uiGuardAt >= 0 && uiGuardAt < addCalls[0].index, 'Image 守卫必须在唯一的 AddComponent<SpriteRenderer> 之前（否则读到假绿）');
  // 读回面契约：node-inspect.cs 的 sprite 子对象必须含这三个新字段（additive；R403 后 sprite==null 时为 JSON null）
  const inspect = fs.readFileSync(path.join(__dirname, '..', 'unity-scripts', 'node-inspect.cs'), 'utf8');
  for (const key of ['assetPath', 'ppu', 'worldSize']) {
    assert.ok(inspect.includes(`sp["${key}"]`), `node-inspect.cs 的 sprite 子对象必须含 ${key}`);
  }
});

test('R481：节点只有 UI Image（无 SpriteRenderer）→ UI_IMAGE_PRESENT（运行时码 1，不谎报成功）', async () => {
  const spy = [];
  const call = fakeCall({ Success: true, Result: JSON.stringify({ __error: 'UI_IMAGE_PRESENT', component: 'Image' }) }, spy);
  const e = await spriteAssign({ projectPath: 'P', path: 'M5UI', asset: ASSET, _call: call });
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.code, 'UI_IMAGE_PRESENT');
  assert.strictEqual(exitCodeFor(e), 1, '「节点上是 UI Image」是运行时事实，不是 argv 形状错');
  assert.ok(e.hint.some((h) => h.includes('SpriteRenderer')), 'hint 必须说明本命令只挂 SpriteRenderer');
  assert.ok(e.hint.some((h) => h.includes('Image')), 'hint 必须点名 UI Image');
  assert.notStrictEqual(e.verified, true, '绝不谎报 verified:true');
  assert.strictEqual(spy.length, 1, '失败即返回，不许再发读回调用');
});

test('R482：worldSize 不一致时 mismatchHint 必须点出 drawMode=Sliced/Tiled 这条成因', async () => {
  // 写成功 + 读回 worldSize 与 intent(2,1) 不等（模拟 drawMode=Sliced 下 sr.bounds = sr.size × scale）
  const call = sequenceCall([WRITTEN, inspectEnvelope({ worldSize: { x: 26.6667, y: 20 } })]);
  const e = await spriteAssign({ projectPath: 'P', path: 'Brick_0_0', asset: ASSET, worldSize: '2,1', _call: call });
  assert.strictEqual(e.verified, false);
  assert.ok(
    e.hint.some((h) => /Sliced\/Tiled/.test(h) && /sr\.size/.test(h)),
    'mismatchHint 必须点出 Sliced/Tiled 的机制 sr.bounds = sr.size × scale',
  );
});
