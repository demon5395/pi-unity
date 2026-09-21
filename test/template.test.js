'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE = path.join(__dirname, '..', 'unity-scripts', 'templates', 'PiBrickBreaker.cs');
const SKILL = path.join(__dirname, '..', 'skills', 'unity-game-dev', 'SKILL.md');
// R307：1x1 世界单位 / PPU=1f 的真正落点是 **C# 侧**（`unity-scripts/sprite-set.cs`）。
// 原简报把读取目标写成 `lib/sprite.js` —— 该文件全文不含 `Rect` / `1f`，断言必然 RED，
// 而「让断言过」的唯一错误出路是去改 `lib/sprite.js`（不许）。故读取目标改成 C# 文件，断言不变。
const SPRITE_CS = path.join(__dirname, '..', 'unity-scripts', 'sprite-set.cs');

test('打砖块模板存在且是一个 MonoBehaviour（能被 node create --components 挂上）', () => {
  const src = fs.readFileSync(TEMPLATE, 'utf8');
  assert.match(src, /public class PiBrickBreaker\s*:\s*MonoBehaviour/);
  assert.match(src, /using UnityEngine;/);
  assert.match(src, /void Start\(\)/);
  assert.match(src, /void Update\(\)/);
  assert.match(src, /void OnGUI\(\)/);
  // F2/R348：模板头注释里引用的 U 编号会**随 `asset write` 落进用户工程**，是给用户看的
  // 现场指引 —— 钉住定稿编号（U25 = 输入模拟可用性边界），别让 M1 时期的预留号
  // U16（定稿后 = 退出编辑器）回潮，否则用户会照着错条目排障。
  assert.match(src, /PITFALLS\.md U25/);
  assert.ok(!/PITFALLS\.md U16/.test(src), 'U16 是「退出编辑器」，输入模拟边界是 U25');
});

test('模板的日志前缀与状态字段是「可被 CLI 验证」的契约（skill 与 E2E 靠它们断言）', () => {
  const src = fs.readFileSync(TEMPLATE, 'utf8');
  for (const tag of ["[BB] ready bricks=", "[BB] hit brick=", "[BB] ball out lives=", "[BB] CLEARED score="]) {
    assert.ok(src.includes(tag), `模板必须打日志 ${tag}`);
  }
  for (const field of ['public int score', 'public int lives', 'public int bricksAlive', 'public float ballX', 'public float ballY', 'public float paddleX']) {
    assert.ok(src.includes(field), `模板必须有公开字段 ${field}（execute-dynamic-code 读回用）`);
  }
  for (const fn of ['public void SetPaddleX(float x)', 'public void ResetBall()']) {
    assert.ok(src.includes(fn), `模板必须有公开入口 ${fn}`);
  }
});

test('模板的尺寸/坐标约定与 sprite 世界单位约定一致（1x1 基础 sprite + localScale = 世界尺寸）', () => {
  const src = fs.readFileSync(TEMPLATE, 'utf8');
  // 场地半宽/半高必须与配方一致（相机 orthographicSize=5 → 半高 5）
  assert.match(src, /HalfWidth\s*=\s*6f/);
  assert.match(src, /HalfHeight\s*=\s*5f/);
  // 砖块命中盒必须是「半尺寸」口径：1.6x0.5 的砖 → 0.8 / 0.25
  // F3/R322+R328：必须**锚定具名常量**，裸 `/0\.8f/` 会被注释、速度常量等任意数字蒙混过关。
  assert.match(src, /BrickHalfWidth\s*=\s*0\.8f/);
  assert.match(src, /BrickHalfHeight\s*=\s*0\.25f/);
  // 其余几何常量同样锚定（与 SKILL §3.5 的配方数字一一对应）
  assert.match(src, /PaddleHalfWidth\s*=\s*1\.2f/);
  assert.match(src, /BallHalfSize\s*=\s*0\.2f/);
  assert.match(src, /PaddleY\s*=\s*-4\.2f/);
  assert.match(src, /BallStartY\s*=\s*-3\.2f/);
  // 背景色必须是配方里的近黑（#0A0A14）
  assert.match(src, /0x0A,\s*0x0A,\s*0x14/);
  // 真机教训（M2 任务 11）：EditMode 里 `unity sprite set` 挂的 sprite 是**运行时对象**，
  // 进 PlayMode 的 domain reload 会销毁它（`spriteName` 变 null → 一块砖都不渲染）；
  // 而 `color` 是序列化字段会保留 → 模板必须在 Start() 里给缺 sprite 的渲染器**兜底自建**，
  // 且必须与 `unity-scripts/sprite-set.cs` 同约定（1x1 + PPU=1f → localScale = 世界尺寸）。
  assert.ok(src.includes('EnsureSprites'), '模板必须有 EnsureSprites 兜底入口');
  assert.match(src, /sprite != null\) continue/, '兜底只补缺 sprite 的渲染器（不覆盖已有 sprite）');
  assert.match(src, /new Rect\(0, 0, 1, 1\), new Vector2\(0\.5f, 0\.5f\), 1f\)/, '兜底 sprite 必须与 sprite-set.cs 同约定（1x1 纹理 + PPU 1f）');
  assert.match(src, /EnsureSprites\(\);\s*\n\s*_ball = FindTransform/, '兜底必须在 Start() 里、找 Ball 之前跑');
});

