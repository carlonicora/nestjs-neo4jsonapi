import type { FilterCriterion, SortCriterion } from "../../core/neo4j/types/filter.criterion";

/**
 * External entity sources: optional capabilities an `AbstractService` subclass
 * implements when its records live outside the app database (for example a
 * corpus served over HTTP).
 *
 * Every hook is optional and discovered on the registered service instance
 * (`EntityServiceRegistry.get(type)`). A service that implements none of them
 * behaves exactly as before.
 */

/** One name-lookup candidate returned by {@link ExternalEntitySource.resolveByText}. */
export interface ExternalResolveCandidate {
  id: string;
  name: string;
  score: number;
  /** True when the source matched the text as an identifier (e.g. a citation number), not by a free-text search. */
  exact?: boolean;
  /**
   * The identity resolve_entity judges ties on (e.g. "14345/2024"), when `name`
   * is a richer label. Two candidates with the same key never get a recommendation.
   */
  key?: string;
}

/** One related record returned by {@link ExternalEntitySource.findRelatedIds}. */
export interface ExternalRelatedId {
  type: string;
  id: string;
}

/**
 * The relationship a {@link ExternalEntitySource.findRelatedIds} call is for. `name` is the
 * relationship's name on the source's descriptor. `direction` is its catalogued direction from
 * the source record: "out", "in", or "both" for a polymorphic relationship, which has none.
 * Two relationships may share one `cypherLabel` (a forward one and its reverse): the source
 * MUST read by `direction`, never both sides of the label.
 */
export interface ExternalRelationshipRef {
  name: string;
  direction: "out" | "in" | "both";
}

/** The operators an external source supports on one field, returned by {@link ExternalEntitySource.filterCapabilities}. */
export interface ExternalFilterCapability {
  field: string;
  operators: string[];
  /** The only values the source accepts on this field (for example a source code list). Printed by describe_entity. */
  values?: string[];
}

/** The input of {@link ExternalEntitySource.findRecordsWithWarnings}: the same as `AbstractService.findRecords`. */
export interface ExternalSearchParams {
  filters?: FilterCriterion[];
  orderByFields?: SortCriterion[];
  limit?: number;
  term?: string;
}

/** The result of {@link ExternalEntitySource.findRecordsWithWarnings}. */
export interface ExternalSearchResult<T = any> {
  records: T[];
  /** Text for the caller about how the records were found (for example an ambiguous lookup); empty when there is none. */
  warnings: string[];
}

/** Optional capabilities an AbstractService subclass implements when its records live outside the app database. */
export interface ExternalEntitySource {
  /** resolve_entity for this type: replaces the app-DB fulltext/semantic tiers. Global reference data: no record-level access check is applied to these candidates. */
  resolveByText(params: { text: string; limit: number }): Promise<ExternalResolveCandidate[]>;
  /** Scope check for a type declared with chat.scopeByService. Returns the subset of ids inside the scope root. */
  filterInScope?(params: { ids: string[]; scopeType: string; scopeId: string }): Promise<string[]>;
  /**
   * The related ids of one record, for edges that do not exist in the app
   * database. Return the related ids typed, at most `limit` of them. A
   * relationship answered with `[]` is reported as having no related records.
   *
   * Which relationships it is asked for depends on
   * {@link ExternalEntitySource.relatedIdsForEveryRelationship}:
   * - without it, only POLYMORPHIC relationships: the polymorphic `traverse`
   *   and a polymorphic `read_entity` include call it with `{ id, cypherLabel,
   *   limit, relationship }`. A typed relationship keeps the target's
   *   `findRelatedRecordsByEdge` in both tools.
   * - with it, EVERY relationship of this source: `traverse` and `read_entity`
   *   never call the target's `findRelatedRecordsByEdge` for it.
   *
   * `filters` and `orderByFields` (the types `findRecords` takes) are sent only
   * to a source that declares `relatedIdsForEveryRelationship`, and only from a
   * typed traverse, already validated against the target type's fields and its
   * `filterCapabilities`. A source that receives them MUST apply them to the
   * relationship's full linked set and return the final ordered page: the tool
   * reads the returned ids in order and does no filtering or sorting of its
   * own. `limit` is then the truncation probe (the page size + 1). The
   * polymorphic traverse and read_entity never send filters or sort.
   *
   * `relationship` names the relationship asked for and its direction; `cypherLabel` alone does not identify it.
   */
  findRelatedIds?(params: {
    id: string;
    cypherLabel: string;
    limit: number;
    relationship: ExternalRelationshipRef;
    filters?: FilterCriterion[];
    orderByFields?: SortCriterion[];
  }): Promise<ExternalRelatedId[]>;
  /**
   * Opt-in: `findRelatedIds` answers EVERY relationship of this source, typed
   * ones included, not only the polymorphic ones.
   *
   * With it, `traverse` asks `findRelatedIds` for a typed relationship too,
   * passing the validated `filters`, `orderByFields` and `limit + 1`, and
   * `read_entity` asks it for every include. Without it (the default), both
   * tools ask `findRelatedIds` only for polymorphic relationships and read a
   * typed one through the target's `findRelatedRecordsByEdge`. Ignored when the
   * service does not implement `findRelatedIds`.
   */
  readonly relatedIdsForEveryRelationship?: true;
  /**
   * The filters this source can actually apply. When present it wins over the
   * operator table of the field types: describe_entity advertises exactly these
   * operators (a field missing from the list, or listed with none, is
   * `filterable: false`), and search_entities / traverse accept exactly these.
   * Without this hook every field keeps the operators of its type.
   */
  filterCapabilities?(): ExternalFilterCapability[];
  /**
   * search_entities for this type, with warnings. When present, search_entities
   * calls it INSTEAD of `findRecords` for an unscoped search (same input) and
   * returns `warnings` in its reply when the list is not empty. The warnings
   * come from the same search that produced the records: no extra round trip
   * and no state kept on the service between calls. Without this hook
   * search_entities calls `findRecords` and its reply has no `warnings` key.
   */
  findRecordsWithWarnings?(params: ExternalSearchParams): Promise<ExternalSearchResult>;
}

