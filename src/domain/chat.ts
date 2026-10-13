import { randomUUID } from "node:crypto";
import type { HomelyDatabase } from "../db.js";
import type { AuthUser } from "../security/googleAuth.js";
import type { AgentResponse } from "../agent/types.js";

export function saveChatTurn(db:HomelyDatabase,user:AuthUser,message:string,response:AgentResponse) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare("INSERT INTO agent_turns(id,home_id,user_id,request_text,reply_text,response_id,proposals_json,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(randomUUID(),user.homeId,user.id,message,response.text,response.responseId,JSON.stringify(response.proposals),new Date().toISOString());
    // Keep a bounded personal conversation; household records and audit history are separate.
    db.prepare("DELETE FROM agent_turns WHERE home_id=? AND user_id=? AND id NOT IN (SELECT id FROM agent_turns WHERE home_id=? AND user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100)")
      .run(user.homeId,user.id,user.homeId,user.id);
    db.exec("COMMIT;");
  }catch(error){db.exec("ROLLBACK;");throw error}
}
export function chatHistory(db:HomelyDatabase,user:AuthUser) {
  const turns=db.prepare("SELECT * FROM agent_turns WHERE home_id=? AND user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100").all(user.homeId,user.id).reverse();
  const messages=turns.flatMap(t=>{
    const proposals=JSON.parse(String(t.proposals_json)) as Array<{transactionId:string;status?:string}>;
    proposals.forEach(p=>{const tx=db.prepare("SELECT status FROM transactions WHERE id=? AND home_id=?").get(p.transactionId,user.homeId);p.status=String(tx?.status??"UNAVAILABLE")});
    return [{role:"user",text:String(t.request_text),proposals:[]},{role:"assistant",text:String(t.reply_text),proposals}];
  });
  return {messages,previousResponseId:turns.at(-1)?.response_id??null};
}
export function clearChat(db:HomelyDatabase,user:AuthUser) {
  db.exec("BEGIN IMMEDIATE;");
  try{
    for(const table of ["agent_turns","agent_contexts"])db.prepare(`DELETE FROM ${table} WHERE home_id=? AND user_id=?`).run(user.homeId,user.id);
    db.exec("COMMIT;");
  }catch(error){db.exec("ROLLBACK;");throw error}
  return {cleared:true};
}
