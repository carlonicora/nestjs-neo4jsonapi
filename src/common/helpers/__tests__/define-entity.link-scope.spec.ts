import { afterEach, describe, expect, it } from "vitest";
import {
  entityTenancyRegistry,
  relatedNodeRule,
  relatedNodeRuleForLabel,
} from "../../registries/entity-tenancy.registry";
import { AiConnectionDescriptor } from "../../../foundations/ai-connection/entities/ai-connection";
import { CompanyDescriptor } from "../../../foundations/company/entities/company";
import { FeatureDescriptor } from "../../../foundations/feature/entities/feature";
import { HowToDescriptor } from "../../../foundations/how-to/entities/how-to";
import { RoleDescriptor } from "../../../foundations/role/entities/role";
import { UserDescriptor } from "../../../foundations/user/entities/user";
import { defineEntity } from "../define-entity";

const companyRel = {
  model: { type: "companies", endpoint: "companies", nodeName: "company", labelName: "Company" },
  direction: "out" as const,
  relationship: "BELONGS_TO",
  cardinality: "one" as const,
};

const base = {
  type: "dle-things",
  endpoint: "dle-things",
  nodeName: "dleThing",
  fields: { name: { type: "string" as const } },
};

describe("defineEntity — linkScope and the label tenancy registry", () => {
  afterEach(() => {
    for (const label of ["DleScoped", "DleVia", "DleViaShared", "DleGlobal", "DleShared", "DleTwice"]) {
      entityTenancyRegistry.unregister(label);
    }
  });

  it("registers a company-scoped label", () => {
    defineEntity<{ name: string }>()({ ...base, labelName: "DleScoped", relationships: {} });
    expect(relatedNodeRuleForLabel("DleScoped")).toEqual({ kind: "company" });
  });

  it("registers the resolved tenancy.via hop", () => {
    defineEntity<{ name: string }>()({
      ...base,
      labelName: "DleVia",
      isCompanyScoped: false,
      tenancy: { via: "company" },
      relationships: { company: companyRel },
    });
    expect(relatedNodeRuleForLabel("DleVia")).toEqual({
      kind: "via",
      hop: { relationship: "BELONGS_TO", direction: "out", label: "Company" },
    });
  });

  it("composes own-or-platform with tenancy { via }", () => {
    defineEntity<{ name: string }>()({
      ...base,
      labelName: "DleViaShared",
      isCompanyScoped: false,
      tenancy: { via: "company" },
      linkScope: "own-or-platform",
      relationships: { company: companyRel },
    });
    expect(relatedNodeRuleForLabel("DleViaShared")).toEqual({
      kind: "via",
      hop: { relationship: "BELONGS_TO", direction: "out", label: "Company" },
      allowPlatform: true,
    });
  });

  it("allows own-or-platform on a company-scoped descriptor", () => {
    const d = defineEntity<{ name: string }>()({
      ...base,
      labelName: "DleShared",
      linkScope: "own-or-platform",
      relationships: {},
    });
    expect(d.linkScope).toBe("own-or-platform");
    expect(relatedNodeRuleForLabel("DleShared")).toEqual({ kind: "company", allowPlatform: true });
  });

  it("global labels and unknown labels are existence-only", () => {
    defineEntity<{ name: string }>()({
      ...base,
      labelName: "DleGlobal",
      isCompanyScoped: false,
      tenancy: "global",
      relationships: {},
    });
    expect(relatedNodeRuleForLabel("DleGlobal")).toEqual({ kind: "exists" });
    expect(relatedNodeRuleForLabel("NeverDefinedLabel")).toEqual({ kind: "exists" });
  });

  it("refuses an unknown linkScope", () => {
    expect(() =>
      defineEntity<{ name: string }>()({
        ...base,
        labelName: "DleScoped",
        linkScope: "anything" as any,
        relationships: {},
      }),
    ).toThrow('linkScope must be "own-or-platform"');
  });

  it("refuses own-or-platform on a target that is already existence-only", () => {
    expect(() =>
      defineEntity<{ name: string }>()({
        ...base,
        labelName: "DleGlobal",
        isCompanyScoped: false,
        tenancy: "global",
        linkScope: "own-or-platform",
        relationships: {},
      }),
    ).toThrow('linkScope "own-or-platform" needs a company-scoped entity or tenancy { via }');
  });

  it("refuses a second descriptor that registers the same label with different tenancy", () => {
    defineEntity<{ name: string }>()({ ...base, labelName: "DleTwice", relationships: {} });
    expect(() =>
      defineEntity<{ name: string }>()({
        ...base,
        type: "dle-twice-portal",
        labelName: "DleTwice",
        isCompanyScoped: false,
        relationships: {},
      }),
    ).toThrow('label "DleTwice" is registered by "dle-things" and "dle-twice-portal" with different tenancy');
    expect(relatedNodeRuleForLabel("DleTwice")).toEqual({ kind: "company" });
  });

  it("accepts a second descriptor of the same label with the same tenancy", () => {
    defineEntity<{ name: string }>()({ ...base, labelName: "DleTwice", relationships: {} });
    defineEntity<{ name: string }>()({ ...base, type: "dle-twice-copy", labelName: "DleTwice", relationships: {} });
    expect(relatedNodeRuleForLabel("DleTwice")).toEqual({ kind: "company" });
  });

  it("a projection never sets the label's rule, whichever loads first", () => {
    const projection = {
      ...base,
      type: "dle-twice-portal",
      labelName: "DleTwice",
      isCompanyScoped: false,
      isProjection: true,
      relationships: {},
    };
    defineEntity<{ name: string }>()(projection);
    expect(relatedNodeRuleForLabel("DleTwice")).toEqual({ kind: "exists" });
    defineEntity<{ name: string }>()({ ...base, labelName: "DleTwice", relationships: {} });
    defineEntity<{ name: string }>()(projection);
    expect(relatedNodeRuleForLabel("DleTwice")).toEqual({ kind: "company" });
  });

  it("relatedNodeRule: crossCompany and contextKey relationships are existence-only", () => {
    defineEntity<{ name: string }>()({ ...base, labelName: "DleScoped", relationships: {} });
    const model = { type: "x", endpoint: "x", nodeName: "x", labelName: "DleScoped" };
    expect(relatedNodeRule({ model, direction: "out", relationship: "R", cardinality: "one" })).toEqual({
      kind: "company",
    });
    expect(
      relatedNodeRule({ model, direction: "out", relationship: "R", cardinality: "one", crossCompany: true }),
    ).toEqual({ kind: "exists" });
    expect(
      relatedNodeRule({ model, direction: "out", relationship: "R", cardinality: "one", contextKey: "userId" }),
    ).toEqual({ kind: "exists" });
  });
});

