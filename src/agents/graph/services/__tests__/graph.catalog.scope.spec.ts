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
          dtoKey: "recording",
          cypherLabel: "FROM_RECORDING",
          cypherDirection: "out",
          targetLabel: "Recording",
          targetType: "recordings",
        },
        {
          key: "campaign",
          dtoKey: "campaign",
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

  describe("inline scope hops", () => {
    const campaignMeta = { type: "campaigns", nodeName: "campaign", labelName: "Campaign" };
    const npc = {
      model: { type: "npcs", nodeName: "npc", labelName: "Npc" },
      description: "An NPC.",
      moduleId: "m-npc",
      fields: { name: { type: "string", description: "Name." } },
      relationships: {},
      chat: { scope: { model: campaignMeta, direction: "out", relationship: "PART_OF|IN" } },
    };
    const npcModules = [...modules, "m-npc"];

    it("compiles an inline hop", () => {
      const catalog = build([campaign, npc]);
      const scope = catalog.getEntityDetail("npcs", npcModules)!.scope!;

      expect(scope.path[0]).toEqual({
        key: "",
        dtoKey: "",
        cypherLabel: "PART_OF|IN",
        cypherDirection: "out",
        targetLabel: "Campaign",
        targetType: "campaigns",
        inline: true,
      });
      expect(scope.rootType).toBe("campaigns");
    });

    it("an inline hop adds no catalog relationship", () => {
      const catalog = build([campaign, npc]);
      const relationships = catalog.getEntityDetail("npcs", npcModules)!.relationships;
      expect(relationships.find((r) => r.targetType === "campaigns")).toBeUndefined();
      expect(relationships).toEqual([]);
    });

    it("rejects an inline hop to an uncatalogued type", () => {
      expect(() => build([npc])).toThrow(/never reaches a scope root/);
    });

    it("rejects writable on an inline-scoped type", () => {
      const writableNpc = { ...npc, chat: { ...npc.chat, writable: true } };
      expect(() => build([campaign, writableNpc])).toThrow(/writable/i);
    });
  });

  describe("scopeShared", () => {
    const law = {
      model: { type: "laws", nodeName: "law", labelName: "Law" },
      description: "A law.",
      moduleId: "m-law",
      fields: { name: { type: "string", description: "Name." } },
      relationships: {},
      chat: { scopeShared: true },
    };

    it("rejects scopeShared together with scope", () => {
      const scopedShared = { ...recording, chat: { scope: "campaign", scopeShared: true } };
      expect(() => build([campaign, scopedShared])).toThrow(/scopeShared/);
    });

    it("rejects scopeShared on a writable type", () => {
      const writableShared = { ...law, chat: { scopeShared: true, writable: true } };
      expect(() => build([writableShared])).toThrow(/scopeShared/);
    });

    it("mirrors scopeShared on the catalog entity", () => {
      const catalog = build([law]);
      const entity = catalog.getEntityDetail("laws", ["m-law"])!;
      expect(entity.scopeShared).toBe(true);
      expect(entity.scope).toBeUndefined();
    });
  });

  describe("scopeByService", () => {
    const note = {
      model: { type: "notes", nodeName: "note", labelName: "Note" },
      description: "A note kept outside the app database.",
      moduleId: "m-note",
      fields: { text: { type: "string", description: "Text." } },
      relationships: {},
      chat: { scopeByService: { rootType: "campaigns" } },
    };

    it("compiles scopeByService", () => {
      const catalog = build([campaign, note]);
      const entity = catalog.getEntityDetail("notes", ["m-note"])!;
      // rootLabel is required by CatalogScope; it is the root's label.
      expect(entity.scope).toEqual({ rootType: "campaigns", rootLabel: "Campaign", path: [], viaService: true });
    });

    it("rejects scopeByService together with scope", () => {
      const both = { ...recording, chat: { scope: "campaign", scopeByService: { rootType: "campaigns" } } };
      expect(() => build([campaign, both])).toThrow(/scopeByService/);
    });

    it("rejects scopeByService together with scopeShared", () => {
      const both = { ...note, chat: { scopeShared: true, scopeByService: { rootType: "campaigns" } } };
      expect(() => build([campaign, both])).toThrow(/scopeByService/);
    });

    it("rejects scopeByService to a non-root type", () => {
      const toRecording = { ...note, chat: { scopeByService: { rootType: "recordings" } } };
      expect(() => build([campaign, recording, toRecording])).toThrow(/never reaches a scope root/);
    });
  });
});
