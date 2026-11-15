import { describe, expect, it, vi } from "vitest";
import { ClsService } from "nestjs-cls";
import { DateTime, int } from "neo4j-driver";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { StripeInvoiceDescriptor } from "../stripe-invoice";

const utc = (iso: string) => {
  const d = new Date(iso);
  return new DateTime(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds() * 1_000_000,
    0,
  );
};

const PROPERTIES = {
  id: "inv-1",
  createdAt: utc("2026-10-14T09:00:00.000Z"),
  updatedAt: utc("2026-10-14T09:00:00.000Z"),
  stripeInvoiceId: "in_1",
  status: "paid",
  currency: "eur",
  amountDue: int(900),
  amountPaid: int(900),
  amountRemaining: int(0),
  subtotal: int(900),
  total: int(900),
  periodStart: utc("2026-10-14T09:00:00.000Z"),
  periodEnd: utc("2026-10-14T09:00:00.000Z"),
  servicePeriodStart: utc("2026-10-14T09:00:00.000Z"),
  servicePeriodEnd: utc("2026-11-14T09:00:00.000Z"),
  serviceLinesCheckedAt: utc("2026-11-15T10:00:00.000Z"),
  attemptCount: int(1),
  attempted: true,
};

const recordOf = (columns: Record<string, unknown>) => ({
  keys: Object.keys(columns),
  has: (key: string) => key in columns,
  get: (key: string) => columns[key],
});

const map = (columns: Record<string, unknown>) =>
  StripeInvoiceDescriptor.model.mapper({
    data: { ...PROPERTIES, labels: ["StripeInvoice"] },
    record: recordOf({ stripeInvoice: { labels: ["StripeInvoice"], properties: PROPERTIES }, ...columns }),
    entityFactory: {} as any,
  });

describe("StripeInvoiceDescriptor", () => {
  it("maps the covered period to dates", () => {
    const invoice = map({});

    expect(invoice.servicePeriodStart).toEqual(new Date("2026-10-14T09:00:00.000Z"));
    expect(invoice.servicePeriodEnd).toEqual(new Date("2026-11-14T09:00:00.000Z"));
  });

  it("reads forSubscription from the record only when the column is there", () => {
    expect(map({ forSubscription: true }).forSubscription).toBe(true);
    expect(map({ forSubscription: false }).forSubscription).toBe(false);
    expect(map({}).forSubscription).toBeUndefined();
  });

  it("declares the stripePrice relationship over FOR_PRICE, out, one, optional", () => {
    expect(StripeInvoiceDescriptor.relationships.stripePrice).toMatchObject({
      direction: "out",
      relationship: "FOR_PRICE",
      cardinality: "one",
      required: false,
    });
    expect(StripeInvoiceDescriptor.relationships.stripePrice.model.labelName).toBe("StripePrice");
  });

  it("serialises the covered period and forSubscription but never serviceLinesCheckedAt", async () => {
    const configService = { get: vi.fn(() => ({ url: "https://api.test/" })) } as any;
    const factory: any = {
      create: (model: any) => {
        if (model.type !== StripeInvoiceDescriptor.model.type) return { create: () => ({}) };
        const Serialiser = model.serialiser as any;
        return new Serialiser(factory, { get: vi.fn() }, configService);
      },
    };
    const service = new JsonApiService(
      factory,
      { get: vi.fn(), has: vi.fn(() => false), isActive: vi.fn(() => false) } as unknown as ClsService,
      configService,
    );

    const document = await service.buildList(StripeInvoiceDescriptor.model, [map({ forSubscription: true })]);
    const wire = JSON.parse(JSON.stringify(document.data[0]));

    expect(wire.attributes.servicePeriodStart).toBe("2026-10-14T09:00:00.000Z");
    expect(wire.attributes.servicePeriodEnd).toBe("2026-11-14T09:00:00.000Z");
    expect(wire.attributes.forSubscription).toBe(true);
    expect(wire.attributes).not.toHaveProperty("serviceLinesCheckedAt");
    expect(wire.meta ?? {}).not.toHaveProperty("serviceLinesCheckedAt");
    expect(JSON.stringify(wire)).not.toContain("serviceLinesCheckedAt");
  });
});
