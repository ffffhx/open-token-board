import { readPostgresAccountProfile } from "@open-token-board/core/storage";
import type { AccountProfileRequest } from "./account-profile-job";

process.once("disconnect", () => process.exit(0));
process.once("message", async (request: AccountProfileRequest) => {
  try {
    const profile = await readPostgresAccountProfile({ ...request, now: new Date(request.now) });
    process.send?.({ profile });
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : "Account profile failed" });
  }
});
