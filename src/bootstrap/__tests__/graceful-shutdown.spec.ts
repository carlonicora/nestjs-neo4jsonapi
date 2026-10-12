import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerHost } from "@nestjs/bullmq";
import { DiscoveryService } from "@nestjs/core";
import { SchedulerRegistry } from "@nestjs/schedule";

import { setupGracefulShutdown, stopJobIntake } from "../graceful-shutdown";

class FakeProcessor extends WorkerHost {
  async process(): Promise<void> {}
}

/** A WorkerHost whose BullMQ worker is a stub; `close` resolves when `release()` is called. */
function makeWorkerHost(events: string[]) {
  let release!: () => void;
  const closed = new Promise<void>((resolve) => (release = resolve));
  const close = vi.fn(async () => {
    events.push("worker.close:start");
    await closed;
    events.push("worker.close:end");
  });
  const host = new FakeProcessor();
  Object.defineProperty(host, "worker", { value: { close } });
  return { host, close, release };
}

function makeApp(params: { registry?: SchedulerRegistry; instances?: unknown[]; events?: string[] }) {
  const discovery = { getProviders: () => (params.instances ?? []).map((instance) => ({ instance })) };
  return {
    get: vi.fn((token: unknown) => {
      if (token === SchedulerRegistry && params.registry) return params.registry;
      if (token === DiscoveryService) return discovery;
      throw new Error(`Nest could not find ${String(token)}`);
    }),
    close: vi.fn(async () => {
      params.events?.push("app.close");
    }),
  } as any;
}

describe("stopJobIntake", () => {
  it("stops cron jobs and clears scheduled intervals and timeouts", async () => {
    const registry = new SchedulerRegistry();
    const cronJob = { stop: vi.fn() };
    registry.addCronJob("sync", cronJob as any);
    registry.addInterval(
      "tick",
      setInterval(() => undefined, 60_000),
    );
    registry.addTimeout(
      "once",
      setTimeout(() => undefined, 60_000),
    );

    await stopJobIntake(makeApp({ registry }));

    expect(cronJob.stop).toHaveBeenCalledTimes(1);
    expect(registry.getIntervals()).toEqual([]);
    expect(registry.getTimeouts()).toEqual([]);
  });

  it("closes every BullMQ worker and waits for the active jobs", async () => {
    const events: string[] = [];
    const first = makeWorkerHost(events);
    const second = makeWorkerHost(events);
    const app = makeApp({ instances: [first.host, { notAWorker: true }, undefined, second.host] });

    let settled = false;
    const drained = stopJobIntake(app).then(() => (settled = true));
    await vi.waitFor(() => expect(second.close).toHaveBeenCalledTimes(1));

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    first.release();
    second.release();
    await drained;
    expect(settled).toBe(true);
  });

  it("works without ScheduleModule (api mode mounts none)", async () => {
    await expect(stopJobIntake(makeApp({}))).resolves.toBeUndefined();
  });
});

describe("setupGracefulShutdown", () => {
  let handlers: Record<string, () => void>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    handlers = {};
    vi.spyOn(process, "on").mockImplementation(((event: string, handler: () => void) => {
      handlers[event] = handler;
      return process;
    }) as any);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["SIGTERM", "SIGINT"])(
    "on %s drains the workers BEFORE app.close() tears down Neo4j and Redis, then exits",
    async (signal) => {
      const events: string[] = [];
      const workerHost = makeWorkerHost(events);
      const app = makeApp({ instances: [workerHost.host], events });
      const healthServer = {
        close: vi.fn((callback: () => void) => {
          events.push("health.close");
          callback();
        }),
      };

      setupGracefulShutdown(app, healthServer);
      handlers[signal]();

      await vi.waitFor(() => expect(workerHost.close).toHaveBeenCalled());
      expect(app.close).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();

      workerHost.release();
      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));

      expect(events).toEqual(["health.close", "worker.close:start", "worker.close:end", "app.close"]);
    },
  );

  it("exits with 1 when the shutdown fails", async () => {
    const app = makeApp({});
    app.close.mockRejectedValueOnce(new Error("close failed"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    setupGracefulShutdown(app);
    handlers.SIGTERM();

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
  });
});
