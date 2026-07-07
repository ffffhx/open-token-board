import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  dedupeTokenEvents,
  normalizeTokenUsageEvent,
  parseTokenUsageImport,
  type TokenBoardUserConfig,
  type TokenUsageEvent,
} from "./token-leaderboard";

export type TokenUsageCollectorConfig = {
  userId?: string;
  displayName?: string;
  team?: string;
  usagePaths?: string[];
  includeDefaultSources?: boolean;
  sinceHours?: number;
  maxFiles?: number;
  maxFileBytes?: number;
  maxCodexFileBytes?: number;
};

type SourceTarget = {
  source: string;
  tool: string;
  paths: string[];
};

type ExtractionContext = {
  source: string;
  tool: string;
  filePath?: string;
  userId?: string;
  displayName?: string;
  team?: string;
  timestamp?: string;
  model?: string;
  project?: string;
  sessionId?: string;
  sessionTitle?: string;
};

type SessionQualityCounts = {
  errorCount: number;
  interruptedCount: number;
  toolCallCount: number;
};

const DEFAULT_SINCE_HOURS = 24 * 30;
const DEFAULT_MAX_FILES = 800;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_CODEX_FILE_BYTES = 256 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const TOKEN_KEYS = new Set([
  "cached_input_tokens",
  "cachedInputTokens",
  "cache_creation_input_tokens",
  "cache_creation_input_tokens_1h",
  "cache_creation_input_tokens_5m",
  "cache_read_input_tokens",
  "cacheCreationInputTokens",
  "cacheCreationInputTokens1h",
  "cacheCreationInputTokens5m",
  "cacheReadInputTokens",
  "completion_tokens",
  "completionTokens",
  "ephemeral_1h_input_tokens",
  "ephemeral_5m_input_tokens",
  "ephemeral1hInputTokens",
  "ephemeral5mInputTokens",
  "input_tokens",
  "inputTokenCount",
  "inputTokens",
  "output_tokens",
  "outputTokenCount",
  "outputTokens",
  "prompt_tokens",
  "promptTokens",
  "reasoning_output_tokens",
  "reasoningOutputTokens",
  "total_tokens",
  "totalTokenCount",
  "totalTokens",
  "tokens",
]);
// A record only counts as a leaf usage event when it carries an input/output token
// key — the rollup-only keys (total_tokens/tokens) are deliberately excluded so a
// node that reports just a grand total does not shadow real usage in its children.
const USAGE_SHAPE_KEYS = new Set([
  "cached_input_tokens",
  "cachedInputTokens",
  "cache_creation_input_tokens",
  "cache_creation_input_tokens_1h",
  "cache_creation_input_tokens_5m",
  "cache_read_input_tokens",
  "cacheCreationInputTokens",
  "cacheCreationInputTokens1h",
  "cacheCreationInputTokens5m",
  "cacheReadInputTokens",
  "completion_tokens",
  "completionTokens",
  "ephemeral_1h_input_tokens",
  "ephemeral_5m_input_tokens",
  "ephemeral1hInputTokens",
  "ephemeral5mInputTokens",
  "input_tokens",
  "inputTokenCount",
  "inputTokens",
  "output_tokens",
  "outputTokenCount",
  "outputTokens",
  "prompt_tokens",
  "promptTokens",
  "reasoning_output_tokens",
  "reasoningOutputTokens",
]);

export async function collectLocalTokenUsage(config: TokenUsageCollectorConfig = {}) {
  const targets = buildSourceTargets(config);
  const codexTitleIndex = await readCodexTitleIndex(targets);
  const maxFiles = config.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileBytes = config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxCodexFileBytes = config.maxCodexFileBytes ?? DEFAULT_MAX_CODEX_FILE_BYTES;
  const sinceMs = Date.now() - (config.sinceHours ?? DEFAULT_SINCE_HOURS) * 60 * 60 * 1000;

  // Gather every candidate file across all targets first, then keep the globally
  // newest up to maxFiles. This makes maxFiles a single shared budget (instead of
  // resetting per target) and guarantees the most recent sessions are never dropped
  // in favor of older ones from an earlier directory.
  const candidates: Array<{ filePath: string; mtimeMs: number; target: SourceTarget }> = [];
  const seenRealPaths = new Set<string>();
  for (const target of targets) {
    for (const targetPath of target.paths) {
      const files = await listUsageFiles(expandHome(targetPath), {
        source: target.source,
        maxFileBytes,
        maxCodexFileBytes,
        sinceMs,
      });
      for (const file of files) {
        // Dedupe by resolved real path so the same file reached through overlapping
        // roots, a symlink, or a "../" spelling is only collected (and counted) once.
        let realPath = file.path;
        try {
          realPath = await fs.realpath(file.path);
        } catch {
          // fall back to the raw path if it cannot be resolved
        }
        if (seenRealPaths.has(realPath)) {
          continue;
        }
        seenRealPaths.add(realPath);
        candidates.push({ filePath: file.path, mtimeMs: file.mtimeMs, target });
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const entries: TokenUsageEvent[] = [];
  for (const { filePath, target } of candidates.slice(0, Math.max(0, maxFiles))) {
    entries.push(
      ...(await parseUsageFile(filePath, {
        source: target.source,
        tool: target.tool,
        filePath,
        userId: config.userId,
        displayName: config.displayName,
        team: config.team,
        project: path.basename(path.dirname(filePath)),
        sessionId: path.basename(filePath),
        sessionTitle: target.source === "codex" ? codexTitleIndex.get(sessionIdFromPath(filePath)) : undefined,
      }))
    );
  }

  return dedupeTokenEvents(entries);
}

export async function collectTokenBoardUserConfig({
  agentName = "token-usage-agent",
  agentVersion = "dev",
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  platform = os.platform(),
}: {
  agentName?: string;
  agentVersion?: string;
  codexHome?: string;
  platform?: string;
} = {}): Promise<TokenBoardUserConfig | null> {
  const codex = await readCodexConfigSummary(codexHome);
  const hasCodex = Object.values(codex).some((value) => value !== undefined && value !== "");

  return {
    updatedAt: new Date().toISOString(),
    agent: {
      name: agentName,
      version: agentVersion,
      platform: normalizePlatform(platform),
    },
    ...(hasCodex ? { codex } : {}),
  };
}

async function readCodexConfigSummary(codexHome: string): Promise<NonNullable<TokenBoardUserConfig["codex"]>> {
  const topLevelConfig = await readCodexTopLevelConfig(path.join(codexHome, "config.toml"));
  const model = normalizeTextField(topLevelConfig.model);
  const modelCache = await readCodexModelCacheSummary(path.join(codexHome, "models_cache.json"), model);

  return {
    model: model || undefined,
    modelReasoningEffort: normalizeTextField(topLevelConfig.model_reasoning_effort) || undefined,
    modelContextWindow: positiveInteger(topLevelConfig.model_context_window),
    modelAutoCompactTokenLimit: positiveInteger(topLevelConfig.model_auto_compact_token_limit),
    ...modelCache,
  };
}

async function readCodexTopLevelConfig(filePath: string) {
  let text = "";

  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    return {} as Record<string, unknown>;
  }

  const result: Record<string, unknown> = {};
  let inSection = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();

    if (!line) {
      continue;
    }

    if (line.startsWith("[")) {
      inSection = true;
      continue;
    }

    if (inSection) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (match) {
      result[match[1]] = parseTomlScalar(match[2]);
    }
  }

  return result;
}

async function readCodexModelCacheSummary(
  filePath: string,
  model: string
): Promise<Pick<
  NonNullable<TokenBoardUserConfig["codex"]>,
  "effectiveContextWindowPercent" | "modelCacheContextWindow" | "modelMaxContextWindow"
>> {
  if (!model) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    return {};
  }

  const modelRecord = parsed.models.find((item) => isRecord(item) && modelMatchesCacheEntry(item, model));

  if (!isRecord(modelRecord)) {
    return {};
  }

  return {
    modelCacheContextWindow: positiveInteger(modelRecord.context_window),
    modelMaxContextWindow: positiveInteger(modelRecord.max_context_window),
    effectiveContextWindowPercent: percentNumber(modelRecord.effective_context_window_percent),
  };
}

