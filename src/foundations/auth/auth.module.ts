import { BullModule } from "@nestjs/bullmq";
import { Module, OnModuleInit } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./controllers/auth.controller";

import { modelRegistry } from "../../common/registries/registry";
import { QueueId } from "../../config/enums/queue.id";
import { CompanyModule } from "../company/company.module";
import { DiscordUserModule } from "../discord-user/discord-user.module";
import { GoogleUserModule } from "../google-user/google-user.module";
import { UserModule } from "../user/user.module";
import { WaitlistModule } from "../waitlist/waitlist.module";
import { AuthDiscordController } from "./controllers/auth.discord.controller";
import { AuthGoogleController } from "./controllers/auth.google.controller";
import { AuthCodeModel } from "./entities/auth.code.model";
import { AuthModel } from "./entities/auth.model";
import { AuthRepository } from "./repositories/auth.repository";
import { AuthSerialiser } from "./serialisers/auth.serialiser";
import { AuthDiscordService } from "./services/auth.discord.service";
import { AuthGoogleService } from "./services/auth.google.service";
import { AuthService } from "./services/auth.service";
import { PendingRegistrationService } from "./services/pending-registration.service";
import { TrialQueueService } from "./services/trial-queue.service";

@Module({
  controllers: [AuthController, AuthDiscordController, AuthGoogleController],
  providers: [
    AuthService,
    AuthRepository,
    AuthSerialiser,
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
    BullModule.registerQueue({ name: QueueId.TRIAL }),
  ],
})
export class AuthModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(AuthModel);
    modelRegistry.register(AuthCodeModel);
  }
}
