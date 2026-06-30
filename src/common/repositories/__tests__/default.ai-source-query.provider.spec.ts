import { describe, it, expect } from "vitest";
import { DefaultAiSourceQueryProvider } from "../default.ai-source-query.provider";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("DefaultAiSourceQueryProvider", () => {
  const p = new DefaultAiSourceQueryProvider();

  it("normal returnsData: company match + WITH data, no params", () => {
    const r = p.build({ dataLimits: {}, returnsData: true });
    expect(norm(r.cypher)).toBe("MATCH (data)-[:BELONGS_TO]->(company) WITH data");
    expect(r.params ?? {}).toEqual({});
  });

  it("normal returnsKeyConcepts: company match + WITH keyconcept", () => {
    const r = p.build({ dataLimits: {}, returnsKeyConcepts: true });
    expect(norm(r.cypher)).toBe("MATCH (data)-[:BELONGS_TO]->(company) WITH keyconcept");
  });

  it("howToMode bypass: HowTo match + WITH data, no params", () => {
    const r = p.build({ dataLimits: { howToMode: true }, returnsData: true });
    expect(norm(r.cypher)).toBe("MATCH (data:HowTo) WITH data");
    expect(r.params ?? {}).toEqual({});
  });

  it("limitToHowToId bypass: HowTo match + WHERE id param + WITH data", () => {
    const r = p.build({ dataLimits: { limitToHowToId: "h1" }, returnsData: true });
    expect(norm(r.cypher)).toBe("MATCH (data:HowTo) WHERE data.id = $limitToHowToId WITH data");
    expect(r.params).toEqual({ limitToHowToId: "h1" });
  });
});
