import OpenAI from "openai";
import type { HomelyDatabase } from "../db.js";
import { activeHomeId } from "../security/homeScope.js";
import { agentToolDefinitions, executeHomelyTool, type HomelyToolName } from "../tools/homelyTools.js";
import { HomeResearch } from "../integrations/webResearch.js";
import { executeResearchTool, researchToolDefinitions, type ResearchToolName } from "./researchTools.js";
import type { AgentProposal, AgentProvider, AgentRequest, AgentResponse } from "./types.js";
import { analyzeDocument } from "../evidence/analyze.js";

const INSTRUCTIONS = `You are Homely, a thoughtful household assistant and the operating memory for one physical home.

Rules:
- Homely's structured state and tool results are the source of truth. Never invent facts about this home.
- For questions about this property, retrieve the relevant state/history before answering.
- To find recorded entries by name, appliance, date, person, part or description, call search_records first and report matching record types and titles. Search is read-only. If there are no matches, say so rather than inventing entries.
- If a result needs details, follow up with the appropriate record reading tool. Do not claim that search_records reads file contents; use get_document or analyze_document only when appropriate.
- Use analyze_document when the user asks to read or interpret a specific stored text, PDF, DOCX, image, audio or video file, not on casual listing.
- Video transcription describes audio; sampled-frame analysis describes only the sampled images. Full-video understanding is not supported. Visual analysis can be initiated from the file viewer. Distinguish model observations from authoritative records.
- Prefer recorded history, repair records, purchase context and document metadata over generic home-maintenance advice.
- Deterministic health states come from Homely. Do not override them.
- You may read state and create inert proposals with preview_action.
- You cannot commit, resolve, complete, undo, or otherwise change persistent state yourself.
- If the user asks for or clearly implies a meaningful state change, create at most one smallest useful proposal in this turn unless they explicitly request multiple actions.
- For a recurring fault, inspect the asset, repairs and history before proposing the next action.
- Repair records are permanent history. Corrections should be recorded as new history rather than deleting the original.
- Charges and potential purchases are part of household memory. Use their tools when cost or buying context is relevant.
- Web research is external evidence, not authoritative home state. Distinguish researched facts from recorded house facts.
- Use search_web for current product, supplier, price, service-provider or general research when useful.
- LOCAL_SERVICE searches require a location explicitly supplied by the user. Never infer or invent a precise home location.
- Use read_web_page only for a page returned by Homely search.
- Save a purchase candidate only when the user asks to remember, save or shortlist it, or otherwise clearly requests that state change.
- A proposal is not a completed action. Say clearly that it requires approval.
- Never claim a proposed action happened until Homely reports a committed transaction in a later interaction.
- Answer naturally, with enough depth to be useful. A simple lookup can be short. Analysis, diagnosis, comparisons, planning and recommendations deserve fuller explanations of the evidence, plausible causes, trade-offs and practical next steps. Let the question's complexity set the length; do not impose a sentence, bullet or word limit.
- Synthesize relevant records: connect current issues with earlier repairs, maintenance, costs and file evidence when those connections help answer the question. Explain what the evidence suggests rather than only repeating entries. Clearly distinguish recorded facts, supported inferences, possibilities and missing information.
- Use available reading and research tools to investigate the request. Follow promising connections when relevant instead of stopping at a superficial list or asking the user to retrieve information you can read yourself. Ask a focused question when a missing fact would materially change the answer.
- Lead with the useful answer and then explain why. Be conversational and thoughtful. Avoid repeated observations, irrelevant generic advice, tool-by-tool narration and boilerplate introductions or conclusions.
- Respect requests for detailed explanations, complete lists, comparisons and step-by-step instructions. Include essential evidence, uncertainty and any approval requirement even when giving a short answer.
- Use Markdown paragraphs, emphasis, lists, headings and tables when they make the answer easier to follow. Do not use raw HTML.
`;

type GroqResponsesClient = Pick<OpenAI, "responses">;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function proposalFromResult(result: unknown): AgentProposal | null {
  const root = asRecord(result);
  const transaction = asRecord(root.transaction);
  const preview = asRecord(root.preview);
  if (!transaction.id || String(transaction.status) !== "PROPOSED") return null;
  const effects = Array.isArray(preview.effects) ? preview.effects.map(String) : [];
  return {
    transactionId: String(transaction.id),
    actionType: String(transaction.action_type ?? ""),
    reason: String(transaction.reason ?? ""),
    preview: {
      title: String(preview.title ?? "Proposed action"),
      summary: String(preview.summary ?? ""),
      effects
    }
  };
}

export class GroqAgentProvider implements AgentProvider {
  private readonly conversationHistories = new Map<string, {homeId:string|null;messages:unknown[]}>();

  constructor(
    private readonly db: HomelyDatabase,
    private readonly client: GroqResponsesClient,
    private readonly model: string,
    private readonly research: HomeResearch = new HomeResearch()
  ) {}

