/**
 * Configuration for chunk processing queues.
 *
 * The library always registers its own CHUNK queue.
 * Use this interface to register additional queues that the ChunkService
 * needs to add jobs to after processing chunks.
 */
export interface ConfigChunkQueuesInterface {
  /**
   * Additional queue IDs for BullMQ registration.
   * These are queues that ChunkService will add jobs to after chunk processing.
   * The library's CHUNK queue is always registered automatically.
   */
  queueIds?: string[];

  /**
   * How many chunk jobs the library's CHUNK worker runs at once.
   * Sourced from `CHUNK_QUEUE_CONCURRENCY` (default 50).
   *
   * READ-ONLY reporting of the value already in force. `@Processor(...)` options
   * are evaluated when the class is DECORATED — long before NestJS builds this
   * config object — so the worker reads the env-derived
   * {@link CHUNK_QUEUE_CONCURRENCY} constant directly. Setting this field through
   * `BaseConfigOptions.chunkQueues` therefore cannot change the worker; only the
   * environment variable can. It is surfaced here so the running concurrency is
   * inspectable through `ConfigService` like every other tunable.
   */
  concurrency?: number;
}
