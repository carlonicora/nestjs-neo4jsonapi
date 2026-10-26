import { describe, it, expect, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServerFactory } from "../services/mcp.server.factory";
import { McpController } from "../controllers/mcp.controller";
import { McpEntityWriteService } from "../services/mcp.entity.write.service";
import { McpGenericToolsService } from "../services/mcp.generic.tools.service";
import { McpToolRegistry } from "../services/mcp.tool.registry";

const ctx = { userId: "u1", companyId: "c1", userModuleIds: ["mod-orders"] };

describe("MCP server (in-memory transport)", () => {
  let factory: McpServerFactory;
  const registry = {
    build: vi.fn().mockReturnValue([
      {
        name: "describe_entity",
        description: "Describe",
        inputSchema: { type: "object", properties: { type: { type: "string" } } },
        readOnly: true,
        execute: vi.fn(),
      },
      {
        name: "create_entity",
        description: "Create",
        inputSchema: { type: "object" },
        readOnly: false,
        execute: vi.fn(),
      },
    ]),
    call: vi.fn().mockResolvedValue({ content: [{ type: "text", text: '{"ok":true}' }] }),
  };

  beforeEach(() => {
    factory = new McpServerFactory(
      { get: vi.fn().mockReturnValue({ serverName: "neural-erp", instructions: "Describe first." }) } as any,
      registry as any,
    );
  });

  async function connect() {
    const server = factory.create(ctx);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    return client;
  }

  it("lists tools with readOnlyHint annotations", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["describe_entity", "create_entity"]);
    expect(tools[0].annotations?.readOnlyHint).toBe(true);
    expect(tools[1].annotations?.readOnlyHint).toBe(false);
  });

  it("routes tools/call through the registry with ctx", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "describe_entity", arguments: { type: "orders" } });
    expect(registry.call).toHaveBeenCalledWith("describe_entity", { type: "orders" }, ctx);
    expect((res.content as any)[0].text).toBe('{"ok":true}');
  });
});

describe("McpController module visibility", () => {
  it("resolves the user's modules within the token's company only", async () => {
    const stop = new Error("stop after ctx");
    const factory = {
      create: vi.fn(() => {
        throw stop;
      }),
    };
    const cls = { get: vi.fn((key: string) => (key === "userId" ? "u1" : key === "companyId" ? "c1" : undefined)) };
    const userModules = { findModuleIdsForUser: vi.fn(async () => ["mod-orders"]) };
    const configService = { get: vi.fn().mockReturnValue({ enabled: true }) };
    const controller = new McpController(factory as any, cls as any, userModules as any, configService as any);

    await expect(controller.handle({} as any, {} as any)).rejects.toBe(stop);
    expect(userModules.findModuleIdsForUser).toHaveBeenCalledWith("u1", "c1");
    expect(factory.create).toHaveBeenCalledWith(ctx);
  });
});

/**
 * LM-85 over the wire: the real generic tool set behind the real registry and
 * server. tools/list carries the generic write tools only when the user's
 * catalog has a chat.writable type; readOnlyHint is unchanged.
 */
describe("MCP server write tool gating (tools/list)", () => {
  const WRITE_TOOLS = ["create_entity", "update_entity", "add_relationship", "remove_relationship"];
  const idle = { invoke: vi.fn().mockResolvedValue({}) };

  async function listFor(entities: Array<Record<string, unknown>>) {
    const catalog = {
      getAccessibleTypes: vi.fn((moduleIds: string[]) =>
        entities.filter((e) => moduleIds.includes(e.moduleId as string)).map((e) => e.type as string),
      ),
      getEntityDetail: vi.fn(
        (type: string, moduleIds: string[]) =>
          entities.find((e) => e.type === type && moduleIds.includes(e.moduleId as string)) ?? null,
      ),
    };
    const writeService = new McpEntityWriteService({ get: vi.fn() } as any, catalog as any, { can: vi.fn() } as any);
    const generic = new McpGenericToolsService(
      idle as any,
      idle as any,
      idle as any,
      idle as any,
      idle as any,
      idle as any,
      writeService,
      catalog as any,
      {} as any,
    );
    const registry = new McpToolRegistry(generic, { build: () => [] } as any);
    const factory = new McpServerFactory(
      { get: vi.fn().mockReturnValue({ serverName: "studio", instructions: "Read access." }) } as any,
      registry,
    );
    const server = factory.create(ctx);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    return (await client.listTools()).tools;
  }

  it("lists no generic write tool when no type is chat.writable", async () => {
    const tools = await listFor([{ type: "judgements", moduleId: "mod-orders", fields: [], relationships: [] }]);
    const names = tools.map((t) => t.name);
    for (const name of WRITE_TOOLS) expect(names).not.toContain(name);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("lists the four write tools with readOnlyHint false when a type is chat.writable", async () => {
    const tools = await listFor([
      { type: "judgements", moduleId: "mod-orders", fields: [], relationships: [] },
      { type: "orders", moduleId: "mod-orders", writable: true, fields: [], relationships: [] },
    ]);
    for (const name of WRITE_TOOLS) {
      expect(tools.find((t) => t.name === name)?.annotations?.readOnlyHint).toBe(false);
    }
    expect(tools.find((t) => t.name === "search_entities")?.annotations?.readOnlyHint).toBe(true);
  });
});
