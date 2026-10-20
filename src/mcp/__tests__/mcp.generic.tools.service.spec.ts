import { BadRequestException } from "@nestjs/common";
import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpGenericToolsService } from "../services/mcp.generic.tools.service";
import { ResolveEntityTool } from "../../agents/graph/tools/resolve-entity.tool";
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
      {} as any,
      {} as any,
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
      {} as any,
      {} as any,
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

describe("McpGenericToolsService ping", () => {
  const idle = { invoke: vi.fn().mockResolvedValue({}) };
  const writeService = { buildTools: vi.fn().mockReturnValue([]) };
  const catalog = { getAccessibleTypes: vi.fn().mockReturnValue(["orders", "accounts", "judgements"]) };
  const configService = { get: vi.fn().mockReturnValue({ serverName: "studio" }) };

  const build = (contributions?: unknown[]) =>
    new McpGenericToolsService(
      idle as any,
      idle as any,
      idle as any,
      idle as any,
      idle as any,
      idle as any,
      writeService as any,
      catalog as any,
      configService as any,
      contributions as any,
    );

  beforeEach(() => vi.clearAllMocks());

  it("ping is read-only and merges status contributions", async () => {
    const corpus = { status: vi.fn().mockResolvedValue({ corpus: { sources: [{ source: "SNCASS", total: 3 }] } }) };
    const queues = { status: vi.fn().mockResolvedValue({ queues: { legalResearch: "ok" } }) };
    const tool = build([corpus, queues])
      .build(ctx)
      .find((t) => t.name === "ping")!;

    expect(tool.readOnly).toBe(true);
    expect(tool.gateFree).toBe(true);

    const out = await tool.execute({}, ctx);
    expect(out.isError).toBeUndefined();
    const reply = JSON.parse(out.content[0].text);
    const { version } = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "package.json"), "utf8"));
    expect(reply).toEqual({
      server: "studio",
      version,
      now: expect.any(String),
      user: { userId: "u1", companyId: "c1" },
      catalog: { types: 3 },
      corpus: { sources: [{ source: "SNCASS", total: 3 }] },
      queues: { legalResearch: "ok" },
    });
    expect(new Date(reply.now).toISOString()).toBe(reply.now);
    expect(catalog.getAccessibleTypes).toHaveBeenCalledWith(["mod-orders"]);
    expect(corpus.status).toHaveBeenCalledWith(ctx);
    expect(queues.status).toHaveBeenCalledWith(ctx);
  });

  it("ping answers without status contributions", async () => {
    const tool = build(undefined)
      .build(ctx)
      .find((t) => t.name === "ping")!;
    const reply = JSON.parse((await tool.execute({}, ctx)).content[0].text);
    expect(Object.keys(reply).sort()).toEqual(["catalog", "now", "server", "user", "version"]);
  });
});

/**
 * The graph tools report a client error as a value, `{ error, ...extras }`.
 * Over MCP that value is a failed call: the client must see isError, never a
 * success payload carrying an error message.
 */
describe("McpGenericToolsService tool-level errors", () => {
  const searchTool = { invoke: vi.fn() };
  const describeTool = { invoke: vi.fn() };
  const idle = { invoke: vi.fn().mockResolvedValue({}) };
  const writeService = { buildTools: vi.fn().mockReturnValue([]) };

  const build = (resolveTool: unknown = idle) =>
    new McpGenericToolsService(
      resolveTool as any,
      describeTool as any,
      searchTool as any,
      idle as any,
      idle as any,
      idle as any,
      writeService as any,
      {} as any,
      {} as any,
    ).build(ctx);

  const payloadOf = (out: { content: Array<{ text?: string }> }) => JSON.parse(out.content[0].text as string);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps a tool-level filter error to validation_failed with isError", async () => {
    const message = 'Operator "lte" is not valid for field "name" on orders.';
    searchTool.invoke.mockResolvedValue({ error: message });
    const out = await build()
      .find((t) => t.name === "search_entities")!
      .execute({ type: "orders" }, ctx);
    expect(out.isError).toBe(true);
    expect(payloadOf(out)).toEqual({ code: "validation_failed", message });
  });

  it("maps an unknown type to unknown_type", async () => {
    const message = 'Entity type "ordes" is not available. Retry this call now with type "orders".';
    describeTool.invoke.mockResolvedValue({ error: message, suggestion: "orders" });
    const out = await build()
      .find((t) => t.name === "describe_entity")!
      .execute({ type: "ordes" }, ctx);
    expect(out.isError).toBe(true);
    expect(payloadOf(out)).toEqual({ code: "unknown_type", message, suggestion: "orders" });
  });

  it("maps a missing record to not_found", async () => {
    const message = "No orders with id o-missing.";
    idle.invoke.mockResolvedValueOnce({ error: message });
    const out = await build()
      .find((t) => t.name === "read_entity")!
      .execute({ type: "orders", id: "o-missing" }, ctx);
    expect(out.isError).toBe(true);
    expect(payloadOf(out)).toEqual({ code: "not_found", message });
  });

  it("maps an unregistered service to internal", async () => {
    const message = 'Service not available for "orders".';
    idle.invoke.mockResolvedValueOnce({ error: message });
    const out = await build()
      .find((t) => t.name === "read_entity")!
      .execute({ type: "orders", id: "o1" }, ctx);
    expect(out.isError).toBe(true);
    expect(payloadOf(out)).toEqual({ code: "internal", message });
  });

  it("keeps a normal result as success", async () => {
    searchTool.invoke.mockResolvedValue({ items: [{ id: "o1" }] });
    const out = await build()
      .find((t) => t.name === "search_entities")!
      .execute({ type: "orders" }, ctx);
    expect(out.isError).toBeUndefined();
    expect(payloadOf(out)).toEqual({ items: [{ id: "o1" }] });
  });

  it("keeps extras (schema) on the error payload", async () => {
    const schema = { type: "orders", fields: [{ name: "name" }], relationships: [] };
    searchTool.invoke.mockResolvedValue({ error: "You must call describe_entity first.", schema });
    const out = await build()
      .find((t) => t.name === "search_entities")!
      .execute({ type: "orders" }, ctx);
    expect(out.isError).toBe(true);
    expect(payloadOf(out)).toEqual({
      code: "validation_failed",
      message: "You must call describe_entity first.",
      schema,
    });
  });

  it("resolve_entity with an out-of-scope type is validation_failed", async () => {
    const message =
      'Type "articles" is not reachable in the current scope (proceedings). Types reachable here: [proceedings, laws].';
    const factory = { capture: (_record: unknown, fn: () => Promise<unknown>) => fn() };
    const search = { resolveEntity: vi.fn().mockRejectedValue(new BadRequestException(message)) };
    const out = await build(new ResolveEntityTool(factory as any, search as any))
      .find((t) => t.name === "resolve_entity")!
      .execute({ text: "Art. 2043", types: ["articles"] }, ctx);
    expect(out.isError).toBe(true);
    expect(payloadOf(out)).toEqual({ code: "validation_failed", message });
  });
});
