import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";
import { DataMeta } from "../interfaces/datamodel.interface";

/**
 * Nest passes the request to a handler only when one of its parameters is decorated with
 * `@Req()`. TypeScript applies parameter decorators before method decorators, so the route-args
 * metadata is already written when this runs.
 */
function receivesRequest(target: any, propertyKey: string): boolean {
  return Object.keys(Reflect.getMetadata(ROUTE_ARGS_METADATA, target.constructor, propertyKey) ?? {}).some((key) =>
    key.startsWith(`${RouteParamtypes.REQUEST}:`),
  );
}

/**
 * Decorator that invalidates cache after the method executes.
 *
 * @param meta - The entity metadata (provides endpoint for cache key)
 * @param id - Optional: The route param name to extract the entity ID.
 *             If omitted, invalidates all entries for this type.
 *             If provided, invalidates the specific element using req.params[id]; the handler
 *             MUST then declare `@Req()`, or the class fails when it is defined.
 */
export function CacheInvalidate(meta: DataMeta, id?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // meta is not read here: a circular import can leave it undefined while the class is defined.
    const handler = `@CacheInvalidate(meta, "${id}") on ${target.constructor.name}.${propertyKey}`;
    if (id && !receivesRequest(target, propertyKey)) {
      throw new Error(`${handler} needs the request: add @Req() to its parameters`);
    }

    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      // Checked before the handler runs, so a missing request never follows a completed write.
      const req = id ? args.find((arg) => arg?.params) : undefined;
      if (id && !req) {
        throw new Error(`${handler} did not receive the request`);
      }

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
      }

      return result;
    };
    return descriptor;
  };
}
