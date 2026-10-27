import { describe, expect, it, vi } from "vitest";
import { ExternalSourceUnavailableError } from "../../../../common/interfaces/external.entity.source.interface";
import { mcpError, mcpToolResult } from "../../../../mcp/services/mcp.errors";
import { ReadEntityTool } from "../read-entity.tool";
import { ToolCallRecord, ToolFactory } from "../tool.factory";

/**
 * An external source (e.g. a corpus over HTTP) that did not answer must reach
 * the caller as its own status, never as "not found", and never as a throw:
 * the in-app assistant calls the same tools and must keep running.
 */
describe("external source unavailable", () => {
  const massime = {
    type: "massime",
    moduleId: "m",
    description: "A massima.",
    fields: [{ name: "content", type: "string" }],
    nodeName: "massima",
    labelName: "Massima",
    relationships: [
      {
        name: "judgement",
        targetType: "judgements",
        cardinality: "one",
        description: "j",
        cypherDirection: "in",
        cypherLabel: "HAS_MASSIMA",
        isReverse: false,
        sourceType: "massime",
      },
    ],
  };
  const ctx = { companyId: "c", userId: "u", userModuleIds: ["m"] };
  const formatter: any = {
    build: ({ entity, record }: any) => {
      const fields: Record<string, unknown> = {};
      for (const f of entity.fields) fields[f.name] = record[f.name];
      return { fields };
    },
  };
  const outage = () =>
    new ExternalSourceUnavailableError({
      message:
        "Il corpus non è al momento raggiungibile: impossibile stabilire se il record esiste. Riprovare più tardi.",
      code: "corpus_unavailable",
      cause: new TypeError("fetch failed"),
    });

  function setup(svc: Record<string, unknown>) {
    const factory = new ToolFactory({} as any, {} as any);
    vi.spyOn(factory, "resolveEntity").mockReturnValue(massime as any);
    vi.spyOn(factory, "resolveService").mockReturnValue(svc as any);
    const tool = new ReadEntityTool(factory, {} as any, {} as any, undefined as any, formatter);
    const recorder: ToolCallRecord[] = [{ tool: "describe_entity", input: { type: "massime" }, durationMs: 0 }];
    return { tool, recorder };
  }

  const payload = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0].text);

  it("read_entity: a source that did not answer resolves to corpus_unavailable, not not_found, and does not throw", async () => {
    const { tool, recorder } = setup({ findRecordById: vi.fn().mockRejectedValue(outage()) });

    const out = await tool.invoke({ type: "massime", id: "m1" }, ctx, recorder);

    expect(out).toEqual({
      error:
        "Il corpus non è al momento raggiungibile: impossibile stabilire se il record esiste. Riprovare più tardi.",
      code: "corpus_unavailable",
      retryable: true,
    });
    const mcp = mcpToolResult(out);
    expect(mcp.isError).toBe(true);
    expect(payload(mcp as any)).toMatchObject({ code: "corpus_unavailable", retryable: true });
    expect(payload(mcp as any).code).not.toBe("not_found");
  });

  it("read_entity: a record the healthy source does not hold stays not_found", async () => {
    const { tool, recorder } = setup({ findRecordById: vi.fn().mockResolvedValue(null) });

    const out = await tool.invoke({ type: "massime", id: "m1" }, ctx, recorder);

    expect(out).toEqual({ error: "No massime with id m1." });
    expect(payload(mcpToolResult(out) as any)).toMatchObject({ code: "not_found" });
  });

  it("read_entity: a healthy read returns the record", async () => {
    const { tool, recorder } = setup({ findRecordById: vi.fn().mockResolvedValue({ id: "m1", content: "Massima." }) });

    const out = await tool.invoke({ type: "massime", id: "m1" }, ctx, recorder);

    expect(out).toMatchObject({ id: "m1", type: "massime", fields: { content: "Massima." } });
    expect(mcpToolResult(out).isError).toBeUndefined();
  });

  it("read_entity include: an unavailable target fails that relationship only", async () => {
    const { tool, recorder } = setup({
      findRecordById: vi.fn().mockResolvedValue({ id: "m1", content: "Massima." }),
      findRelatedRecordsByEdge: vi.fn().mockRejectedValue(outage()),
    });

    const out: any = await tool.invoke({ type: "massime", id: "m1", include: ["judgement"] }, ctx, recorder);

    expect(out.fields).toEqual({ content: "Massima." });
    expect(out.related.judgement).toMatchObject({ code: "corpus_unavailable", retryable: true });
  });

  it("capture still rethrows every other error", async () => {
    const factory = new ToolFactory({} as any, {} as any);
    await expect(
      factory.capture({ tool: "read_entity", input: {} }, () => Promise.reject(new Error("boom")), []),
    ).rejects.toThrow("boom");
  });

  it("mcpError maps a thrown ExternalSourceUnavailableError to its code", () => {
    const result = mcpError(outage());
    expect(result.isError).toBe(true);
    expect(payload(result as any)).toMatchObject({ code: "corpus_unavailable", retryable: true });
  });
});
