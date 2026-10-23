import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  createIngestPayload,
  sanitizeIngestEvents,
  type TokenBoardPrivacyOptions,
  type TokenBoardUploadUser,
} from "@open-token-board/core/automation";
import {
  collectTokenBoardUserConfig,
  type TokenUsageCollectorConfig,
} from "@open-token-board/core/collector";
import {
  collectLocalAgentSpeedViaAscWithReport,
  collectLocalTokenUsageViaAscWithReport,
} from "@open-token-board/core/asc-collector";
import type { TokenBoardUserConfig } from "@open-token-board/core";

type AgentConfig = TokenUsageCollectorConfig & {
  apiUrl: string;
  agentToken?: string;
  uploadToken?: string;
  intervalMs: number;
  stateFile: string;
  privacy: TokenBoardPrivacyOptions;
};

type AgentState = {
  apiUrl?: string;
  userId?: string;
  uploadedIds?: string[];
  lastUploadedAt?: string;
};

const DEFAULT_CONFIG_FILE = path.join(os.homedir(), ".token-board-agent.json");
const DEFAULT_STATE_FILE = path.join(os.homedir(), ".token-board-agent-state.json");
const AGENT_VERSION = "0.2.0";
const COLLECTOR_SCHEMA_VERSION = 2;
const INGEST_BATCH_SIZE = 1000;
const FETCH_TIMEOUT_MS = readNumberEnv("TOKEN_BOARD_FETCH_TIMEOUT_MS", 30_000);
const FETCH_MAX_RETRIES = readNonNegativeIntegerEnv(
  "TOKEN_BOARD_FETCH_MAX_RETRIES",
  readNonNegativeIntegerEnv("TOKEN_BOARD_FETCH_RETRIES", 2)
);
const FETCH_RETRY_BASE_DELAY_MS = readNumberEnv("TOKEN_BOARD_FETCH_RETRY_BASE_DELAY_MS", 1_000);
const FETCH_RETRY_MAX_DELAY_MS = readNumberEnv("TOKEN_BOARD_FETCH_RETRY_MAX_DELAY_MS", 10_000);
// Probe reachability before each watch cycle so a flaky endpoint fails fast instead
// of burning the per-cycle watchdog budget on long upload retries.
const HEALTHCHECK_ENABLED = process.env.TOKEN_BOARD_HEALTHCHECK !== "false";
const HEALTHCHECK_TIMEOUT_MS = readNumberEnv("TOKEN_BOARD_HEALTHCHECK_TIMEOUT_MS", 10_000);
// Final backstop on tracked uploaded-event IDs (the working set is normally pruned
// to the active collection window — see pruneUploadedIds).
const UPLOADED_ID_CAP = readNumberEnv("TOKEN_BOARD_UPLOADED_ID_CAP", 50_000);

async function main() {
  const command = process.argv[2] || "upload";

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    await initConfig();
    return;
  }

  if (command === "login") {
    await loginWithGitHub();
    return;
  }

  if (command === "sync") {
    await syncOnce();
    return;
  }

  if (command === "watch") {
    const config = await loadOrLoginConfig();
    await watch(config);
    return;
  }

  if (command === "speed") {
    await printLocalAgentSpeed();
    return;
  }

  const config = await loadAgentConfig();

  if (command === "collect") {
    const events = await collectAndSanitize(config);
    const userConfig = await collectCurrentUserConfig();
    console.log(JSON.stringify(createIngestPayload(events, clientInfo(), userConfig), null, 2));
    return;
  }

  if (command === "upload") {
    await uploadOnce(config);
    return;
  }

  if (command === "resync") {
    await uploadOnce(config, { force: true });
    return;
  }

  if (command === "replace") {
    await replaceAll(config);
    return;
  }

  printHelp();
  process.exitCode = 1;
}

