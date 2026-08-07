import { Module } from "@nestjs/common";
import { ContextualiserModule } from "../contextualiser/contextualiser.module";
import { DriftModule } from "../drift/drift.module";
import { GraphModule } from "../graph/graph.module";
import { ResponderContextFactoryService } from "./factories/responder.context.factory";
import { GraphNodeService } from "./nodes/graph.node.service";
import { PlannerNodeService } from "./nodes/planner.node.service";
import { ResponderAnswerNodeService } from "./nodes/responder.answer.node.service";
import { ResponderService } from "./services/responder.service";
import { LLMModule } from "../../core/llm/llm.module";
import { S3Module } from "../../foundations/s3/s3.module";

// NOTE: CompanyModule is deliberately NOT imported. Nothing in this module's
// provider graph injects CompanyService/CompanyRepository, and CompanyModule
// declares CompanyController — importing it mounts `companies/*` routes into
// every consumer. An app that replaces the company foundation with its own
// controller then boots into a duplicate-route crash.
@Module({
  imports: [LLMModule, S3Module, ContextualiserModule, DriftModule, GraphModule],
  providers: [
    ResponderContextFactoryService,
    ResponderService,
    ResponderAnswerNodeService,
    PlannerNodeService,
    GraphNodeService,
  ],
  exports: [ResponderService, PlannerNodeService, GraphNodeService],
})
export class ResponderModule {}
