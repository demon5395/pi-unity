/**
 * pi-unity 的 `/unity-*` 扩展命令（backlog ⑫）。
 *
 * 设计：**薄封装**——扩展只负责把 slash 命令转成对 `unity` CLI 的调用，所有校验/读回/退出码
 * 仍由 CLI（`bin/unity.js`）决定（唯一事实源，不在扩展里另写一份）。零第三方依赖：
 * 只做 **type-only** 引入（运行时被擦除），命令执行用内建 `pi.exec`。
 *
 * CLI 定位顺序：环境变量 `PI_UNITY_CLI` → PATH 上的 `unity`（包 `bin` 声明）。
 * 若都不可用，命令会给出可执行的 hint（见下）。
 *
 * 用法：`/unity-doctor [项目根]`、`/unity-tree [项目根]`
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** 解析要调用的 `unity` CLI（返回 { cmd, argvPrefix }）。 */
function resolveCli(): { cmd: string; argvPrefix: string[] } {
  const fromEnv = process.env.PI_UNITY_CLI;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    // 显式给的是 js 入口 → 用 node 执行；否则当可执行文件直接跑
    if (fromEnv.endsWith(".js")) return { cmd: "node", argvPrefix: [fromEnv] };
    return { cmd: fromEnv, argvPrefix: [] };
  }
  return { cmd: "unity", argvPrefix: [] };
}

const CLI_HINT =
  "找不到 `unity` CLI：请把它装进 PATH（本包 bin 声明 `unity`），或设 `PI_UNITY_CLI=<本仓库>/bin/unity.js`。";

export default function unityCommands(pi: ExtensionAPI) {
  /**
   * 跑一条 `unity` 子命令并把结果通知出来。
   * @param sub 子命令（如 `doctor`/`scene tree`）
   * @param args slash 命令的原始参数（首个非空 token 视为项目根）
   */
  const run = async (sub: string[], rawArgs: string, ctx: { ui: { notify: (m: string, kind: string) => void } }) => {
    const parts = rawArgs.trim().split(/\s+/).filter(Boolean);
    const projectPath = parts[0];
    const { cmd, argvPrefix } = resolveCli();
    const argv = [...argvPrefix, ...sub, "--json"];
    if (projectPath) argv.push("--project-path", projectPath);
    try {
      const r = await pi.exec(cmd, argv, { timeout: 180000 });
      const out = (r.stdout || "").trim() || (r.stderr || "").trim();
      if (r.code !== 0 && /ENOENT|not found|is not recognized/i.test(out)) {
        ctx.ui.notify(CLI_HINT, "error");
        return;
      }
      ctx.ui.notify(out ? out.slice(0, 4000) : `exit ${r.code}`, r.code === 0 ? "info" : "error");
    } catch (err) {
      ctx.ui.notify(`${CLI_HINT}\n（${(err as Error).message}）`, "error");
    }
  };

  pi.registerCommand("unity-doctor", {
    description: "检查 Unity/团结 编辑器环境（只读；用法：/unity-doctor [项目根]）",
    handler: async (args, ctx) => run(["doctor"], args, ctx),
  });

  pi.registerCommand("unity-tree", {
    description: "读当前场景节点树（只读；用法：/unity-tree [项目根]）",
    handler: async (args, ctx) => run(["scene", "tree"], args, ctx),
  });
}
