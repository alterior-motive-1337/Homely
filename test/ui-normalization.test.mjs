import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CURRENCY,normalizeCurrency,formatMinorAmount,majorToMinorAmount,
  minorToMajorAmount,localDateInput,calendarDate,normalizeStatus,statusLabel,statusTone,priorityLabel,priorityTone,operationalLabel,operationalTone,conditionLabel,issueStageLabel,purchaseStageLabel,healthLevelLabel,actionLabel,displayLabel,
  matchesSearch,countLabel,matchesStatusFilter
} from "../public/ui-normalization.js";

test("currency formatting and editing preserve minor units and empty values",()=>{
  assert.equal(DEFAULT_CURRENCY.code,"ZAR");
  assert.equal(normalizeCurrency(null).code,"ZAR");
  assert.equal(majorToMinorAmount("250.49"),25049);
  assert.equal(majorToMinorAmount("0"),0);
  assert.equal(majorToMinorAmount(""),null);
  assert.equal(minorToMajorAmount(25049),250.49);
  assert.equal(minorToMajorAmount(null),"");
  assert.match(formatMinorAmount(25049),/250[.,]49/);
  assert.match(formatMinorAmount(0),/0/);
  assert.equal(formatMinorAmount(null),"—");
  assert.throws(()=>majorToMinorAmount("-1"),/non-negative/);
  assert.throws(()=>majorToMinorAmount("nan"),/valid/);
  assert.equal(majorToMinorAmount("12.34",{code:"ZAR",minorUnitsPerMajor:100}),1234);
});

test("local dates use calendar fields, never an ISO UTC slice",()=>{
  assert.equal(localDateInput(new Date(2026,9,16,1,5)),"2026-10-16");
  assert.equal(localDateInput(new Date(2026,0,1,23,55)),"2026-01-01");
});

test("date-only values stay on their recorded calendar day across time zones",()=>{
  const date=calendarDate("2026-10-10");
  assert.equal(date.getFullYear(),2026);
  assert.equal(date.getMonth(),9);
  assert.equal(date.getDate(),10);
  assert.equal(calendarDate("2026-02-30"),null);
  assert.equal(calendarDate("invalid"),null);
  assert.equal(calendarDate(""),null);
  const moment=calendarDate("2026-10-10T18:30:00Z");
  assert.ok(moment instanceof Date);
});

test("labels are human-readable without changing stored enum values",()=>{
  for(const [raw,code,label] of [
    ["in progress","IN_PROGRESS","In progress"],
    ["IN_PROGRESS","IN_PROGRESS","In progress"],
    ["due-soon","DUE_SOON","Due soon"],
    ["SHORTLISTED","SHORTLISTED","Shortlisted"],
    ["monthly","MONTHLY","Monthly"],
    ["MEDIUM","MEDIUM","Medium"],
    ["UNKNOWN","UNKNOWN","Unknown"],
    ["  past due  ","PAST_DUE","Past due"]
  ]){
    assert.equal(normalizeStatus(raw),code,raw);
    assert.equal(statusLabel(raw),label,raw);
  }
  assert.equal(displayLabel("APPLIANCE"),"Appliance");
  assert.equal(displayLabel("FURNITURE"),"Furniture");
  assert.equal(displayLabel("CCTV"),"CCTV");
  assert.equal(displayLabel("Kitchen counter"),"Kitchen counter");
  assert.equal(displayLabel("HDMI television"),"HDMI television");
  assert.equal(actionLabel("REPORT_ISSUE"),"Issue reported");
  assert.equal(actionLabel("RECORD_REPAIR"),"Repair recorded");
  assert.equal(actionLabel("COMPLETE_MAINTENANCE"),"Maintenance completed");
  assert.equal(actionLabel("CUSTOM_ACTION"),"Custom action");
});

test("priorities have only three levels and no separate Critical tier",()=>{
  assert.deepEqual(["LOW","MEDIUM","HIGH"].map(priorityLabel),["Low","Medium","High"]);
  assert.deepEqual(["LOW","MEDIUM","HIGH"].map(priorityTone),["neutral","attention","urgent"]);
  assert.equal(priorityLabel("CRITICAL"),"High","legacy Critical displays as High");
  assert.equal(priorityTone("CRITICAL"),"urgent","legacy priority remains visible as High");
  for(const status of ["CRITICAL","HIGH","MEDIUM","LOW","OPEN","SAVED","UNKNOWN","IN_PROGRESS"]){
    assert.equal(statusTone(status),"neutral",status+" remains neutral without a factual outcome");
  }
  for(const status of ["RESOLVED","COMMITTED","PURCHASED","ACTIVE"])assert.equal(statusTone(status),"positive");
  for(const status of ["OVERDUE","FAILED"])assert.equal(statusTone(status),"urgent");
  for(const status of ["UPCOMING","DEGRADED","ATTENTION"])assert.equal(statusTone(status),"attention");
  assert.deepEqual(["WORKING","NEEDS_ATTENTION","OUT_OF_SERVICE","UNASSESSED"].map(operationalLabel),
    ["Working","Needs attention","Out of service","Not assessed"]);
  assert.deepEqual(["WORKING","NEEDS_ATTENTION","OUT_OF_SERVICE","UNASSESSED"].map(operationalTone),
    ["positive","attention","urgent","neutral"]);
});

test("ranked labels use three states with unassessed data left ungraded",()=>{
  assert.deepEqual(["GOOD","FAIR","POOR"].map(conditionLabel),["Good","Fair","Poor"]);
  assert.equal(conditionLabel("FAILED"),"Poor");
  assert.equal(conditionLabel("NEW"),"Not assessed");
  assert.equal(conditionLabel("UNKNOWN"),"Not assessed");
  assert.deepEqual(["HEALTHY","ATTENTION","FAILED"].map(healthLevelLabel),["Good","Fair","Poor"]);
  assert.equal(healthLevelLabel("DEGRADED"),"Fair");
  assert.equal(healthLevelLabel("UNKNOWN"),"Not assessed");
});
test("issue progress and purchase results each have three user-visible states",()=>{
  for(const [input,output] of Object.entries({
    OPEN:"Open",PLANNED:"Open",MONITORING:"In progress",
    IN_PROGRESS:"In progress",RESOLVED:"Resolved",CLOSED:"Resolved"
  })) assert.equal(issueStageLabel(input),output,input);
  for(const [input,output] of Object.entries({
    SAVED:"Saved",SHORTLISTED:"Saved",PURCHASED:"Purchased",DISMISSED:"Dismissed"
  })) assert.equal(purchaseStageLabel(input),output,input);
});

test("search, status and result counts obey the same contract in every list",()=>{
  assert.equal(matchesSearch("Réfrigérateur freezer","refrigerateur"),true);
  assert.equal(matchesSearch("Washing machine","dishwasher"),false);
  assert.equal(matchesStatusFilter("all",true),true);
  assert.equal(matchesStatusFilter("open",false),false);
  assert.equal(matchesStatusFilter("resolved",false),true);
  assert.equal(matchesStatusFilter("resolved",true),false);
  assert.equal(countLabel(3,9),"9 entries");
  assert.equal(countLabel(3,9,"file","files",true),"3 of 9");
});
