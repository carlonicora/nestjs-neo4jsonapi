import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { isProrationLine, readServiceLines } from "../invoice-service-lines";

const line = (overrides: Record<string, unknown> = {}): Stripe.InvoiceLineItem =>
  ({
    id: "il_1",
    object: "line_item",
    period: { start: 1_760_000_000, end: 1_762_592_000 },
    pricing: { type: "price_details", price_details: { price: "price_monthly", product: "prod_1" } },
    parent: { type: "subscription_item_details", subscription_item_details: { proration: false } },
    ...overrides,
  }) as unknown as Stripe.InvoiceLineItem;

const invoice = (lines: Stripe.InvoiceLineItem[], payments?: unknown): Stripe.Invoice =>
  ({
    id: "in_1",
    object: "invoice",
    lines: { object: "list", data: lines, has_more: false, url: "/v1/invoices/in_1/lines" },
    ...(payments !== undefined ? { payments } : {}),
  }) as unknown as Stripe.Invoice;

describe("isProrationLine", () => {
  it("reads the flag from parent.subscription_item_details", () => {
    expect(
      isProrationLine(
        line({ parent: { type: "subscription_item_details", subscription_item_details: { proration: true } } }),
      ),
    ).toBe(true);
    expect(isProrationLine(line())).toBe(false);
  });

  it("reads the flag from parent.invoice_item_details", () => {
    expect(
      isProrationLine(line({ parent: { type: "invoice_item_details", invoice_item_details: { proration: true } } })),
    ).toBe(true);
  });

  it("falls back to the legacy line-level flag", () => {
    expect(isProrationLine(line({ parent: null, proration: true }))).toBe(true);
    expect(isProrationLine(line({ parent: null }))).toBe(false);
  });
});

describe("readServiceLines", () => {
  it("takes period and price from the first line that is not a proration", () => {
    const result = readServiceLines(
      invoice([
        line({
          id: "il_proration",
          period: { start: 1, end: 2 },
          pricing: { type: "price_details", price_details: { price: "price_old", product: "prod_1" } },
          parent: { type: "subscription_item_details", subscription_item_details: { proration: true } },
        }),
        line({ id: "il_plan" }),
      ]),
    );

    expect(result.periodStart).toEqual(new Date(1_760_000_000 * 1000));
    expect(result.periodEnd).toEqual(new Date(1_762_592_000 * 1000));
    expect(result.stripePriceId).toBe("price_monthly");
  });

  it("reads an expanded price object by its id", () => {
    const result = readServiceLines(
      invoice([
        line({ pricing: { type: "price_details", price_details: { price: { id: "price_yearly" }, product: "p" } } }),
      ]),
    );

    expect(result.stripePriceId).toBe("price_yearly");
  });

  it("gives no period and no price for an all-proration invoice", () => {
    const result = readServiceLines(
      invoice([
        line({ parent: { type: "subscription_item_details", subscription_item_details: { proration: true } } }),
        line({ parent: null, proration: true }),
      ]),
    );

    expect(result.periodStart).toBeUndefined();
    expect(result.periodEnd).toBeUndefined();
    expect(result.stripePriceId).toBeUndefined();
  });

  it("gives no price when the line has no pricing", () => {
    const result = readServiceLines(invoice([line({ pricing: null })]));

    expect(result.periodStart).toEqual(new Date(1_760_000_000 * 1000));
    expect(result.stripePriceId).toBeUndefined();
  });

  it("reads the payment intent id from the first payment, as a string or an object", () => {
    const asString = readServiceLines(
      invoice([line()], { object: "list", data: [{ payment: { type: "payment_intent", payment_intent: "pi_1" } }] }),
    );
    const asObject = readServiceLines(
      invoice([line()], {
        object: "list",
        data: [{ payment: { type: "payment_intent", payment_intent: { id: "pi_2" } } }],
      }),
    );

    expect(asString.paymentIntentId).toBe("pi_1");
    expect(asObject.paymentIntentId).toBe("pi_2");
  });

  it("gives no payment intent id when the invoice has no payments", () => {
    expect(readServiceLines(invoice([line()])).paymentIntentId).toBeUndefined();
    expect(readServiceLines(invoice([line()], { object: "list", data: [] })).paymentIntentId).toBeUndefined();
  });

  it("handles an invoice without lines", () => {
    const result = readServiceLines({ id: "in_1", object: "invoice" } as unknown as Stripe.Invoice);

    expect(result).toEqual({
      periodStart: undefined,
      periodEnd: undefined,
      stripePriceId: undefined,
      paymentIntentId: undefined,
    });
  });
});
