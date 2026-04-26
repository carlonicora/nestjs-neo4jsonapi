import { afterEach, describe, expect, it } from "vitest";
import { AssistantMessageDescriptor } from "../../entities/assistant-message";
import { ChunkDescriptor } from "../../../chunk/entities/chunk.entity";
import { modelRegistry } from "../../../../common/registries/registry";
import type { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";

/**
 * Descriptor + polymorphic-discriminator integration for the
 * AssistantMessage → Chunk → source(Document) → author(User) include chain.
 *
 * The "e2e" tests in this codebase do NOT exercise Neo4j or HTTP — they assert
 * the entity surface that the JSON:API include framework consumes at traversal
 * time. This spec verifies:
 *   1. AssistantMessageDescriptor declares the `citations` relationship
 *      (CITES, out, many) with the edge fields the responder/repo use.
 *   2. ChunkDescriptor declares the polymorphic `source` relationship added in
 *      Task 1, whose discriminator uses modelRegistry to resolve the concrete
 *      model from the Neo4j labels at traversal time.
 *   3. With a Document-shaped model registered, the discriminator returns it
 *      for `labels: ["Document"]` (the link the include framework would walk
 *      to reach `citations.source` and then `citations.source.author`).
 *   4. With unrecognised labels, the discriminator throws an error tagged with
 *      the HAS_CHUNK relationship name so failures surface clearly.
 */
describe("AssistantMessage citations include chain (descriptor + discriminator)", () => {
  // Snapshot the registry's pre-test state so we can restore after each test
  // without leaking the stub Document model into other suites.
  const registryAny = modelRegistry as any;
  const originalModels = new Map<string, any>(registryAny.models);
  const originalLabelIndex = new Map<string, any>(registryAny.labelNameIndex);
  const originalTypeIndex = new Map<string, any>(registryAny.typeIndex);

  afterEach(() => {
    registryAny.models = new Map(originalModels);
    registryAny.labelNameIndex = new Map(originalLabelIndex);
    registryAny.typeIndex = new Map(originalTypeIndex);
  });

  it("AssistantMessageDescriptor.relationships.citations is wired over CITES with relevance/reason edge fields", () => {
    const citations = AssistantMessageDescriptor.relationships.citations;
    expect(citations).toBeDefined();
    expect(citations.relationship).toBe("CITES");
    expect(citations.direction).toBe("out");
    expect(citations.cardinality).toBe("many");
    expect(citations.fields).toEqual(
      expect.arrayContaining([
        { name: "relevance", type: "number", required: true },
        { name: "reason", type: "string", required: false },
      ]),
    );
  });

  it("ChunkDescriptor.relationships.source declares a polymorphic discriminator function (Task 1 wiring)", () => {
    const source = ChunkDescriptor.relationships.source;
    expect(source).toBeDefined();
    expect(source.relationship).toBe("HAS_CHUNK");
    expect(source.direction).toBe("in");
    expect(source.cardinality).toBe("one");
    expect(source.polymorphic).toBeDefined();
    expect(typeof source.polymorphic!.discriminator).toBe("function");
  });

  it("discriminator resolves a Document-labelled node to the registered Document model", () => {
    const documentStub: DataModelInterface<any> = {
      type: "documents",
      endpoint: "documents",
      nodeName: "document",
      labelName: "Document",
      entity: undefined as any,
      mapper: (() => ({})) as any,
    };
    modelRegistry.register(documentStub);

    const resolved = ChunkDescriptor.relationships.source.polymorphic!.discriminator({
      properties: { id: "doc-1" },
      labels: ["Document"],
    });

    expect(resolved).toBe(documentStub);
  });

  it("discriminator throws a HAS_CHUNK-tagged error when no registered model matches the labels", () => {
    expect(() =>
      ChunkDescriptor.relationships.source.polymorphic!.discriminator({
        properties: { id: "x" },
        labels: ["Unknown"],
      }),
    ).toThrow(/HAS_CHUNK/);
  });
});
