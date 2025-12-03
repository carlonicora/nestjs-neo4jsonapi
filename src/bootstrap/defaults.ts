import { AppMode, AppModeConfig } from "../core/appmode/constants/app.mode.constant";

/**
 * Get the application mode from command line arguments
 * Supports: --mode=api, --mode=worker, --api, --worker
 * Defaults to API mode
 */
export function getAppMode(): AppMode {
  const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
  if (modeArg) {
    const mode = modeArg.split("=")[1];
    if (mode === "worker") return AppMode.WORKER;
    if (mode === "api") return AppMode.API;
  }

  if (process.argv.includes("--worker")) return AppMode.WORKER;
  if (process.argv.includes("--api")) return AppMode.API;

  return AppMode.API;
}

/**
 * Get the application mode configuration
 */
export function getAppModeConfig(mode: AppMode): AppModeConfig {
  switch (mode) {
    case AppMode.API:
      return {
        mode: AppMode.API,
        enableControllers: true,
        enableWorkers: false,
        enableCronJobs: false,
      };
    case AppMode.WORKER:
      return {
        mode: AppMode.WORKER,
        enableControllers: false,
        enableWorkers: true,
        enableCronJobs: true,
      };
    default:
      throw new Error(`Unknown app mode: ${mode}`);
  }
}

/**
 * Standard FastifyAdapter options for API applications
 */
export const defaultFastifyOptions = {
  routerOptions: {
    ignoreTrailingSlash: true,
  },
  bodyLimit: 100 * 1024 * 1024, // 100MB
};

/**
 * Standard multipart options for file uploads
 */
export const defaultMultipartOptions = {
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
    fieldSize: 10 * 1024 * 1024, // 10MB
    files: 10,
    fields: 20,
  },
  attachFieldsToBody: false,
};
