/**
 * File Discovery Unit Tests
 *
 * Tests the file discovery functions that locate old-style entity files.
 */

import { describe, it, expect } from "vitest";
import * as path from "path";
import { discoverOldFiles, getModulePath, isAlreadyMigrated } from "../lib/file-discovery";
import { OldEntityFiles } from "../lib/types";

const FIXTURES_DIR = path.resolve(__dirname, "../__fixtures__");

describe("file-discovery", () => {
  describe("discoverOldFiles", () => {
    it("should find all 5 entity files by meta.ts", async () => {
      const results = await discoverOldFiles(path.join(FIXTURES_DIR, "entities"));

      expect(results.length).toBe(1);

      const testEntity = results[0];
      expect(testEntity.entityName).toBe("test-entity");
      expect(testEntity.meta).toContain("test-entity.meta.ts");
      expect(testEntity.entity).toContain("test-entity.ts");
      expect(testEntity.model).toContain("test-entity.model.ts");
      expect(testEntity.map).toContain("test-entity.map.ts");
      expect(testEntity.serialiser).toContain("test-entity.serialiser.ts");
    });

    it("should handle missing optional files", async () => {
      // Create a temporary entity with only meta file to test missing files handling
      // For this test, we'll use migrated-entity which only has meta + entity
      const results = await discoverOldFiles(path.join(FIXTURES_DIR, "migrated-entity"));

      expect(results.length).toBe(1);

      const migratedEntity = results[0];
      expect(migratedEntity.entityName).toBe("migrated-entity");
      expect(migratedEntity.meta).not.toBeNull();
      expect(migratedEntity.entity).not.toBeNull();
      expect(migratedEntity.model).toBeNull(); // No model file
      expect(migratedEntity.map).toBeNull(); // No map file
      expect(migratedEntity.serialiser).toBeNull(); // No serialiser file
    });

    it("should filter by entity name when provided", async () => {
      // Should find test-entity when filtering
      const results = await discoverOldFiles(FIXTURES_DIR, "test-entity");

      expect(results.length).toBe(1);
      expect(results[0].entityName).toBe("test-entity");
    });

    it("should return empty array when entity not found", async () => {
      const results = await discoverOldFiles(FIXTURES_DIR, "nonexistent-entity");

      expect(results.length).toBe(0);
    });

    it("should discover multiple entities in fixtures directory", async () => {
      const results = await discoverOldFiles(FIXTURES_DIR);

      // Should find: test-entity, simple-entity, complex-entity, migrated-entity
      expect(results.length).toBeGreaterThanOrEqual(4);

      const entityNames = results.map((r) => r.entityName);
      expect(entityNames).toContain("test-entity");
      expect(entityNames).toContain("simple-entity");
      expect(entityNames).toContain("complex-entity");
      expect(entityNames).toContain("migrated-entity");
    });

    it("should discover simple-entity files", async () => {
      const results = await discoverOldFiles(path.join(FIXTURES_DIR, "simple-entity"));

      expect(results.length).toBe(1);

      const simpleEntity = results[0];
      expect(simpleEntity.entityName).toBe("simple-entity");
      expect(simpleEntity.meta).not.toBeNull();
      expect(simpleEntity.entity).not.toBeNull();
      expect(simpleEntity.model).not.toBeNull();
      expect(simpleEntity.map).not.toBeNull();
      expect(simpleEntity.serialiser).not.toBeNull();
    });

    it("should discover complex-entity files", async () => {
      const results = await discoverOldFiles(path.join(FIXTURES_DIR, "complex-entity"));

      expect(results.length).toBe(1);

      const complexEntity = results[0];
      expect(complexEntity.entityName).toBe("complex-entity");
      expect(complexEntity.meta).not.toBeNull();
      expect(complexEntity.entity).not.toBeNull();
      expect(complexEntity.model).not.toBeNull();
      expect(complexEntity.map).not.toBeNull();
      expect(complexEntity.serialiser).not.toBeNull();
    });
  });

  describe("isAlreadyMigrated", () => {
    it("should return true if entity contains defineEntity<", () => {
      const files: OldEntityFiles = {
        entityName: "migrated-entity",
        entityDir: path.join(FIXTURES_DIR, "migrated-entity"),
        entity: path.join(FIXTURES_DIR, "migrated-entity/migrated-entity.ts"),
        meta: path.join(FIXTURES_DIR, "migrated-entity/migrated-entity.meta.ts"),
        model: null,
        map: null,
        serialiser: null,
      };

      const result = isAlreadyMigrated(files);
      expect(result).toBe(true);
    });

    it("should return false for old-style entities", () => {
      const files: OldEntityFiles = {
        entityName: "test-entity",
        entityDir: path.join(FIXTURES_DIR, "entities"),
        entity: path.join(FIXTURES_DIR, "entities/test-entity.ts"),
        meta: path.join(FIXTURES_DIR, "entities/test-entity.meta.ts"),
        model: path.join(FIXTURES_DIR, "entities/test-entity.model.ts"),
        map: path.join(FIXTURES_DIR, "entities/test-entity.map.ts"),
        serialiser: path.join(FIXTURES_DIR, "entities/test-entity.serialiser.ts"),
      };

      const result = isAlreadyMigrated(files);
      expect(result).toBe(false);
    });

    it("should return false if entity file is null", () => {
      const files: OldEntityFiles = {
        entityName: "test-entity",
        entityDir: path.join(FIXTURES_DIR, "entities"),
        entity: null,
        meta: path.join(FIXTURES_DIR, "entities/test-entity.meta.ts"),
        model: null,
        map: null,
        serialiser: null,
      };

      const result = isAlreadyMigrated(files);
      expect(result).toBe(false);
    });

    it("should return false for simple-entity (old-style)", () => {
      const files: OldEntityFiles = {
        entityName: "simple-entity",
        entityDir: path.join(FIXTURES_DIR, "simple-entity"),
        entity: path.join(FIXTURES_DIR, "simple-entity/simple-entity.ts"),
        meta: path.join(FIXTURES_DIR, "simple-entity/simple-entity.meta.ts"),
        model: path.join(FIXTURES_DIR, "simple-entity/simple-entity.model.ts"),
        map: path.join(FIXTURES_DIR, "simple-entity/simple-entity.map.ts"),
        serialiser: path.join(FIXTURES_DIR, "simple-entity/simple-entity.serialiser.ts"),
      };

      const result = isAlreadyMigrated(files);
      expect(result).toBe(false);
    });
  });

  describe("getModulePath", () => {
    it("should extract module path from features path", () => {
      const filePath = "src/features/article/entities/article.meta.ts";
      const result = getModulePath(filePath);

      expect(result).toBe("src/features/article");
    });

    it("should extract module path from foundations path", () => {
      const filePath = "src/foundations/user/entities/user.meta.ts";
      const result = getModulePath(filePath);

      expect(result).toBe("src/foundations/user");
    });

    it("should return dirname when no standard pattern matches", () => {
      const filePath = "/custom/path/entities/custom.meta.ts";
      const result = getModulePath(filePath);

      expect(result).toBe("/custom/path/entities");
    });

    it("should handle nested feature paths", () => {
      const filePath = "src/features/my-feature/deep/nested/entity.meta.ts";
      const result = getModulePath(filePath);

      expect(result).toBe("src/features/my-feature");
    });
  });
});
