import * as Handlebars from "handlebars";

/**
 * Renders a date or ISO 8601 string as "9 August 2026 at 14:32 UTC".
 *
 * Handlebars passes its options object as the final argument, so any leading
 * string in `rest` is the caller's timezone override. UTC is the default: the
 * recipient's zone is unknown at send time, and labelling the zone is honest
 * where silently using the server's zone is not.
 */
export function formatDateTimeHelper(value: unknown, ...rest: unknown[]): string {
  if (value === null || value === undefined || value === "") return "";

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";

  const requested = typeof rest[0] === "string" ? rest[0] : "UTC";

  const format = (timeZone: string): string =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
      timeZoneName: "short",
    }).format(date);

  try {
    return format(requested);
  } catch {
    // An unknown IANA zone makes Intl throw; a bad template argument must not
    // take down a transactional email.
    return format("UTC");
  }
}

/**
 * Registers every helper the email templates may use.
 *
 * Extracted from the EmailService constructor so consuming apps can register
 * the identical set when rendering templates outside the service (e.g. tests).
 */
export function registerEmailTemplateHelpers(handlebars: typeof Handlebars): void {
  handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  handlebars.registerHelper("concat", (...args: unknown[]) => args.slice(0, -1).join(""));
  handlebars.registerHelper("formatDateTime", formatDateTimeHelper);
}
