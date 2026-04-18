import { Module, OnModuleInit } from "@nestjs/common";
import { ChatbotModule } from "../../agents/chatbot/chatbot.module";
import { modelRegistry } from "../../common/registries/registry";
import { AssistantController } from "./controllers/assistant.controller";
import { AssistantDescriptor } from "./entities/assistant";
import { AssistantRepository } from "./repositories/assistant.repository";
import { AssistantService } from "./services/assistant.service";

@Module({
  imports: [ChatbotModule],
  controllers: [AssistantController],
  providers: [AssistantDescriptor.model.serialiser, AssistantRepository, AssistantService],
  exports: [AssistantService],
})
export class AssistantModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(AssistantDescriptor.model);
  }
}
