import assert from "node:assert/strict";
import type http from "node:http";
import test from "node:test";
import { assertSameOrigin } from "../src/security/request.js";

function request(method: string, headers: Record<string, string>) {
  return { method, headers } as http.IncomingMessage;
}

test("browser mutations accept Homely's origin and reject other origins", () => {
  assert.doesNotThrow(() => assertSameOrigin(request("POST", {
    host: "homely.example", origin: "http://homely.example", "sec-fetch-site": "same-origin"
  })));
  const sources: Record<string, string>[] = [
    { origin: "https://another.example" },
    { origin: "https://homely.example" },
    { origin: "null" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" }
  ];
  for (const headers of sources) {
    assert.throws(() => assertSameOrigin(request("POST", { host: "homely.example", ...headers })), /origin/i);
  }
});

test("read-only navigation and local API clients remain usable", () => {
  assert.doesNotThrow(() => assertSameOrigin(request("GET", { "sec-fetch-site": "cross-site" })));
  assert.doesNotThrow(() => assertSameOrigin(request("POST", { host: "localhost:4173" })));
});
