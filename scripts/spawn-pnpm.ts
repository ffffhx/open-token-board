import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

/**
 * Run the repository's package manager without relying on Windows resolving the
 * pnpm.cmd shim through child_process.spawn().
 */
export function spawnPnpm(args: string[], options: SpawnOptions = {}): ChildProcess {
  const packageManagerScript = process.env.npm_execpath;

  if (packageManagerScript) {
    return spawn(process.execPath, [packageManagerScript, ...args], options);
  }

  if (process.platform === "win32") {
    const commandPrompt = process.env.ComSpec || "cmd.exe";
    return spawn(commandPrompt, ["/d", "/c", "pnpm", ...args], {
      ...options,
      windowsHide: options.windowsHide ?? true,
    });
  }

  return spawn("pnpm", args, options);
}
