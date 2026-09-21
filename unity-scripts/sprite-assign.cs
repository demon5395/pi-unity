// unity-scripts/sprite-assign.cs
// 入参：parameters["param0"] = {"path":"Brick_0_0","asset":"Assets/Art/hero.png","worldSize":{"x":1.6,"y":0.5}}
//   asset 必须是 **Assets/ 下的资产路径**（.png 需已被 `unity asset import` 配成 Sprite/Single）
//   worldSize 可选：**必须是对象且 x/y 俱全**（给了别的形态 → BAD_PAYLOAD，绝不静默忽略）；
//     给了就把 localScale 反算成「该 sprite 在**世界空间**里正好 x×y」，**符号（镜像）保留**
// 出参：成功 {"__written":true}；失败
//   {"__error":"BAD_PAYLOAD"|"NOT_FOUND"|"SPRITE_NOT_FOUND"|"AMBIGUOUS_SPRITE"|"UI_IMAGE_PRESENT"|"COMPONENT_ADD_FAILED"}
// ⚠️ 本脚本**不做验证**：是否真的挂上、世界尺寸对不对，由 lib/sprite.js 读回 node-inspect.cs 比对（verified 布尔）。
//
// ⚠️ 与 `sprite set` 的本质区别：那个造的是**运行时** 1x1 sprite（HideAndDontSave，进 PlayMode 就没），
//   本脚本挂的是**资产**引用（会被场景/Prefab 序列化、能随交付物走）。这条区别是 M4 的立身之本。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var p = (string)req["path"];
var assetPath = (string)req["asset"];
var ws = req["worldSize"] as Newtonsoft.Json.Linq.JObject;
if (string.IsNullOrEmpty(p) || string.IsNullOrEmpty(assetPath)) return "{\"__error\":\"BAD_PAYLOAD\"}";
// R402：worldSize **存在但不是对象 / 缺 x/y / x,y 不是数字** → BAD_PAYLOAD。
//   `worldSize` 字段直接拿 `!= null` 判不可靠（JSON null 在 Json.NET 里是个 JValue，不是 C# null），
//   所以用 `Property(...)` 判**存在性**；`as JObject` 对 JSON null / 数组 / 字符串都给 C# null。
//   静默 no-op 是真假绿的温床：用户要了尺寸、脚本没改，而旧 localScale 恰好等于期望值时就看不出来。
if (req.Property("worldSize") != null)
{
    bool wsOk = ws != null && ws["x"] != null && ws["y"] != null;
    if (wsOk)
    {
        var tx = ws["x"].Type;
        var ty = ws["y"].Type;
        wsOk = (tx == Newtonsoft.Json.Linq.JTokenType.Integer || tx == Newtonsoft.Json.Linq.JTokenType.Float)
            && (ty == Newtonsoft.Json.Linq.JTokenType.Integer || ty == Newtonsoft.Json.Linq.JTokenType.Float);
    }
    if (!wsOk) return "{\"__error\":\"BAD_PAYLOAD\"}";
}

var sp = AssetDatabase.LoadAssetAtPath<Sprite>(assetPath);
if (sp == null)
{
    var nf = new Newtonsoft.Json.Linq.JObject();
    nf["__error"] = "SPRITE_NOT_FOUND";
    nf["asset"] = assetPath;
    return nf.ToString(Newtonsoft.Json.Formatting.None);
}
// R405：该图被导入成 **Multiple**（一张图多个子 Sprite）时，`LoadAssetAtPath<Sprite>` 只给第一个 ——
//   挂上去「看着成功」，但用户要的那张子图未必是它。必须显式拒（运行时码 → 退出码 1）。
int spriteCount = 0;
foreach (var sub in AssetDatabase.LoadAllAssetsAtPath(assetPath))
{
    if (sub is Sprite) spriteCount++;
}
if (spriteCount > 1)
{
    var amb = new Newtonsoft.Json.Linq.JObject();
    amb["__error"] = "AMBIGUOUS_SPRITE";
    amb["asset"] = assetPath;
    amb["count"] = spriteCount;
    return amb.ToString(Newtonsoft.Json.Formatting.None);
}

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
if (sr == null)
{
    // R481（B-2 D-B2-1）：节点上只有 UI `Image`（没有 SpriteRenderer）时，旧实现会**静默
    //   AddComponent<SpriteRenderer>()** —— sprite 挂到新组件、`Image` 原封不动，而读回面
    //   （node-inspect.cs）只读 SpriteRenderer → `verified:true` **假绿**（真机实证 b2-b11）。
    //   用**反射**探测 UI Image：零编译期依赖（不 `using UnityEngine.UI`、不加 asmdef）。
    //   解析范式照 node-create.cs:62-73（Type.GetType → 扫已加载程序集）。
    System.Type uiImageType = System.Type.GetType("UnityEngine.UI.Image, UnityEngine.UI");
    if (uiImageType == null)
    {
        foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
        {
            uiImageType = asm.GetType("UnityEngine.UI.Image");
            if (uiImageType != null) break;
        }
    }
    var uiImage = uiImageType != null ? go.GetComponent(uiImageType) : null;
    if (uiImage != null)
    {
        var uiErr = new Newtonsoft.Json.Linq.JObject();
        uiErr["__error"] = "UI_IMAGE_PRESENT";
        uiErr["component"] = "Image";
        return uiErr.ToString(Newtonsoft.Json.Formatting.None);
    }
    sr = go.AddComponent<SpriteRenderer>();
}
if (sr == null)
{
    var addErr = new Newtonsoft.Json.Linq.JObject();
    addErr["__error"] = "COMPONENT_ADD_FAILED";
    addErr["component"] = "SpriteRenderer";
    return addErr.ToString(Newtonsoft.Json.Formatting.None);
}

