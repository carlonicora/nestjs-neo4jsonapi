import { ToolFactory, UserContext } from "../tool.factory";

describe("ToolFactory.resolveEntity", () => {
  const quotesDetail: any = {
    type: "quotes",
    moduleId: "11111111-1111-1111-1111-111111111111",
    description: "A quote",
    fields: [],
    relationships: [],
    nodeName: "quote",
    labelName: "Quote",
  };
  const ctx: UserContext = {
    companyId: "c",
    userId: "u",
    userModuleIds: ["11111111-1111-1111-1111-111111111111"],
  };

  function makeFactory(accessible: string[] = ["quotes", "work-orders"]) {
    const catalog: any = {
      getEntityDetail: vi.fn((t: string) => (t === "quotes" ? quotesDetail : null)),
      getAccessibleTypes: vi.fn(() => accessible),
    };
    return { factory: new ToolFactory(catalog, {} as any), catalog };
  }

  it('auto-corrects "Quote" to the quotes detail with no error', () => {
    const { factory } = makeFactory();
    const out = factory.resolveEntity("Quote", ctx);
    expect(out).toBe(quotesDetail);
    expect("error" in out).toBe(false);
  });

  it('auto-corrects "quote" to the quotes detail with no error', () => {
    const { factory } = makeFactory();
    const out = factory.resolveEntity("quote", ctx);
    expect(out).toBe(quotesDetail);
    expect("error" in out).toBe(false);
  });

  it("returns the imperative error + suggestion for a distance-2 input", () => {
    const { factory } = makeFactory();
    const out: any = factory.resolveEntity("quoste", ctx);
    expect(out.error).toBe('Entity type "quoste" is not available. Retry this call now with type "quotes".');
    expect(out.suggestion).toBe("quotes");
  });

  it("returns the plain unavailable error listing all types when nothing is close", () => {
    const { factory } = makeFactory();
    const out: any = factory.resolveEntity("zzzzzz", ctx);
    expect(out.error).toBe('Entity type "zzzzzz" is not available. The available types are: quotes, work-orders.');
    expect(out.suggestion).toBeUndefined();
  });
});