async function readCodexTitleIndex(targets: SourceTarget[]) {
  const codexHomes = new Set<string>([path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"))]);

  for (const target of targets) {
    if (target.source !== "codex") {
      continue;
    }

    for (const targetPath of target.paths) {
      const home = inferCodexHome(expandHome(targetPath));
      if (home) {
        codexHomes.add(home);
      }
    }
  }

  const titles = new Map<string, string>();
  for (const codexHome of codexHomes) {
    const indexPath = path.join(codexHome, "session_index.jsonl");
    let raw = "";
    try {
      raw = await fs.readFile(indexPath, "utf8");
    } catch {
      continue;
    }

    for (const line of raw.split(/\r?\n/)) {
      const parsed = safeJsonParse(line);
      if (!isRecord(parsed)) {
        continue;
      }

      const id = normalizeTextField(parsed.id);
      const title = sanitizeSessionTitle(
        normalizeTextField(parsed.thread_name) ||
          normalizeTextField(parsed.threadName) ||
          normalizeTextField(parsed.title)
      );
      if (id && title) {
        titles.set(id, title);
      }
    }
  }

  return titles;
}

function inferCodexHome(targetPath: string) {
  const parts = path.resolve(targetPath).split(path.sep);
  const dotCodexIndex = parts.lastIndexOf(".codex");
  if (dotCodexIndex >= 0) {
    return parts.slice(0, dotCodexIndex + 1).join(path.sep) || path.sep;
  }

  const base = path.basename(targetPath);
  if (base === "sessions" || base === "archived_sessions" || base === "projects") {
    return path.dirname(targetPath);
  }

  return "";
}

function sessionIdFromPath(filePath: string) {
  const base = path.basename(filePath, ".jsonl");
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? match[1] : base.replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, "");
}

function normalizeTextField(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function stripTomlComment(line: string) {
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = line[index - 1];

    if (char === '"' && previous !== "\\") {
      quoted = !quoted;
    }

    if (!quoted && char === "#") {
      return line.slice(0, index);
    }
  }

  return line;
}

function parseTomlScalar(value: string) {
  const trimmed = value.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }

  if (/^-?\d[\d_]*(?:\.\d[\d_]*)?$/.test(trimmed)) {
    return Number(trimmed.replace(/_/g, ""));
  }

  if (trimmed === "true" || trimmed === "false") {
    return trimmed === "true";
  }

  return trimmed;
}

function modelMatchesCacheEntry(record: Record<string, unknown>, model: string) {
  return [record.id, record.model, record.slug, record.name].some((value) => normalizeTextField(value) === model);
}

function positiveInteger(value: unknown) {
  const number = typeof value === "string" ? Number(value.replace(/_/g, "")) : Number(value);

  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
}

function percentNumber(value: unknown) {
  const number = typeof value === "string" ? Number(value.replace(/%$/, "")) : Number(value);

  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : undefined;
}

function normalizePlatform(value: string) {
  const platform = value.toLowerCase();

  if (platform === "darwin") {
    return "macOS";
  }

  if (platform === "win32") {
    return "Windows";
  }

  return value;
}

export function extractTokenUsageEventsFromJson(value: unknown, context: ExtractionContext) {
  const entries: TokenUsageEvent[] = [];

  visitJson(value, context, entries, { sequence: 0 }, 0);

  return dedupeTokenEvents(entries);
}

async function readUsageFileText(filePath: string): Promise<string | null> {
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return null;
  }

  // Decode by BOM: UTF-16LE / UTF-16BE files (e.g. Windows/Excel exports) would
  // otherwise be read as garbage UTF-8 and silently produce zero events.
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le").replace(/^﻿/, "");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - (buffer.length % 2));
    for (let index = 0; index + 1 < buffer.length; index += 2) {
      swapped[index] = buffer[index + 1];
      swapped[index + 1] = buffer[index];
    }
    return swapped.toString("utf16le").replace(/^﻿/, "");
  }

  // Strip a leading UTF-8 BOM so whole-file JSON.parse does not choke on it.
  return buffer.toString("utf8").replace(/^﻿/, "");
}

export async function parseUsageFile(filePath: string, context: ExtractionContext) {
  if (context.source === "opencode" && isOpencodeSqliteFile(filePath)) {
    return parseOpencodeSqliteUsageFile(filePath, context);
  }

  // Read defensively: the file may be deleted/rotated between enumeration and read
  // (Codex/Claude Code churn logs constantly), and may be BOM-prefixed or UTF-16.
  const text = await readUsageFileText(filePath);
  if (text === null) {
    return [];
  }
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".csv") {
    return applyContext(parseTokenUsageImport(text).entries, context);
  }

  if (context.source === "codex" && ext === ".jsonl") {
    return parseCodexSessionJsonl(text, context);
  }

  if (context.source === "claude-code" && (ext === ".jsonl" || ext === ".log")) {
    return parseClaudeCodeSessionJsonl(text, context);
  }

  if (context.source === "gemini-cli" && (ext === ".json" || ext === ".jsonl" || ext === ".log")) {
    return parseGeminiCliUsageFile(text, context);
  }

  if (context.source === "opencode") {
    if (ext === ".json" || ext === ".jsonl" || ext === ".log") {
      return parseOpencodeUsageText(text, context);
    }
  }

  if (ext === ".jsonl" || ext === ".log") {
    const objects = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => parseJsonLine(line));

    return dedupeTokenEvents(objects.flatMap((object) => extractTokenUsageEventsFromJson(object, context)));
  }

  const parsed = safeJsonParse(text);

  if (parsed !== undefined) {
    const directImport = parseTokenUsageImport(text);
    if (directImport.entries.length) {
      return applyContext(directImport.entries, context);
    }

    return extractTokenUsageEventsFromJson(parsed, context);
  }

  return [];
}

