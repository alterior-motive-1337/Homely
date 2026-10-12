import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../src/db.js";
import { createTestDatabase } from "./helpers.js";
import { seedDemo } from "../src/seed.js";
import { runInHome } from "../src/security/homeScope.js";
import { getAsset, getOverview, listAssets, listIssues, listCharges, listDocuments, listProjects } from "../src/domain/repository.js";
import { proposeTransaction, commitTransaction, getTransaction, undoTransaction, DomainError } from "../src/domain/transactions.js";
import { startUpload, appendUploadChunk, finishUpload, getStoredFile } from "../src/evidence/storage.js";
import { executeHomelyTool } from "../src/tools/homelyTools.js";

test("two households cannot read or mutate one another's records, uploads, proposals or history",async()=>{
  const db=createTestDatabase();migrate(db);seedDemo(db);
  const homeA="home-hawthorn",homeB="home-independent-test";
  const now=new Date().toISOString();
  db.prepare("INSERT INTO homes(id,name,address_label,created_at,updated_at) VALUES(?,?,NULL,?,?)")
    .run(homeB,"Independent household",now,now);
  db.prepare("INSERT INTO systems(id,home_id,name,category,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run("system-independent",homeB,"Appliances","APPLIANCES",1,now,now);
  assert.equal(runInHome(homeA,()=>listAssets(db).length),16);
  assert.equal(runInHome(homeB,()=>listAssets(db).length),0);
  assert.equal(runInHome(homeB,()=>listIssues(db).length),0);
  assert.equal(runInHome(homeB,()=>listProjects(db).length),0);
  assert.equal(runInHome(homeB,()=>listDocuments(db).length),0);
  assert.equal(runInHome(homeB,()=>listCharges(db).length),0);
  assert.equal(runInHome(homeB,()=>getOverview(db).home?.id),homeB);
  assert.equal(runInHome(homeB,()=>getAsset(db,"asset-inverter")),null);
  assert.throws(()=>runInHome(homeB,()=>proposeTransaction(db,{
    actionType:"UPDATE_ASSET",reason:"Cross-home attempt",
    payload:{assetId:"asset-inverter",systemId:"sys-solar",name:"Owned elsewhere",category:"Inverter"}
  })),/Asset not found/);
  assert.throws(()=>runInHome(homeB,()=>proposeTransaction(db,{
    actionType:"CREATE_ASSET",reason:"Cross-home system",
    payload:{systemId:"sys-solar",name:"Intruding appliance",category:"Appliance"}
  })),/System not found/);
  const proposal=runInHome(homeA,()=>proposeTransaction(db,{
    actionType:"CREATE_CHARGE",reason:"Household A bill",
    payload:{name:"Water",category:"Utilities",amountCents:5000,billingCycle:"MONTHLY"}
  }));
  const transactionId=String(proposal.transaction?.id);
  assert.equal(runInHome(homeB,()=>getTransaction(db,transactionId)),null);
  assert.throws(()=>runInHome(homeB,()=>commitTransaction(db,transactionId)),/Transaction not found/);
  runInHome(homeA,()=>commitTransaction(db,transactionId));
  assert.equal(runInHome(homeB,()=>listCharges(db).length),0);
  assert.throws(()=>runInHome(homeB,()=>undoTransaction(db,transactionId)),/Transaction not found/);

  const bytes=Buffer.from("household A private receipt");
  const staged=runInHome(homeA,()=>startUpload(db,{name:"receipt.txt",mimeType:"text/plain",size:bytes.length}));
  runInHome(homeA,()=>appendUploadChunk(db,staged.id,0,bytes));
  runInHome(homeA,()=>finishUpload(db,staged.id));
  assert.throws(()=>runInHome(homeB,()=>proposeTransaction(db,{
    actionType:"ATTACH_DOCUMENT",reason:"Steal A upload",
    payload:{title:"Not mine",documentType:"RECEIPT",provider:"LOCAL",uploadId:staged.id}
  })),/Staged upload is missing/);
  const attached=runInHome(homeA,()=>proposeTransaction(db,{
    actionType:"ATTACH_DOCUMENT",reason:"Store A private receipt",
    payload:{title:"A receipt",documentType:"RECEIPT",provider:"LOCAL",uploadId:staged.id}
  }));
  runInHome(homeA,()=>commitTransaction(db,String(attached.transaction?.id)));
  const docId=String(db.prepare("SELECT document_id FROM file_uploads WHERE id=?").get(staged.id)?.document_id);
  assert.equal(runInHome(homeA,()=>getStoredFile(db,docId).length),bytes.length);
  assert.throws(()=>runInHome(homeB,()=>getStoredFile(db,docId)),(e:unknown)=>e instanceof DomainError&&e.status===404);
  assert.throws(()=>runInHome(homeB,()=>executeHomelyTool(db,"get_document",{documentId:docId})),/Document not found/);
  assert.equal(runInHome(homeB,()=>listDocuments(db).length),0);

  const concurrent=await Promise.all([
    runInHome(homeA,async()=>{await Promise.resolve();return getOverview(db).home?.id}),
    runInHome(homeB,async()=>{await Promise.resolve();return getOverview(db).home?.id})
  ]);
  assert.deepEqual(concurrent,[homeA,homeB]);
  db.close();
});
