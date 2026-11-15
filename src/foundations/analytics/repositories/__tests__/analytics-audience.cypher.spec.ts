import { describe, expect, it } from "vitest";
import { AUDIENCES } from "../../common/analytics.admin.filters";
import { audienceOf } from "../analytics-audience.cypher";

describe("analytics audience fragment", () => {
  it("has exactly the two audiences", () => {
    expect(AUDIENCES).toEqual(["visitors", "users"]);
  });

  it("classifies deleted returning users, then returning users, else visitors", () => {
    const expression = audienceOf("s");

    expect(expression).toContain("coalesce(s.byDeletedUser, false) THEN 'users'");
    expect(expression).toContain("MATCH (s)-[:BY_USER]->(audienceUser:User)");
    expect(expression).toContain("audienceUser.createdAt < s.startedAt");
    expect(expression.trimEnd()).toMatch(/ELSE 'visitors'\s+END$/);
    expect(expression.indexOf("byDeletedUser")).toBeLessThan(expression.indexOf("BY_USER"));
  });
});
