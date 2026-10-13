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
/** Download complete structured memory and binary files as a streaming tar archive. */
export async function streamHomeArchive(db:HomelyDatabase,user:AuthUser,res:http.ServerResponse) {
  if(user.role!=="OWNER")throw new DomainError("Only household owners can export the home.",403);
  const snapshot=homeSnapshot(db,user.homeId);
  res.setHeader("content-type","application/x-tar");
  res.setHeader("content-disposition",'attachment; filename="homely-backup.tar"');
  res.setHeader("cache-control","no-store");
  res.setHeader("x-content-type-options","nosniff");
  res.writeHead(200);
  return writeHomeArchive(db,user.homeId,res,snapshot);
}

export async function writeHomeArchive(db:HomelyDatabase,homeId:string,res:Writable,snapshot=homeSnapshot(db,homeId)) {
  const buffer=Buffer.from(JSON.stringify(snapshot,null,2),"utf8");
  await output(res,tarHeader("homely.json",buffer.length));
  await output(res,buffer);await endFile(res,buffer.length);
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
