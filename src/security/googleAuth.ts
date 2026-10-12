import { createHash, createPublicKey, randomBytes, randomUUID, verify as verifySignature } from "node:crypto";
import type http from "node:http";
import type { HomelyDatabase } from "../db.js";
import { config } from "../config.js";
import { DomainError } from "../domain/transactions.js";

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const FLOW_SECONDS = 10 * 60;
const SESSION_COOKIE = "homely_session";
const FLOW_COOKIE = "homely_oauth";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_KEYS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";

export interface AuthUser { id: string; email: string; name: string; homeId: string; role: "OWNER" | "MEMBER" | "VIEWER" }
export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
  provider: "google";
  setupRequired: boolean;
  user: AuthUser | null;
}
export interface AuthGateway {
  status(req: http.IncomingMessage): AuthStatus;
  requireUser(req: http.IncomingMessage): AuthUser;
  beginLogin(res: http.ServerResponse): void;
  finishLogin(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void>;
  logout(req: http.IncomingMessage, res: http.ServerResponse): void;
  switchHome?(req: http.IncomingMessage, homeId: string): AuthUser;
}
export interface GoogleAuthSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedEmail: string;
}
interface Claims { iss?: unknown; aud?: unknown; sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown; nonce?: unknown; exp?: unknown; iat?: unknown }
interface JsonWebKeyRSA { kid?: string; kty?: string; alg?: string; use?: string; n?: string; e?: string }
interface IdentityDependencies {
  exchange?: (code: string, verifier: string, settings: GoogleAuthSettings) => Promise<string>;
  verify?: (token: string, clientId: string, nonce: string) => Promise<Claims>;
}
const jwksCache: { keys: JsonWebKeyRSA[]; expires: number } = { keys: [], expires: 0 };

