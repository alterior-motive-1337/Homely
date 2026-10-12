import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../src/db.js";
import { createTestDatabase } from "./helpers.js";
import { seedDemo } from "../src/seed.js";
import { proposeTransaction,commitTransaction,undoTransaction } from "../src/domain/transactions.js";

test("uploaded evidence is staged, approval-gated and linked to durable document", () => {
  const db=createTestDatabase();migrate(db);seedDemo(db);
  db.prepare("INSERT INTO file_uploads(id,file_name,mime_type,content,created_at) VALUES (?,?,?,?,?)").run("upload-1","receipt.txt","text/plain",Buffer.from("receipt"),new Date().toISOString());
  const p=proposeTransaction(db,{actionType:"ATTACH_DOCUMENT",reason:"Save receipt",payload:{title:"Receipt",documentType:"RECEIPT",provider:"LOCAL",uploadId:"upload-1",occurredAt:"2026-10-12"}});
  assert.equal(db.prepare("SELECT document_id FROM file_uploads WHERE id = ?").get("upload-1")?.document_id,null);
  commitTransaction(db,String(p.transaction?.id));
  const file=db.prepare("SELECT document_id,content FROM file_uploads WHERE id = ?").get("upload-1");
  assert.ok(file?.document_id);
  assert.equal(Buffer.from(file.content as Uint8Array).toString("utf8"),"receipt");
  const document=db.prepare("SELECT local_path FROM documents WHERE id = ?").get(String(file.document_id));
  assert.equal(document?.local_path,"/api/files/"+file.document_id);
  undoTransaction(db,String(p.transaction?.id));
  assert.equal(db.prepare("SELECT 1 FROM file_uploads WHERE id = ?").get("upload-1"),undefined);
  db.close();
});
