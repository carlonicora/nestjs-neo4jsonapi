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

// Mock the Brevo SDK
const brevo = vi.hoisted(() => {
  const sendTransacEmail = vi.fn();
  const constructedWith = vi.fn();
  class BrevoClient {
    transactionalEmails = { sendTransacEmail };
    constructor(options: unknown) {
      constructedWith(options);
    }
  }
  return { sendTransacEmail, constructedWith, BrevoClient };
});

vi.mock("@getbrevo/brevo", () => ({
  BrevoClient: brevo.BrevoClient,
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
import { join, sep } from "path";
import { AppLoggingService } from "../../../logging/services/logging.service";
import { EmailService } from "../email.service";
import sendGridMail = require("@sendgrid/mail");

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

      expect(compiledTemplate.mock.calls[0][0]).toEqual(
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

  describe("brevo provider", () => {
    beforeEach(() => {
      emailConfig.emailProvider = "brevo";
      brevo.sendTransacEmail.mockResolvedValue({ messageId: "<123@brevo>" });
    });

    it("should authenticate the client with the configured api key", async () => {
      await service.sendEmail("welcome", { to: "user@example.com" }, "en");

      expect(brevo.constructedWith).toHaveBeenCalledWith({ apiKey: "test-api-key" });
    });

    it("should send the email through the transactional emails resource", async () => {
      await service.sendEmail("welcome", { to: "John Doe <user@example.com>", name: "John" }, "en");

      expect(brevo.sendTransacEmail).toHaveBeenCalledWith({
        subject: "Test Subject",
        htmlContent: expect.stringContaining("Hello John"),
        sender: { name: "Test", email: "test@example.com" },
        to: [{ name: "John Doe", email: "user@example.com" }],
      });
    });

    it("should handle an array of recipients", async () => {
      await service.sendEmail("welcome", { to: ["user1@example.com", "user2@example.com"] }, "en");

      expect(brevo.sendTransacEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: [
            { name: "user1@example.com", email: "user1@example.com" },
            { name: "user2@example.com", email: "user2@example.com" },
          ],
        }),
      );
    });

    it("should log and rethrow when Brevo rejects", async () => {
      const brevoError = Object.assign(new Error("Brevo rejected"), {
        statusCode: 400,
        body: { message: "Invalid sender" },
      });
      brevo.sendTransacEmail.mockRejectedValue(brevoError);

      await expect(service.sendEmail("welcome", { to: "user@example.com" }, "en")).rejects.toThrow("Brevo rejected");

      expect(mockLogger.error).toHaveBeenCalledWith("Error sending email via Brevo", brevoError, "EmailService", {
        brevoStatusCode: 400,
        brevoBody: { message: "Invalid sender" },
      });
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
      // registerHelper is overloaded; select the (name, fn) signature the service uses.
      const registerHelper = Handlebars.registerHelper as (name: string, fn: Handlebars.HelperDelegate) => void;
      const registerHelperCalls = vi.mocked(registerHelper).mock.calls;
      const eqHelperCall = registerHelperCalls.find((call) => call[0] === "eq");
      expect(eqHelperCall).toBeDefined();

      const eqHelper = eqHelperCall![1] as (a: any, b: any) => boolean;
      expect(eqHelper("a", "a")).toBe(true);
      expect(eqHelper("a", "b")).toBe(false);
      expect(eqHelper(1, 1)).toBe(true);
      expect(eqHelper(1, "1")).toBe(false);
    });
  });

  describe("configurable default template locale", () => {
    it("falls back to the configured defaultLocale when the requested locale has no template", async () => {
      const itConfig = { ...emailConfig, defaultLocale: "it" };
      const enSegment = join("email", "en") + sep;
      vi.mocked(fs.existsSync).mockImplementation((p: any) => !String(p).includes(enSegment));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          {
            provide: ConfigService,
            useValue: { get: vi.fn((key: string) => (key === "email" ? itConfig : appConfig)) },
          },
          { provide: AppLoggingService, useValue: { error: vi.fn(), log: vi.fn(), warn: vi.fn() } },
        ],
      }).compile();
      const svc = module.get<EmailService>(EmailService);

      await svc.sendEmail("taskCompleted", { to: "user@example.com", name: "Mario" }, "en");

      const readPaths = vi.mocked(fs.readFileSync).mock.calls.map((call) => String(call[0]));
      expect(readPaths.some((p) => p.includes(join("it", "taskCompleted.hbs")))).toBe(true);
      expect(readPaths.some((p) => p.includes(join("en", "taskCompleted.hbs")))).toBe(false);
    });
  });

  describe("per-locale header and footer partials", () => {
    const itFooterPath = join("templates", "email", "it", "footer.hbs");
    const itHeaderPath = join("templates", "email", "it", "header.hbs");
    const rootFooterPath = join("templates", "email", "footer.hbs");

    const renderWithPartials = vi.fn(
      (_data: any, options?: { partials?: Record<string, string> }) =>
        `<html><head><title>T</title></head><body>${options?.partials?.footer ?? "ROOT FOOTER"}</body></html>`,
    );

    beforeEach(() => {
      renderWithPartials.mockClear();
      vi.mocked(Handlebars.compile).mockReturnValue(renderWithPartials as any);
      vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
        const pathStr = String(p);
        if (pathStr.endsWith(itFooterPath)) return "<footer>Piè di pagina italiano</footer>";
        if (pathStr.endsWith(rootFooterPath)) return "<footer>Root footer</footer>";
        return mockTemplateContent;
      });
    });

    it("renders the Italian footer when templates/email/it/footer.hbs exists", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "1" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail: mockSendMail } as any);
      vi.mocked(fs.existsSync).mockImplementation((p: any) => !String(p).endsWith(itHeaderPath));

      await service.sendEmail("x", { to: "user@example.com" }, "it");

      expect(renderWithPartials).toHaveBeenCalledWith(expect.any(Object), {
        data: { locale: "it" },
        partials: { footer: "<footer>Piè di pagina italiano</footer>" },
      });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ html: expect.stringContaining("Piè di pagina italiano") }),
      );
    });

    it("keeps the globally registered root footer when the locale has no footer.hbs", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "1" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail: mockSendMail } as any);
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const pathStr = String(p);
        return !pathStr.endsWith(itFooterPath) && !pathStr.endsWith(itHeaderPath);
      });

      await service.sendEmail("x", { to: "user@example.com" }, "it");

      expect(renderWithPartials).toHaveBeenCalledTimes(1);
      expect(renderWithPartials.mock.calls[0][1]).toEqual({ data: { locale: "it" } });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ html: expect.stringContaining("ROOT FOOTER") }),
      );
    });
  });

  describe("dates in the recipient's language", () => {
    it("passes the email's locale to the template as @locale", async () => {
      const render = vi.fn(
        (_data: unknown, _options?: unknown) => "<html><head><title>T</title></head><body>ok</body></html>",
      );
      vi.mocked(Handlebars.compile).mockReturnValue(render as any);
      vi.mocked(fs.existsSync).mockImplementation(
        (p: any) => !/[\\/](it|en)[\\/](header|footer)\.hbs$/.test(String(p)),
      );

      await service.sendEmail("x", { to: "user@example.com" }, "it");
      await service.sendEmail("x", { to: "user@example.com" }, "en");

      expect(render.mock.calls[0][1]).toEqual({ data: { locale: "it" } });
      expect(render.mock.calls[1][1]).toEqual({ data: { locale: "en" } });
    });

    it("renders {{formatDateTime}} in Italian for an Italian email and unchanged in English", async () => {
      const real = await vi.importActual<typeof import("handlebars")>("handlebars");
      const instance = ((real as any).default ?? real).create() as typeof Handlebars;
      const { registerEmailTemplateHelpers } =
        await vi.importActual<typeof import("../../email.helpers")>("../../email.helpers");
      registerEmailTemplateHelpers(instance as any);
      const source = "<html><head><title>T</title></head><body>{{formatDateTime expiresAt}}</body></html>";
      vi.mocked(fs.readFileSync).mockReturnValue(source);
      vi.mocked(fs.existsSync).mockImplementation(
        (p: any) => !/[\\/](it|en)[\\/](header|footer)\.hbs$/.test(String(p)),
      );
      vi.mocked(Handlebars.compile).mockImplementation(((src: string) => instance.compile(src)) as any);
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "1" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail: mockSendMail } as any);

      await service.sendEmail("x", { to: "user@example.com", expiresAt: "2026-08-09T14:32:05.000Z" }, "it");
      await service.sendEmail("x", { to: "user@example.com", expiresAt: "2026-08-09T14:32:05.000Z" }, "en");

      const italian = mockSendMail.mock.calls[0][0].html as string;
      expect(italian).toContain("9 agosto 2026");
      expect(italian).toContain("14:32 UTC");
      expect(mockSendMail.mock.calls[1][0].html).toBe(
        "<html><head><title>T</title></head><body>9 August 2026 at 14:32 UTC</body></html>",
      );
    });
  });

  describe("sendRendered", () => {
    it("sends pre-rendered html through the SMTP transport without touching templates", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "abc" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail: mockSendMail } as any);
      vi.mocked(fs.readFileSync).mockClear();

      await service.sendRendered({
        to: "client@example.com",
        subject: "Accesso alla tua pratica",
        html: "<html><body>ciao</body></html>",
        attachments: [{ filename: "a.pdf", content: Buffer.from("x"), contentType: "application/pdf" }],
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: emailConfig.emailFrom,
          to: "client@example.com",
          subject: "Accesso alla tua pratica",
          html: "<html><body>ciao</body></html>",
          attachments: [{ filename: "a.pdf", content: Buffer.from("x"), contentType: "application/pdf" }],
        }),
      );
      expect(Handlebars.compile).not.toHaveBeenCalled();
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it("routes to SendGrid when the provider is sendgrid", async () => {
      emailConfig.emailProvider = "sendgrid";
      const spy = vi.spyOn(service as any, "sendEmailWithSendGrid").mockResolvedValue(undefined);

      await service.sendRendered({ to: ["a@x.it", "b@x.it"], subject: "S", html: "<p>h</p>" });

      expect(spy).toHaveBeenCalledWith(["a@x.it", "b@x.it"], "S", "<p>h</p>", undefined, undefined, undefined);
    });

    it("rethrows a transport failure after logging it", async () => {
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: vi.fn().mockRejectedValue(new Error("boom")),
      } as any);

      await expect(service.sendRendered({ to: "c@x.it", subject: "S", html: "<p>h</p>" })).rejects.toThrow("boom");
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("reply-to and headers", () => {
    const replyTo = "a@b.c";
    const headers = { "List-Unsubscribe": "<x>" };

    it("passes replyTo and headers to the SMTP transport", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail: mockSendMail } as any);

      await service.sendEmail("welcome", { to: "user@example.com", replyTo, headers }, "en");

      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ replyTo: "a@b.c", headers }));
    });

    it("maps replyTo to an address object and passes headers on Brevo", async () => {
      emailConfig.emailProvider = "brevo";
      brevo.sendTransacEmail.mockResolvedValue({ messageId: "<123@brevo>" });

      await service.sendEmail("welcome", { to: "user@example.com", replyTo, headers }, "en");

      expect(brevo.sendTransacEmail).toHaveBeenCalledWith(
        expect.objectContaining({ replyTo: { email: "a@b.c", name: "a@b.c" }, headers }),
      );
    });

    it("passes replyTo and headers to SendGrid", async () => {
      emailConfig.emailProvider = "sendgrid";
      const setApiKey = vi.spyOn(sendGridMail, "setApiKey").mockImplementation(() => undefined);
      const send = vi.spyOn(sendGridMail, "send").mockResolvedValue([] as any);

      await service.sendEmail("welcome", { to: "user@example.com", replyTo, headers }, "en");

      expect(send).toHaveBeenCalledWith(expect.objectContaining({ replyTo: "a@b.c", headers }));
      setApiKey.mockRestore();
      send.mockRestore();
    });

    it("keeps replyTo and headers out of the template params", async () => {
      const template = vi.fn().mockReturnValue("<html><head><title>T</title></head><body></body></html>");
      vi.mocked(Handlebars.compile).mockReturnValue(template as any);

      await service.sendEmail("welcome", { to: "user@example.com", replyTo, headers, name: "John" }, "en");

      const templateParams = template.mock.calls[0][0];
      expect(templateParams).toEqual(expect.objectContaining({ name: "John" }));
      expect(templateParams).not.toHaveProperty("replyTo");
      expect(templateParams).not.toHaveProperty("headers");
    });

    it("sends no replyTo or headers keys when none are given", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail: mockSendMail } as any);

      await service.sendEmail("welcome", { to: "user@example.com" }, "en");

      expect(mockSendMail.mock.calls[0][0]).not.toHaveProperty("replyTo");
      expect(mockSendMail.mock.calls[0][0]).not.toHaveProperty("headers");
    });
  });
});