function hash(input: string) { return createHash("sha256").update(input).digest("hex"); }
function randomToken() { return randomBytes(32).toString("base64url"); }
function later(seconds: number) { return new Date(Date.now() + seconds * 1000).toISOString(); }
function cookies(req: http.IncomingMessage): Map<string,string> {
  const values=new Map<string,string>();
  for(const item of String(req.headers.cookie ?? "").split(";")){
    const at=item.indexOf("=");
    if(at>0) values.set(item.slice(0,at).trim(),item.slice(at+1).trim());
  }
  return values;
}
function setCookie(res: http.ServerResponse, name: string, value: string, secure: boolean, maxAge: number, path = "/") {
  const item=`${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const existing=res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie",[...(Array.isArray(existing)?existing.map(String):existing?[String(existing)]:[]),item]);
}
function navigate(res: http.ServerResponse, destination: string) {
  res.writeHead(303,{location:destination,"cache-control":"no-store","referrer-policy":"no-referrer"});
  res.end();
}
async function exchangeCode(code: string, verifier: string, settings: GoogleAuthSettings): Promise<string> {
  const form=new URLSearchParams({
    code, client_id:settings.clientId, client_secret:settings.clientSecret,
    redirect_uri:settings.redirectUri, grant_type:"authorization_code", code_verifier:verifier
  });
  const response=await fetch(GOOGLE_TOKEN_ENDPOINT,{
    method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(10_000)
  });
  if(!response.ok)throw new DomainError("Google could not complete sign-in.",401);
  const data=await response.json() as {id_token?:string};
  if(!data.id_token || data.id_token.length>20_000)throw new DomainError("Google did not provide a valid identity token.",401);
  return data.id_token;
}
async function getGoogleKeys(): Promise<JsonWebKeyRSA[]> {
  if(jwksCache.expires>Date.now() && jwksCache.keys.length) return jwksCache.keys;
  const response=await fetch(GOOGLE_KEYS_ENDPOINT,{signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new DomainError("Google's verification keys are unavailable.",503);
  const data=await response.json() as {keys?:JsonWebKeyRSA[]};
  if(!Array.isArray(data.keys)||!data.keys.length)throw new DomainError("Google's verification keys are unavailable.",503);
  const header=response.headers.get("cache-control")??"";
  const maxAge=Number(/max-age=(\d+)/.exec(header)?.[1]??"300");
  jwksCache.keys=data.keys;
  jwksCache.expires=Date.now()+Math.min(Math.max(maxAge,60),3600)*1000;
  return jwksCache.keys;
}
export async function verifyGoogleIdentity(jwt: string, clientId: string, expectedNonce: string): Promise<Claims> {
  const parts=jwt.split(".");
  if(parts.length!==3 || jwt.length>20_000)throw new DomainError("Invalid Google identity token.",401);
  let header: {kid?:string;alg?:string}, claims: Claims;
  try {
    header=JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as typeof header;
    claims=JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Claims;
  }catch {throw new DomainError("Invalid Google identity token.",401);}
  if(header.alg!=="RS256" || !header.kid)throw new DomainError("Unsupported Google token signature.",401);
  const keys=await getGoogleKeys();
  const key=keys.find(k=>k.kid===header.kid && k.kty==="RSA" && (!k.alg || k.alg==="RS256") && (!k.use || k.use==="sig"));
  if(!key || !key.n || !key.e)throw new DomainError("Google signing key not found.",401);
  const valid=verifySignature("RSA-SHA256",Buffer.from(parts[0]+"."+parts[1]),createPublicKey({
    key:{kty:"RSA",n:key.n,e:key.e},format:"jwk"
  }),Buffer.from(parts[2]!, "base64url"));
  if(!valid)throw new DomainError("Invalid Google identity signature.",401);
  const now=Math.floor(Date.now()/1000);
  if(!["https://accounts.google.com","accounts.google.com"].includes(String(claims.iss??"")) ||
     claims.aud!==clientId || (typeof claims.exp!=="number" || !Number.isSafeInteger(claims.exp)) || Number(claims.exp)<=now ||
     (typeof claims.iat!=="number" || !Number.isSafeInteger(claims.iat)) || Number(claims.iat)>now+60 ||
     claims.nonce!==expectedNonce || !claims.sub || typeof claims.sub!=="string" ||
     typeof claims.email!=="string" || !claims.email.trim() ||
     (claims.email_verified!==true && claims.email_verified!=="true")){
    throw new DomainError("Google identity verification failed.",401);
  }
  return claims;
}

export class GoogleAuthentication implements AuthGateway {
  private readonly secure: boolean;
  readonly enabled: boolean;
  constructor(
    private readonly db: HomelyDatabase,
    private readonly settings: GoogleAuthSettings = {
      clientId:config.googleClientId,clientSecret:config.googleClientSecret,
      redirectUri:config.googleRedirectUri,allowedEmail:config.googleAllowedEmail
    },
    private readonly deps: IdentityDependencies = {}
  ) {
    let uri: URL | undefined;
    try { uri=new URL(settings.redirectUri); } catch {}
    const isSecure=uri?.protocol==="https:";
    const localHttp=uri?.protocol==="http:" && ["localhost","127.0.0.1"].includes(uri.hostname);
    this.secure=Boolean(isSecure);
    this.enabled=Boolean(settings.clientId && settings.clientSecret &&
      uri && (isSecure || localHttp) && !uri.username && !uri.password &&
      uri.pathname==="/auth/google/callback" && !uri.search && !uri.hash);
  }
  private checkEnabled(): void {
    if(!this.enabled)throw new DomainError("Google Sign-In is not configured. Set the Google OAuth environment variables.",503);
  }
  status(req: http.IncomingMessage): AuthStatus {
    const user=this.user(req);
    return {enabled:this.enabled,authenticated:!!user,provider:"google",setupRequired:!this.enabled,user};
  }
  private user(req: http.IncomingMessage): AuthUser | null {
    // Removing or changing OAuth configuration immediately locks out stale sessions.
    if(!this.enabled)return null;
    const token=cookies(req).get(SESSION_COOKIE);
    if(!token || !/^[\w-]{42,60}$/.test(token))return null;
    const row=this.db.prepare(`SELECT u.id,u.email,u.display_name,m.home_id,m.role FROM auth_sessions s
      JOIN auth_users u ON u.id=s.user_id
      JOIN home_memberships m ON m.user_id=u.id AND m.home_id=COALESCE(
        (SELECT home_id FROM home_memberships WHERE user_id=u.id AND home_id=s.home_id),
        (SELECT home_id FROM home_memberships WHERE user_id=u.id ORDER BY joined_at LIMIT 1)
      )
      WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`).get(hash(token),new Date().toISOString());
    if(!row)return null;
    return {id:String(row.id),email:String(row.email),name:String(row.display_name),
      homeId:String(row.home_id),role:String(row.role) as AuthUser["role"]};
  }
  requireUser(req: http.IncomingMessage): AuthUser {
    const user=this.user(req);
    if(!user)throw new DomainError("Sign in with Google to access your home.",401);
    return user;
  }
  switchHome(req: http.IncomingMessage, homeId: string): AuthUser {
    const current=this.requireUser(req);
    const role=this.db.prepare("SELECT role FROM home_memberships WHERE home_id=? AND user_id=?")
      .get(homeId,current.id);
    if(!role)throw new DomainError("You are not a member of that household.",403);
    const token=cookies(req).get(SESSION_COOKIE);
    if(!token)throw new DomainError("Sign in again.",401);
    const changed=this.db.prepare("UPDATE auth_sessions SET home_id=? WHERE token_hash=? AND user_id=?")
      .run(homeId,hash(token),current.id);
    if(Number(changed.changes)!==1)throw new DomainError("Session expired.",401);
    return {...current,homeId,role:String(role.role) as AuthUser["role"]};
  }
  beginLogin(res: http.ServerResponse): void {
    this.checkEnabled();
    const state=randomToken(),verifier=randomToken(),nonce=randomToken();
    const challenge=createHash("sha256").update(verifier).digest("base64url");
    this.db.prepare("DELETE FROM auth_login_attempts WHERE expires_at < ?").run(new Date().toISOString());
    this.db.prepare("INSERT INTO auth_login_attempts(state_hash,code_verifier,nonce,created_at,expires_at) VALUES (?,?,?,?,?)")
      .run(hash(state),verifier,nonce,new Date().toISOString(),later(FLOW_SECONDS));
    setCookie(res,FLOW_COOKIE,state,this.secure,FLOW_SECONDS,"/auth");
    const redirect=new URL(GOOGLE_AUTH_ENDPOINT);
    redirect.search=new URLSearchParams({
      client_id:this.settings.clientId,redirect_uri:this.settings.redirectUri,
      response_type:"code",scope:"openid email profile",state,nonce,code_challenge:challenge,
      code_challenge_method:"S256"
    }).toString();
    navigate(res,redirect.toString());
  }
  async finishLogin(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    this.checkEnabled();
    const returnedState=url.searchParams.get("state")??"";
    const cookieState=cookies(req).get(FLOW_COOKIE)??"";
    setCookie(res,FLOW_COOKIE,"",this.secure,0,"/auth");
    if(returnedState.length<40 || returnedState!==cookieState)throw new DomainError("Google sign-in state mismatch. Retry sign-in.",401);
    const stateHash=hash(returnedState);
    const attempt=this.db.prepare("SELECT code_verifier,nonce,expires_at FROM auth_login_attempts WHERE state_hash=?").get(stateHash);
    this.db.prepare("DELETE FROM auth_login_attempts WHERE state_hash=?").run(stateHash);
    if(!attempt || String(attempt.expires_at)<=new Date().toISOString())throw new DomainError("Google sign-in expired. Retry sign-in.",401);
    if(url.searchParams.has("error"))throw new DomainError("Google sign-in was cancelled.",401);
    const code=url.searchParams.get("code");
    if(!code || code.length>4096)throw new DomainError("Google did not return an authorization code.",401);
    const token=await (this.deps.exchange??exchangeCode)(code,String(attempt.code_verifier),this.settings);
    const identity=await (this.deps.verify??verifyGoogleIdentity)(token,this.settings.clientId,String(attempt.nonce));
    const subject=String(identity.sub??"");
    const email=String(identity.email??"").trim().toLowerCase();
    const verified=identity.email_verified===true || identity.email_verified==="true";
    if(!subject || !verified || !email){
      throw new DomainError("A verified Google email is required.",403);
    }
    const name=String(identity.name??"").slice(0,120).trim()||"Homeowner";
    const sessionToken=randomToken();
    const now=new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const existing=this.db.prepare("SELECT id FROM auth_users WHERE google_subject=?").get(subject);
      const id=existing?String(existing.id):"user-"+randomUUID();
      if(!existing)this.db.prepare(`INSERT INTO auth_users(id,google_subject,email,display_name,created_at,last_login_at)
        VALUES(?,?,?,?,?,?)`).run(id,subject,email,name,now,now);
      else this.db.prepare("UPDATE auth_users SET email=?,display_name=?,last_login_at=? WHERE id=?").run(email,name,now,id);

      const membership=this.db.prepare("SELECT home_id FROM home_memberships WHERE user_id=? ORDER BY joined_at LIMIT 1").get(id);
      if(!membership){
        // Only explicitly configured legacy owner can claim an existing unowned POC home.
        let homeId: string | null = null;
        if(this.settings.allowedEmail && email===this.settings.allowedEmail.trim().toLowerCase()){
          const unclaimed=this.db.prepare(`SELECT h.id FROM homes h
            LEFT JOIN home_memberships m ON m.home_id=h.id
            WHERE m.home_id IS NULL ORDER BY h.created_at LIMIT 1`).get();
          homeId=unclaimed?String(unclaimed.id):null;
        }
        if(!homeId){
          homeId="home-"+randomUUID();
          this.db.prepare("INSERT INTO homes(id,name,address_label,created_at,updated_at) VALUES(?,?,NULL,?,?)")
            .run(homeId,"My Home",now,now);
          const systems=[
            ["Electrical","ELECTRICAL"],["Solar / Energy","SOLAR"],["Plumbing","PLUMBING"],
            ["Security","SECURITY"],["Structure","STRUCTURE"],["Appliances","APPLIANCES"],
            ["Garden / Outdoor","GARDEN"],["Furniture","FURNITURE"]
          ];
          for(let i=0;i<systems.length;i++){
            this.db.prepare(`INSERT INTO systems(id,home_id,name,category,description,position,created_at,updated_at)
              VALUES(?,?,?,?,NULL,?,?,?)`).run("sys-"+randomUUID(),homeId,String(systems[i]![0]),String(systems[i]![1]),i+1,now,now);
          }
        }
        this.db.prepare("INSERT INTO home_memberships(home_id,user_id,role,joined_at) VALUES(?,?,'OWNER',?)")
          .run(homeId,id,now);
        // Retain legacy ownership table as a compatibility record.
        this.db.prepare("INSERT INTO home_owners(home_id,user_id,claimed_at) VALUES(?,?,?)")
          .run(homeId,id,now);
      }
      this.db.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(now);
      const selected=this.db.prepare("SELECT home_id FROM home_memberships WHERE user_id=? ORDER BY joined_at LIMIT 1")
        .get(id);
      if(!selected)throw new DomainError("Account setup failed.",500);
      this.db.prepare("INSERT INTO auth_sessions(token_hash,user_id,expires_at,created_at,home_id) VALUES (?,?,?,?,?)")
        .run(hash(sessionToken),id,later(SESSION_SECONDS),now,String(selected.home_id));
      this.db.exec("COMMIT;");
    }catch(error){this.db.exec("ROLLBACK;");throw error;}
    setCookie(res,SESSION_COOKIE,sessionToken,this.secure,SESSION_SECONDS);
    navigate(res,"/");
  }
  logout(req: http.IncomingMessage, res: http.ServerResponse): void {
    const token=cookies(req).get(SESSION_COOKIE);
    if(token)this.db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").run(hash(token));
    setCookie(res,SESSION_COOKIE,"",this.secure,0);
    res.setHeader("cache-control","no-store");
  }
}
