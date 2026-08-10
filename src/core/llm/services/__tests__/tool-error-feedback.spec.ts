import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  REPEATED_TOOL_FAILURE_LIMIT,
  describeToolInputRejection,
  repeatedToolFailureMessage,
  toolCallSignature,
} from "../tool-error-feedback";

const readEntitySchema = z.object({
  type: z.string(),
  id: z.string(),
  include: z.array(z.string()).optional(),
});

describe("toolCallSignature", () => {
  it("is insensitive to key order — models re-emit the same call with keys shuffled", () => {
    const a = toolCallSignature("read_entity", { id: "npc-1", include: ["goals"] });
    const b = toolCallSignature("read_entity", { include: ["goals"], id: "npc-1" });
    expect(a).toBe(b);
  });

  it("is insensitive to key order at any depth", () => {
    const a = toolCallSignature("traverse", { filters: [{ field: "name", op: "eq" }] });
    const b = toolCallSignature("traverse", { filters: [{ op: "eq", field: "name" }] });
    expect(a).toBe(b);
  });

  it("preserves array order, which is meaningful", () => {
    const a = toolCallSignature("read_entity", { include: ["goals", "factions"] });
    const b = toolCallSignature("read_entity", { include: ["factions", "goals"] });
    expect(a).not.toBe(b);
  });

  it("separates different tools and different arguments", () => {
    expect(toolCallSignature("read_entity", { id: "a" })).not.toBe(toolCallSignature("traverse", { id: "a" }));
    expect(toolCallSignature("read_entity", { id: "a" })).not.toBe(toolCallSignature("read_entity", { id: "b" }));
  });

  it("tolerates non-object arguments", () => {
    expect(() => toolCallSignature("read_entity", undefined)).not.toThrow();
    expect(() => toolCallSignature("read_entity", "raw string")).not.toThrow();
  });
});

describe("describeToolInputRejection", () => {
  it("names the missing required argument and lists every required argument", () => {
    const message = describeToolInputRejection({
      toolName: "read_entity",
      schema: readEntitySchema,
      args: { id: "npc-1", include: ["factions"] },
    });

    expect(message).toContain('Missing required argument "type"');
    expect(message).toContain("expected string");
    expect(message).toContain("Required arguments for read_entity: type, id");
    // Imperative, never question-shaped: small models relay questions to the user.
    expect(message).toContain("Reissue");
    expect(message).not.toContain("?");
  });

  it("reports a present-but-wrong argument as invalid rather than missing", () => {
    const message = describeToolInputRejection({
      toolName: "read_entity",
      schema: readEntitySchema,
      args: { type: 42, id: "npc-1" },
    });

    expect(message).toContain('Invalid argument "type"');
    expect(message).not.toContain("Missing required argument");
  });

  it("names unexpected arguments on a strict schema", () => {
    const message = describeToolInputRejection({
      toolName: "search_entities",
      schema: z.object({ type: z.string() }).strict(),
      args: { type: "npcs", nope: 1 },
    });

    expect(message).toContain('Unexpected argument "nope"');
  });

  it("returns null when the arguments are actually valid — the failure was elsewhere", () => {
    expect(
      describeToolInputRejection({
        toolName: "read_entity",
        schema: readEntitySchema,
        args: { type: "npcs", id: "npc-1" },
      }),
    ).toBeNull();
  });

  it("returns null when the schema cannot be introspected", () => {
    expect(describeToolInputRejection({ toolName: "read_entity", schema: {}, args: { id: "x" } })).toBeNull();
    expect(describeToolInputRejection({ toolName: "read_entity", schema: undefined, args: { id: "x" } })).toBeNull();
  });
});

describe("repeatedToolFailureMessage", () => {
  it("states the tool, the repeat count and an instruction to stop", () => {
    const message = repeatedToolFailureMessage({ toolName: "read_entity", attempts: REPEATED_TOOL_FAILURE_LIMIT });
    expect(message).toContain("read_entity");
    expect(message).toContain(String(REPEATED_TOOL_FAILURE_LIMIT));
    expect(message).toContain("Stop calling");
  });
});
