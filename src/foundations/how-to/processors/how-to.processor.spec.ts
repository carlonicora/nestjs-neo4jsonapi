import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiStatus } from "../../../common/enums/ai.status";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { ChunkRepository } from "../../chunk/repositories/chunk.repository";
import { ChunkService } from "../../chunk/services/chunk.service";
import { HowToService } from "../services/how-to.service";
import { HowToProcessor } from "./how-to.processor";

const MOCK_COMPANY_ID = "company-550e8400-e29b-41d4-a716-446655440000";
const MOCK_USER_ID = "user-660e8400-e29b-41d4-a716-446655440001";
const MOCK_HOWTO_ID = "howto-770e8400-e29b-41d4-a716-446655440002";
const DEFAULT_JOB_NAME = "process_howto";

describe("HowToProcessor", () => {
  let processor: HowToProcessor;
  let logger: { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let cls: ClsService & { run: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  let clsValues: Record<string, unknown>;
  let howToService: { updateAiStatus: ReturnType<typeof vi.fn> };
  let chunkRepository: {
    claimContentFinalisation: ReturnType<typeof vi.fn>;
    clearFinalisationClaim: ReturnType<typeof vi.fn>;
  };
  let chunkService: { propagateAndEmbedDates: ReturnType<typeof vi.fn> };

  const build = (jobNames?: { process?: { HowTo?: string } }) => {
    logger = { debug: vi.fn(), error: vi.fn() };
    clsValues = {};
    cls = {
      run: vi.fn(async (fn: () => Promise<void>) => fn()),
      set: vi.fn((key: string, value: unknown) => {
        clsValues[key] = value;
      }),
      get: vi.fn((key: string) => clsValues[key]),
    } as unknown as ClsService & { run: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
    howToService = { updateAiStatus: vi.fn(async () => undefined) };
    chunkRepository = {
      claimContentFinalisation: vi.fn(async () => true),
      clearFinalisationClaim: vi.fn(async () => undefined),
    };
    chunkService = { propagateAndEmbedDates: vi.fn(async () => undefined) };

    const configService = { get: vi.fn(() => jobNames) } as unknown as ConfigService;

    return new HowToProcessor(
      logger as unknown as AppLoggingService,
      howToService as unknown as HowToService,
      chunkRepository as unknown as ChunkRepository,
      cls,
      chunkService as unknown as ChunkService,
      configService,
    );
  };

  const createMockJob = (name: string, data: Record<string, unknown> = {}): Job =>
    ({
      id: "job-123",
      name,
      data: {
        companyId: MOCK_COMPANY_ID,
        userId: MOCK_USER_ID,
        id: MOCK_HOWTO_ID,
        ...data,
      },
      failedReason: undefined,
    }) as unknown as Job;

  const createMockJobWithoutCompanyId = (name: string, data: Record<string, unknown> = {}): Job =>
    ({
      id: "job-456",
      name,
      data: {
        userId: MOCK_USER_ID,
        id: MOCK_HOWTO_ID,
        ...data,
      },
      failedReason: undefined,
    }) as unknown as Job;

  beforeEach(() => {
    processor = build();
  });

  describe("Worker event handlers", () => {
    it("should log debug message when job becomes active", () => {
      processor.onActive(createMockJob(DEFAULT_JOB_NAME));

      expect(logger.debug).toHaveBeenCalledWith(`Processing ${DEFAULT_JOB_NAME} job`);
    });

    it("should log error message when job fails", () => {
      const job = createMockJob(DEFAULT_JOB_NAME);
      (job as unknown as { failedReason: string }).failedReason = "Processing timeout";

      processor.onError(job);

      expect(logger.error).toHaveBeenCalledWith(
        `Error processing ${DEFAULT_JOB_NAME} job (ID: job-123). Reason: Processing timeout`,
      );
    });

    it("should handle undefined failedReason", () => {
      processor.onError(createMockJob(DEFAULT_JOB_NAME));

      expect(logger.error).toHaveBeenCalledWith(
        `Error processing ${DEFAULT_JOB_NAME} job (ID: job-123). Reason: undefined`,
      );
    });

    it("should log debug message when job completes", () => {
      processor.onCompleted(createMockJob(DEFAULT_JOB_NAME));

      expect(logger.debug).toHaveBeenCalledWith(`Completed ${DEFAULT_JOB_NAME} job (ID: job-123)`);
    });
  });

  describe("job name resolution", () => {
    it("should throw error for unhandled job names", async () => {
      await expect(processor.process(createMockJob("unknown_job"))).rejects.toThrow(
        "Job unknown_job not handled by HowToProcessor",
      );
    });

    it("should accept the configured job name when ConfigService provides one", async () => {
      processor = build({ process: { HowTo: "app:process_howto" } });

      await processor.process(createMockJob("app:process_howto"));

      expect(chunkRepository.claimContentFinalisation).toHaveBeenCalledTimes(1);
    });

    it("should reject the default job name when a custom one is configured", async () => {
      processor = build({ process: { HowTo: "app:process_howto" } });

      await expect(processor.process(createMockJob(DEFAULT_JOB_NAME))).rejects.toThrow(
        "Job process_howto not handled by HowToProcessor",
      );
    });
  });

  describe("CLS context setup with companyId", () => {
    it("should set company ID in CLS context when provided", async () => {
      await processor.process(createMockJob(DEFAULT_JOB_NAME));

      expect(cls.set).toHaveBeenCalledWith("companyId", MOCK_COMPANY_ID);
    });

    it("should set user ID in CLS context", async () => {
      await processor.process(createMockJob(DEFAULT_JOB_NAME));

      expect(cls.set).toHaveBeenCalledWith("userId", MOCK_USER_ID);
    });

    it("should mark as automated job in CLS context", async () => {
      await processor.process(createMockJob(DEFAULT_JOB_NAME));

      expect(cls.set).toHaveBeenCalledWith("isAutomatedJob", true);
    });

    it("should run processing within CLS context", async () => {
      await processor.process(createMockJob(DEFAULT_JOB_NAME));

      expect(cls.run).toHaveBeenCalledTimes(1);
    });
  });

  describe("CLS context setup without companyId (global content)", () => {
    it("should NOT set company ID in CLS context when not provided", async () => {
      await processor.process(createMockJobWithoutCompanyId(DEFAULT_JOB_NAME));

      expect(cls.set).not.toHaveBeenCalledWith("companyId", expect.any(String));
    });

    it("should set user ID in CLS context even without companyId", async () => {
      await processor.process(createMockJobWithoutCompanyId(DEFAULT_JOB_NAME));

      expect(cls.set).toHaveBeenCalledWith("userId", MOCK_USER_ID);
    });

    it("should mark as automated job in CLS context even without companyId", async () => {
      await processor.process(createMockJobWithoutCompanyId(DEFAULT_JOB_NAME));

      expect(cls.set).toHaveBeenCalledWith("isAutomatedJob", true);
    });

    it("should still run processing within CLS context without companyId", async () => {
      await processor.process(createMockJobWithoutCompanyId(DEFAULT_JOB_NAME));

      expect(cls.run).toHaveBeenCalledTimes(1);
    });

    it("should successfully process HowTo without companyId", async () => {
      await processor.process(createMockJobWithoutCompanyId(DEFAULT_JOB_NAME));

      expect(howToService.updateAiStatus).toHaveBeenCalledWith({
        id: MOCK_HOWTO_ID,
        aiStatus: AiStatus.InProgress,
      });
    });
  });

  describe("HowTo processing workflow", () => {
    it("should claim the finalisation latch", async () => {
      await processor.process(createMockJob(DEFAULT_JOB_NAME));

      expect(chunkRepository.claimContentFinalisation).toHaveBeenCalledWith({
        id: MOCK_HOWTO_ID,
        nodeType: "HowTo",
      });
    });

    it("should update AI status to InProgress", async () => {
      await processor.process(createMockJob(DEFAULT_JOB_NAME));

      expect(howToService.updateAiStatus).toHaveBeenCalledWith({
        id: MOCK_HOWTO_ID,
        aiStatus: AiStatus.InProgress,
      });
    });

    it("should propagate and embed chunk dates", async () => {
      await processor.process(createMockJob(DEFAULT_JOB_NAME));

      expect(chunkService.propagateAndEmbedDates).toHaveBeenCalledWith({
        id: MOCK_HOWTO_ID,
        nodeType: "HowTo",
      });
    });

    describe("when the claim is taken", () => {
      beforeEach(() => {
        chunkRepository.claimContentFinalisation.mockResolvedValue(true);
      });

      it("should update AI status to Completed when all chunks are done", async () => {
        await processor.process(createMockJob(DEFAULT_JOB_NAME));

        expect(howToService.updateAiStatus).toHaveBeenCalledWith({
          id: MOCK_HOWTO_ID,
          aiStatus: AiStatus.Completed,
        });
      });

      it("should claim, mark InProgress, propagate dates, then mark Completed in order", async () => {
        const calls: string[] = [];
        chunkRepository.claimContentFinalisation.mockImplementation(async () => {
          calls.push("claim");
          return true;
        });
        howToService.updateAiStatus.mockImplementation(async (params: { aiStatus: AiStatus }) => {
          calls.push(params.aiStatus);
        });
        chunkService.propagateAndEmbedDates.mockImplementation(async () => {
          calls.push("propagate");
        });

        await processor.process(createMockJob(DEFAULT_JOB_NAME));

        expect(calls).toEqual(["claim", AiStatus.InProgress, "propagate", AiStatus.Completed]);
      });

      it("should complete processing for global content without companyId", async () => {
        const statusCalls: AiStatus[] = [];
        howToService.updateAiStatus.mockImplementation(async (params: { aiStatus: AiStatus }) => {
          statusCalls.push(params.aiStatus);
        });

        await processor.process(createMockJobWithoutCompanyId(DEFAULT_JOB_NAME));

        expect(statusCalls).toEqual([AiStatus.InProgress, AiStatus.Completed]);
      });
    });

    describe("when the claim is already held", () => {
      beforeEach(() => {
        chunkRepository.claimContentFinalisation.mockResolvedValue(false);
      });

      it("should not complete processing when another job holds the claim", async () => {
        await processor.process(createMockJob(DEFAULT_JOB_NAME));

        expect(howToService.updateAiStatus).not.toHaveBeenCalled();
        expect(chunkService.propagateAndEmbedDates).not.toHaveBeenCalled();
      });

      it("should not write any AI status when the claim is held (global content)", async () => {
        await processor.process(createMockJobWithoutCompanyId(DEFAULT_JOB_NAME));

        expect(howToService.updateAiStatus).not.toHaveBeenCalled();
      });
    });
  });

  describe("error handling", () => {
    it("should propagate error from claiming the finalisation latch", async () => {
      chunkRepository.claimContentFinalisation.mockRejectedValue(new Error("Failed to get chunks"));

      await expect(processor.process(createMockJob(DEFAULT_JOB_NAME))).rejects.toThrow("Failed to get chunks");
    });

    it("should propagate error from updating AI status", async () => {
      howToService.updateAiStatus.mockRejectedValue(new Error("Failed to update status"));

      await expect(processor.process(createMockJob(DEFAULT_JOB_NAME))).rejects.toThrow("Failed to update status");
    });

    it("should propagate error for global content without companyId", async () => {
      howToService.updateAiStatus.mockRejectedValue(new Error("Failed to update status"));

      await expect(processor.process(createMockJobWithoutCompanyId(DEFAULT_JOB_NAME))).rejects.toThrow(
        "Failed to update status",
      );
    });

    it("should release the claim when date propagation fails", async () => {
      chunkService.propagateAndEmbedDates.mockRejectedValue(new Error("Failed to propagate dates"));

      await expect(processor.process(createMockJob(DEFAULT_JOB_NAME))).rejects.toThrow("Failed to propagate dates");

      expect(chunkRepository.clearFinalisationClaim).toHaveBeenCalledWith({
        id: MOCK_HOWTO_ID,
        nodeType: "HowTo",
      });
      expect(howToService.updateAiStatus).not.toHaveBeenCalledWith({
        id: MOCK_HOWTO_ID,
        aiStatus: AiStatus.Completed,
      });
    });

    it("should release the claim when a status update fails", async () => {
      howToService.updateAiStatus.mockRejectedValue(new Error("Failed to update status"));

      await expect(processor.process(createMockJob(DEFAULT_JOB_NAME))).rejects.toThrow("Failed to update status");

      expect(chunkRepository.clearFinalisationClaim).toHaveBeenCalledWith({
        id: MOCK_HOWTO_ID,
        nodeType: "HowTo",
      });
    });
  });
});
