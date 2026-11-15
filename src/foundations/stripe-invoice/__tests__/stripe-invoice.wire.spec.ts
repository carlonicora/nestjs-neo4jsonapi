import { describe, expect, it, vi } from "vitest";
import { ClsService } from "nestjs-cls";
import { DateTime, int } from "neo4j-driver";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { StripeInvoiceDescriptor } from "../entities/stripe-invoice";

/**
 * Wire contract of a StripeInvoice, captured from the hand-written model, map and serialiser
 * BEFORE they were converted to a descriptor (WYR-98). Every value below was produced by the old
 * code; the converted code must produce the same JSON:API wire document.
 *
 * Single allowance (plan decision 2026-11-15): on the sparse invoice the six nullable attributes
 * may change from null to absent. Nothing else may change.
 */

const NULLABLE_ATTRIBUTES = [
  "stripeInvoiceNumber",
  "stripeHostedInvoiceUrl",
  "stripePdfUrl",
  "tax",
  "dueDate",
  "paidAt",
] as const;

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

/** Node properties as the Neo4j driver returns them for a fully populated paid invoice. */
const FULL_PROPERTIES = {
  id: "inv-full",
  createdAt: utc("2026-10-14T09:00:00.000Z"),
  updatedAt: utc("2026-10-14T09:05:00.000Z"),
  stripeInvoiceId: "in_full",
  stripeInvoiceNumber: "INV-0001",
  stripeHostedInvoiceUrl: "https://invoice.stripe.com/i/in_full",
  stripePdfUrl: "https://pay.stripe.com/invoice/in_full/pdf",
  status: "paid",
  currency: "eur",
  amountDue: int(1098),
  amountPaid: int(1098),
  amountRemaining: int(0),
  subtotal: int(900),
  total: int(1098),
  tax: int(198),
  periodStart: utc("2026-10-14T09:00:00.000Z"),
  periodEnd: utc("2026-11-14T09:00:00.000Z"),
  dueDate: utc("2026-10-21T09:00:00.000Z"),
  paidAt: utc("2026-10-14T09:04:00.000Z"),
  attemptCount: int(1),
  attempted: true,
};

/** A stored invoice without number, URLs, tax, due date and payment date. */
const SPARSE_PROPERTIES = {
  id: "inv-sparse",
  createdAt: utc("2026-09-01T08:00:00.000Z"),
  updatedAt: utc("2026-09-01T08:00:00.000Z"),
  stripeInvoiceId: "in_sparse",
  status: "open",
  currency: "usd",
  amountDue: int(500),
  amountPaid: int(0),
  amountRemaining: int(500),
  subtotal: int(500),
  total: int(500),
  periodStart: utc("2026-09-01T08:00:00.000Z"),
  periodEnd: utc("2026-09-01T08:00:00.000Z"),
  attemptCount: int(0),
  attempted: false,
};

/** A record carrying only the stripeInvoice column, as every customer-facing finder returns. */
const recordOf = (properties: Record<string, unknown>) => {
  const columns: Record<string, unknown> = {
    stripeInvoice: { labels: ["StripeInvoice"], properties },
  };
  return {
    keys: Object.keys(columns),
    has: (key: string) => key in columns,
    get: (key: string) => columns[key],
  };
};

const mapRecord = (properties: Record<string, unknown>) => {
  const record = recordOf(properties);
  const node = record.get("stripeInvoice") as { labels: string[]; properties: Record<string, unknown> };
  return StripeInvoiceDescriptor.model.mapper({
    data: { ...node.properties, labels: node.labels },
    record,
    entityFactory: {} as any,
  });
};

const serialiseToWire = async (entities: any[]) => {
  const configService = { get: vi.fn(() => ({ url: "https://api.test/" })) } as any;
  const factory: any = {
    create: (model: any) => {
      if (model.type !== StripeInvoiceDescriptor.model.type) return { create: () => ({}) };
      const Serialiser = model.serialiser as any;
      return Serialiser.length >= 3
        ? new Serialiser(factory, { get: vi.fn() }, configService)
        : new Serialiser(factory, configService);
    },
  };
  const service = new JsonApiService(
    factory,
    { get: vi.fn(), has: vi.fn(() => false), isActive: vi.fn(() => false) } as unknown as ClsService,
    configService,
  );
  const document = await service.buildList(StripeInvoiceDescriptor.model, entities, new JsonApiPaginator());
  return JSON.parse(JSON.stringify(document.data));
};

const EXPECTED_FULL = {
  type: "stripe-invoices",
  id: "inv-full",
  links: { self: "https://api.test/stripe-invoices/inv-full" },
  attributes: {
    stripeInvoiceId: "in_full",
    stripeInvoiceNumber: "INV-0001",
    stripeHostedInvoiceUrl: "https://invoice.stripe.com/i/in_full",
    stripePdfUrl: "https://pay.stripe.com/invoice/in_full/pdf",
    status: "paid",
    currency: "eur",
    amountDue: 1098,
    amountPaid: 1098,
    amountRemaining: 0,
    subtotal: 900,
    total: 1098,
    tax: 198,
    periodStart: "2026-10-14T09:00:00.000Z",
    periodEnd: "2026-11-14T09:00:00.000Z",
    dueDate: "2026-10-21T09:00:00.000Z",
    paidAt: "2026-10-14T09:04:00.000Z",
    attemptCount: 1,
    attempted: true,
  },
  meta: {
    createdAt: "2026-10-14T09:00:00.000Z",
    updatedAt: "2026-10-14T09:05:00.000Z",
  },
};

const EXPECTED_SPARSE = {
  type: "stripe-invoices",
  id: "inv-sparse",
  links: { self: "https://api.test/stripe-invoices/inv-sparse" },
  attributes: {
    stripeInvoiceId: "in_sparse",
    stripeInvoiceNumber: null,
    stripeHostedInvoiceUrl: null,
    stripePdfUrl: null,
    status: "open",
    currency: "usd",
    amountDue: 500,
    amountPaid: 0,
    amountRemaining: 500,
    subtotal: 500,
    total: 500,
    tax: null,
    periodStart: "2026-09-01T08:00:00.000Z",
    periodEnd: "2026-09-01T08:00:00.000Z",
    attemptCount: 0,
    attempted: false,
  },
  meta: {
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
  },
};

const withoutNullable = (resource: any) => {
  const attributes = { ...resource.attributes };
  for (const key of NULLABLE_ATTRIBUTES) delete attributes[key];
  return { ...resource, attributes };
};

describe("StripeInvoice wire contract", () => {
  it("serialises a fully populated invoice exactly as before the conversion", async () => {
    const [wire] = await serialiseToWire([mapRecord(FULL_PROPERTIES)]);

    expect(wire).toEqual(EXPECTED_FULL);
  });

  it("serialises a sparse invoice as before, the six nullable attributes null or absent", async () => {
    const [wire] = await serialiseToWire([mapRecord(SPARSE_PROPERTIES)]);

    expect(withoutNullable(wire)).toEqual(withoutNullable(EXPECTED_SPARSE));
    for (const key of NULLABLE_ATTRIBUTES) {
      const absentOrNull = !(key in wire.attributes) || wire.attributes[key] === null;
      expect(absentOrNull, `${key} must be null or absent`).toBe(true);
    }
  });

  it("puts neither the customer nor the subscription on the wire (kept quirk)", async () => {
    const wires = await serialiseToWire([mapRecord(FULL_PROPERTIES), mapRecord(SPARSE_PROPERTIES)]);

    for (const wire of wires) {
      expect(wire).not.toHaveProperty("relationships");
    }
  });
});
