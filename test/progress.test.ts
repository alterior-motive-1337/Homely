import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createTestDatabase } from "./helpers.js";
import { migrate } from "../src/db.js";
import { seedDemo } from "../src/seed.js";
import { runInHome } from "../src/security/homeScope.js";
import { proposeTransaction,commitTransaction,undoTransaction } from "../src/domain/transactions.js";
import { listAlerts,acknowledgeAlert } from "../src/domain/alerts.js";
import { saveChatTurn,chatHistory,clearChat,createChatConversation,listChatConversations,belongsToConversation } from "../src/domain/chat.js";
import { GroqAgentProvider } from "../src/agent/groqProvider.js";
import { extractDocument,DOCX_MIME } from "../src/evidence/extract.js";
import { analyzeDocument } from "../src/evidence/analyze.js";
import { writeHomeArchive } from "../src/domain/exportHome.js";
import { restoreHomeArchive } from "../src/domain/restoreHome.js";
import { startUpload,appendUploadChunk,finishUpload,readStoredFile,getStoredFile,MAX_FILE_BYTES } from "../src/evidence/storage.js";
import type { AuthUser } from "../src/security/googleAuth.js";

function fixture(){
  const db=createTestDatabase();migrate(db);seedDemo(db);const now=new Date().toISOString();
  for(const id of ["first","second"])db.prepare("INSERT INTO auth_users(id,google_subject,email,display_name,created_at,last_login_at) VALUES(?,?,?,?,?,?)").run(id,id,id+"@example.test",id,now,now);
  const user:AuthUser={id:"first",homeId:"home-hawthorn",email:"first@example.test",name:"First",role:"OWNER"};
  return {db,user};
}
test("alerts are personal, acknowledge without changing records, and recur when due dates change",()=>{
  const {db,user}=fixture();try{
    db.prepare("UPDATE maintenance_rules SET next_due_at='2020-01-01' WHERE id='maint-gate'").run();
    const alert=listAlerts(db,user).find(a=>a.recordId==="maint-gate")!;assert.ok(alert);
    acknowledgeAlert(db,user,alert.key);assert.equal(listAlerts(db,user).some(a=>a.key===alert.key),false);
    assert.equal(listAlerts(db,{...user,id:"second"}).some(a=>a.key===alert.key),true);
    assert.equal(db.prepare("SELECT active FROM maintenance_rules WHERE id='maint-gate'").get()?.active,1);
    db.prepare("UPDATE maintenance_rules SET next_due_at='2020-01-02' WHERE id='maint-gate'").run();
    assert.equal(listAlerts(db,user).some(a=>a.recordId==="maint-gate"),true);
  }finally{db.close()}
});
test("charge and purchase updates preview, commit, undo and reject stale or foreign records",()=>{
  const {db,user}=fixture();try{runInHome(user.homeId,()=>{
    const create=proposeTransaction(db,{actionType:"CREATE_CHARGE",reason:"Charge test",payload:{name:"Internet",category:"UTILITIES",amountCents:100,billingCycle:"MONTHLY"}});
    commitTransaction(db,String(create.transaction?.id));
    const charge=db.prepare("SELECT * FROM charges WHERE name='Internet'").get()!;
    const payload={chargeId:charge.id,name:"Internet",category:"UTILITIES",amountCents:200,billingCycle:"MONTHLY",active:0};
    const first=proposeTransaction(db,{actionType:"UPDATE_CHARGE",reason:"Update",payload});
    const stale=proposeTransaction(db,{actionType:"UPDATE_CHARGE",reason:"Stale",payload});
    assert.equal(db.prepare("SELECT active FROM charges WHERE id=?").get(String(charge.id))?.active,1);
    commitTransaction(db,String(first.transaction?.id));
    assert.equal(db.prepare("SELECT active FROM charges WHERE id=?").get(String(charge.id))?.active,0);
    assert.throws(()=>commitTransaction(db,String(stale.transaction?.id)),/Record changed/);
    undoTransaction(db,String(first.transaction?.id));
    assert.equal(db.prepare("SELECT amount_cents FROM charges WHERE id=?").get(String(charge.id))?.amount_cents,100);
    const save=proposeTransaction(db,{actionType:"SAVE_PURCHASE",reason:"Save",payload:{title:"Chair",category:"FURNITURE"}});commitTransaction(db,String(save.transaction?.id));
    const purchase=db.prepare("SELECT * FROM purchase_candidates WHERE title='Chair'").get()!;
    const update=proposeTransaction(db,{actionType:"UPDATE_PURCHASE",reason:"Bought",payload:{purchaseCandidateId:purchase.id,title:"Chair",category:"FURNITURE",status:"PURCHASED"}});
    commitTransaction(db,String(update.transaction?.id));assert.equal(db.prepare("SELECT status FROM purchase_candidates WHERE id=?").get(String(purchase.id))?.status,"PURCHASED");
    undoTransaction(db,String(update.transaction?.id));assert.equal(db.prepare("SELECT status FROM purchase_candidates WHERE id=?").get(String(purchase.id))?.status,"SAVED");
    assert.throws(()=>runInHome("home-other",()=>proposeTransaction(db,{actionType:"UPDATE_CHARGE",reason:"Wrong home",payload})),/Charge not found/);
  })}finally{db.close()}
});
test("chat context survives provider restarts, remains personal, and clears independently of household records",async()=>{
  const {db,user}=fixture();try{
    const calls:Array<Record<string,unknown>>=[];
    const fake={responses:{create:async(input:Record<string,unknown>)=>{calls.push(input);return {id:"saved-response-"+calls.length,output:[{role:"assistant",content:"Recorded reply"}],output_text:"Recorded reply"}}}};
    const first=await runInHome(user.homeId,()=>new GroqAgentProvider(db,fake as never,"test").respond({message:"Remember the tap",userId:user.id}));
    saveChatTurn(db,user,"Remember the tap",first);
    await runInHome(user.homeId,()=>new GroqAgentProvider(db,fake as never,"test").respond({message:"Which tap?",userId:user.id,previousResponseId:first.responseId}));
    assert.ok(JSON.stringify(calls[1]?.input).includes("Remember the tap"));
    await runInHome(user.homeId,()=>new GroqAgentProvider(db,fake as never,"test").respond({message:"Private",userId:"second",previousResponseId:first.responseId}));
    assert.equal(JSON.stringify(calls[2]?.input).includes("Remember the tap"),false);
    assert.equal(chatHistory(db,user).messages.length,2);assert.equal(chatHistory(db,{...user,id:"second"}).messages.length,0);
    clearChat(db,user);assert.equal(chatHistory(db,user).messages.length,0);assert.ok(db.prepare("SELECT id FROM assets LIMIT 1").get());
  }finally{db.close()}
});
test("assistant conversations keep separate histories and never leak between identities",()=>{
  const {db,user}=fixture();
  try {
    const first=createChatConversation(db,user);
    const second=createChatConversation(db,user);
    const responseOne={responseId:"session-one-reply",text:"Answer one",proposals:[]};
    const responseTwo={responseId:"session-two-reply",text:"Answer two",proposals:[]};
    saveChatTurn(db,user,"Question one",responseOne as never,first.id);
    saveChatTurn(db,user,"Question two",responseTwo as never,second.id);
    assert.equal(chatHistory(db,user,first.id).messages.length,2);
    assert.equal(chatHistory(db,user,first.id).messages[0]?.text,"Question one");
    assert.equal(chatHistory(db,user,second.id).messages[0]?.text,"Question two");
    assert.equal(chatHistory(db,user,second.id).previousResponseId,"session-two-reply");
    assert.equal(belongsToConversation(db,user,second.id,"session-one-reply"),false);
    assert.equal(belongsToConversation(db,user,first.id,"session-one-reply"),true);
    assert.throws(()=>chatHistory(db,{...user,id:"second"},first.id),/Conversation not found/);
    assert.equal(listChatConversations(db,{...user,id:"second"}).conversations.length,0);
    assert.equal(listChatConversations(db,user).conversations.length,2);
    assert.equal(listChatConversations(db,user).conversations[0]?.title,"Question two");
    assert.equal(listChatConversations(db,user).conversations[1]?.title,"Question one");
  }finally{db.close()}
});
test("real PDF and DOCX evidence extracts locally, rejecting damaged documents",async()=>{
  const pdf=Buffer.from(fs.readFileSync(new URL("./fixtures/receipt.pdf.base64",import.meta.url),"utf8"),"base64");
  const docx=Buffer.from(fs.readFileSync(new URL("./fixtures/receipt.docx.base64",import.meta.url),"utf8"),"base64");
  assert.match(await extractDocument(pdf,"application/pdf"),/Refrigerator service receipt: R 250/);
  assert.match(await extractDocument(docx,DOCX_MIME),/Refrigerator service receipt: R 250/);
  await assert.rejects(extractDocument(Buffer.from("invalid"),DOCX_MIME),/Invalid DOCX/);
});
test("archive recovery creates a new owned home with exact files and remapped history; originals remain intact",async()=>{
  const {db,user}=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),"homely-restore-"));
  const archive=path.join(dir,"backup.tar");
  try{
    const bytes=Buffer.from("Original receipt bytes.");
    runInHome(user.homeId,()=>{
      const upload=startUpload(db,{name:"receipt.txt",mimeType:"text/plain",size:bytes.length});appendUploadChunk(db,upload.id,0,bytes);finishUpload(db,upload.id);
      const tx=proposeTransaction(db,{actionType:"ATTACH_DOCUMENT",reason:"Receipt",payload:{title:"Recovered receipt",documentType:"RECEIPT",provider:"LOCAL",uploadId:upload.id}});commitTransaction(db,String(tx.transaction?.id));
    });
    const stream=fs.createWriteStream(archive),finished=once(stream,"finish");await writeHomeArchive(db,user.homeId,stream);await finished;
    const restored=restoreHomeArchive(db,archive,user.id);assert.notEqual(restored.homeId,user.homeId);assert.equal(restored.files,1);
    assert.ok(db.prepare("SELECT id FROM homes WHERE id=?").get(user.homeId));
    const receipt=db.prepare("SELECT id FROM documents WHERE home_id=? AND title='Recovered receipt'").get(restored.homeId)!;
    assert.deepEqual(runInHome(restored.homeId,()=>readStoredFile(db,String(receipt.id),1000)),bytes);
    assert.equal(db.prepare("SELECT role FROM home_memberships WHERE home_id=? AND user_id=?").get(restored.homeId,user.id)?.role,"OWNER");
    const count=db.prepare("SELECT COUNT(*) AS n FROM homes").get()?.n;
    const damagedFile=fs.readFileSync(archive);const contentOffset=damagedFile.lastIndexOf(bytes);assert.ok(contentOffset>0);
    damagedFile[contentOffset]=damagedFile[contentOffset]!^1;fs.writeFileSync(path.join(dir,"damaged-file.tar"),damagedFile);
    assert.throws(()=>restoreHomeArchive(db,path.join(dir,"damaged-file.tar"),user.id),/file checksum/);
    const broken=fs.readFileSync(archive);broken[0]=88;fs.writeFileSync(path.join(dir,"bad.tar"),broken);
    assert.throws(()=>restoreHomeArchive(db,path.join(dir,"bad.tar"),user.id),/checksum/);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM homes").get()?.n,count);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
test("a complete 50 MB video upload retains every ordered chunk at the storage limit",()=>{
  const {db,user}=fixture();try{runInHome(user.homeId,()=>{
    const upload=startUpload(db,{name:"maximum.mp4",mimeType:"video/mp4",size:MAX_FILE_BYTES});
    const chunk=Buffer.alloc(1_000_000,65);
    for(let index=0;index<50;index++)appendUploadChunk(db,upload.id,index,chunk);
    finishUpload(db,upload.id);
    const tx=proposeTransaction(db,{actionType:"ATTACH_DOCUMENT",reason:"Maximum-size storage check",payload:{title:"Maximum video",documentType:"VIDEO",provider:"LOCAL",uploadId:upload.id}});commitTransaction(db,String(tx.transaction?.id));
    const id=String(db.prepare("SELECT document_id FROM file_uploads WHERE id=?").get(upload.id)?.document_id);
    assert.equal(getStoredFile(db,id).length,MAX_FILE_BYTES);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM file_upload_chunks WHERE upload_id=?").get(upload.id)?.n,50);
    const last=db.prepare("SELECT content FROM file_upload_chunks WHERE upload_id=? AND chunk_index=49").get(upload.id)!;
    assert.deepEqual(Buffer.from(last.content as Uint8Array),chunk);
  })}finally{db.close()}
});
test("video vision accepts only three bounded JPEG samples and caches the analysis",async()=>{
  const {db,user}=fixture();try{
    const bytes=Buffer.from(fs.readFileSync(new URL("./fixtures/video.webm.base64",import.meta.url),"utf8"),"base64");
    const documentId=runInHome(user.homeId,()=>{
      const upload=startUpload(db,{name:"clip.webm",mimeType:"video/webm",size:bytes.length});appendUploadChunk(db,upload.id,0,bytes);finishUpload(db,upload.id);
      const tx=proposeTransaction(db,{actionType:"ATTACH_DOCUMENT",reason:"Video",payload:{title:"Clip",documentType:"VIDEO",provider:"LOCAL",uploadId:upload.id}});commitTransaction(db,String(tx.transaction?.id));
      return String(db.prepare("SELECT document_id FROM file_uploads WHERE id=?").get(upload.id)?.document_id);
    });
    const frames=[.1,1,2].map(timeSeconds=>({image:"data:image/jpeg;base64,/9j/2Q==",timeSeconds}));
    let calls=0;
    const client={chat:{completions:{create:async(input:Record<string,unknown>)=>{calls++;assert.equal(input.model,"qwen/qwen3.8-27b");return {choices:[{message:{content:"A household video sample."}}]}}}}};
    const first=await runInHome(user.homeId,()=>analyzeDocument(db,documentId,client as never,frames));
    assert.match(first.text,/Video samples at/);
    await runInHome(user.homeId,()=>analyzeDocument(db,documentId,client as never,frames));assert.equal(calls,1);
    await assert.rejects(runInHome(user.homeId,()=>analyzeDocument(db,documentId,client as never,[...frames,frames[0]!])),/up to three/);
  }finally{db.close()}
});
