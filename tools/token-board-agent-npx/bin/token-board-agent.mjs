#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const API_URL = (process.env.TOKEN_BOARD_API_URL || "https://124-221-36-36.anyip.dev:8443/token-board").replace(/\/+$/, "");
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
// Per-cycle watchdog: if a single upload pass (collect + post) outlives this, the
// watch loop abandons it and moves on instead of wedging forever. Defaults to twice
// the poll interval (min 10m) so a large legitimate backlog still has room to finish.
const CYCLE_TIMEOUT_MS = readPositiveNumber(
  process.env.TOKEN_BOARD_CYCLE_TIMEOUT_MS,
  Math.max(INTERVAL_MS * 2, 10 * 60 * 1000)
);
// Lightweight reachability probe before each cycle so a flaky endpoint fails fast
// (one short request) instead of burning the watchdog budget on long upload retries.
const HEALTHCHECK_ENABLED = process.env.TOKEN_BOARD_HEALTHCHECK !== "false";
const HEALTHCHECK_TIMEOUT_MS = readPositiveNumber(process.env.TOKEN_BOARD_HEALTHCHECK_TIMEOUT_MS, 10_000);
// Upper bound on tracked uploaded-event IDs kept in the state file (final backstop;
// the working set is normally pruned to the active collection window — see pruneUploadedIds).
const UPLOADED_ID_CAP = readPositiveNumber(process.env.TOKEN_BOARD_UPLOADED_ID_CAP, 50_000);
const BATCH_SIZE = 1000;
const CODEX_RATE_LIMIT_LOOKBACK_DAYS = readPositiveNumber(process.env.TOKEN_BOARD_CODEX_RATE_LIMIT_DAYS, 14);
const CODEX_RATE_LIMIT_MAX_FILES = readPositiveNumber(process.env.TOKEN_BOARD_CODEX_RATE_LIMIT_MAX_FILES, 2000);
const CODEX_RATE_LIMIT_BURN_LOOKBACK_HOURS = readPositiveNumber(process.env.TOKEN_BOARD_CODEX_RATE_LIMIT_BURN_LOOKBACK_HOURS, 3);
const CODEX_RATE_WINDOW_5H_MINUTES = 300;
const CODEX_RATE_WINDOW_WEEKLY_MINUTES = 10080;
const VERSION = "0.4.23";
// Reject any single event above this many tokens: no real API call approaches it, but
// a cumulative usage counter mis-read as one call (e.g. Trae's stats file) can blow
// past it. Mirrors the server-side cap in token-board-automation.ts.
const MAX_EVENT_TOTAL_TOKENS = 50_000_000;
const PACKAGE_NAME = "token-board-agent";
const NPX_COMMAND = `npx --yes ${PACKAGE_NAME}`;
const SESSION_TITLE_MAX_LENGTH = 80;
const MAX_INVALID_USAGE_WARNINGS = 5;
const INSTALL_DIR = path.join(os.homedir(), ".token-board-agent");
const INSTALLED_AGENT_FILE = path.join(INSTALL_DIR, "token-board-agent.mjs");
const CLAUDE_STATUSLINE_SHIM_FILE = path.join(INSTALL_DIR, "claude-statusline-capture.sh");
const CLAUDE_SETTINGS_FILE =
  process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, "settings.json")
    : path.join(os.homedir(), ".claude", "settings.json");
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
  "cache_creation_input_tokens_1h",
  "cache_creation_input_tokens_5m",
  "cacheCreationInputTokens",
  "cacheCreationInputTokens1h",
  "cacheCreationInputTokens5m",
  "cache_read_input_tokens",
  "cacheReadInputTokens",
  "cachedTokens",
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
  "cache_creation_input_tokens_1h",
  "cache_creation_input_tokens_5m",
  "ephemeral_1h_input_tokens",
  "ephemeral_5m_input_tokens",
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
    // Codex sessions can live under more than one home: ~/.codex (plain CLI),
    // $CODEX_HOME (the CLI honours it; once set, NEW sessions stop appearing
    // under ~/.codex entirely), and the Orca app's runtime home (for runs that
    // don't inherit the interactive shell's $CODEX_HOME, e.g. launchd/cron).
    // Overlapping copies between these homes are hardlinks; the collector
    // dedups files by (dev, inode) so listing them all never double-counts.
    paths: [
      homePath(".codex", "sessions"),
      homePath(".codex", "archived_sessions"),
      homePath(".codex", "projects"),
      ...(process.env.CODEX_HOME
        ? [path.join(process.env.CODEX_HOME, "sessions"), path.join(process.env.CODEX_HOME, "archived_sessions")]
        : []),
      appSupportPath("orca", "codex-runtime-home", "home", "sessions"),
      appSupportPath("orca", "codex-runtime-home", "home", "archived_sessions"),
    ],
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
  // Trae removed in 0.4.17: its globalStorage holds a *cumulative* usage stats file
  // whose running counters (billions of tokens) the generic JSON scanner mis-read as
  // single API calls, poisoning the leaderboard. There is no reliable per-call Trae
  // transcript to parse, so the source is dropped rather than mis-counted.
  // 0.4.19 reintroduces Trae as "trae-sampled": a STATEFUL sampler that diffs the
  // cumulative counters between scans (like Codex's total_token_usage delta) instead
  // of reporting the counters themselves. See sampleTraeCounters().
];

// Trae counter sampler: where the cumulative usage counters may live. Only plain
// JSON/JSONL files are sampled (the observed stats file is JSON in a "stats" dir).
const TRAE_SAMPLER_PATHS = [
  appSupportPath("Trae", "User", "globalStorage"),
  appSupportPath("Trae CN", "User", "globalStorage"),
  appSupportPath("Trae", "ModularData", "ai-agent"),
  appSupportPath("Trae CN", "ModularData", "ai-agent"),
  configPath("Trae", "User", "globalStorage"),
  configPath("Trae CN", "User", "globalStorage"),
  appDataPath("Trae", "User", "globalStorage"),
  appDataPath("Trae CN", "User", "globalStorage"),
  homePath(".trae"),
  homePath(".trae-cn"),
  homePath(".trae-aicc-internal"),
];
const TRAE_SAMPLER_TARGET = { source: "trae-sampled", tool: "Trae", paths: TRAE_SAMPLER_PATHS };
const TRAE_STATE_FILE = homePath(".token-board-agent", "trae-counter-state.json");
const TRAE_LEDGER_FILE = homePath(".token-board-agent", "trae-usage-ledger.jsonl");
let invalidUsageWarningCount = 0;

