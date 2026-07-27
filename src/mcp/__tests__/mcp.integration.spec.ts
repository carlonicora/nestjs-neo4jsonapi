import { describe, it, expect, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServerFactory } from "../services/mcp.server.factory";

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
