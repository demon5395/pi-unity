// unity-scripts/build-player.cs
// 入参：parameters["param0"] =
//   {"target":"win64","outDir":"C:/out","outputExtension":".exe",
//    "candidates":[{"name":"win64","buildTarget":"StandaloneWindows64","buildTargetGroup":"Standalone"}, …]}
// 出参：JSON —— 成功
//   {"result":"Succeeded","totalErrors":0,"totalWarnings":0,"totalSize":115535765,
//    "durationSeconds":17.43,"outputPath":"…/S0Project.exe","productName":"S0Project",
//    "sceneCount":1,"scenes":["Assets/Scenes/SampleScene.scene"],"Errors":[],"Warnings":[]}
//   失败（`__error` 哨兵，见 lib/scene.js 的 parseScriptResult）
//   {"__error":"BUILD_TARGET_UNAVAILABLE","target":"webgl","available":["win64","android"]}
//   {"__error":"BUILD_NO_SCENES"}
//   {"__error":"OUT_DIR_UNWRITABLE","detail":"…"}
//   {"__error":"BUILD_FAILED","detail":"…"}
//   {"__error":"BUILD_FAILED","detail":"BuildPlayer returned null"}   ← `BuildPlayer` 返回 null（R365）
//
// 为什么走**编辑器内** `BuildPipeline.BuildPlayer`（M3 任务 3 真机探测②，2026-09-19）：
//   `-batchmode -executeMethod` 需要在**用户工程里放一个 Editor 脚本**（本项目不往用户工程写文件），
//   且要求该项目**没有别的编辑器开着**；而本命令的其余能力都跑在同一台已连接的编辑器上。
//   实测（盲测项目，空场景）：uloop 一次调用 17.5s 返回，report 形状完整，未触发任何超时。
//
// ⚠️ 本脚本**不做验证**：`report.summary.result == Succeeded` 只表示「Unity 认为构建成功」；
//   「产物真的落在磁盘上」由 `lib/build.js` 的写后读回判定（`ARTIFACT_MISSING` / `verified`）。
// ⚠️ 目标可用性**只能**由 `BuildPipeline.IsBuildTargetSupported` 判定（U9：目标取决于装了什么模块）；
//   枚举名用 `Enum.Parse` + try/catch —— 个别平台枚举名在团结引擎里可能不存在（或只是别名），
//   解析失败按「该候选不可用」处理，**绝不**因为解析失败让整条命令报编译错。
//   ⚠️ 别名实测（2026-09-19）：`BuildTarget.WeixinMiniGame.ToString()` 打出 `"MiniGame"`（同一值有别名），
//   所以可用性判定与「名字回给 JS」必须用**我们自己的候选名**，不能用枚举的 ToString。
// ⚠️ 不硬编码 Unity 官方约定（约束 5/24）：产物名取自 `Application.productName`（不是写死 `UnityPlayer`），
//   场景清单取自 `EditorBuildSettings.scenes`（扩展名 `.scene` 由项目自己给），
//   错误字段名沿用上游 `compile` 的 `Message`/`File`/`Line` 形状（供 JS 侧复用 `compressIssues`）。

var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var targetName = (string)req["target"];
var outDir = (string)req["outDir"];
var outputExtension = (string)req["outputExtension"] ?? "";

// 候选 → 该平台模块是否真的装了。Enum.Parse 失败 = 该候选不可用（不抛、不整条失败）。
bool Supported(string groupEnumName, string targetEnumName)
{
    try
    {
        var g = (BuildTargetGroup)System.Enum.Parse(typeof(BuildTargetGroup), groupEnumName, false);
        var t = (BuildTarget)System.Enum.Parse(typeof(BuildTarget), targetEnumName, false);
        return BuildPipeline.IsBuildTargetSupported(g, t);
    }
    catch
    {
        return false;
    }
}

BuildTarget pickedTarget = BuildTarget.NoTarget;
BuildTargetGroup pickedGroup = BuildTargetGroup.Unknown;
bool picked = false;
var available = new Newtonsoft.Json.Linq.JArray();
foreach (var c in (Newtonsoft.Json.Linq.JArray)req["candidates"])
{
    var name = (string)c["name"];
    var gName = (string)c["buildTargetGroup"];
    var tName = (string)c["buildTarget"];
    if (!Supported(gName, tName)) continue;
    available.Add(name);
    if (name == targetName)
    {
        pickedTarget = (BuildTarget)System.Enum.Parse(typeof(BuildTarget), tName, false);
        pickedGroup = (BuildTargetGroup)System.Enum.Parse(typeof(BuildTargetGroup), gName, false);
        picked = true;
    }
}
if (!picked)
{
    var unavailable = new Newtonsoft.Json.Linq.JObject();
    unavailable["__error"] = "BUILD_TARGET_UNAVAILABLE";
    unavailable["target"] = targetName;
    unavailable["available"] = available;
    return unavailable.ToString(Newtonsoft.Json.Formatting.None);
}

// 场景清单：Build Settings 里 enabled 的场景（Unity 的「Build」语义）；
// 清单为空才回退当前打开的场景 —— 不往项目设置里写任何东西。
var sceneList = new System.Collections.Generic.List<string>();
foreach (var s in EditorBuildSettings.scenes)
{
    if (s.enabled && !string.IsNullOrEmpty(s.path)) sceneList.Add(s.path);
}
if (sceneList.Count == 0)
{
    for (int i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++)
    {
        var sc = UnityEngine.SceneManagement.SceneManager.GetSceneAt(i);
        if (sc.isLoaded && !string.IsNullOrEmpty(sc.path)) sceneList.Add(sc.path);
    }
}
if (sceneList.Count == 0)
{
    var noScenes = new Newtonsoft.Json.Linq.JObject();
    noScenes["__error"] = "BUILD_NO_SCENES";
    return noScenes.ToString(Newtonsoft.Json.Formatting.None);
}

