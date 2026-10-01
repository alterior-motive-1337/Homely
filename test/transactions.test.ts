import assert from "node:assert/strict";
import test from "node:test";
import { migrate, openDatabase } from "../src/db.js";
import { seedDemo } from "../src/seed.js";
import { commitTransaction, proposeTransaction, undoTransaction } from "../src/domain/transactions.js";

function demoDb() {
  const db = openDatabase(":memory:");
  migrate(db);
  seedDemo(db);
  return db;
}

test("report issue is inert until commit and undo removes its state but keeps audit", () => {
  const db = demoDb();
  const before = Number(db.prepare("SELECT COUNT(*) AS count FROM issues").get()?.count ?? 0);

  const proposal = proposeTransaction(db, {
    actionType: "REPORT_ISSUE",
    reason: "Kitchen tap pressure has dropped again.",
    payload: {
      assetId: "asset-tap",
      title: "Kitchen tap losing pressure again",
      severity: "MEDIUM",
      description: "Pressure drops after about 30 seconds."
    }
  });

  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM issues").get()?.count ?? 0), before);
  assert.equal(proposal.transaction?.status, "PROPOSED");

  const committed = commitTransaction(db, String(proposal.transaction?.id));
  assert.equal(committed?.status, "COMMITTED");
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM issues").get()?.count ?? 0), before + 1);

  const result = undoTransaction(db, String(proposal.transaction?.id));
  assert.equal(result.original?.status, "REVERSED");
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM issues").get()?.count ?? 0), before);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM transactions").get()?.count ?? 0), 2);
  db.close();
});

test("completing recurring maintenance advances due date and undo restores it", () => {
  const db = demoDb();
  const before = db.prepare("SELECT * FROM maintenance_rules WHERE id = 'maint-gate'").get();

  const proposal = proposeTransaction(db, {
    actionType: "COMPLETE_MAINTENANCE",
    reason: "Gate inspection completed.",
    payload: {
      maintenanceId: "maint-gate",
      completedAt: "2026-10-01",
      note: "Motor and battery checked."
    }
  });

  commitTransaction(db, String(proposal.transaction?.id));
  const after = db.prepare("SELECT * FROM maintenance_rules WHERE id = 'maint-gate'").get();
  assert.equal(after?.last_completed_at, "2026-10-01");
  assert.equal(after?.next_due_at, "2027-03-30");

  undoTransaction(db, String(proposal.transaction?.id));
  const restored = db.prepare("SELECT * FROM maintenance_rules WHERE id = 'maint-gate'").get();
  assert.equal(restored?.last_completed_at, before?.last_completed_at);
  assert.equal(restored?.next_due_at, before?.next_due_at);
  db.close();
});


test("Drive document association is proposed, committed and reversible", () => {
  const db = demoDb();
  const before = Number(db.prepare("SELECT COUNT(*) AS count FROM documents").get()?.count ?? 0);

  const proposal = proposeTransaction(db, {
    actionType: "ATTACH_DOCUMENT",
    reason: "Homeowner selected the inverter warranty from Google Drive.",
    payload: {
      assetId: "asset-inverter",
      title: "Selected inverter warranty",
      documentType: "WARRANTY",
      providerFileId: "drive-file-123",
      mimeType: "text/plain",
      webViewLink: "https://drive.google.com/file/d/drive-file-123/view"
    }
  });

  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM documents").get()?.count ?? 0), before);
  commitTransaction(db, String(proposal.transaction?.id));

  const attached = db.prepare(
    "SELECT * FROM documents WHERE provider = 'GOOGLE_DRIVE' AND provider_file_id = 'drive-file-123'"
  ).get();
  assert.equal(attached?.asset_id, "asset-inverter");
  assert.equal(attached?.type, "WARRANTY");

  undoTransaction(db, String(proposal.transaction?.id));
  assert.equal(
    Number(db.prepare("SELECT COUNT(*) AS count FROM documents WHERE provider_file_id = 'drive-file-123'").get()?.count ?? 0),
    0
  );
  db.close();
});
