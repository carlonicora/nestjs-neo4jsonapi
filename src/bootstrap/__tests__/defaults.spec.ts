import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TRUST_PROXY, resolveTrustProxy } from "../defaults";

describe("resolveTrustProxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("trusts private networks only when TRUST_PROXY is unset", () => {
    vi.stubEnv("TRUST_PROXY", undefined);

    expect(resolveTrustProxy()).toBe("loopback,linklocal,uniquelocal");
    expect(DEFAULT_TRUST_PROXY).toBe("loopback,linklocal,uniquelocal");
  });

  it("uses the default when TRUST_PROXY is empty", () => {
    vi.stubEnv("TRUST_PROXY", "");

    expect(resolveTrustProxy()).toBe(DEFAULT_TRUST_PROXY);
  });

  it("trusts nothing when TRUST_PROXY is false", () => {
    vi.stubEnv("TRUST_PROXY", "false");

    expect(resolveTrustProxy()).toBe(false);
  });

  it("passes a custom list through as a string", () => {
    vi.stubEnv("TRUST_PROXY", "10.0.0.0/8,172.19.0.6");

    expect(resolveTrustProxy()).toBe("10.0.0.0/8,172.19.0.6");
  });
});
