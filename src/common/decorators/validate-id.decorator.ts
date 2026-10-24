import { PreconditionFailedException } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";

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
 * Validates that the URL param ID matches the body ID.
 * Eliminates the repeated `if (id !== body.data.id)` check found in 28 places.
 *
 * The handler MUST declare `@Req()`: the URL param is read from the request. A handler without
 * it fails when the class is defined.
 *
 * @param paramName - The route param name (e.g., "rollId", "cullId")
 * @param bodyPath - Optional path to ID in body (default: "data.id")
 *
 * @example
 * ```typescript
 * @Put(`${endpoint}/:cullId`)
 * @ValidateId("cullId")
 * @CacheInvalidate(cullMeta, "cullId")
 * async update(@Req() req: AuthenticatedRequest, @Res() reply, @Body() body: CullPutDTO) {
 *   return this.crud.update(reply, body);
 * }
 * ```
 */
export function ValidateId(paramName: string, bodyPath = "data.id") {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const handler = `@ValidateId("${paramName}") on ${target.constructor.name}.${propertyKey}`;
    if (!receivesRequest(target, propertyKey)) {
      throw new Error(`${handler} needs the request: add @Req() to its parameters`);
    }

    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      // Find the request object (has params property)
      const req = args.find((arg) => arg?.params);
      if (!req) {
        throw new Error(`${handler} did not receive the request`);
      }
      const paramId = req.params[paramName];

      // Find the body object (has data property for JSON:API format)
      const body = args.find((arg) => arg?.data !== undefined);

      // Navigate to the body ID using the bodyPath
      const bodyId = bodyPath.split(".").reduce((obj, key) => obj?.[key], body);

      // Only validate if both IDs are present and they don't match
      if (paramId && bodyId && paramId !== bodyId) {
        throw new PreconditionFailedException("ID in URL does not match ID in body");
      }

      return originalMethod.apply(this, args);
    };
    return descriptor;
  };
}
