import { DynamicModule, Module } from "@nestjs/common";
import { GraphCreatorService } from "./services/graph.creator.service";
import { LLMModule } from "../../core/llm/llm.module";
import { LoggingModule } from "../../core/logging/logging.module";
import { GRAPH_CREATOR_PROMPT } from "../prompts/prompt.tokens";

export interface GraphCreatorModuleOptions {
  /**
   * Custom prompt for the graph creator.
   * If not provided, the default prompt will be used.
   */
  prompt?: string;
}

@Module({
  providers: [GraphCreatorService],
  exports: [GraphCreatorService],
  imports: [LLMModule, LoggingModule],
})
export class GraphCreatorModule {
  /**
   * Configure the GraphCreatorModule with custom options
   */
  static forRoot(options?: GraphCreatorModuleOptions): DynamicModule {
    const providers: any[] = [GraphCreatorService];

    if (options?.prompt) {
      providers.push({
        provide: GRAPH_CREATOR_PROMPT,
        useValue: options.prompt,
      });
    }

    return {
      module: GraphCreatorModule,
      providers,
      exports: [GraphCreatorService],
      imports: [LLMModule, LoggingModule],
    };
  }
}
