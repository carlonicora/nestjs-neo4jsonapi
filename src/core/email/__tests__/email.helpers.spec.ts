import { describe, expect, it, vi } from "vitest";
import { formatDateTimeHelper, registerEmailTemplateHelpers } from "../email.helpers";

describe("formatDateTimeHelper", () => {
  // Handlebars always appends its options object as the final argument, so the
  // helper is always called with at least one trailing non-string value.
  const options = { name: "formatDateTime", hash: {} };

  it("formats an ISO string in UTC by default", () => {
    expect(formatDateTimeHelper("2026-08-09T14:32:05.000Z", options)).toBe("9 August 2026 at 14:32 UTC");
  });

  it("formats a Date instance", () => {
    expect(formatDateTimeHelper(new Date("2026-08-09T14:32:05.000Z"), options)).toBe("9 August 2026 at 14:32 UTC");
  });

  it("honours an explicit timezone argument", () => {
    expect(formatDateTimeHelper("2026-08-09T14:32:05.000Z", "Europe/Rome", options)).toBe(
      "9 August 2026 at 16:32 CEST",
    );
  });

  it("returns an empty string for undefined", () => {
    expect(formatDateTimeHelper(undefined, options)).toBe("");
  });

  it("returns an empty string for null", () => {
    expect(formatDateTimeHelper(null, options)).toBe("");
  });

  it("returns an empty string for an unparseable value", () => {
    expect(formatDateTimeHelper("not a date", options)).toBe("");
  });

  it("falls back to UTC when the timezone argument is invalid", () => {
    expect(formatDateTimeHelper("2026-08-09T14:32:05.000Z", "Not/AZone", options)).toBe("9 August 2026 at 14:32 UTC");
  });
});

describe("registerEmailTemplateHelpers", () => {
  it("registers eq, concat and formatDateTime on the given Handlebars instance", () => {
    const handlebars = { registerHelper: vi.fn() };
    registerEmailTemplateHelpers(handlebars as never);

    const names = handlebars.registerHelper.mock.calls.map((call) => call[0]);
    expect(names).toEqual(expect.arrayContaining(["eq", "concat", "formatDateTime"]));
  });
});