var sw = System.Diagnostics.Stopwatch.StartNew();
BuildReport report = null;
var locationPathName = outDir + "/" + Application.productName + outputExtension;
try
{
    System.IO.Directory.CreateDirectory(outDir);
}
catch (System.Exception dirEx)
{
    var unwritable = new Newtonsoft.Json.Linq.JObject();
    unwritable["__error"] = "OUT_DIR_UNWRITABLE";
    unwritable["detail"] = dirEx.Message;
    return unwritable.ToString(Newtonsoft.Json.Formatting.None);
}
try
{
    var opts = new BuildPlayerOptions
    {
        scenes = sceneList.ToArray(),
        locationPathName = locationPathName,
        target = pickedTarget,
        targetGroup = pickedGroup,
        options = BuildOptions.None
    };
    report = BuildPipeline.BuildPlayer(opts);
}
catch (System.Exception ex)
{
    var boom = new Newtonsoft.Json.Linq.JObject();
    boom["__error"] = "BUILD_FAILED";
    boom["detail"] = ex.ToString();
    return boom.ToString(Newtonsoft.Json.Formatting.None);
}
sw.Stop();

// R365：`BuildPipeline.BuildPlayer` 可能返回 **null**（`BuildReport` 是 class，`== null` 合法），
// 而下面紧接着就要解引用 `report.summary` → NRE，报错不可读。此处只判 `report`：
// 不抛，按 `BUILD_FAILED` 哨兵返回（与 catch 分支同码），detail 说清是脚本侧的 null 而非构建器抛异常。
//
// ⚠️ **绝不要**在这条件里顺带对 `summary` 做 null 比较（R367，Critical）：`BuildSummary` 是 **struct**
//   （实测团结 2022.3.62t9；Unity 官方版同 —— `UnityEditor.CoreModule` 里 TypeDef 的 extends 是
//    `[netstandard]System.ValueType`，**没有 op_Equality**，mono 反射 `IsValueType=True`），
//   而 struct 与 null 的 `==` 是**编译错误 CS0019**（实测原文：
//   `CS0019: Operator '==' cannot be applied to operands of type 'BuildSummary' and '<null>'`），
//   会让**整个动态脚本编译失败** ⇒ 真机 `unity build` 必挂；而正则式静态测试照样全绿（假绿陷阱）。
//   struct 本就不可能为 null —— 字段缺失由下面 `string.IsNullOrEmpty(summary.outputPath)` 等既有防御兜底。
if (report == null)
{
    var noReport = new Newtonsoft.Json.Linq.JObject();
    noReport["__error"] = "BUILD_FAILED";
    noReport["detail"] = "BuildPlayer returned null";
    return noReport.ToString(Newtonsoft.Json.Formatting.None);
}

// BuildReport 的步骤消息 → 与上游 compile 同形状（Message/File/Line），JS 侧复用 compressIssues。
// 上限 50 条：构建失败时消息可能成百上千，截断说明写在 `truncated` 里（不静默丢）。
int maxIssues = 50;
var errors = new Newtonsoft.Json.Linq.JArray();
var warnings = new Newtonsoft.Json.Linq.JArray();
int errorTotal = 0;
int warningTotal = 0;
var steps = report != null && report.steps != null ? report.steps : new BuildStep[0];
foreach (var step in steps)
{
    if (step.messages == null) continue;
    foreach (var m in step.messages)
    {
        // 用字符串比较而不是枚举成员：BuildStepMessage.MessageType 在不同版本里的名字不保证一致
        var kind = m.type.ToString();
        if (kind == "Error")
        {
            errorTotal++;
            if (errors.Count < maxIssues)
            {
                var item = new Newtonsoft.Json.Linq.JObject();
                item["Message"] = m.content;
                item["File"] = null;
                item["Line"] = null;
                errors.Add(item);
            }
        }
        else if (kind == "Warning")
        {
            warningTotal++;
            if (warnings.Count < maxIssues)
            {
                var item = new Newtonsoft.Json.Linq.JObject();
                item["Message"] = m.content;
                item["File"] = null;
                item["Line"] = null;
                warnings.Add(item);
            }
        }
    }
}

// `BuildSummary` 是 struct：这里不可能为 null，也不需要 null 守卫（见上面 R367 的说明）。
var summary = report.summary;
var actualPath = string.IsNullOrEmpty(summary.outputPath) ? locationPathName : summary.outputPath.Replace("\\", "/");
var res = new Newtonsoft.Json.Linq.JObject();
res["result"] = summary.result.ToString();
res["totalErrors"] = summary.totalErrors;
res["totalWarnings"] = summary.totalWarnings;
res["totalSize"] = summary.totalSize;
res["durationSeconds"] = System.Math.Round(sw.Elapsed.TotalSeconds, 2);
res["outputPath"] = actualPath;
res["productName"] = Application.productName;
res["sceneCount"] = sceneList.Count;
res["scenes"] = new Newtonsoft.Json.Linq.JArray(sceneList);
res["Errors"] = errors;
res["Warnings"] = warnings;
res["errorTotal"] = errorTotal;
res["warningTotal"] = warningTotal;
res["stepsTruncated"] = errorTotal > errors.Count || warningTotal > warnings.Count;
return res.ToString(Newtonsoft.Json.Formatting.None);
