export type TokenUsageType =
  | "graph_creator"
  | "counterpart_identificator"
  | "summariser"
  | "responder"
  | "ethicist"
  | "analyser"
  | "strategy"
  | "text_generation"
  | "embedding";

export const TokenUsageType = {
  GraphCreator: "graph_creator",
  CounterpartIdentificator: "counterpart_identificator",
  Summariser: "summariser",
  Responder: "responder",
  Ethicist: "ethicist",
  Analyser: "analyser",
  Strategy: "strategy",
  TextGeneration: "text_generation",
  Embedding: "embedding",
} as const;
