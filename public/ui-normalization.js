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
export function localDateInput(date=new Date()){
  if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw new RangeError("Invalid date.");
  const pad=x=>String(x).padStart(2,"0");
  return date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate());
}
export function normalizeStatus(value){
  return String(value??"UNKNOWN").trim().toUpperCase().replaceAll(" ","_")||"UNKNOWN";
}
export function statusTone(value){
  const v=normalizeStatus(value);
  if(["CRITICAL","OVERDUE","FAILED"].includes(v))return "urgent";
  if(["HIGH","POOR","DEGRADED"].includes(v))return "attention";
  return "neutral";
}
export function statusLabel(value){return normalizeStatus(value).replaceAll("_"," ")}
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
