import { Module, OnModuleInit } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./controllers/auth.controller";

import { modelRegistry } from "../../common/registries/registry";
import { CompanyModule } from "../company/company.module";
import { DiscordUserModule } from "../discord-user/discord-user.module";
import { UserModule } from "../user/user.module";
import { AuthDiscordController } from "./controllers/auth.discord.controller";
import { AuthCodeModel } from "./entities/auth.code.model";
import { AuthModel } from "./entities/auth.model";
import { AuthRepository } from "./repositories/auth.repository";
import { AuthSerialiser } from "./serialisers/auth.serialiser";
import { AuthDiscordService } from "./services/auth.discord.service";
import { AuthService } from "./services/auth.service";

@Module({
  controllers: [AuthController, AuthDiscordController],
  providers: [AuthService, AuthRepository, AuthSerialiser, AuthDiscordService],
  exports: [AuthService],
  imports: [UserModule, JwtModule, CompanyModule, DiscordUserModule],
})
export class AuthModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(AuthModel);
    modelRegistry.register(AuthCodeModel);
  }
}
