import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { EmbedderService, ModelService } from "../../../core";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Community } from "../entities/community.entity";
import { CommunityModel } from "../entities/community.model";

@Injectable()
export class CommunityRepository implements OnModuleInit {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly embedderService: EmbedderService,
    private readonly modelService: ModelService,
    private readonly securityService: SecurityService,
  ) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT community_id IF NOT EXISTS FOR (community:Community) REQUIRE community.id IS UNIQUE`,
    });

    const dimensions = this.modelService.getEmbedderDimensions();
    await this.neo4j.writeOne({
      query: `
          CREATE VECTOR INDEX communities IF NOT EXISTS
          FOR (community:Community)
          ON community.embedding
          OPTIONS { indexConfig: {
          \`vector.dimensions\`: ${dimensions},
          \`vector.similarity_function\`: 'cosine'
          }};
          `,
    });
  }

  /**
   * Create a new community node with BELONGS_TO company relationship
   * Uses companyId from CLS (current request context)
   */
  async createCommunity(params: {
    name: string;
    level: number;
    memberCount: number;
    rating?: number;
  }): Promise<Community> {
    const query = this.neo4j.initQuery({ serialiser: CommunityModel });
    const id = randomUUID();

    query.queryParams = {
      ...query.queryParams,
      id,
      name: params.name,
      level: params.level,
      memberCount: params.memberCount,
      rating: params.rating ?? 0,
    };

    query.query += `
      CREATE (community:Community {
        id: $id,
        name: $name,
        level: $level,
        memberCount: $memberCount,
        rating: $rating,
        isStale: true,
        staleSince: datetime(),
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (community)-[:BELONGS_TO]->(company)
      RETURN community
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Update community members (HAS_MEMBER relationships to KeyConcepts)
   */
  async updateCommunityMembers(params: { communityId: string; keyConceptIds: string[] }): Promise<void> {
    // First, remove existing HAS_MEMBER relationships
    const removeQuery = this.neo4j.initQuery();
    removeQuery.queryParams = { ...removeQuery.queryParams, communityId: params.communityId };
    removeQuery.query += `
      MATCH (community:Community {id: $communityId})-[r:HAS_MEMBER]->()
      DELETE r
    `;
    await this.neo4j.writeOne(removeQuery);

    // Then, create new HAS_MEMBER relationships
    if (params.keyConceptIds.length > 0) {
      const addQuery = this.neo4j.initQuery();
      addQuery.queryParams = {
        ...addQuery.queryParams,
        communityId: params.communityId,
        keyConceptIds: params.keyConceptIds,
      };
      addQuery.query += `
        MATCH (community:Community {id: $communityId})
        MATCH (keyconcept:KeyConcept) WHERE keyconcept.id IN $keyConceptIds
        MERGE (community)-[:HAS_MEMBER]->(keyconcept)
      `;
      await this.neo4j.writeOne(addQuery);

      // Update memberCount
      const updateCountQuery = this.neo4j.initQuery();
      updateCountQuery.queryParams = {
        ...updateCountQuery.queryParams,
        communityId: params.communityId,
        memberCount: params.keyConceptIds.length,
      };
      updateCountQuery.query += `
        MATCH (community:Community {id: $communityId})
        SET community.memberCount = $memberCount
      `;
      await this.neo4j.writeOne(updateCountQuery);
    }
  }

  /**
   * Set PARENT_OF relationship between communities (hierarchy)
   */
  async setParentCommunity(params: { childCommunityId: string; parentCommunityId: string }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      childCommunityId: params.childCommunityId,
      parentCommunityId: params.parentCommunityId,
    };
    query.query += `
      MATCH (parent:Community {id: $parentCommunityId})
      MATCH (child:Community {id: $childCommunityId})
      MERGE (parent)-[:PARENT_OF]->(child)
    `;
    await this.neo4j.writeOne(query);
  }

  /**
   * Mark communities as stale (needs reprocessing)
   */
  async markAsStale(communityIds: string[]): Promise<void> {
    if (communityIds.length === 0) return;

    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      communityIds,
    };
    query.query += `
      MATCH (community:Community) WHERE community.id IN $communityIds
      SET community.isStale = true, community.staleSince = datetime(), community.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  /**
   * Find stale communities for cron job processing (oldest first)
   * Filters by company from CLS context
   */
  async findStaleCommunities(limit: number): Promise<Community[]> {
    const query = this.neo4j.initQuery({ serialiser: CommunityModel });
    query.queryParams = { ...query.queryParams, limit: Number(limit) };
    query.query += `
      MATCH (community:Community {isStale: true})-[:BELONGS_TO]->(company)
      RETURN community
      ORDER BY community.staleSince ASC
      LIMIT toInteger($limit)
    `;
    const result = await this.neo4j.readMany(query);
    return result ?? [];
  }

  /**
   * Update community summary, embedding, and mark as not stale
   */
  async updateSummary(params: {
    communityId: string;
    name: string;
    summary: string;
    embedding: number[];
    rating: number;
  }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      communityId: params.communityId,
      name: params.name,
      summary: params.summary,
      embedding: params.embedding,
      rating: params.rating,
    };
    query.query += `
      MATCH (community:Community {id: $communityId})
      SET community.name = $name,
          community.summary = $summary,
          community.embedding = $embedding,
          community.rating = $rating,
          community.isStale = false,
          community.staleSince = null,
          community.lastProcessedAt = datetime(),
          community.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  /**
   * Find communities by vector similarity search
   * Filters by company from CLS context
   */
  async findByVector(params: { embedding: number[]; topK: number; level?: number }): Promise<Community[]> {
    const query = this.neo4j.initQuery({ serialiser: CommunityModel });
    query.queryParams = {
      ...query.queryParams,
      embedding: params.embedding,
      topK: params.topK,
      level: params.level,
    };

    let whereClause = "WHERE community.embedding IS NOT NULL AND community.isStale = false";
    if (params.level !== undefined) {
      whereClause += " AND community.level = $level";
    }

    query.query += `
      CALL db.index.vector.queryNodes('communities', $topK * 2, $embedding)
      YIELD node AS community, score
      MATCH (community)-[:BELONGS_TO]->(company)
      ${whereClause}
      RETURN community, score
      ORDER BY score DESC
      LIMIT toInteger($topK)
    `;
    return this.neo4j.readMany(query);
  }

  /**
   * Find communities by hierarchy level
   * Filters by company from CLS context
   */
  async findByLevel(params: { level: number }): Promise<Community[]> {
    const query = this.neo4j.initQuery({ serialiser: CommunityModel });
    query.queryParams = {
      ...query.queryParams,
      level: params.level,
    };

    query.query += `
      MATCH (community:Community)-[:BELONGS_TO]->(company)
      WHERE community.level = $level
      RETURN community
      ORDER BY community.rating DESC
    `;
    return this.neo4j.readMany(query);
  }

  /**
   * Find member KeyConcepts for a community
   */
  async findMemberKeyConcepts(communityId: string): Promise<{ id: string; value: string; description?: string }[]> {
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, communityId };
    query.query += `
      MATCH (community:Community {id: $communityId})-[:HAS_MEMBER]->(keyconcept:KeyConcept)
      RETURN keyconcept.id AS id, keyconcept.value AS value, keyconcept.description AS description
    `;
    const result = await this.neo4j.readMany(query);
    return result as unknown as { id: string; value: string; description?: string }[];
  }

  /**
   * Get KeyConceptRelationships between community members
   */
  async findMemberRelationships(
    communityId: string,
  ): Promise<{ keyConcept1: string; keyConcept2: string; weight: number }[]> {
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, communityId };
    query.query += `
      MATCH (community:Community {id: $communityId})-[:HAS_MEMBER]->(kc1:KeyConcept)
      MATCH (community)-[:HAS_MEMBER]->(kc2:KeyConcept)
      MATCH (kc1)<-[:RELATES_TO]-(rel:KeyConceptRelationship)-[:RELATES_TO]->(kc2)
      WHERE kc1.value < kc2.value
      RETURN kc1.value AS keyConcept1, kc2.value AS keyConcept2, rel.weight AS weight
    `;
    const result = await this.neo4j.readMany(query);
    return result as unknown as { keyConcept1: string; keyConcept2: string; weight: number }[];
  }

  /**
   * Get parent community chain (hierarchy)
   */
  async getHierarchy(communityId: string): Promise<Community[]> {
    const query = this.neo4j.initQuery({ serialiser: CommunityModel });
    query.queryParams = { ...query.queryParams, communityId };
    query.query += `
      MATCH (child:Community {id: $communityId})
      MATCH path = (parent:Community)-[:PARENT_OF*]->(child)
      UNWIND nodes(path) AS community
      RETURN DISTINCT community
      ORDER BY community.level DESC
    `;
    return this.neo4j.readMany(query);
  }

  /**
   * Get child communities
   */
  async getChildren(communityId: string): Promise<Community[]> {
    const query = this.neo4j.initQuery({ serialiser: CommunityModel });
    query.queryParams = { ...query.queryParams, communityId };
    query.query += `
      MATCH (parent:Community {id: $communityId})-[:PARENT_OF]->(child:Community)
      RETURN child AS community
      ORDER BY child.rating DESC
    `;
    return this.neo4j.readMany(query);
  }

  /**
   * Delete a community and its relationships
   */
  async deleteCommunity(communityId: string): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, communityId };
    query.query += `
      MATCH (community:Community {id: $communityId})
      DETACH DELETE community
    `;
    await this.neo4j.writeOne(query);
  }

  /**
   * Delete all communities for the current company (from CLS)
   */
  async deleteAllCommunities(): Promise<void> {
    const query = this.neo4j.initQuery();
    query.query += `
      MATCH (community:Community)-[:BELONGS_TO]->(company)
      DETACH DELETE community
    `;
    await this.neo4j.writeOne(query);
  }

  /**
   * Find communities that contain a specific KeyConcept
   */
  async findCommunitiesByKeyConcept(keyConceptId: string): Promise<Community[]> {
    const query = this.neo4j.initQuery({ serialiser: CommunityModel });
    query.queryParams = { ...query.queryParams, keyConceptId };
    query.query += `
      MATCH (community:Community)-[:HAS_MEMBER]->(keyconcept:KeyConcept {id: $keyConceptId})
      MATCH (community)-[:BELONGS_TO]->(company)
      RETURN community
      ORDER BY community.level ASC
    `;
    return this.neo4j.readMany(query);
  }

  /**
   * Count communities by level for the current company (from CLS)
   */
  async countByLevel(): Promise<{ level: number; count: number }[]> {
    const query = this.neo4j.initQuery();
    query.query += `
      MATCH (community:Community)-[:BELONGS_TO]->(company)
      RETURN community.level AS level, COUNT(community) AS count
      ORDER BY level ASC
    `;
    // Use raw read() to avoid entity serialization - we just need counts
    const result = await this.neo4j.read(query.query, query.queryParams);
    return result.records.map((record) => {
      const level = record.get("level");
      const count = record.get("count");
      return {
        level: level?.toNumber?.() ?? level ?? 0,
        count: count?.toNumber?.() ?? count ?? 0,
      };
    });
  }

  /**
   * Find community by ID with company scope from CLS
   */
  async findById(communityId: string): Promise<Community | null> {
    const query = this.neo4j.initQuery({ serialiser: CommunityModel });
    query.queryParams = { ...query.queryParams, communityId };
    query.query += `
      MATCH (community:Community {id: $communityId})-[:BELONGS_TO]->(company)
      RETURN community
    `;
    return this.neo4j.readOne(query);
  }
}
