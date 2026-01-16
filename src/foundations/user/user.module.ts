import { Module, OnModuleInit } from "@nestjs/common";

import { modelRegistry } from "../../common/registries/registry";
import { CompanyModule } from "../company/company.module";
import { RelevancyModule } from "../relevancy";
import { S3Module } from "../s3/s3.module";
import { UserController } from "./controllers/user.controller";
import { UserDescriptor, OwnerDescriptor, AssigneeDescriptor, AuthorDescriptor } from "./entities/user";
import { UserRepository } from "./repositories/user.repository";
import { UserCypherService } from "./services/user.cypher.service";
import { UserService } from "./services/user.service";

@Module({
  controllers: [UserController],
  providers: [UserRepository, UserService, UserDescriptor.model.serialiser, UserCypherService],
  exports: [UserService, UserRepository, UserDescriptor.model.serialiser, UserCypherService],
  imports: [CompanyModule, S3Module, RelevancyModule],
})
export class UserModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(UserDescriptor.model);
    modelRegistry.register(OwnerDescriptor.model);
    modelRegistry.register(AssigneeDescriptor.model);
    modelRegistry.register(AuthorDescriptor.model);
  }
}
