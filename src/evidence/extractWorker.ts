import { parentPort, workerData } from "node:worker_threads";

const bytes=new Uint8Array(workerData.bytes);
try{
  let text="";
  if(workerData.mime==="application/pdf"){
    const {getDocument}=await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task=getDocument({data:bytes,disableFontFace:true,useSystemFonts:false,verbosity:0});
    try{
      const pdf=await task.promise;
      for(let page=1;page<=Math.min(pdf.numPages,100)&&text.length<20_000;page++){
        const content=await (await pdf.getPage(page)).getTextContent();
        text+=content.items.map(item=>"str" in item?item.str+(item.hasEOL?"\n":" "):"").join("")+"\n";
      }
    }finally{await task.destroy()}
  }else{
    const mammoth=await import("mammoth");
    text=(await mammoth.extractRawText({buffer:Buffer.from(bytes)})).value;
  }
  parentPort?.postMessage({text:text.trim().slice(0,20_000)});
}catch(error){parentPort?.postMessage({error:error instanceof Error?error.message:"Document unreadable"})}
