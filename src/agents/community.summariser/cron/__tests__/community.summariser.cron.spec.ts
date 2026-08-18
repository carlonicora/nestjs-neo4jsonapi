import { vi, describe, it, expect, beforeEach, MockedObject } from "vitest";
import { CommunitySummariserCron } from "../community.summariser.cron";
import { CommunityRepository } from "../../../../foundations/community/repositories/community.repository";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { CreditValidatorInterface } from "../../../../common/tokens";
import { Queue } from "bullmq";

describe("CommunitySummariserCron", () => {
  let cron: CommunitySummariserCron;
  let communityRepository: MockedObject<CommunityRepository>;
  let summariserQueue: MockedObject<Queue>;
  let logger: MockedObject<AppLoggingService>;
  let creditValidator: { validateCredits: ReturnType<typeof vi.fn>; isAiEnabled: ReturnType<typeof vi.fn> };

  const MOCK_STALE_COMMUNITIES = [
    { communityId: "comm-1", companyId: "company-1" },
    { communityId: "comm-2", companyId: "company-1" },
    { communityId: "comm-3", companyId: "company-2" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    communityRepository = {
      findAllStaleCommunities: vi.fn(),
    } as unknown as MockedObject<CommunityRepository>;
    summariserQueue = { add: vi.fn() } as unknown as MockedObject<Queue>;
    logger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as MockedObject<AppLoggingService>;
    // Default: every company has AI, so the pre-existing cases are unaffected.
    creditValidator = { validateCredits: vi.fn(), isAiEnabled: vi.fn().mockResolvedValue(true) };
    cron = new CommunitySummariserCron(
      communityRepository,
      summariserQueue,
      logger,
      creditValidator as unknown as CreditValidatorInterface,
    );
  });

  describe("handleStaleCommunities", () => {
    it("should enqueue one job per stale community", async () => {
      communityRepository.findAllStaleCommunities.mockResolvedValue(MOCK_STALE_COMMUNITIES);
      summariserQueue.add.mockResolvedValue({} as any);
      await cron.handleStaleCommunities();
      expect(communityRepository.findAllStaleCommunities).toHaveBeenCalled();
      expect(summariserQueue.add).toHaveBeenCalledTimes(3);
      expect(summariserQueue.add).toHaveBeenCalledWith("process-stale", {
        communityId: "comm-1",
        companyId: "company-1",
      });
      expect(summariserQueue.add).toHaveBeenCalledWith("process-stale", {
        communityId: "comm-2",
        companyId: "company-1",
      });
      expect(summariserQueue.add).toHaveBeenCalledWith("process-stale", {
        communityId: "comm-3",
        companyId: "company-2",
      });
    });

    it("should handle empty stale communities list", async () => {
      communityRepository.findAllStaleCommunities.mockResolvedValue([]);
      await cron.handleStaleCommunities();
      expect(summariserQueue.add).not.toHaveBeenCalled();
    });

    it("does NOT enqueue for a company whose plan carries no AI", async () => {
      // Without this filter the loop never terminates: the AI-free branch in
      // the processor correctly writes nothing, so `pendingCredits` is never
      // set and the community stays in findAllStaleCommunities forever, being
      // re-enqueued every 10 minutes.
      communityRepository.findAllStaleCommunities.mockResolvedValue(MOCK_STALE_COMMUNITIES);
      summariserQueue.add.mockResolvedValue({} as any);
      creditValidator.isAiEnabled.mockImplementation(
        async ({ companyId }: { companyId: string }) => companyId !== "company-1",
      );

      await cron.handleStaleCommunities();

      expect(summariserQueue.add).toHaveBeenCalledTimes(1);
      expect(summariserQueue.add).toHaveBeenCalledWith("process-stale", {
        communityId: "comm-3",
        companyId: "company-2",
      });
    });

    it("enqueues nothing at all when no company has AI", async () => {
      communityRepository.findAllStaleCommunities.mockResolvedValue(MOCK_STALE_COMMUNITIES);
      creditValidator.isAiEnabled.mockResolvedValue(false);

      await cron.handleStaleCommunities();

      expect(summariserQueue.add).not.toHaveBeenCalled();
    });

    it("still enqueues when no credit validator is bound (ungated deployments)", async () => {
      // The seam's documented contract: no provider bound → work proceeds.
      const ungated = new CommunitySummariserCron(communityRepository, summariserQueue, logger);
      communityRepository.findAllStaleCommunities.mockResolvedValue(MOCK_STALE_COMMUNITIES);
      summariserQueue.add.mockResolvedValue({} as any);

      await ungated.handleStaleCommunities();

      expect(summariserQueue.add).toHaveBeenCalledTimes(3);
    });

    it("should continue enqueuing jobs when one fails", async () => {
      communityRepository.findAllStaleCommunities.mockResolvedValue(MOCK_STALE_COMMUNITIES);
      summariserQueue.add
        .mockRejectedValueOnce(new Error("Queue connection lost"))
        .mockResolvedValueOnce({} as any)
        .mockResolvedValueOnce({} as any);
      await cron.handleStaleCommunities();
      expect(summariserQueue.add).toHaveBeenCalledTimes(3);
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to enqueue stale community comm-1 for company company-1: Queue connection lost",
        "CommunitySummariserCron",
      );
    });
  });
});
