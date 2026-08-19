import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";

// Mock the baseConfig module before importing the service
vi.mock("../../../../config/base.config", () => ({
  baseConfig: {
    api: {
      url: "https://test-api.example.com",
      version: "2.5.10",
    },
  },
}));

import { VersionService } from "../version.service";

describe("VersionService", () => {
  let service: VersionService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    // Save original env
    originalEnv = { ...process.env };

    const module: TestingModule = await Test.createTestingModule({
      providers: [VersionService],
    }).compile();

    service = module.get<VersionService>(VersionService);
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("getVersion", () => {
    // The npm_package_version -> api.version mapping (and its "1.0.0" fallback)
    // now belongs to the config layer and is covered in base.config.spec.ts.
    // Here the service is only responsible for surfacing what config resolved.
    it("should return the version resolved by the config layer", () => {
      expect(service.getVersion()).toBe("2.5.10");
    });
  });

  describe("getApiUrl", () => {
    it("should return API URL from config when available", () => {
      const result = service.getApiUrl();

      expect(result).toBe("https://test-api.example.com");
    });
  });
});

describe("VersionService with no api config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return default localhost URL when api config is undefined", async () => {
    vi.doMock("../../../../config/base.config", () => ({
      baseConfig: {
        api: undefined,
      },
    }));

    const { VersionService: FreshVersionService } = await import("../version.service");

    const module: TestingModule = await Test.createTestingModule({
      providers: [FreshVersionService],
    }).compile();

    const service = module.get<FreshVersionService>(FreshVersionService);

    const result = service.getApiUrl();

    expect(result).toBe("http://localhost:3000");
  });

  it("should return default localhost URL when api.url is undefined", async () => {
    vi.doMock("../../../../config/base.config", () => ({
      baseConfig: {
        api: {
          url: undefined,
        },
      },
    }));

    const { VersionService: FreshVersionService } = await import("../version.service");

    const module: TestingModule = await Test.createTestingModule({
      providers: [FreshVersionService],
    }).compile();

    const service = module.get<FreshVersionService>(FreshVersionService);

    const result = service.getApiUrl();

    expect(result).toBe("http://localhost:3000");
  });
});
