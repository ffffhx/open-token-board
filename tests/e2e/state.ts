import path from "node:path";
import { fileURLToPath } from "node:url";

export type E2eState = {
  apiUrl: string;
  currentMonthPeriod: string;
  primaryLogin: string;
  webSessionToken: string;
  webUrl: string;
};

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(e2eDir, "../..");

export const e2eStatePath = path.join(repoRoot, "tests", ".tmp", "e2e-state.json");
