import Database from "libsql";
import { initializeDatabase, type HomelyDatabase } from "../src/db.js";

// Explicit test dependency; production startup never uses this database.
export function createTestDatabase(): HomelyDatabase {
  return initializeDatabase(new Database(":memory:") as unknown as HomelyDatabase);
}
