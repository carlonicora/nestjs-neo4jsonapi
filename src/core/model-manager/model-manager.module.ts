/**
 * Model Manager Module
 *
 * Provides the centralized ModelManagerService for managing all ML models.
 * This module should be imported in the main app module.
 *
 * Marked as @Global() so ModelManagerService is available app-wide without
 * explicit imports in every module.
 */

import { Global, Module } from "@nestjs/common";
import { ModelManagerService } from "./model-manager.service";

@Global()
@Module({
  providers: [ModelManagerService],
  exports: [ModelManagerService],
})
export class ModelManagerModule {}
