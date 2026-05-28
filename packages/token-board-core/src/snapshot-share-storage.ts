import { promises as fs } from "node:fs";
import path from "node:path";

import { Pool, type PoolConfig } from "pg";

export type SnapshotShareRecord = {
  id: string;
  title: string;
  engine: string;
  engineLabel: string;
  sourceRef?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  redacted: boolean;
  turnCount: number;
  publisher?: {
    userId: string;
    displayName: string;
    team?: string;
  };
  snapshot: unknown;
};

export type SnapshotSharePublicRecord = Omit<SnapshotShareRecord, "publisher">;

export type SnapshotShareStoreKind = "file" | "postgres";

export type SnapshotShareStore = {
  kind: SnapshotShareStoreKind;
  label: string;
  putShare: (record: SnapshotShareRecord) => Promise<void>;
  getShare: (id: string) => Promise<SnapshotSharePublicRecord | undefined>;
  deleteShare: (id: string) => Promise<boolean>;
  countShares: () => Promise<number>;
  close?: () => Promise<void>;
};

export type SnapshotShareStoreOptions = {
  dataFile: string;
  databaseUrl?: string;
  postgresSchema?: string;
  postgresSsl?: boolean | PoolConfig["ssl"];
};

const POSTGRES_TABLE = "snapshot_shares";

export async function createSnapshotShareStore(
  options: SnapshotShareStoreOptions
): Promise<SnapshotShareStore> {
  const databaseUrl = options.databaseUrl?.trim();

  if (databaseUrl) {
    const store = createPostgresSnapshotShareStore({
      connectionString: databaseUrl,
      schema: options.postgresSchema || "token_board",
      ssl: options.postgresSsl,
    });
    await store.initialize();
    return store;
  }

  return createFileSnapshotShareStore({ dataFile: options.dataFile });
}

function createFileSnapshotShareStore({ dataFile }: { dataFile: string }): SnapshotShareStore {
  let storageQueue: Promise<unknown> = Promise.resolve();
  const enqueueStorageOperation = <T>(operation: () => Promise<T>) => {
    const run = storageQueue.then(operation, operation);
    storageQueue = run.catch(() => undefined);
    return run;
  };

  return {
    kind: "file",
    label: dataFile,
    putShare: (record) =>
      enqueueStorageOperation(async () => {
        const existing = await readSnapshotSharesFromFile(dataFile);
        const next = existing.filter((item) => item.id !== record.id).concat(record);
        await writeSnapshotSharesToFile(dataFile, next);
      }),
    getShare: async (id) => {
      const record = (await readSnapshotSharesFromFile(dataFile)).find((item) => item.id === id);
      return isShareExpired(record) ? undefined : toPublicRecord(record);
    },
    deleteShare: (id) =>
      enqueueStorageOperation(async () => {
        const existing = await readSnapshotSharesFromFile(dataFile);
        const next = existing.filter((item) => item.id !== id);
        if (next.length === existing.length) {
          return false;
        }
        await writeSnapshotSharesToFile(dataFile, next);
        return true;
      }),
    countShares: async () => (await readSnapshotSharesFromFile(dataFile)).filter((item) => !isShareExpired(item)).length,
  };
}

