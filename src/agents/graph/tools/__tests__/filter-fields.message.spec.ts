import { describe, it, expect } from "vitest";
import { filterFieldsMessage } from "../filter-fields.message";
import type { CatalogEntity } from "../../interfaces/graph.catalog.interface";

describe("filterFieldsMessage", () => {
  const judgements: CatalogEntity = {
    type: "judgements",
    moduleId: "11111111-1111-1111-1111-111111111111",
    description: "Judgements",
    fields: [
      { name: "name", type: "string", description: "Name.", filterable: true, sortable: true },
      { name: "decisionDate", type: "date", description: "Decided on.", filterable: true, sortable: true },
      { name: "aiWarnings", type: "string[]", description: "Warnings.", filterable: false, sortable: false },
      { name: "summary", type: "string", description: "Summary.", filterable: false, sortable: false },
    ],
    relationships: [],
    nodeName: "judgement",
    labelName: "Judgement",
    personal: false,
    generatedFields: [],
    summary: () => "",
  };

  it("lists only fields with at least one operator, each with its operators", () => {
    const capabilities = [
      { field: "name", operators: ["eq", "like"] },
      { field: "decisionDate", operators: ["gte", "lte", "isNull", "isNotNull"] },
      { field: "aiWarnings", operators: [] },
    ];
    const message = filterFieldsMessage(judgements, capabilities);
    expect(message.split("\n")[0]).toBe(
      "Valid filter fields for judgements: name (eq, like), decisionDate (gte, lte, isNull, isNotNull).",
    );
    expect(message).not.toContain("aiWarnings");
    expect(message).not.toContain("summary");
  });

  it("uses the field type's operators when the service declares no capabilities", () => {
    const message = filterFieldsMessage(judgements, undefined);
    expect(message.split("\n")[0]).toBe(
      "Valid filter fields for judgements: name (eq, ne, in, like, isNull, isNotNull), decisionDate (eq, ne, gt, gte, lt, lte, isNull, isNotNull).",
    );
    expect(message).not.toContain("aiWarnings");
  });

  it("lists sortable fields separately", () => {
    const message = filterFieldsMessage(judgements, [{ field: "name", operators: ["eq"] }]);
    const lines = message.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Valid filter fields for judgements: name (eq).");
    expect(lines[1]).toBe("Sortable fields: name, decisionDate.");
  });

  it("says none when nothing can be filtered or sorted", () => {
    const message = filterFieldsMessage({ ...judgements, fields: [judgements.fields[2]] }, undefined);
    expect(message).toBe("Valid filter fields for judgements: none.\nSortable fields: none.");
  });
});
