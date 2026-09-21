// unity-scripts/prefab-instantiate.cs
// 入参：{"asset":"Assets/Prefabs/Brick.prefab","parent":"Panel","name":"Brick_0_0"}（parent/name 可选）
// 出参：成功 {"__written":true,"instancePath":"Panel/Brick_0_0","name":"Brick_0_0"}
// 失败：{"__error":"BAD_PAYLOAD"|"PREFAB_NOT_FOUND"|"PARENT_NOT_FOUND"|"INSTANTIATE_FAILED"}
// ⚠️ 为什么由本脚本返回 instancePath：调用方拿它当**读回目标**（`node inspect --path`）——
//   路径由本脚本从实例自身沿父链算出，比调用方用「资产文件名」去猜可靠。
// ⚠️ **根名以「资产读回」为准**（R438）：本工具存出的 Prefab 根名 = 文件名（R432），
//   但**外部** Prefab（不是 `unity prefab create` 存的）的根名完全可以 ≠ 文件名。
//   所以 `lib/prefab.js` 会先用 `prefab-create` 的 read 模式读一次**资产**，拿真实根名 /
//   `spriteAssetPath` / 资产根的局部 position/scale 当**期望值**；本脚本返回的 `instancePath`
//   只是读回目标，`name` 只是实例当前的名字（都不是期望值，也不自称验证过任何东西）。
// ⚠️ 本脚本**不做验证**：实例里到底有没有那张图，由 lib/prefab.js 读回 node-inspect.cs 比对（verified 布尔）。
// ⚠️ 实例**沿用资产根的 pos/scale**（任务 5 真机 §②-7：实例化后 position 直接读回资产的值）
//   → 要「实例化到某处」必须事后显式 `node set`，不能依赖默认。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var assetPath = (string)req["asset"];
if (string.IsNullOrEmpty(assetPath)) return "{\"__error\":\"BAD_PAYLOAD\"}";
var asset = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
if (asset == null) return "{\"__error\":\"PREFAB_NOT_FOUND\"}";

var inst = PrefabUtility.InstantiatePrefab(asset) as GameObject;
if (inst == null) return "{\"__error\":\"INSTANTIATE_FAILED\"}";

var parentPath = (string)req["parent"];
if (!string.IsNullOrEmpty(parentPath))
{
    GameObject parent = GameObject.Find(parentPath);
    if (parent == null)
    {
        // 同 node-inspect.cs：Find 找不到非激活对象，回退遍历当前激活场景的全部根对象（含 inactive）。
        // ⚠️ 循环变量不叫 `root`（同 prefab-create.cs 的 CS0136 教训：uloop 顶层语句里局部变量同域）
        string[] segs = parentPath.Split('/');
        foreach (GameObject sceneRoot in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
        {
            GameObject hit = FindByPath(sceneRoot.transform, segs, 0);
            if (hit != null) { parent = hit; break; }
        }
    }
    if (parent == null)
    {
        // ⚠️ 不留半成品：实例已经建出来了，挂父级失败时必须销毁它再报错 ——
        // 否则 agent 看到 PARENT_NOT_FOUND 却已经在场景根上多了一个节点。
        UnityEngine.Object.DestroyImmediate(inst);
        var pnf = new Newtonsoft.Json.Linq.JObject();
        pnf["__error"] = "PARENT_NOT_FOUND";
        pnf["parent"] = parentPath;
        return pnf.ToString(Newtonsoft.Json.Formatting.None);
    }
    inst.transform.SetParent(parent.transform, false);   // worldPositionStays=false：局部坐标不被父级缩放/位置污染
}

var wantedName = (string)req["name"];
if (!string.IsNullOrEmpty(wantedName)) inst.name = wantedName;

var o = new Newtonsoft.Json.Linq.JObject();
o["__written"] = true;
o["instancePath"] = InstancePath(inst.transform);
o["name"] = inst.name;
return o.ToString(Newtonsoft.Json.Formatting.None);

// 实例在场景里的 <name>/<name> 路径（与 node-inspect.cs 的路径口径一致：由**名字**用 `/` 拼接，不保证唯一）
string InstancePath(Transform t)
{
    string s = t.name;
    Transform cur = t.parent;
    while (cur != null) { s = cur.name + "/" + s; cur = cur.parent; }
    return s;
}

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
