import { Module, OnModuleInit } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { AssistantMessageController } from "./controllers/assistant-message.controller";
import { AssistantMessageDescriptor } from "./entities/assistant-message";
import { AssistantMessageRepository } from "./repositories/assistant-message.repository";
import { AssistantMessageService } from "./services/assistant-message.service";

@Module({
  controllers: [AssistantMessageController],
  providers: [
    AssistantMessageDescriptor.model.serialiser,
    AssistantMessageRepository,
    AssistantMessageService,
  ],
  exports: [AssistantMessageService, AssistantMessageRepository],
})
export class AssistantMessageModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(AssistantMessageDescriptor.model);
  }
}
