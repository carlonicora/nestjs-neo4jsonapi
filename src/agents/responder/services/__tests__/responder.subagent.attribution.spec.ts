import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AgentMessageType } from "../../../../common/enums/agentmessage.type";
import { TokenUsageType } from "../../../../foundations/tokenusage/enums/tokenusage.type";
import { ContextualiserContextFactoryService } from "../../../contextualiser/factories/contextualiser.context.factory";
import { ContextualiserService } from "../../../contextualiser/services/contextualiser.service";
import { DriftSearchService } from "../../../drift/services/drift.search.service";
import { ResponderContextFactoryService } from "../../factories/responder.context.factory";
import { GraphNodeService } from "../../nodes/graph.node.service";
import { PlannerNodeService } from "../../nodes/planner.node.service";
import { ResponderAnswerNodeService } from "../../nodes/responder.answer.node.service";
import { ResponderService } from "../responder.service";

/**
 * The responder is the in-repo CALLER of both sub-agents. The owner's ruling is
 * that the caller records their spend, so it must hand its own attribution down
 * at both invocation sites — otherwise the contextualiser and DRIFT run free.
 */
describe("ResponderService — attribution handed down to the sub-agents", () => {
  let service: ResponderService;
  let plannerNode: { execute: Mock };
  let graphNode: { execute: Mock };
  let contextualiserService: { run: Mock };
  let driftSearchService: { search: Mock };
  let answerNode: { execute: Mock };
  let config: { get: Mock };

  beforeEach(async () => {
    plannerNode = {
      execute: vi.fn().mockResolvedValue({
        branchPlan: { runGraph: false, runContextualiser: true, runDrift: true, reasoning: "both sub-agents" },
      }),
    };
    graphNode = { execute: vi.fn() };
    contextualiserService = { run: vi.fn().mockResolvedValue({ tokens: { input: 1, output: 1 } }) };
    driftSearchService = { search: vi.fn().mockResolvedValue({ confidence: 1, matchedCommunities: [] }) };
    answerNode = { execute: vi.fn().mockImplementation(async ({ state }) => state) };
    config = { get: vi.fn().mockReturnValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ResponderService,
        ResponderContextFactoryService,
        ContextualiserContextFactoryService,
        { provide: ContextualiserService, useValue: contextualiserService },
        { provide: DriftSearchService, useValue: driftSearchService },
        { provide: ResponderAnswerNodeService, useValue: answerNode },
        { provide: PlannerNodeService, useValue: plannerNode },
        { provide: GraphNodeService, useValue: graphNode },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = moduleRef.get(ResponderService);
  });

  const runArgs = (overrides: Record<string, unknown> = {}) => ({
    companyId: "company-1",
    userId: "user-1",
    userModuleIds: ["crm"],
    dataLimits: {} as never,
    messages: [{ type: AgentMessageType.User, content: "q" }] as never,
    scopeId: "campaign-1",
    scopeType: "campaigns",
    scopeLabel: "Campaign",
    assistantId: "assistant-1",
    ...overrides,
  });

  it("passes its own ledger category and scope root to the contextualiser", async () => {
    await service.run(runArgs());

    expect(contextualiserService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        attribution: {
          tokenUsageType: TokenUsageType.Responder,
          scopeId: "campaign-1",
          scopeType: "campaigns",
          scopeLabel: "Campaign",
          assistantId: "assistant-1",
        },
      }),
    );
  });

  it("passes the same attribution to DRIFT", async () => {
    await service.run(runArgs());

    expect(driftSearchService.search).toHaveBeenCalledWith(
      expect.objectContaining({
        attribution: {
          tokenUsageType: TokenUsageType.Responder,
          scopeId: "campaign-1",
          scopeType: "campaigns",
          scopeLabel: "Campaign",
          assistantId: "assistant-1",
        },
      }),
    );
  });

  it("still names itself as the category when the turn is unscoped, so the thread fallback applies", async () => {
    await service.run(runArgs({ scopeId: undefined, scopeType: undefined, scopeLabel: undefined }));

    expect(contextualiserService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        attribution: expect.objectContaining({
          tokenUsageType: TokenUsageType.Responder,
          scopeId: undefined,
          assistantId: "assistant-1",
        }),
      }),
    );
  });

  it("hands the attribution down on the help-mode path, which never runs the planner", async () => {
    await service.run(runArgs({ dataLimits: { howToMode: true } as never }));

    expect(plannerNode.execute).not.toHaveBeenCalled();
    expect(contextualiserService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        attribution: expect.objectContaining({ tokenUsageType: TokenUsageType.Responder, scopeId: "campaign-1" }),
      }),
    );
  });
});