// Safe full-window rewrite: stage every batch on the server, verify the manifest,
// then atomically swap this user's history. No delete happens before commit.
async function replaceAll(config: AgentConfig) {
  const report = await collectAndSanitizeWithReport(config, { fullHistory: true });
  const collected = report.events;
  if (!collected.length) {
    throw new Error("Refusing to replace server history with an EMPTY collection; check collector config.");
  }
  if (!report.complete) {
    throw new Error(
      `Refusing to replace from an incomplete scan: ${report.parseFailures.length} files failed to parse.`
    );
  }

  const userConfig = await collectCurrentUserConfig();
  const batches = chunkEvents(collected, INGEST_BATCH_SIZE);
  const replaceId = randomUUID();
  const digest = eventIdDigest(collected);
  logInfo(`Staging ${collected.length} events for atomic replacement (${batches.length} batches).`);

  await postReplacePhase(config, "start", replaceId, [], {
    expectedEvents: collected.length,
    digest,
    complete: true,
    userConfig,
  });
  for (let index = 0; index < batches.length; index += 1) {
    await postReplacePhase(config, "append", replaceId, batches[index]);
    if (index % 10 === 0 || index === batches.length - 1) {
      logInfo(`Staged replace batch ${index + 1}/${batches.length}.`);
    }
  }
  const result = await postReplacePhase(config, "commit", replaceId, [], { digest });
  await uploadAgentSpeedHistoryBestEffort(config, report.speedHistory);

  await writeState(config.stateFile, {
    apiUrl: config.apiUrl,
    userId: config.userId || "local",
    uploadedIds: collected.map((event) => event.id).slice(-UPLOADED_ID_CAP),
    lastUploadedAt: new Date().toISOString(),
  });

  logInfo(
    `Replace complete. accepted=${result.accepted} duplicates=${result.duplicates} server records=${result.records}`
  );
  return result;
}

async function postReplacePhase(
  config: AgentConfig,
  phase: "start" | "append" | "commit" | "abort",
  replaceId: string,
  events: Awaited<ReturnType<typeof collectAndSanitize>>,
  options: {
    expectedEvents?: number;
    digest?: string;
    complete?: boolean;
    userConfig?: TokenBoardUserConfig | null;
  } = {}
) {
  const bearerToken = config.agentToken || config.uploadToken;

  if (!bearerToken) {
    throw new Error("Missing agent token. Run `token-board-agent login`.");
  }

  return requestJsonWithRetry(`${config.apiUrl}/api/usage/replace`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...createIngestPayload(events, clientInfo(), options.userConfig),
      replace: {
        phase,
        replaceId,
        ...(options.expectedEvents !== undefined ? { expectedEvents: options.expectedEvents } : {}),
        ...(options.digest ? { digest: options.digest } : {}),
        ...(options.complete !== undefined ? { complete: options.complete } : {}),
      },
    }),
  }, "Replace") as Promise<{ accepted: number; duplicates: number; records: number; deleted?: number }>;
}

export async function uploadOnce(config: AgentConfig, options: { force?: boolean } = {}) {
  const state = await readState(config.stateFile);
  const force = options.force === true || process.env.TOKEN_BOARD_FORCE_RESYNC === "1";
  const stateMatches = uploadStateMatchesConfig(state, config);
  const uploadedIds = force || !stateMatches ? new Set<string>() : new Set(state.uploadedIds || []);
  const collectionReport = await collectAndSanitizeWithReport(config);
  const collected = collectionReport.events;
  const collectedIds = new Set(collected.map((event) => event.id));
  const events = collected.filter((event) => !uploadedIds.has(event.id));
  const userConfig = await collectCurrentUserConfig();

  if (!events.length) {
    if (userConfig) {
      await postIngest(config, [], userConfig);
    }
    await uploadAgentSpeedHistoryBestEffort(config, collectionReport.speedHistory);
    logInfo(force ? "No token usage events collected for resync." : "No new token usage events to upload.");
    return { accepted: 0, duplicates: 0, records: 0 };
  }

  const batches = chunkEvents(events, INGEST_BATCH_SIZE);
  const result = { accepted: 0, duplicates: 0, records: 0 };

  for (const batch of batches) {
    const batchResult = await postIngest(config, batch, userConfig);
    result.accepted += batchResult.accepted;
    result.duplicates += batchResult.duplicates;
    result.records = batchResult.records;
  }

  await uploadAgentSpeedHistoryBestEffort(config, collectionReport.speedHistory);

  if (result.accepted > 0 || result.duplicates > 0) {
    await writeState(config.stateFile, {
      apiUrl: config.apiUrl,
      userId: config.userId || "local",
      uploadedIds: pruneUploadedIds(uploadedIds, collectedIds, events),
      lastUploadedAt: new Date().toISOString(),
    });
  }

  logInfo(
    `${force ? "Resynced" : "Uploaded"} ${events.length} events in ${batches.length} batches. accepted=${result.accepted} duplicates=${result.duplicates} records=${result.records}`
  );

  return result;
}

