// unity-scripts/node-inspect.cs
// 入参：parameters["param0"] = {"path":"Canvas/Btn"}
//   注意：--parameters 的 key 会被 uloop 丢弃，值按 key 排序位置化为 param0..N
//   （载荷只有一个 key p，所以它恒为 param0）；**不要遍历 parameters**
//   （uloop 会把代码里的字符串字面量驻留成 __uloop_literal_*）。
// 出参：JSON 字符串，字段与 node.set 的 patch 对齐，便于直接比对。

using System.Linq;

var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var p = (string)req["path"];

// R480：可选的实例定位键。⚠️ 用 Property(...) != null 判**存在性**：JSON null 在 Json.NET 里是
// JValue（不是 C# null），`req["siblingIndex"] != null` 恒真（同 sprite-assign.cs:17-20）。
int? wantSibling = null;
var sibTok = req.Property("siblingIndex");
if (sibTok != null && sibTok.Value.Type != Newtonsoft.Json.Linq.JTokenType.Null)
{
    wantSibling = (int)sibTok.Value;
}

// R63：GameObject.Find **找不到非激活对象**，而 get-hierarchy 恰好会列出非激活节点
// （节点 JSON 里的 isActive 字段即为证据）。若只信 Find，就会出现
// 「scene tree 里看得见的节点 inspect 不到」的误导。
// R480：Find 只给**一个**结果，无法区分同父同名实例 → 统一走 DFS **收集全部命中**，
// 再用 siblingIndex 选择。⚠️ 但**不给定位键**时**必须恢复既有默认行为**：旧实现是
// `GameObject.Find`（只命中**激活**对象）优先、失败才 DFS（含 inactive）——见下面
// 收集之后的 Find 回插块（R480 b1r2）。
// R74：回退范围仅限当前激活场景（M1 单场景）—— 非激活场景 / DontDestroyOnLoad
// 里的节点仍会 NOT_FOUND；lib/scene.js 的 NOT_FOUND hint 已写明这个范围。
var matches = new System.Collections.Generic.List<GameObject>();
if (!string.IsNullOrEmpty(p))
{
    string[] segs = p.Split('/');
    foreach (GameObject root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
    {
        CollectByPath(root.transform, segs, 0, matches);
    }
}

if (matches.Count == 0)
{
    // R480（b1r3）：DFS 只覆盖**当前激活场景**；`GameObject.Find` 还能命中其它已加载场景 /
    //   DontDestroyOnLoad 里的**激活**对象（旧实现以 Find 为主路径）。此处若直接 NOT_FOUND，
    //   会静默窄化既有可查范围。故先回退 Find，再判 NOT_FOUND。
    GameObject foundAny = GameObject.Find(p);
    if (foundAny != null) matches.Add(foundAny);
}
if (matches.Count == 0) return "{\"__error\":\"NOT_FOUND\"}";

// R480（b1r2）：**恢复既有的默认选取行为** —— 旧实现先 `GameObject.Find`（只命中**激活**对象），
//   失败才 DFS（含 inactive）。改成「统一 DFS 收集」后若直接取 `matches[0]`，在「同路径存在
//   激活 + 非激活 两个节点」时默认返回值可能与旧行为不同（U42 既有用法面）。故：**不给定位键时**，
//   若 `Find` 命中且它就在同名集合里，就把它挪到 `matches[0]`；DFS 仍只作回退（Find 找不到非激活）。
//   给定位键时按真实 siblingIndex 选，不受此影响。
if (!wantSibling.HasValue)
{
    GameObject found = GameObject.Find(p);
    if (found != null)
    {
        int fi = matches.IndexOf(found);
        if (fi > 0)
        {
            matches.RemoveAt(fi);
            matches.Insert(0, found);
        }
    }
}

// ⚠️ 必须 `= null` 显式初始化：下面 `if (go == null)` 会**读取** go，
//   而 foreach 在空集合时不会赋值 —— 裸 `GameObject go;` 会编译失败 CS0165（未赋值局部变量）。
GameObject go = null;
if (wantSibling.HasValue)
{
    // R480（b1r1 修复）：给了 siblingIndex → 按 transform.GetSiblingIndex() 的真实值选
    //   （与 get-hierarchy 的 siblingIndex 字段、与 Unity 自身概念一致）—— agent 从
    //   `scene tree` 取值即可唯一定位。**不是**同名命中列表的下标（旧实现在「父下还有
    //   异名兄弟」时会让参数名骗人）。
    //   找不到 → SIBLING_INDEX_OUT_OF_RANGE，并把**可用的真实序号列表**回传
    //   （否则用户只能盲试）。
    foreach (var cand in matches)
    {
        if (cand.transform.GetSiblingIndex() == wantSibling.Value) { go = cand; break; }
    }
    if (go == null)
    {
        var err = new Newtonsoft.Json.Linq.JObject();
        err["__error"] = "SIBLING_INDEX_OUT_OF_RANGE";
        err["count"] = matches.Count;
        err["requested"] = wantSibling.Value;
        var avail = new Newtonsoft.Json.Linq.JArray();
        foreach (var cand in matches) avail.Add(cand.transform.GetSiblingIndex());
        err["available"] = avail;   // ← 新增：让错误可自修
        return err.ToString(Newtonsoft.Json.Formatting.None);
    }
}
else
{
    go = matches[0];
}

var rt = go.transform;
var o = new Newtonsoft.Json.Linq.JObject();
o["name"] = go.name;
o["active"] = go.activeSelf;
// R79：从 transform 沿父链向上拼路径 —— 让任务 10 的 `node create --parent X` 能被
// **真读回**验证（否则「建在哪」只有 node-create.cs 自述，写后校验形同虚设）。
// ⚠️ 与 get-hierarchy 的 path 同义：由**名字**用 `/` 拼接，不保证唯一。
// ⚠️ 变量名不得与下面回退块里的 `segs` 重复（CS0136：嵌套/后续同层局部变量不得同名）
var pathSegs = new System.Collections.Generic.List<string>();
for (Transform cur = rt; cur != null; cur = cur.parent) pathSegs.Insert(0, cur.name);
o["path"] = string.Join("/", pathSegs);
// R480（additive）：实例唯一定位与歧义可见性 —— `siblingIndex` 用于「同父同名取第 N 个」，
// `instanceId` 用于证明两次 inspect 拿到的是**不同对象**，`matchCount` 让「命中了几个」可见。
o["siblingIndex"] = rt.GetSiblingIndex();
o["instanceId"] = go.GetInstanceID();
o["matchCount"] = matches.Count;
// R64：字段名 position 读的是 **局部坐标 localPosition**（世界坐标是 transform.position）。
// 局部坐标与任务 10 node.set 的 patch 语义对齐，这里不得改成世界坐标。
o["position"] = new Newtonsoft.Json.Linq.JObject
{
    ["x"] = rt.localPosition.x,
    ["y"] = rt.localPosition.y,
    ["z"] = rt.localPosition.z,
};
o["scale"] = new Newtonsoft.Json.Linq.JObject
{
    ["x"] = rt.localScale.x,
    ["y"] = rt.localScale.y,
    ["z"] = rt.localScale.z,
};
// R74：Missing Script 的组件是 null（GetComponents<Component>() 会把它算进来）——
// 而「缺失脚本」恰恰是 agent 想 inspect 的场景，必须过滤掉，否则
// c.GetType().Name 会 NRE，把一次可诊断的读取变成 Unity 异常栈。
// M2：SpriteRenderer 的读回面（`unity sprite set` 的验证依赖它）。
// 颜色用 0–255 整数：`.cs` 侧用 Color32 写入，`Math.round(c * 255)` 读回 → 8bit 往返无损，
// 于是 `compareSubset` 的数值容差（1e-4）在这里不会产生假红/假绿。
// 没有 SpriteRenderer 时写成 JSON null（不是省略）：intent 里的对象字段遇到 null 会被
// compareSubset 的 F2 类型校验记成一条分歧 —— 这正是「没挂上渲染组件」应有的结论。
var sr = go.GetComponent<SpriteRenderer>();
if (sr != null)
{
    var sp = new Newtonsoft.Json.Linq.JObject();
    sp["present"] = true;
    sp["color"] = new Newtonsoft.Json.Linq.JObject
    {
        ["r"] = (int)System.Math.Round(sr.color.r * 255f),
        ["g"] = (int)System.Math.Round(sr.color.g * 255f),
        ["b"] = (int)System.Math.Round(sr.color.b * 255f),
        ["a"] = (int)System.Math.Round(sr.color.a * 255f),
    };
    sp["sortingOrder"] = sr.sortingOrder;
    sp["sortingLayerName"] = sr.sortingLayerName;
    sp["spriteName"] = sr.sprite != null ? sr.sprite.name : null;
    // M4（additive）：资产 sprite 的读回面 —— `unity sprite assign` 的验证依赖它。
    // assetPath：运行时 sprite（`sprite set` 造的）返回 null，
    //   于是「intent 要资产 A、实际是运行时 sprite」会被 compareSubset 记成一条分歧（不是假绿）。
    //   ✅ **已在团结 2022.3.62t9 实测为 `null`**（任务 4 真机步骤④，real-machine/task4-runtime-inspect.json）：
    //   `AssetDatabase.GetAssetPath(运行时 sprite)` 返回 `""` → 写成 JSON null，
    // ppu：精灵自己的 pixelsPerUnit（证明加载的确实是那张资产）。
    // worldSize：`sr.bounds.size` —— **世界空间的 AABB 尺寸**（父级缩放已含在内）。
    //   这是「这个节点在画面里到底多大」的唯一真值，也是 SKILL 里「localScale = 世界尺寸」
    //   那条旧说法在「父级有缩放 / sprite 是资产」两种情形下的修正口径。
    // R403：`sr.sprite == null` 时 ppu / worldSize 读回 **null**（而不是 0 / {0,0}）——
    //   `bounds.size` 此时退化成 {0,0}，那是个会被误读成「尺寸就是 0」的假值。
    //   ⚠️ `sp["x"] = null`（**字面 null**，绑定到 `JToken` 重载）在 JObject 索引器里的语义是**移除键**
    //   （不是写 JSON null），那样 JSON 里根本没这个字段，读回面就少了一项证据。
    //   ✅ 真机实测（下面 `string.IsNullOrEmpty(spriteAssetPath) ? null : spriteAssetPath` 那行，
    //   与本仓证据一致）：三元表达式 `cond ? null : spriteAssetPath`
    //   的**分支类型是 `string`** → 隐式转换走 `JValue`，所以键**在**且值为 JSON null。
    //   要**显式**表达 JSON null 时用 `JValue.CreateNull()`（下面 `sr.sprite == null` 分支就是这么写的）。
    //   （旧注释把 `sp["x"] = null` 的语义误记成「本行也是移除键」——已按实测更正。）
    if (sr.sprite == null)
    {
        sp["assetPath"] = Newtonsoft.Json.Linq.JValue.CreateNull();
        sp["ppu"] = Newtonsoft.Json.Linq.JValue.CreateNull();
        sp["worldSize"] = Newtonsoft.Json.Linq.JValue.CreateNull();
    }
    else
    {
        var spriteAssetPath = AssetDatabase.GetAssetPath(sr.sprite);
        sp["assetPath"] = string.IsNullOrEmpty(spriteAssetPath) ? null : spriteAssetPath;
        sp["ppu"] = sr.sprite.pixelsPerUnit;
        sp["worldSize"] = new Newtonsoft.Json.Linq.JObject
        {
            ["x"] = sr.bounds.size.x,
            ["y"] = sr.bounds.size.y,
        };
    }
    o["sprite"] = sp;
}
else
{
    o["sprite"] = null;
}
o["components"] = new Newtonsoft.Json.Linq.JArray(
    go.GetComponents<Component>().Where(c => c != null).Select(c => c.GetType().Name).ToArray());
return o.ToString(Newtonsoft.Json.Formatting.None);

// 递归收集**全部**按 <name>/<name> 路径命中的对象：只比较名字，**不检查 activeSelf** ——
// 这正是能命中非激活节点的原因（GetRootGameObjects 同样包含非激活根对象）。
// R480：不再提前 return（旧名单个命中的实现已弃用），改为累积到 hits —— 同父同名时全都要拿到。
// ⚠️ 本函数**不能加 static**：uloop 会把字面量提升成外层局部变量
// （如 __uloop_literal_N），静态局部函数无法引用它们，会编译失败 CS8421。
void CollectByPath(Transform t, string[] segs, int i, System.Collections.Generic.List<GameObject> hits)
{
    if (t.name != segs[i]) return;
    if (i == segs.Length - 1)
    {
        hits.Add(t.gameObject);
        return;
    }
    for (int k = 0; k < t.childCount; k++)
    {
        CollectByPath(t.GetChild(k), segs, i + 1, hits);
    }
}
