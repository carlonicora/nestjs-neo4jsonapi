/**
 * The JSON:API documents the serialiser emits, as returned by
 * `JsonApiService.buildSingle` / `buildList` and by every service method that
 * returns one of them.
 *
 * `JsonApiDataInterface` is a different thing: the serialiser builder
 * descriptor that `create()` returns.
 *
 * The shapes admit what the serialiser really emits: `id` can be missing, and
 * a `forceSingle` relationship with nothing in it emits `data: undefined`.
 */
export interface JsonApiResourceIdentifier {
  type: string;
  id: string;
  meta?: Record<string, any>;
}

export interface JsonApiRelationshipObject {
  data?: JsonApiResourceIdentifier | JsonApiResourceIdentifier[] | null;
  links?: Record<string, any>;
  meta?: Record<string, any>;
}

export interface JsonApiResourceObject {
  type: string;
  id?: string;
  attributes?: Record<string, any>;
  relationships?: Record<string, JsonApiRelationshipObject>;
  links?: Record<string, any>;
  meta?: Record<string, any>;
}

export interface JsonApiDocument<
  D extends JsonApiResourceObject | JsonApiResourceObject[] | null | undefined =
    JsonApiResourceObject | JsonApiResourceObject[],
> {
  data: D;
  included?: JsonApiResourceObject[];
  meta?: Record<string, any>;
  links?: { self?: string; next?: string; prev?: string; [key: string]: any };
}

export type JsonApiSingleDocument = JsonApiDocument<JsonApiResourceObject>;
export type JsonApiListDocument = JsonApiDocument<JsonApiResourceObject[]>;