async function uploadAgentSpeedHistoryBestEffort(
  config: AgentConfig,
  snapshots: Awaited<ReturnType<typeof collectAndSanitizeWithReport>>["speedHistory"]
) {
  if (!snapshots.length) return;
  const uploadSnapshots = snapshots.slice(-120);
  const bearerToken = config.agentToken || config.uploadToken;
  if (!bearerToken) return;
  try {
    const result = await requestJsonWithRetry(`${config.apiUrl}/api/agent-speed/history`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), snapshots: uploadSnapshots }),
    }, "Agent speed history") as { accepted?: number };
    logInfo(`Uploaded ${result.accepted ?? uploadSnapshots.length} daily agent-speed aggregates.`);
  } catch (error) {
    logError(`Agent speed history upload will retry next cycle: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function uploadStateMatchesConfig(state: AgentState, config: AgentConfig) {
  const stateApiUrl = state.apiUrl?.replace(/\/+$/, "") || "";
  const stateUserId = state.userId || "";
  const configUserId = config.userId || "local";

  return (!stateApiUrl || stateApiUrl === config.apiUrl) && (!stateUserId || stateUserId === configUserId);
}

export async function collectAndSanitize(config: AgentConfig) {
  return (await collectAndSanitizeWithReport(config)).events;
}

async function collectAndSanitizeWithReport(config: AgentConfig, options: { fullHistory?: boolean } = {}) {
  const maxEventAgeDays = config.privacy.maxEventAgeDays ?? 120;
  const collectionConfig = options.fullHistory
    ? { ...config, sinceHours: maxEventAgeDays * 24 + 1, maxFiles: undefined, maxFileBytes: undefined }
    : config;
  const report = await collectLocalTokenUsageViaAscWithReport(collectionConfig);
  const minTimestamp = Date.now() - maxEventAgeDays * 24 * 60 * 60 * 1000;
  const rawEvents = options.fullHistory
    ? report.events.filter((event) => new Date(event.timestamp).getTime() >= minTimestamp)
    : report.events;
  const user: TokenBoardUploadUser = {
    userId: config.userId || "local",
    displayName: config.displayName || config.userId || os.userInfo().username || "Local User",
    team: config.team || "Friends",
    uploadToken: config.uploadToken || config.agentToken,
  };
  const sanitized = sanitizeIngestEvents(rawEvents, user, config.privacy);

  if (sanitized.errors.length) {
    console.warn(`Skipped ${sanitized.errors.length} events: ${sanitized.errors.slice(0, 3).join("; ")}`);
  }

  return {
    ...report,
    events: sanitized.entries,
    complete: report.complete && sanitized.errors.length === 0,
  };
}

export async function loadAgentConfig(): Promise<AgentConfig> {
  const fileConfig = await readConfigFile(process.env.TOKEN_BOARD_AGENT_CONFIG || DEFAULT_CONFIG_FILE);
  const usagePaths = readListEnv("TOKEN_BOARD_USAGE_PATHS") || readStringArray(fileConfig.usagePaths);
  const apiUrl = readStringEnv("TOKEN_BOARD_API_URL") || readString(fileConfig.apiUrl) || "http://127.0.0.1:8787";
  const uploadToken = readStringEnv("TOKEN_BOARD_UPLOAD_TOKEN") || readString(fileConfig.uploadToken);
  const agentToken = readStringEnv("TOKEN_BOARD_AGENT_TOKEN") || readString(fileConfig.agentToken);

  if (!agentToken && !uploadToken) {
    throw new Error("Run `token-board-agent login` first, or set TOKEN_BOARD_UPLOAD_TOKEN for legacy mode.");
  }

  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    agentToken,
    uploadToken,
    userId: readStringEnv("TOKEN_BOARD_USER_ID") || readString(fileConfig.userId) || os.userInfo().username,
    displayName:
      readStringEnv("TOKEN_BOARD_DISPLAY_NAME") || readString(fileConfig.displayName) || os.userInfo().username,
    team: readStringEnv("TOKEN_BOARD_TEAM") || readString(fileConfig.team) || "Friends",
    usagePaths,
    includeDefaultSources: readBooleanEnv("TOKEN_BOARD_INCLUDE_DEFAULT_SOURCES", readBoolean(fileConfig.includeDefaultSources, true)),
    sinceHours: readNumberEnv("TOKEN_BOARD_SINCE_HOURS", readNumber(fileConfig.sinceHours, 24 * 30)),
    // Kept in the config shape for backwards compatibility, but ASC deliberately
    // does not use file-count/size limits as semantic scan limits.
    maxFiles: undefined,
    maxFileBytes: undefined,
    intervalMs: readNumberEnv("TOKEN_BOARD_INTERVAL_MS", readNumber(fileConfig.intervalMs, 5 * 60 * 1000)),
    stateFile: readStringEnv("TOKEN_BOARD_AGENT_STATE_FILE") || readString(fileConfig.stateFile) || DEFAULT_STATE_FILE,
    privacy: {
      projectMode: readProjectMode(readStringEnv("TOKEN_BOARD_PROJECT_MODE") || readNestedString(fileConfig, "privacy", "projectMode")),
      includeModel: readBooleanEnv(
        "TOKEN_BOARD_INCLUDE_MODEL",
        readNestedBoolean(fileConfig, "privacy", "includeModel", true)
      ),
      includeSource: readBooleanEnv(
        "TOKEN_BOARD_INCLUDE_SOURCE",
        readNestedBoolean(fileConfig, "privacy", "includeSource", true)
      ),
      hashSessionId: readBooleanEnv(
        "TOKEN_BOARD_HASH_SESSION_ID",
        readNestedBoolean(fileConfig, "privacy", "hashSessionId", true)
      ),
      includeSessionTitle: readBooleanEnv(
        "TOKEN_BOARD_INCLUDE_SESSION_TITLE",
        readNestedBoolean(fileConfig, "privacy", "includeSessionTitle", true)
      ),
      maxEventAgeDays: readNumberEnv(
        "TOKEN_BOARD_MAX_EVENT_AGE_DAYS",
        readNestedNumber(fileConfig, "privacy", "maxEventAgeDays", 120)
      ),
    },
  };
}

async function loadLocalCollectionConfig(): Promise<TokenUsageCollectorConfig> {
  const fileConfig = await readConfigFile(process.env.TOKEN_BOARD_AGENT_CONFIG || DEFAULT_CONFIG_FILE);
  return {
    usagePaths: readListEnv("TOKEN_BOARD_USAGE_PATHS") || readStringArray(fileConfig.usagePaths),
    includeDefaultSources: readBooleanEnv(
      "TOKEN_BOARD_INCLUDE_DEFAULT_SOURCES",
      readBoolean(fileConfig.includeDefaultSources, true)
    ),
    sinceHours: readNumberEnv("TOKEN_BOARD_SINCE_HOURS", readNumber(fileConfig.sinceHours, 24 * 30)),
    maxFiles: undefined,
    maxFileBytes: undefined,
  };
}

async function printLocalAgentSpeed() {
  const config = await loadLocalCollectionConfig();
  const report = await collectLocalAgentSpeedViaAscWithReport(config);
  const asJson = process.argv.includes("--json");
  if (asJson) {
    console.log(JSON.stringify({ ...report, sinceHours: config.sinceHours }, null, 2));
    return;
  }

  console.log(`Local agent speed · last ${formatHours(config.sinceHours ?? 24 * 30)}`);
  console.log(
    `Scanned ${report.filesParsed}/${report.filesDiscovered} session files; ` +
      `${report.analysis.requestSampleCount} requests and ${report.analysis.closedTurnCount} closed turns.\n`
  );

  console.log("Model speed (derived from local request timestamps)");
  const available = report.analysis.modelSpeed.filter((summary) => summary.available);
  if (!available.length) {
    console.log("  No model has enough varied samples yet.");
  } else {
    for (const summary of available) {
      console.log(
        `  ${summary.engine.padEnd(7)} ${summary.model.padEnd(28)} ` +
          `${formatNumber(summary.decodeTokensPerSecond)} tok/s  ` +
          `${formatNumber(summary.fixedOverheadSeconds)}s fixed  ` +
          `jitter p90 ${formatNumber(summary.jitterP90)}x / p99 ${formatNumber(summary.jitterP99)}x  ` +
          `n=${summary.sampleCount}  R²=${formatNumber(summary.rSquared, 2)}  ${summary.confidence}`
      );
    }
  }

  const unavailable = report.analysis.modelSpeed.filter((summary) => !summary.available);
  for (const summary of unavailable) {
    console.log(
      `  ${summary.engine.padEnd(7)} ${summary.model.padEnd(28)} unavailable: ` +
        `${speedUnavailableReason(summary.unavailableReason)} (n=${summary.sampleCount})`
    );
  }

  console.log("\nTime composition (closed turns only; overlapping tools counted once)");
  if (!report.analysis.timeComposition.length) {
    console.log("  No closed turns available yet.");
  } else {
    for (const summary of report.analysis.timeComposition) {
      console.log(
        `  ${summary.engine.padEnd(7)} non-tool ${formatNumber(summary.nonToolPercent)}%  ` +
          `tool ${formatNumber(summary.toolPercent)}%  turns=${summary.turnCount}`
      );
    }
  }

  if (report.parseFailures.length) {
    console.warn(`\nWarning: ${report.parseFailures.length} files could not be parsed; results are partial.`);
  }
  console.log(
    "\nNotes: fixed overhead and tok/s are estimates, not TTFT measurements. " +
      "Compare models within the same engine; tool time includes permission-confirmation waits. Nothing is uploaded."
  );
}

function formatHours(hours: number) {
  if (hours >= 24 && hours % 24 === 0) {
    return `${hours / 24}d`;
  }
  return `${hours}h`;
}

function formatNumber(value: number | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function speedUnavailableReason(reason: string | undefined) {
  if (reason === "too_few_samples") return "needs at least 30 samples";
  if (reason === "output_range_too_narrow") return "output-token range is too narrow";
  return "regression was unstable";
}

async function syncOnce() {
  const config = await loadOrLoginConfig();

  await uploadOnce(config);

  const leaderboardUrl = readStringEnv("TOKEN_BOARD_LEADERBOARD_URL");

  if (leaderboardUrl) {
    console.log(`Open leaderboard: ${leaderboardUrl}`);
  }
}

async function loadOrLoginConfig() {
  try {
    return await loadAgentConfig();
  } catch (error) {
    if (!isMissingAgentTokenError(error)) {
      throw error;
    }

    console.log("No saved GitHub agent session found. Starting login first.");
    await loginWithGitHub();
    return loadAgentConfig();
  }
}

async function watch(config: AgentConfig) {
  // Per-cycle watchdog: abandon a stuck upload pass instead of wedging the loop
  // forever. Defaults to twice the poll interval (min 10m) so a large legitimate
  // backlog still has room to finish.
  const cycleTimeoutMs = readNumberEnv(
    "TOKEN_BOARD_CYCLE_TIMEOUT_MS",
    Math.max(config.intervalMs * 2, 10 * 60 * 1000)
  );
  logInfo(`Token usage agent watching every ${Math.round(config.intervalMs / 1000)}s.`);

  while (true) {
    try {
      if (HEALTHCHECK_ENABLED && !(await checkApiHealth(config.apiUrl))) {
        logError(`API health check failed for ${config.apiUrl}; skipping this cycle.`);
      } else {
        await withWatchdog(uploadOnce(config), cycleTimeoutMs, "upload cycle");
      }
    } catch (error) {
      logError(error instanceof Error ? error.message : String(error));
    }

    await sleep(config.intervalMs);
  }
}

function withWatchdog<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const watchdog = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} exceeded ${ms}ms watchdog; abandoning this cycle to keep the loop alive`));
    }, ms);
  });
  return Promise.race([promise, watchdog]).finally(() => clearTimeout(timer));
}

