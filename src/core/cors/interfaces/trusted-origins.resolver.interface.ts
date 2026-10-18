/**
 * Injection token for an application-provided source of extra trusted origins.
 *
 * The package consults it, when bound, on top of the static CORS configuration:
 * `CorsService` asks `isTrusted()` for an origin the configured lists reject, and
 * `S3Controller` adds `listOrigins()` to the `frame-ancestors` of a downloaded object.
 * When nothing is bound, behaviour is unchanged.
 */
export const TRUSTED_ORIGINS_RESOLVER = "TRUSTED_ORIGINS_RESOLVER";

export interface TrustedOriginsResolver {
  /** True when `origin` (scheme://host[:port]) is trusted by the application. */
  isTrusted(origin: string): Promise<boolean>;
  /** Every origin the application currently trusts, as scheme://host[:port]. */
  listOrigins(): Promise<string[]>;
}
