import { AuditModule, modelRegistry } from "@carlonicora/nestjs-neo4jsonapi";
import { Module, OnModuleInit } from "@nestjs/common";
import { HowToController } from "src/features/essentials/how-to/controllers/how-to.controller";
import { HowToDescriptor } from "src/features/essentials/how-to/entities/how-to";
import { HowToRepository } from "src/features/essentials/how-to/repositories/how-to.repository";
import { HowToService } from "src/features/essentials/how-to/services/how-to.service";

@Module({
  controllers: [HowToController],
  providers: [HowToDescriptor.model.serialiser, HowToRepository, HowToService],
  exports: [],
  imports: [AuditModule],
})
export class HowToModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(HowToDescriptor.model);
  }
}
