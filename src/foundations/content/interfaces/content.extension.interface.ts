import { DataMeta } from "../../../common/interfaces/datamodel.interface";

/**
 * Defines an additional relationship to be included in Content responses.
 */
export interface ContentRelationshipExtension {
  /** Meta information for the related model (e.g., topicMeta, expertiseMeta) */
  model: DataMeta;

  /** Neo4j relationship type (e.g., "HAS_KNOWLEDGE") */
  relationship: string;

  /** Direction of the relationship relative to Content node */
  direction: "in" | "out";

  /** Whether this is a one-to-one or one-to-many relationship */
  cardinality: "one" | "many";

  /** Optional JSON:API key override (e.g., "topics" instead of "topic") */
  dtoKey?: string;
}

/**
 * Describes how the Content → owner edge is matched in Cypher.
 *
 * Default (omitted): the historical directed single-type match
 * `MATCH (content)<-[:PUBLISHED]-(content_owner:User)`.
 */
export interface ContentOwnerMatchPattern {
  /**
   * Neo4j relationship types accepted for the owner edge. Joined with `|`,
   * so `["PUBLISHED", "FROM"]` becomes `[:PUBLISHED|FROM]`.
   */
  relationships: string[];

  /**
   * When true the pattern is undirected (`(content)-[:…]-(owner)`) instead of
   * the default incoming direction (`(content)<-[:…]-(owner)`).
   *
   * Needed when the owner edge points different ways for different underlying
   * labels — e.g. a360ai's Email rows, where the edge is
   * `(email)-[:FROM]->(user)` while every other content type is
   * `(user)-[:PUBLISHED]->(content)`.
   */
  undirected?: boolean;
}

/**
 * Adds one config-driven computed meta field to Content, fed by an extra
 * OPTIONAL MATCH appended to the Content RETURN statement.
 *
 * @example
 * ```typescript
 * // a360ai: expose the proceeding a memo belongs to as meta.proceedingId
 * {
 *   key: "proceedingId",
 *   optionalMatch: "OPTIONAL MATCH (memoProceeding:Proceeding)-[:HAS_MEMO]->(content)",
 *   returnAlias: "memoProceeding.id",
 * }
 * // → OPTIONAL MATCH (memoProceeding:Proceeding)-[:HAS_MEMO]->(content)
 * // → RETURN …, memoProceeding.id AS proceedingId
 * ```
 */
export interface ContentMetaFieldExtension {
  /**
   * JSON:API meta key AND the Cypher RETURN alias the value is read from
   * (the descriptor's computed field reads `record.get(key)`).
   */
  key: string;

  /**
   * A complete Cypher clause appended verbatim before the RETURN — normally an
   * `OPTIONAL MATCH …` binding the variable projected by `returnAlias`. It runs
   * after the company/owner matches, so `content` is in scope.
   */
  optionalMatch: string;

  /**
   * The Cypher expression to project, WITHOUT the alias: it is emitted as
   * `${returnAlias} AS ${key}`. For the example above, `"memoProceeding.id"`.
   */
  returnAlias: string;

  /** Optional human-readable description for the graph catalog / chatbot. */
  description?: string;
}

/**
 * Configuration for extending Content module with additional relationships.
 *
 * This allows APIs to inject custom relationships that will be:
 * - Queried via OPTIONAL MATCH in Cypher
 * - Included in JSON:API serialization
 * - Mapped in entity results
 *
 * Every key beyond `additionalRelationships` is optional and defaults to the
 * package's historical behaviour, so omitting the config (or passing only
 * `additionalRelationships`) leaves the Content wire and Cypher unchanged.
 *
 * @example
 * ```typescript
 * const contentExtension: ContentExtensionConfig = {
 *   additionalRelationships: [
 *     {
 *       model: topicMeta,
 *       relationship: "HAS_KNOWLEDGE",
 *       direction: "in",
 *       cardinality: "many",
 *       dtoKey: "topics",
 *     },
 *   ],
 * };
 * ```
 *
 * @example
 * ```typescript
 * // a360ai's configuration — every non-default knob in one place
 * const contentExtension: ContentExtensionConfig = {
 *   additionalRelationships: [],
 *   ownerMatchPattern: { relationships: ["PUBLISHED", "FROM"], undirected: true },
 *   requireTldr: true,
 *   metaFields: [
 *     {
 *       key: "proceedingId",
 *       optionalMatch: "OPTIONAL MATCH (memoProceeding:Proceeding)-[:HAS_MEMO]->(content)",
 *       returnAlias: "memoProceeding.id",
 *     },
 *   ],
 *   serialiseAuthor: false,
 * };
 * ```
 */
