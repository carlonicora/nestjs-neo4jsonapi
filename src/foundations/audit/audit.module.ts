import { Module, OnModuleInit } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { AuditController } from "./controllers/audit.controller";
import { auditLogModel } from "./entities/audit.model";
import { AuditRepository } from "./repositories/audit.repository";
import { AuditSerialiser } from "./serialisers/audit.serialiser";
import { AuditService } from "./services/audit.service";

@Module({
  // NOTE: do NOT import UserModule here. Audit only uses userMeta/UserDescriptor as
  // direct value imports (Cypher + serialiser), never UserModule's DI providers.
  // Importing it re-registers UserController, which collides with a host app that
  // ships its own user foundation (duplicate GET /users at boot). Full adopters
  // still load UserModule via FoundationsModule.
  imports: [JsonApiModule],
  controllers: [AuditController],
  providers: [AuditSerialiser, AuditService, AuditRepository],
  exports: [AuditService],
})
export class AuditModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(auditLogModel);
  }
}
