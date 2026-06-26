import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";

// Mock fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock nodemailer
vi.mock("nodemailer", () => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn(),
  })),
}));

// Email config consumed via the injected ConfigService mock (this.config.get("email"))
const emailConfig = {
  emailProvider: "smtp",
  emailApiKey: "test-api-key",
  emailFrom: "Test <test@example.com>",
  emailHost: "smtp.example.com",
  emailPort: 587,
  emailSecure: false,
  emailUsername: "user",
  emailPassword: "pass",
};

// App config consumed via the injected ConfigService mock (this.config.get("app"))
const appConfig = {
  url: "https://example.com",
};

// Mock Handlebars
vi.mock("handlebars", () => ({
  default: {
    compile: vi.fn(),
    registerHelper: vi.fn(),
    registerPartial: vi.fn(),
  },
  compile: vi.fn(),
  registerHelper: vi.fn(),
  registerPartial: vi.fn(),
}));

import * as fs from "fs";
import * as nodemailer from "nodemailer";
import * as Handlebars from "handlebars";
import { AppLoggingService } from "../../../logging/services/logging.service";
import { EmailService } from "../email.service";

describe("EmailService", () => {
  let service: EmailService;
  let mockLogger: { error: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

  const mockTemplateContent = `
    <!DOCTYPE html>
    <html>
    <head><title>Test Subject</title></head>
    <body>Hello {{name}}</body>
    </html>
  `;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup fs mocks
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(mockTemplateContent);

    // Setup Handlebars mock
    vi.mocked(Handlebars.compile).mockReturnValue(
      ((data: any) =>
        `<html><head><title>Test Subject</title></head><body>Hello ${data?.name || ""}</body></html>`) as any,
    );

    // Setup nodemailer mock
    const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail: mockSendMail,
    } as any);

    // Reset config to defaults
    emailConfig.emailProvider = "smtp";
    emailConfig.emailApiKey = "test-api-key";

    mockLogger = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };

    const mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === "email") return emailConfig;
        if (key === "app") return appConfig;
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AppLoggingService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should register eq helper", () => {
      expect(Handlebars.registerHelper).toHaveBeenCalledWith("eq", expect.any(Function));
    });

    it("should register header partial when file exists", () => {
      expect(Handlebars.registerPartial).toHaveBeenCalledWith("header", expect.any(String));
    });

    it("should register footer partial when file exists", () => {
      expect(Handlebars.registerPartial).toHaveBeenCalledWith("footer", expect.any(String));
    });

    it("should log error when header partial not found", async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (String(path).includes("header.hbs")) return false;
        return true;
      });

      const freshLogger = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };
      await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: { get: vi.fn(() => emailConfig) } },
          { provide: AppLoggingService, useValue: freshLogger },
        ],
      }).compile();

      expect(freshLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Partial header.hbs not found"),
        undefined,
        "EmailService",
      );
    });

    it("should log error when footer partial not found", async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (String(path).includes("footer.hbs")) return false;
        return true;
      });

      const freshLogger = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };
      await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: { get: vi.fn(() => emailConfig) } },
          { provide: AppLoggingService, useValue: freshLogger },
        ],
      }).compile();

      expect(freshLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Partial footer.hbs not found"),
        undefined,
        "EmailService",
      );
    });
  });

  describe("sendEmail", () => {
    it("should send email via SMTP when provider is smtp", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);

      await service.sendEmail("welcome", { to: "user@example.com", name: "John" }, "en");

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: {
          user: "user",
          pass: "pass",
        },
      });
      expect(mockSendMail).toHaveBeenCalledWith({
        from: "Test <test@example.com>",
        to: "user@example.com",
        subject: "Test Subject",
        html: expect.any(String),
      });
    });

    it("should extract subject from template title tag", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);

      await service.sendEmail("welcome", { to: "user@example.com", name: "John" }, "en");

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Test Subject",
        }),
      );
    });

    it("should use provided subject over extracted title", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);

      await service.sendEmail("welcome", { to: "user@example.com", name: "John", subject: "Custom Subject" }, "en");

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Custom Subject",
        }),
      );
    });

    it("should add app url to params if not provided", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);

      const compiledTemplate = vi.fn((data: any) => {
        expect(data.url).toBe("https://example.com");
        return "<html><head><title>Test</title></head><body></body></html>";
      });
      vi.mocked(Handlebars.compile).mockReturnValue(compiledTemplate as any);

      await service.sendEmail("welcome", { to: "user@example.com", name: "John" }, "en");

      expect(compiledTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com",
        }),
      );
    });

    it("should throw error when template compilation fails", async () => {
      vi.mocked(Handlebars.compile).mockImplementation(() => {
        throw new Error("Compilation error");
      });

      await expect(service.sendEmail("welcome", { to: "user@example.com" }, "en")).rejects.toThrow(
        "Failed to compile email template",
      );
    });

    it("should throw error when sending fails", async () => {
      const mockSendMail = vi.fn().mockRejectedValue(new Error("SMTP error"));
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);

      await expect(service.sendEmail("welcome", { to: "user@example.com" }, "en")).rejects.toThrow("SMTP error");
    });

    it("should handle array of recipients", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);

      await service.sendEmail("welcome", { to: ["user1@example.com", "user2@example.com"], name: "Team" }, "en");

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ["user1@example.com", "user2@example.com"],
        }),
      );
    });

    it("should handle empty subject when no title in template", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);

      vi.mocked(Handlebars.compile).mockReturnValue((() => "<html><head></head><body>No title</body></html>") as any);

      await service.sendEmail("welcome", { to: "user@example.com" }, "en");

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "",
        }),
      );
    });
  });

  describe("loadTemplate", () => {
    it("should load template from app locale path first", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (String(path).includes("/en/welcome.hbs") && String(path).includes("templates/email")) return true;
        if (String(path).includes("header.hbs") || String(path).includes("footer.hbs")) return true;
        return false;
      });

      await service.sendEmail("welcome", { to: "user@example.com" }, "en");

      expect(fs.readFileSync).toHaveBeenCalled();
    });

    it("should fallback to en locale when specified locale not found", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);

      let calledWithFrPath = false;
      let calledWithEnPath = false;

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        const pathStr = String(path);
        if (pathStr.includes("/fr/welcome.hbs")) {
          calledWithFrPath = true;
          return false;
        }
        if (pathStr.includes("/en/welcome.hbs")) {
          calledWithEnPath = true;
          return true;
        }
        if (pathStr.includes("header.hbs") || pathStr.includes("footer.hbs")) return true;
        return false;
      });

      await service.sendEmail("welcome", { to: "user@example.com" }, "fr");

      expect(calledWithFrPath).toBe(true);
      expect(calledWithEnPath).toBe(true);
    });

    it("should throw error when template not found anywhere", async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (String(path).includes("header.hbs") || String(path).includes("footer.hbs")) return true;
        if (String(path).includes("welcome.hbs")) return false;
        return false;
      });

      await expect(service.sendEmail("welcome", { to: "user@example.com" }, "en")).rejects.toThrow(
        'Template file not found for template "welcome"',
      );
    });

    it("should load unsubscribe partial if exists", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (String(path).includes("unsubscribe.hbs")) return true;
        return true;
      });

      await service.sendEmail("welcome", { to: "user@example.com" }, "en");

      expect(Handlebars.registerPartial).toHaveBeenCalledWith("unsubscribe", expect.any(String));
    });

    it("should fallback to en unsubscribe partial when locale not found", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);

      let checkedFrUnsubscribe = false;
      let checkedEnUnsubscribe = false;

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        const pathStr = String(path);
        if (pathStr.includes("/fr/unsubscribe.hbs")) {
          checkedFrUnsubscribe = true;
          return false;
        }
        if (pathStr.includes("/en/unsubscribe.hbs")) {
          checkedEnUnsubscribe = true;
          return true;
        }
        return true;
      });

      await service.sendEmail("welcome", { to: "user@example.com" }, "fr");

      expect(checkedFrUnsubscribe).toBe(true);
      expect(checkedEnUnsubscribe).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should handle SMTP transport errors", async () => {
      const mockSendMail = vi.fn().mockRejectedValue(new Error("Connection refused"));
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);

      await expect(service.sendEmail("welcome", { to: "user@example.com" }, "en")).rejects.toThrow(
        "Connection refused",
      );

      expect(mockLogger.error).toHaveBeenCalledWith("Error sending SMTP email", expect.any(Error), "EmailService");
    });

    it("should log error when sending email fails", async () => {
      const mockSendMail = vi.fn().mockRejectedValue(new Error("Network error"));
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);

      await expect(service.sendEmail("welcome", { to: "user@example.com" }, "en")).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("Handlebars eq helper", () => {
    it("should register eq helper that compares values", () => {
      const registerHelperCalls = vi.mocked(Handlebars.registerHelper).mock.calls;
      const eqHelperCall = registerHelperCalls.find((call) => call[0] === "eq");
      expect(eqHelperCall).toBeDefined();

      const eqHelper = eqHelperCall![1] as (a: any, b: any) => boolean;
      expect(eqHelper("a", "a")).toBe(true);
      expect(eqHelper("a", "b")).toBe(false);
      expect(eqHelper(1, 1)).toBe(true);
      expect(eqHelper(1, "1")).toBe(false);
    });
  });
});
