import assert from "node:assert/strict";
import test from "node:test";
import type http from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
import { migrate } from "../src/db.js";
import { seedDemo } from "../src/seed.js";
import { createTestDatabase } from "./helpers.js";
import { GoogleAuthentication, verifyGoogleIdentity } from "../src/security/googleAuth.js";
import { startServer } from "../src/server.js";

function request(cookie=""): http.IncomingMessage {
  return {headers:{cookie}} as http.IncomingMessage;
}
function response() {
  let status=200;
  const headers=new Map<string,string|string[]>();
  let body="";
  return {
    setHeader(name:string,value:string|string[]){headers.set(name.toLowerCase(),value);return this},
    getHeader(name:string){return headers.get(name.toLowerCase())},
    writeHead(code:number,extra?:Record<string,string>){status=code;for(const [k,v] of Object.entries(extra??{}))this.setHeader(k,v);return this},
    end(value?:string){body=value??"";return this},
    get status(){return status},
    get body(){return body},
    get headers(){return headers}
  };
}
function cookieValue(res: ReturnType<typeof response>,name:string){
  const cookies=res.getHeader("set-cookie");
  const list=Array.isArray(cookies)?cookies:typeof cookies==="string"?[cookies]:[];
  const item=list.find(c=>c.startsWith(name+"="));
  assert.ok(item,name+" cookie is missing");
  return item.split(";")[0]!;
}
const settings={
  clientId:"local-testing.apps.googleusercontent.com",
  clientSecret:"unit-test-secret",
  redirectUri:"http://localhost:4173/auth/google/callback",
  allowedEmail:"owner@example.test"
};

test("Google sign-in issues PKCE challenge, checks nonce, and stores only hashed sessions",async()=>{
  const db=createTestDatabase();migrate(db);seedDemo(db);
  let verifier="",calls=0;
  const auth=new GoogleAuthentication(db,settings,{
    async exchange(code,proof){assert.equal(code,"google-auth-code");verifier=proof;return "signed-id-token"},
    async verify(token,clientId,nonce){
      calls++;assert.equal(token,"signed-id-token");assert.equal(clientId,settings.clientId);assert.ok(nonce.length>=40);
      return {iss:"https://accounts.google.com",aud:clientId,sub:"google-subject-1",
        email:"owner@example.test",email_verified:true,name:"House owner",nonce};
    }
  });
  assert.equal(auth.status(request()).authenticated,false);
  assert.throws(()=>auth.requireUser(request()),/sign in/i);
  const redirect=response();auth.beginLogin(redirect as unknown as http.ServerResponse);
  assert.equal(redirect.status,303);
  const target=new URL(String(redirect.getHeader("location")));
  assert.equal(target.hostname,"accounts.google.com");
  assert.equal(target.searchParams.get("scope"),"openid email profile");
  assert.equal(target.searchParams.get("code_challenge_method"),"S256");
  assert.equal(target.searchParams.get("access_type"),null);
  const state=target.searchParams.get("state")!;
  const cookie=cookieValue(redirect,"homely_oauth");
  assert.ok(cookie.endsWith(state));

  const invalid=response();
  await assert.rejects(()=>auth.finishLogin(request("homely_oauth=invalid"),
    invalid as unknown as http.ServerResponse,
    new URL("http://localhost:4173/auth/google/callback?state="+state+"&code=google-auth-code")),/state mismatch/);
  assert.equal(calls,0);
  const callback=response();
  await auth.finishLogin(request(cookie),callback as unknown as http.ServerResponse,
    new URL("http://localhost:4173/auth/google/callback?state="+state+"&code=google-auth-code"));
  assert.equal(callback.status,303);
  assert.ok(verifier.length>=40);
  assert.equal(calls,1);
  const session=cookieValue(callback,"homely_session");
  assert.ok(auth.status(request(session)).authenticated);
  assert.equal(auth.requireUser(request(session)).email,"owner@example.test");
  const record=db.prepare("SELECT token_hash FROM auth_sessions").get();
  assert.notEqual(record?.token_hash,session.slice(session.indexOf("=")+1));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM home_owners").get()?.count,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM auth_login_attempts").get()?.count,0);
  await assert.rejects(()=>auth.finishLogin(request(cookie),response() as unknown as http.ServerResponse,
    new URL("http://localhost:4173/auth/google/callback?state="+state+"&code=google-auth-code")),/expired/);
  const signout=response();auth.logout(request(session),signout as unknown as http.ServerResponse);
  assert.equal(auth.status(request(session)).authenticated,false);
  db.close();
});

