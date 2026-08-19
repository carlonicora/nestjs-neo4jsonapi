/**
 * Local ML model management — see ModelManagerService and ModelLoader.
 *
 * Driven by MODEL_CONFIG_PATH, MODELS_CACHE_DIR, MODEL_BASE_URL,
 * MODEL_VERIFY_HASH, MODEL_STRICT_HASH, MODEL_AUTO_UPDATE and the ONNX_*
 * thread counts.
 */
export interface ConfigModelManagerInterface {
  /** models.config.yaml location (default `<cwd>/config/models.config.yaml`). */
  configPath: string;
  /** Where downloaded model files are cached (default `<cwd>/.cache/models`). */
  cacheDir: string;
  /** Model host; each model's repo comes from its own `modelId` (default HuggingFace). */
  baseUrl: string;
  /** Verify each downloaded file's SHA-256 (default true; only "false" disables). */
  verifyHash: boolean;
  /** Treat a hash mismatch as fatal (default true; only "false" disables). */
  strictHash: boolean;
  /** Re-download when the pinned version changes (default true; only "false" disables). */
  autoUpdate: boolean;
  onnx: ConfigOnnxInterface;
}

/** onnxruntime-node session threading. */
export interface ConfigOnnxInterface {
  /** Threads used inside one operator (default 2). */
  intraOpNumThreads: number;
  /** Threads used across operators (default 1). */
  interOpNumThreads: number;
}
