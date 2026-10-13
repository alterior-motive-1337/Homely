import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase } from "./helpers.js";
import { migrate } from "../src/db.js";
import { seedDemo } from "../src/seed.js";
import { openSampleHome } from "../src/domain/sampleHome.js";
import { runInHome } from "../src/security/homeScope.js";
import { listAssets, listIssues, listDocuments } from "../src/domain/repository.js";
import { readStoredFile } from "../src/evidence/storage.js";
import type { AuthUser } from "../src/security/googleAuth.js";

function setup(){
  const db=createTestDatabase();migrate(db);seedDemo(db);
  const now=new Date().toISOString();
  for(const id of ["owner","other"]){
    db.prepare("INSERT INTO auth_users(id,google_subject,email,display_name,created_at,last_login_at) VALUES(?,?,?,?,?,?)")
      .run(id,id,id+"@example.invalid",id,now,now);
    db.prepare("INSERT INTO home_memberships(home_id,user_id,role,joined_at) VALUES(?,?,?,?)")
      .run("home-hawthorn",id,"OWNER",now);
  }
  const user:AuthUser={id:"owner",email:"owner@example.invalid",name:"Owner",homeId:"home-hawthorn",role:"OWNER"};
  return {db,user};
}

test("sample homes preserve real records, are private, and retain edits on repeated opening",()=>{
  const {db,user}=setup();
  try{
    const before=runInHome(user.homeId,()=>({assets:listAssets(db),issues:listIssues(db),documents:listDocuments(db)}));
    const sample=openSampleHome(db,user);
    assert.equal(sample.created,true);
    assert.notEqual(sample.homeId,user.homeId);
    const data=runInHome(sample.homeId,()=>({assets:listAssets(db) as Record<string,unknown>[],issues:listIssues(db),documents:listDocuments(db)}));
    assert.equal(data.assets.length,9);assert.equal(data.issues.length,6);assert.equal(data.documents.length,6);
    assert.equal(new Set(data.assets.map(a=>a.condition)).size,6);
    assert.equal(new Set(data.issues.map(i=>i.status)).size,6);
    for(const document of data.documents){
      const bytes=runInHome(sample.homeId,()=>readStoredFile(db,String(document.id),100_000));
      assert.ok(bytes.length>0);
      if(document.mime_type==="application/pdf")assert.equal(bytes.subarray(0,4).toString(),"%PDF");
      if(document.mime_type==="video/webm")assert.equal(bytes.subarray(0,4).toString("hex"),"1a45dfa3");
      assert.throws(()=>runInHome(user.homeId,()=>readStoredFile(db,String(document.id),100_000)),/not found/);
    }
    db.prepare("UPDATE assets SET name='Edited sample asset' WHERE id=?").run(String(data.assets[0]!.id));
    assert.deepEqual(openSampleHome(db,{...user,homeId:sample.homeId}),{homeId:sample.homeId,created:false});
    assert.equal(db.prepare("SELECT name FROM assets WHERE id=?").get(String(data.assets[0]!.id))?.name,"Edited sample asset");
    const other=openSampleHome(db,{...user,id:"other"});
    assert.notEqual(other.homeId,sample.homeId);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM home_memberships WHERE home_id=?").get(sample.homeId)?.n,1);
    assert.deepEqual(runInHome(user.homeId,()=>({assets:listAssets(db),issues:listIssues(db),documents:listDocuments(db)})),before);
  }finally{db.close()}
});

test("sample creation rejects nonowners and rolls back all writes on failure",()=>{
  const {db,user}=setup();
  try{
    for(const role of ["VIEWER","MEMBER"] as const)assert.throws(()=>openSampleHome(db,{...user,role}),/Only a household owner/);
    db.exec("CREATE TRIGGER fail_sample_upload BEFORE INSERT ON file_uploads BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
    assert.throws(()=>openSampleHome(db,user),/fixture failure/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sample_homes").get()?.n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM homes").get()?.n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM file_upload_chunks").get()?.n,0);
  }finally{db.close()}
});