function parseCodexSessionJsonl(text: string, context: ExtractionContext) {
  const entries: TokenUsageEvent[] = [];
  let currentModel = context.model || "unknown";
  let currentProject = context.project;
  let sessionTitle = context.sessionTitle || "";
  let sequence = 0;
  let previousTotalUsage: Record<string, unknown> = {};
  const quality = createSessionQualityCounts();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (
      !line.includes('"token_count"') &&
      !line.includes('"mcp_tool_call_end"') &&
      !line.includes('"turn_aborted"') &&
      !line.includes('"model"') &&
      !line.includes('"cwd"') &&
      !line.includes('"user_message"') &&
      !hasTitleNeedle(line)
    ) {
      continue;
    }

    const parsed = safeJsonParse(line);

    if (!isRecord(parsed)) {
      continue;
    }

    const payload = isRecord(parsed.payload) ? parsed.payload : {};
    const type = typeof parsed.type === "string" ? parsed.type : "";
    addCodexQualityCounts(payload, quality);

    const extractedTitle = extractSessionTitle(parsed);
    if (extractedTitle && (!sessionTitle || hasExplicitSessionTitle(parsed))) {
      sessionTitle = extractedTitle;
    }

    if ((type === "turn_context" || type === "session_meta") && typeof payload.model === "string") {
      currentModel = payload.model;
    }

    if ((type === "turn_context" || type === "session_meta") && typeof payload.cwd === "string") {
      currentProject = path.basename(payload.cwd);
    }

    const info = isRecord(payload.info) ? payload.info : {};
    const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : "";

    if (type !== "event_msg" || payload.type !== "token_count" || !timestamp) {
      continue;
    }

    const totalUsage = isRecord(info.total_token_usage) ? info.total_token_usage : undefined;
    let usage: Record<string, unknown> | undefined;
    if (totalUsage) {
      // total_token_usage is cumulative. On context compaction Codex resets/shrinks
      // the running total; a field-wise Math.max(0, …) delta would then zero (drop)
      // the post-compaction turn. Detect the reset and count the whole turn instead.
      const isReset = toNumber(totalUsage.total_tokens) < toNumber(previousTotalUsage.total_tokens);
      usage = isReset ? totalUsage : tokenUsageDelta(totalUsage, previousTotalUsage);
      previousTotalUsage = totalUsage;
    } else if (isRecord(info.last_token_usage)) {
      usage = info.last_token_usage;
    }

    if (!usage || tokenUsageTotal(usage) <= 0) {
      continue;
    }

    sequence += 1;
    const event = tryRecordToUsageEvent(
      usage,
      {
        ...context,
        timestamp,
        model: currentModel,
        project: currentProject,
        sessionId: context.sessionId || textFromFields(payload, ["id"]) || context.filePath,
        sessionTitle,
      },
      sequence
    );

    if (event) {
      entries.push(event);
    }
  }

  return attachSessionQualityCounts(dedupeTokenEvents(entries), quality);
}

function parseClaudeCodeSessionJsonl(text: string, context: ExtractionContext) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Claude Code keeps the session title in its own log lines: `ai-title` carries the
  // generated short title (refreshed multiple times — keep the last), and `last-prompt`
  // carries the latest user input. Subagent transcripts (under `<session>/subagents/`)
  // have neither, so fall back to the first user message — its content is the task the
  // subagent was given. Without this the collector left these as the raw session id.
  let aiTitle = "";
  let lastPrompt = "";
  let firstUserMessage = "";
  const quality = createSessionQualityCounts();
  for (const line of lines) {
    const wantFirstUser = !firstUserMessage && line.includes('"type":"user"');
    const wantQuality = line.includes('"tool_result"') || line.includes("[Request interrupted by user]");
    if (!wantFirstUser && !wantQuality && !line.includes('"ai-title"') && !line.includes('"last-prompt"')) {
      continue;
    }

    const parsed = safeJsonParse(line);
    if (!isRecord(parsed)) {
      continue;
    }

    addClaudeQualityCounts(parsed, quality);

    if (parsed.type === "ai-title") {
      const title = normalizeTextField(parsed.aiTitle);
      if (title) {
        aiTitle = title;
      }
    } else if (parsed.type === "last-prompt") {
      const prompt = normalizeTextField(parsed.lastPrompt);
      if (prompt) {
        lastPrompt = prompt;
      }
    } else if (parsed.type === "user" && !firstUserMessage && isRecord(parsed.message)) {
      const message = textFromMessageLike(parsed.message.content);
      if (message) {
        firstUserMessage = message;
      }
    }
  }

  const sessionTitle =
    sanitizeSessionTitle(aiTitle) ||
    summarizeSessionTitleFromMessage(lastPrompt) ||
    summarizeSessionTitleFromMessage(firstUserMessage) ||
    context.sessionTitle;
  const enrichedContext = sessionTitle ? { ...context, sessionTitle } : context;

  const objects = lines.flatMap((line) => parseJsonLine(line));

  return attachSessionQualityCounts(
    dedupeTokenEvents(objects.flatMap((object) => extractTokenUsageEventsFromJson(object, enrichedContext))),
    quality
  );
}

function createSessionQualityCounts(): SessionQualityCounts {
  return {
    errorCount: 0,
    interruptedCount: 0,
    toolCallCount: 0,
  };
}

function addClaudeQualityCounts(record: Record<string, unknown>, quality: SessionQualityCounts) {
  const message = isRecord(record.message) ? record.message : {};
  const content = message.content ?? record.content;

  if (record.type === "user" && messageContainsInterruptMarker(content)) {
    quality.interruptedCount = 1;
  }

  const items = Array.isArray(content) ? content : isRecord(content) ? [content] : [];
  for (const item of items) {
    if (!isRecord(item) || item.type !== "tool_result" || typeof item.is_error !== "boolean") {
      continue;
    }

    quality.toolCallCount += 1;
    if (item.is_error) {
      quality.errorCount += 1;
    }
  }
}

function addCodexQualityCounts(payload: Record<string, unknown>, quality: SessionQualityCounts) {
  if (payload.type === "turn_aborted") {
    quality.interruptedCount = 1;
    return;
  }

  if (payload.type !== "mcp_tool_call_end") {
    return;
  }

  const isError = codexMcpToolIsError(payload);
  if (isError === null) {
    return;
  }

  quality.toolCallCount += 1;
  if (isError) {
    quality.errorCount += 1;
  }
}

function codexMcpToolIsError(payload: Record<string, unknown>) {
  const result = isRecord(payload.result) ? payload.result : {};
  const ok = isRecord(result.Ok) ? result.Ok : isRecord(result.ok) ? result.ok : {};

  return typeof ok.isError === "boolean" ? ok.isError : null;
}

