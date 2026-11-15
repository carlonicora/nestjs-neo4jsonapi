import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { CompanyDescriptor } from "../company";

describe("CompanyDescriptor wire surface", () => {
  it("is the tenant root and therefore NOT company-scoped", () => {
    // Without the explicit flag `defineEntity` defaults to `true` and injects a
    // meaningless (company)-[:BELONGS_TO]->(company) self-join into every query.
    expect(CompanyDescriptor.isCompanyScoped).toBe(false);
  });

  it("never serialises ownerEmail", () => {
    // Security fix: the owning account's email must not leak to every company reader.
    expect(CompanyDescriptor.fields.ownerEmail?.excludeFromJsonApi).toBe(true);
  });

  it("KEEPS isActiveSubscription on the wire", () => {
    // CONTRACT — do not "fix" this by excluding it. Sibling applications
    // (neural-erp, phlow) read this attribute off the wire to drive their
    // subscription banner (CommonSidebar.tsx). Applications that do not want it on
    // their own wire exclude it in their extension descriptor instead.
    expect(CompanyDescriptor.fields.isActiveSubscription?.excludeFromJsonApi).toBeUndefined();
  });

  it("keeps the JSON:API type, endpoint and Neo4j label", () => {
    expect(CompanyDescriptor.model.type).toBe("companies");
    expect(CompanyDescriptor.model.endpoint).toBe("companies");
    expect(CompanyDescriptor.model.nodeName).toBe("company");
    expect(CompanyDescriptor.model.labelName).toBe("Company");
  });

  it("keeps the feature and module relationship keys", () => {
    expect(Object.keys(CompanyDescriptor.relationships).sort()).toEqual(["feature", "module"]);
    expect(CompanyDescriptor.relationships.feature.dtoKey).toBe("features");
    expect(CompanyDescriptor.relationships.feature.relationship).toBe("HAS_FEATURE");
    expect(CompanyDescriptor.relationships.module.dtoKey).toBe("modules");
    expect(CompanyDescriptor.relationships.module.relationship).toBe("HAS_MODULE");
  });

  it("declares the credit-warning fields", () => {
    expect(CompanyDescriptor.fields.creditWarningSentAt?.type).toBe("datetime");
    expect(CompanyDescriptor.fields.creditWarningDismissedAt?.type).toBe("datetime");
    expect(CompanyDescriptor.fields.creditsGrantedThisPeriod?.type).toBe("number");
    expect(CompanyDescriptor.fields.creditWarningOffer?.type).toBe("string");
  });

  it("declares trialEndsAt as a datetime", () => {
    expect(CompanyDescriptor.fields.trialEndsAt).toEqual({ type: "datetime" });
  });

  it("declares the four subscription virtual fields without a description", () => {
    const virtualFields = CompanyDescriptor.virtualFields ?? {};
    expect(Object.keys(virtualFields).sort()).toEqual([
      "subscriptionNextAt",
      "subscriptionPlan",
      "subscriptionPlanName",
      "subscriptionStatus",
    ]);
    for (const def of Object.values(virtualFields)) expect(def.description).toBeUndefined();
  });

  it("subscription virtual fields are undefined when the record lacks the columns", () => {
    const virtualFields = CompanyDescriptor.virtualFields ?? {};
    for (const def of Object.values(virtualFields)) {
      expect(def.compute({ data: {}, record: { has: () => false } } as any)).toBeUndefined();
    }
  });

  it("subscriptionNextAt converts a Neo4j datetime to ISO", () => {
    const value = neo4j.types.DateTime.fromStandardDate(new Date("2027-08-14T00:00:00.000Z"));
    const record = { has: (key: string) => key === "subscriptionNextAt", get: () => value };
    expect(CompanyDescriptor.virtualFields.subscriptionNextAt.compute({ data: {}, record } as any)).toBe(
      "2027-08-14T00:00:00.000Z",
    );
  });

  it("subscription virtual fields read their record column", () => {
    const columns: Record<string, any> = {
      subscriptionPlan: "other",
      subscriptionPlanName: "Pro",
      subscriptionStatus: "active",
    };
    const record = { has: (key: string) => key in columns, get: (key: string) => columns[key] };
    for (const [key, value] of Object.entries(columns)) {
      expect(CompanyDescriptor.virtualFields[key].compute({ data: {}, record } as any)).toBe(value);
    }
  });
});
