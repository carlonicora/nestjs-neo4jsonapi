import { Module, OnModuleInit } from "@nestjs/common";
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
export class AssistantMessageModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(AssistantMessageDescriptor.model);

    const all = modelRegistry.getAllModels();
    const candidates = all.filter((m) => m.type !== assistantMessageMeta.type && m.type !== assistantMeta.type);
    AssistantMessageDescriptor.relationships.references.polymorphic!.candidates = candidates;
  }
}
