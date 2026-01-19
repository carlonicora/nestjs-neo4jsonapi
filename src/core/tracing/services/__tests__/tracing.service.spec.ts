import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock @opentelemetry/api - must be defined inline without external variable references
vi.mock("@opentelemetry/api", () => {
  const mockSpan = {
    setAttributes: vi.fn(),
    addEvent: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
    spanContext: vi.fn().mockReturnValue({
      traceId: "mock-trace-id-123",
      spanId: "mock-span-id-456",
    }),
  };

  const mockTracer = {
    startSpan: vi.fn().mockReturnValue(mockSpan),
  };

  return {
    trace: {
      getTracer: vi.fn().mockReturnValue(mockTracer),
      setSpan: vi.fn().mockReturnValue({}),
      getActiveSpan: vi.fn().mockReturnValue(null),
    },
    context: {
      active: vi.fn().mockReturnValue({}),
      with: vi.fn().mockImplementation((_ctx, fn) => fn()),
    },
    SpanKind: {
      INTERNAL: 0,
      SERVER: 1,
      CLIENT: 2,
    },
    SpanStatusCode: {
      UNSET: 0,
      OK: 1,
      ERROR: 2,
    },
  };
});

// Mock baseConfig
vi.mock("../../../../config/base.config", () => ({
  baseConfig: {
    tempo: {
      enabled: true,
      serviceName: "test-service",
      serviceVersion: "1.0.0",
    },
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { TracingService } from "../tracing.service";
import { SpanStatusCode, trace } from "@opentelemetry/api";

// Get references to mocks after import
const getMockTracer = () => (trace.getTracer as any)();
const getMockSpan = () => getMockTracer().startSpan();

describe("TracingService", () => {
  let service: TracingService;
  let mockClsService: vi.Mocked<ClsService>;
  let mockSpan: any;
  let mockTracer: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get fresh mock references
    mockTracer = getMockTracer();
    mockSpan = mockTracer.startSpan();

    // Reset mock implementations
    mockSpan.setAttributes.mockClear();
    mockSpan.addEvent.mockClear();
    mockSpan.setStatus.mockClear();
    mockSpan.end.mockClear();
    mockSpan.spanContext.mockReturnValue({
      traceId: "mock-trace-id-123",
      spanId: "mock-span-id-456",
    });
    mockTracer.startSpan.mockClear();
    mockTracer.startSpan.mockReturnValue(mockSpan);

    mockClsService = {
      get: vi.fn(),
      set: vi.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [TracingService, { provide: ClsService, useValue: mockClsService }],
    }).compile();

    service = module.get<TracingService>(TracingService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("isTracingEnabled", () => {
    it("should return true when tracing is enabled", () => {
      expect(service.isTracingEnabled()).toBe(true);
    });
  });

  describe("startSpan", () => {
    it("should start a new span with the given name", () => {
      const span = service.startSpan("test-span");

      expect(span).toBe(mockSpan);
      expect(mockTracer.startSpan).toHaveBeenCalledWith("test-span", {
        kind: 0, // SpanKind.INTERNAL
        attributes: {},
      });
    });

    it("should start a span with attributes", () => {
      const attributes = { key1: "value1", key2: 123 };

      service.startSpan("test-span", { attributes });

      expect(mockTracer.startSpan).toHaveBeenCalledWith("test-span", {
        kind: 0,
        attributes,
      });
    });

    it("should add events to the span when provided", () => {
      const events = [{ name: "event1", attributes: { foo: "bar" }, timestamp: 12345 }, { name: "event2" }];

      service.startSpan("test-span", { events });

      expect(mockSpan.addEvent).toHaveBeenCalledTimes(2);
      expect(mockSpan.addEvent).toHaveBeenCalledWith("event1", { foo: "bar" }, 12345);
      expect(mockSpan.addEvent).toHaveBeenCalledWith("event2", {}, undefined);
    });

    it("should store span in CLS context", () => {
      service.startSpan("test-span");

      expect(mockClsService.set).toHaveBeenCalledWith("currentSpan", mockSpan);
    });
  });

  describe("createChildSpan", () => {
    it("should create a child span from active context", () => {
      const span = service.createChildSpan("child-span");

      expect(span).toBe(mockSpan);
    });
  });

  describe("startHttpSpan", () => {
    it("should start an HTTP span with method and url", () => {
      service.startHttpSpan("GET", "/api/users");

      expect(mockTracer.startSpan).toHaveBeenCalledWith("GET /api/users", {
        kind: 0,
        attributes: {
          "http.method": "GET",
          "http.url": "/api/users",
          component: "http",
        },
      });
    });

    it("should include client IP when provided", () => {
      service.startHttpSpan("POST", "/api/data", "192.168.1.1");

      expect(mockTracer.startSpan).toHaveBeenCalledWith("POST /api/data", {
        kind: 0,
        attributes: {
          "http.method": "POST",
          "http.url": "/api/data",
          component: "http",
          "http.client_ip": "192.168.1.1",
        },
      });
    });
  });

  describe("addSpanAttribute", () => {
    it("should add an attribute to the active span", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      service.addSpanAttribute("test-key", "test-value");

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ "test-key": "test-value" });
    });

    it("should handle numeric values", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      service.addSpanAttribute("count", 42);

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ count: 42 });
    });

    it("should handle boolean values", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      service.addSpanAttribute("isActive", true);

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ isActive: true });
    });

    it("should do nothing when no active span", () => {
      mockClsService.get.mockReturnValue(null);
      vi.mocked(trace.getActiveSpan).mockReturnValue(undefined);

      service.addSpanAttribute("key", "value");

      // setAttributes should only be called once during startSpan in beforeEach
      // This call should not trigger it again
      expect(mockSpan.setAttributes).not.toHaveBeenCalled();
    });
  });

  describe("addSpanAttributes", () => {
    it("should add multiple attributes to the active span", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      const attributes = { key1: "value1", key2: 123, key3: true };
      service.addSpanAttributes(attributes);

      expect(mockSpan.setAttributes).toHaveBeenCalledWith(attributes);
    });
  });

  describe("addSpanEvent", () => {
    it("should add an event to the active span", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      service.addSpanEvent("test-event");

      expect(mockSpan.addEvent).toHaveBeenCalledWith("test-event", {});
    });

    it("should add an event with attributes", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      const attributes = { eventData: "test" };
      service.addSpanEvent("test-event", attributes);

      expect(mockSpan.addEvent).toHaveBeenCalledWith("test-event", attributes);
    });
  });

  describe("setSpanError", () => {
    it("should set span status to error with string message", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      service.setSpanError("Something went wrong");

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: "Something went wrong",
      });
    });

    it("should set span status to error with Error object", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      const error = new Error("Test error");
      error.name = "TestError";
      error.stack = "stack trace";

      service.setSpanError(error);

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: "Test error",
      });
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        "error.name": "TestError",
        "error.message": "Test error",
        "error.stack": "stack trace",
      });
    });

    it("should handle Error without stack", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      const error = new Error("Test error");
      delete error.stack;

      service.setSpanError(error);

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        "error.name": "Error",
        "error.message": "Test error",
        "error.stack": "",
      });
    });
  });

  describe("setSpanSuccess", () => {
    it("should set span status to OK", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      service.setSpanSuccess();

      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    });
  });

  describe("endSpan", () => {
    it("should end the provided span", () => {
      const customSpan = { end: vi.fn() };

      service.endSpan(customSpan);

      expect(customSpan.end).toHaveBeenCalled();
    });

    it("should end the active span when no span provided", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      service.endSpan();

      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe("getCurrentTraceId", () => {
    it("should return the trace ID from active span", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      const traceId = service.getCurrentTraceId();

      expect(traceId).toBe("mock-trace-id-123");
    });

    it("should return undefined when no active span", () => {
      mockClsService.get.mockReturnValue(null);
      vi.mocked(trace.getActiveSpan).mockReturnValue(undefined);

      const traceId = service.getCurrentTraceId();

      expect(traceId).toBeUndefined();
    });
  });

  describe("getCurrentSpanId", () => {
    it("should return the span ID from active span", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      const spanId = service.getCurrentSpanId();

      expect(spanId).toBe("mock-span-id-456");
    });

    it("should return undefined when no active span", () => {
      mockClsService.get.mockReturnValue(null);
      vi.mocked(trace.getActiveSpan).mockReturnValue(undefined);

      const spanId = service.getCurrentSpanId();

      expect(spanId).toBeUndefined();
    });
  });

  describe("getCurrentTracingContext", () => {
    it("should return tracing context with traceId and spanId", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      const context = service.getCurrentTracingContext();

      expect(context).toEqual({
        traceId: "mock-trace-id-123",
        spanId: "mock-span-id-456",
      });
    });

    it("should return undefined when no active span", () => {
      mockClsService.get.mockReturnValue(null);
      vi.mocked(trace.getActiveSpan).mockReturnValue(undefined);

      const context = service.getCurrentTracingContext();

      expect(context).toBeUndefined();
    });
  });

  describe("getActiveSpan", () => {
    it("should return span from CLS context first", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      const span = service.getActiveSpan();

      expect(span).toBe(mockSpan);
      expect(mockClsService.get).toHaveBeenCalledWith("currentSpan");
    });

    it("should fall back to OpenTelemetry context when CLS is empty", () => {
      const otelSpan = { id: "otel-span" };
      mockClsService.get.mockReturnValue(null);
      vi.mocked(trace.getActiveSpan).mockReturnValue(otelSpan as any);

      const span = service.getActiveSpan();

      expect(span).toBe(otelSpan);
    });
  });

  describe("withSpan", () => {
    it("should execute function within span context and set success", () => {
      mockClsService.get.mockReturnValue(mockSpan);

      const result = service.withSpan("test-operation", (span) => {
        expect(span).toBe(mockSpan);
        return "result";
      });

      expect(result).toBe("result");
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should handle errors and set span error status", () => {
      mockClsService.get.mockReturnValue(mockSpan);
      const error = new Error("Test error");

      expect(() => {
        service.withSpan("test-operation", () => {
          throw error;
        });
      }).toThrow("Test error");

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: "Test error",
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should pass options to startSpan", () => {
      mockClsService.get.mockReturnValue(mockSpan);
      const options = { attributes: { key: "value" } };

      service.withSpan("test-operation", () => "result", options);

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        "test-operation",
        expect.objectContaining({ attributes: { key: "value" } }),
      );
    });
  });
});

