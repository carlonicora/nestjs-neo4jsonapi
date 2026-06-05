import { describe, it, expect } from "vitest";
import { makeTemplateData } from "./fixtures";
import { generateEntityFile } from "../templates/entity.template";

describe("backend entity template", () => {
  it("emits entity-level description and chat", () => {
    const out = generateEntityFile(makeTemplateData({
      description: "A demo widget.",
      chat: { summary: "data.name ?? data.id", textSearchFields: ["name"] },
    }));
    expect(out).toContain('"A demo widget."');
    expect(out).toContain("chat:");
    expect(out).toContain("summary: (data) => data.name ?? data.id");
    expect(out).toContain('textSearchFields: ["name"]');
  });

  it("emits field description and kind", () => {
    const out = generateEntityFile(makeTemplateData({
      fields: [{ name: "value", type: "number", required: false, tsType: "number", description: "Money.", kind: { type: "money" } }],
    }));
    expect(out).toContain('value: { type: "number", description: "Money.", kind: { type: "money" } }');
  });

  it("moves readOnly+computed fields into computed{} and out of fields{}", () => {
    const out = generateEntityFile(makeTemplateData({
      fields: [
        { name: "name", type: "string", required: true, tsType: "string" },
        { name: "effective_value", type: "number", required: false, tsType: "number", readOnly: true, computed: "p.record?.get('effective_value') ?? undefined" },
      ],
    }));
    expect(out).toContain("effective_value?: number;");          // present in entity TS type
    expect(out).toContain("computed: {");                         // computed block present
    expect(out).toContain("effective_value: {");
    expect(out).toContain("compute: (p) => p.record?.get('effective_value') ?? undefined");
    expect(out).not.toMatch(/effective_value:\s*\{\s*type:/);     // absent from fields{} block
  });

  it("excludes a computed field from fields{} even when not readOnly", () => {
    const out = generateEntityFile(makeTemplateData({
      fields: [
        { name: "name", type: "string", required: true, tsType: "string" },
        { name: "score", type: "number", required: false, tsType: "number", computed: "p.record?.get('score') ?? 0" },
      ],
    }));
    expect(out).not.toMatch(/score:\s*\{\s*type:/);   // not in fields{}
    expect(out).toContain("compute: (p) => p.record?.get('score') ?? 0"); // in computed{}
  });

  it("emits relationship description", () => {
    const out = generateEntityFile(makeTemplateData({
      relationships: [{
        key: "account", model: "accountMeta", direction: "out", relationship: "FOR",
        cardinality: "one", required: true, dtoKey: "account", description: "The owning account.",
        relatedEntity: { name: "Account", directory: "crm", pascalCase: "Account", camelCase: "account", kebabCase: "account" },
        isNewStructure: false,
      }],
    }));
    expect(out).toContain('description: "The owning account."');
  });
});
