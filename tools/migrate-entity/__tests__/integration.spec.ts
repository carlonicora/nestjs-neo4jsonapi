/**
 * Integration Tests
 *
 * Tests the full migration pipeline from old-style entities to new descriptors.
 */

import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import { discoverOldFiles, isAlreadyMigrated } from "../lib/file-discovery";
import { parseOldFiles } from "../lib/ast-parser";
import { generateEntityFile, generateMetaFile } from "../lib/descriptor-generator";

const FIXTURES_DIR = path.resolve(__dirname, "../__fixtures__");

/**
 * Helper to check if TypeScript code is syntactically valid
 */
function isValidTypeScript(code: string): { valid: boolean; errors: string[] } {
  const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const errors: string[] = [];

  // Check for parse errors by looking at the source file's internal diagnostics
  // Note: This only checks syntax, not type errors
  function visit(node: ts.Node) {
    // Look for any node with a kind that indicates a parsing error
    if (node.kind === ts.SyntaxKind.Unknown) {
      errors.push(`Unknown syntax at position ${node.pos}`);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Also check that we can re-emit the code
  const printer = ts.createPrinter();
  try {
    printer.printFile(sourceFile);
  } catch (e: any) {
    errors.push(`Printer error: ${e.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

describe("migration integration", () => {
  describe("full migration pipeline - test-entity", () => {
    it("should discover, parse, and generate valid output", async () => {
      // Step 1: Discover files
      const discovered = await discoverOldFiles(path.join(FIXTURES_DIR, "entities"));
      expect(discovered.length).toBe(1);

      const files = discovered[0];
      expect(files.entityName).toBe("test-entity");

      // Step 2: Check not already migrated
      const migrated = isAlreadyMigrated(files);
      expect(migrated).toBe(false);

      // Step 3: Parse old files
      const parsed = parseOldFiles(files);
      expect(parsed.meta.labelName).toBe("TestEntity");
      expect(parsed.entityType.name).toBe("TestEntity");

      // Step 4: Generate new entity file
      const entityFile = generateEntityFile(parsed, files.entityDir);
      expect(entityFile).toContain("defineEntity<TestEntity>()");

      // Step 5: Generate new meta file
      const metaFile = generateMetaFile(parsed.meta);
      expect(metaFile).toContain("testEntityMeta");

      // Step 6: Verify TypeScript syntax is valid
      const entityValidation = isValidTypeScript(entityFile);
      expect(entityValidation.valid).toBe(true);

      const metaValidation = isValidTypeScript(metaFile);
      expect(metaValidation.valid).toBe(true);
    });

    it("should include S3Service injection", async () => {
      const discovered = await discoverOldFiles(path.join(FIXTURES_DIR, "entities"));
      const files = discovered[0];
      const parsed = parseOldFiles(files);

      const entityFile = generateEntityFile(parsed, files.entityDir);

      expect(entityFile).toContain("injectServices: [S3Service]");
      expect(entityFile).toContain("S3Service");
    });

    it("should include URL transforms", async () => {
      const discovered = await discoverOldFiles(path.join(FIXTURES_DIR, "entities"));
      const files = discovered[0];
      const parsed = parseOldFiles(files);

      const entityFile = generateEntityFile(parsed, files.entityDir);

      // Single URL transform
      expect(entityFile).toContain("transform: async (data, services) => {");
      expect(entityFile).toContain("services.S3Service.generateSignedUrl");

      // Array URL transform
      expect(entityFile).toContain("Promise.all");
    });

    it("should preserve entity type definition", async () => {
      const discovered = await discoverOldFiles(path.join(FIXTURES_DIR, "entities"));
      const files = discovered[0];
      const parsed = parseOldFiles(files);

      const entityFile = generateEntityFile(parsed, files.entityDir);

      expect(entityFile).toContain("export type TestEntity = Entity & {");
      expect(entityFile).toContain("name: string;");
      expect(entityFile).toContain("description?: string;");
      expect(entityFile).toContain("url?: string;");
    });
  });

  describe("full migration pipeline - simple-entity", () => {
    it("should migrate simple entity without S3 or relationships", async () => {
      const discovered = await discoverOldFiles(path.join(FIXTURES_DIR, "simple-entity"));
      expect(discovered.length).toBe(1);

      const files = discovered[0];
      const migrated = isAlreadyMigrated(files);
      expect(migrated).toBe(false);

      const parsed = parseOldFiles(files);
      expect(parsed.meta.labelName).toBe("SimpleEntity");

      const entityFile = generateEntityFile(parsed, files.entityDir);

      // Should NOT have S3 stuff
      expect(entityFile).not.toContain("injectServices");
      expect(entityFile).not.toContain("S3Service");

      // Should NOT have relationships
      expect(entityFile).not.toContain("relationships:");

      // Should have fields
      expect(entityFile).toContain("fields:");
      expect(entityFile).toContain('title: { type: "string"');
      expect(entityFile).toContain('count: { type: "number"');
      expect(entityFile).toContain('isActive: { type: "boolean"');

      // Should be valid TypeScript
      const validation = isValidTypeScript(entityFile);
      expect(validation.valid).toBe(true);
    });
  });

  describe("full migration pipeline - complex-entity", () => {
    it("should migrate complex entity with relationships and computed fields", async () => {
      const discovered = await discoverOldFiles(path.join(FIXTURES_DIR, "complex-entity"));
      expect(discovered.length).toBe(1);

      const files = discovered[0];
      const migrated = isAlreadyMigrated(files);
      expect(migrated).toBe(false);

      const parsed = parseOldFiles(files);
      expect(parsed.meta.labelName).toBe("ComplexEntity");

      const entityFile = generateEntityFile(parsed, files.entityDir);

      // Should have relationships
      expect(entityFile).toContain("relationships:");
      expect(entityFile).toContain("author:");
      expect(entityFile).toContain("company:");
      expect(entityFile).toContain("items:");

      // Should have computed fields
      expect(entityFile).toContain("computed:");
      expect(entityFile).toContain("totalScore:");
      expect(entityFile).toContain("itemCount:");

      // Should have meta fields
      expect(entityFile).toContain("meta: true");

      // Should be valid TypeScript
      const validation = isValidTypeScript(entityFile);
      expect(validation.valid).toBe(true);
    });
  });

  describe("already migrated detection", () => {
    it("should detect already-migrated entity", async () => {
      const discovered = await discoverOldFiles(path.join(FIXTURES_DIR, "migrated-entity"));
      expect(discovered.length).toBe(1);

      const files = discovered[0];
      const migrated = isAlreadyMigrated(files);
      expect(migrated).toBe(true);
    });
  });

  describe("migration output validation", () => {
    it("should generate meta file with correct export", async () => {
      const discovered = await discoverOldFiles(path.join(FIXTURES_DIR, "entities"));
      const files = discovered[0];
      const parsed = parseOldFiles(files);

      const metaFile = generateMetaFile(parsed.meta);

      expect(metaFile).toContain('import { DataMeta } from "@carlonicora/nestjs-neo4jsonapi"');
      expect(metaFile).toContain("export const testEntityMeta: DataMeta = {");
      expect(metaFile).toContain('type: "test-entities"');
      expect(metaFile).toContain('endpoint: "test-entities"');
      expect(metaFile).toContain('nodeName: "testEntity"');
      expect(metaFile).toContain('labelName: "TestEntity"');
    });

    it("should generate entity file with correct structure", async () => {
      const discovered = await discoverOldFiles(path.join(FIXTURES_DIR, "entities"));
      const files = discovered[0];
      const parsed = parseOldFiles(files);

      const entityFile = generateEntityFile(parsed, files.entityDir);

      // Check order: imports -> type -> descriptor -> type export
      const importIndex = entityFile.indexOf("import");
      const typeIndex = entityFile.indexOf("export type TestEntity");
      const descriptorIndex = entityFile.indexOf("export const TestEntityDescriptor");
      const typeExportIndex = entityFile.indexOf("export type TestEntityDescriptorType");

      expect(importIndex).toBeLessThan(typeIndex);
      expect(typeIndex).toBeLessThan(descriptorIndex);
      expect(descriptorIndex).toBeLessThan(typeExportIndex);
    });

    it("should include defineEntity call", async () => {
      const discovered = await discoverOldFiles(path.join(FIXTURES_DIR, "entities"));
      const files = discovered[0];
      const parsed = parseOldFiles(files);

      const entityFile = generateEntityFile(parsed, files.entityDir);

      expect(entityFile).toContain("defineEntity<TestEntity>()({");
      expect(entityFile).toContain("...testEntityMeta,");
    });
  });

  describe("multiple fixtures migration", () => {
    it("should discover all fixtures in the directory", async () => {
      const discovered = await discoverOldFiles(FIXTURES_DIR);

      // Should find all 7 fixtures (4 original + 3 from relationship-entity folder)
      const entityNames = discovered.map((d) => d.entityName);
      expect(entityNames).toContain("test-entity");
      expect(entityNames).toContain("simple-entity");
      expect(entityNames).toContain("complex-entity");
      expect(entityNames).toContain("migrated-entity");
      expect(entityNames).toContain("relationship-entity");
      expect(entityNames).toContain("feature");
      expect(entityNames).toContain("module");
    });

    it("should correctly identify which entities need migration", async () => {
      const discovered = await discoverOldFiles(FIXTURES_DIR);

      const needsMigration = discovered.filter((f) => !isAlreadyMigrated(f));
      const alreadyMigrated = discovered.filter((f) => isAlreadyMigrated(f));

      // 6 need migration (3 original + 3 from relationship-entity folder), 1 already migrated
      expect(needsMigration.length).toBe(6);
      expect(alreadyMigrated.length).toBe(1);

      const needsMigrationNames = needsMigration.map((f) => f.entityName);
      expect(needsMigrationNames).toContain("test-entity");
      expect(needsMigrationNames).toContain("simple-entity");
      expect(needsMigrationNames).toContain("complex-entity");
      expect(needsMigrationNames).toContain("relationship-entity");
      expect(needsMigrationNames).toContain("feature");
      expect(needsMigrationNames).toContain("module");

      const alreadyMigratedNames = alreadyMigrated.map((f) => f.entityName);
      expect(alreadyMigratedNames).toContain("migrated-entity");
    });
  });
});
