import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../src/db.js";
import { createTestDatabase } from "./helpers.js";
import { seedDemo } from "../src/seed.js";
import { commitTransaction, proposeTransaction, undoTransaction } from "../src/domain/transactions.js";
import { listAssets } from "../src/domain/repository.js";

test("registering a new appliance requires approval and preserves asset details", () => {
  const db=createTestDatabase();migrate(db);seedDemo(db);
  const system=db.prepare("SELECT id FROM systems LIMIT 1").get();
  assert.ok(system);
  const before=listAssets(db).length;
  const proposal=proposeTransaction(db,{actionType:"CREATE_ASSET",payload:{systemId:system.id,name:"Desk lamp",category:"FURNITURE",condition:"GOOD",location:"Study",purchaseDate:"2026-09-02",purchaseCostCents:45000},reason:"Record owned furniture"});
  assert.equal(listAssets(db).length,before);
  const id=String(proposal.transaction?.id);
  commitTransaction(db,id);
  assert.equal(listAssets(db).length,before+1);
  assert.ok(listAssets(db).some((a)=>a.name==="Desk lamp" && a.condition==="GOOD"));
  undoTransaction(db,id);
  assert.equal(listAssets(db).length,before);
  db.close();
});
