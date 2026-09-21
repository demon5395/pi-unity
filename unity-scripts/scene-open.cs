// unity-scripts/scene-open.cs
// 入参：parameters["param0"] = {"path":"Assets/Scenes/SampleScene.scene","force":false}
// 出参：JSON —— 成功 {"__opened":true,"path":"…","name":"…"}
//   失败 {"__error":"DIRTY_SCENE","active":"<当前场景名>"}
//        {"__error":"SCENE_NOT_FOUND"} / {"__error":"OPEN_FAILED","detail":"…"} / {"__error":"BAD_REQUEST"}
// ⚠️ 脏场景守卫（不许静默丢改动）：活动场景 isDirty 且 force !== true → DIRTY_SCENE，
//   **在 OpenScene 之前**返回（真机行为：EditorSceneManager.OpenScene 不弹对话框、
//   会直接丢弃未保存改动，所以守卫必须由我们自己来）。
// ⚠️ 本脚本**不做验证**：真的换成了目标场景由 lib/scenefile.js 的 sceneOpen 读回
//   `get-hierarchy` 的 sceneName 比对（verified 布尔）。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var openPath = (string)req["path"];
if (string.IsNullOrEmpty(openPath))
{
    // ⚠️ F5①/R363：CLI 路径**不可达** —— lib/scenefile.js 的 pathUsageFailure 已在任何 uloop
    // 调用之前把缺失/裸写/空串/非字符串的 --path 收敛成 MISSING_PATH / BAD_TARGET_PATH（退出码 2）。
    // 保留它**仅为防御**：直接调本 .cs（或上游其它入口）时不能把空路径交给 OpenScene。
    var bad = new Newtonsoft.Json.Linq.JObject();
    bad["__error"] = "BAD_REQUEST";
    bad["detail"] = "path 不能为空";
    return bad.ToString(Newtonsoft.Json.Formatting.None);
}

var forceTok = req["force"];
var force = forceTok != null
    && forceTok.Type == Newtonsoft.Json.Linq.JTokenType.Boolean
    && (bool)forceTok;

var active = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
if (!force && active.IsValid() && active.isDirty)
{
    var dirty = new Newtonsoft.Json.Linq.JObject();
    dirty["__error"] = "DIRTY_SCENE";
    dirty["active"] = active.name;
    return dirty.ToString(Newtonsoft.Json.Formatting.None);
}

// 路径存在性先判：OpenScene 对不存在的路径在不同版本上会抛 / 返回无效场景，先收敛成
// 明确的 SCENE_NOT_FOUND（asset 相对路径以项目根为基准，即 Application.dataPath 的父目录）。
string abs = System.IO.Path.IsPathRooted(openPath)
    ? openPath
    : System.IO.Path.Combine(System.IO.Directory.GetParent(UnityEngine.Application.dataPath).FullName, openPath);
if (!System.IO.File.Exists(abs))
{
    var notFound = new Newtonsoft.Json.Linq.JObject();
    notFound["__error"] = "SCENE_NOT_FOUND";
    notFound["path"] = openPath;
    return notFound.ToString(Newtonsoft.Json.Formatting.None);
}

UnityEngine.SceneManagement.Scene opened;
try
{
    opened = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(
        openPath, UnityEditor.SceneManagement.OpenSceneMode.Single);
}
catch (System.Exception ex)
{
    var openErr = new Newtonsoft.Json.Linq.JObject();
    openErr["__error"] = "OPEN_FAILED";
    openErr["detail"] = ex.Message;
    return openErr.ToString(Newtonsoft.Json.Formatting.None);
}

if (!opened.IsValid())
{
    var invalid = new Newtonsoft.Json.Linq.JObject();
    invalid["__error"] = "OPEN_FAILED";
    invalid["detail"] = "OpenScene 返回无效场景";
    return invalid.ToString(Newtonsoft.Json.Formatting.None);
}

var o = new Newtonsoft.Json.Linq.JObject();
o["__opened"] = true;
o["path"] = opened.path;
o["name"] = opened.name;
return o.ToString(Newtonsoft.Json.Formatting.None);
