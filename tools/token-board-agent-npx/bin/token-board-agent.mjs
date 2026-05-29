#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const API_URL = (process.env.TOKEN_BOARD_API_URL || "https://8-218-149-148.anyip.dev/token-board").replace(/\/+$/, "");
const LEADERBOARD_URL = process.env.TOKEN_BOARD_LEADERBOARD_URL || "https://ffffhx.github.io/open-token-board/board/";
const CONFIG_FILE = process.env.TOKEN_BOARD_AGENT_CONFIG || path.join(os.homedir(), ".token-board-agent.json");
const STATE_FILE = process.env.TOKEN_BOARD_AGENT_STATE_FILE || path.join(os.homedir(), ".token-board-agent-state.json");
const INTERVAL_MS = readPositiveNumber(process.env.TOKEN_BOARD_INTERVAL_MS, 5 * 60 * 1000);
const SINCE_MS = readPositiveNumber(process.env.TOKEN_BOARD_SINCE_HOURS, 24 * 30) * 60 * 60 * 1000;
const MAX_FILES = readPositiveNumber(process.env.TOKEN_BOARD_MAX_FILES, 800);
const MAX_FILE_BYTES = readPositiveNumber(process.env.TOKEN_BOARD_MAX_FILE_BYTES, 5 * 1024 * 1024);
const MAX_CODEX_FILE_BYTES = readPositiveNumber(process.env.TOKEN_BOARD_MAX_CODEX_FILE_BYTES, 256 * 1024 * 1024);
const FETCH_TIMEOUT_MS = readPositiveNumber(process.env.TOKEN_BOARD_FETCH_TIMEOUT_MS, 30_000);
const FETCH_MAX_RETRIES = readNonNegativeInteger(
  process.env.TOKEN_BOARD_FETCH_MAX_RETRIES ?? process.env.TOKEN_BOARD_FETCH_RETRIES,
  2
);
const FETCH_RETRY_BASE_DELAY_MS = readPositiveNumber(process.env.TOKEN_BOARD_FETCH_RETRY_BASE_DELAY_MS, 1_000);
const FETCH_RETRY_MAX_DELAY_MS = readPositiveNumber(process.env.TOKEN_BOARD_FETCH_RETRY_MAX_DELAY_MS, 10_000);
const BATCH_SIZE = 1000;
const VERSION = "0.4.12";
const PACKAGE_NAME = "token-board-agent";
const NPX_COMMAND = `npx --yes ${PACKAGE_NAME}`;
const SESSION_TITLE_MAX_LENGTH = 80;
const MAX_INVALID_USAGE_WARNINGS = 5;
const INSTALL_DIR = path.join(os.homedir(), ".token-board-agent");
const INSTALLED_AGENT_FILE = path.join(INSTALL_DIR, "token-board-agent.mjs");
const LAUNCH_AGENT_LABEL = "dev.ffffhx.token-board-agent";
const LAUNCH_AGENT_PLIST = path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
const WINDOWS_TASK_NAME = "TokenBoardAgent";
const WINDOWS_WRAPPER_FILE = path.join(INSTALL_DIR, "token-board-agent-upload.cmd");
const WINDOWS_LAUNCHER_FILE = path.join(INSTALL_DIR, "token-board-agent-upload.vbs");
const LOG_FILE = path.join(INSTALL_DIR, "agent.log");
const ERROR_LOG_FILE = path.join(INSTALL_DIR, "agent.err.log");
const TOKEN_KEYS = new Set([
  "cached_input_tokens",
  "cachedInputTokens",
  "cache_creation_input_tokens",
  "cacheCreationInputTokens",
  "cache_read_input_tokens",
  "cacheReadInputTokens",
  "cachedTokens",
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
  "reasoningTokens",
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
const USAGE_FILE_EXTENSIONS = new Set([".csv", ".json", ".jsonl", ".log", ".vscdb"]);
const USAGE_FILE_NAMES = new Set(["state.vscdb", "state.vscdb.backup", "storage.json"]);
const SKIP_DIR_NAMES = new Set([
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
  "node_modules",
  "extensions",
  "builtin_skills",
]);
const DEFAULT_SOURCE_TARGETS = [
  {
    source: "codex",
    tool: "Codex CLI",
    paths: [homePath(".codex", "sessions"), homePath(".codex", "archived_sessions"), homePath(".codex", "projects")],
  },
  {
    source: "claude-code",
    tool: "Claude Code",
    paths: [homePath(".claude", "projects"), homePath(".claude", "history.jsonl")],
  },
  {
    source: "cursor",
    tool: "Cursor",
    paths: [
      appSupportPath("Cursor", "User", "globalStorage"),
      appSupportPath("Cursor", "logs"),
      configPath("Cursor", "User", "globalStorage"),
      configPath("Cursor", "logs"),
      appDataPath("Cursor", "User", "globalStorage"),
      appDataPath("Cursor", "logs"),
    ],
  },
  {
    source: "trae",
    tool: "Trae",
    paths: [
      appSupportPath("Trae", "User", "globalStorage"),
      appSupportPath("Trae CN", "User", "globalStorage"),
      appSupportPath("Trae", "logs"),
      appSupportPath("Trae CN", "logs"),
      appSupportPath("Trae", "ModularData", "ai-agent"),
      appSupportPath("Trae CN", "ModularData", "ai-agent"),
      configPath("Trae", "User", "globalStorage"),
      configPath("Trae CN", "User", "globalStorage"),
      appDataPath("Trae", "User", "globalStorage"),
      appDataPath("Trae CN", "User", "globalStorage"),
      homePath(".trae"),
      homePath(".trae-cn"),
      homePath(".trae-aicc-internal"),
    ],
  },
];
let invalidUsageWarningCount = 0;

main().catch((error) => {
  logError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const command = process.argv[2] || "sync";
  if (command === "watch") {
    logInfo(`[token-board-agent] running ${command}`);
  } else {
    console.log(`[token-board-agent] running ${command}`);
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "login") {
    await login();
    return;
  }

  if (command === "install") {
    if (process.platform === "win32") {
      await loadOrLoginConfig();
      await installWindowsTask();
    } else {
      ensureMacosLaunchd();
      await loadOrLoginConfig();
      await installLaunchAgent();
    }
    return;
  }

  if (command === "uninstall") {
    if (process.platform === "win32") {
      await uninstallWindowsTask();
    } else {
      await uninstallLaunchAgent();
    }
    return;
  }

  if (command === "status") {
    if (process.platform === "win32") {
      await printWindowsTaskStatus();
    } else {
      await printLaunchAgentStatus();
    }
    return;
  }

  if (command === "sync" || command === "upload") {
    await uploadOnce(await loadOrLoginConfig());
    console.log(`Open leaderboard: ${LEADERBOARD_URL}`);
    return;
  }

  if (command === "resync") {
    await uploadOnce(await loadOrLoginConfig(), { force: true });
    console.log(`Open leaderboard: ${LEADERBOARD_URL}`);
    return;
  }

  if (command === "replace") {
    await replaceRemoteUsage(await loadOrLoginConfig());
    console.log(`Open leaderboard: ${LEADERBOARD_URL}`);
    return;
  }

  if (command === "collect") {
    const config = await readAgentConfig();
    const events = await collectLocalUsageEvents(config);
    const userConfig = await collectUserConfig();
    console.log(JSON.stringify(createIngestPayload(events, userConfig), null, 2));
    return;
  }

  if (command === "watch") {
    const config = await loadOrLoginConfig();
    logInfo(`Token usage agent watching every ${Math.round(INTERVAL_MS / 1000)}s.`);

    while (true) {
      await uploadOnce(config).catch((error) => {
        logError(error instanceof Error ? error.message : String(error));
      });
      await sleep(INTERVAL_MS);
    }
  }

  printHelp();
  process.exitCode = 1;
}

async function installLaunchAgent() {
  ensureMacosLaunchd();

  await installAgentScript();
  await fs.mkdir(path.dirname(LAUNCH_AGENT_PLIST), { recursive: true });
  await fs.writeFile(LAUNCH_AGENT_PLIST, launchAgentPlist(), { mode: 0o644 });

  if (process.env.TOKEN_BOARD_AGENT_SKIP_LAUNCHCTL === "1") {
    console.log(`Installed launch agent files without launchctl: ${LAUNCH_AGENT_PLIST}`);
    return;
  }

  const domain = launchctlDomain();
  await runLaunchctl(["bootout", domain, LAUNCH_AGENT_PLIST], { allowFailure: true });
  await runLaunchctl(["bootstrap", domain, LAUNCH_AGENT_PLIST]);
  await runLaunchctl(["enable", `${domain}/${LAUNCH_AGENT_LABEL}`], { allowFailure: true });
  await runLaunchctl(["kickstart", "-k", `${domain}/${LAUNCH_AGENT_LABEL}`]);

  console.log("Token board background sync installed.");
  console.log(`LaunchAgent: ${LAUNCH_AGENT_PLIST}`);
  console.log(`Logs: ${LOG_FILE}`);
}

async function installWindowsTask() {
  ensureWindowsTaskScheduler();

  await installAgentScript();
  await fs.writeFile(WINDOWS_WRAPPER_FILE, windowsTaskWrapper(), { mode: 0o755 });
  await fs.writeFile(WINDOWS_LAUNCHER_FILE, windowsHiddenLauncher(), { mode: 0o644 });

  const minutes = Math.max(1, Math.round(INTERVAL_MS / 60_000));
  await runSchtasks([
    "/Create",
    "/TN",
    WINDOWS_TASK_NAME,
    "/SC",
    "MINUTE",
    "/MO",
    String(minutes),
    "/TR",
    windowsTaskRunCommand(),
    "/F",
  ]);
  await runSchtasks(["/Run", "/TN", WINDOWS_TASK_NAME], { allowFailure: true });

  console.log("Token board background sync installed.");
  console.log(`Windows Task Scheduler task: ${WINDOWS_TASK_NAME}`);
  console.log(`Hidden launcher: ${WINDOWS_LAUNCHER_FILE}`);
  console.log(`Wrapper: ${WINDOWS_WRAPPER_FILE}`);
  console.log(`Logs: ${LOG_FILE}`);
}

async function uninstallLaunchAgent() {
  ensureMacosLaunchd();

  if (process.env.TOKEN_BOARD_AGENT_SKIP_LAUNCHCTL !== "1") {
    await runLaunchctl(["bootout", launchctlDomain(), LAUNCH_AGENT_PLIST], { allowFailure: true });
  }

  await fs.rm(LAUNCH_AGENT_PLIST, { force: true });
  await fs.rm(INSTALLED_AGENT_FILE, { force: true });
  console.log("Token board background sync uninstalled.");
  console.log(`Kept auth config: ${CONFIG_FILE}`);
  console.log(`Kept upload state: ${STATE_FILE}`);
}

async function uninstallWindowsTask() {
  ensureWindowsTaskScheduler();

  await runSchtasks(["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"], { allowFailure: true });
  await fs.rm(WINDOWS_LAUNCHER_FILE, { force: true });
  await fs.rm(WINDOWS_WRAPPER_FILE, { force: true });
  await fs.rm(INSTALLED_AGENT_FILE, { force: true });
  console.log("Token board background sync uninstalled.");
  console.log(`Removed Windows Task Scheduler task: ${WINDOWS_TASK_NAME}`);
  console.log(`Kept auth config: ${CONFIG_FILE}`);
  console.log(`Kept upload state: ${STATE_FILE}`);
}

async function printLaunchAgentStatus() {
  ensureMacosLaunchd();
  const plistExists = await fileExists(LAUNCH_AGENT_PLIST);
  const installedScriptExists = await fileExists(INSTALLED_AGENT_FILE);
  const config = await readAgentConfig();
  const state = await readJson(STATE_FILE);
  const stateMatches = uploadStateMatchesConfig(state, config);
  const uploadedIds = stateMatches && Array.isArray(state.uploadedIds) ? state.uploadedIds.length : 0;

  console.log(`LaunchAgent plist: ${plistExists ? LAUNCH_AGENT_PLIST : "not installed"}`);
  console.log(`Installed script: ${installedScriptExists ? INSTALLED_AGENT_FILE : "not installed"}`);
  console.log(`Logs: ${LOG_FILE}`);
  console.log(`Upload state: ${STATE_FILE}`);
  console.log(`Last uploaded: ${stateMatches && state.lastUploadedAt ? state.lastUploadedAt : "never"}`);
  console.log(`Tracked uploaded IDs: ${uploadedIds}`);

  if (process.env.TOKEN_BOARD_AGENT_SKIP_LAUNCHCTL === "1") {
    return;
  }

  const result = await runLaunchctl(["print", `${launchctlDomain()}/${LAUNCH_AGENT_LABEL}`], { allowFailure: true });
  if (result.code === 0) {
    console.log("launchd status: loaded");
    console.log(result.stdout.split("\n").slice(0, 12).join("\n"));
  } else {
    console.log("launchd status: not loaded");
  }
}

async function printWindowsTaskStatus() {
  ensureWindowsTaskScheduler();
  const launcherExists = await fileExists(WINDOWS_LAUNCHER_FILE);
  const wrapperExists = await fileExists(WINDOWS_WRAPPER_FILE);
  const installedScriptExists = await fileExists(INSTALLED_AGENT_FILE);
  const config = await readAgentConfig();
  const state = await readJson(STATE_FILE);
  const stateMatches = uploadStateMatchesConfig(state, config);
  const uploadedIds = stateMatches && Array.isArray(state.uploadedIds) ? state.uploadedIds.length : 0;

  console.log(`Task Scheduler task: ${WINDOWS_TASK_NAME}`);
  console.log(`Hidden launcher: ${launcherExists ? WINDOWS_LAUNCHER_FILE : "not installed"}`);
  console.log(`Wrapper: ${wrapperExists ? WINDOWS_WRAPPER_FILE : "not installed"}`);
  console.log(`Installed script: ${installedScriptExists ? INSTALLED_AGENT_FILE : "not installed"}`);
  console.log(`Logs: ${LOG_FILE}`);
  console.log(`Upload state: ${STATE_FILE}`);
  console.log(`Last uploaded: ${stateMatches && state.lastUploadedAt ? state.lastUploadedAt : "never"}`);
  console.log(`Tracked uploaded IDs: ${uploadedIds}`);

  const result = await runSchtasks(["/Query", "/TN", WINDOWS_TASK_NAME, "/V", "/FO", "LIST"], { allowFailure: true });
  if (result.code === 0) {
    console.log("Task Scheduler status: installed");
    console.log(result.stdout.split(/\r?\n/).slice(0, 24).join("\n"));
  } else {
    console.log("Task Scheduler status: not installed");
  }
}

async function installAgentScript() {
  await fs.mkdir(INSTALL_DIR, { recursive: true });
  await fs.copyFile(fileURLToPath(import.meta.url), INSTALLED_AGENT_FILE);
  await fs.chmod(INSTALLED_AGENT_FILE, 0o755).catch(() => {});
}

async function loadOrLoginConfig() {
  const config = await readAgentConfig();

  if (typeof config.agentToken === "string" && config.agentToken) {
    return config;
  }

  console.log("No saved GitHub agent session found. Starting login first.");
  await login();
  return readAgentConfig();
}

async function login() {
  const start = await postJson(`${API_URL}/api/auth/device/start`, {});

  console.log("Open GitHub device login and enter the code:");
  console.log(`  ${start.verificationUri}`);
  console.log(`  ${start.userCode}`);

  const expiresAt = Date.now() + Number(start.expiresIn || 900) * 1000;
  let intervalMs = Number(start.interval || 5) * 1000;

  while (Date.now() < expiresAt) {
    await sleep(intervalMs);
    const poll = await postJson(`${API_URL}/api/auth/device/poll`, { deviceCode: start.deviceCode });

    if (poll.status === "authorized" && poll.token) {
      const config = {
        apiUrl: API_URL,
        agentToken: poll.token,
        userId: poll.user?.userId || os.userInfo().username,
        displayName: poll.user?.displayName || poll.user?.githubLogin || os.userInfo().username,
        team: poll.user?.team || "GitHub",
      };
      await writeJson(CONFIG_FILE, config);
      console.log(`Logged in as ${poll.user?.githubLogin || poll.user?.displayName || "GitHub user"}.`);
      console.log(`Saved agent session to ${CONFIG_FILE}`);
      return;
    }

    if (poll.status === "slow_down") {
      intervalMs += 5000;
    } else if (poll.status !== "authorization_pending") {
      throw new Error(poll.errorDescription || poll.error || poll.status || "GitHub device login failed");
    }
  }

  throw new Error("GitHub device login expired. Run this command again.");
}

async function uploadOnce(config, options = {}) {
  const state = await readJson(STATE_FILE);
  const force = options.force === true || process.env.TOKEN_BOARD_FORCE_RESYNC === "1";
  const stateMatches = uploadStateMatchesConfig(state, config);
  const uploadedIds = force || !stateMatches ? new Set() : new Set(Array.isArray(state.uploadedIds) ? state.uploadedIds : []);
  const collectedEvents = await collectLocalUsageEvents(config);
  const events = collectedEvents.filter((event) => !uploadedIds.has(event.id));
  const userConfig = await collectUserConfig();

  if (!events.length) {
    if (userConfig) {
      await postIngest(config, [], userConfig);
    }
    logInfo(
      force
        ? "No token usage events collected for resync."
        : "No new token usage events to upload."
    );
    logInfo("Checked Codex, Claude Code, Cursor, Trae, and custom usage paths for recent token logs.");
    return;
  }

  const result = { accepted: 0, duplicates: 0, records: 0 };

  for (const batch of chunk(events, BATCH_SIZE)) {
    const batchResult = await postIngest(config, batch, userConfig);
    result.accepted += Number(batchResult.accepted || 0);
    result.duplicates += Number(batchResult.duplicates || 0);
    result.records = Number(batchResult.records || result.records || 0);
  }

  await writeJson(STATE_FILE, {
    apiUrl: API_URL,
    userId: config.userId,
    uploadedIds: [...new Set([...uploadedIds, ...events.map((event) => event.id)])].slice(-50_000),
    lastUploadedAt: new Date().toISOString(),
  });

  logInfo(
    `${force ? "Resynced" : "Uploaded"} ${events.length} events. accepted=${result.accepted} duplicates=${result.duplicates} records=${result.records}`
  );
}

async function replaceRemoteUsage(config) {
  const collectedEvents = await collectLocalUsageEvents(config);
  const userConfig = await collectUserConfig();

  if (!collectedEvents.length) {
    if (userConfig) {
      await postIngest(config, [], userConfig);
    }
    throw new Error("No token usage events collected; remote records were not changed.");
  }

  const result = { deleted: 0, accepted: 0, duplicates: 0, records: 0 };
  let firstBatch = true;

  for (const batch of chunk(collectedEvents, BATCH_SIZE)) {
    const batchResult = firstBatch ? await postReplace(config, batch, userConfig) : await postIngest(config, batch, userConfig);
    firstBatch = false;
    result.deleted += Number(batchResult.deleted || 0);
    result.accepted += Number(batchResult.accepted || 0);
    result.duplicates += Number(batchResult.duplicates || 0);
    result.records = Number(batchResult.records || result.records || 0);
  }

  await writeJson(STATE_FILE, {
    apiUrl: API_URL,
    userId: config.userId,
    uploadedIds: collectedEvents.map((event) => event.id).slice(-50_000),
    lastUploadedAt: new Date().toISOString(),
  });

  console.log(
    `Replaced remote usage with ${collectedEvents.length} events. deleted=${result.deleted} accepted=${result.accepted} duplicates=${result.duplicates} records=${result.records}`
  );
}

function uploadStateMatchesConfig(state, config) {
  if (!state || typeof state !== "object") {
    return false;
  }

  const stateApiUrl = typeof state.apiUrl === "string" ? state.apiUrl.replace(/\/+$/, "") : "";
  const stateUserId = typeof state.userId === "string" ? state.userId : "";

  return (!stateApiUrl || stateApiUrl === API_URL) && (!stateUserId || stateUserId === config.userId);
}

async function collectLocalUsageEvents(config) {
  const targets = sourceTargets(config);
  const codexTitleIndex = await readCodexTitleIndex(targets);
  const minMtime = Date.now() - SINCE_MS;
  const files = [];

  for (const target of targets) {
    const targetFiles = [];
    for (const targetPath of target.paths) {
      await collectFiles(expandHome(targetPath), target, targetFiles, minMtime, 0);
    }
    files.push(...targetFiles);
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const events = [];
  const configWithTitles = { ...config, codexTitleIndex };
  for (const file of files.slice(0, MAX_FILES * Math.max(1, targets.length))) {
    events.push(...(await parseUsageFile(file.path, file.target, configWithTitles)));
  }

  return dedupe(events);
}

async function readCodexTitleIndex(targets) {
  const codexHomes = new Set([path.resolve(process.env.CODEX_HOME || homePath(".codex"))]);

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

  const titles = new Map();
  for (const codexHome of codexHomes) {
    const indexPath = path.join(codexHome, "session_index.jsonl");
    const raw = await fs.readFile(indexPath, "utf8").catch(() => "");
    if (!raw) {
      continue;
    }

    for (const line of raw.split(/\r?\n/)) {
      const row = safeJson(line);
      if (!row || typeof row !== "object") {
        continue;
      }

      const id = cleanLabel(row.id, 120);
      const title = cleanSessionTitle(row.thread_name || row.threadName || row.title);
      if (id && title) {
        titles.set(id, title);
      }
    }
  }

  return titles;
}

function inferCodexHome(targetPath) {
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

function sourceTargets(config) {
  const targets = [];
  const usagePaths = readListEnv("TOKEN_BOARD_USAGE_PATHS") || readStringArray(config.usagePaths) || [];
  const includeDefaultSources =
    process.env.TOKEN_BOARD_INCLUDE_DEFAULT_SOURCES === "false" ? false : config.includeDefaultSources !== false;

  if (includeDefaultSources) {
    targets.push(...DEFAULT_SOURCE_TARGETS);
  }

  if (usagePaths.length) {
    targets.push({
      source: "custom",
      tool: "Custom Usage",
      paths: usagePaths,
    });
  }

  return targets;
}

async function collectFiles(inputPath, target, files, minMtime, depth) {
  if (files.length >= MAX_FILES || depth > 8) {
    return;
  }

  const stat = await fs.stat(inputPath).catch(() => undefined);
  if (!stat) {
    return;
  }

  if (stat.isFile()) {
    const maxFileBytes = maxUsageFileBytes(inputPath, target);
    if (stat.size <= maxFileBytes && stat.mtimeMs >= minMtime && isUsageFile(inputPath)) {
      files.push({ path: inputPath, mtimeMs: stat.mtimeMs, target });
    }
    return;
  }

  if (!stat.isDirectory() || (depth > 0 && shouldSkipDirectory(inputPath))) {
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(inputPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= MAX_FILES) {
      return;
    }
    await collectFiles(path.join(inputPath, entry.name), target, files, minMtime, depth + 1);
  }
}

async function parseUsageFile(filePath, target, config) {
  if (target.source === "codex" && path.extname(filePath).toLowerCase() === ".jsonl") {
    return parseCodexJsonl(filePath, target, config);
  }

  if (isSqliteUsageFile(filePath)) {
    return parseSqliteUsageFile(filePath, target, config);
  }

  const text = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!text) {
    return [];
  }

  const ext = path.extname(filePath).toLowerCase();
  const context = baseExtractionContext(filePath, target, config);

  if (ext === ".csv") {
    return parseCsvUsage(text, context);
  }

  if (ext === ".jsonl" || ext === ".log") {
    return dedupe(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          const parsed = safeJson(line);
          return parsed === undefined ? [] : extractUsageEventsFromJson(parsed, context);
        })
    );
  }

  const parsed = safeJson(text);
  return parsed === undefined ? [] : extractUsageEventsFromJson(parsed, context);
}

async function parseCodexJsonl(filePath, target, config) {
  const entries = [];
  let model = "unknown";
  let project = projectFromFile(filePath, target.source);
  let sessionTitle = config.codexTitleIndex?.get(sessionIdFromPath(filePath)) || "";
  let sequence = 0;
  let previousTotalUsage = {};

  let lines;
  try {
    lines = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
  } catch {
    return [];
  }

  try {
    for await (const rawLine of lines) {
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

      const parsed = safeJson(line);
      const payload = parsed && typeof parsed.payload === "object" ? parsed.payload : {};

      if (config.includeSessionTitle !== false) {
        const extractedTitle = extractSessionTitle(parsed);
        if (extractedTitle && (!sessionTitle || hasExplicitSessionTitle(parsed))) {
          sessionTitle = extractedTitle;
        }
      }

      if ((parsed?.type === "turn_context" || parsed?.type === "session_meta") && typeof payload.model === "string") {
        model = payload.model;
      }

      if ((parsed?.type === "turn_context" || parsed?.type === "session_meta") && typeof payload.cwd === "string") {
        project = path.basename(payload.cwd);
      }

      if (parsed?.type !== "event_msg" || payload.type !== "token_count" || !payload?.info || !parsed.timestamp) {
        continue;
      }

      const totalUsage = payload.info.total_token_usage;
      const usage =
        totalUsage && typeof totalUsage === "object"
          ? tokenUsageDelta(totalUsage, previousTotalUsage)
          : payload.info.last_token_usage || {};
      if (totalUsage && typeof totalUsage === "object") {
        previousTotalUsage = totalUsage;
      }

      if (tokenUsageTotal(usage) <= 0) {
        continue;
      }

      sequence += 1;
      const event = tryUsageRecordToEvent(usage, {
        config,
        source: target.source,
        tool: target.tool,
        filePath,
        model,
        project,
        sessionId: filePath,
        sessionTitle,
        sequence,
        timestamp: parsed.timestamp,
      });

      if (event) {
        entries.push(event);
      }
    }
  } catch {
    return [];
  }

  return entries;
}

function extractSessionTitle(record) {
  const payload = record && typeof record.payload === "object" ? record.payload : {};
  const payloadType = typeof payload.type === "string" ? payload.type : "";
  const explicitTitle =
    textFromFields(payload, ["sessionTitle", "session_title", "conversationTitle", "conversation_title", "title"]) ||
    textFromFields(record || {}, ["sessionTitle", "session_title", "conversationTitle", "conversation_title", "title"]);

  if (explicitTitle) {
    return cleanSessionTitle(explicitTitle);
  }

  if (record?.type === "event_msg" && payloadType === "user_message") {
    return summarizeSessionTitleFromMessage(
      textFromMessageLike(payload.message) || textFromMessageLike(payload.text_elements)
    );
  }

  return "";
}

function hasTitleNeedle(line) {
  return (
    line.includes('"title"') ||
    line.includes('"sessionTitle"') ||
    line.includes('"session_title"') ||
    line.includes('"conversationTitle"') ||
    line.includes('"conversation_title"')
  );
}

function hasExplicitSessionTitle(record) {
  const payload = record && typeof record.payload === "object" ? record.payload : {};
  return Boolean(
    textFromFields(payload, ["sessionTitle", "session_title", "conversationTitle", "conversation_title", "title"]) ||
      textFromFields(record || {}, ["sessionTitle", "session_title", "conversationTitle", "conversation_title", "title"])
  );
}

function textFromMessageLike(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(textFromMessageLike).filter(Boolean).join(" ");
  }

  if (value && typeof value === "object") {
    return textFromFields(value, ["text", "content", "message", "input_text"]) || textFromMessageLike(value.text_elements);
  }

  return "";
}

function tokenUsageDelta(current, previous) {
  const fields = ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"];
  return Object.fromEntries(
    fields.map((field) => [field, Math.max(0, toNumber(current?.[field]) - toNumber(previous?.[field]))])
  );
}

function tokenUsageTotal(usage) {
  return toNumber(usage?.input_tokens) + toNumber(usage?.output_tokens);
}

function maxUsageFileBytes(filePath, target) {
  return target.source === "codex" && path.extname(filePath).toLowerCase() === ".jsonl"
    ? MAX_CODEX_FILE_BYTES
    : MAX_FILE_BYTES;
}

function extractUsageEventsFromJson(value, context) {
  const entries = [];
  visitJson(value, context, entries, { sequence: 0 }, 0);
  return dedupe(entries);
}

function visitJson(value, context, entries, state, depth) {
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

  const record = value;
  const nextContext = enrichContext(context, record);

  if (hasUsageShape(record)) {
    state.sequence += 1;
    const event = tryUsageRecordToEvent(record, { ...nextContext, sequence: state.sequence });
    if (event) {
      entries.push(event);
    }
    return;
  }

  for (const [key, child] of Object.entries(record)) {
    if (isSensitiveTextKey(key) && (typeof child === "string" || Array.isArray(child))) {
      continue;
    }

    visitJson(child, nextContext, entries, state, depth + 1);
  }
}

function usageRecordToEvent(usage, context) {
  const baseInputTokens = numberFromFields(usage, ["inputTokens", "input_tokens", "inputTokenCount", "promptTokens", "prompt_tokens"]);
  const additiveCachedInputTokens =
    numberFromFields(usage, ["cache_read_input_tokens", "cacheReadInputTokens"]) +
    numberFromFields(usage, ["cache_creation_input_tokens", "cacheCreationInputTokens"]);
  const inputTokens = baseInputTokens + additiveCachedInputTokens;
  const cachedInputTokens =
    numberFromFields(usage, ["cachedInputTokens", "cached_input_tokens", "cachedTokens"]) +
    additiveCachedInputTokens;
  const outputTokens = numberFromFields(usage, ["outputTokens", "output_tokens", "outputTokenCount", "completionTokens", "completion_tokens"]);
  const reasoningOutputTokens = numberFromFields(usage, [
    "reasoningOutputTokens",
    "reasoning_output_tokens",
    "reasoningTokens",
  ]);
  const totalTokens = inputTokens + outputTokens;

  if (totalTokens <= 0) {
    throw new Error("missing input/output token fields; total_tokens fallback is disabled");
  }

  const timestamp = normalizeTimestamp(context.timestamp || textFromFields(usage, ["timestamp", "createdAt", "created_at", "date", "time"]));
  const model = cleanLabel(context.model || textFromFields(usage, ["model", "modelName", "model_name"]), 80) || "unknown";
  const rawProject = context.project || textFromFields(usage, ["project", "repo", "workspace", "cwd", "root", "directory"]);
  const project = projectBasename(rawProject);
  const rawSessionId =
    context.sessionId || textFromFields(usage, ["sessionId", "session_id", "conversationId", "conversation_id", "requestId", "id"]) || context.filePath;
  const sessionId = rawSessionId ? `session:${sha256(rawSessionId).slice(0, 16)}` : "";
  const sessionTitle =
    context.config.includeSessionTitle === false
      ? ""
      : cleanSessionTitle(
          context.sessionTitle || textFromFields(usage, ["sessionTitle", "session_title", "conversationTitle"])
        );
  const base = [
    context.config.userId,
    timestamp,
    context.source,
    model,
    project || "",
    sessionId,
    context.sequence,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  ].join("\n");

  return {
    id: `usage:${sha256(base).slice(0, 32)}`,
    userId: context.config.userId,
    displayName: context.config.displayName,
    team: context.config.team || "GitHub",
    source: context.source,
    tool: context.tool,
    model,
    project,
    sessionId,
    timestamp,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
    messages: numberFromFields(usage, ["messages", "messageCount", "message_count"]),
    sessionTitle,
  };
}

async function postIngest(config, events, userConfig) {
  return requestJsonWithRetry(`${API_URL}/api/usage/ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.agentToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createIngestPayload(events, userConfig)),
  }, "Upload");
}

async function postReplace(config, events, userConfig) {
  return requestJsonWithRetry(`${API_URL}/api/usage/replace`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.agentToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createIngestPayload(events, userConfig)),
  }, "Replace");
}

async function postJson(url, body) {
  return requestJsonWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, "Request");
}

async function parseSqliteUsageFile(filePath, target, config) {
  const context = baseExtractionContext(filePath, target, config);
  const entries = [];
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
      if (!row || typeof row !== "object") {
        continue;
      }

      const value = typeof row.value === "string" ? row.value : "";
      const parsed = safeJson(value);
      if (parsed === undefined) {
        continue;
      }

      entries.push(
        ...extractUsageEventsFromJson(parsed, {
          ...context,
          sessionId: `${filePath}:${typeof row.key === "string" ? row.key : "sqlite"}`,
        })
      );
    }
  }

  return dedupe(entries);
}

function querySqliteJson(filePath, sql) {
  return new Promise((resolve) => {
    execFile("sqlite3", ["-readonly", "-json", filePath, sql], { maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve([]);
        return;
      }

      const parsed = safeJson(stdout);
      resolve(Array.isArray(parsed) ? parsed : []);
    });
  });
}

function parseCsvUsage(text, context) {
  const rows = parseCsvRows(text);
  const [headers, ...bodyRows] = rows;
  if (!headers?.length || !bodyRows.length) {
    return [];
  }

  const entries = bodyRows.flatMap((row, index) => {
    const record = Object.fromEntries(headers.map((header, column) => [header.trim(), row[column] ?? ""]));
    const event = tryUsageRecordToEvent(record, {
      ...enrichContext(context, record),
      sessionId: textFromFields(record, ["sessionId", "session", "conversationId"]) || `${context.filePath}:${index}`,
      sequence: index + 1,
    });
    return event ? [event] : [];
  });

  return dedupe(entries);
}

function tryUsageRecordToEvent(usage, context) {
  try {
    return usageRecordToEvent(usage, context);
  } catch (error) {
    invalidUsageWarningCount += 1;
    if (invalidUsageWarningCount <= MAX_INVALID_USAGE_WARNINGS) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `Skipped token usage record from ${context.source || "unknown"}${context.filePath ? ` (${context.filePath})` : ""}: ${reason}`
      );
    }
    return null;
  }
}

function parseCsvRows(input) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
}

function baseExtractionContext(filePath, target, config) {
  return {
    config,
    source: target.source,
    tool: target.tool,
    filePath,
    project: projectFromFile(filePath, target.source),
    sessionId: filePath,
  };
}

function enrichContext(context, record) {
  return {
    ...context,
    timestamp: textFromFields(record, ["timestamp", "createdAt", "created_at", "date", "time"]) || context.timestamp,
    model: textFromFields(record, ["model", "modelName", "model_name"]) || context.model,
    project: textFromFields(record, ["project", "repo", "workspace", "cwd", "root", "directory"]) || context.project,
    sessionId:
      textFromFields(record, ["sessionId", "session_id", "conversationId", "conversation_id", "requestId", "id"]) ||
      context.sessionId,
    sessionTitle:
      context.sessionTitle || textFromFields(record, ["sessionTitle", "session_title", "conversationTitle"]),
  };
}

function hasUsageShape(record) {
  return Object.keys(record).some((key) => TOKEN_KEYS.has(key)) && sumKnownTokens(record) > 0;
}

function sumKnownTokens(record) {
  return [...TOKEN_KEYS].reduce((sum, key) => sum + toNumber(record[key]), 0);
}

function numberFromFields(record, fields) {
  return fields.reduce((sum, field) => sum + toNumber(record[field]), 0);
}

function textFromFields(record, fields) {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeTimestamp(value) {
  const date = new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function cleanLabel(value, maxLength) {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength)
    : "";
}

function cleanSessionTitle(value) {
  return finalizeSessionTitle(value);
}

function summarizeSessionTitleFromMessage(value) {
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

function prepareSessionTitleText(value) {
  return cleanLabel(value, 120)
    .replace(/```[\s\S]*$/g, "")
    .replace(/^#+\s*/, "")
    .replace(/\btoken\s*榜\b/gi, "token榜")
    .replace(/\bToken\s*Board\b/g, "Token Board")
    .replace(/\s+/g, " ")
    .trim();
}

function compactRequestClause(value) {
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

function hasTitleAction(value) {
  return /(高亮|置顶|展开|收起|隐藏|显示|删除|移除|新增|添加|修复|优化|调整|更新|修改|改成|改为|换成|查看|检查|推荐|实现|支持)/.test(value);
}

function stripRequestPrefix(value) {
  return value
    .trim()
    .replace(/^(?:请|麻烦|帮我|帮忙|帮|可以|能不能|能否|能|现在在|我想|想要|想|把|将|这个|这里|一下)\s*/g, "")
    .trim();
}

function cleanTitleObject(value) {
  return value
    .replace(/^(?:这个|那个|这里的|当前的|本地的|我的|一下)\s*/g, "")
    .replace(/的/g, "")
    .replace(/里看不懂.*$/g, "标题")
    .replace(/(?:一下|下|问题|逻辑|功能|文案|样式)$/g, "")
    .replace(/[吗呢吧呀啊？?。！!]*$/g, "")
    .trim();
}

function formatActionObject(action, object) {
  if (!action || !object) {
    return action || object;
  }

  return /^[A-Za-z0-9]/.test(object) ? `${action} ${object}` : `${action}${object}`;
}

function finalizeSessionTitle(value) {
  const text = prepareSessionTitleText(value);
  const lower = text.toLowerCase();

  if (!text || lower === "none" || lower === "auto" || lower === "unknown" || lower === "n/a") {
    return "";
  }

  return text.length > SESSION_TITLE_MAX_LENGTH
    ? `${text.slice(0, SESSION_TITLE_MAX_LENGTH - 3)}...`
    : text;
}

function projectBasename(value) {
  const text = cleanLabel(value, 240);
  return text ? cleanLabel(path.basename(text.replace(/\\/g, "/")), 80) : undefined;
}

function projectFromFile(filePath, source) {
  const parts = filePath.split(path.sep);
  const projectsIndex = parts.lastIndexOf("projects");

  if ((source === "claude-code" || source === "codex") && projectsIndex >= 0 && parts[projectsIndex + 1]) {
    return parts[projectsIndex + 1];
  }

  return path.basename(path.dirname(filePath));
}

function sessionIdFromPath(filePath) {
  const base = path.basename(filePath, ".jsonl");
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? match[1] : base.replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, "");
}

function isSensitiveTextKey(key) {
  return /^(content|prompt|text|body|transcript)$/i.test(key);
}

function isUsageFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return USAGE_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) || USAGE_FILE_NAMES.has(name);
}

function isSqliteUsageFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return name === "state.vscdb" || name === "state.vscdb.backup" || path.extname(filePath).toLowerCase() === ".vscdb";
}

function shouldSkipDirectory(dirPath) {
  return SKIP_DIR_NAMES.has(path.basename(dirPath));
}

function expandHome(inputPath) {
  return inputPath.startsWith("~/") ? path.join(os.homedir(), inputPath.slice(2)) : inputPath;
}

async function readAgentConfig() {
  const config = await readJson(CONFIG_FILE);
  const username = os.userInfo().username || "local";

  return {
    ...config,
    userId: cleanLabel(config.userId, 80) || username,
    displayName: cleanLabel(config.displayName, 80) || cleanLabel(config.githubLogin, 80) || username,
    team: cleanLabel(config.team, 80) || "GitHub",
    usagePaths: readStringArray(config.usagePaths) || [],
    includeSessionTitle:
      process.env.TOKEN_BOARD_INCLUDE_SESSION_TITLE === "false" ? false : config.includeSessionTitle !== false,
  };
}

function readStringArray(value) {
  return Array.isArray(value) ? value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : [])) : undefined;
}

function readListEnv(name) {
  const value = process.env[name];
  return value?.trim()
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
}

function createIngestPayload(events, userConfig) {
  return {
    schemaVersion: 1,
    client: clientInfo(),
    ...(userConfig ? { userConfig } : {}),
    events,
  };
}

