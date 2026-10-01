import OpenAI from "openai";
import type { HomelyDatabase } from "../db.js";
import { config } from "../config.js";
import { OpenAIAgentProvider } from "./openaiProvider.js";
import type { AgentProvider } from "./types.js";

export interface AgentRuntime {
  provider: AgentProvider | null;
  status: {
    enabled: boolean;
    configured: boolean;
    available: boolean;
    provider: "openai";
    model: string;
  };
}

export function createAgentRuntime(db: HomelyDatabase): AgentRuntime {
  const configured = Boolean(config.openAiApiKey);
  const enabled = config.aiEnabled;

  if (!enabled || !configured) {
    return {
      provider: null,
      status: {
        enabled,
        configured,
        available: false,
        provider: "openai",
        model: config.openAiModel
      }
    };
  }

  const client = new OpenAI({ apiKey: config.openAiApiKey });
  return {
    provider: new OpenAIAgentProvider(db, client, config.openAiModel),
    status: {
      enabled,
      configured,
      available: true,
      provider: "openai",
      model: config.openAiModel
    }
  };
}
