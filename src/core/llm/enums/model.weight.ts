/**
 * Selects which AI model tier a call should use.
 *
 * Each weight maps to a config block resolved from environment variables:
 * - `Lite`   → `AI_*_LITE`
 * - `Normal` → `AI_*`       (the default tier)
 * - `Large`  → `AI_*_LARGE`
 *
 * Every field of a tier is configurable (provider, apiKey, url, model,
 * costs, maxOutputTokens, …), so each tier can run on a different provider.
 * A tier that does NOT set its own `AI_PROVIDER_<TIER>` (or re-declares the
 * base provider) falls back field-by-field to `AI_*`; a tier that switches
 * provider is standalone and inherits nothing from the base tier.
 *
 * Omitting the weight is equivalent to `Normal`.
 */
export enum ModelWeight {
  Lite = "lite",
  Normal = "normal",
  Large = "large",
}
