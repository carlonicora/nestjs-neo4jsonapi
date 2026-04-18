import { Injectable } from "@nestjs/common";
import { DescriptorSource } from "./graph.catalog.service";

interface RegisteredEntry {
  descriptor: any; // EntityDescriptor<any, any>
  module: string;
}

@Injectable()
export class GraphDescriptorRegistry implements DescriptorSource {
  private readonly entries: RegisteredEntry[] = [];

  register(params: { descriptor: any; module: string }): void {
    this.entries.push({ descriptor: params.descriptor, module: params.module });
  }

  loadAll(): any[] {
    return this.entries.map((e) => ({
      model: e.descriptor.model,
      description: e.descriptor.description,
      module: e.module,
      fields: e.descriptor.fields ?? {},
      relationships: e.descriptor.relationships ?? {},
      chat: e.descriptor.chat,
    }));
  }
}
