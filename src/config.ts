import path from "node:path";

const root = process.cwd();

export const config = {
  port: Number(process.env.PORT ?? 4173),
  dbPath: path.resolve(root, process.env.HOMELY_DB_PATH ?? "./data/homely.db"),
  publicDir: path.resolve(root, "public"),
  migrationsDir: path.resolve(root, "migrations")
};
