import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";

import type { CodexRateLimitReport, CodexRateWindow, CodexRateWindowKey } from "./codex-rate-limits";
import {
  dedupeTokenEvents,
  normalizeTokenUsageEvent,
  type TokenBoardMetric,
  type TokenBoardRange,
  type TokenBoardUserConfig,
  type TokenUsageEvent,
} from "./token-leaderboard";

export type TokenBoardUploadUser = {
  userId: string;
  displayName: string;
  team?: string;
  uploadToken?: string;
  uploadTokenHash?: string;
  disabled?: boolean;
};

export type TokenBoardPrivacyOptions = {
  projectMode?: "basename" | "hash" | "none";
  includeModel?: boolean;
  includeSource?: boolean;
  hashSessionId?: boolean;
  includeSessionTitle?: boolean;
  maxEventAgeDays?: number;
  // Sources rejected wholesale at ingest. Server-side blocking is the only guard
  // that reaches old agents in the wild that still collect an unsupported source.
  blockedSources?: string[];
};

export type TokenBoardIngestPayload = {
  schemaVersion?: number;
  client?: {
    name?: string;
    version?: string;
    collectorSchemaVersion?: number;
    hostId?: string;
    platform?: string;
  };
  userConfig?: Partial<TokenBoardUserConfig>;
  events?: Array<Partial<TokenUsageEvent>>;
};

export type TokenBoardIngestResult = {
  entries: TokenUsageEvent[];
  errors: string[];
};

const DEFAULT_MAX_EVENT_AGE_DAYS = 120;
// Trae support was removed entirely (no reliable per-call usage data); block both
// the legacy raw source and the sampled variant so stale agents can't re-add it.
const DEFAULT_BLOCKED_SOURCES = ["trae", "trae-sampled"];

export function hashUploadToken(token: string) {
  return `sha256:${sha256(token)}`;
}

export function normalizeUploadUsers(value: unknown): TokenBoardUploadUser[] {
  const rawUsers = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { users?: unknown }).users)
      ? (value as { users: unknown[] }).users
      : [];

  return rawUsers.flatMap((rawUser) => {
    if (!rawUser || typeof rawUser !== "object") {
      return [];
    }

    const record = rawUser as Record<string, unknown>;
    const userId = sanitizeLabel(record.userId ?? record.user ?? record.username, 80);
    const displayName = sanitizeLabel(record.displayName ?? record.name ?? record.username ?? userId, 80);

    if (!userId || !displayName) {
      return [];
    }

    return [
      {
        userId,
        displayName,
        team: sanitizeLabel(record.team ?? record.group, 80) || undefined,
        uploadToken: sanitizeSecret(record.uploadToken ?? record.token),
        uploadTokenHash: sanitizeSecret(record.uploadTokenHash ?? record.tokenHash),
        disabled: record.disabled === true,
      },
    ];
  });
}

export function findUserByUploadToken(users: TokenBoardUploadUser[], token: string) {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    return undefined;
  }

  return users.find((user) => {
    if (user.disabled) {
      return false;
    }

    const configuredHash = user.uploadTokenHash || (user.uploadToken ? hashUploadToken(user.uploadToken) : "");
    return timingSafeTokenEqual(configuredHash, hashUploadToken(normalizedToken));
  });
}

