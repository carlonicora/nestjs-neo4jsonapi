import { DynamicStructuredTool } from "@langchain/core/tools";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ToolCallRecord, ToolFactory } from "../../graph/tools/tool.factory";
import { OperatorToolDefinition } from "../interfaces/operator.tool.interface";

const inputSchema = z.object({
  note: z.string().describe("A short note describing the test action to execute."),
});

/**
 * Test-only destructive tool: echoes its note as "executed". Used to exercise
 * the approval-gate flow end to end. Registered only when NODE_ENV !== "production".
 */
@Injectable()
export class OperatorTestActionTool {
  constructor(private readonly factory: ToolFactory) {}

  buildDefinition(recorder: ToolCallRecord[]): OperatorToolDefinition {
    return {
      tool: new DynamicStructuredTool({
        name: "operator_test_action",
        description:
          "Execute a test action (development/test environments only). This action requires user approval before it runs.",
        schema: inputSchema,
        func: async (input: z.infer<typeof inputSchema>) =>
          this.factory.capture(
            { tool: "operator_test_action", input },
            async () => `Executed test action: ${input.note}`,
            recorder,
          ),
      }),
      destructive: true,
      summarise: (args: Record<string, unknown>) => `Run test action: ${args.note}`,
    };
  }
}