async function checkApiHealth(apiUrl: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiUrl}/api/usage/health`, { method: "GET", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Prune tracked uploaded-event IDs to the active collection window: keep only
// previously-uploaded IDs still being scanned, then add the freshly uploaded ones.
// Keeps the state file bounded by time instead of accreting forever.
function pruneUploadedIds(
  previousIds: Set<string>,
  collectedIds: Set<string>,
  newlyUploadedEvents: Array<{ id: string }>
) {
  const retained: string[] = [];
  for (const id of previousIds) {
    if (collectedIds.has(id)) {
      retained.push(id);
    }
  }
  for (const event of newlyUploadedEvents) {
    retained.push(event.id);
  }
  return [...new Set(retained)].slice(-UPLOADED_ID_CAP);
}

async function postIngest(
  config: AgentConfig,
  events: Awaited<ReturnType<typeof collectAndSanitize>>,
  userConfig?: TokenBoardUserConfig | null
) {
  const bearerToken = config.agentToken || config.uploadToken;

  if (!bearerToken) {
    throw new Error("Missing agent token. Run `token-board-agent login`.");
  }

  return requestJsonWithRetry(`${config.apiUrl}/api/usage/ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createIngestPayload(events, clientInfo(), userConfig)),
  }, "Upload") as Promise<{ accepted: number; duplicates: number; records: number }>;
}

