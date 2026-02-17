import { BullModule } from "@nestjs/bullmq";
import { DynamicModule, Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { QueueId } from "../../config/enums/queue.id";
import { BaseConfigInterface, ConfigChunkQueuesInterface, ConfigRedisInterface } from "../../config/interfaces";

/**
 * QueueModule - Centralized BullMQ queue configuration
 *
 * Uses ConfigService to get Redis connection and queue IDs dynamically,
 * ensuring app-specific queue configurations are properly loaded.
 *
 * Library's CHUNK queue is ALWAYS registered.
 * App's additional queues come from config.chunkQueues.queueIds.
 */
@Global()
@Module({})
export class QueueModule {
  static forRoot(): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        ConfigModule,
        // Configure Redis connection asynchronously
        BullModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (configService: ConfigService<BaseConfigInterface>) => {
            const redis = configService.get<ConfigRedisInterface>("redis");
            return {
              connection: {
                host: redis?.host,
                port: redis?.port,
                password: redis?.password,
                username: redis?.username,
              },
              prefix: redis?.queue,
              defaultJobOptions: {
                removeOnComplete: true,
                removeOnFail: { age: 3600, count: 1000 },
              },
            };
          },
        }),
        // Always register the library's core queues
        BullModule.registerQueue({ name: QueueId.CHUNK }),
        BullModule.registerQueue({ name: QueueId.COMPANY }),
        BullModule.registerQueue({ name: QueueId.TRIAL }),
      ],
      providers: [
        // Provider that registers app-specific queues dynamically
        {
          provide: "QUEUE_REGISTRATIONS",
          inject: [ConfigService],
          useFactory: async (configService: ConfigService<BaseConfigInterface>) => {
            const chunkQueues = configService.get<ConfigChunkQueuesInterface>("chunkQueues");
            const appQueueIds = chunkQueues?.queueIds ?? [];

            // Filter out CHUNK (already registered) and register remaining queues
            const additionalQueues = appQueueIds.filter((id) => id !== QueueId.CHUNK && id !== QueueId.COMPANY);

            // Note: This provider ensures app queues are tracked, but actual registration
            // happens via BullModule.registerQueue() imports below
            return additionalQueues;
          },
        },
      ],
      exports: [BullModule],
      global: true,
    };
  }

  /**
   * forRootWithQueues - Register specific queue IDs
   * Use this when you need to explicitly specify which queues to register.
   */
  static forRootWithQueues(queueIds: string[]): DynamicModule {
    const allQueueIds = new Set([QueueId.CHUNK, QueueId.COMPANY, QueueId.TRIAL, ...queueIds]);

    return {
      module: QueueModule,
      imports: [
        ConfigModule,
        BullModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (configService: ConfigService<BaseConfigInterface>) => {
            const redis = configService.get<ConfigRedisInterface>("redis");
            return {
              connection: {
                host: redis?.host,
                port: redis?.port,
                password: redis?.password,
                username: redis?.username,
              },
              prefix: redis?.queue,
              defaultJobOptions: {
                removeOnComplete: true,
                removeOnFail: { age: 3600, count: 1000 },
              },
            };
          },
        }),
        ...Array.from(allQueueIds).map((name) => BullModule.registerQueue({ name })),
      ],
      exports: [BullModule],
      global: true,
    };
  }
}
