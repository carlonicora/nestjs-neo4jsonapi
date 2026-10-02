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
}

/** One related record returned by {@link ExternalEntitySource.findRelatedIds}. */
export interface ExternalRelatedId {
  type: string;
  id: string;
}

/** Optional capabilities an AbstractService subclass implements when its records live outside the app database. */
export interface ExternalEntitySource {
  /** resolve_entity for this type: replaces the app-DB fulltext/semantic tiers. Global reference data: no record-level access check is applied to these candidates. */
  resolveByText(params: { text: string; limit: number }): Promise<ExternalResolveCandidate[]>;
  /** Scope check for a type declared with chat.scopeByService. Returns the subset of ids inside the scope root. */
  filterInScope?(params: { ids: string[]; scopeType: string; scopeId: string }): Promise<string[]>;
  /** Polymorphic traverse for edges that do not exist in the app database. */
  findRelatedIds?(params: { id: string; cypherLabel: string; limit: number }): Promise<ExternalRelatedId[]>;
}

/** True when the service implements {@link ExternalEntitySource.resolveByText}. */
export function isExternalEntitySource(svc: unknown): svc is ExternalEntitySource {
  return typeof (svc as any)?.resolveByText === "function";
}
