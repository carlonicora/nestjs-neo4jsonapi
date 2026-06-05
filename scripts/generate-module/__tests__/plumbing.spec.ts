import { describe, it, expect } from "vitest";
import { makeTemplateData } from "./fixtures";

describe("backend plumbing fixtures", () => {
  it("builds a TemplateData with the new optional fields defaulted", () => {
    const data = makeTemplateData();
    expect(data.requiresS3).toBe(false);
    expect(data.exportService).toBe(true);
  });

  it("carries field descriptors through overrides", () => {
    const data = makeTemplateData({
      fields: [{ name: "value", type: "number", required: false, tsType: "number", kind: { type: "money" }, description: "Money." }],
    });
    expect(data.fields[0].kind?.type).toBe("money");
    expect(data.fields[0].description).toBe("Money.");
  });
});
