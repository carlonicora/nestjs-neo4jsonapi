export interface LogContext {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  companyId?: string;
  ip?: string;
  userAgent?: string;
  method?: string;
  url?: string;
  [key: string]: any;
}

export interface LogEntry {
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  message: string;
  context?: string;
  metadata?: Record<string, any>;
  timestamp?: Date;
  error?: Error;
}

export interface LoggingServiceInterface {
  log(message: any, context?: string, metadata?: Record<string, any>): void;
  error(message: any, error?: Error | string, context?: string, metadata?: Record<string, any>): void;
  warn(message: any, context?: string, metadata?: Record<string, any>): void;
  debug(message: any, context?: string, metadata?: Record<string, any>): void;
  verbose(message: any, context?: string, metadata?: Record<string, any>): void;
  fatal(message: any, error?: Error, context?: string, metadata?: Record<string, any>): void;
  trace(message: any, context?: string, metadata?: Record<string, any>): void;

  // Enhanced methods with automatic context enrichment
  logWithContext(message: string, context?: string, metadata?: Record<string, any>): void;
  errorWithContext(message: string, error?: Error, context?: string, metadata?: Record<string, any>): void;

  // Context management
  setRequestContext(context: LogContext): void;
  getRequestContext(): LogContext | undefined;
  clearRequestContext(): void;

  // Child logger creation
  createChildLogger(context: string, metadata?: Record<string, any>): LoggingServiceInterface;
}
