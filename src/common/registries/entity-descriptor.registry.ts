import { EntityDescriptor } from "../interfaces/entity.schema.interface";

/**
 * JSON:API type → entity descriptor, filled by `defineEntity()` at import time (projections
 * excluded). Lets type-generic code read a descriptor from the type a request names, e.g. the
 * offline change-set merge finding the rich-text fields (`kind: { type: "richtext" }`) of a record.
 *
 * NOT @Injectable: populated before NestJS bootstraps, like `modelRegistry`. The first
 * descriptor registered for a type is kept.
 */
export class EntityDescriptorRegistry {
  private readonly entries = new Map<string, EntityDescriptor<any, any>>();

  register(descriptor: EntityDescriptor<any, any>): void {
    const type = descriptor.model?.type;
    if (!type || this.entries.has(type)) return;
    this.entries.set(type, descriptor);
  }

  get(type: string): EntityDescriptor<any, any> | undefined {
    return this.entries.get(type);
  }

  /** The descriptor whose model answers on `endpoint` (first path segment), if any. */
  getByEndpoint(endpoint: string): EntityDescriptor<any, any> | undefined {
    for (const descriptor of this.entries.values()) if (descriptor.model?.endpoint === endpoint) return descriptor;
    return undefined;
  }

  /** Names of the descriptor fields declared `kind: { type: "richtext" }` (empty for an unknown type). */
  richTextFields(type: string): string[] {
    const descriptor = this.entries.get(type);
    if (!descriptor) return [];
    return Object.entries(descriptor.fields ?? {})
      .filter(([, def]: [string, any]) => def?.kind?.type === "richtext")
      .map(([name]) => name);
  }

  /** Test helper: removes one type (or every type) from the registry. */
  unregister(type?: string): void {
    if (type === undefined) this.entries.clear();
    else this.entries.delete(type);
  }
}

export const entityDescriptorRegistry = new EntityDescriptorRegistry();
