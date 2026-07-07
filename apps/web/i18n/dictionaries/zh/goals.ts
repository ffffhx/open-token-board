export const goals = {
  title: "我的目标",
  description: "最多 3 个，按北京时间自然日/自然周评估。",
  count: (current: string, max: string) => `${current} / ${max} 个目标`,
  labels: {
    type: "目标类型",
    target: "目标数值",
  },
  types: {
    daily_streak: { label: "连续活跃", suffix: "天" },
    daily_tokens: { label: "每日 Token", suffix: "tokens" },
    weekly_tokens: { label: "本周 Token", suffix: "tokens" },
    weekly_cost_cap: { label: "本周费用上限", suffix: "USD" },
  },
  emptyTitle: "还没有目标",
  templates: {
    dailyStreak: "每天都用",
    weeklyTokens: "本周 50M",
  },
  actions: {
    saving: "保存中",
    saveChanges: "保存修改",
    addGoal: "添加目标",
    cancel: "取消",
    edit: "编辑",
    delete: "删除",
  },
  errors: {
    apiMissing: "未配置 Token Board API",
    invalidTarget: "目标数值必须是正数",
    saveFailed: "保存失败",
  },
  names: {
    dailyTokens: (target: string) => `每日 >= ${target}`,
    weeklyTokens: (target: string) => `本周 >= ${target}`,
    weeklyCostCap: (target: string) => `本周花费 <= ${target}`,
    dailyStreak: (target: string) => `连续活跃 ${target} 天`,
  },
  progress: {
    generic: (progress: string, target: string, window: string) => `${progress} / ${target} · ${window}`,
    dailyStreak: (progress: string, target: string, window: string) => `${progress} / ${target} 天 · ${window}`,
  },
  status: {
    achieved: "已达成",
    failed: "已失败",
    in_progress: "进行中",
  },
  window: {
    day: (key: string) => key,
    week: (key: string) => `周 ${key}`,
  },
  chain: {
    waiting: "成败链等待第一段达成记录",
    success: (count: string, unit: "day" | "week") => `连续 ${count} ${unit === "week" ? "周" : "天"}达成`,
  },
};
