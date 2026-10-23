import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";

/**
 * Codex CLI 把每次请求的限额状态写进 ~/.codex 的会话日志（每条 token_count
 * 事件都带 rate_limits.primary / secondary，含 used_percent、window_minutes、
 * resets_at）。这个模块直接读这些日志，算出：
 *
 * - 当前剩余额度（used_percent / resets_at 是 Codex 自己上报的，精确值）；
 * - 消耗速度与预计耗尽时间（用最近一段没被重置打断的 pct 斜率推算）；
 * - 限额对应的 token 容量（只能估算：百分比按整数取整，且额度是按账号跨设备
 *   共享的，本机日志看不到网页版/其他机器的用量，所以是下界估计）。
 *
 * 「提前充值」是被正确处理的：窗口边界不假设固定 7 天，而是以 pct 掉回（重置）
 * 的时刻为界，所以即使 Codex 提前刷新额度也不会把旧用量算进来。
 */

const WINDOW_MINUTES_5H = 300;
const WINDOW_MINUTES_WEEKLY = 10080;

export type CodexRateWindowKey = "5h" | "weekly";

export interface CodexRateWindow {
  key: CodexRateWindowKey;
  /** Codex 上报的窗口长度（分钟）：5h=300，weekly=10080。 */
  windowMinutes: number;
  /** 展示用标签，例如 "5 小时" / "每周"。 */
  label: string;
  /** Codex 上报的已用百分比（精确）。 */
  usedPercent: number;
  /** 剩余百分比 = 100 - usedPercent。 */
  remainingPercent: number;
  /** 下次重置时间（ISO）。 */
  resetsAt: string | null;
  /** 距离重置还有多少秒（生成时刻计算，前端可用 resetsAt 实时倒计时）。 */
  resetsInSeconds: number | null;
  /** 该窗口最近一次被上报的时间（ISO）。 */
  observedAt: string;
  /** 距最近一次上报过去了多少秒（数据新鲜度）。 */
  staleSeconds: number;
  /** 最近的消耗速度（百分比/小时），idle 或无法估算时为 null。 */
  burnPercentPerHour: number | null;
  /** 最近的消耗速度（估算 token/小时），无法估算容量或 idle 时为 null。 */
  burnTokensPerHour: number | null;
  /** 预计还有多少秒耗尽（到 100%），不会耗尽时为 null。 */
  etaSeconds: number | null;
  /** 预计耗尽的时间点（ISO），不会耗尽时为 null。 */
  etaAt: string | null;
  /** 是否会在本周期重置前耗尽。 */
  willExhaustBeforeReset: boolean;
  /** 估算的额度容量（总 token，含缓存），无法估算时 null。 */
  estimatedCapacityTokens: number | null;
  /** 估算的剩余 token（= 容量 × 剩余%）。 */
  estimatedRemainingTokens: number | null;
  /** 本机本周期（自上次重置以来）已消耗的 token，下界估计。 */
  localConsumedTokensThisWindow: number | null;
}

export interface CodexRateLimitReport {
  generatedAt: string;
  /** 是否在日志里找到了限额数据。 */
  available: boolean;
  /** 计划类型（plan_type），若 Codex 有上报。 */
  plan: string | null;
  /** 最近一条 token_count 事件的时间（ISO）。 */
  latestEventAt: string | null;
  windows: CodexRateWindow[];
  /** 最近一小时本机的 token 吞吐（token/小时）。 */
  recentTokensPerHour: number | null;
  notes: string[];
  /** 实际扫描的目录。 */
  sourcePaths: string[];
}

export interface AnalyzeCodexRateLimitsOptions {
  /** Codex 主目录，默认 $CODEX_HOME 或 ~/.codex。 */
  codexHome?: string;
  /** 只看最近多少天修改过的日志，默认 14。 */
  lookbackDays?: number;
  /** 最多扫描多少个文件（按 mtime 倒序），默认 2000。 */
  maxFiles?: number;
  /** 估算消耗速度时回看的小时数，默认 3。 */
  burnLookbackHours?: number;
  /** 结果缓存毫秒数（同一 codexHome 内复用），默认 0 不缓存。 */
  cacheMs?: number;
}

interface RawEvent {
  ts: number;
  sessionId: string;
  cumTotal: number | null;
  lastTotal: number;
  /** rate_limits.limit_id —— 区分主计划与 Spark 等独立配额桶；null 视为旧版基础计划。 */
  limitId: string | null;
  /** rate_limits.limit_name —— 基础账号计划为 null，实验模型（如 GPT-5.3-Codex-Spark）非 null。 */
  limitName: string | null;
  pct5: number | null;
  reset5: number | null;
  pctW: number | null;
  resetW: number | null;
}