test("new Google accounts get independent private homes; legacy owner only claims explicit unowned home",async()=>{
  const db=createTestDatabase();migrate(db);seedDemo(db);
  let claims: {sub:string;email:string;email_verified:boolean}={
    sub:"google-user-a",email:"outsider@example.test",email_verified:true
  };
  const auth=new GoogleAuthentication(db,settings,{
    async exchange(){return "token"},
    async verify(_token,_clientId,nonce){return {...claims,nonce}}
  });
  const login=async()=>{
    const start=response();auth.beginLogin(start as unknown as http.ServerResponse);
    const state=new URL(String(start.getHeader("location"))).searchParams.get("state");
    const result=response();
    await auth.finishLogin(request(cookieValue(start,"homely_oauth")),result as unknown as http.ServerResponse,
      new URL("http://localhost:4173/auth/google/callback?state="+state+"&code=abc"));
    return result;
  };
  const first=await login();
  const userA=auth.requireUser(request(cookieValue(first,"homely_session")));
  assert.notEqual(userA.homeId,"home-hawthorn");
  assert.equal(userA.role,"OWNER");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM assets JOIN systems s ON s.id=assets.system_id WHERE s.home_id=?").get(userA.homeId)?.n,0);
  claims={sub:"google-user-a",email:"outsider@example.test",email_verified:false};
  await assert.rejects(login(),/verified Google email/);
  claims={sub:"google-user-b",email:"owner@example.test",email_verified:true};
  const second=await login();
  const userB=auth.requireUser(request(cookieValue(second,"homely_session")));
  assert.equal(userB.homeId,"home-hawthorn");
  assert.notEqual(userA.homeId,userB.homeId);
  claims={sub:"google-user-c",email:"owner@example.test",email_verified:true};
  const third=await login();
  const userC=auth.requireUser(request(cookieValue(third,"homely_session")));
  assert.notEqual(userC.homeId,userB.homeId);
  assert.notEqual(userC.homeId,userA.homeId);
  db.close();
});

test("partially configured OAuth never exposes an existing home",()=>{
  const db=createTestDatabase();migrate(db);seedDemo(db);
  const auth=new GoogleAuthentication(db,{...settings,clientSecret:""});
  assert.equal(auth.status(request()).enabled,false);
  assert.equal(auth.status(request()).authenticated,false);
  assert.throws(()=>auth.requireUser(request()),/sign in/i);
  assert.throws(()=>auth.beginLogin(response() as unknown as http.ServerResponse),/not configured/i);
  db.close();
});

test("Google ID tokens are signature-verified against JWKS with exact audience and nonce",async()=>{
  const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
  const jwk=publicKey.export({format:"jwk"});
  const original=globalThis.fetch;
  globalThis.fetch=async(input)=>{
    assert.equal(String(input),"https://www.googleapis.com/oauth2/v3/certs");
    return new Response(JSON.stringify({keys:[{...jwk,kid:"test-key",alg:"RS256",use:"sig"}]}),{
      status:200,headers:{"content-type":"application/json","cache-control":"public, max-age=300"}
    });
  };
  function encode(payload:Record<string,unknown>){
    const header=Buffer.from(JSON.stringify({alg:"RS256",kid:"test-key",typ:"JWT"})).toString("base64url");
    const body=Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature=sign("RSA-SHA256",Buffer.from(header+"."+body),privateKey).toString("base64url");
    return header+"."+body+"."+signature;
  }
  const basic={iss:"https://accounts.google.com",aud:settings.clientId,sub:"verified-sub",
    email:"owner@example.test",email_verified:true,nonce:"correct-nonce",
    exp:Math.floor(Date.now()/1000)+120,iat:Math.floor(Date.now()/1000)-30};
  try{
    const valid=await verifyGoogleIdentity(encode(basic),settings.clientId,"correct-nonce");
    assert.equal(valid.sub,"verified-sub");
    await assert.rejects(verifyGoogleIdentity(encode(basic),settings.clientId,"different-nonce"),/verification failed/);
    await assert.rejects(verifyGoogleIdentity(encode({...basic,aud:"attacker-client"}),settings.clientId,"correct-nonce"),/verification failed/);
    await assert.rejects(verifyGoogleIdentity(encode({...basic,exp:1}),settings.clientId,"correct-nonce"),/verification failed/);
    const changed=encode({...basic,email:"attacker@example.test"});
    const pieces=changed.split(".");
    pieces[1]=Buffer.from(JSON.stringify(basic)).toString("base64url");
    await assert.rejects(verifyGoogleIdentity(pieces.join("."),settings.clientId,"correct-nonce"),/signature/);
  }finally{globalThis.fetch=original}
});

