import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { URL } from "node:url";
import { config } from "./config.js";
import { migrate, openDatabase } from "./db.js";
import { getAsset, getOverview, getProject, getTimeline, listAssets, listDocuments, listIssues, listMaintenance, listProjects, listSystems } from "./domain/repository.js";
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
import { GoogleDriveIntegration } from "./integrations/googleDrive.js";
import { DriveBackupService } from "./integrations/driveBackup.js";
import { LoginAttemptLimiter, loginPage, OwnerAuth } from "./security/auth.js";

function securityHeaders(res: http.ServerResponse): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
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

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new DomainError("Request body is too large.", 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new DomainError("Request body must be valid JSON.");
  }
}

async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  const body = await readBody(req);
  return new URLSearchParams(body.toString("utf8"));
}

function loginAttemptKey(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return raw?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
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
    return sendHtml(res, 200, fs.readFileSync(indexPath, "utf8"));
  }
  securityHeaders(res);
  res.writeHead(200, { "content-type": mimeType(filePath) });
  return res.end(fs.readFileSync(filePath));
}

async function main(): Promise<void> {
  const auth = new OwnerAuth({
    enabled: config.authEnabled,
    password: config.ownerPassword,
    secret: config.sessionSecret,
    sessionDays: config.sessionDays,
    secureCookies: config.secureCookies
  });

  const loginLimiter = new LoginAttemptLimiter();
  const googleDrive = new GoogleDriveIntegration();
  const backups = new DriveBackupService(googleDrive);
  backups.assertReady();
  await backups.restoreIfDatabaseMissing();

  const db = openDatabase();
  migrate(db);
  const seeded = !hasHome(db);
  if (seeded) seedDemo(db);

  const agentRuntime = createAgentRuntime(db);

  if (seeded && config.backupEnabled) {
    await backups.backupNow(db, "initial-seed");
  }
  backups.startPeriodic(db);

  async function durable<T extends Record<string, unknown>>(result: T, reason: string): Promise<T & {
    durability: { driveBackup: "OK" | "DISABLED" | "DEGRADED" };
  }> {
    if (!config.backupEnabled) {
      return { ...result, durability: { driveBackup: "DISABLED" } };
    }
    try {
      await backups.backupNow(db, reason);
      return { ...result, durability: { driveBackup: "OK" } };
    } catch (error) {
      console.error("Homely state committed but off-site backup is degraded:", error);
      return { ...result, durability: { driveBackup: "DEGRADED" } };
    }
  }

  const server = http.createServer(async (req, res) => {
    if (!req.url) return sendJson(res, 400, { error: "Missing URL" });
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    try {
      if (req.method === "GET" && url.pathname === "/api/health") {
        db.prepare("SELECT 1 AS ok").get();
        const durability = !config.backupEnabled
          ? "LOCAL"
          : googleDrive.status.connected
            ? "READY"
            : "DEGRADED";
        return sendJson(res, 200, { ok: true, service: "Homely", database: "OK", durability });
      }

      if (req.method === "GET" && url.pathname === "/api/auth/status") {
        return sendJson(res, 200, {
          enabled: auth.enabled,
          authenticated: auth.isAuthenticated(req)
        });
      }

      if (req.method === "GET" && url.pathname === "/auth/login") {
        if (!auth.enabled || auth.isAuthenticated(req)) {
          res.writeHead(303, { location: "/" });
          return res.end();
        }
        return sendHtml(res, 200, loginPage());
      }

      if (req.method === "POST" && url.pathname === "/auth/login") {
        const key = loginAttemptKey(req);
        const blockedFor = loginLimiter.retryAfterSeconds(key);
        if (blockedFor > 0) {
          return sendHtml(res, 429, loginPage("Too many failed attempts. Try again later."), {
            "retry-after": String(blockedFor),
            "cache-control": "no-store"
          });
        }

        const form = await readForm(req);
        const password = form.get("password") ?? "";
        if (!auth.verifyPassword(password)) {
          const retryAfter = loginLimiter.recordFailure(key);
          return sendHtml(
            res,
            retryAfter > 0 ? 429 : 401,
            loginPage(retryAfter > 0 ? "Too many failed attempts. Try again later." : "Incorrect owner password."),
            retryAfter > 0 ? { "retry-after": String(retryAfter), "cache-control": "no-store" } : { "cache-control": "no-store" }
          );
        }

        loginLimiter.clear(key);
        res.writeHead(303, {
          location: "/",
          "set-cookie": auth.sessionCookie(),
          "cache-control": "no-store"
        });
        return res.end();
      }

      if (req.method === "POST" && url.pathname === "/api/auth/logout") {
        return sendJson(res, 200, { authenticated: false }, {
          "set-cookie": auth.clearCookie(),
          "cache-control": "no-store"
        });
      }

      if (!auth.isAuthenticated(req)) {
        if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
          res.writeHead(303, { location: "/auth/login" });
          return res.end();
        }
        return sendJson(res, 401, { error: "Owner authentication required." });
      }

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
      if (req.method === "GET" && url.pathname === "/api/documents") return sendJson(res, 200, listDocuments(db));
      if (req.method === "GET" && url.pathname === "/api/projects") return sendJson(res, 200, listProjects(db));
      if (req.method === "GET" && url.pathname.startsWith("/api/projects/")) {
        const project = getProject(db, decodeURIComponent(url.pathname.slice("/api/projects/".length)));
        return project ? sendJson(res, 200, project) : sendJson(res, 404, { error: "Project not found" });
      }
      if (req.method === "GET" && url.pathname === "/api/transactions") return sendJson(res, 200, listTransactions(db));
      if (req.method === "GET" && url.pathname === "/api/integrations/status") {
        return sendJson(res, 200, {
          auth: { enabled: auth.enabled },
          ai: agentRuntime.status,
          voice: { enabled: config.voiceEnabled, available: false },
          googleDrive: googleDrive.status,
          backup: backups.status
        });
      }

      if (req.method === "GET" && url.pathname === "/api/google-drive/connect") {
        const location = googleDrive.getAuthorizationUrl();
        res.writeHead(302, { location });
        return res.end();
      }

      if (req.method === "GET" && url.pathname === "/api/google-drive/callback") {
        const error = url.searchParams.get("error");
        if (error) {
          res.writeHead(302, { location: "/?view=documents&driveError=" + encodeURIComponent(error) });
          return res.end();
        }

        const code = url.searchParams.get("code");
        if (!code) throw new DomainError("Google Drive authorization code is missing.");
        await googleDrive.exchangeCode(code);

        const picked = url.searchParams.get("picked_file_ids") ?? "";
        const location = picked
          ? "/?view=documents&drivePicked=" + encodeURIComponent(picked)
          : "/?view=documents&driveConnected=1";
        res.writeHead(302, { location });
        return res.end();
      }

      if (req.method === "GET" && url.pathname === "/api/google-drive/files") {
        const ids = (url.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
        if (!ids.length) throw new DomainError("No Drive file IDs were selected.");
        return sendJson(res, 200, await googleDrive.getSelectedFiles(ids));
      }

      if (req.method === "POST" && url.pathname === "/api/google-drive/disconnect") {
        googleDrive.disconnect();
        return sendJson(res, 200, { connected: false });
      }

      if (req.method === "POST" && url.pathname === "/api/backups/now") {
        if (!config.backupEnabled) throw new DomainError("Off-site backups are disabled.", 409);
        if (!googleDrive.status.connected) throw new DomainError("Google Drive backup credentials are not ready.", 503);
        const backup = await backups.backupNow(db, "manual");
        if (!backup) throw new DomainError("Backup did not complete.", 503);
        return sendJson(res, 200, { backup, status: backups.status });
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
          return sendJson(res, 200, await durable(result, "transaction-commit"));
        }

        if (req.method === "POST" && operation === "reject") {
          const result = rejectTransaction(db, transactionId);
          if (!result) throw new DomainError("Rejected transaction could not be reloaded.", 500);
          return sendJson(res, 200, await durable(result, "transaction-reject"));
        }

        if (req.method === "POST" && operation === "undo") {
          const result = undoTransaction(db, transactionId);
          return sendJson(res, 200, await durable(result, "transaction-undo"));
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
    console.log(`Homely received ${signal}; preserving state before shutdown.`);
    backups.stopPeriodic();
    try {
      if (config.backupEnabled) await backups.backupNow(db, "shutdown");
    } catch (error) {
      console.error("Final Homely backup failed during shutdown:", error);
    }
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };

  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("SIGINT", () => { void shutdown("SIGINT"); });

  server.listen(config.port, config.host, () => {
    console.log(`Homely running at http://${config.host}:${config.port}`);
  });
}

main().catch((error) => {
  console.error("Homely failed to start:", error);
  process.exit(1);
});
