import { DynamicModule, Global, Module } from "@nestjs/common";
import { OnnxRuntimeModuleOptions } from "./onnx-runtime.config";
import { OnnxRuntimeService } from "./onnx-runtime.service";
import { ONNX_RUNTIME_OPTIONS } from "./onnx-runtime.constants";
// ModelManagerService is now provided globally by ModelManagerModule

interface OnnxRuntimeAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (...args: any[]) => Promise<OnnxRuntimeModuleOptions> | OnnxRuntimeModuleOptions;
}

/**
 * Global NestJS module for ONNX Runtime session management.
 *
 * This module provides centralized ONNX model loading and session management.
 * It uses OnApplicationBootstrap to load models AFTER @huggingface/transformers
 * services (which use OnModuleInit), avoiding potential conflicts.
 *
 * @example
 * ```typescript
 * // In your root module (e.g., FeaturesModules)
 * import { OnnxRuntimeModule } from 'src/common/onnx-runtime';
 *
 * const ONNX_MODELS: OnnxModelConfig[] = [
 *   { name: 'yolo-pose', path: 'models/yolo11l-pose.onnx', priority: 1, optional: false },
 *   { name: 'arcface', path: 'models/arcface.onnx', priority: 2, optional: false },
 * ];
 *
 * @Module({
 *   imports: [
 *     OnnxRuntimeModule.forRoot({ models: ONNX_MODELS }),
 *   ],
 * })
 * export class FeaturesModules {}
 * ```
 *
 * @example
 * ```typescript
 * // In your service
 * import { OnnxRuntimeService } from 'src/common/onnx-runtime';
 *
 * @Injectable()
 * export class MyDetectionService {
 *   constructor(private readonly onnxService: OnnxRuntimeService) {}
 *
 *   async detect(buffer: Buffer) {
 *     const session = this.onnxService.getSession('yolo-pose');
 *     if (!session) throw new Error('Model not loaded');
 *     // ... run inference
 *   }
 * }
 * ```
 */
@Global()
@Module({})
export class OnnxRuntimeModule {
  /**
   * Configure the ONNX Runtime module with model definitions.
   *
   * @param options - Configuration including models to load
   * @returns Dynamic module configuration
   */
  static forRoot(options: OnnxRuntimeModuleOptions): DynamicModule {
    return {
      module: OnnxRuntimeModule,
      providers: [
        {
          provide: ONNX_RUNTIME_OPTIONS,
          useValue: options,
        },
        OnnxRuntimeService,
      ],
      exports: [OnnxRuntimeService],
    };
  }

  /**
   * Configure the ONNX Runtime module asynchronously with ConfigService.
   *
   * @param options - Async configuration including factory function
   * @returns Dynamic module configuration
   */
  static forRootAsync(options: OnnxRuntimeAsyncOptions): DynamicModule {
    return {
      module: OnnxRuntimeModule,
      imports: options.imports || [],
      providers: [
        {
          provide: ONNX_RUNTIME_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        OnnxRuntimeService,
      ],
      exports: [OnnxRuntimeService],
    };
  }
}
