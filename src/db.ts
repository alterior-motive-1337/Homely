import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
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

export function openDatabase(dbPath?: string): HomelyDatabase {
  const useTurso = dbPath === undefined && Boolean(config.tursoDatabaseUrl);
  if (dbPath === undefined && Boolean(config.tursoDatabaseUrl) !== Boolean(config.tursoAuthToken)) {
    throw new Error("Turso requires both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
  }
  // Keep the replica separate from any existing local SQLite database.
  const filePath = dbPath ?? (useTurso ? config.dbPath + ".replica" : config.dbPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let db: HomelyDatabase;
  if (useTurso) {
    const options = { syncUrl: config.tursoDatabaseUrl, authToken: config.tursoAuthToken };
    const replica = new LibsqlDatabase(filePath, options);
    try { replica.sync(); }
    catch (error) { replica.close(); throw error; }
    // libSQL implements the same narrow statement API used by the domain.
    db = replica as unknown as HomelyDatabase;
  } else {
    db = new DatabaseSync(filePath);
  }
  return initializeDatabase(db);
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
  return db;
}

export function migrate(db: HomelyDatabase, migrationsDir = config.migrationsDir): void {
  const applied = db.prepare("SELECT version FROM schema_migrations").all()
    .map((row) => String(row.version));

  const files = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const mark = db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)");

  for (const file of files) {
    if (applied.includes(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.exec(sql);
      mark.run(file, new Date().toISOString());
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }
}

