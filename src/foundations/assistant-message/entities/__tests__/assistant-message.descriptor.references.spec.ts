import { describe, it, expect } from "vitest";
import { AssistantMessageDescriptor } from "../assistant-message";

describe("AssistantMessageDescriptor — references", () => {
  it("declares `references` as a polymorphic many-relationship over :REFERENCES", () => {
    const rel = (AssistantMessageDescriptor.relationships as any).references;
    expect(rel).toBeDefined();
    expect(rel.relationship).toBe("REFERENCES");
    expect(rel.direction).toBe("out");
    expect(rel.cardinality).toBe("many");
    expect(rel.polymorphic).toBeDefined();
  });

  it("does NOT expose `references` as a field (no stringified attribute)", () => {
    expect(AssistantMessageDescriptor.fields.references).toBeUndefined();
  });
});
