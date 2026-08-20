import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { AgentScopeFilterService } from "../../../common/repositories/agent-scope.filter";
import { AI_SOURCE_QUERY, AiSourceQueryProvider } from "../../../common/repositories/ai-source-query.provider";
import { DataLimits } from "../../../common/types/data.limits";
import { EmbedderAttribution, EmbedderService, ModelService } from "../../../core";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { KeyConcept } from "../../keyconcept/entities/key.concept.entity";
import { keyConceptMeta } from "../../keyconcept/entities/key.concept.meta";
import { KeyConceptModel } from "../../keyconcept/entities/key.concept.model";

@Injectable()
export class KeyConceptRepository implements OnModuleInit {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly embedderService: EmbedderService,
    private readonly modelService: ModelService,
    private readonly securityService: SecurityService,
    private readonly clsService: ClsService,
    @Inject(AI_SOURCE_QUERY) private readonly aiSourceQuery: AiSourceQueryProvider,
    private readonly agentScope: AgentScopeFilterService,
  ) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT keyconcept_id IF NOT EXISTS FOR (keyconcept:KeyConcept) REQUIRE keyconcept.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT keyconcept_value IF NOT EXISTS FOR (keyconcept:KeyConcept) REQUIRE keyconcept.value IS UNIQUE`,
    });

    const dimensions = this.modelService.getEmbedderDimensions();
    await this.neo4j.writeOne({
      query: `
        CREATE VECTOR INDEX keyconcepts IF NOT EXISTS
        FOR (keyconcept:KeyConcept)
        ON keyconcept.embedding
        OPTIONS { indexConfig: {
        \`vector.dimensions\`: ${dimensions},
        \`vector.similarity_function\`: 'cosine'
        }};
        `,
    });
  }

  async recreateVectorIndex(): Promise<void> {
    await this.neo4j.writeOne({
      query: `DROP INDEX keyconcepts IF EXISTS`,
    });

    const dimensions = this.modelService.getEmbedderDimensions();
    await this.neo4j.writeOne({
      query: `
        CREATE VECTOR INDEX keyconcepts IF NOT EXISTS
        FOR (keyconcept:KeyConcept)
        ON keyconcept.embedding
        OPTIONS { indexConfig: {
        \`vector.dimensions\`: ${dimensions},
        \`vector.similarity_function\`: 'cosine'
        }};
        `,
    });
  }

  async findAllKeyConcepts(): Promise<KeyConcept[]> {
    const query = this.neo4j.initQuery({ serialiser: KeyConceptModel, fetchAll: true });
    query.query = `
      MATCH (${keyConceptMeta.nodeName}:${keyConceptMeta.labelName})
      RETURN ${keyConceptMeta.nodeName}
    `;
    return this.neo4j.readMany(query);
  }

  async updateEmbedding(params: { keyConceptId: string; embedding: number[] }): Promise<void> {
    await this.neo4j.writeOne({
      query: `
        MATCH (keyconcept:KeyConcept {id: $keyConceptId})
        SET keyconcept.embedding = $embedding
      `,
      queryParams: {
        keyConceptId: params.keyConceptId,
        embedding: params.embedding,
      },
    });
  }

  async findNeighboursByKeyConcepts(params: { keyConcepts: string[]; dataLimits: DataLimits }): Promise<KeyConcept[]> {
    const query = this.neo4j.initQuery({ serialiser: KeyConceptModel });

    // SECURITY: HowTo retrieval (global content) intentionally bypasses company
    // filtering. The package surfaces that bypass through `howToMode`/`limitToHowToId`
    // (the app's `howToId` maps to these via declaration-merge semantics).
    const isCompanyIndependent = !!params.dataLimits.howToMode || !!params.dataLimits.limitToHowToId;

    // Scope gate. This query never touches `aiSourceQuery`, so it needs its own:
    // a KeyConcept node is GLOBALLY de-duplicated by value, which means the
    // bridging relationship is the only thing that says which content the
    // neighbour actually came from. Anchored through `OCCURS_IN` to a chunk
    // owned by in-scope content.
    const scopePredicate = this.agentScope.predicate({ alias: "scopedData", dataLimits: params.dataLimits });
    const scopeGate = scopePredicate
      ? `AND EXISTS {
        MATCH (keyConceptRelationship)-[:OCCURS_IN]->(:Chunk)<-[:HAS_CHUNK]-(scopedData)
        WHERE ${scopePredicate.cypher}
      }`
      : "";

    query.queryParams = {
      ...query.queryParams,
      keyConcepts: params.keyConcepts,
      isCompanyIndependent,
      ...(scopePredicate?.params ?? {}),
    };

    query.query += `
      MATCH (startingKeyConcept:KeyConcept)<-[:RELATES_TO]-(keyConceptRelationship:KeyConceptRelationship)-[:RELATES_TO]->(keyconcept:KeyConcept)
      WHERE startingKeyConcept.value IN $keyConcepts
      AND NOT keyconcept.value IN $keyConcepts
      AND NOT EXISTS {
        MATCH (startingKeyConcept)<-[:HAS_KEY_CONCEPT]-()<-[:HAS_ATOMIC_FACT]-()-[:HAS_ATOMIC_FACT]->()-[:HAS_KEY_CONCEPT]->(keyconcept)
      }
      ${scopeGate}
      // Company scoping: the neighbour is reachable only if the relationship that
      // bridges to it belongs to the caller's company or is global (no company).
      // The previous gate accepted a relationship owned by ANY company and relied on
      // an unlinked aiSourceQuery data match, which leaked cross-company concepts.
      AND (
        $isCompanyIndependent = true
        OR (keyConceptRelationship)-[:BELONGS_TO]->(:Company {id: $companyId})
        OR NOT EXISTS { (keyConceptRelationship)-[:BELONGS_TO]->(:Company) }
      )
      WITH COLLECT(DISTINCT keyconcept) AS neighbors
      UNWIND neighbors AS candidateKeyConcept
      RETURN candidateKeyConcept
      LIMIT 100
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * `attribution` is OPTIONAL and opt-in: this is a QUERY-time embedding, so
   * the repository has no entity of its own to bill it to — the retrieval scope
   * lives with the caller (see `findPotentialChunks` for the same rationale).
   */
  async findPotentialKeyConcepts(params: {
    question: string;
    dataLimits: DataLimits;
    attribution?: EmbedderAttribution;
  }): Promise<KeyConcept[]> {
    const query = this.neo4j.initQuery({ serialiser: KeyConceptModel });

    const queryEmbedding = await this.embedderService.vectoriseText({
      text: params.question,
      attribution: params.attribution,
    });

    const scope = this.aiSourceQuery.build({
      dataLimits: params.dataLimits,
      currentUserId: this.clsService.get("userId"),
      securityService: this.securityService,
      returnsData: true,
    });

    // Confines `data` to the run's scope root before a single concept is
    // gathered. Without it the topic set below spans the whole COMPANY, so
    // every scope root seeds retrieval for every other one.
    const scopeFilter = this.agentScope.build({ alias: "data", dataLimits: params.dataLimits });

    query.queryParams = {
      ...query.queryParams,
      queryEmbedding,
      ...scope.params,
      ...scopeFilter.params,
    };

    query.query += `
      ${scope.cypher}
      ${scopeFilter.cypher}
      MATCH (data)-[:HAS_CHUNK]->()-[:HAS_ATOMIC_FACT]->()-[:HAS_KEY_CONCEPT]->(keyconcept:KeyConcept)
      WITH COLLECT(DISTINCT keyconcept.id) AS topicKeyConceptIds

      CALL db.index.vector.queryNodes('keyconcepts', 1000, $queryEmbedding)
      YIELD node AS candidateKeyConcept, score
      WHERE candidateKeyConcept.id IN topicKeyConceptIds

      RETURN candidateKeyConcept as ${keyConceptMeta.nodeName}, score
      ORDER BY score DESC
      LIMIT 100
    `;

    return this.neo4j.readMany(query);
  }

  //TODO: Change the implementation to remove key Concepts that are not connected to any atomic fact (but they can be connected to KeyConceptRelationships)
  async deleteDisconnectedKeyConcepts(): Promise<void> {
    const query = this.neo4j.initQuery();

    query.query += `
      MATCH (keyconcept:KeyConcept)
      WHERE NOT (keyconcept)<-[:HAS_KEY_CONCEPT]-()

      WITH keyconcept
      DETACH DELETE keyconcept
    `;

    await this.neo4j.writeOne(query);

    const queryRelationships = `
      MATCH (keyConceptRelationship:KeyConceptRelationship)
      OPTIONAL MATCH (keyConceptRelationship)-[r:RELATES_TO]->()
      WITH keyConceptRelationship, COUNT(r) AS relationshipCount
      WHERE relationshipCount <= 1
      DETACH DELETE keyConceptRelationship
    `;
    await this.neo4j.writeOne({ query: queryRelationships });
  }

  async findKeyConceptByValue(params: { keyConceptValue: string }): Promise<KeyConcept> {
    const query = this.neo4j.initQuery({ serialiser: KeyConceptModel });

    query.queryParams = {
      ...query.queryParams,
      keyConceptValue: params.keyConceptValue,
    };

    query.query = `
      MATCH (keyconcept:KeyConcept {value: $keyConceptValue})
      RETURN keyconcept
  `;

    return this.neo4j.readOne(query);
  }

  async findKeyConceptsByValues(params: { keyConceptValues: string[] }): Promise<KeyConcept[]> {
    const query = this.neo4j.initQuery({ serialiser: KeyConceptModel });

    query.queryParams = {
      keyConceptValues: params.keyConceptValues,
    };

    query.query = `
      MATCH (keyconcept:KeyConcept)
      WHERE keyconcept.value IN $keyConceptValues AND keyconcept.embedding IS NOT NULL
      RETURN keyconcept
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * `attribution` is OPTIONAL. ONE usage record covers the whole batch, and
   * that is honest here: every value in it was extracted from a SINGLE chunk of
   * a SINGLE entity during that entity's ingestion (`ChunkService.generateGraph`),
   * so one entity caused the whole cost. KeyConcept nodes are globally
   * de-duplicated by `MERGE (keyconcept:KeyConcept {value})` and are therefore
   * not owned by that entity — billing follows who INCURRED the spend, not who
   * ends up sharing the node.
   */
  async createOrphanKeyConcepts(params: {
    keyConceptValues: string[];
    attribution?: EmbedderAttribution;
  }): Promise<void> {
    // `attribution` is optional: without it the embedder records no usage (opt-in by design).
    // Zero-token guard, mirroring `ChunkRepository.enrichContentAndEmbedBatch`.
    // An empty batch is routine — `ChunkService.generateGraph` calls this
    // unconditionally, and a chunk that yields no key concepts (or the empty
    // fallback analysis returned when graph generation fails) produces an empty
    // array. Embedding nothing costs nothing, and an operation that records ZERO
    // tokens must record NOTHING; `EmbedderService.persistUsage` has no
    // zero-token guard of its own, so without this an attributed empty batch
    // would write a 0-token/0-cost TokenUsage row.
    if (params.keyConceptValues.length === 0) return;

    const vectors = await this.embedderService.vectoriseTextBatch(params.keyConceptValues, params.attribution);

    const data = params.keyConceptValues.map((keyConceptId: string, index: number) => ({
      query: `MERGE (keyconcept: KeyConcept {value: $keyConceptId}) ON CREATE SET keyconcept.id="${randomUUID()}", keyconcept.embedding = $vector`,
      params: { keyConceptId: keyConceptId, vector: vectors[index] },
    }));

    await this.neo4j.executeInTransaction(data);
  }

  /**
   * Update descriptions for existing KeyConcepts (only if they don't have a description yet)
   * This preserves existing descriptions and only adds new ones
   */
  async updateKeyConceptDescriptions(params: {
    descriptions: { keyConcept: string; description: string }[];
  }): Promise<void> {
    if (params.descriptions.length === 0) return;

    const data = params.descriptions.map((item) => ({
      query: `
        MATCH (keyconcept:KeyConcept {value: $keyConceptValue})
        WHERE keyconcept.description IS NULL OR keyconcept.description = ""
        SET keyconcept.description = $description
      `,
      params: { keyConceptValue: item.keyConcept, description: item.description },
    }));

    await this.neo4j.executeInTransaction(data);
  }

  /**
   * `attribution` is OPTIONAL and threaded down from `ChunkService.generateGraph`
   * — the entity whose ingestion produced this atomic fact. Deriving it locally
   * from `atomicFactId` was rejected: an `AtomicFact` is an internal graph node
   * with no owner, so a `USED_FOR` edge to it tells a cost report nothing about
   * which entity the spend belongs to.
   */
  async createKeyConcept(params: {
    keyConceptValue: string;
    atomicFactId: string;
    attribution?: EmbedderAttribution;
  }): Promise<void> {
    const queryCheck = this.neo4j.initQuery({ serialiser: KeyConceptModel, fetchAll: true });

    queryCheck.queryParams = {
      keyConceptValue: params.keyConceptValue,
    };

    queryCheck.query = `
      MATCH (keyconcept: KeyConcept {value: $keyConceptValue})
      RETURN keyconcept
    `;

    const existingNode = await this.neo4j.readMany(queryCheck);

    let vector = null;
    if (!existingNode.length) {
      vector = await this.embedderService.vectoriseText({
        text: params.keyConceptValue,
        attribution: params.attribution,
      });
    }

    const query = this.neo4j.initQuery({ serialiser: KeyConceptModel });

    query.queryParams = {
      keyConceptValue: params.keyConceptValue,
      atomicFactId: params.atomicFactId,
      id: randomUUID(),
      vector: vector,
    };

    query.query = `
      MATCH (atomicfact: AtomicFact {id: $atomicFactId})
      MERGE (keyconcept: KeyConcept {value: $keyConceptValue}) 
      ON CREATE SET keyconcept.id=$id, keyconcept.embedding = $vector
      MERGE (atomicfact)-[:HAS_KEY_CONCEPT]->(keyconcept)
    `;

    await this.neo4j.writeOne(query);
  }

  async createKeyConceptRelation(params: { keyConceptValue: string; atomicFactId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      keyConceptValue: params.keyConceptValue,
      atomicFactId: params.atomicFactId,
    };

    query.query = `
      MATCH (atomicfact: AtomicFact {id: $atomicFactId}), (keyconcept:KeyConcept {value: $keyConceptValue})
      MERGE (atomicfact)-[:HAS_KEY_CONCEPT]->(keyconcept)
    `;

    await this.neo4j.writeOne(query);
  }

  async createOrUpdateKeyConceptRelationships(params: {
    companyId?: string;
    chunkId: string;
    relationships: {
      keyConcept1: string;
      keyConcept2: string;
      relationship: string;
    }[];
  }): Promise<void> {
    const targetBatchSize = 1000;
    const concurrencyLimit = 40;

    const sortedRelationships = params.relationships.sort((a, b) => a.keyConcept1.localeCompare(b.keyConcept1));

    const batches: { keyConcept1: string; keyConcept2: string; relationship: string }[][] = [];
    let currentBatch: { keyConcept1: string; keyConcept2: string; relationship: string }[] = [];

    for (let i = 0; i < sortedRelationships.length; i++) {
      currentBatch.push(sortedRelationships[i]);

      if (
        currentBatch.length >= targetBatchSize &&
        (i === sortedRelationships.length - 1 ||
          sortedRelationships[i + 1].keyConcept1 !== sortedRelationships[i].keyConcept1)
      ) {
        batches.push(currentBatch);
        currentBatch = [];
      }
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    const executeBatch = async (batch: { keyConcept1: string; keyConcept2: string; relationship: string }[]) => {
      for (const relationship of batch) {
        try {
          const sortedKeys = [relationship.keyConcept1, relationship.keyConcept2].sort();

          const query = this.neo4j.initQuery();

          if (params.companyId) {
            query.queryParams = {
              companyId: params.companyId,
              chunkId: params.chunkId,
              sortedKey1: sortedKeys[0],
              sortedKey2: sortedKeys[1],
            };

            query.query = `
              MATCH (company:Company {id: $companyId})
              MATCH (keyConcept1:KeyConcept {value: $sortedKey1})
              MATCH (keyConcept2:KeyConcept {value: $sortedKey2})
              MATCH (chunk:Chunk {id: $chunkId})
              MERGE (rel:KeyConceptRelationship {key1: $sortedKey1, key2: $sortedKey2})
              ON CREATE SET rel.weight = 1
              ON MATCH SET rel.weight = rel.weight + 1
              MERGE (rel)-[:BELONGS_TO]->(company)
              MERGE (rel)-[:RELATES_TO]->(keyConcept1)
              MERGE (rel)-[:RELATES_TO]->(keyConcept2)
              MERGE (rel)-[:OCCURS_IN]->(chunk)
            `;
          } else {
            query.queryParams = {
              chunkId: params.chunkId,
              sortedKey1: sortedKeys[0],
              sortedKey2: sortedKeys[1],
            };

            query.query = `
              MATCH (keyConcept1:KeyConcept {value: $sortedKey1})
              MATCH (keyConcept2:KeyConcept {value: $sortedKey2})
              MATCH (chunk:Chunk {id: $chunkId})
              MERGE (rel:KeyConceptRelationship {key1: $sortedKey1, key2: $sortedKey2})
              ON CREATE SET rel.weight = 1
              ON MATCH SET rel.weight = rel.weight + 1
              MERGE (rel)-[:RELATES_TO]->(keyConcept1)
              MERGE (rel)-[:RELATES_TO]->(keyConcept2)
              MERGE (rel)-[:OCCURS_IN]->(chunk)
            `;
          }

          await this.neo4j.writeOne(query);
        } catch (error) {
          console.error(`Failed to process relationship for chunk ${params.chunkId}: ${error.message}`);
        }
      }
    };

    const runningBatches: Promise<void>[] = [];
    for (let i = 0; i < batches.length; i++) {
      if (runningBatches.length >= concurrencyLimit) {
        await Promise.race(runningBatches);
        runningBatches.splice(
          runningBatches.findIndex((batch) => batch === Promise.race(runningBatches)),
          1,
        );
      }

      runningBatches.push(executeBatch(batches[i]));
    }

    await Promise.all(runningBatches);
  }

  async resizeKeyConceptRelationshipsWeightOnChunkDeletion(params: { chunkId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      chunkId: params.chunkId,
    };

    query.query += `
      MATCH (rel:KeyConceptRelationship)-[occursIn:OCCURS_IN]->(chunk:Chunk {id: $chunkId})
      SET rel.weight = rel.weight - 1
      DELETE occursIn
      WITH rel
      OPTIONAL MATCH (rel)-[:OCCURS_IN]->(remainingChunk:Chunk)
      WITH rel, COUNT(remainingChunk) AS remainingOccurrences
      WHERE remainingOccurrences = 0
      DETACH DELETE rel
    `;

    await this.neo4j.writeOne(query);
  }
}
