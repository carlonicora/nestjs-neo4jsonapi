import { Injectable, Logger } from "@nestjs/common";
import { GraphCatalogService } from "../../../agents/graph/services/graph.catalog.service";
import { ScopeGuard } from "../../../agents/graph/services/scope.guard";
import { UserContext } from "../../../agents/graph/tools/tool.factory";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";

export interface ExtractedMention {
  /** JSON:API type, e.g. "npcs". */
  type: string;
  id: string;
  /** Display text the user saw. */
  alias: string;
}

/**
 * Turns a BlockNote document into the entity references a user message pins.
 *
 * A mention arrives from the browser, so it is INPUT, not a trusted pointer:
 * validate() re-checks catalog membership, scope and existence before any of
 * it reaches the LLM or becomes a REFERENCES edge.
 */
@Injectable()
export class AssistantMentionExtractor {
  private readonly logger = new Logger(AssistantMentionExtractor.name);

  constructor(
    private readonly catalog: GraphCatalogService,
    private readonly scopeGuard: ScopeGuard,
    private readonly entityServices: EntityServiceRegistry,
  ) {}

  /** Walks a BlockNote document for inline nodes of type "mention". Never throws. */
  extract(blocks: unknown[]): ExtractedMention[] {
    const out: ExtractedMention[] = [];
    const seen = new Set<string>();

    const walk = (node: any): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node.type === "mention") {
        const id = node.props?.id;
        const type = node.props?.entityType;
        if (typeof id === "string" && typeof type === "string") {
          const key = `${type}/${id}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ type, id, alias: String(node.props?.alias ?? "") });
          }
        }
        return;
      }
      walk(node.content);
      walk(node.children);
    };

    try {
      walk(blocks);
    } catch (err) {
      this.logger.warn(`extract: malformed document — ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
    return out;
  }

  /**
   * Drops mentions that are not in the catalog for these modules, are outside
   * the run's scope, or no longer resolve to a record.
   */
  async validate(params: { mentions: ExtractedMention[]; ctx: UserContext }): Promise<ExtractedMention[]> {
    const kept: ExtractedMention[] = [];
    for (const mention of params.mentions) {
      if (!this.catalog.getEntityDetail(mention.type, params.ctx.userModuleIds)) {
        this.logger.warn(`validate: dropping mention of uncatalogued type "${mention.type}".`);
        continue;
      }
      if (!(await this.scopeGuard.isInScope({ type: mention.type, id: mention.id, ctx: params.ctx }))) {
        this.logger.warn(`validate: dropping out-of-scope mention ${mention.type}/${mention.id}.`);
        continue;
      }
      const service = this.entityServices.get(mention.type);
      if (!service || !(await service.findRecordById({ id: mention.id }))) {
        this.logger.warn(`validate: dropping unreadable mention ${mention.type}/${mention.id}.`);
        continue;
      }
      kept.push(mention);
    }
    return kept;
  }
}
