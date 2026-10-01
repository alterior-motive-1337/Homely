import { migrate, openDatabase } from "../src/db.js";
const db = openDatabase();
migrate(db);
db.close();
console.log("Homely migrations complete.");
