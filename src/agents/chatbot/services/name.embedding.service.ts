import { Injectable, Logger } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { EmbedderService } from "../../../core/llm/services/embedder.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { GraphCatalogService } from "./graph.catalog.service";

export interface EmbedNameRequest {
  /** Neo4j label name (e.g. "Account"). */
  entityType: string;
  /** Entity id. */
  entityId: string;
}

@Injectable()
export class NameEmbeddingService {
  private readonly logger = new Logger(NameEmbeddingService.name);

  constructor(
    private readonly embedder: EmbedderService,
    private readonly neo4j: Neo4jService,
    private readonly catalog: GraphCatalogService,
    private readonly cls: ClsService,
  ) {}

  /**
   * Read the entity, compose source text from descriptor.textSearchFields,
   * embed it, and write the embedding back. Synchronous — call in the same
   * request flow as the entity create/put/patch.
   *
   * Noops when:
   * - the descriptor is not chat-enabled
   * - the entity does not exist
   * - the composed text is empty
   * - the source text matches what's already stored (dedup)
   */
  async embed(req: EmbedNameRequest): Promise<void> {
    const entity = this.catalog.getCatalogEntityByLabel(req.entityType);
    if (!entity?.textSearchFields?.length) return;

    const companyId = this.cls.get<string>("companyId");
    if (!companyId) return;

    const readResult = await this.neo4j.read(
      `
      MATCH (n:${this.escapeLabel(req.entityType)} { id: $id })-[:BELONGS_TO]->(c:Company { id: $companyId })
      RETURN properties(n) AS props
      `,
      { id: req.entityId, companyId },
    );

    const records = (readResult as any)?.records ?? [];
    if (!records.length) return;
    const props = records[0].get("props") as Record<string, unknown> | undefined;
    if (!props) return;

    const source = entity.textSearchFields
      .map((f) => props[f])
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .join(" ")
      .trim();
    if (!source) return;

    if (props.name_embedding_source === source) return;

    const embedding = await this.embedder.vectoriseText({ text: source });

    await this.neo4j.writeOne({
      query: `
        MATCH (n:${this.escapeLabel(req.entityType)} { id: $id })-[:BELONGS_TO]->(c:Company { id: $companyId })
        SET n.name_embedding = $embedding,
            n.name_embedding_source = $source
      `,
      queryParams: {
        id: req.entityId,
        companyId,
        embedding,
        source,
      },
    });

    this.logger.debug(`Embedded name for ${req.entityType} ${req.entityId} (source length=${source.length})`);
  }

  /**
   * Labels are validated against the catalog (a closed allowlist), so this is
   * a defensive escape only. Reject any label that isn't a plain identifier.
   */
  private escapeLabel(label: string): string {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(label)) {
      throw new Error(`Refusing unsafe Neo4j label "${label}"`);
    }
    return label;
  }
}
