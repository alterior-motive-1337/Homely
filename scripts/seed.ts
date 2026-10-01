import { migrate, openDatabase } from "../src/db.js";
import { seedDemo } from "../src/seed.js";
const db = openDatabase();
migrate(db);
seedDemo(db);
db.close();
console.log("Homely demo property seeded.");
