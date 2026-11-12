import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { parseJsonApiSort } from "../parse-jsonapi-sort";

const descriptor = {
  fields: {
    name: { sortable: true },
    publicationDate: { sortable: true },
    // A computed value declared in `fields` without the opt-in: never sortable.
    stepCount: {},
    secret: { sortable: false },
  },
};

describe("parseJsonApiSort", () => {
  it("reads one ascending field", () => {
    expect(parseJsonApiSort({ sort: "name", descriptor })).toEqual([{ field: "name", direction: "asc" }]);
  });

  it("reads a descending field and several comma-separated fields in order", () => {
    expect(parseJsonApiSort({ sort: "-publicationDate,name", descriptor })).toEqual([
      { field: "publicationDate", direction: "desc" },
      { field: "name", direction: "asc" },
    ]);
  });

  it("trims each key", () => {
    expect(parseJsonApiSort({ sort: " -name , publicationDate ", descriptor })).toEqual([
      { field: "name", direction: "desc" },
      { field: "publicationDate", direction: "asc" },
    ]);
  });

  it.each([undefined, ""])("returns undefined for %j", (sort) => {
    expect(parseJsonApiSort({ sort, descriptor })).toBeUndefined();
  });

  it("accepts createdAt and updatedAt without a descriptor flag", () => {
    expect(parseJsonApiSort({ sort: "-createdAt,updatedAt" })).toEqual([
      { field: "createdAt", direction: "desc" },
      { field: "updatedAt", direction: "asc" },
    ]);
  });

  it("accepts a field named by the allow-list", () => {
    expect(parseJsonApiSort({ sort: "-priority", allow: ["priority"] })).toEqual([
      { field: "priority", direction: "desc" },
    ]);
  });

  it("returns the code-held key, never the request substring", () => {
    const allow = ["priority"];
    const [criterion] = parseJsonApiSort({ sort: "priority", allow }) ?? [];
    expect(criterion.field).toBe(allow[0]);
  });

  it.each([
    ["a field the descriptor does not declare", "missing"],
    ["a field declared sortable: false", "secret"],
    ["a computed field (in fields, no sortable flag)", "stepCount"],
    ["an injection string", "name) DETACH DELETE n //"],
    ["an injection with a semicolon", "name; MATCH (n) DETACH DELETE n"],
    ["a lone minus", "-"],
    ["empty keys", ",,"],
    ["a trailing comma", "name,"],
    ["a repeated field", "name,name"],
    ["a repeated field in both directions", "name,-name"],
    ["a double minus", "--name"],
    ["a plus prefix", "+name"],
    ["a dotted path", "n.name"],
    ["a prototype key", "__proto__"],
    ["a prototype key (constructor)", "constructor"],
  ])("refuses %s with a 400", (_label, sort) => {
    expect(() => parseJsonApiSort({ sort, descriptor })).toThrow(BadRequestException);
  });

  it("refuses more than five keys", () => {
    const allow = ["a", "b", "c", "d", "e", "f"];
    expect(parseJsonApiSort({ sort: "a,b,c,d,e", allow })).toHaveLength(5);
    expect(() => parseJsonApiSort({ sort: "a,b,c,d,e,f", allow })).toThrow(BadRequestException);
  });

  it("refuses a value that is not a string (?sort=a&sort=b, ?sort[x]=a)", () => {
    expect(() => parseJsonApiSort({ sort: ["name", "name"] as unknown as string, descriptor })).toThrow(
      BadRequestException,
    );
    expect(() => parseJsonApiSort({ sort: { x: "name" } as unknown as string, descriptor })).toThrow(
      BadRequestException,
    );
  });

  it("answers the same message for every refusal", () => {
    expect(() => parseJsonApiSort({ sort: "secret", descriptor })).toThrow("Invalid sort");
    expect(() => parseJsonApiSort({ sort: "name,name", descriptor })).toThrow("Invalid sort");
  });
});
