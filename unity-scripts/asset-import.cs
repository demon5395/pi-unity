// unity-scripts/asset-import.cs
// 入参：parameters["param0"] = {"mode":"write","path":"Assets/Art/hero.png","settings":{...}}
//                            {"mode":"read","path":"Assets/Art/hero.png"}
// 出参：write → {"__written":true}
//       read  → {"__read":{...全部设置 + 纹理事实...}}
// 失败：{"__error":"BAD_PAYLOAD"|"IMPORTER_NOT_FOUND"|"TEXTURE_NOT_FOUND"}
//
// ⚠️ 真机教训（M4-SPIKE，团结 2022.3.62t9 实测，改本文件前必读）：
//   NEW-1：spriteMeshType/spriteExtrude/spriteAlignment **不在** TextureImporter 上（真机 CS1061）
//          → 必须 TextureImporterSettings 往返；SpriteMeshType 在 UnityEngine 命名空间（不是 UnityEditor.*）；
//          spriteExtrude 是 **uint**（字面量/转换都要 uint）。
//   NEW-2：外部进程写进 Assets/ 的文件**不会**被自动导入 → 必须显式 ImportAsset（89ms，别用 Refresh 的 3540ms）。
//   SaveAndReimport() 之后**旧 importer 实例作废** → 读回必须重新 GetAtPath（read 模式天然满足）。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var p = (string)req["path"];
var mode = (string)req["mode"];
if (string.IsNullOrEmpty(p) || !p.StartsWith("Assets/") || (mode != "write" && mode != "read"))
    return "{\"__error\":\"BAD_PAYLOAD\"}";

if (mode == "write")
{
    var s = req["settings"] as Newtonsoft.Json.Linq.JObject;
    if (s == null) return "{\"__error\":\"BAD_PAYLOAD\"}";

    // NEW-2：显式、同步、按单路径导入（比 Refresh 快 40 倍，且不需要等帧）
    AssetDatabase.ImportAsset(p, ImportAssetOptions.ForceSynchronousImport);
    var ti = AssetImporter.GetAtPath(p) as TextureImporter;
    if (ti == null) return "{\"__error\":\"IMPORTER_NOT_FOUND\"}";

    ti.textureType = (TextureImporterType)System.Enum.Parse(typeof(TextureImporterType), (string)s["textureType"]);
    ti.spriteImportMode = (SpriteImportMode)System.Enum.Parse(typeof(SpriteImportMode), (string)s["spriteImportMode"]);
    ti.filterMode = (FilterMode)System.Enum.Parse(typeof(FilterMode), (string)s["filterMode"]);
    ti.textureCompression = (TextureImporterCompression)System.Enum.Parse(typeof(TextureImporterCompression), (string)s["textureCompression"]);
    ti.mipmapEnabled = (bool)s["mipmapEnabled"];
    ti.wrapMode = (TextureWrapMode)System.Enum.Parse(typeof(TextureWrapMode), (string)s["wrapMode"]);
    ti.spritePixelsPerUnit = (float)s["pixelsPerUnit"];
    ti.maxTextureSize = (int)s["maxTextureSize"];
    ti.npotScale = (TextureImporterNPOTScale)System.Enum.Parse(typeof(TextureImporterNPOTScale), (string)s["npotScale"]);
    ti.isReadable = (bool)s["isReadable"];
    ti.alphaIsTransparency = (bool)s["alphaIsTransparency"];

    // NEW-1：精灵几何相关的三项走 settings 往返（并把 fallback physics shape 关掉）
    var ts = new TextureImporterSettings();
    ti.ReadTextureSettings(ts);
    ts.spriteMeshType = (UnityEngine.SpriteMeshType)System.Enum.Parse(typeof(UnityEngine.SpriteMeshType), (string)s["spriteMeshType"]);
    ts.spriteExtrude = (uint)(int)s["spriteExtrude"];
    ts.spriteAlignment = (int)s["spriteAlignment"];
    ts.spritePivot = new Vector2((float)s["spritePivotX"], (float)s["spritePivotY"]);
    ts.spriteGenerateFallbackPhysicsShape = false;
    ti.SetTextureSettings(ts);
    ti.SaveAndReimport();   // 实测 40ms；同调用内读回即新值，但**旧实例作废**（读回在 read 模式里重新 GetAtPath）
    return "{\"__written\":true}";
}

// ---- read 模式：**独立一次调用**（写后读回纪律），且必须重新 GetAtPath ----
var ti2 = AssetImporter.GetAtPath(p) as TextureImporter;
if (ti2 == null) return "{\"__error\":\"IMPORTER_NOT_FOUND\"}";
var ts2 = new TextureImporterSettings();
ti2.ReadTextureSettings(ts2);
var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(p);
if (tex == null) return "{\"__error\":\"TEXTURE_NOT_FOUND\"}";
var sp = AssetDatabase.LoadAssetAtPath<Sprite>(p);

var o = new Newtonsoft.Json.Linq.JObject();
o["path"] = p;
o["textureType"] = ti2.textureType.ToString();
o["spriteImportMode"] = ti2.spriteImportMode.ToString();
o["filterMode"] = ti2.filterMode.ToString();
o["textureCompression"] = ti2.textureCompression.ToString();
o["mipmapEnabled"] = ti2.mipmapEnabled;
o["wrapMode"] = ti2.wrapMode.ToString();
o["pixelsPerUnit"] = ti2.spritePixelsPerUnit;
o["maxTextureSize"] = ti2.maxTextureSize;
o["npotScale"] = ti2.npotScale.ToString();
o["isReadable"] = ti2.isReadable;
o["alphaIsTransparency"] = ti2.alphaIsTransparency;
o["spriteMeshType"] = ts2.spriteMeshType.ToString();
o["spriteExtrude"] = (int)ts2.spriteExtrude;
o["spriteAlignment"] = ts2.spriteAlignment;
o["spritePivotX"] = ts2.spritePivot.x;
o["spritePivotY"] = ts2.spritePivot.y;
o["width"] = tex.width;              // intent 里「我要求的尺寸」的读回对应项
o["height"] = tex.height;
o["texWidth"] = tex.width;           // **真实**纹理尺寸 —— 静默缩放会让它与 width/height 不一致（NEW-5）
o["texHeight"] = tex.height;
o["texFormat"] = tex.format.ToString();
o["texFilterMode"] = tex.filterMode.ToString();
o["mipmapCount"] = tex.mipmapCount;
o["hasSprite"] = sp != null;
o["guid"] = AssetDatabase.AssetPathToGUID(p);
var root = new Newtonsoft.Json.Linq.JObject();
root["__read"] = o;
return root.ToString(Newtonsoft.Json.Formatting.None);
