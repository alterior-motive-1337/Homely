import type http from "node:http";
import { DomainError } from "../domain/transactions.js";

// POC browser writes must originate from Homely. This is not user authentication.
export function assertSameOrigin(req: http.IncomingMessage): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method ?? "GET")) return;
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") {
    throw new DomainError("Cross-origin writes are not allowed.", 403);
  }
  const origin = req.headers.origin;
  if (origin) {
    let parsed: URL;
    try { parsed = new URL(origin); }
    catch { throw new DomainError("Invalid request origin.", 403); }
    const protocol = process.env.RENDER === "true" ? "https:" : "http:";
    if (parsed.protocol !== protocol || parsed.host !== req.headers.host) {
      throw new DomainError("Cross-origin writes are not allowed.", 403);
    }
  }
}
