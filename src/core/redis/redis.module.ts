import { Module } from "@nestjs/common";
import { RedisClientStorageService } from "./services/redis.client.storage.service";
import { RedisMessagingService } from "./services/redis.messaging.service";
import { RedisLockService } from "./services/redis.lock.service";

@Module({
  providers: [RedisClientStorageService, RedisMessagingService, RedisLockService],
  exports: [RedisClientStorageService, RedisMessagingService, RedisLockService],
})
export class RedisModule {}
