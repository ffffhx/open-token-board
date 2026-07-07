import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import sanitizeHtml from "sanitize-html";

import {
  createAgentSessionToken,
  createOAuthState,
  createWebSessionToken,
  identityFromGitHubUser,
  isGithubIdentityAllowed,
  parseCookieHeader,
  sanitizeReturnTo,
  verifyAgentSessionToken,
  verifyOAuthState,
  verifyWebSessionToken,
  type GitHubUserProfile,
  type TokenBoardIdentity,
} from "@open-token-board/core/auth";
import {
  findUserByUploadToken,
  isTokenBoardMetric,
  isTokenBoardRange,
  normalizeUploadUsers,
  sanitizeIngestEvents,
  sanitizeTokenBoardUserConfig,
  type TokenBoardUploadUser,
} from "@open-token-board/core/automation";
import {
  buildTokenAchievementSummary,
  buildWeeklyTokenGoalScorecard,
  createCustomTokenLeaderboardWindow,
  buildTokenAccountUsageProfile,
  buildTokenLevelProgress,
  buildTokenLeaderboard,
  evaluateTokenGoals,
  getTokenConsumptionTokens,
  getUnmatchedTokenPricingModels,
  normalizeStoredTokenGoals,
  sanitizeTokenGoals,
  TOKEN_LEVELS,
  type TokenAccountUsageProfile,
  type TokenBoardMetric,
  type TokenBoardRange,
  type TokenBoardUserConfig,
  type TokenGoal,
  type TokenDailyUsagePoint,
  type TokenLeaderboardSummary,
  type TokenLeaderboardWindow,
  type TokenLeaderboardUser,
  type TokenWrappedLevelUp,
  type TokenWrappedNamedUsage,
  type TokenWrappedProjectUsage,
  type TokenWrappedResponse,
  type TokenUsageEvent,
} from "@open-token-board/core";
import {
  analyzeCodexRateLimits,
  type CodexRateLimitReport,
  type CodexRateWindow,
} from "@open-token-board/core/codex-rate-limits";
import {
  createTokenUsageStore,
  importTokenUsageEventsFromJsonFile,
  type TokenUsageStore,
} from "@open-token-board/core/storage";
import {
  chatArticleWithKimi,
  explainSelectionWithKimi,
  parseArticleChatPayload,
  parseSelectionExplainPayload,
  SelectionExplainServiceError,
} from "@open-token-board/core/selection-explainer";
import {
  createSnapshotShareStore,
  SnapshotShareOwnershipError,
  type SnapshotShareRecord,
  type SnapshotShareStore,
} from "@open-token-board/core/snapshot-share-storage";
import { buildTokenUsageSnapshotFromEvents } from "@open-token-board/core/snapshot";
import {
  buildDailyReportCard,
  buildReportStateSnapshot,
  buildWeeklyReportCard,
  buildWeeklyReportHighlights,
  detectDailyReportEvents,
  sendFeishuCard,
  type DailyReportConfig,
  type ReportStateSnapshot,
} from "./daily-report";

const PORT = Number(process.env.TOKEN_BOARD_PORT || 8787);
const HOST = process.env.TOKEN_BOARD_HOST || "127.0.0.1";
const DATA_FILE = process.env.TOKEN_BOARD_DATA_FILE || path.join(process.cwd(), ".token-board", "usage-events.json");
const USERS_FILE = process.env.TOKEN_BOARD_USERS_FILE || path.join(process.cwd(), ".token-board", "users.json");
const MAX_BODY_BYTES = positiveNumberEnv(process.env.TOKEN_BOARD_MAX_BODY_BYTES, 4 * 1024 * 1024);
const MAX_EVENTS = positiveNumberEnv(process.env.TOKEN_BOARD_MAX_EVENTS, 100_000);
const MAX_EVENT_TOTAL_TOKENS = positiveNumberEnv(process.env.TOKEN_BOARD_MAX_EVENT_TOTAL_TOKENS, 50_000_000);
const MAX_USER_DAILY_TOTAL_TOKENS = positiveNumberEnv(process.env.TOKEN_BOARD_MAX_USER_DAILY_TOTAL_TOKENS, 500_000_000);
const LEADERBOARD_SNAPSHOT_FILE =
  process.env.TOKEN_BOARD_LEADERBOARD_SNAPSHOT_FILE || path.join(path.dirname(DATA_FILE), "leaderboard-snapshots.json");
const LEADERBOARD_SNAPSHOT_REFRESH_MS = positiveNumberEnv(process.env.TOKEN_BOARD_LEADERBOARD_SNAPSHOT_REFRESH_MS, 60_000);
const LEADERBOARD_SNAPSHOT_WRITE_DELAY_MS = positiveNumberEnv(process.env.TOKEN_BOARD_LEADERBOARD_SNAPSHOT_WRITE_DELAY_MS, 5_000);
const SNAPSHOT_SHARE_DATA_FILE =
  process.env.SNAPSHOT_SHARE_DATA_FILE || path.join(process.cwd(), ".token-board", "snapshot-shares.json");
const MAX_SNAPSHOT_SHARE_BODY_BYTES = positiveNumberEnv(process.env.SNAPSHOT_SHARE_MAX_BODY_BYTES, 24 * 1024 * 1024);
const MAX_SELECTION_EXPLAIN_BODY_BYTES = positiveNumberEnv(process.env.SELECTION_EXPLAIN_MAX_BODY_BYTES, 16 * 1024);
const MAX_ARTICLE_CHAT_BODY_BYTES = positiveNumberEnv(process.env.ARTICLE_CHAT_MAX_BODY_BYTES, 128 * 1024);
const DEV_AUTH_SECRET_PLACEHOLDER = "dev-only-token-board-auth-secret";

// Parse a positive numeric env var, falling back to a safe default when it is unset
// OR set to a non-numeric value — so a misconfigured limit never becomes NaN (which
// would silently disable the guard it controls).
function positiveNumberEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function booleanEnv(value: string | undefined, fallback: "true" | "false") {
  const normalized = value?.trim();
  return (normalized || fallback) === "true";
}
const DEFAULT_SELECTION_EXPLAIN_ALLOWED_GITHUB_LOGINS = ["ffffhx"];
const DEFAULT_BENCHMARK_ALLOWED_GITHUB_LOGINS = ["ffffhx"];
const SESSION_COOKIE_NAME = "token_board_session";
const WEB_SESSION_TTL_SECONDS = Number(process.env.TOKEN_BOARD_WEB_SESSION_TTL_SECONDS || 30 * 24 * 60 * 60);
const AGENT_SESSION_TTL_SECONDS = Number(process.env.TOKEN_BOARD_AGENT_SESSION_TTL_SECONDS || 180 * 24 * 60 * 60);
const OAUTH_STATE_TTL_SECONDS = 15 * 60;

// --- Daily Feishu (Lark) report -------------------------------------------
// A whole-board digest pushed once a day to a Feishu custom-bot webhook.
// Disabled unless a webhook URL is configured, so existing deployments are unaffected.
const FEISHU_WEBHOOK_URL = process.env.TOKEN_BOARD_FEISHU_WEBHOOK_URL || "";
const FEISHU_WEBHOOK_SECRET = process.env.TOKEN_BOARD_FEISHU_WEBHOOK_SECRET || "";
const DAILY_REPORT_AT = process.env.TOKEN_BOARD_DAILY_REPORT_AT || "09:00"; // local HH:MM
const WEEKLY_REPORT_AT = process.env.TOKEN_BOARD_WEEKLY_REPORT_AT || "10:00"; // local Monday HH:MM
const DAILY_REPORT_TZ_OFFSET_MIN = Number.isFinite(Number(process.env.TOKEN_BOARD_DAILY_REPORT_TZ_OFFSET))
  ? Number(process.env.TOKEN_BOARD_DAILY_REPORT_TZ_OFFSET)
  : 480; // UTC+8 (Asia/Shanghai) by default
const DAILY_REPORT_RANGE: TokenBoardRange = isTokenBoardRange(process.env.TOKEN_BOARD_DAILY_REPORT_RANGE || "")
  ? (process.env.TOKEN_BOARD_DAILY_REPORT_RANGE as TokenBoardRange)
  : "1D";
const DAILY_REPORT_SITE_URL = process.env.TOKEN_BOARD_DAILY_REPORT_SITE_URL || "";
const DAILY_REPORT_TRIGGER_TOKEN = process.env.TOKEN_BOARD_DAILY_REPORT_TRIGGER_TOKEN || "";
const DAILY_REPORT_STATE_FILE =
  process.env.TOKEN_BOARD_DAILY_REPORT_STATE_FILE || path.join(path.dirname(DATA_FILE), "daily-report-state.json");
const DAILY_REPORT_ENABLED = booleanEnv(
  process.env.TOKEN_BOARD_DAILY_REPORT_ENABLED,
  FEISHU_WEBHOOK_URL ? "true" : "false",
);
const WEEKLY_REPORT_ENABLED = booleanEnv(
  process.env.TOKEN_BOARD_WEEKLY_REPORT_ENABLED,
  FEISHU_WEBHOOK_URL ? "true" : "false",
);
let tokenUsageStore: TokenUsageStore | undefined;
let snapshotShareStore: SnapshotShareStore | undefined;
const GLOBAL_SUMMARY_CACHE_MS = 10_000;
let globalSummaryCache: { key: string; at: number; value: unknown } | undefined;
const LEADERBOARD_SNAPSHOT_RANGES: TokenBoardRange[] = ["1D", "7D", "30D", "90D", "week", "month", "lastweek", "lastmonth"];
const LEADERBOARD_SNAPSHOT_METRICS: TokenBoardMetric[] = ["tokens", "cost", "sessions", "messages", "users"];
const PUBLIC_PROFILE_RANGES: TokenBoardRange[] = ["1D", "7D", "30D", "90D"];
const PUBLIC_PROFILE_DAILY_DAYS = 365;
const PUBLIC_PROFILE_TOP_LIMIT = 8;
const RATE_LIMIT_TEAM_STALE_SECONDS = 2 * 60 * 60;
let leaderboardSnapshotCache = new Map<string, LeaderboardSnapshotEntry>();
let leaderboardSnapshotRefreshPromise: Promise<void> | undefined;
let leaderboardSnapshotRefreshTimer: NodeJS.Timeout | undefined;
let leaderboardSnapshotWriteTimer: NodeJS.Timeout | undefined;
let leaderboardSnapshotLastRefreshAt = "";
let leaderboardSnapshotLastError = "";
let dailyReportTimer: NodeJS.Timeout | undefined;
let weeklyReportTimer: NodeJS.Timeout | undefined;
let dailyReportLastSentDayKey = "";
let weeklyReportLastSentWeekKey = "";
let latestReportSnapshot: ReportStateSnapshot | null = null;

