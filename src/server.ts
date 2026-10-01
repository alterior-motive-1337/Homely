import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { URL } from "node:url";
import { config } from "./config.js";
import { migrate, openDatabase } from "./db.js";
import { getAsset, getOverview, getTimeline, listAssets, listIssues, listMaintenance, listSystems } from "./domain/repository.js";
import { hasHome, seedDemo } from "./seed.js";

const db = openDatabase();
migrate(db);
if (!hasHome(db)) seedDemo(db);

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
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

const server = http.createServer((req, res) => {
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
    if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });
    return serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Homely could not complete this request." });
  }
});

server.listen(config.port, () => console.log(`Homely running at http://localhost:${config.port}`));
