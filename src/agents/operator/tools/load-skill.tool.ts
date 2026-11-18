import { DynamicStructuredTool } from "@langchain/core/tools";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { AssistantSkillProvider } from "../../../common/interfaces/assistant.skill.interface";
import { ToolCallRecord, ToolFactory } from "../../graph/tools/tool.factory";
import type { OperatorToolDefinition } from "../interfaces/operator.tool.interface";

export const LOAD_SKILL_TOOL_NAME = "load_skill";

const inputSchema = z.object({
  name: z
    .string()
    .describe("The exact name of one skill from the skills list, as written there, without the leading slash."),
});

type LoadSkillRefusal = { error: string; allowed: string[] };

/**
 * load_skill - returns the instructions of one skill the turn offers.
 *
 * Read-only and never approved. It loads only names in `allowed` (the listed
 * skills plus the ones the user named or the selector preloaded); any other
 * name, or one the provider no longer returns, comes back as `{ error, allowed }`
 * so the model can correct itself, and capture() records the error.
 */
@Injectable()
export class LoadSkillTool {
  constructor(private readonly factory: ToolFactory) {}

  build(params: {
    allowed: string[];
    provider: AssistantSkillProvider;
    recorder: ToolCallRecord[];
  }): OperatorToolDefinition {
    const tool = new DynamicStructuredTool({
      name: LOAD_SKILL_TOOL_NAME,
      description:
        "Load the instructions of one skill from the skills list. Call it before doing work a skill applies to, then follow the instructions it returns.",
      schema: inputSchema,
      func: async (input) => {
        const result = await this.invoke(input, params);
        return typeof result === "string" ? result : JSON.stringify(result);
      },
    });
    return { tool, destructive: false };
  }

  private invoke(
    input: z.infer<typeof inputSchema>,
    params: { allowed: string[]; provider: AssistantSkillProvider; recorder: ToolCallRecord[] },
  ): Promise<string | LoadSkillRefusal> {
    return this.factory.capture<string | LoadSkillRefusal>(
      { tool: LOAD_SKILL_TOOL_NAME, input },
      async () => {
        if (!params.allowed.includes(input.name)) {
          return {
            error: "Unknown skill: " + input.name + ". Use a name from the skills list.",
            allowed: params.allowed,
          };
        }
        const loaded = await params.provider.load({ names: [input.name] });
        const skill = loaded.find((s) => s.name === input.name);
        if (!skill) {
          return { error: "The skill " + input.name + " is not available.", allowed: params.allowed };
        }
        return skill.instructions;
      },
      params.recorder,
    );
  }
}
