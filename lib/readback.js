'use strict';

/**
 * 写后读回比对 —— 本项目唯一自研价值。
 *
 * 背景（实测）：uloop 的 `Success:true` 只表示「你的代码执行了」。
 * 例：`cam.fieldOfView = -100f;` 被 Unity 钳制为 `1e-05`，工具仍报 Success:true。
 * 所以写操作必须主动读回，比对 intent vs actual。
 *
 * 设计约束：**宁可 falsely-fail，也绝不静默假绿**。以下情况都算分歧：
 *   - actual 缺字段（`undefined`）；
 *   - actual 与 intent 类型不符（intent 是普通对象而 actual 不是 —— 标量、数组、
 *     缺字段、`Date`/`Map` 等非普通对象，都算，见 F2）；
 *   - 单侧 NaN（R47）、数组长度不符（R48）、超出 `tol` 的数值差、`!==` 的标量差；
 *   - intent 本身不是普通对象（F3，返回 1 条 `<root>` 分歧）。
 *
 * 两处**例外**（是「确实没有约束」，不是漏检）：
 *   - **两侧都是空对象**（`{a:{}}` vs `{a:{}}`）→ 空对象在 subset 语义下没有可比字段；
 *   - **双侧都是 NaN**（同一份读数）→ 视为一致，否则每次读回都报分歧。
 *
 * **返回空列表 ≠ 验证通过**：空列表只表示「intent 里没有可比对的字段」
 * （例如 `compareSubset({}, anything)`）。判定通过**必须看 `verifyWrite` 的 `verified`**
 * —— 它是唯一的判定入口，而**顶层空 intent**（`{}`）与**非普通对象 intent**
 * 都直接落 `verified:false` + 一条 `<root>` 分歧。
 * 所以严格的说法是：**`verified:true` 来自逐字段比对通过，而不是来自零次比对**；
 * 但**叶级**空对象（`{a:{}}` vs `{a:{}}`）仍属「确实没有约束」——该叶不产分歧，
 * 因此整条 intent 的比对次数可能为 0 却仍 `verified:true`（R120① 已收窄为「顶层」口径，
 * 不再声称「`verified:true` 只可能来自真实比对」）。
 *
 * 本模块零依赖：纯函数 `compareSubset` + 一个 async 包装 `verifyWrite`
 * （读回动作由调用方以 `readActual` 注入，模块自身不 spawn、不碰 fs）。
 */

/** 绝对容差：浮点写回后读回的正常抖动上限（R50：保持绝对容差，不改相对容差）。 */
const DEFAULT_TOL = 1e-4;

/**
 * 是否为「普通对象」：非 null、typeof object、非数组，**且原型是 `Object.prototype`
 * 或 `null`**（F1）。
 *
 * 只判「非 null + typeof object + 非数组」是不够的：`new Date()`、`Map`、`Set`、
 * `RegExp`、类实例都会判真，而 `Object.entries(new Date())` 是**空数组**，于是
 * 递归返回 `[]` —— `{d: new Date(0)}` vs `{d: new Date(1)}` 假绿。严格下去后
 * 这类值走标量分支，按 `!==` 记为分歧（安全方向）。
 * `Object.create(null)`（原型为 null）仍视为普通对象，照常递归。
 */
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

/**
 * 标量（含数组元素）是否算分歧。
 *
 * 数值分支：**先判 NaN**（R47）——简报字面的 `Math.abs(iv - av) > tol` 对 NaN
 * 恒为 false，会让 `NaN` vs `5`、`NaN` vs `NaN` 都不产生 mismatch。
 * 规则：单侧是 NaN → 必判 mismatch（Unity 侧 float 出 NaN 是真实可能的）；
 * 双侧都是 NaN → 视为一致（同一份读数，NaN 不等于自身这条 IEEE 规则在这里
 * 不适用，否则每次读回都会报分歧）。
 */
function isMismatch(iv, av, tol) {
  if (typeof iv === 'number' && typeof av === 'number') {
    if (Number.isNaN(iv) || Number.isNaN(av)) return !(Number.isNaN(iv) && Number.isNaN(av));
    return Math.abs(iv - av) > tol;
  }
  return iv !== av;
}

/**
 * 按 intent 的字段子集递归比较 actual，返回分歧列表。
 *
 * 语义：
 *   - **子集**：只检查 intent 里出现过的字段；actual 多出的字段不算分歧。
 *   - **缺字段算分歧**：intent 有、actual 没有（`undefined`）→ 记一条。
 *   - **类型不符算分歧（F2）**：intent 字段是普通对象、而 actual 对应值**不是**
 *     普通对象（标量 / 数组 / 缺字段 / `Date`·`Map` 等）→ 记一条，**不再静默
 *     递归进空对象**。顶层与数组元素两处递归都做这个校验。
 *     **边界**：两侧都是空对象（`{a:{}}` vs `{a:{}}`）**仍判一致** —— 空对象在
 *     subset 语义下确实没有约束。所以不存在「一律报分歧」，只有这一种对象字段
 *     组合是不报的。
 *   - 嵌套普通对象递归下钻，key 用 `.` 连接（`position.y`）。
 *   - 数组（R48）：长度不同即分歧；长度相同则**逐元素比较**，元素为普通对象时
 *     递归走同一套子集比较（元素处同样做 F2 类型校验），其余元素走与标量相同的
 *     比较（含 R47 的 NaN 规则与容差）。**不用 `JSON.stringify`** —— 它会把
 *     `NaN`/`undefined` 序列化成 `null`（`[NaN]` vs `[null]` 假绿），又对对象
 *     元素键序敏感（`[{a,b}]` vs `[{b,a}]` 假红）。
 *   - **intent 本身不是普通对象 → 返回 1 条分歧**（F3，key 为 `prefix` 或
 *     `<root>`），**不是空列表**：否则 `compareSubset([1,2],[1,3])`、
 *     `compareSubset(undefined, {x:1})` 会让 `verifyWrite` 假绿。
 *   - **`tol` 必须是有限的非负数**（F5）：`NaN` 会让所有数值比较静默通过、
 *     负数会让所有数值比较失配 —— 都是「一个字符关掉整道数值闸门」，所以入口
 *     直接抛 `TypeError`（响亮失败优于静默）。
 *
 * @param {*} intent 意图值（写操作想要达成的状态；必须是普通对象）
 * @param {*} actual 读回的真实值
 * @param {{tol?: number, prefix?: string}} [options] 容差与递归路径前缀
 *   （`tol` 默认 `1e-4`；调用方可显式传入不同容差，见 R51）
 * @returns {Array<{key: string, intent: *, actual: *}>} 分歧列表；
 *   **空数组只表示「intent 里没有可比对的字段」，不等于验证通过**
 * @throws {TypeError} `tol` 非有限数或为负数
 */
