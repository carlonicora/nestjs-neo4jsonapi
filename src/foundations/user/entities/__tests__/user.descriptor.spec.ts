import { describe, expect, it } from "vitest";
import { UserDescriptor } from "../user";

describe("UserDescriptor security surface", () => {
  it("never indexes secrets in the fulltext search fields", () => {
    expect(UserDescriptor.stringFields).not.toContain("password");
    expect(UserDescriptor.stringFields).not.toContain("code");
  });

  it("never serialises password or code over JSON:API", () => {
    expect(UserDescriptor.fields.password?.excludeFromJsonApi).toBe(true);
    expect(UserDescriptor.fields.code?.excludeFromJsonApi).toBe(true);
  });

  it("keeps the role relationship read-only (serialisation-only, hydrated through :Membership)", () => {
    // Roles have no single-hop (user)-[:HAS_MEMBERSHIP]->(:Role) edge, so the generic
    // descriptor-driven paths inherited from AbstractRepository must never traverse or
    // write it. Do NOT remove this flag - spec §3.4.
    expect(UserDescriptor.relationships.role.readOnly).toBe(true);
  });

  it("leaves the other user relationships writable", () => {
    expect(UserDescriptor.relationships.company.readOnly).toBeUndefined();
    expect(UserDescriptor.relationships.module.readOnly).toBeUndefined();
  });
});
