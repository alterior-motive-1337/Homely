// Local Hrana fixture: real SQLite storage and remote stream transaction lifetimes.
// No production credentials, external database, or paid provider calls.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const dir = fs.mkdtempSync(path.join(tmpdir(), "homely-hrana-"));
const file = path.join(dir, "remote.db");
const streams = new Map<string, DatabaseSync>();
let sequence = 0;
type RecordValue = Record<string, any>;

function value(input: any): any {
  if (input === null) return { type: "null" };
  if (typeof input === "number" || typeof input === "bigint") return Number.isInteger(Number(input))
    ? { type: "integer", value: String(input) } : { type: "float", value: Number(input) };
  if (input instanceof Uint8Array) return { type: "blob", base64: Buffer.from(input).toString("base64") };
  return { type: "text", value: String(input) };
}

function execute(db: DatabaseSync, input: RecordValue): RecordValue {
  const sql = String(input.sql);
  const statement = db.prepare(sql);
  const cols = statement.columns().map(col => ({ name: col.name, decltype: col.type }));
  const args = (input.args ?? []).map((arg: RecordValue) => {
    if (arg.type === "null") return null;
    if (arg.type === "integer" || arg.type === "float") return Number(arg.value);
    if (arg.type === "blob") return Buffer.from(arg.base64, "base64");
    return String(arg.value);
  });
  if (cols.length) {
    const rows = statement.all(...args);
    return { cols, rows: input.want_rows ? rows.map(row => cols.map(col => value(row[col.name]))) : [],
      affected_row_count: 0, last_insert_rowid: null };
  }
  const result = statement.run(...args);
  return { cols: [], rows: [], affected_row_count: Number(result.changes), last_insert_rowid: String(result.lastInsertRowid) };
}

function batch(db: DatabaseSync, input: RecordValue): RecordValue {
  const step_results: any[] = [], step_errors: any[] = [];
  for (const step of input.steps) {
    try { step_results.push(execute(db, step.stmt)); step_errors.push(null); }
    catch (error) { step_results.push(null); step_errors.push({ code: "SQLITE_ERROR", message: (error as Error).message }); }
  }
  return { step_results, step_errors };
}

const server = http.createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const baton = input.baton ?? `fixture-${++sequence}`;
    const db = streams.get(baton) ?? new DatabaseSync(file);
    streams.set(baton, db);
    if (req.url === "/v3/cursor") {
      const result = batch(db, input.batch);
      const entries: any[] = [{ baton, base_url: null }];
      for (let i = 0; i < result.step_results.length; i++) {
        const row = result.step_results[i];
        if (!row) { entries.push({ type: "step_error", step: i, error: result.step_errors[i] }); continue; }
        entries.push({ type: "step_begin", step: i, cols: row.cols });
        entries.push(...row.rows.map((row: any) => ({ type: "row", row })));
        entries.push({ type: "step_end", affected_row_count: row.affected_row_count, last_inserted_rowid: row.last_insert_rowid });
      }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
      return;
    }
    if (req.url !== "/v3/pipeline") throw new Error(`Unexpected endpoint ${req.url}`);
    let closed = false;
    const results = input.requests.map((request: RecordValue) => {
      let response: RecordValue;
      switch (request.type) {
        case "describe": {
          const statement = db.prepare(request.sql);
          response = { type: "describe", result: {
            cols: statement.columns().map(col => ({ name: col.name, decltype: col.type })),
            params: Array.from({ length: (request.sql.match(/\?/g) ?? []).length }, () => ({ name: null })),
            is_explain: false, is_readonly: statement.columns().length > 0
          } };
          break;
        }
        case "batch": response = { type: "batch", result: batch(db, request.batch) }; break;
        case "get_autocommit": response = { type: "get_autocommit", is_autocommit: !db.isTransaction }; break;
        case "close":
          if (db.isTransaction) db.exec("ROLLBACK");
          db.close(); streams.delete(baton); closed = true; response = { type: "close" }; break;
        default: throw new Error(`Unexpected request ${request.type}`);
      }
      return { type: "ok", response };
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ baton: closed ? null : baton, base_url: null, results }));
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end((error as Error).message);
  }
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address !== "string") process.send?.({ port: address.port });
});
process.on("SIGTERM", () => {
  for (const db of streams.values()) db.close();
  server.close(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); });
});
