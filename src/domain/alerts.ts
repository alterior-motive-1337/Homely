import type { HomelyDatabase } from "../db.js";
import type { AuthUser } from "../security/googleAuth.js";
import { runInHome } from "../security/homeScope.js";
import { listIssues, listMaintenance } from "./repository.js";
import { DomainError } from "./transactions.js";

export interface HomeAlert { key:string; title:string; detail:string; kind:"ISSUE"|"MAINTENANCE"; severity:string; assetId:string; recordId:string }
export function listAlerts(db:HomelyDatabase,user:AuthUser):HomeAlert[] {
  return runInHome(user.homeId,()=>{
    const issues=listIssues(db).filter(i=>!["RESOLVED","CLOSED"].includes(String(i.status))&&["HIGH","CRITICAL"].includes(String(i.severity)));
    const maintenance=listMaintenance(db).filter(m=>String(m.due_state)==="OVERDUE"||String(m.next_due_at)<=new Date(Date.now()+7*86_400_000).toISOString().slice(0,10));
    const seen=new Set(db.prepare("SELECT alert_key FROM alert_receipts WHERE home_id=? AND user_id=?").all(user.homeId,user.id).map(x=>String(x.alert_key)));
    return [
      ...issues.map(i=>({key:`issue:${i.id}:${i.updated_at}:${i.severity}`,title:String(i.title),detail:String(i.asset_name),kind:"ISSUE" as const,severity:String(i.severity),assetId:String(i.asset_id),recordId:String(i.id)})),
      ...maintenance.map(m=>({key:`maintenance:${m.id}:${m.next_due_at}`,title:String(m.title),detail:`${m.asset_name} · ${m.next_due_at}`,kind:"MAINTENANCE" as const,severity:String(m.due_state),assetId:String(m.asset_id),recordId:String(m.id)}))
    ].filter(a=>!seen.has(a.key)).sort((a,b)=>Number(b.severity==="CRITICAL")-Number(a.severity==="CRITICAL"));
  });
}
export function acknowledgeAlert(db:HomelyDatabase,user:AuthUser,key:unknown) {
  const alert=listAlerts(db,user).find(a=>a.key===key);
  if(!alert)throw new DomainError("Alert not found.",404);
  db.prepare("INSERT OR IGNORE INTO alert_receipts(home_id,user_id,alert_key,acknowledged_at) VALUES(?,?,?,?)").run(user.homeId,user.id,alert.key,new Date().toISOString());
  // A change in severity or due date produces a new alert. Acknowledgement never resolves the record.
  return {acknowledged:true};
}
