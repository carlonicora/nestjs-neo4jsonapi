export interface ConfigAiInterface {
  ai: {
    provider: string;
    apiKey: string;
    model: string;
    url: string;
    region?: string;
    secret?: string;
    instance?: string;
    apiVersion?: string;
    inputCostPer1MTokens: number;
    outputCostPer1MTokens: number;
    maxOutputTokens?: number;
    /** Base64-encoded GCP service account JSON for Google Vertex AI */
    googleCredentialsBase64?: string;
  };
  vision: {
    provider: string;
    apiKey: string;
    model: string;
    url: string;
    region?: string;
    secret?: string;
    instance?: string;
    apiVersion?: string;
    inputCostPer1MTokens: number;
    outputCostPer1MTokens: number;
    /** Base64-encoded GCP service account JSON for Google Vertex AI */
    googleCredentialsBase64?: string;
  };
  transcriber: {
    provider: string;
    apiKey: string;
    model: string;
    url?: string;
    apiVersion?: string;
  };
  embedder: {
    provider: string;
    apiKey: string;
    url: string;
    model: string;
    instance?: string;
    apiVersion?: string;
    dimensions: number;
    /** GCP region for Google Vertex AI embeddings (e.g., "us-central1") */
    region?: string;
    /** Base64-encoded GCP service account JSON for Google Vertex AI */
    googleCredentialsBase64?: string;
  };
}
