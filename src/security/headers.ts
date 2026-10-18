import type http from "node:http";

export function securityHeaders(res: http.ServerResponse): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "camera=(), microphone=(self), geolocation=()");
  res.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; media-src 'self' blob: https:; frame-src 'self';"
  );
  if (process.env.RENDER === "true") {
    res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
}
