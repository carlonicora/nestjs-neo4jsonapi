import { WorkerHost } from "@nestjs/bullmq";
import { INestApplicationContext, Type } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { SchedulerRegistry } from "@nestjs/schedule";

/**
 * Stops everything that starts new work (cron jobs, scheduled intervals and
 * timeouts, BullMQ workers) and waits for the jobs already running to finish.
 *
 * It MUST run before `app.close()`. Nest runs every `onModuleDestroy` hook
 * first — that is where `Neo4jService` closes its driver and the Redis services
 * quit — and only then `beforeApplicationShutdown` (where `@nestjs/schedule`
 * stops its crons) and `onApplicationShutdown` (where `@nestjs/bullmq` closes
 * its workers, waiting for the active jobs). Left to that order, a job that was
 * running when the signal arrived kept going against a closed driver: every
 * query failed with "Pool is closed", the worker sat there with no health check
 * and no database until the job ended, and a second SIGTERM only re-awaited the
 * same close. Observed 2026-10-12 on a `nest start --watch` reload of the
 * worker.
 */
export async function stopJobIntake(app: INestApplicationContext): Promise<void> {
  // ScheduleModule is mounted only when the mode enables cron jobs.
  const schedulerRegistry = getOptional(app, SchedulerRegistry);
  if (schedulerRegistry) {
    schedulerRegistry.getCronJobs().forEach((cronJob) => cronJob.stop());
    schedulerRegistry.getIntervals().forEach((name) => schedulerRegistry.deleteInterval(name));
    schedulerRegistry.getTimeouts().forEach((name) => schedulerRegistry.deleteTimeout(name));
  }

  // Every @Processor extends WorkerHost; its worker exists from onModuleInit on.
  const discoveryService = getOptional(app, DiscoveryService);
  const workerHosts = (discoveryService?.getProviders() ?? [])
    .map((wrapper) => wrapper.instance)
    .filter((instance): instance is WorkerHost => instance instanceof WorkerHost);

  // A graceful BullMQ close: no new job is fetched, the active ones run to
  // completion while Neo4j and Redis are still open.
  await Promise.all(workerHosts.map((host) => host.worker.close()));
}

/**
 * Setup graceful shutdown handlers for SIGTERM and SIGINT.
 *
 * @param app - NestJS application or application context
 * @param healthServer - Optional Node.js http.Server to close on shutdown (worker health check)
 */
export function setupGracefulShutdown(app: INestApplicationContext, healthServer?: any): void {
  const shutdown = async (signal: string) => {
    try {
      if (healthServer) {
        await new Promise<void>((resolve) => healthServer.close(() => resolve()));
      }
      await stopJobIntake(app);
      await app.close();
      process.exit(0);
    } catch (error) {
      console.error(`Error during ${signal} shutdown:`, error);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function getOptional<T>(app: INestApplicationContext, token: Type<T>): T | undefined {
  try {
    return app.get(token, { strict: false });
  } catch {
    return undefined;
  }
}
