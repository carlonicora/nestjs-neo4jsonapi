import { describe, expect, it } from "vitest";

/**
 * OAuthRepository imports CompanyDescriptor, and the common barrel reaches
 * OAuthRepository through jwt.or.oauth.guard -> oauth.token.service. company.ts
 * therefore imports defineEntity from its own file, not from the common barrel:
 * through the barrel, loading the barrel first evaluated company.ts while
 * defineEntity was still undefined ("defineEntity is not a function").
 * Only dynamic imports here, so this file controls the load order.
 */
describe("OAuthRepository load order", () => {
  it("loads when the common barrel is imported first", async () => {
    const common = await import("../../../../common");
    expect(typeof common.defineEntity).toBe("function");

    const { OAuthRepository } = await import("../oauth.repository");
    expect(OAuthRepository).toBeDefined();

    const { CompanyDescriptor } = await import("../../../company/entities/company");
    expect(CompanyDescriptor.model.nodeName).toBe("company");
  });
});
