import fs from "node:fs";
import { randomUUID,createHash } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";
import type { HomelyDatabase } from "../db.js";
import { DomainError } from "./transactions.js";

const TABLES=["homes","systems","assets","issues","maintenance_rules","repairs","charges","purchase_candidates","projects","documents","transactions","timeline_events","transaction_changes","file_analysis"];
type Row=Record<string,unknown>;
type Entry={offset:number;length:number};
function archiveEntries(fd:number,size:number){
  const entries=new Map<string,Entry>();let position=0,ended=false;
  while(position+512<=size){
    const header=Buffer.alloc(512);if(fs.readSync(fd,header,0,512,position)!==512)throw new DomainError("Truncated archive.");
    if(header.every(x=>x===0)){ended=true;break}
    const text=(start:number,length:number)=>header.subarray(start,start+length).toString("ascii").replace(/\0.*$/s,"").trim();
    const number=(start:number,length:number)=>{const value=text(start,length);if(!/^[0-7]+$/.test(value))throw new DomainError("Invalid archive header.");return parseInt(value,8)};
    const checksum=number(148,8),copy=Buffer.from(header);copy.fill(32,148,156);
    if(copy.reduce((a,b)=>a+b,0)!==checksum)throw new DomainError("Archive checksum mismatch.");
    const name=text(0,100),length=number(124,12),type=text(156,1);
    if(!["0",""].includes(type)||text(345,155)||!(/^(homely\.json|files\/upload-[a-zA-Z0-9-]+)$/.test(name)))throw new DomainError("Unsupported archive entry.");
    if(entries.has(name)||length>(name==="homely.json"?10_000_000:50_000_000)||position+512+length>size)throw new DomainError("Invalid or oversized archive entry.");
    entries.set(name,{offset:position+512,length});position+=512+Math.ceil(length/512)*512;
  }
  if(!ended||!entries.has("homely.json"))throw new DomainError("Incomplete Homely archive.");
  return entries;
}
/** Restore into a new household. Never overwrite, delete, or merge the current household. */
export function restoreHomeArchive(db:HomelyDatabase,archivePath:string,ownerId:string){
  if(!db.prepare("SELECT id FROM auth_users WHERE id=?").get(ownerId))throw new DomainError("Existing owner account not found.",404);
  const size=fs.statSync(archivePath).size;
  if(size>520_000_000)throw new DomainError("Archive exceeds 520 MB.",413);
  const fd=fs.openSync(archivePath,"r");
  try{
    const entries=archiveEntries(fd,size),manifest=entries.get("homely.json")!;
    const bytes=Buffer.alloc(manifest.length);fs.readSync(fd,bytes,0,bytes.length,manifest.offset);
    let snapshot:{format:string;homeId:string;tables:Record<string,Row[]>;uploads:Row[]};
    try{snapshot=JSON.parse(bytes.toString("utf8"))}catch{throw new DomainError("Invalid backup manifest.")}
    if(snapshot.format!=="homely-export-v1"||!snapshot.tables||!Array.isArray(snapshot.uploads))throw new DomainError("Unsupported backup format.");
    const sourceHome=snapshot.tables.homes;
    if(sourceHome?.length!==1||sourceHome[0]?.id!==snapshot.homeId)throw new DomainError("Backup must contain one household.");
    const ids=new Map<string,string>();
    const byTable=new Map<string,Set<string>>();
    let rows=0;
    for(const table of TABLES){
      const data=snapshot.tables[table]??[];
      if(!Array.isArray(data))throw new DomainError("Invalid backup table.");
      rows+=data.length;if(rows>50_000)throw new DomainError("Backup has too many records.",413);
      const tableIds=new Set<string>();byTable.set(table,tableIds);
      for(const row of data){
        if(!row||typeof row!=="object"||Array.isArray(row))throw new DomainError("Invalid backup record.");
        // Analysis uses document_id as its primary key; every other exported record has id.
        if(table==="file_analysis")continue;
        if(typeof row.id!=="string"||!/^[a-zA-Z0-9-]+$/.test(row.id)||ids.has(row.id))throw new DomainError("Invalid or duplicate backup identifier.");
        tableIds.add(row.id);ids.set(row.id,(table==="homes"?"home":row.id.split("-")[0])+"-"+randomUUID());
      }
    }
    const homeId=ids.get(snapshot.homeId)!;
    let totalBytes=0;
    for(const upload of snapshot.uploads){
      const id=String(upload.id),entry=entries.get("files/"+id);
      if(!/^upload-[a-zA-Z0-9-]+$/.test(id)||ids.has(id)||!entry||!entry.length||!byTable.get("documents")!.has(String(upload.document_id)))throw new DomainError("Missing or invalid backup file.");
      if(Number(upload.expected_bytes)>0&&Number(upload.received_bytes)!==entry.length)throw new DomainError("Backup file size mismatch.");
      totalBytes+=entry.length;if(totalBytes>500_000_000)throw new DomainError("Restored home exceeds its file quota.",413);
      if(upload.sha256){
        const hash=createHash("sha256");
        for(let offset=0;offset<entry.length;offset+=1_000_000){const chunk=Buffer.alloc(Math.min(1_000_000,entry.length-offset));fs.readSync(fd,chunk,0,chunk.length,entry.offset+offset);hash.update(chunk)}
        if(hash.digest("hex")!==upload.sha256)throw new DomainError("Backup file checksum mismatch.");
      }
      ids.set(id,"upload-"+randomUUID());
    }
    if(entries.size!==snapshot.uploads.length+1)throw new DomainError("Unlisted files in archive.");
    const rewrite=(value:unknown):unknown=>{
      if(typeof value==="string"){
        if(ids.has(value))return ids.get(value);
        if(value.startsWith("/api/files/")){const mapped=ids.get(value.slice(11));if(!mapped)throw new DomainError("Missing file document reference.");return "/api/files/"+mapped}
        return value;
      }
      if(Array.isArray(value))return value.map(rewrite);
      if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v)]));
      return value;
    };
    // A tampered foreign key must not point at an existing record outside the backup.
    for(const table of TABLES){
      const foreign=db.prepare(`PRAGMA foreign_key_list(${table})`).all();
      for(const row of snapshot.tables[table]??[])for(const fk of foreign){const value=row[String(fk.from)];if(value!=null&&!byTable.get(String(fk.table))?.has(String(value)))throw new DomainError("Backup references a record outside its household.")}
    }
    db.exec("BEGIN IMMEDIATE;");
    try{
      db.exec("PRAGMA defer_foreign_keys=ON;");
      for(const table of TABLES){
        const allowed=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>String(c.name)));
        for(const old of snapshot.tables[table]??[]){
          const row=rewrite(old) as Row;
          for(const [column,value] of Object.entries(old))if(column.endsWith("_json")&&typeof value==="string"){
            try{row[column]=JSON.stringify(rewrite(JSON.parse(value)))}catch{throw new DomainError("Invalid JSON in backup history.")}
          }
          if(table==="homes")row.name=String(row.name)+" (restored)";
          if("home_id" in row)row.home_id=homeId;
          const columns=Object.keys(row).filter(c=>allowed.has(c));
          if(columns.some(c=>row[c]!==null&&!["string","number"].includes(typeof row[c])))throw new DomainError("Invalid backup field.");
          db.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")})`).run(...columns.map(c=>row[c] as SQLInputValue));
        }
      }
      for(const upload of snapshot.uploads){
        const entry=entries.get("files/"+upload.id)!,id=ids.get(String(upload.id))!;
        db.prepare("INSERT INTO file_uploads(id,file_name,mime_type,content,document_id,created_at,expected_bytes,received_bytes,completed,home_id) VALUES(?,?,?,X'',?,?,?,?,1,?)")
          .run(id,String(upload.file_name),String(upload.mime_type),ids.get(String(upload.document_id))!,String(upload.created_at),entry.length,entry.length,homeId);
        for(let offset=0,index=0;offset<entry.length;offset+=1_000_000,index++){
          const chunk=Buffer.alloc(Math.min(1_000_000,entry.length-offset));
          if(fs.readSync(fd,chunk,0,chunk.length,entry.offset+offset)!==chunk.length)throw new DomainError("Truncated backup media.");
          db.prepare("INSERT INTO file_upload_chunks(upload_id,chunk_index,content) VALUES(?,?,?)").run(id,index,chunk);
        }
      }
      const now=new Date().toISOString();
      db.prepare("INSERT INTO home_memberships(home_id,user_id,role,joined_at) VALUES(?,?,'OWNER',?)").run(homeId,ownerId,now);
      db.exec("COMMIT;");
      return {homeId,records:rows,files:snapshot.uploads.length};
    }catch(error){db.exec("ROLLBACK;");throw error}
  }finally{fs.closeSync(fd)}
}
