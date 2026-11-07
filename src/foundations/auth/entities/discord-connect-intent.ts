import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { discordConnectIntentMeta } from "./discord-connect-intent.meta";

/**
 * One Discord connect attempt. Lives in Redis for 600 s (`DiscordConnectIntentStore`), never in Neo4j.
 * `id` is the one-time code: a UUID the browser generates when it creates the intent.
 */
export type DiscordConnectIntent = Entity & {
  /** Sanitised before it is stored (`sanitiseReturnPath`). */
  returnPath: string;
  /** The API launch route, set when the intent is created. */
  authorizeUrl?: string;
};

export const DiscordConnectIntentDescriptor = defineEntity<DiscordConnectIntent>()({
  ...discordConnectIntentMeta,

  // Not persisted, never joined to a Company.
  isCompanyScoped: false,
  tenancy: "internal",

  fields: {
    returnPath: { type: "string", required: true },
    authorizeUrl: { type: "string" },
  },

  relationships: {},
});

export type DiscordConnectIntentDescriptorType = typeof DiscordConnectIntentDescriptor;
