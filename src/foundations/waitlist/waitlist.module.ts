import { Module } from "@nestjs/common";
import { EmailModule } from "../../core/email/email.module";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { SecurityModule } from "../../core/security/security.module";
import { UserModule } from "../user/user.module";
import { WaitlistController } from "./controllers/waitlist.controller";
import { WaitlistDescriptor } from "./entities/waitlist";
import { WaitlistRepository } from "./repositories/waitlist.repository";
import { WaitlistService } from "./services/waitlist.service";

@Module({
  imports: [SecurityModule, JsonApiModule, EmailModule, UserModule],
  controllers: [WaitlistController],
  providers: [WaitlistDescriptor.model.serialiser, WaitlistRepository, WaitlistService],
  exports: [WaitlistService, WaitlistRepository],
})
export class WaitlistModule {}