main().catch((error) => {
  if (process.argv[2] === "statusline") {
    process.exitCode = 0;
    return;
  }

  logError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const command = process.argv[2] || "sync";
  const quietCommand = command === "mcp" || command === "statusline";
  if (command === "watch") {
    logInfo(`[token-board-agent] running ${command}`);
  } else if (!quietCommand) {
    console.log(`[token-board-agent] running ${command}`);
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "mcp") {
    await runMcpServer();
    return;
  }

  if (command === "statusline") {
    await printStatusline();
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
      if (HEALTHCHECK_ENABLED && !(await checkApiHealth())) {
        logError(`API health check failed for ${API_URL}; skipping this cycle.`);
      } else {
        await withWatchdog(uploadOnce(config), CYCLE_TIMEOUT_MS, "upload cycle").catch((error) => {
          logError(error instanceof Error ? error.message : String(error));
        });
      }
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
  if (process.platform !== "win32") {
    await installClaudeStatuslineShim();
  }
}

/**
 * Claude Code 本地不存订阅额度,精确额度仅出现在 statusLine 注入的 JSON 的
 * `rate_limits` 字段(Pro/Max 账号、首个 API 响应后)。该 shim 把那份额度落盘成
 * 快照(零网络/零认证),collectClaudeCodeRateLimits() 离线读取后上传。
 *
 * 注意:Claude Code 不提供 `rate_limits_available` 布尔字段——是否有数据只能看
 * `rate_limits` 对象是否存在,故 shim 以"对象存在且至少有一个窗口"为落盘条件。
 *
 * 把 shim 内容作为模板内联在此处,使其随包发布、可版本化,`install` 时重新生成,
 * 避免手写副本在重装时丢失。生成时保留用户原有的 statusLine 命令作为 INNER,
 * 透传渲染不变。
 */
function renderClaudeStatuslineShim(innerStatusline) {
  const inner = typeof innerStatusline === "string" ? innerStatusline : "";
  return `#!/usr/bin/env bash
# claude-statusline-capture.sh
# 由 token-board-agent 生成(请勿手改;\`npx token-board-agent install\` 会重新生成)。
# 1) 读取 Claude Code 经 stdin 传入的 statusLine JSON,把其中 rate_limits 落盘为快照
#    (供 token-board-agent 离线读取,零网络/零认证);
# 2) 原样把同一份 stdin 转交给你已有的 statusline,显示不变。
# 任何提取失败都不影响状态栏渲染(passthrough 始终执行)。

SNAP="\${TOKEN_BOARD_CC_SNAPSHOT:-\$HOME/.token-board-agent/claude-rate-limits.json}"
INNER="\${TOKEN_BOARD_INNER_STATUSLINE:-${inner}}"

TMP="\$(mktemp 2>/dev/null || echo /tmp/cc-sl-\$\$.json)"
cat > "\$TMP"

# best-effort 提取快照(出错忽略)
node -e '
  const fs=require("fs");
  try{
    const inPath=process.argv[1], outPath=process.argv[2];
    const j=JSON.parse(fs.readFileSync(inPath,"utf8"));
    const rl=j.rate_limits;
    // Claude Code 不提供 rate_limits_available 布尔字段;rate_limits 仅在
    // Pro/Max 订阅且首个 API 响应后才出现,故以"对象存在且至少有一个窗口"为准。
    const hasData=Boolean(rl && typeof rl==="object" && (rl.five_hour || rl.seven_day));
    const snap={
      capturedAt:new Date().toISOString(),
      source:"claude-code-statusline",
      claudeVersion:(j.version||j.cli_version||null),
      available:hasData,
      rateLimits:rl||null
    };
    // 仅当确有订阅额度数据时才覆盖,避免把 null 冲掉上一次有效快照
    if(hasData){
      fs.writeFileSync(outPath, JSON.stringify(snap,null,2));
    }
  }catch(e){/* ignore */}
' "\$TMP" "\$SNAP" 2>/dev/null || true

# 始终渲染真实状态栏(若存在原有 statusline)
if [ -n "\$INNER" ] && [ -x "\$INNER" ]; then
  "\$INNER" < "\$TMP"
fi
rm -f "\$TMP" 2>/dev/null || true
`;
}

// 决定透传给哪个原有 statusline:env > 现有 shim 中已保留的值 > Claude settings.json 现有命令。
async function detectInnerStatusline() {
  if (process.env.TOKEN_BOARD_INNER_STATUSLINE) {
    return process.env.TOKEN_BOARD_INNER_STATUSLINE;
  }
  try {
    const existing = await fs.readFile(CLAUDE_STATUSLINE_SHIM_FILE, "utf8");
    const match = existing.match(/INNER="\$\{TOKEN_BOARD_INNER_STATUSLINE:-([^}]*)\}"/);
    if (match && match[1]) {
      return match[1];
    }
  } catch {
    /* no existing shim */
  }
  try {
    const settings = JSON.parse(await fs.readFile(CLAUDE_SETTINGS_FILE, "utf8"));
    const command = settings?.statusLine?.command;
    if (typeof command === "string" && command && !command.includes("claude-statusline-capture")) {
      return command;
    }
  } catch {
    /* no settings.json */
  }
  return "";
}

async function installClaudeStatuslineShim() {
  const inner = await detectInnerStatusline();
  await fs.writeFile(CLAUDE_STATUSLINE_SHIM_FILE, renderClaudeStatuslineShim(inner), "utf8");
  await fs.chmod(CLAUDE_STATUSLINE_SHIM_FILE, 0o755).catch(() => {});
  let wired = false;
  try {
    const settings = JSON.parse(await fs.readFile(CLAUDE_SETTINGS_FILE, "utf8"));
    wired = typeof settings?.statusLine?.command === "string" && settings.statusLine.command.includes("claude-statusline-capture");
  } catch {
    /* ignore */
  }
  if (!wired) {
    console.log("Claude Code 额度采集:已生成 statusLine 捕获脚本(尚未接入):");
    console.log(`  ${CLAUDE_STATUSLINE_SHIM_FILE}`);
    console.log("  在 ~/.claude/settings.json 把 statusLine.command 指向该脚本即可采集订阅额度。");
  }
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
  const collectedIds = new Set(collectedEvents.map((event) => event.id));
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
    logInfo("Checked Codex, Claude Code, Cursor, and custom usage paths for recent token logs.");
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
    uploadedIds: pruneUploadedIds(uploadedIds, collectedIds, events),
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
    uploadedIds: collectedEvents.map((event) => event.id).slice(-UPLOADED_ID_CAP),
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

  // Dedup by (dev, inode): the same physical file reachable via several roots
  // (Orca hardlink-mirrors ~/.codex sessions into its runtime home) must be
  // parsed once. Earlier-listed roots win, keeping event ids stable across runs.
  const seenInodes = new Set();
  const uniqueFiles = files.filter((file) => {
    if (!(file.ino > 0)) {
      return true;
    }
    const key = `${file.dev}:${file.ino}`;
    if (seenInodes.has(key)) {
      return false;
    }
    seenInodes.add(key);
    return true;
  });
  files.length = 0;
  files.push(...uniqueFiles);

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const events = [];
  const configWithTitles = { ...config, codexTitleIndex };
  for (const file of files.slice(0, MAX_FILES * Math.max(1, targets.length))) {
    events.push(...(await parseUsageFile(file.path, file.target, configWithTitles)));
  }

  if (process.env.TOKEN_BOARD_TRAE_SAMPLER !== "false" && config.includeDefaultSources !== false) {
    events.push(...(await collectTraeSampledEvents(config, minMtime)));
  }

  return dedupe(events);
}

// ---------------------------------------------------------------------------
// Trae counter sampler.
//
// Trae keeps no per-call transcript — only cumulative usage counters that grow
// over the app's lifetime. Reporting those directly is how the board got
// poisoned twice, so instead we treat them exactly like Codex's cumulative
// total_token_usage: sample on every collection cycle, diff against the last
// sample, and record only the GROWTH as spend. Deltas are appended to a local
// append-only ledger (one JSONL line per grown counter), and events are then
// derived from ledger lines — so event ids are deterministic across runs, the
// uploadedIds mechanism dedups them like any transcript, and a failed upload
// never loses a delta. First sighting of a counter only baselines it (lifetime
// totals must not be dumped onto one day); a counter that shrinks (reinstall,
// cleared storage) re-baselines silently.
// ---------------------------------------------------------------------------

async function collectTraeSampledEvents(config, minMtime) {
  try {
    await sampleTraeCounters(minMtime);
  } catch (error) {
    console.warn(`Trae counter sampling failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const raw = await fs.readFile(TRAE_LEDGER_FILE, "utf8").catch(() => "");
  if (!raw) {
    return [];
  }

  const events = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    const entry = safeJson(line);
    if (!entry || typeof entry !== "object" || !entry.timestamp) {
      continue;
    }
    const at = Date.parse(entry.timestamp);
    if (!Number.isFinite(at) || at < minMtime) {
      continue;
    }
    const event = tryUsageRecordToEvent(entry, {
      config,
      source: TRAE_SAMPLER_TARGET.source,
      tool: TRAE_SAMPLER_TARGET.tool,
      filePath: TRAE_LEDGER_FILE,
      model: typeof entry.model === "string" ? entry.model : "unknown",
      project: "trae",
      sessionId: `trae-counter:${entry.file || ""}`,
      // Ledger is append-only, so the 1-based line number is a stable sequence
      // and the derived event id never changes across runs.
      sequence: index + 1,
      timestamp: entry.timestamp,
    });
    if (event) {
      events.push(event);
    }
  }

  return events;
}

async function sampleTraeCounters(minMtime) {
  const paths = readListEnv("TOKEN_BOARD_TRAE_PATHS") || TRAE_SAMPLER_PATHS;
  const files = [];
  for (const samplePath of paths) {
    await collectFiles(expandHome(samplePath), TRAE_SAMPLER_TARGET, files, minMtime, 0);
  }

  const readings = new Map(); // `${file}\n${model}` -> summed counter fields
  for (const file of files) {
    const ext = path.extname(file.path).toLowerCase();
    if (ext !== ".json" && ext !== ".jsonl" && ext !== ".log") {
      continue;
    }
    const text = await fs.readFile(file.path, "utf8").catch(() => "");
    if (!text) {
      continue;
    }
    const documents =
      ext === ".json"
        ? [safeJson(text)]
        : text.split(/\r?\n/).map((line) => (line.trim() ? safeJson(line.trim()) : undefined));
    for (const doc of documents) {
      if (doc !== undefined) {
        sumTraeCounters(doc, { model: "" }, file.path, readings, 0);
      }
    }
  }

  if (!readings.size) {
    return;
  }

  const state = safeJson(await fs.readFile(TRAE_STATE_FILE, "utf8").catch(() => "")) || {};
  const now = new Date().toISOString();
  const ledgerLines = [];

  for (const [key, cur] of readings) {
    const prev = state[key];
    state[key] = { ...cur, sampledAt: now };
    if (!prev) {
      continue; // first sighting: baseline only, never dump lifetime totals
    }
    const delta = {
      input_tokens: cur.input - toNumber(prev.input),
      cached_input_tokens: cur.cached - toNumber(prev.cached),
      cache_creation_input_tokens:
        cur.cacheCreation -
        (Object.prototype.hasOwnProperty.call(prev, "cacheCreation") ? toNumber(prev.cacheCreation) : cur.cacheCreation),
      output_tokens: cur.output - toNumber(prev.output),
      reasoning_output_tokens: cur.reasoning - toNumber(prev.reasoning),
    };
    if (Object.values(delta).some((value) => value < 0)) {
      continue; // counter went backwards (reinstall / cleared storage): re-baseline
    }
    if (delta.input_tokens + delta.output_tokens <= 0) {
      continue;
    }
    const [file, model] = key.split("\n");
    ledgerLines.push(JSON.stringify({ timestamp: now, file, model, ...delta }));
  }

  await fs.mkdir(path.dirname(TRAE_STATE_FILE), { recursive: true });
  if (ledgerLines.length) {
    await fs.appendFile(TRAE_LEDGER_FILE, `${ledgerLines.join("\n")}\n`);
  }
  await fs.writeFile(TRAE_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

// Walk arbitrary JSON, summing every usage-shaped record's counters per
// (file, model). Sums of monotone counters stay monotone, so diffing the sums
// is reset-aware regardless of how Trae shards its counters internally.
function sumTraeCounters(value, context, filePath, readings, depth) {
  if (depth > 14 || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => sumTraeCounters(item, context, filePath, readings, depth + 1));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const model = textFromFields(value, ["model", "modelName", "model_name"]) || context.model;

  if (hasUsageShape(value)) {
    const cacheReadTokens = cacheReadInputTokensFromRecord(value);
    const cacheCreationInputTokens = cacheCreationInputTokensFromRecord(value);
    const key = `${filePath}\n${model || "unknown"}`;
    const sums = readings.get(key) || { input: 0, cached: 0, cacheCreation: 0, output: 0, reasoning: 0 };
    sums.input +=
      numberFromFields(value, ["inputTokens", "input_tokens", "inputTokenCount", "promptTokens", "prompt_tokens"]) +
      cacheReadTokens +
      cacheCreationInputTokens;
    sums.cached +=
      numberFromFields(value, ["cachedInputTokens", "cached_input_tokens", "cachedTokens"]) + cacheReadTokens;
    sums.cacheCreation += cacheCreationInputTokens;
    sums.output += numberFromFields(value, [
      "outputTokens",
      "output_tokens",
      "outputTokenCount",
      "completionTokens",
      "completion_tokens",
    ]);
    sums.reasoning += numberFromFields(value, ["reasoningOutputTokens", "reasoning_output_tokens", "reasoningTokens"]);
    readings.set(key, sums);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveTextKey(key) && (typeof child === "string" || Array.isArray(child))) {
      continue;
    }
    sumTraeCounters(child, { model }, filePath, readings, depth + 1);
  }
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
      files.push({ path: inputPath, mtimeMs: stat.mtimeMs, target, dev: stat.dev, ino: stat.ino });
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
    fields.map((field) => [field, Math.max(0, toNumber(current?.[field]) - toNumber(previous?.[field]))])
  );
}

function tokenUsageTotal(usage) {
  return (
    toNumber(usage?.input_tokens) +
    cacheCreationInputTokensFromRecord(usage || {}) +
    cacheReadInputTokensFromRecord(usage || {}) +
    toNumber(usage?.output_tokens)
  );
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
  const cacheReadTokens = cacheReadInputTokensFromRecord(usage);
  const cacheCreationInputTokens = cacheCreationInputTokensFromRecord(usage);
  const inputTokens = baseInputTokens + cacheReadTokens + cacheCreationInputTokens;
  const cachedInputTokens =
    numberFromFields(usage, ["cachedInputTokens", "cached_input_tokens", "cachedTokens"]) +
    cacheReadTokens;
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

  // Defense-in-depth against cumulative counters mis-read as a single call (the same
  // check the server enforces): a real API call cannot exceed a model's context window
  // plus cache. 50M is ~200x the largest real single-call record ever observed.
  if (totalTokens > MAX_EVENT_TOTAL_TOKENS) {
    throw new Error(`single-event token count ${totalTokens} exceeds ${MAX_EVENT_TOTAL_TOKENS}; likely a cumulative counter, not one call`);
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
    cacheCreationInputTokens,
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
    cacheCreationInputTokens,
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

function cacheReadInputTokensFromRecord(record) {
  return numberFromFields(record, ["cache_read_input_tokens", "cacheReadInputTokens"]);
}

function cacheCreationInputTokensFromRecord(record) {
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

function textFromFields(record, fields) {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  const rateLimits = await analyzeLocalCodexRateLimits(codexHome);
  const claudeCodeRateLimits = await collectClaudeCodeRateLimits();
  const hasCodex = Object.values(codex).some((value) => value !== undefined && value !== "");

  return {
    updatedAt: new Date().toISOString(),
    agent: {
      name: "token-board-agent",
      version: VERSION,
      platform: normalizePlatform(os.platform()),
    },
    ...(hasCodex ? { codex } : {}),
    rateLimits,
    ...(claudeCodeRateLimits ? { claudeCodeRateLimits } : {}),
  };
}

/**
 * 读取 Claude Code 状态栏捕获的订阅额度快照(由 claude-statusline-capture.sh 落盘),
 * 构造成与 Codex 额度报告兼容的结构,以便服务端/前端复用同一套类型与组件。
 * Claude Code 本地不存额度,仅在状态栏 JSON 的 rate_limits 中出现(精确值)。
 */
async function collectClaudeCodeRateLimits() {
  const snapPath =
    process.env.TOKEN_BOARD_CC_SNAPSHOT || homePath(".token-board-agent", "claude-rate-limits.json");
  const snap = await readJson(snapPath);
  if (!snap || !snap.available || !snap.rateLimits) {
    return null;
  }

  const nowMs = Date.now();
  const observedAt =
    typeof snap.capturedAt === "string" && snap.capturedAt ? snap.capturedAt : new Date(nowMs).toISOString();
  const staleSeconds = Math.max(0, Math.round((nowMs - Date.parse(observedAt)) / 1000)) || 0;
  const windows = [];

  const pushWindow = (bucket, key, windowMinutes, label) => {
    if (!bucket || typeof bucket.used_percentage !== "number") {
      return;
    }
    const used = Math.max(0, Math.min(100, bucket.used_percentage));
    const resetsEpoch = typeof bucket.resets_at === "number" ? bucket.resets_at : null;
    windows.push({
      key,
      windowMinutes,
      label,
      usedPercent: used,
      remainingPercent: Math.max(0, 100 - used),
      resetsAt: resetsEpoch ? new Date(resetsEpoch * 1000).toISOString() : null,
      resetsInSeconds: resetsEpoch ? Math.round(resetsEpoch - nowMs / 1000) : null,
      observedAt,
      staleSeconds,
      burnPercentPerHour: null,
      etaSeconds: null,
      etaAt: null,
      willExhaustBeforeReset: false,
      estimatedCapacityTokens: null,
      estimatedRemainingTokens: null,
      localConsumedTokensThisWindow: null,
    });
  };

  pushWindow(snap.rateLimits.five_hour, "5h", 300, "5 小时");
  pushWindow(snap.rateLimits.seven_day, "weekly", 10080, "每周");

  if (!windows.length) {
    return null;
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    available: true,
    plan: snap.claudeVersion ? `Claude Code ${snap.claudeVersion}` : "Claude Code",
    latestEventAt: observedAt,
    windows,
    recentTokensPerHour: null,
    notes: ["数据来自 Claude Code 状态栏上报的订阅额度(精确值,非估算)。"],
    sourcePaths: [snapPath],
  };
}

async function analyzeLocalCodexRateLimits(codexHome) {
  const now = Date.now();
  const cutoffMs = now - CODEX_RATE_LIMIT_LOOKBACK_DAYS * 24 * 3600 * 1000;
  const { files, scannedDirs } = await listRecentCodexSessionFiles(codexHome, cutoffMs, CODEX_RATE_LIMIT_MAX_FILES);
  const events = [];
  let plan = null;

  for (const filePath of files) {
    const filePlan = await parseCodexRateLimitFile(filePath, events);
    if (filePlan) {
      plan = filePlan;
    }
  }

  // Isolate one rate-limit bucket: different limit_ids (base plan vs Spark/experimental
  // models) carry separate quotas, and mixing them corrupts the latest percentage and
  // the capacity estimate.
  const { events: bucketEvents, otherBuckets } = selectCodexPrimaryBucket(events);

  const windows = [];
  const fiveHour = buildCodexRateWindow(
    "5h",
    CODEX_RATE_WINDOW_5H_MINUTES,
    "5 小时",
    bucketEvents,
    now,
    (event) => event.pct5,
    (event) => event.reset5,
  );
  const weekly = buildCodexRateWindow(
    "weekly",
    CODEX_RATE_WINDOW_WEEKLY_MINUTES,
    "每周",
    bucketEvents,
    now,
    (event) => event.pctW,
    (event) => event.resetW,
  );
  if (fiveHour) windows.push(fiveHour);
  if (weekly) windows.push(weekly);

  let latestEventAt = null;
  for (const event of events) {
    if (!latestEventAt || event.ts > Date.parse(latestEventAt)) {
      latestEventAt = new Date(event.ts).toISOString();
    }
  }

  let recentTokensPerHour = null;
  if (events.length > 0) {
    const hourAgo = now - 3600 * 1000;
    let sum = 0;
    for (const event of events) {
      if (event.ts >= hourAgo) {
        sum += event.lastTotal;
      }
    }
    recentTokensPerHour = Math.round(sum);
  }

  const notes = [];
  if (files.length === 0) {
    notes.push(`未在 ${scannedDirs.join("、")} 找到最近 ${CODEX_RATE_LIMIT_LOOKBACK_DAYS} 天的会话日志。`);
  }
  if (otherBuckets.length > 0) {
    notes.push(`检测到多个限额桶，仅展示主计划；已忽略 ${otherBuckets.join("、")}（Spark 等实验模型额度单独计算）。`);
  }
  if (windows.length > 0) {
    notes.push(
      "百分比与重置时间为 Codex 上报的精确值；token 容量为估算（百分比按整数取整、额度按账号跨设备共享，本机日志只能给下界）。窗口边界以重置点切分，已计入提前充值。"
    );
  }

  return {
    generatedAt: new Date(now).toISOString(),
    available: windows.length > 0,
    plan,
    latestEventAt,
    windows,
    recentTokensPerHour,
    notes,
    sourcePaths: scannedDirs,
  };
}

async function listRecentCodexSessionFiles(codexHome, cutoffMs, maxFiles) {
  const roots = [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")];
  const found = [];
  const scannedDirs = [];

  async function walk(dir, depth) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 6) {
          await walk(full, depth + 1);
        }
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const info = await fs.stat(full).catch(() => undefined);
        if (info && info.mtimeMs >= cutoffMs) {
          found.push({ filePath: full, mtime: info.mtimeMs });
        }
      }
    }
  }

  for (const root of roots) {
    scannedDirs.push(root);
    await walk(root, 0);
  }

  found.sort((a, b) => b.mtime - a.mtime);
  return { files: found.slice(0, maxFiles).map((entry) => entry.filePath), scannedDirs };
}

async function parseCodexRateLimitFile(filePath, events) {
  const sessionId = path.basename(filePath);
  let plan = null;
  let lines;

  try {
    lines = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
  } catch {
    return null;
  }

  try {
    for await (const rawLine of lines) {
      if (!rawLine.includes('"token_count"')) {
        continue;
      }

      const parsed = safeJson(rawLine);
      const payload = parsed && typeof parsed.payload === "object" ? parsed.payload : {};
      if (payload.type !== "token_count" || typeof parsed?.timestamp !== "string") {
        continue;
      }

      const ts = Date.parse(parsed.timestamp);
      if (!Number.isFinite(ts)) {
        continue;
      }

      const info = payload.info && typeof payload.info === "object" ? payload.info : {};
      const totalUsage = info.total_token_usage && typeof info.total_token_usage === "object" ? info.total_token_usage : {};
      const lastUsage = info.last_token_usage && typeof info.last_token_usage === "object" ? info.last_token_usage : {};
      const cumTotal = numberOrNull(totalUsage.total_tokens);
      const lastTotal = (numberOrNull(lastUsage.input_tokens) || 0) + (numberOrNull(lastUsage.output_tokens) || 0);
      const rateLimits = payload.rate_limits && typeof payload.rate_limits === "object" ? payload.rate_limits : {};
      let pct5 = null;
      let reset5 = null;
      let pctW = null;
      let resetW = null;
      let limitId = null;
      let limitName = null;

      if (typeof rateLimits.plan_type === "string" && rateLimits.plan_type.trim()) {
        plan = rateLimits.plan_type.trim().slice(0, 40);
      }
      if (typeof rateLimits.limit_id === "string") {
        limitId = rateLimits.limit_id;
      }
      if (typeof rateLimits.limit_name === "string") {
        limitName = rateLimits.limit_name;
      }

      for (const slotKey of ["primary", "secondary"]) {
        const slot = rateLimits[slotKey] && typeof rateLimits[slotKey] === "object" ? rateLimits[slotKey] : {};
        const windowMinutes = numberOrNull(slot.window_minutes);
        const usedPercent = numberOrNull(slot.used_percent);
        const resetsAt = numberOrNull(slot.resets_at);
        if (usedPercent === null) {
          continue;
        }
        if (windowMinutes === CODEX_RATE_WINDOW_5H_MINUTES) {
          pct5 = usedPercent;
          reset5 = resetsAt;
        } else if (windowMinutes === CODEX_RATE_WINDOW_WEEKLY_MINUTES) {
          pctW = usedPercent;
          resetW = resetsAt;
        }
      }

      events.push({ ts, sessionId, cumTotal, lastTotal, limitId, limitName, pct5, reset5, pctW, resetW });
    }
  } catch {
    return plan;
  } finally {
    lines.close();
  }

  return plan;
}

function buildCodexRateWindow(key, windowMinutes, label, events, now, pickPct, pickReset) {
  let latest = null;
  for (const event of events) {
    if (pickPct(event) === null) {
      continue;
    }
    if (!latest || event.ts > latest.ts) {
      latest = event;
    }
  }
  if (!latest) {
    return null;
  }

  const usedPercent = pickPct(latest) || 0;
  const remainingPercent = Math.max(0, 100 - usedPercent);
  const resetEpoch = pickReset(latest);
  const resetsAtMs = resetEpoch !== null ? resetEpoch * 1000 : null;
  const resetsInSeconds = resetsAtMs !== null ? Math.round((resetsAtMs - now) / 1000) : null;
  const run = currentCodexRateRun(events, pickPct);
  let burnPercentPerHour = null;
  if (run.length >= 2) {
    const last = run[run.length - 1];
    const lookbackStart = last.ts - CODEX_RATE_LIMIT_BURN_LOOKBACK_HOURS * 3600 * 1000;
    const window = run.filter((point) => point.ts >= lookbackStart);
    const first = window.length >= 2 ? window[0] : run[0];
    const hours = (last.ts - first.ts) / 3600 / 1000;
    const dPct = last.pct - first.pct;
    if (hours > 0 && dPct > 0) {
      burnPercentPerHour = dPct / hours;
    }
  }

  let etaSeconds = null;
  let etaAt = null;
  if (burnPercentPerHour && burnPercentPerHour > 0 && remainingPercent > 0) {
    const hoursToEmpty = remainingPercent / burnPercentPerHour;
    etaSeconds = Math.round(hoursToEmpty * 3600);
    etaAt = new Date(now + hoursToEmpty * 3600 * 1000).toISOString();
  }

  const estimatedCapacityTokens = estimateCodexRateCapacityTokens(events, pickPct);
  const estimatedRemainingTokens =
    estimatedCapacityTokens !== null ? Math.round((estimatedCapacityTokens * remainingPercent) / 100) : null;
  let localConsumedTokensThisWindow = null;
  if (run.length > 0) {
    const runStartTs = run[0].ts;
    let sum = 0;
    for (const event of events) {
      if (event.ts >= runStartTs) {
        sum += event.lastTotal;
      }
    }
    localConsumedTokensThisWindow = Math.round(sum);
  }

  return {
    key,
    windowMinutes,
    label,
    usedPercent,
    remainingPercent,
    resetsAt: resetsAtMs !== null ? new Date(resetsAtMs).toISOString() : null,
    resetsInSeconds,
    observedAt: new Date(latest.ts).toISOString(),
    staleSeconds: Math.round((now - latest.ts) / 1000),
    burnPercentPerHour,
    etaSeconds,
    etaAt,
    willExhaustBeforeReset: etaSeconds !== null && resetsInSeconds !== null && etaSeconds < resetsInSeconds,
    estimatedCapacityTokens,
    estimatedRemainingTokens,
    localConsumedTokensThisWindow,
  };
}

function currentCodexRateRun(events, pickPct) {
  const points = [];
  for (const event of events) {
    const pct = pickPct(event);
    if (pct !== null) {
      points.push({ ts: event.ts, pct });
    }
  }
  points.sort((a, b) => a.ts - b.ts);
  let runStart = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].pct < points[index - 1].pct - 0.5) {
      runStart = index;
    }
  }
  return points.slice(runStart);
}

function estimateCodexRateCapacityTokens(events, pickPct) {
  // used_percent is account-global (shared across every session), but a session's
  // cumTotal only covers its own tokens. Dividing a global pct change by one session's
  // token delta underestimates capacity — catastrophically for the weekly window, which
  // spans many concurrent sessions (~90x too low in practice). Estimate globally: merge
  // all sessions on one timeline and pair each global pct rise with the per-turn tokens
  // (lastTotal, cross-session additive) consumed over that span — same unit as the
  // displayed "consumed this window".
  const points = [];
  for (const event of events) {
    const pct = pickPct(event);
    if (pct === null) {
      continue;
    }
    points.push({ ts: event.ts, pct, tok: event.lastTotal });
  }
  points.sort((a, b) => a.ts - b.ts);

  const ratios = [];
  let runStart = 0;
  for (let index = 1; index <= points.length; index += 1) {
    const broke = index === points.length || points[index].pct < points[index - 1].pct - 0.5;
    if (broke) {
      const dPct = points[index - 1].pct - points[runStart].pct;
      let dTok = 0;
      for (let j = runStart + 1; j <= index - 1; j += 1) {
        dTok += points[j].tok;
      }
      if (dPct >= 20 && dTok > 0) {
        ratios.push((dTok / dPct) * 100);
      }
      runStart = index;
    }
  }

  if (ratios.length < 3) {
    return null;
  }
  return Math.round(percentile(ratios, 0.8));
}

// Pick one rate-limit bucket: different limit_ids (base plan "codex" vs experimental
// models like "codex_bengalfox"/Spark) have separate quotas; mixing them corrupts both
// the latest percentage and the capacity estimate. Prefer the base plan (limit_name
// null), most-recently-active; fold in legacy events that predate limit_id.
function selectCodexPrimaryBucket(events) {
  const rated = events.filter((event) => event.pct5 !== null || event.pctW !== null);
  if (rated.length === 0) {
    return { events, otherBuckets: [] };
  }

  const latestByBucket = new Map();
  for (const event of rated) {
    if (event.limitId === null || event.limitId === undefined) {
      continue;
    }
    const baseplan = event.limitName === null || event.limitName === undefined;
    const current = latestByBucket.get(event.limitId);
    if (!current || event.ts > current.ts) {
      latestByBucket.set(event.limitId, { ts: event.ts, baseplan });
    } else if (baseplan && !current.baseplan) {
      latestByBucket.set(event.limitId, { ts: current.ts, baseplan: true });
    }
  }

  if (latestByBucket.size <= 1) {
    return { events, otherBuckets: [] };
  }

  const ranked = [...latestByBucket.entries()].sort((a, b) => {
    if (a[1].baseplan !== b[1].baseplan) {
      return a[1].baseplan ? -1 : 1;
    }
    return b[1].ts - a[1].ts;
  });
  const chosenId = ranked[0][0];
  const otherBuckets = ranked.slice(1).map(([id]) => id);
  const filtered = events.filter(
    (event) => event.limitId === chosenId || event.limitId === null || event.limitId === undefined,
  );
  return { events: filtered, otherBuckets };
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

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentile(values, q) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[index];
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

const MCP_PROTOCOL_VERSION = "2025-03-26";
const MCP_TOOL_DEFINITIONS = [
  {
    name: "get_leaderboard",
    description: "查询 Open Token Board 榜单 Top N。",
    inputSchema: {
      type: "object",
      properties: {
        range: { type: "string", enum: ["1d", "7d", "30d", "90d"], description: "时间范围，默认 1d。" },
        metric: { type: "string", enum: ["tokens", "cost", "sessions", "messages"], description: "排序指标，默认 tokens。" },
        limit: { type: "number", minimum: 1, maximum: 30, description: "返回人数，默认 10。" },
      },
    },
  },
  {
    name: "get_my_usage",
    description: "查询当前登录账号的用量、排名、等级、徽章和个人最佳。",
    inputSchema: {
      type: "object",
      properties: {
        range: { type: "string", enum: ["1d", "7d", "30d", "90d"], description: "时间范围，默认 1d。" },
      },
    },
  },
  {
    name: "get_user_profile",
    description: "查询某个 GitHub login 的公开 Token Board profile。",
    inputSchema: {
      type: "object",
      properties: {
        login: { type: "string", description: "GitHub login，例如 ffffhx。" },
      },
      required: ["login"],
    },
  },
  {
    name: "get_rate_limits",
    description: "查询当前登录账号已同步到服务端的 Codex / Claude Code 额度快照。",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

async function runMcpServer() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      writeRpc({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }

    const messages = Array.isArray(message) ? message : [message];
    for (const item of messages) {
      await handleMcpMessage(item);
    }
  }
}

async function handleMcpMessage(message) {
  const id = rpcId(message);

  try {
    const result = await handleMcpRequest(message);

    if (result !== undefined && id !== undefined) {
      writeRpc({ jsonrpc: "2.0", id, result });
    }
  } catch (error) {
    if (id === undefined) {
      return;
    }
    writeRpc({
      jsonrpc: "2.0",
      id,
      error: {
        code: typeof error?.rpcCode === "number" ? error.rpcCode : -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function handleMcpRequest(message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.method !== "string") {
    throw rpcError(-32600, "Invalid Request");
  }

  if (message.method.startsWith("notifications/")) {
    return undefined;
  }

  if (message.method === "initialize") {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "token-board-agent", version: VERSION },
    };
  }

  if (message.method === "ping") {
    return {};
  }

  if (message.method === "tools/list") {
    return { tools: MCP_TOOL_DEFINITIONS };
  }

  if (message.method === "tools/call") {
    const params = message.params && typeof message.params === "object" ? message.params : {};
    const name = typeof params.name === "string" ? params.name : "";
    const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {};

    try {
      return mcpText(await callMcpTool(name, args));
    } catch (error) {
      return mcpText(toHelpfulMcpError(error), true);
    }
  }

  throw rpcError(-32601, `Method not found: ${message.method}`);
}

async function callMcpTool(name, args) {
  if (name === "get_leaderboard") {
    return getMcpLeaderboard(args);
  }

  if (name === "get_my_usage") {
    return getMcpMyUsage(args);
  }

  if (name === "get_user_profile") {
    return getMcpUserProfile(args);
  }

  if (name === "get_rate_limits") {
    return getMcpRateLimits();
  }

  throw new Error(`未知工具：${name || "(empty)"}`);
}

async function getMcpLeaderboard(args) {
  const config = await readAgentConfig();
  const range = normalizeMcpRange(args.range, "1D");
  const metric = normalizeMcpMetric(args.metric);
  const limit = clampInteger(args.limit, 10, 1, 30);
  const params = new URLSearchParams({ range, metric, limit: String(limit) });
  const payload = await fetchApiJson(config, `/api/usage/leaderboard?${params.toString()}`, {
    label: "读取榜单",
    timeoutMs: 12_000,
  });
  const users = Array.isArray(payload.users) ? payload.users : Array.isArray(payload.summary?.users) ? payload.summary.users.slice(0, limit) : [];
  const summary = payload.summary && typeof payload.summary === "object" ? payload.summary : {};

  if (!users.length) {
    return `${rangeLabel(range)}暂无榜单数据。`;
  }

  const lines = users.slice(0, limit).map((user) => {
    const rank = user.rank ?? "?";
    const name = user.displayName || user.userId || "Unknown";
    const metricValue = formatLeaderboardMetric(user, metric);
    const level = user.level?.current?.name ? ` · ${user.level.current.name}` : "";
    return `#${rank} ${name}：${metricValue} · ${formatCompactTokens(toNumber(user.tokens))} token · ${formatNumberCompact(toNumber(user.sessions))} 会话${level}`;
  });

  return [
    `${rangeLabel(range)}${metricLabel(metric)}榜 Top ${Math.min(limit, users.length)}（${payload.generatedAt || summary.endAt || "live"}）`,
    ...lines,
  ].join("\n");
}

async function getMcpMyUsage(args) {
  const config = await readAgentConfig();
  ensureAgentToken(config);
  const range = normalizeMcpRange(args.range, "1D");
  const payload = await fetchApiJson(config, `/api/usage/export?format=json&scope=me&range=${encodeURIComponent(range)}`, {
    auth: true,
    label: "读取我的用量",
    timeoutMs: 12_000,
  });
  const profile = payload.profile && typeof payload.profile === "object" ? payload.profile : null;
  const user = profile?.user && typeof profile.user === "object" ? profile.user : null;

  if (!profile || !user) {
    return `${rangeLabel(range)}你还没有上报数据。请运行 npx --yes token-board-agent upload，或等待后台同步完成。`;
  }

  const badges = Array.isArray(profile.badges)
    ? profile.badges.filter((badge) => badge?.achieved).map((badge) => badge.name).filter(Boolean).slice(0, 6)
    : [];
  const bests = profile.personalBests || {};
  const projects = Array.isArray(profile.projects) ? profile.projects : [];
  const rankText = profile.rank ? `#${profile.rank}/${profile.totalUsers || "?"}` : "暂无排名";
  const delta = formatRankDelta(profile.rankDelta);
  const percentile = profile.percentile === null || profile.percentile === undefined ? "暂无" : `超过 ${formatPercentValue(profile.percentile)}`;

  return [
    `${rangeLabel(range)}我的用量：${rankText}${delta ? `（${delta}）` : ""}，${formatCompactTokens(toNumber(user.tokens))} token，${formatUsdShort(toNumber(user.costUsd))}，${formatNumberCompact(toNumber(user.sessions))} 会话。`,
    `位置：${percentile}；等级：${profile.level?.current?.name || "未知"}（累计 ${formatCompactTokens(toNumber(profile.level?.totalTokens))}）。`,
    `徽章：${badges.length ? badges.join("、") : "暂无已解锁徽章"}。`,
    `PB：单日 ${bests.singleDay?.date || "--"} ${formatCompactTokens(toNumber(bests.singleDay?.tokens))}；7 日 ${formatCompactTokens(toNumber(bests.rolling7Day?.tokens))}；最长连续 ${toNumber(bests.longestStreak?.days)} 天。`,
    `常用：${user.topModel || "unknown"} · ${user.topTool || "unknown"}；项目：${projects[0]?.name || "暂无"}。`,
  ].join("\n");
}

async function getMcpUserProfile(args) {
  const login = normalizeGithubLogin(args.login);

  if (!login) {
    throw new Error("login 必须是有效 GitHub 用户名，例如 ffffhx。");
  }

  const config = await readAgentConfig();
  const payload = await fetchApiJson(config, `/api/usage/user?login=${encodeURIComponent(login)}`, {
    label: "读取公开 profile",
    timeoutMs: 12_000,
  });
  const user = payload.user && typeof payload.user === "object" ? payload.user : {};
  const profile = payload.profile && typeof payload.profile === "object" ? payload.profile : {};
  const totals = profile.totals && typeof profile.totals === "object" ? profile.totals : {};
  const rankings = Array.isArray(profile.rankings) ? profile.rankings : [];
  const models = Array.isArray(profile.models) ? profile.models : [];
  const tools = Array.isArray(profile.tools) ? profile.tools : [];

  return [
    `@${user.githubLogin || user.login || login}：${user.displayName || "Unknown"}，${formatCompactTokens(toNumber(totals.tokens))} token，${formatUsdShort(toNumber(totals.costUsd))}，${formatNumberCompact(toNumber(totals.sessions))} 会话。`,
    `活跃：${formatNumberCompact(toNumber(totals.activeDays))} 天，记录 ${formatNumberCompact(toNumber(totals.records))} 条，最近上报 ${profile.lastReportedAt || "--"}。`,
    `排名：${rankings.map((item) => `${item.range} #${item.rank ?? "--"}/${item.totalUsers ?? "?"}`).join("；") || "暂无"}。`,
    `常用模型：${models.slice(0, 3).map((item) => `${item.name} ${formatCompactTokens(toNumber(item.tokens))}`).join("、") || "暂无"}。`,
    `工具分布：${tools.slice(0, 3).map((item) => `${item.name} ${formatCompactTokens(toNumber(item.tokens))}`).join("、") || "暂无"}。`,
  ].join("\n");
}

async function getMcpRateLimits() {
  const config = await readAgentConfig();
  ensureAgentToken(config);
  const payload = await fetchApiJson(config, "/api/usage/export?format=json&scope=me&range=1D", {
    auth: true,
    label: "读取额度快照",
    timeoutMs: 12_000,
  });
  const profile = payload.profile && typeof payload.profile === "object" ? payload.profile : {};
  const userConfig = profile.config && typeof profile.config === "object" ? profile.config : {};
  const codex = userConfig.rateLimits;
  const claude = userConfig.claudeCodeRateLimits;

  if (!codex && !claude) {
    return [
      "服务端还没有你的额度快照。",
      "请运行 npx --yes token-board-agent upload 或等待后台同步；Claude Code 额度还需要先配置 statusLine 捕获脚本。",
    ].join("\n");
  }

  return [formatRateLimitReport("Codex", codex), formatRateLimitReport("Claude Code", claude)].join("\n");
}

async function printStatusline() {
  const text = await Promise.race([buildStatuslineText(), sleep(800).then(() => "")]).catch(() => "");

  if (text) {
    process.stdout.write(text);
  }
}

async function buildStatuslineText() {
  const config = await readAgentConfig();
  if (!config.agentToken) {
    return "";
  }

  const payload = await fetchApiJson(config, "/api/usage/export?format=json&scope=me&range=1D", {
    auth: true,
    label: "Statusline",
    timeoutMs: 750,
  });
  const profile = payload.profile && typeof payload.profile === "object" ? payload.profile : null;
  const user = profile?.user && typeof profile.user === "object" ? profile.user : null;

  if (!profile || !user) {
    return "";
  }

  const rank = profile.rank || user.rank;
  const tokens = toNumber(user.tokens);
  return rank ? `🏆#${rank} · ${formatCompactTokens(tokens)}` : `🏆-- · ${formatCompactTokens(tokens)}`;
}

function writeRpc(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function rpcId(message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || !Object.prototype.hasOwnProperty.call(message, "id")) {
    return undefined;
  }

  return message.id === undefined ? null : message.id;
}

function rpcError(code, message) {
  const error = new Error(message);
  error.rpcCode = code;
  return error;
}

function mcpText(text, isError = false) {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

function ensureAgentToken(config) {
  if (!config.agentToken) {
    throw new Error("还没有登录 Token Board。请先运行 npx --yes token-board-agent login 或 npx --yes token-board-agent install。");
  }
}

function normalizeMcpRange(value, fallback = "1D") {
  const range = typeof value === "string" && value.trim() ? value.trim().toUpperCase() : fallback;

  if (range === "1D" || range === "7D" || range === "30D" || range === "90D") {
    return range;
  }

  throw new Error("range 只能是 1d、7d、30d 或 90d。");
}

function normalizeMcpMetric(value) {
  const metric = typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "tokens";

  if (metric === "tokens" || metric === "cost" || metric === "sessions" || metric === "messages") {
    return metric;
  }

  throw new Error("metric 只能是 tokens、cost、sessions 或 messages。");
}

function normalizeGithubLogin(value) {
  const text = cleanLabel(value, 120).toLowerCase().replace(/^@+/, "");
  const candidate = text.replace(/^https?:\/\/(?:www\.)?github\.com\//, "").split(/[/?#]/)[0] || text;
  return /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(candidate) ? candidate : "";
}

async function fetchApiJson(config, endpoint, options = {}) {
  const url = apiEndpointUrl(config, endpoint);
  const headers = { Accept: "application/json" };

  if (options.auth) {
    ensureAgentToken(config);
    headers.Authorization = `Bearer ${config.agentToken}`;
  }

  const { response, text } = await fetchTextOnce(url, { method: "GET", headers }, options.timeoutMs || 15_000);
  const payload = parseJsonPayload(text);

  if (!response.ok) {
    const message = typeof payload.error === "string" && payload.error ? payload.error : `HTTP ${response.status}`;
    const error = new Error(`${options.label || "请求"}失败：${message}`);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function fetchTextOnce(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (isAbortError(error)) {
      const timeoutError = new Error(`请求超时（${timeoutMs}ms）`);
      timeoutError.code = "ETIMEDOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function apiEndpointUrl(config, endpoint) {
  const base = apiBaseUrlFromConfig(config);
  return `${base}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

function apiBaseUrlFromConfig(config) {
  return (cleanLabel(config.serverUrl, 500) || cleanLabel(config.apiUrl, 500) || API_URL).replace(/\/+$/, "");
}

function toHelpfulMcpError(error) {
  const status = typeof error?.status === "number" ? error.status : 0;
  const message = error instanceof Error ? error.message : String(error);

  if (status === 401 || status === 403) {
    return "登录已失效或无权限。请运行 npx --yes token-board-agent login 重新登录，然后再试。";
  }

  if (status === 404) {
    return `${message}。请确认用户名、serverUrl 和服务路径是否正确。`;
  }

  if (error?.code === "ETIMEDOUT") {
    return `${message}。请检查 Token Board 服务是否可访问，或稍后重试。`;
  }

  if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(message)) {
    return `连接 Token Board 服务失败：${message}。请检查 ~/.token-board-agent.json 里的 serverUrl/apiUrl，或确认服务已启动。`;
  }

  return message;
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(number)));
}

function rangeLabel(range) {
  return range === "1D" ? "今日" : `近 ${range.replace("D", "")} 天`;
}

function metricLabel(metric) {
  if (metric === "cost") return "费用";
  if (metric === "sessions") return "会话";
  if (metric === "messages") return "消息";
  return "Token";
}

function formatLeaderboardMetric(user, metric) {
  if (metric === "cost") return formatUsdShort(toNumber(user.costUsd));
  if (metric === "sessions") return `${formatNumberCompact(toNumber(user.sessions))} 会话`;
  if (metric === "messages") return `${formatNumberCompact(toNumber(user.messages))} 消息`;
  return `${formatCompactTokens(toNumber(user.tokens))} token`;
}

function formatRateLimitReport(label, report) {
  if (!report || typeof report !== "object") {
    return `${label}：暂无快照。`;
  }

  const windows = Array.isArray(report.windows) ? report.windows : [];
  const notes = Array.isArray(report.notes) ? report.notes.filter(Boolean).slice(0, 2).join("；") : "";

  if (!report.available || !windows.length) {
    return `${label}：暂无可用额度。${notes ? ` ${notes}` : ""}`;
  }

  const header = `${label}：${report.plan || "未知计划"}，更新 ${report.latestEventAt || report.generatedAt || "--"}`;
  const rows = windows.map((window) => {
    const reset = window.resetsInSeconds === null || window.resetsInSeconds === undefined ? "未知" : formatDurationSeconds(window.resetsInSeconds);
    const remainingTokens =
      window.estimatedRemainingTokens === null || window.estimatedRemainingTokens === undefined
        ? ""
        : `，约剩 ${formatCompactTokens(toNumber(window.estimatedRemainingTokens))} token`;
    const eta = window.etaSeconds ? `，预计 ${formatDurationSeconds(window.etaSeconds)} 后耗尽` : "";
    return `- ${window.label || window.key}：已用 ${formatPercentNumber(toNumber(window.usedPercent))}，剩余 ${formatPercentNumber(toNumber(window.remainingPercent))}，重置 ${reset}${remainingTokens}${eta}`;
  });

  return [header, ...rows, ...(notes ? [`备注：${notes}`] : [])].join("\n");
}

function formatRankDelta(value) {
  const delta = Number(value);
  if (!Number.isFinite(delta) || delta === 0) return "";
  return delta > 0 ? `上升 ${delta}` : `下降 ${Math.abs(delta)}`;
}

function formatCompactTokens(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0";
  if (number >= 1_000_000_000) return `${trimFixed(number / 1_000_000_000)}B`;
  if (number >= 1_000_000) return `${trimFixed(number / 1_000_000)}M`;
  if (number >= 1_000) return `${trimFixed(number / 1_000)}K`;
  return String(Math.round(number));
}

function formatNumberCompact(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(number);
}

function formatUsdShort(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "$0";
  if (number < 1) return `$${number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
  return `$${number.toFixed(2)}`;
}

function formatPercentValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : "--";
}

function formatPercentNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1).replace(/\.0$/, "")}%` : "--";
}

function formatDurationSeconds(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}天${hours % 24}小时`;
  }

  if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  }

  return `${minutes}分钟`;
}

function trimFixed(value) {
  return value.toFixed(1).replace(/\.0$/, "");
}

function printHelp() {
  console.log(`Usage:
  ${NPX_COMMAND}
  ${NPX_COMMAND} install
  ${NPX_COMMAND} status
  ${NPX_COMMAND} statusline
  ${NPX_COMMAND} mcp
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

// Prune the tracked uploaded-event IDs to the active collection window: keep only
// previously-uploaded IDs that are still being scanned (drop ones that have aged
// out of the time window and will never reappear), then add the freshly uploaded
// IDs. This keeps the state file bounded by time instead of accreting forever;
// UPLOADED_ID_CAP is only a final safety backstop for very heavy windows.
function pruneUploadedIds(previousIds, collectedIds, newlyUploadedEvents) {
  const retained = [];
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

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

async function requestJsonWithRetry(url, options, label) {
  let lastError;

  for (let attempt = 0; attempt <= FETCH_MAX_RETRIES; attempt += 1) {
    try {
      const { response, text } = await fetchTextWithTimeout(url, options);
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

async function fetchTextWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    // Read the body under the same abort timer. A stalled body (headers arrive but
    // the stream never finishes — common on flaky reverse proxies) would otherwise
    // hang forever here, which is what previously wedged the whole watch loop.
    const text = await response.text();
    return { response, text };
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

function withWatchdog(promise, ms, label) {
  let timer;
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} exceeded ${ms}ms watchdog; abandoning this cycle to keep the loop alive`));
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), watchdog]).finally(() => clearTimeout(timer));
}

async function checkApiHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}/api/usage/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
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
