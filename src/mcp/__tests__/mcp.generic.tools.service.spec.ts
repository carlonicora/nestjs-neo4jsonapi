import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpGenericToolsService } from "../services/mcp.generic.tools.service";
import { FILTER_OPERATORS, filtersJsonSchema, sortJsonSchema } from "../../agents/graph/tools/traverse.tool";

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

describe("McpGenericToolsService filter contract", () => {
  let service: McpGenericToolsService;
  const searchTool = { invoke: vi.fn().mockResolvedValue({ items: [] }) };
  const traverseTool = { invoke: vi.fn().mockResolvedValue({ items: [] }) };
  const idle = { invoke: vi.fn().mockResolvedValue({}) };
  const writeService = { buildTools: vi.fn().mockReturnValue([]) };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new McpGenericToolsService(
      idle as any,
      idle as any,
      searchTool as any,
      idle as any,
      traverseTool as any,
      idle as any,
      writeService as any,
    );
  });

  it("advertises the filters shape on the wire", () => {
    for (const name of ["search_entities", "traverse"]) {
      const tool = service.build(ctx).find((t) => t.name === name)!;
      const properties = (tool.inputSchema as any).properties;
      expect(properties.filters).toEqual(filtersJsonSchema);
      expect(properties.sort).toEqual(sortJsonSchema);
      const variants = properties.filters.oneOf;
      expect(variants.map((v: any) => v.type)).toEqual(["array", "object"]);
      expect(variants[0].items.properties.op.enum).toEqual([...FILTER_OPERATORS]);
    }
  });

  it("returns validation_failed on a bad filter", async () => {
    const tool = service.build(ctx).find((t) => t.name === "search_entities")!;
    const out = await tool.execute(
      { type: "judgements", filters: [{ field: "number", op: "contains", value: "1" }] },
      ctx,
    );
    expect(out.isError).toBe(true);
    const payload = JSON.parse((out.content[0] as { text: string }).text);
    expect(payload.code).toBe("validation_failed");
    expect(payload.message).toContain('Operator "contains" is not valid');
    expect(searchTool.invoke).not.toHaveBeenCalled();
  });

  it("returns validation_failed on a bad traverse filter shape", async () => {
    const tool = service.build(ctx).find((t) => t.name === "traverse")!;
    const out = await tool.execute(
      { fromType: "orders", fromId: "o1", relationship: "lines", filters: [{ number: "1", op: "eq" }] },
      ctx,
    );
    expect(out.isError).toBe(true);
    const payload = JSON.parse((out.content[0] as { text: string }).text);
    expect(payload.code).toBe("validation_failed");
    expect(payload.message).toContain("{ field, op, value }");
    expect(traverseTool.invoke).not.toHaveBeenCalled();
  });

  it("returns validation_failed for an unknown key on traverse", async () => {
    const tool = service.build(ctx).find((t) => t.name === "traverse")!;
    const out = await tool.execute(
      { fromType: "orders", fromId: "o1", relationship: "lines", filter: [{ field: "total", op: "gt", value: 1 }] },
      ctx,
    );
    expect(out.isError).toBe(true);
    const payload = JSON.parse((out.content[0] as { text: string }).text);
    expect(payload.code).toBe("validation_failed");
    expect(JSON.stringify(payload.issues)).toContain("filter");
    expect(traverseTool.invoke).not.toHaveBeenCalled();
  });

  it("returns validation_failed on a bad sort", async () => {
    for (const name of ["search_entities", "traverse"]) {
      const tool = service.build(ctx).find((t) => t.name === name)!;
      const input =
        name === "traverse"
          ? {
              fromType: "orders",
              fromId: "o1",
              relationship: "lines",
              sort: [{ field: "total", direction: "descending" }],
            }
          : { type: "orders", sort: [{ field: "total", direction: "descending" }] };
      const out = await tool.execute(input, ctx);
      expect(out.isError).toBe(true);
      const payload = JSON.parse((out.content[0] as { text: string }).text);
      expect(payload.code).toBe("validation_failed");
      expect(payload.message).toContain("asc | desc");
      expect(payload.sort).toEqual(sortJsonSchema);
    }
    expect(searchTool.invoke).not.toHaveBeenCalled();
    expect(traverseTool.invoke).not.toHaveBeenCalled();
  });

  it("advertises every sort form coerceSort accepts", () => {
    const variants = (sortJsonSchema as any).oneOf;
    const item = variants.find((v: any) => v.type === "object" && v.properties?.field);
    expect(item.properties.direction.enum).toEqual(["asc", "desc"]);
    expect(variants.some((v: any) => v.type === "object" && v.additionalProperties?.enum)).toBe(true);
  });
});
