/**
 * Configuration for a single ONNX model to be loaded.
 */
export interface OnnxModelConfig {
  /**
   * Unique identifier for the model (e.g., 'yolo-pose', 'arcface').
   * Used to retrieve the session via OnnxRuntimeService.getSession(name).
   */
  name: string;

  /**
   * Path to the ONNX model file, relative to process.cwd().
   * Example: 'models/yolo11l-pose.onnx'
   */
  path: string;

  /**
   * URL to download the model from if not present locally.
   * Typically a Hugging Face URL like:
   * 'https://huggingface.co/<user>/<repo>/resolve/main/<filename>'
   */
  downloadUrl?: string;

  /**
   * Load priority. Lower numbers load first.
   * Use to load smaller models first for faster initial availability.
   */
  priority: number;

  /**
   * If true, failure to load this model won't prevent app startup.
   * The model will be unavailable but other services can still function.
   */
  optional: boolean;
}

/**
 * Configuration options for the OnnxRuntimeModule.
 *
 * Note: The 'models' array is now optional since ModelManagerService
 * handles model loading from models.config.yaml. This parameter is kept
 * for backward compatibility but is no longer used.
 */
export interface OnnxRuntimeModuleOptions {
  /**
   * List of models to load during application bootstrap.
   * DEPRECATED: ModelManagerService now handles this from models.config.yaml
   * Kept for backward compatibility.
   */
  models?: OnnxModelConfig[];

  /**
   * Number of threads for intra-operation parallelism.
   * Controls parallelism within a single ONNX operation (e.g., matrix multiplication).
   * Default: 2 (conservative to avoid contention with @huggingface/transformers)
   */
  intraOpNumThreads?: number;

  /**
   * Number of threads for inter-operation parallelism.
   * Controls parallelism between independent operations in the graph.
   * Default: 1 (sequential to avoid thread contention)
   */
  interOpNumThreads?: number;

  /**
   * Level of graph optimization to apply.
   * - 'disabled': No optimizations
   * - 'basic': Basic optimizations (constant folding)
   * - 'extended': Extended optimizations (more aggressive)
   * - 'all': All available optimizations
   * Default: 'all'
   */
  graphOptimizationLevel?: "disabled" | "basic" | "extended" | "all";
}

/**
 * Default options for OnnxRuntimeModule.
 */
export const DEFAULT_ONNX_RUNTIME_OPTIONS: Partial<OnnxRuntimeModuleOptions> = {
  intraOpNumThreads: 2,
  interOpNumThreads: 1,
  graphOptimizationLevel: "all",
};
