import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { BackoffOptions, Queue } from "bullmq";
import { TrialQueueService } from "../trial-queue.service";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { QueueId } from "../../../../config/enums/queue.id";

describe("TrialQueueService", () => {
  let service: TrialQueueService;
  let trialQueue: MockedObject<Queue>;
  let logger: MockedObject<AppLoggingService>;

  const TEST_IDS = {
    companyId: "550e8400-e29b-41d4-a716-446655440000",
    userId: "660e8400-e29b-41d4-a716-446655440001",
  };

  const createMockQueue = () => ({
    add: vi.fn(),
    addBulk: vi.fn(),
    getJob: vi.fn(),
    getJobs: vi.fn(),
  });

  const createMockLogger = () => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrialQueueService,
        { provide: getQueueToken(QueueId.TRIAL), useValue: createMockQueue() },
        { provide: AppLoggingService, useValue: createMockLogger() },
      ],
    }).compile();

    service = module.get<TrialQueueService>(TrialQueueService);
    trialQueue = module.get(getQueueToken(QueueId.TRIAL)) as MockedObject<Queue>;
    logger = module.get(AppLoggingService) as MockedObject<AppLoggingService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("queueTrialCreation", () => {
    it("should add a job to the trial queue with correct parameters", async () => {
      // Arrange
      trialQueue.add.mockResolvedValue({ id: "job-123" } as any);

      // Act
      await service.queueTrialCreation({
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
      });

      // Assert
      expect(trialQueue.add).toHaveBeenCalledWith(
        "process_trial",
        {
          companyId: TEST_IDS.companyId,
          userId: TEST_IDS.userId,
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    });

    it("should log success message after queuing", async () => {
      // Arrange
      trialQueue.add.mockResolvedValue({ id: "job-123" } as any);

      // Act
      await service.queueTrialCreation({
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
      });

      // Assert
      expect(logger.log).toHaveBeenCalledWith(`Trial creation queued for company ${TEST_IDS.companyId}`);
    });

    it("should catch and log errors without throwing", async () => {
      // Arrange
      const error = new Error("Queue connection failed");
      trialQueue.add.mockRejectedValue(error);

      // Act
      await service.queueTrialCreation({
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
      });

      // Assert
      expect(logger.error).toHaveBeenCalledWith(
        `Failed to queue trial creation for company ${TEST_IDS.companyId}: ${error}`,
      );
    });

    it("should not throw error when queue fails", async () => {
      // Arrange
      trialQueue.add.mockRejectedValue(new Error("Queue error"));

      // Act & Assert - should not throw
      await expect(
        service.queueTrialCreation({
          companyId: TEST_IDS.companyId,
          userId: TEST_IDS.userId,
        }),
      ).resolves.toBeUndefined();
    });

    it("should use correct job options for retry", async () => {
      // Arrange
      trialQueue.add.mockResolvedValue({ id: "job-456" } as any);

      // Act
      await service.queueTrialCreation({
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
      });

      // Assert
      const callArgs = trialQueue.add.mock.calls[0];
      const jobOptions = callArgs[2];
      expect(jobOptions.attempts).toBe(3);
      // backoff is `number | BackoffOptions`; the service sets the object form.
      const backoff = jobOptions.backoff as BackoffOptions;
      expect(backoff.type).toBe("exponential");
      expect(backoff.delay).toBe(5000);
    });

    it("should set removeOnComplete to true", async () => {
      // Arrange
      trialQueue.add.mockResolvedValue({ id: "job-789" } as any);

      // Act
      await service.queueTrialCreation({
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
      });

      // Assert
      const callArgs = trialQueue.add.mock.calls[0];
      const jobOptions = callArgs[2];
      expect(jobOptions.removeOnComplete).toBe(true);
    });

    it("should set removeOnFail to false", async () => {
      // Arrange
      trialQueue.add.mockResolvedValue({ id: "job-abc" } as any);

      // Act
      await service.queueTrialCreation({
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
      });

      // Assert
      const callArgs = trialQueue.add.mock.calls[0];
      const jobOptions = callArgs[2];
      expect(jobOptions.removeOnFail).toBe(false);
    });
  });
});
