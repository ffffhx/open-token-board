// Thin adapter: agent-session-core (ASC) -> token-board's local collector contract.
//
// This is the env-gated alternative to collectLocalTokenUsage(). It maps a
// TokenUsageCollectorConfig onto ASC's discover -> parse -> toTokenEvents pipeline
// and returns plain TokenUsageEvent[] in the *exact* downstream shape. All
// dedup / redaction / stable-id work is intentionally left to the existing
// sanitizeIngestEvents() chain — this layer does not re-implement any of it.
//
// Scope (step 1 of the migration): ASC supports engine = codex | claude only.
// Codex/Claude rate-limits, the user runtime config report, and custom
// non-codex/claude JSON usage extraction (the old collector's `custom` source +
// generic visitJson scan) are NOT covered here and continue to use the old path.
// Custom usagePaths are still discovered here on a best-effort basis with ASC's
// content-based engine detection, but any file ASC cannot classify as
// codex/claude is silently skipped (it would need the old collector).

import {
  discoverSessionFiles,
  defaultRoots,
  parseSessionFile,
  toTokenEvents,
  type DiscoverOptions,
  type DiscoveredFile,
  type TokenUsageEvent as AscTokenUsageEvent,
} from "agent-session-core";

import type { TokenUsageEvent } from "./token-leaderboard";
import type { TokenUsageCollectorConfig } from "./token-usage-collector";

// Mirror the old collector's defaults so a config-less call behaves the same.
const DEFAULT_SINCE_HOURS = 24 * 30;
const DEFAULT_MAX_FILES = 800;

// Sentinel engine key for user-supplied custom paths: ASC tags every discovered
// file with the root's key as `engine`, so we route custom paths through this
// placeholder and then clear it before parsing to force content detection.
const CUSTOM_ENGINE = "__custom__";

function buildDiscoverOptions(config: TokenUsageCollectorConfig): DiscoverOptions {
  const roots: Record<string, string[]> = {};

  if (config.includeDefaultSources !== false) {
    // ASC's defaultRoots() = { codex: [sessions, archived_sessions], claude: [projects] }.
    // The old collector additionally walks ~/.codex/projects, so include it to
    // keep the codex file set aligned for parity.
    const base = defaultRoots();
    roots.codex = [...(base.codex ?? []), "~/.codex/projects"];
    roots.claude = [...(base.claude ?? [])];
  }

  if (config.usagePaths?.length) {
    roots[CUSTOM_ENGINE] = [...config.usagePaths];
  }

  const sinceHours = config.sinceHours ?? DEFAULT_SINCE_HOURS;
  const opts: DiscoverOptions = {
    roots,
    sinceMs: sinceHours > 0 ? sinceHours * 60 * 60 * 1000 : null,
    maxFiles: config.maxFiles ?? DEFAULT_MAX_FILES,
    // token-board counts real spend, including per-subagent/workflow transcripts
    // that ASC excludes by default. The old collector counted these too, so this
    // keeps the session/token set aligned (leaving only the dedup correction).
    includeSubagentTranscripts: true,
  };

  // ASC's maxBytes is an admission filter; beyond it the parser truncates a
  // prefix (session.truncated) rather than slurping. The old collector instead
  // *drops* files past maxFileBytes. We only set maxBytes when the caller asked
  // for one; otherwise we keep ASC's large default so nothing is dropped (the
  // drop-vs-truncate difference is a known, documented delta).
  if (typeof config.maxFileBytes === "number" && config.maxFileBytes > 0) {
    opts.maxBytes = config.maxFileBytes;
  }

  return opts;
}

/**
 * ASC-backed replacement for collectLocalTokenUsage(). Returns events in the
 * downstream TokenUsageEvent shape. Dedup / redaction / stable-id are left to
 * sanitizeIngestEvents().
 */
export async function collectLocalTokenUsageViaAsc(
  config: TokenUsageCollectorConfig = {}
): Promise<TokenUsageEvent[]> {
  const opts = buildDiscoverOptions(config);
  const ctx = {
    userId: config.userId || "local",
    displayName: config.displayName,
    team: config.team,
  };

  const files = discoverSessionFiles(opts);
  const out: TokenUsageEvent[] = [];

  for (const file of files) {
    // Custom paths carry the sentinel engine: clear it so parseSessionFile
    // content-detects codex/claude (and skips anything it can't classify).
    const toParse: DiscoveredFile =
      file.engine === (CUSTOM_ENGINE as DiscoveredFile["engine"])
        ? ({ ...file, engine: undefined as unknown as DiscoveredFile["engine"] })
        : file;

    const session = parseSessionFile(toParse);
    if (!session) continue;

    const ascEvents = toTokenEvents(session, ctx);
    for (const ev of ascEvents) {
      out.push(mapEvent(ev));
    }
  }

  return out;
}

/** Map an ASC TokenUsageEvent onto the downstream TokenUsageEvent shape. */
function mapEvent(ev: AscTokenUsageEvent): TokenUsageEvent {
  return {
    id: ev.id,
    userId: ev.userId,
    displayName: ev.displayName,
    team: ev.team,
    source: ev.source,
    model: ev.model,
    project: ev.project,
    tool: ev.tool,
    timestamp: ev.timestamp,
    inputTokens: ev.inputTokens,
    cacheCreationInputTokens: ev.cacheCreationInputTokens ?? 0,
    cachedInputTokens: ev.cachedInputTokens,
    outputTokens: ev.outputTokens,
    reasoningOutputTokens: ev.reasoningOutputTokens,
    totalTokens: ev.totalTokens,
    costUsd: ev.costUsd,
    sessionId: ev.sessionId,
    sessionTitle: ev.sessionTitle,
  };
}
