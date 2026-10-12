import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase } from "./helpers.js";
import { migrate } from "../src/db.js";
import { seedDemo } from "../src/seed.js";
import type { AuthUser } from "../src/security/googleAuth.js";
import { acceptInvite, inviteMember, listHouseholds, listInvitations, listMembers, removeMember, renameHome, revokeInvite } from "../src/domain/households.js";
import { DomainError } from "../src/domain/transactions.js";

test("email-bound invitations permit only the invited Google identity and can be revoked",()=>{
  const db=createTestDatabase();migrate(db);seedDemo(db);
  const now=new Date().toISOString();
  db.prepare("INSERT INTO auth_users(id,google_subject,email,display_name,created_at,last_login_at) VALUES(?,?,?,?,?,?)")
    .run("owner","google-owner","owner@test.example","Owner",now,now);
  db.prepare("INSERT INTO auth_users(id,google_subject,email,display_name,created_at,last_login_at) VALUES(?,?,?,?,?,?)")
    .run("member","google-member","member@test.example","Member",now,now);
  db.prepare("INSERT INTO auth_users(id,google_subject,email,display_name,created_at,last_login_at) VALUES(?,?,?,?,?,?)")
    .run("intruder","google-intruder","intruder@test.example","Intruder",now,now);
  db.prepare("INSERT INTO home_memberships(home_id,user_id,role,joined_at) VALUES(?,?,?,?)")
    .run("home-hawthorn","owner","OWNER",now);
  const owner:AuthUser={id:"owner",email:"owner@test.example",name:"Owner",homeId:"home-hawthorn",role:"OWNER"};
  const member:AuthUser={id:"member",email:"member@test.example",name:"Member",homeId:"another-home",role:"OWNER"};
  const intruder:AuthUser={id:"intruder",email:"intruder@test.example",name:"Intruder",homeId:"other-home",role:"OWNER"};
  try{
    const invite=inviteMember(db,owner,"MEMBER@test.example","VIEWER");
    assert.match(invite.token,/^[\w-]{43}$/);
    assert.equal(listInvitations(db,owner).length,1);
    assert.throws(()=>acceptInvite(db,intruder,invite.token),(err:unknown)=>err instanceof DomainError&&err.status===403);
    const accepted=acceptInvite(db,member,invite.token);
    assert.equal(accepted.homeId,"home-hawthorn");
    assert.equal(accepted.role,"VIEWER");
    assert.throws(()=>acceptInvite(db,member,invite.token),(err:unknown)=>err instanceof DomainError&&err.status===403);
    assert.equal(listInvitations(db,owner).length,0);
    assert.equal(listMembers(db,owner).length,2);
    assert.throws(()=>inviteMember(db,owner,"member@test.example","MEMBER"),/already a member/);
    assert.equal(listHouseholds(db,member).length,1);
    assert.throws(()=>removeMember(db,member,"owner"),(err:unknown)=>err instanceof DomainError&&err.status===403);
    assert.deepEqual(renameHome(db,owner,"The new name"),{id:"home-hawthorn",name:"The new name"});
    assert.deepEqual(removeMember(db,owner,"member"),{removed:true});
    assert.equal(listMembers(db,owner).length,1);
    const another=inviteMember(db,owner,"member@test.example","MEMBER");
    assert.deepEqual(revokeInvite(db,owner,another.id),{revoked:true});
    assert.throws(()=>acceptInvite(db,member,another.token),/expired or is addressed/);
    const expiring=inviteMember(db,owner,"member@test.example","MEMBER");
    db.prepare("UPDATE home_invitations SET expires_at=? WHERE id=?").run("2020-01-01T00:00:00.000Z",expiring.id);
    assert.throws(()=>acceptInvite(db,member,expiring.token),/expired or is addressed/);
  }finally{db.close()}
});
