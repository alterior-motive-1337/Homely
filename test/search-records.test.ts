import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../src/db.js";
import { createTestDatabase } from "./helpers.js";
import { seedDemo } from "../src/seed.js";
import { agentToolDefinitions, executeHomelyTool } from "../src/tools/homelyTools.js";
import { GroqAgentProvider } from "../src/agent/groqProvider.js";

test("agent can search household records without web research", () => {
  const db=createTestDatabase();
  migrate(db);
  seedDemo(db);
  try {
    assert.ok(agentToolDefinitions.some(tool=>tool.name==="search_records"));
    const assets=executeHomelyTool(db,"search_records",{query:"inverter",category:"ASSET",limit:10}) as {
      total:number;matches:Array<{type:string;id:string;title:string}>;
    };
    assert.ok(assets.matches.some(entry=>entry.title.toLowerCase().includes("inverter")));
    assert.ok(assets.matches.every(entry=>entry.type==="ASSET"));

    const files=executeHomelyTool(db,"search_records",{query:"warranty",category:"FILE",limit:10}) as {
      total:number;matches:Array<{type:string;title:string}>;
    };
    assert.ok(files.total>0);
    assert.ok(files.matches.every(entry=>entry.type==="FILE"));

    const all=executeHomelyTool(db,"search_records",{query:"inverter",category:"ALL",limit:30}) as {
      total:number;matches:Array<{type:string;title:string}>;
    };
    assert.ok(all.total>=files.matches.filter(entry=>entry.title.toLowerCase().includes("inverter")).length+assets.total);
    assert.ok(all.matches.some(entry=>entry.type==="ASSET"));

    const missing=executeHomelyTool(db,"search_records",{query:"invented-object-xyz",category:"ALL",limit:10}) as {total:number;matches:unknown[]};
    assert.equal(missing.total,0);
    assert.deepEqual(missing.matches,[]);
  } finally { db.close() }
});

test("Groq agent can call unified household search", async () => {
  const db=createTestDatabase();
  migrate(db);
  seedDemo(db);
  const calls:Array<Record<string,unknown>>=[];
  const fake={responses:{create:async(input:Record<string,unknown>)=>{
    calls.push(input);
    if(calls.length===1)return {
      id:"search-start",output_text:"",
      output:[{type:"function_call",name:"search_records",call_id:"search-call",arguments:JSON.stringify({query:"inverter",category:"ALL",limit:10})}]
    };
    return {id:"search-complete",output_text:"I found the inverter.",output:[]};
  }}};
  try {
    const provider=new GroqAgentProvider(db,fake as never,"test-model");
    const reply=await provider.respond({message:"Find the inverter"});
    assert.deepEqual(reply.toolsUsed,["search_records"]);
    assert.equal(calls.length,2);
    const history=calls[1]?.input as Array<{type?:string;output?:string}>;
    const output=history.find(item=>item.type==="function_call_output")?.output;
    assert.ok(output,"agent must receive grounded results");
    const search=JSON.parse(output) as {matches:Array<{type:string;title:string}>};
    assert.ok(search.matches.some(item=>item.type==="ASSET"&&item.title.toLowerCase().includes("inverter")));
  } finally {db.close()}
});
