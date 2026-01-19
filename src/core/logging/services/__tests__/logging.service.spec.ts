import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { AppLoggingService } from "../logging.service";

// Create mock pino logger
const mockPinoLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(),
};

// Mock pino to return our mock logger
vi.mock("pino", () => {
  const mockPino = vi.fn(() => mockPinoLogger);
  mockPino.stdTimeFunctions = { isoTime: vi.fn() };
  mockPino.multistream = vi.fn((streams) => streams);
  mockPino.transport = vi.fn((config) => config);
  return { default: mockPino };
});

// Mock pino-pretty
vi.mock("pino-pretty", () => ({
  default: vi.fn(() => ({ write: vi.fn() })),
}));

// Mock the base config
vi.mock("../../../../config/base.config", () => ({
  baseConfig: {
    logging: {
      loki: {
        enabled: false,
        host: null,
      },
    },
  },
}));

describe("AppLoggingService", () => {
  let service: AppLoggingService;
  let mockClsService: vi.Mocked<ClsService>;
  let clsStore: Record<string, any>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset the mock child function to return a fresh logger for each test
    mockPinoLogger.child.mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
    });

    // CLS store for simulating request context
    clsStore = {};

    mockClsService = {
      get: vi.fn((key: string) => clsStore[key]),
      set: vi.fn((key: string, value: any) => {
        clsStore[key] = value;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [AppLoggingService, { provide: ClsService, useValue: mockClsService }],
    }).compile();

    service = module.get<AppLoggingService>(AppLoggingService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("log", () => {
    it("should log info level message", () => {
      service.log("Test message", "TestContext");

      expect(mockPinoLogger.info).toHaveBeenCalled();
      const [context, message] = mockPinoLogger.info.mock.calls[0];
      expect(message).toBe("Test message");
      expect(context.context).toBe("TestContext");
    });

    it("should log object messages as JSON string", () => {
      const messageObj = { key: "value", nested: { data: 123 } };
      service.log(messageObj, "TestContext");

      expect(mockPinoLogger.info).toHaveBeenCalled();
      const [, message] = mockPinoLogger.info.mock.calls[0];
      expect(message).toBe(JSON.stringify(messageObj));
    });

    it("should include metadata in context", () => {
      service.log("Test message", "TestContext", { extra: "data" });

      expect(mockPinoLogger.info).toHaveBeenCalled();
      const [context] = mockPinoLogger.info.mock.calls[0];
      expect(context.extra).toBe("data");
    });
  });

  describe("error", () => {
    it("should log error level message", () => {
      service.error("Error occurred", undefined, "TestContext");

      expect(mockPinoLogger.error).toHaveBeenCalled();
      const [, message] = mockPinoLogger.error.mock.calls[0];
      expect(message).toBe("Error occurred");
    });

    it("should include Error object details", () => {
      const error = new Error("Test error");
      service.error("Something failed", error, "TestContext");

      expect(mockPinoLogger.error).toHaveBeenCalled();
      const [context, message] = mockPinoLogger.error.mock.calls[0];
      expect(context.error).toBe("Test error");
      expect(context.errorName).toBe("Error");
      expect(message).toContain("Something failed");
      expect(message).toContain("Stack:");
    });

    it("should handle legacy trace string signature", () => {
      service.error("Error occurred", "trace-id-123", "TestContext");

      expect(mockPinoLogger.error).toHaveBeenCalled();
      const [context] = mockPinoLogger.error.mock.calls[0];
      expect(context.trace).toBe("trace-id-123");
    });

    it("should log object messages as JSON string with error", () => {
      const messageObj = { errorCode: "ERR_001" };
      const error = new Error("Test error");
      service.error(messageObj, error, "TestContext");

      expect(mockPinoLogger.error).toHaveBeenCalled();
      const [, message] = mockPinoLogger.error.mock.calls[0];
      expect(message).toContain(JSON.stringify(messageObj));
      expect(message).toContain("Stack:");
    });
  });

  describe("warn", () => {
    it("should log warn level message", () => {
      service.warn("Warning message", "TestContext");

      expect(mockPinoLogger.warn).toHaveBeenCalled();
      const [, message] = mockPinoLogger.warn.mock.calls[0];
      expect(message).toBe("Warning message");
    });

    it("should log object messages as JSON string", () => {
      const messageObj = { warning: "data" };
      service.warn(messageObj, "TestContext");

      expect(mockPinoLogger.warn).toHaveBeenCalled();
      const [, message] = mockPinoLogger.warn.mock.calls[0];
      expect(message).toBe(JSON.stringify(messageObj));
    });
  });

  describe("debug", () => {
    it("should log debug level message", () => {
      service.debug("Debug message", "TestContext");

      expect(mockPinoLogger.debug).toHaveBeenCalled();
      const [, message] = mockPinoLogger.debug.mock.calls[0];
      expect(message).toBe("Debug message");
    });

    it("should log object messages as JSON string", () => {
      const messageObj = { debug: true };
      service.debug(messageObj, "TestContext");

      expect(mockPinoLogger.debug).toHaveBeenCalled();
      const [, message] = mockPinoLogger.debug.mock.calls[0];
      expect(message).toBe(JSON.stringify(messageObj));
    });
  });

  describe("verbose", () => {
    it("should log trace level message (verbose maps to trace)", () => {
      service.verbose("Verbose message", "TestContext");

      expect(mockPinoLogger.trace).toHaveBeenCalled();
      const [, message] = mockPinoLogger.trace.mock.calls[0];
      expect(message).toBe("Verbose message");
    });
  });

  describe("fatal", () => {
    it("should log fatal level message", () => {
      service.fatal("Fatal error");

      expect(mockPinoLogger.fatal).toHaveBeenCalled();
      const [, message] = mockPinoLogger.fatal.mock.calls[0];
      expect(message).toBe("Fatal error");
    });

    it("should include Error object details", () => {
      const error = new Error("Critical failure");
      service.fatal("System crashed", error, "TestContext");

      expect(mockPinoLogger.fatal).toHaveBeenCalled();
      const [context, message] = mockPinoLogger.fatal.mock.calls[0];
      expect(context.error).toBe("Critical failure");
      expect(context.errorName).toBe("Error");
      expect(message).toContain("System crashed");
      expect(message).toContain("Stack:");
    });
  });

  describe("trace", () => {
    it("should log trace level message", () => {
      service.trace("Trace message", "TestContext");

      expect(mockPinoLogger.trace).toHaveBeenCalled();
      const [, message] = mockPinoLogger.trace.mock.calls[0];
      expect(message).toBe("Trace message");
    });
  });

  describe("logWithContext", () => {
    it("should log with context enrichment", () => {
      service.logWithContext("Contextual log", "TestContext", { customField: "value" });

      expect(mockPinoLogger.info).toHaveBeenCalled();
      const [context, message] = mockPinoLogger.info.mock.calls[0];
      expect(message).toBe("Contextual log");
      expect(context.context).toBe("TestContext");
      expect(context.customField).toBe("value");
    });
  });

  describe("errorWithContext", () => {
    it("should log error with context enrichment", () => {
      const error = new Error("Contextual error");
      service.errorWithContext("Error with context", error, "TestContext", { errorCode: "E001" });

      expect(mockPinoLogger.error).toHaveBeenCalled();
      const [context, message] = mockPinoLogger.error.mock.calls[0];
      expect(message).toContain("Error with context");
      expect(context.error).toBe("Contextual error");
      expect(context.errorCode).toBe("E001");
    });

    it("should handle missing error", () => {
      service.errorWithContext("Error without exception", undefined, "TestContext");

      expect(mockPinoLogger.error).toHaveBeenCalled();
      const [, message] = mockPinoLogger.error.mock.calls[0];
      expect(message).toBe("Error without exception");
    });
  });

  describe("Request Context Management", () => {
    it("should set request context in CLS", () => {
      const logContext = {
        requestId: "req-123",
        userId: "user-456",
        method: "GET",
        url: "/api/test",
      };

      service.setRequestContext(logContext);

      expect(mockClsService.set).toHaveBeenCalledWith("logContext", logContext);
    });

    it("should get request context from CLS", () => {
      const logContext = {
        requestId: "req-123",
        userId: "user-456",
      };
      clsStore["logContext"] = logContext;

      const result = service.getRequestContext();

      expect(result).toEqual(logContext);
    });

    it("should clear request context", () => {
      service.clearRequestContext();

      expect(mockClsService.set).toHaveBeenCalledWith("logContext", undefined);
    });

    it("should include request context in logs", () => {
      const logContext = {
        requestId: "req-789",
        userId: "user-abc",
      };
      clsStore["logContext"] = logContext;

      service.log("Message with context", "TestContext");

      expect(mockPinoLogger.info).toHaveBeenCalled();
      const [context] = mockPinoLogger.info.mock.calls[0];
      expect(context.requestId).toBe("req-789");
      expect(context.userId).toBe("user-abc");
    });
  });

  describe("createChildLogger", () => {
    it("should create a child logger with context", () => {
      const childLogger = service.createChildLogger("ChildContext", { module: "test" });

      expect(mockPinoLogger.child).toHaveBeenCalledWith({
        context: "ChildContext",
        module: "test",
      });
      expect(childLogger).toBeDefined();
    });

    it("should cache child loggers with same context", () => {
      service.createChildLogger("SameContext", { key: "value" });
      service.createChildLogger("SameContext", { key: "value" });

      // Should only create child once due to caching
      expect(mockPinoLogger.child).toHaveBeenCalledTimes(1);
    });

    it("should create new child for different context", () => {
      service.createChildLogger("Context1", { key: "value1" });
      service.createChildLogger("Context2", { key: "value2" });

      expect(mockPinoLogger.child).toHaveBeenCalledTimes(2);
    });

    it("child logger should have all logging methods", () => {
      const childLogger = service.createChildLogger("ChildContext");

      expect(childLogger.log).toBeDefined();
      expect(childLogger.error).toBeDefined();
      expect(childLogger.warn).toBeDefined();
      expect(childLogger.debug).toBeDefined();
      expect(childLogger.verbose).toBeDefined();
      expect(childLogger.fatal).toBeDefined();
      expect(childLogger.trace).toBeDefined();
      expect(childLogger.logWithContext).toBeDefined();
      expect(childLogger.errorWithContext).toBeDefined();
      expect(childLogger.createChildLogger).toBeDefined();
    });
  });

  describe("HTTP Logging Utilities", () => {
    it("should log HTTP request", () => {
      service.logHttpRequest("GET", "/api/users", 200, 150, "192.168.1.1");

      expect(mockPinoLogger.info).toHaveBeenCalled();
      const [context, message] = mockPinoLogger.info.mock.calls[0];
      expect(message).toBe("GET /api/users - 200 (150ms)");
      expect(context.httpMethod).toBe("GET");
      expect(context.httpUrl).toBe("/api/users");
      expect(context.httpStatusCode).toBe(200);
      expect(context.responseTimeMs).toBe(150);
      expect(context.clientIp).toBe("192.168.1.1");
      expect(context.context).toBe("HTTP");
    });

    it("should log HTTP error", () => {
      const error = new Error("Connection refused");
      service.logHttpError("POST", "/api/data", error, 500, "10.0.0.1");

      expect(mockPinoLogger.error).toHaveBeenCalled();
      const [context, message] = mockPinoLogger.error.mock.calls[0];
      expect(message).toContain("POST /api/data - ERROR (500ms)");
      expect(context.httpMethod).toBe("POST");
      expect(context.httpUrl).toBe("/api/data");
      expect(context.error).toBe("Connection refused");
    });
  });

  describe("Business and Security Event Logging", () => {
    it("should log business event", () => {
      service.logBusinessEvent("UserRegistered", { userId: "user-123", plan: "premium" });

      expect(mockPinoLogger.info).toHaveBeenCalled();
      const [context, message] = mockPinoLogger.info.mock.calls[0];
      expect(message).toBe("Business Event: UserRegistered");
      expect(context.context).toBe("BUSINESS");
      expect(context.userId).toBe("user-123");
      expect(context.plan).toBe("premium");
    });

    it("should log security event with security flag", () => {
      service.logSecurityEvent("LoginAttemptFailed", { userId: "user-456", ip: "10.0.0.1" });

      expect(mockPinoLogger.info).toHaveBeenCalled();
      const [context, message] = mockPinoLogger.info.mock.calls[0];
      expect(message).toBe("Security Event: LoginAttemptFailed");
      expect(context.context).toBe("SECURITY");
      expect(context.securityEvent).toBe(true);
      expect(context.userId).toBe("user-456");
    });
  });
});
