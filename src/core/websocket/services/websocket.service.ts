import { Inject, Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { Server, Socket } from "socket.io";
import { APP_MODE_TOKEN, AppMode, AppModeConfig } from "../../appmode/constants/app.mode.constant";
import { RedisClientStorageService } from "../../redis/services/redis.client.storage.service";
import { RedisMessagingService } from "../../redis/services/redis.messaging.service";

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
export class WebSocketService implements OnModuleInit {
  private server: Server | null = null;
  private clients: Map<string, Socket[]> = new Map();

  constructor(
    private readonly eventEmitter: EventEmitter2,
    @Inject(APP_MODE_TOKEN) private readonly appModeConfig: AppModeConfig,
    @Optional() private readonly redisClientStorage?: RedisClientStorageService,
    @Optional() private readonly redisMessaging?: RedisMessagingService,
  ) {}

  onModuleInit() {
    // Cleanup expired clients every 5 minutes
    setInterval(
      () => {
        if (this.redisClientStorage?.cleanupExpiredClients) {
          this.redisClientStorage.cleanupExpiredClients();
        }
      },
      5 * 60 * 1000,
    );
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

  handleIncomingMessage(companyId: string, userId: string, message: { type: string; message: any }) {
    this.eventEmitter.emit(message.type, { companyId, userId, message });
  }

  handleIncomingGoogleMeetPart(meetId: string, speakerName: string, timestamp: Date, message: any) {
    this.eventEmitter.emit("googlemeet", { meetId, speakerName, timestamp, message });
  }

  @OnEvent("redis.notification")
  async handleRedisNotification(notification: any) {
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
