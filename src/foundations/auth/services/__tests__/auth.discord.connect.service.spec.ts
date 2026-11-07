import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";

// Same mocks as auth.discord.service.spec.ts: the real files pull the whole auth / waitlist chain.
vi.mock("../auth.service", () => ({
  AuthService: class MockAuthService {
    createToken = vi.fn();
    createCode = vi.fn();
  },
}));
vi.mock("../../../waitlist/services/waitlist.service", () => ({
  WaitlistService: class MockWaitlistService {
    validateInviteCode = vi.fn();
  },
}));

import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { createHash } from "crypto";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { RedisLockService } from "../../../../core/redis/services/redis.lock.service";
import { DiscordUserRepository } from "../../../discord-user/repositories/discord-user.repository";
import { DiscordUserService } from "../../../discord-user/services/discord-user.service";
import { UserRepository } from "../../../user/repositories/user.repository";
import { AuthDiscordService } from "../auth.discord.service";
import { AuthService } from "../auth.service";
import { DiscordConnectIntentService } from "../discord-connect-intent.service";
import { DiscordConnectIntentStore, StoredDiscordConnectIntent } from "../discord-connect-intent.store";
import { PendingRegistrationService } from "../pending-registration.service";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("AuthDiscordService — connect", () => {
  const CODE = "0b6f8a52-3c0e-4d8e-9a77-6f0c2b1d4e11";
  const BROWSER_KEY = "browser-key-value";

  let configValues: Record<string, any>;
  let configService: Mocked<ConfigService>;
  let store: Mocked<DiscordConnectIntentStore>;
  let userRepository: Mocked<UserRepository>;
  let discordUserRepository: Mocked<DiscordUserRepository>;
  let discordUserService: Mocked<DiscordUserService>;
  let authService: { createToken: ReturnType<typeof vi.fn>; createCode: ReturnType<typeof vi.fn> };
  let service: AuthDiscordService;

  const launchedIntent = (overrides: Partial<StoredDiscordConnectIntent> = {}): StoredDiscordConnectIntent => ({
    userId: "u-1",
    returnPath: "/settings",
    createdAt: "2026-11-07T10:00:00.000Z",
    browserKeyHash: sha256(BROWSER_KEY),
    launched: true,
    ...overrides,
  });

  beforeEach(() => {
    configValues = {
      api: { url: "http://api.test/" },
      app: { url: "http://app.test/" },
      discord: { clientId: "client-id", clientSecret: "client-secret" },
      auth: { allowRegistration: true },
      redis: { queue: "q" },
    };
    configService = { get: vi.fn((key: string) => configValues[key]) } as unknown as Mocked<ConfigService>;

    store = {
      create: vi.fn().mockResolvedValue(true),
      launch: vi.fn().mockResolvedValue(true),
      get: vi.fn(),
      attachDiscord: vi.fn().mockResolvedValue(true),
      consumeByConfirmToken: vi.fn(),
      consume: vi.fn().mockResolvedValue(null),
    } as unknown as Mocked<DiscordConnectIntentStore>;

    userRepository = { updateAvatar: vi.fn() } as unknown as Mocked<UserRepository>;
    discordUserRepository = {
      findByDiscordId: vi.fn(),
      findByUserId: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<DiscordUserRepository>;
    discordUserService = { link: vi.fn() } as unknown as Mocked<DiscordUserService>;
    authService = {
      createToken: vi.fn().mockResolvedValue({ data: { attributes: { refreshToken: "refresh" } } }),
      createCode: vi.fn(),
    };

    service = new AuthDiscordService(
      userRepository,
      discordUserRepository,
      discordUserService,
      authService as unknown as AuthService,
      configService,
      { get: vi.fn() } as unknown as ClsService,
      {} as PendingRegistrationService,
      { get: vi.fn() } as unknown as ModuleRef,
      store,
      undefined,
    );

    vi.spyOn(service, "exchangeCodeForToken").mockResolvedValue("access-token");
    vi.spyOn(service, "fetchUserDetails").mockResolvedValue({
      id: "d-1",
      username: "player",
      email: "p@example.com",
      avatar: "~https://cdn.discordapp.com/avatars/d-1/a.png",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("state", () => {
    it("parseStateData returns connect", () => {
      const state = Buffer.from(JSON.stringify({ nonce: "n", connect: "c" })).toString("base64url");

      expect(service.parseStateData(state)?.connect).toBe("c");
    });

    it("generateConnectUrl state carries only nonce and connect", () => {
      const url = new URL(service.generateConnectUrl({ code: CODE }));
      const state = JSON.parse(Buffer.from(url.searchParams.get("state")!, "base64url").toString());

      expect(Object.keys(state)).toEqual(["nonce", "connect"]);
      expect(state.connect).toBe(CODE);
      expect(url.searchParams.get("redirect_uri")!.endsWith("auth/callback/discord")).toBe(true);
      expect(url.searchParams.get("scope")).toBe("identify email");
      expect(url.searchParams.get("client_id")).toBe("client-id");
    });
  });

  describe("cookie", () => {
    const createIntentService = () =>
      new DiscordConnectIntentService(
        store,
        {
          get: vi.fn((key: string) => ({ userId: "u-1", companyId: "c-1" })[key]),
        } as unknown as ClsService,
        configService,
        {
          get: vi.fn(() => {
            throw new Error("none");
          }),
        } as unknown as ModuleRef,
        discordUserRepository,
        discordUserService,
        {} as RedisLockService,
        { buildSingle: vi.fn(async () => ({ data: {} })) } as unknown as JsonApiService,
        service,
      );

    it("create sets the cookie", async () => {
      const { cookie } = await createIntentService().create({ id: CODE, returnPath: "/" });

      const match = /^discord_connect=([^;]+); HttpOnly; SameSite=Lax; Path=\/; Max-Age=600$/.exec(cookie);
      expect(match).not.toBeNull();
      expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ browserKeyHash: sha256(match![1]) }));
    });

    it("create adds Secure for an https api.url", async () => {
      configValues.api = { url: "https://api.test/" };

      const { cookie } = await createIntentService().create({ id: CODE, returnPath: "/" });

      expect(cookie).toMatch(/; Secure$/);
    });

    it("the cookie path follows an api.url with a sub-path", () => {
      configValues.api = { url: "https://x.test/api/" };

      expect(service.connectCookie({ value: "v", maxAge: 600 })).toContain("; Path=/api/;");
    });
  });

  describe("launchConnect", () => {
    it("launchConnect with the right cookie redirects to Discord once", async () => {
      const url = await service.launchConnect({ code: CODE, browserKey: BROWSER_KEY });

      expect(store.launch).toHaveBeenCalledTimes(1);
      expect(store.launch).toHaveBeenCalledWith({ code: CODE, browserKeyHash: sha256(BROWSER_KEY) });
      expect(url.startsWith("https://discord.com/api/oauth2/authorize?")).toBe(true);
    });

    it("launch without the cookie returns failed and keeps the intent", async () => {
      store.launch.mockResolvedValue(false);

      await expect(service.launchConnect({ code: CODE })).resolves.toBe("http://app.test/?discordConnect=failed");
      expect(store.consume).not.toHaveBeenCalled();
    });

    it("launch with a wrong cookie returns failed and keeps the intent", async () => {
      store.launch.mockResolvedValue(false);

      await expect(service.launchConnect({ code: CODE, browserKey: "wrong" })).resolves.toBe(
        "http://app.test/?discordConnect=failed",
      );
      expect(store.launch).toHaveBeenCalledWith({ code: CODE, browserKeyHash: sha256("wrong") });
      expect(store.consume).not.toHaveBeenCalled();
    });

    it("a second launch returns failed and keeps the intent", async () => {
      store.launch.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await service.launchConnect({ code: CODE, browserKey: BROWSER_KEY });
      await expect(service.launchConnect({ code: CODE, browserKey: BROWSER_KEY })).resolves.toContain(
        "discordConnect=failed",
      );
      expect(store.consume).not.toHaveBeenCalled();
    });
  });

  describe("handleDiscordConnectCallback", () => {
    it("callback without the cookie burns the intent and returns failed without contacting Discord", async () => {
      store.get.mockResolvedValue(launchedIntent());

      const url = await service.handleDiscordConnectCallback({ code: CODE, discordCode: "dc" });

      expect(url).toBe("http://app.test/settings?discordConnect=failed");
      expect(store.consume).toHaveBeenCalledWith(CODE);
      expect(service.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it("callback with a wrong cookie burns and fails", async () => {
      store.get.mockResolvedValue(launchedIntent());

      const url = await service.handleDiscordConnectCallback({ code: CODE, discordCode: "dc", browserKey: "wrong" });

      expect(url).toContain("discordConnect=failed");
      expect(store.consume).toHaveBeenCalledWith(CODE);
      expect(service.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it("callback on an intent never launched burns and fails", async () => {
      store.get.mockResolvedValue(launchedIntent({ launched: undefined }));

      const url = await service.handleDiscordConnectCallback({
        code: CODE,
        discordCode: "dc",
        browserKey: BROWSER_KEY,
      });

      expect(url).toContain("discordConnect=failed");
      expect(store.consume).toHaveBeenCalledWith(CODE);
      expect(service.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it("the callback always clears the cookie", () => {
      expect(service.connectCookie({ value: "", maxAge: 0 })).toBe(
        "discord_connect=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      );
    });

    it("callback with an unknown intent returns failed without exchanging the Discord code", async () => {
      store.get.mockResolvedValue(null);

      const url = await service.handleDiscordConnectCallback({
        code: CODE,
        discordCode: "dc",
        browserKey: BROWSER_KEY,
      });

      expect(url).toBe("http://app.test/?discordConnect=failed");
      expect(service.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it("callback maps an exchange error to failed", async () => {
      store.get.mockResolvedValue(launchedIntent());
      vi.mocked(service.exchangeCodeForToken).mockRejectedValue(new Error("bad code"));

      const url = await service.handleDiscordConnectCallback({
        code: CODE,
        discordCode: "dc",
        browserKey: BROWSER_KEY,
      });

      expect(store.consume).toHaveBeenCalledWith(CODE);
      expect(url).toBe("http://app.test/settings?discordConnect=failed");
    });

    it("callback stores the Discord account and redirects pending", async () => {
      store.get.mockResolvedValue(launchedIntent({ returnPath: "/settings?section=profile" }));

      const url = await service.handleDiscordConnectCallback({
        code: CODE,
        discordCode: "dc",
        browserKey: BROWSER_KEY,
      });

      expect(store.attachDiscord).toHaveBeenCalledTimes(1);
      const call = store.attachDiscord.mock.calls[0][0];
      expect(call.code).toBe(CODE);
      expect(call.discord).toEqual({
        id: "d-1",
        username: "player",
        avatar: "~https://cdn.discordapp.com/avatars/d-1/a.png",
      });
      expect(call.confirmToken).toMatch(UUID);
      expect(url).toBe(
        `http://app.test/settings?section=profile&discordConnect=pending&discordConnectConfirm=${call.confirmToken}`,
      );
      expect(url.replace("http://", "")).not.toContain("//");
      expect(discordUserService.link).not.toHaveBeenCalled();
      expect(store.consume).not.toHaveBeenCalled();
    });

    it("callback redirect carries the confirmation token and not the intent id", async () => {
      store.get.mockResolvedValue(launchedIntent({ returnPath: "/" }));

      const url = await service.handleDiscordConnectCallback({
        code: CODE,
        discordCode: "dc",
        browserKey: BROWSER_KEY,
      });

      expect(url).toContain("discordConnect=pending");
      expect(url).not.toContain(CODE);
    });

    it("a second callback on the same intent returns failed and burns it", async () => {
      store.get.mockResolvedValue(launchedIntent());
      store.attachDiscord.mockResolvedValue(false);

      const url = await service.handleDiscordConnectCallback({
        code: CODE,
        discordCode: "dc",
        browserKey: BROWSER_KEY,
      });

      expect(store.consume).toHaveBeenCalledWith(CODE);
      expect(url).toContain("discordConnect=failed");
      expect(url).not.toContain("discordConnectConfirm");
    });
  });

  describe("handleDiscordLogin picture rule", () => {
    const loginWith = async (currentAvatar: string | null, discordAvatar: string | null) => {
      discordUserRepository.findByDiscordId.mockResolvedValue({
        id: "du-1",
        discordId: "d-1",
        user: { id: "u-1", avatar: currentAvatar },
      } as any);
      await service.handleDiscordLogin({
        userDetails: { id: "d-1", username: "player", email: "p@example.com", avatar: discordAvatar },
      });
    };

    it("handleDiscordLogin keeps an uploaded avatar", async () => {
      await loginWith("users/u-1/a.png", "~https://cdn.discordapp.com/avatars/d-1/new.png");

      expect(userRepository.updateAvatar).not.toHaveBeenCalled();
    });

    it("handleDiscordLogin replaces a Discord avatar", async () => {
      await loginWith(
        "~https://cdn.discordapp.com/avatars/d-1/old.png",
        "~https://cdn.discordapp.com/avatars/d-1/new.png",
      );

      expect(userRepository.updateAvatar).toHaveBeenCalledWith({
        userId: "u-1",
        avatar: "~https://cdn.discordapp.com/avatars/d-1/new.png",
      });
    });

    it("handleDiscordLogin clears a Discord avatar when the Discord account has none", async () => {
      await loginWith("~https://cdn.discordapp.com/avatars/d-1/old.png", null);

      expect(userRepository.updateAvatar).toHaveBeenCalledWith({ userId: "u-1", avatar: null });
    });
  });
});
