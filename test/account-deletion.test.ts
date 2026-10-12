import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase } from "./helpers.js";
import { migrate } from "../src/db.js";
import { seedDemo } from "../src/seed.js";
import type { AuthUser } from "../src/security/googleAuth.js";
import { deleteAccount } from "../src/domain/deleteAccount.js";
import { DomainError } from "../src/domain/transactions.js";

test("account deletion requires confirmation and never silently destroys a shared home",()=>{
  const db=createTestDatabase();migrate(db);seedDemo(db);
  const now=new Date().toISOString();
  const owner:AuthUser={id:"owner-erase",email:"owner@home.test",name:"Owner",homeId:"home-hawthorn",role:"OWNER"};
  const member:AuthUser={id:"viewer-erase",email:"viewer@home.test",name:"Viewer",homeId:"home-hawthorn",role:"VIEWER"};
  try{
    for(const user of [owner,member])db.prepare("INSERT INTO auth_users(id,google_subject,email,display_name,created_at,last_login_at) VALUES(?,?,?,?,?,?)")
      .run(user.id,"sub-"+user.id,user.email,user.name,now,now);
    db.prepare("INSERT INTO home_memberships(home_id,user_id,role,joined_at) VALUES(?,?,?,?)")
      .run(owner.homeId,owner.id,"OWNER",now);
    db.prepare("INSERT INTO home_memberships(home_id,user_id,role,joined_at) VALUES(?,?,?,?)")
      .run(member.homeId,member.id,"VIEWER",now);
    assert.throws(()=>deleteAccount(db,owner,"something else"),(e:unknown)=>e instanceof DomainError&&e.status===400);
    assert.throws(()=>deleteAccount(db,owner,"DELETE MY ACCOUNT"),(e:unknown)=>e instanceof DomainError&&e.status===409);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM homes").get()?.n,1);
    db.prepare("DELETE FROM home_memberships WHERE home_id=? AND user_id=?").run(member.homeId,member.id);
    assert.deepEqual(deleteAccount(db,owner,"DELETE MY ACCOUNT"),{deleted:true});
    for(const table of ["homes","assets","issues","repairs","documents","timeline_events","transactions","file_uploads","home_memberships"]){
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM "+table).get()?.n,0,table+" should be erased");
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_users").get()?.n,1,"unrelated account is retained");
  }finally{db.close()}
});

test("a viewer may delete their account without removing someone else's household",()=>{
  const db=createTestDatabase();migrate(db);seedDemo(db);
  const now=new Date().toISOString();
  const user:AuthUser={id:"viewer-left",email:"viewer@home.test",name:"Viewer",homeId:"home-hawthorn",role:"VIEWER"};
  try{
    db.prepare("INSERT INTO auth_users(id,google_subject,email,display_name,created_at,last_login_at) VALUES(?,?,?,?,?,?)")
      .run(user.id,"sub-"+user.id,user.email,user.name,now,now);
    db.prepare("INSERT INTO home_memberships(home_id,user_id,role,joined_at) VALUES(?,?,?,?)")
      .run(user.homeId,user.id,"VIEWER",now);
    assert.deepEqual(deleteAccount(db,user,"DELETE MY ACCOUNT"),{deleted:true});
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM homes").get()?.n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM assets").get()?.n,16);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_users").get()?.n,0);
  }finally{db.close()}
});
