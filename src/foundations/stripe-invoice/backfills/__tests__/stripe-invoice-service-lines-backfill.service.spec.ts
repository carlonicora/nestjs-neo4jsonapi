import { beforeEach, describe, expect, it, vi, type Mocked } from "vitest";
import type { RedisLockService } from "../../../../core/redis/services/redis.lock.service";
import Stripe from "stripe";
import { StripeInvoiceServiceLinesBackfillService } from "../stripe-invoice-service-lines-backfill.service";

const stripeInvoice = (id: string) => ({ id, object: "invoice" }) as unknown as Stripe.Invoice;

describe("StripeInvoiceServiceLinesBackfillService", () => {
  let stripeService: { isConfigured: ReturnType<typeof vi.fn> };
  let api: { getInvoice: ReturnType<typeof vi.fn> };
  let invoiceRepository: { findWithoutServiceLines: ReturnType<typeof vi.fn> };
  let adminService: { recordServiceLinesFromStripe: ReturnType<typeof vi.fn> };
  let cls: { run: ReturnType<typeof vi.fn> };
  let logger: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let service: StripeInvoiceServiceLinesBackfillService;

  beforeEach(() => {
    stripeService = { isConfigured: vi.fn().mockReturnValue(true) };
    api = { getInvoice: vi.fn(async (id: string) => stripeInvoice(id)) };
    invoiceRepository = { findWithoutServiceLines: vi.fn().mockResolvedValue(["in_a", "in_b", "in_c"]) };
    adminService = { recordServiceLinesFromStripe: vi.fn().mockResolvedValue("recorded") };
    cls = { run: vi.fn((fn: () => unknown) => fn()) };
    logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    service = new StripeInvoiceServiceLinesBackfillService(
      stripeService as any,
      api as any,
      invoiceRepository as any,
      adminService as any,
      cls as any,
      logger as any,
    );
  });

  it("is a no-op when Stripe is not configured", async () => {
    stripeService.isConfigured.mockReturnValue(false);

    const result = await service.run();

    expect(result.skipped).toBe("stripe-not-configured");
    expect(invoiceRepository.findWithoutServiceLines).not.toHaveBeenCalled();
    expect(api.getInvoice).not.toHaveBeenCalled();
    expect(adminService.recordServiceLinesFromStripe).not.toHaveBeenCalled();
  });

  it("fetches each unchecked invoice from Stripe and records its service lines", async () => {
    const result = await service.run();

    expect(api.getInvoice.mock.calls.map((call) => call[0])).toEqual(["in_a", "in_b", "in_c"]);
    expect(adminService.recordServiceLinesFromStripe).toHaveBeenCalledTimes(3);
    expect(adminService.recordServiceLinesFromStripe).toHaveBeenCalledWith(stripeInvoice("in_a"));
    expect(result).toEqual({ skipped: null, total: 3, recorded: 3, priceUnknown: 0, failed: 0 });
  });

  it("counts an invoice whose price is not stored locally, which stays unmarked for the next boot", async () => {
    adminService.recordServiceLinesFromStripe.mockResolvedValueOnce("recorded").mockResolvedValueOnce("price-unknown");

    const result = await service.run();

    expect(result.recorded).toBe(2);
    expect(result.priceUnknown).toBe(1);
  });

  it("counts a Stripe error as failed, records nothing for it and carries on", async () => {
    api.getInvoice.mockImplementation(async (id: string) => {
      if (id === "in_b") throw new Error("Stripe unavailable");
      return stripeInvoice(id);
    });

    const result = await service.run();

    expect(result.failed).toBe(1);
    expect(result.recorded).toBe(2);
    expect(adminService.recordServiceLinesFromStripe).toHaveBeenCalledTimes(2);
    expect(adminService.recordServiceLinesFromStripe).not.toHaveBeenCalledWith(stripeInvoice("in_b"));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("in_b"), expect.any(Error));
  });

  it("asks Stripe one invoice at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    api.getInvoice.mockImplementation(async (id: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return stripeInvoice(id);
    });

    await service.run();

    expect(maxInFlight).toBe(1);
  });

  it("runs inside a CLS context, since repository queries read it", async () => {
    await service.run();

    expect(cls.run).toHaveBeenCalledTimes(1);
  });

  it("starts in the background at bootstrap and never throws out of it", async () => {
    invoiceRepository.findWithoutServiceLines.mockRejectedValue(new Error("neo4j down"));

    expect(() => service.onApplicationBootstrap()).not.toThrow();
    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith("Stripe invoice service lines backfill aborted", expect.any(Error)),
    );
  });

  describe("start-up lock", () => {
    const makeLock = (runFn: boolean) => ({
      scopedKey: vi.fn<RedisLockService["scopedKey"]>((name) => `q:lock:${name}`),
      withLock: vi.fn(async (_key, _ttl, fn) => (runFn ? fn() : null)),
    });

    const make = (lock: ReturnType<typeof makeLock>) =>
      new StripeInvoiceServiceLinesBackfillService(
        stripeService as any,
        api as any,
        invoiceRepository as any,
        adminService as any,
        cls as any,
        logger as any,
        lock as unknown as RedisLockService,
      );

    it("runs through the startup:stripe-invoice-lines-backfill lock", async () => {
      const lock = makeLock(true);

      await make(lock).run();

      expect(lock.withLock).toHaveBeenCalledWith(
        "q:lock:startup:stripe-invoice-lines-backfill",
        1800,
        expect.any(Function),
        { retryOnRedisError: true },
      );
      expect(invoiceRepository.findWithoutServiceLines).toHaveBeenCalled();
    });

    it("runs nothing and reports locked when another process holds the lock", async () => {
      const lock = makeLock(false);

      const result = await make(lock).run();

      expect(result).toEqual({ skipped: "locked", total: 0, recorded: 0, priceUnknown: 0, failed: 0 });
      expect(cls.run).not.toHaveBeenCalled();
      expect(invoiceRepository.findWithoutServiceLines).not.toHaveBeenCalled();
    });
  });
});
