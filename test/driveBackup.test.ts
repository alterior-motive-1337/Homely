import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { GoogleDriveIntegration } from "../src/integrations/googleDrive.js";

test("Drive backup service can back up, lose and restore SQLite state", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "homely-recovery-"));
  const dbPath = path.join(tempDir, "homely.db");
  const remotePath = path.join(tempDir, "remote.db");

  process.env.HOMELY_DB_PATH = dbPath;
  process.env.BACKUP_ENABLED = "true";
  process.env.BACKUP_REQUIRED = "true";
  process.env.BACKUP_RETENTION = "12";

  const { DriveBackupService } = await import("../src/integrations/driveBackup.js");
  const { openDatabase } = await import("../src/db.js");

  const fakeDrive = {
    status: {
      enabled: true,
      available: true,
      configured: true,
      connected: true,
      credentialSource: "TEST",
      scope: "test"
    },
    async uploadBackup(filePath: string, fileName: string) {
      fs.copyFileSync(filePath, remotePath);
      return { id: "backup-1", name: fileName, createdTime: new Date().toISOString(), size: String(fs.statSync(filePath).size) };
    },
    async downloadLatestBackup(destinationPath: string) {
      if (!fs.existsSync(remotePath)) return null;
      fs.copyFileSync(remotePath, destinationPath);
      return { id: "backup-1", name: "homely-test.db", createdTime: new Date().toISOString(), size: String(fs.statSync(remotePath).size) };
    },
    async pruneBackups() {
      return 0;
    }
  } as unknown as GoogleDriveIntegration;

  const backups = new DriveBackupService(fakeDrive);
  const db = openDatabase();
  db.exec("CREATE TABLE cloud_test(value TEXT NOT NULL); INSERT INTO cloud_test(value) VALUES ('survived');");

  const uploaded = await backups.backupNow(db, "test");
  assert.ok(uploaded);
  assert.equal(fs.existsSync(remotePath), true);

  db.close();
  fs.rmSync(dbPath, { force: true });

  const restored = await backups.restoreIfDatabaseMissing();
  assert.ok(restored);
  assert.equal(fs.existsSync(dbPath), true);

  const recovered = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = recovered.prepare("SELECT value FROM cloud_test").get() as { value?: string } | undefined;
    assert.equal(row?.value, "survived");
  } finally {
    recovered.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
