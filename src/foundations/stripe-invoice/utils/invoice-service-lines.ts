import Stripe from "stripe";

/**
 * Whether an invoice line is a proration. Current Stripe API versions carry the flag
 * under `parent.*_item_details`; older ones put it on the line itself.
 */
export function isProrationLine(line: Stripe.InvoiceLineItem): boolean {
  return (
    line.parent?.subscription_item_details?.proration ??
    line.parent?.invoice_item_details?.proration ??
    (line as any).proration === true
  );
}

/**
 * What an invoice was for, read from its first line that is not a proration: the covered period
 * and the Stripe price id of that line, plus the id of the PaymentIntent that paid the invoice
 * (first payment). An all-proration invoice gives no period and no price.
 */
export function readServiceLines(invoice: Stripe.Invoice): {
  periodStart?: Date;
  periodEnd?: Date;
  stripePriceId?: string;
  paymentIntentId?: string;
} {
  const line = (invoice.lines?.data ?? []).find((candidate) => !isProrationLine(candidate));

  const price = line?.pricing?.price_details?.price;
  const stripePriceId = typeof price === "string" ? price : price?.id;

  const paymentIntent = invoice.payments?.data?.[0]?.payment?.payment_intent;
  const paymentIntentId = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;

  return {
    periodStart: line ? new Date(line.period.start * 1000) : undefined,
    periodEnd: line ? new Date(line.period.end * 1000) : undefined,
    stripePriceId,
    paymentIntentId,
  };
}
