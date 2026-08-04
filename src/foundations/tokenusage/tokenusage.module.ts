import { Module, OnModuleInit } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { TokenUsageDescriptor } from "./entities/tokenusage";
import { TokenUsageRepository } from "./repositories/tokenusage.repository";
import { TokenUsageService } from "./services/tokenusage.service";

@Module({
  controllers: [],
  providers: [TokenUsageDescriptor.model.serialiser, TokenUsageRepository, TokenUsageService],
  exports: [TokenUsageService],
  imports: [],
})
export class TokenUsageModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(TokenUsageDescriptor.model);
  }
}
