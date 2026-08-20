import { promises as fs } from "node:fs";
import path from "node:path";

import { Pool, type PoolClient, type PoolConfig } from "pg";

import { mergeTokenEvents } from "./token-board-automation";
import {
  buildEmptyTokenAchievementSummary,
  buildTokenAchievementSummariesByUser,
} from "./token-achievements";
import {
  buildTokenEfficiencySummary,
  emptyTokenEfficiencyProfile,
} from "./token-efficiency";
import {
  buildTokenLeaderboardTrends,
  buildTokenProjectLeaderboard,
  buildTokenTeamLeaderboard,
  buildTokenUsageDistribution,
  normalizeTokenUsageEvent,
  parseTokenUsageImport,
  resolveTokenLeaderboardWindow,
  type TokenBoardMetric,
  type TokenBoardRange,
  type TokenBoardUserConfig,
  type TokenDailyUsagePoint,
  type TokenLeaderboardSummary,
  type TokenLeaderboardUser,
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

export type TokenUsageStoreReplaceResult = TokenUsageStoreInsertResult & {
  deleted: number;
};

export type TokenUsageStoreBackupStatus = {
  enabled: boolean;
  retention: number;
  directory: string | null;
  retained: number;
  latestFile: string | null;
  latestBackupAt: string | null;
  lastBackupAt: string | null;
  lastBackupError: string | null;
  lastRecoveryAt: string | null;
  lastRecoverySource: "backup" | "empty" | null;
  lastRecoveryError: string | null;
};

export type TokenUsageStoreHealth = {
  kind: TokenUsageStoreKind;
  label: string;
  eventCount: number;
  lastWriteAt: string | null;
  backups: TokenUsageStoreBackupStatus;
};

export type TokenUsageLeaderboardOptions = {
  range: TokenBoardRange;
  metric: TokenBoardMetric;
  now?: Date;
};

export type TokenUsageLeaderboardResult = {
  records: number;
  summary: TokenLeaderboardSummary;
};

export type TokenUsageStore = {
  kind: TokenUsageStoreKind;
  label: string;
  listEvents: () => Promise<TokenUsageEvent[]>;
  listEventsForUser: (userId: string) => Promise<TokenUsageEvent[]>;
  getLeaderboardSummary?: (options: TokenUsageLeaderboardOptions) => Promise<TokenUsageLeaderboardResult>;
  countEvents: () => Promise<number>;
  insertEvents: (events: TokenUsageEvent[]) => Promise<TokenUsageStoreInsertResult>;
  replaceEventsForUser: (userId: string, events: TokenUsageEvent[]) => Promise<TokenUsageStoreReplaceResult>;
  deleteEventsForUser: (userId: string) => Promise<TokenUsageStoreDeleteResult>;
  getHealth?: () => Promise<TokenUsageStoreHealth>;
  getUserConfig: (userId: string) => Promise<TokenBoardUserConfig | null>;
  listUserConfigs: () => Promise<Array<{ userId: string; config: TokenBoardUserConfig }>>;
  upsertUserConfig: (userId: string, config: TokenBoardUserConfig) => Promise<TokenBoardUserConfig>;
  close?: () => Promise<void>;
};

export type TokenUsageStoreOptions = {
  dataFile: string;
  /** Optional file-store retention cap. Zero/undefined means no semantic truncation. */
  fileRetentionEvents?: number;
  /** @deprecated Use fileRetentionEvents. Kept for callers that explicitly want file retention. */
  maxEvents?: number;
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
const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const FILE_BACKUP_RETENTION = 3;

export async function createTokenUsageStore(options: TokenUsageStoreOptions): Promise<TokenUsageStore> {
  const databaseUrl = options.databaseUrl?.trim();

  if (databaseUrl) {
    const store = createPostgresTokenUsageStore({
      connectionString: databaseUrl,
      schema: options.postgresSchema || "token_board",
      ssl: options.postgresSsl,
    });
    await store.initialize();
    return store;
  }

  return createFileTokenUsageStore({
    dataFile: options.dataFile,
    retentionEvents: options.fileRetentionEvents ?? options.maxEvents ?? 0,
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

async function createFileTokenUsageStore({
  dataFile,
  retentionEvents,
}: {
  dataFile: string;
  retentionEvents: number;
}): Promise<TokenUsageStore> {
  let storageQueue: Promise<unknown> = Promise.resolve();
  const userConfigsFile = path.join(path.dirname(dataFile), "user-configs.json");
  const fileState = createFileStoreState(dataFile);
  const enqueueStorageOperation = <T>(operation: () => Promise<T>) => {
    const run = storageQueue.then(operation, operation);
    storageQueue = run.catch(() => undefined);
    return run;
  };

  await recoverTokenUsageFileIfNeeded(dataFile, fileState);
  await refreshFileWriteTime(dataFile, fileState);

  return {
    kind: "file",
    label: dataFile,
    listEvents: () => readTokenUsageEventsFromFile(dataFile).then((result) => result.entries),
    listEventsForUser: (userId) =>
      readTokenUsageEventsFromFile(dataFile).then((result) => result.entries.filter((event) => event.userId === userId)),
    countEvents: async () => (await readTokenUsageEventsFromFile(dataFile)).entries.length,
    insertEvents: (events) =>
      enqueueStorageOperation(async () => {
        const existing = (await readTokenUsageEventsFromFile(dataFile)).entries;
        const existingById = new Map(existing.map((event) => [event.id, event]));
        const incomingNew = events.filter((event) => !existingById.has(event.id));
        // A re-ingested event can carry a session title we only discovered later;
        // treat that as a change to flush, so the update is not silently dropped
        // (mirrors the Postgres ON CONFLICT DO UPDATE of session_title).
        const hasMetadataUpdate = events.some((event) => {
          const prior = existingById.get(event.id);
          return Boolean(prior && hasTokenEventMetadataUpdate(prior, event));
        });
        const merged = mergeTokenEvents(existing, events, retentionEvents);

        if (incomingNew.length || hasMetadataUpdate) {
          await writeTokenUsageEventsToFile(dataFile, merged, fileState);
        }

        return {
          accepted: incomingNew.length,
          duplicates: events.length - incomingNew.length,
          records: merged.length,
        };
      }),
    replaceEventsForUser: (userId, events) =>
      enqueueStorageOperation(async () => {
        const existing = (await readTokenUsageEventsFromFile(dataFile)).entries;
        const kept = existing.filter((event) => event.userId !== userId);
        const deleted = existing.length - kept.length;
        const replacement = mergeTokenEvents([], events, 0);
        const merged = mergeTokenEvents(kept, replacement, retentionEvents);

        await writeTokenUsageEventsToFile(dataFile, merged, fileState);

        return {
          accepted: replacement.length,
          duplicates: events.length - replacement.length,
          deleted,
          records: merged.length,
        };
      }),
    deleteEventsForUser: (userId) =>
      enqueueStorageOperation(async () => {
        const existing = (await readTokenUsageEventsFromFile(dataFile)).entries;
        const kept = existing.filter((event) => event.userId !== userId);
        const deleted = existing.length - kept.length;

        if (deleted) {
          await writeTokenUsageEventsToFile(dataFile, kept, fileState);
        }

        return {
          deleted,
          records: kept.length,
        };
      }),
    getHealth: () =>
      enqueueStorageOperation(async () => {
        const events = (await readTokenUsageEventsFromFile(dataFile)).entries;

        return {
          kind: "file",
          label: dataFile,
          eventCount: events.length,
          lastWriteAt: fileState.lastWriteAt,
          backups: await buildFileBackupStatus(fileState),
        };
      }),
    getUserConfig: (userId) => readTokenUserConfigsFromFile(userConfigsFile).then((configs) => configs[userId] ?? null),
    listUserConfigs: () =>
      readTokenUserConfigsFromFile(userConfigsFile).then((configs) =>
        Object.entries(configs).map(([userId, config]) => ({ userId, config }))
      ),
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
  const userConfigsTable = `${safeSchema}.${sqlIdentifier(POSTGRES_USER_CONFIGS_TABLE)}`;
  const backupStatus: TokenUsageStoreBackupStatus = {
    enabled: false,
    retention: 0,
    directory: null,
    retained: 0,
    latestFile: null,
    latestBackupAt: null,
    lastBackupAt: null,
    lastBackupError: null,
    lastRecoveryAt: null,
    lastRecoverySource: null,
    lastRecoveryError: null,
  };

  return {
    kind: "postgres" as const,
    label: `${schema}.${POSTGRES_TABLE}`,
    initialize: async () => {
      await pool.query(`CREATE SCHEMA IF NOT EXISTS ${safeSchema}`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id TEXT PRIMARY KEY,
          upstream_event_id TEXT,
          user_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          team TEXT,
          source TEXT NOT NULL,
          model TEXT NOT NULL,
          project TEXT,
          tool TEXT,
          reported_at TIMESTAMPTZ NOT NULL,
          input_tokens BIGINT NOT NULL DEFAULT 0,
          cache_creation_input_tokens BIGINT NOT NULL DEFAULT 0,
          cached_input_tokens BIGINT NOT NULL DEFAULT 0,
          output_tokens BIGINT NOT NULL DEFAULT 0,
          reasoning_output_tokens BIGINT NOT NULL DEFAULT 0,
          total_tokens BIGINT NOT NULL DEFAULT 0,
          cost_usd DOUBLE PRECISION,
          messages INTEGER NOT NULL DEFAULT 0,
          session_id TEXT,
          session_title TEXT,
          error_count BIGINT,
          interrupted_count BIGINT,
          tool_call_count BIGINT,
          lines_written BIGINT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS session_title TEXT`);
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS upstream_event_id TEXT`);
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS cache_creation_input_tokens BIGINT NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS error_count BIGINT`);
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS interrupted_count BIGINT`);
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tool_call_count BIGINT`);
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS lines_written BIGINT`);
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
        `
      );

      return result.rows.flatMap((row) => rowToTokenUsageEvent(row) ?? []);
    },
    listEventsForUser: async (userId: string) => {
      const result = await pool.query<TokenUsageEventRow>(
        `
          SELECT *
          FROM ${table}
          WHERE user_id = $1
          ORDER BY reported_at DESC, created_at DESC
        `,
        [userId]
      );

      return result.rows.flatMap((row) => rowToTokenUsageEvent(row) ?? []);
    },
    getLeaderboardSummary: (options) => readPostgresLeaderboardSummary(pool, table, options),
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
        // RETURNING (xmax = 0) marks freshly-inserted rows; an ON CONFLICT title
        // update has xmax != 0, so it is not miscounted as a new acceptance.
        const result = await pool.query<{ inserted: boolean }>(text, values);
        accepted += result.rows.filter((row) => row.inserted).length;
      }

      return {
        accepted,
        duplicates: events.length - accepted,
        records: await countPostgresRows(pool, table),
      };
    },
    replaceEventsForUser: async (userId: string, events: TokenUsageEvent[]) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const deletedResult = await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
        const replacement = mergeTokenEvents([], events, 0);
        await insertPostgresEvents(client, table, replacement);
        await client.query("COMMIT");

        return {
          accepted: replacement.length,
          duplicates: events.length - replacement.length,
          deleted: deletedResult.rowCount || 0,
          records: await countPostgresRows(pool, table),
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    deleteEventsForUser: async (userId: string) => {
      const result = await pool.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);

      return {
        deleted: result.rowCount || 0,
        records: await countPostgresRows(pool, table),
      };
    },
    getHealth: async () => {
      const [countResult, writeResult] = await Promise.all([
        pool.query<{ count: string }>(`SELECT count(*) AS count FROM ${table}`),
        pool.query<{ last_write_at: Date | string | null }>(`SELECT max(created_at) AS last_write_at FROM ${table}`),
      ]);

      return {
        kind: "postgres" as const,
        label: `${schema}.${POSTGRES_TABLE}`,
        eventCount: Number(countResult.rows[0]?.count || 0),
        lastWriteAt: writeResult.rows[0]?.last_write_at ? toIsoString(writeResult.rows[0].last_write_at) : null,
        backups: backupStatus,
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
    listUserConfigs: async () => {
      const result = await pool.query<{ user_id: string; config: TokenBoardUserConfig; updated_at: Date | string }>(
        `
          SELECT user_id, config, updated_at
          FROM ${userConfigsTable}
          ORDER BY updated_at DESC
        `
      );

      return result.rows.flatMap((row) => {
        if (!row.config) {
          return [];
        }

        return [
          {
            userId: row.user_id,
            config: {
              ...row.config,
              updatedAt: new Date(row.updated_at || row.config.updatedAt).toISOString(),
            },
          },
        ];
      });
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

function hasTokenEventMetadataUpdate(prior: TokenUsageEvent, next: TokenUsageEvent) {
  return (
    next.timestamp !== prior.timestamp ||
    next.displayName !== prior.displayName ||
    next.team !== prior.team ||
    next.model !== prior.model ||
    next.project !== prior.project ||
    next.tool !== prior.tool ||
    next.inputTokens !== prior.inputTokens ||
    next.cacheCreationInputTokens !== prior.cacheCreationInputTokens ||
    next.cachedInputTokens !== prior.cachedInputTokens ||
    next.outputTokens !== prior.outputTokens ||
    next.reasoningOutputTokens !== prior.reasoningOutputTokens ||
    next.totalTokens !== prior.totalTokens ||
    next.costUsd !== prior.costUsd ||
    next.messages !== prior.messages ||
    next.sessionId !== prior.sessionId ||
    Boolean(next.sessionTitle && next.sessionTitle !== prior.sessionTitle) ||
    Boolean(next.upstreamEventId && next.upstreamEventId !== prior.upstreamEventId) ||
    hasQualityCountUpdate(prior.errorCount, next.errorCount) ||
    hasQualityCountUpdate(prior.interruptedCount, next.interruptedCount) ||
    hasQualityCountUpdate(prior.toolCallCount, next.toolCallCount) ||
    hasQualityCountUpdate(prior.linesWritten, next.linesWritten)
  );
}

function hasQualityCountUpdate(prior: number | null | undefined, next: number | null | undefined) {
  return next !== undefined && next !== null && prior !== next;
}

type PostgresLeaderboardUserRow = {
  user_id: string;
  display_name: string;
  team: string | null;
  input_tokens: string | number;
  cache_creation_input_tokens: string | number;
  cached_input_tokens: string | number;
  output_tokens: string | number;
  reasoning_output_tokens: string | number;
  tokens: string | number;
  cost_usd: string | number;
  messages: string | number;
  records: string | number;
  sessions: string | number;
  active_days: string | number;
  lines_written: string | number | null;
  last_reported_at: Date | string | null;
  previous_tokens: string | number | null;
  top_model: string | null;
  top_tool: string | null;
};

type PostgresDailyUsageRow = {
  user_id?: string;
  date: string;
  tokens: string | number;
};

type PostgresNamedUsageRow = {
  name: string;
  tokens: string | number;
  cost_usd?: string | number;
  sessions?: string | number;
};

type PostgresPreviousRankRow = {
  active_days: string | number;
  user_id: string;
  display_name: string | null;
  tokens: string | number;
  cost_usd: string | number;
  messages: string | number;
  sessions: string | number;
  lines_written: string | number | null;
};

async function readPostgresLeaderboardSummary(
  pool: Pool,
  table: string,
  { range, metric, now = new Date() }: TokenUsageLeaderboardOptions
): Promise<TokenUsageLeaderboardResult> {
  const end = Number.isFinite(now.getTime()) ? now : new Date();
  const rangeWindow = resolveTokenLeaderboardWindow(range, end);
  const { start, previousStart, previousEnd } = rangeWindow;
  const rangeParams = [start, rangeWindow.end];
  const userResult = await pool.query<PostgresLeaderboardUserRow>(
    `
      WITH current_events AS (
        SELECT *
        FROM ${table}
        WHERE reported_at >= $1
          AND reported_at <= $2
      ),
      previous_by_user AS (
        SELECT
          user_id,
          SUM(total_tokens)::double precision AS previous_tokens
        FROM ${table}
        WHERE reported_at >= $3
          AND reported_at <= $4
        GROUP BY user_id
      ),
      user_totals AS (
        SELECT
          user_id,
          SUM(input_tokens)::double precision AS input_tokens,
          SUM(cache_creation_input_tokens)::double precision AS cache_creation_input_tokens,
          SUM(cached_input_tokens)::double precision AS cached_input_tokens,
          SUM(output_tokens)::double precision AS output_tokens,
          SUM(reasoning_output_tokens)::double precision AS reasoning_output_tokens,
          SUM(total_tokens)::double precision AS tokens,
          COALESCE(SUM(cost_usd), 0)::double precision AS cost_usd,
          SUM(messages)::double precision AS messages,
          COUNT(*)::integer AS records,
          COUNT(DISTINCT COALESCE(NULLIF(session_id, ''), id))::integer AS sessions,
          COUNT(DISTINCT (reported_at AT TIME ZONE 'Asia/Shanghai')::date)::integer AS active_days,
          CASE
            WHEN COUNT(lines_written) > 0 THEN SUM(lines_written)::double precision
            ELSE NULL
          END AS lines_written,
          MAX(reported_at) AS last_reported_at
        FROM current_events
        GROUP BY user_id
      ),
      latest_user AS (
        SELECT DISTINCT ON (user_id)
          user_id,
          display_name,
          team
        FROM current_events
        ORDER BY user_id, reported_at DESC, created_at DESC
      ),
      top_model AS (
        SELECT user_id, model AS top_model
        FROM (
          SELECT
            user_id,
            model,
            ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY tokens DESC, model ASC) AS rn
          FROM (
            SELECT user_id, model, SUM(total_tokens)::double precision AS tokens
            FROM current_events
            GROUP BY user_id, model
          ) model_totals
        ) ranked_models
        WHERE rn = 1
      ),
      top_tool AS (
        SELECT user_id, tool_name AS top_tool
        FROM (
          SELECT
            user_id,
            tool_name,
            ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY tokens DESC, tool_name ASC) AS rn
          FROM (
            SELECT
              user_id,
              COALESCE(NULLIF(tool, ''), NULLIF(source, ''), 'unknown') AS tool_name,
              SUM(total_tokens)::double precision AS tokens
            FROM current_events
            GROUP BY user_id, tool_name
          ) tool_totals
        ) ranked_tools
        WHERE rn = 1
      )
      SELECT
        user_totals.user_id,
        COALESCE(NULLIF(latest_user.display_name, ''), user_totals.user_id) AS display_name,
        COALESCE(NULLIF(latest_user.team, ''), 'Friends') AS team,
        user_totals.input_tokens,
        user_totals.cache_creation_input_tokens,
        user_totals.cached_input_tokens,
        user_totals.output_tokens,
        user_totals.reasoning_output_tokens,
        user_totals.tokens,
        user_totals.cost_usd,
        user_totals.messages,
        user_totals.records,
        user_totals.sessions,
        user_totals.active_days,
        user_totals.lines_written,
        user_totals.last_reported_at,
        COALESCE(previous_by_user.previous_tokens, 0)::double precision AS previous_tokens,
        COALESCE(top_model.top_model, 'unknown') AS top_model,
        COALESCE(top_tool.top_tool, 'unknown') AS top_tool
      FROM user_totals
      LEFT JOIN latest_user ON latest_user.user_id = user_totals.user_id
      LEFT JOIN previous_by_user ON previous_by_user.user_id = user_totals.user_id
      LEFT JOIN top_model ON top_model.user_id = user_totals.user_id
      LEFT JOIN top_tool ON top_tool.user_id = user_totals.user_id
    `,
    [start, rangeWindow.end, previousStart, previousEnd]
  );

  const dailyResult = await pool.query<PostgresDailyUsageRow>(
    `
      SELECT
        to_char((reported_at AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD') AS date,
        SUM(total_tokens)::double precision AS tokens
      FROM ${table}
      WHERE reported_at >= $1
        AND reported_at <= $2
      GROUP BY date
      ORDER BY date
    `,
    rangeParams
  );
  const dailyByUserResult = await pool.query<PostgresDailyUsageRow>(
    `
      SELECT
        user_id,
        to_char((reported_at AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD') AS date,
        SUM(total_tokens)::double precision AS tokens
      FROM ${table}
      WHERE reported_at >= $1
        AND reported_at <= $2
      GROUP BY user_id, date
      ORDER BY user_id, date
    `,
    rangeParams
  );
  const modelResult = await pool.query<PostgresNamedUsageRow>(
    `
      SELECT
        model AS name,
        SUM(total_tokens)::double precision AS tokens,
        COALESCE(SUM(cost_usd), 0)::double precision AS cost_usd
      FROM ${table}
      WHERE reported_at >= $1
        AND reported_at <= $2
      GROUP BY model
      ORDER BY tokens DESC, name ASC
      LIMIT 12
    `,
    rangeParams
  );
  const toolResult = await pool.query<PostgresNamedUsageRow>(
    `
      SELECT
        COALESCE(NULLIF(tool, ''), NULLIF(source, ''), 'unknown') AS name,
        SUM(total_tokens)::double precision AS tokens,
        COUNT(DISTINCT COALESCE(NULLIF(session_id, ''), id))::integer AS sessions
      FROM ${table}
      WHERE reported_at >= $1
        AND reported_at <= $2
      GROUP BY name
      ORDER BY tokens DESC, name ASC
      LIMIT 12
    `,
    rangeParams
  );
  const previousRankResult = await pool.query<PostgresPreviousRankRow>(
    `
      SELECT
        user_id,
        MAX(display_name) AS display_name,
        SUM(total_tokens)::double precision AS tokens,
        COALESCE(SUM(cost_usd), 0)::double precision AS cost_usd,
        SUM(messages)::double precision AS messages,
        COUNT(DISTINCT COALESCE(NULLIF(session_id, ''), id))::integer AS sessions,
        COUNT(DISTINCT (reported_at AT TIME ZONE 'Asia/Shanghai')::date)::integer AS active_days,
        CASE
          WHEN COUNT(lines_written) > 0 THEN SUM(lines_written)::double precision
          ELSE NULL
        END AS lines_written
      FROM ${table}
      WHERE reported_at >= $1
        AND reported_at <= $2
      GROUP BY user_id
    `,
    [previousStart, previousEnd]
  );
  const emptyDailySeries = buildEmptyDailySeries(start, end);
  const dailyByUserValues = new Map<string, Map<string, number>>();

  for (const row of dailyByUserResult.rows) {
    if (!row.user_id) {
      continue;
    }

    const values = dailyByUserValues.get(row.user_id) ?? new Map<string, number>();
    values.set(row.date, toFiniteNumber(row.tokens));
    dailyByUserValues.set(row.user_id, values);
  }

  const userIds = userResult.rows.map((row) => row.user_id).filter(Boolean);
  const achievementEvents = await readPostgresEventsForUsers(pool, table, userIds);
  const currentEvents = await readPostgresEventsInRange(pool, table, start, rangeWindow.end);
  const efficiencySummary = buildTokenEfficiencySummary(currentEvents);
  const achievementsByUser = buildTokenAchievementSummariesByUser(achievementEvents, { now: end });
  const previousRankByUser = rankPostgresPreviousUsers(previousRankResult.rows, metric);
  const users = applyLeaderboardRankDelta(rankLeaderboardUsers(
    userResult.rows.map((row) => {
      const tokens = toFiniteNumber(row.tokens);
      const previousTokens = toFiniteNumber(row.previous_tokens);
      const achievements = achievementsByUser.get(row.user_id) ?? buildEmptyTokenAchievementSummary(end);

      return {
        rank: 0,
        previousRank: previousRankByUser.get(row.user_id) ?? null,
        rankDelta: null,
        userId: row.user_id,
        displayName: row.display_name || row.user_id,
        team: row.team || "Friends",
        level: achievements.level,
        badges: achievements.badges,
        personalBests: achievements.personalBests,
        tokens,
        inputTokens: toFiniteNumber(row.input_tokens),
        cacheCreationInputTokens: toFiniteNumber(row.cache_creation_input_tokens),
        cachedInputTokens: toFiniteNumber(row.cached_input_tokens),
        outputTokens: toFiniteNumber(row.output_tokens),
        reasoningOutputTokens: toFiniteNumber(row.reasoning_output_tokens),
        costUsd: toFiniteNumber(row.cost_usd),
        sessions: toFiniteInteger(row.sessions),
        messages: toFiniteNumber(row.messages),
        records: toFiniteInteger(row.records),
        activeDays: toFiniteInteger(row.active_days),
        linesWritten: optionalRowNumber(row.lines_written) ?? null,
        efficiency: efficiencySummary.users.get(row.user_id) ?? emptyTokenEfficiencyProfile(efficiencySummary.team),
        lastReportedAt: row.last_reported_at ? toIsoString(row.last_reported_at) : undefined,
        topModel: row.top_model || "unknown",
        topTool: row.top_tool || "unknown",
        share: 0,
        deltaTokens: previousTokens > 0 ? (tokens - previousTokens) / previousTokens : null,
        daily: fillDailySeries(emptyDailySeries, dailyByUserValues.get(row.user_id)),
      };
    }),
    metric
  ));
  const totalTokens = users.reduce((sum, user) => sum + user.tokens, 0);
  const totalCostUsd = users.reduce((sum, user) => sum + user.costUsd, 0);
  const totalSessions = users.reduce((sum, user) => sum + user.sessions, 0);
  const totalMessages = users.reduce((sum, user) => sum + user.messages, 0);
  const lineValues = users.flatMap((user) => (user.linesWritten === null ? [] : [user.linesWritten]));
  const totalLinesWritten = lineValues.length ? lineValues.reduce((sum, value) => sum + value, 0) : null;
  const usersWithShare = users.map((user) => ({
    ...user,
    share: totalTokens > 0 ? user.tokens / totalTokens : 0,
  }));
  const models = modelResult.rows.map((row) => {
    const tokens = toFiniteNumber(row.tokens);

    return {
      name: row.name || "unknown",
      tokens,
      costUsd: toFiniteNumber(row.cost_usd),
      share: totalTokens > 0 ? tokens / totalTokens : 0,
    };
  });
  const tools = toolResult.rows.map((row) => {
    const tokens = toFiniteNumber(row.tokens);

    return {
      name: row.name || "unknown",
      tokens,
      sessions: toFiniteInteger(row.sessions),
      share: totalTokens > 0 ? tokens / totalTokens : 0,
    };
  });
  const dailyValues = new Map(dailyResult.rows.map((row) => [row.date, toFiniteNumber(row.tokens)]));
  const previousEvents = await readPostgresEventsInRange(pool, table, previousStart, previousEnd);
  const trends = buildTokenLeaderboardTrends(currentEvents, start, rangeWindow.end);
  const teams = buildTokenTeamLeaderboard(currentEvents, previousEvents);
  const projects = buildTokenProjectLeaderboard(currentEvents);
  const distribution = buildTokenUsageDistribution(currentEvents);

  return {
    records: usersWithShare.reduce((sum, user) => sum + user.records, 0),
    summary: {
      range: rangeWindow.range,
      startAt: start.toISOString(),
      endAt: rangeWindow.end.toISOString(),
      totalTokens,
      totalCostUsd,
      totalSessions,
      totalMessages,
      totalLinesWritten,
      activeUsers: usersWithShare.length,
      topModel: models[0]?.name ?? "unknown",
      topTool: tools[0]?.name ?? "unknown",
      daily: fillDailySeries(emptyDailySeries, dailyValues),
      trends,
      models,
      tools,
      teams,
      projects,
      distribution,
      efficiency: efficiencySummary.team,
      users: usersWithShare,
    },
  };
}

function rankLeaderboardUsers(users: TokenLeaderboardUser[], metric: TokenBoardMetric) {
  return users
    .sort((a, b) => leaderboardMetricValue(b, metric) - leaderboardMetricValue(a, metric) || a.displayName.localeCompare(b.displayName))
    .map((user, index) => ({ ...user, rank: index + 1 }));
}

function applyLeaderboardRankDelta(users: TokenLeaderboardUser[]) {
  return users.map((user) => ({
    ...user,
    rankDelta: user.previousRank === null ? null : user.previousRank - user.rank,
  }));
}

function rankPostgresPreviousUsers(rows: PostgresPreviousRankRow[], metric: TokenBoardMetric) {
  const rankableRows = metric === "lines" ? rows.filter((row) => row.lines_written !== null) : rows;
  return new Map(
    [...rankableRows]
      .sort((left, right) => {
        const diff = previousPostgresMetricValue(right, metric) - previousPostgresMetricValue(left, metric);
        return diff || (left.display_name || left.user_id).localeCompare(right.display_name || right.user_id);
      })
      .map((row, index) => [row.user_id, index + 1] as const)
  );
}

function previousPostgresMetricValue(row: PostgresPreviousRankRow, metric: TokenBoardMetric) {
  if (metric === "lines") {
    return row.lines_written === null ? -1 : toFiniteNumber(row.lines_written);
  }

  if (metric === "cost") {
    return toFiniteNumber(row.cost_usd);
  }

  if (metric === "sessions") {
    return toFiniteInteger(row.sessions);
  }

  if (metric === "messages") {
    return toFiniteNumber(row.messages);
  }

  if (metric === "users") {
    return toFiniteInteger(row.active_days);
  }

  return toFiniteNumber(row.tokens);
}

function leaderboardMetricValue(user: TokenLeaderboardUser, metric: TokenBoardMetric) {
  if (metric === "lines") {
    return user.linesWritten ?? -1;
  }

  if (metric === "cost") {
    return user.costUsd;
  }

  if (metric === "sessions") {
    return user.sessions;
  }

  if (metric === "messages") {
    return user.messages;
  }

  if (metric === "users") {
    return user.activeDays;
  }

  return user.tokens;
}

async function readPostgresEventsForUsers(pool: Pool, table: string, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)].filter(Boolean);

  if (!uniqueUserIds.length) {
    return [];
  }

  const result = await pool.query<TokenUsageEventRow>(
    `
      SELECT *
      FROM ${table}
      WHERE user_id = ANY($1::text[])
      ORDER BY user_id ASC, reported_at ASC, created_at ASC
    `,
    [uniqueUserIds]
  );

  return result.rows.flatMap((row) => rowToTokenUsageEvent(row) ?? []);
}

async function readPostgresEventsInRange(pool: Pool, table: string, start: Date, end: Date) {
  const result = await pool.query<TokenUsageEventRow>(
    `
      SELECT *
      FROM ${table}
      WHERE reported_at >= $1
        AND reported_at <= $2
      ORDER BY reported_at ASC, created_at ASC
    `,
    [start, end]
  );

  return result.rows.flatMap((row) => rowToTokenUsageEvent(row) ?? []);
}

function buildEmptyDailySeries(start: Date, end: Date): TokenDailyUsagePoint[] {
  const points: TokenDailyUsagePoint[] = [];
  const startDay = startOfShanghaiDay(start);
  const endDay = startOfShanghaiDay(end);

  for (let time = startDay.getTime(); time <= endDay.getTime(); time += DAY_MS) {
    const bucketStart = new Date(Math.max(time, start.getTime()));
    const bucketEnd = new Date(Math.min(time + DAY_MS - 1, end.getTime()));

    points.push({
      date: shanghaiDayKey(new Date(time)),
      startAt: bucketStart.toISOString(),
      endAt: bucketEnd.toISOString(),
      tokens: 0,
    });
  }

  return points;
}

function fillDailySeries(emptyDailySeries: TokenDailyUsagePoint[], values = new Map<string, number>()) {
  return emptyDailySeries.map((point) => ({
    ...point,
    tokens: values.get(point.date) ?? 0,
  }));
}

function startOfShanghaiDay(value: Date) {
  return shanghaiDayStartUtc(shanghaiDayKey(value));
}

function shanghaiDayKey(value: Date | string) {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const shifted = new Date((Number.isFinite(time) ? time : Date.now()) + SHANGHAI_OFFSET_MS);

  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function shanghaiDayStartUtc(dayKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);

  if (!match) {
    return new Date(0);
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - SHANGHAI_OFFSET_MS);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toIsoString(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function toFiniteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function toFiniteInteger(value: unknown) {
  return Math.trunc(toFiniteNumber(value));
}

type FileStoreState = {
  backupDir: string;
  backupPrefix: string;
  backupEnabled: boolean;
  backupRetention: number;
  lastWriteAt: string | null;
  lastBackupDayKey: string | null;
  lastBackupAt: string | null;
  lastBackupError: string | null;
  lastRecoveryAt: string | null;
  lastRecoverySource: "backup" | "empty" | null;
  lastRecoveryError: string | null;
};

type BackupFile = {
  filePath: string;
  mtimeMs: number;
  mtimeIso: string;
};

function createFileStoreState(dataFile: string): FileStoreState {
  const backupDir = process.env.TOKEN_BOARD_JSON_BACKUP_DIR?.trim() || path.dirname(dataFile);
  const backupEnabled =
    process.env.TOKEN_BOARD_JSON_BACKUP_ENABLED !== "false" &&
    process.env.TOKEN_BOARD_JSON_BACKUPS !== "false";

  return {
    backupDir,
    backupPrefix: `${path.basename(dataFile)}.backup-`,
    backupEnabled,
    backupRetention: FILE_BACKUP_RETENTION,
    lastWriteAt: null,
    lastBackupDayKey: null,
    lastBackupAt: null,
    lastBackupError: null,
    lastRecoveryAt: null,
    lastRecoverySource: null,
    lastRecoveryError: null,
  };
}

async function recoverTokenUsageFileIfNeeded(filePath: string, state: FileStoreState) {
  try {
    await readTokenUsageEventsFromFile(filePath);
    return;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Token usage data file is unreadable, attempting recovery: ${filePath}; ${message}`);

    const backup = await findLatestValidTokenUsageBackup(state);
    if (backup) {
      await writeTokenUsageEventsToFile(filePath, backup.entries, state, { backupBeforeWrite: false });
      state.lastRecoveryAt = new Date().toISOString();
      state.lastRecoverySource = "backup";
      state.lastRecoveryError = message;
      console.warn(`Token usage data file restored from backup: ${backup.filePath}`);
      return;
    }

    await writeTokenUsageEventsToFile(filePath, [], state, { backupBeforeWrite: false });
    state.lastRecoveryAt = new Date().toISOString();
    state.lastRecoverySource = "empty";
    state.lastRecoveryError = message;
    console.warn("Token usage data file recovered with an empty event store.");
  }
}

async function refreshFileWriteTime(filePath: string, state: FileStoreState) {
  try {
    const stat = await fs.stat(filePath);
    state.lastWriteAt = stat.mtime.toISOString();
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      state.lastBackupError = error instanceof Error ? error.message : String(error);
    }
  }
}

async function backupTokenUsageFileBeforeWrite(filePath: string, state: FileStoreState) {
  if (!state.backupEnabled) {
    return;
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  if (state.lastBackupDayKey === dayKey) {
    return;
  }

  try {
    await readTokenUsageEventsFromFile(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    state.lastBackupError = error instanceof Error ? error.message : String(error);
    console.warn(`Token usage backup skipped because the current file is unreadable: ${state.lastBackupError}`);
    return;
  }

  const backupFile = path.join(state.backupDir, `${state.backupPrefix}${dayKey}.json`);
  try {
    await fs.mkdir(state.backupDir, { recursive: true });
    if (!(await fileExists(backupFile))) {
      await fs.copyFile(filePath, backupFile);
    }
    state.lastBackupDayKey = dayKey;
    state.lastBackupAt = new Date().toISOString();
    state.lastBackupError = null;
    await rotateTokenUsageBackups(state);
  } catch (error) {
    state.lastBackupError = error instanceof Error ? error.message : String(error);
    console.warn(`Token usage backup failed: ${state.lastBackupError}`);
  }
}

async function rotateTokenUsageBackups(state: FileStoreState) {
  const backups = await listTokenUsageBackups(state);
  const stale = backups.slice(state.backupRetention);

  await Promise.all(stale.map((backup) => fs.rm(backup.filePath, { force: true }).catch(() => undefined)));
}

async function findLatestValidTokenUsageBackup(state: FileStoreState) {
  const backups = await listTokenUsageBackups(state);

  for (const backup of backups) {
    try {
      const parsed = await readTokenUsageEventsFromFile(backup.filePath);
      return { filePath: backup.filePath, entries: parsed.entries };
    } catch (error) {
      state.lastBackupError = error instanceof Error ? error.message : String(error);
    }
  }

  return null;
}

async function buildFileBackupStatus(state: FileStoreState): Promise<TokenUsageStoreBackupStatus> {
  const backups = await listTokenUsageBackups(state);
  const latest = backups[0] ?? null;

  return {
    enabled: state.backupEnabled,
    retention: state.backupRetention,
    directory: state.backupEnabled ? state.backupDir : null,
    retained: backups.length,
    latestFile: latest?.filePath ?? null,
    latestBackupAt: latest?.mtimeIso ?? null,
    lastBackupAt: state.lastBackupAt,
    lastBackupError: state.lastBackupError,
    lastRecoveryAt: state.lastRecoveryAt,
    lastRecoverySource: state.lastRecoverySource,
    lastRecoveryError: state.lastRecoveryError,
  };
}

async function listTokenUsageBackups(state: FileStoreState): Promise<BackupFile[]> {
  if (!state.backupEnabled) {
    return [];
  }

  let names: string[];
  try {
    names = await fs.readdir(state.backupDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const backups = await Promise.all(
    names
      .filter((name) => name.startsWith(state.backupPrefix) && name.endsWith(".json"))
      .map(async (name) => {
        const filePath = path.join(state.backupDir, name);
        const stat = await fs.stat(filePath);
        return {
          filePath,
          mtimeMs: stat.mtimeMs,
          mtimeIso: stat.mtime.toISOString(),
        };
      })
  );

  return backups.sort((left, right) => right.mtimeMs - left.mtimeMs || right.filePath.localeCompare(left.filePath));
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
  await writeJsonFileAtomic(filePath, { schemaVersion: 1, updatedAt: new Date().toISOString(), users: configs });
}

async function writeTokenUsageEventsToFile(
  filePath: string,
  events: TokenUsageEvent[],
  state?: FileStoreState,
  options: { backupBeforeWrite?: boolean } = {}
) {
  if (state && options.backupBeforeWrite !== false) {
    await backupTokenUsageFileBeforeWrite(filePath, state);
  }

  const writtenAt = new Date().toISOString();
  await writeJsonFileAtomic(filePath, { schemaVersion: 1, updatedAt: writtenAt, entries: events });

  if (state) {
    state.lastWriteAt = writtenAt;
  }
}

async function writeJsonFileAtomic(filePath: string, payload: unknown) {
  const dir = path.dirname(filePath);
  const tempFile = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );

  await fs.mkdir(dir, { recursive: true });

  try {
    const handle = await fs.open(tempFile, "w", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tempFile, filePath);
    await fsyncDirectory(dir);
  } catch (error) {
    await fs.rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function fsyncDirectory(dir: string) {
  try {
    const handle = await fs.open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is best-effort across filesystems/platforms.
  }
}

// Columns the ON CONFLICT path may rewrite, each paired with the expression that
// produces its new value. Both the SET list and the "did anything actually change?"
// guard are derived from this single list so the two can never drift apart — a guard
// that disagreed with the SET would either skip real corrections or defeat itself.
// `id`, `user_id` and `source` are intentionally absent: they are never updated, so
// comparing them would force a rewrite that changes nothing.
function conflictUpdates(table: string): Array<[column: string, value: string]> {
  const current = (column: string) => `${table}.${sqlIdentifier(column)}`;
  const incoming = (column: string) => `EXCLUDED.${sqlIdentifier(column)}`;
  const plain = (column: string): [string, string] => [column, incoming(column)];
  // Keep a previously-stored value when the incoming one is blank/absent.
  const keepIfBlank = (column: string): [string, string] => [
    column,
    `COALESCE(NULLIF(${incoming(column)}, ''), ${current(column)})`,
  ];
  const keepIfNull = (column: string): [string, string] => [
    column,
    `COALESCE(${incoming(column)}, ${current(column)})`,
  ];

  return [
    keepIfBlank("upstream_event_id"),
    plain("display_name"),
    plain("team"),
    plain("model"),
    plain("project"),
    plain("tool"),
    plain("reported_at"),
    plain("input_tokens"),
    plain("cache_creation_input_tokens"),
    plain("cached_input_tokens"),
    plain("output_tokens"),
    plain("reasoning_output_tokens"),
    plain("total_tokens"),
    plain("cost_usd"),
    plain("messages"),
    plain("session_id"),
    keepIfBlank("session_title"),
    keepIfNull("error_count"),
    keepIfNull("interrupted_count"),
    keepIfNull("tool_call_count"),
    keepIfNull("lines_written"),
  ];
}

function buildInsertQuery(table: string, events: TokenUsageEvent[]) {
  const columns = [
    "id",
    "upstream_event_id",
    "user_id",
    "display_name",
    "team",
    "source",
    "model",
    "project",
    "tool",
    "reported_at",
    "input_tokens",
    "cache_creation_input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
    "cost_usd",
    "messages",
    "session_id",
    "session_title",
    "error_count",
    "interrupted_count",
    "tool_call_count",
    "lines_written",
  ];
  const values: Array<string | number | null> = [];
  const rows = events.map((event, eventIndex) => {
    const base = eventIndex * columns.length;
    values.push(
      event.id,
      event.upstreamEventId || null,
      event.userId,
      event.displayName,
      event.team || null,
      event.source,
      event.model,
      event.project || null,
      event.tool || null,
      event.timestamp,
      event.inputTokens,
      event.cacheCreationInputTokens,
      event.cachedInputTokens,
      event.outputTokens,
      event.reasoningOutputTokens,
      event.totalTokens,
      event.costUsd ?? null,
      event.messages ?? 0,
      event.sessionId || null,
      event.sessionTitle || null,
      event.errorCount ?? null,
      event.interruptedCount ?? null,
      event.toolCallCount ?? null,
      event.linesWritten ?? null
    );

    return `(${columns.map((_, columnIndex) => `$${base + columnIndex + 1}`).join(", ")})`;
  });

  // The agent re-uploads its whole retention window every cycle, so the vast
  // majority of these rows are byte-identical to what is already stored. An
  // unguarded DO UPDATE would rewrite every one of them, and under MVCC each
  // rewrite means a new row version, four index updates, WAL, and later vacuum
  // work — for no change at all. The guard below keeps the self-healing property
  // (a genuinely corrected row still gets written) while skipping the no-ops.
  //
  // Rows skipped by the guard return nothing, so they never reach `accepted`,
  // and the caller derives `duplicates` by subtraction — which is exactly where
  // an unchanged row belongs.
  const updates = conflictUpdates(table);
  const setClause = updates.map(([column, value]) => `${sqlIdentifier(column)} = ${value}`).join(",\n          ");
  const storedRow = updates.map(([column]) => `${table}.${sqlIdentifier(column)}`).join(", ");
  const incomingRow = updates.map(([, value]) => value).join(", ");

  return {
    text: `
      INSERT INTO ${table} (${columns.map(sqlIdentifier).join(", ")})
      VALUES ${rows.join(", ")}
      ON CONFLICT (id) DO UPDATE
      SET ${setClause}
      WHERE (${storedRow}) IS DISTINCT FROM (${incomingRow})
      RETURNING (xmax = 0) AS inserted
    `,
    values,
  };
}

async function insertPostgresEvents(client: PoolClient, table: string, events: TokenUsageEvent[]) {
  for (let index = 0; index < events.length; index += INSERT_BATCH_SIZE) {
    const batch = events.slice(index, index + INSERT_BATCH_SIZE).map(normalizeTokenUsageEvent);
    const query = buildInsertQuery(table, batch);
    await client.query(query.text, query.values);
  }
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
    upstreamEventId: row.upstream_event_id || undefined,
    userId: row.user_id,
    displayName: row.display_name,
    team: row.team || undefined,
    source: row.source,
    model: row.model,
    project: row.project || undefined,
    tool: row.tool || undefined,
    timestamp: new Date(row.reported_at).toISOString(),
    inputTokens,
    cacheCreationInputTokens: toNumber(row.cache_creation_input_tokens),
    cachedInputTokens: toNumber(row.cached_input_tokens),
    outputTokens,
    reasoningOutputTokens: toNumber(row.reasoning_output_tokens),
    totalTokens: toNumber(row.total_tokens),
    costUsd: row.cost_usd === null ? undefined : toNumber(row.cost_usd),
    messages: toNumber(row.messages),
    sessionId: row.session_id || undefined,
    sessionTitle: row.session_title || undefined,
    errorCount: optionalRowNumber(row.error_count),
    interruptedCount: optionalRowNumber(row.interrupted_count),
    toolCallCount: optionalRowNumber(row.tool_call_count),
    linesWritten: optionalRowNumber(row.lines_written),
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

function optionalRowNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : undefined;
}

type TokenUsageEventRow = {
  id: string;
  upstream_event_id: string | null;
  user_id: string;
  display_name: string;
  team: string | null;
  source: string;
  model: string;
  project: string | null;
  tool: string | null;
  reported_at: Date | string;
  input_tokens: string | number;
  cache_creation_input_tokens: string | number;
  cached_input_tokens: string | number;
  output_tokens: string | number;
  reasoning_output_tokens: string | number;
  total_tokens: string | number;
  cost_usd: string | number | null;
  messages: string | number | null;
  session_id: string | null;
  session_title: string | null;
  error_count: string | number | null;
  interrupted_count: string | number | null;
  tool_call_count: string | number | null;
  lines_written: string | number | null;
};
