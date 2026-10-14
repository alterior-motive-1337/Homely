import { randomUUID } from "node:crypto";
import type { HomelyDatabase } from "../db.js";
import type { AuthUser } from "../security/googleAuth.js";
import type { AgentResponse } from "../agent/types.js";
import { DomainError } from "./transactions.js";

type Conversation = { id:string; title:string; createdAt:string; updatedAt:string };

export function listChatConversations(db:HomelyDatabase,user:AuthUser):{conversations:Conversation[]} {
  const rows=db.prepare("SELECT id,title,created_at,updated_at FROM agent_conversations WHERE home_id=? AND user_id=? ORDER BY updated_at DESC,id DESC").all(user.homeId,user.id);
  return {conversations:rows.map(row=>({id:String(row.id),title:String(row.title),createdAt:String(row.created_at),updatedAt:String(row.updated_at)}))};
}
export function createChatConversation(db:HomelyDatabase,user:AuthUser):Conversation {
  const now=new Date().toISOString(),id=randomUUID();
  db.prepare("INSERT INTO agent_conversations(id,home_id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run(id,user.homeId,user.id,"New chat",now,now);
  return {id,title:"New chat",createdAt:now,updatedAt:now};
}
export function resolveChatConversation(db:HomelyDatabase,user:AuthUser,conversationId?:string|null):string {
  if(conversationId){
    const row=db.prepare("SELECT id FROM agent_conversations WHERE id=? AND home_id=? AND user_id=?").get(conversationId,user.homeId,user.id);
    if(!row)throw new DomainError("Conversation not found.",404);
    return String(row.id);
  }
  const row=db.prepare("SELECT id FROM agent_conversations WHERE home_id=? AND user_id=? ORDER BY updated_at DESC,id DESC LIMIT 1").get(user.homeId,user.id);
  return row?String(row.id):createChatConversation(db,user).id;
}
export function belongsToConversation(db:HomelyDatabase,user:AuthUser,conversationId:string,responseId:string):boolean {
  return Boolean(db.prepare("SELECT id FROM agent_turns WHERE home_id=? AND user_id=? AND conversation_id=? AND response_id=? LIMIT 1")
    .get(user.homeId,user.id,conversationId,responseId));
}
export function saveChatTurn(db:HomelyDatabase,user:AuthUser,message:string,response:AgentResponse,conversationId?:string|null) {
  const id=resolveChatConversation(db,user,conversationId), now=new Date().toISOString();
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare("INSERT INTO agent_turns(id,home_id,user_id,conversation_id,request_text,reply_text,response_id,proposals_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(),user.homeId,user.id,id,message,response.text,response.responseId,JSON.stringify(response.proposals),now);
    db.prepare("UPDATE agent_conversations SET updated_at=?,title=CASE WHEN title='New chat' THEN ? ELSE title END WHERE id=? AND home_id=? AND user_id=?")
      .run(now,message.replace(/\s+/g," ").trim().slice(0,72)||"New chat",id,user.homeId,user.id);
    db.exec("COMMIT;");
  }catch(error){db.exec("ROLLBACK;");throw error}
}
export function chatHistory(db:HomelyDatabase,user:AuthUser,conversationId?:string|null) {
  const selected=conversationId
    ? db.prepare("SELECT id FROM agent_conversations WHERE id=? AND home_id=? AND user_id=?").get(conversationId,user.homeId,user.id)
    : db.prepare("SELECT id FROM agent_conversations WHERE home_id=? AND user_id=? ORDER BY updated_at DESC,id DESC LIMIT 1").get(user.homeId,user.id);
  if(conversationId&&!selected)throw new DomainError("Conversation not found.",404);
  const id=selected?String(selected.id):null;
  if(!id)return {conversationId:null,messages:[],previousResponseId:null};
  const turns=db.prepare("SELECT * FROM agent_turns WHERE home_id=? AND user_id=? AND conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 500").all(user.homeId,user.id,id).reverse();
  const messages=turns.flatMap(t=>{
    const proposals=JSON.parse(String(t.proposals_json)) as Array<{transactionId:string;status?:string}>;
    proposals.forEach(p=>{const tx=db.prepare("SELECT status FROM transactions WHERE id=? AND home_id=?").get(p.transactionId,user.homeId);p.status=String(tx?.status??"UNAVAILABLE")});
    return [{role:"user",text:String(t.request_text),proposals:[]},{role:"assistant",text:String(t.reply_text),proposals}];
  });
  return {conversationId:id,messages,previousResponseId:turns.at(-1)?.response_id??null};
}
export function clearChat(db:HomelyDatabase,user:AuthUser) {
  db.exec("BEGIN IMMEDIATE;");
  try{
    for(const table of ["agent_turns","agent_contexts","agent_conversations"])
      db.prepare(`DELETE FROM ${table} WHERE home_id=? AND user_id=?`).run(user.homeId,user.id);
    db.exec("COMMIT;");
  }catch(error){db.exec("ROLLBACK;");throw error}
  return {cleared:true};
}
