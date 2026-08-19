import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Redis } from "ioredis";
import { baseConfig } from "../../../config/base.config";
import { BaseConfigInterface, ConfigRedisInterface } from "../../../config/interfaces";

export interface NotificationMessage {
  type: "user" | "company" | "broadcast";
  targetId?: string; // userId for 'user', companyId for 'company', undefined for 'broadcast'
  event: string;
  data: any;
  timestamp: Date;
  source: "worker" | "api";
}

@Injectable()
export class RedisMessagingService implements OnModuleInit, OnModuleDestroy {
  private publisher!: Redis;
  private subscriber!: Redis;
  private channel: string;

  constructor(
    private eventEmitter: EventEmitter2,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {}

  private get redisConfig(): ConfigRedisInterface {
    return this.configService.get<ConfigRedisInterface>("redis");
  }

  onModuleInit() {
    if (!this.redisConfig) {
      return;
    }

    this.channel = `${this.redisConfig.queue}:websocket_notifications`;

    this.publisher = new Redis({
      host: this.redisConfig.host,
      port: this.redisConfig.port,
      username: this.redisConfig.username,
      password: this.redisConfig.password,
    });

    this.subscriber = new Redis({
      host: this.redisConfig.host,
      port: this.redisConfig.port,
      username: this.redisConfig.username,
      password: this.redisConfig.password,
    });

    // Subscribe to notifications channel
    this.subscriber.subscribe(this.channel);

    // Handle incoming messages
    this.subscriber.on("message", (channel: string, message: string) => {
      if (channel === this.channel) {
        try {
          const notification: NotificationMessage = JSON.parse(message);
          // Emit local event for WebSocketService to handle
          this.eventEmitter.emit("redis.notification", notification);
        } catch (error) {
          console.error("Error parsing Redis notification message:", error);
        }
      }
    });
  }

  async publishNotification(notification: Omit<NotificationMessage, "timestamp" | "source">): Promise<void> {
    if (!this.publisher) {
      console.warn("RedisMessagingService: Publisher not initialized");
      return;
    }

    const fullNotification: NotificationMessage = {
      ...notification,
      timestamp: new Date(),
      source: baseConfig.environment.appMode,
    };

    await this.publisher.publish(this.channel, JSON.stringify(fullNotification));
  }

  async publishUserNotification(userId: string, event: string, data: any): Promise<void> {
    await this.publishNotification({
      type: "user",
      targetId: userId,
      event,
      data,
    });
  }

  async publishCompanyNotification(companyId: string, event: string, data: any): Promise<void> {
    await this.publishNotification({
      type: "company",
      targetId: companyId,
      event,
      data,
    });
  }

  async publishBroadcastNotification(event: string, data: any): Promise<void> {
    await this.publishNotification({
      type: "broadcast",
      event,
      data,
    });
  }

  async onModuleDestroy() {
    try {
      if (this.publisher) {
        await this.publisher.quit();
      }
    } catch (error) {
      console.error("Error closing Redis publisher connection:", error);
      this.publisher?.disconnect();
    }

    try {
      if (this.subscriber) {
        await this.subscriber.quit();
      }
    } catch (error) {
      console.error("Error closing Redis subscriber connection:", error);
      this.subscriber?.disconnect();
    }
  }
}
