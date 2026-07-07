export const landing = {
  capabilities: {
    eyebrow: "Token usage, shared clearly",
    title: "把 AI 编码用量变成一张可讨论的榜单",
    description: "Open Token Board 适合想知道“最近谁在高强度编码、哪些模型最贵、上下文复用效率如何”的小圈子。",
    cards: [
      {
        title: "朋友排行榜",
        body: "按 1D、7D、30D、90D 查看 Token、费用和会话排名，适合小团队或朋友局做透明对比。",
        meta: "Rank by tokens, cost, sessions",
        preview: "rank",
      },
      {
        title: "自动同步",
        body: "本机 agent 后台采集 AI 编码工具的用量记录，安装后定时上报，不需要手动整理日志。",
        meta: "macOS LaunchAgent / Windows Task",
        preview: "sync",
      },
      {
        title: "个人洞察",
        body: "登录 GitHub 后查看自己的模型、项目、缓存命中率、活跃时间和 session 明细。",
        meta: "GitHub account view",
        preview: "profile",
      },
    ],
  },
  workflow: {
    eyebrow: "3 steps",
    title: "使用流程：安装、检查、刷新榜单",
    description: "不需要手动整理日志。复制下面的命令在本机执行，等 agent 完成同步后进入 `/board/` 就能看到数据。",
    openBoard: "打开榜单",
    steps: [
      {
        eyebrow: "01",
        title: "安装并完成授权",
        body: "在你平时使用 Codex 或 Claude Code 的电脑终端里运行安装命令。首次执行会引导 GitHub 授权，并注册后台同步任务。",
        commandLabel: "安装命令",
      },
      {
        eyebrow: "02",
        title: "检查同步状态",
        body: "安装完成后运行状态命令，确认配置文件、后台任务和最近一次上报结果是否正常。后台任务默认每 5 分钟同步一次。",
        commandLabel: "状态检查命令",
      },
      {
        eyebrow: "03",
        title: "打开榜单并刷新",
        body: "回到榜单页面刷新，或切换时间窗口查看自己的记录。如果以后不想继续同步，可以运行卸载命令。",
        commandLabel: "卸载命令",
      },
    ],
  },
  privacy: {
    eyebrow: "Privacy boundary",
    title: "适合公开排名，但不适合公开 prompt",
    description: "Token Board 的目标是共享统计，不是共享内容。榜单里应该出现的是用量、趋势和效率，而不是你的完整对话。",
    items: [
      "只展示 token、模型、工具、项目 basename 与会话短标题。",
      "不展示完整 prompt 文本，不上传项目绝对路径。",
      "费用按公开模型单价估算，不等同于实际账单。",
    ],
  },
  hero: {
    capabilities: "能力",
    privacy: "隐私",
    eyebrow: "AI coding token arena",
    tagline: "把 AI 编码用量变成一场看得见的排位赛。",
    description: "自动同步本机 token，公开趋势、效率和榜首高光，不公开完整 prompt。",
    cta: "看实时榜单",
    liveSummary: "Live summary",
    connectingTitle: "榜单数据正在接线",
    connectingBody: "summary 接口可用后，这里会滚动展示全站 token 和参与人数。",
    highlight: "榜首不会只出现在表格第一行，Open Token Board 会把高光、趋势和效率一起拉出来。",
    sceneSignals: ["当前榜首", "当前区间记录", "高频组合"],
    sceneColumns: ["排名", "用户", "每日用量", "总消耗", "会话", "模型"],
  },
  live: {
    total7d: "7 日总 token",
    rollingTotal: "全站滚动消耗",
    participants: "参与人数",
    reporting: "自动上报中",
    leader: "当前榜首",
  },
  command: {
    aria: "复制加入命令",
    copiedToast: "加入命令已复制",
    failedToast: "复制失败，请手动复制命令",
  },
};
