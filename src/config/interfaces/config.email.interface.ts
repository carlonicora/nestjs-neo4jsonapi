export interface ConfigEmailInterface {
  emailProvider: "sendgrid" | "smtp" | "brevo";
  emailApiKey?: string;
  emailFrom: string;
  emailHost: string;
  emailPort: number;
  emailSecure: boolean;
  emailUsername: string;
  emailPassword: string;
  /**
   * Locale used as the template fallback when the requested locale has no
   * template file. Default "en" (historical behaviour). Set to the product's
   * primary language (e.g. "it") when app templates exist only in that locale.
   */
  defaultLocale?: string;
}
