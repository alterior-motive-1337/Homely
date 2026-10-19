import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../src/db.js";
import { deleteDocument } from "../src/domain/deleteDocument.js";
import { commitTransaction, proposeTransaction, undoTransaction } from "../src/domain/transactions.js";
import { seedDemo } from "../src/seed.js";
import { runInHome } from "../src/security/homeScope.js";
import { createTestDatabase } from "./helpers.js";

function demoDb() {
  const db=createTestDatabase();
  migrate(db);
  seedDemo(db);
  return db;
}

test("eligible household records can be deleted with preview and restored from history",()=>{
  const db=demoDb();
  try{
    const system=db.prepare("SELECT id FROM systems LIMIT 1").get();
    const home=db.prepare("SELECT id FROM homes LIMIT 1").get();
    assert.ok(system&&home);
    const created=proposeTransaction(db,{actionType:"CREATE_ASSET",reason:"Create a removable test asset",payload:{
      systemId:String(system.id),name:"Delete test asset",category:"FURNITURE",condition:"GOOD"
    }});
    const assetCreation=String(created.transaction?.id);
    commitTransaction(db,assetCreation);
    const asset=db.prepare("SELECT id FROM assets WHERE name=?").get("Delete test asset");
    assert.ok(asset);

    const deletion=proposeTransaction(db,{actionType:"DELETE_RECORD",reason:"Remove test asset",payload:{
      entityType:"asset",entityId:String(asset.id)
    }});
    const deletionId=String(deletion.transaction?.id);
    assert.ok(db.prepare("SELECT id FROM assets WHERE id=?").get(String(asset.id)));
    commitTransaction(db,deletionId);
    assert.equal(db.prepare("SELECT id FROM assets WHERE id=?").get(String(asset.id)),undefined);
    undoTransaction(db,deletionId);
    assert.ok(db.prepare("SELECT id FROM assets WHERE id=?").get(String(asset.id)));

    db.prepare(`INSERT INTO charges(
      id,home_id,name,category,amount_cents,billing_cycle,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run("charge-delete-test",String(home.id),"Delete test charge","OTHER",1200,"MONTHLY","2026-10-01","2026-10-01");
    const chargeDeletion=proposeTransaction(db,{actionType:"DELETE_RECORD",reason:"Remove test charge",payload:{
      entityType:"charge",entityId:"charge-delete-test"
    }});
    const chargeDeletionId=String(chargeDeletion.transaction?.id);
    commitTransaction(db,chargeDeletionId);
    assert.equal(db.prepare("SELECT id FROM charges WHERE id=?").get("charge-delete-test"),undefined);
    undoTransaction(db,chargeDeletionId);
    assert.ok(db.prepare("SELECT id FROM charges WHERE id=?").get("charge-delete-test"));

    db.prepare(`INSERT INTO purchase_candidates(
      id,home_id,title,category,status,metadata_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run("purchase-delete-test",String(home.id),"Delete test purchase","OTHER","SAVED","{}","2026-10-01","2026-10-01");
    const purchaseDeletion=proposeTransaction(db,{actionType:"DELETE_RECORD",reason:"Remove test purchase",payload:{
      entityType:"purchase_candidate",entityId:"purchase-delete-test"
    }});
    const purchaseDeletionId=String(purchaseDeletion.transaction?.id);
    commitTransaction(db,purchaseDeletionId);
    assert.equal(db.prepare("SELECT id FROM purchase_candidates WHERE id=?").get("purchase-delete-test"),undefined);
    undoTransaction(db,purchaseDeletionId);
    assert.ok(db.prepare("SELECT id FROM purchase_candidates WHERE id=?").get("purchase-delete-test"));
  }finally{db.close()}
});

test("assets with household history cannot be deleted",()=>{
  const db=demoDb();
  try{
    assert.throws(()=>proposeTransaction(db,{actionType:"DELETE_RECORD",reason:"Attempt unsafe deletion",payload:{
      entityType:"asset",entityId:"asset-tap"
    }}),/linked records/);
  }finally{db.close()}
});

test("removing a file deletes its uploaded bytes and analysis but keeps permanent audit history",()=>{
  const db=demoDb();
  try{
    const home=db.prepare("SELECT id FROM homes LIMIT 1").get();
    assert.ok(home);
    db.prepare(`INSERT INTO documents(id,title,type,provider,created_at,updated_at,home_id)
      VALUES(?,?,?,?,?,?,?)`).run("document-delete-test","Delete test file","RECEIPT","LOCAL","2026-10-01","2026-10-01",String(home.id));
    db.prepare(`INSERT INTO file_uploads(
      id,file_name,mime_type,content,document_id,created_at,expected_bytes,received_bytes,completed,home_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run("upload-delete-test","receipt.txt","text/plain",Buffer.from("private bytes"),
      "document-delete-test","2026-10-01",13,13,1,String(home.id));
    db.prepare("INSERT INTO file_analysis(document_id,content_text,model,analyzed_at) VALUES(?,?,?,?)")
      .run("document-delete-test","private analysis","test-model","2026-10-01");

    assert.throws(()=>runInHome("home-not-authorized",()=>deleteDocument(db,"document-delete-test")),/File not found/);
    assert.ok(db.prepare("SELECT id FROM documents WHERE id=?").get("document-delete-test"));
    assert.deepEqual(runInHome(String(home.id),()=>deleteDocument(db,"document-delete-test")),{deleted:true});
    assert.equal(db.prepare("SELECT id FROM documents WHERE id=?").get("document-delete-test"),undefined);
    assert.equal(db.prepare("SELECT id FROM file_uploads WHERE id=?").get("upload-delete-test"),undefined);
    assert.equal(db.prepare("SELECT document_id FROM file_analysis WHERE document_id=?").get("document-delete-test"),undefined);
    const audit=db.prepare("SELECT action_type FROM transactions WHERE action_type='DELETE_DOCUMENT'").get();
    assert.equal(audit?.action_type,"DELETE_DOCUMENT");
    assert.throws(()=>undoTransaction(db,String(db.prepare("SELECT id FROM transactions WHERE action_type='DELETE_DOCUMENT'").get()?.id)),/Removed files cannot be restored/);
  }finally{db.close()}
});