function chunkEvents<T>(events: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < events.length; index += size) {
    chunks.push(events.slice(index, index + size));
  }

  return chunks;
}

type FetchJsonError = Error & {
  code?: string;
  status?: number;
};

async function requestJsonWithRetry(url: string, options: RequestInit, label: string) {
  let lastError: FetchJsonError | undefined;

  for (let attempt = 0; attempt <= FETCH_MAX_RETRIES; attempt += 1) {
    try {
      const { response, text } = await fetchTextWithTimeout(url, options);
      const payload = parseJsonPayload(text);

      if (response.ok) {
        return payload;
      }

      const error = new Error(responseErrorMessage(payload, label, response.status)) as FetchJsonError;
      error.status = response.status;

      if (!isRetryableStatus(response.status) || attempt === FETCH_MAX_RETRIES) {
        throw error;
      }

      lastError = error;
    } catch (error) {
      lastError = normalizeFetchError(error, label);

      if (!isRetryableFetchError(lastError) || attempt === FETCH_MAX_RETRIES) {
        throw lastError;
      }
    }

    const delayMs = retryDelayMs(attempt);
    logError(`${lastError.message}; retrying in ${delayMs}ms (${attempt + 1}/${FETCH_MAX_RETRIES + 1})`);
    await sleep(delayMs);
  }

  throw lastError || new Error(`${label} failed`);
}

