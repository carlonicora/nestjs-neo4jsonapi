import { Module, OnModuleInit } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { BlockNoteModule } from "../../core/blocknote/blocknote.module";
import { AuditModule } from "../audit/audit.module";
import { ChunkModule } from "../chunk/chunk.module";
import { ChunkerModule } from "../chunker/chunker.module";
import { TokenUsageModule } from "../tokenusage/tokenusage.module";
import { HowToController } from "./controllers/how-to.controller";
import { HowToDescriptor } from "./entities/how-to";
import { HowToProcessor } from "./processors/how-to.processor";
import { HowToRepository } from "./repositories/how-to.repository";
import { HowToService } from "./services/how-to.service";

@Module({
  controllers: [HowToController],
  providers: [HowToDescriptor.model.serialiser, HowToRepository, HowToService, createWorkerProvider(HowToProcessor)],
  exports: [HowToRepository, HowToService],
  imports: [AuditModule, BlockNoteModule, ChunkModule, ChunkerModule, TokenUsageModule],
})
export class HowToModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(HowToDescriptor.model);
  }
}
