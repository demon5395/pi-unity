// C-A 探针 6c：清理（节点 + Prefab 资产 + ca-defaults.png）+ 存回场景（官方版 2022.3.62f3c1）
var names = new System.Collections.Generic.List<string>();
foreach (var go in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
{
    if (go.name.StartsWith("Ca")) { names.Add(go.name); UnityEngine.Object.DestroyImmediate(go); }
}
var gone = new Newtonsoft.Json.Linq.JArray();
foreach (var p in new string[] { "Assets/Prefabs/CaP.prefab", "Assets/Prefabs/CaDifferent.prefab", "Assets/Art/ca-defaults.png" })
{
    AssetDatabase.DeleteAsset(p);
    var e = new Newtonsoft.Json.Linq.JObject();
    e["path"] = p;
    e["loadAssetAtPathIsNull"] = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(p) == null;
    gone.Add(e);
}
UnityEditor.SceneManagement.EditorSceneManager.SaveOpenScenes();
var o = new Newtonsoft.Json.Linq.JObject();
o["destroyedNodes"] = new Newtonsoft.Json.Linq.JArray(names);
o["assets"] = gone;
return o.ToString(Newtonsoft.Json.Formatting.None);
