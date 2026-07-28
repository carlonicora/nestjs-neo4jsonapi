import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpGenericToolsService } from "../services/mcp.generic.tools.service";

const ctx = { userId: "u1", companyId: "c1", userModuleIds: ["mod-orders"] };

/**
 * Regression: the graph tools enforce a describe-first contract via a
 * per-turn recorder. MCP is stateless (fresh recorder per tools/call), so the
 * service must seed the recorder with the requested type or search/read/
 * traverse would refuse every call and the retry guidance would loop forever.
 */
describe("McpGenericToolsService describe-first seeding", () => {
  let service: McpGenericToolsService;
  const searchTool = { invoke: vi.fn().mockResolvedValue([]) };
  const readTool = { invoke: vi.fn().mockResolvedValue({}) };
  const traverseTool = { invoke: vi.fn().mockResolvedValue([]) };
  const describeTool = { invoke: vi.fn().mockResolvedValue({}) };
  const resolveTool = { invoke: vi.fn().mockResolvedValue({}) };
  const searchDocsTool = { invoke: vi.fn().mockResolvedValue("") };
  const writeService = { buildTools: vi.fn().mockReturnValue([]) };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new McpGenericToolsService(
      resolveTool as any,
      describeTool as any,
      searchTool as any,
      readTool as any,
      traverseTool as any,
      searchDocsTool as any,
      writeService as any,
    );
  });

  function recorderPassedTo(mock: { mock: { calls: any[][] } }): Array<{ tool: string; input: any }> {
    return mock.mock.calls[0][2];
  }

  it("search_entities seeds a describe_entity record for the requested type", async () => {
    const tool = service.build(ctx).find((t) => t.name === "search_entities")!;
    await tool.execute({ type: "orders", limit: 5 }, ctx);
    expect(recorderPassedTo(searchTool.invoke)).toContainEqual(
      expect.objectContaining({ tool: "describe_entity", input: { type: "orders" } }),
    );
  });

  it("read_entity seeds for input.type and traverse for input.fromType", async () => {
    const tools = service.build(ctx);
    await tools.find((t) => t.name === "read_entity")!.execute({ type: "orders", id: "o1" }, ctx);
    expect(recorderPassedTo(readTool.invoke)).toContainEqual(
      expect.objectContaining({ tool: "describe_entity", input: { type: "orders" } }),
    );
    await tools
      .find((t) => t.name === "traverse")!
      .execute({ fromType: "orders", fromId: "o1", relationship: "account" }, ctx);
    expect(recorderPassedTo(traverseTool.invoke)).toContainEqual(
      expect.objectContaining({ tool: "describe_entity", input: { type: "orders" } }),
    );
  });

  it("describe_entity and resolve_entity do not seed", async () => {
    const tools = service.build(ctx);
    await tools.find((t) => t.name === "describe_entity")!.execute({ type: "orders" }, ctx);
    expect(recorderPassedTo(describeTool.invoke)).toEqual([]);
  });
});
