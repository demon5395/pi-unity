// unity-scripts/prefab-apply.cs
// 入参：{"mode":"apply"|"revert","path":"CaI"}
// 出参：{"__written":true,"assetPath":"Assets/Prefabs/CaP.prefab","hasOverrides":false}
// 失败：{"__error":"BAD_PAYLOAD"|"NOT_FOUND"|"NOT_PREFAB_INSTANCE"|"APPLY_FAILED"|"REVERT_FAILED"}
//
// ⚠️ 真机事实（docs/m5-probes-raw/cb-REPORT.md）：ApplyPrefabInstance/RevertPrefabInstance
//   都会写/读「正常属性覆盖」（根 scale、子节点变换、sprite、components），
//   但**根 `localPosition` 是豁免项**（apply 不写进资产、revert 也不还原）—— 读回面由 lib 侧排除。
//   ⚠️ 本脚本**不做验证**：是否真的写回/清空，由 lib/prefab.js 读回「实例投影 vs 资产投影」比对。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var mode = (string)req["mode"];
if (mode != "apply" && mode != "revert") return "{\"__error\":\"BAD_PAYLOAD\"}";
var nodePath = (string)req["path"];
if (string.IsNullOrEmpty(nodePath)) return "{\"__error\":\"BAD_PAYLOAD\"}";
GameObject go = GameObject.Find(nodePath);
if (go == null)
{
    // 同 node-inspect.cs / prefab-create.cs：Find 找不到**非激活**对象，回退按路径递归查找。
    string[] segs = nodePath.Split('/');
    foreach (GameObject sceneRoot in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
    {
        GameObject hit = FindByPath(sceneRoot.transform, segs, 0);
        if (hit != null) { go = hit; break; }
    }
}
if (go == null) return "{\"__error\":\"NOT_FOUND\"}";
// 🔴 修正（冲突扫描 #4）：--path 必须是**实例根** —— 子对象也会过 IsPartOfPrefabInstance，
//   但拿「资产**根**投影」比「**子节点**投影」会永久假红。用 GetOutermostPrefabInstanceRoot 卡死。
if (!PrefabUtility.IsPartOfPrefabInstance(go)) return "{\"__error\":\"NOT_PREFAB_INSTANCE\"}";
if (PrefabUtility.GetOutermostPrefabInstanceRoot(go) != go) return "{\"__error\":\"NOT_PREFAB_INSTANCE\"}";
var assetPath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(go);
if (string.IsNullOrEmpty(assetPath)) return "{\"__error\":\"NOT_PREFAB_INSTANCE\"}";
try
{
    // 🔴 修正（冲突扫描 #12）：InteractionMode 用**全限定名**
    //   （唯一真机证据 cb-60-apply.cs 全限定；静态测试测不出 CS0103）。
    if (mode == "apply") PrefabUtility.ApplyPrefabInstance(go, UnityEditor.InteractionMode.AutomatedAction);
    else PrefabUtility.RevertPrefabInstance(go, UnityEditor.InteractionMode.AutomatedAction);
}
catch (System.Exception ex)
{
    // 两个码各自一个**可静态断言**的发射点（`er["__error"] = "<CODE>";`）——
    // 三元表达式虽等价，但静态契约（test/prefab.test.js）按 `["__error"] = "CODE"` 绑定，
    // 拆开写才测得到（冲突扫描 #15 的口径）。
    var er = new Newtonsoft.Json.Linq.JObject();
    if (mode == "apply") er["__error"] = "APPLY_FAILED";
    else er["__error"] = "REVERT_FAILED";
    er["detail"] = ex.Message;
    return er.ToString(Newtonsoft.Json.Formatting.None);
}
AssetDatabase.SaveAssets();
var o = new Newtonsoft.Json.Linq.JObject();
o["__written"] = true;
o["assetPath"] = assetPath;
o["hasOverrides"] = PrefabUtility.HasPrefabInstanceAnyOverrides(go, false);
return o.ToString(Newtonsoft.Json.Formatting.None);

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
