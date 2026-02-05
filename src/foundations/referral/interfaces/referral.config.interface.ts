/**
 * Configuration interface for the ReferralModule.
 * All options are optional and have sensible defaults.
 */
export interface ReferralModuleConfig {
  /**
   * Whether the referral feature is enabled.
   * When false, all endpoints return 404 and hooks are no-ops.
   * @default false
   */
  enabled?: boolean;

  /**
   * Number of tokens awarded to both referrer and referred on completion.
   * @default 1000
   */
  rewardTokens?: number;

  /**
   * Cooldown period for referral invite emails in seconds.
   * Prevents spam by limiting how often invites can be sent to the same email.
   * @default 1209600 (14 days)
   */
  inviteCooldownSeconds?: number;
}

/**
 * Async options for ReferralModule.forRootAsync()
 */
export interface ReferralModuleAsyncOptions {
  imports?: any[];
  useFactory: (...args: any[]) => Promise<ReferralModuleConfig> | ReferralModuleConfig;
  inject?: any[];
}

/**
 * Injection token for referral configuration
 */
export const REFERRAL_CONFIG = Symbol("REFERRAL_CONFIG");

/**
 * Default configuration values
 */
export const DEFAULT_REFERRAL_CONFIG: Required<ReferralModuleConfig> = {
  enabled: false,
  rewardTokens: 1000,
  inviteCooldownSeconds: 14 * 24 * 60 * 60, // 14 days
};
