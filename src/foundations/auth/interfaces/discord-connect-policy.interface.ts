/**
 * Optional hook an application provides to refuse a Discord connect for some users
 * (for example a shared demo user). Without a hook every user with a company may connect.
 */
export interface DiscordConnectPolicyInterface {
  /** Whether this user, in this company, may start connecting a Discord account. */
  canConnect(params: { userId: string; companyId: string }): Promise<boolean>;
}

/**
 * Injection token for the optional Discord connect policy hook
 */
export const DISCORD_CONNECT_POLICY = Symbol("DISCORD_CONNECT_POLICY");
