import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { createTestDatabase } from "./helpers.js";
import { migrate } from "../src/db.js";
import { seedDemo } from "../src/seed.js";
import { runInHome } from "../src/security/homeScope.js";
import type { AuthUser } from "../src/security/googleAuth.js";
import { homeSnapshot, streamHomeArchive } from "../src/domain/exportHome.js";
import { startUpload, appendUploadChunk, finishUpload } from "../src/evidence/storage.js";
import { proposeTransaction, commitTransaction, DomainError } from "../src/domain/transactions.js";

const own:AuthUser={id:"owner-id",email:"owner@example.test",name:"Owner",homeId:"home-hawthorn",role:"OWNER"};
test("owner exports full structured history and original Turso chunks in tar, never other homes",async()=>{
  const db=createTestDatabase();migrate(db);seedDemo(db);
  const raw=Buffer.from("An exact original file, not extracted text.");
  try{
    const upload=runInHome(own.homeId,()=>startUpload(db,{name:"receipt.txt",mimeType:"text/plain",size:raw.length}));
    runInHome(own.homeId,()=>appendUploadChunk(db,upload.id,0,raw));
    runInHome(own.homeId,()=>finishUpload(db,upload.id));
    const proposal=runInHome(own.homeId,()=>proposeTransaction(db,{
      actionType:"ATTACH_DOCUMENT",reason:"Test original evidence archive",
      payload:{title:"Receipt",documentType:"RECEIPT",provider:"LOCAL",uploadId:upload.id}
    }));
    runInHome(own.homeId,()=>commitTransaction(db,String(proposal.transaction?.id)));
    const snapshot=homeSnapshot(db,own.homeId);
    assert.equal(snapshot.format,"homely-export-v1");
    assert.equal(snapshot.uploads.length,1);
    assert.equal((snapshot.tables.documents as unknown[]).length,4);
    const now=new Date().toISOString();
    db.prepare("INSERT INTO homes(id,name,address_label,created_at,updated_at) VALUES(?,?,NULL,?,?)")
      .run("home-other","Other household",now,now);
    const other=homeSnapshot(db,"home-other");
    assert.equal((other.tables.documents as unknown[]).length,0);
    assert.equal(other.uploads.length,0);
    const denied={...own,role:"VIEWER" as const};
    await assert.rejects(
      streamHomeArchive(db,denied,{} as http.ServerResponse),
      (e:unknown)=>e instanceof DomainError&&e.status===403
    );
    const server=http.createServer((_req,res)=>{
      void streamHomeArchive(db,own,res).catch(e=>{console.error(e);res.destroy()});
    });
    server.listen(0,"127.0.0.1");await once(server,"listening");
    const address=server.address();
    if(!address||typeof address==="string")throw Error("No port");
    try{
      const response=await fetch("http://127.0.0.1:"+address.port);
      assert.equal(response.status,200);
      assert.equal(response.headers.get("content-type"),"application/x-tar");
      const tar=Buffer.from(await response.arrayBuffer());
      assert.equal(tar.subarray(0,11).toString("utf8").replace(/\0/g,""),"homely.json");
      const metadataSize=parseInt(tar.subarray(124,136).toString("ascii").replace(/\0/g,"").trim(),8);
      const metadata=JSON.parse(tar.subarray(512,512+metadataSize).toString("utf8"));
      assert.equal(metadata.homeId,own.homeId);
      const fileOffset=512+Math.ceil(metadataSize/512)*512;
      assert.ok(tar.subarray(fileOffset,fileOffset+100).toString("utf8").includes(upload.id));
      assert.deepEqual(tar.subarray(fileOffset+512,fileOffset+512+raw.length),raw);
      assert.equal(tar.subarray(tar.length-1024).equals(Buffer.alloc(1024)),true);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
  }finally{db.close()}
});