async function fetchTextWithTimeout(url: string, options: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    // Read the body under the same abort timer. A stalled body (headers arrive but
    // the stream never finishes — common on flaky reverse proxies) would otherwise
    // hang here with no timeout, wedging the whole watch loop.
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (isAbortError(error)) {
      const timeoutError = new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`) as FetchJsonError;
      timeoutError.code = "ETIMEDOUT";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonPayload(text: string): Record<string, unknown> {
  if (!text) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { error: text.trim() || "Invalid JSON response" };
  }
}

function responseErrorMessage(payload: Record<string, unknown>, label: string, status: number) {
  const payloadMessage = readString(payload.error) || readString(payload.errorDescription);
  return payloadMessage
    ? `${label} failed with HTTP ${status}: ${truncateLogMessage(payloadMessage)}`
    : `${label} failed with HTTP ${status}`;
}

function normalizeFetchError(error: unknown, label: string): FetchJsonError {
  if (error instanceof Error) {
    return error as FetchJsonError;
  }

  return new Error(`${label} failed: ${String(error)}`);
}

function isRetryableFetchError(error: FetchJsonError) {
  if (typeof error.status === "number") {
    return isRetryableStatus(error.status);
  }

  return true;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function retryDelayMs(attempt: number) {
  const exponentialDelay = Math.min(FETCH_RETRY_MAX_DELAY_MS, FETCH_RETRY_BASE_DELAY_MS * 2 ** attempt);
  const jitter = Math.floor(Math.random() * Math.min(250, Math.max(1, exponentialDelay * 0.2)));
  return exponentialDelay + jitter;
}

function logInfo(message: string) {
  console.log(`${new Date().toISOString()} ${message}`);
}

function logError(message: string) {
  console.error(`${new Date().toISOString()} ${message}`);
}

function truncateLogMessage(message: string) {
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function loginWithGitHub() {
  const configPath = process.env.TOKEN_BOARD_AGENT_CONFIG || DEFAULT_CONFIG_FILE;
  const fileConfig = await readConfigFile(configPath);
  const apiUrl = (readStringEnv("TOKEN_BOARD_API_URL") || readString(fileConfig.apiUrl) || "http://127.0.0.1:8787").replace(
    /\/+$/,
    ""
  );
  const start = await postJson(`${apiUrl}/api/auth/device/start`, {});

  console.log("Open GitHub device login and enter the code:");
  console.log(`  ${start.verificationUri}`);
  console.log(`  ${start.userCode}`);

  const expiresAt = Date.now() + Number(start.expiresIn || 900) * 1000;
  let intervalMs = Number(start.interval || 5) * 1000;

  while (Date.now() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    // The poll endpoint returns HTTP 200 only for pending/slow_down; terminal device
    // errors (access_denied, expired_token, …) come back as HTTP 400, which postJson
    // throws on — surface a clear message instead of an opaque request failure.
    let poll: Awaited<ReturnType<typeof postJson>>;
    try {
      poll = await postJson(`${apiUrl}/api/auth/device/poll`, { deviceCode: start.deviceCode });
    } catch (error) {
      throw new Error(
        `GitHub device login failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (poll.status === "authorized" && poll.token) {
      const nextConfig = {
        ...fileConfig,
        apiUrl,
        agentToken: poll.token,
        userId: poll.user?.userId || fileConfig.userId || os.userInfo().username,
        displayName: poll.user?.displayName || fileConfig.displayName || os.userInfo().username,
        team: poll.user?.team || fileConfig.team || "GitHub",
        intervalMs: readNumber(fileConfig.intervalMs, 300000),
        includeDefaultSources: readBoolean(fileConfig.includeDefaultSources, true),
        usagePaths: readStringArray(fileConfig.usagePaths) || [],
        privacy:
          fileConfig.privacy && typeof fileConfig.privacy === "object"
            ? fileConfig.privacy
            : {
                projectMode: "basename",
                includeModel: true,
                includeSource: true,
                hashSessionId: true,
                maxEventAgeDays: 120,
              },
      };

      delete (nextConfig as { uploadToken?: unknown }).uploadToken;
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, { mode: 0o600 });
      console.log(`Logged in as ${poll.user?.githubLogin || poll.user?.displayName || "GitHub user"}.`);
      console.log(`Saved agent session to ${configPath}`);
      return;
    }

    if (poll.status === "slow_down") {
      intervalMs += 5000;
    } else if (poll.status !== "authorization_pending") {
      throw new Error(poll.errorDescription || poll.error || poll.status || "GitHub device login failed");
    }
  }

  throw new Error("GitHub device login expired. Run `token-board-agent login` again.");
}

