/**
 * Selects which AI model tier a call should use.
 *
 * Each weight maps to a config block resolved from environment variables:
 * - `Lite`   → `AI_*_LITE`  (falls back field-by-field to `AI_*`)
 * - `Normal` → `AI_*`       (the default tier)
 * - `Large`  → `AI_*_LARGE` (falls back field-by-field to `AI_*`)
 *
 * Omitting the weight is equivalent to `Normal`.
 */
export enum ModelWeight {
  Lite = "lite",
  Normal = "normal",
  Large = "large",
}
