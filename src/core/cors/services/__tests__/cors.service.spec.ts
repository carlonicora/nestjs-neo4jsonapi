import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { CorsService } from "../cors.service";
import { ConfigCorsInterface } from "../../../../config/interfaces";
import { TRUSTED_ORIGINS_RESOLVER, TrustedOriginsResolver } from "../../interfaces/trusted-origins.resolver.interface";

describe("CorsService", () => {
  let service: CorsService;
  let mockConfigService: { get: ReturnType<typeof vi.fn> };

  const createMockCorsConfig = (overrides: Partial<ConfigCorsInterface> = {}): ConfigCorsInterface => ({
    origins: ["https://example.com", "https://app.example.com"],
    originPatterns: ["^https:\\/\\/.*\\.example\\.com$"],
    credentials: true,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: "Content-Type,Authorization",
    maxAge: 86400,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    logViolations: false,
    ...overrides,
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === "cors") return createMockCorsConfig();
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CorsService, { provide: ConfigService, useValue: mockConfigService }],
    }).compile();

    service = module.get<CorsService>(CorsService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getCorsConfiguration", () => {
    it("should return cors configuration with origin validator", () => {
      const config = service.getCorsConfiguration();

      expect(config.credentials).toBe(true);
      expect(config.methods).toBe("GET,HEAD,PUT,PATCH,POST,DELETE");
      expect(config.allowedHeaders).toBe("Content-Type,Authorization");
      expect(config.maxAge).toBe(86400);
      expect(config.preflightContinue).toBe(false);
      expect(config.optionsSuccessStatus).toBe(204);
      expect(typeof config.origin).toBe("function");
    });

    it("should return true for origin when no origins or patterns configured", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "cors")
          return createMockCorsConfig({
            origins: [],
            originPatterns: [],
          });
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [CorsService, { provide: ConfigService, useValue: mockConfigService }],
      }).compile();

      const newService = module.get<CorsService>(CorsService);
      const config = newService.getCorsConfiguration();

      expect(config.origin).toBe(true);
    });

    it("should log warning when no origins configured and logViolations is true", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "cors")
          return createMockCorsConfig({
            origins: [],
            originPatterns: [],
            logViolations: true,
          });
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [CorsService, { provide: ConfigService, useValue: mockConfigService }],
      }).compile();

      const newService = module.get<CorsService>(CorsService);
      newService.getCorsConfiguration();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "CORS: No origins or patterns configured, allowing all origins (insecure)",
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe("origin validator function", () => {
    it("should allow requests without Origin header", () => {
      const config = service.getCorsConfiguration();
      const originValidator = config.origin as (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => void;

      const callback = vi.fn();
      originValidator(undefined, callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it("should allow exact matching origins", () => {
      const config = service.getCorsConfiguration();
      const originValidator = config.origin as (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => void;

      const callback = vi.fn();
      originValidator("https://example.com", callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it("should allow pattern matching origins", () => {
      const config = service.getCorsConfiguration();
      const originValidator = config.origin as (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => void;

      const callback = vi.fn();
      originValidator("https://subdomain.example.com", callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it("should reject non-matching origins", () => {
      const config = service.getCorsConfiguration();
      const originValidator = config.origin as (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => void;

      const callback = vi.fn();
      originValidator("https://malicious.com", callback);

      expect(callback).toHaveBeenCalledWith(null, false);
    });

    it("should log rejected origins when logViolations is enabled", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "cors")
          return createMockCorsConfig({
            logViolations: true,
          });
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [CorsService, { provide: ConfigService, useValue: mockConfigService }],
      }).compile();

      const newService = module.get<CorsService>(CorsService);
      const config = newService.getCorsConfiguration();
      const originValidator = config.origin as (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => void;

      const callback = vi.fn();
      originValidator("https://malicious.com", callback);

      expect(consoleErrorSpy).toHaveBeenCalledWith("CORS: Rejected request from origin: https://malicious.com");
      consoleErrorSpy.mockRestore();
    });

    it("should handle invalid regex patterns gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "cors")
          return createMockCorsConfig({
            origins: [],
            originPatterns: ["[invalid-regex"],
          });
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [CorsService, { provide: ConfigService, useValue: mockConfigService }],
      }).compile();

      const newService = module.get<CorsService>(CorsService);
      const config = newService.getCorsConfiguration();
      const originValidator = config.origin as (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => void;

      const callback = vi.fn();
      originValidator("https://test.com", callback);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("CORS: Invalid origin pattern"),
        expect.any(Error),
      );
      expect(callback).toHaveBeenCalledWith(null, false);
      consoleErrorSpy.mockRestore();
    });
  });

  describe("validateConfiguration", () => {
    it("should log warning when no origins or patterns configured", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "cors")
          return createMockCorsConfig({
            origins: [],
            originPatterns: [],
          });
        return undefined;
      });

      service.validateConfiguration();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "CORS: No origins or patterns configured. This will allow all origins which is insecure for production.",
      );
      consoleErrorSpy.mockRestore();
    });

    it("should log warning for invalid origins", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "cors")
          return createMockCorsConfig({
            origins: ["not-a-valid-url", "https://valid.com"],
            originPatterns: [],
          });
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [CorsService, { provide: ConfigService, useValue: mockConfigService }],
      }).compile();

      const newService = module.get<CorsService>(CorsService);
      newService.validateConfiguration();

      expect(consoleErrorSpy).toHaveBeenCalledWith("CORS: Invalid origin configured: not-a-valid-url");
      consoleErrorSpy.mockRestore();
    });

    it("should log warning for invalid regex patterns", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "cors")
          return createMockCorsConfig({
            origins: ["https://valid.com"],
            originPatterns: ["[invalid-regex"],
          });
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [CorsService, { provide: ConfigService, useValue: mockConfigService }],
      }).compile();

      const newService = module.get<CorsService>(CorsService);
      newService.validateConfiguration();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("CORS: Invalid origin pattern"),
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });

    it("should not log any warnings for valid configuration", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      service.validateConfiguration();

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("getOrigins", () => {
    it("should return configured origins", () => {
      const origins = service.getOrigins();

      expect(origins).toEqual(["https://example.com", "https://app.example.com"]);
    });

    it("should return empty array when no origins configured", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "cors")
          return createMockCorsConfig({
            origins: [],
          });
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [CorsService, { provide: ConfigService, useValue: mockConfigService }],
      }).compile();

      const newService = module.get<CorsService>(CorsService);
      const origins = newService.getOrigins();

      expect(origins).toEqual([]);
    });
  });

  describe("getOriginPatterns", () => {
    it("should return configured origin patterns", () => {
      const patterns = service.getOriginPatterns();

      expect(patterns).toEqual(["^https:\\/\\/.*\\.example\\.com$"]);
    });

    it("should return empty array when no patterns configured", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "cors")
          return createMockCorsConfig({
            originPatterns: [],
          });
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [CorsService, { provide: ConfigService, useValue: mockConfigService }],
      }).compile();

      const newService = module.get<CorsService>(CorsService);
      const patterns = newService.getOriginPatterns();

      expect(patterns).toEqual([]);
    });
  });

  describe("getCredentialsPolicy", () => {
    it("should return true when credentials are enabled", () => {
      const result = service.getCredentialsPolicy();

      expect(result).toBe(true);
    });

    it("should return false when credentials are disabled", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "cors")
          return createMockCorsConfig({
            credentials: false,
          });
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [CorsService, { provide: ConfigService, useValue: mockConfigService }],
      }).compile();

      const newService = module.get<CorsService>(CorsService);
      const result = newService.getCredentialsPolicy();

      expect(result).toBe(false);
    });
  });

  describe("with a bound TRUSTED_ORIGINS_RESOLVER", () => {
    type Validator = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => unknown;

    const build = async (params: { cors: Partial<ConfigCorsInterface>; resolver: TrustedOriginsResolver }) => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === "cors" ? createMockCorsConfig(params.cors) : undefined,
      );
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CorsService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: TRUSTED_ORIGINS_RESOLVER, useValue: params.resolver },
        ],
      }).compile();
      return module.get<CorsService>(CorsService);
    };

    const decide = (validator: Validator, origin: string | undefined) =>
      new Promise<{ allow: boolean | undefined; calls: number }>((resolve) => {
        const callback = vi.fn((_err: Error | null, allow?: boolean) => {
          // Let any stray second call land before resolving.
          setTimeout(() => resolve({ allow, calls: callback.mock.calls.length }), 0);
        });
        validator(origin, callback);
      });

    it("asks the resolver when the static lists reject the origin", async () => {
      const resolver = { isTrusted: vi.fn().mockResolvedValue(true), listOrigins: vi.fn() };
      const svc = await build({ cors: { origins: ["http://a.test"], originPatterns: [] }, resolver });
      const validator = svc.getCorsConfiguration().origin as Validator;

      const result = await decide(validator, "https://clienti.rossi.it");

      expect(result).toEqual({ allow: true, calls: 1 });
      expect(resolver.isTrusted).toHaveBeenCalledWith("https://clienti.rossi.it");
    });

    it("returns nothing a promise-aware CORS plugin could mistake for a second answer", async () => {
      const resolver = { isTrusted: vi.fn().mockResolvedValue(true), listOrigins: vi.fn() };
      const svc = await build({ cors: { origins: ["http://a.test"], originPatterns: [] }, resolver });
      const validator = svc.getCorsConfiguration().origin as Validator;

      expect(validator("https://clienti.rossi.it", vi.fn())).toBeUndefined();
    });

    it("rejects when the resolver says no", async () => {
      const resolver = { isTrusted: vi.fn().mockResolvedValue(false), listOrigins: vi.fn() };
      const svc = await build({ cors: { origins: ["http://a.test"], originPatterns: [] }, resolver });
      const validator = svc.getCorsConfiguration().origin as Validator;

      expect(await decide(validator, "https://evil.test")).toEqual({ allow: false, calls: 1 });
    });

    it("rejects, and logs when asked to, when the resolver throws", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const resolver = { isTrusted: vi.fn().mockRejectedValue(new Error("boom")), listOrigins: vi.fn() };
      const svc = await build({
        cors: { origins: ["http://a.test"], originPatterns: [], logViolations: true },
        resolver,
      });
      const validator = svc.getCorsConfiguration().origin as Validator;

      expect(await decide(validator, "https://clienti.rossi.it")).toEqual({ allow: false, calls: 1 });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "CORS: Trusted-origins resolver failed for origin: https://clienti.rossi.it",
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });

    it("does not ask the resolver for an origin the static lists allow", async () => {
      const resolver = { isTrusted: vi.fn(), listOrigins: vi.fn() };
      const svc = await build({ cors: { origins: ["http://a.test"], originPatterns: [] }, resolver });
      const validator = svc.getCorsConfiguration().origin as Validator;

      expect(await decide(validator, "http://a.test")).toEqual({ allow: true, calls: 1 });
      expect(resolver.isTrusted).not.toHaveBeenCalled();
    });

    it("keeps allow-all when no lists are configured", async () => {
      const resolver = { isTrusted: vi.fn(), listOrigins: vi.fn() };
      const svc = await build({ cors: { origins: [], originPatterns: [] }, resolver });

      expect(svc.getCorsConfiguration().origin).toBe(true);
      expect(resolver.isTrusted).not.toHaveBeenCalled();
    });

    it("keeps allowing an absent Origin", async () => {
      const resolver = { isTrusted: vi.fn(), listOrigins: vi.fn() };
      const svc = await build({ cors: { origins: ["http://a.test"], originPatterns: [] }, resolver });
      const validator = svc.getCorsConfiguration().origin as Validator;

      expect(await decide(validator, undefined)).toEqual({ allow: true, calls: 1 });
      expect(resolver.isTrusted).not.toHaveBeenCalled();
    });
  });
});
