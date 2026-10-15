import { describe, it, expect } from "vitest";
import { defineEntity } from "../define-entity";

const parentRel = {
  model: {
    type: "legal-researches",
    endpoint: "legal-researches",
    nodeName: "legalResearch",
    labelName: "LegalResearch",
  },
  direction: "in" as const,
  relationship: "HAS_MESSAGE",
  cardinality: "one" as const,
};

const base = {
  type: "messages",
  endpoint: "messages",
  nodeName: "message",
  labelName: "Message",
  fields: { content: { type: "string" as const } },
  relationships: { legalResearch: parentRel },
};

describe("defineEntity — tenancy", () => {
  it("throws on unscoped described entity without tenancy", () => {
    expect(() =>
      defineEntity<{ content: string }>()({ ...base, isCompanyScoped: false, description: "A message." }),
    ).toThrow(
      'defineEntity(messages): an unscoped described entity must declare "tenancy" ("global" | "self" | "internal" | { via: "<relationship key>" }).',
    );
  });

  it("throws when tenancy is set on a scoped entity", () => {
    expect(() =>
      defineEntity<{ content: string }>()({ ...base, description: "A message.", tenancy: "global" }),
    ).toThrow('defineEntity(messages): "tenancy" is only valid with isCompanyScoped: false.');
  });

  it("throws when via names an unknown relationship", () => {
    expect(() =>
      defineEntity<{ content: string }>()({
        ...base,
        isCompanyScoped: false,
        description: "A message.",
        tenancy: { via: "conversation" },
      }),
    ).toThrow('defineEntity(messages): tenancy.via "conversation" is not a relationship on this descriptor.');
  });

  it('accepts "global", "self", "internal" and { via } and exposes descriptor.tenancy', () => {
    for (const tenancy of ["global", "self", "internal", { via: "legalResearch" }] as const) {
      const descriptor = defineEntity<{ content: string }>()({
        ...base,
        isCompanyScoped: false,
        description: "A message.",
        tenancy,
      });
      expect(descriptor.tenancy).toEqual(tenancy);
    }
  });

  it("accepts an unscoped entity without description and without tenancy", () => {
    const descriptor = defineEntity<{ content: string }>()({ ...base, isCompanyScoped: false });
    expect(descriptor.tenancy).toBeUndefined();
  });
});
