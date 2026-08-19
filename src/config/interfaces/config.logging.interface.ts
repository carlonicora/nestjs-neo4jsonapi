export interface ConfigLoggingInterface {
  /**
   * Raw LOG_LEVEL, empty when unset. Deliberately NOT defaulted here: the two
   * pino transports disagree on their fallback (the Loki path defaults to
   * "info", the file path to "trace"), so each applies its own `|| default`.
   */
  level: string;
  /** CONSOLE_ENABLED === "true" (default false). Off means no stdout output. */
  consoleEnabled: boolean;
  loki: ConfigLokiInterface;
  debug: ConfigDebugLoggingInterface;
}

export interface ConfigLokiInterface {
  enabled: boolean;
  host: string;
  username: string;
  password: string;
  batching: boolean;
  interval: number;
  labels: {
    application: string;
    environment: string;
  };
}

/** File-based round/turn debug logger — see DebugLoggerService. */
export interface ConfigDebugLoggingInterface {
  /** DEBUG_LOGGING_ENABLED === "true" (default false). */
  enabled: boolean;
  /** Directory the round logs are written to, from DEBUG_LOG_PATH (default "./logs"). */
  basePath: string;
}
