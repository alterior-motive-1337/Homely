import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "libsql";
import { migrate, type HomelyDatabase } from "../src/db.js";
import { hasHome, seedDemo } from "../src/seed.js";
import { commitTransaction, proposeTransaction, undoTransaction } from "../src/domain/transactions.js";
import { startUpload, appendUploadChunk, finishUpload, readStoredFile } from "../src/evidence/storage.js";

test("HTTP driver migrations, seeding and approval/undo retain atomic transactions", { timeout: 30_000 }, async () => {
  const child = fork(new URL("./hrana-server.ts", import.meta.url), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let db: HomelyDatabase | undefined;
  const dir = fs.mkdtempSync(path.join(tmpdir(), "homely-remote-migration-"));
  try {
    const [{ port }] = await once(child, "message") as [{ port: number }];
    db = new Database(`http://127.0.0.1:${port}`) as unknown as HomelyDatabase;
    // Exercise the same Hrana transaction path after the replica's local setup.
    db.exec("CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
    migrate(db);
    migrate(db); // Restarting must skip applied migrations without changing records.
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()?.count, 11);
    seedDemo(db);
    assert.ok(hasHome(db));
    const proposal = proposeTransaction(db, { actionType: "COMPLETE_MAINTENANCE", reason: "HTTP transaction check",
      payload: { maintenanceId: "maint-gate", completedAt: "2026-10-01" } });
    commitTransaction(db, String(proposal.transaction?.id));
    assert.equal(db.prepare("SELECT next_due_at FROM maintenance_rules WHERE id = 'maint-gate'").get()?.next_due_at, "2027-03-30");
    undoTransaction(db, String(proposal.transaction?.id));
    assert.equal(db.prepare("SELECT next_due_at FROM maintenance_rules WHERE id = 'maint-gate'").get()?.next_due_at, "2026-10-22");

    // Exercise BLOBs over the HTTP driver, not just local SQLite.
    const sample=Buffer.alloc(256_000,73);
    const upload=startUpload(db,{name:"test-clip.mp4",mimeType:"video/mp4",size:sample.length});
    appendUploadChunk(db,upload.id,0,sample);
    finishUpload(db,upload.id);
    const evidence=proposeTransaction(db,{actionType:"ATTACH_DOCUMENT",reason:"Remote media check",payload:{
      title:"Test clip",documentType:"VIDEO",provider:"LOCAL",uploadId:upload.id
    }});
    commitTransaction(db,String(evidence.transaction?.id));
    const documentId=String(db.prepare("SELECT document_id FROM file_uploads WHERE id=?").get(upload.id)?.document_id);
    assert.deepEqual(readStoredFile(db,documentId,300_000),sample);

    fs.writeFileSync(path.join(dir, "007_broken.sql"), "CREATE TABLE rolled_back(id TEXT); INSERT INTO missing_table VALUES (1);");
    assert.throws(() => migrate(db!, dir), /007_broken.sql/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'rolled_back'").get()?.count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '007_broken.sql'").get()?.count, 0);
    assert.ok(hasHome(db));
  } finally {
    db?.close();
    const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
