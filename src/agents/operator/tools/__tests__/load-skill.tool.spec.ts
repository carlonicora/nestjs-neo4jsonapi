import { DynamicStructuredTool } from "@langchain/core/tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import type { AssistantSkillProvider } from "../../../../common/interfaces/assistant.skill.interface";
import { ToolCallRecord, ToolFactory } from "../../../graph/tools/tool.factory";
import { LoadSkillTool } from "../load-skill.tool";

// Real capture wrapper, dependencies unused by capture().
const factory = new ToolFactory({} as any, {} as any);

describe("LoadSkillTool", () => {
  let provider: Mocked<AssistantSkillProvider>;
  let recorder: ToolCallRecord[];
  let tool: LoadSkillTool;

  beforeEach(() => {
    provider = {
      listActive: vi.fn(),
      load: vi.fn(async ({ names }: { names: string[] }) =>
        names.filter((n) => n === "email").map((name) => ({ name, instructions: "Sign off with the team name." })),
      ),
    };
    recorder = [];
    tool = new LoadSkillTool(factory);
  });

  it("builds a read-only load_skill tool with a described name field", () => {
    const definition = tool.build({ allowed: ["email"], provider, recorder });
    expect(definition.destructive).toBe(false);
    expect(definition.tool).toBeInstanceOf(DynamicStructuredTool);
    expect(definition.tool.name).toBe("load_skill");
    const shape = (definition.tool.schema as any).shape;
    expect(shape.name.description).toBeTruthy();
    expect(shape.name.description).not.toMatch(/[{}]/);
  });

  it("loads an allowed skill and returns its instructions as plain text", async () => {
    const definition = tool.build({ allowed: ["email"], provider, recorder });
    const result = await definition.tool.invoke({ name: "email" });

    expect(provider.load).toHaveBeenCalledTimes(1);
    expect(provider.load).toHaveBeenCalledWith({ names: ["email"] });
    expect(result).toBe("Sign off with the team name.");
    expect(recorder).toHaveLength(1);
    expect(recorder[0].tool).toBe("load_skill");
    expect(recorder[0].input).toEqual({ name: "email" });
    expect(recorder[0].error).toBeUndefined();
  });

  it("refuses a name that is not allowed without calling the provider", async () => {
    const definition = tool.build({ allowed: ["email"], provider, recorder });
    const result = await definition.tool.invoke({ name: "other" });

    expect(provider.load).not.toHaveBeenCalled();
    const parsed = JSON.parse(result as string);
    expect(typeof parsed.error).toBe("string");
    expect(parsed.allowed).toEqual(["email"]);
    expect(recorder).toHaveLength(1);
    expect(recorder[0].error).toBe(parsed.error);
  });

  it("refuses a name the provider returns nothing for", async () => {
    const definition = tool.build({ allowed: ["email", "humanizer"], provider, recorder });
    const result = await definition.tool.invoke({ name: "humanizer" });

    expect(provider.load).toHaveBeenCalledWith({ names: ["humanizer"] });
    const parsed = JSON.parse(result as string);
    expect(typeof parsed.error).toBe("string");
    expect(parsed.allowed).toEqual(["email", "humanizer"]);
    expect(recorder).toHaveLength(1);
    expect(recorder[0].error).toBe(parsed.error);
  });
});
