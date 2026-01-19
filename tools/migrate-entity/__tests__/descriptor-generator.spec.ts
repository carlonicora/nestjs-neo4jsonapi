/**
 * Descriptor Generator Unit Tests
 *
 * Tests the code generation functions that produce new-style descriptor files.
 */

import { describe, it, expect } from "vitest";
import * as path from "path";
import { generateDescriptor, generateMetaFile, generateEntityFile } from "../lib/descriptor-generator";
import { parseOldFiles } from "../lib/ast-parser";
import { OldEntityFiles, ParsedEntity, ParsedMeta } from "../lib/types";

const FIXTURES_DIR = path.resolve(__dirname, "../__fixtures__");

/**
 * Helper to get parsed entity from test fixtures
 */
function getParsedTestEntity(): ParsedEntity {
  const files: OldEntityFiles = {
    entityName: "TestEntity",
    entityDir: path.join(FIXTURES_DIR, "entities"),
    entity: path.join(FIXTURES_DIR, "entities/test-entity.ts"),
    meta: path.join(FIXTURES_DIR, "entities/test-entity.meta.ts"),
    model: path.join(FIXTURES_DIR, "entities/test-entity.model.ts"),
    map: path.join(FIXTURES_DIR, "entities/test-entity.map.ts"),
    serialiser: path.join(FIXTURES_DIR, "entities/test-entity.serialiser.ts"),
  };
  return parseOldFiles(files);
}

function getParsedSimpleEntity(): ParsedEntity {
  const files: OldEntityFiles = {
    entityName: "SimpleEntity",
    entityDir: path.join(FIXTURES_DIR, "simple-entity"),
    entity: path.join(FIXTURES_DIR, "simple-entity/simple-entity.ts"),
    meta: path.join(FIXTURES_DIR, "simple-entity/simple-entity.meta.ts"),
    model: path.join(FIXTURES_DIR, "simple-entity/simple-entity.model.ts"),
    map: path.join(FIXTURES_DIR, "simple-entity/simple-entity.map.ts"),
    serialiser: path.join(FIXTURES_DIR, "simple-entity/simple-entity.serialiser.ts"),
  };
  return parseOldFiles(files);
}

function getParsedComplexEntity(): ParsedEntity {
  const files: OldEntityFiles = {
    entityName: "ComplexEntity",
    entityDir: path.join(FIXTURES_DIR, "complex-entity"),
    entity: path.join(FIXTURES_DIR, "complex-entity/complex-entity.ts"),
    meta: path.join(FIXTURES_DIR, "complex-entity/complex-entity.meta.ts"),
    model: path.join(FIXTURES_DIR, "complex-entity/complex-entity.model.ts"),
    map: path.join(FIXTURES_DIR, "complex-entity/complex-entity.map.ts"),
    serialiser: path.join(FIXTURES_DIR, "complex-entity/complex-entity.serialiser.ts"),
  };
  return parseOldFiles(files);
}

/**
 * Helper to get parsed entity with local relationship type imports
 * This tests import type behavior for non-framework relationship types
 */
function getParsedRelationshipEntity(): ParsedEntity {
  const files: OldEntityFiles = {
    entityName: "relationship-entity",
    entityDir: path.join(FIXTURES_DIR, "relationship-entity"),
    entity: path.join(FIXTURES_DIR, "relationship-entity/relationship-entity.ts"),
    meta: path.join(FIXTURES_DIR, "relationship-entity/relationship-entity.meta.ts"),
    model: path.join(FIXTURES_DIR, "relationship-entity/relationship-entity.model.ts"),
    map: path.join(FIXTURES_DIR, "relationship-entity/relationship-entity.map.ts"),
    serialiser: path.join(FIXTURES_DIR, "relationship-entity/relationship-entity.serialiser.ts"),
  };
  return parseOldFiles(files);
}

