import { DynamicModule, Module } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { RedisModule } from "../../core/redis/redis.module";
import { HowToModule } from "../how-to/how-to.module";
import { HELP_CONTENT_CONFIG_TOKEN } from "./tokens";
import { HelpContentConfig } from "./interfaces/help-content-config.interface";
import { HelpContentSyncService } from "./services/help-content-sync.service";
import { MdxToMarkdownService } from "./services/mdx-to-markdown.service";

@Module({})
export class HelpContentSyncModule {
  static forRoot(config: HelpContentConfig): DynamicModule {
    return {
      module: HelpContentSyncModule,
      imports: [RedisModule, HowToModule],
      providers: [
        { provide: HELP_CONTENT_CONFIG_TOKEN, useValue: config },
        createWorkerProvider(MdxToMarkdownService),
        createWorkerProvider(HelpContentSyncService),
      ],
    };
  }
}
