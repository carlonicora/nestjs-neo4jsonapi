import { Module } from "@nestjs/common";
import { LLMModule } from "../../core/llm/llm.module";
import { LoggingModule } from "../../core/logging/logging.module";
import { TracingModule } from "../../core/tracing/tracing.module";
import { CompanyRepository } from "../../foundations/company/repositories/company.repository";
import { CommunityModule } from "../../foundations/community/community.module";
import { CommunityDetectorModule } from "../community.detector/community.detector.module";
import { CommunitySearchNodeService } from "./nodes/community.search.node.service";
import { FollowUpNodeService } from "./nodes/followup.node.service";
import { HydeNodeService } from "./nodes/hyde.node.service";
import { PrimerAnswerNodeService } from "./nodes/primer.answer.node.service";
import { SynthesisNodeService } from "./nodes/synthesis.node.service";
import { DriftMigrationService } from "./services/drift.migration.service";
import { DriftSearchService } from "./services/drift.search.service";

// NOTE: DriftMigrationService needs CompanyRepository, but CompanyModule also
// declares CompanyController — importing the module would mount `companies/*`
// routes into every consumer of DriftModule (and therefore of ResponderModule),
// crashing any app that replaces the company foundation with its own controller.
// The repository only depends on globally-exported core services (Neo4jService,
// SecurityService, ClsService), so it is provided directly instead.
@Module({
  imports: [LLMModule, LoggingModule, TracingModule, CommunityModule, CommunityDetectorModule],
  providers: [
    CompanyRepository,
    // Node services
    HydeNodeService,
    CommunitySearchNodeService,
    PrimerAnswerNodeService,
    FollowUpNodeService,
    SynthesisNodeService,
    // Main services
    DriftSearchService,
    DriftMigrationService,
  ],
  exports: [DriftSearchService, DriftMigrationService],
})
export class DriftModule {}
