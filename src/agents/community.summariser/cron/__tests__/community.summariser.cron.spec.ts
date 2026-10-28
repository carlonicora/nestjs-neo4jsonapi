import { vi, describe, it, expect, beforeEach, Mock, MockedObject } from "vitest";
import { CommunitySummariserCron } from "../community.summariser.cron";
import { CommunityRepository } from "../../../../foundations/community/repositories/community.repository";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { CommunityScopeFilterInterface, CreditValidatorInterface } from "../../../../common/tokens";
import { ClsService } from "nestjs-cls";
import { Queue } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { CommunityLayerService } from "../../../../foundations/community/services/community-layer.service";
import { AgentScopeFilterService } from "../../../../common/repositories/agent-scope.filter";
import { EmbedderService } from "../../../../core/llm/services/embedder.service";
import { ModelService } from "../../../../core/llm/services/model.service";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";

describe("CommunitySummariserCron", () => {
  let cron: CommunitySummariserCron;
  let communityRepository: MockedObject<CommunityRepository>;
  let summariserQueue: MockedObject<Queue>;
  let logger: MockedObject<AppLoggingService>;
  let creditValidator: { validateCredits: ReturnType<typeof vi.fn>; isAiEnabled: ReturnType<typeof vi.fn> };
  let cls: {
    run: Mock<(...args: any[]) => any>;
    set: Mock<(...args: any[]) => any>;
    get: Mock<(...args: any[]) => any>;
  };

  const MOCK_STALE_COMMUNITIES = [
    { communityId: "comm-1", companyId: "company-1" },
    { communityId: "comm-2", companyId: "company-1" },
    { communityId: "comm-3", companyId: "company-2" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    communityRepository = {
      findAllStaleCommunities: vi.fn(),
      findScopeRootForCommunity: vi.fn(),
    } as unknown as MockedObject<CommunityRepository>;
    // CLS stub: run() executes the callback and records the company it was seeded with.
    const store = new Map<string, unknown>();
    cls = {
      run: vi.fn(async (fn: () => Promise<unknown>) => {
        store.clear();
        return fn();
      }),
      set: vi.fn((key: string, value: unknown) => store.set(key, value)),
      get: vi.fn((key: string) => store.get(key)),
    };
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
      cls as unknown as ClsService,
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
      const ungated = new CommunitySummariserCron(
        communityRepository,
        summariserQueue,
        logger,
        cls as unknown as ClsService,
      );
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
  describe("scope filter (COMMUNITY_SCOPE_FILTER seam)", () => {
    let filter: { canGroup: ReturnType<typeof vi.fn> };
    let filtered: CommunitySummariserCron;

    beforeEach(() => {
      filter = { canGroup: vi.fn() };
      filtered = new CommunitySummariserCron(
        communityRepository,
        summariserQueue,
        logger,
        cls as unknown as ClsService,
        creditValidator as unknown as CreditValidatorInterface,
        filter as unknown as CommunityScopeFilterInterface,
      );
      summariserQueue.add.mockResolvedValue({} as any);
    });

    it("asks the repository for the scope root by community id only", async () => {
      communityRepository.findAllStaleCommunities.mockResolvedValue([
        { communityId: "comm-1", companyId: "company-1" },
      ]);
      communityRepository.findScopeRootForCommunity.mockResolvedValue(null);
      filter.canGroup.mockResolvedValue(true);

      await filtered.handleStaleCommunities();

      expect(communityRepository.findScopeRootForCommunity).toHaveBeenCalledTimes(1);
      expect(communityRepository.findScopeRootForCommunity.mock.calls[0]).toStrictEqual([{ communityId: "comm-1" }]);
    });

    it("does not enqueue a stale community whose scope root the filter rejects", async () => {
      communityRepository.findAllStaleCommunities.mockResolvedValue([
        { communityId: "comm-1", companyId: "company-1" },
        { communityId: "comm-2", companyId: "company-1" },
      ]);
      const seenCompanies: unknown[] = [];
      communityRepository.findScopeRootForCommunity.mockImplementation(async ({ communityId }) => {
        seenCompanies.push(cls.get("companyId"));
        return { id: communityId === "comm-1" ? "root-a" : "root-b", type: "scope-roots", label: "ScopeRoot" };
      });
      filter.canGroup.mockImplementation(async ({ scope }) => scope?.id === "root-b");

      await filtered.handleStaleCommunities();

      // The scope root is read inside a CLS context seeded with the community's company.
      expect(seenCompanies).toEqual(["company-1", "company-1"]);
      expect(filter.canGroup).toHaveBeenCalledWith({
        companyId: "company-1",
        scope: { id: "root-a", type: "scope-roots" },
      });
      expect(summariserQueue.add).toHaveBeenCalledTimes(1);
      expect(summariserQueue.add).toHaveBeenCalledWith("process-stale", {
        communityId: "comm-2",
        companyId: "company-1",
      });
    });

    it("groups by company when the community has no scope root", async () => {
      communityRepository.findAllStaleCommunities.mockResolvedValue([
        { communityId: "comm-1", companyId: "company-1" },
      ]);
      communityRepository.findScopeRootForCommunity.mockResolvedValue(null);
      filter.canGroup.mockResolvedValue(false);

      await filtered.handleStaleCommunities();

      expect(filter.canGroup).toHaveBeenCalledWith({ companyId: "company-1" });
      expect(summariserQueue.add).not.toHaveBeenCalled();
    });

    it("enqueues it when the filter is unbound", async () => {
      communityRepository.findAllStaleCommunities.mockResolvedValue([
        { communityId: "comm-1", companyId: "company-1" },
      ]);

      await cron.handleStaleCommunities();

      expect(communityRepository.findScopeRootForCommunity).not.toHaveBeenCalled();
      expect(summariserQueue.add).toHaveBeenCalledWith("process-stale", {
        communityId: "comm-1",
        companyId: "company-1",
      });
    });
  });

  describe("an app with no community setting and no groups (a360ai)", () => {
    it("reads every company's stale groups once, finds none and enqueues nothing", async () => {
      // No `community` key and no catalog: the company layer, resolved without error.
      const layer = new CommunityLayerService({ get: vi.fn(() => undefined) } as unknown as ConfigService);
      layer.onApplicationBootstrap();
      expect(layer.current()).toBeUndefined();

      // The cron runs with no company in CLS, so initQuery binds none.
      const neo4j = {
        initQuery: vi.fn(() => ({ query: "", queryParams: { companyId: null } })),
        readMany: vi.fn().mockResolvedValue([]),
        read: vi.fn(),
        writeOne: vi.fn(),
      };
      const repository = new CommunityRepository(
        neo4j as unknown as Neo4jService,
        {} as SecurityService,
        cls as unknown as ClsService,
        {} as EmbedderService,
        {} as ModelService,
        {} as AgentScopeFilterService,
        layer,
      );
      const a360ai = new CommunitySummariserCron(
        repository,
        summariserQueue,
        logger,
        cls as unknown as ClsService,
        creditValidator as unknown as CreditValidatorInterface,
      );

      await a360ai.handleStaleCommunities();

      expect(neo4j.readMany).toHaveBeenCalledTimes(1);
      expect(neo4j.read).not.toHaveBeenCalled();
      expect(neo4j.writeOne).not.toHaveBeenCalled();
      expect(summariserQueue.add).not.toHaveBeenCalled();
    });
  });
});
