import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { ClsService } from "nestjs-cls";
import { SecurityService, hashPassword, checkPassword } from "../security.service";
import { SystemRoles } from "../../../../common/constants/system.roles";

describe("SecurityService", () => {
  let service: SecurityService;
  let mockJwtService: vi.Mocked<JwtService>;
  let mockClsService: vi.Mocked<ClsService>;

  const TEST_IDS = {
    userId: "user-123",
    companyId: "company-456",
  };

  const TEST_JWT_TOKEN = "test.jwt.token";

  beforeEach(async () => {
    vi.clearAllMocks();

    mockJwtService = {
      sign: vi.fn().mockReturnValue(TEST_JWT_TOKEN),
    } as any;

    mockClsService = {
      get: vi.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ClsService, useValue: mockClsService },
      ],
    }).compile();

    service = module.get<SecurityService>(SecurityService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("hashPassword", () => {
    it("should hash a password", async () => {
      const password = "testPassword123";

      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.startsWith("$2")).toBe(true); // bcrypt hash prefix
    });

    it("should generate different hashes for the same password", async () => {
      const password = "testPassword123";

      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("checkPassword", () => {
    it("should return true for matching password and hash", async () => {
      const password = "testPassword123";
      const hash = await hashPassword(password);

      const result = await checkPassword(password, hash);

      expect(result).toBe(true);
    });

    it("should return false for non-matching password", async () => {
      const password = "testPassword123";
      const wrongPassword = "wrongPassword456";
      const hash = await hashPassword(password);

      const result = await checkPassword(wrongPassword, hash);

      expect(result).toBe(false);
    });
  });

  describe("refreshTokenExpiration", () => {
    it("should return a date 7 days from now", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const expiration = service.refreshTokenExpiration;

      const expectedTime = now + 7 * 24 * 60 * 60 * 1000;
      expect(expiration.getTime()).toBe(expectedTime);

      vi.useRealTimers();
    });
  });

  describe("tokenExpiration", () => {
    it("should return a date 24 hours from now", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const expiration = service.tokenExpiration;

      const expectedTime = now + 24 * 60 * 60 * 1000;
      expect(expiration.getTime()).toBe(expectedTime);

      vi.useRealTimers();
    });
  });

  describe("signJwt", () => {
    it("should sign a JWT with user information", () => {
      const params = {
        userId: TEST_IDS.userId,
        roles: [SystemRoles.Administrator],
        companyId: TEST_IDS.companyId,
        features: ["feature1", "feature2"],
        userName: "Test User",
      };

      const result = service.signJwt(params);

      expect(result).toBe(TEST_JWT_TOKEN);
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        roles: [SystemRoles.Administrator],
        companyId: TEST_IDS.companyId,
        features: ["feature1", "feature2"],
        userName: "Test User",
        expiration: expect.any(Date),
      });
    });

    it("should sign a JWT without userName when not provided", () => {
      const params = {
        userId: TEST_IDS.userId,
        roles: [],
        companyId: TEST_IDS.companyId,
        features: [],
      };

      service.signJwt(params);

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_IDS.userId,
          userName: undefined,
        }),
      );
    });
  });

  describe("isCurrentUserCompanyAdmin", () => {
    it("should return true (hardcoded behavior)", () => {
      const result = service.isCurrentUserCompanyAdmin();

      expect(result).toBe(true);
    });
  });

  describe("validateAdmin", () => {
    it("should not throw when user has Administrator role", () => {
      const user = {
        roles: [SystemRoles.Administrator],
      };

      expect(() => service.validateAdmin({ user })).not.toThrow();
    });

    it("should not throw when user has CompanyAdministrator role", () => {
      const user = {
        roles: [SystemRoles.CompanyAdministrator],
      };

      expect(() => service.validateAdmin({ user })).not.toThrow();
    });

    it("should throw when user has no admin roles", () => {
      const user = {
        roles: ["some-other-role"],
      };

      expect(() => service.validateAdmin({ user })).toThrow("User is not an admin");
    });

    it("should throw when user has no roles", () => {
      const user = {
        roles: [],
      };

      expect(() => service.validateAdmin({ user })).toThrow("User is not an admin");
    });

    it("should throw when user is undefined", () => {
      expect(() => service.validateAdmin({ user: undefined })).toThrow("User is not an admin");
    });
  });

  describe("isUserInRoles", () => {
    it("should return true when user has one of the specified roles", () => {
      const user = {
        roles: [SystemRoles.Administrator, "other-role"],
      };

      const result = service.isUserInRoles({
        user,
        roles: [SystemRoles.Administrator],
      });

      expect(result).toBe(true);
    });

    it("should return true when user has multiple matching roles", () => {
      const user = {
        roles: [SystemRoles.Administrator, SystemRoles.CompanyAdministrator],
      };

      const result = service.isUserInRoles({
        user,
        roles: [SystemRoles.Administrator, SystemRoles.CompanyAdministrator],
      });

      expect(result).toBe(true);
    });

    it("should return false when user has none of the specified roles", () => {
      const user = {
        roles: ["some-role"],
      };

      const result = service.isUserInRoles({
        user,
        roles: [SystemRoles.Administrator],
      });

      expect(result).toBe(false);
    });

    it("should return false when user is undefined", () => {
      const result = service.isUserInRoles({
        user: undefined,
        roles: [SystemRoles.Administrator],
      });

      expect(result).toBe(false);
    });

    it("should return false when user has no roles property", () => {
      const user = {};

      const result = service.isUserInRoles({
        user,
        roles: [SystemRoles.Administrator],
      });

      expect(result).toBe(false);
    });

    it("should return false when user.roles is empty", () => {
      const user = {
        roles: [],
      };

      const result = service.isUserInRoles({
        user,
        roles: [SystemRoles.Administrator],
      });

      expect(result).toBe(false);
    });
  });

  describe("userHasAccess", () => {
    it("should execute validator and return its result", () => {
      const validator = vi.fn().mockReturnValue("access-granted");

      const result = service.userHasAccess({ validator });

      expect(validator).toHaveBeenCalled();
      expect(result).toBe("access-granted");
    });

    it("should pass through validator errors", () => {
      const validator = vi.fn().mockImplementation(() => {
        throw new Error("Access denied");
      });

      expect(() => service.userHasAccess({ validator })).toThrow("Access denied");
    });
  });
});
