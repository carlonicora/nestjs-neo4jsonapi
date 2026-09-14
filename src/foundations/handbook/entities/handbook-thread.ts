import { defineEntity, Entity } from "../../../common";
import type { User } from "../../user/entities/user";
import { ownerMeta } from "../../user/entities/user.meta";
import type { HandbookThreadMessage } from "./handbook-thread-message";
import { handbookThreadMessageMeta } from "./handbook-thread-message.meta";
import { handbookThreadMeta } from "./handbook-thread.meta";

/**
 * One persisted handbook conversation: a title and an ordered list of messages.
 *
 * This is deliberately NOT the package `Assistant`. `Assistant` is
 * `isCompanyScoped: true`, and the handbook chat exists for platform
 * administrators — who have a Membership with `HAS_ROLE` and no `IN_COMPANY`,
 * i.e. no Company at all. A company-scoped thread would 404 for exactly the
 * user the feature is for, and relaxing `Assistant`'s scoping to accommodate
 * that would weaken tenancy for every application built on the package.
 *
 * `isCompanyScoped: false` therefore removes the company filter, and the
 * `CREATED_BY` owner edge becomes the WHOLE security boundary:
 * `HandbookThreadRepository.buildUserHasAccess()` requires it on every read and
 * every write. `contextKey: "userId"` attaches that edge from CLS on create, so
 * a client can never nominate a different owner, and `immutable: true` keeps a
 * later PUT from re-pointing it.
 */
export type HandbookThread = Entity & {
  title: string;
  owner?: User;
  messages?: HandbookThreadMessage[];
};

export const HandbookThreadDescriptor = defineEntity<HandbookThread>()({
  ...handbookThreadMeta,

  isCompanyScoped: false,

  fields: {
    title: { type: "string", required: true },
  },

  relationships: {
    owner: {
      model: ownerMeta,
      direction: "out",
      relationship: "CREATED_BY",
      cardinality: "one",
      required: false,
      dtoKey: "created-by",
      contextKey: "userId",
      immutable: true,
    },
    messages: {
      model: handbookThreadMessageMeta,
      direction: "out",
      relationship: "HAS_MESSAGE",
      cardinality: "many",
      required: false,
      dtoKey: "messages",
    },
  },
});

export type HandbookThreadDescriptorType = typeof HandbookThreadDescriptor;
