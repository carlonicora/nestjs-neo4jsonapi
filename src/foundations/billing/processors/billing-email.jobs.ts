import { formatEmailDate } from "../../../core/email/email.helpers";
import { BillingEmailJobDefinition } from "../interfaces/billing.config.interface";
import type { CreditWarningOffer } from "../interfaces/credit-warning.interface";

/**
 * Job types the library billing email sender handles out of the box.
 *
 * The mapping below is copied from only35's `apps/api/src/processors/email.processor.ts`
 * (every job type except the app-specific `cull-completed`), with the hard-coded
 * paths turned into the configurable `links`. `card-expiring` is new.
 */
export type LibraryBillingJobType =
  | "payment-failure"
  | "subscription-status-change"
  | "payment-success-customer"
  | "payment-success-admin"
  | "trial-ending-reminder"
  | "trial-ended"
  | "deletion-warning"
  | "subscription-cancelled"
  | "company-deleted"
  | "referral-invite"
  | "referral-reward"
  | "card-expiring"
  | "credit-warning";

export interface BillingEmailJobData {
  jobType: string;
  payload: Record<string, unknown> & { to: string; locale?: string };
}

export interface PaymentFailureEmailParams {
  to: string;
  customerName: string;
  stripeCustomerId: string;
  stripeInvoiceId?: string;
  stripePaymentIntentId?: string;
  amount?: number;
  currency?: string;
  errorMessage?: string;
  invoiceUrl?: string;
  invoiceNumber?: string;
  keepsAccess?: boolean;
  locale?: string;
}

export interface SubscriptionStatusEmailParams {
  to: string;
  customerName: string;
  stripeCustomerId: string;
  subscriptionId: string;
  status: string;
  locale?: string;
}

export interface PaymentSuccessCustomerEmailParams {
  to: string;
  customerName: string;
  stripeCustomerId: string;
  stripeInvoiceId?: string;
  stripePaymentIntentId?: string;
  amount: number;
  currency: string;
  invoiceUrl?: string;
  invoiceNumber?: string;
  isOneTimePurchase: boolean;
  locale?: string;
}

export interface PaymentSuccessAdminEmailParams {
  to: string;
  adminName: string;
  companyName: string;
  amount: number;
  currency: string;
  isOneTimePurchase: boolean;
  locale?: string;
}

export interface TrialEndingReminderEmailParams {
  to: string;
  customerName: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  trialEndDate: string;
  locale?: string;
}

export interface TrialEndedEmailParams {
  to: string;
  customerName: string;
  companyName: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  trialEndDate: string;
  dataRemovalDate: string;
  locale?: string;
}

export interface DeletionWarningEmailParams {
  to: string;
  companyName: string;
  daysRemaining: number;
  deletionDate: string;
  reason: "trial_expired" | "subscription_cancelled";
  isTrialExpired: boolean;
  isSubscriptionCancelled: boolean;
  locale?: string;
}

export interface SubscriptionCancelledEmailParams {
  to: string;
  companyName: string;
  dataRemovalDate: string;
  locale?: string;
}

export interface CompanyDeletedEmailParams {
  to: string;
  companyName: string;
  reason: "trial_expired" | "subscription_cancelled" | "immediate_deletion";
  deletionDate: string;
  locale?: string;
}

export interface ReferralInviteEmailParams {
  to: string;
  referralCode: string;
  companyName: string;
  inviterName: string;
  inviterEmail: string;
  referralUrl: string;
  locale?: string;
}

export interface ReferralRewardEmailParams {
  to: string;
  userName: string;
  tokensAwarded: number;
  locale?: string;
}

export interface CardExpiringEmailParams {
  to: string;
  customerName: string;
  stripeCustomerId: string;
  renewalDate: string;
  cardBrand: string;
  cardLast4: string;
  locale?: string;
}

export interface CreditWarningEmailParams {
  to: string;
  customerName: string;
  offer: CreditWarningOffer;
  interval: "month" | "year";
  locale: string;
}

/** Narrows the queued payload to the shape a job expects. */
function asParams<T>(payload: Record<string, unknown>): T {
  return payload as unknown as T;
}