var oldSprite = sr.sprite;
sr.sprite = sp;
// R411：旧 sprite 若是**我们自己的运行时对象**（`sprite set` 造的，hideFlags=HideAndDontSave）
//   → 连同它的纹理一起回收，否则每次重挂都泄漏一张 Texture2D。
//   ⚠️ 只认**整个 HideAndDontSave 位组**：资产对象的 hideFlags 实测是 `NotEditable`（资产纹理）
//   或 None —— 两者都 ≠ 整个位组，绝不会命中（销毁资产 sprite 会连带毁掉磁盘上的资源）。
if (oldSprite != null && (oldSprite.hideFlags & HideFlags.HideAndDontSave) == HideFlags.HideAndDontSave)
{
    var oldTexture = oldSprite.texture;
    UnityEngine.Object.DestroyImmediate(oldSprite);
    // R418①：纹理**也必须**判它自己的 hideFlags —— 旧 sprite 是我们自己造的（运行时），
    //   但它的 `texture` 完全可能是**资产纹理**（`unity exec` 能造出这种组合：
    //   `Sprite.Create(AssetDatabase.LoadAssetAtPath<Texture2D>(...), ...)` + HideAndDontSave）。
    //   真机事实（团结 2022.3.62t9）：旧写法无条件 `DestroyImmediate(资产纹理)` 时，Unity 会**拒绝**
    //   （Editor.log：「Destroying assets is not permitted to avoid data loss.」）且对象存活，
    //   即它**没有真的误伤**；但资产安全就这么押在引擎的日志级保护上，而且每次调用都刷一条错误。
    //   显式判 hideFlags 后不再依赖引擎内部行为，也不再刷错误。
    //   `oldTexture != sp.texture` 是第二道兜底：重新挂同一张图时不能把自己正在用的纹理销掉。
    //   安全优先级：**宁可漏收，绝不误伤资产**。
    if (oldTexture != null
        && oldTexture != sp.texture
        && (oldTexture.hideFlags & HideFlags.HideAndDontSave) == HideFlags.HideAndDontSave)
    {
        UnityEngine.Object.DestroyImmediate(oldTexture);
    }
}

if (ws != null)
{
    var t = go.transform;
    // 父级缩放必须除掉：lossyScale 是父链累积缩放；不除的话挂到有缩放的父级下
    // 「世界尺寸」就不等于用户要的值（读回 sr.bounds.size 会立刻暴露 → verified:false）。
    Vector3 parentScale = t.parent != null ? t.parent.lossyScale : Vector3.one;
    Vector3 b = sp.bounds.size;                       // 精灵自身在「世界单位」下的尺寸（= 纹理尺寸 / PPU）
    float wantX = (float)ws["x"];
    float wantY = (float)ws["y"];
    // R410：用 Mathf.Sign 保留原 localScale 的**镜像符号**（负缩放 = 翻转），只覆盖「大小」。
    //   `Mathf.Sign(0f)` 是 1（Unity 语义），localScale==0 的退化情形与旧行为一致。
    float sx = (b.x > 0f && Mathf.Abs(parentScale.x) > 0f) ? Mathf.Sign(t.localScale.x) * wantX / (b.x * Mathf.Abs(parentScale.x)) : t.localScale.x;
    float sy = (b.y > 0f && Mathf.Abs(parentScale.y) > 0f) ? Mathf.Sign(t.localScale.y) * wantY / (b.y * Mathf.Abs(parentScale.y)) : t.localScale.y;
    t.localScale = new Vector3(sx, sy, t.localScale.z);
}
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
