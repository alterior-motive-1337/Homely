import assert from "node:assert/strict";
import test from "node:test";
import { viewerMayWrite } from "../src/security/authorization.js";

test("read-only members retain personal account, household-switch, alert and chat actions", () => {
  for (const [method, pathname] of [
    ["POST", "/api/homes/active"],
    ["POST", "/api/homes/invitations/accept"],
    ["POST", "/api/alerts/acknowledge"],
    ["POST", "/api/agent/respond"],
    ["POST", "/api/agent/conversations"],
    ["POST", "/api/voice/speech"],
    ["PATCH", "/api/agent/conversations/chat-123"],
    ["DELETE", "/api/agent/history"],
    ["DELETE", "/api/account/delete"]
  ] as const) {
    assert.equal(viewerMayWrite(method, pathname), true, `${method} ${pathname}`);
  }
});

test("read-only members cannot mutate shared household records or settings", () => {
  for (const [method, pathname] of [
    ["POST", "/api/transactions/preview"],
    ["POST", "/api/homes/sample"],
    ["PATCH", "/api/homes/current"],
    ["POST", "/api/homes/invitations"],
    ["DELETE", "/api/homes/members/member-123"],
    ["PUT", "/api/uploads/upload-123/chunks/0"],
    ["PATCH", "/api/agent/conversations/chat-123/extra"]
  ] as const) {
    assert.equal(viewerMayWrite(method, pathname), false, `${method} ${pathname}`);
  }
});
