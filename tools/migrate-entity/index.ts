#!/usr/bin/env node
/**
 * Entity Migration CLI
 *
 * Migrates old-style entities (5 files) to new descriptor-based pattern (1 file).
 *
 * Usage:
 *   pnpm neo4jsonapi-migrate --path src/features/article
 *   pnpm neo4jsonapi-migrate --path src/foundations/user
 *   pnpm neo4jsonapi-migrate --all
 *   pnpm neo4jsonapi-migrate --path src/features/article --dry-run
 */

import { Command } from "commander";
import { EntityMigrator, printMigrationSummary } from "./lib/entity-migrator";

const program = new Command();

program
  .name("neo4jsonapi-migrate")
  .description("Migrate old-style entities to new descriptor-based architecture")
  .option("-p, --path <module-path>", "Path to module folder (e.g., src/features/article)")
  .option("-e, --entity <name>", "Entity name if module has multiple (e.g., auth.code)")
  .option("-a, --all", "Migrate all entities in codebase")
  .option("-d, --dry-run", "Preview changes without writing files")
  .option("--backup", "Create .bak backup files before overwriting")
  .option("-v, --verbose", "Verbose output")
  .parse();

async function main() {
  const options = program.opts();

  console.info("\n🔄 Entity Migration CLI");
  console.info("========================\n");

  if (options.dryRun) {
    console.info("⚠️  DRY RUN MODE - No files will be modified\n");
  }

  const migrator = new EntityMigrator({
    path: options.path,
    entity: options.entity,
    all: options.all,
    dryRun: options.dryRun,
    skipBackup: !options.backup,
    verbose: options.verbose,
  });

  let result;

  if (options.all) {
    result = await migrator.migrateAll();
  } else if (options.path) {
    result = await migrator.migrate(options.path, options.entity);
  } else {
    program.help();
    return;
  }

  printMigrationSummary(result);

  if (result.failureCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Migration failed:", error.message);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});
