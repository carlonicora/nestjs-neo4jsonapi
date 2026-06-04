/**
 * Model Configuration Loader
 *
 * Loads and validates models.config.yaml, providing type-safe access to model configuration.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { Logger } from "@nestjs/common";
import { ModelsConfig, ConfigValidationResult, OnnxModelConfig, TransformersModelConfig } from "./model-manager.config";

const logger = new Logger("ModelLoader");

export class ModelLoader {
  private config: ModelsConfig | null = null;
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || this.getDefaultConfigPath();
  }

  private getDefaultConfigPath(): string {
    const fromEnv = process.env.MODEL_CONFIG_PATH;
    if (fromEnv) {
      return fromEnv;
    }
    return path.join(process.cwd(), "config", "models.config.yaml");
  }

  load(): ModelsConfig {
    if (this.config) {
      return this.config;
    }

    const fullPath = path.resolve(this.configPath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Model configuration file not found: ${fullPath}`);
    }

    try {
      const fileContent = fs.readFileSync(fullPath, "utf-8");
      const parsed = yaml.load(fileContent) as any;

      this.config = this.validateAndTransform(parsed);
      logger.log(`Model configuration loaded from: ${fullPath}`);
      logger.log(
        `Total models: ${this.config.registry.onnx.length} ONNX, ${this.config.registry.transformers.length} Transformers`,
      );

      return this.config;
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        throw error;
      }
      throw new Error(`Failed to parse model configuration: ${error}`);
    }
  }

  private validateAndTransform(parsed: any): ModelsConfig {
    const result: ConfigValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    // Validate top-level structure
    if (!parsed.version) {
      result.errors.push("Missing required field: version");
    }
    if (!parsed.registry) {
      result.errors.push("Missing required field: registry");
    }

    if (!parsed.registry?.onnx) {
      result.errors.push("Missing required field: registry.onnx");
    }
    if (!parsed.registry?.transformers) {
      result.errors.push("Missing required field: registry.transformers");
    }

    // Validate ONNX models
    const onnxModels = parsed.registry?.onnx || [];
    onnxModels.forEach((model: any, index: number) => {
      if (!model.name) {
        result.errors.push(`ONNX model ${index}: Missing required field: name`);
      }
      if (!model.path) {
        result.errors.push(`ONNX model ${model.name || index}: Missing required field: path`);
      }
      if (!model.version) {
        result.errors.push(`ONNX model ${model.name || index}: Missing required field: version`);
      }
      if (!model.hash) {
        result.errors.push(`ONNX model ${model.name || index}: Missing required field: hash`);
      }
      if (typeof model.priority !== "number") {
        result.errors.push(`ONNX model ${model.name || index}: Missing required field: priority`);
      }
      if (typeof model.optional !== "boolean") {
        result.errors.push(`ONNX model ${model.name || index}: Missing required field: optional`);
      }
      if (!model.modelId) {
        result.errors.push(`ONNX model ${model.name || index}: Missing required field: modelId`);
      }
    });

    // Validate Transformers models
    const transformersModels = parsed.registry?.transformers || [];
    transformersModels.forEach((model: any, index: number) => {
      if (!model.name) {
        result.errors.push(`Transformers model ${index}: Missing required field: name`);
      }
      if (!model.path) {
        result.errors.push(`Transformers model ${model.name || index}: Missing required field: path`);
      }
      if (!model.version) {
        result.errors.push(`Transformers model ${model.name || index}: Missing required field: version`);
      }
      if (!model.components || !Array.isArray(model.components)) {
        result.errors.push(`Transformers model ${model.name || index}: Missing required field: components`);
      }
      if (typeof model.priority !== "number") {
        result.errors.push(`Transformers model ${model.name || index}: Missing required field: priority`);
      }
      if (typeof model.optional !== "boolean") {
        result.errors.push(`Transformers model ${model.name || index}: Missing required field: optional`);
      }
      if (!model.modelId) {
        result.errors.push(`Transformers model ${model.name || index}: Missing required field: modelId`);
      }

      // Validate components
      model.components?.forEach((component: any, cIndex: number) => {
        if (!component.name) {
          result.errors.push(
            `Transformers model ${model.name || index}, component ${cIndex}: Missing required field: name`,
          );
        }
        if (!component.file) {
          result.errors.push(
            `Transformers model ${model.name || index}, component ${cIndex}: Missing required field: file`,
          );
        }
        if (!component.hash) {
          result.errors.push(
            `Transformers model ${model.name || index}, component ${cIndex}: Missing required field: hash`,
          );
        }
      });
    });

    // If errors, throw
    if (result.errors.length > 0) {
      const errorSummary = result.errors.join("\n  - ");
      throw new Error(`Model configuration validation failed:\n  - ${errorSummary}`);
    }

    // Log warnings
    if (result.warnings.length > 0) {
      logger.warn(`Model configuration warnings:\n  - ${result.warnings.join("\n  - ")}`);
    }

    // Return typed config
    return {
      version: parsed.version,
      registry: {
        onnx: onnxModels as OnnxModelConfig[],
        transformers: transformersModels as TransformersModelConfig[],
      },
    };
  }

  getConfig(): ModelsConfig {
    if (!this.config) {
      return this.load();
    }
    return this.config;
  }

  getOnnxModels(): OnnxModelConfig[] {
    return this.getConfig().registry.onnx;
  }

  getTransformersModels(): TransformersModelConfig[] {
    return this.getConfig().registry.transformers;
  }

  getOnnxModelByName(name: string): OnnxModelConfig | undefined {
    return this.getOnnxModels().find((m) => m.name === name);
  }

  getTransformersModelByName(name: string): TransformersModelConfig | undefined {
    return this.getTransformersModels().find((m) => m.name === name);
  }

  getAllModels(): (OnnxModelConfig | TransformersModelConfig)[] {
    const config = this.getConfig();
    return [...config.registry.onnx, ...config.registry.transformers];
  }
}

let loaderInstance: ModelLoader | null = null;

export function getModelLoader(configPath?: string): ModelLoader {
  if (!loaderInstance) {
    loaderInstance = new ModelLoader(configPath);
  }
  return loaderInstance;
}
