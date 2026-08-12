export type TokenUsageType =
  | "graph_creator"
  | "counterpart_identificator"
  | "summariser"
  | "responder"
  | "ethicist"
  | "analyser"
  | "strategy"
  | "text_generation"
  | "embedding"
  | "image_analysis";

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
  ImageAnalysis: "image_analysis",
} as const;