describe("descriptor-generator", () => {
  describe("generateDescriptor", () => {
    it("should generate valid TypeScript code", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain("export const TestEntityDescriptor = defineEntity<TestEntity>()");
      expect(result.code).toContain("...testEntityMeta");
    });

    it("should include injectServices when S3 transforms present", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain("injectServices: [S3Service]");
    });

    it("should exclude injectServices when no transforms", () => {
      const parsed = getParsedSimpleEntity();
      const entityDir = path.join(FIXTURES_DIR, "simple-entity");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).not.toContain("injectServices");
    });

    it("should include all fields", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain("fields:");
      expect(result.code).toContain("name:");
      expect(result.code).toContain("description:");
      expect(result.code).toContain("url:");
      expect(result.code).toContain("tags:");
    });

    it("should include computed fields", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain("computed:");
      expect(result.code).toContain("relevance:");
      expect(result.code).toContain("itemCount:");
    });

    it("should include relationships", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain("relationships:");
      expect(result.code).toContain("author:");
      expect(result.code).toContain('direction: "in"');
      expect(result.code).toContain('cardinality: "one"');
    });

    it("should generate correct imports", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.imports.length).toBeGreaterThan(0);
      expect(result.imports.some((i) => i.includes("defineEntity"))).toBe(true);
      expect(result.imports.some((i) => i.includes("Entity"))).toBe(true);
      expect(result.imports.some((i) => i.includes("S3Service"))).toBe(true);
    });

    it("should not include S3Service in imports when no transforms", () => {
      const parsed = getParsedSimpleEntity();
      const entityDir = path.join(FIXTURES_DIR, "simple-entity");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.imports.some((i) => i.includes("S3Service"))).toBe(false);
    });

    it("should generate type export", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain("export type TestEntityDescriptorType = typeof TestEntityDescriptor");
    });
  });

  describe("generateDescriptor - field configs", () => {
    it("should create field config with correct type (string)", () => {
      const parsed = getParsedSimpleEntity();
      const entityDir = path.join(FIXTURES_DIR, "simple-entity");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain('title: { type: "string"');
    });

    it("should create field config with correct type (number)", () => {
      const parsed = getParsedSimpleEntity();
      const entityDir = path.join(FIXTURES_DIR, "simple-entity");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain('count: { type: "number"');
    });

    it("should create field config with correct type (boolean)", () => {
      const parsed = getParsedSimpleEntity();
      const entityDir = path.join(FIXTURES_DIR, "simple-entity");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain('isActive: { type: "boolean"');
    });

    it("should create field config with correct type (Date -> datetime)", () => {
      const parsed = getParsedSimpleEntity();
      const entityDir = path.join(FIXTURES_DIR, "simple-entity");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain('createdAt: { type: "datetime"');
    });

    it("should create field config with array type (string[])", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain('tags: { type: "string[]"');
    });

    it("should mark required fields", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain("required: true");
    });

    it("should identify meta fields", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain("meta: true");
    });

    it("should add S3 transforms for URL fields", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      // Single URL transform
      expect(result.code).toContain("url: {");
      expect(result.code).toContain("transform: async (data, services) => {");
      expect(result.code).toContain("services.S3Service.generateSignedUrl");

      // Array URL transform
      expect(result.code).toContain("samplePhotographs: {");
      expect(result.code).toContain("Promise.all");
    });
  });

  describe("generateDescriptor - computed configs", () => {
    it("should create computed config from mapper", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain("computed:");
      expect(result.code).toContain("compute: (params) =>");
    });

    it("should include params.record.has patterns in computed", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain("params.record.has");
    });

    it("should mark meta computed fields", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      // relevance should have meta: true
      const computedSection = result.code.split("computed:")[1]?.split("relationships:")[0];
      expect(computedSection).toContain("meta: true");
    });
  });

  describe("generateDescriptor - relationship configs", () => {
    it("should use heuristics when Cypher unavailable", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      // author relationship should use heuristic (PUBLISHED)
      expect(result.code).toContain("author:");
      expect(result.code).toContain('relationship: "PUBLISHED"');
    });

    it("should determine cardinality from relationship type", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      // author is a single User, so cardinality should be "one"
      expect(result.code).toContain('cardinality: "one"');
    });

    it("should include dtoKey when present", () => {
      const parsed = getParsedComplexEntity();
      const entityDir = path.join(FIXTURES_DIR, "complex-entity");

      const result = generateDescriptor(parsed, entityDir);

      // items has dtoKey in the fixture
      expect(result.code).toContain('dtoKey: "items"');
    });

    it("should handle multiple relationships", () => {
      const parsed = getParsedComplexEntity();
      const entityDir = path.join(FIXTURES_DIR, "complex-entity");

      const result = generateDescriptor(parsed, entityDir);

      expect(result.code).toContain("author:");
      expect(result.code).toContain("company:");
      expect(result.code).toContain("items:");
    });
  });

  describe("generateMetaFile", () => {
    it("should generate meta file with correct export", () => {
      const meta: ParsedMeta = {
        type: "test-entities",
        endpoint: "test-entities",
        nodeName: "testEntity",
        labelName: "TestEntity",
      };

      const result = generateMetaFile(meta);

      expect(result).toContain('import { DataMeta } from "@carlonicora/nestjs-neo4jsonapi"');
      expect(result).toContain("export const testEntityMeta: DataMeta = {");
      expect(result).toContain('type: "test-entities"');
      expect(result).toContain('endpoint: "test-entities"');
      expect(result).toContain('nodeName: "testEntity"');
      expect(result).toContain('labelName: "TestEntity"');
    });

    it("should generate meta file for simple-entity", () => {
      const meta: ParsedMeta = {
        type: "simple-entities",
        endpoint: "simple-entities",
        nodeName: "simpleEntity",
        labelName: "SimpleEntity",
      };

      const result = generateMetaFile(meta);

      expect(result).toContain("export const simpleEntityMeta: DataMeta = {");
      expect(result).toContain('type: "simple-entities"');
    });
  });

  describe("generateEntityFile", () => {
    it("should generate entity file with defineEntity", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateEntityFile(parsed, entityDir);

      expect(result).toContain("defineEntity<TestEntity>()");
    });

    it("should generate complete file structure", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateEntityFile(parsed, entityDir);

      // Should have imports first
      expect(result.indexOf("import")).toBeLessThan(result.indexOf("export type TestEntity"));

      // Should have type definition before descriptor
      expect(result.indexOf("export type TestEntity")).toBeLessThan(
        result.indexOf("export const TestEntityDescriptor"),
      );

      // Should have descriptor type export at end
      expect(result).toContain("export type TestEntityDescriptorType");
    });

    it("should include entity type definition", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateEntityFile(parsed, entityDir);

      expect(result).toContain("export type TestEntity = Entity & {");
      expect(result).toContain("name: string;");
      expect(result).toContain("description?: string;");
    });

    it("should generate valid file for simple-entity", () => {
      const parsed = getParsedSimpleEntity();
      const entityDir = path.join(FIXTURES_DIR, "simple-entity");

      const result = generateEntityFile(parsed, entityDir);

      expect(result).toContain("export const SimpleEntityDescriptor = defineEntity<SimpleEntity>()");
      expect(result).toContain("...simpleEntityMeta");
      expect(result).not.toContain("injectServices");
      expect(result).not.toContain("S3Service");
    });

    it("should generate valid file for complex-entity with relationships", () => {
      const parsed = getParsedComplexEntity();
      const entityDir = path.join(FIXTURES_DIR, "complex-entity");

      const result = generateEntityFile(parsed, entityDir);

      expect(result).toContain("export const ComplexEntityDescriptor = defineEntity<ComplexEntity>()");
      expect(result).toContain("relationships:");
      expect(result).toContain("author:");
      expect(result).toContain("company:");
      expect(result).toContain("items:");
    });
  });

  describe("S3 transform code generation", () => {
    it("should generate single URL transform correctly", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      // Check for single URL transform pattern with tilde prefix handling
      expect(result.code).toContain("if (!data.url) return undefined;");
      expect(result.code).toContain('if (data.url.startsWith("~")) return data.url.substring(1);');
      expect(result.code).toContain("services.S3Service.generateSignedUrl({ key: data.url, isPublic: true })");
    });

    it("should generate array URL transform correctly", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      // Check for array URL transform pattern with tilde prefix handling
      expect(result.code).toContain("if (!data.samplePhotographs?.length) return [];");
      expect(result.code).toContain("data.samplePhotographs.map(async (url: string) => {");
      expect(result.code).toContain('if (url.startsWith("~")) return url.substring(1);');
      expect(result.code).toContain("services.S3Service.generateSignedUrl({ key: url, isPublic: true })");
    });
  });

  /**
   * Tests for circular dependency prevention
   *
   * These tests verify that the generated code avoids circular dependencies by:
   * 1. Using internal imports (../../../common) instead of package barrel (@carlonicora/nestjs-neo4jsonapi)
   * 2. Using "import type" for relationship type imports that would otherwise cause runtime circular deps
   */
  describe("circular dependency prevention - internal imports", () => {
    it("should use internal import path instead of package barrel for framework imports", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      // Framework imports should use internal path to avoid circular dependency
      // when the package barrel re-exports from ./foundations
      const frameworkImport = result.imports.find((i) => i.includes("defineEntity"));
      expect(frameworkImport).toBeDefined();
      expect(frameworkImport).toContain('from "../../../common"');
      expect(frameworkImport).not.toContain("@carlonicora/nestjs-neo4jsonapi");
    });

    it("should include Entity in internal imports", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      const frameworkImport = result.imports.find((i) => i.includes("../../../common"));
      expect(frameworkImport).toBeDefined();
      expect(frameworkImport).toContain("Entity");
    });

    it("should include S3Service in separate import when transforms are used", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      // S3Service has its own module, so it should be imported separately (not from ../../../common)
      const s3Import = result.imports.find((i) => i.includes("S3Service"));
      expect(s3Import).toBeDefined();
      expect(s3Import).toContain('from "../../s3"');
    });

    it("should NOT include S3Service in internal imports when no transforms", () => {
      const parsed = getParsedSimpleEntity();
      const entityDir = path.join(FIXTURES_DIR, "simple-entity");

      const result = generateDescriptor(parsed, entityDir);

      const frameworkImport = result.imports.find((i) => i.includes("../../../common"));
      expect(frameworkImport).toBeDefined();
      expect(frameworkImport).not.toContain("S3Service");
    });

    it("should generate internal imports for entity file", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateEntityFile(parsed, entityDir);

      // Verify the full file uses internal imports
      expect(result).toContain('from "../../../common"');
      expect(result).not.toMatch(/from ["']@carlonicora\/nestjs-neo4jsonapi["']/);
    });
  });

  describe("circular dependency prevention - import type for relationship types", () => {
    it("should use import type for non-framework relationship type imports", () => {
      const parsed = getParsedRelationshipEntity();
      const entityDir = path.join(FIXTURES_DIR, "relationship-entity");

      const result = generateDescriptor(parsed, entityDir);

      // Find imports for Feature and Module (non-framework types)
      const featureImport = result.imports.find((i) => i.includes("Feature"));
      const moduleImport = result.imports.find((i) => i.includes("Module"));

      // Both should use "import type" to avoid runtime circular dependencies
      if (featureImport) {
        expect(featureImport).toMatch(/^import type\s/);
      }
      if (moduleImport) {
        expect(moduleImport).toMatch(/^import type\s/);
      }
    });

    it("should convert regular imports to import type for local entity files", () => {
      const parsed = getParsedRelationshipEntity();
      const entityDir = path.join(FIXTURES_DIR, "relationship-entity");

      const result = generateEntityFile(parsed, entityDir);

      // The generated file should have import type for Feature and Module
      // These are only used in the type definition, not at runtime
      const lines = result.split("\n");
      const importLines = lines.filter((l) => l.includes("import") && (l.includes("Feature") || l.includes("Module")));

      for (const importLine of importLines) {
        // Skip framework imports which don't need import type
        if (!importLine.includes("../../../common")) {
          expect(importLine).toMatch(/^import type\s/);
        }
      }
    });

    it("should NOT use import type for framework types (User, Company)", () => {
      const parsed = getParsedTestEntity();
      const entityDir = path.join(FIXTURES_DIR, "entities");

      const result = generateDescriptor(parsed, entityDir);

      // Framework types like User and Company are included in the main internal import
      // which is a regular import (not import type) because defineEntity is also needed at runtime
      const frameworkImport = result.imports.find((i) => i.includes("../../../common"));
      expect(frameworkImport).toBeDefined();
      // This should be a regular import, not import type
      expect(frameworkImport).not.toMatch(/^import type\s/);
    });

    it("should generate valid file for relationship-entity", () => {
      const parsed = getParsedRelationshipEntity();
      const entityDir = path.join(FIXTURES_DIR, "relationship-entity");

      const result = generateEntityFile(parsed, entityDir);

      expect(result).toContain("export const RelationshipEntityDescriptor = defineEntity<RelationshipEntity>()");
      expect(result).toContain("relationships:");
      expect(result).toContain("feature:");
      expect(result).toContain("module:");
    });
  });
});
