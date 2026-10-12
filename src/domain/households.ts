import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { HomelyDatabase } from "../db.js";
import { DomainError } from "../domain/transactions.js";
import type { AuthUser } from "../security/googleAuth.js";

const HASH = (value: string) => createHash("sha256").update(value).digest("hex");
const NOW = () => new Date().toISOString();
const MAX_PENDING = 20;
function ownerOnly(user: AuthUser) {
  if(user.role!=="OWNER")throw new DomainError("Only a household owner can manage invitations.",403);
}
function normalizeEmail(email: unknown) {
  const normalized=String(email??"").trim().toLowerCase();
  if(normalized.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))throw new DomainError("Enter a valid email address.");
  return normalized;
}
export function listHouseholds(db: HomelyDatabase,user: AuthUser) {
  return db.prepare(`SELECT h.id,h.name,m.role,m.joined_at
    FROM home_memberships m JOIN homes h ON h.id=m.home_id
    WHERE m.user_id=? ORDER BY m.joined_at,h.name`).all(user.id);
}
export function listMembers(db: HomelyDatabase,user: AuthUser) {
  return db.prepare(`SELECT u.id,u.display_name AS name,u.email,m.role,m.joined_at
    FROM home_memberships m JOIN auth_users u ON u.id=m.user_id
    WHERE m.home_id=? ORDER BY CASE m.role WHEN 'OWNER' THEN 0 ELSE 1 END,m.joined_at`).all(user.homeId);
}
export function listInvitations(db: HomelyDatabase,user: AuthUser) {
  ownerOnly(user);
  return db.prepare(`SELECT id,email,role,created_at,expires_at FROM home_invitations
    WHERE home_id=? AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC`)
    .all(user.homeId,NOW());
}
export function inviteMember(db: HomelyDatabase,user: AuthUser,emailInput:unknown,roleInput:unknown) {
  ownerOnly(user);
  const email=normalizeEmail(emailInput);
  const role=String(roleInput??"MEMBER");
  if(role!=="MEMBER" && role!=="VIEWER")throw new DomainError("Invite role must be MEMBER or VIEWER.");
  if(email===user.email.toLowerCase())throw new DomainError("You already own this household.");
  const existing=db.prepare(`SELECT 1 FROM home_memberships m JOIN auth_users u ON u.id=m.user_id
    WHERE m.home_id=? AND lower(u.email)=? LIMIT 1`).get(user.homeId,email);
  if(existing)throw new DomainError("That account is already a member.",409);
  const count=db.prepare(`SELECT COUNT(*) AS n FROM home_invitations WHERE home_id=? AND used_at IS NULL AND expires_at>?`)
    .get(user.homeId,NOW());
  if(Number(count?.n??0)>=MAX_PENDING)throw new DomainError("Too many pending invitations.",429);
  const token=randomBytes(32).toString("base64url");
  const id="invite-"+randomUUID();
  db.prepare(`INSERT INTO home_invitations
    (id,home_id,invited_by,email,role,token_hash,expires_at,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(id,user.homeId,user.id,email,role,HASH(token),
    new Date(Date.now()+7*86400_000).toISOString(),NOW());
  return {id,email,role,token,expiresInDays:7};
}
export function revokeInvite(db: HomelyDatabase,user: AuthUser,id:string) {
  ownerOnly(user);
  const result=db.prepare("DELETE FROM home_invitations WHERE id=? AND home_id=? AND used_at IS NULL")
    .run(id,user.homeId);
  if(Number(result.changes)!==1)throw new DomainError("Pending invitation not found.",404);
  return {revoked:true};
}
export function acceptInvite(db: HomelyDatabase,user: AuthUser,tokenInput:unknown) {
  const token=String(tokenInput??"");
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new DomainError("Invalid invitation.",400);
  db.exec("BEGIN IMMEDIATE;");
  try{
    const invite=db.prepare(`SELECT * FROM home_invitations
      WHERE token_hash=? AND used_at IS NULL AND expires_at>?`).get(HASH(token),NOW());
    if(!invite || String(invite.email)!==user.email.trim().toLowerCase()) {
      throw new DomainError("Invitation is expired or is addressed to another Google account.",403);
    }
    const member=db.prepare("SELECT role FROM home_memberships WHERE home_id=? AND user_id=?")
      .get(String(invite.home_id),user.id);
    if(member)throw new DomainError("You already belong to this home.",409);
    db.prepare("INSERT INTO home_memberships(home_id,user_id,role,joined_at) VALUES(?,?,?,?)")
      .run(String(invite.home_id),user.id,String(invite.role),NOW());
    db.prepare("UPDATE home_invitations SET used_at=? WHERE id=? AND used_at IS NULL")
      .run(NOW(),String(invite.id));
    db.exec("COMMIT;");
    return {homeId:String(invite.home_id),role:String(invite.role)};
  }catch(error){db.exec("ROLLBACK;");throw error}
}
export function removeMember(db: HomelyDatabase,user: AuthUser,memberId:string) {
  ownerOnly(user);
  if(memberId===user.id)throw new DomainError("The owner cannot remove themselves.",409);
  const target=db.prepare("SELECT role FROM home_memberships WHERE home_id=? AND user_id=?")
    .get(user.homeId,memberId);
  if(!target)throw new DomainError("Household member not found.",404);
  if(String(target.role)==="OWNER")throw new DomainError("Cannot remove another owner.",403);
  db.exec("BEGIN IMMEDIATE;");
  try{
    db.prepare("DELETE FROM home_memberships WHERE home_id=? AND user_id=?").run(user.homeId,memberId);
    // Invalidates sessions using the revoked home, without signing the user out of their own home.
    db.prepare("UPDATE auth_sessions SET home_id=NULL WHERE user_id=? AND home_id=?").run(memberId,user.homeId);
    db.exec("COMMIT;");
  }catch(error){db.exec("ROLLBACK;");throw error}
  return {removed:true};
}
export function renameHome(db: HomelyDatabase,user: AuthUser,nameInput:unknown) {
  ownerOnly(user);
  const name=String(nameInput??"").trim();
  if(!name || name.length>100)throw new DomainError("Home name must be 1–100 characters.");
  db.prepare("UPDATE homes SET name=?,updated_at=? WHERE id=?")
    .run(name,NOW(),user.homeId);
  return {id:user.homeId,name};
}
