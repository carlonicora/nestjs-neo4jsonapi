import { DataMeta } from "../interfaces/datamodel.interface";
import { copyMetadata, receivesRequest } from "./handler-wrapper";

/** One cached element: its JSON:API type (endpoint) and id. */
export type CacheInvalidateElement = { type: string; id: string };

export interface CacheInvalidateOptions {
  /**
   * Further elements whose cached documents the write changes, such as the records the entity
   * links to (their related lists change). Called once before the handler and once after it,
   * with the controller instance and the request; the union of both answers is invalidated, so
   * an element the write unlinks is invalidated as well as one it links. Setting it requires the
   * handler to declare `@Req()`.
   */
  elements?: (context: {
    controller: any;
    request: any;
  }) => CacheInvalidateElement[] | Promise<CacheInvalidateElement[]>;
}

/**
 * Decorator that invalidates cache after the method executes.
 *
 * @param meta - The entity metadata (provides endpoint for cache key)
 * @param id - Optional: The route param name to extract the entity ID.
 *             If omitted, invalidates all entries for this type.
 *             If provided, invalidates the specific element using req.params[id]; the handler
 *             MUST then declare `@Req()`, or the class fails when it is defined.
 * @param options - Optional: `elements` names further elements to invalidate (see
 *             {@link CacheInvalidateOptions}).
 */
export function CacheInvalidate(meta: DataMeta, id?: string, options?: CacheInvalidateOptions) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // meta is not read here: a circular import can leave it undefined while the class is defined.
    const handler = `@CacheInvalidate(meta, "${id}") on ${target.constructor.name}.${propertyKey}`;
    const needsRequest = !!id || !!options?.elements;
    if (needsRequest && !receivesRequest(target, propertyKey)) {
      throw new Error(`${handler} needs the request: add @Req() to its parameters`);
    }

    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      // Checked before the handler runs, so a missing request never follows a completed write.
      const req = needsRequest ? args.find((arg) => arg?.params) : undefined;
      if (needsRequest && !req) {
        throw new Error(`${handler} did not receive the request`);
      }

      const readElements = async (): Promise<CacheInvalidateElement[]> =>
        options?.elements && this.cacheService ? await options.elements({ controller: this, request: req }) : [];

      // Read before the write: an element the write unlinks is no longer reported afterwards.
      const before = await readElements();

      const result = await originalMethod.apply(this, args);

      if (this.cacheService) {
        if (!id) {
          // No id param → invalidate by type
          await this.cacheService.invalidateByType(meta.endpoint);
        } else {
          // id param provided → invalidate specific element
          const paramId = req.params[id];

          if (paramId) {
            await this.cacheService.invalidateByElement(meta.endpoint, paramId as string);
          }
        }

        if (options?.elements) {
          const union = new Map<string, CacheInvalidateElement>();
          for (const element of [...before, ...(await readElements())]) {
            union.set(`${element.type}:${element.id}`, element);
          }
          if (union.size > 0) await this.cacheService.invalidateByElements([...union.values()]);
        }
      }

      return result;
    };
    copyMetadata(originalMethod, descriptor.value);
    return descriptor;
  };
}
