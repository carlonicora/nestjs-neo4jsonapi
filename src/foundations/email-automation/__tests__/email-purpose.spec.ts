import { describe, expect, it } from "vitest";
import { emailAutomationIneligibleReason, resolveEmailPurpose } from "../utils/email-purpose";

describe("resolveEmailPurpose", () => {
  it("returns service only for exactly service", () => {
    expect(resolveEmailPurpose("service")).toBe("service");
  });

  it.each([undefined, null, "marketing", "x"])("treats %s as marketing", (value) => {
    expect(resolveEmailPurpose(value)).toBe("marketing");
  });
});

describe("emailAutomationIneligibleReason", () => {
  it("marketing without consent is no_consent", () => {
    expect(
      emailAutomationIneligibleReason({
        purpose: "marketing",
        marketingConsent: false,
        optedOut: false,
        alreadyEnrolled: false,
      }),
    ).toBe("no_consent");
  });

  it("marketing opted out is opted_out, even with consent", () => {
    expect(
      emailAutomationIneligibleReason({
        purpose: "marketing",
        marketingConsent: true,
        optedOut: true,
        alreadyEnrolled: false,
      }),
    ).toBe("opted_out");
  });

  it("service ignores consent and opt-out", () => {
    expect(
      emailAutomationIneligibleReason({
        purpose: "service",
        marketingConsent: false,
        optedOut: true,
        alreadyEnrolled: false,
      }),
    ).toBeNull();
  });

  it("marketing with consent and no opt-out is eligible", () => {
    expect(
      emailAutomationIneligibleReason({
        purpose: "marketing",
        marketingConsent: true,
        optedOut: false,
        alreadyEnrolled: false,
      }),
    ).toBeNull();
  });

  it.each(["service", "marketing"] as const)("already enrolled comes first for %s", (purpose) => {
    expect(
      emailAutomationIneligibleReason({
        purpose,
        marketingConsent: false,
        optedOut: true,
        alreadyEnrolled: true,
      }),
    ).toBe("already_enrolled");
  });
});
