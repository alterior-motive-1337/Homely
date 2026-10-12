import assert from "node:assert/strict";
import test from "node:test";
import { RequestLimiter } from "../src/security/traffic.js";
import { createTestDatabase } from "./helpers.js";
import { migrate } from "../src/db.js";
import { seedDemo } from "../src/seed.js";
import { runInHome } from "../src/security/homeScope.js";
import { startUpload, HOME_STORAGE_BYTES } from "../src/evidence/storage.js";
import { DomainError } from "../src/domain/transactions.js";

test("per-key throttling does not punish other identities and resets on window expiry",()=>{
  let now=0;
  const limiter=new RequestLimiter(4,()=>now);
  limiter.enforce("a",2,1000);limiter.enforce("a",2,1000);
  assert.throws(()=>limiter.enforce("a",2,1000),(error:unknown)=>error instanceof DomainError&&error.status===429);
  assert.doesNotThrow(()=>limiter.enforce("b",2,1000));
  now=1000;
  assert.doesNotThrow(()=>limiter.enforce("a",2,1000));
});
test("household storage reserve counts active uploads atomically",()=>{
  const db=createTestDatabase();migrate(db);seedDemo(db);
  try{
    const home="home-hawthorn";
    db.prepare("INSERT INTO file_uploads(id,file_name,mime_type,content,created_at,expected_bytes,received_bytes,completed,home_id) VALUES(?,?,?,?,?,?,0,0,?)")
      .run("upload-reserved", "reserved.bin","application/octet-stream",Buffer.alloc(0),new Date().toISOString(),HOME_STORAGE_BYTES-1_000_000,home);
    assert.throws(()=>runInHome(home,()=>startUpload(db,{name:"another.mp4",mimeType:"video/mp4",size:1_000_001})),
      (error:unknown)=>error instanceof DomainError&&error.status===413);
    assert.doesNotThrow(()=>runInHome(home,()=>startUpload(db,{name:"small.mp4",mimeType:"video/mp4",size:1_000_000})));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM file_uploads WHERE home_id=?").get(home)?.n,2);
  }finally{db.close()}
});
