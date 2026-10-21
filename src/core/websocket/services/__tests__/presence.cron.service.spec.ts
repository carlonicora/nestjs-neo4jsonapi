import { vi, describe, it, expect, beforeEach, type Mocked } from "vitest";
import { PresenceCronService } from "../presence.cron.service";
import { PresenceService } from "../presence.service";
import { WebSocketService } from "../websocket.service";
import { RedisClientStorageService } from "../../../redis/services/redis.client.storage.service";
import { AppLoggingService } from "../../../logging/services/logging.service";

describe("PresenceCronService", () => {
  let cron: PresenceCronService;
  let presenceService: Mocked<Pick<PresenceService, "markIdleUsersAsAway" | "getUserStatus">>;
  let webSocketService: Mocked<Pick<WebSocketService, "broadcast" | "sendPresenceToCompany">>;
  let redisClientStorage: Mocked<Pick<RedisClientStorageService, "getUserCompany" | "cleanupExpiredClients">>;
  let logger: Mocked<Pick<AppLoggingService, "log" | "error">>;

  const lastActivity = new Date("2026-10-21T10:00:00.000Z");

  beforeEach(() => {
    presenceService = {
      markIdleUsersAsAway: vi.fn(),
      getUserStatus: vi.fn().mockResolvedValue({ status: "away", lastActivity, socketIds: ["s1"], userName: "U" }),
    };
    webSocketService = {
      broadcast: vi.fn().mockResolvedValue(undefined),
      sendPresenceToCompany: vi.fn().mockResolvedValue(undefined),
    };
    redisClientStorage = {
      getUserCompany: vi.fn(),
      cleanupExpiredClients: vi.fn().mockResolvedValue(undefined),
    };
    logger = { log: vi.fn(), error: vi.fn() };

    cron = new PresenceCronService(
      presenceService as unknown as PresenceService,
      webSocketService as unknown as WebSocketService,
      redisClientStorage as unknown as RedisClientStorageService,
      logger as unknown as AppLoggingService,
    );
  });

  it("sends each idle user's presence to that user's company, never as a global broadcast", async () => {
    presenceService.markIdleUsersAsAway.mockResolvedValue(["user-a", "user-b"]);
    redisClientStorage.getUserCompany.mockImplementation(async (userId: string) =>
      userId === "user-a" ? "company-1" : "company-2",
    );

    await cron.markIdleUsers();

    expect(webSocketService.sendPresenceToCompany).toHaveBeenCalledWith("company-1", {
      userId: "user-a",
      status: "away",
      lastSeen: lastActivity,
    });
    expect(webSocketService.sendPresenceToCompany).toHaveBeenCalledWith("company-2", {
      userId: "user-b",
      status: "away",
      lastSeen: lastActivity,
    });
    expect(webSocketService.broadcast).not.toHaveBeenCalled();
  });

  it("passes a missing company through, so WebSocketService sends nothing", async () => {
    presenceService.markIdleUsersAsAway.mockResolvedValue(["user-a"]);
    redisClientStorage.getUserCompany.mockResolvedValue(null);

    await cron.markIdleUsers();

    expect(webSocketService.sendPresenceToCompany).toHaveBeenCalledWith(null, expect.anything());
    expect(webSocketService.broadcast).not.toHaveBeenCalled();
  });

  it("sends nothing when no user changed status", async () => {
    presenceService.markIdleUsersAsAway.mockResolvedValue([]);

    await cron.markIdleUsers();

    expect(webSocketService.sendPresenceToCompany).not.toHaveBeenCalled();
    expect(webSocketService.broadcast).not.toHaveBeenCalled();
  });
});
