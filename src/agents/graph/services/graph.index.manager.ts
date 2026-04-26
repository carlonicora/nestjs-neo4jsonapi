import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ModelService } from "../../../core/llm/services/model.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { CatalogEntity } from "../interfaces/graph.catalog.interface";
import { GraphCatalogService } from "./graph.catalog.service";

@Injectable()
export class GraphIndexManager implements OnApplicationBootstrap {
  private readonly logger = new Logger(GraphIndexManager.name);

  constructor(
    private readonly neo4j: Neo4jService,
    private readonly catalog: GraphCatalogService,
    private readonly models: ModelService,
  ) {}

  // Fires in onApplicationBootstrap (after all onModuleInit). GraphCatalogService
  // builds its catalog in its own onApplicationBootstrap; because it's declared
  // before this manager in graph.module.ts, its bootstrap runs first and the
  // catalog is populated by the time we read it here.
  async onApplicationBootstrap(): Promise<void> {
    const entities = this.catalog.getAllChatEnabledEntities();
    if (!entities.length) return;

    const dims = this.models.getEmbedderDimensions();

    for (const e of entities) {
      await this.ensureFulltext(e);
      await this.ensureVector(e, dims);
    }
  }

  private async ensureFulltext(e: CatalogEntity): Promise<void> {
    const fields = (e.textSearchFields ?? []).map((f) => `n.\`${f}\``).join(", ");
    if (!fields) return;

    const indexName = this.fulltextIndexName(e.labelName);
    await this.neo4j.writeOne({
      query: `
        CREATE FULLTEXT INDEX \`${indexName}\` IF NOT EXISTS
        FOR (n:\`${e.labelName}\`)
        ON EACH [${fields}]
      `,
    });
    this.logger.debug(`Ensured fulltext index ${indexName} for ${e.labelName}`);
  }

  private async ensureVector(e: CatalogEntity, dims: number): Promise<void> {
    if (!e.textSearchFields?.length) return;

    const indexName = this.vectorIndexName(e.labelName);
    await this.neo4j.writeOne({
      query: `
        CREATE VECTOR INDEX \`${indexName}\` IF NOT EXISTS
        FOR (n:\`${e.labelName}\`)
        ON n.name_embedding
        OPTIONS { indexConfig: {
          \`vector.dimensions\`: ${dims},
          \`vector.similarity_function\`: 'cosine'
        }}
      `,
    });
    this.logger.debug(`Ensured vector index ${indexName} for ${e.labelName}`);
  }

  fulltextIndexName(label: string): string {
    return `${label.toLowerCase()}_chat_fulltext`;
  }

  vectorIndexName(label: string): string {
    return `${label.toLowerCase()}_chat_embedding`;
  }
}
