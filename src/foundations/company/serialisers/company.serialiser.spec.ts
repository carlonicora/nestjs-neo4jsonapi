/**
 * Company Serialiser Unit Tests
 *
 * Tests the CompanySerialiser class that converts Company entities to JSON:API format.
 * These tests verify that serialization works correctly before and after migration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { CompanySerialiser } from "./company.serialiser";
import { JsonApiSerialiserFactory } from "../../../core/jsonapi/factories/jsonapi.serialiser.factory";
import { S3Service } from "../../s3/services/s3.service";
import { Company } from "../entities/company.entity";
import { companyMeta } from "../entities/company.meta";

describe("CompanySerialiser", () => {
  let serialiser: CompanySerialiser;
  let mockSerialiserFactory: vi.Mocked<JsonApiSerialiserFactory>;
  let mockS3Service: vi.Mocked<S3Service>;
  let mockConfigService: vi.Mocked<ConfigService>;

  const mockApiConfig = {
    url: "https://api.example.com/",
  };

  beforeEach(async () => {
    mockSerialiserFactory = {
      create: vi.fn().mockReturnValue({}),
    } as any;

    mockS3Service = {
      generateSignedUrl: vi.fn().mockResolvedValue("https://signed-url.s3.amazonaws.com/logo.png"),
    } as any;

    mockConfigService = {
      get: vi.fn().mockReturnValue(mockApiConfig),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanySerialiser,
        { provide: JsonApiSerialiserFactory, useValue: mockSerialiserFactory },
        { provide: S3Service, useValue: mockS3Service },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    serialiser = module.get<CompanySerialiser>(CompanySerialiser);
  });

  describe("type getter", () => {
    it("should return the company endpoint", () => {
      expect(serialiser.type).toBe(companyMeta.endpoint);
      expect(serialiser.type).toBe("companies");
    });
  });

  describe("create method", () => {
    it("should return a JsonApiDataInterface with correct type", () => {
      const result = serialiser.create();

      expect(result.type).toBe("companies");
    });

    it("should define all expected attributes", () => {
      const result = serialiser.create();

      expect(result.attributes).toHaveProperty("name");
      expect(result.attributes).toHaveProperty("configurations");
      expect(result.attributes).toHaveProperty("logoUrl");
      expect(result.attributes).toHaveProperty("logo");
      expect(result.attributes).toHaveProperty("monthlyTokens");
      expect(result.attributes).toHaveProperty("availableMonthlyTokens");
      expect(result.attributes).toHaveProperty("availableExtraTokens");
      expect(result.attributes).toHaveProperty("isActiveSubscription");
    });

    it("should have static string mappings for simple attributes", () => {
      const result = serialiser.create();

      expect(result.attributes.name).toBe("name");
      expect(result.attributes.configurations).toBe("configurations");
      expect(result.attributes.logoUrl).toBe("logo");
      expect(result.attributes.isActiveSubscription).toBe("isActiveSubscription");
    });

    it("should have async function for logo attribute", () => {
      const result = serialiser.create();

      expect(typeof result.attributes.logo).toBe("function");
    });

    it("should have async functions for token attributes", () => {
      const result = serialiser.create();

      expect(typeof result.attributes.monthlyTokens).toBe("function");
      expect(typeof result.attributes.availableMonthlyTokens).toBe("function");
      expect(typeof result.attributes.availableExtraTokens).toBe("function");
    });

    it("should define feature and module relationships", () => {
      const result = serialiser.create();

      expect(result.relationships).toHaveProperty("feature");
      expect(result.relationships).toHaveProperty("module");
      expect(result.relationships.feature.name).toBe("features");
      expect(result.relationships.module.name).toBe("modules");
    });
  });

  describe("logo attribute transform", () => {
    it("should generate signed URL when logo is present", async () => {
      const result = serialiser.create();
      const mockCompany: Partial<Company> = {
        logo: "logos/company-logo.png",
      };

      const signedUrl = await result.attributes.logo(mockCompany);

      expect(mockS3Service.generateSignedUrl).toHaveBeenCalledWith({
        key: "logos/company-logo.png",
        isPublic: true,
      });
      expect(signedUrl).toBe("https://signed-url.s3.amazonaws.com/logo.png");
    });

    it("should return undefined when logo is not present", async () => {
      const result = serialiser.create();
      const mockCompany: Partial<Company> = {
        logo: undefined,
      };

      const signedUrl = await result.attributes.logo(mockCompany);

      expect(mockS3Service.generateSignedUrl).not.toHaveBeenCalled();
      expect(signedUrl).toBeUndefined();
    });

    it("should return undefined when logo is empty string", async () => {
      const result = serialiser.create();
      const mockCompany: Partial<Company> = {
        logo: "",
      };

      const signedUrl = await result.attributes.logo(mockCompany);

      expect(mockS3Service.generateSignedUrl).not.toHaveBeenCalled();
      expect(signedUrl).toBeUndefined();
    });

    it("should return undefined when logo is null", async () => {
      const result = serialiser.create();
      const mockCompany: Partial<Company> = {
        logo: null as any,
      };

      const signedUrl = await result.attributes.logo(mockCompany);

      expect(mockS3Service.generateSignedUrl).not.toHaveBeenCalled();
      expect(signedUrl).toBeUndefined();
    });
  });

  describe("token attribute transforms", () => {
    describe("monthlyTokens", () => {
      it("should return number when monthlyTokens is defined", async () => {
        const result = serialiser.create();
        const mockCompany: Partial<Company> = {
          monthlyTokens: 10000,
        };

        const tokens = await result.attributes.monthlyTokens(mockCompany);

        expect(tokens).toBe(10000);
        expect(typeof tokens).toBe("number");
      });

      it("should return 0 when monthlyTokens is undefined", async () => {
        const result = serialiser.create();
        const mockCompany: Partial<Company> = {
          monthlyTokens: undefined,
        };

        const tokens = await result.attributes.monthlyTokens(mockCompany);

        expect(tokens).toBe(0);
      });

      it("should convert BigInt to number", async () => {
        const result = serialiser.create();
        const mockCompany: Partial<Company> = {
          monthlyTokens: BigInt(50000) as any,
        };

        const tokens = await result.attributes.monthlyTokens(mockCompany);

        expect(tokens).toBe(50000);
        expect(typeof tokens).toBe("number");
      });
    });

    describe("availableMonthlyTokens", () => {
      it("should return number when availableMonthlyTokens is defined", async () => {
        const result = serialiser.create();
        const mockCompany: Partial<Company> = {
          availableMonthlyTokens: 5000,
        };

        const tokens = await result.attributes.availableMonthlyTokens(mockCompany);

        expect(tokens).toBe(5000);
      });

      it("should return 0 when availableMonthlyTokens is undefined", async () => {
        const result = serialiser.create();
        const mockCompany: Partial<Company> = {
          availableMonthlyTokens: undefined,
        };

        const tokens = await result.attributes.availableMonthlyTokens(mockCompany);

        expect(tokens).toBe(0);
      });
    });

    describe("availableExtraTokens", () => {
      it("should return number when availableExtraTokens is defined", async () => {
        const result = serialiser.create();
        const mockCompany: Partial<Company> = {
          availableExtraTokens: 2500,
        };

        const tokens = await result.attributes.availableExtraTokens(mockCompany);

        expect(tokens).toBe(2500);
      });

      it("should return 0 when availableExtraTokens is undefined", async () => {
        const result = serialiser.create();
        const mockCompany: Partial<Company> = {
          availableExtraTokens: undefined,
        };

        const tokens = await result.attributes.availableExtraTokens(mockCompany);

        expect(tokens).toBe(0);
      });
    });
  });

  describe("relationship serializers", () => {
    it("should create feature relationship serializer", () => {
      serialiser.create();

      expect(mockSerialiserFactory.create).toHaveBeenCalled();
      // Check that FeatureModel was passed (first call)
      const calls = mockSerialiserFactory.create.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    it("should create module relationship serializer", () => {
      serialiser.create();

      // The create method should be called for both feature and module
      expect(mockSerialiserFactory.create).toHaveBeenCalledTimes(2);
    });
  });

  describe("S3 service error handling", () => {
    it("should propagate S3 errors", async () => {
      const s3Error = new Error("S3 service unavailable");
      mockS3Service.generateSignedUrl.mockRejectedValue(s3Error);

      const result = serialiser.create();
      const mockCompany: Partial<Company> = {
        logo: "logos/test.png",
      };

      await expect(result.attributes.logo(mockCompany)).rejects.toThrow("S3 service unavailable");
    });
  });

  describe("edge cases", () => {
    it("should handle zero token values correctly", async () => {
      const result = serialiser.create();
      const mockCompany: Partial<Company> = {
        monthlyTokens: 0,
        availableMonthlyTokens: 0,
        availableExtraTokens: 0,
      };

      expect(await result.attributes.monthlyTokens(mockCompany)).toBe(0);
      expect(await result.attributes.availableMonthlyTokens(mockCompany)).toBe(0);
      expect(await result.attributes.availableExtraTokens(mockCompany)).toBe(0);
    });

    it("should handle very large token values", async () => {
      const result = serialiser.create();
      const mockCompany: Partial<Company> = {
        monthlyTokens: 999999999999,
      };

      const tokens = await result.attributes.monthlyTokens(mockCompany);
      expect(tokens).toBe(999999999999);
    });

    it("should handle negative token values", async () => {
      const result = serialiser.create();
      const mockCompany: Partial<Company> = {
        monthlyTokens: -100,
      };

      const tokens = await result.attributes.monthlyTokens(mockCompany);
      expect(tokens).toBe(-100);
    });
  });
});
