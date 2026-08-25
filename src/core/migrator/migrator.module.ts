import { Module } from "@nestjs/common";
import { createWorkerProvider } from "../../common";
import { S3ServiceModule } from "../../foundations/s3/s3.service.module";
import { MigratorService } from "./services/migrator.service";

/**
 * Migrator Module
 *
 * Provides Neo4j database migration functionality
 *
 * Features:
 * - Automatic migration discovery from neo4j.migrations/ folder
 * - Transaction-based execution
 * - Version tracking with date and increment
 * - Development and production support
 *
 * @example
 * Create a migration file: src/neo4j.migrations/20231201_01.ts
 * ```typescript
 * import { MigrationInterface } from '@your-package/core/migrator';
 *
 * export const migration: MigrationInterface[] = [
 *   {
 *     query: 'CREATE CONSTRAINT user_email IF NOT EXISTS FOR (u:User) REQUIRE u.email IS UNIQUE',
 *     queryParams: {},
 *   },
 * ];
 * ```
 */
@Module({
  // Import S3ServiceModule (NOT S3Module) so the migrator gets the uploader
  // without registering S3Module's /s3 controller — importing S3Module here
  // double-declares GET /s3 when the app already serves it. Importing rather
  // than re-providing S3Service keeps S3Service to a SINGLE registration; see
  // the comment in s3.service.module.ts for why that matters.
  imports: [S3ServiceModule],
  providers: [createWorkerProvider(MigratorService)],
  exports: [],
})
export class MigratorModule {}
