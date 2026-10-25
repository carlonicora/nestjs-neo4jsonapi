/**
 * The three billing emails an app can switch off one by one.
 */
export type BillingEmailKey = "paymentFailed" | "cardExpiring" | "subscriptionEnded";

/**
 * App-relative paths the billing emails link to. The sender prefixes each with
 * the app URL (`app.url`, trailing slash removed).
 */
export type BillingLinks = {
  billing: string;
  paymentMethod: string;
  subscribe: string;
  resubscribe: string;
  /** Opens plan change on the current subscription (credit warning: subscribe / move up a plan). */
  changePlan: string;
  /** Opens credit pack purchase (credit warning: add a credit pack). */
  buyCredits: string;
};

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
  /**
   * Warn a company once per credit period, in the app and by email, when its
   * credits left fall to `100 - thresholdPercent`% of what it was granted.
   * OFF by default: with it off nothing runs and no Company field is written.
   * `thresholdPercent` defaults to 80.
   */
  creditWarning?: { enabled?: boolean; thresholdPercent?: number };
}

export type ResolvedBillingConfig = {
  emailSender: { enabled: boolean; extraJobs: Record<string, BillingEmailJobDefinition> };
  emails: Record<BillingEmailKey, boolean>;
  failedCardGrace: boolean;
  deletion: { afterSubscriptionEndedDays: number };
  links: BillingLinks;
  creditWarning: { enabled: boolean; thresholdPercent: number };
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
    changePlan: "/settings/billing?action=change-plan",
    buyCredits: "/settings/billing?action=subscribe",
  },
  creditWarning: { enabled: false, thresholdPercent: 80 },
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
    creditWarning: {
      enabled: config?.creditWarning?.enabled ?? DEFAULT_BILLING_CONFIG.creditWarning.enabled,
      thresholdPercent:
        config?.creditWarning?.thresholdPercent ?? DEFAULT_BILLING_CONFIG.creditWarning.thresholdPercent,
    },
  };
}

function stripUndefined<T extends object>(value?: T): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
