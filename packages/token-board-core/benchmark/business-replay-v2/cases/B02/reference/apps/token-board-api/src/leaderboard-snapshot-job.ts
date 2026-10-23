import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { TokenLeaderboardBatchOptions, readPostgresLeaderboardBatch } from "@open-token-board/core/storage";

export type SnapshotJobResult = Awaited<ReturnType<typeof readPostgresLeaderboardBatch>>;
export type SnapshotJobRequest = Omit<TokenLeaderboardBatchOptions, "now"> & { now: string };

/** Keep CPU-heavy history processing off the HTTP event loop. No worker survives its parent. */
export function runLeaderboardSnapshotJob(request: SnapshotJobRequest, timeoutMs = 300_000): Promise<SnapshotJobResult> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL("./leaderboard-snapshot-worker.ts", import.meta.url)), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],

    });
    let settled = false;
    const collected: SnapshotJobResult = [];
    const finish = (error?: Error, entries?: SnapshotJobResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill();
        reject(error);
      } else {
        if (child.connected) child.disconnect();
        resolve(entries!);
      }
    };
    const timer = setTimeout(() => finish(new Error(`Leaderboard refresh exceeded ${timeoutMs}ms`)), timeoutMs);
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => finish(new Error(`Leaderboard worker exited (${code ?? signal})`)));
    child.on("message", (message: { entry?: SnapshotJobResult[number]; done?: boolean; error?: string }) => {
      if (message.entry) collected.push(message.entry);
      else if (message.done && collected.length === request.ranges.length * request.metrics.length) finish(undefined, collected);
      else finish(new Error(message.error || "Incomplete leaderboard worker response"));
    });
    child.send(request, (error) => { if (error) finish(error); });
  });
}
