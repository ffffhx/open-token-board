import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  createTokenUsageStore,
  type TokenUsageStore,
} from "../../packages/token-board-core/src/token-board-storage";
import type { TokenUsageEvent } from "../../packages/token-board-core/src/token-leaderboard";

let originalBackupEnabled: string | undefined;
let originalBackupDir: string | undefined;

beforeEach(() => {
  originalBackupEnabled = process.env.TOKEN_BOARD_JSON_BACKUP_ENABLED;
  originalBackupDir = process.env.TOKEN_BOARD_JSON_BACKUP_DIR;
  process.env.TOKEN_BOARD_JSON_BACKUP_ENABLED = "true";
  delete process.env.TOKEN_BOARD_JSON_BACKUP_DIR;
});

afterEach(() => {
  restoreEnv("TOKEN_BOARD_JSON_BACKUP_ENABLED", originalBackupEnabled);
  restoreEnv("TOKEN_BOARD_JSON_BACKUP_DIR", originalBackupDir);
});

describe("file token usage store hardening", () => {
  it("serializes concurrent writes without losing events", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "otb-storage-concurrent-"));
    const dataFile = path.join(dir, "usage-events.json");
    await writeStoreFile(dataFile, []);

    try {
      const store = await createTokenUsageStore({ dataFile, maxEvents: 1000 });
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, index) => store.insertEvents([usageEvent(`concurrent-${index}`)]))
      );
      const accepted = results.reduce((sum, result) => sum + result.accepted, 0);
      const health = await store.getHealth?.();

      assert.equal(accepted, 20);
      assert.equal(await store.countEvents(), 20);
      assert.equal(health?.eventCount, 20);
      assert.equal(health?.backups.enabled, true);
      assert.equal(health?.backups.retained, 1);
      assert.ok(health?.lastWriteAt);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("recovers a corrupt data file from the latest valid backup", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "otb-storage-recover-backup-"));
    const dataFile = path.join(dir, "usage-events.json");
    await writeStoreFile(dataFile, [usageEvent("restored")]);
    const warnings = captureWarnings();

    try {
      const firstStore = await createTokenUsageStore({ dataFile, maxEvents: 1000 });
      await firstStore.insertEvents([usageEvent("after-backup")]);
      await writeFile(dataFile, "{broken-json", "utf8");

      const recoveredStore = await createTokenUsageStore({ dataFile, maxEvents: 1000 });
      const events = await recoveredStore.listEvents();
      const health = await recoveredStore.getHealth?.();

      assert.deepEqual(events.map((event) => event.id), ["restored"]);
      assert.equal(health?.backups.lastRecoverySource, "backup");
      assert.match(warnings.text(), /restored from backup/);
    } finally {
      warnings.restore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to an empty store when corrupt data has no valid backup", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "otb-storage-recover-empty-"));
    const dataFile = path.join(dir, "usage-events.json");
    await writeFile(dataFile, "{broken-json", "utf8");
    const warnings = captureWarnings();

    try {
      const store = await createTokenUsageStore({ dataFile, maxEvents: 1000 });
      const health = await store.getHealth?.();

      assert.equal(await store.countEvents(), 0);
      assert.equal(health?.backups.lastRecoverySource, "empty");
      assert.match(warnings.text(), /empty event store/);
    } finally {
      warnings.restore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function writeStoreFile(filePath: string, entries: TokenUsageEvent[]) {
  await writeFile(
    filePath,
    `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), entries }, null, 2)}\n`,
    "utf8"
  );
}

function usageEvent(id: string): TokenUsageEvent {
  return {
    id,
    userId: "github:storage-test",
    displayName: "storage-test",
    team: "Ops",
    source: "codex",
    model: "gpt-5-codex",
    project: "storage",
    tool: "Codex CLI",
    timestamp: "2026-07-08T04:00:00.000Z",
    inputTokens: 1000,
    cacheCreationInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 1000,
    costUsd: 0,
    messages: 1,
    sessionId: id,
  };
}

function captureWarnings() {
  const original = console.warn;
  const messages: string[] = [];
  console.warn = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };

  return {
    text: () => messages.join("\n"),
    restore: () => {
      console.warn = original;
    },
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
