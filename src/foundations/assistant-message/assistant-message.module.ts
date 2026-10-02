import { Module, OnApplicationBootstrap, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { modelRegistry } from "../../common/registries/registry";
import { AssistantMessageController } from "./controllers/assistant-message.controller";
import { AssistantMessageDescriptor } from "./entities/assistant-message";
import { assistantMessageMeta } from "./entities/assistant-message.meta";
import { AssistantMessageRepository } from "./repositories/assistant-message.repository";
import { AssistantMessageService } from "./services/assistant-message.service";
import { assistantMeta } from "../assistant/entities/assistant.meta";

@Module({
  controllers: [AssistantMessageController],
  providers: [AssistantMessageDescriptor.model.serialiser, AssistantMessageRepository, AssistantMessageService],
  exports: [AssistantMessageService, AssistantMessageRepository],
})
export class AssistantMessageModule implements OnModuleInit, OnApplicationBootstrap {
  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit() {
    modelRegistry.register(AssistantMessageDescriptor.model);
  }

  onApplicationBootstrap() {
    const all = modelRegistry.getAllModels();
    // Only models whose serialiser is an instantiated provider can be cited:
    // the auto serialiser builds every candidate's serialiser through ModuleRef
    // when it serialises a message. An app can register a model (for typed
    // reads) without providing its serialiser — an internal entity that is
    // never served over HTTP — and listing it here crashes every assistant
    // response with "Nest could not find <X>AutoSerialiser element".
    const candidates = all.filter(
      (m) =>
        !!m.serialiser &&
        m.type !== assistantMessageMeta.type &&
        m.type !== assistantMeta.type &&
        this.isSerialiserResolvable(m.serialiser),
    );
    AssistantMessageDescriptor.relationships.references.polymorphic!.candidates = candidates;
  }

  private isSerialiserResolvable(serialiser: unknown): boolean {
    try {
      return !!this.moduleRef.get(serialiser as any, { strict: false });
    } catch {
      return false;
    }
  }
}
