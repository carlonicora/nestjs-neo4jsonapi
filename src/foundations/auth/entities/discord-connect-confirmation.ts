import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { discordConnectConfirmationMeta } from "./discord-connect-confirmation.meta";

/**
 * The outcome of confirming one Discord connect:
 * - `connected`: the Discord account is on this user (now or already);
 * - `taken`: it is on another user;
 * - `already`: this user has a different Discord account;
 * - `failed`: unknown token, another user's intent, nothing attached, or a held lock.
 */
export type DiscordConnectResult = "connected" | "taken" | "already" | "failed";

/**
 * The outcome of confirming one Discord connect. Never stored.
 * `id` is the confirmation token the callback handed to the browser.
 */
export type DiscordConnectConfirmation = Entity & {
  result: DiscordConnectResult;
  discordName?: string;
};

export const DiscordConnectConfirmationDescriptor = defineEntity<DiscordConnectConfirmation>()({
  ...discordConnectConfirmationMeta,

  // Not persisted, never joined to a Company.
  isCompanyScoped: false,
  tenancy: "internal",

  fields: {
    result: { type: "string" },
    discordName: { type: "string" },
  },

  relationships: {},
});

export type DiscordConnectConfirmationDescriptorType = typeof DiscordConnectConfirmationDescriptor;
