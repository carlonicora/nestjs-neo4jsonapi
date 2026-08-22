import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AgentScopeFilterService } from "../../../common/repositories/agent-scope.filter";
import { AI_SOURCE_QUERY, AiSourceQueryProvider } from "../../../common/repositories/ai-source-query.provider";
import { DataLimits } from "../../../common/types/data.limits";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { AtomicFact } from "../../atomicfact/entities/atomic.fact.entity";
import { AtomicFactModel } from "../../atomicfact/entities/atomic.fact.model";
import { MAX_ATOMIC_FACTS } from "../../chunk/repositories/retrieval.constants";

@Injectable()
export class AtomicFactRepository implements OnModuleInit {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly securityService: SecurityService,
    private readonly clsService: ClsService,
    @Inject(AI_SOURCE_QUERY) private readonly aiSourceQuery: AiSourceQueryProvider,
    private readonly agentScope: AgentScopeFilterService,
  ) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT atomicfact_id IF NOT EXISTS FOR (atomicfact:AtomicFact) REQUIRE atomicfact.id IS UNIQUE`,
    });
  }

  async findAtomicFactsByKeyConcepts(params: {
    keyConcepts: string[];
    skipChunkIds: string[];
    skipAtomicFactIds: string[];
    dataLimits: DataLimits;
  }): Promise<AtomicFact[]> {
    const query = this.neo4j.initQuery({ serialiser: AtomicFactModel });
    const scope = this.aiSourceQuery.build({
      dataLimits: params.dataLimits,
      currentUserId: this.clsService.get("userId"),
      securityService: this.securityService,
      returnsData: true,
    });
    // The gate that matters most on this query: KeyConcept nodes are globally
    // de-duplicated by value, so a concept that two scope roots happen to share
    // fans out to the atomic facts of BOTH unless `data` is confined to the
    // run's scope root first.
    const scopeFilter = this.agentScope.build({ alias: "data", dataLimits: params.dataLimits });

    query.queryParams = {
      ...query.queryParams,
      keyConcepts: params.keyConcepts,
      skipChunkIds: params.skipChunkIds,
      skipAtomicFactIds: params.skipAtomicFactIds,
      maxAtomicFacts: MAX_ATOMIC_FACTS,
      ...scope.params,
      ...scopeFilter.params,
    };
    // Deliberate: the facts are NOT ordered before the cut. Atomic facts carry no
    // embedding (spec §2.4), so there is no relevance signal to order by — this is
    // a spend bound, not a ranking. Giving facts embeddings is out of scope and has
    // its own spec.
    query.query += `
      ${scope.cypher}
      ${scopeFilter.cypher}
      MATCH (keyconcept:KeyConcept)<-[:HAS_KEY_CONCEPT]-(atomicfact:AtomicFact)<-[:HAS_ATOMIC_FACT]-(atomicfact_chunk:Chunk)<-[:HAS_CHUNK]-(data)
      WHERE keyconcept.value IN $keyConcepts
      ${params.skipChunkIds.length > 0 ? `AND NOT atomicfact_chunk.id IN $skipChunkIds` : ""}
      ${params.skipAtomicFactIds.length > 0 ? `AND NOT atomicfact.id IN $skipAtomicFactIds` : ""}
      RETURN atomicfact, atomicfact_chunk
      LIMIT toInteger($maxAtomicFacts)
  `;
    return this.neo4j.readMany(query);
  }

  async findAtomicFactsByChunkId(params: { chunkId: string }): Promise<AtomicFact[]> {
    const query = this.neo4j.initQuery({ serialiser: AtomicFactModel });

    query.queryParams = {
      ...query.queryParams,
      chunkId: params.chunkId,
    };

    query.query += `
      MATCH (chunk:Chunk {id: $chunkId})-[:HAS_ATOMIC_FACT]->(atomicfact: AtomicFact)
      RETURN atomicfact
    `;

    return this.neo4j.readMany(query);
  }

  async findAtomicFactById(params: { atomicFactId: string }): Promise<AtomicFact> {
    const query = this.neo4j.initQuery({ serialiser: AtomicFactModel });

    query.queryParams = {
      ...query.queryParams,
      atomicFactId: params.atomicFactId,
    };

    query.query += `
      MATCH (atomicfact: AtomicFact {id: $atomicFactId})
      RETURN atomicfact
    `;
    return this.neo4j.readOne(query);
  }

  async deleteDisconnectedAtomicFacts(): Promise<void> {
    const query = this.neo4j.initQuery();

    query.query = `
      MATCH (fact:AtomicFact)
      WHERE NOT (fact)<-[:HAS_ATOMIC_FACT]-()
      DETACH DELETE fact
    `;

    await this.neo4j.writeOne(query);
  }

  async createAtomicFact(params: { atomicFactId: string; chunkId: string; content: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      chunkId: params.chunkId,
      atomicFactId: params.atomicFactId,
      atomicFactContent: params.content,
    };

    query.query += `
      MATCH (chunk:Chunk {id: $chunkId})
      MERGE (atomicfact:AtomicFact {id: $atomicFactId})
      ON CREATE SET atomicfact.content = $atomicFactContent
      MERGE (chunk)-[:HAS_ATOMIC_FACT]->(atomicfact)
    `;

    await this.neo4j.writeOne(query);
  }
}
