import { CallHandler, ExecutionContext, HttpException } from "@nestjs/common";
import { throwError } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoggingInterceptor } from "../logging.interceptor";

vi.mock("../../../../config/base.config", () => ({
  baseConfig: {
    api: { url: "http://localhost:3300" },
  },
}));

describe("LoggingInterceptor", () => {
  let interceptor: LoggingInterceptor;
  let loggingService: any;
  let clsService: any;

  const buildContext = (method: string, url: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
          id: "req-1",
          url,
          method,
          ip: "127.0.0.1",
          raw: {},
        }),
      }),
    }) as unknown as ExecutionContext;

  const buildHandler = (error: unknown): CallHandler => ({
    handle: () => throwError(() => error),
  });

  const run = async (context: ExecutionContext, error: unknown): Promise<unknown> =>
    new Promise((resolve) => {
      interceptor.intercept(context, buildHandler(error)).subscribe({
        error: (e) => resolve(e),
      });
    });

  beforeEach(() => {
    loggingService = {
      setRequestContext: vi.fn(),
      clearRequestContext: vi.fn(),
      logHttpError: vi.fn(),
      errorWithContext: vi.fn(),
      warn: vi.fn(),
    };
    clsService = { set: vi.fn() };
    interceptor = new LoggingInterceptor(loggingService, clsService);
  });

  it("logs 4xx client errors at warn level without a stack trace", async () => {
    const exception = new HttpException("Method Not Allowed", 405);

    const thrown = await run(buildContext("GET", "/mcp"), exception);

    expect(thrown).toBe(exception);
    expect(loggingService.logHttpError).not.toHaveBeenCalled();
    expect(loggingService.errorWithContext).not.toHaveBeenCalled();
    expect(loggingService.warn).toHaveBeenCalledTimes(1);
    const [message, context, metadata] = loggingService.warn.mock.calls[0];
    expect(message).toMatch(/^GET \/mcp - 405 \(\d+ms\)$/);
    expect(context).toBe("HTTP");
    expect(metadata).toMatchObject({ httpStatusCode: 405, httpMethod: "GET", httpUrl: "/mcp" });
  });

  it("logs 5xx server errors at error level with full context", async () => {
    const exception = new HttpException("Boom", 500);

    const thrown = await run(buildContext("POST", "/mcp"), exception);

    expect(thrown).toBe(exception);
    expect(loggingService.warn).not.toHaveBeenCalled();
    expect(loggingService.logHttpError).toHaveBeenCalledTimes(1);
    expect(loggingService.errorWithContext).toHaveBeenCalledTimes(1);
    expect(loggingService.errorWithContext).toHaveBeenCalledWith(
      "Request failed",
      exception,
      "HTTP_ERROR",
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it("treats errors without a status as 5xx", async () => {
    const exception = new Error("unexpected");

    await run(buildContext("GET", "/anything"), exception);

    expect(loggingService.warn).not.toHaveBeenCalled();
    expect(loggingService.errorWithContext).toHaveBeenCalledTimes(1);
  });

  it("defers validation errors to HttpExceptionFilter", async () => {
    const exception: any = new HttpException({ message: ["name must be a string"] }, 400);
    exception.response = { message: ["name must be a string"] };

    await run(buildContext("POST", "/users"), exception);

    expect(loggingService.warn).not.toHaveBeenCalled();
    expect(loggingService.logHttpError).not.toHaveBeenCalled();
    expect(loggingService.errorWithContext).not.toHaveBeenCalled();
  });
});
