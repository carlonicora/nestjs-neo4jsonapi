import { Entity } from "../../../common/abstracts/entity";
import { User } from "../../user/entities/user";

/**
 * Content entity type representing polymorphic content (Article, Document, etc.).
 *
 * The index signature allows extension relationships to be added dynamically
 * when ContentExtensionConfig is provided. APIs can narrow this type using
 * intersection types for better type safety.
 *
 * @example
 * ```typescript
 * // In API - narrow type for specific extensions
 * type ExtendedContent = Content & {
 *   topic: Topic[];
 *   expertise: Expertise[];
 * };
 * ```
 */
export type Content = Entity & {
  name: string;
  contentType: string;
  abstract?: string;
  tldr?: string;
  aiStatus?: string;

  relevance?: number;

  owner: User;
  author: User;

  /** Index signature for extension relationships added via ContentExtensionConfig */
  [relationshipName: string]: unknown;
};
