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

  describe("bindRequestContext: false", () => {
    const unbound = { bindsRequestContext: false };
    const companyInner = () => ({
      build: vi.fn(() => ({ cypher: "MATCH (data)-[:BELONGS_TO]->(company)\n      WITH data", params: {} })),
    });

    it("refuses an inner fragment that uses the unbound company", () => {
      const provider = new HandbookAiSourceQueryProvider(companyInner() as any, unbound as any);
      expect(() => provider.build({ dataLimits: {} as any, returnsData: true })).toThrow(/bindRequestContext: false/);
    });

    it("refuses an inner fragment that uses the unbound currentUser", () => {
      const inner = { build: vi.fn(() => ({ cypher: "MATCH (data)<-[:OWNS]-(currentUser)", params: {} })) };
      const provider = new HandbookAiSourceQueryProvider(inner as any, unbound as any);
      expect(() => provider.build({ dataLimits: {} as any, returnsData: true })).toThrow(/bindRequestContext: false/);
    });

    it("lets a global fragment through", () => {
      const inner = { build: vi.fn(() => ({ cypher: "MATCH (data:HowTo)\n      WITH data", params: {} })) };
      const provider = new HandbookAiSourceQueryProvider(inner as any, unbound as any);
      expect(provider.build({ dataLimits: { howToMode: true } as any, returnsData: true }).cypher).toContain("HowTo");
    });

    it("still serves handbook mode", () => {
      const provider = new HandbookAiSourceQueryProvider(companyInner() as any, unbound as any);
      expect(provider.build({ dataLimits: { handbookMode: true }, returnsData: true }).cypher).toContain(
        "HandbookPage",
      );
    });

    it("keeps the company fragment when the request context is bound", () => {
      const provider = new HandbookAiSourceQueryProvider(companyInner() as any, { bindsRequestContext: true } as any);
      expect(provider.build({ dataLimits: {} as any, returnsData: true }).cypher).toContain("(company)");
    });
  });
});
