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

/** The operators an external source supports on one field, returned by {@link ExternalEntitySource.filterCapabilities}. */
export interface ExternalFilterCapability {
  field: string;
  operators: string[];
  /** The only values the source accepts on this field (for example a source code list). Printed by describe_entity. */
  values?: string[];
}

/** Optional capabilities an AbstractService subclass implements when its records live outside the app database. */
export interface ExternalEntitySource {
  /** resolve_entity for this type: replaces the app-DB fulltext/semantic tiers. Global reference data: no record-level access check is applied to these candidates. */
  resolveByText(params: { text: string; limit: number }): Promise<ExternalResolveCandidate[]>;
  /** Scope check for a type declared with chat.scopeByService. Returns the subset of ids inside the scope root. */
  filterInScope?(params: { ids: string[]; scopeType: string; scopeId: string }): Promise<string[]>;
  /** Polymorphic traverse for edges that do not exist in the app database. */
  findRelatedIds?(params: { id: string; cypherLabel: string; limit: number }): Promise<ExternalRelatedId[]>;
  /**
   * The filters this source can actually apply. When present it wins over the
   * operator table of the field types: describe_entity advertises exactly these
   * operators (a field missing from the list, or listed with none, is
   * `filterable: false`), and search_entities / traverse accept exactly these.
   * Without this hook every field keeps the operators of its type.
   */
  filterCapabilities?(): ExternalFilterCapability[];
}

/** True when the service implements {@link ExternalEntitySource.resolveByText}. */
export function isExternalEntitySource(svc: unknown): svc is ExternalEntitySource {
  return typeof (svc as any)?.resolveByText === "function";
}

/**
 * Thrown by an external source's read when the source itself did not answer
 * (network error, timeout, 5xx). It means "unknown", never "missing": a read
 * that throws it must not be reported as not found.
 *
 * The graph tools turn it into a tool value, never a thrown error
 * (`ToolFactory.capture`): `{ error: message, code, retryable: true }`. The
 * operator keeps running, and the MCP client gets `isError` with `code`.
 * `message` is the text shown to the user; the technical failure stays on `cause`.
 */
export class ExternalSourceUnavailableError extends Error {
  readonly code: string;
  readonly retryable = true;
  readonly cause?: unknown;

  constructor(params: { message: string; code?: string; cause?: unknown }) {
    super(params.message);
    this.name = "ExternalSourceUnavailableError";
    this.code = params.code ?? "source_unavailable";
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

/** The tool value an {@link ExternalSourceUnavailableError} becomes: a status the caller reads, never a throw. */
export function externalSourceUnavailableResult(e: ExternalSourceUnavailableError): {
  error: string;
  code: string;
  retryable: true;
} {
  return { error: e.message, code: e.code, retryable: true };
}
