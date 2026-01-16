/**
 * Entity Migration CLI - Main Orchestrator
 *
 * Coordinates the migration of old-style entities to the new descriptor pattern.
 */

import * as fs from "fs";
import * as path from "path";
import { detectCypherServiceWarnings, parseOldFiles } from "./ast-parser";
import { generateEntityFile, generateMetaFile } from "./descriptor-generator";
import { discoverAllModulePaths, discoverOldFiles, isAlreadyMigrated } from "./file-discovery";
import { findModuleFile, formatModuleContent, updateModule } from "./module-updater";
import { findExternalReferences, summarizeReferences, updateFileReferences } from "./reference-updater";
import { EntityMigrationResult, FileChange, MigrationResult, MigratorOptions, OldEntityFiles } from "./types";

export class EntityMigrator {
  private changes: FileChange[] = [];

  constructor(private options: MigratorOptions) {}

  /**
   * Migrates entities within a module path.
   */
  async migrate(modulePath: string, entityName?: string): Promise<MigrationResult> {
    const absolutePath = path.isAbsolute(modulePath) ? modulePath : path.resolve(process.cwd(), modulePath);

    this.log(`\nMigrating entities in: ${modulePath}`);

    // 1. Discover old files
    const oldFileSets = await discoverOldFiles(absolutePath, entityName);

    if (oldFileSets.length === 0) {
      this.log(`  No old-style entities found in ${modulePath}`);
      return this.createResult([]);
    }

    const results: EntityMigrationResult[] = [];

    for (const oldFiles of oldFileSets) {
      try {
        const result = await this.migrateEntity(oldFiles, absolutePath);
        results.push(result);
      } catch (error) {
        results.push({
          entityName: oldFiles.entityName,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          changes: [],
        });
      }
    }

    return this.createResult(results);
  }

  /**
   * Migrates all entities in the codebase.
   */
  async migrateAll(): Promise<MigrationResult> {
    this.log("\nDiscovering all entities in codebase...");

    const modulePaths = await discoverAllModulePaths();
    this.log(`Found ${modulePaths.length} modules with entities`);

    const allResults: EntityMigrationResult[] = [];

    for (const modulePath of modulePaths) {
      const result = await this.migrate(modulePath);
      allResults.push(...result.results);
    }

    return this.createResult(allResults);
  }

  /**
   * Migrates a single entity.
   */
  private async migrateEntity(oldFiles: OldEntityFiles, modulePath: string): Promise<EntityMigrationResult> {
    const changes: FileChange[] = [];

    this.log(`\n  Migrating: ${oldFiles.entityName}`);

    // Check if already migrated
    if (isAlreadyMigrated(oldFiles)) {
      this.log(`    Already migrated, skipping`);
      return {
        entityName: oldFiles.entityName,
        success: true,
        changes: [],
      };
    }

    // 1. Parse old files
    this.log(`    Parsing old files...`);
    const parsed = parseOldFiles(oldFiles);

    // 2. Determine target file paths
    const targetPath = this.getTargetFilePath(oldFiles);
    const metaTargetPath = this.getMetaFilePath(oldFiles);

    // 3. Generate meta file content
    this.log(`    Generating meta file...`);
    const metaContent = generateMetaFile(parsed.meta);

    // 4. Generate new descriptor file (with Cypher relationship extraction)
    this.log(`    Generating new descriptor...`);
    const newContent = generateEntityFile(parsed, oldFiles.entityDir, {
      modulePath,
      useCypherRelationships: true,
      verbose: this.options.verbose,
      entityName: oldFiles.entityName,
    });

    // 5. Create backups if needed
    if (!this.options.skipBackup) {
      // Backup meta file if it exists
      if (fs.existsSync(metaTargetPath)) {
        const metaBackupPath = `${metaTargetPath}.bak`;
        if (!this.options.dryRun) {
          fs.copyFileSync(metaTargetPath, metaBackupPath);
        }
        changes.push({
          type: "create",
          path: metaBackupPath,
          content: fs.readFileSync(metaTargetPath, "utf-8"),
        });
      }

      // Backup descriptor file if it exists
      if (fs.existsSync(targetPath)) {
        const backupPath = `${targetPath}.bak`;
        if (!this.options.dryRun) {
          fs.copyFileSync(targetPath, backupPath);
        }
        changes.push({
          type: "create",
          path: backupPath,
          content: fs.readFileSync(targetPath, "utf-8"),
        });
      }
    }

    // 6. Write meta file first
    changes.push({
      type: fs.existsSync(metaTargetPath) ? "update" : "create",
      path: metaTargetPath,
      content: metaContent,
    });

    if (!this.options.dryRun) {
      fs.writeFileSync(metaTargetPath, metaContent);
      this.log(`    Created: ${path.relative(process.cwd(), metaTargetPath)}`);
    } else {
      this.log(`    Would create: ${path.relative(process.cwd(), metaTargetPath)}`);
    }

    // 7. Write new entity descriptor file
    changes.push({
      type: oldFiles.entity ? "update" : "create",
      path: targetPath,
      content: newContent,
    });

    if (!this.options.dryRun) {
      fs.writeFileSync(targetPath, newContent);
      this.log(`    Created: ${path.relative(process.cwd(), targetPath)}`);
    } else {
      this.log(`    Would create: ${path.relative(process.cwd(), targetPath)}`);
    }

    // 8. Find and update external references (exclude the entity files we just created)
    this.log(`    Finding external references...`);
    const references = await findExternalReferences(
      oldFiles.entityName,
      parsed.meta.labelName,
      "src",
      [targetPath, metaTargetPath] // Exclude the entity files being migrated
    );

    if (this.options.verbose) {
      this.log(summarizeReferences(references));
    }

    for (const ref of references) {
      const updatedContent = updateFileReferences(ref.filePath, ref);
      changes.push({
        type: "update",
        path: ref.filePath,
        content: updatedContent,
      });

      if (!this.options.dryRun) {
        fs.writeFileSync(ref.filePath, updatedContent);
        this.log(`    Updated: ${path.relative(process.cwd(), ref.filePath)} (${ref.usages.length} changes)`);
      } else {
        this.log(`    Would update: ${path.relative(process.cwd(), ref.filePath)} (${ref.usages.length} changes)`);
      }
    }

    // 9. Update module file
    const moduleFile = await findModuleFile(modulePath);
    if (moduleFile) {
      const moduleUpdate = updateModule(moduleFile, oldFiles.entityName, parsed.meta.labelName);
      if (moduleUpdate) {
        const formattedContent = formatModuleContent(moduleUpdate.updatedContent);
        changes.push({
          type: "update",
          path: moduleFile,
          content: formattedContent,
        });

        if (!this.options.dryRun) {
          fs.writeFileSync(moduleFile, formattedContent);
          this.log(`    Updated module: ${path.relative(process.cwd(), moduleFile)}`);
          for (const change of moduleUpdate.changes) {
            this.log(`      - ${change}`);
          }
        } else {
          this.log(`    Would update module: ${path.relative(process.cwd(), moduleFile)}`);
        }
      }
    }

    // 10. Delete old files (model, map, serialiser - not meta since we're using the same path)
    const filesToDelete = [oldFiles.model, oldFiles.map, oldFiles.serialiser].filter(
      (f): f is string => f !== null
    );

    // Don't delete the old meta file if it's the same as our target meta file
    if (oldFiles.meta && oldFiles.meta !== metaTargetPath) {
      filesToDelete.push(oldFiles.meta);
    }

    // Don't delete the entity file if it's the target
    const entityFileToDelete = oldFiles.entity && oldFiles.entity !== targetPath ? oldFiles.entity : null;
    if (entityFileToDelete) {
      filesToDelete.push(entityFileToDelete);
    }

    for (const fileToDelete of filesToDelete) {
      changes.push({
        type: "delete",
        path: fileToDelete,
      });

      if (!this.options.dryRun) {
        if (fs.existsSync(fileToDelete)) {
          fs.unlinkSync(fileToDelete);
          this.log(`    Deleted: ${path.relative(process.cwd(), fileToDelete)}`);
        }
      } else {
        this.log(`    Would delete: ${path.relative(process.cwd(), fileToDelete)}`);
      }
    }

    // 11. Clean up empty directories
    await this.cleanupEmptyDirectories(modulePath);

    // 12. Detect and warn about custom cypher.service.ts logic
    const cypherWarnings = detectCypherServiceWarnings(modulePath);
    if (cypherWarnings.length > 0) {
      this.log(`\n    ⚠️  PHASE 2 WARNING: Custom cypher.service.ts logic detected:`);
      for (const warning of cypherWarnings) {
        this.log(`      • ${warning.description}`);
        this.log(`        Action: ${warning.action}`);
      }
    }

    return {
      entityName: oldFiles.entityName,
      success: true,
      changes,
    };
  }

