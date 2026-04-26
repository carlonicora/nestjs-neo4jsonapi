import { describe, it, expect } from "vitest";
import { defineEntity } from "../define-entity";

describe("defineEntity — description and reverse extensions", () => {
  it("accepts top-level description, chat block, field description, relationship description + reverse", () => {
    const descriptor = defineEntity<{ name: string }>()({
      type: "widgets",
      endpoint: "widgets",
      nodeName: "widget",
      labelName: "Widget",
      description: "A widget — a unit of work.",
      chat: {
        summary: (data: any) => `${data.name}`,
        textSearchFields: ["name"],
      },
      fields: {
        name: { type: "string", required: true, description: "Human-readable name." },
      },
      relationships: {
        owner: {
          model: { type: "users", endpoint: "users", nodeName: "user", labelName: "User" },
          direction: "in",
          relationship: "OWNS",
          cardinality: "one",
          description: "User who owns this widget.",
          reverse: {
            name: "widgets",
            description: "Widgets owned by this user.",
          },
        },
      },
    });

    expect((descriptor as any).description).toBe("A widget — a unit of work.");
    expect((descriptor as any).chat.textSearchFields).toEqual(["name"]);
    expect((descriptor as any).fields.name.description).toBe("Human-readable name.");
    expect((descriptor as any).relationships.owner.description).toBe("User who owns this widget.");
    expect((descriptor as any).relationships.owner.reverse).toEqual({
      name: "widgets",
      description: "Widgets owned by this user.",
    });
  });
});

describe("defineEntity — bridge declaration", () => {
  const baseSchema = {
    type: "bom-entries",
    endpoint: "bom-entries",
    nodeName: "bomEntry",
    labelName: "BomEntry",
    description: "Junction record between a BoM and items/parts.",
    fields: { position: { type: "number", description: "Row order." } },
    relationships: {
      bom: {
        model: { type: "boms", endpoint: "boms", nodeName: "bom", labelName: "BoM" },
        direction: "in" as const,
        relationship: "HAS_BOM_ENTRY",
        cardinality: "one" as const,
        description: "Parent BoM.",
      },
      item: {
        model: { type: "items", endpoint: "items", nodeName: "item", labelName: "Item" },
        direction: "out" as const,
        relationship: "FOR_ITEM",
        cardinality: "one" as const,
        description: "Item this entry refers to.",
      },
    },
  };

  it("accepts bridge.materialiseTo when keys match relationships", () => {
    const d = defineEntity<{ position?: number }>()({
      ...baseSchema,
      bridge: { materialiseTo: ["item"] },
    } as any);
    expect((d as any).bridge).toEqual({ materialiseTo: ["item"] });
  });

  it("throws when bridge.materialiseTo references an unknown relationship", () => {
    expect(() =>
      defineEntity<{ position?: number }>()({
        ...baseSchema,
        bridge: { materialiseTo: ["doesNotExist"] },
      } as any),
    ).toThrow(/materialiseTo references "doesNotExist"/);
  });

  it("throws when bridge is set but description is missing", () => {
    const { description: _drop, ...withoutDescription } = baseSchema;
    expect(() =>
      defineEntity<{ position?: number }>()({
        ...withoutDescription,
        bridge: { materialiseTo: ["item"] },
      } as any),
    ).toThrow(/requires a top-level "description"/);
  });

  it("throws when bridge.materialiseTo is empty", () => {
    expect(() =>
      defineEntity<{ position?: number }>()({
        ...baseSchema,
        bridge: { materialiseTo: [] },
      } as any),
    ).toThrow(/non-empty string\[\]/);
  });
});
