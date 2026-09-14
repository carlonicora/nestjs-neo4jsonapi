import { defineEntity, Entity } from "../../../common";
import type { HandbookThread } from "./handbook-thread";
import { handbookThreadMeta } from "./handbook-thread.meta";
import { handbookThreadMessageMeta } from "./handbook-thread-message.meta";

export type HandbookThreadMessageRole = "user" | "assistant";

/**
 * One turn of a handbook conversation.
 *
 * `sources` holds repo-relative HandbookPage paths rather than `CITES` edges to
 * `Chunk` nodes (the shape `AssistantMessage` uses). The handbook answer is
 * attributed to the PAGE a reader can open, chunk boundaries are an ingest
 * detail, and the paths are resolved once at write time — so a re-ingest that
 * replaces the chunks leaves the rendered provenance intact.
 *
 * `isCompanyScoped: false` for the same reason as the thread; access is
 * inherited from the parent thread's owner edge, enforced in
 * `HandbookThreadMessageRepository.buildUserHasAccess()`.
 */
export type HandbookThreadMessage = Entity & {
  role: HandbookThreadMessageRole;
  content: string;
  position: number;
  sources?: string[];
  thread?: HandbookThread;
};

export const HandbookThreadMessageDescriptor = defineEntity<HandbookThreadMessage>()({
  ...handbookThreadMessageMeta,

  isCompanyScoped: false,

  fields: {
    role: { type: "string", required: true },
    content: { type: "string", required: true },
    position: { type: "number", required: true },
    sources: { type: "string[]" },
  },

  relationships: {
    thread: {
      model: handbookThreadMeta,
      direction: "in",
      relationship: "HAS_MESSAGE",
      cardinality: "one",
      required: true,
      dtoKey: "thread",
      immutable: true,
    },
  },
});

export type HandbookThreadMessageDescriptorType = typeof HandbookThreadMessageDescriptor;
