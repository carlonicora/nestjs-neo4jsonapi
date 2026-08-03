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
});
