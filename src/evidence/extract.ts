import fs from "node:fs";
import { Worker } from "node:worker_threads";
import { DomainError } from "../domain/transactions.js";

export const DOCX_MIME="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
let extracting=false;
function validateDocx(bytes:Buffer){
  // Bound declared expansion before a ZIP parser touches document contents.
  let offset=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65_557);i--)if(bytes.readUInt32LE(i)===0x06054b50){offset=i;break}
  if(offset<0)throw new DomainError("Invalid DOCX file.");
  const count=bytes.readUInt16LE(offset+10),start=bytes.readUInt32LE(offset+16);
  if(count>1000||start>=offset)throw new DomainError("DOCX archive exceeds extraction limits.",413);
  let position=start,total=0;
  for(let i=0;i<count;i++){
    if(position+46>offset||bytes.readUInt32LE(position)!==0x02014b50)throw new DomainError("Invalid DOCX archive.");
    total+=bytes.readUInt32LE(position+24);
    if(total>20_000_000)throw new DomainError("Expanded DOCX exceeds 20 MB.",413);
    position+=46+bytes.readUInt16LE(position+28)+bytes.readUInt16LE(position+30)+bytes.readUInt16LE(position+32);
  }
}
export async function extractDocument(bytes:Buffer,mime:string):Promise<string>{
  if(bytes.length>12_000_000)throw new DomainError("Document extraction supports files up to 12 MB.",413);
  if(mime===DOCX_MIME)validateDocx(bytes);
  if(extracting)throw new DomainError("Another document is being read. Retry shortly.",503);
  extracting=true;
  const compiled=new URL("./extractWorker.js",import.meta.url);
  const path=fs.existsSync(compiled)?compiled:new URL("./extractWorker.ts",import.meta.url);
  try{return await new Promise<string>((resolve,reject)=>{
    const worker=new Worker(path,{execArgv:[],workerData:{bytes,mime},resourceLimits:{maxOldGenerationSizeMb:128,stackSizeMb:4}});
    let done=false;
    const finish=(error:Error|null,text?:string)=>{if(done)return;done=true;clearTimeout(timeout);void worker.terminate();if(error)reject(error);else resolve(text??"")};
    const timeout=setTimeout(()=>finish(new DomainError("Document extraction timed out.",422)),20_000);
    worker.on("message",(result:{error?:string;text?:string})=>finish(result.error?new DomainError("Document could not be read. It may be damaged or password-protected.",422):null,result.text));
    worker.on("error",()=>finish(new DomainError("Document extraction failed.",422)));
    worker.on("exit",code=>{if(!done)finish(new DomainError("Document extraction stopped.",422))});
  })}finally{extracting=false}
}
