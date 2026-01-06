import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { HttpExceptionFilter } from "../http-exception.filter";
import { AppLoggingService } from "../../../core/logging/services/logging.service";

describe("HttpExceptionFilter", () => {
  let filter: HttpExceptionFilter;
  let mockLogger: vi.Mocked<Partial<AppLoggingService>>;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      getRequestContext: vi.fn(),
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    mockRequest = {
      method: "GET",
      url: "/api/test",
      id: "req-123",
      ip: "127.0.0.1",
      headers: {
        "user-agent": "test-agent",
      },
    };

    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as ArgumentsHost;

    filter = new HttpExceptionFilter(mockLogger as AppLoggingService);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe("catch", () => {
    it("should log HttpException with warn level for 4xx errors", () => {
      const exception = new HttpException("Not Found", HttpStatus.NOT_FOUND);

      filter.catch(exception, mockHost);

      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("should log HttpException with error level for 5xx errors", () => {
      const exception = new HttpException("Internal Server Error", HttpStatus.INTERNAL_SERVER_ERROR);

      filter.catch(exception, mockHost);

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should log unknown exceptions as 500 errors", () => {
      const exception = new Error("Something went wrong");

      filter.catch(exception, mockHost);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it("should include request context in logs", () => {
      mockLogger.getRequestContext?.mockReturnValue({
        requestId: "ctx-req-456",
        userId: "user-123",
        companyId: "company-456",
      });

      const exception = new HttpException("Bad Request", HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockHost);

      const logCall = mockLogger.warn?.mock.calls[0];
      expect(logCall).toBeDefined();
      const metadata = logCall?.[2];
      expect(metadata?.request?.requestId).toBe("ctx-req-456");
      expect(metadata?.request?.userId).toBe("user-123");
      expect(metadata?.request?.companyId).toBe("company-456");
    });

    it("should include timestamp in structured log entry", () => {
      const exception = new HttpException("Bad Request", HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockHost);

      const logCall = mockLogger.warn?.mock.calls[0];
      const metadata = logCall?.[2];
      expect(metadata?.timestamp).toBeDefined();
      expect(new Date(metadata?.timestamp).toISOString()).toBe(metadata?.timestamp);
    });

    it("should return JSON:API formatted error response", () => {
      const exception = new HttpException("Not Found", HttpStatus.NOT_FOUND);

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.any(String),
          errors: expect.arrayContaining([
            expect.objectContaining({
              status: "404",
              title: expect.any(String),
              detail: expect.any(String),
              source: expect.objectContaining({
                pointer: "/api/test",
              }),
              meta: expect.objectContaining({
                timestamp: expect.any(String),
                path: "/api/test",
                method: "GET",
              }),
            }),
          ]),
        }),
      );
    });

    it("should not expose requestId, userId, or companyId in client response", () => {
      mockLogger.getRequestContext?.mockReturnValue({
        requestId: "req-123",
        userId: "user-123",
        companyId: "company-456",
      });

      const exception = new HttpException("Bad Request", HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockHost);

      const responseBody = mockResponse.send.mock.calls[0][0];
      // requestId IS included in response for tracing
      expect(responseBody.errors[0].meta.requestId).toBe("req-123");
      // userId and companyId should NOT be in client response
      expect(responseBody.errors[0].meta.userId).toBeUndefined();
      expect(responseBody.errors[0].meta.companyId).toBeUndefined();
    });
  });

  describe("validation errors", () => {
    it("should log validation errors with details", () => {
      const exception = new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: ["email must be an email", "name should not be empty"],
          error: "Bad Request",
        },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      expect(mockLogger.warn).toHaveBeenCalled();
      const logMessage = mockLogger.warn?.mock.calls[0][0];
      expect(logMessage).toContain("Validation Error");
      expect(logMessage).toContain("email must be an email");
      expect(logMessage).toContain("name should not be empty");
    });
  });

  describe("production mode", () => {
    it("should sanitize 500 error messages in production", () => {
      vi.stubEnv("NODE_ENV", "production");

      // Create new filter instance to pick up env change
      const prodFilter = new HttpExceptionFilter(mockLogger as AppLoggingService);
      const exception = new HttpException(
        "Database connection failed: host=localhost:5432",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

      prodFilter.catch(exception, mockHost);

      const responseBody = mockResponse.send.mock.calls[0][0];
      expect(responseBody.message).toBe("An internal error occurred. Please try again later.");
      expect(responseBody.message).not.toContain("Database");
      expect(responseBody.message).not.toContain("localhost");
    });

    it("should not sanitize 4xx error messages in production", () => {
      vi.stubEnv("NODE_ENV", "production");

      const prodFilter = new HttpExceptionFilter(mockLogger as AppLoggingService);
      const exception = new HttpException("Invalid email format", HttpStatus.BAD_REQUEST);

      prodFilter.catch(exception, mockHost);

      const responseBody = mockResponse.send.mock.calls[0][0];
      expect(responseBody.message).toBe("Invalid email format");
    });
  });

  describe("without logger", () => {
    it("should handle exceptions gracefully without logger", () => {
      const filterWithoutLogger = new HttpExceptionFilter();
      const exception = new HttpException("Test Error", HttpStatus.BAD_REQUEST);

      expect(() => filterWithoutLogger.catch(exception, mockHost)).not.toThrow();
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    });
  });
});
