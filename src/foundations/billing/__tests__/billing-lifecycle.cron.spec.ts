import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

// The cron needs only the card-expiry service contract.
vi.mock("../services/card-expiry-warning.service", () => ({
  CardExpiryWarningService: class {},
}));

import { BillingLifecycleCron } from "../cron/billing-lifecycle.cron";

const NOW = new Date("2026-11-05T10:00:00Z");

describe("BillingLifecycleCron", () => {
  let cardExpiryWarningService: { processDue: Mock };
  let logger: { log: Mock; error: Mock };

  const buildCron = () => new BillingLifecycleCron(cardExpiryWarningService as any, logger as any);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    cardExpiryWarningService = { processDue: vi.fn().mockResolvedValue({ checked: 2, warned: 1 }) };
    logger = { log: vi.fn(), error: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the card check with the current time and logs the counts", async () => {
    await buildCron().run();

    expect(cardExpiryWarningService.processDue).toHaveBeenCalledWith({ now: NOW });
    expect(logger.log).toHaveBeenCalledWith("Billing lifecycle: 2 card(s) checked, 1 warned", "BillingLifecycleCron");
  });

  it("logs a failing card check without throwing", async () => {
    cardExpiryWarningService.processDue = vi.fn().mockRejectedValue(new Error("stripe down"));

    await expect(buildCron().run()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("stripe down"), "BillingLifecycleCron");
  });
});
