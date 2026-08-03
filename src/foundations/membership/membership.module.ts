import { Module, OnModuleInit } from "@nestjs/common";

import { modelRegistry } from "../../common/registries/registry";
import { MembershipDescriptor } from "./entities/membership";
import { MembershipRepository } from "./repositories/membership.repository";

/**
 * Membership is backend-internal: no controller, no endpoint.
 * The repository exists only to bootstrap the uniqueness constraint.
 */
@Module({
  controllers: [],
  providers: [MembershipRepository, MembershipDescriptor.model.serialiser],
  exports: [MembershipRepository],
  imports: [],
})
export class MembershipModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(MembershipDescriptor.model);
  }
}
