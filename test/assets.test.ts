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
  assert.ok(listAssets(db).some((a)=>String((a as Record<string,unknown>).name)==="Desk lamp" && String((a as Record<string,unknown>).condition)==="GOOD"));
  undoTransaction(db,id);
  assert.equal(listAssets(db).length,before);
  db.close();
});

test("approved asset updates are reversible and preserve the original fields", () => {
  const db=createTestDatabase();migrate(db);seedDemo(db);
  const asset=db.prepare("SELECT * FROM assets LIMIT 1").get();
  assert.ok(asset);
  const proposed=proposeTransaction(db,{actionType:"UPDATE_ASSET",reason:"Update inventory condition",payload:{
    assetId:String(asset.id),systemId:String(asset.system_id),name:String(asset.name),category:String(asset.category),
    condition:"FAIR",location:"Utility room",purchaseDate:"2026-09-10",purchaseCostCents:19900
  }});
  assert.equal(db.prepare("SELECT condition FROM assets WHERE id = ?").get(String(asset.id))?.condition,asset.condition);
  const id=String(proposed.transaction?.id);
  commitTransaction(db,id);
  assert.equal(db.prepare("SELECT condition FROM assets WHERE id = ?").get(String(asset.id))?.condition,"FAIR");
  undoTransaction(db,id);
  assert.equal(db.prepare("SELECT condition FROM assets WHERE id = ?").get(String(asset.id))?.condition,asset.condition);
  db.close();
});
