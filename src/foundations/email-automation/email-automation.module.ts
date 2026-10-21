import { DynamicModule, Module, OnModuleInit, Provider } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { CacheModule } from "../../core/cache/cache.module";
import { EmailModule } from "../../core/email/email.module";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { SecurityModule } from "../../core/security/security.module";
import { AuditModule } from "../audit/audit.module";
import { UserModule } from "../user/user.module";
import { EmailAutomationStepController } from "./controllers/email-automation-step.controller";
import { EmailAutomationController } from "./controllers/email-automation.controller";
import { EmailAutomationPublicController } from "./controllers/email-automation.public.controller";
import { EmailAutomationSenderCron } from "./cron/email-automation-sender.cron";
import { EmailAutomationDescriptor } from "./entities/email-automation";
import { EmailAutomationEnrollmentDescriptor } from "./entities/email-automation-enrollment";
import { EmailAutomationStepDescriptor } from "./entities/email-automation-step";
import { EmailAutomationTriggerDescriptor } from "./entities/email-automation-trigger";
import { EmailOptOutDescriptor } from "./entities/email-opt-out";
import {
  DEFAULT_EMAIL_AUTOMATION_CONFIG,
  EMAIL_AUTOMATION_CONFIG,
  EmailAutomationModuleConfig,
} from "./interfaces/email-automation.config.interface";
import { EmailAutomationEnrollmentRepository } from "./repositories/email-automation-enrollment.repository";
import { EmailAutomationStepRepository } from "./repositories/email-automation-step.repository";
import { EmailAutomationRepository } from "./repositories/email-automation.repository";
import { EmailOptOutRepository } from "./repositories/email-opt-out.repository";
import { EmailAutomationRenderer } from "./services/email-automation-renderer.service";
import { EmailAutomationSenderService } from "./services/email-automation-sender.service";
import { EmailAutomationStepService } from "./services/email-automation-step.service";
import { EmailAutomationTriggerService } from "./services/email-automation-trigger.service";
import { EmailAutomationUnsubscribeService } from "./services/email-automation-unsubscribe.service";
import { EmailAutomationService } from "./services/email-automation.service";

/**
 * EmailAutomationModule — linear email sequences administrators build on a canvas.
 *
 * - Admin CRUD over automations and steps (`EmailAutomationController`,
 *   `EmailAutomationStepController`, administrators only)
 * - A public one-click unsubscribe route (`EmailAutomationPublicController`)
 * - A listener that enrols people on the triggers the app declares
 *   (`EmailAutomationTriggerService`)
 * - An hourly sender, registered on worker instances only (`EmailAutomationSenderCron`)
 *
 * The library declares no trigger: with no `triggers` the routes exist but nobody
 * is ever enrolled.
 *
 * @example
 * ```typescript
 * EmailAutomationModule.forRoot({
 *   triggers: [waitlistConfirmedTrigger("waitlist-confirmed"), userActivatedTrigger("registration-completed")],
 * })
 *
 * // Through FoundationsModule, which mounts this module for you
 * FoundationsModule.forRoot({ emailAutomation: { triggers: [...] } })
 * ```
 */
@Module({})
export class EmailAutomationModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(EmailAutomationDescriptor.model);
    modelRegistry.register(EmailAutomationStepDescriptor.model);
    modelRegistry.register(EmailAutomationEnrollmentDescriptor.model);
    modelRegistry.register(EmailOptOutDescriptor.model);
    // Synthetic resource (never a node): buildList needs it in the registry
    modelRegistry.register(EmailAutomationTriggerDescriptor.model);
  }

  /**
   * Configure the EmailAutomationModule.
   *
   * @param config - Optional configuration merged over DEFAULT_EMAIL_AUTOMATION_CONFIG
   */
  static forRoot(config?: EmailAutomationModuleConfig): DynamicModule {
    const mergedConfig: Required<EmailAutomationModuleConfig> = { ...DEFAULT_EMAIL_AUTOMATION_CONFIG, ...config };

    const configProvider: Provider = {
      provide: EMAIL_AUTOMATION_CONFIG,
      useValue: mergedConfig,
    };

    return {
      module: EmailAutomationModule,
      imports: [SecurityModule, JsonApiModule, EmailModule, UserModule, CacheModule, AuditModule],
      controllers: [EmailAutomationController, EmailAutomationStepController, EmailAutomationPublicController],
      providers: [
        configProvider,
        EmailAutomationDescriptor.model.serialiser,
        EmailAutomationStepDescriptor.model.serialiser,
        EmailAutomationEnrollmentDescriptor.model.serialiser,
        EmailOptOutDescriptor.model.serialiser,
        EmailAutomationTriggerDescriptor.model.serialiser,
        EmailAutomationRepository,
        EmailAutomationStepRepository,
        EmailAutomationEnrollmentRepository,
        EmailOptOutRepository,
        EmailAutomationService,
        EmailAutomationStepService,
        EmailAutomationTriggerService,
        EmailAutomationRenderer,
        EmailAutomationSenderService,
        EmailAutomationUnsubscribeService,
        createWorkerProvider(EmailAutomationSenderCron),
      ],
      exports: [
        EmailAutomationService,
        EmailAutomationStepService,
        EmailAutomationRepository,
        EmailAutomationStepRepository,
        EmailAutomationEnrollmentRepository,
        EmailOptOutRepository,
        EMAIL_AUTOMATION_CONFIG,
      ],
    };
  }
}
