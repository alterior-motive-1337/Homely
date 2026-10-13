import OpenAI, { toFile } from "openai";
import type { HomelyDatabase } from "../db.js";
import { activeHomeId } from "../security/homeScope.js";
import { config } from "../config.js";
import { DomainError } from "../domain/transactions.js";
import { getStoredFile, readStoredFile } from "./storage.js";
import { DOCX_MIME, extractDocument } from "./extract.js";

type MediaClient = Pick<OpenAI,"chat"|"audio">;

export function cachedAnalysis(db: HomelyDatabase, documentId: string) {
  return db.prepare("SELECT f.content_text,f.model,f.analyzed_at FROM file_analysis f JOIN documents d ON d.id=f.document_id WHERE f.document_id=? AND d.home_id IS COALESCE(NULLIF(?,''),d.home_id)").get(documentId,activeHomeId() ?? "");
}

/** On-demand processing only; original media stays exclusively in Turso. */
export async function analyzeDocument(
  db: HomelyDatabase,
  documentId: string,
  client?: MediaClient,
  visualFrames?: Array<{image:string;timeSeconds:number}>
) {
  const document=db.prepare("SELECT id,title FROM documents WHERE id=? AND home_id IS COALESCE(NULLIF(?,''),home_id)").get(documentId,activeHomeId() ?? "");
  if(!document)throw new DomainError("Evidence record not found.",404);
  const file=getStoredFile(db,documentId);
  const mime=file.mimeType;
  if(visualFrames!==undefined){
    if(!mime.startsWith("video/"))throw new DomainError("Frame analysis requires a stored video.");
    if(!Array.isArray(visualFrames)||!visualFrames.length||visualFrames.length>3)throw new DomainError("Provide up to three video frames.");
    for(const frame of visualFrames){
      if(typeof frame?.image!=="string"||frame.image.length>300_000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(frame.image)||!Number.isFinite(frame.timeSeconds)||frame.timeSeconds<0)throw new DomainError("Invalid video frame.");
      const bytes=Buffer.from(frame.image.slice(23),"base64");if(bytes[0]!==255||bytes[1]!==216)throw new DomainError("Invalid JPEG frame.");
    }
  }
  const cached=cachedAnalysis(db,documentId);
  if(cached&&(!visualFrames||String(cached.model).endsWith(":video-frames")))return { text:String(cached.content_text),model:String(cached.model),cached:true };
  let content="";
  let model="";
  if(mime==="text/plain"||mime==="text/csv"||mime==="application/json"){
    if(file.length>1_000_000)throw new DomainError("Text extraction currently supports files up to 1 MB.",413);
    content=readStoredFile(db,documentId,1_000_000).toString("utf8").slice(0,20000);
    model="local-text";
  }else if(mime==="application/pdf"||mime===DOCX_MIME){
    if(file.length>12_000_000)throw new DomainError("Document extraction supports files up to 12 MB.",413);
    content=await extractDocument(readStoredFile(db,documentId,12_000_000),mime);
    model=mime==="application/pdf"?"local-pdf":"local-docx";
    if(!content)throw new DomainError("No readable text. Scanned documents need OCR.",422);
  }else{
    const api=client ?? (config.groqApiKey ? new OpenAI({
      apiKey:config.groqApiKey,baseURL:"https://api.groq.com/openai/v1"
    }) : null);
    if(!api)throw new DomainError("Groq must be configured to analyze multimedia.",503);
    if(visualFrames){
      const visionModel="qwen/qwen3.8-27b";model=visionModel+":video-frames";
      const result=await api.chat.completions.create({model:visionModel,messages:[{role:"user",content:[
        {type:"text",text:"Interpret these three sampled household video frames. Frame times in seconds: "+visualFrames.map(f=>f.timeSeconds).join(", ")+". Describe visible equipment, text or damage. These are samples, not full-video understanding. Do not infer unseen events, motion or audio."},
        ...visualFrames.map(frame=>({type:"image_url" as const,image_url:{url:frame.image}}))
      ]}],max_completion_tokens:1200});
      const text=result.choices[0]?.message.content?.trim()??"";
      if(text)content="Video samples at "+visualFrames.map(f=>f.timeSeconds+"s").join(", ")+".\n\n"+text;
    }else if(/^image\/(png|jpeg|webp)$/.test(mime)){
      // Base64 expands the request. Leave headroom below Groq's 20 MB image request cap.
      if(file.length>12_000_000)throw new DomainError("Image analysis supports images up to 12 MB; the original 50 MB file remains stored.",413);
      model="qwen/qwen3.8-27b";
      const data=readStoredFile(db,documentId,12_000_000).toString("base64");
      const result=await api.chat.completions.create({
        model,
        messages:[{role:"user",content:[
          {type:"text",text:"Describe this household evidence accurately, including visible text, equipment, model numbers and any visible damage. Do not invent details or assert facts not visible."},
          {type:"image_url",image_url:{url:`data:${mime};base64,${data}`}}
        ]}],
        max_completion_tokens:1200
      });
      content=result.choices[0]?.message.content?.trim()??"";
    }else if(/^(audio\/(mpeg|mp4|wav|ogg|webm|x-wav|flac)|video\/(mp4|webm))$/.test(mime)){
      // Whisper on Groq Free is limited to 25 MB, independent of Homely's 50 MB storage.
      if(file.length>25_000_000)throw new DomainError("Speech transcription supports files up to 25 MB on Groq Free; the full 50 MB original remains stored.",413);
      model="whisper-large-v3-turbo";
      const bytes=readStoredFile(db,documentId,25_000_000);
      const uploaded=await toFile(bytes,file.name,{type:mime});
      const transcript=await api.audio.transcriptions.create({file:uploaded,model});
      content=String(transcript.text??"").trim();
    }else{
      throw new DomainError("No compatible processor for this format.",415);
    }
  }
  if(!content)throw new DomainError("Media processing returned no usable content.",422);
  content=content.slice(0,20000);
  db.prepare(`INSERT INTO file_analysis(document_id,content_text,model,analyzed_at)
    VALUES (?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET
    content_text=excluded.content_text,model=excluded.model,analyzed_at=excluded.analyzed_at
  `).run(documentId,content,model,new Date().toISOString());
  return {text:content,model,cached:false};
}
