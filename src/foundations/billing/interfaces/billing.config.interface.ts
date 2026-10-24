/**
 * The three billing emails an app can switch off one by one.
 */
export type BillingEmailKey = "paymentFailed" | "cardExpiring" | "subscriptionEnded";

/**
 * App-relative paths the billing emails link to. The sender prefixes each with
 * the app URL (`app.url`, trailing slash removed).
 */
export type BillingLinks = { billing: string; paymentMethod: string; subscribe: string; resubscribe: string };

/**
 * One email job the library sender handles: the template id and the mapping from
 * the queued payload to the template data.
 */
export interface BillingEmailJobDefinition {
  template: string;
  toTemplateData: (
    payload: Record<string, unknown>,
    ctx: { appUrl: string; locale: string; links: BillingLinks },
  ) => Record<string, unknown>;
}

/**
 * Configuration for the BillingModule. Every key is optional; omitted keys keep
 * the value in `DEFAULT_BILLING_CONFIG`.
 */
export interface BillingModuleConfig {
  /**
   * The library billing email sender (a BullMQ worker on `QueueId.EMAIL`).
   * OFF by default: apps that consume the email queue with their own processor
   * keep doing so. `extraJobs` adds or overrides job types for the app.
   */
  emailSender?: { enabled?: boolean; extraJobs?: Record<string, BillingEmailJobDefinition> };
  /** Per-email switches. Default: every email on. */
  emails?: Partial<Record<BillingEmailKey, boolean>>;
  /** Keep full access while Stripe retries a failed renewal, for GMs who have paid before. Default on. */
  failedCardGrace?: boolean;
  /** Days between a subscription ending and the company's deletion date. Default 30. */
  deletion?: { afterSubscriptionEndedDays?: number };
  /** App-relative paths used in billing emails. */
  links?: Partial<BillingLinks>;
}

export type ResolvedBillingConfig = {
  emailSender: { enabled: boolean; extraJobs: Record<string, BillingEmailJobDefinition> };
  emails: Record<BillingEmailKey, boolean>;
  failedCardGrace: boolean;
  deletion: { afterSubscriptionEndedDays: number };
  links: BillingLinks;
};

export const DEFAULT_BILLING_CONFIG: ResolvedBillingConfig = {
  emailSender: { enabled: false, extraJobs: {} },
  emails: { paymentFailed: true, cardExpiring: true, subscriptionEnded: true },
  failedCardGrace: true,
  deletion: { afterSubscriptionEndedDays: 30 },
  links: {
    billing: "/settings/billing",
    paymentMethod: "/settings/billing",
    subscribe: "/settings/billing?action=subscribe",
    resubscribe: "/settings/billing",
  },
};

export const BILLING_CONFIG = Symbol("BILLING_CONFIG");

/**
 * Merges an app's billing config over the defaults, key by key: a partial
 * `emails` or `links` object keeps every key it does not name.
 */
export function resolveBillingConfig(config?: BillingModuleConfig): ResolvedBillingConfig {
  return {
    emailSender: {
      enabled: config?.emailSender?.enabled ?? DEFAULT_BILLING_CONFIG.emailSender.enabled,
      extraJobs: { ...DEFAULT_BILLING_CONFIG.emailSender.extraJobs, ...(config?.emailSender?.extraJobs ?? {}) },
    },
    emails: { ...DEFAULT_BILLING_CONFIG.emails, ...stripUndefined(config?.emails) },
    failedCardGrace: config?.failedCardGrace ?? DEFAULT_BILLING_CONFIG.failedCardGrace,
    deletion: {
      afterSubscriptionEndedDays:
        config?.deletion?.afterSubscriptionEndedDays ?? DEFAULT_BILLING_CONFIG.deletion.afterSubscriptionEndedDays,
    },
    links: { ...DEFAULT_BILLING_CONFIG.links, ...stripUndefined(config?.links) },
  };
}

function stripUndefined<T extends object>(value?: T): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
