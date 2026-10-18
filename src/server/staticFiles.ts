import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { securityHeaders } from "../security/headers.js";

interface CachedAsset {
  etag: string;
  modifiedAt: Date;
  raw: Buffer;
  compressed: Map<"br" | "gzip", Buffer>;
}

const MAX_ASSET_BYTES = 1_000_000;
const MAX_CACHE_BYTES = 16_000_000;
const assetCache = new Map<string, CachedAsset>();
const compressionJobs = new Map<string, Promise<Buffer>>();
const publicRoots = new Map<string, Promise<string>>();
let cacheBytes = 0;

function resolvePublicRoot(directory: string): Promise<string> {
  let root = publicRoots.get(directory);
  if (!root) {
    root = fs.promises.realpath(directory);
    publicRoots.set(directory, root);
    void root.catch(() => {
      if (publicRoots.get(directory) === root) publicRoots.delete(directory);
    });
  }
  return root;
}

function mimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".json" || ext === ".map") return "application/json; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

function acceptsEncoding(header: string | string[] | undefined, encoding: "br" | "gzip"): boolean {
  const entries = (Array.isArray(header) ? header.join(",") : header ?? "")
    .split(",")
    .map((entry) => {
      const [name, ...parameters] = entry.trim().toLowerCase().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return [name?.trim() ?? "", quality ? Number(quality.trim().slice(2)) : 1] as const;
    });
  const explicit = entries.find(([name]) => name === encoding);
  if (explicit) return explicit[1] > 0;
  const wildcard = entries.find(([name]) => name === "*");
  return wildcard ? wildcard[1] > 0 : false;
}

function acceptsIdentity(header: string | string[] | undefined): boolean {
  if (!header) return true;
  const entries = (Array.isArray(header) ? header.join(",") : header)
    .split(",")
    .map((entry) => {
      const [name, ...parameters] = entry.trim().toLowerCase().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return [name?.trim() ?? "", quality ? Number(quality.trim().slice(2)) : 1] as const;
    });
  const explicit = entries.find(([name]) => name === "identity");
  if (explicit) return explicit[1] > 0;
  return !entries.some(([name, quality]) => name === "*" && quality === 0);
}

