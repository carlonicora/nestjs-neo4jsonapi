import { forwardRef, Module, OnApplicationBootstrap, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { GraphModule } from "../../agents/graph/graph.module";
import { OperatorModule } from "../../agents/operator/operator.module";
import { ResponderModule } from "../../agents/responder/responder.module";
import { modelRegistry } from "../../common/registries/registry";
import { BlockNoteModule } from "../../core/blocknote/blocknote.module";
import { AssistantActionModule } from "../assistant-action/assistant-action.module";
import { AssistantMessageModule } from "../assistant-message/assistant-message.module";
import { assistantMessageMeta } from "../assistant-message/entities/assistant-message.meta";
import { AssistantController } from "./controllers/assistant.controller";
import { AssistantDescriptor } from "./entities/assistant";
import { assistantMeta } from "./entities/assistant.meta";
import { AssistantRepository } from "./repositories/assistant.repository";
import { AssistantMentionExtractor } from "./services/assistant-mention.extractor";
import { AssistantService } from "./services/assistant.service";

@Module({
  // forwardRef: AssistantActionModule's controller needs AssistantService
  // (resolveAction) while the operator turn flow here needs that module's
  // service/repository to create and resolve pending actions.
  // forwardRef on OperatorModule: its standalone OperatorController needs
  // AssistantService while AssistantService needs OperatorService.
  // GraphModule supplies GraphCatalogService and ScopeGuard (mention
  // validation + hydration scope filtering); BlockNoteModule supplies the
  // markdown conversion used to persist a rich composer payload.
  imports: [
    GraphModule,
    BlockNoteModule,
    ResponderModule,
    forwardRef(() => OperatorModule),
    AssistantMessageModule,
    forwardRef(() => AssistantActionModule),
  ],
  controllers: [AssistantController],
  providers: [AssistantDescriptor.model.serialiser, AssistantRepository, AssistantMentionExtractor, AssistantService],
  exports: [AssistantService, AssistantMessageModule],
})
export class AssistantModule implements OnModuleInit, OnApplicationBootstrap {
  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit() {
    modelRegistry.register(AssistantDescriptor.model);
  }

  onApplicationBootstrap() {
    const all = modelRegistry.getAllModels();
    // BOUND_TO is a multi-label polymorphic relationship: the repository's
    // read query keeps the bound target only when its label is among these
    // candidates ($polyLabels_content). Left empty, the target never loads and
    // follow-up turns lose the thread's content scope.
    // Only models whose serialiser is an instantiated provider can be bound:
    // the auto serialiser builds every candidate's serialiser through ModuleRef
    // when it serialises an assistant. An app can register a model (for typed
    // reads) without providing its serialiser — an internal entity that is
    // never served over HTTP — and listing it here crashes every assistant
    // response with "Nest could not find <X>AutoSerialiser element".
    const candidates = all.filter(
      (m) =>
        !!m.serialiser &&
        m.type !== assistantMessageMeta.type &&
        m.type !== assistantMeta.type &&
        this.isSerialiserResolvable(m.serialiser),
    );
    AssistantDescriptor.relationships.content.polymorphic!.candidates = candidates;
  }

  private isSerialiserResolvable(serialiser: unknown): boolean {
    try {
      return !!this.moduleRef.get(serialiser as any, { strict: false });
    } catch {
      return false;
    }
  }
}