interface CacheEntry {
  key: string;
  at: number;
  report: CodexRateLimitReport;
}

let cache: CacheEntry | null = null;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function defaultCodexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

async function listRecentSessionFiles(
  codexHome: string,
  cutoffMs: number,
  maxFiles: number,
): Promise<{ files: string[]; scannedDirs: string[] }> {
  const roots = [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")];
  const found: Array<{ filePath: string; mtime: number }> = [];
  const scannedDirs: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 6) await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const info = await stat(full);
          if (info.mtimeMs >= cutoffMs) {
            found.push({ filePath: full, mtime: info.mtimeMs });
          }
        } catch {
          // ignore unreadable file
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

async function parseFile(filePath: string, events: RawEvent[]): Promise<string | null> {
  const sessionId = path.basename(filePath);
  let plan: string | null = null;
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.includes("\"token_count\"")) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = (obj as { payload?: Record<string, unknown> }).payload;
      if (!payload || payload.type !== "token_count") continue;
      const timestamp = (obj as { timestamp?: string }).timestamp;
      if (typeof timestamp !== "string") continue;
      const ts = Date.parse(timestamp);
      if (!Number.isFinite(ts)) continue;

      const info = (payload.info ?? null) as Record<string, unknown> | null;
      const totalUsage = (info?.total_token_usage ?? null) as Record<string, unknown> | null;
      const lastUsage = (info?.last_token_usage ?? null) as Record<string, unknown> | null;
      const cumTotal = num(totalUsage?.total_tokens);
      const lastInput = num(lastUsage?.input_tokens) ?? 0;
      const lastOutput = num(lastUsage?.output_tokens) ?? 0;
      const lastTotal = lastInput + lastOutput;

      const rateLimits = (payload.rate_limits ?? null) as Record<string, unknown> | null;
      let pct5: number | null = null;
      let reset5: number | null = null;
      let pctW: number | null = null;
      let resetW: number | null = null;
      let limitId: string | null = null;
      let limitName: string | null = null;
      if (rateLimits) {
        if (typeof rateLimits.plan_type === "string") plan = rateLimits.plan_type;
        if (typeof rateLimits.limit_id === "string") limitId = rateLimits.limit_id;
        if (typeof rateLimits.limit_name === "string") limitName = rateLimits.limit_name;
        for (const slotKey of ["primary", "secondary"] as const) {
          const slot = rateLimits[slotKey] as Record<string, unknown> | null;
          if (!slot) continue;
          const windowMinutes = num(slot.window_minutes);
          const usedPercent = num(slot.used_percent);
          const resetsAt = num(slot.resets_at);
          if (usedPercent === null) continue;
          if (windowMinutes === WINDOW_MINUTES_5H) {
            pct5 = usedPercent;
            reset5 = resetsAt;
          } else if (windowMinutes === WINDOW_MINUTES_WEEKLY) {
            pctW = usedPercent;
            resetW = resetsAt;
          }
        }
      }

      events.push({ ts, sessionId, cumTotal, lastTotal, limitId, limitName, pct5, reset5, pctW, resetW });
    }
  } catch {
    // ignore stream errors on a single file
  } finally {
    rl.close();
    stream.close();
  }
  return plan;
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[index];
}

/** 估算窗口容量：会话内 pct 单调上涨段的 Δtoken/Δpct 上包络（独占段最接近真值）。 */
function estimateCapacityTokens(
  events: RawEvent[],
  pickPct: (e: RawEvent) => number | null,
): number | null {
  // used_percent is account-global (shared across every session), but a single
  // session's cumTotal only covers its own tokens. Dividing a global pct change by
  // one session's token delta underestimates capacity — catastrophically for the
  // weekly window, which spans many concurrent sessions (observed ~90x too low).
  // Estimate globally instead: merge all sessions on one timeline and pair each
  // global pct rise with the per-turn tokens (lastTotal, cross-session additive)
  // consumed over that same span. lastTotal is also the unit used for the displayed
  // "consumed this window", so capacity and consumption stay in the same currency.
  const points = events
    .map((event) => ({ ts: event.ts, pct: pickPct(event), tok: event.lastTotal }))
    .filter((point): point is { ts: number; pct: number; tok: number } => point.pct !== null)
    .sort((a, b) => a.ts - b.ts);

  const ratios: number[] = [];
  let runStart = 0;
  for (let i = 1; i <= points.length; i += 1) {
    // A drop in pct marks a window reset (or an early top-up); end the run there.
    const broke = i === points.length || points[i].pct < points[i - 1].pct - 0.5;
    if (broke) {
      const dPct = points[i - 1].pct - points[runStart].pct;
      let dTok = 0;
      for (let j = runStart + 1; j <= i - 1; j += 1) dTok += points[j].tok;
      if (dPct >= 20 && dTok > 0) ratios.push((dTok / dPct) * 100);
      runStart = i;
    }
  }
  if (ratios.length < 3) return null;
  return Math.round(percentile(ratios, 0.8));
}

