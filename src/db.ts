import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

export type HomelyDatabase = DatabaseSync;

export function openDatabase(dbPath = config.dbPath): HomelyDatabase {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
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
