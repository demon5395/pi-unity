// unity-scripts/prefab-create.cs
// 入参：{"mode":"write","fromNode":"Brick_0_0","to":"Assets/Prefabs/Brick.prefab"}
//       {"mode":"read","path":"Assets/Prefabs/Brick.prefab"}
// 出参：write → {"__written":true,"guid":"<32-hex>"}
//       read  → {"__read":{asset,name,position:{x,y,z},scale:{x,y,z},spriteAssetPath,components,guid}}
// 失败：{"__error":"BAD_PAYLOAD"|"NOT_FOUND"|"SOURCE_IS_PREFAB_INSTANCE"|"PREFAB_SAVE_FAILED"|"PREFAB_NOT_FOUND"}
//
// ⚠️ 同名覆盖 = 更新（任务 5 真机探测结论，docs/M4-PROBES.md §②-2 / §②-8）：guid 不变、资产内容更新
//   → 美术/关卡返工安全。三次覆盖（pos/scale 各改两次）guid 恒为同一个 32-hex。
// ⚠️ 读回在**独立一次调用**里（写后读回纪律）：SaveAsPrefabAsset 的返回值只说明「它返回了非空」。
// ⚠️ 本脚本**不做验证**：是否真的把该节点存进去了，由 lib/prefab.js 读回本脚本 read 模式的结果
//   与「源节点的投影」逐字段比对（verified 布尔）。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var mode = (string)req["mode"];
if (mode != "write" && mode != "read") return "{\"__error\":\"BAD_PAYLOAD\"}";

if (mode == "write")
{
    var fromNode = (string)req["fromNode"];
    var to = (string)req["to"];
    if (string.IsNullOrEmpty(fromNode) || string.IsNullOrEmpty(to)) return "{\"__error\":\"BAD_PAYLOAD\"}";
    GameObject go = GameObject.Find(fromNode);
    if (go == null)
    {
        // 同 node-inspect.cs / sprite-assign.cs：Find 找不到**非激活**对象，
        // 回退遍历当前激活场景的全部根对象（含 inactive），按 <name>/<name> 路径递归查找。
        // ⚠️ 循环变量不能叫 `root`：uloop 顶层语句里所有局部变量同域，而 read 模式稍后有一个
        //    `var root = new JObject()`（CS0136 实测踩过）→ 改名 `sceneRoot`。
        string[] segs = fromNode.Split('/');
        foreach (GameObject sceneRoot in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
        {
            GameObject hit = FindByPath(sceneRoot.transform, segs, 0);
            if (hit != null) { go = hit; break; }
        }
    }
    if (go == null) return "{\"__error\":\"NOT_FOUND\"}";
    // R430（控制者裁定，依据任务 5 的 R427 真机探测 §②-10①）：
    //   拿 **Prefab 实例**当源，SaveAsPrefabAsset 会**静默产出 Variant（Prefab 变体）**
    //   （实测：产物第一个文档就是 PrefabInstance、GetPrefabAssetType==Variant、根名被改成文件名）
    //   —— 用户以为存的是普通 Prefab。本命令**必须拒绝**，绝不静默交出另一种工件。
    //   （想存 Variant 的人要等 backlog 的显式选项。代价明确、收益是「不会在 verified:true 下给出意外产物」。）
    if (PrefabUtility.IsPartOfPrefabInstance(go))
    {
        return "{\"__error\":\"SOURCE_IS_PREFAB_INSTANCE\"}";
    }
    var saved = PrefabUtility.SaveAsPrefabAsset(go, to);
    if (saved == null) return "{\"__error\":\"PREFAB_SAVE_FAILED\"}";
    var w = new Newtonsoft.Json.Linq.JObject();
    w["__written"] = true;
    w["guid"] = AssetDatabase.AssetPathToGUID(to);
    return w.ToString(Newtonsoft.Json.Formatting.None);
}

var p = (string)req["path"];
if (string.IsNullOrEmpty(p)) return "{\"__error\":\"BAD_PAYLOAD\"}";
var asset = AssetDatabase.LoadAssetAtPath<GameObject>(p);
if (asset == null) return "{\"__error\":\"PREFAB_NOT_FOUND\"}";
var sr = asset.GetComponent<SpriteRenderer>();
var o = new Newtonsoft.Json.Linq.JObject();
// asset：用 `AssetDatabase.GetAssetPath(asset)`（**真正载入的那个对象**的路径），
//   而不是回显入参 `p` —— 回显是自证（intent 与 actual 用同一个来源），拿不到额外证据。
o["asset"] = AssetDatabase.GetAssetPath(asset);
o["name"] = asset.name;
// position / scale：与 node-inspect.cs 同口径的**局部**值。
//   Prefab 资产根没有父级 → `position == localPosition`；写局部值是为了让「子节点当源」这条
//   Unity 语义（Prefab 根保留子节点的 local 值，R430②/§②-10②）在**字段名**上也自洽，
//   不会有人误读成世界坐标。scale 本来就是 localScale。
o["position"] = new Newtonsoft.Json.Linq.JObject
{
    ["x"] = asset.transform.localPosition.x,
    ["y"] = asset.transform.localPosition.y,
    ["z"] = asset.transform.localPosition.z,
};
o["scale"] = new Newtonsoft.Json.Linq.JObject
{
    ["x"] = asset.transform.localScale.x,
    ["y"] = asset.transform.localScale.y,
    ["z"] = asset.transform.localScale.z,
};
// spriteAssetPath：证明「Prefab 里装的 sprite 确实是那张资产」（null = 没挂资产 sprite）。
//   ⚠️ 运行时 sprite（`sprite set` 造的）的 GetAssetPath 返回 "" → 这里写成 JSON null，
//   与 node-inspect.cs 同口径（M4 任务 4 真机实测）。
var spriteAssetPath = (sr != null && sr.sprite != null) ? AssetDatabase.GetAssetPath(sr.sprite) : "";
o["spriteAssetPath"] = string.IsNullOrEmpty(spriteAssetPath) ? Newtonsoft.Json.Linq.JValue.CreateNull() : spriteAssetPath;
o["guid"] = AssetDatabase.AssetPathToGUID(p);
// R448：把组件的**名字列表**纳入读回面 —— 空节点（默认 transform + 无 sprite）原先的投影
//   四个字段全是常量默认值（name 由 --to 文件名覆盖、position=0,0,0、scale=1,1,1、spriteAssetPath=null），
//   于是任何「空 Prefab」都能满足同一份 intent → verified:true 的证伪力 ≈ 0。
//   口径与 node-inspect.cs **同形**（GetComponents<Component>() 过滤 null 后取类型名）→
//   intent（源节点的 node inspect）与 actual（Prefab 资产）可直接逐元素比。
//   ⚠️ 顺序敏感：compareSubset 对数组「长度不等即分歧、等长逐元素比」。
//   ⚠️ 本文件没有 using System.Linq → 不要用 Where/Select/ToArray。
var comps = new Newtonsoft.Json.Linq.JArray();
foreach (var c in asset.GetComponents<Component>())
{
    if (c != null) comps.Add(c.GetType().Name);
}
o["components"] = comps;
var root = new Newtonsoft.Json.Linq.JObject();
root["__read"] = o;
return root.ToString(Newtonsoft.Json.Formatting.None);

// ⚠️ 不能加 static（uloop 会把字面量提升成外层局部变量 → CS8421）
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
