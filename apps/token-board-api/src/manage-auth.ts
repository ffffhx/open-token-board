import path from "node:path";
import { createAuthSessionStore } from "./auth-session-store";

// Run only from the deployment host/container with its existing DB configuration.
const [command, userId] = process.argv.slice(2);
if (!["disable", "enable", "revoke-all"].includes(command) || !userId) {
  throw new Error("Usage: node --import tsx src/manage-auth.ts <disable|enable|revoke-all> <userId>");
}
const store = await createAuthSessionStore({
  dataFile: process.env.TOKEN_BOARD_AUTH_STATE_FILE || path.join(path.dirname(process.env.TOKEN_BOARD_DATA_FILE || path.join(process.cwd(), ".token-board", "usage-events.json")), "auth-state.json"),
  databaseUrl: process.env.TOKEN_BOARD_DATABASE_URL || process.env.DATABASE_URL,
  postgresSchema: process.env.TOKEN_BOARD_POSTGRES_SCHEMA || "token_board",
  postgresSsl: process.env.TOKEN_BOARD_POSTGRES_SSL === "true",
});
try {
  if (command === "revoke-all") await store.revokeAll(userId);
  else await store.setDisabled(userId, command === "disable");
  console.log(`${command} completed for ${userId}`);
} finally { await store.close(); }
