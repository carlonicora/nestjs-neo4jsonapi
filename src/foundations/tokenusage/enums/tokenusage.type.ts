export type TokenUsageType =
  | "graph_creator"
  | "counterpart_identificator"
  | "summariser"
  | "responder"
  | "operator"
  | "ethicist"
  | "analyser"
  | "strategy"
  | "text_generation"
  | "embedding"
  | "image_analysis"
  | "community_summariser";

export const TokenUsageType = {
  GraphCreator: "graph_creator",
  CounterpartIdentificator: "counterpart_identificator",
  Summariser: "summariser",
  Responder: "responder",
  Operator: "operator",
  Ethicist: "ethicist",
  Analyser: "analyser",
  Strategy: "strategy",
  TextGeneration: "text_generation",
  Embedding: "embedding",
  ImageAnalysis: "image_analysis",
  CommunitySummariser: "community_summariser",
} as const;
