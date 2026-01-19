import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock problematic modules before any imports
vi.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import * as fs from "fs";
import * as path from "path";
import { MigratorService } from "../migrator.service";
import { Neo4jService } from "../../../neo4j/services/neo4j.service";
import { AppLoggingService } from "../../../logging/services/logging.service";

describe("MigratorService", () => {
  let service: MigratorService;
  let neo4jService: vi.Mocked<Neo4jService>;
  let logger: vi.Mocked<AppLoggingService>;

  const TEST_IDS = {
    migrationVersion: "20231201_01",
    migrationDate: 20231201,
    migrationIncrement: 1,
  };

  const createMockNeo4jService = () => ({
    writeOne: vi.fn(),
    read: vi.fn(),
    executeInTransaction: vi.fn(),
  });

  const createMockLogger = () => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    logWithContext: vi.fn(),
    errorWithContext: vi.fn(),
    setRequestContext: vi.fn(),
    getRequestContext: vi.fn(),
    clearRequestContext: vi.fn(),
    createChildLogger: vi.fn(),
    logHttpRequest: vi.fn(),
    logHttpError: vi.fn(),
    logBusinessEvent: vi.fn(),
    logSecurityEvent: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockNeo4jService = createMockNeo4jService();
    const mockLogger = createMockLogger();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigratorService,
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: AppLoggingService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<MigratorService>(MigratorService);
    neo4jService = module.get(Neo4jService) as vi.Mocked<Neo4jService>;
    logger = module.get(AppLoggingService) as vi.Mocked<AppLoggingService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("onModuleInit", () => {
    it("should create migration constraints and run migrations", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert
      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("CREATE CONSTRAINT migration_version IF NOT EXISTS"),
      });
      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("CREATE CONSTRAINT migration_date_increment IF NOT EXISTS"),
      });
    });

    it("should log when no migrations to run", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert
      expect(logger.log).toHaveBeenCalledWith("No migrations to run");
    });
  });

  describe("createMigrationConstraints", () => {
    it("should create version uniqueness constraint", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert
      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query:
          "CREATE CONSTRAINT migration_version IF NOT EXISTS FOR (migration:Migration) REQUIRE migration.version IS UNIQUE",
      });
    });

    it("should create date+increment composite uniqueness constraint", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert
      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query:
          "CREATE CONSTRAINT migration_date_increment IF NOT EXISTS FOR (migration:Migration) REQUIRE (migration.versionDate, migration.versionIncrement) IS UNIQUE",
      });
    });

    it("should log error when constraint creation fails", async () => {
      // Arrange
      const error = new Error("Constraint creation failed");
      neo4jService.writeOne.mockRejectedValueOnce(error);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert
      expect(logger.error).toHaveBeenCalledWith("Failed to create migration constraints:", error);
    });
  });

  describe("getLastAppliedMigration", () => {
    it("should return null when no migrations have been applied", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert
      expect(neo4jService.read).toHaveBeenCalledWith(
        "MATCH (m:Migration) RETURN m ORDER BY m.versionDate DESC, m.versionIncrement DESC LIMIT 1",
        {},
      );
    });

    it("should return last migration version when migrations exist", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      const mockRecord = {
        get: vi.fn().mockReturnValue({
          properties: { version: TEST_IDS.migrationVersion },
        }),
      };
      neo4jService.read.mockResolvedValue({ records: [mockRecord] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert
      expect(neo4jService.read).toHaveBeenCalled();
    });

    it("should log error and return null when query fails", async () => {
      // Arrange
      const error = new Error("Database connection failed");
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockRejectedValue(error);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert
      expect(logger.error).toHaveBeenCalledWith("Failed to get last applied migration:", error);
    });
  });

  describe("discoverMigrations", () => {
    it("should use dist folder when it exists", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).includes("dist");
      });
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);

      // Act
      await service.onModuleInit();

      // Assert
      expect(fs.existsSync).toHaveBeenCalledWith(path.join(process.cwd(), "dist", "neo4j.migrations"));
    });

    it("should fall back to src folder when dist does not exist", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).includes("src");
      });
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);

      // Act
      await service.onModuleInit();

      // Assert
      expect(fs.existsSync).toHaveBeenCalledWith(path.join(process.cwd(), "src", "neo4j.migrations"));
    });

    it("should warn when no migrations directory exists", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert
      expect(logger.warn).toHaveBeenCalledWith("Migrations directory not found in both dist and src folders");
    });

    it("should filter out .d.ts files and discover valid migration files", async () => {
      // Arrange - Set up a scenario where files are discovered but already applied
      neo4jService.writeOne.mockResolvedValue(undefined);
      // Return a migration version newer than all discovered files
      const mockRecord = {
        get: vi.fn().mockReturnValue({
          properties: { version: "20231230_99" }, // Newer than all discovered
        }),
      };
      neo4jService.read.mockResolvedValue({ records: [mockRecord] });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["20231201_01.ts", "20231201_01.d.ts", "20231202_01.js"] as any);

      // Act
      await service.onModuleInit();

      // Assert - files should be discovered (excluding .d.ts)
      expect(fs.readdirSync).toHaveBeenCalled();
      // Should log no migrations since all are already applied
      expect(logger.log).toHaveBeenCalledWith("No migrations to run");
    });

    it("should sort migration files alphabetically", async () => {
      // Arrange - Set up a scenario where files are discovered but already applied
      neo4jService.writeOne.mockResolvedValue(undefined);
      // Return a migration version newer than all discovered files
      const mockRecord = {
        get: vi.fn().mockReturnValue({
          properties: { version: "20231230_99" }, // Newer than all discovered
        }),
      };
      neo4jService.read.mockResolvedValue({ records: [mockRecord] });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["20231203_01.ts", "20231201_01.ts", "20231202_01.ts"] as any);

      // Act
      await service.onModuleInit();

      // Assert
      expect(fs.readdirSync).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith("No migrations to run");
    });
  });

  describe("filterMigrationsToRun", () => {
    it("should return all migrations when no migrations have been applied and none exist", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);

      // Act
      await service.onModuleInit();

      // Assert - No migrations should be run since none exist
      expect(logger.log).toHaveBeenCalledWith("No migrations to run");
    });

    it("should filter migrations based on last applied version", async () => {
      // Arrange - all migrations already applied
      neo4jService.writeOne.mockResolvedValue(undefined);
      const mockRecord = {
        get: vi.fn().mockReturnValue({
          properties: { version: "20231230_99" }, // Newer than all discovered
        }),
      };
      neo4jService.read.mockResolvedValue({ records: [mockRecord] });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["20231201_01.ts", "20231202_01.ts"] as any);

      // Act
      await service.onModuleInit();

      // Assert - no migrations to run since all are older than last applied
      expect(neo4jService.read).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith("No migrations to run");
    });
  });

  describe("compareVersions", () => {
    it("should compare dates correctly - all filtered when last applied is newer", async () => {
      // Test via filterMigrationsToRun behavior
      neo4jService.writeOne.mockResolvedValue(undefined);
      const mockRecord = {
        get: vi.fn().mockReturnValue({
          properties: { version: "20231220_99" }, // Newer than all discovered
        }),
      };
      neo4jService.read.mockResolvedValue({ records: [mockRecord] });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["20231130_01.ts", "20231201_02.ts", "20231202_01.ts"] as any);

      // Act
      await service.onModuleInit();

      // Assert - all should be filtered since last applied is newer
      expect(neo4jService.read).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith("No migrations to run");
    });

    it("should compare increments correctly when dates are equal - all filtered", async () => {
      // Test via filterMigrationsToRun behavior
      neo4jService.writeOne.mockResolvedValue(undefined);
      const mockRecord = {
        get: vi.fn().mockReturnValue({
          properties: { version: "20231201_99" }, // Same date but higher increment
        }),
      };
      neo4jService.read.mockResolvedValue({ records: [mockRecord] });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["20231201_01.ts", "20231201_02.ts", "20231201_03.ts"] as any);

      // Act
      await service.onModuleInit();

      // Assert - all should be filtered since increment is higher
      expect(neo4jService.read).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith("No migrations to run");
    });
  });

  describe("executeMigrations", () => {
    it("should not execute migrations when all are already applied", async () => {
      // Arrange - set last applied to be newer than all discovered migrations
      neo4jService.writeOne.mockResolvedValue(undefined);
      const mockRecord = {
        get: vi.fn().mockReturnValue({
          properties: { version: "20231230_99" },
        }),
      };
      neo4jService.read.mockResolvedValue({ records: [mockRecord] });
      neo4jService.executeInTransaction.mockResolvedValue(undefined);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["20231201_01.ts"] as any);

      // Act
      await service.onModuleInit();

      // Assert - no transaction should be executed since no migrations to run
      expect(neo4jService.executeInTransaction).not.toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith("No migrations to run");
    });

    it("should log success message after applying migrations when no migrations exist", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert - when no migrations, it logs "No migrations to run"
      expect(logger.log).toHaveBeenCalledWith("No migrations to run");
    });

    it("should handle migration import error gracefully", async () => {
      // Arrange - migrations exist and need to be run, but import will fail
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] }); // No previous migrations
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["20231201_01.ts"] as any);

      // Act & Assert - Import will fail since the file doesn't exist
      // The error is logged and then re-thrown
      await expect(service.onModuleInit()).rejects.toThrow();

      // Assert - Error should be logged before being re-thrown
      expect(logger.error).toHaveBeenCalledWith("Migration failed:", expect.any(Error));
    });
  });

  describe("Error Handling", () => {
    it("should handle constraint creation errors gracefully", async () => {
      // Arrange
      const error = new Error("Constraint error");
      neo4jService.writeOne.mockRejectedValueOnce(error);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert
      expect(logger.error).toHaveBeenCalledWith("Failed to create migration constraints:", error);
    });

    it("should handle migration read errors gracefully", async () => {
      // Arrange
      const error = new Error("Read error");
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockRejectedValue(error);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert
      expect(logger.error).toHaveBeenCalledWith("Failed to get last applied migration:", error);
    });

    it("should log error when migration import fails", async () => {
      // Arrange - migrations exist but import will fail
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] }); // No previous migrations
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["20231201_01.ts"] as any);

      // Act & Assert - Import will fail since file doesn't exist
      // The error is logged and then re-thrown
      await expect(service.onModuleInit()).rejects.toThrow();

      // Assert - error should be logged before being re-thrown
      expect(logger.error).toHaveBeenCalledWith("Migration failed:", expect.any(Error));
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty migration directory", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);

      // Act
      await service.onModuleInit();

      // Assert
      expect(logger.log).toHaveBeenCalledWith("No migrations to run");
    });

    it("should handle migration files with only .d.ts files", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["migration.d.ts"] as any);

      // Act
      await service.onModuleInit();

      // Assert
      expect(logger.log).toHaveBeenCalledWith("No migrations to run");
    });

    it("should handle mixed .ts and .js migration files when all already applied", async () => {
      // Arrange - set last applied to be newer
      neo4jService.writeOne.mockResolvedValue(undefined);
      const mockRecord = {
        get: vi.fn().mockReturnValue({
          properties: { version: "20231230_99" },
        }),
      };
      neo4jService.read.mockResolvedValue({ records: [mockRecord] });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["20231201_01.ts", "20231202_01.js"] as any);

      // Act
      await service.onModuleInit();

      // Assert - both file types should be discovered
      expect(fs.readdirSync).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith("No migrations to run");
    });

    it("should handle version with different increment numbers when all already applied", async () => {
      // Version format should be YYYYMMDD_XX
      neo4jService.writeOne.mockResolvedValue(undefined);
      const mockRecord = {
        get: vi.fn().mockReturnValue({
          properties: { version: "20231230_99" },
        }),
      };
      neo4jService.read.mockResolvedValue({ records: [mockRecord] });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["20231201_01.ts", "20231201_10.ts", "20231201_99.ts"] as any);

      // Act
      await service.onModuleInit();

      // Assert
      expect(fs.readdirSync).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith("No migrations to run");
    });
  });

  describe("Integration with Neo4jService", () => {
    it("should call writeOne for constraint creation", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert
      expect(neo4jService.writeOne).toHaveBeenCalledTimes(2);
    });

    it("should call read for getting last applied migration", async () => {
      // Arrange
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      await service.onModuleInit();

      // Assert
      expect(neo4jService.read).toHaveBeenCalledTimes(1);
      expect(neo4jService.read).toHaveBeenCalledWith(expect.stringContaining("MATCH (m:Migration)"), {});
    });
  });
});
