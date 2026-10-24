import { HttpStatus, Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { StripeError } from "../../stripe/errors/stripe.errors";
import { StripeService } from "../../stripe/services/stripe.service";
import { discountFromStripeSubscription } from "../entities/stripe-subscription.discount";
import { StripeSubscriptionRepository } from "../repositories/stripe-subscription.repository";
import { StripeSubscriptionApiService } from "../services/stripe-subscription-api.service";
import { StripeSubscriptionBackfillRepository } from "./stripe-subscription-backfill.repository";

/** Marker id: changing it makes every deployed app run the backfill again. */
export const STRIPE_SUBSCRIPTION_DISCOUNT_BACKFILL_ID = "stripe-subscription-discount-20261024";

export type StripeSubscriptionDiscountBackfillResult = {
  /** Skipped without touching anything: Stripe off, or the marker already exists. */
  skipped: "stripe-not-configured" | "already-completed" | null;
  total: number;
  /** Discount fields written (a discount, or null when Stripe says there is none). */
  updated: number;
  /** Stripe no longer has the subscription; node left as it is. */
  missing: number;
  /** Stripe answered but the discount could not be read; node left as it is. */
  unreadable: number;
  /** Any other error (network, rate limit, Neo4j); node left as it is, run retried on next boot. */
  failed: number;
};

/**
 * One-off backfill of the discount fields on every StripeSubscription node.
 *
 * The discount fields are written on create, plan change and Stripe sync only, so a
 * subscription stored before they existed shows no discount until its next change.
 * This reads each subscription from Stripe (with the discount expanded) and writes
 * only the discount fields through {@link StripeSubscriptionRepository.update}.
 *
 * Runs in worker mode at application bootstrap, after the migrator (module init),
 * in the background so a long list never delays the worker. A
 * `(:StripeSubscriptionBackfill)` marker stops later boots from running it again; the
 * marker is written only when no subscription failed for a transient reason, so an
 * outage during the deploy is retried on the next boot. Re-running is harmless: each
 * write is the value Stripe holds now.
 */
@Injectable()
export class StripeSubscriptionDiscountBackfillService implements OnApplicationBootstrap {
  constructor(
    private readonly stripeService: StripeService,
    private readonly stripeSubscriptionApiService: StripeSubscriptionApiService,
    private readonly subscriptionRepository: StripeSubscriptionRepository,
    private readonly backfillRepository: StripeSubscriptionBackfillRepository,
    private readonly cls: ClsService,
    private readonly logger: AppLoggingService,
  ) {}

  onApplicationBootstrap(): void {
    void this.run().catch((error) => {
      this.logger.error("Stripe subscription discount backfill aborted", error);
    });
  }

  /** Repository queries read the request context, so the run gets an empty one. */
  async run(): Promise<StripeSubscriptionDiscountBackfillResult> {
    return this.cls.run(() => this.backfill());
  }

  private async backfill(): Promise<StripeSubscriptionDiscountBackfillResult> {
    const result: StripeSubscriptionDiscountBackfillResult = {
      skipped: null,
      total: 0,
      updated: 0,
      missing: 0,
      unreadable: 0,
      failed: 0,
    };

    if (!this.stripeService.isConfigured()) {
      return { ...result, skipped: "stripe-not-configured" };
    }

    if (await this.backfillRepository.isCompleted({ id: STRIPE_SUBSCRIPTION_DISCOUNT_BACKFILL_ID })) {
      return { ...result, skipped: "already-completed" };
    }

    const subscriptions = await this.subscriptionRepository.findAll();
    result.total = subscriptions.length;
    this.logger.log(`Stripe subscription discount backfill: ${subscriptions.length} subscriptions`);

    // Sequential on purpose: one Stripe read at a time.
    for (const subscription of subscriptions) {
      try {
        const stripeSubscription = await this.stripeSubscriptionApiService.retrieveSubscription(
          subscription.stripeSubscriptionId,
        );
        const discount = discountFromStripeSubscription(stripeSubscription);

        if (discount === undefined) {
          result.unreadable++;
          this.logger.warn(
            `Stripe subscription discount backfill: discount of ${subscription.stripeSubscriptionId} is unreadable, left as it is`,
          );
          continue;
        }

        await this.subscriptionRepository.update({ id: subscription.id, discount });
        result.updated++;
      } catch (error) {
        if (isMissingInStripe(error)) {
          result.missing++;
          this.logger.warn(
            `Stripe subscription discount backfill: ${subscription.stripeSubscriptionId} not found in Stripe, left as it is`,
          );
          continue;
        }

        result.failed++;
        this.logger.error(
          `Stripe subscription discount backfill: ${subscription.stripeSubscriptionId} failed, left as it is`,
          error as Error,
        );
      }
    }

    const summary = `total=${result.total} updated=${result.updated} missing=${result.missing} unreadable=${result.unreadable} failed=${result.failed}`;
    if (result.failed === 0) {
      await this.backfillRepository.markCompleted({ id: STRIPE_SUBSCRIPTION_DISCOUNT_BACKFILL_ID, summary });
      this.logger.log(`Stripe subscription discount backfill completed: ${summary}`);
    } else {
      this.logger.warn(`Stripe subscription discount backfill incomplete, retried on next boot: ${summary}`);
    }

    return result;
  }
}

/**
 * A deleted or unknown subscription: Stripe answers 404 `resource_missing`, which
 * {@link StripeSubscriptionApiService.retrieveSubscription} rethrows as a 400 StripeError.
 */
function isMissingInStripe(error: unknown): boolean {
  if (error instanceof StripeError) return error.stripeCode === "resource_missing";
  const raw = error as { code?: string; statusCode?: number } | null;
  return raw?.code === "resource_missing" || raw?.statusCode === HttpStatus.NOT_FOUND;
}