function compareSubset(intent, actual, { tol = DEFAULT_TOL, prefix = '' } = {}) {
  if (!Number.isFinite(tol) || tol < 0) {
    throw new TypeError(
      `compareSubset: tol 必须是有限的非负数，收到 ${String(tol)}` +
        '（NaN 会静默关掉数值闸门，负数会让一切数值失配）'
    );
  }
  if (!isPlainObject(intent)) return [{ key: prefix || '<root>', intent, actual }];

  const out = [];
  const a = isPlainObject(actual) ? actual : {};

  for (const [key, iv] of Object.entries(intent)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const av = a[key];

    if (isPlainObject(iv)) {
      // F2：actual 侧类型不符（含缺字段）→ 直接记分歧，不递归（空对象会假绿）。
      if (!isPlainObject(av)) {
        out.push({ key: path, intent: iv, actual: av });
        continue;
      }
      out.push(...compareSubset(iv, av, { tol, prefix: path }));
      continue;
    }
    if (Array.isArray(iv)) {
      // 长度不同（含 actual 根本不是数组）→ 一条分歧，报整个数组便于定位。
      if (!Array.isArray(av) || iv.length !== av.length) {
        out.push({ key: path, intent: iv, actual: av });
        continue;
      }
      for (let i = 0; i < iv.length; i++) {
        const itemPath = `${path}.${i}`;
        if (isPlainObject(iv[i])) {
          // F2（数组元素处）：同样先校验 actual 侧类型。
          if (!isPlainObject(av[i])) {
            out.push({ key: itemPath, intent: iv[i], actual: av[i] });
            continue;
          }
          out.push(...compareSubset(iv[i], av[i], { tol, prefix: itemPath }));
          continue;
        }
        if (isMismatch(iv[i], av[i], tol)) {
          out.push({ key: itemPath, intent: iv[i], actual: av[i] });
        }
      }
      continue;
    }
    if (isMismatch(iv, av, tol)) out.push({ key: path, intent: iv, actual: av });
  }
  return out;
}

/**
 * 写后读回：调用 `readActual()` 拿真实值，与 intent 比对。
 *
 * 返回形状**逐字固定**（任务 10 用它把 intent/actual 塞进信封）：
 * `{ verified, intent, actual, mismatches }` —— `verified` 只在确实比对通过时为 true。
 *
 * **零次比对不算验证通过（F1，R117）**：`intent` 不是普通对象、**或顶层是空对象**
 * （`{}`）时，intent 提供不了任何约束，直接返回 `verified:false` 与一条
 * `key:'<root>'` 的分歧条目（`{key,intent,actual}` 形状与其它条目一致；该 key 的
 * 语义是「intent 本身不可比对」）。判定分工：`compareSubset({}, x)` 仍返回 `[]`
 * —— 纯比较语义下「无约束 = 无分歧」；**是否算验证通过只由本函数裁定**。
 *
 * **失败传播契约（F6）**：`readActual()` 抛出、或返回 rejected Promise 时，
 * `verifyWrite` **会拒绝（reject）**，绝不吞掉异常，也绝不把「读回失败」伪装成
 * 结果。调用方**必须**捕获并落 `fail()` 信封，**不得产出 `ok` 信封** ——
 * 「读不回来」本身就是写后校验失败，不是通过。
 *
 * **大坐标容差提示（R51）**：默认绝对容差 `1e-4` 对 float32 大坐标（量级 ≥1e4，
 * ULP 已超过 `1e-4`）偏严，此时 `verified:false` 未必等于写入失败。需要不同容差
 * 请直接调 `compareSubset(intent, actual, { tol })`。**本函数刻意不提供 `tol`
 * 参数** —— 不给调用方一个能整段关掉数值闸门的逃逸口。
 *
 * @param {{intent: *, readActual: () => (Promise<*>|*)}} params
 * @returns {Promise<{verified: boolean, intent: *, actual: *, mismatches: Array<{key: string, intent: *, actual: *}>}>}
 * @throws 透传 `readActual` 的异常/拒绝（调用方必须落 `fail()`）
 */
async function verifyWrite({ intent, readActual }) {
  const actual = await readActual();
  // F1（R117）：intent 提供不了任何约束（非普通对象，或顶层空对象）→ 零次比对，
  // 不得宣称 verified。`compareSubset` 保持纯比较语义（{} → []），判定入口在这里。
  if (!isPlainObject(intent) || Object.keys(intent).length === 0) {
    return { verified: false, intent, actual, mismatches: [{ key: '<root>', intent, actual }] };
  }
  const mismatches = compareSubset(intent, actual);
  return { verified: mismatches.length === 0, intent, actual, mismatches };
}

module.exports = { compareSubset, verifyWrite, isPlainObject };
