export { OnnxRuntimeModule } from "./onnx-runtime.module";
export { OnnxRuntimeService } from "./onnx-runtime.service";
// NOTE (lib barrel only): only35 exports the legacy onnx-runtime.config OnnxModelConfig here,
// but in this package's single barrel it collides with model-manager.config's OnnxModelConfig
// (the YAML registry type). Export only OnnxRuntimeModuleOptions; the canonical OnnxModelConfig
// comes from ./model-manager.
export type { OnnxRuntimeModuleOptions } from "./onnx-runtime.config";
export { ONNX_RUNTIME_OPTIONS } from "./onnx-runtime.constants";
