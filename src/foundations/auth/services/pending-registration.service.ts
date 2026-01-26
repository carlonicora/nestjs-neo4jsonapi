import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { Redis } from "ioredis";
import { BaseConfigInterface, ConfigRedisInterface } from "../../../config/interfaces";

export interface PendingRegistration {
  id: string;
  provider: "discord" | "google" | "github";
  providerUserId: string;
  email: string;
  name: string;
  avatar?: string;
  inviteCode?: string;
  createdAt: string;
}

@Injectable()
export class PendingRegistrationService implements OnModuleDestroy {
  private redis: Redis;
  private readonly REDIS_PREFIX: string;
  private readonly TTL_SECONDS = 900; // 15 minutes

  constructor(private readonly configService: ConfigService<BaseConfigInterface>) {
    const redisConfig = this.configService.get<ConfigRedisInterface>("redis");

    this.REDIS_PREFIX = `${redisConfig.queue}:pending-registration:`;

    this.redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      username: redisConfig.username,
      password: redisConfig.password,
    });
  }

  async create(data: Omit<PendingRegistration, "id" | "createdAt">): Promise<string> {
    const id = randomUUID();
    const registration: PendingRegistration = {
      ...data,
      id,
      createdAt: new Date().toISOString(),
    };

    await this.redis.setex(`${this.REDIS_PREFIX}${id}`, this.TTL_SECONDS, JSON.stringify(registration));

    return id;
  }

  async get(pendingId: string): Promise<PendingRegistration | null> {
    const data = await this.redis.get(`${this.REDIS_PREFIX}${pendingId}`);
    if (!data) return null;
    return JSON.parse(data) as PendingRegistration;
  }

  async delete(pendingId: string): Promise<void> {
    await this.redis.del(`${this.REDIS_PREFIX}${pendingId}`);
  }

  async onModuleDestroy() {
    try {
      await this.redis.quit();
    } catch (error) {
      console.error("Error closing Redis connection:", error);
      this.redis.disconnect();
    }
  }
}
