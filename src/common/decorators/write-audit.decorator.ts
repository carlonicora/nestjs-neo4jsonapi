import { DataMeta } from "../interfaces/datamodel.interface";

const REDACTED_FIELDS = new Set([
  "password",
  "passwordHash",
  "token",
  "secret",
  "apiKey",
  "refreshToken",
  "accessToken",
]);

/**
 * Decorator that automatically logs a write audit entry after the method executes.
 * Captures the submitted JSON:API body data (attributes + relationships) as the changes record.
 *
 * @param meta - The entity metadata (provides labelName for audit)
 * @param auditType - The type of write operation: "create" or "edit"
 */
export function WriteAudit(meta: DataMeta, auditType: "create" | "edit") {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args);

      // Extract entity ID and body data from request body (JSON:API format)
      const body = args.find((arg) => arg?.data?.id || arg?.data?.type);
      const entityId = body?.data?.id;

      if (entityId && this.auditService) {
        // Capture the submitted data as changes
        const changes: Record<string, any> = {};
        if (body.data.attributes) {
          const sanitised = { ...body.data.attributes };
          for (const key of Object.keys(sanitised)) {
            if (REDACTED_FIELDS.has(key)) {
              sanitised[key] = "[REDACTED]";
            }
          }
          changes.attributes = sanitised;
        }
        if (body.data.relationships) {
          changes.relationships = body.data.relationships;
        }

        await this.auditService.createWriteAuditEntry({
          entityType: meta.labelName,
          entityId: entityId as string,
          auditType,
          changes: Object.keys(changes).length > 0 ? JSON.stringify(changes) : undefined,
        });
      }

      return result;
    };
    return descriptor;
  };
}