  /**
   * Determines the target file path for the new entity descriptor.
   */
  private getTargetFilePath(oldFiles: OldEntityFiles): string {
    // Target is entityName.ts in the entities directory
    // If the old entity file was entity.entity.ts, we use entity.ts instead
    const baseName = oldFiles.entityName;
    return path.join(oldFiles.entityDir, `${baseName}.ts`);
  }

  /**
   * Determines the target file path for the entity meta file.
   */
  private getMetaFilePath(oldFiles: OldEntityFiles): string {
    const baseName = oldFiles.entityName;
    return path.join(oldFiles.entityDir, `${baseName}.meta.ts`);
  }

  /**
   * Cleans up empty directories after file deletion.
   */
  private async cleanupEmptyDirectories(modulePath: string): Promise<void> {
    const serialisersDir = path.join(modulePath, "serialisers");

    if (fs.existsSync(serialisersDir)) {
      const files = fs.readdirSync(serialisersDir);
      if (files.length === 0) {
        if (!this.options.dryRun) {
          fs.rmdirSync(serialisersDir);
          this.log(`    Removed empty directory: serialisers/`);
        } else {
          this.log(`    Would remove empty directory: serialisers/`);
        }
      }
    }
  }

  /**
   * Creates a migration result summary.
   */
  private createResult(results: EntityMigrationResult[]): MigrationResult {
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    return {
      results,
      totalEntities: results.length,
      successCount,
      failureCount,
    };
  }

  /**
   * Logs a message if verbose mode is enabled or if it's important.
   */
  private log(message: string): void {
    if (this.options.verbose || !message.startsWith("      ")) {
      console.log(message);
    }
  }
}

/**
 * Prints a summary of the migration results.
 */
export function printMigrationSummary(result: MigrationResult): void {
  console.log("\n" + "=".repeat(60));
  console.log("Migration Summary");
  console.log("=".repeat(60));
  console.log(`Total entities: ${result.totalEntities}`);
  console.log(`Successful: ${result.successCount}`);
  console.log(`Failed: ${result.failureCount}`);

  if (result.failureCount > 0) {
    console.log("\nFailed migrations:");
    for (const r of result.results.filter((r) => !r.success)) {
      console.log(`  - ${r.entityName}: ${r.error}`);
    }
  }

  console.log("=".repeat(60) + "\n");
}