export function sanitizeIngestEvents(
  events: Array<Partial<TokenUsageEvent>>,
  user: TokenBoardUploadUser,
  options: TokenBoardPrivacyOptions = {}
): TokenBoardIngestResult {
  const errors: string[] = [];
  const now = Date.now();
  const maxAgeDays = options.maxEventAgeDays ?? DEFAULT_MAX_EVENT_AGE_DAYS;
  const minTime = now - maxAgeDays * 24 * 60 * 60 * 1000;
  const blockedSources = new Set(
    (options.blockedSources ?? DEFAULT_BLOCKED_SOURCES).map((item) => item.trim().toLowerCase()).filter(Boolean)
  );

  const entries = events.flatMap((event, index) => {
    try {
      const normalized = normalizeTokenUsageEvent(event);
      const timestamp = new Date(normalized.timestamp).getTime();

      if (!Number.isFinite(timestamp) || timestamp < minTime || timestamp > now + 24 * 60 * 60 * 1000) {
        errors.push(`第 ${index + 1} 条记录时间超出允许范围`);
        return [];
      }

      if (normalized.totalTokens <= 0) {
        errors.push(`第 ${index + 1} 条记录没有 token 用量`);
        return [];
      }

      const rawSource = sanitizeLabel(normalized.source, 60).toLowerCase();
      if (blockedSources.has(rawSource)) {
        errors.push(`第 ${index + 1} 条记录来源 ${rawSource} 已被屏蔽（该来源没有可靠的逐调用用量数据）`);
        return [];
      }

      const project = sanitizeProjectName(normalized.project, options.projectMode ?? "basename");
      const upstreamEventId = sanitizeUpstreamEventId(normalized.upstreamEventId);
      const sessionId =
        options.hashSessionId === false
          ? sanitizeLabel(normalized.sessionId, 120)
          : normalized.sessionId
            ? sanitizeSessionId(normalized.sessionId)
            : "";
      const source = options.includeSource === false ? "local-agent" : sanitizeLabel(normalized.source, 60) || "local-agent";
      const model = options.includeModel === false ? "hidden" : sanitizeLabel(normalized.model, 80) || "unknown";
      const sessionTitle =
        options.includeSessionTitle === false ? "" : sanitizeSessionTitle(normalized.sessionTitle);
      const stableId = stableTokenEventId({
        ...normalized,
        userId: user.userId,
        displayName: user.displayName,
        team: user.team || "Friends",
        project,
        sessionId,
        sessionTitle,
        source,
        model,
        upstreamEventId,
      });

      return [
        normalizeTokenUsageEvent({
          ...normalized,
          id: stableId,
          upstreamEventId,
          userId: user.userId,
          displayName: user.displayName,
          team: user.team || "Friends",
          source,
          tool: sanitizeLabel(normalized.tool, 60) || source,
          model,
          // When the model is hidden, drop the original cost so it cannot be used to
          // reverse-infer the model from its per-token rate (re-estimated as 0 for "hidden").
          costUsd: options.includeModel === false ? undefined : normalized.costUsd,
          project,
          sessionId,
          sessionTitle,
        }),
      ];
    } catch (error) {
      const message = error instanceof Error ? error.message : "解析失败";
      errors.push(`第 ${index + 1} 条记录${message}`);
      return [];
    }
  });

  return { entries: dedupeTokenEvents(entries), errors };
}

export function mergeTokenEvents(existing: TokenUsageEvent[], incoming: TokenUsageEvent[], maxEvents = 0) {
  // Incoming events are listed last so that on an id collision the fresher event
  // wins in dedupeTokenEvents (later set() overwrites). This lets a re-ingested
  // event carry an updated session title instead of being shadowed by the old one.
  const merged = dedupeTokenEvents([...existing, ...incoming]);
  return maxEvents > 0 ? merged.slice(0, maxEvents) : merged;
}

export function sanitizeTokenBoardUserConfig(
  value: unknown,
  client: TokenBoardIngestPayload["client"] = {}
): TokenBoardUserConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const record = value;
  const agentRecord = isRecord(record.agent) ? record.agent : {};
  const codexRecord = isRecord(record.codex) ? record.codex : {};
  const agent = compactObject({
    name: sanitizeLabel(agentRecord.name ?? client?.name, 60) || undefined,
    version: sanitizeLabel(agentRecord.version ?? client?.version, 40) || undefined,
    platform: sanitizePlatform(agentRecord.platform ?? client?.platform),
  });
  const codex = compactObject({
    model: sanitizeLabel(codexRecord.model, 80) || undefined,
    modelReasoningEffort: sanitizeLabel(codexRecord.modelReasoningEffort ?? codexRecord.model_reasoning_effort, 40) || undefined,
    modelContextWindow: sanitizePositiveInteger(codexRecord.modelContextWindow ?? codexRecord.model_context_window),
    modelAutoCompactTokenLimit: sanitizePositiveInteger(
      codexRecord.modelAutoCompactTokenLimit ?? codexRecord.model_auto_compact_token_limit
    ),
    modelCacheContextWindow: sanitizePositiveInteger(codexRecord.modelCacheContextWindow ?? codexRecord.model_cache_context_window),
    modelMaxContextWindow: sanitizePositiveInteger(codexRecord.modelMaxContextWindow ?? codexRecord.model_max_context_window),
    effectiveContextWindowPercent: sanitizePercent(
      codexRecord.effectiveContextWindowPercent ?? codexRecord.effective_context_window_percent
    ),
  });
  const hasAgent = Boolean(agent.name || agent.version || agent.platform);
  const hasCodex = Object.values(codex).some((item) => item !== undefined);
  const rateLimits = sanitizeCodexRateLimits(record.rateLimits ?? record.rate_limits);
  const claudeCodeRateLimits = sanitizeCodexRateLimits(
    record.claudeCodeRateLimits ?? record.claude_code_rate_limits
  );

  if (!hasAgent && !hasCodex && !rateLimits && !claudeCodeRateLimits) {
    return null;
  }

  return {
    updatedAt: sanitizeIsoDate(record.updatedAt) || new Date().toISOString(),
    ...(hasAgent ? { agent } : {}),
    ...(hasCodex ? { codex } : {}),
    ...(rateLimits ? { rateLimits } : {}),
    ...(claudeCodeRateLimits ? { claudeCodeRateLimits } : {}),
  };
}

