import { describe, expect, it } from "vitest";
import { SkillDescriptor } from "../skill";
import { skillMeta } from "../skill.meta";

describe("SkillDescriptor", () => {
  it("mixes platform rows and company rows (decision P1)", () => {
    expect(SkillDescriptor.isCompanyScoped).toBe(false);
    expect(SkillDescriptor.tenancy).toEqual({ via: "company" });
    expect(SkillDescriptor.linkScope).toBe("own-or-platform");
  });

  it("stays out of the Assistant's graph catalog", () => {
    expect(SkillDescriptor.description).toBeUndefined();
  });

  it("spreads the meta", () => {
    expect(skillMeta).toEqual({ type: "skills", endpoint: "skills", nodeName: "skill", labelName: "Skill" });
    expect(SkillDescriptor.model.type).toBe("skills");
    expect(SkillDescriptor.model.labelName).toBe("Skill");
  });

  it("declares the stored fields", () => {
    const fields = SkillDescriptor.fields as Record<string, any>;
    expect(fields.name).toMatchObject({ type: "string", required: true, sortable: true });
    expect(fields.description).toMatchObject({ type: "string", required: true });
    expect(fields.instructions).toMatchObject({ type: "string", required: true, excludeFromSearch: true });
    expect(fields.isActive).toMatchObject({ type: "boolean" });
    expect(fields.isGlobal).toMatchObject({ type: "boolean", immutable: true });
  });

  it("emits the per-caller states as attributes computed from the query", () => {
    const fields = SkillDescriptor.fields as Record<string, any>;
    const computed = SkillDescriptor.computed as Record<string, any>;
    for (const name of ["origin", "isEnabled", "isHidden", "canRestore"]) {
      expect(fields[name]).toBeDefined();
      expect(computed[name]).toBeDefined();
    }
    expect(fields.origin.excludeFromSearch).toBe(true);
  });

  it("reads each computed state from its query column, falling back to the data", () => {
    const computed = SkillDescriptor.computed as Record<string, any>;
    const columns: Record<string, unknown> = {
      skillOrigin: "copy",
      skillIsEnabled: true,
      skillIsHidden: false,
      skillCanRestore: true,
    };
    const record = { has: (k: string) => k in columns, get: (k: string) => columns[k] };
    expect(computed.origin.compute({ data: {}, record })).toBe("copy");
    expect(computed.isEnabled.compute({ data: {}, record })).toBe(true);
    expect(computed.isHidden.compute({ data: {}, record })).toBe(false);
    expect(computed.canRestore.compute({ data: {}, record })).toBe(true);

    const empty = { has: () => false, get: (): unknown => undefined };
    expect(computed.origin.compute({ data: { origin: "global" }, record: empty })).toBe("global");
    expect(computed.isEnabled.compute({ data: { isEnabled: false }, record: empty })).toBe(false);
    expect(computed.isHidden.compute({ data: { isHidden: true }, record: empty })).toBe(true);
    expect(computed.canRestore.compute({ data: {}, record: empty })).toBeUndefined();
  });

  it("declares the company and original relationships", () => {
    const rels = SkillDescriptor.relationships as Record<string, any>;
    expect(rels.company).toMatchObject({
      relationship: "BELONGS_TO",
      direction: "out",
      cardinality: "one",
      required: false,
      immutable: true,
    });
    expect(rels.company.contextKey).toBeUndefined();
    expect(rels.original).toMatchObject({
      model: skillMeta,
      relationship: "OVERRIDES",
      direction: "out",
      cardinality: "one",
      required: false,
      immutable: true,
      dtoKey: "original",
    });
  });
});
