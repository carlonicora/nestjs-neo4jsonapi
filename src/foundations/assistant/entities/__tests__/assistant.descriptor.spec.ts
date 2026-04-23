import { describe, expect, it } from "vitest";
import { AssistantDescriptor } from "../assistant";

describe("AssistantDescriptor (post-refactor)", () => {
  it("no longer declares a messages JSON field", () => {
    const fields = AssistantDescriptor.fields as Record<string, any>;
    expect(fields.messages).toBeUndefined();
  });

  it("declares a messages relationship to assistant-messages (direction=out, HAS_MESSAGE, many)", () => {
    const rel = (AssistantDescriptor.relationships as any).messages;
    expect(rel).toBeDefined();
    expect(rel.direction).toBe("out");
    expect(rel.relationship).toBe("HAS_MESSAGE");
    expect(rel.cardinality).toBe("many");
    expect(rel.required).toBe(false);
  });

  it("does NOT declare a name_embedding field", () => {
    const fields = AssistantDescriptor.fields as Record<string, any>;
    expect(fields.name_embedding).toBeUndefined();
  });
});
