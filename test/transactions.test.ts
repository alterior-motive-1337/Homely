import assert from "node:assert/strict";
import test from "node:test";
import { migrate, openDatabase } from "../src/db.js";
import { getAsset, listMaintenanceTasks } from "../src/domain/repository.js";
import { commitTransaction, previewAction, undoTransaction } from "../src/domain/transactions.js";
import { seedDemo } from "../src/seed.js";

function database() {
  const db = openDatabase(":memory:");
  migrate(db);
  seedDemo(db);
  return db;
}

test("maintenance action is invisible until approved and reversible after commit", () => {
  const db = database();
  const proposal = previewAction(db, {
    type: "CREATE_MAINTENANCE_TASK",
    assetId: "asset-camera-4",
    title: "Inspect Camera 4 network path",
    dueAt: "2026-10-03",
    reason: "Repeated disconnects suggest the network path should be inspected."
  });

  assert.equal(proposal?.status, "PROPOSED");
  assert.equal(listMaintenanceTasks(db).length, 0);

  const committed = commitTransaction(db, String(proposal?.id));
  assert.equal(committed?.status, "COMMITTED");
  assert.equal(listMaintenanceTasks(db).length, 1);

  const reversed = undoTransaction(db, String(proposal?.id));
  assert.equal(reversed?.status, "REVERSED");
  assert.equal(listMaintenanceTasks(db).length, 0);

  const audit = db.prepare("SELECT COUNT(*) AS count FROM timeline_events WHERE transaction_id = ?")
    .get(String(proposal?.id));
  assert.equal(Number(audit?.count), 2);
  db.close();
});

test("reported issue changes deterministic health only after approval and undo restores it", () => {
  const db = database();
  const before = getAsset(db, "asset-irrigation");
  assert.equal(before?.health, "UNKNOWN");

  const proposal = previewAction(db, {
    type: "REPORT_ISSUE",
    assetId: "asset-irrigation",
    title: "Controller fails to power on",
    severity: "HIGH",
    description: "Display remains dark after supply is confirmed."
  });

  assert.equal(getAsset(db, "asset-irrigation")?.health, "UNKNOWN");

  commitTransaction(db, String(proposal?.id));
  assert.equal(getAsset(db, "asset-irrigation")?.health, "DEGRADED");

  undoTransaction(db, String(proposal?.id));
  assert.equal(getAsset(db, "asset-irrigation")?.health, "UNKNOWN");
  db.close();
});
