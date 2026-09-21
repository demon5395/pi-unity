// unity-scripts/node-set.cs
// 入参：parameters["param0"] = {"path":"Brick","patch":{"active":false,"position":{"x":1,"y":2,"z":0}}}
// 出参：JSON —— 成功 {"__written":true}；失败 {"__error":"..."}（NOT_FOUND / BAD_PATCH）。
// ⚠️ 本脚本**不做验证**：写后读回比对由 lib/scene.js 的 nodeSet 负责。
//
// R90：**两遍式** —— 先只做全量校验（第一遍内**不得出现任何 `go.` 赋值**），
// 全部通过后才在第二遍统一赋值。**禁止**「改完再回滚」。
//
// 为什么关键：`.cs` 返回 `__error` 时 JS 走失败路径、**永不读回**，所以「先改后验」
// 的失败是「对调用者不可见的半成品改动」。例：`--patch '{"name":"New","position":{"x":1}}'`
// （缺 y/z）会先把节点改名、再报 BAD_PATCH → agent 修好 y/z 后用旧路径重试得到
// NOT_FOUND，把「改名已成功」误判成「节点消失」。

var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var p = (string)req["path"];
var patch = req["patch"] as Newtonsoft.Json.Linq.JObject;

if (patch == null)
{
    var bad = new Newtonsoft.Json.Linq.JObject();
    bad["__error"] = "BAD_PATCH";
    bad["detail"] = "patch 需要 JSON 对象";
    return bad.ToString(Newtonsoft.Json.Formatting.None);
}

