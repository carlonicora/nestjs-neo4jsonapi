import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";

// The real AuthDiscordService pulls the whole auth chain; only connectCookie is used here.
vi.mock("../auth.discord.service", () => ({
  AuthDiscordService: class MockAuthDiscordService {
    connectCookie = vi.fn();
  },
}));

import { ConflictException, ForbiddenException, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { createHash } from "crypto";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { RedisLockService } from "../../../../core/redis/services/redis.lock.service";
import { DiscordUserRepository } from "../../../discord-user/repositories/discord-user.repository";
import { DiscordUserService } from "../../../discord-user/services/discord-user.service";
import { DISCORD_CONNECT_POLICY } from "../../interfaces/discord-connect-policy.interface";
import { AuthDiscordService } from "../auth.discord.service";
import { DiscordConnectIntentService } from "../discord-connect-intent.service";
import { DiscordConnectIntentStore, StoredDiscordConnectIntent } from "../discord-connect-intent.store";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("DiscordConnectIntentService", () => {
  const CODE = "0b6f8a52-3c0e-4d8e-9a77-6f0c2b1d4e11";
  const TOKEN = "5c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const QUEUE = "testqueue";

  let service: DiscordConnectIntentService;
  let store: Mocked<DiscordConnectIntentStore>;
  let cls: { userId?: string; companyId?: string };
  let clsService: Mocked<ClsService>;
  let configValues: Record<string, any>;
  let configService: Mocked<ConfigService>;
  let policy: { canConnect: ReturnType<typeof vi.fn> } | undefined;
  let moduleRef: Mocked<ModuleRef>;
  let discordUserRepository: Mocked<DiscordUserRepository>;
  let discordUserService: Mocked<DiscordUserService>;
  let redisLockService: Mocked<RedisLockService>;
  let jsonApiService: Mocked<JsonApiService>;
  let authDiscordService: Mocked<AuthDiscordService>;

  const attached = (overrides: Partial<StoredDiscordConnectIntent> = {}): StoredDiscordConnectIntent => ({
    userId: "u-1",
    returnPath: "/",
    createdAt: "2026-11-07T10:00:00.000Z",
    browserKeyHash: "hash",
    launched: true,
    discord: { id: "d-1", username: "player", avatar: "~https://cdn.discordapp.com/avatars/d-1/a.png" },
    ...overrides,
  });

  beforeEach(() => {
    cls = { userId: "u-1", companyId: "c-1" };
    clsService = {
      get: vi.fn((key: string) => (cls as any)[key]),
      has: vi.fn((key: string) => (cls as any)[key] !== undefined),
    } as unknown as Mocked<ClsService>;

    configValues = {
      api: { url: "http://api.test/" },
      app: { url: "http://app.test/" },
      discord: { clientId: "client", clientSecret: "secret" },
      redis: { queue: QUEUE },
    };
    configService = { get: vi.fn((key: string) => configValues[key]) } as unknown as Mocked<ConfigService>;

    policy = undefined;
    moduleRef = {
      get: vi.fn((token: unknown) => {
        if (token === DISCORD_CONNECT_POLICY && policy) return policy;
        throw new Error("no provider");
      }),
    } as unknown as Mocked<ModuleRef>;

    store = {
      create: vi.fn().mockResolvedValue(true),
      consumeByConfirmToken: vi.fn(),
    } as unknown as Mocked<DiscordConnectIntentStore>;

    discordUserRepository = {
      findByUserId: vi.fn().mockResolvedValue(undefined),
      findByDiscordId: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<DiscordUserRepository>;

    discordUserService = { link: vi.fn().mockResolvedValue("linked") } as unknown as Mocked<DiscordUserService>;

    redisLockService = {
      withLock: vi.fn((_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
    } as unknown as Mocked<RedisLockService>;

    jsonApiService = {
      buildSingle: vi.fn(async (model: any, record: any) => ({
        data: { type: model.type, id: record.id, attributes: record },
      })),
    } as unknown as Mocked<JsonApiService>;

    authDiscordService = {
      connectCookie: vi.fn(({ value }: { value: string }) => `discord_connect=${value}`),
    } as unknown as Mocked<AuthDiscordService>;

    service = new DiscordConnectIntentService(
      store,
      clsService,
      configService,
      moduleRef,
      discordUserRepository,
      discordUserService,
      redisLockService,
      jsonApiService,
      authDiscordService,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("create answers 403 with no company in CLS", async () => {
      cls.companyId = undefined;

      await expect(service.create({ id: CODE, returnPath: "/" })).rejects.toBeInstanceOf(ForbiddenException);
      expect(store.create).not.toHaveBeenCalled();
    });

    it("create answers 403 when the policy refuses", async () => {
      policy = { canConnect: vi.fn().mockResolvedValue(false) };

      await expect(service.create({ id: CODE, returnPath: "/" })).rejects.toBeInstanceOf(ForbiddenException);
      expect(policy.canConnect).toHaveBeenCalledWith({ userId: "u-1", companyId: "c-1" });
      expect(store.create).not.toHaveBeenCalled();
    });

    it("create without a policy hook allows", async () => {
      await expect(service.create({ id: CODE, returnPath: "/" })).resolves.toBeDefined();
      expect(store.create).toHaveBeenCalled();
    });

    it("create returns the launch route as authorizeUrl and stores only the key's sha256", async () => {
      const result = await service.create({ id: CODE, returnPath: "/" });

      expect(result.document.data.attributes.authorizeUrl).toBe(
        `http://api.test/discord-connect-intents/${CODE}/authorize`,
      );
      const { value, maxAge } = authDiscordService.connectCookie.mock.calls[0][0];
      expect(maxAge).toBe(600);
      expect(value.length).toBeGreaterThanOrEqual(43);
      expect(result.cookie).toBe(`discord_connect=${value}`);
      const stored = store.create.mock.calls[0][0];
      expect(stored.browserKeyHash).toBe(sha256(value));
      expect(JSON.stringify(stored)).not.toContain(value);
    });

    it("create answers 501 when Discord is not configured", async () => {
      configValues.discord = { clientId: "", clientSecret: "" };

      const error = await service.create({ id: CODE, returnPath: "/" }).catch((e) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
    });

    it("create answers 409 when the user already has Discord", async () => {
      discordUserRepository.findByUserId.mockResolvedValue({ id: "du-1" } as any);

      await expect(service.create({ id: CODE, returnPath: "/" })).rejects.toBeInstanceOf(ConflictException);
      expect(store.create).not.toHaveBeenCalled();
    });

    it("create answers 409 when the code already exists", async () => {
      store.create.mockResolvedValue(false);

      await expect(service.create({ id: CODE, returnPath: "/" })).rejects.toBeInstanceOf(ConflictException);
    });

    it("create stores the CLS user and the sanitised returnPath", async () => {
      const result = await service.create({ id: CODE, returnPath: "//evil.test" });

      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: CODE, userId: "u-1", returnPath: "/" }),
      );
      expect(result.document.data.attributes.returnPath).toBe("/");
    });

    it("create returns the intent", async () => {
      const result = await service.create({ id: CODE, returnPath: "/settings" });

      expect(result.document.data.type).toBe("discord-connect-intents");
      expect(result.document.data.id).toBe(CODE);
      expect(result.document.data.attributes.returnPath).toBe("/settings");
    });
  });

  describe("confirm", () => {
    const resultOf = (doc: any) => doc.data.attributes.result;

    it("confirm by another user returns failed and links nothing", async () => {
      store.consumeByConfirmToken.mockResolvedValue(attached({ userId: "u-2" }));

      const doc = await service.confirm({ confirmToken: TOKEN });

      expect(resultOf(doc)).toBe("failed");
      expect(discordUserService.link).not.toHaveBeenCalled();
      expect(store.consumeByConfirmToken).toHaveBeenCalledWith(TOKEN);
    });

    it("confirm with an unknown token returns failed", async () => {
      store.consumeByConfirmToken.mockResolvedValue(null);

      expect(resultOf(await service.confirm({ confirmToken: TOKEN }))).toBe("failed");
      expect(discordUserService.link).not.toHaveBeenCalled();
    });

    it("confirm without a Discord account attached returns failed", async () => {
      store.consumeByConfirmToken.mockResolvedValue(attached({ discord: undefined }));

      expect(resultOf(await service.confirm({ confirmToken: TOKEN }))).toBe("failed");
      expect(discordUserService.link).not.toHaveBeenCalled();
    });

    it("confirm returns failed while the Discord id lock is held", async () => {
      store.consumeByConfirmToken.mockResolvedValue(attached());
      redisLockService.withLock.mockResolvedValue(null);

      expect(resultOf(await service.confirm({ confirmToken: TOKEN }))).toBe("failed");
      expect(discordUserService.link).not.toHaveBeenCalled();
    });

    it("confirm runs the checks and the link inside withLock with key <queue>:discord-link:<discordId> and 30 s", async () => {
      store.consumeByConfirmToken.mockResolvedValue(attached());
      let insideLock = false;
      redisLockService.withLock.mockImplementation(async (_key, _ttl, fn) => {
        insideLock = true;
        try {
          return await fn();
        } finally {
          insideLock = false;
        }
      });
      const seen: boolean[] = [];
      discordUserRepository.findByDiscordId.mockImplementation(async () => {
        seen.push(insideLock);
        return undefined as any;
      });
      discordUserRepository.findByUserId.mockImplementation(async () => {
        seen.push(insideLock);
        return undefined;
      });
      discordUserService.link.mockImplementation(async () => {
        seen.push(insideLock);
        return "linked";
      });

      await service.confirm({ confirmToken: TOKEN });

      expect(redisLockService.withLock).toHaveBeenCalledWith(`${QUEUE}:discord-link:d-1`, 30, expect.any(Function));
      expect(seen).toEqual([true, true, true]);
    });

    it("confirm classifies a blocked link by re-checking", async () => {
      store.consumeByConfirmToken.mockResolvedValue(attached());
      discordUserService.link.mockResolvedValue("blocked");
      discordUserRepository.findByDiscordId
        .mockResolvedValueOnce(undefined as any)
        .mockResolvedValueOnce({ id: "du-9", user: { id: "u-9" } } as any);

      expect(resultOf(await service.confirm({ confirmToken: TOKEN }))).toBe("taken");
      expect(discordUserRepository.findByDiscordId).toHaveBeenCalledTimes(2);
    });

    it("a blocked link with both lookups empty returns failed", async () => {
      store.consumeByConfirmToken.mockResolvedValue(attached());
      discordUserService.link.mockResolvedValue("blocked");

      expect(resultOf(await service.confirm({ confirmToken: TOKEN }))).toBe("failed");
    });

    it("confirm returns taken when the Discord id belongs to another user", async () => {
      store.consumeByConfirmToken.mockResolvedValue(attached());
      discordUserRepository.findByDiscordId.mockResolvedValue({ id: "du-9", user: { id: "u-9" } } as any);

      expect(resultOf(await service.confirm({ confirmToken: TOKEN }))).toBe("taken");
      expect(discordUserService.link).not.toHaveBeenCalled();
    });

    it("confirm is idempotent connected for the same user", async () => {
      store.consumeByConfirmToken.mockResolvedValue(attached());
      discordUserRepository.findByDiscordId.mockResolvedValue({ id: "du-1", user: { id: "u-1" } } as any);

      const doc = await service.confirm({ confirmToken: TOKEN });

      expect(resultOf(doc)).toBe("connected");
      expect(doc.data.attributes.discordName).toBe("player");
      expect(discordUserService.link).not.toHaveBeenCalled();
    });

    it("confirm returns already when the user has another Discord", async () => {
      store.consumeByConfirmToken.mockResolvedValue(attached());
      discordUserRepository.findByUserId.mockResolvedValue({ id: "du-2", discordId: "d-2" } as any);

      const doc = await service.confirm({ confirmToken: TOKEN });

      expect(resultOf(doc)).toBe("already");
      expect(doc.data.attributes.discordName).toBeUndefined();
      expect(discordUserService.link).not.toHaveBeenCalled();
    });

    it("confirm links and returns connected with discordName", async () => {
      const intent = attached();
      store.consumeByConfirmToken.mockResolvedValue(intent);

      const doc = await service.confirm({ confirmToken: TOKEN });

      expect(discordUserService.link).toHaveBeenCalledWith({
        userId: "u-1",
        userDetails: { id: "d-1", username: "player", avatar: intent.discord!.avatar },
      });
      expect(doc.data.type).toBe("discord-connect-confirmations");
      expect(doc.data.id).toBe(TOKEN);
      expect(resultOf(doc)).toBe("connected");
      expect(doc.data.attributes.discordName).toBe("player");
    });

    it("a blocked link, then findByDiscordId returns another user → taken", async () => {
      store.consumeByConfirmToken.mockResolvedValue(attached());
      discordUserService.link.mockResolvedValue("blocked");
      discordUserRepository.findByDiscordId
        .mockResolvedValueOnce(undefined as any)
        .mockResolvedValueOnce({ id: "du-3", user: { id: "u-3" } } as any);

      const doc = await service.confirm({ confirmToken: TOKEN });

      expect(resultOf(doc)).toBe("taken");
      expect(doc.data.attributes.discordName).toBeUndefined();
    });
  });
});
