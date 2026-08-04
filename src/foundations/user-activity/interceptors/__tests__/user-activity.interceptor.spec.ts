import { CallHandler, ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserActivityService } from "../../services/user-activity.service";
import { UserActivityInterceptor } from "../user-activity.interceptor";

describe("UserActivityInterceptor", () => {
  let interceptor: UserActivityInterceptor;
  let userActivity: { record: ReturnType<typeof vi.fn> };
  let logger: { error: ReturnType<typeof vi.fn> };

  const context = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const next: CallHandler = { handle: () => of({ ok: true }) };

  const run = async (request: Record<string, unknown>) => {
    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(context(request), next).subscribe({ next: () => resolve(), error: reject });
    });
  };

  const authed = { userId: "user-1", companyId: "company-1" };

  beforeEach(() => {
    userActivity = { record: vi.fn(async () => undefined) };
    logger = { error: vi.fn() };
    interceptor = new UserActivityInterceptor(userActivity as unknown as UserActivityService, logger as any);
  });

  it("records ENTITY/CREATE for a POST and infers the entity type from the first path segment", async () => {
    await run({ method: "POST", url: "/proceedings?include=owner", user: authed });

    expect(userActivity.record).toHaveBeenCalledWith({
      userId: "user-1",
      companyId: "company-1",
      category: "ENTITY",
      action: "CREATE",
      entityType: "proceedings",
      metadata: { method: "POST", path: "/proceedings" },
    });
  });

  it.each([
    ["PUT", "UPDATE"],
    ["PATCH", "UPDATE"],
    ["DELETE", "DELETE"],
  ])("maps %s to %s", async (method, action) => {
    await run({ method, url: "/documents/doc-1", user: authed });

    expect(userActivity.record).toHaveBeenCalledWith(expect.objectContaining({ action, category: "ENTITY" }));
  });

  it("skips GET and OPTIONS", async () => {
    await run({ method: "GET", url: "/proceedings", user: authed });
    await run({ method: "OPTIONS", url: "/proceedings", user: authed });

    expect(userActivity.record).not.toHaveBeenCalled();
  });

  it.each(["/health", "/healthcheck", "/metrics", "/auth/login"])("skips %s", async (url) => {
    await run({ method: "POST", url, user: authed });

    expect(userActivity.record).not.toHaveBeenCalled();
  });

  it("skips unauthenticated requests", async () => {
    await run({ method: "POST", url: "/proceedings" });
    await run({ method: "POST", url: "/proceedings", user: { userId: "user-1" } });
    await run({ method: "POST", url: "/proceedings", user: { companyId: "company-1" } });

    expect(userActivity.record).not.toHaveBeenCalled();
  });

  it("leaves entityType undefined when the first segment is not a resource name", async () => {
    await run({ method: "POST", url: "/V2/proceedings", user: authed });

    expect(userActivity.record).toHaveBeenCalledWith(expect.objectContaining({ entityType: undefined }));
  });

  it("never breaks the response stream when recording blows up", async () => {
    userActivity.record.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    await expect(run({ method: "POST", url: "/proceedings", user: authed })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});
