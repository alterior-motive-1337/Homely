import assert from "node:assert/strict";
import test from "node:test";
import type http from "node:http";
import { LoginAttemptLimiter, OwnerAuth } from "../src/security/auth.js";

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


test("changing the owner password invalidates existing sessions", () => {
  const original = new OwnerAuth({
    enabled: true,
    password: "old-password",
    secret: "s".repeat(64),
    sessionDays: 7,
    secureCookies: false
  });
  const rotated = new OwnerAuth({
    enabled: true,
    password: "new-password",
    secret: "s".repeat(64),
    sessionDays: 7,
    secureCookies: false
  });

  const pair = original.sessionCookie().split(";")[0] ?? "";
  assert.equal(original.isAuthenticated(requestWithCookie(pair)), true);
  assert.equal(rotated.isAuthenticated(requestWithCookie(pair)), false);
});

test("login limiter blocks repeated failures and clears on success", () => {
  const limiter = new LoginAttemptLimiter(3, 60_000, 120_000);
  const key = "test-client";
  const now = 1_000_000;

  assert.equal(limiter.recordFailure(key, now), 0);
  assert.equal(limiter.recordFailure(key, now + 1), 0);
  assert.ok(limiter.recordFailure(key, now + 2) > 0);
  assert.ok(limiter.retryAfterSeconds(key, now + 3) > 0);

  limiter.clear(key);
  assert.equal(limiter.retryAfterSeconds(key, now + 4), 0);
});
