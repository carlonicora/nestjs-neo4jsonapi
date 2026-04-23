import { Injectable } from "@nestjs/common";
import { DescriptorSource } from "./graph.catalog.service";

interface RegisteredEntry {
  descriptor: any; // EntityDescriptor<any, any>
  moduleId: string;
}

@Injectable()
export class GraphDescriptorRegistry implements DescriptorSource {
  private readonly entries: RegisteredEntry[] = [];

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
    return this.entries.map((e) => ({
      model: e.descriptor.model,
      description: e.descriptor.description,
      moduleId: e.moduleId,
      fields: e.descriptor.fields ?? {},
      relationships: e.descriptor.relationships ?? {},
      chat: e.descriptor.chat,
    }));
  }
}
