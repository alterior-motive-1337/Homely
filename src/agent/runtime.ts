import OpenAI from "openai";
import type { HomelyDatabase } from "../db.js";
import { config } from "../config.js";
import { OpenAIAgentProvider } from "./openaiProvider.js";
import type { AgentProvider } from "./types.js";

type ProviderName = "groq" | "openai";

export interface AgentRuntime {
  provider: AgentProvider | null;
  status: {
    enabled: boolean;
    configured: boolean;
    available: boolean;
    provider: ProviderName;
    model: string;
  };
}

export function createAgentRuntime(db: HomelyDatabase): AgentRuntime {
  const enabled = config.aiEnabled;
  const useGroq = Boolean(config.groqApiKey);
  const configured = useGroq || Boolean(config.openAiApiKey);
  const providerName: ProviderName = useGroq ? "groq" : "openai";
  const model = useGroq ? config.groqModel : config.openAiModel;

  if (!enabled || !configured) {
    return {
      provider: null,
      status: {
        enabled,
        configured,
        available: false,
        provider: providerName,
        model
      }
    };
  }

  const client = useGroq
    ? new OpenAI({
        apiKey: config.groqApiKey,
        baseURL: "https://api.groq.com/openai/v1"
      })
    : new OpenAI({ apiKey: config.openAiApiKey });

  return {
    provider: new OpenAIAgentProvider(db, client, model, providerName.toUpperCase()),
    status: {
      enabled,
      configured,
      available: true,
      provider: providerName,
      model
    }
  };
}
