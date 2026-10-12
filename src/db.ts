import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import LibsqlDatabase from "libsql";
import { config } from "./config.js";

type Row = Record<string, SQLOutputValue>;
export interface HomelyDatabase {
  exec(sql: string): unknown;
  close(): unknown;
  prepare(sql: string): {
    all(...params: SQLInputValue[]): Row[];
    get(...params: SQLInputValue[]): Row | undefined;
    run(...params: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  };
}

interface TursoConnection { url: string; authToken: string }
type Replica = HomelyDatabase & { sync(): unknown };
type ReplicaFactory = (filePath: string, options: { syncUrl: string; authToken: string }) => Replica;

export function openDatabase(
  connection: TursoConnection = { url: config.tursoDatabaseUrl, authToken: config.tursoAuthToken },
  createReplica: ReplicaFactory = (filePath, options) => new LibsqlDatabase(filePath, options) as unknown as Replica
): HomelyDatabase {
  const url = connection.url.trim(), authToken = connection.authToken.trim();
  if (!url || !authToken) throw new Error("Turso is required. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw new Error("TURSO_DATABASE_URL must be a valid remote database URL."); }
  if (!["libsql:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error("TURSO_DATABASE_URL must be a remote libsql:// or https:// URL.");
  }
  const databaseId = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const filePath = path.join(tmpdir(), "homely", databaseId + ".replica");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const replica = createReplica(filePath, { syncUrl: url, authToken });
  try {
    replica.sync();
    return initializeDatabase(replica);
  } catch (error) {
    replica.close();
    throw error;
  }
}

export function initializeDatabase(db: HomelyDatabase): HomelyDatabase {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  // libSQL adds query timing to get() results. It is not household record data.
  const cleanRow = (row: Row): Row => Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "_metadata")
  );
  return {
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        all: (...params) => statement.all(...params).map(cleanRow),
        get: (...params) => {
          const row = statement.get(...params);
          return row ? cleanRow(row) : undefined;
        },
        run: (...params) => statement.run(...params)
      };
    }
  };
}

export function migrate(db: HomelyDatabase, migrationsDir = config.migrationsDir): void {
  const applied = db.prepare("SELECT version FROM schema_migrations").all()
    .map((row) => String(row.version));

  const files = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.includes(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.exec(sql);
      // Remote prepared statements retain the transaction scope they were created in.
      // Preparing before BEGIN would close that stream when the marker is written.
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(file, new Date().toISOString());
      db.exec("COMMIT;");
    } catch (error) {
      try { db.exec("ROLLBACK;"); }
      catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Migration ${file} failed; rollback also failed.`);
      }
      throw new Error(`Migration ${file} failed.`, { cause: error });
    }
  }
}

