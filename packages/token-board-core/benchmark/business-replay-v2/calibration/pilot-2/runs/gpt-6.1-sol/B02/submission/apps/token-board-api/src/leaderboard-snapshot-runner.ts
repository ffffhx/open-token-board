import { Worker } from "node:worker_threads";
import type { SnapshotJob, SnapshotEntry } from "./leaderboard-snapshot-worker";

let worker: Worker | undefined;
let pending: { resolve: (entries: SnapshotEntry[]) => void; reject: (error: Error) => void } | undefined;

/** Keep statistics and persistence off the HTTP event loop. The server coalesces callers. */
export function buildLeaderboardSnapshotsInWorker(job: SnapshotJob): Promise<SnapshotEntry[]> {
  if (pending) return Promise.reject(new Error("Snapshot worker is already busy"));
  if (!worker) {
    const source = import.meta.url.endsWith(".ts");
    const entry = new URL(`./leaderboard-snapshot-worker.${source ? "ts" : "js"}`, import.meta.url);
    const current = new Worker(`
      const { workerData } = require("node:worker_threads");
      (async () => {
        if (workerData.source) {
          const { tsImport } = await import("tsx/esm/api");
          await tsImport(workerData.entry, workerData.parent);
        } else { await import(workerData.entry); }
      })().catch(error => { throw error; });
    `, { eval: true, workerData: { source, entry: entry.href, parent: import.meta.url } });
    worker = current;
    const failed = (error: Error) => {
      if (worker !== current) return;
      worker = undefined;
      const operation = pending;
      pending = undefined;
      operation?.reject(error);
    };
    current.on("error", failed);
    current.on("exit", (code) => failed(new Error(`Snapshot worker exited (${code})`)));
    current.on("message", (message: { entries?: SnapshotEntry[]; error?: string }) => {
      if (worker !== current) return;
      const operation = pending;
      pending = undefined;
      current.unref();
      if (message.error) operation?.reject(new Error(message.error));
      else if (message.entries) operation?.resolve(message.entries);
      else operation?.reject(new Error("Invalid snapshot worker response"));
    });
    current.unref();
  }
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    worker!.ref();
    try { worker!.postMessage(job); }
    catch (error) { pending = undefined; worker!.unref(); reject(error); }
  });
}
