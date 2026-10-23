import { readPostgresLeaderboardBatch } from "@open-token-board/core/storage";
import type { SnapshotJobRequest } from "./leaderboard-snapshot-job";

process.once("disconnect", () => process.exit(0));
process.once("message", async (request: SnapshotJobRequest) => {
  try {
    const window = request.window ? { range: request.window.range, start: new Date(request.window.start), end: new Date(request.window.end), previousStart: new Date(request.window.previousStart), previousEnd: new Date(request.window.previousEnd) } : undefined;
    const entries = await readPostgresLeaderboardBatch({ ...request, now: new Date(request.now), window });
    process.send?.({ entries });
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : "Leaderboard refresh failed" });
  }
});
