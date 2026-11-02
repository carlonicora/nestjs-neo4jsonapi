import { vi, describe, it, expect } from "vitest";
import { of } from "rxjs";
import { OfflineRequestInterceptor } from "../offline-request.interceptor";
import { OfflineRequestContext } from "../offline-request.context";
import { OFFLINE_CLS_REPLAY, OFFLINE_INTERNAL_HEADER, OFFLINE_REPLAY_HEADER } from "../offline.constants";
import { offlineInternalToken } from "../../../foundations/offline-change-set/services/offline-route-runner.service";

const buildContext = (headers: Record<string, string | undefined>): any => ({
  getType: () => "http",
  switchToHttp: () => ({ getRequest: () => ({ headers }) }),
});

const buildCls = () => {
  const store = new Map<string, unknown>();
  return {
    store,
    set: vi.fn((key: string, value: unknown) => store.set(key, value)),
    get: vi.fn((key: string) => store.get(key)),
  };
};

describe("OfflineRequestInterceptor", () => {
  it("sets OFFLINE_CLS_REPLAY to true when x-offline-replay is 1 and the process token is carried", async () => {
    const cls = buildCls();
    const interceptor = new OfflineRequestInterceptor(cls as any);
    const next = { handle: vi.fn(() => of("ok")) };

    interceptor.intercept(
      buildContext({ [OFFLINE_REPLAY_HEADER]: "1", [OFFLINE_INTERNAL_HEADER]: offlineInternalToken() }),
      next,
    );

    expect(cls.set).toHaveBeenCalledWith(OFFLINE_CLS_REPLAY, true);
    expect(next.handle).toHaveBeenCalled();
    expect(new OfflineRequestContext(cls as any).isReplay()).toBe(true);
  });

  it("a client sending x-offline-replay: 1 without the process token is not a replay", async () => {
    const cls = buildCls();
    const interceptor = new OfflineRequestInterceptor(cls as any);
    const next = { handle: vi.fn(() => of("ok")) };

    interceptor.intercept(buildContext({ [OFFLINE_REPLAY_HEADER]: "1" }), next);
    interceptor.intercept(buildContext({ [OFFLINE_REPLAY_HEADER]: "1", [OFFLINE_INTERNAL_HEADER]: "guess" }), next);

    expect(cls.set).not.toHaveBeenCalled();
    expect(next.handle).toHaveBeenCalledTimes(2);
    expect(new OfflineRequestContext(cls as any).isReplay()).toBe(false);
  });

  it("leaves it unset otherwise", async () => {
    const cls = buildCls();
    const interceptor = new OfflineRequestInterceptor(cls as any);
    const next = { handle: vi.fn(() => of("ok")) };

    interceptor.intercept(
      buildContext({ [OFFLINE_REPLAY_HEADER]: "0", [OFFLINE_INTERNAL_HEADER]: offlineInternalToken() }),
      next,
    );
    interceptor.intercept(buildContext({}), next);

    expect(cls.set).not.toHaveBeenCalled();
    expect(next.handle).toHaveBeenCalledTimes(2);
    expect(new OfflineRequestContext(cls as any).isReplay()).toBe(false);
  });
});
