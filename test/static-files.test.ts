import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { serveStatic } from "../src/server/staticFiles.js";

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function request(
  port: number,
  requestPath: string,
  headers: http.OutgoingHttpHeaders = {},
  method = "GET"
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: requestPath, headers, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("static delivery is non-blocking, bounded, correctly cached, compressed and traversal-safe", async (t) => {
  const publicDir = path.resolve(process.cwd(), "public");
  const server = http.createServer((req, res) => {
    void serveStatic(res, req.url ?? "/", req, publicDir);
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const port = (server.address() as import("node:net").AddressInfo).port;

  const br = await request(port, "/app.js", { "accept-encoding": "br" });
  assert.equal(br.status, 200);
  assert.equal(br.headers["content-encoding"], "br");
  assert.match(String(br.headers.vary), /Accept-Encoding/i);
  assert.equal(br.headers["cache-control"], "public, max-age=0, must-revalidate");
  assert.equal(
    brotliDecompressSync(br.body).toString("utf8"),
    (await request(port, "/app.js")).body.toString("utf8")
  );

  const gzip = await request(port, "/app.js", { "accept-encoding": "br;q=0, gzip;q=1" });
  assert.equal(gzip.headers["content-encoding"], "gzip");
  assert.equal(gunzipSync(gzip.body).toString("utf8"), brotliDecompressSync(br.body).toString("utf8"));
  assert.equal(gzip.headers.etag, br.headers.etag);

  const notModified = await request(port, "/app.js", {
    "accept-encoding": "br",
    "if-none-match": `"unrelated", ${String(br.headers.etag)}`
  });
  assert.equal(notModified.status, 304);
  assert.match(String(notModified.headers.vary), /Accept-Encoding/i);
  assert.equal(notModified.headers["content-length"], undefined);
  assert.equal(notModified.body.length, 0);

  const identity = await request(port, "/app.js", { "accept-encoding": "br;q=0, gzip;q=0" });
  assert.equal(identity.status, 200);
  assert.equal(identity.headers["content-encoding"], undefined);
  assert.equal(identity.body.toString("utf8"), brotliDecompressSync(br.body).toString("utf8"));

  const head = await request(port, "/app.js", { "accept-encoding": "identity" }, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers["content-length"]), identity.body.length);
  assert.equal(head.body.length, 0);

  const missing = await request(port, "/not-a-file.js");
  assert.equal(missing.status, 404);
  assert.equal((await request(port, "/not-a-file.js", {}, "HEAD")).body.length, 0);
  const appRoute = await request(port, "/household/settings");
  assert.equal(appRoute.status, 200);
  assert.match(appRoute.body.toString("utf8"), /<title>Homely<\/title>/);
  assert.equal((await request(port, "/%2e%2e%2f.env.example")).status, 403);
});
