import { Module } from "@nestjs/common";
import { RedisClientStorageService } from "./services/redis.client.storage.service";
import { RedisMessagingService } from "./services/redis.messaging.service";
import { RedisLockService } from "./services/redis.lock.service";
import { JobRunService } from "./services/job-run.service";

@Module({
  providers: [RedisClientStorageService, RedisMessagingService, RedisLockService, JobRunService],
  exports: [RedisClientStorageService, RedisMessagingService, RedisLockService, JobRunService],
})
export class RedisModule {}