test("HTTP routes never expose household records, files, or upload endpoints without login",async()=>{
  const db=createTestDatabase();
  const auth=new GoogleAuthentication(db,{...settings,clientSecret:""});
  const server=await startServer(db,auth);
  try{
    const origin="http://127.0.0.1:4173";
    const publicHealth=await fetch(origin+"/api/health");
    assert.equal(publicHealth.status,200);
    const status=await fetch(origin+"/api/auth/status");
    assert.equal(status.status,200);
    assert.equal((await status.json()).authenticated,false);
    assert.equal((await fetch(origin+"/")).status,200);
    for(const route of ["/api/overview","/api/systems","/api/assets","/api/issues",
      "/api/repairs","/api/documents","/api/transactions","/api/integrations/status",
      "/api/files/doc-1","/demo-documents/inverter-warranty.txt"]){
      const response=await fetch(origin+route);
      assert.equal(response.status,401,route+" must require Google sign-in");
    }
    const upload=await fetch(origin+"/api/uploads/start",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({name:"clip.mp4",mimeType:"video/mp4",size:100})
    });
    assert.equal(upload.status,401);
    const sample=await fetch(origin+"/api/homes/sample",{method:"POST"});
    assert.equal(sample.status,401,"sample creation must require Google sign-in");
  }finally{await new Promise<void>((done)=>server.close(()=>done()));db.close()}
});

test("active household switching requires membership and revocation falls back to personal home",async()=>{
  const db=createTestDatabase();migrate(db);seedDemo(db);
  const auth=new GoogleAuthentication(db,{...settings,allowedEmail:""},{
    async exchange(){return "token"},
    async verify(_token,_clientId,nonce){
      return {sub:"google-multihome-owner",email:"multihome@example.test",email_verified:true,nonce}
    }
  });
  try{
    const begin=response();auth.beginLogin(begin as unknown as http.ServerResponse);
    const state=new URL(String(begin.getHeader("location"))).searchParams.get("state");
    const callback=response();
    await auth.finishLogin(request(cookieValue(begin,"homely_oauth")),callback as unknown as http.ServerResponse,
      new URL("http://localhost:4173/auth/google/callback?state="+state+"&code=abc"));
    const session=cookieValue(callback,"homely_session");
    const first=auth.requireUser(request(session));
    assert.equal(first.role,"OWNER");
    assert.notEqual(first.homeId,"home-hawthorn");
    assert.throws(()=>auth.switchHome(request(session),"home-hawthorn"),/not a member/);
    db.prepare("INSERT INTO home_memberships(home_id,user_id,role,joined_at) VALUES(?,?,?,?)")
      .run("home-hawthorn",first.id,"MEMBER",new Date().toISOString());
    const second=auth.switchHome(request(session),"home-hawthorn");
    assert.equal(second.role,"MEMBER");
    assert.equal(auth.requireUser(request(session)).homeId,"home-hawthorn");
    db.prepare("DELETE FROM home_memberships WHERE home_id=? AND user_id=?").run("home-hawthorn",first.id);
    assert.equal(auth.requireUser(request(session)).homeId,first.homeId);
    assert.equal(auth.requireUser(request(session)).role,"OWNER");
  }finally{db.close()}
});

