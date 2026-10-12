import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { migrate } from "../src/db.js";
import { createTestDatabase } from "./helpers.js";
import { seedDemo } from "../src/seed.js";
import { proposeTransaction, commitTransaction, DomainError } from "../src/domain/transactions.js";
import { startUpload, appendUploadChunk, finishUpload, getStoredFile, readStoredFile, streamStoredFile, MAX_FILE_BYTES } from "../src/evidence/storage.js";
import { analyzeDocument } from "../src/evidence/analyze.js";

test("50MB cap, ordered chunks, approval gating and ranged video playback",async()=>{
  const db=createTestDatabase();migrate(db);seedDemo(db);
  assert.throws(()=>startUpload(db,{name:"too-big.mp4",mimeType:"video/mp4",size:MAX_FILE_BYTES+1}),DomainError);
  const first=Buffer.alloc(1_000_000,65),tail=Buffer.from("XYZ789");
  const upload=startUpload(db,{name:"clip.mp4",mimeType:"video/mp4",size:first.length+tail.length});
  assert.throws(()=>appendUploadChunk(db,upload.id,1,tail),DomainError);
  appendUploadChunk(db,upload.id,0,first);
  assert.throws(()=>finishUpload(db,upload.id),DomainError);
  assert.throws(()=>proposeTransaction(db,{actionType:"ATTACH_DOCUMENT",reason:"Store test video",payload:{title:"Clip",documentType:"VIDEO",provider:"LOCAL",uploadId:upload.id}}),DomainError);
  appendUploadChunk(db,upload.id,1,tail);
  finishUpload(db,upload.id);
  const preview=proposeTransaction(db,{actionType:"ATTACH_DOCUMENT",reason:"Save video clip",payload:{title:"Clip",documentType:"VIDEO",provider:"LOCAL",uploadId:upload.id}});
  assert.equal(db.prepare("SELECT document_id FROM file_uploads WHERE id=?").get(upload.id)?.document_id,null);
  commitTransaction(db,String(preview.transaction?.id));
  const doc=String(db.prepare("SELECT document_id FROM file_uploads WHERE id=?").get(upload.id)?.document_id);
  assert.equal(getStoredFile(db,doc).length,first.length+tail.length);
  assert.deepEqual(readStoredFile(db,doc,MAX_FILE_BYTES),Buffer.concat([first,tail]));
  const server=http.createServer((req,res)=>{void streamStoredFile(db,doc,req.headers.range,res)});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();if(!address||typeof address==="string")throw Error("port missing");
  try{
    const response=await fetch("http://127.0.0.1:"+address.port,{headers:{range:"bytes=999998-1000002"}});
    assert.equal(response.status,206);
    assert.equal(response.headers.get("content-range"),"bytes 999998-1000002/1000006");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString("utf8"),"AAXYZ");
  }finally{await new Promise<void>((done)=>server.close(()=>done()));db.close()}
});

test("cached multimedia analysis uses no repeat Groq calls",async()=>{
  const db=createTestDatabase();migrate(db);seedDemo(db);
  const buffer=Buffer.from("example evidence text");
  const upload=startUpload(db,{name:"receipt.txt",mimeType:"text/plain",size:buffer.length});
  appendUploadChunk(db,upload.id,0,buffer);finishUpload(db,upload.id);
  const proposal=proposeTransaction(db,{actionType:"ATTACH_DOCUMENT",reason:"Save receipt",payload:{title:"Receipt",documentType:"RECEIPT",provider:"LOCAL",uploadId:upload.id}});
  commitTransaction(db,String(proposal.transaction?.id));
  const doc=String(db.prepare("SELECT document_id FROM file_uploads WHERE id=?").get(upload.id)?.document_id);
  const first=await analyzeDocument(db,doc);
  const second=await analyzeDocument(db,doc);
  assert.equal(first.cached,false);assert.equal(second.cached,true);
  assert.equal(second.text,"example evidence text");
  db.close();
});
