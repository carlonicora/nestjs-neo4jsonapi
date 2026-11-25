import { describe, it, expect, vi } from "vitest";
import { AppMode, AppModeConfig } from "../../../common/decorators/conditional-service.decorator";
import { ModelManagerModule } from "../../model-manager/model-manager.module";
import { ModelManagerService } from "../../model-manager/model-manager.service";
import { OnnxRuntimeModule } from "../onnx-runtime.module";

vi.mock("../../model-manager/model-loader", () => ({
  getModelLoader: () => ({ getConfig: () => ({ registry: { onnx: [], transformers: [] } }) }),
}));

describe("ONNX runtime + model-manager wiring", () => {
  it("exposes the ModelManagerModule and OnnxRuntimeModule.forRoot/forRootAsync", () => {
    expect(ModelManagerModule).toBeTruthy();
    expect(typeof OnnxRuntimeModule.forRoot).toBe("function");
    expect(typeof OnnxRuntimeModule.forRootAsync).toBe("function");
  });
});

describe("labelled worker", () => {
  const shouldLoad = (config: Partial<AppModeConfig>, loadInApi: boolean): boolean =>
    (new ModelManagerService(config as AppModeConfig) as any).shouldLoadModel({ loadInApi });

  it("a labelled worker loads only the models marked loadInApi", () => {
    const config = { mode: AppMode.WORKER, label: "x" };

    expect(shouldLoad(config, false)).toBe(false);
    expect(shouldLoad(config, true)).toBe(true);
  });

  it("an unlabelled worker loads every model", () => {
    const config = { mode: AppMode.WORKER };

    expect(shouldLoad(config, false)).toBe(true);
    expect(shouldLoad(config, true)).toBe(true);
  });

  it("the api loads only the models marked loadInApi", () => {
    const config = { mode: AppMode.API };

    expect(shouldLoad(config, false)).toBe(false);
    expect(shouldLoad(config, true)).toBe(true);
  });
});
