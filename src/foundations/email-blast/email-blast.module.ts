import { BullModule } from "@nestjs/bullmq";
import { DynamicModule, Module, OnModuleInit } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { QueueId } from "../../config/enums/queue.id";
import { CacheModule } from "../../core/cache/cache.module";
import { EmailModule } from "../../core/email/email.module";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { SecurityModule } from "../../core/security/security.module";
import { AuditModule } from "../audit/audit.module";
import { EmailAutomationDescriptor } from "../email-automation/entities/email-automation";
import { EmailAutomationEnrollmentDescriptor } from "../email-automation/entities/email-automation-enrollment";
import { EmailAutomationStepDescriptor } from "../email-automation/entities/email-automation-step";
import { EmailOptOutDescriptor } from "../email-automation/entities/email-opt-out";
import { EmailAutomationEnrollmentRepository } from "../email-automation/repositories/email-automation-enrollment.repository";
import { EmailOptOutRepository } from "../email-automation/repositories/email-opt-out.repository";
import { UserModule } from "../user/user.module";
import { EmailBlastController } from "./controllers/email-blast.controller";
import { EmailBlastPublicController } from "./controllers/email-blast.public.controller";
import { EmailBlastRecoveryCron } from "./cron/email-blast-recovery.cron";
import { EmailBlastDescriptor } from "./entities/email-blast";
import { EmailBlastAudienceDescriptor } from "./entities/email-blast-audience";
import { EmailBlastDeliveryDescriptor } from "./entities/email-blast-delivery";
import { EmailBlastProcessor } from "./processors/email-blast.processor";
import { EmailBlastAdminRepository } from "./repositories/email-blast.admin.repository";
import { EmailBlastDeliveryRepository } from "./repositories/email-blast-delivery.repository";
import { EmailBlastRepository } from "./repositories/email-blast.repository";
import { EmailBlastDeliveryService } from "./services/email-blast-delivery.service";
import { EmailBlastService } from "./services/email-blast.service";

/**
 * EmailBlastModule — one-off marketing emails an administrator sends to every registered
 * user who gave marketing consent.
 *
 * - Admin CRUD, recipient count, test send and Send (`EmailBlastController`, administrators only)
 * - A public unsubscribe route (`EmailBlastPublicController`) that stops all marketing email
 * - A worker job that snapshots the recipients and sends (`EmailBlastProcessor`)
 * - A recovery cron that fails stuck deliveries and re-queues interrupted sends
 *   (`EmailBlastRecoveryCron`)
 *
 * It does not import `EmailAutomationModule`: that module is `@Module({})` with everything in
 * `forRoot()`, so the bare class resolves nothing and a second `forRoot()` would mount the
 * automation controllers and cron twice. The two automation repositories it needs are
 * provided here with their serialisers.
 */
@Module({})
export class EmailBlastModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(EmailBlastDescriptor.model);
    modelRegistry.register(EmailBlastDeliveryDescriptor.model);
    // Synthetic resource (never a node): buildSingle needs it in the registry
    modelRegistry.register(EmailBlastAudienceDescriptor.model);
  }

  static forRoot(): DynamicModule {
    return {
      module: EmailBlastModule,
      imports: [
        SecurityModule,
        JsonApiModule,
        EmailModule,
        UserModule,
        CacheModule,
        AuditModule,
        BullModule.registerQueue({ name: QueueId.EMAIL_BLAST }),
      ],
      controllers: [EmailBlastController, EmailBlastPublicController],
      providers: [
        EmailBlastDescriptor.model.serialiser,
        EmailBlastDeliveryDescriptor.model.serialiser,
        EmailBlastAudienceDescriptor.model.serialiser,
        EmailOptOutDescriptor.model.serialiser,
        EmailAutomationEnrollmentDescriptor.model.serialiser,
        EmailAutomationDescriptor.model.serialiser,
        EmailAutomationStepDescriptor.model.serialiser,
        EmailBlastRepository,
        EmailBlastDeliveryRepository,
        EmailBlastAdminRepository,
        EmailOptOutRepository,
        EmailAutomationEnrollmentRepository,
        EmailBlastService,
        EmailBlastDeliveryService,
        createWorkerProvider(EmailBlastProcessor),
        createWorkerProvider(EmailBlastRecoveryCron),
      ],
      exports: [EmailBlastService, EmailBlastDeliveryService, EmailBlastRepository, EmailBlastDeliveryRepository],
    };
  }
}
