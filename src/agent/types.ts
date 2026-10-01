export interface AgentRequest {
  message: string;
  previousResponseId?: string | null;
}

export interface AgentProposal {
  transactionId: string;
  actionType: string;
  reason: string;
  preview: {
    title: string;
    summary: string;
    effects: string[];
  };
}

export interface AgentResponse {
  text: string;
  responseId: string | null;
  proposals: AgentProposal[];
  toolsUsed: string[];
}

export interface AgentProvider {
  respond(request: AgentRequest): Promise<AgentResponse>;
}
