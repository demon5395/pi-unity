// unity-scripts/node-create.cs
// 入参：parameters["param0"] = {"name":"Brick","parent":"Canvas","components":["SpriteRenderer"]}
//   组件名可写全名（UnityEngine.SpriteRenderer）或短名（SpriteRenderer），一律映射到短名比对。
// 出参：JSON —— 成功 {name, active, path}；失败 {"__error":"..."}
//   （BAD_REQUEST / PARENT_NOT_FOUND / COMPONENT_TYPE_NOT_FOUND / NOT_A_COMPONENT / COMPONENT_ADD_FAILED）。
// ⚠️ 本脚本**不做验证**：uloop 的 Success 只说明代码跑了。写入是否真的生效由
//   lib/scene.js 的 nodeCreate 读回（node-inspect.cs）比对 intent vs actual；
//   node-inspect.cs 的 `path` 字段就是为「建在哪」这个比对加的（R79）。

var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var name = (string)req["name"];
var parentPath = (string)req["parent"];

if (string.IsNullOrEmpty(name))
{
    var bad = new Newtonsoft.Json.Linq.JObject();
    bad["__error"] = "BAD_REQUEST";
    bad["detail"] = "name 不能为空";
    return bad.ToString(Newtonsoft.Json.Formatting.None);
}

var go = new GameObject(name);

if (!string.IsNullOrEmpty(parentPath))
{
    GameObject parent = FindParentByPath(parentPath);
    if (parent == null)
    {
        // 别把半成品留在场景里：父节点不存在时销毁刚建的节点
        UnityEngine.Object.DestroyImmediate(go);
        var err = new Newtonsoft.Json.Linq.JObject();
        err["__error"] = "PARENT_NOT_FOUND";
        err["parent"] = parentPath;
        // R94/R104⑤：口径必须与 JS 的读回路径一致 —— 裸名只在**根对象**里找
        // （FindParentByPath 的裸名分支），命中不了时把「从根写起」写进 detail，
        // 否则「节点存在但在嵌套里」会被读成「不存在」。
        if (parentPath.IndexOf('/') < 0)
            err["detail"] = "裸名只接受根对象；父路径需从根写起（如 Canvas/Panel）";
        return err.ToString(Newtonsoft.Json.Formatting.None);
    }
    go.transform.SetParent(parent.transform, false);
}

var comps = req["components"] as Newtonsoft.Json.Linq.JArray;
if (comps != null)
{
    foreach (var c in comps)
    {
        string cname = null;
        // R104⑤/R111②：整段「类型解析 + 添加」包 try/catch。
        // ⚠️ **实测口径（2026-09-19 团结 2022.3.62t9 真机）**：畸形程序集限定名
        // （`Type.GetType("Sprite, Nope")`）**不抛**，而是返回 null → 走上面的
        // COMPONENT_TYPE_NOT_FOUND 分支（旧注释写成「会抛异常」与真机事实相反）。
        // 这个 catch 守的是**其它**会抛的情形：`AddComponent` 内部抛出（自定义组件的
        // 构造 / Awake 抛异常）、`IsAssignableFrom` 之外的类型系统异常等；没有它，
        // 异常会穿出成 internal error + 退出码 3，且场景里留下半成品节点。
        // 异常一律收敛成 COMPONENT_ADD_FAILED + 清理（R93 的内层 try 并入此处）。
        try
        {
            cname = (string)c;
            // R78b①：解析不出类型**不能静默跳过**（`if (t != null)` 会漏加组件还报成功）
            System.Type t = System.Type.GetType(cname);
            if (t == null) t = System.Type.GetType(cname + ", UnityEngine");
            if (t == null)
            {
                // 短名兼容：在已加载程序集里找 `cname` 或 `UnityEngine.cname`
                foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
                {
                    t = asm.GetType(cname);
                    if (t == null && cname.IndexOf('.') < 0) t = asm.GetType("UnityEngine." + cname);
                    if (t != null) break;
                }
            }
            if (t == null)
            {
                // 与 PARENT_NOT_FOUND 同理：写失败就别把半成品留在场景里
                UnityEngine.Object.DestroyImmediate(go);
                var err = new Newtonsoft.Json.Linq.JObject();
                err["__error"] = "COMPONENT_TYPE_NOT_FOUND";
                err["component"] = cname;
                return err.ToString(Newtonsoft.Json.Formatting.None);
            }
            // R93：`Type.GetType("System.String, UnityEngine")` 之类能解析成功，但不是
            // Component —— `AddComponent` 会抛 ArgumentException，而两处 DestroyImmediate
            // 都在它之前 → 场景里留下半成品节点。先判类型再挂。
            if (!typeof(Component).IsAssignableFrom(t))
            {
                UnityEngine.Object.DestroyImmediate(go);
                var err = new Newtonsoft.Json.Linq.JObject();
                err["__error"] = "NOT_A_COMPONENT";
                err["component"] = cname;
                err["detail"] = "只有 Component 子类能挂到节点上";
                return err.ToString(Newtonsoft.Json.Formatting.None);
            }
            if (go.GetComponent(t) == null)
            {
                // R106/F1 真机补验：抽象类型（如 `Collider`）的 AddComponent **不抛**，
                // 而是返回 null 并只打一条 Unity 日志 —— 旧代码当成成功，场景里留一个
                // 缺组件的半成品节点（读回虽然会 verified:false，但残骸已经留下）。
                // 与上面的异常分支同构：null 也当添加失败处理 + 清理。
                var added = go.AddComponent(t);
                if (added == null)
                {
                    UnityEngine.Object.DestroyImmediate(go);
                    var nullErr = new Newtonsoft.Json.Linq.JObject();
                    nullErr["__error"] = "COMPONENT_ADD_FAILED";
                    nullErr["component"] = cname;
                    nullErr["detail"] = "AddComponent 返回 null（类型可能为抽象/不可实例化，如 Collider）";
                    return nullErr.ToString(Newtonsoft.Json.Formatting.None);
                }
            }
        }
        catch (System.Exception ex)
        {
            UnityEngine.Object.DestroyImmediate(go);
            var err = new Newtonsoft.Json.Linq.JObject();
            err["__error"] = "COMPONENT_ADD_FAILED";
            err["component"] = cname;
            err["detail"] = ex.Message;
            return err.ToString(Newtonsoft.Json.Formatting.None);
        }
    }
}

var o = new Newtonsoft.Json.Linq.JObject();
o["name"] = go.name;
o["active"] = go.activeSelf;
o["path"] = string.IsNullOrEmpty(parentPath) ? go.name : parentPath + "/" + go.name;
return o.ToString(Newtonsoft.Json.Formatting.None);

// R104⑤：裸名**直接走根锚定查找**。原先的「先 GameObject.Find（命中任意深度）再判
// `parent.transform.parent != null`」在同名根/嵌套共存时会误拒 —— 根对象明明在，
// 却被嵌套的同名对象抢先命中而报 PARENT_NOT_FOUND。非裸名仍走 Find + 根遍历回退（含 inactive）。
GameObject FindParentByPath(string path)
{
    if (path.IndexOf('/') < 0)
    {
        foreach (GameObject root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
        {
            if (root.name == path) return root;
        }
        return null;
    }
    // R82 同类：GameObject.Find 找不到非激活对象；回退遍历当前激活场景的全部根对象（含 inactive）
    GameObject found = GameObject.Find(path);
    if (found != null) return found;
    string[] segs = path.Split('/');
    foreach (GameObject root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
    {
        GameObject hit = FindByPath(root.transform, segs, 0);
        if (hit != null) return hit;
    }
    return null;
}

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
