import { describe, expect, it } from "vitest";
import { defineEntity } from "../define-entity";

/**
 * The FULLTEXT index is derived automatically from every field declared
 * `type: "string"`. That sweeps in machine-readable values — JSON config blobs,
 * UUID references, auth tokens — making them searchable text, so a query for
 * "nude" can match an entity whose *name* is "Boudoir" because the term appears
 * inside a stored config blob.
 *
 * `excludeFromSearch` opts a single field out of the index. It changes nothing
 * about how the field is stored, validated, or serialised.
 */
describe("defineEntity — excludeFromSearch", () => {
  it("omits an excluded string field from stringFields and the fulltext index", () => {
    const descriptor = defineEntity<{ name: string; discoveryConfig: string }>()({
      type: "moodboards",
      endpoint: "moodboards",
      nodeName: "moodboard",
      labelName: "Moodboard",
      fields: {
        name: { type: "string", required: true },
        discoveryConfig: { type: "string", excludeFromSearch: true },
      },
      relationships: {},
    });

    expect(descriptor.stringFields).toEqual(["name"]);
    expect(descriptor.indexes).toEqual([{ name: "moodboard_search_index", properties: ["name"], type: "FULLTEXT" }]);
    expect(descriptor.fulltextIndexName).toBe("moodboard_search_index");
  });

  it("creates no fulltext index when every string field is excluded", () => {
    const descriptor = defineEntity<{ token: string; refreshToken: string }>()({
      type: "authPersons",
      endpoint: "auth-persons",
      nodeName: "authPerson",
      labelName: "AuthPerson",
      fields: {
        token: { type: "string", required: true, excludeFromSearch: true },
        refreshToken: { type: "string", required: true, excludeFromSearch: true },
      },
      relationships: {},
    });

    expect(descriptor.stringFields).toEqual([]);
    expect(descriptor.indexes).toEqual([]);
    // An empty name is the established "no index" signal, already honoured by
    // every `params.term && this.descriptor.fulltextIndexName` search guard.
    expect(descriptor.fulltextIndexName).toBe("");
  });

  it("leaves entities that do not use the flag completely unchanged", () => {
    // This is the safety contract for a submodule shared with sibling repos:
    // absent the opt-in, derivation must behave exactly as it always has.
    const descriptor = defineEntity<{ name: string; description: string }>()({
      type: "galleries",
      endpoint: "galleries",
      nodeName: "gallery",
      labelName: "Gallery",
      fields: {
        name: { type: "string", required: true },
        description: { type: "string" },
        photoCount: { type: "number" },
      },
      relationships: {},
    });

    expect(descriptor.stringFields).toEqual(["name", "description"]);
    expect(descriptor.fulltextIndexName).toBe("gallery_search_index");
  });
});
