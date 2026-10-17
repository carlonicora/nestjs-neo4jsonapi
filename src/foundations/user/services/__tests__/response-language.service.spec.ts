import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResponseLanguageService } from "../response-language.service";

describe("ResponseLanguageService", () => {
  let i18nConfig: { enabled: boolean; supportedLanguages: string[] } | undefined;
  let clsStore: Record<string, unknown>;
  let configService: { get: ReturnType<typeof vi.fn> };
  let cls: {
    isActive: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
  let users: { findForLanguage: ReturnType<typeof vi.fn> };
  let service: ResponseLanguageService;

  const savedLanguage = (language: string | null) => ({ id: "user-1", language });

  beforeEach(() => {
    i18nConfig = { enabled: true, supportedLanguages: ["en", "it"] };
    clsStore = {};

    configService = { get: vi.fn((key: string) => (key === "i18n" ? i18nConfig : undefined)) };
    cls = {
      isActive: vi.fn().mockReturnValue(true),
      get: vi.fn((key: string) => clsStore[key]),
      set: vi.fn((key: string, value: unknown) => {
        clsStore[key] = value;
      }),
    };
    users = { findForLanguage: vi.fn().mockResolvedValue(undefined) };

    service = new ResponseLanguageService(configService as any, cls as any, users as any);
  });

  describe("resolve", () => {
    it("returns undefined when i18n is disabled", async () => {
      i18nConfig = { enabled: false, supportedLanguages: ["en", "it"] };
      clsStore.userId = "user-1";

      await expect(service.resolve()).resolves.toBeUndefined();
      expect(users.findForLanguage).not.toHaveBeenCalled();
    });

    it("returns undefined when the app has no i18n config", async () => {
      i18nConfig = undefined;

      await expect(service.resolve()).resolves.toBeUndefined();
    });

    it("returns cls responseLanguage without a DB call", async () => {
      clsStore.responseLanguage = "it";
      clsStore.userId = "user-1";

      await expect(service.resolve()).resolves.toBe("it");
      expect(users.findForLanguage).not.toHaveBeenCalled();
    });

    it("returns the saved language of cls userId and caches it into cls responseLanguage", async () => {
      clsStore.userId = "user-1";
      users.findForLanguage.mockResolvedValue(savedLanguage("it"));

      await expect(service.resolve()).resolves.toBe("it");
      expect(users.findForLanguage).toHaveBeenCalledWith({ userId: "user-1" });
      expect(cls.set).toHaveBeenCalledWith("responseLanguage", "it");
    });

    it("falls back to cls language, normalised, when the saved language is null", async () => {
      clsStore.userId = "user-1";
      clsStore.language = "it-IT";
      users.findForLanguage.mockResolvedValue(savedLanguage(null));

      await expect(service.resolve()).resolves.toBe("it");
    });

    it("returns the first supported language when nothing is resolvable", async () => {
      await expect(service.resolve()).resolves.toBe("en");
      expect(users.findForLanguage).not.toHaveBeenCalled();
    });

    it("does not touch cls when no cls context is active", async () => {
      cls.isActive.mockReturnValue(false);

      await expect(service.resolve()).resolves.toBe("en");
      expect(cls.get).not.toHaveBeenCalled();
      expect(cls.set).not.toHaveBeenCalled();
    });
  });

  describe("normalise", () => {
    it("reduces a regional code to the supported base language", () => {
      expect(service.normalise("it-IT")).toBe("it");
    });

    it("returns undefined for an unsupported language", () => {
      expect(service.normalise("fr")).toBeUndefined();
    });

    it("returns undefined for empty input", () => {
      expect(service.normalise("")).toBeUndefined();
      expect(service.normalise(null)).toBeUndefined();
      expect(service.normalise(undefined)).toBeUndefined();
    });
  });

  describe("resolveForUser", () => {
    it("returns the first supported language for a user with language null, without throwing", async () => {
      users.findForLanguage.mockResolvedValue(savedLanguage(null));

      await expect(service.resolveForUser({ userId: "user-1" })).resolves.toBe("en");
    });

    it("returns the saved language", async () => {
      users.findForLanguage.mockResolvedValue(savedLanguage("it"));

      await expect(service.resolveForUser({ userId: "user-1" })).resolves.toBe("it");
    });

    it("returns undefined when disabled", async () => {
      i18nConfig = { enabled: false, supportedLanguages: ["en"] };

      await expect(service.resolveForUser({ userId: "user-1" })).resolves.toBeUndefined();
      expect(users.findForLanguage).not.toHaveBeenCalled();
    });
  });

  describe("resolveForEmail", () => {
    it("returns the saved language of the user with that email", async () => {
      users.findForLanguage.mockResolvedValue(savedLanguage("it"));

      await expect(service.resolveForEmail({ email: "a@b.c" })).resolves.toBe("it");
      expect(users.findForLanguage).toHaveBeenCalledWith({ email: "a@b.c" });
    });

    it("falls back to the context language when the email has no saved language", async () => {
      clsStore.language = "it";

      await expect(service.resolveForEmail({ email: "new@b.c" })).resolves.toBe("it");
    });

    it("returns undefined when disabled", async () => {
      i18nConfig = { enabled: false, supportedLanguages: ["en"] };

      await expect(service.resolveForEmail({ email: "a@b.c" })).resolves.toBeUndefined();
    });
  });
});
