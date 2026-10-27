import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedObject } from "vitest";
import { BaseConfigInterface } from "../../../config/interfaces";
import { CacheService } from "../../../core/cache/services/cache.service";
import { EmailService } from "../../../core/email/services/email.service";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { EmailAutomationEnrollment } from "../../email-automation/entities/email-automation-enrollment";
import { EmailOptOut } from "../../email-automation/entities/email-opt-out";
import { EmailAutomationEnrollmentRepository } from "../../email-automation/repositories/email-automation-enrollment.repository";
import { EmailOptOutRepository } from "../../email-automation/repositories/email-opt-out.repository";
import { ResponseLanguageService } from "../../user/services/response-language.service";
import { EMAIL_BLAST_BATCH_SIZE, EMAIL_BLAST_JOB_NAMES } from "../email-blast.constants";
import { EmailBlast } from "../entities/email-blast";
import { EmailBlastDelivery } from "../entities/email-blast-delivery";
import { emailBlastMeta } from "../entities/email-blast.meta";
import { EmailBlastDeliveryRepository } from "../repositories/email-blast-delivery.repository";
import { EmailBlastRepository } from "../repositories/email-blast.repository";
import { EmailBlastDeliveryService } from "../services/email-blast-delivery.service";

const NOW = new Date("2026-10-27T10:00:00.000Z");
const SIXTY_MINUTES_AGO = new Date("2026-10-27T09:00:00.000Z");

