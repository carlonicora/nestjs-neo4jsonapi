import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { AppLoggingService } from "../../logging/services/logging.service";
import { PresenceService } from "./presence.service";
import { WebSocketService } from "./websocket.service";
import { RedisClientStorageService } from "../../redis/services/redis.client.storage.service";

@Injectable()
export class PresenceCronService {
  constructor(
    private readonly presenceService: PresenceService,
    private readonly webSocketService: WebSocketService,
    private readonly redisClientStorage: RedisClientStorageService,
    private readonly logger: AppLoggingService,
  ) {}

  /**
   * Run every 5 minutes to mark idle users as "away" or "offline"
   */
  @Cron("*/5 * * * *")
  async markIdleUsers() {
    try {
      this.logger.log("Running presence idle detection cron job");

      const changedUsers = await this.presenceService.markIdleUsersAsAway();

      if (changedUsers.length > 0) {
        this.logger.log(`Marked ${changedUsers.length} users as idle`);

        // Broadcast status changes to all connected clients
        for (const userId of changedUsers) {
          const status = await this.presenceService.getUserStatus(userId);

          await this.webSocketService.broadcast("user:presence", {
            userId,
            status: status.status,
            lastSeen: status.lastActivity,
          });
        }
      }
    } catch (error) {
      this.logger.error("Error in presence idle detection cron job", error);
    }
  }

  /**
   * Run every hour to clean up orphaned WebSocket client references in Redis.
   * Removes socket IDs from user_clients sets when the corresponding ws_client key has expired.
   */
  @Cron("0 * * * *")
  async cleanupExpiredClients() {
    try {
      await this.redisClientStorage.cleanupExpiredClients();
    } catch (error) {
      this.logger.error("Error in expired clients cleanup cron job", error);
    }
  }
}
