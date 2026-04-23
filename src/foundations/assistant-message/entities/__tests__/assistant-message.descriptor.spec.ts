import { describe, expect, it } from "vitest";
import { AssistantMessageDescriptor } from "../assistant-message";

describe("AssistantMessageDescriptor", () => {
  it("declares required fields for role, content, position", () => {
    const fields = AssistantMessageDescriptor.fields as Record<string, any>;
    expect(fields.role.required).toBe(true);
    expect(fields.content.required).toBe(true);
    expect(fields.position.required).toBe(true);
  });

  it("declares the assistant relationship as direction=in, HAS_MESSAGE, required, immutable", () => {
    const rel = (AssistantMessageDescriptor.relationships as any).assistant;
    expect(rel.direction).toBe("in");
    expect(rel.relationship).toBe("HAS_MESSAGE");
    expect(rel.cardinality).toBe("one");
    expect(rel.required).toBe(true);
    expect(rel.immutable).toBe(true);
  });

  it("is company-scoped", () => {
    expect(AssistantMessageDescriptor.isCompanyScoped).toBe(true);
  });

  it("does NOT declare a name_embedding field", () => {
    const fields = AssistantMessageDescriptor.fields as Record<string, any>;
    expect(fields.name_embedding).toBeUndefined();
  });
});