describe("TracingService (disabled)", () => {
  let service: TracingService;
  let mockClsService: vi.Mocked<ClsService>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockClsService = {
      get: vi.fn(),
      set: vi.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [TracingService, { provide: ClsService, useValue: mockClsService }],
    }).compile();

    service = module.get<TracingService>(TracingService);

    // Manually set isEnabled to false for testing disabled behavior
    (service as any).isEnabled = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return false for isTracingEnabled", () => {
    expect(service.isTracingEnabled()).toBe(false);
  });

  it("should return null for startSpan", () => {
    const span = service.startSpan("test");
    expect(span).toBeNull();
  });

  it("should return null for createChildSpan", () => {
    const span = service.createChildSpan("test");
    expect(span).toBeNull();
  });

  it("should return null for startHttpSpan", () => {
    const span = service.startHttpSpan("GET", "/api");
    expect(span).toBeNull();
  });

  it("should do nothing for addSpanAttribute", () => {
    service.addSpanAttribute("key", "value");
    expect(mockClsService.get).not.toHaveBeenCalled();
  });

  it("should do nothing for addSpanAttributes", () => {
    service.addSpanAttributes({ key: "value" });
    expect(mockClsService.get).not.toHaveBeenCalled();
  });

  it("should do nothing for addSpanEvent", () => {
    service.addSpanEvent("test");
    expect(mockClsService.get).not.toHaveBeenCalled();
  });

  it("should do nothing for setSpanError", () => {
    service.setSpanError("error");
    expect(mockClsService.get).not.toHaveBeenCalled();
  });

  it("should do nothing for setSpanSuccess", () => {
    service.setSpanSuccess();
    expect(mockClsService.get).not.toHaveBeenCalled();
  });

  it("should do nothing for endSpan", () => {
    service.endSpan();
    expect(mockClsService.get).not.toHaveBeenCalled();
  });

  it("should return undefined for getCurrentTraceId", () => {
    expect(service.getCurrentTraceId()).toBeUndefined();
  });

  it("should return undefined for getCurrentSpanId", () => {
    expect(service.getCurrentSpanId()).toBeUndefined();
  });

  it("should return undefined for getCurrentTracingContext", () => {
    expect(service.getCurrentTracingContext()).toBeUndefined();
  });

  it("should return null for getActiveSpan", () => {
    expect(service.getActiveSpan()).toBeNull();
  });

  it("should execute function directly for withSpan when disabled", () => {
    const result = service.withSpan("test", (span) => {
      expect(span).toBeNull();
      return "result";
    });

    expect(result).toBe("result");
  });
});
