import assert from "node:assert/strict";
import test from "node:test";
import { classifyAssetState } from "../src/domain/applianceState.js";
import { summarizeHomeInsights } from "../src/domain/insights.js";

test("appliance state reflects recorded operation and actual outstanding work",()=>{
  assert.equal(classifyAssetState("GOOD","HEALTHY"),"WORKING");
  assert.equal(classifyAssetState("GOOD","UNKNOWN"),"WORKING");
  assert.equal(classifyAssetState("GOOD","DEGRADED"),"NEEDS_ATTENTION");
  assert.equal(classifyAssetState("GOOD","ATTENTION"),"NEEDS_ATTENTION");
  assert.equal(classifyAssetState("FAIR","HEALTHY"),"NEEDS_ATTENTION");
  assert.equal(classifyAssetState("POOR","HEALTHY"),"NEEDS_ATTENTION");
  assert.equal(classifyAssetState("FAILED","HEALTHY"),"OUT_OF_SERVICE");
  assert.equal(classifyAssetState("FAILED","DEGRADED"),"OUT_OF_SERVICE");
  assert.equal(classifyAssetState("NEW","UNKNOWN"),"UNASSESSED");
  assert.equal(classifyAssetState("UNKNOWN","HEALTHY"),"UNASSESSED");
  // An urgent issue does not automatically establish that an appliance is unusable.
  assert.equal(classifyAssetState("GOOD","FAILED"),"NEEDS_ATTENTION");
});

test("insights use the last 365 days, real costs, and only known billing periods",()=>{
  const insights=summarizeHomeInsights({
    assets:[
      {operational_state:"WORKING"},{operational_state:"NEEDS_ATTENTION"},
      {operational_state:"OUT_OF_SERVICE"},{operational_state:"UNASSESSED"}
    ],
    issues:[
      {status:"OPEN",severity:"HIGH"},{status:"IN_PROGRESS",severity:"CRITICAL"},
      {status:"RESOLVED",severity:"HIGH"},{status:"OPEN",severity:"LOW"}
    ],
    repairs:[
      {repair_date:"2026-10-17",cost_cents:10000},
      {repair_date:"2026-02-01",cost_cents:null},
      {repair_date:"2025-01-01",cost_cents:900000},
      {repair_date:"2026-12-01",cost_cents:500000}
    ],
    charges:[
      {active:1,billing_cycle:"MONTHLY",amount_cents:1000},
      {active:1,billing_cycle:"QUARTERLY",amount_cents:900},
      {active:1,billing_cycle:"ANNUAL",amount_cents:1200},
      {active:1,billing_cycle:"OTHER",amount_cents:5000},
      {active:0,billing_cycle:"MONTHLY",amount_cents:20000}
    ],
    maintenance:[{due_state:"OVERDUE"},{due_state:"UPCOMING"},{due_state:"SCHEDULED"}]
  },"2026-10-17");
  assert.deepEqual(insights.service,{
    needing_attention:1,out_of_service:1,unassessed:1,high_priority_issues:2
  });
  assert.deepEqual(insights.repairs,{
    count_12m:2,cost_count_12m:1,recorded_cost_cents_12m:10000
  });
  assert.deepEqual(insights.charges,{
    active_count:4,estimated_monthly_cents:1400,estimated_count:3,unspecified_cycle_count:1
  });
  assert.deepEqual(insights.maintenance,{overdue:1,due_soon:1});
});

test("missing data is not mistaken for zero expenses or complete assessment",()=>{
  const insights=summarizeHomeInsights({
    assets:[{operational_state:"UNASSESSED"}],issues:[],
    repairs:[{repair_date:"2026-10-01",cost_cents:null}],
    charges:[{active:1,billing_cycle:"OTHER",amount_cents:16000}],
    maintenance:[]
  },"2026-10-17");
  assert.equal(insights.repairs.count_12m,1);
  assert.equal(insights.repairs.cost_count_12m,0);
  assert.equal(insights.charges.estimated_count,0);
  assert.equal(insights.charges.unspecified_cycle_count,1);
  assert.equal(insights.service.unassessed,1);
  assert.throws(()=>summarizeHomeInsights({assets:[],issues:[],repairs:[],charges:[],maintenance:[]},"invalid"));
});