/**
 * 选出主配额桶并过滤事件：Codex 会对不同模型上报不同的 limit_id（如基础计划 "codex"
 * 与实验模型 "codex_bengalfox"/Spark），它们配额互不相同。把多个桶混在一起会让最新
 * 百分比与容量估算都失真，所以只保留一个桶。优先基础计划（limit_name 为空），取其中
 * 最近活跃的；旧版无 limit_id 的事件并入该桶。返回过滤后的事件与被忽略的其它桶名。
 */
function selectPrimaryBucket(events: RawEvent[]): { events: RawEvent[]; otherBuckets: string[] } {
  const rated = events.filter((event) => event.pct5 !== null || event.pctW !== null);
  if (rated.length === 0) return { events, otherBuckets: [] };

  const latestByBucket = new Map<string, { ts: number; baseplan: boolean }>();
  for (const event of rated) {
    if (event.limitId === null) continue;
    const current = latestByBucket.get(event.limitId);
    const baseplan = event.limitName === null;
    if (!current || event.ts > current.ts) {
      latestByBucket.set(event.limitId, { ts: event.ts, baseplan });
    } else if (baseplan && !current.baseplan) {
      latestByBucket.set(event.limitId, { ...current, baseplan });
    }
  }

  if (latestByBucket.size <= 1) return { events, otherBuckets: [] };

  const ranked = [...latestByBucket.entries()].sort((a, b) => {
    if (a[1].baseplan !== b[1].baseplan) return a[1].baseplan ? -1 : 1; // base plan first
    return b[1].ts - a[1].ts; // then most recent
  });
  const chosenId = ranked[0][0];
  const otherBuckets = ranked.slice(1).map(([id]) => id);

  // Keep the chosen bucket plus legacy events with no limit_id (predate the split).
  const filtered = events.filter((event) => event.limitId === chosenId || event.limitId === null);
  return { events: filtered, otherBuckets };
}

/** 找出某窗口「当前这一段」（自上次重置以来）的 pct 观测点。 */
function currentRunObservations(
  events: RawEvent[],
  pickPct: (e: RawEvent) => number | null,
): Array<{ ts: number; pct: number }> {
  const points: Array<{ ts: number; pct: number }> = [];
  for (const event of events) {
    const pct = pickPct(event);
    if (pct !== null) points.push({ ts: event.ts, pct });
  }
  points.sort((a, b) => a.ts - b.ts);
  let runStart = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].pct < points[i - 1].pct - 0.5) runStart = i;
  }
  return points.slice(runStart);
}

