import { Logger } from "@nestjs/common";
import { DataMeta } from "../interfaces/datamodel.interface";
import { copyMetadata, receivesRequest } from "./handler-wrapper";

const logger = new Logger("Audit");

/**
 * Decorator that automatically logs a read audit entry after the method executes.
 *
 * @param meta - The entity metadata (provides labelName for audit)
 * @param id - The route param name to extract the entity ID (e.g., "cullId", "rollId")
 *
 * The handler MUST declare `@Req()`: the id is read from the request. A handler without it fails
 * when the class is defined.
 */
export function Audit(meta: DataMeta, id: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // meta is not read here: a circular import can leave it undefined while the class is defined.
    const handler = `@Audit(meta, "${id}") on ${target.constructor.name}.${propertyKey}`;
    if (!receivesRequest(target, propertyKey)) {
      throw new Error(`${handler} needs the request: add @Req() to its parameters`);
    }

    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const req = args.find((arg) => arg?.params);
      if (!req) {
        throw new Error(`${handler} did not receive the request`);
      }

      const result = await originalMethod.apply(this, args);

      const paramId = req.params[id];

      if (paramId && this.auditService) {
        // Fire-and-forget, but never unhandled: a rejected audit write must not crash the
        // process (unhandled rejection) nor fail the request that already succeeded.
        const auditService = this.auditService;
        Promise.resolve()
          .then(() =>
            auditService.logRead({
              entityType: meta.labelName,
              entityId: paramId as string,
            }),
          )
          .catch((error: unknown) =>
            logger.error(
              `Audit read failed for ${meta.labelName} ${paramId}`,
              error instanceof Error ? error.stack : String(error),
            ),
          );
      }

      return result;
    };
    copyMetadata(originalMethod, descriptor.value);
    return descriptor;
  };
}
