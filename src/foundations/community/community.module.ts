import { Module, OnModuleInit } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { CommunityDescriptor } from "./entities/community.entity";
import { CommunityRepository } from "./repositories/community.repository";
import { CommunityLayerService } from "./services/community-layer.service";
import { CommunityService } from "./services/community.service";

@Module({
  controllers: [],
  providers: [CommunityService, CommunityRepository, CommunityLayerService],
  exports: [CommunityService, CommunityRepository, CommunityLayerService],
  imports: [],
})
export class CommunityModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(CommunityDescriptor.model);
  }
}
