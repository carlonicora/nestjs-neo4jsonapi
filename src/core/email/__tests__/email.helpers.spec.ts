import { describe, expect, it, vi } from "vitest";
import {
  emailDateLocale,
  formatDateTimeHelper,
  formatEmailDate,
  formatEmailDateTime,
  registerEmailTemplateHelpers,
} from "../email.helpers";

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

describe("formatDateTimeHelper with @locale", () => {
  const withLocale = (locale: unknown) => ({ name: "formatDateTime", hash: {}, data: { locale } });

  it("formats in Italian when the render's @locale is it", () => {
    const out = formatDateTimeHelper("2026-08-09T14:32:05.000Z", withLocale("it"));
    expect(out).toContain("9 agosto 2026");
    expect(out).toContain("14:32 UTC");
    expect(out).not.toContain("August");
  });

  it("keeps the en-GB output byte-identical when @locale is en", () => {
    expect(formatDateTimeHelper("2026-08-09T14:32:05.000Z", withLocale("en"))).toBe("9 August 2026 at 14:32 UTC");
  });

  it("keeps the en-GB output when @locale is missing or not a string", () => {
    expect(formatDateTimeHelper("2026-08-09T14:32:05.000Z", withLocale(undefined))).toBe("9 August 2026 at 14:32 UTC");
    expect(formatDateTimeHelper("2026-08-09T14:32:05.000Z", withLocale(42))).toBe("9 August 2026 at 14:32 UTC");
  });

  it("combines @locale with an explicit timezone argument", () => {
    const out = formatDateTimeHelper("2026-08-09T14:32:05.000Z", "Europe/Rome", withLocale("it"));
    expect(out).toContain("9 agosto 2026");
    expect(out).toContain("16:32");
  });
});

describe("emailDateLocale", () => {
  it("maps English and no locale to en-GB", () => {
    expect(emailDateLocale(undefined)).toBe("en-GB");
    expect(emailDateLocale("")).toBe("en-GB");
    expect(emailDateLocale("en")).toBe("en-GB");
  });

  it("keeps a supported language", () => {
    expect(emailDateLocale("it")).toBe("it");
  });

  it("falls back to en-GB for a malformed tag", () => {
    expect(emailDateLocale("not a locale!")).toBe("en-GB");
  });
});

describe("formatEmailDateTime", () => {
  it("matches the helper's English output", () => {
    expect(formatEmailDateTime("2026-08-09T14:32:05.000Z")).toBe("9 August 2026 at 14:32 UTC");
    expect(formatEmailDateTime("2026-08-09T14:32:05.000Z", "en")).toBe("9 August 2026 at 14:32 UTC");
  });

  it("formats in Italian", () => {
    expect(formatEmailDateTime("2026-08-09T14:32:05.000Z", "it")).toContain("9 agosto 2026");
  });

  it("returns an empty string for an unparseable value", () => {
    expect(formatEmailDateTime("nope", "it")).toBe("");
  });
});

describe("formatEmailDate", () => {
  it("formats a calendar day in English", () => {
    expect(formatEmailDate(new Date("2026-08-09T23:30:00.000Z"), "en")).toBe("9 August 2026");
  });

  it("formats a calendar day in Italian", () => {
    expect(formatEmailDate("2026-08-09T00:00:00.000Z", "it")).toBe("9 agosto 2026");
  });

  it("returns an empty string for empty or unparseable values", () => {
    expect(formatEmailDate(undefined, "it")).toBe("");
    expect(formatEmailDate("nope", "it")).toBe("");
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
