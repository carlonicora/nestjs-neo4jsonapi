import { Module } from "@nestjs/common";
import { GraphModule } from "./graph/graph.module";
import { CommunityDetectorModule } from "./community.detector/community.detector.module";
import { CommunitySummariserModule } from "./community.summariser/community.summariser.module";
import { ContextualiserModule } from "./contextualiser/contextualiser.module";
import { DriftModule } from "./drift/drift.module";
import { GraphCreatorModule } from "./graph.creator/graph.creator.module";
import { ResponderModule } from "./responder/responder.module";
import { SummariserModule } from "./summariser/summariser.module";

/**
 * Centralized module for all AI agents.
 *
 * Prompts are configured via baseConfig.prompts (set in createBaseConfig()).
 */
@Module({
  imports: [
    GraphModule,
    CommunityDetectorModule,
    CommunitySummariserModule,
    ContextualiserModule,
    DriftModule,
    GraphCreatorModule,
    ResponderModule,
    SummariserModule,
  ],
  exports: [
    GraphModule,
    CommunityDetectorModule,
    CommunitySummariserModule,
    ContextualiserModule,
    DriftModule,
    GraphCreatorModule,
    ResponderModule,
    SummariserModule,
  ],
})
export class AgentsModule {}
