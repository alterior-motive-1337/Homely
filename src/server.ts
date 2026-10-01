import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { URL } from "node:url";
import { config } from "./config.js";
import { migrate, openDatabase } from "./db.js";
import { getAsset, getOverview, getTimeline, listAssets, listIssues, listMaintenance, listSystems } from "./domain/repository.js";
import {
  commitTransaction,
  DomainError,
  getTransaction,
  listTransactions,
  proposeTransaction,
  undoTransaction,
  type ActionType
} from "./domain/transactions.js";
import { hasHome, seedDemo } from "./seed.js";

const db = openDatabase();
migrate(db);
if (!hasHome(db)) seedDemo(db);

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new DomainError("Request body is too large.", 413);
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new DomainError("Request body must be valid JSON.");
  }
}

function mimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(res: http.ServerResponse, pathname: string) {
  const relative = (pathname === "/" ? "index.html" : pathname).replace(/^\/+/, "");
  const filePath = path.resolve(config.publicDir, relative);
  if (!filePath.startsWith(config.publicDir + path.sep) && filePath !== path.join(config.publicDir, "index.html")) {
    return sendJson(res, 403, { error: "Forbidden" });
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    const indexPath = path.join(config.publicDir, "index.html");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync(indexPath));
  }
  res.writeHead(200, { "content-type": mimeType(filePath) });
  return res.end(fs.readFileSync(filePath));
}

const server = http.createServer(async (req, res) => {
  if (!req.url) return sendJson(res, 400, { error: "Missing URL" });
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { ok: true, service: "Homely" });
    if (req.method === "GET" && url.pathname === "/api/overview") return sendJson(res, 200, getOverview(db));
    if (req.method === "GET" && url.pathname === "/api/systems") return sendJson(res, 200, listSystems(db));
    if (req.method === "GET" && url.pathname === "/api/assets") return sendJson(res, 200, listAssets(db));
    if (req.method === "GET" && url.pathname.startsWith("/api/assets/")) {
      const asset = getAsset(db, decodeURIComponent(url.pathname.slice("/api/assets/".length)));
      return asset ? sendJson(res, 200, asset) : sendJson(res, 404, { error: "Asset not found" });
    }
    if (req.method === "GET" && url.pathname === "/api/issues") return sendJson(res, 200, listIssues(db));
    if (req.method === "GET" && url.pathname === "/api/maintenance") return sendJson(res, 200, listMaintenance(db));
    if (req.method === "GET" && url.pathname === "/api/timeline") return sendJson(res, 200, getTimeline(db));
    if (req.method === "GET" && url.pathname === "/api/transactions") return sendJson(res, 200, listTransactions(db));

    if (req.method === "POST" && url.pathname === "/api/transactions/preview") {
      const body = await readJson(req);
      const result = proposeTransaction(db, {
        actionType: String(body.actionType ?? "") as ActionType,
        payload: (body.payload && typeof body.payload === "object" ? body.payload : {}) as Record<string, unknown>,
        reason: String(body.reason ?? ""),
        requestText: body.requestText === undefined ? null : String(body.requestText),
        origin: "WEB_UI"
      });
      return sendJson(res, 201, result);
    }

    const transactionMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)(?:\/(commit|undo))?$/);
    if (transactionMatch) {
      const transactionId = decodeURIComponent(transactionMatch[1] ?? "");
      const operation = transactionMatch[2];

      if (req.method === "GET" && !operation) {
        const transaction = getTransaction(db, transactionId);
        return transaction
          ? sendJson(res, 200, transaction)
          : sendJson(res, 404, { error: "Transaction not found" });
      }

      if (req.method === "POST" && operation === "commit") {
        return sendJson(res, 200, commitTransaction(db, transactionId));
      }

      if (req.method === "POST" && operation === "undo") {
        return sendJson(res, 200, undoTransaction(db, transactionId));
      }
    }

    if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });
    return serveStatic(res, url.pathname);
  } catch (error) {
    if (error instanceof DomainError) return sendJson(res, error.status, { error: error.message });
    console.error(error);
    return sendJson(res, 500, { error: "Homely could not complete this request." });
  }
});

server.listen(config.port, () => console.log(`Homely running at http://localhost:${config.port}`));
