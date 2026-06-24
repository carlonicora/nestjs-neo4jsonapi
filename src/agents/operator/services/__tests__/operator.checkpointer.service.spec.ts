import { MemorySaver } from "@langchain/langgraph";
import { RedisSaver } from "@langchain/langgraph-checkpoint-redis";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorCheckpointerService } from "../operator.checkpointer.service";

vi.mock("@langchain/langgraph-checkpoint-redis", () => ({
  RedisSaver: {
    fromUrl: vi.fn(),
  },
}));

const { probeClient, MockedRedis } = vi.hoisted(() => {
  const probeClient = {
    on: vi.fn(),
    connect: vi.fn(),
    call: vi.fn(),
    disconnect: vi.fn(),
  };

  // A regular function (not an arrow) so `new Redis(...)` can construct it;
  // a constructor returning an object makes `new` yield that object.
  return {
    probeClient,
    MockedRedis: vi.fn(function () {
      return probeClient;
    }),
  };
});

vi.mock("ioredis", () => ({
  Redis: MockedRedis,
}));

const mockedFromUrl = vi.mocked(RedisSaver.fromUrl);

/** COMMAND INFO reply for a command the server supports. */
const supportedCommandReply = (name: string): unknown => [[name.toLowerCase(), -1, ["write"], 1, 1, 1]];
/** COMMAND INFO reply for an unknown command: a single nil element. */
const missingCommandReply = (): unknown => [null];

