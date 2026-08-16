import { Module, OnModuleInit } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { AuditModule } from "../audit/audit.module";
import { AiConnectionController } from "./controllers/ai-connection.controller";
import { AiConnectionDescriptor } from "./entities/ai-connection";
import { AiConnectionRepository } from "./repositories/ai-connection.repository";
import { AiConnectionEncryptionService } from "./services/ai-connection-encryption.service";
import { AiConnectionService } from "./services/ai-connection.service";

@Module({
  controllers: [AiConnectionController],
  providers: [
    AiConnectionDescriptor.model.serialiser,
    AiConnectionRepository,
    AiConnectionService,
    AiConnectionEncryptionService,
  ],
  exports: [AiConnectionRepository, AiConnectionService, AiConnectionEncryptionService],
  imports: [AuditModule],
})
export class AiConnectionModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(AiConnectionDescriptor.model);
  }
}