test('skill 必须写出 M2 的全部命令面与打砖块配方（盲测 agent 只读它）', () => {
  const src = fs.readFileSync(SKILL, 'utf8');
  for (const cmd of ['unity pixels', 'unity sprite set', 'unity play', 'unity asset write',
    'unity compile', 'unity node delete', 'doctor --golden', '--capture-mode', '--match-mode',
    // M4：盲测 agent 只读 SKILL —— 新命令不进 SKILL 就等于不存在
    'unity asset import', 'unity sprite assign', 'unity prefab create', 'unity prefab instantiate',
    '--remove-bg', '--world-size', '--ppu']) {
    assert.ok(src.includes(cmd), `skill 必须提到 ${cmd}`);
  }
  for (const spec of ['Bricks', 'Brick_', 'Paddle', 'Ball', '0A0A14', 'FF2E88', 'orthographic', 'SpriteRenderer']) {
    assert.ok(src.includes(spec), `skill 的配方必须提到 ${spec}`);
  }
  // F3/R322+R328：约束 18 的跨语言 tripwire 必须**两侧都钉住** —— 只钉 `.cs` 时，
  // 有人改 SKILL 配方里的砖块 scale，测试全绿而模板 AABB 立刻错位。
  // 以下 token 是 SKILL §3.5 配方的**字面**写法（已 grep 核对；模板常量与之等价）。
  for (const token of ['(1.6, 0.5, 1)', '(2.4, 0.35, 1)', '(0.4, 0.4, 1)',
    '(0, -4.2, 0)', '(0, -3.2, 0)', '(col - 2.5) * 1.85', 'orthographic size = 5']) {
    assert.ok(src.includes(token), `skill 配方的几何 token 必须与模板一致：${token}`);
  }
  assert.ok(src.includes('--template PiBrickBreaker'), 'skill 必须给出装脚本的命令');
  assert.ok(src.includes('--smoke 不再只读') || src.includes('`--smoke` 从 M2 起不再只读'), 'skill 必须写明 --smoke 的语义变化');
});

test('mouseFollowLerp 不是死字段：鼠标分支真的用它做平滑（F6/R325）', () => {
  const src = fs.readFileSync(TEMPLATE, 'utf8');
  // 模板头注释鼓励「用公开字段做实验」—— 声明后从未被读的字段会误导实验者。
  const uses = src.split('\n').filter((l) => l.includes('mouseFollowLerp') && !/public\s+float\s+mouseFollowLerp/.test(l));
  assert.ok(uses.length >= 1, 'mouseFollowLerp 必须在输入分支里被真正读取（不能只声明）');
  // D15：行内含 `Mathf.Lerp` + `Time.deltaTime` 太软（**一句注释**也能满足）——
  // 钉住模板里的**真实调用形态**（`unity-scripts/templates/PiBrickBreaker.cs` 的鼠标分支）：
  // `Mathf.Lerp(_paddle.localPosition.x, mouseX, Mathf.Clamp01(mouseFollowLerp * Time.deltaTime))`
  assert.match(
    src,
    /Mathf\.Lerp\(\s*_paddle\.localPosition\.x\s*,\s*mouseX\s*,\s*Mathf\.Clamp01\(\s*mouseFollowLerp\s*\*\s*Time\.deltaTime\s*\)/,
    '鼠标跟随必须真的按 `Mathf.Lerp(_paddle.localPosition.x, mouseX, …mouseFollowLerp * Time.deltaTime…)` 平滑',
  );
});

test('sprite 的 1x1 世界单位约定与 skill 的配方一致（跨文件 tripwire）', () => {
  const js = fs.readFileSync(SPRITE_CS, 'utf8');
  assert.match(js, /new Rect\(0, 0, 1, 1\)/, 'sprite 必须是 1x1 的 Rect');
  assert.match(js, /, 1f\)/, 'pixelsPerUnit 必须是 1f（默认 100 会让方块小到看不见）');
  const skill = fs.readFileSync(SKILL, 'utf8');
  assert.ok(skill.includes('localScale = 世界尺寸') || skill.includes('localScale 就是世界尺寸'), 'skill 必须写明 scale = 世界尺寸');
});

test('SKILL §3.6 的默认值与 asset import 的实现一致（跨语言 tripwire）', () => {
  const skill = fs.readFileSync(SKILL, 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'lib', 'importart.js'), 'utf8');
  assert.match(js, /ppu === undefined \? 16/, 'PPU 默认值必须是 16（SKILL 表里写的就是 16）');
  assert.match(skill, /\| `--ppu <n>`.*\| 16 \|/, 'SKILL 必须把 PPU 默认值写成 16');
  assert.match(js, /tolerance === undefined \? 40/, '容差默认值必须是 40');
  assert.match(skill, /\| `--tolerance <0-255>`.*\| 40 \|/, 'SKILL 必须把容差默认值写成 40');
});
