import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { CommunitySummariserProcessor } from "../community.summariser.processor";

describe("CommunitySummariserProcessor", () => {
  const catalog = {
    getAllEntities: () => [
      { type: "scope-roots", labelName: "ScopeRoot", scope: { path: [], rootType: "scope-roots" } },
    ],
  };

  const build = (params: { filter?: { canGroup: any } }) => {
    const summariserService = { generateSummaryById: vi.fn(async () => undefined) };
    const cls = { run: vi.fn(async (fn: () => Promise<void>) => fn()), set: vi.fn() };
    const communityRepository = {
      findScopeRootForCommunity: vi.fn(async () => ({ id: "root-a", type: "scope-roots", label: "ScopeRoot" })),
      markPendingCredits: vi.fn(),
    };
    const creditValidator = {
      isAiEnabled: vi.fn(async () => true),
      hasAvailableCredits: vi.fn(async () => true),
      validateCredits: vi.fn(),
    };
    const processor = new CommunitySummariserProcessor(
      summariserService as any,
      cls as any,
      { log: vi.fn(), debug: vi.fn(), error: vi.fn() } as any,
      communityRepository as any,
      { sendMessageToCompany: vi.fn() } as any,
      creditValidator as any,
      params.filter as any,
      catalog as any,
    );
    return { processor, summariserService, communityRepository, creditValidator };
  };

  const job = { data: { communityId: "comm-1", companyId: "c-1" } } as Job<{ communityId: string; companyId: string }>;

  it("does not summarise a community whose scope root the filter rejects, before any credit check", async () => {
    const filter = { canGroup: vi.fn(async () => false) };
    const { processor, summariserService, communityRepository, creditValidator } = build({ filter });

    await processor.process(job);

    expect(communityRepository.findScopeRootForCommunity).toHaveBeenCalledWith({
      communityId: "comm-1",
      rootLabels: ["ScopeRoot"],
    });
    expect(filter.canGroup).toHaveBeenCalledWith({
      companyId: "c-1",
      scope: { id: "root-a", type: "scope-roots" },
    });
    expect(creditValidator.hasAvailableCredits).not.toHaveBeenCalled();
    expect(communityRepository.markPendingCredits).not.toHaveBeenCalled();
    expect(summariserService.generateSummaryById).not.toHaveBeenCalled();
  });

  it("summarises a community whose scope root the filter accepts", async () => {
    const filter = { canGroup: vi.fn(async () => true) };
    const { processor, summariserService } = build({ filter });

    await processor.process(job);

    expect(summariserService.generateSummaryById).toHaveBeenCalledWith("comm-1");
  });

  it("asks the filter about the company for a community with no scope root", async () => {
    const filter = { canGroup: vi.fn(async () => false) };
    const { processor, summariserService, communityRepository } = build({ filter });
    communityRepository.findScopeRootForCommunity.mockResolvedValue(null as never);

    await processor.process(job);

    expect(filter.canGroup).toHaveBeenCalledWith({ companyId: "c-1" });
    expect(summariserService.generateSummaryById).not.toHaveBeenCalled();
  });

  it("summarises without reading the scope root when the filter is unbound", async () => {
    const { processor, summariserService, communityRepository } = build({});

    await processor.process(job);

    expect(communityRepository.findScopeRootForCommunity).not.toHaveBeenCalled();
    expect(summariserService.generateSummaryById).toHaveBeenCalledWith("comm-1");
  });
});
