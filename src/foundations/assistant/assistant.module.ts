import { Module, OnModuleInit } from "@nestjs/common";
import { GraphModule } from "../../agents/graph/graph.module";
import { ResponderModule } from "../../agents/responder/responder.module";
import { modelRegistry } from "../../common/registries/registry";
import { AssistantMessageModule } from "../assistant-message/assistant-message.module";
import { AssistantController } from "./controllers/assistant.controller";
import { AssistantDescriptor } from "./entities/assistant";
import { AssistantRepository } from "./repositories/assistant.repository";
import { AssistantService } from "./services/assistant.service";

@Module({
  imports: [GraphModule, ResponderModule, AssistantMessageModule],
  controllers: [AssistantController],
  providers: [AssistantDescriptor.model.serialiser, AssistantRepository, AssistantService],
  exports: [AssistantService, AssistantMessageModule],
})
export class AssistantModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(AssistantDescriptor.model);
  }
}
