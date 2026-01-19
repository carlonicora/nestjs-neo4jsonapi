import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";

// Mock the baseConfig module before importing the service
vi.mock("../../../../config/base.config", () => ({
  baseConfig: {
    api: {
      url: "https://test-api.example.com",
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
    it("should return npm_package_version when environment variable is set", () => {
      process.env.npm_package_version = "2.5.10";

      const result = service.getVersion();

      expect(result).toBe("2.5.10");
    });

    it("should return default version 1.0.0 when npm_package_version is not set", () => {
      delete process.env.npm_package_version;

      const result = service.getVersion();

      expect(result).toBe("1.0.0");
    });

    it("should return default version when npm_package_version is empty string", () => {
      process.env.npm_package_version = "";

      const result = service.getVersion();

      expect(result).toBe("1.0.0");
    });

    it("should handle semantic versioning format", () => {
      process.env.npm_package_version = "1.2.3-alpha.1";

      const result = service.getVersion();

      expect(result).toBe("1.2.3-alpha.1");
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
