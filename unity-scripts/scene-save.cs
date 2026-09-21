// unity-scripts/scene-save.cs
// 入参：parameters["param0"] = {"path":"Assets/Scenes/SampleScene.scene"}（path 可选）
//   有 path → EditorSceneManager.SaveScene(SceneManager.GetActiveScene(), path)（单场景另存/落盘）
//   无 path → 逐场景 EditorSceneManager.SaveScene(scene, scene.path)（保存当前打开的**全部**场景）
// 出参：JSON —— 成功 {"__saved":true,"path":"…","name":"…","count":N,
//          "mtimeBefore":"<ISO>","mtimeAfter":"<ISO>"}（ISO 磁盘硬证据，供 --json 自查）
//   失败 {"__error":"NO_SCENE"}（没有活动场景 / 未命名场景且无 path）
//        {"__error":"SAVE_FAILED","detail":"…（含 mtime before → after）…"}
// ⚠️ 本脚本**不做验证**：uloop 的 Success 只说明代码跑了；「当前打开的是哪个场景」由
//   lib/scenefile.js 的 sceneSave 写后读回 `get-hierarchy` 的 sceneName 比对（verified 布尔）。
//
// ⚠️ R356（真机实测，2026-09-19，团结 2022.3.62t9）：**`EditorSceneManager.SaveOpenScenes()`
//   在本环境里什么都不写**，却返回 true —— 真机上 `Assets/Scenes/SampleScene.scene` 在调用前后
//   mtime / size / md5 **完全不变**、文件里没有任何新节点，而调用方收到的是 `__saved:true`
//   （即「报告成功 + 静默不落盘」的假绿）。根因见 R357：**动态代码建的节点不会置场景 isDirty**
//   （实测 roots 5→6 而 isDirty 仍为 False），而 SaveOpenScenes 只保存 dirty 的场景 → 它对
//   CLI 造出来的改动天然无感。故本脚本**不用 SaveOpenScenes**：无 path 分支逐场景显式
//   `SaveScene(scene, scene.path)`（语义同样是「保存全部打开的场景」），并在每次保存后核对
//   **文件 mtime 必须前进** —— 这才是「真的落盘」的硬证据（isDirty 在本环境不可用）。
var req = Newtonsoft.Json.Linq.JObject.Parse((string)parameters["param0"]);
var savePath = (string)req["path"];

var active = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
if (!active.IsValid())
{
    var noScene = new Newtonsoft.Json.Linq.JObject();
    noScene["__error"] = "NO_SCENE";
    noScene["detail"] = "没有活动的场景";
    return noScene.ToString(Newtonsoft.Json.Formatting.None);
}

string outPath;
string outName;
int savedCount;
// R361：成功载荷的磁盘硬证据（ISO 字符串）；失败 detail 也带上 before → after，
// 让「mtime 未前进」这种失败可直接诊断（而不只是一个断言）。
string mtimeBeforeIso = null;
string mtimeAfterIso = null;