export const LIBRARY_BILLING_EMAIL_JOBS: Record<LibraryBillingJobType, BillingEmailJobDefinition> = {
  "payment-failure": {
    template: "paymentFailure",
    toTemplateData: (payload, { appUrl, locale, links }) => {
      const params = asParams<PaymentFailureEmailParams>(payload);
      return {
        to: params.to,
        customerName: params.customerName,
        stripeInvoiceId: params.stripeInvoiceId,
        stripePaymentIntentId: params.stripePaymentIntentId,
        amount: params.amount,
        currency: params.currency,
        errorMessage: params.errorMessage,
        invoiceUrl: params.invoiceUrl,
        invoiceNumber: params.invoiceNumber,
        updatePaymentUrl: `${appUrl}${links.paymentMethod}`,
        keepsAccess: params.keepsAccess ?? false,
        locale,
      };
    },
  },

  "subscription-status-change": {
    template: "subscriptionStatusChange",
    toTemplateData: (payload, { appUrl, locale, links }) => {
      const params = asParams<SubscriptionStatusEmailParams>(payload);
      return {
        to: params.to,
        customerName: params.customerName,
        subscriptionId: params.subscriptionId,
        status: params.status,
        dashboardUrl: `${appUrl}${links.billing}`,
        locale,
      };
    },
  },

  "payment-success-customer": {
    template: "paymentSuccessCustomer",
    toTemplateData: (payload, { appUrl, locale, links }) => {
      const params = asParams<PaymentSuccessCustomerEmailParams>(payload);
      return {
        to: params.to,
        customerName: params.customerName,
        amount: params.amount,
        currency: params.currency?.toUpperCase() || "USD",
        invoiceUrl: params.invoiceUrl,
        invoiceNumber: params.invoiceNumber,
        isOneTimePurchase: params.isOneTimePurchase,
        billingDashboardUrl: `${appUrl}${links.billing}`,
        locale,
      };
    },
  },

  "payment-success-admin": {
    template: "paymentSuccessAdmin",
    toTemplateData: (payload, { locale }) => {
      const params = asParams<PaymentSuccessAdminEmailParams>(payload);
      return {
        to: params.to,
        adminName: params.adminName,
        companyName: params.companyName,
        amount: params.amount,
        currency: params.currency?.toUpperCase() || "USD",
        isOneTimePurchase: params.isOneTimePurchase,
        locale,
      };
    },
  },

  "trial-ending-reminder": {
    template: "trialEndingReminder",
    toTemplateData: (payload, { appUrl, locale, links }) => {
      const params = asParams<TrialEndingReminderEmailParams>(payload);
      return {
        to: params.to,
        customerName: params.customerName,
        trialEndDate: formatEmailDate(params.trialEndDate, locale),
        upgradeUrl: `${appUrl}${links.subscribe}`,
        locale,
      };
    },
  },

  "trial-ended": {
    template: "trialEndedWithoutPayment",
    toTemplateData: (payload, { appUrl, locale, links }) => {
      const params = asParams<TrialEndedEmailParams>(payload);
      return {
        to: params.to,
        customerName: params.customerName,
        companyName: params.companyName,
        trialEndDate: formatEmailDate(params.trialEndDate, locale),
        dataRemovalDate: formatEmailDate(params.dataRemovalDate, locale),
        upgradeUrl: `${appUrl}${links.resubscribe}`,
        locale,
      };
    },
  },

  "deletion-warning": {
    template: "deletionWarning",
    toTemplateData: (payload, { appUrl, locale, links }) => {
      const params = asParams<DeletionWarningEmailParams>(payload);

      const subject =
        params.daysRemaining === 1
          ? `Final Warning: Your ${params.companyName} data will be deleted tomorrow`
          : `Warning: Your ${params.companyName} data will be deleted in ${params.daysRemaining} days`;

      return {
        to: params.to,
        subject,
        companyName: params.companyName,
        daysRemaining: params.daysRemaining,
        deletionDate: formatEmailDate(params.deletionDate, locale),
        isTrialExpired: params.isTrialExpired,
        isSubscriptionCancelled: params.isSubscriptionCancelled,
        isFinalWarning: params.daysRemaining === 1,
        resubscribeUrl: `${appUrl}${links.resubscribe}`,
        locale,
      };
    },
  },

  "subscription-cancelled": {
    template: "subscriptionCancelled",
    toTemplateData: (payload, { appUrl, locale, links }) => {
      const params = asParams<SubscriptionCancelledEmailParams>(payload);
      return {
        to: params.to,
        companyName: params.companyName,
        dataRemovalDate: formatEmailDate(params.dataRemovalDate, locale),
        resubscribeUrl: `${appUrl}${links.resubscribe}`,
        locale,
      };
    },
  },

  "company-deleted": {
    template: "companyDeleted",
    toTemplateData: (payload, { locale }) => {
      const params = asParams<CompanyDeletedEmailParams>(payload);
      return {
        to: params.to,
        companyName: params.companyName,
        deletionDate: formatEmailDate(params.deletionDate, locale),
        isTrialExpired: params.reason === "trial_expired",
        isSubscriptionCancelled: params.reason === "subscription_cancelled",
        isImmediateDeletion: params.reason === "immediate_deletion",
        locale,
      };
    },
  },

  "referral-invite": {
    template: "referralInvite",
    toTemplateData: (payload, { locale }) => {
      const params = asParams<ReferralInviteEmailParams>(payload);
      return {
        to: params.to,
        referralCode: params.referralCode,
        companyName: params.companyName,
        inviterName: params.inviterName,
        inviterEmail: params.inviterEmail,
        referralUrl: params.referralUrl,
        locale,
      };
    },
  },

  "referral-reward": {
    template: "referralReward",
    toTemplateData: (payload, { locale }) => {
      const params = asParams<ReferralRewardEmailParams>(payload);
      return {
        to: params.to,
        userName: params.userName,
        tokensAwarded: params.tokensAwarded,
        locale,
      };
    },
  },

  "card-expiring": {
    template: "cardExpiring",
    toTemplateData: (payload, { appUrl, locale, links }) => {
      const params = asParams<CardExpiringEmailParams>(payload);
      return {
        to: params.to,
        customerName: params.customerName,
        renewalDate: formatEmailDate(params.renewalDate, locale),
        cardBrand: params.cardBrand,
        cardLast4: params.cardLast4,
        updatePaymentUrl: `${appUrl}${links.paymentMethod}`,
        locale,
      };
    },
  },

  "credit-warning": {
    template: "creditWarning",
    toTemplateData: (payload, { appUrl, locale, links }) => {
      const params = asParams<CreditWarningEmailParams>(payload);
      return {
        to: params.to,
        customerName: params.customerName,
        offerSubscribe: params.offer === "subscribe",
        offerUpgrade: params.offer === "upgrade-or-pack",
        offerPack: params.offer === "pack",
        isYearly: params.interval === "year",
        changePlanUrl: `${appUrl}${links.changePlan}`,
        buyCreditsUrl: `${appUrl}${links.buyCredits}`,
        locale,
      };
    },
  },
};
