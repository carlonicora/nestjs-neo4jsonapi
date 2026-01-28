import { PreconditionFailedException } from "@nestjs/common";

/**
 * Validates that the URL param ID matches the body ID.
 * Eliminates the repeated `if (id !== body.data.id)` check found in 28 places.
 *
 * @param paramName - The route param name (e.g., "rollId", "cullId")
 * @param bodyPath - Optional path to ID in body (default: "data.id")
 *
 * @example
 * ```typescript
 * @Put(`${endpoint}/:cullId`)
 * @ValidateId("cullId")
 * @CacheInvalidate(cullMeta, "cullId")
 * async update(@Res() reply, @Body() body: CullPutDTO) {
 *   return this.crud.update(reply, body);
 * }
 * ```
 */
export function ValidateId(paramName: string, bodyPath = "data.id") {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      // Find the request object (has params property)
      const req = args.find((arg) => arg?.params);
      const paramId = req?.params?.[paramName];

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
