import { describe, expect, it } from "vitest";
import { buildContentDescriptor, ContentDescriptor } from "../content";
import { ContentExtensionConfig } from "../../interfaces/content.extension.interface";

const metaKeys = (descriptor: ReturnType<typeof buildContentDescriptor>): string[] =>
  [
    ...Object.entries(descriptor.fields ?? {})
      .filter(([, def]) => (def as any)?.meta)
      .map(([name]) => name),
    ...Object.entries(descriptor.computed ?? {})
      .filter(([, def]) => (def as any)?.meta)
      .map(([name]) => name),
  ].sort();

const attributeKeys = (descriptor: ReturnType<typeof buildContentDescriptor>): string[] =>
  Object.entries(descriptor.fields ?? {})
    .filter(([, def]) => !(def as any)?.meta)
    .map(([name]) => name)
    .sort();

describe("ContentDescriptor", () => {
  describe("without configuration (the package wire contract)", () => {
    it("should expose the legacy serialiser's attributes", () => {
      expect(attributeKeys(ContentDescriptor)).toEqual(["abstract", "name", "tldr"]);
    });

    it("should expose the legacy serialiser's meta", () => {
      expect(metaKeys(ContentDescriptor)).toEqual(["aiStatus", "contentType", "relevance"]);
    });

    it("should expose the legacy serialiser's relationships", () => {
      expect(Object.keys(ContentDescriptor.relationships).sort()).toEqual(["author", "owner"]);
    });

    it("should keep owner and author as incoming PUBLISHED single relationships", () => {
      for (const key of ["owner", "author"]) {
        expect(ContentDescriptor.relationships[key]).toMatchObject({
          direction: "in",
          relationship: "PUBLISHED",
          cardinality: "one",
        });
      }
    });

    it("should derive the legacy single children tokens (plus company)", () => {
      expect(ContentDescriptor.model.singleChildrenTokens).toEqual(["company", "owner", "author"]);
      expect(ContentDescriptor.model.childrenTokens).toEqual([]);
    });

    it("should compute contentType from the Neo4j label", () => {
      const compute = (ContentDescriptor.computed as any).contentType.compute;

      expect(compute({ data: { labels: ["Article"] }, record: {}, entityFactory: {} })).toBe("Article");
      expect(compute({ data: {}, record: {}, entityFactory: {} })).toBeUndefined();
    });

    it("should compute relevance from totalScore", () => {
      const compute = (ContentDescriptor.computed as any).relevance.compute;
      const record = { has: (key: string) => key === "totalScore", get: () => 42 };

      expect(compute({ data: {}, record, entityFactory: {} })).toBe(42);
      expect(compute({ data: {}, record: { has: () => false }, entityFactory: {} })).toBe(0);
    });
  });

  describe("with the a360ai configuration", () => {
    const A360_CONFIG: ContentExtensionConfig = {
      additionalRelationships: [],
      ownerMatchPattern: { relationships: ["PUBLISHED", "FROM"], undirected: true },
      requireTldr: true,
      metaFields: [
        {
          key: "proceedingId",
          optionalMatch: "OPTIONAL MATCH (memoProceeding:Proceeding)-[:HAS_MEMO]->(content)",
          returnAlias: "memoProceeding.id",
        },
      ],
      serialiseAuthor: false,
    };

    const descriptor = buildContentDescriptor(A360_CONFIG);

    it("should pin the a360ai attributes", () => {
      expect(attributeKeys(descriptor)).toEqual(["abstract", "name", "tldr"]);
    });

    it("should pin the a360ai meta (including proceedingId)", () => {
      expect(metaKeys(descriptor)).toEqual(["aiStatus", "contentType", "proceedingId", "relevance"]);
    });

    it("should pin the a360ai relationships (owner only)", () => {
      expect(Object.keys(descriptor.relationships)).toEqual(["owner"]);
      expect(descriptor.model.singleChildrenTokens).toEqual(["company", "owner"]);
    });

    it("should read the meta field from its RETURN alias", () => {
      const compute = (descriptor.computed as any).proceedingId.compute;
      const proceedingId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

      expect(
        compute({
          data: {},
          record: { has: (key: string) => key === "proceedingId", get: () => proceedingId },
          entityFactory: {},
        }),
      ).toBe(proceedingId);
      expect(compute({ data: {}, record: { has: () => false }, entityFactory: {} })).toBeUndefined();
      expect(compute({ data: {}, record: { has: () => true, get: () => null }, entityFactory: {} })).toBeUndefined();
    });
  });

  describe("with additional relationships", () => {
    const descriptor = buildContentDescriptor({
      additionalRelationships: [
        {
          model: { type: "topics", endpoint: "topics", nodeName: "topic", labelName: "Topic" },
          relationship: "HAS_KNOWLEDGE",
          direction: "in",
          cardinality: "many",
          dtoKey: "topics",
        },
      ],
    });

    it("should key the relationship by the related model nodeName (the Cypher RETURN alias)", () => {
      expect(Object.keys(descriptor.relationships).sort()).toEqual(["author", "owner", "topic"]);
      expect(descriptor.relationships.topic).toMatchObject({
        relationship: "HAS_KNOWLEDGE",
        direction: "in",
        cardinality: "many",
        dtoKey: "topics",
      });
    });

    it("should add many-cardinality relationships to childrenTokens", () => {
      expect(descriptor.model.childrenTokens).toEqual(["topic"]);
    });
  });
});
