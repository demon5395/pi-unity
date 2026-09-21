// unity-scripts/node-delete.cs
// 入参：parameters["param0"] = {"path":"Canvas/Btn"}
// 出参：JSON —— 成功 {"__deleted":true,"path":"<被删节点的实际路径>"}；失败 {"__error":"NOT_FOUND"|"BAD_REQUEST"}
// ⚠️ 本脚本**不做验证**：删完之后「节点真的不在了」由 lib/scene.js 的 nodeDelete 读回确认。
// ⚠️ Unity 语义：DestroyImmediate 会**连带删掉整个子树**；skill §5 的停止条件要求删**用户既有内容**前先问用户。
// 回读为什么用「实际路径」：调用方可能给裸名（只匹配根对象），读回必须用同一个路径，
// 否则会出现「删了 A 却去查 B」的假红。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var p = (string)req["path"];
if (string.IsNullOrEmpty(p)) return "{\"__error\":\"BAD_REQUEST\"}";

// R80/R82 同源：GameObject.Find **找不到非激活对象**，回退遍历当前激活场景的全部根对象（含 inactive）。
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

var pathSegs = new System.Collections.Generic.List<string>();
for (Transform cur = go.transform; cur != null; cur = cur.parent) pathSegs.Insert(0, cur.name);

var o = new Newtonsoft.Json.Linq.JObject();
o["__deleted"] = true;
o["path"] = string.Join("/", pathSegs);
UnityEngine.Object.DestroyImmediate(go);
return o.ToString(Newtonsoft.Json.Formatting.None);

// 同 node-inspect.cs：递归按 <name>/<name> 查找，**不检查 activeSelf**（这正是能命中非激活节点的原因）。
// ⚠️ 本函数**不能加 static**：uloop 会把字面量提升成外层局部变量，静态局部函数引用会编译失败 CS8421。
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
