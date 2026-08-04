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
});
