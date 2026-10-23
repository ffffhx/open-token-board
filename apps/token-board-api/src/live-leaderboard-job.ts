import { runLeaderboardSnapshotJob, type SnapshotJobRequest, type SnapshotJobResult } from "./leaderboard-snapshot-job";

// One live analytics worker at a time, with bounded pending work and cached results.
// All metrics for the same window share the expensive SQL and history processing.
type LiveResult = { entries: SnapshotJobResult; generatedAt: string };
const pending = new Map<string, Promise<LiveResult>>();
const cache = new Map<string, { at: number; result: LiveResult }>();
let queue: Promise<unknown> = Promise.resolve();
export class AnalyticsBusyError extends Error {}

export function readLiveLeaderboardJob(request: SnapshotJobRequest, allowTimeBucket = false) {
  const key = JSON.stringify([request.ranges, allowTimeBucket ? request.now.slice(0, 16) : request.now, request.window]);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return Promise.resolve(cached.result);
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 8) throw new AnalyticsBusyError("Analytics is busy; retry shortly");
  const job = queue.then(async () => ({ entries: await runLeaderboardSnapshotJob(request), generatedAt: request.now }));
  queue = job.catch(() => undefined);
  pending.set(key, job);
  void job.then((result) => {
    cache.set(key, { at: Date.now(), result });
    if (cache.size > 24) cache.delete(cache.keys().next().value!);
  }).catch(() => undefined).finally(() => pending.delete(key));
  return job;
}
