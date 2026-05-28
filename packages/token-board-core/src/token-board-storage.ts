import { promises as fs } from "node:fs";
import path from "node:path";

import { Pool, type PoolConfig } from "pg";

import { mergeTokenEvents } from "./token-board-automation";
import {
  normalizeTokenUsageEvent,
  parseTokenUsageImport,
  type TokenBoardUserConfig,
  type TokenUsageEvent,
} from "./token-leaderboard";

export type TokenUsageStoreKind = "file" | "postgres";

export type TokenUsageStoreInsertResult = {
  accepted: number;
  duplicates: number;
  records: number;
};

export type TokenUsageStoreDeleteResult = {
  deleted: number;
  records: number;
};

export type TokenUsageStore = {
  kind: TokenUsageStoreKind;
  label: string;
  listEvents: () => Promise<TokenUsageEvent[]>;
  countEvents: () => Promise<number>;
  insertEvents: (events: TokenUsageEvent[]) => Promise<TokenUsageStoreInsertResult>;
  deleteEventsForUser: (userId: string) => Promise<TokenUsageStoreDeleteResult>;
  getUserConfig: (userId: string) => Promise<TokenBoardUserConfig | null>;
  upsertUserConfig: (userId: string, config: TokenBoardUserConfig) => Promise<TokenBoardUserConfig>;
  close?: () => Promise<void>;
};

export type TokenUsageStoreOptions = {
  dataFile: string;
  maxEvents: number;
  databaseUrl?: string;
  postgresSchema?: string;
  postgresSsl?: boolean | PoolConfig["ssl"];
};

export type TokenUsageJsonImportResult = TokenUsageStoreInsertResult & {
  filePath: string;
  imported: number;
  errors: string[];
};

const POSTGRES_TABLE = "usage_events";
const POSTGRES_USER_CONFIGS_TABLE = "user_configs";
const INSERT_BATCH_SIZE = 400;

export async function createTokenUsageStore(options: TokenUsageStoreOptions): Promise<TokenUsageStore> {
  const databaseUrl = options.databaseUrl?.trim();

  if (databaseUrl) {
    const store = createPostgresTokenUsageStore({
      connectionString: databaseUrl,
      maxEvents: options.maxEvents,
      schema: options.postgresSchema || "token_board",
      ssl: options.postgresSsl,
    });
    await store.initialize();
    return store;
  }

  return createFileTokenUsageStore({
    dataFile: options.dataFile,
    maxEvents: options.maxEvents,
  });
}

export async function importTokenUsageEventsFromJsonFile(
  store: TokenUsageStore,
  filePath: string
): Promise<TokenUsageJsonImportResult> {
  const parsed = await readTokenUsageEventsFromFile(filePath);
  const result = await store.insertEvents(parsed.entries);

  return {
    ...result,
    filePath,
    imported: parsed.entries.length,
    errors: parsed.errors,
  };
}

export async function readTokenUsageEventsFromFile(filePath: string) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = parseTokenUsageImport(text);

    if (!parsed.entries.length && parsed.errors.length && !isEmptyTokenEventStore(text)) {
      throw new Error(`Token usage data file is unreadable: ${parsed.errors[0]}`);
    }

    return parsed;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { entries: [], errors: [] };
    }

    throw error;
  }
}

function createFileTokenUsageStore({
  dataFile,
  maxEvents,
}: {
  dataFile: string;
  maxEvents: number;
}): TokenUsageStore {
  let storageQueue: Promise<unknown> = Promise.resolve();
  const userConfigsFile = path.join(path.dirname(dataFile), "user-configs.json");
  const enqueueStorageOperation = <T>(operation: () => Promise<T>) => {
    const run = storageQueue.then(operation, operation);
    storageQueue = run.catch(() => undefined);
    return run;
  };

  return {
    kind: "file",
    label: dataFile,
    listEvents: () => readTokenUsageEventsFromFile(dataFile).then((result) => result.entries),
    countEvents: async () => (await readTokenUsageEventsFromFile(dataFile)).entries.length,
    insertEvents: (events) =>
      enqueueStorageOperation(async () => {
        const existing = (await readTokenUsageEventsFromFile(dataFile)).entries;
        const existingIds = new Set(existing.map((event) => event.id));
        const incomingNew = events.filter((event) => !existingIds.has(event.id));
        const merged = mergeTokenEvents(existing, events, maxEvents);

        if (incomingNew.length) {
          await writeTokenUsageEventsToFile(dataFile, merged);
        }

        return {
          accepted: incomingNew.length,
          duplicates: events.length - incomingNew.length,
          records: merged.length,
        };
      }),
    deleteEventsForUser: (userId) =>
      enqueueStorageOperation(async () => {
        const existing = (await readTokenUsageEventsFromFile(dataFile)).entries;
        const kept = existing.filter((event) => event.userId !== userId);
        const deleted = existing.length - kept.length;

        if (deleted) {
          await writeTokenUsageEventsToFile(dataFile, kept);
        }

        return {
          deleted,
          records: kept.length,
        };
      }),
    getUserConfig: (userId) => readTokenUserConfigsFromFile(userConfigsFile).then((configs) => configs[userId] ?? null),
    upsertUserConfig: (userId, config) =>
      enqueueStorageOperation(async () => {
        const configs = await readTokenUserConfigsFromFile(userConfigsFile);
        configs[userId] = config;
        await writeTokenUserConfigsToFile(userConfigsFile, configs);
        return config;
      }),
  };
}