function attachSessionQualityCounts(entries: TokenUsageEvent[], quality: SessionQualityCounts) {
  if (!entries.length) {
    return entries;
  }

  let anchorIndex = 0;
  let anchorTime = Number.NEGATIVE_INFINITY;
  entries.forEach((entry, index) => {
    const time = new Date(entry.timestamp).getTime();
    if (Number.isFinite(time) && time > anchorTime) {
      anchorIndex = index;
      anchorTime = time;
    }
  });

  return entries.map((entry, index) =>
    index === anchorIndex
      ? normalizeTokenUsageEvent({
          ...entry,
          errorCount: quality.errorCount,
          interruptedCount: quality.interruptedCount > 0 ? 1 : 0,
          toolCallCount: quality.toolCallCount,
        })
      : entry
  );
}

function messageContainsInterruptMarker(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.includes("[Request interrupted by user]");
  }

  if (Array.isArray(value)) {
    return value.some((item) => messageContainsInterruptMarker(item, depth + 1));
  }

  if (isRecord(value)) {
    return Object.values(value).some((item) => messageContainsInterruptMarker(item, depth + 1));
  }

  return false;
}

type GeminiTokenBlock = {
  input: number;
  output: number;
  cached: number;
  thoughts: number;
  tool: number;
  total?: number;
};

type PendingUsageRecord = {
  usage: Record<string, unknown>;
  timestamp: string;
  model: string;
  sessionId: string;
  messageId?: string;
};

function parseGeminiCliUsageFile(text: string, context: ExtractionContext) {
  const ext = context.filePath ? path.extname(context.filePath).toLowerCase() : "";

  if (ext === ".jsonl" || ext === ".log") {
    return parseGeminiCliJsonl(text, context);
  }

  const parsed = safeJsonParse(text);
  if (!isRecord(parsed)) {
    return [];
  }

  const sessionId =
    textFromFields(parsed, ["sessionId", "session_id"]) ||
    (context.filePath ? path.basename(context.filePath, path.extname(context.filePath)) : "") ||
    context.sessionId ||
    "";
  const timestamp =
    textFromFields(parsed, ["timestamp", "created_at", "createdAt", "startTime", "lastUpdated"]) ||
    context.timestamp ||
    "";
  const modelHint = textFromFields(parsed, ["model", "modelName", "model_name"]) || context.model || "";
  const pending: PendingUsageRecord[] = [];

  if (Array.isArray(parsed.messages)) {
    for (const message of parsed.messages) {
      if (!isRecord(message)) {
        continue;
      }
      const event = geminiRecordToPendingEvent(message, {
        modelHint,
        sessionId,
        timestamp,
        normalizeInput: normalizeGeminiSessionInput,
      });
      if (event) {
        pending.push(event);
      }
    }
  } else {
    const direct = geminiRecordToPendingEvent(parsed, {
      modelHint,
      sessionId,
      timestamp,
      normalizeInput: normalizeGeminiSessionInput,
    });
    if (direct) {
      pending.push(direct);
    } else {
      pending.push(...geminiStatsToPendingEvents(parsed.stats ?? (isRecord(parsed.result) ? parsed.result.stats : undefined), {
        modelHint,
        sessionId,
        timestamp,
      }));
    }
  }

  return pendingGeminiEventsToUsageEvents(pending, context);
}

function parseGeminiCliJsonl(text: string, context: ExtractionContext) {
  const pending: PendingUsageRecord[] = [];
  const directIndexesById = new Map<string, number>();
  let sessionId =
    context.sessionId ||
    (context.filePath ? path.basename(context.filePath, path.extname(context.filePath)) : "") ||
    "";
  let currentModel = context.model || "";
  let currentTimestamp = context.timestamp || "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || (!line.includes('"tokens"') && !line.includes('"stats"') && !line.includes('"session'))) {
      continue;
    }

    const parsed = safeJsonParse(line);
    if (!isRecord(parsed)) {
      continue;
    }

    sessionId = textFromFields(parsed, ["sessionId", "session_id"]) || sessionId;
    currentModel = textFromFields(parsed, ["model", "modelName", "model_name"]) || currentModel;
    currentTimestamp = textFromFields(parsed, ["timestamp", "created_at", "createdAt", "startTime", "lastUpdated"]) || currentTimestamp;

    if (isRecord(parsed.tokens)) {
      const event = geminiRecordToPendingEvent(parsed, {
        modelHint: currentModel,
        sessionId,
        timestamp: currentTimestamp,
        normalizeInput: normalizeGeminiSessionInput,
      });
      if (!event) {
        continue;
      }

      if (event.messageId) {
        const existingIndex = directIndexesById.get(event.messageId);
        if (existingIndex !== undefined) {
          pending[existingIndex] = event;
        } else {
          directIndexesById.set(event.messageId, pending.length);
          pending.push(event);
        }
      } else {
        pending.push(event);
      }
      continue;
    }

    pending.push(
      ...geminiStatsToPendingEvents(parsed.stats ?? (isRecord(parsed.result) ? parsed.result.stats : undefined), {
        modelHint: currentModel,
        sessionId,
        timestamp: currentTimestamp,
      })
    );
  }

  return pendingGeminiEventsToUsageEvents(pending, context);
}

function geminiRecordToPendingEvent(
  record: Record<string, unknown>,
  {
    modelHint,
    sessionId,
    timestamp,
    normalizeInput,
  }: {
    modelHint: string;
    sessionId: string;
    timestamp: string;
    normalizeInput: (tokens: GeminiTokenBlock) => { inputWithoutCache: number; cacheReadTokens: number };
  }
): PendingUsageRecord | null {
  const tokens = parseGeminiTokens(record.tokens);
  if (!tokens) {
    return null;
  }
  const model = textFromFields(record, ["model", "modelName", "model_name"]) || modelHint || "unknown";
  const eventTimestamp = textFromFields(record, ["timestamp", "created_at", "createdAt", "time"]) || timestamp;
  const messageId = textFromFields(record, ["id", "messageId", "message_id"]);

  return {
    usage: geminiTokensToUsageRecord(tokens, normalizeInput),
    timestamp: eventTimestamp,
    model,
    sessionId,
    messageId,
  };
}

function geminiStatsToPendingEvents(
  value: unknown,
  { modelHint, sessionId, timestamp }: { modelHint: string; sessionId: string; timestamp: string }
) {
  if (!isRecord(value)) {
    return [];
  }

  const models = isRecord(value.models) ? value.models : undefined;
  if (models) {
    const entries: PendingUsageRecord[] = [];
    for (const [model, data] of Object.entries(models)) {
      if (!isRecord(data)) {
        continue;
      }
      const tokens = parseGeminiTokens(data.tokens ?? data);
      if (!tokens) {
        continue;
      }
      entries.push({
        usage: geminiTokensToUsageRecord(tokens, subtractGeminiCachedOverlap),
        timestamp,
        model,
        sessionId,
      });
    }
    if (entries.length) {
      return entries;
    }
  }

  const tokens = parseGeminiTokens(value.tokens ?? value);
  if (!tokens) {
    return [];
  }

  return [
    {
      usage: geminiTokensToUsageRecord(tokens, subtractGeminiCachedOverlap),
      timestamp,
      model: modelHint || "unknown",
      sessionId,
    },
  ];
}

