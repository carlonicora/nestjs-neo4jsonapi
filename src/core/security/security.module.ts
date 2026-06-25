import { DynamicModule, Module, Type } from "@nestjs/common";
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
export class SecurityModule {
  /**
   * Configure SecurityModule with an optional custom SecurityService subclass.
   *
   * When securityService is provided, the DI token SecurityService resolves
   * to that subclass (e.g. corpus's SecurityService that overrides userHasAccess).
   * When omitted, the default SecurityService is used (neural-erp behavior unchanged).
   *
   * @param securityService - Optional custom SecurityService subclass
   */
  static forRoot(securityService?: Type<SecurityService>): DynamicModule {
    const provider = securityService ? { provide: SecurityService, useClass: securityService } : SecurityService;
    return {
      module: SecurityModule,
      providers: [provider, JwtStrategy, JwtAuthGuard, AdminJwtAuthGuard, OptionalJwtAuthGuard],
      exports: [SecurityService, JwtStrategy, JwtAuthGuard, AdminJwtAuthGuard, OptionalJwtAuthGuard],
    };
  }
}
