import { readPostgresLeaderboardBatch } from "@open-token-board/core/storage";
import type { SnapshotJobRequest } from "./leaderboard-snapshot-job";

process.once("disconnect", () => process.exit(0));
process.once("message", async (request: SnapshotJobRequest) => {
  try {
    const entries = await readPostgresLeaderboardBatch({ ...request, now: new Date(request.now) });
    for (const entry of entries) {
      await new Promise<void>((resolve, reject) => process.send?.({ entry }, (error: Error | null) => error ? reject(error) : resolve()));
    }
    process.send?.({ done: true });
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : "Leaderboard refresh failed" });
  }
});
