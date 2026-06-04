import { describe, it, expect } from "vitest";
import { ModelManagerModule } from "../../model-manager/model-manager.module";
import { OnnxRuntimeModule } from "../onnx-runtime.module";

describe("ONNX runtime + model-manager wiring", () => {
  it("exposes the ModelManagerModule and OnnxRuntimeModule.forRoot/forRootAsync", () => {
    expect(ModelManagerModule).toBeTruthy();
    expect(typeof OnnxRuntimeModule.forRoot).toBe("function");
    expect(typeof OnnxRuntimeModule.forRootAsync).toBe("function");
  });
});
