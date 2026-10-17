import * as Handlebars from "handlebars";

/**
 * The Intl locale an email date is formatted in. English (and no locale)
 * keeps the en-GB output the emails have always had ("9 August 2026");
 * any other language formats in its own conventions ("9 agosto 2026").
 */
export function emailDateLocale(locale: string | undefined): string {
  if (!locale || locale === "en") return "en-GB";
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0 ? locale : "en-GB";
  } catch {
    // A malformed language tag makes Intl throw; fall back to English.
    return "en-GB";
  }
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Renders a date or ISO 8601 string as "9 August 2026 at 14:32 UTC" (en, the
 * default) or "9 agosto 2026 alle ore 14:32 UTC" (it). Returns "" for an
 * empty or unparseable value.
 *
 * UTC is the default zone: the recipient's zone is unknown at send time, and
 * labelling the zone is honest where silently using the server's zone is not.
 * An unknown IANA zone falls back to UTC.
 */
export function formatEmailDateTime(value: unknown, locale?: string, timeZone: string = "UTC"): string {
  const date = toDate(value);
  if (!date) return "";

  const format = (zone: string): string =>
    new Intl.DateTimeFormat(emailDateLocale(locale), {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: zone,
      timeZoneName: "short",
    }).format(date);

  try {
    return format(timeZone);
  } catch {
    // A bad template argument must not take down a transactional email.
    return format("UTC");
  }
}

/**
 * Renders a calendar day as "9 August 2026" (en) or "9 agosto 2026" (it), read
 * in UTC so the day does not shift with the server's zone. Returns "" for an
 * empty or unparseable value. For callers that put a date into an email
 * without a time (trial end, data removal, deletion).
 */
export function formatEmailDate(value: unknown, locale?: string): string {
  const date = toDate(value);
  if (!date) return "";

  return new Intl.DateTimeFormat(emailDateLocale(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * The `formatDateTime` Handlebars helper: `{{formatDateTime value}}` or
 * `{{formatDateTime value "Europe/Rome"}}`.
 *
 * Handlebars passes its options object as the final argument, so any leading
 * string in `rest` is the caller's timezone override. The language comes from
 * the render's data frame (`@locale`), which EmailService.sendEmail sets to
 * the locale the email is rendered for; without it the output is English.
 */
export function formatDateTimeHelper(value: unknown, ...rest: unknown[]): string {
  const timeZone = typeof rest[0] === "string" ? rest[0] : "UTC";
  const options = rest[rest.length - 1] as { data?: { locale?: unknown } } | undefined;
  const locale = typeof options?.data?.locale === "string" ? options.data.locale : undefined;

  return formatEmailDateTime(value, locale, timeZone);
}

/**
 * Registers every helper the email templates may use.
 *
 * Extracted from the EmailService constructor so consuming apps can register
 * the identical set when rendering templates outside the service (e.g. tests).
 * To get localised dates outside the service, render with
 * `template(context, { data: { locale } })`.
 */
export function registerEmailTemplateHelpers(handlebars: typeof Handlebars): void {
  handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  handlebars.registerHelper("concat", (...args: unknown[]) => args.slice(0, -1).join(""));
  handlebars.registerHelper("formatDateTime", formatDateTimeHelper);
}
