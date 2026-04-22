import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantMessageModule } from "../assistant-message.module";
import { AssistantMessageDescriptor } from "../entities/assistant-message";
import { assistantMessageMeta } from "../entities/assistant-message.meta";
import { assistantMeta } from "../../assistant/entities/assistant.meta";
import { modelRegistry } from "../../../common/registries/registry";

describe("AssistantMessageModule.onApplicationBootstrap", () => {
  beforeEach(() => {
    AssistantMessageDescriptor.relationships.references.polymorphic!.candidates = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("populates candidates with only serialiser-having models, excluding assistant and assistant-message self-types", () => {
    const withSerialiser1 = {
      nodeName: "account",
      labelName: "Account",
      type: "accounts",
      serialiser: class {} as any,
      entity: {},
      mapper: () => ({}),
    } as any;
    const withSerialiser2 = {
      nodeName: "order",
      labelName: "Order",
      type: "orders",
      serialiser: class {} as any,
      entity: {},
      mapper: () => ({}),
    } as any;
    const withoutSerialiser = {
      nodeName: "keyConcept",
      labelName: "KeyConcept",
      type: "key-concepts",
      serialiser: undefined,
      entity: {},
      mapper: () => ({}),
    } as any;
    const selfAssistant = {
      nodeName: "assistant",
      labelName: "Assistant",
      type: assistantMeta.type,
      serialiser: class {} as any,
      entity: {},
      mapper: () => ({}),
    } as any;
    const selfAssistantMessage = {
      nodeName: "assistantMessage",
      labelName: "AssistantMessage",
      type: assistantMessageMeta.type,
      serialiser: class {} as any,
      entity: {},
      mapper: () => ({}),
    } as any;

    vi.spyOn(modelRegistry, "getAllModels").mockReturnValue([
      withSerialiser1,
      withSerialiser2,
      withoutSerialiser,
      selfAssistant,
      selfAssistantMessage,
    ]);

    const mod = new AssistantMessageModule();
    mod.onApplicationBootstrap();

    const candidates = AssistantMessageDescriptor.relationships.references.polymorphic!.candidates;
    expect(candidates).toHaveLength(2);
    expect(candidates).toEqual(expect.arrayContaining([withSerialiser1, withSerialiser2]));
    expect(candidates).not.toContain(withoutSerialiser);
    expect(candidates).not.toContain(selfAssistant);
    expect(candidates).not.toContain(selfAssistantMessage);
  });
});