function createPostgresSnapshotShareStore({
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
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          engine TEXT NOT NULL,
          engine_label TEXT NOT NULL,
          source_ref TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          expires_at TIMESTAMPTZ,
          redacted BOOLEAN NOT NULL DEFAULT TRUE,
          turn_count INTEGER NOT NULL DEFAULT 0,
          publisher JSONB,
          payload JSONB NOT NULL
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS snapshot_shares_updated_at_idx ON ${table} (updated_at DESC)`);
    },
    putShare: async (record: SnapshotShareRecord) => {
      await pool.query(
        `
          INSERT INTO ${table} (
            id,
            title,
            engine,
            engine_label,
            source_ref,
            created_at,
            updated_at,
            expires_at,
            redacted,
            turn_count,
            publisher,
            payload
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            engine = EXCLUDED.engine,
            engine_label = EXCLUDED.engine_label,
            source_ref = EXCLUDED.source_ref,
            updated_at = EXCLUDED.updated_at,
            expires_at = EXCLUDED.expires_at,
            redacted = EXCLUDED.redacted,
            turn_count = EXCLUDED.turn_count,
            publisher = EXCLUDED.publisher,
            payload = EXCLUDED.payload
        `,
        [
          record.id,
          record.title,
          record.engine,
          record.engineLabel,
          record.sourceRef || null,
          record.createdAt,
          record.updatedAt,
          record.expiresAt || null,
          record.redacted,
          record.turnCount,
          record.publisher ? JSON.stringify(record.publisher) : null,
          JSON.stringify(record.snapshot),
        ]
      );
    },
    getShare: async (id: string) => {
      const result = await pool.query<SnapshotShareRow>(
        `
          SELECT *
          FROM ${table}
          WHERE id = $1
            AND (expires_at IS NULL OR expires_at > now())
          LIMIT 1
        `,
        [id]
      );
      return result.rows[0] ? rowToPublicShare(result.rows[0]) : undefined;
    },
    deleteShare: async (id: string) => {
      const result = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      return Boolean(result.rowCount);
    },
    countShares: async () => {
      const result = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM ${table} WHERE expires_at IS NULL OR expires_at > now()`
      );
      return Number(result.rows[0]?.count || 0);
    },
    close: () => pool.end(),
  } satisfies SnapshotShareStore & { initialize: () => Promise<void> };
}

async function readSnapshotSharesFromFile(filePath: string): Promise<SnapshotShareRecord[]> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)
        ? (parsed as { entries: unknown[] }).entries
        : [];

    return entries.flatMap((entry) => normalizeShareRecord(entry) ?? []);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeSnapshotSharesToFile(filePath: string, records: SnapshotShareRecord[]) {
  const dir = path.dirname(filePath);
  const tempFile = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );

  await fs.mkdir(dir, { recursive: true });

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

function rowToPublicShare(row: SnapshotShareRow): SnapshotSharePublicRecord {
  return {
    id: row.id,
    title: row.title,
    engine: row.engine,
    engineLabel: row.engine_label,
    sourceRef: row.source_ref || undefined,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    expiresAt: row.expires_at ? toIsoString(row.expires_at) : undefined,
    redacted: row.redacted,
    turnCount: Number(row.turn_count || 0),
    snapshot: row.payload,
  };
}

function normalizeShareRecord(value: unknown): SnapshotShareRecord | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Partial<SnapshotShareRecord>;
  const id = sanitizeText(record.id, 120);

  if (!id) {
    return undefined;
  }

  return {
    id,
    title: sanitizeText(record.title, 240) || id,
    engine: sanitizeText(record.engine, 80) || "codex",
    engineLabel: sanitizeText(record.engineLabel, 80) || "Codex",
    sourceRef: sanitizeText(record.sourceRef, 240) || undefined,
    createdAt: normalizeDateText(record.createdAt) || new Date().toISOString(),
    updatedAt: normalizeDateText(record.updatedAt) || new Date().toISOString(),
    expiresAt: normalizeDateText(record.expiresAt) || undefined,
    redacted: record.redacted !== false,
    turnCount: Number.isFinite(Number(record.turnCount)) ? Number(record.turnCount) : 0,
    publisher: normalizePublisher(record.publisher),
    snapshot: record.snapshot,
  };
}

function normalizePublisher(value: unknown): SnapshotShareRecord["publisher"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const publisher = value as SnapshotShareRecord["publisher"];
  const userId = sanitizeText(publisher?.userId, 120);
  const displayName = sanitizeText(publisher?.displayName, 120);

  if (!userId || !displayName) {
    return undefined;
  }

  return {
    userId,
    displayName,
    team: sanitizeText(publisher?.team, 120) || undefined,
  };
}

function toPublicRecord(record: SnapshotShareRecord | undefined): SnapshotSharePublicRecord | undefined {
  if (!record) {
    return undefined;
  }

  const { publisher: _publisher, ...publicRecord } = record;
  return publicRecord;
}

function isShareExpired(record: SnapshotShareRecord | undefined) {
  if (!record?.expiresAt) {
    return false;
  }

  return new Date(record.expiresAt).getTime() <= Date.now();
}

function normalizeDateText(value: unknown) {
  const date = typeof value === "string" ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function toIsoString(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}

type SnapshotShareRow = {
  id: string;
  title: string;
  engine: string;
  engine_label: string;
  source_ref: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  expires_at: Date | string | null;
  redacted: boolean;
  turn_count: number | string;
  payload: unknown;
};