// R80/R82：GameObject.Find **找不到非激活对象**，而 `node set --patch '{"active":false}'`
// 之后节点恰恰是非激活的 —— 只信 Find 会让「把节点设为非激活」永远 verified:false。
// 因此与 node-inspect.cs 共用同一套回退：遍历当前激活场景的全部根对象（含 inactive）。
GameObject go = GameObject.Find(p);
if (go == null && !string.IsNullOrEmpty(p))
{
    string[] segs = p.Split('/');
    foreach (GameObject root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
    {
        GameObject hit = FindByPath(root.transform, segs, 0);
        if (hit != null) { go = hit; break; }
    }
}
if (go == null) return "{\"__error\":\"NOT_FOUND\"}";

// ────────────── 第一遍：全量校验（本段内不得有任何 `go.` 赋值）──────────────
string nameValue = null;
if (patch["name"] != null)
{
    if (patch["name"].Type != Newtonsoft.Json.Linq.JTokenType.String)
    {
        var bad = new Newtonsoft.Json.Linq.JObject();
        bad["__error"] = "BAD_PATCH";
        bad["field"] = "name";
        bad["detail"] = "name 需要字符串";
        return bad.ToString(Newtonsoft.Json.Formatting.None);
    }
    nameValue = (string)patch["name"];
}

bool hasActive = patch["active"] != null;
bool activeValue = false;
if (hasActive)
{
    if (patch["active"].Type != Newtonsoft.Json.Linq.JTokenType.Boolean)
    {
        var bad = new Newtonsoft.Json.Linq.JObject();
        bad["__error"] = "BAD_PATCH";
        bad["field"] = "active";
        bad["detail"] = "active 需要布尔值";
        return bad.ToString(Newtonsoft.Json.Formatting.None);
    }
    activeValue = (bool)patch["active"];
}

// R83：position/scale 子对象缺字段不得 NRE —— 点名缺哪个字段；
// R90：值类型也要校验全 —— `{"x":"abc"}` 直接 (float) 转换会抛异常穿出成
// internal error + 退出码 3（且此时可能已经改过别的字段）。
bool hasPosition = patch["position"] != null;
Vector3 positionValue = Vector3.zero;
if (hasPosition)
{
    var v = patch["position"] as Newtonsoft.Json.Linq.JObject;
    var missing = new Newtonsoft.Json.Linq.JArray();
    if (v == null || v["x"] == null || v["y"] == null || v["z"] == null)
    {
        if (v == null)
        {
            missing.Add("x"); missing.Add("y"); missing.Add("z");
        }
        else
        {
            if (v["x"] == null) missing.Add("x");
            if (v["y"] == null) missing.Add("y");
            if (v["z"] == null) missing.Add("z");
        }
        var bad = new Newtonsoft.Json.Linq.JObject();
        bad["__error"] = "BAD_PATCH";
        bad["field"] = "position";
        bad["missing"] = missing;
        bad["detail"] = "position 需要完整的数值 x/y/z";
        return bad.ToString(Newtonsoft.Json.Formatting.None);
    }
    foreach (var axis in new string[] { "x", "y", "z" })
    {
        var tok = v[axis];
        if (tok.Type != Newtonsoft.Json.Linq.JTokenType.Integer && tok.Type != Newtonsoft.Json.Linq.JTokenType.Float)
        {
            var bad = new Newtonsoft.Json.Linq.JObject();
            bad["__error"] = "BAD_PATCH";
            bad["field"] = "position";
            bad["invalid"] = axis;
            bad["detail"] = "position." + axis + " 需要数值";
            return bad.ToString(Newtonsoft.Json.Formatting.None);
        }
    }
    positionValue = new Vector3((float)v["x"], (float)v["y"], (float)v["z"]);
}

bool hasScale = patch["scale"] != null;
Vector3 scaleValue = Vector3.one;
if (hasScale)
{
    var v = patch["scale"] as Newtonsoft.Json.Linq.JObject;
    var missing = new Newtonsoft.Json.Linq.JArray();
    if (v == null || v["x"] == null || v["y"] == null || v["z"] == null)
    {
        if (v == null)
        {
            missing.Add("x"); missing.Add("y"); missing.Add("z");
        }
        else
        {
            if (v["x"] == null) missing.Add("x");
            if (v["y"] == null) missing.Add("y");
            if (v["z"] == null) missing.Add("z");
        }
        var bad = new Newtonsoft.Json.Linq.JObject();
        bad["__error"] = "BAD_PATCH";
        bad["field"] = "scale";
        bad["missing"] = missing;
        bad["detail"] = "scale 需要完整的数值 x/y/z";
        return bad.ToString(Newtonsoft.Json.Formatting.None);
    }
    foreach (var axis in new string[] { "x", "y", "z" })
    {
        var tok = v[axis];
        if (tok.Type != Newtonsoft.Json.Linq.JTokenType.Integer && tok.Type != Newtonsoft.Json.Linq.JTokenType.Float)
        {
            var bad = new Newtonsoft.Json.Linq.JObject();
            bad["__error"] = "BAD_PATCH";
            bad["field"] = "scale";
            bad["invalid"] = axis;
            bad["detail"] = "scale." + axis + " 需要数值";
            return bad.ToString(Newtonsoft.Json.Formatting.None);
        }
    }
    scaleValue = new Vector3((float)v["x"], (float)v["y"], (float)v["z"]);
}

// ────────────── 第二遍：全部校验通过，统一赋值 ──────────────
if (patch["name"] != null) go.name = nameValue;
if (hasActive) go.SetActive(activeValue);
if (hasPosition) go.transform.localPosition = positionValue;
if (hasScale) go.transform.localScale = scaleValue;
return "{\"__written\":true}";

// 同 node-inspect.cs：Find 找不到非激活对象，回退遍历当前激活场景的全部根对象。
// ⚠️ 不能加 static（uloop 会把字面量提升成外层局部变量，静态局部函数引用会 CS8421）。
GameObject FindByPath(Transform t, string[] segs, int i)
{
    if (t.name != segs[i]) return null;
    if (i == segs.Length - 1) return t.gameObject;
    for (int k = 0; k < t.childCount; k++)
    {
        GameObject hit = FindByPath(t.GetChild(k), segs, i + 1);
        if (hit != null) return hit;
    }
    return null;
}
