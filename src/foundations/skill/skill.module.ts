import { Global, Module, OnModuleInit } from "@nestjs/common";
import { ASSISTANT_SKILL_PROVIDER } from "../../common/interfaces/assistant.skill.interface";
import { modelRegistry } from "../../common/registries/registry";
import { AuditModule } from "../audit/audit.module";
import { CompanyModule } from "../company/company.module";
import { SkillAdminController } from "./controllers/skill.admin.controller";
import { SkillCompanyAdminController } from "./controllers/skill.company-admin.controller";
import { SkillController } from "./controllers/skill.controller";
import { SkillDescriptor } from "./entities/skill";
import { SkillRepository } from "./repositories/skill.repository";
import { SkillAdminService } from "./services/skill.admin.service";
import { SkillCompanyAdminService } from "./services/skill.company-admin.service";
import { SkillAssistantProvider } from "./services/skill.assistant.provider";
import { SkillService } from "./services/skill.service";

/**
 * SkillModule — Assistant skills. OPT-IN: mounted by FoundationsModule only when the app
 * passes `skill: {}`. Unmounted, no route exists and the Assistant has no skills.
 *
 * `@Global()` because the Assistant consumes ASSISTANT_SKILL_PROVIDER without importing
 * this module. SkillAdminController and SkillCompanyAdminController are listed first so
 * `skills/global…` and `skills/companies/:companyId…` are matched before `skills/:skillId`.
 */
@Global()
@Module({
  imports: [AuditModule, CompanyModule],
  controllers: [SkillAdminController, SkillCompanyAdminController, SkillController],
  providers: [
    SkillDescriptor.model.serialiser,
    SkillRepository,
    SkillService,
    SkillAdminService,
    SkillCompanyAdminService,
    SkillAssistantProvider,
    { provide: ASSISTANT_SKILL_PROVIDER, useExisting: SkillAssistantProvider },
  ],
  exports: [SkillService, SkillRepository, ASSISTANT_SKILL_PROVIDER],
})
export class SkillModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(SkillDescriptor.model);
  }
}
