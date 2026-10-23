import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileDir = fileURLToPath(new URL("..", import.meta.url));
const androidDir = path.join(mobileDir, "android");
const isWindows = process.platform === "win32";
const command = isWindows ? process.env.ComSpec || "cmd.exe" : path.join(androidDir, "gradlew");
const args = isWindows ? ["/d", "/c", "gradlew.bat", "assembleRelease"] : ["assembleRelease"];
const result = spawnSync(command, args, {
  cwd: androidDir,
  stdio: "inherit",
  windowsHide: false,
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