function sanitizeCodexRateLimits(value: unknown): CodexRateLimitReport | null {
  if (!isRecord(value)) {
    return null;
  }

  const generatedAt = sanitizeIsoDate(value.generatedAt);
  const latestEventAt = sanitizeIsoDate(value.latestEventAt) || null;
  const windows = Array.isArray(value.windows)
    ? value.windows.flatMap((window) => {
        const sanitized = sanitizeCodexRateWindow(window);
        return sanitized ? [sanitized] : [];
      })
    : [];
  const sourcePaths = Array.isArray(value.sourcePaths)
    ? value.sourcePaths.flatMap((item) => {
        const text = sanitizeLabel(item, 240);
        return text ? [text] : [];
      }).slice(0, 8)
    : [];
  const notes = Array.isArray(value.notes)
    ? value.notes.flatMap((item) => {
        const text = sanitizeLabel(item, 280);
        return text ? [text] : [];
      }).slice(0, 8)
    : [];

  return {
    generatedAt: generatedAt || new Date().toISOString(),
    available: value.available === true && windows.length > 0,
    plan: sanitizeLabel(value.plan, 40) || null,
    latestEventAt,
    windows,
    recentTokensPerHour: sanitizeNonNegativeNumberOrNull(value.recentTokensPerHour),
    notes,
    sourcePaths,
  };
}

function sanitizeCodexRateWindow(value: unknown): CodexRateWindow | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawKey = sanitizeLabel(value.key, 20);
  const key: CodexRateWindowKey | null = rawKey === "5h" || rawKey === "weekly" ? rawKey : null;
  if (!key) {
    return null;
  }

  const windowMinutes = sanitizePositiveInteger(value.windowMinutes);
  const label = sanitizeLabel(value.label, 20) || (key === "5h" ? "5 小时" : "每周");
  const observedAt = sanitizeIsoDate(value.observedAt);
  const usedPercent = sanitizePercent(value.usedPercent);
  const remainingPercent = sanitizePercent(value.remainingPercent);

  if (!windowMinutes || !observedAt || usedPercent === undefined || remainingPercent === undefined) {
    return null;
  }

  const burnPercentPerHour = sanitizeNonNegativeNumberOrNull(value.burnPercentPerHour);
  const estimatedCapacityTokens = sanitizeNonNegativeIntegerOrNull(value.estimatedCapacityTokens);
  const burnTokensPerHour =
    sanitizeNonNegativeIntegerOrNull(value.burnTokensPerHour ?? value.burn_tokens_per_hour) ??
    (burnPercentPerHour !== null && estimatedCapacityTokens !== null
      ? Math.round((estimatedCapacityTokens * burnPercentPerHour) / 100)
      : null);

  return {
    key,
    windowMinutes,
    label,
    usedPercent,
    remainingPercent,
    resetsAt: sanitizeIsoDate(value.resetsAt) || null,
    resetsInSeconds: sanitizeIntegerOrNull(value.resetsInSeconds),
    observedAt,
    staleSeconds: sanitizeNonNegativeInteger(value.staleSeconds) ?? 0,
    burnPercentPerHour,
    burnTokensPerHour,
    etaSeconds: sanitizeIntegerOrNull(value.etaSeconds),
    etaAt: sanitizeIsoDate(value.etaAt) || null,
    willExhaustBeforeReset: value.willExhaustBeforeReset === true,
    estimatedCapacityTokens,
    estimatedRemainingTokens: sanitizeNonNegativeIntegerOrNull(value.estimatedRemainingTokens),
    localConsumedTokensThisWindow: sanitizeNonNegativeIntegerOrNull(value.localConsumedTokensThisWindow),
  };
}

