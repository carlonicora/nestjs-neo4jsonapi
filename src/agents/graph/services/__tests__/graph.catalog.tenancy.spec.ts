import { describe, it, expect } from "vitest";
import { GraphCatalogService } from "../graph.catalog.service";

function descriptor(opts: Partial<any>): any {
  return {
    model: { type: opts.type, nodeName: opts.type, labelName: opts.type },
    description: opts.description,
    moduleId: opts.moduleId ?? "11111111-1111-1111-1111-111111111111",
    isCompanyScoped: opts.isCompanyScoped ?? true,
    tenancy: opts.tenancy,
    fields: opts.fields ?? { name: { type: "string", description: "Display name." } },
    relationships: opts.relationships ?? {},
    chat: opts.chat,
  };
}

const researchRel = {
  model: { type: "legal-researches", nodeName: "legalResearch", labelName: "LegalResearch" },
  direction: "in",
  relationship: "HAS_MESSAGE",
  cardinality: "one",
};

const build = (entries: any[]) => {
  const svc = new GraphCatalogService({ loadAll: () => entries } as any);
  svc.buildCatalog();
  return svc;
};

describe("GraphCatalogService — tenancy", () => {
  it("skips internal types", () => {
    const svc = build([
      descriptor({ type: "auths", description: "Auth tokens.", isCompanyScoped: false, tenancy: "internal" }),
      descriptor({ type: "laws", description: "Laws.", isCompanyScoped: false, tenancy: "global" }),
    ]);
    expect(svc.hasType("auths")).toBe(false);
    expect(svc.hasType("laws")).toBe(true);
  });

  it("throws on an unscoped described type without tenancy", () => {
    expect(() =>
      build([descriptor({ type: "activities", description: "Activities.", isCompanyScoped: false })]),
    ).toThrow(/activities.*"global" \| "self" \| "internal" \| \{ via: "<relationship key>" \}/);
  });

  it("rejects via to an unscoped target", () => {
    expect(() =>
      build([
        descriptor({
          type: "messages",
          description: "Messages.",
          isCompanyScoped: false,
          tenancy: { via: "legalResearch" },
          relationships: { legalResearch: researchRel },
        }),
        descriptor({ type: "legal-researches", isCompanyScoped: false }),
      ]),
    ).toThrow('tenancy.via "legalResearch" on messages points at legal-researches, which is not company-scoped');
  });

  it("rejects via to a target that is not registered", () => {
    expect(() =>
      build([
        descriptor({
          type: "messages",
          description: "Messages.",
          isCompanyScoped: false,
          tenancy: { via: "legalResearch" },
          relationships: { legalResearch: researchRel },
        }),
      ]),
    ).toThrow(/tenancy\.via "legalResearch" on messages points at legal-researches/);
  });

  it("accepts via to a scoped target", () => {
    const svc = build([
      descriptor({
        type: "messages",
        description: "Messages.",
        isCompanyScoped: false,
        tenancy: { via: "legalResearch" },
        relationships: { legalResearch: researchRel },
      }),
      descriptor({ type: "legal-researches", description: "Researches.", isCompanyScoped: true }),
    ]);
    expect(svc.hasType("messages")).toBe(true);
  });

  it("accepts via to a self-tenancy target", () => {
    const companyRel = {
      model: { type: "companies", nodeName: "company", labelName: "Company" },
      direction: "in",
      relationship: "HAS_INVITATION",
      cardinality: "one",
    };
    const invitation = descriptor({
      type: "invitations",
      description: "Invitations.",
      isCompanyScoped: false,
      tenancy: { via: "company" },
      relationships: { company: companyRel },
    });
    const svc = build([invitation, descriptor({ type: "companies", isCompanyScoped: false, tenancy: "self" })]);
    expect(svc.hasType("invitations")).toBe(true);

    for (const tenancy of ["global", "internal", { via: "x" }, undefined]) {
      expect(() => build([invitation, descriptor({ type: "companies", isCompanyScoped: false, tenancy })])).toThrow(
        'tenancy.via "company" on invitations points at companies, which is not company-scoped',
      );
    }
  });

  it("accepts self and keeps undescribed unscoped types out without complaint", () => {
    const svc = build([
      descriptor({ type: "companies", description: "The studio.", isCompanyScoped: false, tenancy: "self" }),
      descriptor({ type: "pending-auths", isCompanyScoped: false }),
    ]);
    expect(svc.hasType("companies")).toBe(true);
    expect(svc.hasType("pending-auths")).toBe(false);
  });
});
