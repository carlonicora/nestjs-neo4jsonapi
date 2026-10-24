import { beforeEach, describe, expect, it, vi } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

import { stripeSubscriptionMeta } from "../../entities/stripe-subscription.meta";
import { StripeSubscriptionDescriptor } from "../../entities/stripe-subscription";
import { StripeSubscriptionRepository } from "../../repositories/stripe-subscription.repository";
import { StripeSubscriptionBackfillRepository } from "../stripe-subscription-backfill.repository";

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("StripeSubscriptionBackfillRepository", () => {
  let neo4j: { readCount: ReturnType<typeof vi.fn>; writeOne: ReturnType<typeof vi.fn> };
  let repository: StripeSubscriptionBackfillRepository;

  beforeEach(() => {
    neo4j = { readCount: vi.fn(), writeOne: vi.fn().mockResolvedValue(null) };
    repository = new StripeSubscriptionBackfillRepository(neo4j as any);
  });

  it("reports a backfill completed when its marker exists", async () => {
    neo4j.readCount.mockResolvedValue(1);

    await expect(repository.isCompleted({ id: "b1" })).resolves.toBe(true);
    expect(flat(neo4j.readCount.mock.calls[0][0])).toBe(
      "MATCH (backfill:StripeSubscriptionBackfill {id: $id}) RETURN count(backfill) AS total",
    );
    expect(neo4j.readCount.mock.calls[0][1]).toEqual({ id: "b1" });
  });

  it("reports a backfill not completed when there is no marker", async () => {
    neo4j.readCount.mockResolvedValue(0);

    await expect(repository.isCompleted({ id: "b1" })).resolves.toBe(false);
  });

  it("MERGEs the marker, parameterised, so marking twice keeps one node", async () => {
    await repository.markCompleted({ id: "b1", summary: "total=1" });

    const [{ query, queryParams }] = neo4j.writeOne.mock.calls[0];
    expect(flat(query)).toBe(
      "MERGE (backfill:StripeSubscriptionBackfill {id: $id}) ON CREATE SET backfill.createdAt = datetime() SET backfill.completedAt = datetime(), backfill.summary = $summary",
    );
    expect(queryParams).toEqual({ id: "b1", summary: "total=1" });
  });
});

describe("StripeSubscriptionRepository.findAll", () => {
  it("appends to the initQuery preamble and reads every subscription that update() can reach", async () => {
    const neo4j = {
      initQuery: vi.fn().mockReturnValue({ query: "PREAMBLE", queryParams: { companyId: null } }),
      readMany: vi.fn().mockResolvedValue([]),
    };
    const cls = { get: vi.fn(() => undefined), has: vi.fn(() => false) };
    const repository = new StripeSubscriptionRepository(neo4j as any, {} as any, cls as any);

    await repository.findAll();

    expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: StripeSubscriptionDescriptor.model, fetchAll: true });
    const { query } = neo4j.readMany.mock.calls[0][0];
    const n = stripeSubscriptionMeta.nodeName;
    expect(query.startsWith("PREAMBLE")).toBe(true);
    // update() starts from the same default match, so every row read here can be updated
    expect(flat(query)).toContain(`MATCH (${n}:${stripeSubscriptionMeta.labelName}) WHERE $companyId IS NULL`);
    expect(flat(query)).toContain(`MATCH (${n})-[:BELONGS_TO]->(${n}_stripeCustomer:StripeCustomer)`);
    expect(flat(query)).toContain(`MATCH (${n})-[:USES_PRICE]->`);
    expect(query).not.toMatch(/SKIP|LIMIT|\{CURSOR\}/);
    expect(query).not.toMatch(/\bSET\b|\bDELETE\b|\bCREATE\b/);
  });
});