async function main() {
  authSecret(); // fail fast if the auth secret is missing/placeholder
  tokenUsageStore = await openTokenUsageStore();
  snapshotShareStore = await openSnapshotShareStore();
  await loadLeaderboardSnapshotsFromFile();

  if (process.env.TOKEN_BOARD_MIGRATE_JSON_ON_START === "true") {
    const result = await importTokenUsageEventsFromJsonFile(tokenUsageStore, DATA_FILE);
    console.log(
      `migrated ${result.accepted}/${result.imported} token usage events from ${result.filePath}; duplicates=${result.duplicates}; records=${result.records}`
    );
  }
  startLeaderboardSnapshotRefreshLoop();
  startFeishuReportLoops();

  const server = createServer((request, response) => {
    void routeRequest(request, response).catch((error) => {
      // Log the real error server-side; return a generic message so internal detail
      // (SQL fragments, connection strings, env names, upstream text) is not leaked.
      console.error("Unhandled request error:", error);
      sendJson(request, response, 500, { error: "Internal server error" });
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`token-board server listening on http://${HOST}:${PORT}`);
    console.log(`storage: ${tokenUsageStore?.kind} (${tokenUsageStore?.label})`);
    console.log(`snapshot shares: ${snapshotShareStore?.kind} (${snapshotShareStore?.label})`);
    console.log(`leaderboard snapshots: ${LEADERBOARD_SNAPSHOT_FILE}`);
  });
}

async function migrateJson() {
  const store = await openTokenUsageStore();

  try {
    const result = await importTokenUsageEventsFromJsonFile(store, DATA_FILE);
    console.log(`source: ${result.filePath}`);
    console.log(`storage: ${store.kind} (${store.label})`);
    console.log(`imported: ${result.imported}`);
    console.log(`accepted: ${result.accepted}`);
    console.log(`duplicates: ${result.duplicates}`);
    console.log(`records: ${result.records}`);

    if (result.errors.length) {
      console.log(`parse warnings: ${result.errors.join("; ")}`);
    }
  } finally {
    await store.close?.();
  }
}

async function routeRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage/health") {
    const users = await loadUploadUsers();
    const records = await usageStore().countEvents();
    const snapshotShares = await shareStore().countShares();
    sendJson(request, response, 200, {
      ok: true,
      users: users.length,
      records,
      snapshotShares,
      storage: usageStore().kind,
      snapshotShareStorage: shareStore().kind,
      pricing: {
        overrideFile: process.env.TOKEN_BOARD_PRICING_FILE || null,
        unmatchedModels: getUnmatchedTokenPricingModels(),
      },
      leaderboardSnapshots: {
        entries: leaderboardSnapshotCache.size,
        file: LEADERBOARD_SNAPSHOT_FILE,
        lastRefreshAt: leaderboardSnapshotLastRefreshAt || null,
        lastError: leaderboardSnapshotLastError || null,
        refreshMs: LEADERBOARD_SNAPSHOT_REFRESH_MS,
        refreshing: Boolean(leaderboardSnapshotRefreshPromise),
      },
      githubAuth: Boolean(process.env.GITHUB_CLIENT_ID),
      generatedAt: new Date().toISOString(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/internal/daily-report/run") {
    // Manual trigger for testing / backfill. Gated behind a dedicated token so it
    // is invisible (404) unless explicitly configured.
    if (!DAILY_REPORT_TRIGGER_TOKEN) {
      sendJson(request, response, 404, { error: "Not found" });
      return;
    }
    if (readBearerToken(request) !== DAILY_REPORT_TRIGGER_TOKEN) {
      sendJson(request, response, 401, { error: "Unauthorized" });
      return;
    }
    if (!FEISHU_WEBHOOK_URL) {
      sendJson(request, response, 400, { error: "Feishu webhook is not configured" });
      return;
    }
    const kind = parseReportKind(url.searchParams.get("kind"));
    if (!kind) {
      sendJson(request, response, 400, { error: "kind must be daily or weekly" });
      return;
    }
    const result = kind === "weekly" ? await runWeeklyReport("manual") : await runDailyReport("manual");
    sendJson(request, response, result.sent ? 200 : 202, result);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage/rate-limits") {
    const daysParam = Number(url.searchParams.get("days"));
    const lookbackDays = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(90, daysParam) : undefined;
    const identity = readWebIdentity(request);
    const userConfig = identity ? await usageStore().getUserConfig(identity.userId) : null;

    if (userConfig?.rateLimits) {
      sendJson(request, response, 200, {
        ...userConfig.rateLimits,
        notes: [
          ...userConfig.rateLimits.notes,
          `已从 ${identity?.displayName || identity?.userId || "当前用户"} 的 token-board-agent 后台同步读取。`,
        ],
      });
      return;
    }

    const report = await analyzeCodexRateLimits({ lookbackDays, cacheMs: 8000 });
    sendJson(request, response, 200, {
      ...report,
      notes: [
        ...report.notes,
        identity
          ? "尚未收到当前登录用户的 token-board-agent 额度快照；请重新运行 npx --yes token-board-agent install 或等待后台同步。"
          : "未登录时只能读取 API 服务所在机器的 Codex 日志；登录后可读取 token-board-agent 上传的个人额度快照。",
      ],
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage/claude-rate-limits") {
    const identity = readWebIdentity(request);
    const userConfig = identity ? await usageStore().getUserConfig(identity.userId) : null;

    if (userConfig?.claudeCodeRateLimits) {
      sendJson(request, response, 200, {
        ...userConfig.claudeCodeRateLimits,
        notes: [
          ...userConfig.claudeCodeRateLimits.notes,
          `已从 ${identity?.displayName || identity?.userId || "当前用户"} 的 token-board-agent 后台同步读取。`,
        ],
      });
      return;
    }

    // Claude Code 不在本地落地额度,服务端无 fallback：未上传即 available:false。
    sendJson(request, response, 200, {
      generatedAt: new Date().toISOString(),
      available: false,
      plan: null,
      latestEventAt: null,
      windows: [],
      recentTokensPerHour: null,
      notes: [
        identity
          ? "尚未收到当前登录用户的 Claude Code 额度快照。请在本机为 Claude Code 配置状态栏捕获(token-board-agent 会读取 ~/.token-board-agent/claude-rate-limits.json),并确保 Claude Code 是订阅(Pro/Max)账号。"
          : "登录后可读取 token-board-agent 上传的 Claude Code 订阅额度快照。",
      ],
      sourcePaths: [],
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage/rate-limits/team") {
    await handleTeamRateLimits(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/snapshots/health") {
    sendJson(request, response, 200, {
      ok: true,
      shares: await shareStore().countShares(),
      storage: shareStore().kind,
      generatedAt: new Date().toISOString(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/explain-selection/health") {
    sendJson(request, response, 200, {
      ok: true,
      authRequired: true,
      articleChat: true,
      allowedGithubLogins: selectionExplainAllowedGithubLogins(),
      keyConfigured: Boolean(process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY),
      generatedAt: new Date().toISOString(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/explain-selection") {
    await handleSelectionExplain(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat-article") {
    await handleArticleChat(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/snapshots") {
    await handleSnapshotSharePublish(request, response);
    return;
  }

  if (request.method === "GET" && snapshotShareIdFromPath(url.pathname)) {
    await handleSnapshotShareGet(request, response, snapshotShareIdFromPath(url.pathname) || "");
    return;
  }

  if (request.method === "DELETE" && snapshotShareIdFromPath(url.pathname)) {
    await handleSnapshotShareDelete(request, response, snapshotShareIdFromPath(url.pathname) || "");
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    const identity = readWebIdentity(request);
    sendJson(request, response, 200, {
      authenticated: Boolean(identity),
      user: identity,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/benchmark/access") {
    const identity = readWebIdentity(request);
    sendJson(request, response, 200, {
      authenticated: Boolean(identity),
      allowed: Boolean(identity && isGithubIdentityAllowed(identity, benchmarkAllowedGithubLogins())),
      user: identity
        ? {
            userId: identity.userId,
            displayName: identity.displayName,
            githubLogin: identity.githubLogin,
            avatarUrl: identity.avatarUrl,
          }
        : null,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/logout") {
    response.setHeader("Set-Cookie", clearSessionCookie(request));
    redirect(response, sanitizeReturnTo(url.searchParams.get("returnTo"), allowedReturnOrigins(request), "/"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/github/start") {
    await handleGithubStart(request, response, url);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/github/callback") {
    await handleGithubCallback(request, response, url);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/device/start") {
    await handleDeviceStart(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/device/poll") {
    await handleDevicePoll(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage/stats") {
    const metric = parseMetric(url.searchParams.get("metric"));
    const now = parseNow(url.searchParams.get("now"));
    const statsRange = parseStatsRange(url.searchParams);

    if ("error" in statsRange) {
      sendJson(request, response, 400, { error: statsRange.error });
      return;
    }

    const { generatedAt, records, source, summary } = await readUsageLeaderboard({
      range: statsRange.range,
      metric,
      now,
      preferSnapshot: statsRange.preferSnapshot,
      window: statsRange.window,
    });

    sendJson(request, response, 200, {
      schemaVersion: 1,
      source,
      records,
      generatedAt,
      summary,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/badge") {
    await handleBadge(request, response, url);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage/user") {
    await handlePublicUsageUser(request, response, url);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage/wrapped") {
    await handleUsageWrapped(request, response, url);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage/me") {
    const identity = readWebIdentity(request);

    if (!identity) {
      sendJson(request, response, 401, { error: "GitHub login required" });
      return;
    }

    const range = parseRange(url.searchParams.get("range"));
    const now = parseNow(url.searchParams.get("now"));
    sendJson(request, response, 200, await buildUsageMePayload(identity, { range, now, preferSnapshot: !url.searchParams.has("now") }));
    return;
  }

  if (url.pathname === "/api/usage/goals") {
    await handleUsageGoals(request, response, url);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage/summary") {
    const now = parseNow(url.searchParams.get("now"));
    const ownerUserId = normalizeOptionalText(url.searchParams.get("userId")) || normalizeOptionalText(process.env.TOKEN_BOARD_SUMMARY_USER_ID);
    const store = usageStore();

    if (ownerUserId) {
      // Scope to a single user's events so an arbitrary userId cannot force a
      // full-table scan on every request.
      const scopedEvents = await store.listEventsForUser(ownerUserId);
      sendJson(request, response, 200, {
        ...buildTokenUsageSnapshotFromEvents(scopedEvents, { now, source: "token-board-server-user" }),
        records: scopedEvents.length,
        totalRecords: await store.countEvents(),
        userId: ownerUserId,
      });
      return;
    }

    // Global (unauthenticated) board: cache the full-scan result briefly so it cannot
    // be hammered into repeated whole-table scans.
    const cacheKey = `summary:${url.searchParams.get("now") || "live"}`;
    if (globalSummaryCache && globalSummaryCache.key === cacheKey && Date.now() - globalSummaryCache.at < GLOBAL_SUMMARY_CACHE_MS) {
      sendJson(request, response, 200, globalSummaryCache.value);
      return;
    }
    const events = await store.listEvents();
    const payload = {
      ...buildTokenUsageSnapshotFromEvents(events, { now, source: "token-board-server" }),
      records: events.length,
      totalRecords: events.length,
      userId: null,
    };
    globalSummaryCache = { key: cacheKey, at: Date.now(), value: payload };
    sendJson(request, response, 200, payload);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage/leaderboard") {
    const range = parseRange(url.searchParams.get("range"));
    const metric = parseMetric(url.searchParams.get("metric"));
    const now = parseNow(url.searchParams.get("now"));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
    const { generatedAt, source, summary } = await readUsageLeaderboard({
      range,
      metric,
      now,
      preferSnapshot: !url.searchParams.has("now"),
    });

    sendJson(request, response, 200, {
      schemaVersion: 1,
      source,
      generatedAt,
      users: summary.users.slice(0, limit),
      summary,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage/export") {
    await handleUsageExport(request, response, url);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/usage/ingest") {
    await handleIngest(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/usage/replace") {
    await handleReplace(request, response);
    return;
  }

  sendJson(request, response, 404, { error: "Not found" });
}

type TeamRateLimitWindowSnapshot = Pick<
  CodexRateWindow,
  | "key"
  | "windowMinutes"
  | "label"
  | "usedPercent"
  | "remainingPercent"
  | "resetsAt"
  | "observedAt"
  | "staleSeconds"
  | "burnPercentPerHour"
  | "burnTokensPerHour"
  | "etaAt"
  | "willExhaustBeforeReset"
> & {
  resetsInSeconds: number | null;
  etaSeconds: number | null;
};

type TeamRateLimitToolSnapshot = {
  available: boolean;
  plan: string | null;
  generatedAt: string;
  latestEventAt: string | null;
  windows: TeamRateLimitWindowSnapshot[];
};

type TeamUserProfile = {
  login: string;
  displayName: string;
  team?: string;
  avatarUrl?: string;
};

async function handleTeamRateLimits(request: IncomingMessage, response: ServerResponse) {
  const identity = readWebIdentity(request);

  if (!identity) {
    sendJson(request, response, 401, { error: "GitHub login required" });
    return;
  }

  const nowMs = Date.now();
  const store = usageStore();
  const [configs, uploadUsers, events] = await Promise.all([
    store.listUserConfigs(),
    loadUploadUsers(),
    store.listEvents(),
  ]);
  const profiles = buildTeamUserProfiles(uploadUsers, events);
  const users = configs.flatMap(({ userId, config }) => {
    const codex = teamToolSnapshotFromReport(config.rateLimits, nowMs);
    const claudeCode = teamToolSnapshotFromReport(config.claudeCodeRateLimits, nowMs);

    if (!codex && !claudeCode) {
      return [];
    }

    const profile = profiles.get(userId) ?? teamFallbackProfile(userId);
    const updatedAt = sanitizeTeamIsoDate(config.updatedAt) || new Date(0).toISOString();
    const snapshotAgeSeconds = Math.max(0, Math.round((nowMs - Date.parse(updatedAt)) / 1000));
    const weeklyRemainingPercent = minWindowRemaining([codex, claudeCode], "weekly");
    const fiveHourRemainingPercent = minWindowRemaining([codex, claudeCode], "5h");

    return [
      {
        userId,
        login: profile.login,
        displayName: profile.displayName,
        team: profile.team ?? null,
        avatarUrl: profile.avatarUrl ?? null,
        updatedAt,
        snapshotAgeSeconds,
        stale: snapshotAgeSeconds > RATE_LIMIT_TEAM_STALE_SECONDS,
        weeklyRemainingPercent,
        fiveHourRemainingPercent,
        codex,
        claudeCode,
      },
    ];
  });

  users.sort((left, right) => {
    const weekly = nullableNumberSort(left.weeklyRemainingPercent, right.weeklyRemainingPercent);
    if (weekly !== 0) return weekly;
    const fiveHour = nullableNumberSort(left.fiveHourRemainingPercent, right.fiveHourRemainingPercent);
    if (fiveHour !== 0) return fiveHour;
    if (left.stale !== right.stale) return left.stale ? 1 : -1;
    return left.login.localeCompare(right.login);
  });

  sendJson(request, response, 200, {
    schemaVersion: 1,
    generatedAt: new Date(nowMs).toISOString(),
    staleAfterSeconds: RATE_LIMIT_TEAM_STALE_SECONDS,
    users,
  });
}

function teamToolSnapshotFromReport(
  report: CodexRateLimitReport | null | undefined,
  nowMs: number
): TeamRateLimitToolSnapshot | null {
  if (!report?.available || !report.windows.length) {
    return null;
  }

  return {
    available: true,
    plan: report.plan,
    generatedAt: report.generatedAt,
    latestEventAt: report.latestEventAt,
    windows: report.windows.map((window) => teamWindowSnapshot(window, nowMs)),
  };
}

function teamWindowSnapshot(window: CodexRateWindow, nowMs: number): TeamRateLimitWindowSnapshot {
  const resetsInSeconds = secondsUntilIso(window.resetsAt, nowMs) ?? window.resetsInSeconds;
  const etaSeconds = secondsUntilIso(window.etaAt, nowMs) ?? window.etaSeconds;

  return {
    key: window.key,
    windowMinutes: window.windowMinutes,
    label: window.label,
    usedPercent: window.usedPercent,
    remainingPercent: window.remainingPercent,
    resetsAt: window.resetsAt,
    resetsInSeconds,
    observedAt: window.observedAt,
    staleSeconds: window.staleSeconds,
    burnPercentPerHour: window.burnPercentPerHour,
    burnTokensPerHour: window.burnTokensPerHour,
    etaSeconds,
    etaAt: window.etaAt,
    willExhaustBeforeReset: window.willExhaustBeforeReset,
  };
}

function buildTeamUserProfiles(uploadUsers: TokenBoardUploadUser[], events: TokenUsageEvent[]) {
  const profiles = new Map<string, TeamUserProfile>();

  for (const user of uploadUsers) {
    profiles.set(user.userId, {
      login: inferTeamLogin(user.userId, user.displayName),
      displayName: user.displayName,
      team: user.team,
      avatarUrl: teamAvatarUrl(inferTeamLogin(user.userId, user.displayName)),
    });
  }

  const latestEvents = new Map<string, TokenUsageEvent>();
  for (const event of events) {
    const current = latestEvents.get(event.userId);
    if (!current || Date.parse(event.timestamp) > Date.parse(current.timestamp)) {
      latestEvents.set(event.userId, event);
    }
  }

  for (const [userId, event] of latestEvents) {
    const current = profiles.get(userId);
    const login = current?.login || inferTeamLogin(userId, event.displayName);
    profiles.set(userId, {
      login,
      displayName: current?.displayName || event.displayName || login || userId,
      team: current?.team || event.team,
      avatarUrl: current?.avatarUrl || teamAvatarUrl(login),
    });
  }

  return profiles;
}

function teamFallbackProfile(userId: string): TeamUserProfile {
  const login = inferTeamLogin(userId, userId);
  return {
    login,
    displayName: login || userId,
    avatarUrl: teamAvatarUrl(login),
  };
}

function inferTeamLogin(userId: string, displayName: string) {
  const displayLogin = normalizePublicProfileLogin(displayName);

  if (displayLogin && !/^\d+$/.test(displayLogin)) {
    return displayLogin;
  }

  const withoutGithubPrefix = userId.replace(/^github:/i, "");
  const userIdLogin = normalizePublicProfileLogin(withoutGithubPrefix);

  if (userIdLogin && !/^\d+$/.test(userIdLogin)) {
    return userIdLogin;
  }

  return displayLogin || userIdLogin || userId;
}

function teamAvatarUrl(login: string) {
  return isSafeGithubLogin(login) && !/^\d+$/.test(login) ? `https://github.com/${login}.png` : undefined;
}

function minWindowRemaining(tools: Array<TeamRateLimitToolSnapshot | null>, key: CodexRateWindow["key"]) {
  const values = tools.flatMap((tool) => {
    const window = tool?.windows.find((item) => item.key === key);
    return typeof window?.remainingPercent === "number" ? [window.remainingPercent] : [];
  });

  return values.length ? Math.min(...values) : null;
}

function nullableNumberSort(left: number | null, right: number | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function secondsUntilIso(iso: string | null, nowMs: number) {
  if (!iso) {
    return null;
  }

  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? Math.round((ts - nowMs) / 1000) : null;
}

function sanitizeTeamIsoDate(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : "";
}

async function handleUsageExport(request: IncomingMessage, response: ServerResponse, url: URL) {
  const format = parseExportFormat(url.searchParams.get("format") || "csv");
  const scope = parseExportScope(url.searchParams.get("scope") || "leaderboard");

  if (!format) {
    sendJson(request, response, 400, { error: "format must be csv or json" });
    return;
  }

  if (!scope) {
    sendJson(request, response, 400, { error: "scope must be leaderboard or me" });
    return;
  }

  const range = parseRange(url.searchParams.get("range"));
  const metric = parseMetric(url.searchParams.get("metric"));
  const now = parseNow(url.searchParams.get("now"));
  const generatedAt = new Date().toISOString();

  if (scope === "leaderboard") {
    const { records, source, summary } = await readUsageLeaderboard({
      range,
      metric,
      now,
      preferSnapshot: !url.searchParams.has("now"),
    });
    const payload = {
      schemaVersion: 1,
      source,
      scope,
      range,
      metric,
      records,
      generatedAt,
      users: summary.users,
      summary,
    };

    response.setHeader("Content-Disposition", exportContentDisposition(scope, range, format));
    if (format === "json") {
      sendJson(request, response, 200, payload);
      return;
    }

    sendCsv(request, response, 200, leaderboardExportCsv(payload));
    return;
  }

  const identity = await readUsageRequestIdentity(request);

  if (!identity) {
    sendJson(request, response, 401, { error: "Login required" });
    return;
  }

  const payload = await buildUsageMePayload(identity, {
    range,
    now,
    preferSnapshot: !url.searchParams.has("now"),
  });
  const exportPayload = {
    ...payload,
    scope,
    range,
  };

  response.setHeader("Content-Disposition", exportContentDisposition(scope, range, format));
  if (format === "json") {
    sendJson(request, response, 200, exportPayload);
    return;
  }

  sendCsv(request, response, 200, accountExportCsv(exportPayload));
}

async function buildUsageMePayload(
  identity: TokenBoardIdentity,
  {
    range,
    now,
    preferSnapshot,
  }: {
    range: TokenBoardRange;
    now: Date;
    preferSnapshot: boolean;
  }
) {
  const store = usageStore();
  // Load only this user's events for the per-user breakdown, and derive the
  // cross-user ranking from the aggregated leaderboard, so neither path scans the
  // whole event table on every request.
  const userEvents = await store.listEventsForUser(identity.userId);
  const profile = buildTokenAccountUsageProfile(userEvents, {
    userId: identity.userId,
    range,
    now,
  });
  const { summary } = await readUsageLeaderboard({
    range,
    metric: "tokens",
    now,
    preferSnapshot,
  });
  const rankedUser = summary.users.find((entry) => entry.userId === identity.userId) ?? null;
  const totalUsers = summary.users.length;
  const rank = rankedUser?.rank ?? null;
  const previousRank = rankedUser?.previousRank ?? null;
  profile.rank = rank;
  profile.previousRank = previousRank;
  profile.rankDelta = rank !== null && previousRank !== null ? previousRank - rank : null;
  profile.totalUsers = totalUsers;
  profile.percentile = rank !== null && totalUsers > 0 ? (totalUsers - rank) / totalUsers : null;
  if (rankedUser) {
    profile.level = rankedUser.level;
    profile.badges = rankedUser.badges;
    profile.personalBests = rankedUser.personalBests;
    profile.efficiency = rankedUser.efficiency;
  }
  if (profile.user && rankedUser) {
    profile.user.rank = rankedUser.rank;
    profile.user.previousRank = previousRank;
    profile.user.rankDelta = profile.rankDelta;
    profile.user.share = rankedUser.share;
    profile.user.deltaTokens = rankedUser.deltaTokens;
    profile.user.efficiency = rankedUser.efficiency;
  }
  const userConfig = await store.getUserConfig(identity.userId);
  const goals = normalizeStoredTokenGoals(userConfig?.goals);

  return {
    schemaVersion: 1,
    source: "server",
    records: profile.records,
    totalRecords: await store.countEvents(),
    generatedAt: new Date().toISOString(),
    user: identity,
    profile: {
      ...profile,
      config: userConfig,
      goals: evaluateTokenGoals(goals, userEvents, { now }),
    },
  };
}

async function handleUsageGoals(request: IncomingMessage, response: ServerResponse, url: URL) {
  const identity = readWebIdentity(request);

  if (!identity) {
    sendJson(request, response, 401, { error: "GitHub login required" });
    return;
  }

  if (request.method !== "GET" && request.method !== "PUT") {
    sendJson(request, response, 405, { error: "Method not allowed" });
    return;
  }

  const store = usageStore();
  const now = parseNow(url.searchParams.get("now"));

  if (request.method === "GET") {
    const userConfig = await store.getUserConfig(identity.userId);
    const goals = normalizeStoredTokenGoals(userConfig?.goals);
    const userEvents = await store.listEventsForUser(identity.userId);

    sendJson(request, response, 200, {
      schemaVersion: 1,
      goals,
      evaluations: evaluateTokenGoals(goals, userEvents, { now }),
    });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(request, response, 400, { error: "Body must be valid JSON" });
    return;
  }

  const rawGoals = Array.isArray(body)
    ? body
    : body && typeof body === "object" && !Array.isArray(body)
      ? (body as { goals?: unknown }).goals
      : undefined;
  const validation = sanitizeTokenGoals(rawGoals, {
    now,
    createId: createTokenGoalId,
  });

  if (validation.errors.length) {
    sendJson(request, response, 400, {
      error: "Invalid goals",
      errors: validation.errors,
    });
    return;
  }

  const existingConfig = await store.getUserConfig(identity.userId);
  const updatedConfig: TokenBoardUserConfig = {
    ...(existingConfig ?? { updatedAt: now.toISOString() }),
    updatedAt: now.toISOString(),
    goals: validation.goals,
  };

  await store.upsertUserConfig(identity.userId, updatedConfig);
  const userEvents = await store.listEventsForUser(identity.userId);

  sendJson(request, response, 200, {
    schemaVersion: 1,
    goals: validation.goals,
    evaluations: evaluateTokenGoals(validation.goals, userEvents, { now }),
  });
}

type UsageMeExportPayload = Awaited<ReturnType<typeof buildUsageMePayload>> & {
  range: TokenBoardRange;
  scope: "me";
};
type CsvValue = string | number | boolean | null | undefined;
type CsvRow = Record<string, CsvValue>;

const LEADERBOARD_EXPORT_COLUMNS = [
  "generatedAt",
  "source",
  "range",
  "metric",
  "startAt",
  "endAt",
  "rank",
  "previousRank",
  "rankDelta",
  "userId",
  "displayName",
  "team",
  "level",
  "levelTotalTokens",
  "badges",
  "tokens",
  "inputTokens",
  "cacheCreationInputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "costUsd",
  "sessions",
  "messages",
  "records",
  "activeDays",
  "share",
  "deltaTokens",
  "topModel",
  "topTool",
  "lastReportedAt",
];

const ACCOUNT_EXPORT_COLUMNS = [
  "generatedAt",
  "source",
  "range",
  "startAt",
  "endAt",
  "userId",
  "githubLogin",
  "displayName",
  "team",
  "rank",
  "previousRank",
  "rankDelta",
  "totalUsers",
  "percentile",
  "level",
  "levelTotalTokens",
  "badges",
  "personalBestSingleDayDate",
  "personalBestSingleDayTokens",
  "personalBestRolling7DayStart",
  "personalBestRolling7DayEnd",
  "personalBestRolling7DayTokens",
  "longestStreakDays",
  "todayTokens",
  "brokeDailyPbToday",
  "tokens",
  "inputTokens",
  "cacheCreationInputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "costUsd",
  "sessions",
  "messages",
  "records",
  "activeDays",
  "share",
  "deltaTokens",
  "topModel",
  "topTool",
  "topProject",
  "topHour",
  "topWeekday",
  "lastReportedAt",
];

function leaderboardExportCsv(payload: {
  generatedAt: string;
  source: "live" | "snapshot";
  range: TokenBoardRange;
  metric: TokenBoardMetric;
  summary: TokenLeaderboardSummary;
}) {
  return stringifyCsv(
    LEADERBOARD_EXPORT_COLUMNS,
    payload.summary.users.map((user) => leaderboardExportRow(user, payload))
  );
}

function leaderboardExportRow(
  user: TokenLeaderboardUser,
  context: {
    generatedAt: string;
    source: "live" | "snapshot";
    range: TokenBoardRange;
    metric: TokenBoardMetric;
    summary: TokenLeaderboardSummary;
  }
): CsvRow {
  return {
    generatedAt: context.generatedAt,
    source: context.source,
    range: context.range,
    metric: context.metric,
    startAt: context.summary.startAt,
    endAt: context.summary.endAt,
    rank: user.rank,
    previousRank: user.previousRank,
    rankDelta: user.rankDelta,
    userId: user.userId,
    displayName: user.displayName,
    team: user.team,
    level: user.level.current.name,
    levelTotalTokens: user.level.totalTokens,
    badges: achievedBadgeNames(user.badges),
    tokens: user.tokens,
    inputTokens: user.inputTokens,
    cacheCreationInputTokens: user.cacheCreationInputTokens,
    cachedInputTokens: user.cachedInputTokens,
    outputTokens: user.outputTokens,
    reasoningOutputTokens: user.reasoningOutputTokens,
    costUsd: user.costUsd,
    sessions: user.sessions,
    messages: user.messages,
    records: user.records,
    activeDays: user.activeDays,
    share: user.share,
    deltaTokens: user.deltaTokens,
    topModel: user.topModel,
    topTool: user.topTool,
    lastReportedAt: user.lastReportedAt,
  };
}

function accountExportCsv(payload: UsageMeExportPayload) {
  const profile: TokenAccountUsageProfile = payload.profile;
  const user = profile.user;
  const bests = profile.personalBests;

  return stringifyCsv(ACCOUNT_EXPORT_COLUMNS, [
    {
      generatedAt: payload.generatedAt,
      source: payload.source,
      range: payload.range,
      startAt: profile.startAt,
      endAt: profile.endAt,
      userId: payload.user.userId,
      githubLogin: payload.user.githubLogin,
      displayName: user?.displayName ?? payload.user.displayName,
      team: user?.team ?? payload.user.team,
      rank: profile.rank,
      previousRank: profile.previousRank,
      rankDelta: profile.rankDelta,
      totalUsers: profile.totalUsers,
      percentile: profile.percentile,
      level: profile.level.current.name,
      levelTotalTokens: profile.level.totalTokens,
      badges: achievedBadgeNames(profile.badges),
      personalBestSingleDayDate: bests.singleDay.date,
      personalBestSingleDayTokens: bests.singleDay.tokens,
      personalBestRolling7DayStart: bests.rolling7Day.startDate,
      personalBestRolling7DayEnd: bests.rolling7Day.endDate,
      personalBestRolling7DayTokens: bests.rolling7Day.tokens,
      longestStreakDays: bests.longestStreak.days,
      todayTokens: bests.todayTokens,
      brokeDailyPbToday: bests.brokeDailyPbToday,
      tokens: user?.tokens ?? 0,
      inputTokens: user?.inputTokens ?? 0,
      cacheCreationInputTokens: user?.cacheCreationInputTokens ?? 0,
      cachedInputTokens: user?.cachedInputTokens ?? 0,
      outputTokens: user?.outputTokens ?? 0,
      reasoningOutputTokens: user?.reasoningOutputTokens ?? 0,
      costUsd: user?.costUsd ?? 0,
      sessions: user?.sessions ?? 0,
      messages: user?.messages ?? 0,
      records: profile.records,
      activeDays: user?.activeDays ?? 0,
      share: user?.share ?? null,
      deltaTokens: user?.deltaTokens ?? null,
      topModel: user?.topModel ?? "",
      topTool: user?.topTool ?? "",
      topProject: profile.projects[0]?.name ?? "",
      topHour: profile.topHour,
      topWeekday: profile.topWeekday,
      lastReportedAt: user?.lastReportedAt ?? "",
    },
  ]);
}

function achievedBadgeNames(badges: TokenLeaderboardUser["badges"]) {
  return badges
    .filter((badge) => badge.achieved)
    .map((badge) => badge.name)
    .join("|");
}

function createTokenGoalId() {
  return `goal_${randomBytes(8).toString("hex")}`;
}

function stringifyCsv(columns: string[], rows: CsvRow[]) {
  const lines = [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ];

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function csvEscape(value: CsvValue) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function handlePublicUsageUser(request: IncomingMessage, response: ServerResponse, url: URL) {
  const login = normalizePublicProfileLogin(url.searchParams.get("login"));

  if (!login) {
    sendJson(request, response, 400, { error: "Invalid github login" });
    return;
  }

  const now = parseNow(url.searchParams.get("now"));
  const store = usageStore();
  const [events, uploadUsers] = await Promise.all([store.listEvents(), loadUploadUsers()]);
  const match = findPublicProfileUserEvents(events, uploadUsers, login);

  if (!match) {
    sendJson(request, response, 404, { error: "User not found" });
    return;
  }

  const summary = buildPublicProfileSummary(match.events);
  const rankings = PUBLIC_PROFILE_RANGES.map((range) => {
    const rangeSummary = buildTokenLeaderboard(events, { range, metric: "tokens", now });
    const rankedUser = rangeSummary.users.find((user) => user.userId === match.userId) ?? null;

    return {
      range,
      rank: rankedUser?.rank ?? null,
      totalUsers: rangeSummary.users.length,
      tokens: rankedUser?.tokens ?? 0,
      share: rankedUser?.share ?? 0,
    };
  });

  sendJson(request, response, 200, {
    schemaVersion: 1,
    source: "server",
    records: match.events.length,
    totalRecords: events.length,
    generatedAt: new Date().toISOString(),
    user: {
      userId: match.userId,
      login: match.login,
      githubLogin: match.login,
      displayName: summary.displayName,
      team: summary.team,
      avatarUrl: `https://github.com/${match.login}.png`,
    },
    profile: {
      joinedAt: summary.joinedAt,
      lastReportedAt: summary.lastReportedAt,
      totals: summary.totals,
      daily365: buildShanghaiDailySeries(match.events, now, PUBLIC_PROFILE_DAILY_DAYS),
      models: buildPublicNamedUsage(match.events, "model", PUBLIC_PROFILE_TOP_LIMIT),
      tools: buildPublicNamedUsage(match.events, "tool", PUBLIC_PROFILE_TOP_LIMIT),
      rankings,
    },
  });
}

async function handleBadge(request: IncomingMessage, response: ServerResponse, url: URL) {
  const login = normalizePublicProfileLogin(url.searchParams.get("login"));
  const style = parseBadgeStyle(url.searchParams.get("style"));

  if (!login) {
    sendSvg(request, response, 200, buildBadgeSvg("Open Token Board", "unknown", "unknown"));
    return;
  }

  const store = usageStore();
  const [events, uploadUsers] = await Promise.all([store.listEvents(), loadUploadUsers()]);
  const match = findPublicProfileUserEvents(events, uploadUsers, login);

  if (!match) {
    sendSvg(request, response, 200, buildBadgeSvg("Open Token Board", "unknown", "unknown"));
    return;
  }

  const now = parseNow(url.searchParams.get("now"));
  const label = "Open Token Board";
  const value =
    style === "weekly"
      ? weeklyBadgeValue(events, match.userId, now)
      : flatBadgeValue(match.events, now);

  sendSvg(request, response, 200, buildBadgeSvg(label, value, style));
}

function parseBadgeStyle(value: string | null): "flat" | "weekly" {
  return value === "weekly" ? "weekly" : "flat";
}

function flatBadgeValue(events: TokenUsageEvent[], now: Date) {
  const achievement = buildTokenAchievementSummary(events, { now });

  return `${achievement.level.current.name} · ${formatBadgeNumber(achievement.level.totalTokens)} tokens`;
}

function weeklyBadgeValue(events: TokenUsageEvent[], userId: string, now: Date) {
  const summary = buildTokenLeaderboard(events, { range: "week", metric: "tokens", now });
  const user = summary.users.find((entry) => entry.userId === userId);

  if (!user) {
    return "0 tokens · rank --";
  }

  return `${formatBadgeNumber(user.tokens)} this week · #${user.rank}`;
}

function formatBadgeNumber(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;

  if (safe >= 1_000_000_000) {
    return `${formatBadgeCompact(safe / 1_000_000_000)}B`;
  }

  if (safe >= 1_000_000) {
    return `${formatBadgeCompact(safe / 1_000_000)}M`;
  }

  if (safe >= 1_000) {
    return `${formatBadgeCompact(safe / 1_000)}K`;
  }

  return String(Math.round(safe));
}

function formatBadgeCompact(value: number) {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}

function buildBadgeSvg(label: string, value: string, tone: "flat" | "weekly" | "unknown") {
  const labelWidth = badgeTextWidth(label) + 18;
  const valueWidth = badgeTextWidth(value) + 18;
  const width = labelWidth + valueWidth;
  const valueColor = tone === "unknown" ? "#6b7280" : tone === "weekly" ? "#2563eb" : "#475569";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escapeXml(`${label}: ${value}`)}">`,
    `<title>${escapeXml(`${label}: ${value}`)}</title>`,
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".12"/><stop offset="1" stop-opacity=".12"/></linearGradient>`,
    `<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${labelWidth}" height="20" fill="#334155"/>`,
    `<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${valueColor}"/>`,
    `<rect width="${width}" height="20" fill="url(#s)"/>`,
    `</g>`,
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">`,
    `<text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".25">${escapeXml(label)}</text>`,
    `<text x="${labelWidth / 2}" y="14">${escapeXml(label)}</text>`,
    `<text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".25">${escapeXml(value)}</text>`,
    `<text x="${labelWidth + valueWidth / 2}" y="14">${escapeXml(value)}</text>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

function badgeTextWidth(value: string) {
  return Math.ceil([...value].reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 12 : 7), 0));
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function handleUsageWrapped(request: IncomingMessage, response: ServerResponse, url: URL) {
  const login = normalizePublicProfileLogin(url.searchParams.get("login"));

  if (!login) {
    sendJson(request, response, 400, { error: "Invalid github login" });
    return;
  }

  const period = parseWrappedPeriod(url.searchParams.get("period"), parseNow(url.searchParams.get("now")));

  if (!period) {
    sendJson(request, response, 400, { error: "Invalid period. Use YYYY-MM or YYYY." });
    return;
  }

  const store = usageStore();
  const [events, uploadUsers] = await Promise.all([store.listEvents(), loadUploadUsers()]);
  const match = findPublicProfileUserEvents(events, uploadUsers, login);

  if (!match) {
    sendJson(request, response, 404, { error: "User not found" });
    return;
  }

  const summary = buildPublicProfileSummary(match.events);
  const periodEvents = match.events.filter((event) => wrappedEventInPeriod(event, period));
  const allPeriodEvents = events.filter((event) => wrappedEventInPeriod(event, period));
  const daily = buildWrappedDailySeries(periodEvents, period);
  const targetTeam = latestWrappedTeam(periodEvents, summary.team);
  const achievements = buildWrappedAchievements(match.events, period);
  const payload: TokenWrappedResponse = {
    schemaVersion: 1,
    source: "server",
    records: periodEvents.length,
    totalRecords: events.length,
    generatedAt: new Date().toISOString(),
    user: {
      userId: match.userId,
      login: match.login,
      githubLogin: match.login,
      displayName: summary.displayName,
      team: targetTeam,
      avatarUrl: `https://github.com/${match.login}.png`,
    },
    period: {
      type: period.type,
      value: period.value,
      label: period.label,
      startAt: period.startAt.toISOString(),
      endAt: period.dataEndAt.toISOString(),
      timezone: "Asia/Shanghai",
      days: daily.length,
    },
    totals: buildWrappedTotals(periodEvents),
    streak: buildWrappedStreak(daily),
    topModels: buildWrappedModelUsage(periodEvents, 3),
    topProjects: buildWrappedProjectUsage(periodEvents, 3),
    peakDay: buildWrappedPeakDay(daily),
    night: buildWrappedNightShare(periodEvents),
    achievements,
    daily,
    ranking: buildWrappedTeamRanking(allPeriodEvents, match.userId, targetTeam),
  };

  sendJson(request, response, 200, payload);
}

type PublicProfileUserMatch = {
  events: TokenUsageEvent[];
  login: string;
  userId: string;
};

type WrappedPeriod = {
  type: "month" | "year";
  value: string;
  label: string;
  startAt: Date;
  endAt: Date;
  dataEndAt: Date;
};

const WRAPPED_SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const WRAPPED_DAY_MS = 24 * 60 * 60 * 1000;

function parseWrappedPeriod(value: string | null, now: Date): WrappedPeriod | null {
  const text = normalizeOptionalText(value);
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();

  if (!text) {
    const parts = wrappedShanghaiDateParts(safeNow);
    return createWrappedPeriod(parts.year, parts.month, safeNow);
  }

  const monthMatch = /^(\d{4})-(\d{2})$/.exec(text);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);

    return createWrappedPeriod(year, month, safeNow);
  }

  const yearMatch = /^(\d{4})$/.exec(text);
  if (yearMatch) {
    return createWrappedPeriod(Number(yearMatch[1]), null, safeNow);
  }

  return null;
}

function createWrappedPeriod(year: number, month: number | null, now: Date): WrappedPeriod | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return null;
  }

  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return null;
  }

  const startAt = wrappedLocalStartUtc(year, month ?? 1, 1);
  const endAt =
    month === null
      ? wrappedLocalStartUtc(year + 1, 1, 1)
      : month === 12
        ? wrappedLocalStartUtc(year + 1, 1, 1)
        : wrappedLocalStartUtc(year, month + 1, 1);
  const dataEndAt =
    now.getTime() >= startAt.getTime() && now.getTime() < endAt.getTime() ? now : endAt;
  const value = month === null ? String(year) : `${year}-${pad2(month)}`;

  return {
    type: month === null ? "year" : "month",
    value,
    label: month === null ? `${year} 年` : `${year} 年 ${month} 月`,
    startAt,
    endAt,
    dataEndAt,
  };
}

function wrappedEventInPeriod(event: TokenUsageEvent, period: WrappedPeriod) {
  const timestamp = new Date(event.timestamp).getTime();
  return (
    Number.isFinite(timestamp) &&
    timestamp >= period.startAt.getTime() &&
    timestamp < period.dataEndAt.getTime()
  );
}

function buildWrappedTotals(events: TokenUsageEvent[]): TokenWrappedResponse["totals"] {
  const sessions = new Set<string>();
  const activeDays = new Set<string>();
  let tokens = 0;
  let costUsd = 0;
  let messages = 0;

  for (const event of events) {
    tokens += getTokenConsumptionTokens(event);
    costUsd += event.costUsd ?? 0;
    messages += event.messages ?? 0;
    sessions.add(event.sessionId || event.id);
    activeDays.add(wrappedDayKey(event.timestamp));
  }

  return {
    tokens,
    costUsd,
    sessions: sessions.size,
    messages,
    records: events.length,
    activeDays: activeDays.size,
  };
}

function buildWrappedModelUsage(events: TokenUsageEvent[], limit: number): TokenWrappedNamedUsage[] {
  const totalTokens = events.reduce((sum, event) => sum + getTokenConsumptionTokens(event), 0);
  const usage = new Map<string, { tokens: number; costUsd: number; sessions: Set<string> }>();

  for (const event of events) {
    const tokens = getTokenConsumptionTokens(event);
    const current = usage.get(event.model) ?? { tokens: 0, costUsd: 0, sessions: new Set<string>() };
    current.tokens += tokens;
    current.costUsd += event.costUsd ?? 0;
    current.sessions.add(event.sessionId || event.id);
    usage.set(event.model, current);
  }

  return [...usage.entries()]
    .map(([name, value]) => ({
      name,
      tokens: value.tokens,
      costUsd: value.costUsd,
      sessions: value.sessions.size,
      share: totalTokens > 0 ? value.tokens / totalTokens : 0,
    }))
    .sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function buildWrappedProjectUsage(events: TokenUsageEvent[], limit: number): TokenWrappedProjectUsage[] {
  const totalTokens = events.reduce((sum, event) => sum + getTokenConsumptionTokens(event), 0);
  const usage = new Map<
    string,
    {
      tokens: number;
      costUsd: number;
      sessions: Set<string>;
      activeDays: Set<string>;
    }
  >();

  for (const event of events) {
    const tokens = getTokenConsumptionTokens(event);
    const name = event.project || "未标记项目";
    const current =
      usage.get(name) ?? { tokens: 0, costUsd: 0, sessions: new Set<string>(), activeDays: new Set<string>() };
    current.tokens += tokens;
    current.costUsd += event.costUsd ?? 0;
    current.sessions.add(event.sessionId || event.id);
    current.activeDays.add(wrappedDayKey(event.timestamp));
    usage.set(name, current);
  }

  return [...usage.entries()]
    .map(([name, value]) => ({
      name,
      tokens: value.tokens,
      costUsd: value.costUsd,
      sessions: value.sessions.size,
      activeDays: value.activeDays.size,
      share: totalTokens > 0 ? value.tokens / totalTokens : 0,
    }))
    .sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function buildWrappedDailySeries(events: TokenUsageEvent[], period: WrappedPeriod): TokenDailyUsagePoint[] {
  const seriesEndAt = period.dataEndAt.getTime() > period.startAt.getTime() ? period.dataEndAt : period.endAt;
  const points = new Map<string, TokenDailyUsagePoint>();

  for (let time = period.startAt.getTime(); time < seriesEndAt.getTime(); time += WRAPPED_DAY_MS) {
    const bucketStart = new Date(time);
    const bucketEnd = new Date(Math.min(time + WRAPPED_DAY_MS, seriesEndAt.getTime()));
    const date = wrappedDayKey(bucketStart);
    points.set(date, {
      date,
      startAt: bucketStart.toISOString(),
      endAt: bucketEnd.toISOString(),
      tokens: 0,
    });
  }

  for (const event of events) {
    const point = points.get(wrappedDayKey(event.timestamp));

    if (point) {
      point.tokens += getTokenConsumptionTokens(event);
    }
  }

  return [...points.values()];
}

function buildWrappedPeakDay(daily: TokenDailyUsagePoint[]): TokenWrappedResponse["peakDay"] {
  const peak = daily.reduce<TokenDailyUsagePoint | null>(
    (best, point) => (!best || point.tokens > best.tokens ? point : best),
    null
  );

  return peak && peak.tokens > 0 ? { date: peak.date, tokens: peak.tokens } : { date: null, tokens: 0 };
}

function buildWrappedStreak(daily: TokenDailyUsagePoint[]): TokenWrappedResponse["streak"] {
  const activeDays = daily.filter((point) => point.tokens > 0).map((point) => point.date);

  if (!activeDays.length) {
    return { days: 0, startDate: null, endDate: null };
  }

  let bestStart = activeDays[0];
  let bestEnd = activeDays[0];
  let currentStart = activeDays[0];
  let currentEnd = activeDays[0];

  for (const day of activeDays.slice(1)) {
    if (wrappedDayToTime(day) - wrappedDayToTime(currentEnd) === WRAPPED_DAY_MS) {
      currentEnd = day;
    } else {
      if (wrappedStreakLength(currentStart, currentEnd) > wrappedStreakLength(bestStart, bestEnd)) {
        bestStart = currentStart;
        bestEnd = currentEnd;
      }
      currentStart = day;
      currentEnd = day;
    }
  }

  if (wrappedStreakLength(currentStart, currentEnd) > wrappedStreakLength(bestStart, bestEnd)) {
    bestStart = currentStart;
    bestEnd = currentEnd;
  }

  return {
    days: wrappedStreakLength(bestStart, bestEnd),
    startDate: bestStart,
    endDate: bestEnd,
  };
}

function buildWrappedNightShare(events: TokenUsageEvent[]): TokenWrappedResponse["night"] {
  let tokens = 0;
  let nightTokens = 0;

  for (const event of events) {
    const eventTokens = getTokenConsumptionTokens(event);
    tokens += eventTokens;

    if (wrappedShanghaiDateParts(event.timestamp).hour < 6) {
      nightTokens += eventTokens;
    }
  }

  return {
    tokens: nightTokens,
    ratio: tokens > 0 ? nightTokens / tokens : 0,
  };
}

function buildWrappedAchievements(
  events: TokenUsageEvent[],
  period: WrappedPeriod
): TokenWrappedResponse["achievements"] {
  const sortedEvents = [...events].sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  );
  const beforeEvents = sortedEvents.filter((event) => new Date(event.timestamp).getTime() < period.startAt.getTime());
  const throughPeriodEvents = sortedEvents.filter((event) => new Date(event.timestamp).getTime() < period.dataEndAt.getTime());
  const beforeTotalTokens = beforeEvents.reduce((sum, event) => sum + getTokenConsumptionTokens(event), 0);
  const throughTotalTokens = throughPeriodEvents.reduce((sum, event) => sum + getTokenConsumptionTokens(event), 0);
  const beforeLevel = buildTokenLevelProgress(beforeTotalTokens).current;
  const afterSummary = buildTokenAchievementSummary(throughPeriodEvents, { now: period.dataEndAt });
  const newBadges = afterSummary.badges.filter(
    (badge) => badge.achieved && wrappedAchievementAtInPeriod(badge.achievedAt, period)
  );
  const levelUps: TokenWrappedLevelUp[] = TOKEN_LEVELS.filter(
    (level) => level.thresholdTokens > beforeTotalTokens && level.thresholdTokens <= throughTotalTokens
  ).map((level) => ({
    id: level.id,
    name: level.name,
    symbol: level.symbol,
    color: level.color,
    thresholdTokens: level.thresholdTokens,
    reachedAt: firstWrappedCumulativeReachedAt(sortedEvents, level.thresholdTokens) ?? period.startAt.toISOString(),
  }));

  return {
    newBadges,
    levelUps,
    levelBefore: beforeLevel,
    levelAfter: afterSummary.level.current,
  };
}

function buildWrappedTeamRanking(
  events: TokenUsageEvent[],
  targetUserId: string,
  targetTeam: string
): TokenWrappedResponse["ranking"] {
  const users = new Map<
    string,
    {
      userId: string;
      displayName: string;
      team: string;
      tokens: number;
      latestAt: string;
    }
  >();

  for (const event of events) {
    const current =
      users.get(event.userId) ??
      {
        userId: event.userId,
        displayName: event.displayName || event.userId,
        team: event.team || "Friends",
        tokens: 0,
        latestAt: event.timestamp,
      };
    const timestamp = new Date(event.timestamp).getTime();
    const latestTimestamp = new Date(current.latestAt).getTime();

    current.tokens += getTokenConsumptionTokens(event);

    if (Number.isFinite(timestamp) && (!Number.isFinite(latestTimestamp) || timestamp >= latestTimestamp)) {
      current.displayName = event.displayName || current.displayName;
      current.team = event.team || current.team;
      current.latestAt = event.timestamp;
    }

    users.set(event.userId, current);
  }

  const teamUsers = [...users.values()]
    .filter((user) => user.team === targetTeam && user.tokens > 0)
    .sort((left, right) => right.tokens - left.tokens || left.displayName.localeCompare(right.displayName))
    .map((user, index) => ({ ...user, rank: index + 1 }));
  const rankedUser = teamUsers.find((user) => user.userId === targetUserId) ?? null;
  const totalTokens = teamUsers.reduce((sum, user) => sum + user.tokens, 0);

  return {
    team: targetTeam,
    rank: rankedUser?.rank ?? null,
    totalUsers: teamUsers.length,
    tokens: rankedUser?.tokens ?? 0,
    share: rankedUser && totalTokens > 0 ? rankedUser.tokens / totalTokens : 0,
    percentile: rankedUser && teamUsers.length > 0 ? (teamUsers.length - rankedUser.rank) / teamUsers.length : null,
  };
}

function latestWrappedTeam(events: TokenUsageEvent[], fallbackTeam: string) {
  const latest = latestPublicProfileEvent(events);
  return latest?.team || fallbackTeam || "Friends";
}

function wrappedAchievementAtInPeriod(value: string | null, period: WrappedPeriod) {
  if (!value) {
    return false;
  }

  const time = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? wrappedLocalDayStartUtc(value).getTime()
    : new Date(value).getTime();

  return (
    Number.isFinite(time) &&
    time >= period.startAt.getTime() &&
    time < period.dataEndAt.getTime()
  );
}

function firstWrappedCumulativeReachedAt(events: TokenUsageEvent[], threshold: number) {
  let total = 0;

  for (const event of events) {
    total += getTokenConsumptionTokens(event);

    if (total >= threshold) {
      return event.timestamp;
    }
  }

  return null;
}

function wrappedShanghaiDateParts(value: string | Date) {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const shifted = new Date((Number.isFinite(time) ? time : Date.now()) + WRAPPED_SHANGHAI_OFFSET_MS);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
  };
}

function wrappedDayKey(value: string | Date) {
  const parts = wrappedShanghaiDateParts(value);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function wrappedLocalStartUtc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day) - WRAPPED_SHANGHAI_OFFSET_MS);
}

function wrappedLocalDayStartUtc(dayKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);

  if (!match) {
    return new Date(0);
  }

  return wrappedLocalStartUtc(Number(match[1]), Number(match[2]), Number(match[3]));
}

function wrappedDayToTime(day: string) {
  return new Date(`${day}T00:00:00.000Z`).getTime();
}

function wrappedStreakLength(startDate: string, endDate: string) {
  return Math.floor((wrappedDayToTime(endDate) - wrappedDayToTime(startDate)) / WRAPPED_DAY_MS) + 1;
}

function findPublicProfileUserEvents(
  events: TokenUsageEvent[],
  uploadUsers: TokenBoardUploadUser[],
  login: string
): PublicProfileUserMatch | null {
  const configuredUserIds = new Set(
    uploadUsers
      .filter((user) => publicProfileTextMatches(user.userId, login) || publicProfileTextMatches(user.displayName, login))
      .map((user) => user.userId)
  );
  const groups = new Map<string, TokenUsageEvent[]>();

  for (const event of events) {
    const matches =
      configuredUserIds.has(event.userId) ||
      publicProfileTextMatches(event.userId, login) ||
      publicProfileTextMatches(event.displayName, login);

    if (!matches) {
      continue;
    }

    const group = groups.get(event.userId) ?? [];
    group.push(event);
    groups.set(event.userId, group);
  }

  if (!groups.size) {
    return null;
  }

  const bestMatch = [...groups.entries()]
    .map(([groupUserId, groupEvents]) => {
      const latestEvent = latestPublicProfileEvent(groupEvents);
      const userIdMatch = publicProfileTextMatches(groupUserId, login);
      const configuredMatch = configuredUserIds.has(groupUserId);
      const displayNameMatch = latestEvent ? publicProfileTextMatches(latestEvent.displayName, login) : false;
      const latestTime = latestEvent ? new Date(latestEvent.timestamp).getTime() : 0;
      const tokens = groupEvents.reduce((sum, event) => sum + getTokenConsumptionTokens(event), 0);

      return {
        userId: groupUserId,
        events: groupEvents,
        score: (userIdMatch ? 1000 : 0) + (configuredMatch ? 500 : 0) + (displayNameMatch ? 100 : 0),
        latestTime: Number.isFinite(latestTime) ? latestTime : 0,
        tokens,
      };
    })
    .sort((left, right) => right.score - left.score || right.latestTime - left.latestTime || right.tokens - left.tokens)[0];

  return { userId: bestMatch.userId, events: bestMatch.events, login };
}

function normalizePublicProfileLogin(value: string | null | undefined) {
  const text = normalizePublicProfileText(value, 180).toLowerCase();

  if (!text) {
    return "";
  }

  const withoutGithubUrl = text.replace(/^https?:\/\/(?:www\.)?github\.com\//, "").split(/[/?#]/)[0] || text;
  const candidate = withoutGithubUrl
    .replace(/^@+/, "")
    .replace(/^github:/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39);

  return isSafeGithubLogin(candidate) ? candidate : "";
}

function publicProfileTextMatches(value: string | undefined, login: string) {
  return publicProfileTextVariants(value).includes(login);
}

function publicProfileTextVariants(value: string | undefined) {
  const text = normalizePublicProfileText(value, 180);
  const withoutGithubPrefix = text.replace(/^github:/i, "");
  return uniquePublicProfileValues([
    normalizePublicProfileLogin(text),
    normalizePublicProfileLogin(withoutGithubPrefix),
  ]);
}

function uniquePublicProfileValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function isSafeGithubLogin(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(value);
}

function normalizePublicProfileText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function buildPublicProfileSummary(events: TokenUsageEvent[]) {
  const latestEvent = latestPublicProfileEvent(events);
  const sortedByTime = [...events].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  const sessions = new Set<string>();
  const activeDays = new Set<string>();
  let tokens = 0;
  let inputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let reasoningOutputTokens = 0;
  let costUsd = 0;
  let messages = 0;

  for (const event of events) {
    tokens += getTokenConsumptionTokens(event);
    inputTokens += event.inputTokens;
    cacheCreationInputTokens += event.cacheCreationInputTokens;
    cachedInputTokens += event.cachedInputTokens;
    outputTokens += event.outputTokens;
    reasoningOutputTokens += event.reasoningOutputTokens;
    costUsd += event.costUsd ?? 0;
    messages += event.messages ?? 0;
    sessions.add(event.sessionId || event.id);
    activeDays.add(publicProfileShanghaiDayKey(event.timestamp));
  }

  return {
    displayName: latestEvent?.displayName || sortedByTime[0]?.displayName || "Unknown",
    team: latestEvent?.team || sortedByTime[0]?.team || "Friends",
    joinedAt: sortedByTime[0]?.timestamp ?? null,
    lastReportedAt: latestEvent?.timestamp ?? null,
    totals: {
      tokens,
      inputTokens,
      cacheCreationInputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
      costUsd,
      sessions: sessions.size,
      messages,
      records: events.length,
      activeDays: activeDays.size,
    },
  };
}

function buildPublicNamedUsage(events: TokenUsageEvent[], key: "model" | "tool", limit: number) {
  const totalTokens = events.reduce((sum, event) => sum + getTokenConsumptionTokens(event), 0);
  const usage = new Map<string, { tokens: number; costUsd: number; sessions: Set<string> }>();

  for (const event of events) {
    const name = key === "model" ? event.model : event.tool || event.source;
    const item = usage.get(name) ?? { tokens: 0, costUsd: 0, sessions: new Set<string>() };
    item.tokens += getTokenConsumptionTokens(event);
    item.costUsd += event.costUsd ?? 0;
    item.sessions.add(event.sessionId || event.id);
    usage.set(name, item);
  }

  return [...usage.entries()]
    .map(([name, value]) => ({
      name,
      tokens: value.tokens,
      costUsd: value.costUsd,
      sessions: value.sessions.size,
      share: totalTokens > 0 ? value.tokens / totalTokens : 0,
    }))
    .sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function buildShanghaiDailySeries(events: TokenUsageEvent[], now: Date, days: number): TokenDailyUsagePoint[] {
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
  const endDay = publicProfileShanghaiDayKey(safeNow);
  const endDayStart = publicProfileShanghaiDayStartUtc(endDay);
  const startDayStart = addPublicProfileUtcDays(endDayStart, -(days - 1));
  const values = new Map<string, TokenDailyUsagePoint>();

  for (let index = 0; index < days; index += 1) {
    const bucketStart = addPublicProfileUtcDays(startDayStart, index);
    const bucketEnd = addPublicProfileUtcDays(bucketStart, 1);
    const date = publicProfileShanghaiDayKey(bucketStart);

    values.set(date, {
      date,
      startAt: bucketStart.toISOString(),
      endAt: new Date(Math.min(bucketEnd.getTime(), safeNow.getTime())).toISOString(),
      tokens: 0,
    });
  }

  for (const event of events) {
    const timestamp = new Date(event.timestamp).getTime();

    if (!Number.isFinite(timestamp) || timestamp < startDayStart.getTime() || timestamp > safeNow.getTime()) {
      continue;
    }

    const point = values.get(publicProfileShanghaiDayKey(event.timestamp));

    if (point) {
      point.tokens += getTokenConsumptionTokens(event);
    }
  }

  return [...values.values()];
}

const PUBLIC_PROFILE_SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const PUBLIC_PROFILE_DAY_MS = 24 * 60 * 60 * 1000;

function publicProfileShanghaiDayKey(value: string | Date) {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const shifted = new Date((Number.isFinite(time) ? time : Date.now()) + PUBLIC_PROFILE_SHANGHAI_OFFSET_MS);

  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function publicProfileShanghaiDayStartUtc(dayKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);

  if (!match) {
    return new Date(0);
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - PUBLIC_PROFILE_SHANGHAI_OFFSET_MS);
}

function addPublicProfileUtcDays(value: Date, days: number) {
  return new Date(value.getTime() + days * PUBLIC_PROFILE_DAY_MS);
}

function latestPublicProfileEvent(events: TokenUsageEvent[]) {
  return events.reduce<TokenUsageEvent | null>((latest, event) => {
    if (!latest) {
      return event;
    }

    return new Date(event.timestamp).getTime() > new Date(latest.timestamp).getTime() ? event : latest;
  }, null);
}

async function handleSelectionExplain(request: IncomingMessage, response: ServerResponse) {
  const identity = readWebIdentity(request);

  if (!identity) {
    sendJson(request, response, 401, {
      error: "请先用作者 GitHub 账号登录后再使用 AI 解释。",
    });
    return;
  }

  if (!isGithubIdentityAllowed(identity, selectionExplainAllowedGithubLogins())) {
    sendJson(request, response, 403, {
      error: "当前 GitHub 账号不在选词 AI 解释白名单中。",
    });
    return;
  }

  let body: unknown;

  try {
    body = await readJsonBody(request, MAX_SELECTION_EXPLAIN_BODY_BYTES);
  } catch (error) {
    sendJson(request, response, 400, {
      error: error instanceof Error ? error.message : "请求体不正确。",
    });
    return;
  }

  const parsed = parseSelectionExplainPayload(body);

  if (!parsed.ok) {
    sendJson(request, response, 400, {
      error: parsed.error,
    });
    return;
  }

  try {
    const explanation = await explainSelectionWithKimi(parsed.data);

    sendJson(request, response, 200, {
      explanation,
    });
  } catch (error) {
    if (error instanceof SelectionExplainServiceError) {
      sendJson(request, response, error.status, {
        code: error.code,
        error: error.message,
      });
      return;
    }

    sendJson(request, response, 500, {
      error: "AI 解释暂时不可用，请稍后再试。",
    });
  }
}

async function handleArticleChat(request: IncomingMessage, response: ServerResponse) {
  const identity = readWebIdentity(request);

  if (!identity) {
    sendJson(request, response, 401, {
      error: "请先用作者 GitHub 账号登录后再使用文章 AI 问答。",
    });
    return;
  }

  if (!isGithubIdentityAllowed(identity, selectionExplainAllowedGithubLogins())) {
    sendJson(request, response, 403, {
      error: "当前 GitHub 账号不在文章 AI 问答白名单中。",
    });
    return;
  }

  let body: unknown;

  try {
    body = await readJsonBody(request, MAX_ARTICLE_CHAT_BODY_BYTES);
  } catch (error) {
    sendJson(request, response, 400, {
      error: error instanceof Error ? error.message : "请求体不正确。",
    });
    return;
  }

  const parsed = parseArticleChatPayload(body);

  if (!parsed.ok) {
    sendJson(request, response, 400, {
      error: parsed.error,
    });
    return;
  }

  try {
    const chat = await chatArticleWithKimi(parsed.data);

    sendJson(request, response, 200, chat);
  } catch (error) {
    if (error instanceof SelectionExplainServiceError) {
      sendJson(request, response, error.status, {
        code: error.code,
        error: error.message,
      });
      return;
    }

    sendJson(request, response, 500, {
      error: "文章 AI 问答暂时不可用，请稍后再试。",
    });
  }
}

async function handleIngest(request: IncomingMessage, response: ServerResponse) {
  const identity = await authenticateIngestRequest(request);

  if (!identity) {
    sendJson(request, response, 401, { error: "Login required" });
    return;
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    sendJson(request, response, 400, { error: "Body must be a JSON object" });
    return;
  }
  const userConfig = extractUserConfigFromIngestBody(body);
  const rawEvents = Array.isArray((body as { events?: unknown }).events)
    ? ((body as { events: Parameters<typeof sanitizeIngestEvents>[0] }).events)
    : [];

  if (!rawEvents.length && !userConfig) {
    sendJson(request, response, 400, { error: "Body must include events[] or userConfig" });
    return;
  }

  const rawValidationErrors = rawEvents.length ? validateRawIngestEvents(rawEvents) : [];
  if (rawValidationErrors.length) {
    sendJson(request, response, 400, {
      error: "Token usage batch rejected",
      errors: rawValidationErrors,
    });
    return;
  }

  const sanitized = rawEvents.length
    ? sanitizeIngestEvents(rawEvents, identity, ingestPrivacyOptions())
    : { entries: [], errors: [] };

  if (sanitized.errors.length) {
    sendJson(request, response, 400, {
      error: "Token usage batch rejected",
      errors: sanitized.errors,
    });
    return;
  }

  const store = usageStore();
  const batchValidationErrors = sanitized.entries.length
    ? await validateNormalizedIngestEvents(store, sanitized.entries, "ingest")
    : [];
  if (batchValidationErrors.length) {
    sendJson(request, response, 400, {
      error: "Token usage batch rejected",
      errors: batchValidationErrors,
    });
    return;
  }

  if (userConfig) {
    await store.upsertUserConfig(identity.userId, await mergeUserConfigForIngest(store, identity.userId, userConfig));
  }
  const result = await store.insertEvents(sanitized.entries);
  if (result.accepted > 0) {
    queueLeaderboardSnapshotRefresh();
  }

  sendJson(request, response, 200, {
    ok: true,
    accepted: result.accepted,
    duplicates: result.duplicates,
    errors: sanitized.errors,
    records: result.records,
    configUpdated: Boolean(userConfig),
    user: {
      userId: identity.userId,
      displayName: identity.displayName,
      team: identity.team || "GitHub",
    },
  });
}

async function handleReplace(request: IncomingMessage, response: ServerResponse) {
  const identity = await authenticateIngestRequest(request);

  if (!identity) {
    sendJson(request, response, 401, { error: "Login required" });
    return;
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    sendJson(request, response, 400, { error: "Body must be a JSON object" });
    return;
  }
  const userConfig = extractUserConfigFromIngestBody(body);
  const rawEvents = Array.isArray((body as { events?: unknown }).events)
    ? ((body as { events: Parameters<typeof sanitizeIngestEvents>[0] }).events)
    : [];

  if (!rawEvents.length && !userConfig) {
    sendJson(request, response, 400, { error: "Body must include events[] or userConfig" });
    return;
  }

  const rawValidationErrors = rawEvents.length ? validateRawIngestEvents(rawEvents) : [];
  if (rawValidationErrors.length) {
    sendJson(request, response, 400, {
      error: "Token usage batch rejected",
      errors: rawValidationErrors,
    });
    return;
  }

  const sanitized = rawEvents.length
    ? sanitizeIngestEvents(rawEvents, identity, ingestPrivacyOptions())
    : { entries: [], errors: [] };

  if (sanitized.errors.length) {
    sendJson(request, response, 400, {
      error: "Token usage batch rejected",
      errors: sanitized.errors,
    });
    return;
  }

  const store = usageStore();
  const batchValidationErrors = sanitized.entries.length
    ? await validateNormalizedIngestEvents(store, sanitized.entries, "replace")
    : [];
  if (batchValidationErrors.length) {
    sendJson(request, response, 400, {
      error: "Token usage batch rejected",
      errors: batchValidationErrors,
    });
    return;
  }

  if (userConfig) {
    await store.upsertUserConfig(identity.userId, await mergeUserConfigForIngest(store, identity.userId, userConfig));
  }
  const deleted = sanitized.entries.length ? await store.deleteEventsForUser(identity.userId) : { deleted: 0, records: await store.countEvents() };
  const inserted = await store.insertEvents(sanitized.entries);
  if (deleted.deleted > 0 || inserted.accepted > 0) {
    queueLeaderboardSnapshotRefresh();
  }

  sendJson(request, response, 200, {
    ok: true,
    replaced: true,
    deleted: deleted.deleted,
    accepted: inserted.accepted,
    duplicates: inserted.duplicates,
    errors: sanitized.errors,
    configUpdated: Boolean(userConfig),
    records: inserted.records,
    user: {
      userId: identity.userId,
      displayName: identity.displayName,
      team: identity.team || "GitHub",
    },
  });
}

function extractUserConfigFromIngestBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const client =
    record.client && typeof record.client === "object" && !Array.isArray(record.client)
      ? (record.client as Parameters<typeof sanitizeTokenBoardUserConfig>[1])
      : {};

  return sanitizeTokenBoardUserConfig(record.userConfig ?? record.config, client);
}

async function mergeUserConfigForIngest(
  store: TokenUsageStore,
  userId: string,
  nextConfig: TokenBoardUserConfig
): Promise<TokenBoardUserConfig> {
  if (nextConfig.goals !== undefined) {
    return nextConfig;
  }

  const existing = await store.getUserConfig(userId);
  const existingGoals = normalizeStoredTokenGoals(existing?.goals);

  return existingGoals.length ? { ...nextConfig, goals: existingGoals } : nextConfig;
}

type IngestWriteMode = "ingest" | "replace";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const TOKEN_NUMBER_FIELDS = [
  "inputTokens",
  "input_tokens",
  "cacheCreationInputTokens",
  "cache_creation_input_tokens",
  "cache_creation_input_tokens_5m",
  "cache_creation_input_tokens_1h",
  "cacheReadInputTokens",
  "cache_read_input_tokens",
  "cachedInputTokens",
  "cached_input_tokens",
  "cachedTokens",
  "outputTokens",
  "output_tokens",
  "reasoningOutputTokens",
  "reasoning_output_tokens",
  "totalTokens",
  "total_tokens",
  "messages",
  "errorCount",
  "error_count",
  "interruptedCount",
  "interrupted_count",
  "toolCallCount",
  "tool_call_count",
] as const;

function validateRawIngestEvents(events: unknown[]) {
  const errors: string[] = [];
  const latestAllowedMs = shanghaiStartOfDayAfterTomorrowMs();

  events.forEach((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      errors.push(`第 ${index + 1} 条记录不是对象`);
      return;
    }

    const record = event as Record<string, unknown>;
    errors.push(...validateRawTokenNumbers(record, index));

    const timestampValue = readRawField(record, ["timestamp", "reportedAt", "reported_at", "date", "createdAt", "created_at"]);
    if (timestampValue !== undefined) {
      const timestamp = parseRawDateMs(timestampValue);
      if (timestamp === null) {
        errors.push(`第 ${index + 1} 条记录 reported_at/timestamp 无法解析`);
      } else if (timestamp >= latestAllowedMs) {
        errors.push(`第 ${index + 1} 条记录 reported_at/timestamp 不能晚于明天（Asia/Shanghai）`);
      }
    }

    const inputTokens = readRawNumber(record, ["inputTokens", "input_tokens"]);
    const outputTokens = readRawNumber(record, ["outputTokens", "output_tokens"]);
    const totalTokens = readRawNumber(record, ["totalTokens", "total_tokens"]);
    const cacheReadTokens =
      readRawNumber(record, ["cachedInputTokens", "cached_input_tokens", "cachedTokens"]) +
      readRawNumber(record, ["cacheReadInputTokens", "cache_read_input_tokens"]);
    const cacheCreationTokens = readRawCacheCreationInputTokens(record);
    const reasoningOutputTokens = readRawNumber(record, ["reasoningOutputTokens", "reasoning_output_tokens"]);
    const errorCount = readRawOptionalNumber(record, ["errorCount", "error_count"]);
    const interruptedCount = readRawOptionalNumber(record, ["interruptedCount", "interrupted_count"]);
    const toolCallCount = readRawOptionalNumber(record, ["toolCallCount", "tool_call_count"]);
    const computedTotalTokens = inputTokens + outputTokens;

    if (totalTokens > 0 && Math.abs(totalTokens - computedTotalTokens) > 1) {
      errors.push(
        `第 ${index + 1} 条记录 totalTokens=${totalTokens} 与 inputTokens+outputTokens=${computedTotalTokens} 不一致`
      );
    }

    if (inputTokens > 0 && cacheReadTokens + cacheCreationTokens > inputTokens + 1) {
      errors.push(
        `第 ${index + 1} 条记录 cache read/write 合计 ${cacheReadTokens + cacheCreationTokens} 超过 inputTokens ${inputTokens}`
      );
    }

    if (outputTokens >= 0 && reasoningOutputTokens > outputTokens + 1) {
      errors.push(
        `第 ${index + 1} 条记录 reasoningOutputTokens ${reasoningOutputTokens} 超过 outputTokens ${outputTokens}`
      );
    }

    if (errorCount !== null && toolCallCount !== null && errorCount > toolCallCount) {
      errors.push(`第 ${index + 1} 条记录 errorCount 不能超过 toolCallCount`);
    }

    if (interruptedCount !== null && interruptedCount > 1) {
      errors.push(`第 ${index + 1} 条记录 interruptedCount 只能是 0 或 1`);
    }

    if (MAX_EVENT_TOTAL_TOKENS > 0 && computedTotalTokens > MAX_EVENT_TOTAL_TOKENS) {
      errors.push(
        `第 ${index + 1} 条记录 token 用量 ${computedTotalTokens} 超出单条上限 ${MAX_EVENT_TOTAL_TOKENS}`
      );
    }
  });

  return errors;
}

async function validateNormalizedIngestEvents(
  store: TokenUsageStore,
  entries: TokenUsageEvent[],
  mode: IngestWriteMode
) {
  const errors: string[] = [];

  entries.forEach((event, index) => {
    const fields = {
      inputTokens: event.inputTokens,
      cacheCreationInputTokens: event.cacheCreationInputTokens,
      cachedInputTokens: event.cachedInputTokens,
      outputTokens: event.outputTokens,
      reasoningOutputTokens: event.reasoningOutputTokens,
      totalTokens: event.totalTokens,
    };
    const optionalCountFields = {
      errorCount: event.errorCount,
      interruptedCount: event.interruptedCount,
      toolCallCount: event.toolCallCount,
    };

    for (const [field, value] of Object.entries(fields)) {
      if (!Number.isFinite(value) || value < 0) {
        errors.push(`第 ${index + 1} 条记录 ${field} 必须是非负数`);
      }
    }

    for (const [field, value] of Object.entries(optionalCountFields)) {
      if (value === undefined || value === null) {
        continue;
      }
      if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
        errors.push(`第 ${index + 1} 条记录 ${field} 必须是非负整数`);
      }
    }

    if (Math.abs(event.totalTokens - (event.inputTokens + event.outputTokens)) > 1) {
      errors.push(`第 ${index + 1} 条记录 totalTokens 与 inputTokens+outputTokens 不一致`);
    }

    if (event.cachedInputTokens + event.cacheCreationInputTokens > event.inputTokens + 1) {
      errors.push(`第 ${index + 1} 条记录 cache read/write 合计超过 inputTokens`);
    }

    if (event.reasoningOutputTokens > event.outputTokens + 1) {
      errors.push(`第 ${index + 1} 条记录 reasoningOutputTokens 超过 outputTokens`);
    }

    if (
      event.errorCount !== undefined &&
      event.errorCount !== null &&
      event.toolCallCount !== undefined &&
      event.toolCallCount !== null &&
      event.errorCount > event.toolCallCount
    ) {
      errors.push(`第 ${index + 1} 条记录 errorCount 不能超过 toolCallCount`);
    }

    if (event.interruptedCount !== undefined && event.interruptedCount !== null && event.interruptedCount > 1) {
      errors.push(`第 ${index + 1} 条记录 interruptedCount 只能是 0 或 1`);
    }

    if (MAX_EVENT_TOTAL_TOKENS > 0 && event.totalTokens > MAX_EVENT_TOTAL_TOKENS) {
      errors.push(`第 ${index + 1} 条记录 token 用量 ${event.totalTokens} 超出单条上限 ${MAX_EVENT_TOTAL_TOKENS}`);
    }
  });

  if (!errors.length) {
    errors.push(...(await validateUserDailyTokenCap(store, entries, mode)));
  }

  return errors;
}

async function validateUserDailyTokenCap(store: TokenUsageStore, entries: TokenUsageEvent[], mode: IngestWriteMode) {
  if (!entries.length || MAX_USER_DAILY_TOTAL_TOKENS <= 0) {
    return [];
  }

  const totalsByUserDay = new Map<string, number>();
  const incomingIds = new Set(entries.map((entry) => entry.id));

  if (mode === "ingest") {
    const users = new Set(entries.map((entry) => entry.userId));
    for (const userId of users) {
      const existing = await store.listEventsForUser(userId);
      for (const event of existing) {
        if (incomingIds.has(event.id)) {
          continue;
        }
        addDailyTokenTotal(totalsByUserDay, event);
      }
    }
  }

  entries.forEach((event) => addDailyTokenTotal(totalsByUserDay, event));

  return [...totalsByUserDay.entries()].flatMap(([key, tokens]) => {
    if (tokens <= MAX_USER_DAILY_TOTAL_TOKENS) {
      return [];
    }

    const [userId, day] = key.split("\n");
    return [
      `用户 ${userId} 在 ${day} 的单日 token 累计 ${Math.round(tokens)} 超出上限 ${MAX_USER_DAILY_TOTAL_TOKENS}`,
    ];
  });
}

function addDailyTokenTotal(totals: Map<string, number>, event: TokenUsageEvent) {
  const key = `${event.userId}\n${shanghaiDateKey(event.timestamp)}`;
  totals.set(key, (totals.get(key) ?? 0) + getTokenConsumptionTokens(event));
}

function validateRawTokenNumbers(record: Record<string, unknown>, index: number) {
  const errors: string[] = [];
  const cacheCreation = record.cache_creation;
  const nestedCacheCreation =
    cacheCreation && typeof cacheCreation === "object" && !Array.isArray(cacheCreation)
      ? (cacheCreation as Record<string, unknown>)
      : null;

  for (const field of TOKEN_NUMBER_FIELDS) {
    const value = record[field];
    if (value === undefined) {
      continue;
    }
    const parsed = parseRawNumber(value);
    if (parsed === null) {
      errors.push(`第 ${index + 1} 条记录 ${field} 不是有效数字`);
    } else if (parsed < 0) {
      errors.push(`第 ${index + 1} 条记录 ${field} 不能为负数`);
    }
  }

  if (nestedCacheCreation) {
    for (const field of ["ephemeral_5m_input_tokens", "ephemeral_1h_input_tokens"] as const) {
      const value = nestedCacheCreation[field];
      if (value === undefined) {
        continue;
      }
      const parsed = parseRawNumber(value);
      if (parsed === null) {
        errors.push(`第 ${index + 1} 条记录 cache_creation.${field} 不是有效数字`);
      } else if (parsed < 0) {
        errors.push(`第 ${index + 1} 条记录 cache_creation.${field} 不能为负数`);
      }
    }
  }

  return errors;
}

function readRawCacheCreationInputTokens(record: Record<string, unknown>) {
  const total = readRawNumber(record, ["cacheCreationInputTokens", "cache_creation_input_tokens"]);
  if (total > 0) {
    return total;
  }

  const cacheCreation = record.cache_creation;
  const nested =
    cacheCreation && typeof cacheCreation === "object" && !Array.isArray(cacheCreation)
      ? (cacheCreation as Record<string, unknown>)
      : {};

  return (
    readRawNumber(record, [
      "cacheCreationInputTokens5m",
      "cache_creation_input_tokens_5m",
      "ephemeral5mInputTokens",
      "ephemeral_5m_input_tokens",
    ]) +
    readRawNumber(record, [
      "cacheCreationInputTokens1h",
      "cache_creation_input_tokens_1h",
      "ephemeral1hInputTokens",
      "ephemeral_1h_input_tokens",
    ]) +
    readRawNumber(nested, ["ephemeral5mInputTokens", "ephemeral_5m_input_tokens"]) +
    readRawNumber(nested, ["ephemeral1hInputTokens", "ephemeral_1h_input_tokens"])
  );
}

function readRawNumber(record: Record<string, unknown>, fields: string[]) {
  const value = readRawField(record, fields);
  const parsed = value === undefined ? 0 : parseRawNumber(value);
  return parsed === null ? 0 : parsed;
}

function readRawOptionalNumber(record: Record<string, unknown>, fields: string[]) {
  const value = readRawField(record, fields);
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = parseRawNumber(value);
  return parsed === null ? null : parsed;
}

function readRawField(record: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    if (record[field] !== undefined) {
      return record[field];
    }
  }

  return undefined;
}

function parseRawNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,_\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return value === undefined || value === null || value === "" ? 0 : null;
}

function parseRawDateMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const epoch = Number(trimmed);
      return epoch < 1e12 ? epoch * 1000 : epoch;
    }
    const parsed = new Date(trimmed).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function shanghaiStartOfDayAfterTomorrowMs(now = new Date()) {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 2) - SHANGHAI_OFFSET_MS;
}

function shanghaiDateKey(value: string) {
  const time = new Date(value).getTime();
  const shifted = new Date((Number.isFinite(time) ? time : Date.now()) + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function handleSnapshotSharePublish(request: IncomingMessage, response: ServerResponse) {
  const identity = await authenticateIngestRequest(request);

  if (!identity) {
    sendJson(request, response, 401, { error: "Login required" });
    return;
  }

  const body = (await readJsonBody(request, MAX_SNAPSHOT_SHARE_BODY_BYTES)) as {
    snapshot?: unknown;
    expiresInDays?: unknown;
    siteUrl?: unknown;
    shareId?: unknown;
  };
  const snapshot = normalizeSnapshotPayloadForShare(body.snapshot ?? body);

  if (!snapshot.redacted && process.env.SNAPSHOT_SHARE_ALLOW_UNREDACTED !== "true") {
    sendJson(request, response, 400, {
      error: "Refusing to publish an unredacted snapshot. Re-run without --no-redact, or set SNAPSHOT_SHARE_ALLOW_UNREDACTED=true on the server.",
    });
    return;
  }

  const now = new Date().toISOString();
  const expiresAt = expiryFromDays(body.expiresInDays);
  const requestedShareId = sanitizeSnapshotShareId(body.shareId);
  const record: SnapshotShareRecord = {
    id: requestedShareId || createSnapshotShareId(),
    title: snapshot.title,
    engine: snapshot.engine,
    engineLabel: snapshot.engineLabel,
    sourceRef: snapshot.ref,
    createdAt: now,
    updatedAt: now,
    expiresAt,
    redacted: snapshot.redacted,
    turnCount: snapshot.turnCount,
    publisher: {
      userId: identity.userId,
      displayName: identity.displayName,
      team: identity.team,
    },
    snapshot: snapshot.payload,
  };

  try {
    await shareStore().putShare(record, { requireOwnerUserId: identity.userId });
  } catch (error) {
    if (error instanceof SnapshotShareOwnershipError) {
      sendJson(request, response, 403, { error: "This snapshot share id belongs to another user" });
      return;
    }
    throw error;
  }

  sendJson(request, response, 200, {
    ok: true,
    id: record.id,
    title: record.title,
    turnCount: record.turnCount,
    redacted: record.redacted,
    expiresAt: record.expiresAt || null,
    url: snapshotShareUrl(record.id, body.siteUrl),
  });
}

async function handleSnapshotShareGet(
  request: IncomingMessage,
  response: ServerResponse,
  id: string
) {
  const record = await shareStore().getShare(id);

  if (!record) {
    sendJson(request, response, 404, { error: "Snapshot share not found" });
    return;
  }

  sendJson(request, response, 200, {
    schemaVersion: 1,
    share: {
      id: record.id,
      title: record.title,
      engine: record.engine,
      engineLabel: record.engineLabel,
      sourceRef: record.sourceRef,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      expiresAt: record.expiresAt || null,
      redacted: record.redacted,
      turnCount: record.turnCount,
    },
    snapshot: record.snapshot,
  });
}

async function handleSnapshotShareDelete(
  request: IncomingMessage,
  response: ServerResponse,
  id: string
) {
  const identity = await authenticateIngestRequest(request);

  if (!identity) {
    sendJson(request, response, 401, { error: "Login required" });
    return;
  }

  // Scope deletion to the publisher so a logged-in user cannot delete others' shares.
  const deleted = await shareStore().deleteShare(id, { requireOwnerUserId: identity.userId });

  sendJson(request, response, deleted ? 200 : 404, {
    ok: deleted,
    deleted,
    id,
  });
}

async function handleGithubStart(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (!enforceAuthRateLimit(request, response)) {
    return;
  }
  const clientId = requireEnv("GITHUB_CLIENT_ID");
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"), allowedReturnOrigins(request), "/token-leaderboard/");
  const state = createOAuthState(returnTo, authSecret(), OAUTH_STATE_TTL_SECONDS);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${publicBaseUrl(request)}/api/auth/github/callback`,
    scope: "read:user",
    state,
  });

  redirect(response, `https://github.com/login/oauth/authorize?${params.toString()}`);
}

async function handleGithubCallback(request: IncomingMessage, response: ServerResponse, url: URL) {
  const code = url.searchParams.get("code");
  const state = verifyOAuthState(url.searchParams.get("state") || "", authSecret());

  if (!code || !state?.returnTo) {
    sendJson(request, response, 400, { error: "Invalid OAuth callback" });
    return;
  }

  const accessToken = await exchangeGithubCode(code, `${publicBaseUrl(request)}/api/auth/github/callback`);
  const identity = await githubIdentityFromAccessToken(accessToken);

  if (!isGithubIdentityAllowed(identity, allowedGithubLogins())) {
    sendJson(request, response, 403, { error: "This GitHub account is not allowed" });
    return;
  }

  response.setHeader(
    "Set-Cookie",
    sessionCookie(createWebSessionToken(identity, authSecret(), WEB_SESSION_TTL_SECONDS), request, WEB_SESSION_TTL_SECONDS)
  );
  redirect(response, state.returnTo);
}

async function handleDeviceStart(request: IncomingMessage, response: ServerResponse) {
  if (!enforceAuthRateLimit(request, response)) {
    return;
  }
  const clientId = requireEnv("GITHUB_CLIENT_ID");
  const githubResponse = await postGithubForm("https://github.com/login/device/code", {
    client_id: clientId,
    scope: "read:user",
  });

  sendJson(request, response, 200, {
    deviceCode: githubResponse.device_code,
    userCode: githubResponse.user_code,
    verificationUri: githubResponse.verification_uri,
    expiresIn: githubResponse.expires_in,
    interval: githubResponse.interval,
  });
}

async function handleDevicePoll(request: IncomingMessage, response: ServerResponse) {
  if (!enforceAuthRateLimit(request, response)) {
    return;
  }
  const body = await readJsonBody(request);
  const deviceCode =
    body && typeof body === "object" && !Array.isArray(body) && typeof (body as { deviceCode?: unknown }).deviceCode === "string"
      ? (body as { deviceCode: string }).deviceCode
      : "";

  if (!deviceCode) {
    sendJson(request, response, 400, { error: "deviceCode is required" });
    return;
  }

  const githubResponse = await postGithubForm("https://github.com/login/oauth/access_token", {
    client_id: requireEnv("GITHUB_CLIENT_ID"),
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });

  if (githubResponse.error) {
    const status = githubResponse.error === "authorization_pending" || githubResponse.error === "slow_down" ? 200 : 400;
    sendJson(request, response, status, {
      status: githubResponse.error,
      interval: githubResponse.interval,
      errorDescription: githubResponse.error_description,
    });
    return;
  }

  const identity = await githubIdentityFromAccessToken(String(githubResponse.access_token || ""));

  if (!isGithubIdentityAllowed(identity, allowedGithubLogins())) {
    sendJson(request, response, 403, { error: "This GitHub account is not allowed" });
    return;
  }

  sendJson(request, response, 200, {
    status: "authorized",
    token: createAgentSessionToken(identity, authSecret(), AGENT_SESSION_TTL_SECONDS),
    user: identity,
    expiresIn: AGENT_SESSION_TTL_SECONDS,
  });
}

async function authenticateIngestRequest(request: IncomingMessage): Promise<TokenBoardIdentity | undefined> {
  const token = readBearerToken(request);
  const agentIdentity = verifyAgentSessionToken(token, authSecret());

  if (agentIdentity) {
    return agentIdentity;
  }

  const legacyUser = findUserByUploadToken(await loadUploadUsers(), token);

  if (legacyUser) {
    return {
      userId: legacyUser.userId,
      displayName: legacyUser.displayName,
      team: legacyUser.team || "Friends",
    };
  }

  return undefined;
}

function readWebIdentity(request: IncomingMessage) {
  const token = parseCookieHeader(request.headers.cookie).get(SESSION_COOKIE_NAME) || "";
  return verifyWebSessionToken(token, authSecret());
}

async function readUsageRequestIdentity(request: IncomingMessage) {
  return readWebIdentity(request) ?? (await authenticateIngestRequest(request));
}

async function loadUploadUsers(): Promise<TokenBoardUploadUser[]> {
  if (process.env.TOKEN_BOARD_USERS_JSON) {
    return normalizeUploadUsers(JSON.parse(process.env.TOKEN_BOARD_USERS_JSON));
  }

  if (process.env.TOKEN_BOARD_UPLOAD_TOKEN) {
    return [
      {
        userId: process.env.TOKEN_BOARD_USER_ID || "local",
        displayName: process.env.TOKEN_BOARD_DISPLAY_NAME || process.env.TOKEN_BOARD_USER_ID || "Local User",
        team: process.env.TOKEN_BOARD_TEAM || "Friends",
        uploadToken: process.env.TOKEN_BOARD_UPLOAD_TOKEN,
      },
    ];
  }

  try {
    const text = await fs.readFile(USERS_FILE, "utf8");
    return normalizeUploadUsers(JSON.parse(text));
  } catch {
    return [];
  }
}

async function readJsonBody(request: IncomingMessage, maxBytes = MAX_BODY_BYTES) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > maxBytes) {
      throw new Error("Request body is too large");
    }

    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function snapshotShareIdFromPath(pathname: string) {
  const match = pathname.match(/^\/api\/snapshots\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function createSnapshotShareId() {
  return `snap_${randomBytes(18).toString("base64url")}`;
}

function sanitizeSnapshotShareId(value: unknown) {
  const text = sanitizeSnapshotText(value, 90);
  return /^snap_[A-Za-z0-9_-]{16,80}$/.test(text) ? text : "";
}

function normalizeSnapshotPayloadForShare(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("Body must include a snapshot object");
  }

  const payload = removePrivateSnapshotFields(JSON.parse(JSON.stringify(value))) as Record<string, unknown>;
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  const title = sanitizeSnapshotText(payload.title, 180) || "Untitled snapshot";
  const engine = sanitizeSnapshotText(payload.engine, 80) || "codex";
  const engineLabel = sanitizeSnapshotText(payload.engineLabel, 80) || "Codex";
  const ref = sanitizeSnapshotText(payload.ref, 240) || undefined;

  if (!turns.length) {
    throw new Error("Snapshot has no shareable turns");
  }

  sanitizeTurnHtml(payload);

  return {
    title,
    engine,
    engineLabel,
    ref,
    redacted: payload.redacted !== false,
    turnCount: turns.length,
    payload,
  };
}

function removePrivateSnapshotFields(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(removePrivateSnapshotFields);
  }

  const record = value as Record<string, unknown>;
  delete record.cwd;
  delete record.filePath;
  delete record.displayFilePath;

  for (const [key, item] of Object.entries(record)) {
    if (key === "images") {
      continue;
    }
    record[key] = removePrivateSnapshotFields(item);
  }

  return record;
}

function sanitizeTurnHtml(snapshot: Record<string, unknown>) {
  const turns = Array.isArray(snapshot.turns) ? snapshot.turns : [];

  for (const turn of turns) {
    if (!turn || typeof turn !== "object") {
      continue;
    }

    const record = turn as Record<string, unknown>;
    if (typeof record.html === "string") {
      record.html = sanitizePublishedHtml(record.html);
    }
  }
}

function sanitizePublishedHtml(value: string) {
  // Use a real allowlist-based sanitizer rather than regex stripping, which is
  // trivially bypassable (malformed/nested tags, javascript: URLs, svg/onload, …).
  return sanitizeHtml(value, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "figure", "figcaption", "span"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": ["class", "style"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    disallowedTagsMode: "discard",
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
    },
  });
}

function expiryFromDays(value: unknown) {
  const days = Number(value);

  if (!Number.isFinite(days) || days <= 0) {
    return undefined;
  }

  const maxDays = Math.min(days, 365);
  return new Date(Date.now() + maxDays * 24 * 60 * 60 * 1000).toISOString();
}

function snapshotShareUrl(id: string, rawSiteUrl: unknown) {
  const siteUrl = sanitizeSnapshotUrl(rawSiteUrl) || sanitizeSnapshotUrl(process.env.SNAPSHOT_SHARE_SITE_URL) || "https://ffffhx.github.io/garden-lab";
  return `${siteUrl.replace(/\/+$/, "")}/snapshots/share/?id=${encodeURIComponent(id)}`;
}

function sanitizeSnapshotText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function sanitizeSnapshotUrl(value: unknown) {
  const text = sanitizeSnapshotText(value, 400).replace(/\/+$/, "");

  if (!text) {
    return "";
  }

  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

async function exchangeGithubCode(code: string, redirectUri: string) {
  const payload = await postGithubForm("https://github.com/login/oauth/access_token", {
    client_id: requireEnv("GITHUB_CLIENT_ID"),
    client_secret: requireEnv("GITHUB_CLIENT_SECRET"),
    code,
    redirect_uri: redirectUri,
  });

  if (!payload.access_token) {
    throw new Error(String(payload.error_description || payload.error || "GitHub OAuth token exchange failed"));
  }

  return String(payload.access_token);
}

async function githubIdentityFromAccessToken(accessToken: string) {
  if (!accessToken) {
    throw new Error("GitHub access token is empty");
  }

  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "token-board",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub user request failed with HTTP ${response.status}`);
  }

  return identityFromGitHubUser((await response.json()) as GitHubUserProfile);
}

async function postGithubForm(url: string, fields: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "token-board",
    },
    body: new URLSearchParams(fields),
  });
  const payload = (await response.json()) as Record<string, string | number | undefined>;

  if (!response.ok) {
    throw new Error(String(payload.error_description || payload.error || `GitHub request failed with HTTP ${response.status}`));
  }

  return payload;
}

function readBearerToken(request: IncomingMessage) {
  const auth = request.headers.authorization || "";

  if (auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }

  const header = request.headers["x-token-board-token"];
  return Array.isArray(header) ? header[0] || "" : header || "";
}

function parseExportFormat(value: string | null): "csv" | "json" | null {
  const format = value?.trim().toLowerCase();
  return format === "csv" || format === "json" ? format : null;
}

function parseExportScope(value: string | null): "leaderboard" | "me" | null {
  const scope = value?.trim().toLowerCase();
  return scope === "leaderboard" || scope === "me" ? scope : null;
}

function parseRange(value: string | null): TokenBoardRange {
  const raw = value?.trim() || "";
  const rolling = raw.toUpperCase();
  const calendar = raw.toLowerCase();

  if (isTokenBoardRange(rolling)) {
    return rolling;
  }

  return isTokenBoardRange(calendar) ? calendar : "7D";
}

function parseStatsRange(searchParams: URLSearchParams):
  | { range: TokenBoardRange; preferSnapshot: boolean; window?: TokenLeaderboardWindow }
  | { error: string } {
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (from !== null || to !== null) {
    const custom = parseCustomStatsWindow(from, to);

    if (!custom) {
      return { error: "from/to must be valid YYYY-MM-DD dates, from <= to, with a maximum range of 366 days" };
    }

    return {
      range: "7D",
      preferSnapshot: false,
      window: custom,
    };
  }

  return {
    range: parseRange(searchParams.get("range")),
    preferSnapshot: !searchParams.has("now"),
  };
}

function parseCustomStatsWindow(from: string | null, to: string | null): TokenLeaderboardWindow | null {
  if (!from || !to || !isValidDayKey(from) || !isValidDayKey(to)) {
    return null;
  }

  const fromTime = dayKeyUtcTime(from);
  const toTime = dayKeyUtcTime(to);

  if (toTime < fromTime) {
    return null;
  }

  const days = Math.floor((toTime - fromTime) / (24 * 60 * 60 * 1000)) + 1;

  if (days < 1 || days > 366) {
    return null;
  }

  return createCustomTokenLeaderboardWindow(from, to);
}

function isValidDayKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    year >= 2000 &&
    year <= 2100 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function dayKeyUtcTime(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return Date.UTC(year, month - 1, day);
}

function parseMetric(value: string | null): TokenBoardMetric {
  return value && isTokenBoardMetric(value) ? value : "tokens";
}

function parseNow(value: string | null) {
  const parsed = value ? new Date(value) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function parseProjectMode(value: string | undefined): "basename" | "hash" | "none" {
  return value === "hash" || value === "none" ? value : "basename";
}

function ingestPrivacyOptions() {
  return {
    projectMode: parseProjectMode(process.env.TOKEN_BOARD_PROJECT_MODE),
    includeModel: process.env.TOKEN_BOARD_INCLUDE_MODEL !== "false",
    includeSource: process.env.TOKEN_BOARD_INCLUDE_SOURCE !== "false",
    hashSessionId: process.env.TOKEN_BOARD_HASH_SESSION_ID !== "false",
    includeSessionTitle: process.env.TOKEN_BOARD_INCLUDE_SESSION_TITLE !== "false",
    maxEventAgeDays: positiveNumberEnv(process.env.TOKEN_BOARD_MAX_EVENT_AGE_DAYS, 120),
    maxEventTotalTokens: MAX_EVENT_TOTAL_TOKENS,
    // Comma-separated source blocklist; defaults to "trae" (cumulative counters,
    // no per-call data — old agents keep re-uploading them as fresh calls).
    blockedSources: (process.env.TOKEN_BOARD_BLOCKED_SOURCES ?? "trae")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function normalizeOptionalText(value: string | null | undefined) {
  return value?.trim() || "";
}

function allowedGithubLogins() {
  return (process.env.TOKEN_BOARD_ALLOWED_GITHUB_LOGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectionExplainAllowedGithubLogins() {
  const logins = (
    process.env.SELECTION_EXPLAIN_ALLOWED_GITHUB_LOGINS ||
    process.env.TOKEN_BOARD_ALLOWED_GITHUB_LOGINS ||
    ""
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return logins.length ? logins : DEFAULT_SELECTION_EXPLAIN_ALLOWED_GITHUB_LOGINS;
}

function benchmarkAllowedGithubLogins() {
  const logins = (process.env.TOKEN_BOARD_BENCHMARK_ALLOWED_GITHUB_LOGINS || process.env.BENCHMARK_ALLOWED_GITHUB_LOGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return logins.length ? logins : DEFAULT_BENCHMARK_ALLOWED_GITHUB_LOGINS;
}

function allowedReturnOrigins(request: IncomingMessage) {
  return (process.env.TOKEN_BOARD_ALLOWED_RETURN_ORIGINS || process.env.TOKEN_BOARD_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin && origin !== "*")
    .concat(originFromRequest(request));
}

function originFromRequest(request: IncomingMessage) {
  const protocol = request.headers["x-forwarded-proto"] || (process.env.TOKEN_BOARD_PUBLIC_URL?.startsWith("https://") ? "https" : "http");
  return `${Array.isArray(protocol) ? protocol[0] : protocol}://${request.headers.host || `${HOST}:${PORT}`}`;
}

function publicBaseUrl(request: IncomingMessage) {
  return (process.env.TOKEN_BOARD_PUBLIC_URL || originFromRequest(request)).replace(/\/+$/, "");
}

function authSecret() {
  const secret = process.env.TOKEN_BOARD_AUTH_SECRET;

  if (secret && secret !== DEV_AUTH_SECRET_PLACEHOLDER) {
    return secret;
  }

  // Never sign real sessions with the committed placeholder; that would let anyone
  // who has read this repo forge tokens. Require an explicit opt-in for local dev.
  if (process.env.TOKEN_BOARD_ALLOW_DEV_AUTH_SECRET === "true") {
    return DEV_AUTH_SECRET_PLACEHOLDER;
  }

  throw new Error(
    "TOKEN_BOARD_AUTH_SECRET must be set to a strong random value. Set it, or set TOKEN_BOARD_ALLOW_DEV_AUTH_SECRET=true for local development only."
  );
}

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

// Lightweight fixed-window per-key limiter for unauthenticated endpoints that proxy
// outbound calls to GitHub, so they cannot be hammered to exhaust quota / relay abuse.
function rateLimitExceeded(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (rateLimitBuckets.size > 5000) {
      for (const [bucketKey, value] of rateLimitBuckets) {
        if (value.resetAt <= now) {
          rateLimitBuckets.delete(bucketKey);
        }
      }
    }
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  bucket.count += 1;
  return bucket.count > limit;
}

function clientIp(request: IncomingMessage) {
  const forwarded = request.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return raw?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
}

function enforceAuthRateLimit(request: IncomingMessage, response: ServerResponse) {
  if (rateLimitExceeded(`auth:${clientIp(request)}`, 60, 60_000)) {
    sendJson(request, response, 429, { error: "Too many requests, please slow down" });
    return false;
  }

  return true;
}

async function openTokenUsageStore() {
  return createTokenUsageStore({
    dataFile: DATA_FILE,
    maxEvents: MAX_EVENTS,
    databaseUrl: normalizeOptionalText(process.env.TOKEN_BOARD_DATABASE_URL) || normalizeOptionalText(process.env.DATABASE_URL),
    postgresSchema: normalizeOptionalText(process.env.TOKEN_BOARD_POSTGRES_SCHEMA) || "token_board",
    postgresSsl: process.env.TOKEN_BOARD_DATABASE_SSL === "true" ? { rejectUnauthorized: process.env.TOKEN_BOARD_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
  });
}

async function openSnapshotShareStore() {
  return createSnapshotShareStore({
    dataFile: SNAPSHOT_SHARE_DATA_FILE,
    databaseUrl: normalizeOptionalText(process.env.TOKEN_BOARD_DATABASE_URL) || normalizeOptionalText(process.env.DATABASE_URL),
    postgresSchema: normalizeOptionalText(process.env.TOKEN_BOARD_POSTGRES_SCHEMA) || "token_board",
    postgresSsl: process.env.TOKEN_BOARD_DATABASE_SSL === "true" ? { rejectUnauthorized: process.env.TOKEN_BOARD_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
  });
}

function usageStore() {
  if (!tokenUsageStore) {
    throw new Error("Token usage store is not initialized");
  }

  return tokenUsageStore;
}

type UsageLeaderboardReadResult = {
  generatedAt: string;
  records: number;
  source: "live" | "snapshot";
  summary: TokenLeaderboardSummary;
};

type LeaderboardSnapshotEntry = {
  generatedAt: string;
  key: string;
  metric: TokenBoardMetric;
  range: TokenBoardRange;
  records: number;
  summary: TokenLeaderboardSummary;
};

async function readUsageLeaderboard({
  range,
  metric,
  now,
  preferSnapshot = false,
  window,
}: {
  range: TokenBoardRange;
  metric: TokenBoardMetric;
  now: Date;
  preferSnapshot?: boolean;
  window?: TokenLeaderboardWindow;
}): Promise<UsageLeaderboardReadResult> {
  if (preferSnapshot && !window) {
    const snapshot = await readLeaderboardSnapshot({ range, metric });

    if (snapshot) {
      return {
        generatedAt: snapshot.generatedAt,
        records: snapshot.records,
        source: "snapshot",
        summary: snapshot.summary,
      };
    }

    if (leaderboardSnapshotLastError) {
      throw new Error(`Leaderboard snapshot is not ready: ${leaderboardSnapshotLastError}`);
    }
  }

  const live = await readLiveUsageLeaderboard({ range, metric, now, window });

  return {
    ...live,
    generatedAt: new Date().toISOString(),
    source: "live",
  };
}

async function readLiveUsageLeaderboard({
  range,
  metric,
  now,
  window,
}: {
  range: TokenBoardRange;
  metric: TokenBoardMetric;
  now: Date;
  window?: TokenLeaderboardWindow;
}) {
  const store = usageStore();

  if (store.getLeaderboardSummary && !window) {
    return store.getLeaderboardSummary({ range, metric, now });
  }

  const events = await store.listEvents();

  return {
    records: events.length,
    summary: buildTokenLeaderboard(events, { range, metric, now, window }),
  };
}

// --- Daily Feishu report scheduler ----------------------------------------

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local calendar day (YYYY-MM-DD) for the configured timezone offset. */
function localDayKey(now: Date, offsetMin: number): string {
  const local = new Date(now.getTime() + offsetMin * 60_000);
  return `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`;
}

function parseReportTime(value: string, fallback: { hour: number; minute: number }): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute };
  }
  return fallback;
}

/** UTC instant of the next local HH:MM (today if still ahead, else tomorrow). */
function nextDailyReportTime(now: Date): Date {
  const { hour, minute } = parseReportTime(DAILY_REPORT_AT, { hour: 9, minute: 0 });
  const offsetMs = DAILY_REPORT_TZ_OFFSET_MIN * 60_000;
  const local = new Date(now.getTime() + offsetMs);
  let targetUtcMs =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute, 0, 0) - offsetMs;
  if (targetUtcMs <= now.getTime()) targetUtcMs += 24 * 60 * 60 * 1000;
  return new Date(targetUtcMs);
}

/** UTC instant of the next local Monday HH:MM. */
function nextWeeklyReportTime(now: Date): Date {
  const { hour, minute } = parseReportTime(WEEKLY_REPORT_AT, { hour: 10, minute: 0 });
  const offsetMs = DAILY_REPORT_TZ_OFFSET_MIN * 60_000;
  const local = new Date(now.getTime() + offsetMs);
  const weekday = local.getUTCDay();
  let daysUntilMonday = (1 - weekday + 7) % 7;
  let targetUtcMs =
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + daysUntilMonday,
      hour,
      minute,
      0,
      0,
    ) - offsetMs;

  if (targetUtcMs <= now.getTime()) {
    daysUntilMonday += 7;
    targetUtcMs =
      Date.UTC(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate() + daysUntilMonday,
        hour,
        minute,
        0,
        0,
      ) - offsetMs;
  }

  return new Date(targetUtcMs);
}

function localWeekKey(now: Date, offsetMin: number): string {
  const local = new Date(now.getTime() + offsetMin * 60_000);
  const weekday = local.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const mondayLocalUtcMs =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - daysSinceMonday * 24 * 60 * 60 * 1000;
  const monday = new Date(mondayLocalUtcMs);
  return `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}-${pad2(monday.getUTCDate())}`;
}

function startFeishuReportLoops() {
  if (!DAILY_REPORT_ENABLED && !WEEKLY_REPORT_ENABLED) return;
  if (!FEISHU_WEBHOOK_URL) {
    console.warn("Feishu report enabled but TOKEN_BOARD_FEISHU_WEBHOOK_URL is missing; not scheduling");
    return;
  }
  void loadDailyReportState().finally(() => {
    if (DAILY_REPORT_ENABLED) {
      scheduleNextDailyReport();
      console.log(
        `daily Feishu report: enabled at ${DAILY_REPORT_AT} (UTC${DAILY_REPORT_TZ_OFFSET_MIN >= 0 ? "+" : ""}${DAILY_REPORT_TZ_OFFSET_MIN / 60}h), ` +
          `range=${DAILY_REPORT_RANGE}, next=${nextDailyReportTime(new Date()).toISOString()}`,
      );
    }
    if (WEEKLY_REPORT_ENABLED) {
      scheduleNextWeeklyReport();
      console.log(
        `weekly Feishu report: enabled on Monday at ${WEEKLY_REPORT_AT} (UTC${DAILY_REPORT_TZ_OFFSET_MIN >= 0 ? "+" : ""}${DAILY_REPORT_TZ_OFFSET_MIN / 60}h), ` +
          `next=${nextWeeklyReportTime(new Date()).toISOString()}`,
      );
    }
  });
}

function scheduleNextDailyReport() {
  if (dailyReportTimer) clearTimeout(dailyReportTimer);
  const now = new Date();
  const delay = Math.max(1_000, nextDailyReportTime(now).getTime() - now.getTime());
  dailyReportTimer = setTimeout(() => {
    void runDailyReport("schedule")
      .catch((error) => console.error("daily report (schedule) failed:", error))
      .finally(scheduleNextDailyReport);
  }, delay);
}

function scheduleNextWeeklyReport() {
  if (weeklyReportTimer) clearTimeout(weeklyReportTimer);
  const now = new Date();
  const delay = Math.max(1_000, nextWeeklyReportTime(now).getTime() - now.getTime());
  weeklyReportTimer = setTimeout(() => {
    void runWeeklyReport("schedule")
      .catch((error) => console.error("weekly report (schedule) failed:", error))
      .finally(scheduleNextWeeklyReport);
  }, delay);
}

async function runDailyReport(
  trigger: "schedule" | "manual",
): Promise<{ kind: "daily"; sent: boolean; reason?: string; status?: number; activeUsers?: number; events?: number }> {
  const now = new Date();
  const dayKey = localDayKey(now, DAILY_REPORT_TZ_OFFSET_MIN);
  if (trigger === "schedule" && dailyReportLastSentDayKey === dayKey) {
    return { kind: "daily", sent: false, reason: "already-sent-today" };
  }

  const dailyResult = await readLiveUsageLeaderboard({ range: "1D", metric: "tokens", now });
  const weeklyResult = await readLiveUsageLeaderboard({ range: "7D", metric: "tokens", now });
  const reportGoalConfigs = await loadReportGoalConfigs();
  const reportGoalEvents = reportGoalConfigs.length ? await usageStore().listEvents() : [];
  const reportResult =
    DAILY_REPORT_RANGE === "1D"
      ? dailyResult
      : DAILY_REPORT_RANGE === "7D"
        ? weeklyResult
        : await readLiveUsageLeaderboard({ range: DAILY_REPORT_RANGE, metric: "tokens", now });
  const snapshot = buildReportStateSnapshot({
    dailySummary: dailyResult.summary,
    weeklySummary: weeklyResult.summary,
    generatedAt: now.toISOString(),
    dayKey,
    goalEvaluationsByUser: buildReportGoalEvaluationsByUser(reportGoalConfigs, reportGoalEvents, now),
  });
  const events = detectDailyReportEvents(snapshot, latestReportSnapshot);
  const summary = reportResult.summary;

  if (!summary || (summary.activeUsers === 0 && trigger === "schedule")) {
    if (trigger === "schedule") {
      dailyReportLastSentDayKey = dayKey;
      latestReportSnapshot = snapshot;
      await saveDailyReportState();
    }
    console.log(`daily report (${trigger}): no active users for ${dayKey}, skipped`);
    return { kind: "daily", sent: false, reason: "no-data", activeUsers: 0, events: events.length };
  }

  const card = buildDailyReportCard(summary, {
    tzOffsetMinutes: DAILY_REPORT_TZ_OFFSET_MIN,
    siteUrl: DAILY_REPORT_SITE_URL || undefined,
    events,
  });
  const result = await sendFeishuCard(card, feishuReportConfig());

  if (result.ok) {
    dailyReportLastSentDayKey = dayKey;
    latestReportSnapshot = snapshot;
    await saveDailyReportState();
    console.log(`daily report (${trigger}): sent for ${dayKey} (status=${result.status}, events=${events.length})`);
    return { kind: "daily", sent: true, status: result.status, activeUsers: summary.activeUsers, events: events.length };
  }

  console.error(
    `daily report (${trigger}): send failed (status=${result.status}, code=${result.code ?? "?"}, msg=${result.msg ?? "?"})`,
  );
  return { kind: "daily", sent: false, reason: "send-failed", status: result.status, activeUsers: summary.activeUsers, events: events.length };
}

async function runWeeklyReport(
  trigger: "schedule" | "manual",
): Promise<{ kind: "weekly"; sent: boolean; reason?: string; status?: number; activeUsers?: number; highlights?: number }> {
  const now = new Date();
  const weekKey = localWeekKey(now, DAILY_REPORT_TZ_OFFSET_MIN);
  if (trigger === "schedule" && weeklyReportLastSentWeekKey === weekKey) {
    return { kind: "weekly", sent: false, reason: "already-sent-this-week" };
  }

  const { summary } = await readLiveUsageLeaderboard({ range: "7D", metric: "tokens", now });
  const previousNow = Number.isFinite(Date.parse(summary.startAt)) ? new Date(summary.startAt) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const { summary: previousSummary } = await readLiveUsageLeaderboard({ range: "7D", metric: "tokens", now: previousNow });

  if (!summary || (summary.activeUsers === 0 && trigger === "schedule")) {
    if (trigger === "schedule") {
      weeklyReportLastSentWeekKey = weekKey;
      await saveDailyReportState();
    }
    console.log(`weekly report (${trigger}): no active users for ${weekKey}, skipped`);
    return { kind: "weekly", sent: false, reason: "no-data", activeUsers: 0, highlights: 0 };
  }

  const usageEvents = await usageStore().listEvents();
  const reportGoalConfigs = await loadReportGoalConfigs();
  const highlights = buildWeeklyReportHighlights(usageEvents, {
    now,
    tzOffsetMinutes: DAILY_REPORT_TZ_OFFSET_MIN,
  });
  const goalScorecard = buildWeeklyTokenGoalScorecard({
    configs: reportGoalConfigs,
    events: usageEvents,
    now,
  });
  const card = buildWeeklyReportCard(summary, previousSummary, {
    tzOffsetMinutes: DAILY_REPORT_TZ_OFFSET_MIN,
    siteUrl: DAILY_REPORT_SITE_URL || undefined,
    highlights,
    goalScorecard,
  });
  const result = await sendFeishuCard(card, feishuReportConfig());

  if (result.ok) {
    weeklyReportLastSentWeekKey = weekKey;
    await saveDailyReportState();
    console.log(`weekly report (${trigger}): sent for ${weekKey} (status=${result.status}, highlights=${highlights.length})`);
    return { kind: "weekly", sent: true, status: result.status, activeUsers: summary.activeUsers, highlights: highlights.length };
  }

  console.error(
    `weekly report (${trigger}): send failed (status=${result.status}, code=${result.code ?? "?"}, msg=${result.msg ?? "?"})`,
  );
  return { kind: "weekly", sent: false, reason: "send-failed", status: result.status, activeUsers: summary.activeUsers, highlights: highlights.length };
}

type ReportGoalConfig = {
  userId: string;
  goals: TokenGoal[];
};

async function loadReportGoalConfigs(): Promise<ReportGoalConfig[]> {
  const rows = await usageStore().listUserConfigs();

  return rows.flatMap((row) => {
    const goals = normalizeStoredTokenGoals(row.config.goals);
    return goals.length ? [{ userId: row.userId, goals }] : [];
  });
}

function buildReportGoalEvaluationsByUser(
  configs: ReportGoalConfig[],
  events: TokenUsageEvent[],
  now: Date,
) {
  if (!configs.length) {
    return new Map<string, ReturnType<typeof evaluateTokenGoals>>();
  }

  const eventsByUser = new Map<string, TokenUsageEvent[]>();
  for (const event of events) {
    const current = eventsByUser.get(event.userId) ?? [];
    current.push(event);
    eventsByUser.set(event.userId, current);
  }

  return new Map(
    configs.map((config) => [
      config.userId,
      evaluateTokenGoals(config.goals, eventsByUser.get(config.userId) ?? [], { now }),
    ])
  );
}

function feishuReportConfig(): DailyReportConfig {
  return {
    webhookUrl: FEISHU_WEBHOOK_URL,
    secret: FEISHU_WEBHOOK_SECRET || undefined,
    tzOffsetMinutes: DAILY_REPORT_TZ_OFFSET_MIN,
    siteUrl: DAILY_REPORT_SITE_URL || undefined,
  };
}

function parseReportKind(value: string | null) {
  if (!value || value === "daily") return "daily" as const;
  if (value === "weekly") return "weekly" as const;
  return null;
}

async function loadDailyReportState() {
  try {
    const raw = await fs.readFile(DAILY_REPORT_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as {
      lastSentDayKey?: unknown;
      lastWeeklySentWeekKey?: unknown;
      latestSnapshot?: unknown;
    };
    if (parsed && typeof parsed.lastSentDayKey === "string") {
      dailyReportLastSentDayKey = parsed.lastSentDayKey;
    }
    if (parsed && typeof parsed.lastWeeklySentWeekKey === "string") {
      weeklyReportLastSentWeekKey = parsed.lastWeeklySentWeekKey;
    }
    latestReportSnapshot = parseReportStateSnapshot(parsed?.latestSnapshot);
  } catch {
    // No state yet (or unreadable) — start fresh.
  }
}

async function saveDailyReportState() {
  try {
    await fs.mkdir(path.dirname(DAILY_REPORT_STATE_FILE), { recursive: true });
    await fs.writeFile(
      DAILY_REPORT_STATE_FILE,
      JSON.stringify(
        {
          lastSentDayKey: dailyReportLastSentDayKey,
          lastWeeklySentWeekKey: weeklyReportLastSentWeekKey,
          latestSnapshot: latestReportSnapshot,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (error) {
    console.error("failed to persist daily report state:", error);
  }
}

function parseReportStateSnapshot(value: unknown): ReportStateSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const snapshot = value as Partial<ReportStateSnapshot>;
  if (snapshot.schemaVersion !== 1 || typeof snapshot.generatedAt !== "string" || !Array.isArray(snapshot.users)) {
    return null;
  }

  return snapshot as ReportStateSnapshot;
}

async function readLeaderboardSnapshot({
  range,
  metric,
}: {
  range: TokenBoardRange;
  metric: TokenBoardMetric;
}) {
  const key = leaderboardSnapshotKey(range, metric);
  const cached = leaderboardSnapshotCache.get(key);

  if (cached) {
    return cached;
  }

  await refreshLeaderboardSnapshots("cache-miss").catch((error) => {
    console.error("Leaderboard snapshot refresh failed:", error);
  });

  return leaderboardSnapshotCache.get(key) ?? null;
}

function startLeaderboardSnapshotRefreshLoop() {
  void refreshLeaderboardSnapshots("startup").catch((error) => {
    console.error("Initial leaderboard snapshot refresh failed:", error);
  });

  if (leaderboardSnapshotRefreshTimer) {
    clearInterval(leaderboardSnapshotRefreshTimer);
  }

  leaderboardSnapshotRefreshTimer = setInterval(() => {
    void refreshLeaderboardSnapshots("interval").catch((error) => {
      console.error("Leaderboard snapshot refresh failed:", error);
    });
  }, LEADERBOARD_SNAPSHOT_REFRESH_MS);

  leaderboardSnapshotRefreshTimer.unref?.();
}

function queueLeaderboardSnapshotRefresh() {
  if (leaderboardSnapshotWriteTimer) {
    clearTimeout(leaderboardSnapshotWriteTimer);
  }

  leaderboardSnapshotWriteTimer = setTimeout(() => {
    leaderboardSnapshotWriteTimer = undefined;
    void refreshLeaderboardSnapshots("write").catch((error) => {
      console.error("Leaderboard snapshot refresh after write failed:", error);
    });
  }, LEADERBOARD_SNAPSHOT_WRITE_DELAY_MS);

  leaderboardSnapshotWriteTimer.unref?.();
}

async function refreshLeaderboardSnapshots(reason: string) {
  if (leaderboardSnapshotRefreshPromise) {
    return leaderboardSnapshotRefreshPromise;
  }

  leaderboardSnapshotRefreshPromise = refreshLeaderboardSnapshotsNow(reason)
    .catch((error) => {
      leaderboardSnapshotLastError = error instanceof Error ? error.message : String(error);
      throw error;
    })
    .finally(() => {
      leaderboardSnapshotRefreshPromise = undefined;
    });

  return leaderboardSnapshotRefreshPromise;
}

async function refreshLeaderboardSnapshotsNow(reason: string) {
  const refreshedAt = new Date().toISOString();
  const nextCache = new Map<string, LeaderboardSnapshotEntry>();
  const store = usageStore();
  const snapshotEvents = store.kind === "file" ? await store.listEvents() : null;

  for (const range of LEADERBOARD_SNAPSHOT_RANGES) {
    for (const metric of LEADERBOARD_SNAPSHOT_METRICS) {
      const { records, summary } = snapshotEvents
        ? {
            records: snapshotEvents.length,
            summary: buildTokenLeaderboard(snapshotEvents, { range, metric, now: new Date(refreshedAt) }),
          }
        : await readLiveUsageLeaderboard({
            range,
            metric,
            now: new Date(refreshedAt),
          });
      nextCache.set(leaderboardSnapshotKey(range, metric), {
        generatedAt: refreshedAt,
        key: leaderboardSnapshotKey(range, metric),
        metric,
        range,
        records,
        summary,
      });
    }
  }

  leaderboardSnapshotCache = nextCache;
  leaderboardSnapshotLastRefreshAt = refreshedAt;
  leaderboardSnapshotLastError = "";
  await writeLeaderboardSnapshotsToFile();
  console.log(
    `leaderboard snapshots refreshed (${reason}); entries=${leaderboardSnapshotCache.size}; generatedAt=${refreshedAt}`
  );
}

async function loadLeaderboardSnapshotsFromFile() {
  try {
    const text = await fs.readFile(LEADERBOARD_SNAPSHOT_FILE, "utf8");
    const parsed = JSON.parse(text) as unknown;

    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { entries?: unknown }).entries)) {
      return;
    }

    const nextCache = new Map<string, LeaderboardSnapshotEntry>();
    for (const entry of (parsed as { entries: unknown[] }).entries) {
      const normalized = normalizeLeaderboardSnapshotEntry(entry);
      if (normalized) {
        nextCache.set(normalized.key, normalized);
      }
    }

    if (nextCache.size) {
      leaderboardSnapshotCache = nextCache;
      leaderboardSnapshotLastRefreshAt =
        typeof (parsed as { generatedAt?: unknown }).generatedAt === "string"
          ? (parsed as { generatedAt: string }).generatedAt
          : "";
      console.log(`loaded ${nextCache.size} leaderboard snapshots from ${LEADERBOARD_SNAPSHOT_FILE}`);
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    console.error("Failed to load leaderboard snapshots:", error);
  }
}

async function writeLeaderboardSnapshotsToFile() {
  const entries = [...leaderboardSnapshotCache.values()];
  const payload = {
    schemaVersion: 1,
    generatedAt: leaderboardSnapshotLastRefreshAt || new Date().toISOString(),
    entries,
  };
  const dir = path.dirname(LEADERBOARD_SNAPSHOT_FILE);
  const tempFile = path.join(
    dir,
    `.${path.basename(LEADERBOARD_SNAPSHOT_FILE)}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`
  );

  await fs.mkdir(dir, { recursive: true });

  try {
    await fs.writeFile(tempFile, `${JSON.stringify(payload)}\n`);
    await fs.rename(tempFile, LEADERBOARD_SNAPSHOT_FILE);
  } catch (error) {
    await fs.rm(tempFile, { force: true }).catch(() => undefined);
    leaderboardSnapshotLastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

function normalizeLeaderboardSnapshotEntry(value: unknown): LeaderboardSnapshotEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<LeaderboardSnapshotEntry>;
  if (!entry.range || !isTokenBoardRange(entry.range) || !entry.metric || !isTokenBoardMetric(entry.metric)) {
    return null;
  }

  if (!entry.summary || typeof entry.summary !== "object" || !Array.isArray(entry.summary.users)) {
    return null;
  }

  return {
    generatedAt: typeof entry.generatedAt === "string" ? entry.generatedAt : new Date().toISOString(),
    key: leaderboardSnapshotKey(entry.range, entry.metric),
    metric: entry.metric,
    range: entry.range,
    records: Number.isFinite(entry.records) ? Number(entry.records) : 0,
    summary: entry.summary as TokenLeaderboardSummary,
  };
}

function leaderboardSnapshotKey(range: TokenBoardRange, metric: TokenBoardMetric) {
  return `${range}:${metric}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}

function shareStore() {
  if (!snapshotShareStore) {
    throw new Error("Snapshot share store is not initialized");
  }

  return snapshotShareStore;
}

function applyCors(request: IncomingMessage, response: ServerResponse) {
  const allowed = (process.env.TOKEN_BOARD_ALLOWED_ORIGINS || "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = request.headers.origin || "";
  const wildcard = allowed.includes("*");
  const explicitlyAllowed = Boolean(origin) && allowed.includes(origin);

  if (explicitlyAllowed) {
    // Only an explicitly allowlisted origin may be paired with credentials.
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
  } else if (wildcard) {
    // Wildcard config: reflect the origin for public reads but NEVER allow
    // credentials, so a malicious site cannot read a logged-in user's responses.
    response.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else {
    response.setHeader("Access-Control-Allow-Origin", allowed[0] || "*");
  }

  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Token-Board-Token");
  response.setHeader("Vary", "Origin");
}

function sessionCookie(token: string, request: IncomingMessage, maxAgeSeconds: number) {
  const sameSite = process.env.TOKEN_BOARD_COOKIE_SAMESITE || "Lax";
  const secure =
    process.env.TOKEN_BOARD_COOKIE_SECURE === "true" ||
    (process.env.TOKEN_BOARD_COOKIE_SECURE !== "false" && publicBaseUrl(request).startsWith("https://"));
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function clearSessionCookie(request: IncomingMessage) {
  return sessionCookie("", request, 0);
}

function redirect(response: ServerResponse, location: string) {
  response.writeHead(302, { Location: location });
  response.end();
}

function sendJson(request: IncomingMessage, response: ServerResponse, status: number, payload: unknown) {
  applyCors(request, response);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendCsv(request: IncomingMessage, response: ServerResponse, status: number, csv: string) {
  applyCors(request, response);
  response.writeHead(status, {
    "Content-Type": "text/csv; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(csv);
}

function sendSvg(request: IncomingMessage, response: ServerResponse, status: number, svg: string) {
  applyCors(request, response);
  response.writeHead(status, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
  response.end(svg);
}

function exportContentDisposition(scope: "leaderboard" | "me", range: TokenBoardRange, format: "csv" | "json") {
  const day = new Date().toISOString().slice(0, 10);
  return `attachment; filename="token-board-${scope}-${range.toLowerCase()}-${day}.${format}"`;
}

async function run() {
  const command = process.argv[2] || "serve";

  if (command === "serve" || command === "server") {
    await main();
    return;
  }

  if (command === "migrate-json") {
    await migrateJson();
    return;
  }

  throw new Error(`Unknown token-board command: ${command}`);
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
