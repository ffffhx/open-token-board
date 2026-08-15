import type { TokenBoardMetric, TokenBoardRange } from "@open-token-board/core";

export const ROLLING_RANGES: TokenBoardRange[] = ["1D", "7D", "30D", "90D"];
export const CALENDAR_RANGES: TokenBoardRange[] = ["today", "week", "month", "lastweek", "lastmonth"];
export const RANGES: TokenBoardRange[] = [...ROLLING_RANGES, ...CALENDAR_RANGES];
export const METRIC_KEYS: TokenBoardMetric[] = ["tokens", "cost", "sessions", "lines", "users"];
export const DATA_LOAD_SLOW_MS = 10_000;
export const TOAST_DISMISS_MS = 1_800;

export const NPX_INSTALL_COMMAND = "npx --yes token-board-agent install";
export const NPX_STATUS_COMMAND = "npx --yes token-board-agent status";
export const NPX_UNINSTALL_COMMAND = "npx --yes token-board-agent uninstall";
