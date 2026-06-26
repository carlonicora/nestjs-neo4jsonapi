import { Injectable, Optional } from "@nestjs/common";
import { AppLoggingService } from "../../logging/services/logging.service";
import { RedisClientStorageService } from "../../redis/services/redis.client.storage.service";

export interface PresenceStatus {
  status: "online" | "away" | "offline";
  lastActivity: Date;
  socketIds: string[];
  userName: string;
}

/**
 * Presence Service
 *
 * Tracks user online/offline/away status using Redis
 *
 * Features:
 * - Real-time presence tracking
 * - Multi-device support (tracks multiple socket connections)
 * - Automatic status calculation (online/away/offline)
 * - TTL-based expiration
 * - Batch status queries
 */
@Injectable()
export class PresenceService {
  private readonly PRESENCE_KEY_PREFIX = "presence:";
  private readonly PRESENCE_TTL = 35 * 60; // 35 minutes in seconds
  private readonly ONLINE_THRESHOLD = 2 * 60 * 1000; // 2 minutes in milliseconds
  private readonly AWAY_THRESHOLD = 30 * 60 * 1000; // 30 minutes in milliseconds

  constructor(
    private readonly logger: AppLoggingService,
    @Optional() private readonly redisClientStorage?: RedisClientStorageService,
  ) {}

  /**
   * Set user as online when they connect
   */
  async setUserOnline(userId: string, userName: string, socketId: string): Promise<void> {
    if (!this.redisClientStorage?.isConnected?.()) {
      this.logger.error(
        `Redis not connected - skipping setUserOnline for user ${userId}`,
        undefined,
        "PresenceService",
      );
      return;
    }

    try {
      const key = this.getPresenceKey(userId);
      const redis = this.redisClientStorage.getRedisClient();

      const existingData = await redis.get(key);
      const existingPresence: PresenceStatus | null = existingData ? JSON.parse(existingData) : null;

      const presence: PresenceStatus = {
        status: "online",
        lastActivity: new Date(),
        socketIds: existingPresence ? [...existingPresence.socketIds, socketId] : [socketId],
        userName,
      };

      await redis.setex(key, this.PRESENCE_TTL, JSON.stringify(presence));
    } catch (error) {
      this.logger.error(`Error setting user online for ${userId}`, error as Error, "PresenceService");
    }
  }

  /**
   * Set user as offline when they disconnect
   * Only sets to offline if no other sockets are connected
   */
  async setUserOffline(userId: string, socketId: string): Promise<void> {
    if (!this.redisClientStorage?.isConnected?.()) {
      this.logger.error(
        `Redis not connected - skipping setUserOffline for user ${userId}`,
        undefined,
        "PresenceService",
      );
      return;
    }

    try {
      const key = this.getPresenceKey(userId);
      const redis = this.redisClientStorage.getRedisClient();

      const existingData = await redis.get(key);
      if (!existingData) return;

      const presence: PresenceStatus = JSON.parse(existingData);

      // Remove the disconnected socket
      presence.socketIds = presence.socketIds.filter((id) => id !== socketId);

      // If no sockets remain, set to offline
      if (presence.socketIds.length === 0) {
        presence.status = "offline";
        presence.lastActivity = new Date();
        await redis.setex(key, this.PRESENCE_TTL, JSON.stringify(presence));
      } else {
        // Still has other connections, keep as online/away
        await redis.setex(key, this.PRESENCE_TTL, JSON.stringify(presence));
      }
    } catch (error) {
      this.logger.error(`Error setting user offline for ${userId}`, error as Error, "PresenceService");
    }
  }

  /**
   * Update user activity timestamp (called on heartbeat)
   */
  async updateActivity(userId: string): Promise<void> {
    if (!this.redisClientStorage?.isConnected?.()) {
      return;
    }

    try {
      const key = this.getPresenceKey(userId);
      const redis = this.redisClientStorage.getRedisClient();

      const existingData = await redis.get(key);
      if (!existingData) return;

      const presence: PresenceStatus = JSON.parse(existingData);
      presence.lastActivity = new Date();
      presence.status = "online"; // Active heartbeat = online

      await redis.setex(key, this.PRESENCE_TTL, JSON.stringify(presence));
    } catch (error) {
      this.logger.error("Error updating heartbeat", error as Error, "PresenceService");
      return;
    }
  }

