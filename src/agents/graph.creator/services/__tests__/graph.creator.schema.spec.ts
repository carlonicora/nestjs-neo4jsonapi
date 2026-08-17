import { describe, expect, it } from "vitest";
import {
  buildGraphCreatorOutputSchema,
  defaultAtomicFactDescription,
  defaultKeyConceptDescriptionDescription,
  defaultKeyConceptsDescription,
  graphCreatorOutputSchema,
} from "../graph.creator.service";

/**
 * BACKWARD-COMPATIBILITY LOCK for every app that consumes this library without
 * overriding anything.
 *
 * The Graph Creator's field descriptions became overridable so that an app
 * extracting invented fiction is not told, inline with the field it is filling,
 * that "player" is an example of something NOT to extract. That change is only
 * safe if a consumer which supplies NO overrides gets byte-identical prompts to
 * the ones it got before — the extraction it has already run, and the graph it
 * has already built, depend on those exact strings.
 *
 * These are therefore not descriptive tests. They are a tripwire: any future
 * edit to a default description fails here, and whoever makes it has to decide
 * deliberately that every existing consumer should re-extract.
 */
describe("graph creator output schema", () => {
  it("keeps the historical key-concept description when nothing is overridden", () => {
    expect(defaultKeyConceptsDescription).toBe(
      `Only semantically meaningful entities: proper names (people, organizations), places, significant dates (with full date like "15/2/2023", NOT isolated times like "12.40"). Preserve exact characters. NO common nouns, NO isolated times without dates, NO administrative timestamps. Examples: "andrea ciampaglia", "tribunale di roma", "15/2/2023", "notifica", "presidente" - NOT "verbale", "12.40", "player", "thing"`,
    );
  });

  it("keeps the historical atomic-fact description when nothing is overridden", () => {
    expect(defaultAtomicFactDescription).toBe(
      `A single, indivisible fact containing ONLY ONE action/event/relationship. Each fact must have exactly ONE verb. If source text has multiple actions (e.g., "detects, grants and postpones"), split into separate atomic facts. NO compound sentences. Examples: "The president detects the ambiguity of the notification" (one action: detects). NOT: "The president detects the ambiguity and grants an extension" (two actions - must split).`,
    );
  });

  it("keeps the historical concept-description description when nothing is overridden", () => {
    expect(defaultKeyConceptDescriptionDescription).toBe(
      `Brief 1-2 sentence description of what this entity is in the context of the document. Explains its role, type, or significance.`,
    );
  });

  it("builds the historical schema when called with no overrides", () => {
    const item = buildGraphCreatorOutputSchema().shape.atomicFacts.element.shape;
    expect(item.keyConcepts.description).toBe(defaultKeyConceptsDescription);
    expect(item.atomicFact.description).toBe(defaultAtomicFactDescription);
  });

  it("builds the historical schema when called with an empty override object", () => {
    // The config field is optional-per-key, so an app that overrides only one
    // description must still get the library default for the other two.
    const item = buildGraphCreatorOutputSchema({ atomicFact: "custom" }).shape.atomicFacts.element.shape;
    expect(item.atomicFact.description).toBe("custom");
    expect(item.keyConcepts.description).toBe(defaultKeyConceptsDescription);
  });

  it("exports the no-override schema under its historical name", () => {
    expect(graphCreatorOutputSchema.shape.atomicFacts.element.shape.keyConcepts.description).toBe(
      defaultKeyConceptsDescription,
    );
  });

  it("still demands every collection the service post-processes", () => {
    for (const key of ["atomicFacts", "keyConceptsRelationships", "keyConceptDescriptions", "dates"]) {
      expect(Object.keys(graphCreatorOutputSchema.shape)).toContain(key);
    }
  });
});
