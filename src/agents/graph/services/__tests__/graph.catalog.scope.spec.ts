import { describe, expect, it } from "vitest";
import { GraphCatalogService } from "../graph.catalog.service";

const campaign = {
  model: { type: "campaigns", nodeName: "campaign", labelName: "Campaign" },
  description: "A campaign.",
  moduleId: "m-campaign",
  fields: { name: { type: "string", description: "Name." } },
  relationships: {},
  chat: { scope: "self", textSearchFields: ["name"] },
};

const recording = {
  model: { type: "recordings", nodeName: "recording", labelName: "Recording" },
  description: "A recording.",
  moduleId: "m-recording",
  fields: { status: { type: "string", description: "Status." } },
  relationships: {
    campaign: {
      model: { type: "campaigns", nodeName: "campaign", labelName: "Campaign" },
      direction: "out",
      relationship: "PART_OF",
      cardinality: "one",
    },
  },
  chat: { scope: "campaign" },
};

const transcript = {
  model: { type: "transcripts", nodeName: "transcript", labelName: "Transcript" },
  description: "A transcript.",
  moduleId: "m-transcript",
  fields: { text: { type: "string", description: "Text." } },
  relationships: {
    recording: {
      model: { type: "recordings", nodeName: "recording", labelName: "Recording" },
      direction: "out",
      relationship: "FROM_RECORDING",
      cardinality: "one",
    },
  },
  chat: { scope: "recording" },
};

const source = (entries: any[]) => ({ loadAll: () => entries });
const modules = ["m-campaign", "m-recording", "m-transcript"];

// GraphCatalogService builds on onApplicationBootstrap, not in the
// constructor (graph.catalog.service.ts:52-56), so buildCatalog() is called
// explicitly here — and is also what must throw on a bad chain.
const build = (entries: any[]) => {
  const catalog = new GraphCatalogService(source(entries) as any);
  catalog.buildCatalog();
  return catalog;
};

describe("GraphCatalogService scope compilation", () => {
  it("compiles a two-hop chain to the scope root", () => {
    const catalog = build([campaign, recording, transcript]);
    const detail = catalog.getEntityDetail("transcripts", modules)!;

    expect(detail.scope).toEqual({
      rootType: "campaigns",
      rootLabel: "Campaign",
      path: [
        {
          key: "recording",
          cypherLabel: "FROM_RECORDING",
          cypherDirection: "out",
          targetLabel: "Recording",
          targetType: "recordings",
        },
        {
          key: "campaign",
          cypherLabel: "PART_OF",
          cypherDirection: "out",
          targetLabel: "Campaign",
          targetType: "campaigns",
        },
      ],
    });
  });

  it("compiles the root itself to an empty path", () => {
    const catalog = build([campaign]);
    expect(catalog.getEntityDetail("campaigns", ["m-campaign"])!.scope).toEqual({
      rootType: "campaigns",
      rootLabel: "Campaign",
      path: [],
    });
  });

  it("leaves scope undefined when a descriptor declares no chat.scope", () => {
    const unscoped = { ...recording, chat: {} };
    const catalog = build([campaign, unscoped]);
    expect(catalog.getEntityDetail("recordings", modules)!.scope).toBeUndefined();
  });

  it("throws when a chain never reaches a self root", () => {
    // recording's own chat.scope points at campaigns, which is absent here.
    const orphan = { ...campaign, chat: {} };
    expect(() => build([orphan, recording])).toThrow(/never reaches a scope root/i);
  });

  it("throws when a chain revisits a type", () => {
    const looping = {
      ...campaign,
      chat: { scope: "recording" },
      relationships: {
        recording: {
          model: { type: "recordings", nodeName: "recording", labelName: "Recording" },
          direction: "in",
          relationship: "PART_OF",
          cardinality: "many",
        },
      },
    };
    expect(() => build([looping, recording])).toThrow(/cycle/i);
  });

  it("throws when a writable type is more than one hop from its root", () => {
    const writableTranscript = { ...transcript, chat: { scope: "recording", writable: true } };
    expect(() => build([campaign, recording, writableTranscript])).toThrow(/writable/i);
  });
});
