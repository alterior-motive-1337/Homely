import fs from "node:fs";
import { config } from "../src/config.js";
import { migrate, openDatabase } from "../src/db.js";
import { seedDemo } from "../src/seed.js";

for (const suffix of ["", "-shm", "-wal"]) {
  const file = config.dbPath + suffix;
  if (fs.existsSync(file)) fs.rmSync(file);
}
const db = openDatabase();
migrate(db);
seedDemo(db);
db.close();
console.log("Homely database reset and seeded.");