  /**
   * Get user's current status
   */
  async getUserStatus(userId: string): Promise<PresenceStatus> {
    if (!this.redisClientStorage?.isConnected?.()) {
      return {
        status: "offline",
        lastActivity: new Date(),
        socketIds: [],
        userName: "",
      };
    }

    try {
      const key = this.getPresenceKey(userId);
      const redis = this.redisClientStorage.getRedisClient();

      const data = await redis.get(key);
      if (!data) {
        return {
          status: "offline",
          lastActivity: new Date(),
          socketIds: [],
          userName: "",
        };
      }

      const presence: PresenceStatus = JSON.parse(data);

      // Recalculate status based on lastActivity
      const now = new Date().getTime();
      const lastActivityTime = new Date(presence.lastActivity).getTime();
      const timeSinceActivity = now - lastActivityTime;

      if (presence.socketIds.length === 0) {
        presence.status = "offline";
      } else if (timeSinceActivity > this.AWAY_THRESHOLD) {
        presence.status = "offline";
      } else if (timeSinceActivity > this.ONLINE_THRESHOLD) {
        presence.status = "away";
      } else {
        presence.status = "online";
      }

      return presence;
    } catch (error) {
      this.logger.error(`Error getting user status for ${userId}`, error as Error, "PresenceService");
      return {
        status: "offline",
        lastActivity: new Date(),
        socketIds: [],
        userName: "",
      };
    }
  }

  /**
   * Get statuses for multiple users
   */
  async getUsersStatuses(userIds: string[]): Promise<Map<string, PresenceStatus>> {
    const statuses = new Map<string, PresenceStatus>();

    await Promise.all(
      userIds.map(async (userId) => {
        const status = await this.getUserStatus(userId);
        statuses.set(userId, status);
      }),
    );

    return statuses;
  }

  /**
   * Mark idle users as "away"
   * Called by cron job every 5 minutes
   * Returns array of user IDs whose status changed
   */
  async markIdleUsersAsAway(): Promise<string[]> {
    if (!this.redisClientStorage?.isConnected?.()) {
      return [];
    }

    try {
      const redis = this.redisClientStorage.getRedisClient();
      const pattern = `${this.PRESENCE_KEY_PREFIX}*`;
      const keys = await redis.keys(pattern);

      const changedUsers: string[] = [];

      await Promise.all(
        keys.map(async (key: string) => {
          try {
            const data = await redis.get(key);
            if (!data) return;

            const presence: PresenceStatus = JSON.parse(data);

            // Skip if no sockets
            if (presence.socketIds.length === 0) return;

            const now = new Date().getTime();
            const lastActivityTime = new Date(presence.lastActivity).getTime();
            const timeSinceActivity = now - lastActivityTime;

            // If idle for more than 2 minutes but less than 30, mark as away
            if (timeSinceActivity > this.ONLINE_THRESHOLD && timeSinceActivity < this.AWAY_THRESHOLD) {
              if (presence.status !== "away") {
                presence.status = "away";
                await redis.setex(key, this.PRESENCE_TTL, JSON.stringify(presence));

                // Extract userId from key
                const userId = key.replace(this.PRESENCE_KEY_PREFIX, "");
                changedUsers.push(userId);
              }
            }
            // If idle for more than 30 minutes, mark as offline
            else if (timeSinceActivity > this.AWAY_THRESHOLD) {
              if (presence.status !== "offline") {
                presence.status = "offline";
                presence.socketIds = [];
                await redis.setex(key, this.PRESENCE_TTL, JSON.stringify(presence));

                const userId = key.replace(this.PRESENCE_KEY_PREFIX, "");
                changedUsers.push(userId);
              }
            }
          } catch (error) {
            // Continue processing other keys if one fails
            this.logger.error(`Error processing presence key ${key}`, error as Error, "PresenceService");
          }
        }),
      );

      return changedUsers;
    } catch (error) {
      this.logger.error("Error marking idle users as away", error as Error, "PresenceService");
      return [];
    }
  }

  /**
   * Helper to construct Redis key
   */
  private getPresenceKey(userId: string): string {
    return `${this.PRESENCE_KEY_PREFIX}${userId}`;
  }
}
