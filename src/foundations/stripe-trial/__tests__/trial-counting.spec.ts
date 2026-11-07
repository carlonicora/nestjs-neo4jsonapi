import { describe, expect, it } from "vitest";
import type { StripeSubscription } from "../../stripe-subscription/entities/stripe-subscription";
import { isCountingTrialSubscription } from "../trial-counting";

type Case = Pick<StripeSubscription, "status" | "trialEnd">;

describe("isCountingTrialSubscription", () => {
  const cases: Array<[Case, boolean]> = [
    [{ status: "trialing" }, true],
    [{ status: "active" }, true],
    [{ status: "past_due" }, true],
    [{ status: "unpaid" }, true],
    [{ status: "paused" }, true],
    [{ status: "canceled", trialEnd: new Date() }, true],
    [{ status: "canceled" }, false],
    [{ status: "incomplete" }, false],
    [{ status: "incomplete_expired" }, false],
  ];

  it.each(cases)(
    "isCountingTrialSubscription counts trialing, active, past_due, unpaid, paused and any subscription with a trialEnd (%o → %s)",
    (subscription, expected) => {
      expect(isCountingTrialSubscription(subscription)).toBe(expected);
    },
  );
});
