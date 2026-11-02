import { Module } from "@nestjs/common";
import { LLMModule } from "../../core/llm/llm.module";
import { LoggingModule } from "../../core/logging/logging.module";
import { TracingModule } from "../../core/tracing/tracing.module";
import { CommunityModule } from "../../foundations/community/community.module";
import { CommunityDetectorModule } from "../community.detector/community.detector.module";
import { CommunitySearchNodeService } from "./nodes/community.search.node.service";
import { FollowUpNodeService } from "./nodes/followup.node.service";
import { HydeNodeService } from "./nodes/hyde.node.service";
import { PrimerAnswerNodeService } from "./nodes/primer.answer.node.service";
import { SynthesisNodeService } from "./nodes/synthesis.node.service";
import { DriftMigrationService } from "./services/drift.migration.service";
import { DriftSearchService } from "./services/drift.search.service";

// NOTE: DriftMigrationService needs CompanyRepository, but this module neither
// imports CompanyModule (it declares CompanyController, which would mount
// `companies/*` routes into every consumer of DriftModule and crash any app that
// replaces the company foundation with its own controller) nor provides its own
// copy (a second repository instance would rebuild `company_search_index` from
// its own descriptor on every boot, fighting an app's extended descriptor).
// DriftMigrationService resolves the app's CompanyRepository at call time via
// ModuleRef instead.
@Module({
  imports: [LLMModule, LoggingModule, TracingModule, CommunityModule, CommunityDetectorModule],
  providers: [
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
