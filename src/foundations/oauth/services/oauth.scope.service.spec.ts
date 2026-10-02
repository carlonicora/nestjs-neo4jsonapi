import { describe, it, expect, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { OAuthScopeService } from "./oauth.scope.service";
import { OAuthScopeDefinition } from "../constants/oauth.scopes";

const buildService = (additionalScopes?: OAuthScopeDefinition[]): OAuthScopeService => {
  const configService = {
    get: vi.fn().mockImplementation((key: string) => (key === "oauth" ? { additionalScopes } : undefined)),
  } as unknown as ConfigService;
  return new OAuthScopeService(configService);
};

const photographsRead: OAuthScopeDefinition = {
  scope: "photographs:read",
  name: "View Photographs",
  description: "View your photographs",
};

describe("OAuthScopeService", () => {
  it("lists the built-in scopes when config registers none", () => {
    const service = buildService();

    expect(service.all().map((definition) => definition.scope)).toEqual(["read", "write", "profile", "mcp", "admin"]);
    expect(service.isValid("read")).toBe(true);
    expect(service.describe("mcp").name).toBe("MCP Server Access");
  });

  it("rejects photographs:read when config registers no additional scopes", () => {
    const service = buildService([]);

    expect(service.isValid("photographs:read")).toBe(false);
    expect(service.validate("read photographs:read")).toBe(false);
  });

  it("accepts photographs:read when registered through additionalScopes", () => {
    const service = buildService([photographsRead]);

    expect(service.isValid("photographs:read")).toBe(true);
    expect(service.validate("read photographs:read")).toBe(true);
    expect(service.validate(["photographs:read", "write"])).toBe(true);
    expect(service.all().map((definition) => definition.scope)).toEqual([
      "read",
      "write",
      "profile",
      "mcp",
      "admin",
      "photographs:read",
    ]);
  });

  it("describes an additional scope with its config name and description", () => {
    const service = buildService([photographsRead]);

    expect(service.describe("photographs:read")).toEqual({
      name: "View Photographs",
      description: "View your photographs",
    });
  });

  it("falls back for an unknown scope", () => {
    const service = buildService();

    expect(service.describe("unknown:scope")).toEqual({
      name: "unknown:scope",
      description: "Access to unknown:scope",
    });
  });

  it("throws at construction when an additional scope duplicates a built-in", () => {
    expect(() => buildService([{ scope: "read", name: "Read", description: "Read" }])).toThrow(/Duplicate OAuth scope/);
  });

  it("throws at construction when two additional scopes share a scope string", () => {
    expect(() => buildService([photographsRead, { ...photographsRead, name: "Other" }])).toThrow(
      /Duplicate OAuth scope "photographs:read"/,
    );
  });
});
