// Shared UI boundary: structured records remain authoritative; formatting does not mutate them.
export const DEFAULT_CURRENCY = Object.freeze({code:"ZAR",locale:"en-ZA",minorUnitsPerMajor:100});

export function normalizeCurrency(value){
  if(!value||typeof value!=="object")return DEFAULT_CURRENCY;
  const code=typeof value.code==="string"&&/^[A-Z]{3}$/.test(value.code)?value.code:DEFAULT_CURRENCY.code;
  const locale=typeof value.locale==="string"&&value.locale.length<32?value.locale:DEFAULT_CURRENCY.locale;
  const minorUnitsPerMajor=Number.isSafeInteger(value.minorUnitsPerMajor)&&value.minorUnitsPerMajor>0?value.minorUnitsPerMajor:DEFAULT_CURRENCY.minorUnitsPerMajor;
  return {code,locale,minorUnitsPerMajor};
}
export function formatMinorAmount(amount,currency=DEFAULT_CURRENCY){
  if(amount==null||amount==="")return "—";
  const value=Number(amount);if(!Number.isFinite(value))return "—";
  const c=normalizeCurrency(currency),fractional=value%c.minorUnitsPerMajor!==0;
  try{return new Intl.NumberFormat(c.locale,{style:"currency",currency:c.code,minimumFractionDigits:fractional?2:0,maximumFractionDigits:fractional?2:0}).format(value/c.minorUnitsPerMajor)}
  catch(_){return new Intl.NumberFormat("en-ZA",{style:"currency",currency:"ZAR",maximumFractionDigits:2}).format(value/100)}
}
export function majorToMinorAmount(amount,currency=DEFAULT_CURRENCY){
  if(amount==null||String(amount).trim()==="")return null;
  const value=Number(amount);
  if(!Number.isFinite(value)||value<0)throw new RangeError("Enter a valid, non-negative amount.");
  return Math.round(value*normalizeCurrency(currency).minorUnitsPerMajor);
}
export function minorToMajorAmount(amount,currency=DEFAULT_CURRENCY){
  return amount==null||amount===""?"":Number(amount)/normalizeCurrency(currency).minorUnitsPerMajor;
}
// Date-only values are calendar days, not UTC instants. Construct them in local time
// so a repair dated 10 Oct never renders as 9 Oct west of Greenwich.
export function calendarDate(value){
  if(value==null||value==="")return null;
  if(value instanceof Date)return Number.isFinite(value.getTime())?value:null;
  if(typeof value==="string"){
    const match=/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value.trim());
    if(match){
      const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
      const result=new Date(year,month-1,day);
      if(result.getFullYear()!==year||result.getMonth()!==month-1||result.getDate()!==day)return null;
      return result;
    }
  }
  const result=new Date(value);
  return Number.isFinite(result.getTime())?result:null;
}
export function localDateInput(date=new Date()){
  if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw new RangeError("Invalid date.");
  const pad=x=>String(x).padStart(2,"0");
  return date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate());
}
// Display strings are separate from stored codes; never rewrite API payload values.
export function normalizeStatus(value){
  return String(value??"UNKNOWN").trim().replace(/([a-z])([A-Z])/g,"$1_$2")
    .replace(/[^A-Za-z0-9]+/g,"_").toUpperCase()||"UNKNOWN";
}
// Three semantic tones, including the default neutral. Colors describe urgency,
// not arbitrary workflow stages such as OPEN, SAVED or IN_PROGRESS.
const URGENT_STATES=new Set(["CRITICAL","FAILED","OVERDUE","EMERGENCY","PAST_DUE"]);
const ATTENTION_STATES=new Set(["HIGH","MEDIUM","POOR","DEGRADED","DUE_SOON","AT_RISK"]);
export function statusTone(value){
  const state=normalizeStatus(value);
  return URGENT_STATES.has(state)?"urgent":ATTENTION_STATES.has(state)?"attention":"neutral";
}
export function statusLabel(value){
  const normalized=normalizeStatus(value);
  return normalized.split("_").filter(Boolean).join(" ").toLocaleLowerCase("en-ZA")
    .replace(/^./,first=>first.toLocaleUpperCase("en-ZA"));
}
const ACTION_LABELS=Object.freeze({
  REPORT_ISSUE:"Issue reported",RESOLVE_ISSUE:"Issue resolved",
  RECORD_REPAIR:"Repair recorded",CREATE_ASSET:"Asset registered",
  UPDATE_ASSET:"Asset updated",CREATE_CHARGE:"Charge created",
  UPDATE_CHARGE:"Charge updated",SAVE_PURCHASE:"Purchase saved",
  UPDATE_PURCHASE:"Purchase updated",ATTACH_DOCUMENT:"File attached",
  COMPLETE_MAINTENANCE:"Maintenance completed"
});
export function actionLabel(value){
  const state=normalizeStatus(value);
  return ACTION_LABELS[state]??statusLabel(state);
}
export function matchesSearch(text,query){
  const norm=x=>String(x??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase().trim();
  return norm(text).includes(norm(query));
}
export function countLabel(visible,total,singular="entry",plural=singular==="entry"?"entries":singular+"s",filtered=false){
  return filtered?visible+" of "+total:total+" "+(total===1?singular:plural);
}
export function matchesStatusFilter(status,active){
  return status==="all"||active==null||(status==="open"?Boolean(active):!active);
}
