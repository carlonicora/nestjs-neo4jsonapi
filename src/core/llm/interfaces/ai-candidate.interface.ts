export const AI_CONNECTION_TYPES = [
  "ai",
  "aiLite",
  "aiLarge",
  "vision",
  "audio",
  "embedder",
  "transcriber",
  "documentAi",
] as const;
export type AiConnectionType = (typeof AI_CONNECTION_TYPES)[number];

export const AI_CONNECTIONS_CHANGED_EVENT = "ai-connections.changed";

/** One link in a fallback chain, normalized to the shape buildChatModel consumes. */
export interface ResolvedAiCandidate {
  source: "db" | "env";
  /** AiConnection node id, or `env:<type>` for the final .env candidate. */
  connectionId: string;
  connectionType: AiConnectionType;
  provider: string;
  apiKey: string;
  model: string;
  url: string;
  region?: string;
  instance?: string;
  apiVersion?: string;
  googleCredentialsBase64?: string;
  allowFallbacks?: boolean;
  reasoningEffort?: string;
  maxOutputTokens?: number;
  dimensions?: number;
  inputCostPer1MTokens?: number;
  outputCostPer1MTokens?: number;
  cachedInputCostPer1MTokens?: number;
  costPerMinute?: number;
  costPerPage?: number;
  directUrl?: string;
  language?: string;
  directFormat?: string;
  directProvider?: string;
}
