import { describe, it, expect } from "vitest";
import { defineEntity, MAX_INCLUDE_DEPTH } from "../define-entity";

const npcMeta = { type: "npcs", endpoint: "npcs", nodeName: "npc", labelName: "Npc" };
const turnMeta = { type: "turns", endpoint: "turns", nodeName: "turn", labelName: "Turn" };

type Turn = { id: string };

const buildTurn = (relOverrides: Record<string, any> = {}) =>
  defineEntity<Turn>()({
    ...turnMeta,
    isCompanyScoped: false,
    fields: {},
    relationships: {
      npc: {
        model: npcMeta,
        direction: "out",
        relationship: "PLAYED_BY",
        cardinality: "one",
        required: false,
        ...relOverrides,
      },
    },
  });

describe("defineEntity — enriched RelationshipInfo", () => {
  it("populates direction/relationship/cardinality/required on singleChildrenRelationships", () => {
    const descriptor = buildTurn();
    const npc = descriptor.model.singleChildrenRelationships!.find((r) => r.relationshipName === "npc");
    expect(npc).toMatchObject({
      nodeName: "npc",
      relationshipName: "npc",
      direction: "out",
      relationship: "PLAYED_BY",
      cardinality: "one",
      required: false,
    });
  });
});

describe("defineEntity — include validation", () => {
  it("accepts a valid include path and preserves it on the descriptor", () => {
    const descriptor = defineEntity<{ id: string }>()({
      type: "rounds",
      endpoint: "rounds",
      nodeName: "round",
      labelName: "Round",
      isCompanyScoped: false,
      fields: {},
      relationships: {
        turns: { model: turnMeta, direction: "in", relationship: "PART_OF", cardinality: "many", include: ["npc"] },
      },
    });
    expect(descriptor.relationships.turns.include).toEqual(["npc"]);
  });

  it("throws when an include path is deeper than MAX_INCLUDE_DEPTH", () => {
    const tooDeep = Array.from({ length: MAX_INCLUDE_DEPTH + 1 }, () => "x").join(".");
    expect(() =>
      defineEntity<{ id: string }>()({
        type: "rounds",
        endpoint: "rounds",
        nodeName: "round",
        labelName: "Round",
        isCompanyScoped: false,
        fields: {},
        relationships: {
          turns: { model: turnMeta, direction: "in", relationship: "PART_OF", cardinality: "many", include: [tooDeep] },
        },
      }),
    ).toThrow(/MAX_INCLUDE_DEPTH/);
  });

  it("throws when include is declared on a relationship that also has edge fields", () => {
    expect(() =>
      defineEntity<{ id: string }>()({
        type: "rounds",
        endpoint: "rounds",
        nodeName: "round",
        labelName: "Round",
        isCompanyScoped: false,
        fields: {},
        relationships: {
          turns: {
            model: turnMeta,
            direction: "in",
            relationship: "PART_OF",
            cardinality: "many",
            fields: [{ name: "position", type: "number" }],
            include: ["npc"],
          },
        },
      }),
    ).toThrow(/edge .*fields.* include|include.*edge/i);
  });
});
