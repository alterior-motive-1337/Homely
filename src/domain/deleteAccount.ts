import type { HomelyDatabase } from "../db.js";
import type { AuthUser } from "../security/googleAuth.js";
import { DomainError } from "./transactions.js";

/**
 * Irreversible self-service erasure. An owner must remove all other members
 * first so another person's household data is not silently deleted.
 * All operations are in one transaction.
 */
export function deleteAccount(db: HomelyDatabase,user: AuthUser,confirmation: unknown) {
  if(confirmation!=="DELETE MY ACCOUNT") {
    throw new DomainError('Type "DELETE MY ACCOUNT" to confirm permanent removal.',400);
  }
  const owned=db.prepare("SELECT home_id FROM home_memberships WHERE user_id=? AND role='OWNER'")
    .all(user.id).map(row=>String(row.home_id));
  for(const homeId of owned){
    const count=db.prepare("SELECT COUNT(*) AS n FROM home_memberships WHERE home_id=? AND user_id<>?")
      .get(homeId,user.id);
    if(Number(count?.n??0)>0) {
      throw new DomainError("Remove other household members before deleting this account.",409);
    }
  }
  db.exec("BEGIN IMMEDIATE;");
  try{
    // Recheck account and shared memberships under the same write lock.
    if(!db.prepare("SELECT id FROM auth_users WHERE id=?").get(user.id))
      throw new DomainError("Account not found.",404);
    for(const homeId of owned) {
      const others=db.prepare("SELECT COUNT(*) AS n FROM home_memberships WHERE home_id=? AND user_id<>?")
        .get(homeId,user.id);
      if(Number(others?.n??0)>0)throw new DomainError("Remove members before deleting this household.",409);
      db.prepare("DELETE FROM file_uploads WHERE home_id=?").run(homeId);
      db.prepare("DELETE FROM documents WHERE home_id=?").run(homeId);
      db.prepare("DELETE FROM transaction_changes WHERE transaction_id IN (SELECT id FROM transactions WHERE home_id=?)").run(homeId);
      db.prepare("DELETE FROM transactions WHERE home_id=?").run(homeId);
      db.prepare("DELETE FROM timeline_events WHERE home_id=?").run(homeId);
      db.prepare("DELETE FROM projects WHERE home_id=?").run(homeId);
      db.prepare("DELETE FROM purchase_candidates WHERE home_id=?").run(homeId);
      db.prepare("DELETE FROM charges WHERE home_id=?").run(homeId);
      db.prepare("DELETE FROM repairs WHERE home_id=?").run(homeId);
      db.prepare("DELETE FROM maintenance_rules WHERE asset_id IN (SELECT a.id FROM assets a JOIN systems s ON s.id=a.system_id WHERE s.home_id=?)").run(homeId);
      db.prepare("DELETE FROM issues WHERE asset_id IN (SELECT a.id FROM assets a JOIN systems s ON s.id=a.system_id WHERE s.home_id=?)").run(homeId);
      db.prepare("DELETE FROM assets WHERE system_id IN (SELECT id FROM systems WHERE home_id=?)").run(homeId);
      db.prepare("DELETE FROM systems WHERE home_id=?").run(homeId);
      db.prepare("DELETE FROM home_invitations WHERE home_id=?").run(homeId);
      db.prepare("DELETE FROM home_memberships WHERE home_id=?").run(homeId);
      db.prepare("DELETE FROM home_owners WHERE home_id=?").run(homeId);
      db.prepare("DELETE FROM homes WHERE id=?").run(homeId);
    }
    // Memberships on another owner's shared home and all remaining sessions
    // are removed by foreign-key cascade from auth_users.
    db.prepare("DELETE FROM auth_users WHERE id=?").run(user.id);
    db.exec("COMMIT;");
  }catch(error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return {deleted:true};
}
