import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { VersionController } from "../controllers/version.controller";
import { VersionService } from "../services/version.service";

describe("VersionController", () => {
  let controller: VersionController;
  let versionService: vi.Mocked<VersionService>;

  beforeEach(async () => {
    const mockVersionService = {
      getVersion: vi.fn(),
      getApiUrl: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VersionController],
      providers: [{ provide: VersionService, useValue: mockVersionService }],
    }).compile();

    controller = module.get<VersionController>(VersionController);
    versionService = module.get(VersionService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getVersion", () => {
    it("should return version object from version service", () => {
      versionService.getVersion.mockReturnValue("1.2.3");

      const result = controller.getVersion();

      expect(result).toEqual({ version: "1.2.3" });
      expect(versionService.getVersion).toHaveBeenCalledOnce();
    });

    it("should return default version when env var not set", () => {
      versionService.getVersion.mockReturnValue("1.0.0");

      const result = controller.getVersion();

      expect(result).toEqual({ version: "1.0.0" });
    });

    it("should return actual npm package version", () => {
      versionService.getVersion.mockReturnValue("2.5.10");

      const result = controller.getVersion();

      expect(result.version).toBe("2.5.10");
      expect(versionService.getVersion).toHaveBeenCalled();
    });
  });

  describe("dependency injection", () => {
    it("should have versionService injected", () => {
      expect(controller["versionService"]).toBeDefined();
    });
  });
});