describe("library descriptors tagged for the related-company check", () => {
  it("Role is own-or-platform: platform roles carry no company edge", () => {
    expect(RoleDescriptor.linkScope).toBe("own-or-platform");
    expect(relatedNodeRuleForLabel("Role")).toEqual({ kind: "company", allowPlatform: true });
  });

  it("AiConnection.company is crossCompany: an administrator configures any company's chain", () => {
    expect(AiConnectionDescriptor.relationships.company.crossCompany).toBe(true);
    expect(relatedNodeRule(AiConnectionDescriptor.relationships.company)).toEqual({ kind: "exists" });
  });

  it("User is company-scoped (membership), Company is self, Feature and HowTo are global", () => {
    expect(UserDescriptor.isCompanyScoped).toBe(true);
    expect(relatedNodeRuleForLabel("User")).toEqual({ kind: "company" });
    expect(CompanyDescriptor.tenancy).toBe("self");
    expect(relatedNodeRuleForLabel("Company")).toEqual({ kind: "self" });
    expect(FeatureDescriptor.tenancy).toBe("global");
    expect(relatedNodeRuleForLabel("Feature")).toEqual({ kind: "exists" });
    expect(HowToDescriptor.tenancy).toBe("global");
    expect(relatedNodeRuleForLabel("HowTo")).toEqual({ kind: "exists" });
  });

  it("plain-model labels without a descriptor stay existence-only", () => {
    for (const label of ["Module", "StripePrice", "OAuthClient"]) {
      expect(relatedNodeRuleForLabel(label)).toEqual({ kind: "exists" });
    }
  });
});
