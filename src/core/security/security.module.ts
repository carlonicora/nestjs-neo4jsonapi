import { Module } from "@nestjs/common";
import { AdminJwtAuthGuard } from "../../common/guards/jwt.auth.admin.guard";
import { JwtAuthGuard } from "../../common/guards/jwt.auth.guard";
import { OptionalJwtAuthGuard } from "../../common/guards/jwt.auth.optional.guard";
import { JwtStrategy } from "../../common/strategies/jwt.strategy";
import { SecurityService } from "./services/security.service";

@Module({
  controllers: [],
  providers: [SecurityService, JwtStrategy, JwtAuthGuard, AdminJwtAuthGuard, OptionalJwtAuthGuard],
  exports: [SecurityService, JwtStrategy, JwtAuthGuard, AdminJwtAuthGuard, OptionalJwtAuthGuard],
})
export class SecurityModule {}
