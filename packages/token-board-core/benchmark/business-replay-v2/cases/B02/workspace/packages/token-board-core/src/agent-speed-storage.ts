import { promises as fs } from "node:fs";
import path from "node:path";

import { Pool, type PoolConfig } from "pg";

import {
  sanitizeAgentSpeedDailySnapshots,
  type AgentSpeedDailySnapshot,
} from "./agent-speed";

export type AgentSpeedHistoryStoreKind = "file" | "postgres";

export type AgentSpeedHistoryStore = {
  kind: AgentSpeedHistoryStoreKind;
  label: string;
  upsertSnapshots: (userId: string, snapshots: AgentSpeedDailySnapshot[]) => Promise<{ accepted: number; records: number }>;
  listSnapshots: (userId: string, options?: { days?: number; now?: Date }) => Promise<AgentSpeedDailySnapshot[]>;
  countSnapshots: () => Promise<number>;
  close?: () => Promise<void>;
};

export type AgentSpeedHistoryStoreOptions = {
  dataFile: string;
  databaseUrl?: string;
  postgresSchema?: string;
  postgresSsl?: boolean | PoolConfig["ssl"];
};

type StoredAgentSpeedSnapshot = AgentSpeedDailySnapshot & { userId: string };

const POSTGRES_TABLE = "agent_speed_daily";
const RETENTION_DAYS = 400;

export async function createAgentSpeedHistoryStore(
  options: AgentSpeedHistoryStoreOptions
): Promise<AgentSpeedHistoryStore> {
  const databaseUrl = options.databaseUrl?.trim();
  if (databaseUrl) {
    const store = createPostgresStore({
      connectionString: databaseUrl,
      schema: options.postgresSchema || "token_board",
      ssl: options.postgresSsl,
    });
    await store.initialize();
    return store;
  }
  return createFileStore(options.dataFile);
}

function createFileStore(dataFile: string): AgentSpeedHistoryStore {
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>) => {
    const run = queue.then(operation, operation);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    kind: "file",
    label: dataFile,
    upsertSnapshots: (userId, snapshots) =>
      enqueue(async () => {
        const existing = await readFileRecords(dataFile);
        const incomingKeys = new Set(snapshots.map((snapshot) => `${userId}\u0000${snapshot.date}`));
        const cutoff = dayKeyOffset(new Date(), -(RETENTION_DAYS - 1));
        const next = existing
          .filter((entry) => entry.date >= cutoff && !incomingKeys.has(`${entry.userId}\u0000${entry.date}`))
          .concat(snapshots.map((snapshot) => ({ ...snapshot, userId })))
          .sort((left, right) => left.userId.localeCompare(right.userId) || left.date.localeCompare(right.date));
        await writeFileRecords(dataFile, next);
        return { accepted: snapshots.length, records: next.filter((entry) => entry.userId === userId).length };
      }),
    listSnapshots: async (userId, options) => {
      const cutoff = historyCutoff(options?.days, options?.now);
      return (await readFileRecords(dataFile))
        .filter((entry) => entry.userId === userId && entry.date >= cutoff)
        .map(({ userId: _userId, ...snapshot }) => snapshot)
        .sort((left, right) => left.date.localeCompare(right.date));
    },
    countSnapshots: async () => (await readFileRecords(dataFile)).length,
  };
}

function createPostgresStore({
  connectionString,
  schema,
  ssl,
}: {
  connectionString: string;
  schema: string;
  ssl?: PoolConfig["ssl"];
}) {
  const pool = new Pool({ connectionString, ssl });
  const safeSchema = sqlIdentifier(schema);
  const table = `${safeSchema}.${sqlIdentifier(POSTGRES_TABLE)}`;

  return {
    kind: "postgres" as const,
    label: `${schema}.${POSTGRES_TABLE}`,
    initialize: async () => {
      await pool.query(`CREATE SCHEMA IF NOT EXISTS ${safeSchema}`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${table} (
          user_id TEXT NOT NULL,
          day DATE NOT NULL,
          captured_at TIMESTAMPTZ NOT NULL,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, day)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS agent_speed_daily_user_day_idx ON ${table} (user_id, day DESC)`);
    },
    upsertSnapshots: async (userId: string, snapshots: AgentSpeedDailySnapshot[]) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const snapshot of snapshots) {
          await client.query(
            `
              INSERT INTO ${table} (user_id, day, captured_at, payload, updated_at)
              VALUES ($1, $2::date, $3, $4::jsonb, now())
              ON CONFLICT (user_id, day) DO UPDATE SET
                captured_at = EXCLUDED.captured_at,
                payload = EXCLUDED.payload,
                updated_at = now()
            `,
            [userId, snapshot.date, snapshot.capturedAt, JSON.stringify(snapshot)]
          );
        }
        await client.query(`DELETE FROM ${table} WHERE day < (CURRENT_DATE - $1::integer)`, [RETENTION_DAYS - 1]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      const result = await pool.query<{ count: string }>(`SELECT count(*) AS count FROM ${table} WHERE user_id = $1`, [userId]);
      return { accepted: snapshots.length, records: Number(result.rows[0]?.count || 0) };
    },
    listSnapshots: async (userId: string, options?: { days?: number; now?: Date }) => {
      const cutoff = historyCutoff(options?.days, options?.now);
      const result = await pool.query<{ payload: unknown }>(
        `SELECT payload FROM ${table} WHERE user_id = $1 AND day >= $2::date ORDER BY day ASC`,
        [userId, cutoff]
      );
      return result.rows.flatMap((row) => sanitizeAgentSpeedDailySnapshots([row.payload]).snapshots);
    },
    countSnapshots: async () => {
      const result = await pool.query<{ count: string }>(`SELECT count(*) AS count FROM ${table}`);
      return Number(result.rows[0]?.count || 0);
    },
    close: () => pool.end(),
  } satisfies AgentSpeedHistoryStore & { initialize: () => Promise<void> };
}

async function readFileRecords(filePath: string): Promise<StoredAgentSpeedSnapshot[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.entries)
        ? parsed.entries
        : [];
    return entries.flatMap((entry) => normalizeStoredRecord(entry) ?? []);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

function normalizeStoredRecord(value: unknown): StoredAgentSpeedSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const userId = sanitizeText(value.userId, 160);
  const snapshot = sanitizeAgentSpeedDailySnapshots([value]).snapshots[0];
  return userId && snapshot ? { ...snapshot, userId } : undefined;
}

async function writeFileRecords(filePath: string, records: StoredAgentSpeedSnapshot[]) {
  const directory = path.dirname(filePath);
  const tempFile = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(
      tempFile,
      `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), entries: records }, null, 2)}\n`
    );
    await fs.rename(tempFile, filePath);
  } catch (error) {
    await fs.rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

function historyCutoff(days = 30, now = new Date()) {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(365, Math.trunc(days))) : 30;
  return dayKeyOffset(now, -(safeDays - 1));
}

function dayKeyOffset(value: Date, offsetDays: number) {
  const shifted = new Date(value.getTime() + 8 * 60 * 60 * 1_000);
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function sanitizeText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function sqlIdentifier(value: string) {
  const normalized = value.trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  }
  return `"${normalized.replace(/"/g, '""')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}
