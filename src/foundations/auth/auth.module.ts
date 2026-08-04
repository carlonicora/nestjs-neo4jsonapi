import { BullModule } from "@nestjs/bullmq";
import { forwardRef, Module, OnModuleInit } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthCompanyController } from "./controllers/auth.company.controller";
import { AuthController } from "./controllers/auth.controller";

import { modelRegistry } from "../../common/registries/registry";
import { QueueId } from "../../config/enums/queue.id";
import { CompanyModule } from "../company/company.module";
import { DiscordUserModule } from "../discord-user/discord-user.module";
import { GoogleUserModule } from "../google-user/google-user.module";
import { TwoFactorModule } from "../two-factor/two-factor.module";
import { UserModule } from "../user/user.module";
import { WaitlistModule } from "../waitlist/waitlist.module";
import { AuthDiscordController } from "./controllers/auth.discord.controller";
import { AuthGoogleController } from "./controllers/auth.google.controller";
import { AuthDescriptor } from "./entities/auth";
import { AuthCodeDescriptor } from "./entities/auth.code";
import { PendingAuthDescriptor } from "./entities/pending-auth";
import { AuthRepository } from "./repositories/auth.repository";
import { AuthDiscordService } from "./services/auth.discord.service";
import { AuthGoogleService } from "./services/auth.google.service";
import { AuthService } from "./services/auth.service";
import { PendingRegistrationService } from "./services/pending-registration.service";
import { TrialQueueService } from "./services/trial-queue.service";

@Module({
  controllers: [AuthCompanyController, AuthController, AuthDiscordController, AuthGoogleController],
  providers: [
    AuthService,
    AuthRepository,
    AuthDescriptor.model.serialiser,
    AuthCodeDescriptor.model.serialiser,
    PendingAuthDescriptor.model.serialiser,
    AuthDiscordService,
    AuthGoogleService,
    PendingRegistrationService,
    TrialQueueService,
  ],
  exports: [AuthService, PendingRegistrationService, TrialQueueService],
  imports: [
    UserModule,
    JwtModule,
    CompanyModule,
    DiscordUserModule,
    GoogleUserModule,
    WaitlistModule,
    forwardRef(() => TwoFactorModule),
    BullModule.registerQueue({ name: QueueId.TRIAL }),
  ],
})
export class AuthModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(AuthDescriptor.model);
    modelRegistry.register(AuthCodeDescriptor.model);
    modelRegistry.register(PendingAuthDescriptor.model);
  }
}
