import type http from "node:http";
import type { Writable } from "node:stream";
import { once } from "node:events";
import { createHash } from "node:crypto";
import type { HomelyDatabase } from "../db.js";
import type { AuthUser } from "../security/googleAuth.js";
import { DomainError } from "./transactions.js";

const BLOCK=512;
const pad=(n:number)=>(BLOCK-n%BLOCK)%BLOCK;
function octal(header:Buffer,value:number,offset:number,length:number) {
  const text=Math.floor(value).toString(8).padStart(length-1,"0")+"\0";
  header.write(text,offset,length,"ascii");
}
function tarHeader(name:string,size:number) {
  if(!/^[a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9]+)?$/.test(name) || Buffer.byteLength(name)>100)throw new Error("Invalid export filename");
  const header=Buffer.alloc(BLOCK);
  header.write(name,0,100,"ascii");
  octal(header,0o600,100,8);
  octal(header,0,108,8);
  octal(header,0,116,8);
  octal(header,size,124,12);
  octal(header,Math.floor(Date.now()/1000),136,12);
  header.fill(" ",148,156);
  header.write("0",156);
  header.write("ustar\0",257,6,"ascii");
  header.write("00",263,2,"ascii");
  let total=0;
  for(const byte of header)total+=byte;
  octal(header,total,148,8);
  return header;
}
async function output(res:Writable,data:Buffer) {
  if(res.destroyed)throw new Error("Client disconnected during export");
  if(!res.write(data))await once(res,"drain");
}
async function endFile(res:Writable,size:number) {
  const rem=pad(size);
  if(rem)await output(res,Buffer.alloc(rem));
}
type TableDef = {name:string;query:string};
const TABLES:TableDef[]=[
  {name:"homes",query:"SELECT * FROM homes WHERE id=?"},
  {name:"systems",query:"SELECT * FROM systems WHERE home_id=?"},
  {name:"assets",query:"SELECT a.* FROM assets a JOIN systems s ON s.id=a.system_id WHERE s.home_id=?"},
  {name:"issues",query:"SELECT i.* FROM issues i JOIN assets a ON a.id=i.asset_id JOIN systems s ON s.id=a.system_id WHERE s.home_id=?"},
  {name:"maintenance_rules",query:"SELECT m.* FROM maintenance_rules m JOIN assets a ON a.id=m.asset_id JOIN systems s ON s.id=a.system_id WHERE s.home_id=?"},
  {name:"repairs",query:"SELECT * FROM repairs WHERE home_id=?"},
  {name:"charges",query:"SELECT * FROM charges WHERE home_id=?"},
  {name:"purchase_candidates",query:"SELECT * FROM purchase_candidates WHERE home_id=?"},
  {name:"documents",query:"SELECT * FROM documents WHERE home_id=?"},
  {name:"timeline_events",query:"SELECT * FROM timeline_events WHERE home_id=?"},
  {name:"projects",query:"SELECT * FROM projects WHERE home_id=?"},
  {name:"transactions",query:"SELECT * FROM transactions WHERE home_id=?"},
  {name:"transaction_changes",query:"SELECT c.* FROM transaction_changes c JOIN transactions t ON t.id=c.transaction_id WHERE t.home_id=?"},
  {name:"file_analysis",query:"SELECT a.* FROM file_analysis a JOIN documents d ON d.id=a.document_id WHERE d.home_id=?"}
];
export function homeSnapshot(db:HomelyDatabase,homeId:string) {
  const tables:Record<string,unknown>= {};
  for(const table of TABLES)tables[table.name]=db.prepare(table.query).all(homeId);
  const uploads=db.prepare(`SELECT f.id,f.file_name,f.mime_type,f.document_id,
    f.expected_bytes,f.received_bytes,f.created_at,f.completed
    FROM file_uploads f JOIN documents d ON d.id=f.document_id
    WHERE d.home_id=? AND f.home_id=? AND f.completed=1
    ORDER BY f.created_at`).all(homeId,homeId);
  const checkedUploads=uploads.map(upload=>{
    const hash=createHash("sha256"),id=String(upload.id);
    if(Number(upload.expected_bytes)>0){
      for(let index=0;index<Math.ceil(Number(upload.received_bytes)/1_000_000);index++){
        const chunk=db.prepare("SELECT content FROM file_upload_chunks WHERE upload_id=? AND chunk_index=?").get(id,index);
        if(!chunk)throw new DomainError("Stored file is incomplete.",500);
        hash.update(Buffer.from(chunk.content as Uint8Array));
      }
    }else{
      const file=db.prepare("SELECT content FROM file_uploads WHERE id=? AND home_id=?").get(id,homeId);
      if(!file)throw new DomainError("Stored file is missing.",500);
      hash.update(Buffer.from(file.content as Uint8Array));
    }
    return {...upload,sha256:hash.digest("hex")} as typeof upload & {sha256:string};
  });
  return {format:"homely-export-v1",exportedAt:new Date().toISOString(),homeId,tables,uploads:checkedUploads};
}

