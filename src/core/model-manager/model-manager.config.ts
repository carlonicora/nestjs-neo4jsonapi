/**
 * Model Manager Configuration Types
 *
 * Defines the structure of models.config.yaml for type-safe configuration loading.
 */

export interface ModelConfig {
  name: string;
  modelId: string;
  version: string;
  hash: string;
  priority: number;
  optional: boolean;
  description?: string;
  loadInApi?: boolean; // If true, also load in API mode (Worker always loads all models)
}

export interface OnnxAdditionalFile {
  path: string; // Relative path in HuggingFace repo
  hash: string;
}

export interface OnnxModelConfig extends ModelConfig {
  path: string; // Relative path in HuggingFace repo
  additionalFiles?: OnnxAdditionalFile[]; // Additional files like .onnx.data for external data
}

export interface ModelComponent {
  name: string;
  file: string; // Relative path within model directory
  hash: string;
}

export interface TransformersModelConfig extends ModelConfig {
  path: string; // Directory path
  components: ModelComponent[];
}

export type ModelConfigType = OnnxModelConfig | TransformersModelConfig;

export interface ModelRegistry {
  onnx: OnnxModelConfig[];
  transformers: TransformersModelConfig[];
}

export interface ModelsConfig {
  version: string;
  registry: ModelRegistry;
}

/**
 * Validation result for configuration
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Model loading status
 */
export interface ModelLoadStatus {
  name: string;
  framework: "onnx" | "transformers";
  status: "pending" | "loading" | "loaded" | "failed";
  error?: string;
  loadTimeMs?: number;
}

/**
 * Download progress
 */
export interface DownloadProgress {
  modelName: string;
  component?: string;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: string;
}

/**
 * Model cache metadata
 */
export interface ModelCacheMetadata {
  name: string;
  version: string;
  hash: string;
  cachedAt: number;
  filePath: string;
}