function pendingGeminiEventsToUsageEvents(pending: PendingUsageRecord[], context: ExtractionContext) {
  const entries: TokenUsageEvent[] = [];
  let sequence = 0;
  for (const event of pending) {
    if (tokenUsageTotal(event.usage) <= 0) {
      continue;
    }
    sequence += 1;
    const usageEvent = tryRecordToUsageEvent(
      event.usage,
      {
        ...context,
        timestamp: event.timestamp || context.timestamp,
        model: event.model,
        sessionId: event.sessionId || context.sessionId || context.filePath,
      },
      sequence
    );
    if (usageEvent) {
      entries.push(usageEvent);
    }
  }
  return dedupeTokenEvents(entries);
}

function parseGeminiTokens(value: unknown): GeminiTokenBlock | null {
  if (!isRecord(value)) {
    return null;
  }

  const tokens = {
    input: numberFromFields(value, ["input", "prompt", "input_tokens", "prompt_tokens", "promptTokenCount"]),
    output: numberFromFields(value, [
      "output",
      "candidates",
      "output_tokens",
      "completion_tokens",
      "candidates_tokens",
      "candidatesTokenCount",
    ]),
    cached: numberFromFields(value, ["cached", "cached_tokens", "cachedContentTokenCount"]),
    thoughts: numberFromFields(value, ["thoughts", "reasoning", "thoughts_tokens", "reasoning_tokens"]),
    tool: numberFromFields(value, ["tool", "tool_tokens"]),
    total: positiveInteger(value.total ?? value.total_tokens ?? value.totalTokenCount),
  };

  return tokens.input + tokens.output + tokens.cached + tokens.thoughts + tokens.tool + (tokens.total ?? 0) > 0
    ? tokens
    : null;
}

function geminiTokensToUsageRecord(
  tokens: GeminiTokenBlock,
  normalizeInput: (tokens: GeminiTokenBlock) => { inputWithoutCache: number; cacheReadTokens: number }
) {
  const { inputWithoutCache, cacheReadTokens } = normalizeInput(tokens);
  return {
    input_tokens: inputWithoutCache + tokens.tool,
    cache_read_input_tokens: cacheReadTokens,
    output_tokens: tokens.output + tokens.thoughts,
    reasoning_output_tokens: tokens.thoughts,
  };
}

function subtractGeminiCachedOverlap(tokens: GeminiTokenBlock) {
  const cacheReadTokens = tokens.cached;
  const cachedPortion = Math.min(tokens.input, cacheReadTokens);
  return {
    inputWithoutCache: Math.max(0, tokens.input - cachedPortion),
    cacheReadTokens,
  };
}

function normalizeGeminiSessionInput(tokens: GeminiTokenBlock) {
  const inclusiveTotal = tokens.input + tokens.output + tokens.thoughts + tokens.tool;
  const exclusiveTotal = inclusiveTotal + tokens.cached;
  if (tokens.cached > 0 && tokens.total === inclusiveTotal && tokens.total !== exclusiveTotal) {
    return subtractGeminiCachedOverlap(tokens);
  }
  return {
    inputWithoutCache: tokens.input,
    cacheReadTokens: tokens.cached,
  };
}

async function parseOpencodeSqliteUsageFile(filePath: string, context: ExtractionContext) {
  const rows = await querySqliteJson(filePath, "select id, session_id, data from message;");
  const entries: TokenUsageEvent[] = [];
  let sequence = 0;
  for (const row of rows) {
    if (!isRecord(row) || typeof row.data !== "string") {
      continue;
    }
    const message = safeJsonParse(row.data);
    if (!isRecord(message)) {
      continue;
    }
    sequence += 1;
    const event = opencodeMessageToUsageEvent(message, {
      ...context,
      filePath,
      sessionId: normalizeTextField(row.session_id) || context.sessionId || filePath,
    }, sequence, normalizeTextField(row.id));
    if (event) {
      entries.push(event);
    }
  }
  return dedupeTokenEvents(entries);
}

async function querySqliteJson(filePath: string, sql: string): Promise<unknown[]> {
  try {
    const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-json", filePath, sql], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const parsed = safeJsonParse(String(stdout));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseOpencodeUsageText(text: string, context: ExtractionContext) {
  const ext = context.filePath ? path.extname(context.filePath).toLowerCase() : "";
  if (ext === ".jsonl" || ext === ".log") {
    const entries: TokenUsageEvent[] = [];
    let sequence = 0;
    for (const line of text.split(/\r?\n/)) {
      const parsed = line.trim() ? safeJsonParse(line.trim()) : undefined;
      if (parsed === undefined) {
        continue;
      }
      const batch = parseOpencodeMessagesFromJson(parsed, context, { sequence });
      sequence += batch.length;
      entries.push(...batch);
    }
    return dedupeTokenEvents(entries);
  }

  const parsed = safeJsonParse(text);
  return parsed === undefined ? [] : dedupeTokenEvents(parseOpencodeMessagesFromJson(parsed, context, { sequence: 0 }));
}

function parseOpencodeMessagesFromJson(value: unknown, context: ExtractionContext, state: { sequence: number }, depth = 0) {
  const entries: TokenUsageEvent[] = [];
  if (depth > 14 || value === null || value === undefined) {
    return entries;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      entries.push(...parseOpencodeMessagesFromJson(item, context, state, depth + 1));
    }
    return entries;
  }

  if (!isRecord(value)) {
    return entries;
  }

  if (isRecord(value.tokens)) {
    state.sequence += 1;
    const event = opencodeMessageToUsageEvent(value, context, state.sequence);
    if (event) {
      entries.push(event);
    }
    return entries;
  }

  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && isSensitiveTextKey(key)) {
      continue;
    }
    entries.push(...parseOpencodeMessagesFromJson(child, context, state, depth + 1));
  }

  return entries;
}

