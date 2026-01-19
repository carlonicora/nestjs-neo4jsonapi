import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { PresenceService, PresenceStatus } from "../presence.service";
import { RedisClientStorageService } from "../../../redis/services/redis.client.storage.service";

describe("PresenceService", () => {
  let service: PresenceService;
  let redisService: vi.Mocked<RedisClientStorageService>;

  const mockRedisClient = {
    get: vi.fn(),
    setex: vi.fn(),
    keys: vi.fn(),
  };

  const TEST_IDS = {
    userId: "user-123",
    userId2: "user-456",
    socketId: "socket-789",
    socketId2: "socket-999",
  };

  const createMockRedisService = () => ({
    isConnected: vi.fn().mockReturnValue(true),
    getRedisClient: vi.fn().mockReturnValue(mockRedisClient),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockRedisServiceValue = createMockRedisService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresenceService,
        {
          provide: RedisClientStorageService,
          useValue: mockRedisServiceValue,
        },
      ],
    }).compile();

    service = module.get<PresenceService>(PresenceService);
    redisService = module.get(RedisClientStorageService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("setUserOnline", () => {
    it("should set user as online when Redis is connected", async () => {
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.setex.mockResolvedValue("OK");

      await service.setUserOnline(TEST_IDS.userId, "Test User", TEST_IDS.socketId);

      expect(mockRedisClient.get).toHaveBeenCalledWith(`presence:${TEST_IDS.userId}`);
      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        `presence:${TEST_IDS.userId}`,
        35 * 60, // PRESENCE_TTL
        expect.stringContaining('"status":"online"'),
      );

      const setexCall = mockRedisClient.setex.mock.calls[0];
      const savedData = JSON.parse(setexCall[2]);
      expect(savedData.socketIds).toContain(TEST_IDS.socketId);
      expect(savedData.userName).toBe("Test User");
    });

    it("should add socket to existing presence when user already has connections", async () => {
      const existingPresence: PresenceStatus = {
        status: "online",
        lastActivity: new Date(),
        socketIds: [TEST_IDS.socketId],
        userName: "Test User",
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(existingPresence));
      mockRedisClient.setex.mockResolvedValue("OK");

      await service.setUserOnline(TEST_IDS.userId, "Test User", TEST_IDS.socketId2);

      const setexCall = mockRedisClient.setex.mock.calls[0];
      const savedData = JSON.parse(setexCall[2]);
      expect(savedData.socketIds).toContain(TEST_IDS.socketId);
      expect(savedData.socketIds).toContain(TEST_IDS.socketId2);
      expect(savedData.socketIds.length).toBe(2);
    });

    it("should do nothing when Redis is not connected", async () => {
      redisService.isConnected.mockReturnValue(false);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await service.setUserOnline(TEST_IDS.userId, "Test User", TEST_IDS.socketId);

      expect(mockRedisClient.get).not.toHaveBeenCalled();
      expect(mockRedisClient.setex).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should handle Redis errors gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedisClient.get.mockRejectedValue(new Error("Redis error"));

      await service.setUserOnline(TEST_IDS.userId, "Test User", TEST_IDS.socketId);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Error setting user online"));
      consoleSpy.mockRestore();
    });
  });

  describe("setUserOffline", () => {
    it("should set user as offline when no other sockets remain", async () => {
      const existingPresence: PresenceStatus = {
        status: "online",
        lastActivity: new Date(),
        socketIds: [TEST_IDS.socketId],
        userName: "Test User",
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(existingPresence));
      mockRedisClient.setex.mockResolvedValue("OK");

      await service.setUserOffline(TEST_IDS.userId, TEST_IDS.socketId);

      const setexCall = mockRedisClient.setex.mock.calls[0];
      const savedData = JSON.parse(setexCall[2]);
      expect(savedData.status).toBe("offline");
      expect(savedData.socketIds.length).toBe(0);
    });

    it("should keep user online when other sockets remain", async () => {
      const existingPresence: PresenceStatus = {
        status: "online",
        lastActivity: new Date(),
        socketIds: [TEST_IDS.socketId, TEST_IDS.socketId2],
        userName: "Test User",
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(existingPresence));
      mockRedisClient.setex.mockResolvedValue("OK");

      await service.setUserOffline(TEST_IDS.userId, TEST_IDS.socketId);

      const setexCall = mockRedisClient.setex.mock.calls[0];
      const savedData = JSON.parse(setexCall[2]);
      expect(savedData.socketIds).toContain(TEST_IDS.socketId2);
      expect(savedData.socketIds).not.toContain(TEST_IDS.socketId);
    });

    it("should do nothing when presence data does not exist", async () => {
      mockRedisClient.get.mockResolvedValue(null);

      await service.setUserOffline(TEST_IDS.userId, TEST_IDS.socketId);

      expect(mockRedisClient.setex).not.toHaveBeenCalled();
    });

    it("should do nothing when Redis is not connected", async () => {
      redisService.isConnected.mockReturnValue(false);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await service.setUserOffline(TEST_IDS.userId, TEST_IDS.socketId);

      expect(mockRedisClient.get).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should handle Redis errors gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedisClient.get.mockRejectedValue(new Error("Redis error"));

      await service.setUserOffline(TEST_IDS.userId, TEST_IDS.socketId);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Error setting user offline"));
      consoleSpy.mockRestore();
    });
  });

  describe("updateActivity", () => {
    it("should update activity timestamp and set status to online", async () => {
      const existingPresence: PresenceStatus = {
        status: "away",
        lastActivity: new Date(Date.now() - 300000), // 5 minutes ago
        socketIds: [TEST_IDS.socketId],
        userName: "Test User",
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(existingPresence));
      mockRedisClient.setex.mockResolvedValue("OK");

      await service.updateActivity(TEST_IDS.userId);

      const setexCall = mockRedisClient.setex.mock.calls[0];
      const savedData = JSON.parse(setexCall[2]);
      expect(savedData.status).toBe("online");
    });

    it("should do nothing when presence data does not exist", async () => {
      mockRedisClient.get.mockResolvedValue(null);

      await service.updateActivity(TEST_IDS.userId);

      expect(mockRedisClient.setex).not.toHaveBeenCalled();
    });

    it("should do nothing when Redis is not connected", async () => {
      redisService.isConnected.mockReturnValue(false);

      await service.updateActivity(TEST_IDS.userId);

      expect(mockRedisClient.get).not.toHaveBeenCalled();
    });

    it("should handle Redis errors gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedisClient.get.mockRejectedValue(new Error("Redis error"));

      await service.updateActivity(TEST_IDS.userId);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("getUserStatus", () => {
    it("should return online status when activity is recent", async () => {
      const existingPresence: PresenceStatus = {
        status: "online",
        lastActivity: new Date(), // Just now
        socketIds: [TEST_IDS.socketId],
        userName: "Test User",
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(existingPresence));

      const result = await service.getUserStatus(TEST_IDS.userId);

      expect(result.status).toBe("online");
      expect(result.userName).toBe("Test User");
      expect(result.socketIds).toContain(TEST_IDS.socketId);
    });

    it("should return away status when activity is between 2 and 30 minutes old", async () => {
      const existingPresence: PresenceStatus = {
        status: "online",
        lastActivity: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
        socketIds: [TEST_IDS.socketId],
        userName: "Test User",
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(existingPresence));

      const result = await service.getUserStatus(TEST_IDS.userId);

      expect(result.status).toBe("away");
    });

    it("should return offline status when activity is older than 30 minutes", async () => {
      const existingPresence: PresenceStatus = {
        status: "online",
        lastActivity: new Date(Date.now() - 35 * 60 * 1000), // 35 minutes ago
        socketIds: [TEST_IDS.socketId],
        userName: "Test User",
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(existingPresence));

      const result = await service.getUserStatus(TEST_IDS.userId);

      expect(result.status).toBe("offline");
    });

    it("should return offline status when no sockets are connected", async () => {
      const existingPresence: PresenceStatus = {
        status: "online",
        lastActivity: new Date(),
        socketIds: [],
        userName: "Test User",
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(existingPresence));

      const result = await service.getUserStatus(TEST_IDS.userId);

      expect(result.status).toBe("offline");
    });

    it("should return default offline status when no presence data exists", async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await service.getUserStatus(TEST_IDS.userId);

      expect(result.status).toBe("offline");
      expect(result.socketIds).toEqual([]);
      expect(result.userName).toBe("");
    });

    it("should return default offline status when Redis is not connected", async () => {
      redisService.isConnected.mockReturnValue(false);

      const result = await service.getUserStatus(TEST_IDS.userId);

      expect(result.status).toBe("offline");
      expect(result.socketIds).toEqual([]);
      expect(result.userName).toBe("");
    });

    it("should handle Redis errors and return default offline status", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedisClient.get.mockRejectedValue(new Error("Redis error"));

      const result = await service.getUserStatus(TEST_IDS.userId);

      expect(result.status).toBe("offline");
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Error getting user status"));
      consoleSpy.mockRestore();
    });
  });

  describe("getUsersStatuses", () => {
    it("should return statuses for multiple users", async () => {
      const presence1: PresenceStatus = {
        status: "online",
        lastActivity: new Date(),
        socketIds: [TEST_IDS.socketId],
        userName: "User 1",
      };
      const presence2: PresenceStatus = {
        status: "away",
        lastActivity: new Date(Date.now() - 5 * 60 * 1000),
        socketIds: [TEST_IDS.socketId2],
        userName: "User 2",
      };

      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify(presence1))
        .mockResolvedValueOnce(JSON.stringify(presence2));

      const result = await service.getUsersStatuses([TEST_IDS.userId, TEST_IDS.userId2]);

      expect(result.size).toBe(2);
      expect(result.get(TEST_IDS.userId)?.status).toBe("online");
      expect(result.get(TEST_IDS.userId2)?.status).toBe("away");
    });

    it("should return empty map for empty user list", async () => {
      const result = await service.getUsersStatuses([]);

      expect(result.size).toBe(0);
    });
  });

  describe("markIdleUsersAsAway", () => {
    it("should mark users as away when idle for 2-30 minutes", async () => {
      const idlePresence: PresenceStatus = {
        status: "online", // Currently online
        lastActivity: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago (idle)
        socketIds: [TEST_IDS.socketId],
        userName: "Test User",
      };

      mockRedisClient.keys.mockResolvedValue([`presence:${TEST_IDS.userId}`]);
      mockRedisClient.get.mockResolvedValue(JSON.stringify(idlePresence));
      mockRedisClient.setex.mockResolvedValue("OK");

      const changedUsers = await service.markIdleUsersAsAway();

      expect(changedUsers).toContain(TEST_IDS.userId);
      const setexCall = mockRedisClient.setex.mock.calls[0];
      const savedData = JSON.parse(setexCall[2]);
      expect(savedData.status).toBe("away");
    });

    it("should mark users as offline when idle for more than 30 minutes", async () => {
      const veryIdlePresence: PresenceStatus = {
        status: "online",
        lastActivity: new Date(Date.now() - 35 * 60 * 1000), // 35 minutes ago
        socketIds: [TEST_IDS.socketId],
        userName: "Test User",
      };

      mockRedisClient.keys.mockResolvedValue([`presence:${TEST_IDS.userId}`]);
      mockRedisClient.get.mockResolvedValue(JSON.stringify(veryIdlePresence));
      mockRedisClient.setex.mockResolvedValue("OK");

      const changedUsers = await service.markIdleUsersAsAway();

      expect(changedUsers).toContain(TEST_IDS.userId);
      const setexCall = mockRedisClient.setex.mock.calls[0];
      const savedData = JSON.parse(setexCall[2]);
      expect(savedData.status).toBe("offline");
      expect(savedData.socketIds).toEqual([]);
    });

    it("should not change status for already away users", async () => {
      const alreadyAwayPresence: PresenceStatus = {
        status: "away",
        lastActivity: new Date(Date.now() - 5 * 60 * 1000),
        socketIds: [TEST_IDS.socketId],
        userName: "Test User",
      };

      mockRedisClient.keys.mockResolvedValue([`presence:${TEST_IDS.userId}`]);
      mockRedisClient.get.mockResolvedValue(JSON.stringify(alreadyAwayPresence));
      mockRedisClient.setex.mockResolvedValue("OK");

      const changedUsers = await service.markIdleUsersAsAway();

      expect(changedUsers).not.toContain(TEST_IDS.userId);
    });

    it("should skip users with no sockets", async () => {
      const noSocketPresence: PresenceStatus = {
        status: "online",
        lastActivity: new Date(Date.now() - 5 * 60 * 1000),
        socketIds: [],
        userName: "Test User",
      };

      mockRedisClient.keys.mockResolvedValue([`presence:${TEST_IDS.userId}`]);
      mockRedisClient.get.mockResolvedValue(JSON.stringify(noSocketPresence));

      const changedUsers = await service.markIdleUsersAsAway();

      expect(changedUsers).toEqual([]);
      expect(mockRedisClient.setex).not.toHaveBeenCalled();
    });

    it("should return empty array when Redis is not connected", async () => {
      redisService.isConnected.mockReturnValue(false);

      const result = await service.markIdleUsersAsAway();

      expect(result).toEqual([]);
    });

    it("should handle Redis errors gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedisClient.keys.mockRejectedValue(new Error("Redis error"));

      const result = await service.markIdleUsersAsAway();

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Error marking idle users"));
      consoleSpy.mockRestore();
    });

    it("should continue processing other keys when one fails", async () => {
      const validPresence: PresenceStatus = {
        status: "online",
        lastActivity: new Date(Date.now() - 5 * 60 * 1000),
        socketIds: [TEST_IDS.socketId],
        userName: "Test User",
      };

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedisClient.keys.mockResolvedValue([`presence:${TEST_IDS.userId}`, `presence:${TEST_IDS.userId2}`]);
      mockRedisClient.get
        .mockRejectedValueOnce(new Error("Redis error for user 1"))
        .mockResolvedValueOnce(JSON.stringify(validPresence));
      mockRedisClient.setex.mockResolvedValue("OK");

      const changedUsers = await service.markIdleUsersAsAway();

      // Should process second user even though first failed
      expect(changedUsers).toContain(TEST_IDS.userId2);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Error processing presence key"));
      consoleSpy.mockRestore();
    });
  });

  describe("when RedisClientStorageService is undefined", () => {
    let serviceWithoutRedis: PresenceService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [PresenceService],
      }).compile();

      serviceWithoutRedis = module.get<PresenceService>(PresenceService);
    });

    it("setUserOnline should do nothing", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await serviceWithoutRedis.setUserOnline(TEST_IDS.userId, "Test User", TEST_IDS.socketId);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Redis not connected"));
      consoleSpy.mockRestore();
    });

    it("setUserOffline should do nothing", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await serviceWithoutRedis.setUserOffline(TEST_IDS.userId, TEST_IDS.socketId);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Redis not connected"));
      consoleSpy.mockRestore();
    });

    it("updateActivity should do nothing", async () => {
      await serviceWithoutRedis.updateActivity(TEST_IDS.userId);
      // No errors should be thrown
    });

    it("getUserStatus should return default offline status", async () => {
      const result = await serviceWithoutRedis.getUserStatus(TEST_IDS.userId);

      expect(result.status).toBe("offline");
      expect(result.socketIds).toEqual([]);
    });

    it("markIdleUsersAsAway should return empty array", async () => {
      const result = await serviceWithoutRedis.markIdleUsersAsAway();

      expect(result).toEqual([]);
    });
  });
});