function clientInfo() {
  return { name: "token-board-agent", version: VERSION, hostId: os.hostname(), platform: os.platform() };
}

async function collectUserConfig() {
  const codexHome = path.resolve(process.env.CODEX_HOME || homePath(".codex"));
  const codex = await readCodexConfigSummary(codexHome);
  const hasCodex = Object.values(codex).some((value) => value !== undefined && value !== "");

  return {
    updatedAt: new Date().toISOString(),
    agent: {
      name: "token-board-agent",
      version: VERSION,
      platform: normalizePlatform(os.platform()),
    },
    ...(hasCodex ? { codex } : {}),
  };
}

async function readCodexConfigSummary(codexHome) {
  const topLevelConfig = await readCodexTopLevelConfig(path.join(codexHome, "config.toml"));
  const model = cleanLabel(topLevelConfig.model, 80);
  const modelCache = await readCodexModelCacheSummary(path.join(codexHome, "models_cache.json"), model);

  return {
    model: model || undefined,
    modelReasoningEffort: cleanLabel(topLevelConfig.model_reasoning_effort, 40) || undefined,
    modelContextWindow: positiveInteger(topLevelConfig.model_context_window),
    modelAutoCompactTokenLimit: positiveInteger(topLevelConfig.model_auto_compact_token_limit),
    ...modelCache,
  };
}

