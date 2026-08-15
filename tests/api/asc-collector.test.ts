import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { collectLocalTokenUsageViaAscWithReport } from "../../packages/token-board-core/src/asc-collector";

test("ASC collection does not silently truncate a semantic window at 800 files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "token-board-asc-"));
  const timestamp = new Date().toISOString();
  const fileCount = 805;

  try {
    await Promise.all(
      Array.from({ length: fileCount }, (_, index) => {
        const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
        const rows = [
          JSON.stringify({ timestamp, type: "session_meta", payload: { id, cwd: root, model: "test-model" } }),
          JSON.stringify({
            timestamp,
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: {
                  input_tokens: 10,
                  cached_input_tokens: 2,
                  output_tokens: 1,
                  reasoning_output_tokens: 0,
                  total_tokens: 11,
                },
              },
            },
          }),
        ];
        return writeFile(path.join(root, `rollout-${id}.jsonl`), `${rows.join("\n")}\n`, "utf8");
      })
    );

    const result = await collectLocalTokenUsageViaAscWithReport({
      includeDefaultSources: false,
      usagePaths: [root],
      sinceHours: 1,
      // Legacy callers may still supply this field; the semantic scan must not
      // honor it as an implicit truncation cap.
      maxFiles: 10,
    });

    assert.equal(result.complete, true);
    assert.equal(result.filesDiscovered, fileCount);
    assert.equal(result.filesParsed, fileCount);
    assert.equal(result.events.length, fileCount);
    assert.equal(result.events.reduce((sum, event) => sum + event.totalTokens, 0), fileCount * 11);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ASC collection deduplicates diverged copies of the same logical session", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "token-board-asc-copy-"));
  const timestamp = new Date().toISOString();
  const sessionId = "00000000-0000-4000-8000-999999999999";
  const older = path.join(root, "older.jsonl");
  const newer = path.join(root, "newer.jsonl");
  const content = (inputTokens: number) =>
    [
      JSON.stringify({ timestamp, type: "session_meta", payload: { id: sessionId, cwd: root, model: "test-model" } }),
      JSON.stringify({
        timestamp,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { total_token_usage: { input_tokens: inputTokens, output_tokens: 1, total_tokens: inputTokens + 1 } },
        },
      }),
    ].join("\n");

  try {
    await writeFile(older, `${content(10)}\n`, "utf8");
    await writeFile(newer, `${content(20)}\n`, "utf8");
    const now = new Date();
    await utimes(older, new Date(now.getTime() - 60_000), new Date(now.getTime() - 60_000));
    await utimes(newer, now, now);

    const result = await collectLocalTokenUsageViaAscWithReport({
      includeDefaultSources: false,
      usagePaths: [root],
      sinceHours: 1,
    });

    assert.equal(result.filesDiscovered, 2);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]?.totalTokens, 21);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
