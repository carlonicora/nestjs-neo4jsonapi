import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { Server, Socket } from "socket.io";
import { APP_MODE_TOKEN, AppMode, AppModeConfig } from "../../appmode/constants/app.mode.constant";
import { AppLoggingService } from "../../logging/services/logging.service";
import { RedisClientStorageService } from "../../redis/services/redis.client.storage.service";
import { NotificationMessage, RedisMessagingService } from "../../redis/services/redis.messaging.service";

/**
 * Prefix under which client `message` frames are re-emitted on the in-process event bus.
 *
 * A socket client controls `message.type`, so it must never be emitted verbatim: that
 * would let any connected user fire internal events ("redis.notification", trigger
 * events, cache-invalidation events, ...). Listeners for client messages subscribe to
 * `${WS_CLIENT_MESSAGE_EVENT_PREFIX}<type>`, e.g. `@OnEvent("ws:message:chat")`.
 */
export const WS_CLIENT_MESSAGE_EVENT_PREFIX = "ws:message:";

/** Allowed shape of a client-supplied message type (no wildcards, no whitespace, bounded). */
export const WS_CLIENT_MESSAGE_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;

/** Socket event carrying presence changes. Sent to the user's company only, never broadcast. */
export const WS_PRESENCE_EVENT = "user:presence";

/**
 * WebSocket Service
 *
 * Manages WebSocket connections and message broadcasting
 *
 * Features:
 * - Client connection management
 * - User-specific messaging
 * - Company-wide broadcasting
 * - Global broadcast capabilities
 * - Redis pub/sub for multi-instance support
 * - Periodic cleanup of expired clients
 */
@Injectable()
export class WebSocketService implements OnModuleInit, OnModuleDestroy {
  private server: Server | null = null;
  private clients: Map<string, Socket[]> = new Map();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    @Inject(APP_MODE_TOKEN) private readonly appModeConfig: AppModeConfig,
    private readonly logger: AppLoggingService,
    @Optional() private readonly redisClientStorage?: RedisClientStorageService,
    @Optional() private readonly redisMessaging?: RedisMessagingService,
  ) {}

  onModuleInit() {
    // Cleanup expired clients every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        if (this.redisClientStorage?.cleanupExpiredClients) {
          this.redisClientStorage.cleanupExpiredClients();
        }
      },
      5 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  setServer(server: Server) {
    this.server = server;
  }

  async addClient(userId: string, client: Socket) {
    const existingClients = this.clients.get(userId) || [];
    existingClients.push(client);
    this.clients.set(userId, existingClients);

    if (this.redisClientStorage?.addClient) {
      await this.redisClientStorage.addClient(userId, client.data.user.companyId, client.id);
    }
  }

  async removeClient(userId: string, client: Socket) {
    const existingClients = this.clients.get(userId);
    if (existingClients) {
      const index = existingClients.indexOf(client);
      if (index !== -1) {
        existingClients.splice(index, 1);
        if (existingClients.length > 0) {
          this.clients.set(userId, existingClients);
        } else {
          this.clients.delete(userId);
        }
      }
    }

    if (this.redisClientStorage?.removeClient) {
      await this.redisClientStorage.removeClient(client.id);
    }
  }

  async broadcast(event: string, data: any) {
    if (this.appModeConfig.mode === AppMode.WORKER) {
      if (this.redisMessaging?.publishBroadcastNotification) {
        await this.redisMessaging.publishBroadcastNotification(event, data);
      }
      return;
    }

    this.broadcastDirect(event, data);
  }

  private broadcastDirect(event: string, data: any) {
    if (this.server) {
      this.server.emit(event, data);
    }
  }

  async sendMessageToCompany(companyId: string, event: string, data: any) {
    if (this.appModeConfig.mode === AppMode.WORKER) {
      if (this.redisMessaging?.publishCompanyNotification) {
        await this.redisMessaging.publishCompanyNotification(companyId, event, data);
      }
      return;
    }

    this.sendMessageToCompanyDirect(companyId, event, data);
  }

  private async sendMessageToCompanyDirect(companyId: string, event: string, data: any) {
    if (!this.redisClientStorage?.getCompanyUsers) {
      return;
    }

    const companyUsers = await this.redisClientStorage.getCompanyUsers(companyId);

    companyUsers.forEach((userId: string) => {
      const clients = this.clients.get(userId);
      if (clients && clients.length > 0) {
        clients.forEach((client) => client.emit(event, data));
      }
    });
  }

  async sendMessageToUser(userId: string, event: string, data: any) {
    if (this.appModeConfig.mode === AppMode.WORKER) {
      if (this.redisMessaging?.publishUserNotification) {
        await this.redisMessaging.publishUserNotification(userId, event, data);
      }
      return;
    }

    this.sendMessageToUserDirect(userId, event, data);
  }

  private sendMessageToUserDirect(userId: string, event: string, data: any) {
    const clients = this.clients.get(userId);
    if (clients && clients.length > 0) {
      clients.forEach((client) => client.emit(event, data));
    }
  }

  /**
   * Presence of a user goes to the sockets of that user's company only. Without a
   * company there is nobody entitled to see it, so nothing is sent.
   */
  async sendPresenceToCompany(companyId: string | null | undefined, data: any) {
    if (!companyId) return;
    await this.sendMessageToCompany(companyId, WS_PRESENCE_EVENT, data);
  }

  /**
   * Re-emits a client `message` frame under the reserved `ws:message:` namespace.
   * Returns false (and emits nothing) when the type is missing or malformed.
   */
  handleIncomingMessage(companyId: string, userId: string, message: { type: string; message: any }): boolean {
    const type = message?.type;
    if (typeof type !== "string" || !WS_CLIENT_MESSAGE_TYPE_PATTERN.test(type)) {
      this.logger.warn(`Rejected websocket message with invalid type from user ${userId}`, WebSocketService.name);
      return false;
    }

    this.eventEmitter.emit(`${WS_CLIENT_MESSAGE_EVENT_PREFIX}${type}`, { companyId, userId, message });
    return true;
  }

  handleIncomingGoogleMeetPart(meetId: string, speakerName: string, timestamp: Date, message: any) {
    this.eventEmitter.emit("googlemeet", { meetId, speakerName, timestamp, message });
  }

  @OnEvent("redis.notification")
  async handleRedisNotification(notification: NotificationMessage) {
    switch (notification.type) {
      case "user":
        if (notification.targetId) {
          this.sendMessageToUserDirect(notification.targetId, notification.event, notification.data);
        }
        break;
      case "company":
        if (notification.targetId) {
          await this.sendMessageToCompanyDirect(notification.targetId, notification.event, notification.data);
        }
        break;
      case "broadcast":
        this.broadcastDirect(notification.event, notification.data);
        break;
    }
  }
}
