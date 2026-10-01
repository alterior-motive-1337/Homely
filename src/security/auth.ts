import crypto from "node:crypto";
import type http from "node:http";

const COOKIE_NAME = "homely_session";

function digest(value: string): Buffer {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

function constantTimeEqual(left: string, right: string): boolean {
  return crypto.timingSafeEqual(digest(left), digest(right));
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

export class OwnerAuth {
  constructor(
    private readonly options: {
      enabled: boolean;
      password: string;
      secret: string;
      sessionDays: number;
      secureCookies: boolean;
    }
  ) {
    if (options.enabled && !options.password) {
      throw new Error("AUTH_ENABLED=true requires HOMELY_OWNER_PASSWORD.");
    }
    if (options.enabled && options.secret.length < 32) {
      throw new Error("AUTH_ENABLED=true requires HOMELY_SESSION_SECRET with at least 32 characters.");
    }
  }

  get enabled(): boolean {
    return this.options.enabled;
  }

  verifyPassword(password: string): boolean {
    if (!this.options.enabled) return true;
    return constantTimeEqual(password, this.options.password);
  }

  private sign(expiresAt: number): string {
    return crypto
      .createHmac("sha256", this.options.secret)
      .update(String(expiresAt))
      .digest("base64url");
  }

  private createToken(): { token: string; maxAge: number } {
    const maxAge = this.options.sessionDays * 24 * 60 * 60;
    const expiresAt = Math.floor(Date.now() / 1000) + maxAge;
    return { token: `${expiresAt}.${this.sign(expiresAt)}`, maxAge };
  }

  isAuthenticated(req: http.IncomingMessage): boolean {
    if (!this.options.enabled) return true;
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return false;

    const [rawExpiry, signature] = token.split(".");
    if (!rawExpiry || !signature) return false;
    const expiresAt = Number(rawExpiry);
    if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;

    const expected = this.sign(expiresAt);
    return constantTimeEqual(signature, expected);
  }

  sessionCookie(): string {
    const { token, maxAge } = this.createToken();
    const secure = this.options.secureCookies ? "; Secure" : "";
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  clearCookie(): string {
    const secure = this.options.secureCookies ? "; Secure" : "";
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  }
}

export function loginPage(errorMessage = ""): string {
  const error = errorMessage
    ? `<p class="error">${errorMessage.replace(/[<>&"']/g, "")}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Homely · Owner access</title>
<style>
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #090909; color: #f4f4f4; }
main { width: min(92vw, 420px); border: 1px solid #292929; background: #111; padding: 32px; }
.eyebrow { color: #969696; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; }
h1 { margin: 10px 0 8px; font-size: 30px; font-weight: 620; }
p { color: #aaa; line-height: 1.5; }
label { display: block; margin: 24px 0 8px; font-size: 13px; color: #cfcfcf; }
input { width: 100%; padding: 12px; border: 1px solid #333; background: #080808; color: #fff; font: inherit; }
button { width: 100%; margin-top: 14px; padding: 12px; border: 0; background: #f4f4f4; color: #090909; font: inherit; font-weight: 650; cursor: pointer; }
.error { color: #ff8c8c; }
</style>
</head>
<body>
<main>
<div class="eyebrow">Private property system</div>
<h1>Homely</h1>
<p>Owner authentication is required before this home's operating memory is exposed.</p>
${error}
<form method="post" action="/auth/login">
<label for="password">Owner password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Enter Homely</button>
</form>
</main>
</body>
</html>`;
}
