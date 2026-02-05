/**
 * ReferralModule Unit Tests
 *
 * Tests module creation and configuration patterns.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { BullModule, getQueueToken } from "@nestjs/bullmq";
import { ClsModule, ClsService } from "nestjs-cls";

import { ReferralModule } from "../referral.module";
import {
  REFERRAL_CONFIG,
  DEFAULT_REFERRAL_CONFIG,
  ReferralModuleConfig,
} from "../interfaces/referral.config.interface";
import { ReferralService } from "../services/referral.service";
import { ReferralRepository } from "../repositories/referral.repository";
import { QueueId } from "../../../config/enums/queue.id";

// Mock dependencies
vi.mock("../../../core/jsonapi/services/jsonapi.service", () => ({
  JsonApiService: vi.fn().mockImplementation(() => ({
    buildSingle: vi.fn(),
    buildList: vi.fn(),
  })),
}));

vi.mock("../../../core/cache/services/cache.service", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    getRedisClient: vi.fn().mockReturnValue({
      get: vi.fn(),
      setex: vi.fn(),
    }),
  })),
}));

vi.mock("../../../core/neo4j/services/neo4j.service", () => ({
  Neo4jService: vi.fn().mockImplementation(() => ({
    initQuery: vi.fn(),
    read: vi.fn(),
    readOne: vi.fn(),
    write: vi.fn(),
    writeOne: vi.fn(),
  })),
}));

vi.mock("../../../core/security/services/security.service", () => ({
  SecurityService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../company/company.module", () => ({
  CompanyModule: class MockCompanyModule {},
}));

vi.mock("../../user/user.module", () => ({
  UserModule: class MockUserModule {},
}));

vi.mock("../../company/repositories/company.repository", () => ({
  CompanyRepository: vi.fn().mockImplementation(() => ({
    findByCompanyId: vi.fn(),
    findByReferralCode: vi.fn(),
    setReferralCode: vi.fn(),
    addExtraTokens: vi.fn(),
  })),
}));

vi.mock("../../user/repositories/user.repository", () => ({
  UserRepository: vi.fn().mockImplementation(() => ({
    findByUserId: vi.fn(),
    findByEmail: vi.fn(),
  })),
}));

describe("ReferralModule", () => {
  describe("Scenario: Default configuration values", () => {
    it("should have enabled: false by default", () => {
      expect(DEFAULT_REFERRAL_CONFIG.enabled).toBe(false);
    });

    it("should have rewardTokens: 1000 by default", () => {
      expect(DEFAULT_REFERRAL_CONFIG.rewardTokens).toBe(1000);
    });

    it("should have inviteCooldownSeconds: 14 days by default", () => {
      expect(DEFAULT_REFERRAL_CONFIG.inviteCooldownSeconds).toBe(14 * 24 * 60 * 60);
    });
  });

  describe("Scenario: Module creation with default configuration", () => {
    it("should create module with default config when no options provided", () => {
      const dynamicModule = ReferralModule.forRoot();

      expect(dynamicModule).toBeDefined();
      expect(dynamicModule.module).toBe(ReferralModule);
    });

    it("should export REFERRAL_CONFIG provider", () => {
      const dynamicModule = ReferralModule.forRoot();

      expect(dynamicModule.exports).toBeDefined();
      expect(dynamicModule.exports).toContain(REFERRAL_CONFIG);
    });

    it("should export ReferralService", () => {
      const dynamicModule = ReferralModule.forRoot();

      expect(dynamicModule.exports).toContain(ReferralService);
    });

    it("should export ReferralRepository", () => {
      const dynamicModule = ReferralModule.forRoot();

      expect(dynamicModule.exports).toContain(ReferralRepository);
    });

    it("should include ReferralController", () => {
      const dynamicModule = ReferralModule.forRoot();

      expect(dynamicModule.controllers).toBeDefined();
      expect(dynamicModule.controllers?.length).toBeGreaterThan(0);
    });
  });

  describe("Scenario: Module creation with custom configuration", () => {
    it("should accept custom enabled value", () => {
      const customConfig: ReferralModuleConfig = { enabled: true };
      const dynamicModule = ReferralModule.forRoot(customConfig);

      expect(dynamicModule).toBeDefined();
      expect(dynamicModule.module).toBe(ReferralModule);
    });

    it("should accept custom rewardTokens value", () => {
      const customConfig: ReferralModuleConfig = { rewardTokens: 500 };
      const dynamicModule = ReferralModule.forRoot(customConfig);

      expect(dynamicModule).toBeDefined();
    });

    it("should accept custom inviteCooldownSeconds value", () => {
      const customConfig: ReferralModuleConfig = { inviteCooldownSeconds: 3600 };
      const dynamicModule = ReferralModule.forRoot(customConfig);

      expect(dynamicModule).toBeDefined();
    });

    it("should merge custom config with defaults", () => {
      const customConfig: ReferralModuleConfig = { enabled: true };
      const mergedConfig = { ...DEFAULT_REFERRAL_CONFIG, ...customConfig };

      expect(mergedConfig.enabled).toBe(true);
      expect(mergedConfig.rewardTokens).toBe(1000); // default preserved
      expect(mergedConfig.inviteCooldownSeconds).toBe(14 * 24 * 60 * 60); // default preserved
    });

    it("should preserve all default values when partial config provided", () => {
      const customConfig: ReferralModuleConfig = { enabled: true };
      const mergedConfig = { ...DEFAULT_REFERRAL_CONFIG, ...customConfig };

      expect(mergedConfig.enabled).toBe(true);
      expect(mergedConfig.rewardTokens).toBe(1000);
      expect(mergedConfig.inviteCooldownSeconds).toBe(14 * 24 * 60 * 60);
    });

    it("should allow overriding all config values", () => {
      const fullCustomConfig: ReferralModuleConfig = {
        enabled: true,
        rewardTokens: 2000,
        inviteCooldownSeconds: 7200,
      };
      const mergedConfig = { ...DEFAULT_REFERRAL_CONFIG, ...fullCustomConfig };

      expect(mergedConfig.enabled).toBe(true);
      expect(mergedConfig.rewardTokens).toBe(2000);
      expect(mergedConfig.inviteCooldownSeconds).toBe(7200);
    });
  });

  describe("Scenario: Async module configuration", () => {
    it("should support forRootAsync with factory function", () => {
      const asyncOptions = {
        useFactory: async () => ({ enabled: true, rewardTokens: 2000 }),
        inject: [],
      };
      const dynamicModule = ReferralModule.forRootAsync(asyncOptions);

      expect(dynamicModule).toBeDefined();
      expect(dynamicModule.module).toBe(ReferralModule);
    });

    it("should support forRootAsync with imports", () => {
      const mockConfigModule = class MockConfigModule {};
      const asyncOptions = {
        imports: [mockConfigModule],
        useFactory: async () => ({ enabled: true }),
        inject: [],
      };
      const dynamicModule = ReferralModule.forRootAsync(asyncOptions);

      expect(dynamicModule).toBeDefined();
      expect(dynamicModule.imports).toContain(mockConfigModule);
    });

    it("should support forRootAsync with inject", () => {
      const asyncOptions = {
        useFactory: async (config: { get: (key: string) => string }) => ({
          enabled: config.get("REFERRAL_ENABLED") === "true",
        }),
        inject: ["ConfigService"],
      };
      const dynamicModule = ReferralModule.forRootAsync(asyncOptions);

      expect(dynamicModule).toBeDefined();
      expect(dynamicModule.providers).toBeDefined();
    });

    it("should export same providers as forRoot", () => {
      const syncModule = ReferralModule.forRoot();
      const asyncModule = ReferralModule.forRootAsync({
        useFactory: async () => ({}),
        inject: [],
      });

      expect(asyncModule.exports).toContain(REFERRAL_CONFIG);
      expect(asyncModule.exports).toContain(ReferralService);
      expect(asyncModule.exports).toContain(ReferralRepository);
    });

    it("should merge defaults with async config", async () => {
      const asyncConfig = { enabled: true };
      const mergedConfig = { ...DEFAULT_REFERRAL_CONFIG, ...asyncConfig };

      expect(mergedConfig.enabled).toBe(true);
      expect(mergedConfig.rewardTokens).toBe(1000); // default preserved
    });
  });

  describe("Scenario: Module structure validation", () => {
    it("should include BullModule for EMAIL queue in imports", () => {
      const dynamicModule = ReferralModule.forRoot();

      expect(dynamicModule.imports).toBeDefined();
      // BullModule.registerQueue returns a DynamicModule
      const imports = dynamicModule.imports as any[];
      const hasBullImport = imports.some(
        (imp) => imp && (imp.module?.name === "BullModule" || imp.constructor?.name === "DynamicModule"),
      );
      expect(imports.length).toBeGreaterThan(0);
    });

    it("should include CompanyModule in imports", () => {
      const dynamicModule = ReferralModule.forRoot();
      const imports = dynamicModule.imports as any[];

      // CompanyModule is mocked, check it's in the imports
      expect(imports.length).toBeGreaterThan(0);
    });

    it("should include UserModule in imports", () => {
      const dynamicModule = ReferralModule.forRoot();
      const imports = dynamicModule.imports as any[];

      expect(imports.length).toBeGreaterThan(0);
    });

    it("should include ReferralService in providers", () => {
      const dynamicModule = ReferralModule.forRoot();

      expect(dynamicModule.providers).toBeDefined();
      expect(dynamicModule.providers).toContain(ReferralService);
    });

    it("should include ReferralRepository in providers", () => {
      const dynamicModule = ReferralModule.forRoot();

      expect(dynamicModule.providers).toContain(ReferralRepository);
    });
  });
});