export function sanitizeProjectName(value: unknown, mode: TokenBoardPrivacyOptions["projectMode"] = "basename") {
  const text = sanitizeLabel(value, 240);

  if (!text || mode === "none") {
    return undefined;
  }

  if (mode === "hash") {
    return `project:${sha256(text).slice(0, 12)}`;
  }

  return sanitizeLabel(path.basename(text.replace(/\\/g, "/")), 80) || undefined;
}

export function createIngestPayload(
  events: TokenUsageEvent[],
  client: TokenBoardIngestPayload["client"] = { name: "token-usage-agent" },
  userConfig?: TokenBoardUserConfig | null
): TokenBoardIngestPayload {
  return {
    schemaVersion: 1,
    client,
    ...(userConfig ? { userConfig } : {}),
    events,
  };
}

export function isTokenBoardRange(value: string): value is TokenBoardRange {
  return (
    value === "today" ||
    value === "1D" ||
    value === "7D" ||
    value === "30D" ||
    value === "90D" ||
    value === "week" ||
    value === "month" ||
    value === "lastweek" ||
    value === "lastmonth"
  );
}

export function isTokenBoardMetric(value: string): value is TokenBoardMetric {
  return (
    value === "tokens" ||
    value === "cost" ||
    value === "sessions" ||
    value === "messages" ||
    value === "users" ||
    value === "lines"
  );
}

function stableTokenEventId(event: TokenUsageEvent) {
  if (event.upstreamEventId) {
    return `usage:v2:${sha256([event.userId, event.source, event.upstreamEventId].join("\n")).slice(0, 32)}`;
  }

  // Compatibility fallback for old/custom collectors without an immutable key.
  return `usage:v1:${sha256(
    [
      event.userId,
      event.timestamp,
      event.source,
      event.model,
      event.project || "",
      event.sessionId || "",
      event.inputTokens,
      event.cacheCreationInputTokens,
      event.cachedInputTokens,
      event.outputTokens,
      event.reasoningOutputTokens,
      event.totalTokens,
    ].join("\n")
  ).slice(0, 32)}`;
}

function sanitizeUpstreamEventId(value: unknown) {
  const text = sanitizeLabel(value, 160);
  if (!text) {
    return "";
  }
  return text.startsWith("upstream:") ? text : `upstream:${sha256(text).slice(0, 32)}`;
}

function sanitizeSessionId(value: string) {
  const text = sanitizeLabel(value, 120);
  return /^session:[a-f0-9]{16}$/i.test(text) ? text.toLowerCase() : `session:${sha256(text).slice(0, 16)}`;
}

function timingSafeTokenEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(normalizeTokenHash(left));
  const rightBuffer = Buffer.from(normalizeTokenHash(right));

  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeTokenHash(value: string) {
  return sanitizeSecret(value).replace(/^sha256:/, "");
}

function sanitizeSecret(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeLabel(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeSessionTitle(value: unknown) {
  const text = sanitizeLabel(value, 120)
    .replace(/^#+\s*/, "")
    .replace(/```.*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const lower = text.toLowerCase();

  if (!text || lower === "none" || lower === "auto" || lower === "unknown" || lower === "n/a") {
    return "";
  }

  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function sanitizePositiveInteger(value: unknown) {
  const number = typeof value === "string" ? Number(value.replace(/_/g, "")) : Number(value);

  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
}

function sanitizeNonNegativeInteger(value: unknown) {
  const number = typeof value === "string" ? Number(value.replace(/_/g, "")) : Number(value);

  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined;
}

function sanitizeIntegerOrNull(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const number = typeof value === "string" ? Number(value.replace(/_/g, "")) : Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function sanitizeNonNegativeIntegerOrNull(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  return sanitizeNonNegativeInteger(value) ?? null;
}

function sanitizeNonNegativeNumberOrNull(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const number = typeof value === "string" ? Number(value.replace(/_/g, "")) : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function sanitizePercent(value: unknown) {
  const number = typeof value === "string" ? Number(value.replace(/%$/, "")) : Number(value);

  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : undefined;
}

function sanitizeIsoDate(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const time = new Date(value).getTime();

  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function sanitizePlatform(value: unknown) {
  const text = sanitizeLabel(value, 40).toLowerCase();

  if (text === "darwin" || text === "macos" || text === "mac") {
    return "macOS";
  }

  if (text === "win32" || text === "windows" || text === "win") {
    return "Windows";
  }

  if (text === "linux") {
    return "Linux";
  }

  return text || undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as Partial<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
