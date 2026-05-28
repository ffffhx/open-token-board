import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const packageDir = path.join(rootDir, "tools", "token-board-agent-npx");
const publicDir = path.join(rootDir, "apps", "web", "public");
const outputFile = path.join(publicDir, "token-board-agent.tgz");

await fs.mkdir(publicDir, { recursive: true });
await fs.rm(outputFile, { force: true });

const result = spawnSync("npm", ["pack", "--pack-destination", publicDir], {
  cwd: packageDir,
  encoding: "utf8",
  stdio: "pipe",
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

const packedName = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);

if (!packedName) {
  throw new Error("npm pack did not report an output tarball");
}

await fs.rename(path.join(publicDir, packedName), outputFile);
console.log(`Packed token-board-agent to ${path.relative(rootDir, outputFile)}`);
