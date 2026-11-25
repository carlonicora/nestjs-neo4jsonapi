import { Injectable, OnApplicationBootstrap, Optional } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { RedisLockService } from "../../../core/redis/services/redis.lock.service";
import { StripeService } from "../../stripe/services/stripe.service";
import { StripeInvoiceRepository } from "../repositories/stripe-invoice.repository";
import { StripeInvoiceAdminService } from "../services/stripe-invoice-admin.service";
import { StripeInvoiceApiService } from "../services/stripe-invoice-api.service";

export type StripeInvoiceServiceLinesBackfillResult = {
  /** Skipped without touching anything: Stripe off. */
  skipped: "stripe-not-configured" | "locked" | null;
  total: number;
  /** Service lines written and the invoice marked checked. */
  recorded: number;
  /** Period written, but the line's price is not stored locally: left unchecked, retried on next boot. */
  priceUnknown: number;
  /** Stripe could not return the invoice (or a write failed): left unchecked, retried on next boot. */
  failed: number;
};

/**
 * One-off fill-in of the plan and covered period of every StripeInvoice stored before they were
 * recorded (WYR-98).
 *
 * The live sync records them on every invoice webhook; this reads each invoice that has no
 * `serviceLinesCheckedAt` from Stripe (lines and payments expanded) and records them through
 * {@link StripeInvoiceAdminService.recordServiceLinesFromStripe}. There is no marker node: the
 * per-invoice `serviceLinesCheckedAt` is the marker, so later boots only see the invoices still
 * unchecked (an invoice Stripe could not return, or whose price is not stored locally yet).
 *
 * Runs in worker mode at application bootstrap, in the background so a long list never delays the
 * worker. Re-running is harmless: each write is what Stripe holds now.
 */
@Injectable()
export class StripeInvoiceServiceLinesBackfillService implements OnApplicationBootstrap {
  constructor(
    private readonly stripeService: StripeService,
    private readonly stripeInvoiceApiService: StripeInvoiceApiService,
    private readonly stripeInvoiceRepository: StripeInvoiceRepository,
    private readonly stripeInvoiceAdminService: StripeInvoiceAdminService,
    private readonly cls: ClsService,
    private readonly logger: AppLoggingService,
    @Optional() private readonly redisLock?: RedisLockService,
  ) {}

  onApplicationBootstrap(): void {
    void this.run().catch((error) => {
      this.logger.error("Stripe invoice service lines backfill aborted", error);
    });
  }

  /**
   * Repository queries read the request context, so the run gets an empty one.
   * With a lock service, one process runs it; another one booting at the same time skips.
   */
  async run(): Promise<StripeInvoiceServiceLinesBackfillResult> {
    if (!this.redisLock) return this.cls.run(() => this.backfill());

    const result = await this.redisLock.withLock(
      this.redisLock.scopedKey("startup:stripe-invoice-lines-backfill"),
      1800,
      () => this.cls.run(() => this.backfill()),
      { retryOnRedisError: true },
    );
    return result ?? { skipped: "locked", total: 0, recorded: 0, priceUnknown: 0, failed: 0 };
  }

  private async backfill(): Promise<StripeInvoiceServiceLinesBackfillResult> {
    const result: StripeInvoiceServiceLinesBackfillResult = {
      skipped: null,
      total: 0,
      recorded: 0,
      priceUnknown: 0,
      failed: 0,
    };

    if (!this.stripeService.isConfigured()) {
      return { ...result, skipped: "stripe-not-configured" };
    }

    const stripeInvoiceIds = await this.stripeInvoiceRepository.findWithoutServiceLines();
    result.total = stripeInvoiceIds.length;
    if (result.total === 0) return result;

    this.logger.log(`Stripe invoice service lines backfill: ${result.total} invoices`);

    // Sequential on purpose: one Stripe read at a time.
    for (const stripeInvoiceId of stripeInvoiceIds) {
      try {
        const stripeInvoice = await this.stripeInvoiceApiService.getInvoice(stripeInvoiceId);
        const outcome = await this.stripeInvoiceAdminService.recordServiceLinesFromStripe(stripeInvoice);

        if (outcome === "price-unknown") result.priceUnknown++;
        else result.recorded++;
      } catch (error) {
        result.failed++;
        this.logger.error(
          `Stripe invoice service lines backfill: ${stripeInvoiceId} failed, left unchecked`,
          error as Error,
        );
      }
    }

    this.logger.log(
      `Stripe invoice service lines backfill: total=${result.total} recorded=${result.recorded} priceUnknown=${result.priceUnknown} failed=${result.failed}`,
    );

    return result;
  }
}
