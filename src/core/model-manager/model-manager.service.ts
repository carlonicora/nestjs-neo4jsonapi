/**
 * Model Manager Service
 *
 * Centralized service for managing all ML models:
 * - Loads models.config.yaml
 * - Downloads models on startup (runtime)
 * - Verifies SHA256 hashes
 * - Checks version compatibility
 * - Caches ONNX sessions and Transformers models
 * - Provides unified interface for model access
 */

import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from "@nestjs/common";
import { APP_MODE_TOKEN, AppMode, AppModeConfig } from "../../common/decorators/conditional-service.decorator";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as ort from "onnxruntime-node";
import { getModelLoader } from "./model-loader";
import type {
  ModelsConfig,
  OnnxModelConfig,
  TransformersModelConfig,
  ModelComponent,
  ModelLoadStatus,
} from "./model-manager.config";

@Injectable()
export class ModelManagerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ModelManagerService.name);
  private readonly config: ModelsConfig;
  private readonly cacheDir: string;
  private readonly baseUrl: string;
  private readonly verifyHash: boolean;
  private readonly strictHash: boolean;
  private readonly autoUpdate: boolean;

  // ONNX session cache
  private onnxSessions: Map<string, ort.InferenceSession> = new Map();

  // Transformers model cache
  private transformersModels: Map<string, Map<string, any>> = new Map();

  // Load status tracking
  private loadStatus: ModelLoadStatus[] = [];

  // Readiness tracking - allows services to wait for models to be loaded
  private readyPromise: Promise<void>;
  private readyResolver!: () => void;

  constructor(@Optional() @Inject(APP_MODE_TOKEN) private readonly appModeConfig?: AppModeConfig) {
    this.config = getModelLoader().getConfig();
    this.cacheDir = process.env.MODELS_CACHE_DIR || path.join(process.cwd(), ".cache", "models");
    // HuggingFace host only; each model's repo comes from its `modelId` so the
    // shared lib serves multiple apps (the download URL is built per-model below).
    this.baseUrl = process.env.MODEL_BASE_URL || "https://huggingface.co";
    this.verifyHash = process.env.MODEL_VERIFY_HASH !== "false";
    this.strictHash = process.env.MODEL_STRICT_HASH !== "false";
    this.autoUpdate = process.env.MODEL_AUTO_UPDATE !== "false";

    // Initialize readiness promise
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolver = resolve;
    });

    this.logger.log(`ModelManager initialized`);
    this.logger.log(`Cache directory: ${this.cacheDir}`);
    this.logger.log(`Base URL: ${this.baseUrl}`);
    this.logger.log(`Hash verification: ${this.verifyHash}, Strict: ${this.strictHash}`);
    this.logger.log(`Auto-update: ${this.autoUpdate}`);
  }

  /**
   * Check if running in worker mode.
   * Defaults to worker mode if no app mode config (tests, standalone scripts).
   */
  private isWorkerMode(): boolean {
    if (!this.appModeConfig) return true;
    return this.appModeConfig.mode === AppMode.WORKER;
  }

  /**
   * Determine if a model should be loaded based on current app mode.
   * - Worker mode: load all models
   * - API mode: only load models marked with loadInApi: true
   */
  private shouldLoadModel(model: OnnxModelConfig | TransformersModelConfig): boolean {
    if (this.isWorkerMode()) return true;
    return model.loadInApi === true;
  }

  async onApplicationBootstrap(): Promise<void> {
    const mode = this.isWorkerMode() ? "Worker" : "API";
    this.logger.log(`${mode} mode - starting model loading process...`);

    const startTime = Date.now();

    // Create cache directory
    this.ensureCacheDir();

    // Combine all models and sort by priority
    const allModels = [
      ...this.config.registry.onnx.map((m) => ({ config: m, framework: "onnx" as const })),
      ...this.config.registry.transformers.map((m) => ({ config: m, framework: "transformers" as const })),
    ].sort((a, b) => a.config.priority - b.config.priority);

    // Filter models based on mode
    const modelsToLoad = allModels.filter(({ config }) => this.shouldLoadModel(config));
    const skippedCount = allModels.length - modelsToLoad.length;

    if (skippedCount > 0) {
      this.logger.log(
        `${mode} mode: Loading ${modelsToLoad.length} models, skipping ${skippedCount} worker-only models`,
      );
    } else {
      this.logger.log(`Loading ${modelsToLoad.length} models...`);
    }

    // Load each model
    for (const { config, framework } of modelsToLoad) {
      await this.loadModel(config, framework);
      // Small delay between models to reduce memory pressure
      await new Promise((r) => setTimeout(r, 100));
    }

    const totalTime = Date.now() - startTime;
    this.logger.log(`All models loaded in ${totalTime}ms`);

    // Log load status summary
    const loaded = this.loadStatus.filter((s) => s.status === "loaded").length;
    const failed = this.loadStatus.filter((s) => s.status === "failed").length;
    this.logger.log(`Load summary: ${loaded} loaded, ${failed} failed`);

    // Signal that models are ready
    this.readyResolver();
  }

  private async loadModel(
    model: OnnxModelConfig | TransformersModelConfig,
    framework: "onnx" | "transformers",
  ): Promise<void> {
    const status: ModelLoadStatus = {
      name: model.name,
      framework: framework,
      status: "loading",
    };
    this.loadStatus.push(status);

    const startTime = Date.now();

    try {
      if (framework === "onnx") {
        await this.loadOnnxModel(model as OnnxModelConfig);
      } else {
        await this.loadTransformersModel(model as TransformersModelConfig);
      }

      status.status = "loaded";
      status.loadTimeMs = Date.now() - startTime;
      this.logger.log(`[${model.name}] Model loaded in ${status.loadTimeMs}ms`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status.status = "failed";
      status.error = message;
      this.logger.error(`[${model.name}] Failed to load: ${message}`);

      if (!model.optional && this.strictHash && message.includes("hash verification")) {
        throw new Error(`Required model ${model.name} failed hash verification`);
      }

      if (!model.optional && !message.includes("optional")) {
        throw new Error(`Required model ${model.name} failed to load`);
      }
    }
  }

  private async loadOnnxModel(config: OnnxModelConfig): Promise<void> {
    const cachePath = path.join(this.cacheDir, "onnx", config.name);
    const filePath = path.join(cachePath, path.basename(config.path));

    // Ensure cache directory exists
    if (!fs.existsSync(cachePath)) {
      fs.mkdirSync(cachePath, { recursive: true });
    }

    // Download if missing or if version mismatch
    const needsDownload = await this.needsDownload(filePath, config);
    if (needsDownload) {
      const downloadUrl = `${this.baseUrl}/${config.modelId}/resolve/main/${config.path}`;
      await this.downloadFile(downloadUrl, filePath, config.name);
    }

    // Verify hash
    if (this.verifyHash) {
      const isValid = this.verifyFileHash(filePath, config.hash);
      if (!isValid) {
        if (this.strictHash) {
          throw new Error(`Hash verification failed for ${config.name}`);
        }
        this.logger.warn(`[${config.name}] Hash verification failed (non-strict mode, continuing)`);
      }
    }

    // Download additional files (e.g., .onnx.data for external data models)
    if (config.additionalFiles) {
      for (const additionalFile of config.additionalFiles) {
        const additionalFilePath = path.join(cachePath, path.basename(additionalFile.path));
        const needsAdditionalDownload = !fs.existsSync(additionalFilePath);

        if (needsAdditionalDownload) {
          const additionalUrl = `${this.baseUrl}/${config.modelId}/resolve/main/${additionalFile.path}`;
          await this.downloadFile(additionalUrl, additionalFilePath, config.name, path.basename(additionalFile.path));
        }

        // Verify hash for additional file
        if (this.verifyHash) {
          const isValid = this.verifyFileHash(additionalFilePath, additionalFile.hash);
          if (!isValid) {
            if (this.strictHash) {
              throw new Error(`Hash verification failed for ${config.name}/${path.basename(additionalFile.path)}`);
            }
            this.logger.warn(
              `[${config.name}/${path.basename(additionalFile.path)}] Hash verification failed (non-strict mode, continuing)`,
            );
          }
        }
      }
    }

    // Load ONNX session
    const sessionOptions: ort.InferenceSession.SessionOptions = {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
      intraOpNumThreads: parseInt(process.env.ONNX_INTRA_OP_NUM_THREADS || "2"),
      interOpNumThreads: parseInt(process.env.ONNX_INTER_OP_NUM_THREADS || "1"),
      enableCpuMemArena: true,
      enableMemPattern: true,
    };

    const session = await ort.InferenceSession.create(filePath, sessionOptions);
    this.onnxSessions.set(config.name, session);
  }

  private async loadTransformersModel(config: TransformersModelConfig): Promise<void> {
    const cachePath = path.join(this.cacheDir, "transformers", config.name);
    const modelCache: Map<string, any> = new Map();

    // Ensure cache directory exists
    if (!fs.existsSync(cachePath)) {
      fs.mkdirSync(cachePath, { recursive: true });
    }

    // Load each component
    for (const component of config.components) {
      const componentPath = path.join(cachePath, component.file);

      // Download if missing or if version mismatch
      const componentUrl = `${this.baseUrl}/${config.modelId}/resolve/main/${config.path}/${component.file}`;
      const needsDownload = await this.needsDownload(componentPath, config, component);

      if (needsDownload) {
        await this.downloadFile(componentUrl, componentPath, config.name, component.name);
      }

      // Verify hash
      if (this.verifyHash) {
        const isValid = this.verifyFileHash(componentPath, component.hash);
        if (!isValid) {
          if (this.strictHash) {
            throw new Error(`Hash verification failed for ${config.name}/${component.name}`);
          }
          this.logger.warn(`[${config.name}/${component.name}] Hash verification failed (non-strict mode, continuing)`);
        }
      }

      // For Transformers.js models, we don't load them here
      // They're loaded lazily by the services that use them
      // We just verify they're downloaded and cached
      modelCache.set(component.name, { path: componentPath });
    }

    this.transformersModels.set(config.name, modelCache);
  }

  private async needsDownload(
    filePath: string,
    config: OnnxModelConfig | TransformersModelConfig,
    _component?: ModelComponent,
  ): Promise<boolean> {
    // If file doesn't exist, need download
    if (!fs.existsSync(filePath)) {
      return true;
    }

    // Check version compatibility if auto-update enabled
    if (!this.autoUpdate) {
      return false;
    }

    // Check version metadata
    const metadataPath = filePath + ".metadata";
    if (fs.existsSync(metadataPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
        if (metadata.version === config.version) {
          return false; // Version matches, no download needed
        }
        this.logger.log(`[${config.name}] Version mismatch: cached=${metadata.version}, config=${config.version}`);
      } catch {
        // Invalid metadata, need download
        return true;
      }
    }

    return true;
  }

  private async downloadFile(url: string, filePath: string, modelName: string, componentName?: string): Promise<void> {
    const label = componentName ? `${modelName}/${componentName}` : modelName;
    this.logger.log(`[${label}] Downloading from ${url}...`);

    const startTime = Date.now();

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength = response.headers.get("content-length");
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Stream the response to file
      const fileStream = fs.createWriteStream(filePath);
      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error("Failed to get response reader");
      }

      let downloadedBytes = 0;
      let lastLoggedPercent = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        fileStream.write(Buffer.from(value));
        downloadedBytes += value.length;

        // Log progress every 10%
        if (totalBytes > 0) {
          const percent = Math.floor((downloadedBytes / totalBytes) * 100);
          if (percent >= lastLoggedPercent + 10) {
            lastLoggedPercent = percent;
            const mbDownloaded = (downloadedBytes / 1024 / 1024).toFixed(1);
            const mbTotal = (totalBytes / 1024 / 1024).toFixed(1);
            this.logger.log(`[${label}] Progress: ${percent}% (${mbDownloaded}/${mbTotal} MB)`);
          }
        }
      }

      fileStream.end();

      // Wait for file to be fully written
      await new Promise<void>((resolve, reject) => {
        fileStream.on("finish", resolve);
        fileStream.on("error", reject);
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const fileSizeMB = (downloadedBytes / 1024 / 1024).toFixed(1);
      this.logger.log(`[${label}] Downloaded ${fileSizeMB} MB in ${duration}s`);

      // Save metadata
      const metadataPath = filePath + ".metadata";
      fs.writeFileSync(
        metadataPath,
        JSON.stringify({
          version: "1.0.0",
          downloadedAt: new Date().toISOString(),
        }),
      );
    } catch (error) {
      // Clean up partial download
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Download failed: ${message}`);
    }
  }

  private verifyFileHash(filePath: string, expectedHash: string): boolean {
    const actualHash = this.computeHash(filePath);
    const isValid = actualHash === expectedHash;

    if (!isValid) {
      this.logger.error(`Hash mismatch for ${filePath}`);
      this.logger.error(`  Expected: ${expectedHash}`);
      this.logger.error(`  Actual:   ${actualHash}`);
    }

    return isValid;
  }

  private computeHash(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash("sha256");
    hashSum.update(fileBuffer);
    return "sha256:" + hashSum.digest("hex");
  }

  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  // Public API for accessing models

  getOnnxSession(name: string): ort.InferenceSession | null {
    return this.onnxSessions.get(name) ?? null;
  }

  getTransformersModel(name: string, component?: string): any | null {
    const modelCache = this.transformersModels.get(name);
    if (!modelCache) {
      return null;
    }
    if (component) {
      return modelCache.get(component) ?? null;
    }
    return modelCache;
  }

  isModelLoaded(name: string, framework: "onnx" | "transformers"): boolean {
    if (framework === "onnx") {
      return this.onnxSessions.has(name);
    }
    return this.transformersModels.has(name);
  }

  getLoadedModels(): { onnx: string[]; transformers: string[] } {
    return {
      onnx: Array.from(this.onnxSessions.keys()),
      transformers: Array.from(this.transformersModels.keys()),
    };
  }

  getLoadStatus(): ModelLoadStatus[] {
    return [...this.loadStatus];
  }

  /**
   * Wait for all models to be loaded.
   * Services that depend on models should call this before accessing them.
   */
  async waitForReady(): Promise<void> {
    return this.readyPromise;
  }
}