try
{
    if (string.IsNullOrEmpty(savePath))
    {
        // 无 path → 保存全部打开的场景。
        // ⚠️ **未命名场景会让保存弹模态对话框**（编辑器主线程阻塞 → 之后每个 uloop 调用都会挂住），
        // 所以必须在保存**之前**收敛：只要有一个打开的场景没有 path 就报 NO_SCENE，
        // 让调用方改用 --path 指定落盘位置。
        for (int i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++)
        {
            var opened = UnityEngine.SceneManagement.SceneManager.GetSceneAt(i);
            if (string.IsNullOrEmpty(opened.path))
            {
                var unnamed = new Newtonsoft.Json.Linq.JObject();
                unnamed["__error"] = "NO_SCENE";
                unnamed["detail"] = "有未命名场景（"
                    + (string.IsNullOrEmpty(opened.name) ? "未命名" : opened.name)
                    + "）；不给 --path 无法保存（会弹保存对话框阻塞编辑器），请用 --path 指定落盘路径";
                return unnamed.ToString(Newtonsoft.Json.Formatting.None);
            }
        }
        savedCount = 0;
        // 多场景：取所有已保存场景里最早的 before / 最晚的 after（代表整次保存的盘面变化区间）。
        System.DateTime allBefore = System.DateTime.MaxValue;
        System.DateTime allAfter = System.DateTime.MinValue;
        for (int i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++)
        {
            var opened = UnityEngine.SceneManagement.SceneManager.GetSceneAt(i);
            string openedAbs = ResolveProjectPath(opened.path);
            System.DateTime openedBefore = FileWriteStamp(openedAbs);
            if (!UnityEditor.SceneManagement.EditorSceneManager.SaveScene(opened, opened.path))
            {
                var failAt = new Newtonsoft.Json.Linq.JObject();
                failAt["__error"] = "SAVE_FAILED";
                failAt["detail"] = "SaveScene 返回 false：" + opened.path;
                return failAt.ToString(Newtonsoft.Json.Formatting.None);
            }
            // ⚠️ 比较直接写在 FileWriteStamp(...) 上（而不是先存入变量再比）—— 让
            // test/scenefile.test.js 的 F2/R360 tripwire 能同时锁住**方向**与**两处核对次数**。
            if (FileWriteStamp(openedAbs) <= openedBefore)
            {
                var notWritten = new Newtonsoft.Json.Linq.JObject();
                notWritten["__error"] = "SAVE_FAILED";
                notWritten["detail"] = "保存后文件 mtime 未前进（未真正落盘）：" + opened.path
                    + "；mtime " + IsoStamp(openedBefore) + " → " + IsoStamp(FileWriteStamp(openedAbs));
                return notWritten.ToString(Newtonsoft.Json.Formatting.None);
            }
            System.DateTime openedAfter = FileWriteStamp(openedAbs);
            if (openedBefore < allBefore) allBefore = openedBefore;
            if (openedAfter > allAfter) allAfter = openedAfter;
            savedCount++;
        }
        if (savedCount > 0)
        {
            mtimeBeforeIso = IsoStamp(allBefore);
            mtimeAfterIso = IsoStamp(allAfter);
        }
    }
    else
    {
        string saveAbs = ResolveProjectPath(savePath);
        System.DateTime saveBefore = FileWriteStamp(saveAbs);
        if (!UnityEditor.SceneManagement.EditorSceneManager.SaveScene(active, savePath))
        {
            var failOne = new Newtonsoft.Json.Linq.JObject();
            failOne["__error"] = "SAVE_FAILED";
            failOne["detail"] = "SaveScene 返回 false（确认路径形如 Assets/Scenes/X.scene，且父目录存在）";
            return failOne.ToString(Newtonsoft.Json.Formatting.None);
        }
        if (FileWriteStamp(saveAbs) <= saveBefore)
        {
            var notWrittenOne = new Newtonsoft.Json.Linq.JObject();
            notWrittenOne["__error"] = "SAVE_FAILED";
            notWrittenOne["detail"] = "保存后文件 mtime 未前进（未真正落盘）：" + savePath
                + "；mtime " + IsoStamp(saveBefore) + " → " + IsoStamp(FileWriteStamp(saveAbs));
            return notWrittenOne.ToString(Newtonsoft.Json.Formatting.None);
        }
        mtimeBeforeIso = IsoStamp(saveBefore);
        mtimeAfterIso = IsoStamp(FileWriteStamp(saveAbs));
        savedCount = 1;
    }
}
catch (System.Exception ex)
{
    var exErr = new Newtonsoft.Json.Linq.JObject();
    exErr["__error"] = "SAVE_FAILED";
    exErr["detail"] = ex.Message;
    return exErr.ToString(Newtonsoft.Json.Formatting.None);
}

// 保存会改写场景的 name/path（未命名 → 文件名），所以要**重新取一次**活动场景，
// 而不是用保存前的 active（Scene 是句柄结构体，重取最稳）。
var after = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
if (!after.IsValid())
{
    var gone = new Newtonsoft.Json.Linq.JObject();
    gone["__error"] = "SAVE_FAILED";
    gone["detail"] = "保存后活动场景无效";
    return gone.ToString(Newtonsoft.Json.Formatting.None);
}

outPath = after.path;
outName = after.name;

var o = new Newtonsoft.Json.Linq.JObject();
o["__saved"] = true;
o["path"] = outPath;
o["name"] = outName;
o["count"] = savedCount;
// R361：把磁盘硬证据一并回报（lib/scenefile.js 会透传到成功信封的 actual）
o["mtimeBefore"] = mtimeBeforeIso;
o["mtimeAfter"] = mtimeAfterIso;
return o.ToString(Newtonsoft.Json.Formatting.None);

// ISO 8601（"o"）字符串：让失败 detail 与成功载荷里的 mtime 都人读且可比较（R361）。
// ⚠️ 同样不能加 static（uloop 字面量提升 → CS8421，见文件头注释）。
string IsoStamp(System.DateTime t)
{
    return t.ToString("o", System.Globalization.CultureInfo.InvariantCulture);
}

// 场景 path 是 asset 相对路径（Assets/…）→ 绝对路径，用于文件层面的落盘核对。
// ⚠️ 不能加 static（uloop 会把字面量提升成外层局部变量，静态局部函数引用会 CS8421）。
string ResolveProjectPath(string assetPath)
{
    if (System.IO.Path.IsPathRooted(assetPath)) return assetPath;
    return System.IO.Path.Combine(System.IO.Directory.GetParent(UnityEngine.Application.dataPath).FullName, assetPath);
}

// 文件的最后写入时间（UTC；文件不存在 → DateTime.MinValue，便于把「新建文件」也判为前进）。
System.DateTime FileWriteStamp(string absPath)
{
    return System.IO.File.Exists(absPath)
        ? System.IO.File.GetLastWriteTimeUtc(absPath)
        : System.DateTime.MinValue;
}
