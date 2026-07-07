import type { TokenBoardMetric, TokenBoardRange } from "@open-token-board/core";

import type { InstallGuideConfig, InstallGuidePlatform } from "./types";

export const RANGES: TokenBoardRange[] = ["1D", "7D", "30D", "90D"];
export const ROLLING_RANGE_LABELS: Record<TokenBoardRange, string> = {
  "1D": "滚动 24 小时",
  "7D": "滚动 7x24 小时",
  "30D": "滚动 30x24 小时",
  "90D": "滚动 90x24 小时",
};

export const METRICS: Array<{ key: TokenBoardMetric; label: string }> = [
  { key: "tokens", label: "总消耗" },
  { key: "cost", label: "费用" },
  { key: "sessions", label: "会话" },
  { key: "users", label: "活跃人数" },
];
export const DATA_LOAD_SLOW_MS = 10_000;
export const TOAST_DISMISS_MS = 1_800;

export const NPX_INSTALL_COMMAND = "npx --yes token-board-agent install";
export const NPX_STATUS_COMMAND = "npx --yes token-board-agent status";
export const NPX_UNINSTALL_COMMAND = "npx --yes token-board-agent uninstall";
export const INSTALL_GUIDES: Record<InstallGuidePlatform, InstallGuideConfig> = {
  macos: {
    description: "适合在 macOS 上使用 Codex、Claude Code、Gemini CLI 或 opencode 的朋友。",
    label: "macOS",
    uninstall: {
      command: NPX_UNINSTALL_COMMAND,
      commandLabel: "macOS 卸载命令",
      description: "以后不想继续同步时，在同一个 macOS 用户的终端里运行卸载命令。",
      note: "卸载会移除 LaunchAgent 和本机安装脚本，保留授权配置与上传状态；重新安装后可继续使用。",
    },
    steps: [
      {
        title: "安装本机 agent",
        eyebrow: "Step 1",
        description: "在你平时使用 AI 编码工具的 Mac 终端里运行安装命令，首次执行会引导 GitHub 授权。",
        command: NPX_INSTALL_COMMAND,
        commandLabel: "macOS 安装命令",
        note: "安装成功后会注册 macOS LaunchAgent，终端关闭也会每 5 分钟同步本机支持工具的 token 记录和 Codex 额度快照。",
      },
      {
        title: "检查运行状态",
        eyebrow: "Step 2",
        description: "安装完成后运行 status，确认配置文件、LaunchAgent 和最近一次同步结果是否正常。",
        command: NPX_STATUS_COMMAND,
        commandLabel: "macOS 状态检查命令",
        note: "如果没有看到最近同步结果，等 1-2 分钟后再检查，或确认当前系统用户就是使用 Codex 的用户。",
      },
      {
        title: "回到榜单刷新",
        eyebrow: "Step 3",
        description: "后台任务开始同步后，回到页面刷新榜单或打开额度面板，就能看到自己的 token 记录和 Codex 额度。",
        note: "页面只展示 token、模型、工具、项目 basename 与会话短标题，不展示完整 prompt 文本。",
      },
    ],
  },
  windows: {
    description: "适合在 Windows PowerShell 里使用 Codex CLI、Claude Code、Gemini CLI 或 opencode 的朋友。",
    label: "Windows",
    uninstall: {
      command: NPX_UNINSTALL_COMMAND,
      commandLabel: "Windows PowerShell 卸载命令",
      description: "以后不想继续同步时，在 PowerShell 里运行卸载命令。",
      note: "卸载会删除 TokenBoardAgent 任务、本机隐藏启动器和安装脚本，保留授权配置与上传状态；重新安装后可继续使用。",
    },
    steps: [
      {
        title: "安装 Windows 后台任务",
        eyebrow: "Step 1",
        description: "在 PowerShell 里运行安装命令，首次执行会引导 GitHub 授权，并注册 Windows 任务计划程序。",
        command: NPX_INSTALL_COMMAND,
        commandLabel: "Windows PowerShell 安装命令",
        note: "安装成功后会创建名为 TokenBoardAgent 的隐藏 Task Scheduler 任务，每 5 分钟同步本机支持工具的 token 记录和 Codex 额度快照。",
      },
      {
        title: "检查任务状态",
        eyebrow: "Step 2",
        description: "安装完成后运行 status，确认配置文件、Task Scheduler 任务和最近一次同步结果是否正常。",
        command: NPX_STATUS_COMMAND,
        commandLabel: "Windows PowerShell 状态检查命令",
        note: "如果公司策略禁用了任务计划程序，可以临时运行 token-board-agent watch 作为前台同步模式。",
      },
      {
        title: "回到榜单刷新",
        eyebrow: "Step 3",
        description: "任务开始同步后，回到页面刷新榜单或打开额度面板，就能看到自己的 token 记录和 Codex 额度。",
        note: "Windows 模式会读取用户目录下的 Codex / Claude Code / Gemini CLI / opencode 记录。",
      },
    ],
  },
};