function opencodeMessageToUsageEvent(
  message: Record<string, unknown>,
  context: ExtractionContext,
  sequence: number,
  overrideMessageId = ""
) {
  const tokens = isRecord(message.tokens) ? message.tokens : {};
  const cache = isRecord(tokens.cache) ? tokens.cache : {};
  const time = isRecord(message.time) ? message.time : {};
  const timestamp = isoFromEpochFields(time, ["created"]) || context.timestamp || new Date().toISOString();
  const model = normalizeOpencodeModelName(textFromFields(message, ["modelID", "modelId", "model", "modelName"]) || context.model || "unknown");
  const sessionId = textFromFields(message, ["sessionID", "sessionId", "session_id"]) || context.sessionId || context.filePath;
  const messageId = overrideMessageId || textFromFields(message, ["id", "messageId", "message_id"]);

  return tryRecordToUsageEvent(
    {
      input_tokens: numberFromFields(tokens, ["input", "input_tokens", "prompt_tokens"]),
      output_tokens: numberFromFields(tokens, ["output", "output_tokens", "completion_tokens"]),
      cache_read_input_tokens: numberFromFields(cache, ["read", "cache_read_input_tokens", "cacheReadInputTokens"]),
      cache_creation_input_tokens: numberFromFields(cache, ["write", "cache_creation_input_tokens", "cacheCreationInputTokens"]),
      reasoning_output_tokens: numberFromFields(tokens, [
        "reasoning",
        "reasoning_tokens",
        "reasoningTokens",
        "reasoning_output_tokens",
        "reasoningOutputTokens",
      ]),
    },
    {
      ...context,
      timestamp,
      model,
      sessionId: messageId ? `${sessionId}:${messageId}` : sessionId,
    },
    sequence
  );
}

function normalizeOpencodeModelName(model: string) {
  if (model === "gemini-3-pro-high") {
    return "gemini-3-pro-preview";
  }
  if (model === "k2p6") {
    return "kimi-k2.6";
  }
  return model;
}

function extractSessionTitle(record: Record<string, unknown>) {
  const payload = isRecord(record.payload) ? record.payload : {};
  const payloadType = typeof payload.type === "string" ? payload.type : "";
  const explicitTitle =
    textFromFields(payload, ["sessionTitle", "session_title", "conversationTitle", "conversation_title", "title"]) ||
    textFromFields(record, ["sessionTitle", "session_title", "conversationTitle", "conversation_title", "title"]);

  if (explicitTitle) {
    return sanitizeSessionTitle(explicitTitle);
  }

  if (record.type === "event_msg" && payloadType === "user_message") {
    return summarizeSessionTitleFromMessage(textFromMessageLike(payload.message) || textFromMessageLike(payload.text_elements));
  }

  return "";
}

function hasTitleNeedle(line: string) {
  return (
    line.includes('"title"') ||
    line.includes('"sessionTitle"') ||
    line.includes('"session_title"') ||
    line.includes('"conversationTitle"') ||
    line.includes('"conversation_title"')
  );
}

function hasExplicitSessionTitle(record: Record<string, unknown>) {
  const payload = isRecord(record.payload) ? record.payload : {};
  return Boolean(
    textFromFields(payload, ["sessionTitle", "session_title", "conversationTitle", "conversation_title", "title"]) ||
      textFromFields(record, ["sessionTitle", "session_title", "conversationTitle", "conversation_title", "title"])
  );
}

function textFromMessageLike(value: unknown, depth = 0): string {
  // Guard against pathologically nested content arrays; an unbounded recursion here
  // would throw RangeError and abort the whole collection run (mirrors visitJson).
  if (depth > 12) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => textFromMessageLike(item, depth + 1)).filter(Boolean).join(" ");
  }

  if (isRecord(value)) {
    return (
      textFromFields(value, ["text", "content", "message", "input_text"]) ||
      textFromMessageLike(value.text_elements, depth + 1)
    );
  }

  return "";
}

function sanitizeSessionTitle(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return finalizeSessionTitle(value);
}

function summarizeSessionTitleFromMessage(value: string) {
  const text = prepareSessionTitleText(value);
  if (!text) {
    return "";
  }

  const clauses = text
    .split(/[，,。！？!?；;\n]/)
    .map((clause) => stripRequestPrefix(clause))
    .filter(Boolean);
  // Only derive a title from a clause that contains a recognized task action. Falling
  // back to the raw prompt text would leak arbitrary user input (secrets, paths, …)
  // into the stored session title, bypassing the sensitive-key redaction.
  const clause = [...clauses].reverse().find(hasTitleAction);
  if (!clause) {
    return "";
  }
  const compactTitle = compactRequestClause(clause);

  return finalizeSessionTitle(compactTitle || clause);
}

