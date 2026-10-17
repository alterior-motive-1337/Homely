import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";
import type { HomelyDatabase } from "../db.js";
import type { AuthUser } from "../security/googleAuth.js";
import { DomainError } from "./transactions.js";

/** Creates one private, editable sample household per owner. Never reseeds an existing home. */
export function openSampleHome(db: HomelyDatabase, user: AuthUser) {
  if(user.role!=="OWNER")throw new DomainError("Only a household owner can create a sample home.",403);
  const now=new Date().toISOString();
  const date=(days:number)=>new Date(Date.now()+days*86400_000).toISOString().slice(0,10);
  const homeId="home-sample-"+randomUUID();
  const ids=new Map<string,string>();
  const id=(key:string)=>{if(!ids.has(key))ids.set(key,randomUUID());return ids.get(key)!};
  // Table and field names below are code constants, never request data.
  const insert=(table:string,record:Record<string,SQLInputValue>)=>{
    const keys=Object.keys(record);
    db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(()=>"?").join(",")})`).run(...Object.values(record));
  };
  db.exec("BEGIN IMMEDIATE;");
  try{
    const existing=db.prepare(`SELECT h.home_id FROM sample_homes h JOIN home_memberships m
      ON m.home_id=h.home_id AND m.user_id=h.user_id WHERE h.user_id=? AND m.role='OWNER'`).get(user.id);
    if(existing){db.exec("COMMIT;");return {homeId:String(existing.home_id),created:false}}
    insert("homes",{id:homeId,name:"Sample home",address_label:null,created_at:now,updated_at:now});
    insert("home_memberships",{home_id:homeId,user_id:user.id,role:"OWNER",joined_at:now});
    insert("sample_homes",{user_id:user.id,home_id:homeId});
    for(const [key,name,category] of [["kitchen","Kitchen","APPLIANCES"],["utility","Utility room","APPLIANCES"],["living","Living room","FURNITURE"]]){
      insert("systems",{id:id(key!),home_id:homeId,name:name!,category:category!,position:ids.size,created_at:now,updated_at:now});
    }
    const assets=[
      ["fridge","kitchen","Fridge freezer","APPLIANCE","GOOD",125000,"Kitchen"],
      ["dishwasher","kitchen","Dishwasher","APPLIANCE","FAIR",65000,"Kitchen"],
      ["oven","kitchen","Electric oven","APPLIANCE","POOR",82000,"Kitchen"],
      ["kettle","kitchen","Electric kettle","APPLIANCE","NEW",4500,"Kitchen counter"],
      ["washer","utility","Washing machine","APPLIANCE","FAILED",90000,"Utility room"],
      ["dryer","utility","Tumble dryer","APPLIANCE","GOOD",78000,"Utility room"],
      ["sofa","living","Three-seat sofa","FURNITURE","GOOD",145000,"Living room"],
      ["table","living","Dining table","FURNITURE","FAIR",0,"Dining area"],
      ["chair","living","Vintage reading chair with an exceptionally long descriptive name to test filename and title fading","FURNITURE","UNKNOWN",null,"Reading corner"]
    ] as const;
    for(const [key,system,name,category,condition,cost,location] of assets){
      insert("assets",{id:id(key),system_id:id(system),name,category,condition,location,purchase_cost_cents:cost,
        manufacturer:"Sample manufacturer",model:"DEMO-"+key.toUpperCase(),serial_number:"SAMPLE-"+key.toUpperCase(),
        purchase_date:date(-180),warranty_start:date(-180),warranty_end:date(key==="fridge"?20:185),
        notes:"Fictional sample record. Edit freely to test Homely.",health_observed_at:condition==="UNKNOWN"?null:now,created_at:now,updated_at:now});
    }
    const issues=[
      ["leak","dishwasher","Water collecting beneath dishwasher","OPEN","HIGH","Small puddle after the rinse cycle."],
      ["washer-fault","washer","Washing machine will not start","IN_PROGRESS","CRITICAL","Sample E04 error; service visit booked."],
      ["oven-temp","oven","Oven temperature fluctuates","PLANNED","MEDIUM","Thermostat inspection planned for next week."],
      ["table-wobble","table","Dining table leg needs checking","MONITORING","LOW","Monitor movement after tightening the bolts."],
      ["fridge-seal","fridge","Fridge door seal replaced","RESOLVED","MEDIUM","New seal fitted and temperature checked."],
      ["dryer-filter","dryer","Dryer filter blockage cleared","CLOSED","LOW","Filter cleaned; airflow restored."]
    ] as const;
    for(const [key,asset,title,status,severity,description] of issues){
      insert("issues",{id:id(key),asset_id:id(asset),title,status,severity,description,detected_at:date(-10),
        resolved_at:["RESOLVED","CLOSED"].includes(status)?date(-3):null,created_at:now,updated_at:now});
    }
    for(const [key,asset,issue,title,cost] of [
      ["seal-repair","fridge","fridge-seal","Replace fridge door seal",25000],
      ["filter-repair","dryer","dryer-filter","Clean dryer filter and duct",15000],
      ["table-repair","table","table-wobble","Tighten dining table fixings",0]
    ] as const){
      insert("repairs",{id:id(key),home_id:homeId,asset_id:id(asset),issue_id:id(issue),title,
        description:"Fictional completed repair for testing.",repair_date:date(-3),cost_cents:cost,contractor:"Sample Home Services",
        outcome:"Completed; check performance during normal use.",created_at:now});
      insert("timeline_events",{id:randomUUID(),home_id:homeId,event_type:"REPAIR_RECORDED",title,summary:"Sample repair recorded.",
        occurred_at:date(-3),asset_id:id(asset),issue_id:id(issue),repair_id:id(key),created_at:now});
    }
    for(const [asset,title,offset] of [["washer","Inspect inlet hoses",-7],["dryer","Clean lint filter",2],["fridge","Check door seals",14],["oven","Deep clean oven",30]] as const){
      insert("maintenance_rules",{id:randomUUID(),asset_id:id(asset),title,interval_days:90,last_completed_at:date(offset-90),next_due_at:date(offset),active:1,created_at:now,updated_at:now});
    }
    for(const [key,name,cycle,amount,active] of [["electricity","Electricity","MONTHLY",185000,1],["insurance","Home insurance","ANNUAL",420000,1],["old-internet","Previous internet plan","MONTHLY",69900,0]] as const){
      insert("charges",{id:id(key),home_id:homeId,name,category:"HOUSEHOLD",billing_cycle:cycle,amount_cents:amount,due_day:15,
        provider:"Sample provider",notes:"Fictional charge for testing.",active,created_at:now,updated_at:now});
    }
    for(const [key,asset,title,status,budget,cost] of [
      ["washer-purchase","washer","Replacement washing machine","SHORTLISTED",110000,95000],
      ["chair-purchase","chair","Reading lamp","SAVED",12000,8500],
      ["kettle-purchase","kettle","New electric kettle","PURCHASED",6000,4500],
      ["sofa-purchase","sofa","Sofa cover","DISMISSED",20000,18000]
    ] as const){
      insert("purchase_candidates",{id:id(key),home_id:homeId,asset_id:id(asset),title,category:"HOUSEHOLD",status,
        budget_cents:budget,expected_cost_cents:cost,source_name:"Sample catalogue",rationale:"Fictional purchase for testing.",created_at:now,updated_at:now});
    }
    const fixture=(name:string)=>Buffer.from(fs.readFileSync(path.resolve("fixtures/sample-home",name+".base64"),"utf8"),"base64");
    const files=[
      {title:"Fridge service receipt.pdf",mime:"application/pdf",asset:"fridge",repair:"seal-repair",bytes:fixture("receipt.pdf")},
      {title:"Sample repair receipt.docx",mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",asset:"fridge",bytes:fixture("receipt.docx")},
      {title:"Playback test — colour bars.webm",mime:"video/webm",asset:"washer",bytes:fixture("video.webm")},
      {title:"Washing machine warranty.txt",mime:"text/plain",asset:"washer",bytes:Buffer.from("SAMPLE WARRANTY\nFictional manufacturer: Sample manufacturer\nModel: DEMO-WASHER\nSerial: SAMPLE-WASHER\nCoverage: 24 months from purchase.\nKeep the receipt and serial number for a claim.\n")},
      {title:"A very long household maintenance schedule filename containing detailed appliance inspection notes and warranty reference information for testing the fading title behaviour.csv",mime:"text/csv",asset:"dryer",bytes:Buffer.from("appliance,task,interval_days\nDryer,Clean lint filter,7\nFridge,Inspect door seals,90\nOven,Deep clean,90\n")},
      {title:"Reading corner reference.svg",mime:"image/svg+xml",asset:"chair",bytes:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="440" viewBox="0 0 600 440"><rect width="600" height="440" fill="#d5cfc3"/><rect y="320" width="600" height="120" fill="#9d9284"/><rect x="46" y="42" width="236" height="247" rx="9" fill="#aab6b7" stroke="#ede8df" stroke-width="18"/><path d="M164 45v235M49 160h231" stroke="#ede8df" stroke-width="13"/><circle cx="535" cy="88" r="37" fill="#ece1bf"/><path d="M355 302h202v13H355z" fill="#483c34"/><path d="M378 316v87M532 316v87" stroke="#483c34" stroke-width="12"/><path d="M376 306q-10-112 69-114 82-4 71 114" fill="#ad8469" stroke="#695446" stroke-width="12"/><rect x="411" y="208" width="67" height="80" rx="12" fill="#b9947a"/><path d="M423 320l-27 74M483 320l31 74" stroke="#594b41" stroke-width="14"/><rect x="307" y="74" width="69" height="139" rx="4" fill="#766453"/><path d="M317 99h51M317 151h51" stroke="#d9c9ab" stroke-width="8"/><rect x="316" y="103" width="8" height="39" fill="#d7ae6d"/><rect x="337" y="112" width="12" height="30" fill="#929d80"/><rect x="351" y="107" width="11" height="35" fill="#c5a27d"/><path d="M557 288v-84" stroke="#545f45" stroke-width="7"/><ellipse cx="546" cy="209" rx="25" ry="41" fill="#69795a"/><ellipse cx="566" cy="224" rx="21" ry="36" fill="#788966"/><path d="M316 405h234" stroke="#54463c" stroke-width="5" opacity=".25"/></svg>`)},
      {title:"Sample household inventory.json",mime:"application/json",asset:"chair",bytes:Buffer.from(JSON.stringify({sample:true,room:"Reading corner",item:"Vintage reading chair",condition:"UNKNOWN"},null,2))}
    ];
    for(const file of files){
      const documentId=randomUUID(),uploadId=randomUUID();
      insert("documents",{id:documentId,home_id:homeId,title:file.title,type:file.mime==="video/webm"?"VIDEO":"DOCUMENT",provider:"LOCAL",
        local_path:"/api/files/"+documentId,mime_type:file.mime,asset_id:id(file.asset),repair_id:"repair" in file?id(file.repair!):null,
        provenance:"Fictional sample evidence",evidence_reason:"Sample file for preview, analysis and attachment testing.",created_at:now,updated_at:now});
      insert("file_uploads",{id:uploadId,home_id:homeId,file_name:file.title,mime_type:file.mime,content:Buffer.alloc(0),document_id:documentId,
        expected_bytes:file.bytes.length,received_bytes:file.bytes.length,completed:1,created_at:now});
      insert("file_upload_chunks",{upload_id:uploadId,chunk_index:0,content:file.bytes});
      insert("timeline_events",{id:randomUUID(),home_id:homeId,event_type:"DOCUMENT_LINKED",title:file.title,summary:"Sample file added.",
        occurred_at:date(-2),asset_id:id(file.asset),document_id:documentId,created_at:now});
    }
    db.exec("COMMIT;");
    return {homeId,created:true};
  }catch(error){db.exec("ROLLBACK;");throw error}
}
