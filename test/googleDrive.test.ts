import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("Drive remains unavailable without credentials and stores no token", async () => {
  const previous = {
    enabled: process.env.GOOGLE_DRIVE_ENABLED,
    id: process.env.GOOGLE_CLIENT_ID,
    secret: process.env.GOOGLE_CLIENT_SECRET,
    token: process.env.GOOGLE_DRIVE_TOKEN_PATH
  };

  const tokenPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "homely-drive-")), "token.json");
  process.env.GOOGLE_DRIVE_ENABLED = "false";
  process.env.GOOGLE_CLIENT_ID = "";
  process.env.GOOGLE_CLIENT_SECRET = "";
  process.env.GOOGLE_DRIVE_TOKEN_PATH = tokenPath;

  const { GoogleDriveIntegration } = await import("../src/integrations/googleDrive.js");
  const drive = new GoogleDriveIntegration();
  assert.equal(drive.status.available, false);
  assert.equal(drive.status.connected, false);
  assert.equal(fs.existsSync(tokenPath), false);

  if (previous.enabled === undefined) delete process.env.GOOGLE_DRIVE_ENABLED; else process.env.GOOGLE_DRIVE_ENABLED = previous.enabled;
  if (previous.id === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = previous.id;
  if (previous.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = previous.secret;
  if (previous.token === undefined) delete process.env.GOOGLE_DRIVE_TOKEN_PATH; else process.env.GOOGLE_DRIVE_TOKEN_PATH = previous.token;
});