describe("EmailBlastDeliveryService", () => {
  let service: EmailBlastDeliveryService;
  let jsonApiService: MockedObject<JsonApiService>;
  let deliveryRepository: MockedObject<EmailBlastDeliveryRepository>;
  let clsService: MockedObject<ClsService>;
  let blastRepository: MockedObject<EmailBlastRepository>;
  let optOutRepository: MockedObject<EmailOptOutRepository>;
  let enrollmentRepository: MockedObject<EmailAutomationEnrollmentRepository>;
  let emailService: MockedObject<EmailService>;
  let responseLanguage: MockedObject<ResponseLanguageService>;
  let configService: MockedObject<ConfigService<BaseConfigInterface>>;
  let cacheService: MockedObject<CacheService>;
  let queue: MockedObject<Queue>;
  let logger: MockedObject<AppLoggingService>;

  const blast = {
    id: "blast-1",
    subject: "Big news",
    body: "Hello {{name}}",
    replyTo: "reply@wyrd.li",
    status: "sending",
    sentCount: 0,
    failedCount: 0,
    unsubscribedCount: 0,
  } as EmailBlast;

  const buildDelivery = (id: string, overrides: Partial<EmailBlastDelivery> = {}): EmailBlastDelivery =>
    ({
      id,
      email: `${id}@wyrd.li`,
      name: undefined,
      userId: `user-${id}`,
      status: "sending",
      unsubscribeToken: `token-${id}`,
      ...overrides,
    }) as EmailBlastDelivery;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    jsonApiService = { buildSingle: vi.fn() } as unknown as MockedObject<JsonApiService>;
    deliveryRepository = {
      createSnapshot: vi.fn().mockResolvedValue(undefined),
      claimBatch: vi.fn().mockResolvedValue([]),
      markSent: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markSkipped: vi.fn().mockResolvedValue(undefined),
      failStuck: vi.fn().mockResolvedValue(undefined),
      findByUnsubscribeToken: vi.fn().mockResolvedValue(null),
      markUnsubscribed: vi.fn().mockResolvedValue(true),
    } as unknown as MockedObject<EmailBlastDeliveryRepository>;
    clsService = { get: vi.fn() } as unknown as MockedObject<ClsService>;
    blastRepository = {
      findById: vi.fn().mockResolvedValue(blast),
      markSentIfDone: vi.fn().mockResolvedValue({ ...blast, status: "sent" }),
      findSending: vi.fn().mockResolvedValue([]),
    } as unknown as MockedObject<EmailBlastRepository>;
    optOutRepository = {
      findByEmail: vi.fn().mockResolvedValue(null),
      createOptOut: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<EmailOptOutRepository>;
    enrollmentRepository = {
      findActiveByEmail: vi.fn().mockResolvedValue([]),
      finish: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<EmailAutomationEnrollmentRepository>;
    emailService = { sendEmail: vi.fn().mockResolvedValue(undefined) } as unknown as MockedObject<EmailService>;
    responseLanguage = {
      resolveForEmail: vi.fn().mockResolvedValue("en"),
    } as unknown as MockedObject<ResponseLanguageService>;
    configService = {
      get: vi.fn((key: string) => {
        if (key === "app") return { url: "https://app.test/" };
        if (key === "api") return { url: "https://api.test/" };
        return undefined;
      }),
    } as unknown as MockedObject<ConfigService<BaseConfigInterface>>;
    cacheService = {
      invalidateByType: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<CacheService>;
    queue = {
      getJob: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<Queue>;
    logger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as MockedObject<AppLoggingService>;

    service = new EmailBlastDeliveryService(
      jsonApiService,
      deliveryRepository,
      clsService,
      blastRepository,
      optOutRepository,
      enrollmentRepository,
      emailService,
      responseLanguage,
      configService,
      cacheService,
      queue,
      logger,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("processBlast", () => {
    it("processBlast loads the blast and stops when it is not sending", async () => {
      blastRepository.findById.mockResolvedValue({ ...blast, status: "draft" } as EmailBlast);

      const counts = await service.processBlast({ blastId: "blast-1" });

      expect(blastRepository.findById).toHaveBeenCalledWith({ id: "blast-1" });
      expect(deliveryRepository.createSnapshot).not.toHaveBeenCalled();
      expect(deliveryRepository.claimBatch).not.toHaveBeenCalled();
      expect(emailService.sendEmail).not.toHaveBeenCalled();
      expect(counts).toEqual({ sent: 0, skipped: 0, failed: 0 });
    });

    it("processBlast creates the snapshot then claims in batches of 50", async () => {
      const first = Array.from({ length: EMAIL_BLAST_BATCH_SIZE }, (_, i) => buildDelivery(`a${i}`));
      const second = [buildDelivery("b0")];
      deliveryRepository.claimBatch.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValue([]);

      const counts = await service.processBlast({ blastId: "blast-1" });

      expect(EMAIL_BLAST_BATCH_SIZE).toBe(50);
      expect(deliveryRepository.createSnapshot).toHaveBeenCalledWith({ blastId: "blast-1" });
      expect(deliveryRepository.createSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
        deliveryRepository.claimBatch.mock.invocationCallOrder[0],
      );
      expect(deliveryRepository.claimBatch).toHaveBeenCalledTimes(3);
      expect(deliveryRepository.claimBatch).toHaveBeenCalledWith({ blastId: "blast-1", limit: 50, claimedAt: NOW });
      expect(emailService.sendEmail).toHaveBeenCalledTimes(51);
      expect(deliveryRepository.markSent).toHaveBeenCalledTimes(51);
      expect(blastRepository.markSentIfDone).toHaveBeenCalledWith({ id: "blast-1" });
      expect(counts).toEqual({ sent: 51, skipped: 0, failed: 0 });
    });

    it("sends the emailBlast template with the rendered blast", async () => {
      deliveryRepository.claimBatch.mockResolvedValueOnce([buildDelivery("d1", { name: "Carlo" })]);

      await service.processBlast({ blastId: "blast-1" });

      expect(emailService.sendEmail).toHaveBeenCalledWith(
        "emailBlast",
        {
          to: "d1@wyrd.li",
          subject: "Big news",
          content: expect.stringContaining("Hello Carlo"),
          replyTo: "reply@wyrd.li",
          headers: {
            "List-Unsubscribe": "<https://api.test/email-blasts/unsubscribe/token-d1>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          unsubscribeAllUrl: "https://app.test/en/unsubscribe/blast/token-d1",
        },
        "en",
      );
    });

    it("processBlast skips an address that opted out after the snapshot", async () => {
      deliveryRepository.claimBatch.mockResolvedValueOnce([buildDelivery("d1")]);
      optOutRepository.findByEmail.mockResolvedValue({ id: "o1", email: "d1@wyrd.li" } as EmailOptOut);

      const counts = await service.processBlast({ blastId: "blast-1" });

      expect(optOutRepository.findByEmail).toHaveBeenCalledWith({ email: "d1@wyrd.li" });
      expect(deliveryRepository.markSkipped).toHaveBeenCalledWith({ id: "d1" });
      expect(emailService.sendEmail).not.toHaveBeenCalled();
      expect(deliveryRepository.markSent).not.toHaveBeenCalled();
      expect(counts).toEqual({ sent: 0, skipped: 1, failed: 0 });
    });

    it("a send error marks the delivery failed, with no second sendEmail", async () => {
      deliveryRepository.claimBatch.mockResolvedValueOnce([buildDelivery("d1")]);
      emailService.sendEmail.mockRejectedValue(new Error("provider down"));

      const counts = await service.processBlast({ blastId: "blast-1" });

      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
      expect(deliveryRepository.markFailed).toHaveBeenCalledWith({ id: "d1", error: "provider down" });
      expect(deliveryRepository.markSent).not.toHaveBeenCalled();
      expect(counts).toEqual({ sent: 0, skipped: 0, failed: 1 });
    });

    it("markSent runs only after a successful send, outside the send try", async () => {
      deliveryRepository.claimBatch.mockResolvedValueOnce([buildDelivery("d1")]);
      deliveryRepository.markSent.mockRejectedValue(new Error("database down"));

      await service.processBlast({ blastId: "blast-1" });

      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
      expect(deliveryRepository.markSent).toHaveBeenCalledWith({ id: "d1", sentAt: NOW });
      expect(emailService.sendEmail.mock.invocationCallOrder[0]).toBeLessThan(
        deliveryRepository.markSent.mock.invocationCallOrder[0],
      );
      // A database error after the send never counts a delivered email as failed.
      expect(deliveryRepository.markFailed).not.toHaveBeenCalled();
    });

    it("processBlast invalidates the email-blasts cache after each batch and at the end", async () => {
      deliveryRepository.claimBatch
        .mockResolvedValueOnce([buildDelivery("d1")])
        .mockResolvedValueOnce([buildDelivery("d2")])
        .mockResolvedValue([]);

      await service.processBlast({ blastId: "blast-1" });

      // after the snapshot, after each of the two batches, after the final status change
      expect(cacheService.invalidateByType).toHaveBeenCalledTimes(4);
      expect(cacheService.invalidateByType).toHaveBeenCalledWith(emailBlastMeta.endpoint);
      const lastInvalidate = cacheService.invalidateByType.mock.invocationCallOrder.at(-1) ?? 0;
      expect(blastRepository.markSentIfDone.mock.invocationCallOrder[0]).toBeLessThan(lastInvalidate);
    });

    it("processBlast resumes without resending claimed deliveries", async () => {
      deliveryRepository.claimBatch.mockResolvedValue([]);

      const counts = await service.processBlast({ blastId: "blast-1" });

      expect(deliveryRepository.createSnapshot).toHaveBeenCalledWith({ blastId: "blast-1" });
      expect(emailService.sendEmail).not.toHaveBeenCalled();
      expect(deliveryRepository.markSent).not.toHaveBeenCalled();
      expect(blastRepository.markSentIfDone).toHaveBeenCalledWith({ id: "blast-1" });
      expect(counts).toEqual({ sent: 0, skipped: 0, failed: 0 });
    });

    it("a missing locale falls back to en", async () => {
      deliveryRepository.claimBatch.mockResolvedValueOnce([buildDelivery("d1")]);
      responseLanguage.resolveForEmail.mockResolvedValue(undefined);

      await service.processBlast({ blastId: "blast-1" });

      expect(responseLanguage.resolveForEmail).toHaveBeenCalledWith({ email: "d1@wyrd.li" });
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        "emailBlast",
        expect.objectContaining({ unsubscribeAllUrl: "https://app.test/en/unsubscribe/blast/token-d1" }),
        "en",
      );
    });
  });

  describe("recoverStuck", () => {
    it("recoverStuck fails deliveries claimed over 60 minutes ago and re-enqueues sending blasts", async () => {
      blastRepository.findSending.mockResolvedValue([blast]);

      await service.recoverStuck({ now: NOW });

      expect(deliveryRepository.failStuck).toHaveBeenCalledWith({ claimedBefore: SIXTY_MINUTES_AGO });
      expect(queue.add).toHaveBeenCalledWith(
        EMAIL_BLAST_JOB_NAMES.sendBlast,
        { blastId: "blast-1" },
        expect.objectContaining({ jobId: "email-blast-blast-1", attempts: 1 }),
      );
      expect(cacheService.invalidateByType).toHaveBeenCalledWith(emailBlastMeta.endpoint);
    });

    it("recoverStuck removes a failed job with the same jobId before adding it again", async () => {
      blastRepository.findSending.mockResolvedValue([blast]);
      const failedJob = {
        isFailed: vi.fn().mockResolvedValue(true),
        remove: vi.fn().mockResolvedValue(undefined),
      } as unknown as MockedObject<Job>;
      queue.getJob.mockResolvedValue(failedJob);

      await service.recoverStuck({ now: NOW });

      expect(queue.getJob).toHaveBeenCalledWith("email-blast-blast-1");
      expect(failedJob.remove).toHaveBeenCalledTimes(1);
      expect(failedJob.remove.mock.invocationCallOrder[0]).toBeLessThan(queue.add.mock.invocationCallOrder[0]);
    });

    it("leaves a job that has not failed in place", async () => {
      blastRepository.findSending.mockResolvedValue([blast]);
      const activeJob = {
        isFailed: vi.fn().mockResolvedValue(false),
        remove: vi.fn().mockResolvedValue(undefined),
      } as unknown as MockedObject<Job>;
      queue.getJob.mockResolvedValue(activeJob);

      await service.recoverStuck({ now: NOW });

      expect(activeJob.remove).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribe", () => {
    const delivery = buildDelivery("d1", { status: "sent" });

    it("unknown token answers 404", async () => {
      deliveryRepository.findByUnsubscribeToken.mockResolvedValue(null);

      await expect(service.unsubscribe({ token: "nope", source: "link" })).rejects.toBeInstanceOf(NotFoundException);
      expect(deliveryRepository.markUnsubscribed).not.toHaveBeenCalled();
      expect(optOutRepository.createOptOut).not.toHaveBeenCalled();
    });

    it("unsubscribe is idempotent and counts once", async () => {
      deliveryRepository.findByUnsubscribeToken.mockResolvedValue(delivery);
      deliveryRepository.markUnsubscribed.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await service.unsubscribe({ token: "token-d1", source: "link" });
      await service.unsubscribe({ token: "token-d1", source: "header" });

      // The repository guard counts once; the service never increments by itself.
      expect(deliveryRepository.markUnsubscribed).toHaveBeenCalledTimes(2);
      expect(deliveryRepository.markUnsubscribed).toHaveBeenCalledWith({ id: "d1", unsubscribedAt: NOW });
      expect(optOutRepository.createOptOut).toHaveBeenCalledTimes(2);
      expect(optOutRepository.createOptOut).toHaveBeenLastCalledWith({
        id: expect.any(String),
        email: "d1@wyrd.li",
        optedOutAt: NOW,
        source: "header",
      });
    });

    it("unsubscribe finishes active automation enrolments of the email", async () => {
      deliveryRepository.findByUnsubscribeToken.mockResolvedValue(delivery);
      enrollmentRepository.findActiveByEmail.mockResolvedValue([
        { id: "enr-1" } as EmailAutomationEnrollment,
        { id: "enr-2" } as EmailAutomationEnrollment,
      ]);

      await service.unsubscribe({ token: "token-d1", source: "link" });

      expect(enrollmentRepository.findActiveByEmail).toHaveBeenCalledWith({ email: "d1@wyrd.li" });
      expect(enrollmentRepository.finish).toHaveBeenCalledWith({
        enrollmentId: "enr-1",
        status: "unsubscribed",
        finishedAt: NOW,
      });
      expect(enrollmentRepository.finish).toHaveBeenCalledWith({
        enrollmentId: "enr-2",
        status: "unsubscribed",
        finishedAt: NOW,
      });
    });
  });
});
