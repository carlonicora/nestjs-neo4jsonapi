import { describe, expect, it, vi } from "vitest";
import { AssistantMentionExtractor } from "../assistant-mention.extractor";

const doc = [
  {
    type: "paragraph",
    content: [
      { type: "text", text: "compare ", styles: {} },
      { type: "mention", props: { id: "a", entityType: "npcs", alias: "One" } },
      { type: "text", text: " and ", styles: {} },
      { type: "mention", props: { id: "b", entityType: "factions", alias: "Two" } },
    ],
  },
  { type: "paragraph", content: [{ type: "mention", props: { id: "a", entityType: "npcs", alias: "One" } }] },
];

const ctx = { companyId: "c", userId: "u", userModuleIds: ["m"], scopeId: "camp-1", scopeType: "campaigns" };

describe("AssistantMentionExtractor.extract", () => {
  it("collects every mention once, in document order", () => {
    const extractor = new AssistantMentionExtractor({} as any, {} as any, {} as any);
    expect(extractor.extract(doc)).toEqual([
      { type: "npcs", id: "a", alias: "One" },
      { type: "factions", id: "b", alias: "Two" },
    ]);
  });

  it("returns an empty list for a malformed document instead of throwing", () => {
    const extractor = new AssistantMentionExtractor({} as any, {} as any, {} as any);
    expect(extractor.extract(null as any)).toEqual([]);
    expect(extractor.extract([{ type: "paragraph" }] as any)).toEqual([]);
  });
});

describe("AssistantMentionExtractor.validate", () => {
  it("drops types absent from the catalog, ids outside the scope, and vanished records", async () => {
    const catalog = { getEntityDetail: (type: string) => (type === "npcs" ? { type: "npcs" } : null) };
    const guard = { isInScope: vi.fn(async ({ id }: any) => id !== "outside") };
    const registry = { get: () => ({ findRecordById: async ({ id }: any) => (id === "gone" ? null : { id }) }) };

    const extractor = new AssistantMentionExtractor(catalog as any, guard as any, registry as any);
    const validated = await extractor.validate({
      mentions: [
        { type: "npcs", id: "keep", alias: "Keep" },
        { type: "npcs", id: "outside", alias: "Other campaign" },
        { type: "npcs", id: "gone", alias: "Deleted" },
        { type: "unicorns", id: "x", alias: "Not catalogued" },
      ],
      ctx: ctx as any,
    });

    expect(validated).toEqual([{ type: "npcs", id: "keep", alias: "Keep" }]);
  });
});
