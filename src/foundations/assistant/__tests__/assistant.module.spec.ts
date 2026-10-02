import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modelRegistry } from "../../../common/registries/registry";
import { assistantMessageMeta } from "../../assistant-message/entities/assistant-message.meta";
import { AssistantModule } from "../assistant.module";
import { AssistantDescriptor } from "../entities/assistant";
import { assistantMeta } from "../entities/assistant.meta";
import { AssistantRepository } from "../repositories/assistant.repository";

const model = (nodeName: string, labelName: string, type: string, serialiser?: any) =>
  ({ nodeName, labelName, type, serialiser, entity: {}, mapper: () => ({}) }) as any;
const withSerialiser = (nodeName: string, labelName: string, type: string) =>
  model(nodeName, labelName, type, class {});

describe("AssistantModule.onApplicationBootstrap (BOUND_TO content candidates)", () => {
  beforeEach(() => {
    AssistantDescriptor.relationships.content.polymorphic!.candidates = [];
  });

  afterEach(() => {
    AssistantDescriptor.relationships.content.polymorphic!.candidates = [];
    vi.restoreAllMocks();
  });

  it("populates candidates with only serialiser-having models, excluding assistant and assistant-message self-types", () => {
    const campaign = withSerialiser("campaign", "Campaign", "campaigns");
    const account = withSerialiser("account", "Account", "accounts");
    const withoutSerialiser = model("keyConcept", "KeyConcept", "key-concepts");
    const selfAssistant = withSerialiser("assistant", "Assistant", assistantMeta.type);
    const selfAssistantMessage = withSerialiser("assistantMessage", "AssistantMessage", assistantMessageMeta.type);
    vi.spyOn(modelRegistry, "getAllModels").mockReturnValue([
      campaign,
      account,
      withoutSerialiser,
      selfAssistant,
      selfAssistantMessage,
    ]);

    new AssistantModule({ get: vi.fn().mockReturnValue({}) } as any).onApplicationBootstrap();

    expect(AssistantDescriptor.relationships.content.polymorphic!.candidates).toEqual([campaign, account]);
  });

  it("excludes a model whose serialiser is not a registered provider", () => {
    const provided = model("campaign", "Campaign", "campaigns", class ProvidedSerialiser {});
    const unprovided = model(
      "microsoftGraphSubscription",
      "MicrosoftGraphSubscription",
      "microsoft-graph-subscriptions",
      class UnprovidedSerialiser {},
    );
    vi.spyOn(modelRegistry, "getAllModels").mockReturnValue([provided, unprovided]);
    const moduleRef = {
      get: vi.fn().mockImplementation((token: unknown) => {
        if (token === unprovided.serialiser) throw new Error("Nest could not find UnprovidedSerialiser element");
        return {};
      }),
    } as any;

    new AssistantModule(moduleRef).onApplicationBootstrap();

    expect(AssistantDescriptor.relationships.content.polymorphic!.candidates).toEqual([provided]);
  });

  it("makes AssistantRepository.findById load the bound target: $polyLabels_content carries its label", async () => {
    const captured: any[] = [];
    const neo4j = {
      initQuery: () => ({ query: "", queryParams: { companyId: "c-1", currentUserId: "u-1" } }),
      readOne: vi.fn(async (q: any) => {
        captured.push(q);
        return { id: "a-1" };
      }),
      readMany: vi.fn(async () => []),
      read: vi.fn(async () => ({ records: [] })),
    } as any;
    const securityService = { userHasAccess: (p: { validator: () => string }) => p.validator() } as any;
    const clsService = { get: (k: string) => (k === "userId" ? "u-1" : "c-1"), has: () => true } as any;
    const repo = new AssistantRepository(neo4j, securityService, clsService);

    vi.spyOn(modelRegistry, "getAllModels").mockReturnValue([
      withSerialiser("campaign", "Campaign", "campaigns"),
      withSerialiser("assistant", "Assistant", assistantMeta.type),
    ]);
    new AssistantModule({ get: vi.fn().mockReturnValue({}) } as any).onApplicationBootstrap();

    await repo.findById({ id: "a-1" });

    const q = captured[0];
    expect(q.query).toContain(
      "WHERE assistant_content IS NULL OR any(l IN labels(assistant_content) WHERE l IN $polyLabels_content)",
    );
    expect(q.queryParams.polyLabels_content).toEqual(["Campaign"]);
  });
});
