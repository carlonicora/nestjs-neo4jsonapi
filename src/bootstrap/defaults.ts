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

const LABEL_ERROR = "--label is valid only with an explicit --mode=worker";

/**
 * Get the worker label from command line arguments (`--label=<name>`).
 * A label needs a non-empty value and an explicit `--mode=worker`; anything else throws.
 * Returns undefined when no label is given.
 */
export function getAppLabel(argv: string[] = process.argv): string | undefined {
  const labelArg = argv.find((arg) => arg.startsWith("--label="));
  if (labelArg === undefined) return undefined;

  const label = labelArg.slice("--label=".length);
  if (!label || !argv.includes("--mode=worker")) throw new Error(LABEL_ERROR);

  return label;
}

/**
 * Get the application mode configuration.
 * A labelled worker runs no cron jobs and carries its label.
 */
export function getAppModeConfig(mode: AppMode, label?: string): AppModeConfig {
  if (label !== undefined && mode !== AppMode.WORKER) throw new Error(LABEL_ERROR);
  if (label !== undefined) {
    return {
      mode: AppMode.WORKER,
      enableControllers: false,
      enableWorkers: true,
      enableCronJobs: false,
      label,
    };
  }

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
 * Default `trustProxy` value: proxy-addr named ranges for private networks.
 */
export const DEFAULT_TRUST_PROXY = "loopback,linklocal,uniquelocal";

/**
 * Resolve Fastify's `trustProxy` from `TRUST_PROXY`.
 *
 * Fastify takes `X-Forwarded-For` as `request.ip` only when the direct peer is trusted.
 * Trusting private ranges only is safe: a client connecting straight from the internet
 * has a public address, is never trusted, and so cannot spoof `X-Forwarded-For`; a
 * reverse proxy on the private/Docker network is trusted. Without this every request
 * behind the proxy shares the proxy's IP, and so one rate-limit bucket.
 *
 * - unset or empty: `DEFAULT_TRUST_PROXY`
 * - `false`: trust nothing
 * - anything else: comma-separated IPs/CIDRs/named ranges, passed through as-is.
 *   `true` (trust every hop) is deliberately not supported: it would let any client spoof its IP.
 */
export function resolveTrustProxy(value: string | undefined = process.env.TRUST_PROXY): string | false {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_TRUST_PROXY;
  if (trimmed.toLowerCase() === "false") return false;
  return trimmed;
}

/**
 * Standard FastifyAdapter options for API applications
 */
export const defaultFastifyOptions = {
  trustProxy: resolveTrustProxy(),
  routerOptions: {
    ignoreTrailingSlash: true,
    // Signed object tokens (`/s3/objects/:token`) carry key, content type and filename;
    // Fastify's 100-char default answers 414 for them.
    maxParamLength: 4096,
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