function prepareSessionTitleText(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/```[\s\S]*$/g, "")
    .replace(/^#+\s*/, "")
    .replace(/\btoken\s*榜\b/gi, "token榜")
    .replace(/\bToken\s*Board\b/g, "Token Board")
    .replace(/\s+/g, " ")
    .trim();
}

function compactRequestClause(value: string) {
  const clause = stripRequestPrefix(value)
    .replace(/[吗呢吧呀啊？?。！!]*$/g, "")
    .trim();

  if (!clause) {
    return "";
  }

  const changeTarget = clause.match(/^(?:把|将)?(.{1,32}?)(?:改成|改为|换成|调整为|更新为).+$/);
  if (changeTarget?.[1]) {
    return formatActionObject("修改", cleanTitleObject(changeTarget[1]));
  }

  const objectBeforeAction = clause.match(/^(.{1,32}?)(?:应该|需要|要|得|可以|需|应|必须)?(?:被)?(高亮|置顶|展开|收起|隐藏|显示|删除|移除|新增|添加|修复|优化|调整|更新)(?:一下|下|起来|出来|掉)?$/);
  if (objectBeforeAction?.[1] && objectBeforeAction[2]) {
    return formatActionObject(objectBeforeAction[2], cleanTitleObject(objectBeforeAction[1]));
  }

  const actionBeforeObject = clause.match(/^(修复|检查|查看|推荐|移除|新增|添加|更新|优化|调整|实现|支持|修改|删除|高亮|置顶|展开|收起|隐藏|显示)(.+)$/);
  if (actionBeforeObject?.[1] && actionBeforeObject[2]) {
    return formatActionObject(actionBeforeObject[1], cleanTitleObject(actionBeforeObject[2]));
  }

  return clause;
}

function hasTitleAction(value: string) {
  return /(高亮|置顶|展开|收起|隐藏|显示|删除|移除|新增|添加|修复|优化|调整|更新|修改|改成|改为|换成|查看|检查|推荐|实现|支持)/.test(value);
}

function stripRequestPrefix(value: string) {
  return value
    .trim()
    .replace(/^(?:请|麻烦|帮我|帮忙|帮|可以|能不能|能否|能|现在在|我想|想要|想|把|将|这个|这里|一下)\s*/g, "")
    .trim();
}

function cleanTitleObject(value: string) {
  return value
    .replace(/^(?:这个|那个|这里的|当前的|本地的|我的|一下)\s*/g, "")
    .replace(/的/g, "")
    .replace(/里看不懂.*$/g, "标题")
    .replace(/(?:一下|下|问题|逻辑|功能|文案|样式)$/g, "")
    .replace(/[吗呢吧呀啊？?。！!]*$/g, "")
    .trim();
}

function formatActionObject(action: string, object: string) {
  if (!action || !object) {
    return action || object;
  }

  return /^[A-Za-z0-9]/.test(object) ? `${action} ${object}` : `${action}${object}`;
}

function finalizeSessionTitle(value: string) {
  const text = prepareSessionTitleText(value);
  const lower = text.toLowerCase();

  if (!text || lower === "none" || lower === "auto" || lower === "unknown" || lower === "n/a") {
    return "";
  }

  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function tokenUsageDelta(current: Record<string, unknown>, previous: Record<string, unknown>) {
  const fields = [
    "input_tokens",
    "cached_input_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
  ];

  return Object.fromEntries(
    fields.map((field) => [field, Math.max(0, toNumber(current[field]) - toNumber(previous[field]))])
  );
}

function tokenUsageTotal(record: Record<string, unknown>) {
  return (
    toNumber(record.input_tokens) +
    cacheCreationInputTokensFromRecord(record) +
    cacheReadInputTokensFromRecord(record) +
    toNumber(record.output_tokens)
  );
}

export function defaultSourceTargets(): SourceTarget[] {
  return [
    {
      source: "codex",
      tool: "Codex CLI",
      paths: ["~/.codex/sessions", "~/.codex/archived_sessions", "~/.codex/projects"],
    },
    {
      source: "claude-code",
      tool: "Claude Code",
      paths: ["~/.claude/projects"],
    },
    {
      source: "gemini-cli",
      tool: "Gemini CLI",
      paths: defaultGeminiCliPaths(),
    },
    {
      source: "opencode",
      tool: "opencode",
      paths: defaultOpencodePaths(),
    },
  ];
}

function buildSourceTargets(config: TokenUsageCollectorConfig): SourceTarget[] {
  const targets: SourceTarget[] = [];

  if (config.usagePaths?.length) {
    targets.push({
      source: "custom",
      tool: "Custom Usage",
      paths: config.usagePaths,
    });
  }

  if (config.includeDefaultSources !== false) {
    targets.push(...defaultSourceTargets());
  }

  return targets;
}

async function listUsageFiles(
  inputPath: string,
  {
    source,
    maxFileBytes,
    maxCodexFileBytes,
    sinceMs,
  }: {
    source: string;
    maxFileBytes: number;
    maxCodexFileBytes: number;
    sinceMs: number;
  }
) {
  // Enumerate every qualifying file with its mtime; the caller applies the global
  // maxFiles budget after sorting newest-first, so no cap is imposed here.
  const files: Array<{ path: string; mtimeMs: number }> = [];

  async function walk(currentPath: string, depth: number) {
    if (depth > 8) {
      return;
    }

    let stat;
    try {
      stat = await fs.stat(currentPath);
    } catch {
      return;
    }

    if (stat.isDirectory()) {
      if (shouldSkipDirectory(currentPath)) {
        return;
      }

      const children = await fs.readdir(currentPath);
      for (const child of children) {
        await walk(path.join(currentPath, child), depth + 1);
      }
      return;
    }

    const maxBytes =
      (source === "codex" && path.extname(currentPath).toLowerCase() === ".jsonl") ||
      (source === "opencode" && isOpencodeSqliteFile(currentPath))
        ? maxCodexFileBytes
        : maxFileBytes;

    if (stat.isFile() && stat.size <= maxBytes && stat.mtimeMs >= sinceMs && isUsageFile(currentPath, source)) {
      files.push({ path: currentPath, mtimeMs: stat.mtimeMs });
    }
  }

  await walk(inputPath, 0);
  return files;
}

function visitJson(
  value: unknown,
  context: ExtractionContext,
  entries: TokenUsageEvent[],
  state: { sequence: number },
  depth: number
) {
  if (depth > 14 || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => visitJson(item, context, entries, state, depth + 1));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const nextContext = enrichContext(context, record);

  if (hasUsageShape(record)) {
    state.sequence += 1;
    const event = tryRecordToUsageEvent(record, nextContext, state.sequence);
    if (event) {
      entries.push(event);
    }
    return;
  }

  for (const [key, child] of Object.entries(record)) {
    if (typeof child === "string" && isSensitiveTextKey(key)) {
      continue;
    }

    visitJson(child, nextContext, entries, state, depth + 1);
  }
}

function recordToUsageEvent(record: Record<string, unknown>, context: ExtractionContext, sequence: number) {
  const baseInputTokens = numberFromFields(record, ["inputTokens", "input_tokens", "inputTokenCount", "promptTokens", "prompt_tokens"]);
  // cache_read = discounted reads (counted as cachedInput); cache_creation = premium
  // writes (counted as full-rate input only, never as discounted cached input).
  const cacheReadTokens = cacheReadInputTokensFromRecord(record);
  const cacheCreationTokens = cacheCreationInputTokensFromRecord(record);
  const inputTokens = baseInputTokens + cacheReadTokens + cacheCreationTokens;
  const cachedInputTokens =
    numberFromFields(record, ["cachedInputTokens", "cached_input_tokens", "cachedTokens"]) + cacheReadTokens;
  const outputTokens = numberFromFields(record, ["outputTokens", "output_tokens", "outputTokenCount", "completionTokens", "completion_tokens"]);
  const reasoningOutputTokens = numberFromFields(record, [
    "reasoningOutputTokens",
    "reasoning_output_tokens",
    "reasoningTokens",
  ]);
  const totalTokens = inputTokens + outputTokens;

  if (totalTokens <= 0) {
    throw new Error("missing input/output token fields; total_tokens fallback is disabled");
  }

  const timestamp = context.timestamp || new Date().toISOString();
  const model = context.model || textFromFields(record, ["model", "modelName", "model_name"]) || "unknown";
  const sessionId = context.sessionId || textFromFields(record, ["sessionId", "session_id", "conversationId", "id"]);
  const project = context.project || textFromFields(record, ["project", "repo", "workspace", "cwd"]);
  const sessionTitle =
    context.sessionTitle || textFromFields(record, ["sessionTitle", "session_title", "conversationTitle"]);

  return normalizeTokenUsageEvent({
    id: stableCollectorId(context, timestamp, model, sessionId, sequence, {
      inputTokens,
      cacheCreationInputTokens: cacheCreationTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
      totalTokens,
    }),
    userId: context.userId || "local",
    displayName: context.displayName || context.userId || "Local User",
    team: context.team || "Friends",
    source: context.source,
    tool: context.tool,
    model,
    project,
    timestamp,
    inputTokens,
    cacheCreationInputTokens: cacheCreationTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
    messages: numberFromFields(record, ["messages", "messageCount", "message_count"]),
    sessionId,
    sessionTitle: sanitizeSessionTitle(sessionTitle),
    errorCount: optionalNumberFromFields(record, ["errorCount", "error_count"]),
    interruptedCount: optionalNumberFromFields(record, [
      "interruptedCount",
      "interrupted_count",
      "interruptCount",
      "interrupt_count",
      "abortedCount",
      "aborted_count",
    ]),
    toolCallCount: optionalNumberFromFields(record, ["toolCallCount", "tool_call_count"]),
  });
}

function tryRecordToUsageEvent(record: Record<string, unknown>, context: ExtractionContext, sequence: number) {
  try {
    return recordToUsageEvent(record, context, sequence);
  } catch {
    return null;
  }
}

function isoFromEpochFields(record: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      const ms = value < 1e12 ? value * 1000 : value;
      return new Date(ms).toISOString();
    }
  }
  return "";
}

function enrichContext(context: ExtractionContext, record: Record<string, unknown>): ExtractionContext {
  const timestampFields = ["timestamp", "createdAt", "created_at", "date", "time"];
  return {
    ...context,
    timestamp:
      context.timestamp || textFromFields(record, timestampFields) || isoFromEpochFields(record, timestampFields),
    model: context.model || textFromFields(record, ["model", "modelName", "model_name"]),
    project: context.project || textFromFields(record, ["project", "repo", "workspace", "cwd", "root", "directory"]),
    sessionId:
      context.sessionId ||
      textFromFields(record, ["sessionId", "session_id", "conversationId", "conversation_id", "requestId", "id"]),
    sessionTitle:
      context.sessionTitle || textFromFields(record, ["sessionTitle", "session_title", "conversationTitle"]),
  };
}

function applyContext(entries: TokenUsageEvent[], context: ExtractionContext) {
  return entries.map((entry) =>
    normalizeTokenUsageEvent({
      ...entry,
      userId: entry.userId || context.userId || "local",
      displayName: entry.displayName || context.displayName || context.userId || "Local User",
      team: entry.team || context.team || "Friends",
      source: entry.source === "manual" ? context.source : entry.source,
      tool: entry.tool === "manual" ? context.tool : entry.tool,
      project: entry.project || context.project,
      sessionId: entry.sessionId || context.sessionId,
      sessionTitle: entry.sessionTitle || context.sessionTitle,
    })
  );
}

function hasUsageShape(record: Record<string, unknown>) {
  // Require a real input/output token key (not just a rollup total), otherwise a
  // node carrying only total_tokens would be treated as a leaf and shadow the real
  // usage events nested under it.
  return Object.keys(record).some((key) => USAGE_SHAPE_KEYS.has(key)) && sumKnownTokens(record) > 0;
}

function sumKnownTokens(record: Record<string, unknown>) {
  return [...TOKEN_KEYS].reduce((sum, key) => sum + toNumber(record[key]), 0);
}

function numberFromFields(record: Record<string, unknown>, fields: string[]) {
  return fields.reduce((sum, field) => sum + toNumber(record[field]), 0);
}

function optionalNumberFromFields(record: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    if (record[field] !== undefined && record[field] !== null && record[field] !== "") {
      return Math.trunc(toNumber(record[field]));
    }
  }
  return undefined;
}

function cacheReadInputTokensFromRecord(record: Record<string, unknown>) {
  return numberFromFields(record, ["cache_read_input_tokens", "cacheReadInputTokens"]);
}

function cacheCreationInputTokensFromRecord(record: Record<string, unknown>) {
  const total = numberFromFields(record, ["cache_creation_input_tokens", "cacheCreationInputTokens"]);
  if (total > 0) {
    return total;
  }

  const nested = isRecord(record.cache_creation) ? record.cache_creation : {};
  return (
    numberFromFields(record, [
      "cache_creation_input_tokens_5m",
      "cacheCreationInputTokens5m",
      "cache_creation_input_tokens_1h",
      "cacheCreationInputTokens1h",
      "ephemeral_5m_input_tokens",
      "ephemeral5mInputTokens",
      "ephemeral_1h_input_tokens",
      "ephemeral1hInputTokens",
    ]) +
    numberFromFields(nested, [
      "ephemeral_5m_input_tokens",
      "ephemeral5mInputTokens",
      "ephemeral_1h_input_tokens",
      "ephemeral1hInputTokens",
    ])
  );
}

function textFromFields(record: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function toNumber(value: unknown) {
  // Token counts are never negative; clamp so a corrupt/delta-style negative cannot
  // undercount aggregates or zero out a cumulative delta incorrectly.
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  return 0;
}

function parseJsonLine(line: string) {
  const parsed = safeJsonParse(line);
  return parsed === undefined ? [] : [parsed];
}

function safeJsonParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUsageFile(filePath: string, source = "") {
  if (source === "opencode" && isOpencodeSqliteFile(filePath)) {
    return true;
  }
  return [".csv", ".json", ".jsonl", ".log"].includes(path.extname(filePath).toLowerCase());
}

function isOpencodeSqliteFile(filePath: string) {
  const name = path.basename(filePath).toLowerCase();
  return name === "opencode.db" || /^opencode-[a-z0-9_-]+\.db$/.test(name);
}

function shouldSkipDirectory(dirPath: string) {
  const name = path.basename(dirPath);
  return [
    "node_modules",
    ".git",
    ".ripgrep",
    "Cache",
    "CachedData",
    "CachedExtensionVSIXs",
    "Code Cache",
    "Crashpad",
    "GPUCache",
    "IndexedDB",
    "Local Storage",
    "extensions",
    "builtin_skills",
  ].includes(name);
}

function isSensitiveTextKey(key: string) {
  return /^(content|prompt|text|body|transcript)$/i.test(key);
}

function expandHome(inputPath: string) {
  return inputPath.startsWith("~/") ? path.join(os.homedir(), inputPath.slice(2)) : inputPath;
}

function defaultGeminiCliPaths() {
  return uniquePaths([
    ...pathListFromEnv("GEMINI_DATA_DIR"),
    ...(process.env.GEMINI_CLI_HOME ? [path.join(process.env.GEMINI_CLI_HOME, "tmp")] : []),
    "~/.gemini/tmp",
  ]);
}

function defaultOpencodePaths() {
  return uniquePaths([...pathListFromEnv("OPENCODE_DATA_DIR"), "~/.local/share/opencode"]);
}

function pathListFromEnv(name: string) {
  const value = process.env[name];
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function uniquePaths(paths: string[]) {
  return [...new Set(paths.filter(Boolean))];
}

function stableCollectorId(
  context: ExtractionContext,
  timestamp: string,
  model: string,
  sessionId: string,
  sequence: number,
  tokens: {
    inputTokens: number;
    cacheCreationInputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
  }
) {
  const hash = createHash("sha256")
    .update(
      [
        context.source,
        context.filePath || "",
        timestamp,
        model,
        sessionId,
        sequence,
        tokens.inputTokens,
        tokens.cacheCreationInputTokens,
        tokens.cachedInputTokens,
        tokens.outputTokens,
        tokens.reasoningOutputTokens,
        tokens.totalTokens,
      ].join("\n")
    )
    .digest("hex")
    .slice(0, 32);

  return `local:${hash}`;
}