export interface ContentExtensionConfig {
  additionalRelationships: ContentRelationshipExtension[];

  /**
   * Overrides the Content → owner Cypher match.
   *
   * Default (omitted): `MATCH (content)<-[:PUBLISHED]-(content_owner:User)` —
   * byte-identical to the pre-config behaviour.
   *
   * a360ai: `{ relationships: ["PUBLISHED", "FROM"], undirected: true }`.
   */
  ownerMatchPattern?: ContentOwnerMatchPattern;

  /**
   * When true, only records carrying a non-empty `tldr` are returned. The
   * filter is applied BOTH to the default list match and to the `findByIds`
   * lookup.
   *
   * Default (omitted / false): no tldr filter — every content record is
   * returned, exactly as before.
   *
   * a360ai: `true` (Content is a view over AI-summarised records only).
   */
  requireTldr?: boolean;

  /**
   * Extra computed meta fields hydrated by additional OPTIONAL MATCH clauses.
   *
   * Default (omitted): no extra clauses and no extra meta keys.
   *
   * a360ai: the `proceedingId` entry documented on
   * {@link ContentMetaFieldExtension}.
   */
  metaFields?: ContentMetaFieldExtension[];

  /**
   * Whether the `author` relationship is matched and serialised.
   *
   * Default (omitted / true): the `author` relationship is part of the wire and
   * of the Cypher RETURN, as it has always been.
   *
   * a360ai: `false` — a360ai content has no author distinct from the owner and
   * its wire contract pins relationships to `["owner"]`.
   */
  serialiseAuthor?: boolean;

  /**
   * Per-label record-level access rules, keyed by the underlying Neo4j label
   * (e.g. `"Document"`). Each value is a Cypher predicate over the content node
   * alias `content` and the bound `currentUser`, normally the label's own
   * repository `buildUserHasAccess()` predicate re-aliased to `content`.
   *
   * `ContentCypherService.userHasAccess()` — the access check of EVERY Content
   * read: the list, by-owner and by-ids reads and the related rows of the
   * `/contents/:id/relevance` read — ANDs one `(NOT content:<Label> OR (<predicate>))`
   * conjunct per entry, so a row of that label is returned only when its
   * predicate holds. The SOURCE of `/contents/:id/relevance` and
   * `/contents/:id/user-relevance` must pass the same check (403/404 otherwise),
   * and the relevance page is cut after the filter. Skipped for automated jobs,
   * like every `userHasAccess` check. With no user in context a guarded label
   * is excluded outright (`currentUser` is unbound).
   *
   * Default (omitted): no access predicate. Every company record of the
   * configured content types is returned, exactly as before.
   *
   * a360ai: the Document and Memo access rules.
   */
  accessPredicates?: Record<string, string>;
}

/**
 * Injection token for Content extension configuration.
 * Use with @Optional() @Inject(CONTENT_EXTENSION_CONFIG) to make it optional.
 */
export const CONTENT_EXTENSION_CONFIG = Symbol("CONTENT_EXTENSION_CONFIG");

/**
 * Injection token carrying the descriptor that `ContentModule.forRoot()` built
 * from the module configuration. The module registers `descriptor.model` in
 * `modelRegistry` on init; read paths resolve it with `getContentModel()`.
 */
export const CONTENT_DESCRIPTOR = Symbol("CONTENT_DESCRIPTOR");
