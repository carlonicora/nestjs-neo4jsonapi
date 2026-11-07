import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";

const mockRedisInstance = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  getdel: vi.fn(),
  eval: vi.fn(),
  quit: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("ioredis", () => {
  class MockRedis {
    set = mockRedisInstance.set;
    get = mockRedisInstance.get;
    getdel = mockRedisInstance.getdel;
    eval = mockRedisInstance.eval;
    quit = mockRedisInstance.quit;
    disconnect = mockRedisInstance.disconnect;
  }
  return { Redis: MockRedis, default: MockRedis };
});

import { ConfigService } from "@nestjs/config";
import { DiscordConnectIntentStore, StoredDiscordConnectIntent } from "../discord-connect-intent.store";

describe("DiscordConnectIntentStore", () => {
  const QUEUE = "testqueue";
  const CODE = "0b6f8a52-3c0e-4d8e-9a77-6f0c2b1d4e11";
  const INTENT_KEY = `${QUEUE}:discord-connect:${CODE}`;
  const TOKEN = "5c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const CONFIRM_KEY = `${QUEUE}:discord-connect-confirm:${TOKEN}`;

  const STORED: StoredDiscordConnectIntent = {
    userId: "u-1",
    returnPath: "/settings",
    createdAt: "2026-11-07T10:00:00.000Z",
    browserKeyHash: "hash-1",
    launched: true,
    discord: { id: "d-1", username: "player", avatar: null },
  };

  let store: DiscordConnectIntentStore;

  beforeEach(() => {
    const configService = {
      get: vi.fn(() => ({ host: "localhost", port: 6379, username: "u", password: "p", queue: QUEUE })),
    } as unknown as Mocked<ConfigService>;
    store = new DiscordConnectIntentStore(configService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("writes the intent with SET EX 600 NX and returns true", async () => {
      mockRedisInstance.set.mockResolvedValue("OK");

      const created = await store.create({ code: CODE, userId: "u-1", returnPath: "/", browserKeyHash: "hash-1" });

      expect(created).toBe(true);
      expect(mockRedisInstance.set).toHaveBeenCalledTimes(1);
      const [key, value, ex, ttl, nx] = mockRedisInstance.set.mock.calls[0];
      expect(key).toBe(INTENT_KEY);
      expect(JSON.parse(value)).toMatchObject({ userId: "u-1", returnPath: "/", browserKeyHash: "hash-1" });
      expect([ex, ttl, nx]).toEqual(["EX", 600, "NX"]);
    });

    it("returns false when the key already exists", async () => {
      mockRedisInstance.set.mockResolvedValue(null);

      await expect(
        store.create({ code: CODE, userId: "u-1", returnPath: "/", browserKeyHash: "hash-1" }),
      ).resolves.toBe(false);
    });
  });

  describe("launch", () => {
    it("runs one eval on the intent key with the browser key hash and is true once", async () => {
      mockRedisInstance.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      await expect(store.launch({ code: CODE, browserKeyHash: "hash-1" })).resolves.toBe(true);
      await expect(store.launch({ code: CODE, browserKeyHash: "hash-1" })).resolves.toBe(false);

      expect(mockRedisInstance.eval).toHaveBeenCalledTimes(2);
      const [script, numKeys, key, hash] = mockRedisInstance.eval.mock.calls[0];
      expect(typeof script).toBe("string");
      expect(numKeys).toBe(1);
      expect(key).toBe(INTENT_KEY);
      expect(hash).toBe("hash-1");
    });

    it("is false when the intent is missing", async () => {
      mockRedisInstance.eval.mockResolvedValue(0);

      await expect(store.launch({ code: CODE, browserKeyHash: "hash-1" })).resolves.toBe(false);
      expect(mockRedisInstance.eval).toHaveBeenCalledTimes(1);
    });
  });

  describe("attachDiscord", () => {
    const discord = { id: "d-1", username: "player", avatar: null };

    it("runs one eval with the intent key, the confirmation key and a 120 s cap, true once", async () => {
      mockRedisInstance.eval.mockResolvedValueOnce(1);

      await expect(store.attachDiscord({ code: CODE, discord, confirmToken: TOKEN })).resolves.toBe(true);

      expect(mockRedisInstance.eval).toHaveBeenCalledTimes(1);
      const [script, numKeys, intentKey, confirmKey, discordJson, code, cap] = mockRedisInstance.eval.mock.calls[0];
      expect(script).toContain("math.min");
      expect(numKeys).toBe(2);
      expect(intentKey).toBe(INTENT_KEY);
      expect(confirmKey).toBe(CONFIRM_KEY);
      expect(JSON.parse(discordJson)).toEqual(discord);
      expect(code).toBe(CODE);
      expect(cap).toBe(120);
    });

    it("is false when the script reports an attached or missing intent", async () => {
      mockRedisInstance.eval.mockResolvedValue(0);

      await expect(store.attachDiscord({ code: CODE, discord, confirmToken: TOKEN })).resolves.toBe(false);
      expect(mockRedisInstance.eval).toHaveBeenCalledTimes(1);
    });
  });

  describe("consumeByConfirmToken", () => {
    it("runs one eval on the confirmation key and returns the parsed intent", async () => {
      mockRedisInstance.eval.mockResolvedValue(JSON.stringify(STORED));

      await expect(store.consumeByConfirmToken(TOKEN)).resolves.toEqual(STORED);

      expect(mockRedisInstance.eval).toHaveBeenCalledTimes(1);
      const [, numKeys, confirmKey, prefix] = mockRedisInstance.eval.mock.calls[0];
      expect(numKeys).toBe(1);
      expect(confirmKey).toBe(CONFIRM_KEY);
      expect(prefix).toBe(`${QUEUE}:discord-connect:`);
    });

    it("returns null for an unknown token", async () => {
      mockRedisInstance.eval.mockResolvedValue(null);

      await expect(store.consumeByConfirmToken(TOKEN)).resolves.toBeNull();
    });
  });

  describe("get", () => {
    it("reads the intent with GET", async () => {
      mockRedisInstance.get.mockResolvedValue(JSON.stringify(STORED));

      await expect(store.get(CODE)).resolves.toEqual(STORED);
      expect(mockRedisInstance.get).toHaveBeenCalledWith(INTENT_KEY);
    });

    it("returns null when missing", async () => {
      mockRedisInstance.get.mockResolvedValue(null);

      await expect(store.get(CODE)).resolves.toBeNull();
    });
  });

  describe("consume", () => {
    it("burns the intent with one GETDEL", async () => {
      mockRedisInstance.getdel.mockResolvedValue(JSON.stringify(STORED));

      await expect(store.consume(CODE)).resolves.toEqual(STORED);
      expect(mockRedisInstance.getdel).toHaveBeenCalledTimes(1);
      expect(mockRedisInstance.getdel).toHaveBeenCalledWith(INTENT_KEY);
    });

    it("a consumed code cannot be consumed again", async () => {
      mockRedisInstance.getdel.mockResolvedValueOnce(JSON.stringify(STORED)).mockResolvedValueOnce(null);

      await store.consume(CODE);
      await expect(store.consume(CODE)).resolves.toBeNull();
    });
  });
});
