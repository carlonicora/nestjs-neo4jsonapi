import { Global, Module } from "@nestjs/common";
import { ResponseLanguageService } from "./services/response-language.service";
import { UserModule } from "./user.module";

/**
 * Response Language Module
 *
 * Global so LLM, email and feature services can resolve the response
 * language without importing it. Disabled unless `config.i18n.enabled`.
 * Registered with the foundation modules, never from core: a core module
 * importing a foundation module closes an import cycle through the core barrel.
 */
@Global()
@Module({
  imports: [UserModule],
  providers: [ResponseLanguageService],
  exports: [ResponseLanguageService],
})
export class ResponseLanguageModule {}