describe("OperatorCheckpointerService", () => {
  let service: OperatorCheckpointerService;
  let configValues: Record<string, unknown>;

  const fakeRedisSaverClient = { on: vi.fn() };
  const fakeRedisSaver = {
    __kind: "redis-saver",
    end: vi.fn().mockResolvedValue(undefined),
    client: fakeRedisSaverClient,
  };

  const buildService = async (): Promise<OperatorCheckpointerService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OperatorCheckpointerService,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) => configValues[key]),
          },
        },
      ],
    }).compile();

    return module.get<OperatorCheckpointerService>(OperatorCheckpointerService);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    configValues = {};
    mockedFromUrl.mockResolvedValue(fakeRedisSaver as unknown as RedisSaver);
    fakeRedisSaver.end.mockResolvedValue(undefined);
    // Probe defaults: server supports both module commands.
    probeClient.connect.mockResolvedValue(undefined);
    probeClient.call.mockImplementation(async (...args: unknown[]) => supportedCommandReply(String(args[2])));
  });

  describe("when redis config is absent", () => {
    it("returns a MemorySaver", async () => {
      configValues = {};
      service = await buildService();

      const saver = await service.getSaver();

      expect(saver).toBeInstanceOf(MemorySaver);
      expect(mockedFromUrl).not.toHaveBeenCalled();
    });

    it("returns a MemorySaver when redis host is empty", async () => {
      configValues = {
        redis: { host: "", port: 6379, password: "", username: "", queue: "default" },
      };
      service = await buildService();

      const saver = await service.getSaver();

      expect(saver).toBeInstanceOf(MemorySaver);
      expect(mockedFromUrl).not.toHaveBeenCalled();
    });

    it("caches the MemorySaver instance", async () => {
      configValues = {};
      service = await buildService();

      const first = await service.getSaver();
      const second = await service.getSaver();

      expect(second).toBe(first);
    });

    it("warns about the MemorySaver fallback", async () => {
      const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      configValues = {};
      service = await buildService();

      await service.getSaver();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("falling back to MemorySaver"));
      warnSpy.mockRestore();
    });
  });

  describe("when redis config is present", () => {
    beforeEach(() => {
      configValues = {
        redis: { host: "redis.local", port: 6380, password: "secret", username: "operator", queue: "default" },
      };
    });

    it("constructs a RedisSaver from the configured connection", async () => {
      service = await buildService();

      const saver = await service.getSaver();

      expect(saver).toBe(fakeRedisSaver);
      expect(mockedFromUrl).toHaveBeenCalledTimes(1);
      const [url] = mockedFromUrl.mock.calls[0];
      expect(url).toBe("redis://operator:secret@redis.local:6380");
    });

    it("percent-encodes reserved characters in credentials", async () => {
      configValues = {
        redis: { host: "redis.local", port: 6379, password: "p@ss:word", username: "user@corp", queue: "default" },
      };
      service = await buildService();

      await service.getSaver();

      const [url] = mockedFromUrl.mock.calls[0];
      expect(url).toBe("redis://user%40corp:p%40ss%3Aword@redis.local:6379");
    });

    it("brackets IPv6 hosts in the url", async () => {
      configValues = {
        redis: { host: "::1", port: 6379, password: "", username: "", queue: "default" },
      };
      service = await buildService();

      await service.getSaver();

      const [url] = mockedFromUrl.mock.calls[0];
      expect(url).toBe("redis://[::1]:6379");
    });

    it("omits credentials from the url when none are configured", async () => {
      configValues = {
        redis: { host: "redis.local", port: 6379, password: "", username: "", queue: "default" },
      };
      service = await buildService();

      await service.getSaver();

      const [url] = mockedFromUrl.mock.calls[0];
      expect(url).toBe("redis://redis.local:6379");
    });

    it("caches the saver instance across calls", async () => {
      service = await buildService();

      const first = await service.getSaver();
      const second = await service.getSaver();

      expect(second).toBe(first);
      expect(mockedFromUrl).toHaveBeenCalledTimes(1);
    });

    it("retries saver creation after a failed connection instead of caching the rejection", async () => {
      mockedFromUrl
        .mockRejectedValueOnce(new Error("redis down"))
        .mockResolvedValueOnce(fakeRedisSaver as unknown as RedisSaver);
      service = await buildService();

      await expect(service.getSaver()).rejects.toThrow("redis down");

      const saver = await service.getSaver();

      expect(saver).toBe(fakeRedisSaver);
      expect(mockedFromUrl).toHaveBeenCalledTimes(2);
    });

    it("computes the TTL as (approvalTtlDays + 1) days", async () => {
      configValues.operator = { approvalTtlDays: 3 };
      service = await buildService();

      await service.getSaver();

      const [, ttlConfig] = mockedFromUrl.mock.calls[0];
      // RedisSaver's defaultTTL option is expressed in minutes (the saver
      // multiplies by 60 internally).
      expect(ttlConfig?.defaultTTL).toBe((3 + 1) * 24 * 60);
    });

    it("defaults approvalTtlDays to 7 when operator config is absent", async () => {
      service = await buildService();

      await service.getSaver();

      const [, ttlConfig] = mockedFromUrl.mock.calls[0];
      expect(ttlConfig?.defaultTTL).toBe((7 + 1) * 24 * 60);
    });

    it("defaults approvalTtlDays to 7 when operator config has no approvalTtlDays", async () => {
      configValues.operator = {};
      service = await buildService();

      await service.getSaver();

      const [, ttlConfig] = mockedFromUrl.mock.calls[0];
      expect(ttlConfig?.defaultTTL).toBe((7 + 1) * 24 * 60);
    });
  });

  describe("capability probe", () => {
    beforeEach(() => {
      configValues = {
        redis: { host: "redis.local", port: 6380, password: "secret", username: "operator", queue: "default" },
      };
    });

    it("probes the configured server for JSON.SET and FT.CREATE before adopting RedisSaver", async () => {
      service = await buildService();

      const saver = await service.getSaver();

      expect(saver).toBe(fakeRedisSaver);
      expect(MockedRedis).toHaveBeenCalledTimes(1);
      expect(MockedRedis).toHaveBeenCalledWith(
        "redis://operator:secret@redis.local:6380",
        expect.objectContaining({ lazyConnect: true }),
      );
      expect(probeClient.call).toHaveBeenCalledWith("COMMAND", "INFO", "JSON.SET");
      expect(probeClient.call).toHaveBeenCalledWith("COMMAND", "INFO", "FT.CREATE");
    });

    it("attaches an error listener to the probe client before connecting", async () => {
      service = await buildService();

      await service.getSaver();

      expect(probeClient.on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(probeClient.on.mock.invocationCallOrder[0]).toBeLessThan(probeClient.connect.mock.invocationCallOrder[0]);
    });

    it("disconnects the probe client when the probe passes", async () => {
      service = await buildService();

      await service.getSaver();

      expect(probeClient.disconnect).toHaveBeenCalledTimes(1);
    });

    it("falls back to MemorySaver without calling fromUrl when JSON.SET is missing", async () => {
      const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      probeClient.call.mockImplementation(async (...args: unknown[]) =>
        args[2] === "JSON.SET" ? missingCommandReply() : supportedCommandReply(String(args[2])),
      );
      service = await buildService();

      const saver = await service.getSaver();

      expect(saver).toBeInstanceOf(MemorySaver);
      expect(mockedFromUrl).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("lacks the RedisJSON/RediSearch modules"));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("redis.local:6380"));
      expect(probeClient.disconnect).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });

    it("falls back to MemorySaver without calling fromUrl when FT.CREATE is missing", async () => {
      const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      probeClient.call.mockImplementation(async (...args: unknown[]) =>
        args[2] === "FT.CREATE" ? missingCommandReply() : supportedCommandReply(String(args[2])),
      );
      service = await buildService();

      const saver = await service.getSaver();

      expect(saver).toBeInstanceOf(MemorySaver);
      expect(mockedFromUrl).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("FT.CREATE"));
      expect(probeClient.disconnect).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });

    it("caches the MemorySaver fallback without re-probing", async () => {
      const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      probeClient.call.mockResolvedValue(missingCommandReply());
      service = await buildService();

      const first = await service.getSaver();
      const second = await service.getSaver();

      expect(second).toBe(first);
      expect(MockedRedis).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });

    it("propagates probe connection failures, disconnects the probe client and retries on the next call", async () => {
      probeClient.connect.mockRejectedValueOnce(new Error("connection refused"));
      service = await buildService();

      await expect(service.getSaver()).rejects.toThrow("connection refused");

      expect(mockedFromUrl).not.toHaveBeenCalled();
      expect(probeClient.disconnect).toHaveBeenCalledTimes(1);

      const saver = await service.getSaver();

      expect(saver).toBe(fakeRedisSaver);
      expect(MockedRedis).toHaveBeenCalledTimes(2);
      expect(probeClient.disconnect).toHaveBeenCalledTimes(2);
    });

    it("propagates probe command failures and disconnects the probe client", async () => {
      probeClient.call.mockRejectedValueOnce(new Error("connection reset"));
      service = await buildService();

      await expect(service.getSaver()).rejects.toThrow("connection reset");

      expect(mockedFromUrl).not.toHaveBeenCalled();
      expect(probeClient.disconnect).toHaveBeenCalledTimes(1);
    });

    it("does not construct a probe client when redis config is absent", async () => {
      configValues = {};
      service = await buildService();

      await service.getSaver();

      expect(MockedRedis).not.toHaveBeenCalled();
    });
  });

  describe("saver error handler", () => {
    beforeEach(() => {
      configValues = {
        redis: { host: "redis.local", port: 6380, password: "secret", username: "operator", queue: "default" },
      };
    });

    it("attaches a logging error handler to the RedisSaver internal client", async () => {
      const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      service = await buildService();

      await service.getSaver();

      expect(fakeRedisSaverClient.on).toHaveBeenCalledWith("error", expect.any(Function));

      const [, listener] = fakeRedisSaverClient.on.mock.calls[0];
      expect(() => listener(new Error("socket closed"))).not.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("socket closed"));
      errorSpy.mockRestore();
    });

    it("still adopts the saver and warns when the internal client is not reachable", async () => {
      const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const clientlessSaver = { __kind: "clientless", end: vi.fn().mockResolvedValue(undefined) };
      mockedFromUrl.mockResolvedValueOnce(clientlessSaver as unknown as RedisSaver);
      service = await buildService();

      const saver = await service.getSaver();

      expect(saver).toBe(clientlessSaver);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("could not attach an error handler"));
      warnSpy.mockRestore();
    });
  });

  describe("onModuleDestroy", () => {
    beforeEach(() => {
      configValues = {
        redis: { host: "redis.local", port: 6380, password: "secret", username: "operator", queue: "default" },
      };
    });

    it("closes the RedisSaver connection on shutdown", async () => {
      service = await buildService();
      await service.getSaver();

      await service.onModuleDestroy();

      expect(fakeRedisSaver.end).toHaveBeenCalledTimes(1);
    });

    it("does nothing when no saver was created", async () => {
      service = await buildService();

      await service.onModuleDestroy();

      expect(fakeRedisSaver.end).not.toHaveBeenCalled();
    });

    it("does not call end on a MemorySaver fallback", async () => {
      configValues = {};
      service = await buildService();
      await service.getSaver();

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(fakeRedisSaver.end).not.toHaveBeenCalled();
    });

    it("never throws when end rejects", async () => {
      fakeRedisSaver.end.mockRejectedValueOnce(new Error("socket already closed"));
      service = await buildService();
      await service.getSaver();

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
