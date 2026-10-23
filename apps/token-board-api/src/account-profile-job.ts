import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { TokenAccountProfileReadOptions, readPostgresAccountProfile } from "@open-token-board/core/storage";
import { AnalyticsBusyError } from "./live-leaderboard-job";

export type AccountProfileRequest = Omit<TokenAccountProfileReadOptions, "now"> & { now: string };
type Profile = Awaited<ReturnType<typeof readPostgresAccountProfile>>;
const pending = new Map<string, Promise<Profile>>();
// Merge duplicate in-flight requests; do not retain account configuration or goals after completion.
let queue: Promise<unknown> = Promise.resolve();

export function readAccountProfileJob(request: AccountProfileRequest) {
  const key = JSON.stringify([request.userId, request.range, request.now, request.summary.endAt]);
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 4) throw new AnalyticsBusyError("Account analytics is busy; retry shortly");
  const deadline = Date.now() + 60_000;
  const job = queue.then(() => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new AnalyticsBusyError("Account analytics timed out; retry shortly");
    return runAccountProfileJob(request, remaining);
  });
  queue = job.catch(() => undefined);
  pending.set(key, job);
  void job.finally(() => pending.delete(key)).catch(() => undefined);
  return job;
}

export function runAccountProfileJob(request: AccountProfileRequest, timeoutMs = 60_000): Promise<Profile> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL("./account-profile-worker.ts", import.meta.url)), [], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let settled = false;
    const finish = (error?: Error, profile?: Profile) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { child.kill(); reject(error); }
      else { if (child.connected) child.disconnect(); resolve(profile!); }
    };
    const timer = setTimeout(() => finish(new AnalyticsBusyError("Account analytics timed out; retry shortly")), timeoutMs);
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => finish(new Error(`Account worker exited (${code ?? signal})`)));
    child.once("message", (message: { profile?: Profile; error?: string }) => {
      if (message.profile) finish(undefined, message.profile);
      else finish(new Error(message.error || "Invalid account worker response"));
    });
    child.send(request, (error) => { if (error) finish(error); });
  });
}
