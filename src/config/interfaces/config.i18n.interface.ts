/**
 * Per-app opt-in for saved user languages and the AI response language.
 *
 * Disabled by default: an app that does not set it keeps English-only
 * behaviour byte-for-byte.
 */
export interface ConfigI18nInterface {
  /** Turns on saved-language resolution. Default false. */
  enabled: boolean;
  /** Languages the app supports. Default ["en"]. The first entry is the fallback. */
  supportedLanguages: string[];
}
