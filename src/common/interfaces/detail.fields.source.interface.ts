/**
 * Detail fields: an optional capability an `AbstractService` subclass
 * implements when its records carry values the assistant may read only when it
 * opens one record (`read_entity`), for example a body stored outside the
 * database.
 *
 * The hook is discovered on the registered service instance
 * (`EntityServiceRegistry.get(type)`) and is called only for a type whose
 * descriptor declares `chat.detailFields`. A service that implements nothing
 * behaves exactly as before.
 */

import type { CypherType } from "./entity.schema.interface";

/** A field that exists only when the assistant opens one record (read_entity). */
export interface DetailFieldDef {
  type: CypherType;
  description: string;
}

/** Optional capability: values for the descriptor's chat.detailFields, read on a single-record read only. */
export interface DetailFieldsSource {
  readDetailFields(params: { record: any }): Promise<Record<string, unknown>>;
}

/** True when the service implements {@link DetailFieldsSource.readDetailFields}. */
export function isDetailFieldsSource(svc: unknown): svc is DetailFieldsSource {
  return typeof (svc as any)?.readDetailFields === "function";
}
