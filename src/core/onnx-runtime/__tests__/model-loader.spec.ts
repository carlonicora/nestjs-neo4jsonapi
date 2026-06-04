import { describe, it, expect } from "vitest";
import { ModelLoader } from "../../model-manager/model-loader";

describe("ModelLoader", () => {
  it("throws a clear error when the config file is missing", () => {
    const loader = new ModelLoader("/nonexistent/path/models.config.yaml");
    expect(() => loader.load()).toThrow(/Model configuration file not found/);
  });
});
