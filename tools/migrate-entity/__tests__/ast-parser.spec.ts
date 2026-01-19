/**
 * AST Parser Unit Tests
 *
 * Tests the parsing functions that extract configuration from old-style entity files.
 */

import { describe, it, expect } from "vitest";
import * as path from "path";
import { parseMetaFile, parseEntityFile, parseMapFile, parseSerialiserFile, parseOldFiles } from "../lib/ast-parser";
import { OldEntityFiles } from "../lib/types";

const FIXTURES_DIR = path.resolve(__dirname, "../__fixtures__");

describe("ast-parser", () => {
  describe("parseMetaFile", () => {
    it("should parse DataMeta with all required fields from test-entity", () => {
      const metaPath = path.join(FIXTURES_DIR, "entities/test-entity.meta.ts");
      const result = parseMetaFile(metaPath);

      expect(result.type).toBe("test-entities");
      expect(result.endpoint).toBe("test-entities");
      expect(result.nodeName).toBe("testEntity");
      expect(result.labelName).toBe("TestEntity");
    });

    it("should parse DataMeta from simple-entity", () => {
      const metaPath = path.join(FIXTURES_DIR, "simple-entity/simple-entity.meta.ts");
      const result = parseMetaFile(metaPath);

      expect(result.type).toBe("simple-entities");
      expect(result.endpoint).toBe("simple-entities");
      expect(result.nodeName).toBe("simpleEntity");
      expect(result.labelName).toBe("SimpleEntity");
    });

    it("should parse DataMeta from complex-entity", () => {
      const metaPath = path.join(FIXTURES_DIR, "complex-entity/complex-entity.meta.ts");
      const result = parseMetaFile(metaPath);

      expect(result.type).toBe("complex-entities");
      expect(result.endpoint).toBe("complex-entities");
      expect(result.nodeName).toBe("complexEntity");
      expect(result.labelName).toBe("ComplexEntity");
    });
  });

  describe("parseEntityFile", () => {
    it("should extract entity name from type definition", () => {
      const entityPath = path.join(FIXTURES_DIR, "entities/test-entity.ts");
      const result = parseEntityFile(entityPath);

      expect(result.name).toBe("TestEntity");
    });

    it("should extract scalar fields from type definition", () => {
      const entityPath = path.join(FIXTURES_DIR, "entities/test-entity.ts");
      const result = parseEntityFile(entityPath);

      const fieldNames = result.fields.map((f) => f.name);
      expect(fieldNames).toContain("name");
      expect(fieldNames).toContain("description");
      expect(fieldNames).toContain("url");
      expect(fieldNames).toContain("tags");
    });

    it("should identify relationship fields separately", () => {
      const entityPath = path.join(FIXTURES_DIR, "entities/test-entity.ts");
      const result = parseEntityFile(entityPath);

      const relFieldNames = result.relationshipFields.map((f) => f.name);
      expect(relFieldNames).toContain("company");
      expect(relFieldNames).toContain("author");
    });

    it("should handle optional fields (?)", () => {
      const entityPath = path.join(FIXTURES_DIR, "entities/test-entity.ts");
      const result = parseEntityFile(entityPath);

      const descField = result.fields.find((f) => f.name === "description");
      expect(descField?.optional).toBe(true);

      const nameField = result.fields.find((f) => f.name === "name");
      expect(nameField?.optional).toBe(false);
    });

    it("should handle array types (string[])", () => {
      const entityPath = path.join(FIXTURES_DIR, "entities/test-entity.ts");
      const result = parseEntityFile(entityPath);

      const tagsField = result.fields.find((f) => f.name === "tags");
      expect(tagsField?.type).toBe("string[]");

      const samplePhotographsField = result.fields.find((f) => f.name === "samplePhotographs");
      expect(samplePhotographsField?.type).toBe("string[]");
    });

    it("should extract imports from entity file", () => {
      const entityPath = path.join(FIXTURES_DIR, "entities/test-entity.ts");
      const result = parseEntityFile(entityPath);

      expect(result.imports.length).toBeGreaterThan(0);
      expect(result.imports.some((i) => i.includes("Entity"))).toBe(true);
    });

    it("should extract all field types from simple-entity", () => {
      const entityPath = path.join(FIXTURES_DIR, "simple-entity/simple-entity.ts");
      const result = parseEntityFile(entityPath);

      expect(result.name).toBe("SimpleEntity");

      const titleField = result.fields.find((f) => f.name === "title");
      expect(titleField?.type).toBe("string");
      expect(titleField?.optional).toBe(false);

      const countField = result.fields.find((f) => f.name === "count");
      expect(countField?.type).toBe("number");

      const isActiveField = result.fields.find((f) => f.name === "isActive");
      expect(isActiveField?.type).toBe("boolean");

      const createdAtField = result.fields.find((f) => f.name === "createdAt");
      expect(createdAtField?.type).toBe("Date");
      expect(createdAtField?.optional).toBe(true);
    });

    it("should extract relationships from complex-entity", () => {
      const entityPath = path.join(FIXTURES_DIR, "complex-entity/complex-entity.ts");
      const result = parseEntityFile(entityPath);

      expect(result.name).toBe("ComplexEntity");

      const relFieldNames = result.relationshipFields.map((f) => f.name);
      expect(relFieldNames).toContain("author");
      expect(relFieldNames).toContain("company");
      expect(relFieldNames).toContain("items");

      const itemsField = result.relationshipFields.find((f) => f.name === "items");
      expect(itemsField?.type).toBe("Item[]");
    });
  });

  describe("parseMapFile", () => {
    it("should extract regular field mappings", () => {
      const mapPath = path.join(FIXTURES_DIR, "entities/test-entity.map.ts");
      const result = parseMapFile(mapPath);

      const fieldNames = result.fields.map((f) => f.name);
      expect(fieldNames).toContain("name");
      expect(fieldNames).toContain("description");
      expect(fieldNames).toContain("url");

      const nameField = result.fields.find((f) => f.name === "name");
      expect(nameField?.mapping).toBe("params.data.name");
      expect(nameField?.isComputed).toBe(false);
    });

    it("should identify computed fields (params.record access)", () => {
      const mapPath = path.join(FIXTURES_DIR, "entities/test-entity.map.ts");
      const result = parseMapFile(mapPath);

      const computedFields = result.fields.filter((f) => f.isComputed);
      expect(computedFields.length).toBeGreaterThan(0);

      const relevanceField = result.fields.find((f) => f.name === "relevance");
      expect(relevanceField?.isComputed).toBe(true);
      expect(relevanceField?.mapping).toContain("params.record.has");
    });

    it("should handle Neo4j integer conversion (.low)", () => {
      const mapPath = path.join(FIXTURES_DIR, "entities/test-entity.map.ts");
      const result = parseMapFile(mapPath);

      const itemCountField = result.fields.find((f) => f.name === "itemCount");
      expect(itemCountField?.isComputed).toBe(true);
      expect(itemCountField?.mapping).toContain(".low");
    });

    it("should extract imports from map file", () => {
      const mapPath = path.join(FIXTURES_DIR, "entities/test-entity.map.ts");
      const result = parseMapFile(mapPath);

      expect(result.imports.length).toBeGreaterThan(0);
    });

    it("should parse simple-entity mapper without computed fields", () => {
      const mapPath = path.join(FIXTURES_DIR, "simple-entity/simple-entity.map.ts");
      const result = parseMapFile(mapPath);

      const fieldNames = result.fields.map((f) => f.name);
      expect(fieldNames).toContain("title");
      expect(fieldNames).toContain("description");
      expect(fieldNames).toContain("count");

      const computedFields = result.fields.filter((f) => f.isComputed);
      expect(computedFields.length).toBe(0);
    });

    it("should parse complex-entity mapper with computed fields", () => {
      const mapPath = path.join(FIXTURES_DIR, "complex-entity/complex-entity.map.ts");
      const result = parseMapFile(mapPath);

      const totalScoreField = result.fields.find((f) => f.name === "totalScore");
      expect(totalScoreField?.isComputed).toBe(true);

      const itemCountField = result.fields.find((f) => f.name === "itemCount");
      expect(itemCountField?.isComputed).toBe(true);
    });
  });

  describe("parseSerialiserFile", () => {
    it("should extract attributes mapping", () => {
      const serialiserPath = path.join(FIXTURES_DIR, "entities/test-entity.serialiser.ts");
      const result = parseSerialiserFile(serialiserPath);

      const attrNames = result.attributes.map((a) => a.name);
      expect(attrNames).toContain("name");
      expect(attrNames).toContain("description");
      expect(attrNames).toContain("url");
      expect(attrNames).toContain("samplePhotographs");

      const nameAttr = result.attributes.find((a) => a.name === "name");
      expect(nameAttr?.mapping).toBe("name");
      expect(nameAttr?.isMeta).toBe(false);
    });

    it("should extract meta attributes", () => {
      const serialiserPath = path.join(FIXTURES_DIR, "entities/test-entity.serialiser.ts");
      const result = parseSerialiserFile(serialiserPath);

      const metaNames = result.meta.map((m) => m.name);
      expect(metaNames).toContain("position");
      expect(metaNames).toContain("relevance");
      expect(metaNames).toContain("itemCount");

      const positionMeta = result.meta.find((m) => m.name === "position");
      expect(positionMeta?.isMeta).toBe(true);
    });

    it("should extract relationships with model imports", () => {
      const serialiserPath = path.join(FIXTURES_DIR, "entities/test-entity.serialiser.ts");
      const result = parseSerialiserFile(serialiserPath);

      expect(result.relationships.length).toBeGreaterThan(0);

      const authorRel = result.relationships.find((r) => r.name === "author");
      expect(authorRel?.modelImport).toBe("UserModel");
    });

    it("should detect injected services from constructor", () => {
      const serialiserPath = path.join(FIXTURES_DIR, "entities/test-entity.serialiser.ts");
      const result = parseSerialiserFile(serialiserPath);

      expect(result.services).toContain("S3Service");
      expect(result.services).not.toContain("SerialiserFactory");
    });

    it("should detect custom methods", () => {
      // The test-entity.serialiser.ts now uses inline S3 transforms, so no custom methods.
      // Use complex-entity which still has a custom serialise method.
      const serialiserPath = path.join(FIXTURES_DIR, "complex-entity/complex-entity.serialiser.ts");
      const result = parseSerialiserFile(serialiserPath);

      // Complex entity has a custom 'serialise' method
      expect(result.customMethods.length).toBeGreaterThan(0);
    });

    it("should detect S3 transforms for URL fields", () => {
      const serialiserPath = path.join(FIXTURES_DIR, "entities/test-entity.serialiser.ts");
      const result = parseSerialiserFile(serialiserPath);

      expect(result.s3Transforms.length).toBeGreaterThan(0);

      const urlTransform = result.s3Transforms.find((t) => t.fieldName === "url");
      expect(urlTransform?.isArray).toBe(false);

      const samplePhotographsTransform = result.s3Transforms.find((t) => t.fieldName === "samplePhotographs");
      expect(samplePhotographsTransform?.isArray).toBe(true);
    });

    it("should not detect S3 transforms when S3Service is not injected", () => {
      const serialiserPath = path.join(FIXTURES_DIR, "simple-entity/simple-entity.serialiser.ts");
      const result = parseSerialiserFile(serialiserPath);

      expect(result.services).not.toContain("S3Service");
      expect(result.s3Transforms.length).toBe(0);
    });

    it("should parse complex-entity serialiser with multiple relationships", () => {
      const serialiserPath = path.join(FIXTURES_DIR, "complex-entity/complex-entity.serialiser.ts");
      const result = parseSerialiserFile(serialiserPath);

      const relNames = result.relationships.map((r) => r.name);
      expect(relNames).toContain("author");
      expect(relNames).toContain("company");
      expect(relNames).toContain("items");

      const itemsRel = result.relationships.find((r) => r.name === "items");
      expect(itemsRel?.dtoKey).toBe("items");
    });
  });

  describe("parseOldFiles", () => {
    it("should parse all test-entity files and return structured data", () => {
      const files: OldEntityFiles = {
        entityName: "TestEntity",
        entityDir: path.join(FIXTURES_DIR, "entities"),
        entity: path.join(FIXTURES_DIR, "entities/test-entity.ts"),
        meta: path.join(FIXTURES_DIR, "entities/test-entity.meta.ts"),
        model: path.join(FIXTURES_DIR, "entities/test-entity.model.ts"),
        map: path.join(FIXTURES_DIR, "entities/test-entity.map.ts"),
        serialiser: path.join(FIXTURES_DIR, "entities/test-entity.serialiser.ts"),
      };

      const result = parseOldFiles(files);

      // Verify meta
      expect(result.meta.type).toBe("test-entities");
      expect(result.meta.labelName).toBe("TestEntity");

      // Verify entity type
      expect(result.entityType.name).toBe("TestEntity");
      expect(result.entityType.fields.length).toBeGreaterThan(0);
      expect(result.entityType.relationshipFields.length).toBeGreaterThan(0);

      // Verify mapper
      expect(result.mapper).not.toBeNull();
      expect(result.mapper?.fields.length).toBeGreaterThan(0);

      // Verify serialiser
      expect(result.serialiser).not.toBeNull();
      expect(result.serialiser?.attributes.length).toBeGreaterThan(0);
      expect(result.serialiser?.services).toContain("S3Service");
      expect(result.serialiser?.s3Transforms.length).toBeGreaterThan(0);
    });

    it("should handle missing optional files gracefully", () => {
      const files: OldEntityFiles = {
        entityName: "TestEntity",
        entityDir: path.join(FIXTURES_DIR, "entities"),
        entity: null,
        meta: path.join(FIXTURES_DIR, "entities/test-entity.meta.ts"),
        model: null,
        map: null,
        serialiser: null,
      };

      const result = parseOldFiles(files);

      // Meta should still be parsed
      expect(result.meta.type).toBe("test-entities");

      // Entity type should be created with empty fields
      expect(result.entityType.name).toBe("TestEntity");
      expect(result.entityType.fields).toEqual([]);

      // Optional parts should be null
      expect(result.mapper).toBeNull();
      expect(result.serialiser).toBeNull();
    });

    it("should parse simple-entity without S3 or relationships", () => {
      const files: OldEntityFiles = {
        entityName: "SimpleEntity",
        entityDir: path.join(FIXTURES_DIR, "simple-entity"),
        entity: path.join(FIXTURES_DIR, "simple-entity/simple-entity.ts"),
        meta: path.join(FIXTURES_DIR, "simple-entity/simple-entity.meta.ts"),
        model: path.join(FIXTURES_DIR, "simple-entity/simple-entity.model.ts"),
        map: path.join(FIXTURES_DIR, "simple-entity/simple-entity.map.ts"),
        serialiser: path.join(FIXTURES_DIR, "simple-entity/simple-entity.serialiser.ts"),
      };

      const result = parseOldFiles(files);

      expect(result.meta.labelName).toBe("SimpleEntity");
      expect(result.entityType.relationshipFields.length).toBe(0);
      expect(result.serialiser?.services.length).toBe(0);
      expect(result.serialiser?.s3Transforms.length).toBe(0);
      expect(result.serialiser?.relationships.length).toBe(0);
    });
  });
});
