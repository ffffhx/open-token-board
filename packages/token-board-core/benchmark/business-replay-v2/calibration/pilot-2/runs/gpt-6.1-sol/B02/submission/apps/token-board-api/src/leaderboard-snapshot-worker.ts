import { parentPort } from "node:worker_threads";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createTokenUsageStore, type TokenUsageStore, type TokenUsageStoreOptions } from "@open-token-board/core/storage";
import { buildTokenLeaderboard, type TokenBoardRange, type TokenBoardMetric, type TokenLeaderboardSummary } from "@open-token-board/core";

export type SnapshotEntry = {
  generatedAt: string; key: string; metric: TokenBoardMetric; range: TokenBoardRange;
  records: number; summary: TokenLeaderboardSummary;
};
export type SnapshotJob = {
  options: TokenUsageStoreOptions; ranges: TokenBoardRange[]; metrics: TokenBoardMetric[];
  refreshedAt: string; file: string;
};
let store: TokenUsageStore | undefined;

parentPort?.on("message", async (job: SnapshotJob) => {
  try {
    store ??= await createTokenUsageStore(job.options);
    const now = new Date(job.refreshedAt);
    const results = store.getLeaderboardSnapshots
      ? await store.getLeaderboardSnapshots(job.ranges, job.metrics, now)
      : await (async () => {
        const events = await store!.listEvents();
        return job.ranges.flatMap(range => job.metrics.map(metric => ({
          range, metric, records: events.length, summary: buildTokenLeaderboard(events, { range, metric, now }),
        })));
      })();
    const entries: SnapshotEntry[] = results.map(result => ({
      ...result, generatedAt: job.refreshedAt, key: `${result.range}:${result.metric}`,
    }));
    const dir = path.dirname(job.file);
    const temporary = path.join(dir, `.${path.basename(job.file)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, generatedAt: job.refreshedAt, entries })}\n`);
      await fs.rename(temporary, job.file);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    parentPort!.postMessage({ entries });
  } catch (error) {
    parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
