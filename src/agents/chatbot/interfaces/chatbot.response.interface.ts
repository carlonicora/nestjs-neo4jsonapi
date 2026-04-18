import { AgentMessageType } from "../../../common/enums/agentmessage.type";

export interface ChatbotReference {
  type: string;
  id: string;
  reason: string;
}

export interface ChatbotToolCall {
  tool: string;
  input: Record<string, unknown>;
  durationMs: number;
  error?: string;
}

export interface ChatbotResponseInterface {
  type: AgentMessageType.Assistant;
  answer: string;
  references: ChatbotReference[];
  needsClarification: boolean;
  suggestedQuestions: string[];
  tokens: { input: number; output: number };
  toolCalls: ChatbotToolCall[];
}
