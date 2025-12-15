import { Module, OnModuleInit } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { CommunityModel } from "./entities/community.model";
import { CommunityRepository } from "./repositories/community.repository";
import { CommunityService } from "./services/community.service";

@Module({
  controllers: [],
  providers: [CommunityService, CommunityRepository],
  exports: [CommunityService, CommunityRepository],
  imports: [],
})
export class CommunityModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(CommunityModel);
  }
}