type EvidenceEntry={
  id:string;title:string;type:string;status:string;occurredAt:string;recordedAt:string;
  fileName:string;storedCopy:string;archiveFile:string;mimeType:string;bytes:string;sha256:string;provenance:string;
  reason:string;associations:string;sourceUrl:string;auditReference:string;
};
function evidenceEntries(snapshot:ReturnType<typeof homeSnapshot>):EvidenceEntry[]{
  const docs=snapshot.tables.documents as Array<Record<string,unknown>>;
  const uploadsByDocument=new Map(snapshot.uploads.map(upload=>[String(upload.document_id),upload]));
  const transactions=new Map((snapshot.tables.transactions as Array<Record<string,unknown>>).map(row=>[String(row.id),row]));
  const changes=snapshot.tables.transaction_changes as Array<Record<string,unknown>>;
  const related=[
    ["asset","assets","asset_id","name"],
    ["issue","issues","issue_id","title"],
    ["repair","repairs","repair_id","title"],
    ["charge","charges","charge_id","name"],
    ["purchase","purchase_candidates","purchase_candidate_id","title"]
  ] as const;
  const indexes=new Map(related.map(([kind,table,,label])=>[
    kind,new Map((snapshot.tables[table] as Array<Record<string,unknown>>).map(row=>[String(row.id),String(row[label]??row.id)]))
  ]));
  return docs.map(doc=>{
    const id=String(doc.id),upload=uploadsByDocument.get(id);
    const associations=related.flatMap(([kind,,,])=>{
      const field={asset:"asset_id",issue:"issue_id",repair:"repair_id",charge:"charge_id",purchase:"purchase_candidate_id"}[kind];
      const reference=doc[field];
      if(typeof reference!=="string")return [];
      const name=indexes.get(kind)?.get(reference)??reference;
      return [kind+": "+name];
    });
    const auditReference=changes.filter(change=>change.entity_type==="document"&&change.entity_id===id).map(change=>{
      const transaction=transactions.get(String(change.transaction_id));
      if(!transaction)return "";
      return [String(change.operation??""),String(transaction.action_type??""),String(transaction.id),
        String(transaction.status??""),String(transaction.committed_at??transaction.created_at??"")].filter(Boolean).join(" · ");
    }).filter(Boolean).join("; ");
    return {
      id,title:String(doc.title??""),type:String(doc.type??""),
      status:String(doc.evidence_status??""),
      occurredAt:String(doc.occurred_at??"").slice(0,10),
      recordedAt:String(doc.created_at??""),
      fileName:String(upload?.file_name??doc.original_name??""),
      storedCopy:upload?"Original uploaded bytes included":"No uploaded bytes in this bundle",
      archiveFile:upload?"files/"+String(upload.id):"",
      mimeType:String(doc.mime_type??upload?.mime_type??""),
      bytes:upload?String(upload.received_bytes??""):"",
      sha256:String(upload?.sha256??""),
      provenance:String(doc.provenance??""),
      reason:String(doc.evidence_reason??""),
      associations:associations.join("; "),
      sourceUrl:String(doc.source_url??""),
      auditReference
    };
  });
}
const htmlEscape=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
function csvCell(value:string){
  const safe=/^[\t\r ]*[=+\-@]/.test(value)?"'"+value:value;
  return '"'+safe.replaceAll('"','""')+'"';
}
function evidenceRegisterHtml(snapshot:ReturnType<typeof homeSnapshot>,entries:EvidenceEntry[]){
  const columns=[
    ["Record ID","id"],["Title","title"],["Type","type"],["Status","status"],
    ["Evidence date","occurredAt"],["Recorded by Homely (UTC)","recordedAt"],
    ["Original filename","fileName"],["Stored copy","storedCopy"],["Archive member","archiveFile"],["Media type","mimeType"],["Bytes","bytes"],
    ["SHA-256","sha256"],["Provenance","provenance"],["Reason","reason"],
    ["Associations","associations"],["Source URL","sourceUrl"],["Homely audit reference","auditReference"]
  ] as const;
  const header=columns.map(([label])=>"<th scope=\"col\">"+htmlEscape(label)+"</th>").join("");
  const rows=entries.map(entry=>"<tr>"+columns.map(([,key])=>"<td>"+htmlEscape(entry[key])+"</td>").join("")+"</tr>").join("");
  return Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Homely evidence register</title><style>
body{font:14px/1.45 system-ui,sans-serif;color:#171717;margin:2rem}
h1{font-size:1.5rem;margin-bottom:.25rem}.meta,.notice{color:#444}
.notice{border:1px solid #777;padding:.8rem;margin:1rem 0}
table{border-collapse:collapse;width:100%;font-size:10px}th,td{border:1px solid #999;padding:.35rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#eee}code{font-size:9px;overflow-wrap:anywhere}
@media print{body{margin:0}h1{font-size:16pt}.notice{break-inside:avoid}table{font-size:7pt}thead{display:table-header-group}tr{break-inside:avoid}}
</style></head><body>
<h1>Homely evidence register</h1>
<p class="meta">Household ID: ${htmlEscape(snapshot.homeId)} · Exported: ${htmlEscape(snapshot.exportedAt)} (UTC) · Records: ${entries.length}</p>
<p class="notice">This register reflects metadata and approval history stored in Homely. It is not a certification of authenticity, an independent timestamp, or a statement of legal admissibility. The SHA-256 values are fingerprints for comparing file bytes; they do not prove who created or supplied a file. Preserve the original device and source records and seek jurisdiction-specific legal guidance.</p>
<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>
</body></html>`,"utf8");
}
function evidenceRegisterCsv(entries:EvidenceEntry[]){
  const columns=[
    ["record_id","id"],["title","title"],["type","type"],["status","status"],
    ["evidence_date","occurredAt"],["recorded_at_utc","recordedAt"],
    ["original_filename","fileName"],["stored_copy","storedCopy"],["archive_file","archiveFile"],["mime_type","mimeType"],["bytes","bytes"],
    ["sha256","sha256"],["provenance","provenance"],["reason","reason"],
    ["associations","associations"],["source_url","sourceUrl"],["homely_audit_reference","auditReference"]
  ] as const;
  const lines=[columns.map(([label])=>csvCell(label)).join(","),
    ...entries.map(entry=>columns.map(([,key])=>csvCell(entry[key])).join(","))];
  return Buffer.from("\uFEFF"+lines.join("\r\n")+"\r\n","utf8");
}
function archiveNotes(){
  return Buffer.from("Homely household and evidence export\n\n"
    +"Contents: homely.json (structured records and metadata), evidence-register.html (printable index), evidence-register.csv (spreadsheet index), SHA256SUMS.txt (file fingerprints), and files/ (original uploaded bytes).\n\n"
    +"Verify extracted files with a SHA-256 utility against SHA256SUMS.txt. Keep this archive and the original source/device records unchanged. The checksums can detect byte changes relative to this package, but they are not a digital signature and do not independently prove authorship, origin, or time of creation. Homely's recorded timestamps are application records, not independent trusted timestamps. This export is not a certification of legal admissibility; requirements vary by jurisdiction.\n","utf8");
}
/** Download complete structured memory and binary files as a streaming tar archive. */
export async function streamHomeArchive(db:HomelyDatabase,user:AuthUser,res:http.ServerResponse) {
  if(user.role!=="OWNER")throw new DomainError("Only household owners can export the home.",403);
  const snapshot=homeSnapshot(db,user.homeId);
  res.setHeader("content-type","application/x-tar");
  res.setHeader("content-disposition",'attachment; filename="homely-evidence-bundle.tar"');
  res.setHeader("cache-control","no-store");
  res.setHeader("x-content-type-options","nosniff");
  res.writeHead(200);
  return writeHomeArchive(db,user.homeId,res,snapshot);
}

export async function writeHomeArchive(db:HomelyDatabase,homeId:string,res:Writable,snapshot=homeSnapshot(db,homeId)) {
  const buffer=Buffer.from(JSON.stringify(snapshot,null,2),"utf8");
  const evidence=evidenceEntries(snapshot);
  const registerHtml=evidenceRegisterHtml(snapshot,evidence),registerCsv=evidenceRegisterCsv(evidence),notes=archiveNotes();
  const checksums=[
    [createHash("sha256").update(buffer).digest("hex"),"homely.json"],
    [createHash("sha256").update(registerHtml).digest("hex"),"evidence-register.html"],
    [createHash("sha256").update(registerCsv).digest("hex"),"evidence-register.csv"],
    [createHash("sha256").update(notes).digest("hex"),"EXPORT-NOTES.txt"],
    ...snapshot.uploads.map(upload=>[String(upload.sha256),"files/"+String(upload.id)])
  ].map(([hash,name])=>hash+"  "+name).join("\n")+"\n";
  const checkBuffer=Buffer.from(checksums,"utf8");
  const artifacts=[
    ["homely.json",buffer],
    ["evidence-register.html",registerHtml],
    ["evidence-register.csv",registerCsv],
    ["EXPORT-NOTES.txt",notes],
    ["SHA256SUMS.txt",checkBuffer]
  ] as const;
  for(const [name,content] of artifacts){
    await output(res,tarHeader(name,content.length));
    await output(res,content);await endFile(res,content.length);
  }
  for(const item of snapshot.uploads){
    const id=String(item.id);
    const length=Number(item.expected_bytes)>0?Number(item.received_bytes):Number(
      db.prepare("SELECT length(content) AS bytes FROM file_uploads WHERE id=? AND home_id=?").get(id,homeId)?.bytes??0);
    // File extension is recovered from the metadata in homely.json.
    await output(res,tarHeader("files/"+id,length));
    let received=0;
    if(Number(item.expected_bytes)>0){
      const count=Math.ceil(length/1_000_000);
      for(let index=0;index<count;index++){
        const chunk=db.prepare("SELECT content FROM file_upload_chunks WHERE upload_id=? AND chunk_index=?").get(id,index);
        if(!chunk){res.destroy();throw new Error("Stored file chunk missing during export");}
        const bytes=Buffer.from(chunk.content as Uint8Array);
        received+=bytes.length;await output(res,bytes);
      }
    }else{
      const file=db.prepare("SELECT content FROM file_uploads WHERE id=? AND home_id=?").get(id,homeId);
      if(!file){res.destroy();throw new Error("Stored file missing during export");}
      const bytes=Buffer.from(file.content as Uint8Array);received=bytes.length;await output(res,bytes);
    }
    if(received!==length){res.destroy();throw new Error("File length mismatch in export");}
    await endFile(res,length);
  }
  await output(res,Buffer.alloc(BLOCK*2));
  res.end();
}
