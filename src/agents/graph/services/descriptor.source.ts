import { Injectable, Logger } from "@nestjs/common";
import { DescriptorSource } from "./graph.catalog.service";

interface RegisteredEntry {
  descriptor: any; // EntityDescriptor<any, any>
  moduleId: string;
}

@Injectable()
export class GraphDescriptorRegistry implements DescriptorSource {
  private readonly logger = new Logger(GraphDescriptorRegistry.name);
  private readonly entries: RegisteredEntry[] = [];
  private logged = false;

  /**
   * Register a feature-module's descriptor with the chatbot graph catalog.
   *
   * `moduleId` must be the stable UUID of the `(Module)` node seeded in the
   * host app's Neo4j migrations. Matching the ID — not the name — means the
   * catalog continues to work after module renames and is decoupled from the
   * host app's naming conventions.
   */
  register(params: { descriptor: any; moduleId: string }): void {
    this.entries.push({ descriptor: params.descriptor, moduleId: params.moduleId });
  }

  loadAll(): any[] {
    const out = this.entries.map((e) => ({
      model: e.descriptor.model,
      description: e.descriptor.description,
      moduleId: e.moduleId,
      fields: e.descriptor.fields ?? {},
      relationships: e.descriptor.relationships ?? {},
      chat: e.descriptor.chat,
      bridge: e.descriptor.bridge,
    }));
    if (!this.logged) {
      this.logged = true;
      this.logger.log(
        `loadAll: ${out.length} descriptors: ` +
          JSON.stringify(
            out.map((d) => ({
              type: d.model.type,
              moduleId: d.moduleId,
              hasDescription: !!d.description,
              hasBridge: !!d.bridge,
            })),
          ),
      );
    }
    return out;
  }
}
