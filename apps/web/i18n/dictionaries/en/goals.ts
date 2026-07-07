import type { goals as zhGoals } from "../zh/goals";

export const goals = {
  title: "My goals",
  description: "Set up to 3 goals. They are evaluated by calendar day or week in Asia/Shanghai.",
  count: (current, max) => `${current} / ${max} goals`,
  labels: {
    type: "Goal type",
    target: "Target value",
  },
  types: {
    daily_streak: { label: "Active streak", suffix: "days" },
    daily_tokens: { label: "Daily tokens", suffix: "tokens" },
    weekly_tokens: { label: "Weekly tokens", suffix: "tokens" },
    weekly_cost_cap: { label: "Weekly cost cap", suffix: "USD" },
  },
  emptyTitle: "No goals yet",
  templates: {
    dailyStreak: "Use it daily",
    weeklyTokens: "50M this week",
  },
  actions: {
    saving: "Saving",
    saveChanges: "Save changes",
    addGoal: "Add goal",
    cancel: "Cancel",
    edit: "Edit",
    delete: "Delete",
  },
  errors: {
    apiMissing: "Token Board API is not configured",
    invalidTarget: "Target value must be positive",
    saveFailed: "Save failed",
  },
  names: {
    dailyTokens: (target) => `Daily >= ${target}`,
    weeklyTokens: (target) => `This week >= ${target}`,
    weeklyCostCap: (target) => `Weekly spend <= ${target}`,
    dailyStreak: (target) => `${target}-day active streak`,
  },
  progress: {
    generic: (progress, target, window) => `${progress} / ${target} · ${window}`,
    dailyStreak: (progress, target, window) => `${progress} / ${target} days · ${window}`,
  },
  status: {
    achieved: "Achieved",
    failed: "Failed",
    in_progress: "In progress",
  },
  window: {
    day: (key) => key,
    week: (key) => `Week of ${key}`,
  },
  chain: {
    waiting: "Success chain is waiting for the first achieved period",
    success: (count, unit) => `Achieved for ${count} consecutive ${unit === "week" ? "weeks" : "days"}`,
  },
} satisfies typeof zhGoals;
