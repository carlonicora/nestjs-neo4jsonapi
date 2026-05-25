import { Injectable, OnModuleInit } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { aiSourceQuery } from "../../../common/repositories/ai.source.query";
import { DataLimits } from "../../../common/types/data.limits";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { AtomicFact } from "../../atomicfact/entities/atomic.fact.entity";
import { AtomicFactModel } from "../../atomicfact/entities/atomic.fact.model";

@Injectable()
export class AtomicFactRepository implements OnModuleInit {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly securityService: SecurityService,
    private readonly clsService: ClsService,
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
    // SECURITY: HowTo retrieval intentionally bypasses company filtering.
    // Dispatch to the private method so the bypass is visible and quarantined here.
    if (params.dataLimits.howToMode || params.dataLimits.limitToHowToId) {
      return this.findAtomicFactsByKeyConceptsFromHowTos(params);
    }

    const query = this.neo4j.initQuery({ serialiser: AtomicFactModel });

    query.queryParams = {
      ...query.queryParams,
      keyConcepts: params.keyConcepts,
      skipChunkIds: params.skipChunkIds,
      skipAtomicFactIds: params.skipAtomicFactIds,
    };

    query.query += `
        MATCH (data)-[:BELONGS_TO]->(company)
        ${aiSourceQuery({
          currentUserId: this.clsService.get("userId"),
          securityService: this.securityService,
          dataLimits: params.dataLimits,
          returnsData: true,
        })}
        MATCH (keyconcept:KeyConcept)<-[:HAS_KEY_CONCEPT]-(atomicfact:AtomicFact)<-[:HAS_ATOMIC_FACT]-(atomicfact_chunk:Chunk)<-[:HAS_CHUNK]-(data)
        WHERE keyconcept.value IN $keyConcepts
        ${params.skipChunkIds.length > 0 ? `AND NOT atomicfact_chunk.id IN $skipChunkIds` : ""}
        ${params.skipAtomicFactIds.length > 0 ? `AND NOT atomicfact.id IN $skipAtomicFactIds` : ""}
        RETURN atomicfact, atomicfact_chunk
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Help-content retrieval. Intentionally bypasses company filtering — `(data:HowTo)`
   * nodes are global and have no `BELONGS_TO Company` edge. Only callable from inside
   * this repository; `findAtomicFactsByKeyConcepts` dispatches here based on
   * `dataLimits.howToMode` / `dataLimits.limitToHowToId`.
   */
  private async findAtomicFactsByKeyConceptsFromHowTos(params: {
    keyConcepts: string[];
    skipChunkIds: string[];
    skipAtomicFactIds: string[];
    dataLimits: DataLimits;
  }): Promise<AtomicFact[]> {
    const query = this.neo4j.initQuery({ serialiser: AtomicFactModel });

    query.queryParams = {
      ...query.queryParams,
      keyConcepts: params.keyConcepts,
      skipChunkIds: params.skipChunkIds,
      skipAtomicFactIds: params.skipAtomicFactIds,
      ...(params.dataLimits.limitToHowToId ? { limitToHowToId: params.dataLimits.limitToHowToId } : {}),
    };

    const limitClause = params.dataLimits.limitToHowToId ? `WHERE data.id = $limitToHowToId` : "";

    query.query += `
        MATCH (data:HowTo)
        ${limitClause}
        WITH data
        MATCH (keyconcept:KeyConcept)<-[:HAS_KEY_CONCEPT]-(atomicfact:AtomicFact)<-[:HAS_ATOMIC_FACT]-(atomicfact_chunk:Chunk)<-[:HAS_CHUNK]-(data)
        WHERE keyconcept.value IN $keyConcepts
        ${params.skipChunkIds.length > 0 ? `AND NOT atomicfact_chunk.id IN $skipChunkIds` : ""}
        ${params.skipAtomicFactIds.length > 0 ? `AND NOT atomicfact.id IN $skipAtomicFactIds` : ""}
        RETURN atomicfact, atomicfact_chunk
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
