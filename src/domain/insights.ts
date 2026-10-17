import type { OperationalState } from "./applianceState.js";

type Asset={operational_state?:OperationalState | null};
type Issue={status?:unknown;severity?:unknown};
type Repair={repair_date?:unknown;cost_cents?:unknown};
type Charge={active?:unknown;billing_cycle?:unknown;amount_cents?:unknown};
type Maintenance={due_state?:unknown};

export interface HomeInsights {
  service: { needing_attention:number; out_of_service:number; unassessed:number; high_priority_issues:number };
  repairs: { count_12m:number; cost_count_12m:number; recorded_cost_cents_12m:number };
  charges: { active_count:number; estimated_monthly_cents:number; estimated_count:number; unspecified_cycle_count:number };
  maintenance: { overdue:number; due_soon:number };
}

export function summarizeHomeInsights(
  data:{assets:Asset[];issues:Issue[];repairs:Repair[];charges:Charge[];maintenance:Maintenance[]},
  asOf:string
): HomeInsights {
  // All input arrays must be scoped to the active household by the repository.
  const validDate=/^\d{4}-\d{2}-\d{2}$/.test(asOf);
  if(!validDate)throw new RangeError("Expected YYYY-MM-DD as-of date.");
  const from=new Date(asOf+"T12:00:00Z");
  from.setUTCDate(from.getUTCDate()-365);
  const windowStart=from.toISOString().slice(0,10);
  const relevantRepairs=data.repairs.filter(r=>{
    const date=String(r.repair_date??"");
    return /^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=windowStart&&date<=asOf;
  });
  const knownRepairCosts=relevantRepairs.map(r=>Number(r.cost_cents))
    .filter((v,i)=>relevantRepairs[i]!.cost_cents!=null&&Number.isSafeInteger(v)&&v>=0);
  const activeCharges=data.charges.filter(c=>Number(c.active)===1);
  let monthly=0,estimatedCount=0,unspecified=0;
  for(const charge of activeCharges){
    const cents=Number(charge.amount_cents);
    const cycle=String(charge.billing_cycle??"").toUpperCase();
    const divisor=cycle==="MONTHLY"?1:cycle==="QUARTERLY"?3:cycle==="ANNUAL"?12:null;
    if(divisor===null||!Number.isSafeInteger(cents)||cents<0){unspecified++;continue}
    monthly+=cents/divisor;
    estimatedCount++;
  }
  const activeIssues=data.issues.filter(i=>!["RESOLVED","CLOSED"].includes(String(i.status??"").toUpperCase()));
  return {
    service:{
      needing_attention:data.assets.filter(a=>a.operational_state==="NEEDS_ATTENTION").length,
      out_of_service:data.assets.filter(a=>a.operational_state==="OUT_OF_SERVICE").length,
      unassessed:data.assets.filter(a=>a.operational_state==="UNASSESSED").length,
      high_priority_issues:activeIssues.filter(i=>["HIGH","CRITICAL"].includes(String(i.severity??"").toUpperCase())).length
    },
    repairs:{
      count_12m:relevantRepairs.length,
      cost_count_12m:knownRepairCosts.length,
      recorded_cost_cents_12m:knownRepairCosts.reduce((sum,c)=>sum+c,0)
    },
    charges:{
      active_count:activeCharges.length,
      estimated_monthly_cents:Math.round(monthly),
      estimated_count:estimatedCount,
      unspecified_cycle_count:unspecified
    },
    maintenance:{
      overdue:data.maintenance.filter(m=>m.due_state==="OVERDUE").length,
      due_soon:data.maintenance.filter(m=>m.due_state==="UPCOMING").length
    }
  };
}
