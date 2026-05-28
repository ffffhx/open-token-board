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

const DEFAULT_SINCE_HOURS = 24 * 30;
const DEFAULT_MAX_FILES = 800;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_CODEX_FILE_BYTES = 256 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const TOKEN_KEYS = new Set([
  "cached_input_tokens",
  "cachedInputTokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "completion_tokens",
  "completionTokens",
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
const SQLITE_USAGE_NEEDLES = [
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "prompt_tokens",
  "completion_tokens",
  "cached_input_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
  "token_usage",
  "tokenusage",
];

export async function collectLocalTokenUsage(config: TokenUsageCollectorConfig = {}) {
  const targets = buildSourceTargets(config);
  const codexTitleIndex = await readCodexTitleIndex(targets);
  const maxFiles = config.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileBytes = config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxCodexFileBytes = config.maxCodexFileBytes ?? DEFAULT_MAX_CODEX_FILE_BYTES;
  const sinceMs = Date.now() - (config.sinceHours ?? DEFAULT_SINCE_HOURS) * 60 * 60 * 1000;
  const entries: TokenUsageEvent[] = [];

  for (const target of targets) {
    let scannedFiles = 0;

    for (const targetPath of target.paths) {
      const files = await listUsageFiles(expandHome(targetPath), {
        source: target.source,
        maxFiles: Math.max(0, maxFiles - scannedFiles),
        maxFileBytes,
        maxCodexFileBytes,
        sinceMs,
      });
      scannedFiles += files.length;

      for (const filePath of files) {
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
    }
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

export async function parseUsageFile(filePath: string, context: ExtractionContext) {
  if (isSqliteUsageFile(filePath)) {
    return parseSqliteUsageFile(filePath, context);
  }

  const text = await fs.readFile(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".csv") {
    return applyContext(parseTokenUsageImport(text).entries, context);
  }

  if (context.source === "codex" && ext === ".jsonl") {
    return parseCodexSessionJsonl(text, context);
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

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (
      !line.includes('"token_count"') &&
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
    const usage = totalUsage
      ? tokenUsageDelta(totalUsage, previousTotalUsage)
      : isRecord(info.last_token_usage)
        ? info.last_token_usage
        : undefined;
    if (totalUsage) {
      previousTotalUsage = totalUsage;
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

  return dedupeTokenEvents(entries);
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

function textFromMessageLike(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(textFromMessageLike).filter(Boolean).join(" ");
  }

  if (isRecord(value)) {
    return (
      textFromFields(value, ["text", "content", "message", "input_text"]) ||
      textFromMessageLike(value.text_elements)
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
  const clause = [...clauses].reverse().find(hasTitleAction) || stripRequestPrefix(text);
  const compactTitle = compactRequestClause(clause);

  return finalizeSessionTitle(compactTitle || text);
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
  const fields = ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"];

  return Object.fromEntries(
    fields.map((field) => [field, Math.max(0, toNumber(current[field]) - toNumber(previous[field]))])
  );
}

function tokenUsageTotal(record: Record<string, unknown>) {
  return toNumber(record.input_tokens) + toNumber(record.output_tokens);
}

async function parseSqliteUsageFile(filePath: string, context: ExtractionContext) {
  const entries: TokenUsageEvent[] = [];
  const valueMatches = SQLITE_USAGE_NEEDLES.map(
    (needle) => `lower(cast(value as text)) like '%${needle.replace(/'/g, "''")}%'`
  );
  const where = [`lower(key) like '%usage%'`, ...valueMatches].join(" or ");

  for (const table of ["ItemTable", "cursorDiskKV"]) {
    const rows = await querySqliteJson(
      filePath,
      `select key, cast(value as text) as value from ${table} where ${where} limit 200;`
    );

    for (const row of rows) {
      if (!isRecord(row) || typeof row.value !== "string") {
        continue;
      }

      const parsed = safeJsonParse(row.value);
      if (parsed === undefined) {
        continue;
      }

      entries.push(
        ...extractTokenUsageEventsFromJson(parsed, {
          ...context,
          sessionId: `${filePath}:${typeof row.key === "string" ? row.key : "sqlite"}`,
        })
      );
    }
  }

  return dedupeTokenEvents(entries);
}

async function querySqliteJson(filePath: string, sql: string) {
  try {
    const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-json", filePath, sql], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const parsed = safeJsonParse(stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
      source: "cursor",
      tool: "Cursor",
      paths: [
        "~/Library/Application Support/Cursor/User/globalStorage",
        "~/Library/Application Support/Cursor/logs",
        "~/.config/Cursor/User/globalStorage",
        "~/.config/Cursor/logs",
      ],
    },
    {
      source: "trae",
      tool: "Trae",
      paths: [
        "~/Library/Application Support/Trae/User/globalStorage",
        "~/Library/Application Support/Trae CN/User/globalStorage",
        "~/Library/Application Support/Trae/logs",
        "~/Library/Application Support/Trae CN/logs",
        "~/Library/Application Support/Trae/ModularData/ai-agent",
        "~/Library/Application Support/Trae CN/ModularData/ai-agent",
        "~/.config/Trae/User/globalStorage",
        "~/.config/Trae CN/User/globalStorage",
        "~/.trae",
        "~/.trae-cn",
        "~/.trae-aicc-internal",
      ],
    },
    {
      source: "gemini-cli",
      tool: "Gemini CLI",
      paths: ["~/.gemini"],
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
    maxFiles,
    maxFileBytes,
    maxCodexFileBytes,
    sinceMs,
  }: {
    source: string;
    maxFiles: number;
    maxFileBytes: number;
    maxCodexFileBytes: number;
    sinceMs: number;
  }
) {
  const files: string[] = [];

  async function walk(currentPath: string, depth: number) {
    if (files.length >= maxFiles || depth > 8) {
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
      source === "codex" && path.extname(currentPath).toLowerCase() === ".jsonl"
        ? maxCodexFileBytes
        : maxFileBytes;

    if (
      stat.isFile() &&
      files.length < maxFiles &&
      stat.size <= maxBytes &&
      stat.mtimeMs >= sinceMs &&
      isUsageFile(currentPath)
    ) {
      files.push(currentPath);
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
  const additiveCachedInputTokens =
    numberFromFields(record, ["cache_read_input_tokens", "cacheReadInputTokens"]) +
    numberFromFields(record, ["cache_creation_input_tokens", "cacheCreationInputTokens"]);
  const inputTokens = baseInputTokens + additiveCachedInputTokens;
  const cachedInputTokens =
    numberFromFields(record, ["cachedInputTokens", "cached_input_tokens", "cachedTokens"]) +
    additiveCachedInputTokens;
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
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
    messages: numberFromFields(record, ["messages", "messageCount", "message_count"]),
    sessionId,
    sessionTitle: sanitizeSessionTitle(sessionTitle),
  });
}

function tryRecordToUsageEvent(record: Record<string, unknown>, context: ExtractionContext, sequence: number) {
  try {
    return recordToUsageEvent(record, context, sequence);
  } catch {
    return null;
  }
}

function enrichContext(context: ExtractionContext, record: Record<string, unknown>): ExtractionContext {
  return {
    ...context,
    timestamp: context.timestamp || textFromFields(record, ["timestamp", "createdAt", "created_at", "date", "time"]),
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
  return Object.keys(record).some((key) => TOKEN_KEYS.has(key)) && sumKnownTokens(record) > 0;
}

function sumKnownTokens(record: Record<string, unknown>) {
  return [...TOKEN_KEYS].reduce((sum, key) => sum + toNumber(record[key]), 0);
}

function numberFromFields(record: Record<string, unknown>, fields: string[]) {
  return fields.reduce((sum, field) => sum + toNumber(record[field]), 0);
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
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
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

function isUsageFile(filePath: string) {
  const basename = path.basename(filePath).toLowerCase();
  return (
    [".csv", ".json", ".jsonl", ".log", ".vscdb"].includes(path.extname(filePath).toLowerCase()) ||
    basename === "state.vscdb.backup"
  );
}

function isSqliteUsageFile(filePath: string) {
  const basename = path.basename(filePath).toLowerCase();
  return (
    basename === "state.vscdb" ||
    basename === "state.vscdb.backup" ||
    path.extname(filePath).toLowerCase() === ".vscdb"
  );
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

function stableCollectorId(
  context: ExtractionContext,
  timestamp: string,
  model: string,
  sessionId: string,
  sequence: number,
  tokens: {
    inputTokens: number;
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
