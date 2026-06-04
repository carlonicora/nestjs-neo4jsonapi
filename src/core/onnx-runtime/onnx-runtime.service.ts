import { Inject, Injectable, Logger } from "@nestjs/common";
import * as ort from "onnxruntime-node";
import { OnnxRuntimeModuleOptions, DEFAULT_ONNX_RUNTIME_OPTIONS } from "./onnx-runtime.config";
import { ONNX_RUNTIME_OPTIONS } from "./onnx-runtime.constants";
import { ModelManagerService } from "../model-manager/model-manager.service";

/**
 * ONNX Runtime service for session configuration and access.
 *
 * This service now delegates to ModelManagerService for model loading.
 * It maintains backward compatibility by providing session access methods.
 *
 * The service uses OnApplicationBootstrap instead of OnModuleInit to ensure
 * @huggingface/transformers services (which use OnModuleInit) load their models first,
 * avoiding potential conflicts with the shared native ONNX Runtime.
 */
@Injectable()
export class OnnxRuntimeService {
  private readonly logger = new Logger(OnnxRuntimeService.name);
  private readonly sessionOptions: ort.InferenceSession.SessionOptions;
  private readonly options: Required<OnnxRuntimeModuleOptions>;

  constructor(
    @Inject(ONNX_RUNTIME_OPTIONS)
    options: OnnxRuntimeModuleOptions,
    private readonly modelManager: ModelManagerService,
  ) {
    // Merge with defaults
    this.options = {
      ...DEFAULT_ONNX_RUNTIME_OPTIONS,
      ...options,
    } as Required<OnnxRuntimeModuleOptions>;

    // Configure ONNX Runtime environment ONCE at construction
    this.configureRuntime();

    // Build session options for backward compatibility
    this.sessionOptions = this.buildSessionOptions();
  }

  /**
   * Configure the ONNX Runtime global environment.
   * Called once during service construction.
   */
  private configureRuntime(): void {
    // Disable telemetry
    ort.env.telemetry = false;

    // Set log level to 'fatal' to silence verbose BFCArena/memory allocation logs
    // Only critical errors will be shown
    ort.env.logLevel = "fatal";

    this.logger.log(
      `ONNX Runtime configured: threads=${this.options.intraOpNumThreads}/${this.options.interOpNumThreads}, ` +
        `optimization=${this.options.graphOptimizationLevel}`,
    );
  }

  /**
   * Build session options from configuration.
   * Note: These options are no longer used directly for loading
   * (ModelManagerService handles that), but kept for backward compatibility.
   */
  private buildSessionOptions(): ort.InferenceSession.SessionOptions {
    return {
      executionProviders: ["cpu"],
      graphOptimizationLevel: this.options.graphOptimizationLevel,
      intraOpNumThreads: this.options.intraOpNumThreads,
      interOpNumThreads: this.options.interOpNumThreads,
      enableCpuMemArena: true,
      enableMemPattern: true,
    };
  }

  /**
   * Get a loaded session by name.
   * Delegates to ModelManagerService.
   *
   * @param name - The model name as configured in models.config.yaml
   * @returns The InferenceSession, or null if not loaded
   */
  getSession(name: string): ort.InferenceSession | null {
    return this.modelManager.getOnnxSession(name);
  }

  /**
   * Check if a model is loaded and ready.
   * Delegates to ModelManagerService.
   *
   * @param name - The model name
   * @returns true if the model is loaded
   */
  isModelLoaded(name: string): boolean {
    return this.modelManager.isModelLoaded(name, "onnx");
  }

  /**
   * Wait for all models to be loaded.
   * Services that depend on ONNX models should call this before accessing them.
   */
  async waitForReady(): Promise<void> {
    return this.modelManager.waitForReady();
  }

  /**
   * Get all loaded ONNX model names.
   * Delegates to ModelManagerService.
   */
  getLoadedModels(): string[] {
    const loaded = this.modelManager.getLoadedModels();
    return loaded.onnx;
  }
}
