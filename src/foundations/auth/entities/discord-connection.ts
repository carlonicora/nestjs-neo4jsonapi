import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { discordConnectionMeta } from "./discord-connection.meta";

/**
 * Whether a user has a Discord account linked, and its name. A read-only projection of the
 * User node: `id` is the user id. Read only for the caller's own id.
 */
export type DiscordConnection = Entity & {
  /** The user has a DiscordUser. */
  connected: boolean;
  /** DiscordUser.name when connected (not "name": the User node has its own name). */
  discordName?: string;
};

export const DiscordConnectionDescriptor = defineEntity<DiscordConnection>()({
  ...discordConnectionMeta,

  isCompanyScoped: false,
  tenancy: "internal",
  // Another view of the label: the library UserDescriptor owns User.
  isProjection: true,

  fields: {
    connected: { type: "boolean" },
    discordName: { type: "string" },
  },

  computed: {
    connected: {
      compute: (params) => Boolean(params.record?.has?.("connected") && params.record.get("connected")),
    },
    discordName: {
      compute: (params) => {
        if (!params.record?.has?.("discordName")) return undefined;
        const name = params.record.get("discordName");
        return typeof name === "string" ? name : undefined;
      },
    },
  },

  relationships: {},
});

export type DiscordConnectionDescriptorType = typeof DiscordConnectionDescriptor;
