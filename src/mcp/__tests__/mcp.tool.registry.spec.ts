import { HttpException } from "@nestjs/common";
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
  mcpFlatError: (code: string, message: string, meta: Record<string, unknown> = {}) => ({
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ code, message, ...meta }) }],
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

  describe("credit gate on call()", () => {
    const aiOff = () => ({ validateCredits: vi.fn(), isAiEnabled: vi.fn().mockResolvedValue(false) });

    it("call() returns ai_disabled when the interactive validator says AI is off", async () => {
      const generic = makeGeneric();
      const interactive = aiOff();
      const registry = new McpToolRegistry(generic as any, { build: () => [] } as any, undefined, interactive);
      const res = await registry.call("describe_entity", { type: "orders" }, ctx);
      expect(res.isError).toBe(true);
      expect(JSON.parse(res.content[0].text).code).toBe("ai_disabled");
      expect(interactive.isAiEnabled).toHaveBeenCalledWith({ companyId: "c1" });
      expect(interactive.validateCredits).not.toHaveBeenCalled();
      const tool = generic.build.mock.results[0].value[0];
      expect(tool.execute).not.toHaveBeenCalled();
    });

    it("call() returns no_credits on 402", async () => {
      const generic = makeGeneric();
      const interactive = {
        validateCredits: vi.fn().mockRejectedValue(new HttpException("NO_CREDITS", 402)),
        isAiEnabled: vi.fn().mockResolvedValue(true),
      };
      const registry = new McpToolRegistry(generic as any, { build: () => [] } as any, undefined, interactive);
      const res = await registry.call("describe_entity", { type: "orders" }, ctx);
      expect(res.isError).toBe(true);
      expect(JSON.parse(res.content[0].text).code).toBe("no_credits");
      const tool = generic.build.mock.results[0].value[0];
      expect(tool.execute).not.toHaveBeenCalled();
    });

    it("call() falls back to CREDIT_VALIDATOR when the interactive token is unbound", async () => {
      const base = aiOff();
      const registry = new McpToolRegistry(
        makeGeneric() as any,
        { build: () => [] } as any,
        undefined,
        undefined,
        base,
      );
      const res = await registry.call("describe_entity", { type: "orders" }, ctx);
      expect(JSON.parse(res.content[0].text).code).toBe("ai_disabled");
    });

    it("call() prefers the interactive validator over CREDIT_VALIDATOR", async () => {
      const interactive = { validateCredits: vi.fn(), isAiEnabled: vi.fn().mockResolvedValue(true) };
      const base = aiOff();
      const registry = new McpToolRegistry(
        makeGeneric() as any,
        { build: () => [] } as any,
        undefined,
        interactive,
        base,
      );
      const res = await registry.call("describe_entity", { type: "orders" }, ctx);
      expect(res.content[0].text).toBe("ok");
      expect(base.isAiEnabled).not.toHaveBeenCalled();
    });

    it("call() with no validator bound executes the tool", async () => {
      const registry = new McpToolRegistry(
        makeGeneric() as any,
        { build: () => [] } as any,
        undefined,
        undefined,
        undefined,
      );
      const res = await registry.call("describe_entity", { type: "orders" }, ctx);
      expect(res.isError).toBeUndefined();
      expect(res.content[0].text).toBe("ok");
    });

    it("build() is never gated", () => {
      const interactive = aiOff();
      const gated = new McpToolRegistry(makeGeneric() as any, { build: () => [] } as any, undefined, interactive);
      const ungated = new McpToolRegistry(makeGeneric() as any, { build: () => [] } as any, undefined);
      expect(gated.build(ctx).length).toBe(ungated.build(ctx).length);
      expect(interactive.isAiEnabled).not.toHaveBeenCalled();
    });

    it("call() propagates a non-402 validator error", async () => {
      const interactive = {
        validateCredits: vi.fn().mockRejectedValue(new Error("neo4j down")),
        isAiEnabled: vi.fn().mockResolvedValue(true),
      };
      const registry = new McpToolRegistry(makeGeneric() as any, { build: () => [] } as any, undefined, interactive);
      await expect(registry.call("describe_entity", { type: "orders" }, ctx)).rejects.toThrow("neo4j down");
    });
  });
});