async function readCodexTopLevelConfig(filePath) {
  let text = "";

  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    return {};
  }

  const result = {};
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

async function readCodexModelCacheSummary(filePath, model) {
  if (!model) {
    return {};
  }

  let parsed;

  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.models)) {
    return {};
  }

  const modelRecord = parsed.models.find((item) => item && typeof item === "object" && modelMatchesCacheEntry(item, model));

  if (!modelRecord || typeof modelRecord !== "object") {
    return {};
  }

  return {
    modelCacheContextWindow: positiveInteger(modelRecord.context_window),
    modelMaxContextWindow: positiveInteger(modelRecord.max_context_window),
    effectiveContextWindowPercent: percentNumber(modelRecord.effective_context_window_percent),
  };
}

function stripTomlComment(line) {
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

function parseTomlScalar(value) {
  const trimmed = String(value).trim();

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

function modelMatchesCacheEntry(record, model) {
  return [record.id, record.model, record.slug, record.name].some((value) => cleanLabel(value, 120) === model);
}

function positiveInteger(value) {
  const number = typeof value === "string" ? Number(value.replace(/_/g, "")) : Number(value);

  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
}

function percentNumber(value) {
  const number = typeof value === "string" ? Number(value.replace(/%$/, "")) : Number(value);

  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : undefined;
}

function normalizePlatform(value) {
  const platform = String(value).toLowerCase();

  if (platform === "darwin") {
    return "macOS";
  }

  if (platform === "win32") {
    return "Windows";
  }

  return value;
}

function printHelp() {
  console.log(`Usage:
  ${NPX_COMMAND}
  ${NPX_COMMAND} install
  ${NPX_COMMAND} status
  ${NPX_COMMAND} uninstall
  ${NPX_COMMAND} watch
  ${NPX_COMMAND} login
  ${NPX_COMMAND} collect
  ${NPX_COMMAND} upload
  ${NPX_COMMAND} resync
  ${NPX_COMMAND} replace`);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function dedupe(events) {
  const seen = new Set();
  return events.filter((event) => {
    if (seen.has(event.id)) {
      return false;
    }
    seen.add(event.id);
    return true;
  });
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

async function requestJsonWithRetry(url, options, label) {
  let lastError;

  for (let attempt = 0; attempt <= FETCH_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options);
      const text = await response.text();
      const payload = parseJsonPayload(text);

      if (response.ok) {
        return payload;
      }

      const error = new Error(responseErrorMessage(payload, label, response.status));
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
    logError(
      `${lastError.message}; retrying in ${delayMs}ms (${attempt + 1}/${FETCH_MAX_RETRIES + 1})`
    );
    await sleep(delayMs);
  }

  throw lastError || new Error(`${label} failed`);
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (isAbortError(error)) {
      const timeoutError = new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`);
      timeoutError.code = "ETIMEDOUT";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonPayload(text) {
  if (!text) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : { value: parsed };
  } catch {
    return { error: text.trim() || "Invalid JSON response" };
  }
}

function responseErrorMessage(payload, label, status) {
  const payloadMessage = typeof payload.error === "string" && payload.error ? payload.error : "";
  return payloadMessage
    ? `${label} failed with HTTP ${status}: ${truncateLogMessage(payloadMessage)}`
    : `${label} failed with HTTP ${status}`;
}

function normalizeFetchError(error, label) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(`${label} failed: ${String(error)}`);
}

function isRetryableFetchError(error) {
  if (typeof error.status === "number") {
    return isRetryableStatus(error.status);
  }

  return true;
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}

function retryDelayMs(attempt) {
  const exponentialDelay = Math.min(
    FETCH_RETRY_MAX_DELAY_MS,
    FETCH_RETRY_BASE_DELAY_MS * 2 ** attempt
  );
  const jitter = Math.floor(Math.random() * Math.min(250, Math.max(1, exponentialDelay * 0.2)));
  return exponentialDelay + jitter;
}

function logInfo(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

function logError(message) {
  console.error(`${new Date().toISOString()} ${message}`);
}

function truncateLogMessage(message) {
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}

function readPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function readNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function homePath(...segments) {
  return path.join(os.homedir(), ...segments);
}

function appSupportPath(...segments) {
  return path.join(os.homedir(), "Library", "Application Support", ...segments);
}

function configPath(...segments) {
  return path.join(os.homedir(), ".config", ...segments);
}

function appDataPath(...segments) {
  return process.env.APPDATA ? path.join(process.env.APPDATA, ...segments) : path.join(os.homedir(), "AppData", "Roaming", ...segments);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureMacosLaunchd() {
  if (process.platform !== "darwin") {
    throw new Error("Background install currently supports macOS LaunchAgent and Windows Task Scheduler only. Use `watch` on this platform.");
  }
}

function ensureWindowsTaskScheduler() {
  if (process.platform !== "win32") {
    throw new Error("Windows Task Scheduler mode only runs on Windows.");
  }
}

function launchAgentPlist() {
  const environment = {
    TOKEN_BOARD_API_URL: API_URL,
    TOKEN_BOARD_LEADERBOARD_URL: LEADERBOARD_URL,
    TOKEN_BOARD_AGENT_CONFIG: CONFIG_FILE,
    TOKEN_BOARD_AGENT_STATE_FILE: STATE_FILE,
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(LAUNCH_AGENT_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(INSTALLED_AGENT_FILE)}</string>
    <string>watch</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(environment)
  .map(([key, value]) => `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`)
  .join("\n")}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(LOG_FILE)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(ERROR_LOG_FILE)}</string>
</dict>
</plist>
`;
}

function launchctlDomain() {
  return `gui/${process.getuid()}`;
}

function windowsTaskWrapper() {
  return [
    "@echo off",
    "setlocal",
    `set "TOKEN_BOARD_API_URL=${escapeCmdValue(API_URL)}"`,
    `set "TOKEN_BOARD_LEADERBOARD_URL=${escapeCmdValue(LEADERBOARD_URL)}"`,
    `set "TOKEN_BOARD_AGENT_CONFIG=${escapeCmdValue(CONFIG_FILE)}"`,
    `set "TOKEN_BOARD_AGENT_STATE_FILE=${escapeCmdValue(STATE_FILE)}"`,
    `set "TOKEN_BOARD_INTERVAL_MS=${escapeCmdValue(String(INTERVAL_MS))}"`,
    `set "TOKEN_BOARD_MAX_FILES=${escapeCmdValue(String(MAX_FILES))}"`,
    `set "TOKEN_BOARD_MAX_FILE_BYTES=${escapeCmdValue(String(MAX_FILE_BYTES))}"`,
    `set "TOKEN_BOARD_MAX_CODEX_FILE_BYTES=${escapeCmdValue(String(MAX_CODEX_FILE_BYTES))}"`,
    `"${escapeCmdPath(process.execPath)}" "${escapeCmdPath(INSTALLED_AGENT_FILE)}" upload >> "${escapeCmdPath(LOG_FILE)}" 2>> "${escapeCmdPath(ERROR_LOG_FILE)}"`,
    "set EXIT_CODE=%ERRORLEVEL%",
    "endlocal & exit /b %EXIT_CODE%",
    "",
  ].join("\r\n");
}

function windowsHiddenLauncher() {
  return [
    'Set shell = CreateObject("WScript.Shell")',
    `exitCode = shell.Run(${vbsString(windowsCmdRunCommand())}, 0, True)`,
    "WScript.Quit exitCode",
    "",
  ].join("\r\n");
}

function windowsTaskRunCommand() {
  return `"${escapeCmdPath(windowsSystemPath("wscript.exe"))}" //B //Nologo "${escapeCmdPath(WINDOWS_LAUNCHER_FILE)}"`;
}

function windowsCmdRunCommand() {
  const comspec = process.env.ComSpec || windowsSystemPath("cmd.exe");
  return `"${escapeCmdPath(comspec)}" /d /c ""${escapeCmdPath(WINDOWS_WRAPPER_FILE)}""`;
}

function windowsSystemPath(fileName) {
  return path.join(process.env.SystemRoot || "C:\\Windows", "System32", fileName);
}

function runLaunchctl(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("launchctl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (options.allowFailure) {
        resolve({ code: 1, stdout, stderr: error.message });
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({ code: code || 0, stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || `launchctl ${args.join(" ")} failed with exit ${code}`));
      }
    });
  });
}

function runSchtasks(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile("schtasks.exe", args, { windowsHide: true }, (error, stdout = "", stderr = "") => {
      if (!error || options.allowFailure) {
        resolve({ code: error && typeof error.code === "number" ? error.code : 0, stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `schtasks ${args.join(" ")} failed`));
    });

    child.on("error", (error) => {
      if (options.allowFailure) {
        resolve({ code: 1, stdout: "", stderr: error.message });
      } else {
        reject(error);
      }
    });
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeCmdValue(value) {
  return String(value).replace(/\r?\n/g, " ").replace(/%/g, "%%");
}

function escapeCmdPath(value) {
  return String(value).replace(/"/g, "");
}

function vbsString(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}
