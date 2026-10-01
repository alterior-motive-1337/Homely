import assert from "node:assert/strict";
import test from "node:test";
import type http from "node:http";
import { OwnerAuth } from "../src/security/auth.js";

function requestWithCookie(cookie: string): http.IncomingMessage {
  return { headers: { cookie } } as http.IncomingMessage;
}

test("owner auth signs and verifies an HTTP-only session token", () => {
  const auth = new OwnerAuth({
    enabled: true,
    password: "owner-test-password",
    secret: "s".repeat(64),
    sessionDays: 7,
    secureCookies: true
  });

  assert.equal(auth.verifyPassword("wrong"), false);
  assert.equal(auth.verifyPassword("owner-test-password"), true);

  const cookie = auth.sessionCookie();
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);

  const pair = cookie.split(";")[0] ?? "";
  assert.equal(auth.isAuthenticated(requestWithCookie(pair)), true);

  const [name, value] = pair.split("=");
  const tampered = `${name}=${value}x`;
  assert.equal(auth.isAuthenticated(requestWithCookie(tampered)), false);
});

test("enabled owner auth refuses incomplete secret configuration", () => {
  assert.throws(() => new OwnerAuth({
    enabled: true,
    password: "",
    secret: "s".repeat(64),
    sessionDays: 7,
    secureCookies: false
  }), /HOMELY_OWNER_PASSWORD/);

  assert.throws(() => new OwnerAuth({
    enabled: true,
    password: "owner-test-password",
    secret: "short",
    sessionDays: 7,
    secureCookies: false
  }), /HOMELY_SESSION_SECRET/);
});
