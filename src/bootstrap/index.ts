/**
 * Bootstrap utilities for NestJS applications
 *
 * This module provides the `bootstrap()` function for simplified application setup,
 * plus helper functions for custom bootstrapping scenarios.
 *
 * ## Simplified Bootstrap (Recommended)
 *
 * ```typescript
 * // main.ts
 * import * as dotenv from "dotenv";
 * dotenv.config({ path: "path/to/.env" });
 *
 * import { bootstrap } from "@carlonicora/nestjs-neo4jsonapi";
 * import { FeaturesModules } from "./features/features.modules";
 *
 * bootstrap({
 *   queueIds: ["chunk"],
 *   appModules: [FeaturesModules],
 *   i18n: { fallbackLanguage: "en", path: "./src/i18n" },
 * });
 * ```
 *
 * ## Custom Bootstrap (Advanced)
 *
 * For custom scenarios, use the individual utilities:
 *
 * ```typescript
 * import { getAppMode, getAppModeConfig, AppMode } from "@carlonicora/nestjs-neo4jsonapi";
 *
 * const mode = getAppMode();
 * const modeConfig = getAppModeConfig(mode);
 *
 * if (mode === AppMode.WORKER) {
 *   // Custom worker setup
 * } else {
 *   // Custom API setup
 * }
 * ```
 */

import { AppMode, AppModeConfig } from "../core/appmode/constants/app.mode.constant";

export { AppMode, AppModeConfig };

// Bootstrap function and options
export { createAppModule } from "./app.module.factory";
export { bootstrap } from "./bootstrap";
export { BootstrapOptions, I18nOptions } from "./bootstrap.options";

// Re-export defaults (functions and constants)
export { defaultFastifyOptions, defaultMultipartOptions, getAppMode, getAppModeConfig } from "./defaults";
