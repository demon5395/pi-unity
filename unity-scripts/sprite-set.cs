// unity-scripts/sprite-set.cs
// 入参：parameters["param0"] = {"path":"Paddle","color":{"r":0,"g":255,"b":200},"sortingOrder":0}
//   说明：color 的 a 字段可选（缺省 255）；sortingOrder 可选。
// 出参：JSON —— 成功 {"__written":true}；失败 {"__error":"NOT_FOUND"|"BAD_PAYLOAD"|"SPRITE_CREATE_FAILED"|"COMPONENT_ADD_FAILED"}
// ⚠️ 本脚本**不做验证**：颜色是否真的生效由 lib/sprite.js 的 spriteSet 读回 node-inspect.cs 比对。
//
// 关键约定（与 skill §3.5 的打砖块配方、node-inspect.cs 的读回字段三者必须一致）：
//   - 基础 sprite 是 **1x1 世界单位**（1x1 纹理 + pixelsPerUnit=1f）→ 节点的 localScale 就是世界尺寸；
//   - 颜色走 SpriteRenderer.color（不改纹理像素）→ 一张白纹理可以复用出所有颜色，零资产文件；
//   - 只在 sprite 为空时创建纹理/sprite（改颜色不重复造，避免每次调用泄漏 Texture2D）。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var p = (string)req["path"];
var colorTok = req["color"] as Newtonsoft.Json.Linq.JObject;
if (string.IsNullOrEmpty(p) || colorTok == null) return "{\"__error\":\"BAD_PAYLOAD\"}";

// 同 node-inspect.cs：Find 找不到非激活对象，回退遍历当前激活场景的全部根对象（含 inactive）。
GameObject go = GameObject.Find(p);
if (go == null)
{
    string[] segs = p.Split('/');
    foreach (GameObject root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
    {
        GameObject hit = FindByPath(root.transform, segs, 0);
        if (hit != null) { go = hit; break; }
    }
}
if (go == null) return "{\"__error\":\"NOT_FOUND\"}";

var sr = go.GetComponent<SpriteRenderer>();
if (sr == null) sr = go.AddComponent<SpriteRenderer>();
if (sr == null)
{
    var addErr = new Newtonsoft.Json.Linq.JObject();
    addErr["__error"] = "COMPONENT_ADD_FAILED";
    addErr["component"] = "SpriteRenderer";
    return addErr.ToString(Newtonsoft.Json.Formatting.None);
}

if (sr.sprite == null)
{
    var tex = new Texture2D(1, 1, TextureFormat.RGBA32, false);
    tex.SetPixel(0, 0, Color.white);
    tex.Apply();
    tex.hideFlags = HideFlags.HideAndDontSave;
    // pixelsPerUnit **必须是 1f**：默认 100 会让 1x1 纹理只有 0.01 世界单位（方块看不见）。
    var sp = Sprite.Create(tex, new Rect(0, 0, 1, 1), new Vector2(0.5f, 0.5f), 1f);
    if (sp == null)
    {
        UnityEngine.Object.DestroyImmediate(tex);
        var createErr = new Newtonsoft.Json.Linq.JObject();
        createErr["__error"] = "SPRITE_CREATE_FAILED";
        createErr["detail"] = "Sprite.Create 返回 null";
        return createErr.ToString(Newtonsoft.Json.Formatting.None);
    }
    sp.hideFlags = HideFlags.HideAndDontSave;
    sr.sprite = sp;
}

// 颜色用 byte 通道 → Unity 侧 float；读回时 Math.round(c * 255) 往返无损（8bit 值不会被浮点吃掉）。
var a = colorTok["a"] != null ? (int)colorTok["a"] : 255;
sr.color = new Color32((byte)(int)colorTok["r"], (byte)(int)colorTok["g"], (byte)(int)colorTok["b"], (byte)a);

if (req["sortingOrder"] != null) sr.sortingOrder = (int)req["sortingOrder"];
return "{\"__written\":true}";

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