function matchesIfNoneMatch(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  return (Array.isArray(header) ? header.join(",") : header)
    .split(",")
    .some((candidate) => {
      const value = candidate.trim();
      return value === "*" || value.replace(/^W\//, "") === etag.replace(/^W\//, "");
    });
}

function cacheControl(filePath: string): string {
  if (path.extname(filePath).toLowerCase() === ".html") return "no-store";
  const filename = path.basename(filePath);
  return /(?:^|[.-])[a-f0-9]{8,}(?:[.-]|$)/i.test(filename)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
}

function touchCache(filePath: string, entry: CachedAsset): void {
  assetCache.delete(filePath);
  assetCache.set(filePath, entry);
}

function removeCacheEntry(filePath: string): void {
  const entry = assetCache.get(filePath);
  if (!entry) return;
  cacheBytes -= entry.raw.byteLength;
  for (const compressed of entry.compressed.values()) cacheBytes -= compressed.byteLength;
  assetCache.delete(filePath);
}

function makeRoom(required: number, preservePath?: string): boolean {
  while (cacheBytes + required > MAX_CACHE_BYTES && assetCache.size) {
    const oldest = [...assetCache.keys()].find((candidate) => candidate !== preservePath);
    if (!oldest) break;
    removeCacheEntry(oldest);
  }
  return cacheBytes + required <= MAX_CACHE_BYTES;
}

function encodingQuality(header: string | string[] | undefined, encoding: "br" | "gzip"): number {
  const entries = (Array.isArray(header) ? header.join(",") : header ?? "")
    .split(",")
    .map((entry) => {
      const [name, ...parameters] = entry.trim().toLowerCase().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return [name?.trim() ?? "", quality ? Number(quality.trim().slice(2)) : 1] as const;
    });
  return entries.find(([name]) => name === encoding)?.[1]
    ?? entries.find(([name]) => name === "*")?.[1]
    ?? 0;
}

async function compress(entry: CachedAsset, filePath: string, encoding: "br" | "gzip"): Promise<Buffer> {
  const key = `${filePath}\u0000${entry.etag}\u0000${encoding}`;
  const existingJob = compressionJobs.get(key);
  if (existingJob) return existingJob;

  const job = encoding === "br"
    ? promisify(zlib.brotliCompress)(entry.raw)
    : promisify(zlib.gzip)(entry.raw);
  compressionJobs.set(key, job);
  try {
    const compressed = await job;
    if (assetCache.get(filePath) === entry) {
      if (makeRoom(compressed.byteLength, filePath)) {
        touchCache(filePath, entry);
        entry.compressed.set(encoding, compressed);
        cacheBytes += compressed.byteLength;
      }
    }
    return compressed;
  } finally {
    compressionJobs.delete(key);
  }
}

function isCompressible(filePath: string): boolean {
  return [".css", ".html", ".js", ".json", ".mjs", ".svg", ".txt"].includes(path.extname(filePath).toLowerCase());
}

async function loadAsset(filePath: string, etag: string, modifiedAt: Date): Promise<CachedAsset> {
  const cached = assetCache.get(filePath);
  if (cached?.etag === etag) {
    touchCache(filePath, cached);
    return cached;
  }

  const raw = await fs.promises.readFile(filePath);
  const concurrent = assetCache.get(filePath);
  if (concurrent?.etag === etag) {
    touchCache(filePath, concurrent);
    return concurrent;
  }
  if (concurrent) removeCacheEntry(filePath);
  makeRoom(raw.byteLength);
  const entry: CachedAsset = { etag, modifiedAt, raw, compressed: new Map() };
  assetCache.set(filePath, entry);
  cacheBytes += raw.byteLength;
  return entry;
}

function setAssetHeaders(
  res: http.ServerResponse,
  filePath: string,
  etag: string,
  modifiedAt: Date,
  size: number
): void {
  securityHeaders(res);
  res.setHeader("content-type", mimeType(filePath));
  res.setHeader("cache-control", cacheControl(filePath));
  res.setHeader("etag", etag);
  res.setHeader("last-modified", modifiedAt.toUTCString());
  if (isCompressible(filePath)) res.setHeader("vary", "Accept-Encoding");
  if (size > 0) res.setHeader("content-length", size);
}

function sendError(res: http.ServerResponse, status: number, message: string, method?: string): void {
  securityHeaders(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(method === "HEAD" ? undefined : JSON.stringify({ error: message }));
}

export async function serveStatic(
  res: http.ServerResponse,
  pathname: string,
  req: http.IncomingMessage,
  publicDir: string
): Promise<void> {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendError(res, 400, "Invalid path.", req.method);
    return;
  }

  let root: string;
  try {
    root = await resolvePublicRoot(publicDir);
  } catch (error) {
    console.error("Error resolving the public directory:", error);
    sendError(res, 500, "Application files could not be served.", req.method);
    return;
  }
  const relative = (decodedPath === "/" ? "index.html" : decodedPath).replace(/^[/\\]+/, "");
  const candidate = path.resolve(root, relative);
  const relativeToRoot = path.relative(root, candidate);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    sendError(res, 403, "Forbidden.", req.method);
    return;
  }

  let filePath = candidate;
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw Object.assign(new Error("Not a regular file."), { code: "ENOENT" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      console.error("Error resolving static file:", error);
      sendError(res, 500, "File could not be served.", req.method);
      return;
    }
    if (path.extname(decodedPath)) {
      sendError(res, 404, "File not found.", req.method);
      return;
    }
    filePath = path.join(root, "index.html");
    try {
      stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        sendError(res, 404, "File not found.", req.method);
        return;
      }
    } catch (indexError) {
      console.error("Error resolving the application entry point:", indexError);
      sendError(res, 500, "Application entry point could not be served.", req.method);
      return;
    }
  }

  try {
    const realPath = await fs.promises.realpath(filePath);
    const resolvedRelative = path.relative(root, realPath);
    if (resolvedRelative.startsWith("..") || path.isAbsolute(resolvedRelative)) {
      sendError(res, 403, "Forbidden.", req.method);
      return;
    }
    filePath = realPath;

    const etag = `W/"${stat.mtimeMs}-${stat.size}"`;
    const vary = isCompressible(filePath);
    if (matchesIfNoneMatch(req.headers["if-none-match"], etag)) {
      setAssetHeaders(res, filePath, etag, stat.mtime, stat.size);
      res.removeHeader("content-length");
      res.writeHead(304);
      res.end();
      return;
    }

    const acceptEncoding = req.headers["accept-encoding"];
    let encoding: "br" | "gzip" | undefined;
    if (isCompressible(filePath) && stat.size >= 1024 && stat.size <= MAX_ASSET_BYTES) {
      const brQuality = encodingQuality(acceptEncoding, "br");
      const gzipQuality = encodingQuality(acceptEncoding, "gzip");
      if (brQuality > 0 && brQuality >= gzipQuality) encoding = "br";
      else if (gzipQuality > 0) encoding = "gzip";
    }
    if (!encoding && !acceptsIdentity(acceptEncoding)) {
      sendError(res, 406, "No acceptable content encoding is available.", req.method);
      return;
    }

    const cacheable = stat.size <= MAX_ASSET_BYTES;
    let entry = cacheable ? assetCache.get(filePath) : undefined;
    if (entry && entry.etag !== etag) {
      removeCacheEntry(filePath);
      entry = undefined;
    }

    if (req.method === "HEAD") {
      let contentLength = stat.size;
      if (encoding && cacheable) {
        entry = entry ?? await loadAsset(filePath, etag, stat.mtime);
        contentLength = (entry.compressed.get(encoding) ?? await compress(entry, filePath, encoding)).byteLength;
      }
      setAssetHeaders(res, filePath, etag, stat.mtime, contentLength);
      if (encoding) res.setHeader("content-encoding", encoding);
      res.writeHead(200);
      res.end();
      return;
    }

    if (!cacheable) {
      setAssetHeaders(res, filePath, etag, stat.mtime, stat.size);
      if (encoding) res.setHeader("vary", "Accept-Encoding");
      res.writeHead(200);
      const stream = fs.createReadStream(filePath);
      stream.on("error", (error) => {
        console.error("Error streaming static file:", error);
        res.destroy(error);
      });
      stream.pipe(res);
      return;
    }

    entry = entry ?? await loadAsset(filePath, etag, stat.mtime);

    let body = entry.raw;
    if (encoding) {
      body = entry.compressed.get(encoding) ?? await compress(entry, filePath, encoding);
    }
    setAssetHeaders(res, filePath, etag, entry.modifiedAt, body.byteLength);
    if (encoding) res.setHeader("content-encoding", encoding);
    if (vary) res.setHeader("vary", "Accept-Encoding");
    res.writeHead(200);
    res.end(body);
  } catch (error) {
    console.error("Error serving static file:", error);
    if (res.headersSent) {
      res.destroy(error as Error);
      return;
    }
    sendError(res, 500, "File could not be served.", req.method);
  }
}
