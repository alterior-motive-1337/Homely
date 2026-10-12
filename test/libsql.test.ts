import assert from "node:assert/strict";
import test from "node:test";
import Database from "libsql";
import { initializeDatabase, migrate, type HomelyDatabase } from "../src/db.js";
import { seedDemo } from "../src/seed.js";
import { listIssues, listRepairs } from "../src/domain/repository.js";
import { proposeTransaction, commitTransaction, undoTransaction } from "../src/domain/transactions.js";

test("libSQL supports Homely migrations and permanent issue/repair transactions", () => {
  const db = initializeDatabase(new Database(":memory:") as unknown as HomelyDatabase);
  try {
    migrate(db); seedDemo(db);
    const before = listIssues(db).length;
    const issue = proposeTransaction(db, { actionType: "REPORT_ISSUE", reason: "Driver compatibility check", payload: {
      assetId: "asset-tap", title: "Driver test issue", severity: "MEDIUM"
    } });
    assert.equal(listIssues(db).length, before);
    commitTransaction(db, String(issue.transaction?.id));
    assert.equal(listIssues(db).length, before + 1);
    assert.throws(() => undoTransaction(db, String(issue.transaction?.id)), /permanent/);
    const repair = proposeTransaction(db, { actionType: "RECORD_REPAIR", reason: "Driver compatibility check", payload: {
      assetId: "asset-tap", issueId: listIssues(db).find((row) => row.title === "Driver test issue")?.id, title: "Driver test repair", repairDate: "2026-10-12", costCents: 45000
    } });
    commitTransaction(db, String(repair.transaction?.id));
    assert.equal(listRepairs(db).find((row) => row.title === "Driver test repair")?.cost_cents, 45000);
    assert.throws(() => undoTransaction(db, String(repair.transaction?.id)), /permanent/);
  } finally { db.close(); }
});
