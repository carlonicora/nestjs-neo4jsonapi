import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { AbstractService } from "../../core/neo4j/abstracts/abstract.service";

@Injectable()
export class EntityServiceRegistry implements OnModuleInit {
  private readonly logger = new Logger(EntityServiceRegistry.name);
  private readonly byType = new Map<string, AbstractService<any, any>>();

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    const wrappers = this.discovery.getProviders();
    for (const wrapper of wrappers) {
      const instance = wrapper.instance;
      if (!instance || !(instance instanceof AbstractService)) continue;
      const type = (instance as any).model?.type;
      if (!type) continue;
      if (this.byType.has(type)) {
        this.logger.warn(`Duplicate AbstractService for type "${type}"; keeping first registered.`);
        continue;
      }
      this.byType.set(type, instance);
    }
    this.logger.log(`Registered ${this.byType.size} entity services.`);
  }

  get(type: string): AbstractService<any, any> | undefined {
    return this.byType.get(type);
  }

  listTypes(): string[] {
    return Array.from(this.byType.keys());
  }
}
