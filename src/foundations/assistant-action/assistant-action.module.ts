import { forwardRef, Module, OnModuleInit } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { LoggingModule } from "../../core/logging/logging.module";
import { AssistantModule } from "../assistant/assistant.module";
import { AuditModule } from "../audit/audit.module";
import { AssistantActionController } from "./controllers/assistant-action.controller";
import { AssistantActionExpiryCron } from "./cron/assistant-action.expiry.cron";
import { AssistantActionDescriptor } from "./entities/assistant-action";
import { AssistantActionRepository } from "./repositories/assistant-action.repository";
import { AssistantActionService } from "./services/assistant-action.service";

@Module({
  // forwardRef: the controller needs AssistantService (resolveAction), while
  // the operator turn flow in AssistantModule needs this module's service /
  // repository to create and resolve pending actions.
  imports: [forwardRef(() => AssistantModule), AuditModule, LoggingModule],
  controllers: [AssistantActionController],
  providers: [
    AssistantActionDescriptor.model.serialiser,
    AssistantActionRepository,
    AssistantActionService,
    createWorkerProvider(AssistantActionExpiryCron),
  ],
  exports: [AssistantActionService, AssistantActionRepository],
})
export class AssistantActionModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(AssistantActionDescriptor.model);
  }
}
