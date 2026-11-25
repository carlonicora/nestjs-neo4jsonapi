import { afterEach, describe, expect, it, vi } from "vitest";
import { AppMode } from "../../common/decorators/conditional-service.decorator";
import { DEFAULT_TRUST_PROXY, getAppLabel, getAppModeConfig, resolveTrustProxy } from "../defaults";

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

describe("getAppLabel", () => {
  const LABEL_ERROR = "--label is valid only with an explicit --mode=worker";

  it("reads the label of an explicit worker", () => {
    expect(getAppLabel(["node", "main", "--mode=worker", "--label=discord"])).toBe("discord");
  });

  it("returns undefined when no label is given", () => {
    expect(getAppLabel(["node", "main", "--mode=worker"])).toBeUndefined();
  });

  it("throws for a label in API mode", () => {
    expect(() => getAppLabel(["--mode=api", "--label=x"])).toThrow(LABEL_ERROR);
  });

  it("throws for a label with no mode", () => {
    expect(() => getAppLabel(["--label=x"])).toThrow(LABEL_ERROR);
  });

  it("throws for a label with the --worker shorthand", () => {
    expect(() => getAppLabel(["--worker", "--label=x"])).toThrow(LABEL_ERROR);
  });

  it("throws for an empty label", () => {
    expect(() => getAppLabel(["--mode=worker", "--label="])).toThrow(LABEL_ERROR);
  });
});

describe("getAppModeConfig", () => {
  it("gives a labelled worker no cron jobs and carries the label", () => {
    expect(getAppModeConfig(AppMode.WORKER, "discord")).toEqual({
      mode: AppMode.WORKER,
      enableControllers: false,
      enableWorkers: true,
      enableCronJobs: false,
      label: "discord",
    });
  });

  it("leaves an unlabelled worker unchanged", () => {
    const config = getAppModeConfig(AppMode.WORKER);

    expect(config).toEqual({
      mode: AppMode.WORKER,
      enableControllers: false,
      enableWorkers: true,
      enableCronJobs: true,
    });
    expect("label" in config).toBe(false);
  });
});
