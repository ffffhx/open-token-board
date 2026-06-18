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
  buildTokenAccountUsageProfile,
  buildTokenLeaderboard,
  type TokenBoardMetric,
  type TokenBoardRange,
  type TokenLeaderboardSummary,
} from "@open-token-board/core";
import { analyzeCodexRateLimits } from "@open-token-board/core/codex-rate-limits";
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

const PORT = Number(process.env.TOKEN_BOARD_PORT || 8787);
const HOST = process.env.TOKEN_BOARD_HOST || "127.0.0.1";
const DATA_FILE = process.env.TOKEN_BOARD_DATA_FILE || path.join(process.cwd(), ".token-board", "usage-events.json");
const USERS_FILE = process.env.TOKEN_BOARD_USERS_FILE || path.join(process.cwd(), ".token-board", "users.json");
const MAX_BODY_BYTES = positiveNumberEnv(process.env.TOKEN_BOARD_MAX_BODY_BYTES, 4 * 1024 * 1024);
const MAX_EVENTS = positiveNumberEnv(process.env.TOKEN_BOARD_MAX_EVENTS, 100_000);
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
const DEFAULT_SELECTION_EXPLAIN_ALLOWED_GITHUB_LOGINS = ["ffffhx"];
const SESSION_COOKIE_NAME = "token_board_session";
const WEB_SESSION_TTL_SECONDS = Number(process.env.TOKEN_BOARD_WEB_SESSION_TTL_SECONDS || 30 * 24 * 60 * 60);
const AGENT_SESSION_TTL_SECONDS = Number(process.env.TOKEN_BOARD_AGENT_SESSION_TTL_SECONDS || 180 * 24 * 60 * 60);
const OAUTH_STATE_TTL_SECONDS = 15 * 60;
let tokenUsageStore: TokenUsageStore | undefined;
let snapshotShareStore: SnapshotShareStore | undefined;
const GLOBAL_SUMMARY_CACHE_MS = 10_000;
let globalSummaryCache: { key: string; at: number; value: unknown } | undefined;
const LEADERBOARD_SNAPSHOT_RANGES: TokenBoardRange[] = ["1D", "7D", "30D", "90D"];
const LEADERBOARD_SNAPSHOT_METRICS: TokenBoardMetric[] = ["tokens", "cost", "sessions", "messages"];
let leaderboardSnapshotCache = new Map<string, LeaderboardSnapshotEntry>();
let leaderboardSnapshotRefreshPromise: Promise<void> | undefined;
let leaderboardSnapshotRefreshTimer: NodeJS.Timeout | undefined;
let leaderboardSnapshotWriteTimer: NodeJS.Timeout | undefined;
let leaderboardSnapshotLastRefreshAt = "";
let leaderboardSnapshotLastError = "";

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

  if (request.method === "GET" && url.pathname === "/api/usage/rate-limits") {
    const daysParam = Number(url.searchParams.get("days"));
    const lookbackDays = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(90, daysParam) : undefined;
    const report = await analyzeCodexRateLimits({ lookbackDays, cacheMs: 8000 });
    sendJson(request, response, 200, report);
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
    const range = parseRange(url.searchParams.get("range"));
    const metric = parseMetric(url.searchParams.get("metric"));
    const now = parseNow(url.searchParams.get("now"));
    const { generatedAt, records, source, summary } = await readUsageLeaderboard({
      range,
      metric,
      now,
      preferSnapshot: !url.searchParams.has("now"),
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

  if (request.method === "GET" && url.pathname === "/api/usage/me") {
    const identity = readWebIdentity(request);

    if (!identity) {
      sendJson(request, response, 401, { error: "GitHub login required" });
      return;
    }

    const range = parseRange(url.searchParams.get("range"));
    const now = parseNow(url.searchParams.get("now"));
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
      preferSnapshot: !url.searchParams.has("now"),
    });
    const rankedUser = summary.users.find((entry) => entry.userId === identity.userId) ?? null;
    const totalUsers = summary.users.length;
    const rank = rankedUser?.rank ?? null;
    const { summary: previousSummary } = await readUsageLeaderboard({
      range,
      metric: "tokens",
      now: new Date(summary.startAt),
    });
    const previousRank = previousSummary.users.find((entry) => entry.userId === identity.userId)?.rank ?? null;
    profile.rank = rank;
    profile.previousRank = previousRank;
    profile.rankDelta = rank !== null && previousRank !== null ? previousRank - rank : null;
    profile.totalUsers = totalUsers;
    profile.percentile = rank !== null && totalUsers > 0 ? (totalUsers - rank) / totalUsers : null;
    if (profile.user && rankedUser) {
      profile.user.rank = rankedUser.rank;
      profile.user.share = rankedUser.share;
      profile.user.deltaTokens = rankedUser.deltaTokens;
    }
    const userConfig = await store.getUserConfig(identity.userId);

    sendJson(request, response, 200, {
      schemaVersion: 1,
      source: "server",
      records: profile.records,
      totalRecords: await store.countEvents(),
      generatedAt: new Date().toISOString(),
      user: identity,
      profile: {
        ...profile,
        config: userConfig,
      },
    });
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

  const sanitized = rawEvents.length
    ? sanitizeIngestEvents(rawEvents, identity, ingestPrivacyOptions())
    : { entries: [], errors: [] };

  if (!sanitized.entries.length && sanitized.errors.length && !userConfig) {
    sendJson(request, response, 400, {
      error: "No valid token usage events",
      errors: sanitized.errors,
    });
    return;
  }

  const store = usageStore();
  if (userConfig) {
    await store.upsertUserConfig(identity.userId, userConfig);
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

  const sanitized = rawEvents.length
    ? sanitizeIngestEvents(rawEvents, identity, ingestPrivacyOptions())
    : { entries: [], errors: [] };

  if (!sanitized.entries.length && sanitized.errors.length && !userConfig) {
    sendJson(request, response, 400, {
      error: "No valid token usage events",
      errors: sanitized.errors,
    });
    return;
  }

  const store = usageStore();
  if (userConfig) {
    await store.upsertUserConfig(identity.userId, userConfig);
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

function parseRange(value: string | null): TokenBoardRange {
  return value && isTokenBoardRange(value) ? value : "7D";
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
}: {
  range: TokenBoardRange;
  metric: TokenBoardMetric;
  now: Date;
  preferSnapshot?: boolean;
}): Promise<UsageLeaderboardReadResult> {
  if (preferSnapshot) {
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

  const live = await readLiveUsageLeaderboard({ range, metric, now });

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
}: {
  range: TokenBoardRange;
  metric: TokenBoardMetric;
  now: Date;
}) {
  const store = usageStore();

  if (store.getLeaderboardSummary) {
    return store.getLeaderboardSummary({ range, metric, now });
  }

  const events = await store.listEvents();

  return {
    records: events.length,
    summary: buildTokenLeaderboard(events, { range, metric, now }),
  };
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

  for (const range of LEADERBOARD_SNAPSHOT_RANGES) {
    const { records, summary } = await readLiveUsageLeaderboard({
      range,
      metric: "tokens",
      now: new Date(refreshedAt),
    });

    for (const metric of LEADERBOARD_SNAPSHOT_METRICS) {
      const metricSummary = summaryForMetric(summary, metric);
      nextCache.set(leaderboardSnapshotKey(range, metric), {
        generatedAt: refreshedAt,
        key: leaderboardSnapshotKey(range, metric),
        metric,
        range,
        records,
        summary: metricSummary,
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

function summaryForMetric(summary: TokenLeaderboardSummary, metric: TokenBoardMetric): TokenLeaderboardSummary {
  return {
    ...summary,
    users: [...summary.users]
      .sort((left, right) => leaderboardMetricValue(right, metric) - leaderboardMetricValue(left, metric) || left.displayName.localeCompare(right.displayName))
      .map((user, index) => ({ ...user, rank: index + 1 })),
  };
}

function leaderboardMetricValue(user: TokenLeaderboardSummary["users"][number], metric: TokenBoardMetric) {
  if (metric === "cost") {
    return user.costUsd;
  }

  if (metric === "sessions") {
    return user.sessions;
  }

  if (metric === "messages") {
    return user.messages;
  }

  return user.tokens;
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

  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
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