async function initConfig() {
  const filePath = process.env.TOKEN_BOARD_AGENT_CONFIG || DEFAULT_CONFIG_FILE;

  try {
    await fs.access(filePath);
    console.log(`Config already exists: ${filePath}`);
    return;
  } catch {
    // Create below.
  }

  const template = {
    apiUrl: "http://127.0.0.1:8787",
    userId: os.userInfo().username,
    displayName: os.userInfo().username,
    team: "Friends",
    intervalMs: 300000,
    includeDefaultSources: true,
    usagePaths: [] as string[],
    privacy: {
      projectMode: "basename",
      includeModel: true,
      includeSource: true,
      hashSessionId: true,
      maxEventAgeDays: 120,
    },
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(template, null, 2)}\n`, { mode: 0o600 });
  console.log(`Created ${filePath}`);
}

async function readConfigFile(filePath: string) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function readState(filePath: string): Promise<AgentState> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as AgentState;
  } catch {
    return {};
  }
}

async function writeState(filePath: string, state: AgentState) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function clientInfo() {
  return {
    name: "token-usage-agent",
    version: AGENT_VERSION,
    collectorSchemaVersion: COLLECTOR_SCHEMA_VERSION,
    hostId: os.hostname(),
    platform: os.platform(),
  };
}

function eventIdDigest(events: Array<{ id: string; upstreamEventId?: string }>) {
  const keys = events.map((event) => event.upstreamEventId || event.id).sort().join("\n");
  return `sha256:${createHash("sha256").update(keys).digest("hex")}`;
}

function collectCurrentUserConfig() {
  return collectTokenBoardUserConfig({
    agentName: "token-usage-agent",
    agentVersion: AGENT_VERSION,
  });
}

function printHelp() {
  console.log(`Usage:
  npx --yes token-board-agent
  npx --yes token-board-agent install
  npx --yes token-board-agent status
  npx --yes token-board-agent uninstall
  npx --yes token-board-agent login
  npx --yes token-board-agent upload
  npx --yes token-board-agent speed
  npx --yes token-board-agent resync
  npx --yes token-board-agent replace
  npx --yes token-board-agent watch

Local repo equivalents:
  pnpm token:agent init
  pnpm token:agent login
  pnpm token:agent sync
  pnpm token:agent collect
  pnpm token:agent speed
  pnpm token:agent upload
  pnpm token:agent resync
  pnpm token:agent replace
  pnpm token:agent watch`);
}

async function postJson(url: string, body: unknown) {
  return requestJsonWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, "Request") as Promise<Record<string, any>>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function readStringEnv(name: string) {
  return readString(process.env[name]);
}

function isMissingAgentTokenError(error: unknown) {
  return error instanceof Error && error.message.includes("token-board-agent login");
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.flatMap((item) => (typeof item === "string" ? [item] : [])) : undefined;
}

function readListEnv(name: string) {
  const value = process.env[name];
  return value?.trim() ? value.split(",").map((item) => item.trim()).filter(Boolean) : undefined;
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readBooleanEnv(name: string, fallback: boolean) {
  const value = process.env[name];
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readNonNegativeIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function readNestedString(record: Record<string, unknown>, parent: string, key: string) {
  const value = record[parent];
  return value && typeof value === "object" ? readString((value as Record<string, unknown>)[key]) : "";
}

function readNestedBoolean(record: Record<string, unknown>, parent: string, key: string, fallback: boolean) {
  const value = record[parent];
  return value && typeof value === "object" ? readBoolean((value as Record<string, unknown>)[key], fallback) : fallback;
}

function readNestedNumber(record: Record<string, unknown>, parent: string, key: string, fallback: number) {
  const value = record[parent];
  return value && typeof value === "object" ? readNumber((value as Record<string, unknown>)[key], fallback) : fallback;
}

function readProjectMode(value: string): TokenBoardPrivacyOptions["projectMode"] {
  return value === "hash" || value === "none" ? value : "basename";
}

void main().catch((error) => {
  logError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
