import { describe, expect, it, vi } from "vitest";

// Task 5/6 own these files; they may not exist on disk yet while tasks run in
// parallel. Mock them so only this task's modules are loaded for real.
vi.mock("../services/mcp.errors", () => ({
  mcpError: (e: unknown) => ({
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ code: "internal", message: e instanceof Error ? e.message : "Unexpected error" }),
      },
    ],
  }),
}));
vi.mock("../services/mcp.entity.write.service", () => ({ McpEntityWriteService: class McpEntityWriteService {} }));
vi.mock("../services/mcp.promoted.tools.factory", () => ({
  McpPromotedToolsFactory: class McpPromotedToolsFactory {},
}));

import { McpToolRegistry } from "../services/mcp.tool.registry";

const ctx = { userId: "u1", companyId: "c1", userModuleIds: ["mod-orders"] };

function makeGeneric(overrides = {}) {
  return {
    build: vi.fn().mockReturnValue([
      {
        name: "describe_entity",
        description: "d",
        inputSchema: { type: "object" },
        readOnly: true,
        execute: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] }),
      },
      { name: "create_entity", description: "c", inputSchema: { type: "object" }, readOnly: false, execute: vi.fn() },
    ]),
    ...overrides,
  };
}

describe("McpToolRegistry", () => {
  it("lists generic + promoted + contributed tools", () => {
    const promoted = {
      build: vi
        .fn()
        .mockReturnValue([
          { name: "search_orders", description: "s", inputSchema: {}, readOnly: true, execute: vi.fn() },
        ]),
    };
    const contributed = [
      {
        build: vi
          .fn()
          .mockReturnValue([
            { name: "custom_tool", description: "x", inputSchema: {}, readOnly: true, execute: vi.fn() },
          ]),
      },
    ];
    const registry = new McpToolRegistry(makeGeneric() as any, promoted as any, contributed as any);
    const tools = registry.build(ctx);
    expect(tools.map((t) => t.name)).toEqual(["describe_entity", "create_entity", "search_orders", "custom_tool"]);
  });

  it("throws on duplicate tool names", () => {
    const promoted = {
      build: vi
        .fn()
        .mockReturnValue([
          { name: "describe_entity", description: "dup", inputSchema: {}, readOnly: true, execute: vi.fn() },
        ]),
    };
    const registry = new McpToolRegistry(makeGeneric() as any, promoted as any, undefined);
    expect(() => registry.build(ctx)).toThrow(/duplicate/i);
  });

  it("call() routes to the named tool and returns its result", async () => {
    const registry = new McpToolRegistry(makeGeneric() as any, { build: () => [] } as any, undefined);
    const res = await registry.call("describe_entity", { type: "orders" }, ctx);
    expect(res.content[0].text).toBe("ok");
  });

  it("call() on unknown tool returns flat error payload", async () => {
    const registry = new McpToolRegistry(makeGeneric() as any, { build: () => [] } as any, undefined);
    const res = await registry.call("nope", {}, ctx);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).code).toBe("unknown_type");
  });
});
