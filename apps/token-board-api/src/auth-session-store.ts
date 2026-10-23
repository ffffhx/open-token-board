import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

export type AuthSession = {
  id: string;
  kind: "web" | "agent";
  label: string;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
};
type UserState = { disabled?: boolean; revokedBefore?: number; sessions?: Record<string, AuthSession> };
type State = UserState & { consumedAt?: number; expiresAt?: number };
type Options = { dataFile: string; databaseUrl?: string; postgresSchema?: string; postgresSsl?: boolean };

export function authSessionId(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function createAuthSessionStore(options: Options) {
  const schema = options.postgresSchema || "token_board";
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error("Invalid auth schema");
  const table = `"${schema}".auth_state`;
  const pool = options.databaseUrl ? new Pool({ connectionString: options.databaseUrl, ssl: options.postgresSsl, max: 2 }) : undefined;
  if (pool) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value JSONB NOT NULL)`);
  }
  let queue: Promise<unknown> = Promise.resolve();
  async function readFile(): Promise<Record<string, State>> {
    try { return JSON.parse(await fs.readFile(options.dataFile, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  }
  async function read(key: string): Promise<State> {
    if (!pool) return (await readFile())[key] || {};
    const result = await pool.query<{ value: State }>(`SELECT value FROM ${table} WHERE key = $1`, [key]);
    return result.rows[0]?.value || {};
  }
  async function mutate<T>(key: string, update: (state: State) => T): Promise<T> {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`auth:${key}`]);
        const result = await client.query<{ value: State }>(`SELECT value FROM ${table} WHERE key = $1`, [key]);
        const state = result.rows[0]?.value || {};
        const value = update(state);
        await client.query(`INSERT INTO ${table} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, state]);
        await client.query("COMMIT");
        return value;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    const operation = queue.then(async () => {
      const contents = await readFile();
      const state = contents[key] ||= {};
      const value = update(state);
      const now = Date.now();
      for (const [entryKey, entry] of Object.entries(contents)) if (entryKey.startsWith("oauth:") && (entry.expiresAt || 0) < now) delete contents[entryKey];
      await fs.mkdir(path.dirname(options.dataFile), { recursive: true });
      const temporary = `${options.dataFile}.${randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, "wx", 0o600);
        try { await handle.writeFile(JSON.stringify(contents)); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temporary, options.dataFile);
      } finally { await fs.rm(temporary, { force: true }); }
      return value;
    });
    queue = operation.catch(() => undefined);
    return operation;
  }
  function metadata(token: string, kind: AuthSession["kind"], label: string, issuedNow: boolean): AuthSession {
    const claims = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
    return { id: authSessionId(token), kind, label: label.slice(0, 120), createdAt: issuedNow ? Date.now() : claims.iat * 1000, expiresAt: claims.exp * 1000 };
  }
  const allowed = (state: UserState, session: AuthSession) => !state.disabled && !session.revokedAt && session.expiresAt > Date.now() && session.createdAt > (state.revokedBefore || 0);
  return {
    register: (userId: string, token: string, kind: AuthSession["kind"], label: string) => mutate(`user:${userId}`, (state) => {
      const session = metadata(token, kind, label, true);
      session.createdAt = Math.max(session.createdAt, (state.revokedBefore || 0) + 1);
      if (state.disabled) throw new Error("Account is disabled");
      const sessions = state.sessions ||= {};
      for (const [id, entry] of Object.entries(sessions)) if (entry.expiresAt <= Date.now()) delete sessions[id];
      sessions[session.id] = session;
      return session;
    }),
    authorize: async (userId: string, token: string, kind: AuthSession["kind"]) => {
      const key = `user:${userId}`;
      const id = authSessionId(token);
      const state = await read(key);
      if (state.sessions?.[id]) return allowed(state, state.sessions[id]);
      // Migrate an already-signed legacy credential without extending its lifetime
      // or letting registration bypass a previous account-wide revocation.
      return mutate(key, (current) => {
        const session = current.sessions?.[id] || metadata(token, kind, "Existing session", false);
        if (!allowed(current, session)) return false;
        (current.sessions ||= {})[id] = session;
        return true;
      });
    },
    list: async (userId: string) => Object.values((await read(`user:${userId}`)).sessions || {}).filter((session) => session.expiresAt > Date.now()),
    revoke: (userId: string, id: string) => mutate(`user:${userId}`, (state) => {
      const session = state.sessions?.[id];
      if (!session) return false;
      session.revokedAt = Date.now();
      return true;
    }),
    revokeAll: (userId: string) => mutate(`user:${userId}`, (state) => { state.revokedBefore = Date.now(); }),
    setDisabled: (userId: string, disabled: boolean) => mutate(`user:${userId}`, (state) => {
      state.disabled = disabled;
      if (disabled) state.revokedBefore = Date.now();
    }),
    isDisabled: async (userId: string) => Boolean((await read(`user:${userId}`)).disabled),
    consumeOAuthState: async (state: string, expiresAt: number) => {
      if (pool) await pool.query(`DELETE FROM ${table} WHERE key LIKE 'oauth:%' AND (value->>'expiresAt')::bigint < $1`, [Date.now()]);
      return mutate(`oauth:${authSessionId(state)}`, (entry) => {
        if (entry.consumedAt || expiresAt <= Date.now()) return false;
        entry.consumedAt = Date.now(); entry.expiresAt = expiresAt;
        return true;
      });
    },
    close: async () => { await queue; await pool?.end(); },
  };
}

export type AuthSessionStore = Awaited<ReturnType<typeof createAuthSessionStore>>;
