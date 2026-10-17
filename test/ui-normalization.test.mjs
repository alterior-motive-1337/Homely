import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CURRENCY,normalizeCurrency,formatMinorAmount,majorToMinorAmount,
  minorToMajorAmount,localDateInput,calendarDate,normalizeStatus,statusLabel,statusTone,actionLabel,displayLabel,
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

test("neutral, amber attention and red urgent tones are the only state categories",()=>{
  const groups={
    neutral:["UNKNOWN","NEW","GOOD","FAIR","LOW","OPEN","IN_PROGRESS","PLANNED","MONITORING","RESOLVED","CLOSED","ACTIVE","INACTIVE","COMMITTED","REJECTED","SAVED","SHORTLISTED","PURCHASED","MONTHLY","OWNER"],
    attention:["MEDIUM","HIGH","POOR","DEGRADED","DUE_SOON","AT_RISK"],
    urgent:["CRITICAL","FAILED","OVERDUE","PAST_DUE","EMERGENCY"]
  };
  for(const [tone,states] of Object.entries(groups)){
    for(const state of states)assert.equal(statusTone(state),tone,state);
  }
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