function createPostgresTokenUsageStore({
  connectionString,
  maxEvents,
  schema,
  ssl,
}: {
  connectionString: string;
  maxEvents: number;
  schema: string;
  ssl?: PoolConfig["ssl"];
}) {
  const pool = new Pool({ connectionString, ssl });
  const safeSchema = sqlIdentifier(schema);
  const table = `${safeSchema}.${sqlIdentifier(POSTGRES_TABLE)}`;
  const userConfigsTable = `${safeSchema}.${sqlIdentifier(POSTGRES_USER_CONFIGS_TABLE)}`;

  return {
    kind: "postgres" as const,
    label: `${schema}.${POSTGRES_TABLE}`,
    initialize: async () => {
      await pool.query(`CREATE SCHEMA IF NOT EXISTS ${safeSchema}`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          team TEXT,
          source TEXT NOT NULL,
          model TEXT NOT NULL,
          project TEXT,
          tool TEXT,
          reported_at TIMESTAMPTZ NOT NULL,
          input_tokens BIGINT NOT NULL DEFAULT 0,
          cached_input_tokens BIGINT NOT NULL DEFAULT 0,
          output_tokens BIGINT NOT NULL DEFAULT 0,
          reasoning_output_tokens BIGINT NOT NULL DEFAULT 0,
          total_tokens BIGINT NOT NULL DEFAULT 0,
          cost_usd DOUBLE PRECISION,
          messages INTEGER NOT NULL DEFAULT 0,
          session_id TEXT,
          session_title TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS session_title TEXT`);
      await pool.query(`CREATE INDEX IF NOT EXISTS usage_events_reported_at_idx ON ${table} (reported_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS usage_events_user_reported_at_idx ON ${table} (user_id, reported_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS usage_events_model_idx ON ${table} (model)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS usage_events_tool_idx ON ${table} (tool)`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${userConfigsTable} (
          user_id TEXT PRIMARY KEY,
          config JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
    },
    listEvents: async () => {
      const result = await pool.query<TokenUsageEventRow>(
        `
          SELECT *
          FROM ${table}
          ORDER BY reported_at DESC, created_at DESC
          LIMIT $1
        `,
        [maxEvents]
      );

      return result.rows.flatMap((row) => rowToTokenUsageEvent(row) ?? []);
    },
    countEvents: async () => {
      const result = await pool.query<{ count: string }>(`SELECT count(*) AS count FROM ${table}`);
      return Number(result.rows[0]?.count || 0);
    },
    insertEvents: async (events: TokenUsageEvent[]) => {
      if (!events.length) {
        return {
          accepted: 0,
          duplicates: 0,
          records: await countPostgresRows(pool, table),
        };
      }

      let accepted = 0;

      for (let index = 0; index < events.length; index += INSERT_BATCH_SIZE) {
        const batch = events.slice(index, index + INSERT_BATCH_SIZE).map(normalizeTokenUsageEvent);
        const { text, values } = buildInsertQuery(table, batch);
        const result = await pool.query(text, values);
        accepted += result.rowCount || 0;
      }

      return {
        accepted,
        duplicates: events.length - accepted,
        records: await countPostgresRows(pool, table),
      };
    },
    deleteEventsForUser: async (userId: string) => {
      const result = await pool.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);

      return {
        deleted: result.rowCount || 0,
        records: await countPostgresRows(pool, table),
      };
    },
    getUserConfig: async (userId: string) => {
      const result = await pool.query<{ config: TokenBoardUserConfig; updated_at: Date | string }>(
        `SELECT config, updated_at FROM ${userConfigsTable} WHERE user_id = $1`,
        [userId]
      );
      const row = result.rows[0];

      if (!row?.config) {
        return null;
      }

      return {
        ...row.config,
        updatedAt: new Date(row.updated_at || row.config.updatedAt).toISOString(),
      };
    },
    upsertUserConfig: async (userId: string, config: TokenBoardUserConfig) => {
      await pool.query(
        `
          INSERT INTO ${userConfigsTable} (user_id, config, updated_at)
          VALUES ($1, $2::jsonb, $3)
          ON CONFLICT (user_id) DO UPDATE
          SET config = EXCLUDED.config,
              updated_at = EXCLUDED.updated_at
        `,
        [userId, JSON.stringify(config), config.updatedAt]
      );

      return config;
    },
    close: () => pool.end(),
  } satisfies TokenUsageStore & { initialize: () => Promise<void> };
}

async function readTokenUserConfigsFromFile(filePath: string): Promise<Record<string, TokenBoardUserConfig>> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const users = (parsed as { users?: unknown }).users;
      if (users && typeof users === "object" && !Array.isArray(users)) {
        return users as Record<string, TokenBoardUserConfig>;
      }
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }

  return {};
}

async function writeTokenUserConfigsToFile(filePath: string, configs: Record<string, TokenBoardUserConfig>) {
  const dir = path.dirname(filePath);
  const tempFile = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );

  await fs.mkdir(dir, { recursive: true });

  try {
    await fs.writeFile(
      tempFile,
      `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), users: configs }, null, 2)}\n`
    );
    await fs.rename(tempFile, filePath);
  } catch (error) {
    await fs.rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeTokenUsageEventsToFile(filePath: string, events: TokenUsageEvent[]) {
  const dir = path.dirname(filePath);
  const tempFile = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );

  await fs.mkdir(dir, { recursive: true });

  try {
    await fs.writeFile(
      tempFile,
      `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), entries: events }, null, 2)}\n`
    );
    await fs.rename(tempFile, filePath);
  } catch (error) {
    await fs.rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

function buildInsertQuery(table: string, events: TokenUsageEvent[]) {
  const columns = [
    "id",
    "user_id",
    "display_name",
    "team",
    "source",
    "model",
    "project",
    "tool",
    "reported_at",
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
    "cost_usd",
    "messages",
    "session_id",
    "session_title",
  ];
  const values: Array<string | number | null> = [];
  const rows = events.map((event, eventIndex) => {
    const base = eventIndex * columns.length;
    values.push(
      event.id,
      event.userId,
      event.displayName,
      event.team || null,
      event.source,
      event.model,
      event.project || null,
      event.tool || null,
      event.timestamp,
      event.inputTokens,
      event.cachedInputTokens,
      event.outputTokens,
      event.reasoningOutputTokens,
      event.totalTokens,
      event.costUsd ?? null,
      event.messages ?? 0,
      event.sessionId || null,
      event.sessionTitle || null
    );

    return `(${columns.map((_, columnIndex) => `$${base + columnIndex + 1}`).join(", ")})`;
  });

  return {
    text: `
      INSERT INTO ${table} (${columns.map(sqlIdentifier).join(", ")})
      VALUES ${rows.join(", ")}
      ON CONFLICT (id) DO UPDATE
      SET "session_title" = COALESCE(NULLIF(EXCLUDED."session_title", ''), ${table}."session_title")
      WHERE NULLIF(EXCLUDED."session_title", '') IS NOT NULL
        AND COALESCE(${table}."session_title", '') <> EXCLUDED."session_title"
    `,
    values,
  };
}

async function countPostgresRows(pool: Pool, table: string) {
  const result = await pool.query<{ count: string }>(`SELECT count(*) AS count FROM ${table}`);
  return Number(result.rows[0]?.count || 0);
}

function rowToTokenUsageEvent(row: TokenUsageEventRow): TokenUsageEvent | undefined {
  const inputTokens = toNumber(row.input_tokens);
  const outputTokens = toNumber(row.output_tokens);

  if (inputTokens + outputTokens <= 0) {
    return undefined;
  }

  return normalizeTokenUsageEvent({
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    team: row.team || undefined,
    source: row.source,
    model: row.model,
    project: row.project || undefined,
    tool: row.tool || undefined,
    timestamp: new Date(row.reported_at).toISOString(),
    inputTokens,
    cachedInputTokens: toNumber(row.cached_input_tokens),
    outputTokens,
    reasoningOutputTokens: toNumber(row.reasoning_output_tokens),
    totalTokens: toNumber(row.total_tokens),
    costUsd: row.cost_usd === null ? undefined : toNumber(row.cost_usd),
    messages: toNumber(row.messages),
    sessionId: row.session_id || undefined,
    sessionTitle: row.session_title || undefined,
  });
}

function sqlIdentifier(value: string) {
  const normalized = value.trim();

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  }

  return `"${normalized.replace(/"/g, '""')}"`;
}

function isEmptyTokenEventStore(text: string) {
  try {
    const parsed = JSON.parse(text) as unknown;
    return (
      (Array.isArray(parsed) && parsed.length === 0) ||
      Boolean(
        parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { entries?: unknown }).entries) &&
          !(parsed as { entries: unknown[] }).entries.length
      )
    );
  } catch {
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}

function toNumber(value: string | number | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

type TokenUsageEventRow = {
  id: string;
  user_id: string;
  display_name: string;
  team: string | null;
  source: string;
  model: string;
  project: string | null;
  tool: string | null;
  reported_at: Date | string;
  input_tokens: string | number;
  cached_input_tokens: string | number;
  output_tokens: string | number;
  reasoning_output_tokens: string | number;
  total_tokens: string | number;
  cost_usd: string | number | null;
  messages: string | number | null;
  session_id: string | null;
  session_title: string | null;
};