/** True when the service implements {@link ExternalEntitySource.resolveByText}. */
export function isExternalEntitySource(svc: unknown): svc is ExternalEntitySource {
  return typeof (svc as any)?.resolveByText === "function";
}

/**
 * True when `findRelatedIds` must be asked for this relationship of the
 * service: always for a polymorphic one, and for a typed one only when the
 * service declares {@link ExternalEntitySource.relatedIdsForEveryRelationship}.
 */
export function answersRelatedIds<T extends object>(
  svc: T | undefined,
  relationship: { polymorphic?: boolean },
): svc is T & Required<Pick<ExternalEntitySource, "findRelatedIds">> {
  const source = svc as Partial<ExternalEntitySource> | undefined;
  if (typeof source?.findRelatedIds !== "function") return false;
  return relationship.polymorphic === true || source.relatedIdsForEveryRelationship === true;
}

/** True when the service implements {@link ExternalEntitySource.findRecordsWithWarnings}. */
export function hasSearchWarnings(
  svc: unknown,
): svc is Required<Pick<ExternalEntitySource, "findRecordsWithWarnings">> {
  return typeof (svc as any)?.findRecordsWithWarnings === "function";
}

/**
 * Thrown by an external source's read when the source itself did not answer
 * (network error, timeout, 5xx). It means "unknown", never "missing": a read
 * that throws it must not be reported as not found.
 *
 * The graph tools turn it into a tool value, never a thrown error
 * (`ToolFactory.capture`): `{ error: message, code, retryable }`, with the
 * error's own `retryable`: true by default (the source did not answer and may
 * answer later), false when the source answered with a defect that a retry
 * would meet again. The operator keeps running, and the MCP client gets
 * `isError` with `code`.
 * `message` is the text shown to the user; the technical failure stays on `cause`.
 */
export class ExternalSourceUnavailableError extends Error {
  readonly code: string;
  /** Whether the same call can succeed later: true for an outage (the default), false for a defect of the source. */
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(params: { message: string; code?: string; cause?: unknown; retryable?: boolean }) {
    super(params.message);
    this.name = "ExternalSourceUnavailableError";
    this.code = params.code ?? "source_unavailable";
    this.retryable = params.retryable ?? true;
    this.cause = params.cause;
  }
}

/** True for an {@link ExternalSourceUnavailableError}, also across duplicated copies of this package. */
export function isExternalSourceUnavailableError(e: unknown): e is ExternalSourceUnavailableError {
  return (
    e instanceof ExternalSourceUnavailableError ||
    (typeof e === "object" &&
      e !== null &&
      (e as { name?: unknown }).name === "ExternalSourceUnavailableError" &&
      typeof (e as { code?: unknown }).code === "string")
  );
}

/**
 * The tool value an {@link ExternalSourceUnavailableError} becomes: a status the caller reads,
 * never a throw. `retryable` is the error's own value; a copy without the field reads as retryable.
 */
export function externalSourceUnavailableResult(e: ExternalSourceUnavailableError): {
  error: string;
  code: string;
  retryable: boolean;
} {
  return { error: e.message, code: e.code, retryable: e.retryable !== false };
}
