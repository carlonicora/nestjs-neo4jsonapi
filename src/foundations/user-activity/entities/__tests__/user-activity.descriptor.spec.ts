import { describe, expect, it } from "vitest";
import { UserActivityDescriptor } from "../user-activity";
import { userActivityMeta } from "../user-activity.meta";

/**
 * Descriptor parity: ported from the a360ai local module's
 * `user-activity.parity.spec.ts`. These pins are the wire contract the
 * wholesale move into the library must not disturb.
 */
describe("user-activity descriptor parity", () => {
  it("keeps the meta byte-identical", () => {
    expect(userActivityMeta).toEqual({
      type: "user-activities",
      endpoint: "user-activities",
      nodeName: "userActivity",
      labelName: "UserActivity",
    });
  });

  it("keeps the old JSON:API attribute surface", () => {
    const serialised = Object.entries(UserActivityDescriptor.fields)
      .filter(([, def]: [string, any]) => !def.excludeFromJsonApi && !def.meta)
      .map(([name]) => name)
      .sort();
    // From the old UserActivitySerialiser.create() attributes:
    // { category, action, entityType, entityId, metadata }
    expect(serialised).toEqual(["action", "category", "entityId", "entityType", "metadata"]);
  });

  it("keeps the old meta surface (empty — the old serialiser never set this.meta)", () => {
    const meta = Object.entries(UserActivityDescriptor.fields)
      .filter(([, def]: [string, any]) => def.meta)
      .map(([name]) => name)
      .sort();
    expect(meta).toEqual([]);
  });

  it("keeps the old relationship surface", () => {
    // Old UserActivityModel had singleChildrenTokens: [] and the old
    // UserActivitySerialiser set relationships: {} — no JSON:API relationship
    // was ever exposed, even though the real graph has
    // (User)-[:PERFORMED]->(UserActivity)-[:BELONGS_TO]->(Company).
    expect(Object.keys(UserActivityDescriptor.relationships).sort()).toEqual([]);
  });

  it("keeps category and action required", () => {
    expect((UserActivityDescriptor.fields as any).category.required).toBe(true);
    expect((UserActivityDescriptor.fields as any).action.required).toBe(true);
    expect((UserActivityDescriptor.fields as any).entityType.required).toBeFalsy();
    expect((UserActivityDescriptor.fields as any).entityId.required).toBeFalsy();
    expect((UserActivityDescriptor.fields as any).metadata.type).toBe("json");
  });

  it("reproduces the old mapUserActivity()/safeParseJson() metadata round-trip", () => {
    const compute = UserActivityDescriptor.computed?.metadata?.compute;
    expect(compute).toBeTypeOf("function");

    // Stored as a JSON string on the node (see UserActivityRepository.createActivity()).
    expect(
      compute!({ data: { metadata: '{"method":"POST","path":"/proceedings"}' }, record: {}, entityFactory: {} } as any),
    ).toEqual({
      method: "POST",
      path: "/proceedings",
    });

    // Old safeParseJson() swallowed parse errors and returned undefined.
    expect(compute!({ data: { metadata: "not-json" }, record: {}, entityFactory: {} } as any)).toBeUndefined();

    // No metadata recorded.
    expect(compute!({ data: { metadata: null }, record: {}, entityFactory: {} } as any)).toBeUndefined();
    expect(compute!({ data: {}, record: {}, entityFactory: {} } as any)).toBeUndefined();
  });

  it("has a catalog-visible description on the entity and every field", () => {
    expect(typeof UserActivityDescriptor.description).toBe("string");
    expect(UserActivityDescriptor.description!.length).toBeGreaterThan(0);
    for (const [name, def] of Object.entries(UserActivityDescriptor.fields) as [string, any][]) {
      expect(typeof def.description, `field "${name}" is missing a description`).toBe("string");
      expect(def.description.length, `field "${name}" description is empty`).toBeGreaterThan(0);
    }
  });
});
