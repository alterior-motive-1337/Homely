import OpenAI from "openai";
import type { HomelyDatabase } from "../db.js";
import { config } from "../config.js";
import { GroqAgentProvider } from "./groqProvider.js";
import { HomeResearch } from "../integrations/webResearch.js";
import type { AgentProvider } from "./types.js";

export interface AgentRuntime {
  provider: AgentProvider | null;
  status: {
    enabled: boolean;
    configured: boolean;
    available: boolean;
    provider: "groq";
    model: string;
  };
  researchStatus: {
    exa: { configured: boolean };
    firecrawl: { configured: boolean };
    available: boolean;
  };
}

export function createAgentRuntime(db: HomelyDatabase): AgentRuntime {
  const enabled = config.aiEnabled;
  const research = new HomeResearch();
  const configured = Boolean(config.groqApiKey);
  const model = config.groqModel;

  if (!enabled || !configured) {
    return {
      provider: null,
      status: {
        enabled,
        configured,
        available: false,
        provider: "groq",
        model
      },
      researchStatus: research.status
    };
  }

  const client = new OpenAI({
    apiKey: config.groqApiKey,
    baseURL: "https://api.groq.com/openai/v1"
  });

  return {
    provider: new GroqAgentProvider(db, client, model, research),
    status: {
      enabled,
      configured,
      available: true,
      provider: "groq",
      model
    },
    researchStatus: research.status
  };
}