  async respond(request: AgentRequest): Promise<AgentResponse> {
    const message = request.message.trim();
    if (!message) throw new Error("Message is required.");
    const startedAt=Date.now();
    let modelMillis=0;
    let modelRequests=0;

    const tools = [
      ...(agentToolDefinitions as OpenAI.Responses.Tool[]),
      ...researchToolDefinitions(this.research)
    ];
    const homeId=activeHomeId();
    const stored=request.previousResponseId&&homeId&&request.userId
      ?this.db.prepare("SELECT input_json FROM agent_contexts WHERE response_id=? AND home_id=? AND user_id=?").get(request.previousResponseId,homeId,request.userId):null;
    const prior = stored ? (JSON.parse(String(stored.input_json)) as unknown[]).slice(-16) : request.previousResponseId && !homeId
      ? (this.conversationHistories.get(request.previousResponseId)?.homeId===activeHomeId()
          ? this.conversationHistories.get(request.previousResponseId)?.messages : null) ?? []
      : [];
    let groqInput: unknown[] = [...prior, { role: "user", content: message }];

    const modelStartedAt=Date.now();
    let response = await this.client.responses.create({
      model: this.model,
      instructions: INSTRUCTIONS,
      input: groqInput as OpenAI.Responses.ResponseCreateParams["input"],
      tools
    });
    modelMillis+=Date.now()-modelStartedAt;
    modelRequests++;

    const proposals: AgentProposal[] = [];
    const toolsUsed: string[] = [];

    for (let round = 0; round < 5; round += 1) {
      const calls = response.output.filter((item) => item.type === "function_call");
      if (!calls.length) break;

      const outputs = await Promise.all(calls.map(async (call) => {
        const name = call.name;
        toolsUsed.push(name);

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }

        try {
          const result = name === "analyze_document"
            ? await analyzeDocument(this.db,String(args.documentId??""))
            : name === "search_web" || name === "read_web_page"
              ? await executeResearchTool(this.research,name as ResearchToolName,args)
              : executeHomelyTool(this.db,name as HomelyToolName,args,"GROQ");
          if (name === "preview_action") {
            const proposal = proposalFromResult(result);
            if (proposal) proposals.push(proposal);
          }
          return {
            type: "function_call_output" as const,
            call_id: call.call_id,
            output: JSON.stringify(result)
          };
        } catch (error) {
          return {
            type: "function_call_output" as const,
            call_id: call.call_id,
            output: JSON.stringify({
              error: error instanceof Error ? error.message : "Homely tool failed."
            })
          };
        }
      }));

      groqInput = [
        ...groqInput,
        ...response.output,
        ...outputs
      ];

      const nextStartedAt=Date.now();
      response = await this.client.responses.create({
        model: this.model,
        instructions: INSTRUCTIONS,
        input: groqInput as OpenAI.Responses.ResponseCreateParams["input"],
        tools
      });
      modelMillis+=Date.now()-nextStartedAt;
      modelRequests++;
    }

    const text = response.output_text?.trim() ||
      (proposals.length ? "I found a grounded next action and prepared it for your approval." : "I could not produce a grounded response.");

    if (response.id) {
      const all=[...groqInput,...response.output];
      // Start at a user message so function calls and their results remain paired.
      let start=Math.max(0,all.length-80);
      while(start<all.length&&asRecord(all[start]).role!=="user")start++;
      const history=homeId&&request.userId
        ?[...prior,{role:"user",content:message},{role:"assistant",content:text}].slice(-16)
        :all.slice(start);
      if(homeId&&request.userId){
        this.db.exec("BEGIN IMMEDIATE;");
        try{
          this.db.prepare("INSERT OR REPLACE INTO agent_contexts(response_id,home_id,user_id,input_json,created_at) VALUES(?,?,?,?,?)")
            .run(response.id,homeId,request.userId,JSON.stringify(history),new Date().toISOString());
          this.db.prepare("DELETE FROM agent_contexts WHERE home_id=? AND user_id=? AND response_id NOT IN (SELECT response_id FROM agent_contexts WHERE home_id=? AND user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10)")
            .run(homeId,request.userId,homeId,request.userId);
          this.db.exec("COMMIT;");
        }catch(error){this.db.exec("ROLLBACK;");throw error}
      }else this.conversationHistories.set(response.id, {homeId:activeHomeId(),messages:history});
      while (this.conversationHistories.size > 32) {
        const oldest = this.conversationHistories.keys().next().value;
        if (!oldest) break;
        this.conversationHistories.delete(oldest);
      }
    }

    console.info(JSON.stringify({
      type:"agent_performance",
      elapsed_ms:Date.now()-startedAt,
      model_ms:modelMillis,
      model_requests:modelRequests,
      tools_used:[...new Set(toolsUsed)]
    }));
    return {
      text,
      responseId: response.id ?? null,
      proposals,
      toolsUsed: [...new Set(toolsUsed)]
    };
  }
}

