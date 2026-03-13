import { Module, OnModuleInit } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { AuditController } from "./controllers/audit.controller";
import { auditLogModel } from "./entities/audit.model";
import { AuditRepository } from "./repositories/audit.repository";
import { AuditSerialiser } from "./serialisers/audit.serialiser";
import { AuditService } from "./services/audit.service";
import { UserModule } from "../user/user.module";

@Module({
  imports: [JsonApiModule, UserModule],
  controllers: [AuditController],
  providers: [AuditSerialiser, AuditService, AuditRepository],
  exports: [AuditService],
})
export class AuditModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(auditLogModel);
  }
}
