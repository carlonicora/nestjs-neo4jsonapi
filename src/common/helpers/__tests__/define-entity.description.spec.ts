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
