import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { URL, pathToFileURL } from "node:url";
import { config } from "./config.js";
import { migrate, openDatabase, type HomelyDatabase } from "./db.js";
import { getAsset, getOverview, getProject, getTimeline, listAssets, listCharges, listDocuments, listIssues, listMaintenance, listProjects, listPurchaseCandidates, listRepairs, listSystems } from "./domain/repository.js";
import {
  commitTransaction,
  DomainError,
  getTransaction,
  listTransactions,
  proposeTransaction,
  rejectTransaction,
  undoTransaction,
  type ActionType
} from "./domain/transactions.js";
import { hasHome, seedDemo } from "./seed.js";
import { createAgentRuntime } from "./agent/runtime.js";
import { assertSameOrigin } from "./security/request.js";
import { startUpload, appendUploadChunk, finishUpload, streamStoredFile, UPLOAD_CHUNK_BYTES } from "./evidence/storage.js";
import { analyzeDocument } from "./evidence/analyze.js";
import { GoogleAuthentication, type AuthGateway } from "./security/googleAuth.js";
import { enterHome } from "./security/homeScope.js";

function securityHeaders(res: http.ServerResponse): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "camera=(), microphone=(self), geolocation=()");
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) {
  securityHeaders(res);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendHtml(
  res: http.ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {}
) {
  securityHeaders(res);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

async function readBody(req: http.IncomingMessage, maxSize = 1_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxSize) throw new DomainError("Request body is too large.", 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  if (!body.length) return {};
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Not an object");
    return parsed as Record<string, unknown>;
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
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".ico") return "image/x-icon";
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
    if (path.extname(pathname)) return sendJson(res, 404, { error: "File not found" });
    return sendHtml(res, 200, fs.readFileSync(indexPath, "utf8"), { "cache-control": "no-store" });
  }
  securityHeaders(res);
  res.writeHead(200, { "content-type": mimeType(filePath), "cache-control": path.extname(filePath).toLowerCase() === ".html" ? "no-store" : "no-cache" });
  return res.end(fs.readFileSync(filePath));
}