function buildWindow(
  key: CodexRateWindowKey,
  windowMinutes: number,
  label: string,
  events: RawEvent[],
  now: number,
  burnLookbackHours: number,
  pickPct: (e: RawEvent) => number | null,
  pickReset: (e: RawEvent) => number | null,
): CodexRateWindow | null {
  // 最新一条带该窗口的事件 = 当前精确状态。
  let latest: RawEvent | null = null;
  for (const event of events) {
    if (pickPct(event) === null) continue;
    if (!latest || event.ts > latest.ts) latest = event;
  }
  if (!latest) return null;

  const usedPercent = pickPct(latest) ?? 0;
  const remainingPercent = Math.max(0, 100 - usedPercent);
  const resetEpoch = pickReset(latest);
  const resetsAtMs = resetEpoch !== null ? resetEpoch * 1000 : null;
  const resetsInSeconds = resetsAtMs !== null ? Math.round((resetsAtMs - now) / 1000) : null;

  // 消耗速度：当前段最近 burnLookbackHours 小时的 pct 斜率。
  const run = currentRunObservations(events, pickPct);
  let burnPercentPerHour: number | null = null;
  if (run.length >= 2) {
    const last = run[run.length - 1];
    const lookbackStart = last.ts - burnLookbackHours * 3600 * 1000;
    const window = run.filter((point) => point.ts >= lookbackStart);
    const first = window.length >= 2 ? window[0] : run[0];
    const hours = (last.ts - first.ts) / 3600 / 1000;
    const dPct = last.pct - first.pct;
    if (hours > 0 && dPct > 0) burnPercentPerHour = dPct / hours;
  }

  const estimatedCapacityTokens = estimateCapacityTokens(events, pickPct);
  const burnTokensPerHour =
    estimatedCapacityTokens !== null && burnPercentPerHour !== null
      ? Math.round((estimatedCapacityTokens * burnPercentPerHour) / 100)
      : null;
  const estimatedRemainingTokens =
    estimatedCapacityTokens !== null
      ? Math.round((estimatedCapacityTokens * remainingPercent) / 100)
      : null;

  let etaSeconds: number | null = null;
  let etaAt: string | null = null;
  if (burnPercentPerHour && burnPercentPerHour > 0 && remainingPercent > 0) {
    const hoursToEmpty = remainingPercent / burnPercentPerHour;
    etaSeconds = Math.round(hoursToEmpty * 3600);
    etaAt = new Date(now + hoursToEmpty * 3600 * 1000).toISOString();
  }
  const willExhaustBeforeReset =
    etaSeconds !== null && resetsInSeconds !== null && etaSeconds < resetsInSeconds;

  // 本机本周期消耗：自当前段起点以来的 per-turn token 之和。
  let localConsumedTokensThisWindow: number | null = null;
  if (run.length > 0) {
    const runStartTs = run[0].ts;
    let sum = 0;
    for (const event of events) {
      if (event.ts >= runStartTs) sum += event.lastTotal;
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
    burnTokensPerHour,
    etaSeconds,
    etaAt,
    willExhaustBeforeReset,
    estimatedCapacityTokens,
    estimatedRemainingTokens,
    localConsumedTokensThisWindow,
  };
}

export async function analyzeCodexRateLimits(
  options: AnalyzeCodexRateLimitsOptions = {},
): Promise<CodexRateLimitReport> {
  const codexHome = options.codexHome ?? defaultCodexHome();
  const lookbackDays = options.lookbackDays ?? 14;
  const maxFiles = options.maxFiles ?? 2000;
  const burnLookbackHours = options.burnLookbackHours ?? 3;
  const cacheMs = options.cacheMs ?? 0;

  const cacheKey = `${codexHome}|${lookbackDays}|${maxFiles}|${burnLookbackHours}`;
  const now = Date.now();
  if (cacheMs > 0 && cache && cache.key === cacheKey && now - cache.at < cacheMs) {
    return cache.report;
  }

  const cutoffMs = now - lookbackDays * 24 * 3600 * 1000;
  const { files, scannedDirs } = await listRecentSessionFiles(codexHome, cutoffMs, maxFiles);

  const events: RawEvent[] = [];
  let plan: string | null = null;
  for (const filePath of files) {
    const filePlan = await parseFile(filePath, events);
    if (filePlan) plan = filePlan;
  }

  const notes: string[] = [];
  if (files.length === 0) {
    notes.push(`未在 ${scannedDirs.join("、")} 找到最近 ${lookbackDays} 天的会话日志。`);
  }

  // Isolate one rate-limit bucket: different limit_ids (base plan vs Spark/experimental
  // models) have separate quotas, and mixing them corrupts both the latest percentage
  // and the capacity estimate.
  const { events: bucketEvents, otherBuckets } = selectPrimaryBucket(events);
  if (otherBuckets.length > 0) {
    notes.push(`检测到多个限额桶，仅展示主计划；已忽略 ${otherBuckets.join("、")}（Spark 等实验模型额度单独计算）。`);
  }

  const windows: CodexRateWindow[] = [];
  const w5 = buildWindow(
    "5h",
    WINDOW_MINUTES_5H,
    "5 小时",
    bucketEvents,
    now,
    burnLookbackHours,
    (e) => e.pct5,
    (e) => e.reset5,
  );
  const ww = buildWindow(
    "weekly",
    WINDOW_MINUTES_WEEKLY,
    "每周",
    bucketEvents,
    now,
    burnLookbackHours,
    (e) => e.pctW,
    (e) => e.resetW,
  );
  if (w5) windows.push(w5);
  if (ww) windows.push(ww);

  let latestEventAt: string | null = null;
  for (const event of events) {
    if (!latestEventAt || event.ts > Date.parse(latestEventAt)) {
      latestEventAt = new Date(event.ts).toISOString();
    }
  }

  let recentTokensPerHour: number | null = null;
  if (events.length > 0) {
    const hourAgo = now - 3600 * 1000;
    let sum = 0;
    for (const event of events) {
      if (event.ts >= hourAgo) sum += event.lastTotal;
    }
    recentTokensPerHour = Math.round(sum);
  }

  if (windows.length > 0) {
    notes.push(
      "百分比与重置时间为 Codex 上报的精确值；token 容量为估算（百分比按整数取整、" +
        "额度按账号跨设备共享，本机日志只能给下界）。窗口边界以重置点切分，已计入提前充值。",
    );
  }

  const report: CodexRateLimitReport = {
    generatedAt: new Date(now).toISOString(),
    available: windows.length > 0,
    plan,
    latestEventAt,
    windows,
    recentTokensPerHour,
    notes,
    sourcePaths: scannedDirs,
  };

  if (cacheMs > 0) cache = { key: cacheKey, at: now, report };
  return report;
}
