import type OpenAI from "openai";
import { HomeResearch, type ResearchPurpose } from "../integrations/webResearch.js";

export type ResearchToolName = "search_web" | "read_web_page";

export function researchToolDefinitions(research: HomeResearch): OpenAI.Responses.Tool[] {
  const tools: OpenAI.Responses.Tool[] = [];

  if (research.status.exa.configured) {
    tools.push({
      type: "function",
      name: "search_web",
      description: "Search current public web information for products, prices, local services, suppliers, or general research. Local service searches require a location explicitly supplied by the user.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          purpose: { type: "string", enum: ["LOCAL_SERVICE","PRODUCT","GENERAL"] },
          location: { type: ["string","null"] },
          maxResults: { type: "integer", minimum: 1, maximum: 8 }
        },
        required: ["query","purpose","location","maxResults"],
        additionalProperties: false
      }
    });
  }

  if (research.status.firecrawl.configured) {
    tools.push({
      type: "function",
      name: "read_web_page",
      description: "Read the main content of an HTTPS page that was returned by Homely search earlier in this server session.",
      strict: true,
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
        additionalProperties: false
      }
    });
  }

  return tools;
}

export async function executeResearchTool(
  research: HomeResearch,
  name: ResearchToolName,
  args: Record<string, unknown>
): Promise<unknown> {
  if (name === "search_web") {
    return research.search({
      query: String(args.query ?? ""),
      purpose: String(args.purpose ?? "GENERAL") as ResearchPurpose,
      location: args.location === null || args.location === undefined ? null : String(args.location),
      maxResults: Number(args.maxResults ?? 5)
    });
  }

  if (name === "read_web_page") {
    return research.readSearchResult(String(args.url ?? ""));
  }

  throw new Error("Unknown research tool.");
}
