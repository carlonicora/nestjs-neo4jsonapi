import { BadRequestException } from "@nestjs/common";
import { vi, describe, it, expect } from "vitest";
import { ResolveEntityTool } from "../resolve-entity.tool";
import { mcpError } from "../../../../mcp/services/mcp.errors";

function mkFactory(
  capture = vi.fn(async (_r, fn, rec) => {
    const v = await fn();
    rec.push({ tool: "resolve_entity", input: _r.input, durationMs: 0 });
    return v;
  }),
): any {
  return { capture };
}

describe("ResolveEntityTool", () => {
  const ctx = {
    companyId: "c",
    userId: "u",
    userModuleIds: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
  };

  it("passes text, companyId, userModules through to GraphSearchService.resolveEntity", async () => {
    const search: any = {
      resolveEntity: vi.fn().mockResolvedValue({
        matchMode: "exact",
        items: [{ type: "accounts", id: "a1", summary: "Acme", score: 9.0 }],
      }),
    };
    const tool = new ResolveEntityTool(mkFactory(), search);

    const out: any = await tool.invoke({ text: "Acme" }, ctx, []);

    expect(search.resolveEntity).toHaveBeenCalledWith({
      text: "Acme",
      companyId: "c",
      userModuleIds: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
    });
    expect(out).toEqual({
      matchMode: "exact",
      items: [{ type: "accounts", id: "a1", summary: "Acme", score: 9.0 }],
    });
  });

  it("returns service result unchanged on matchMode='none'", async () => {
    const search: any = {
      resolveEntity: vi.fn().mockResolvedValue({ matchMode: "none", items: [] }),
    };
    const tool = new ResolveEntityTool(mkFactory(), search);

    const out = await tool.invoke({ text: "nothing" }, ctx, []);
    expect(out).toEqual({ matchMode: "none", items: [] });
  });

  it("does NOT require describe_entity to have been called for any type (no gate)", async () => {
    const search: any = {
      resolveEntity: vi.fn().mockResolvedValue({ matchMode: "exact", items: [] }),
    };
    const tool = new ResolveEntityTool(mkFactory(), search);

    const out = await tool.invoke({ text: "x" }, ctx, []);
    expect(search.resolveEntity).toHaveBeenCalled();
    expect((out as any).error).toBeUndefined();
  });

  it("build() returns a DynamicStructuredTool named 'resolve_entity' with a { text } schema", async () => {
    const search: any = { resolveEntity: vi.fn().mockResolvedValue({ matchMode: "none", items: [] }) };
    const tool = new ResolveEntityTool(mkFactory(), search);
    const built: any = tool.build(ctx, []);
    expect(built.name).toBe("resolve_entity");

    const raw = await built.func({ text: "valid-text" });
    expect(typeof raw).toBe("string");
    expect(JSON.parse(raw)).toEqual({ matchMode: "none", items: [] });
  });

  it("records the tool call in the recorder via factory.capture", async () => {
    const recorder: any[] = [];
    const captureSpy = vi.fn(async (_r, fn, rec) => {
      const v = await fn();
      rec.push({ tool: "resolve_entity", input: _r.input, durationMs: 5 });
      return v;
    });
    const search: any = {
      resolveEntity: vi.fn().mockResolvedValue({ matchMode: "exact", items: [] }),
    };
    const tool = new ResolveEntityTool(mkFactory(captureSpy), search);

    await tool.invoke({ text: "q" }, ctx, recorder);
    expect(captureSpy).toHaveBeenCalled();
    expect(recorder).toHaveLength(1);
    expect(recorder[0]).toMatchObject({ tool: "resolve_entity", input: { text: "q" } });
  });
  it("passes types through to GraphSearchService.resolveEntity", async () => {
    const search: any = { resolveEntity: vi.fn().mockResolvedValue({ matchMode: "none", items: [] }) };
    const tool = new ResolveEntityTool(mkFactory(), search);
    await tool.invoke({ text: "Rossi", types: ["emails"] }, ctx, []);
    expect(search.resolveEntity).toHaveBeenCalledWith(expect.objectContaining({ text: "Rossi", types: ["emails"] }));
  });

  it("the input schema accepts an optional types array", () => {
    const tool = new ResolveEntityTool(mkFactory(), { resolveEntity: vi.fn() } as any);
    const built: any = tool.build(ctx, []);
    expect(built.schema.safeParse({ text: "x", types: ["accounts"] }).success).toBe(true);
    expect(built.schema.safeParse({ text: "x", types: "accounts" }).success).toBe(false);
  });

  it("rejects an unknown type name", async () => {
    const message = 'Unknown type "x". Visible types: [accounts, persons].';
    const search: any = { resolveEntity: vi.fn().mockRejectedValue(new BadRequestException(message)) };
    const tool = new ResolveEntityTool(mkFactory(), search);

    // MCP path: invoke throws, and the MCP error mapper makes it validation_failed.
    const thrown = await tool.invoke({ text: "Rossi", types: ["x"] }, ctx, []).catch((e) => e);
    const payload = JSON.parse(mcpError(thrown).content[0].text);
    expect(payload).toEqual({ code: "validation_failed", message });

    // LangGraph path: the model gets the message as a tool error to recover from.
    const raw = await (tool.build(ctx, []) as any).func({ text: "Rossi", types: ["x"] });
    expect(JSON.parse(raw as string)).toEqual({ error: message });
  });
});
