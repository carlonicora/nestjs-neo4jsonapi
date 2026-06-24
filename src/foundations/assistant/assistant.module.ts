import { forwardRef, Module, OnModuleInit } from "@nestjs/common";
import { GraphModule } from "../../agents/graph/graph.module";
import { OperatorModule } from "../../agents/operator/operator.module";
import { ResponderModule } from "../../agents/responder/responder.module";
import { modelRegistry } from "../../common/registries/registry";
import { AssistantActionModule } from "../assistant-action/assistant-action.module";
import { AssistantMessageModule } from "../assistant-message/assistant-message.module";
import { AssistantController } from "./controllers/assistant.controller";
import { AssistantDescriptor } from "./entities/assistant";
import { AssistantRepository } from "./repositories/assistant.repository";
import { AssistantService } from "./services/assistant.service";

@Module({
  // forwardRef: AssistantActionModule's controller needs AssistantService
  // (resolveAction) while the operator turn flow here needs that module's
  // service/repository to create and resolve pending actions.
  // forwardRef on OperatorModule: its standalone OperatorController needs
  // AssistantService while AssistantService needs OperatorService.
  imports: [
    GraphModule,
    ResponderModule,
    forwardRef(() => OperatorModule),
    AssistantMessageModule,
    forwardRef(() => AssistantActionModule),
  ],
  controllers: [AssistantController],
  providers: [AssistantDescriptor.model.serialiser, AssistantRepository, AssistantService],
  exports: [AssistantService, AssistantMessageModule],
})
export class AssistantModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(AssistantDescriptor.model);
  }
}
