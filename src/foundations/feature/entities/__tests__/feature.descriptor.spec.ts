import { describe, expect, it } from "vitest";
import { FeatureDescriptor } from "../feature";

describe("FeatureDescriptor wire surface", () => {
  it("keeps the JSON:API attribute set", () => {
    expect(Object.keys(FeatureDescriptor.fields).sort()).toEqual(["isCore", "name"]);
  });

  it("keeps the modules relationship key and direction", () => {
    expect(FeatureDescriptor.relationships.module.dtoKey).toBe("modules");
    expect(FeatureDescriptor.relationships.module.direction).toBe("in");
    expect(FeatureDescriptor.relationships.module.relationship).toBe("IN_FEATURE");
  });

  it("is a global entity", () => {
    expect(FeatureDescriptor.isCompanyScoped).toBe(false);
  });

  it("keeps the JSON:API type, endpoint and Neo4j label", () => {
    expect(FeatureDescriptor.model.type).toBe("features");
    expect(FeatureDescriptor.model.endpoint).toBe("features");
    expect(FeatureDescriptor.model.nodeName).toBe("feature");
    expect(FeatureDescriptor.model.labelName).toBe("Feature");
  });

  it("keeps the module children token used by the entity factory", () => {
    expect(FeatureDescriptor.model.childrenTokens).toEqual(["module"]);
  });
});