export async function startServer(
  db: HomelyDatabase = openDatabase(),
  authentication?: AuthGateway
): Promise<http.Server> {
  migrate(db);
  if (!hasHome(db) && process.env.HOMELY_SEED_DEMO === "true") seedDemo(db);

  const agentRuntime = createAgentRuntime(db);
  const auth = authentication ?? new GoogleAuthentication(db);

  const server = http.createServer(async (req, res) => {
    if (!req.url) return sendJson(res, 400, { error: "Missing URL" });
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      assertSameOrigin(req);
      if (req.method === "GET" && url.pathname === "/api/health") {
        db.prepare("SELECT 1 AS ok").get();
        return sendJson(res, 200, { ok: true, service: "Homely", database: "OK", mode: "POC", durability: "TURSO" });
      }

      if (req.method === "GET" && url.pathname === "/api/auth/status") {
        return sendJson(res, 200, auth.status(req), { "cache-control": "no-store" });
      }
      if (req.method === "GET" && url.pathname === "/auth/google") {
        auth.beginLogin(res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/auth/google/callback") {
        try { await auth.finishLogin(req,res,url); }
        catch (error) {
          console.error("Google sign-in failed:", error instanceof DomainError ? error.message : "Identity provider unavailable");
          res.setHeader("cache-control","no-store");
          res.writeHead(303,{location:"/?auth_error=signin","referrer-policy":"no-referrer"});
          res.end();
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/auth/login") {
        res.writeHead(303,{location:"/","cache-control":"no-store"});
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/auth/logout") {
        auth.logout(req,res);
        res.writeHead(204);
        return res.end();
      }
      // Every home API, file download, upload and agent operation requires a valid owner session.
      // No Google account can access the existing household just by registering.
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/demo-documents/")) {
        const user=auth.requireUser(req);
        enterHome(user.homeId);
        if(user.role==="VIEWER" && !["GET","HEAD"].includes(req.method ?? "GET"))
          throw new DomainError("Your household membership is read-only.",403);
      }

      // Upload each 50 MB file in small durable Turso transactions.
      if (req.method === "POST" && url.pathname === "/api/uploads/start") {
        return sendJson(res,201,startUpload(db,await readJson(req)));
      }
      const chunkMatch = /^\/api\/uploads\/(upload-[a-f0-9-]+)\/chunks\/(\d+)$/.exec(url.pathname);
      if (req.method === "PUT" && chunkMatch) {
        const bytes = await readBody(req, UPLOAD_CHUNK_BYTES);
        return sendJson(res,200,appendUploadChunk(db,chunkMatch[1]!,Number(chunkMatch[2]),bytes));
      }
      const finishMatch = /^\/api\/uploads\/(upload-[a-f0-9-]+)\/finish$/.exec(url.pathname);
      if (req.method === "POST" && finishMatch) {
        return sendJson(res,200,finishUpload(db,finishMatch[1]!));
      }
      const mediaMatch = /^\/api\/files\/([a-zA-Z0-9-]+)$/.exec(url.pathname);
      if (req.method === "GET" && mediaMatch) {
        return streamStoredFile(db,mediaMatch[1]!,typeof req.headers.range === "string" ? req.headers.range : undefined,res);
      }

      if (req.method === "GET" && url.pathname === "/api/overview") return sendJson(res, 200, getOverview(db));
      if (req.method === "GET" && url.pathname === "/api/systems") return sendJson(res, 200, listSystems(db));
      if (req.method === "GET" && url.pathname === "/api/assets") return sendJson(res, 200, listAssets(db));
      if (req.method === "GET" && url.pathname.startsWith("/api/assets/")) {
        const asset = getAsset(db, decodeURIComponent(url.pathname.slice("/api/assets/".length)));
        return asset ? sendJson(res, 200, asset) : sendJson(res, 404, { error: "Asset not found" });
      }
      if (req.method === "GET" && url.pathname === "/api/issues") return sendJson(res, 200, listIssues(db));
      if (req.method === "GET" && url.pathname === "/api/repairs") return sendJson(res, 200, listRepairs(db));
      if (req.method === "GET" && url.pathname === "/api/charges") return sendJson(res, 200, listCharges(db));
      if (req.method === "GET" && url.pathname === "/api/purchases") return sendJson(res, 200, listPurchaseCandidates(db));
      if (req.method === "GET" && url.pathname === "/api/maintenance") return sendJson(res, 200, listMaintenance(db));
      if (req.method === "GET" && url.pathname === "/api/timeline") return sendJson(res, 200, getTimeline(db));
      if (req.method === "GET" && url.pathname === "/api/documents") return sendJson(res, 200, listDocuments(db));
      const analysisPath=url.pathname.split("/");
      if(req.method==="POST" && analysisPath.length===5 && analysisPath[1]==="api" &&
        analysisPath[2]==="documents" && analysisPath[4]==="analyze" &&
        /^[a-zA-Z0-9-]+$/.test(analysisPath[3]??"")){
        try { return sendJson(res,200,await analyzeDocument(db,analysisPath[3]!)); }
        catch(error){
          if(error instanceof DomainError) throw error;
          console.error("Multimedia processing unavailable:",error);
          return sendJson(res,503,{error:"Multimedia analysis failed or is unavailable."});
        }
      }
      if (req.method === "GET" && url.pathname === "/api/projects") return sendJson(res, 200, listProjects(db));
      if (req.method === "GET" && url.pathname.startsWith("/api/projects/")) {
        const project = getProject(db, decodeURIComponent(url.pathname.slice("/api/projects/".length)));
        return project ? sendJson(res, 200, project) : sendJson(res, 404, { error: "Project not found" });
      }
      if (req.method === "GET" && url.pathname === "/api/transactions") return sendJson(res, 200, listTransactions(db));
      if (req.method === "GET" && url.pathname === "/api/integrations/status") {
        return sendJson(res, 200, {
          mode: "POC",
          storage: { provider: "TURSO" },
          ai: agentRuntime.status,
          research: agentRuntime.researchStatus,
          voice: { input: "BROWSER" }
        });
      }

      if (req.method === "POST" && url.pathname === "/api/agent/respond") {
        const body = await readJson(req);
        const message = String(body.message ?? "").trim();
        if (!message) throw new DomainError("Message is required.");
        if (message.length > 4000) throw new DomainError("Message is too long.");
        if (!agentRuntime.provider) {
          return sendJson(res, 503, {
            error: "Agent unavailable. Structured Homely functionality remains operational."
          });
        }

        try {
          const response = await agentRuntime.provider.respond({
            message,
            previousResponseId: body.previousResponseId === null || body.previousResponseId === undefined
              ? null
              : String(body.previousResponseId)
          });
          return sendJson(res, 200, response);
        } catch (error) {
          console.error("Homely agent provider failed:", error);
          return sendJson(res, 503, {
            error: "Agent temporarily unavailable. Structured Homely functionality remains operational."
          });
        }
      }

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

      const transactionMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)(?:\/(commit|reject|undo))?$/);
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
          const result = commitTransaction(db, transactionId);
          if (!result) throw new DomainError("Committed transaction could not be reloaded.", 500);
          return sendJson(res, 200, result);
        }

        if (req.method === "POST" && operation === "reject") {
          const result = rejectTransaction(db, transactionId);
          if (!result) throw new DomainError("Rejected transaction could not be reloaded.", 500);
          return sendJson(res, 200, result);
        }

        if (req.method === "POST" && operation === "undo") {
          const result = undoTransaction(db, transactionId);
          return sendJson(res, 200, result);
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

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Homely received ${signal}; closing home memory.`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };

  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("SIGINT", () => { void shutdown("SIGINT"); });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      console.log(`Homely running at http://${config.host}:${config.port}`);
      resolve();
    });
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer().catch((error) => {
    console.error("Homely failed to start:", error);
    process.exit(1);
  });
}

