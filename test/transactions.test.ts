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

test("committed issue reports are permanent history", () => {
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

  assert.throws(
    () => undoTransaction(db, String(proposal.transaction?.id)),
    /Issue records are permanent/
  );
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM issues").get()?.count ?? 0), before + 1);
  assert.equal(
    db.prepare("SELECT status FROM transactions WHERE id = ?").get(String(proposal.transaction?.id))?.status,
    "COMMITTED"
  );
  db.close();
});

test("repair records are permanent history", () => {
  const db = demoDb();
  const proposal = proposeTransaction(db, {
    actionType: "RECORD_REPAIR",
    reason: "Record completed kitchen tap repair.",
    payload: {
      assetId: "asset-tap",
      title: "Replace tap cartridge",
      repairDate: "2026-10-04",
      costCents: 45000,
      contractor: "Demo Plumbing",
      outcome: "Pressure restored."
    }
  });

  commitTransaction(db, String(proposal.transaction?.id));
  assert.equal(
    Number(db.prepare("SELECT COUNT(*) AS count FROM repairs WHERE title = 'Replace tap cartridge'").get()?.count ?? 0),
    1
  );
  assert.throws(
    () => undoTransaction(db, String(proposal.transaction?.id)),
    /Repair records are permanent/
  );
  assert.equal(
    Number(db.prepare("SELECT COUNT(*) AS count FROM repairs WHERE title = 'Replace tap cartridge'").get()?.count ?? 0),
    1
  );
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
  assert.equal(attached?.web_view_link, "https://drive.google.com/file/d/drive-file-123/view");

  undoTransaction(db, String(proposal.transaction?.id));
  assert.equal(
    Number(db.prepare("SELECT COUNT(*) AS count FROM documents WHERE provider_file_id = 'drive-file-123'").get()?.count ?? 0),
    0
  );
  db.close();
});


test("Drive evidence can link to issue and repair with provenance", () => {
  const db = demoDb();

  const repairProposal = proposeTransaction(db, {
    actionType: "RECORD_REPAIR",
    reason: "Record the repair that resolved the historical tap issue.",
    payload: {
      assetId: "asset-tap",
      issueId: "issue-tap-2025",
      title: "Tap aerator service",
      repairDate: "2025-11-06",
      costCents: 25000,
      contractor: "Mokoena Plumbing",
      outcome: "Sediment removed and pressure restored."
    }
  });
  commitTransaction(db, String(repairProposal.transaction?.id));
  const repair = db.prepare("SELECT * FROM repairs WHERE title = 'Tap aerator service'").get();
  assert.ok(repair?.id);

  const evidence = proposeTransaction(db, {
    actionType: "ATTACH_DOCUMENT",
    reason: "Attach the repair invoice as historical evidence.",
    payload: {
      issueId: "issue-tap-2025",
      repairId: String(repair?.id),
      title: "Tap repair invoice",
      documentType: "INVOICE",
      providerFileId: "drive-tap-invoice",
      mimeType: "application/pdf",
      webViewLink: "https://drive.google.com/file/d/drive-tap-invoice/view",
      sourceUrl: "https://drive.google.com/file/d/drive-tap-invoice/view",
      provenance: "Selected by homeowner from Google Drive.",
      occurredAt: "2025-11-06",
      evidenceReason: "Invoice proving the completed repair and cost.",
      evidenceStatus: "REFERENCE"
    }
  });
  const evidenceTxId = String(evidence.transaction?.id);
  commitTransaction(db, evidenceTxId);

  const document = db.prepare("SELECT * FROM documents WHERE provider_file_id = 'drive-tap-invoice'").get();
  assert.equal(document?.asset_id, "asset-tap");
  assert.equal(document?.issue_id, "issue-tap-2025");
  assert.equal(document?.repair_id, repair?.id);
  assert.equal(document?.provenance, "Selected by homeowner from Google Drive.");
  assert.equal(document?.occurred_at, "2025-11-06T12:00:00.000Z");
  assert.equal(document?.evidence_reason, "Invoice proving the completed repair and cost.");
  assert.equal(document?.evidence_status, "REFERENCE");

  undoTransaction(db, evidenceTxId);
  assert.equal(
    Number(db.prepare("SELECT COUNT(*) AS count FROM documents WHERE provider_file_id = 'drive-tap-invoice'").get()?.count ?? 0),
    0
  );
  db.close();
});

test("web links can be saved as contextual evidence without Drive", () => {
  const db = demoDb();
  const proposal = proposeTransaction(db, {
    actionType: "ATTACH_DOCUMENT",
    reason: "Save the inverter manual source page.",
    payload: {
      assetId: "asset-inverter",
      title: "Sunsynk inverter manual source",
      documentType: "MANUAL",
      provider: "LOCAL",
      sourceUrl: "https://example.com/inverter-manual",
      webViewLink: "https://example.com/inverter-manual",
      mimeType: "text/uri-list",
      occurredAt: "2026-10-04",
      provenance: "Saved directly by homeowner in Homely.",
      evidenceReason: "Reference manual for future troubleshooting.",
      evidenceStatus: "REFERENCE"
    }
  });

  const txId = String(proposal.transaction?.id);
  commitTransaction(db, txId);
  const document = db.prepare("SELECT * FROM documents WHERE title = 'Sunsynk inverter manual source'").get();
  assert.equal(document?.provider, "LOCAL");
  assert.equal(document?.asset_id, "asset-inverter");
  assert.equal(document?.source_url, "https://example.com/inverter-manual");
  assert.equal(document?.evidence_status, "REFERENCE");

  undoTransaction(db, txId);
  assert.equal(
    Number(db.prepare("SELECT COUNT(*) AS count FROM documents WHERE title = 'Sunsynk inverter manual source'").get()?.count ?? 0),
    0
  );
  db.close();
});

test("project creation and status changes are transactional and reversible", () => {
  const db = demoDb();

  const created = proposeTransaction(db, {
    actionType: "CREATE_PROJECT",
    reason: "Plan inverter battery expansion.",
    payload: {
      title: "Battery expansion",
      description: "Add storage capacity before summer outages.",
      status: "ACTIVE",
      startDate: "2026-10-10",
      targetDate: "2026-12-15",
      budgetCents: 2500000
    }
  });

  const createdTxId = String(created.transaction?.id);
  commitTransaction(db, createdTxId);

  const project = db.prepare("SELECT * FROM projects WHERE title = 'Battery expansion'").get();
  assert.equal(project?.status, "ACTIVE");
  assert.equal(project?.budget_cents, 2500000);

  const statusChange = proposeTransaction(db, {
    actionType: "UPDATE_PROJECT_STATUS",
    reason: "Project work has finished.",
    payload: {
      projectId: String(project?.id),
      status: "COMPLETE",
      completedAt: "2026-12-01",
      note: "Installation signed off."
    }
  });

  const statusTxId = String(statusChange.transaction?.id);
  commitTransaction(db, statusTxId);
  const completed = db.prepare("SELECT * FROM projects WHERE id = ?").get(String(project?.id));
  assert.equal(completed?.status, "COMPLETE");
  assert.equal(completed?.completed_at, "2026-12-01");

  undoTransaction(db, statusTxId);
  const restored = db.prepare("SELECT * FROM projects WHERE id = ?").get(String(project?.id));
  assert.equal(restored?.status, "ACTIVE");
  assert.equal(restored?.completed_at, null);

  undoTransaction(db, createdTxId);
  assert.equal(
    Number(db.prepare("SELECT COUNT(*) AS count FROM projects WHERE id = ?").get(String(project?.id))?.count ?? 0),
    0
  );
  db.close();
});
