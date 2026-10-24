import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";

/**
 * Nest passes the request to a handler only when one of its parameters is decorated with
 * `@Req()`. TypeScript applies parameter decorators before method decorators, so the route-args
 * metadata is already written when this runs.
 */
export function receivesRequest(target: any, propertyKey: string): boolean {
  return Object.keys(Reflect.getMetadata(ROUTE_ARGS_METADATA, target.constructor, propertyKey) ?? {}).some((key) =>
    key.startsWith(`${RouteParamtypes.REQUEST}:`),
  );
}

/**
 * Method decorators listed below a wrapper (`@Get`, `@Roles`, ...) run first and write their
 * metadata on the original function. Copy it onto the wrapper that replaces it, or Nest never
 * sees the route.
 */
export function copyMetadata(original: object, wrapper: object): void {
  for (const key of Reflect.getOwnMetadataKeys(original)) {
    Reflect.defineMetadata(key, Reflect.getOwnMetadata(key, original), wrapper);
  }
}
