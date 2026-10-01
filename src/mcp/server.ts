import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { migrate, openDatabase } from "../db.js";
import { hasHome, seedDemo } from "../seed.js";
import { buildHomelyMcpServer } from "./createServer.js";

serveStdio(() => {
  const db = openDatabase();
  migrate(db);
  if (!hasHome(db)) seedDemo(db);
  return buildHomelyMcpServer(db);
});
