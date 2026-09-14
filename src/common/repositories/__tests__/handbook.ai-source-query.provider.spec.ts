import { describe, expect, it, vi } from "vitest";
import { HandbookAiSourceQueryProvider } from "../handbook.ai-source-query.provider";

function makeInner() {
  return { build: vi.fn(() => ({ cypher: "INNER", params: { inner: true } })) };
}

describe("HandbookAiSourceQueryProvider", () => {
  it("delegates every non-handbook turn untouched", () => {
    const inner = makeInner();
    const provider = new HandbookAiSourceQueryProvider(inner as any);

    const result = provider.build({ dataLimits: { proceedingId: "p1" } as any, returnsData: true });

    expect(inner.build).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ cypher: "INNER", params: { inner: true } });
  });

  it("scopes handbook mode to the HandbookPage label and never calls the inner provider", () => {
    const inner = makeInner();
    const provider = new HandbookAiSourceQueryProvider(inner as any);

    const result = provider.build({ dataLimits: { handbookMode: true }, returnsData: true });

    expect(inner.build).not.toHaveBeenCalled();
    expect(result.cypher).toContain("MATCH (data:HandbookPage)");
    expect(result.cypher).toContain("WITH data");
    expect(result.cypher).not.toContain("BELONGS_TO");
  });

  it("returns key concepts when asked for them", () => {
    const provider = new HandbookAiSourceQueryProvider(makeInner() as any);
    const result = provider.build({ dataLimits: { handbookMode: true }, returnsKeyConcepts: true });
    expect(result.cypher).toContain("WITH keyconcept");
  });

  it("binds a single-page limit instead of interpolating it", () => {
    const provider = new HandbookAiSourceQueryProvider(makeInner() as any);

    const result = provider.build({
      dataLimits: { limitToHandbookPageId: "page-1" },
      returnsData: true,
    });

    expect(result.cypher).toContain("WHERE data.id = $limitToHandbookPageId");
    expect(result.cypher).not.toContain("page-1");
    expect(result.params).toEqual({ limitToHandbookPageId: "page-1" });
  });
});
