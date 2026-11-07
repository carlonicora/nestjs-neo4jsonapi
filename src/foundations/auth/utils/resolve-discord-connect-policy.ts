import { ModuleRef } from "@nestjs/core";
import { DISCORD_CONNECT_POLICY, DiscordConnectPolicyInterface } from "../interfaces/discord-connect-policy.interface";

/**
 * Resolves the optional application-provided Discord connect policy hook.
 * Call at use time, never in a constructor (moduleRef.get in a constructor can capture a placeholder).
 *
 * @returns The hook, or undefined when the application provides none
 */
export function resolveDiscordConnectPolicy(moduleRef: ModuleRef): DiscordConnectPolicyInterface | undefined {
  try {
    return moduleRef.get(DISCORD_CONNECT_POLICY, { strict: false });
  } catch {
    return undefined;
  }
}
