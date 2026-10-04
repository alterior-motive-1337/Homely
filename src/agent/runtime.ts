import OpenAI from "openai";
import type { HomelyDatabase } from "../db.js";
import { config } from "../config.js";
import { GroqAgentProvider } from "./groqProvider.js";
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
}

export function createAgentRuntime(db: HomelyDatabase): AgentRuntime {
  const configured = Boolean(config.groqApiKey);
  const enabled = config.aiEnabled;

  if (!enabled || !configured) {
    return {
      provider: null,
      status: {
        enabled,
        configured,
        available: false,
        provider: "groq",
        model: config.groqModel
      }
    };
  }

  const client = new OpenAI({
    apiKey: config.groqApiKey,
    baseURL: "https://api.groq.com/openai/v1"
  });
  return {
    provider: new GroqAgentProvider(db, client, config.groqModel),
    status: {
      enabled,
      configured,
      available: true,
      provider: "groq",
      model: config.groqModel
    }
  };
}
