import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CURRENCY,normalizeCurrency,formatMinorAmount,majorToMinorAmount,
  minorToMajorAmount,localDateInput,calendarDate,normalizeStatus,statusLabel,statusTone,
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

test("status is semantic, not one decorative color per state",()=>{
  assert.equal(normalizeStatus("in progress"),"IN_PROGRESS");
  assert.equal(statusLabel("IN_PROGRESS"),"IN PROGRESS");
  assert.equal(statusTone("CRITICAL"),"urgent");
  assert.equal(statusTone("OVERDUE"),"urgent");
  assert.equal(statusTone("FAILED"),"urgent");
  assert.equal(statusTone("HIGH"),"attention");
  for(const status of ["GOOD","FAIR","UNKNOWN","OPEN","MEDIUM","LOW","RESOLVED"]){
    assert.equal(statusTone(status),"neutral",status);
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
