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
   * The filters this source can actually apply. describe_entity narrows each
   * field's operators to this list; a filterable field missing from it gets
   * none. Without this hook every field keeps the operators of its type.
   */
  filterCapabilities?(): ExternalFilterCapability[];
}

/** True when the service implements {@link ExternalEntitySource.resolveByText}. */
export function isExternalEntitySource(svc: unknown): svc is ExternalEntitySource {
  return typeof (svc as any)?.resolveByText === "function";
}
