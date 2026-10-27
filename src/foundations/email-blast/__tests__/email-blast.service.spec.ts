import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedObject } from "vitest";
import { BaseConfigInterface } from "../../../config/interfaces";
import { EmailService } from "../../../core/email/services/email.service";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { JsonApiDTOData } from "../../../core/neo4j/abstracts/abstract.service";
import { User } from "../../user/entities/user";
import { UserRepository } from "../../user/repositories/user.repository";
import { ResponseLanguageService } from "../../user/services/response-language.service";
import { EMAIL_BLAST_JOB_NAMES } from "../email-blast.constants";
import { EmailBlast } from "../entities/email-blast";
import { EmailBlastAudience } from "../entities/email-blast-audience";
import { EmailBlastAdminRepository } from "../repositories/email-blast.admin.repository";
import { EmailBlastRepository } from "../repositories/email-blast.repository";
import { EmailBlastService } from "../services/email-blast.service";

describe("EmailBlastService", () => {
  let service: EmailBlastService;
  let jsonApiService: MockedObject<JsonApiService>;
  let blastRepository: MockedObject<EmailBlastRepository>;
  let clsService: MockedObject<ClsService>;
  let adminRepository: MockedObject<EmailBlastAdminRepository>;
  let userRepository: MockedObject<UserRepository>;
  let responseLanguage: MockedObject<ResponseLanguageService>;
  let emailService: MockedObject<EmailService>;
  let configService: MockedObject<ConfigService<BaseConfigInterface>>;
  let queue: MockedObject<Queue>;

  const buildBlast = (overrides: Partial<EmailBlast> = {}): EmailBlast =>
    ({
      id: "blast-1",
      subject: "Big news",
      body: "Hello {{name}}",
      status: "draft",
      sentCount: 0,
      failedCount: 0,
      unsubscribedCount: 0,
      ...overrides,
    }) as EmailBlast;

  beforeEach(() => {
    jsonApiService = {
      buildSingle: vi.fn().mockResolvedValue({ data: { id: "blast-1" } }),
    } as unknown as MockedObject<JsonApiService>;
    blastRepository = {
      findById: vi.fn().mockResolvedValue(buildBlast()),
      markSending: vi.fn().mockResolvedValue(buildBlast({ status: "sending" })),
    } as unknown as MockedObject<EmailBlastRepository>;
    clsService = {
      get: vi.fn((key: string) => (key === "userId" ? "admin-1" : undefined)),
    } as unknown as MockedObject<ClsService>;
    adminRepository = {
      countEligibleRecipients: vi.fn().mockResolvedValue({ id: "blast-1", recipientCount: 3 }),
    } as unknown as MockedObject<EmailBlastAdminRepository>;
    userRepository = {
      findOneForAdmin: vi.fn().mockResolvedValue({ id: "admin-1", email: "admin@wyrd.li", name: "Admin" } as User),
    } as unknown as MockedObject<UserRepository>;
    responseLanguage = {
      resolveForEmail: vi.fn().mockResolvedValue("it"),
    } as unknown as MockedObject<ResponseLanguageService>;
    emailService = {
      sendEmail: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<EmailService>;
    configService = {
      get: vi.fn((key: string) => {
        if (key === "app") return { url: "https://app.test/" };
        if (key === "api") return { url: "https://api.test/" };
        return undefined;
      }),
    } as unknown as MockedObject<ConfigService<BaseConfigInterface>>;
    queue = {
      add: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<Queue>;

    service = new EmailBlastService(
      jsonApiService,
      blastRepository,
      clsService,
      adminRepository,
      userRepository,
      responseLanguage,
      emailService,
      configService,
      queue,
    );
  });

  it("patch and delete refuse a non-draft blast", async () => {
    blastRepository.findById.mockResolvedValue(buildBlast({ status: "sent" }));

    await expect(
      service.patchFromDTO({
        data: { id: "blast-1", type: "email-blasts", attributes: { subject: "x" } } as JsonApiDTOData,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.delete({ id: "blast-1" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("send refuses when nobody is eligible", async () => {
    adminRepository.countEligibleRecipients.mockResolvedValue({
      id: "blast-1",
      recipientCount: 0,
    } as EmailBlastAudience);

    await expect(service.send({ id: "blast-1" })).rejects.toBeInstanceOf(BadRequestException);
    expect(blastRepository.markSending).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("send refuses a blast that is no longer draft", async () => {
    blastRepository.markSending.mockResolvedValue(null);

    await expect(service.send({ id: "blast-1" })).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("send enqueues send-blast with jobId email-blast-<id>", async () => {
    const result = await service.send({ id: "blast-1" });

    expect(blastRepository.markSending).toHaveBeenCalledWith({ id: "blast-1", sentAt: expect.any(Date) });
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, data, options] = queue.add.mock.calls[0];
    expect(name).toBe(EMAIL_BLAST_JOB_NAMES.sendBlast);
    expect(name).toBe("send-blast");
    expect(data).toEqual({ blastId: "blast-1" });
    expect(options?.jobId).toBe("email-blast-blast-1");
    expect(options?.jobId).not.toContain(":");
    expect(options?.attempts).toBe(1);
    expect(result).toEqual({ data: { id: "blast-1" } });
  });

  it("sendTest sends only to the caller with [TEST] subject and token test, creating no delivery", async () => {
    await service.sendTest({ id: "blast-1" });

    expect(userRepository.findOneForAdmin).toHaveBeenCalledWith({ userId: "admin-1" });
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    const [templateId, params, locale] = emailService.sendEmail.mock.calls[0];
    expect(templateId).toBe("emailBlast");
    expect(locale).toBe("it");
    expect(params.to).toBe("admin@wyrd.li");
    expect(params.subject).toBe("[TEST] Big news");
    expect(params.unsubscribeAllUrl).toBe("https://app.test/it/unsubscribe/blast/test");
    expect(params.headers?.["List-Unsubscribe"]).toBe("<https://api.test/email-blasts/unsubscribe/test>");
    expect(blastRepository.markSending).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("sendTest refuses a non-draft blast", async () => {
    blastRepository.findById.mockResolvedValue(buildBlast({ status: "sending" }));

    await expect(service.sendTest({ id: "blast-1" })).rejects.toBeInstanceOf(BadRequestException);
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });
});
