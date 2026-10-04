import OpenAI from "openai";
import type { HomelyDatabase } from "../db.js";
import { agentToolDefinitions, executeHomelyTool, type HomelyToolName } from "../tools/homelyTools.js";
import type { AgentProposal, AgentProvider, AgentRequest, AgentResponse } from "./types.js";

const INSTRUCTIONS = `You are Homely, the operating memory for one physical home.

Rules:
- Homely's structured state and tool results are the source of truth. Never invent facts about this home.
- For questions about this property, retrieve the relevant state/history before answering.
- Prefer recorded history and document metadata over generic home-maintenance advice.
- Deterministic health states come from Homely. Do not override them.
- You may read state and create inert proposals with preview_action.
- You cannot commit, resolve, complete, undo, or otherwise change persistent state yourself.
- If the user asks for or clearly implies a meaningful state change, create at most one smallest useful proposal in this turn unless they explicitly request multiple actions.
- For a recurring fault, inspect the asset and its history before proposing the next action.
- A proposal is not a completed action. Say clearly that it requires approval.
- Never claim a proposed action happened until Homely reports a committed transaction in a later interaction.
- Keep responses concise, specific, calm, and grounded in this house.
`;

type GroqCompatibleClient = Pick<OpenAI, "responses">;

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
  constructor(
    private readonly db: HomelyDatabase,
    private readonly client: GroqCompatibleClient,
    private readonly model: string
  ) {}

  async respond(request: AgentRequest): Promise<AgentResponse> {
    const message = request.message.trim();
    if (!message) throw new Error("Message is required.");

    const tools = agentToolDefinitions as OpenAI.Responses.Tool[];
    let response = await this.client.responses.create({
      model: this.model,
      instructions: INSTRUCTIONS,
      input: message,
      previous_response_id: request.previousResponseId ?? undefined,
      tools
    });

    const proposals: AgentProposal[] = [];
    const toolsUsed: string[] = [];

    for (let round = 0; round < 8; round += 1) {
      const calls = response.output.filter((item) => item.type === "function_call");
      if (!calls.length) break;

      const outputs = calls.map((call) => {
        const name = call.name as HomelyToolName;
        toolsUsed.push(name);

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }

        try {
          const result = executeHomelyTool(this.db, name, args, "GROQ");
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
      });

      response = await this.client.responses.create({
        model: this.model,
        instructions: INSTRUCTIONS,
        previous_response_id: response.id,
        input: outputs,
        tools
      });
    }

    const text = response.output_text?.trim() ||
      (proposals.length ? "I found a grounded next action and prepared it for your approval." : "I could not produce a grounded response.");

    return {
      text,
      responseId: response.id ?? null,
      proposals,
      toolsUsed: [...new Set(toolsUsed)]
    };
  }
}
