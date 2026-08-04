import { Module, OnModuleInit } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { NotificationController } from "./controllers/notification.controller";
import { NotificationDescriptor } from "./entities/notification";
import { NotificationRepository } from "./repositories/notification.repository";
import { NotificationServices } from "./services/notification.service";

@Module({
  controllers: [NotificationController],
  providers: [NotificationRepository, NotificationServices, NotificationDescriptor.model.serialiser],
  exports: [NotificationRepository],
  imports: [],
})
export class NotificationModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(NotificationDescriptor.model);
  }
}
