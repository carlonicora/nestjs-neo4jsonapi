import { describe, expect, it, vi } from "vitest";
import { UserDescriptor } from "../user";
import type { RelationshipDef } from "../../../../common/interfaces/entity.schema.interface";

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
    // Widen to RelationshipDef: the inferred literal types omit the optional readOnly key.
    const company: RelationshipDef = UserDescriptor.relationships.company;
    const module: RelationshipDef = UserDescriptor.relationships.module;
    expect(company.readOnly).toBeUndefined();
    expect(module.readOnly).toBeUndefined();
  });
});

describe("UserDescriptor avatar transform", () => {
  const transform = UserDescriptor.fields.avatar!.transform!;

  it("returns an http(s) avatar as-is, never signing it", async () => {
    const generateSignedUrl = vi.fn();
    const services = { S3Service: { generateSignedUrl } };

    await expect(transform({ avatar: "https://cdn.discordapp.com/avatars/1/abc.png" }, services)).resolves.toBe(
      "https://cdn.discordapp.com/avatars/1/abc.png",
    );
    await expect(transform({ avatar: "HTTP://example.com/a.png" }, services)).resolves.toBe("HTTP://example.com/a.png");
    expect(generateSignedUrl).not.toHaveBeenCalled();
  });

  it("signs an S3 key", async () => {
    const generateSignedUrl = vi.fn().mockResolvedValue("https://signed.example/a.png");

    await expect(
      transform({ avatar: "companies/c1/users/u1/u1.png" }, { S3Service: { generateSignedUrl } }),
    ).resolves.toBe("https://signed.example/a.png");
    expect(generateSignedUrl).toHaveBeenCalledWith({ key: "companies/c1/users/u1/u1.png", isPublic: true });
  });
});
