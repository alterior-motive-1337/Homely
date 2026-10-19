import OpenAI from "openai";
import type { HomelyDatabase } from "../db.js";
import { config } from "../config.js";
import { GroqAgentProvider } from "./groqProvider.js";
import { GroqSpeechProvider } from "./speech.js";
import { HomeResearch } from "../integrations/webResearch.js";
import type { AgentProvider } from "./types.js";

export interface AgentRuntime {
  provider: AgentProvider | null;
  speechProvider: GroqSpeechProvider | null;
  status: {
    enabled: boolean;
    configured: boolean;
    available: boolean;
    provider: "groq";
    model: string;
  };
  researchStatus: {
    exa: { configured: boolean };
    available: boolean;
  };
}

export function createAgentRuntime(db: HomelyDatabase): AgentRuntime {
  const enabled = true;
  const research = new HomeResearch();
  const configured = Boolean(config.groqApiKey);
  const model = config.groqModel;

  if (!enabled || !configured) {
    return {
      provider: null,
      speechProvider: null,
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
    speechProvider: new GroqSpeechProvider(client),
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
