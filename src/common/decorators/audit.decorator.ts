import { DataMeta } from "../interfaces/datamodel.interface";

/**
 * Decorator that automatically logs a read audit entry after the method executes.
 *
 * @param meta - The entity metadata (provides labelName for audit)
 * @param id - The route param name to extract the entity ID (e.g., "cullId", "rollId")
 */
export function Audit(meta: DataMeta, id: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args);

      const req = args.find((arg) => arg?.params);
      const paramId = req?.params?.[id];

      if (paramId && this.auditService) {
        this.auditService.logRead({
          entityType: meta.labelName,
          entityId: paramId as string,
        });
      }

      return result;
    };
    return descriptor;
  };
}
