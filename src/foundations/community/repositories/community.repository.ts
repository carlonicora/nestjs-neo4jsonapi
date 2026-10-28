import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { modelRegistry } from "../../../common/registries/registry";
import { AgentScopeFilterService } from "../../../common/repositories/agent-scope.filter";
import { AgentScope } from "../../../common/types/agent.scope";
import { EmbedderService } from "../../../core/llm/services/embedder.service";
import { ModelService } from "../../../core/llm/services/model.service";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { companyMeta } from "../../company/entities/company.meta";
import { KeyConcept } from "../../keyconcept/entities/key.concept.entity";
import { keyConceptMeta } from "../../keyconcept/entities/key.concept.meta";
import { KeyConceptModel } from "../../keyconcept/entities/key.concept.model";
import { Community, CommunityDescriptor } from "../entities/community.entity";
import { communityMeta } from "../entities/community.meta";
import { CommunityLayerService } from "../services/community-layer.service";

/**
 * Up to this many company/scope communities, `findByVector` ranks them by
 * exact cosine (no recall cliff). Above it, it falls back to the vector-index
 * over-fetch, which ranks globally and filters afterwards.
 */
export const COMMUNITY_EXACT_SCAN_MAX_SCOPED_NODES = 5000;

const toNumber = (value: any): number =>
  value?.toNumber?.() ?? (value === null || value === undefined ? 0 : Number(value));

/**
 * Topic groups of key concepts, one set per company or per layer root (`CommunityLayerService`).
 *
 * Every match on a Community starts from `buildDefaultMatch()`, so the company predicate is the
 * framework's. With no company in CLS that predicate matches every company: only
 * `findAllStaleCommunities` (the cron) relies on it; every write throws instead.
 */
@Injectable()
export class CommunityRepository extends AbstractRepository<Community, typeof CommunityDescriptor.relationships> {
  protected readonly descriptor = CommunityDescriptor;

  constructor(
    neo4j: Neo4jService,
    securityService: SecurityService,
    clsService: ClsService,
    private readonly embedderService: EmbedderService,
    private readonly modelService: ModelService,
    private readonly agentScope: AgentScopeFilterService,
    private readonly layer: CommunityLayerService,
  ) {
    super(neo4j, securityService, clsService);
  }

  async onModuleInit() {
    await super.onModuleInit();

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

  /** A query on the Community serialiser, refused when no company is in context (writes). */
  private writeQuery(method: string) {
    const query = this.neo4j.initQuery({ serialiser: CommunityDescriptor.model });
    if (!query.queryParams.companyId) throw new Error(`CommunityRepository.${method}: no company in context`);
    return query;
  }

  private readQuery() {
    return this.neo4j.initQuery({ serialiser: CommunityDescriptor.model });
  }

  /**
   * `scopeRoot` ties the group to the layer root its members were detected within. Its `label`
   * is ignored: the label comes from the layer. A `scopeRoot` with no layer configured throws.
   */
  async createCommunity(params: {
    name: string;
    level: number;
    memberCount: number;
    rating?: number;
    scopeRoot?: { id: string; label: string };
  }): Promise<Community> {
    const query = this.writeQuery("createCommunity");
    const layer = await this.layer.ready();
    if (params.scopeRoot && !layer)
      throw new Error("CommunityRepository.createCommunity: scopeRoot passed but no community layer is configured");

    if (params.scopeRoot && layer)
      await this.neo4j.validateRelatedNodes({ nodes: [{ id: params.scopeRoot.id, label: layer.labelName }] });

    query.queryParams = {
      ...query.queryParams,
      id: randomUUID(),
      name: params.name,
      level: params.level,
      memberCount: params.memberCount,
      rating: params.rating ?? 0,
      scopeRootId: params.scopeRoot?.id ?? null,
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
      ${
        params.scopeRoot && layer
          ? `WITH community
      MATCH (scopeRoot:${layer.labelName} { id: $scopeRootId })
      CREATE (community)-[:SCOPED_TO]->(scopeRoot)`
          : ``
      }
      RETURN community
    `;

    return this.neo4j.writeOne(query);
  }

  /** Replaces the group's HAS_MEMBER edges. */
  async updateCommunityMembers(params: { communityId: string; keyConceptIds: string[] }): Promise<void> {
    const removeQuery = this.writeQuery("updateCommunityMembers");
    removeQuery.queryParams = { ...removeQuery.queryParams, searchValue: params.communityId };
    removeQuery.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      MATCH (community)-[r:HAS_MEMBER]->()
      DELETE r
    `;

    if (params.keyConceptIds.length > 0)
      await this.neo4j.validateRelatedNodes({
        nodes: params.keyConceptIds.map((id) => ({ id, label: keyConceptMeta.labelName })),
      });

    await this.neo4j.writeOne(removeQuery);

    if (params.keyConceptIds.length === 0) return;

    const addQuery = this.writeQuery("updateCommunityMembers");
    addQuery.queryParams = {
      ...addQuery.queryParams,
      searchValue: params.communityId,
      keyConceptIds: params.keyConceptIds,
      memberCount: params.keyConceptIds.length,
    };
    addQuery.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      SET community.memberCount = $memberCount
      WITH community
      MATCH (keyconcept:KeyConcept) WHERE keyconcept.id IN $keyConceptIds
      MERGE (community)-[:HAS_MEMBER]->(keyconcept)
    `;
    await this.neo4j.writeOne(addQuery);
  }

  /** PARENT_OF between two groups of the same company. */
  async setParentCommunity(params: { childCommunityId: string; parentCommunityId: string }): Promise<void> {
    const query = this.writeQuery("setParentCommunity");
    await this.neo4j.validateRelatedNodes({
      nodes: [{ id: params.parentCommunityId, label: communityMeta.labelName }],
    });

    query.queryParams = {
      ...query.queryParams,
      searchValue: params.childCommunityId,
      parentCommunityId: params.parentCommunityId,
    };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      MATCH (parent:Community {id: $parentCommunityId})
      WHERE EXISTS { MATCH (parent)-[:BELONGS_TO]-(company) }
      MERGE (parent)-[:PARENT_OF]->(community)
    `;
    await this.neo4j.writeOne(query);
  }

  /** Marks groups as stale (needs reprocessing). */
  async markAsStale(communityIds: string[]): Promise<void> {
    if (communityIds.length === 0) return;

    const query = this.writeQuery("markAsStale");
    query.queryParams = { ...query.queryParams, communityIds };
    query.query += `
      ${this.buildDefaultMatch()}
      WHERE community.id IN $communityIds
      SET community.isStale = true, community.staleSince = datetime(), community.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  /**
   * Defers a group for lack of credits: the summariser cron skips it (`findAllStaleCommunities`)
   * until approval clears the flag (spec §2: a fresh top-up must not be silently eaten).
   */
  async markPendingCredits(communityId: string): Promise<void> {
    const query = this.writeQuery("markPendingCredits");
    query.queryParams = { ...query.queryParams, searchValue: communityId };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      SET community.pendingCredits = true, community.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  /** Approval: clears the flag for the current company; returns the cleared ids so the caller can re-enqueue them. */
  async clearPendingCredits(): Promise<string[]> {
    const readQuery = this.writeQuery("clearPendingCredits");
    readQuery.query += `
      ${this.buildDefaultMatch()}
      WHERE community.pendingCredits = true
      RETURN community
    `;
    const pending = await this.neo4j.readMany<Community>(readQuery);
    const communityIds = pending.map((community) => community.id);
    if (communityIds.length === 0) return [];

    const writeQuery = this.writeQuery("clearPendingCredits");
    writeQuery.queryParams = { ...writeQuery.queryParams, communityIds };
    writeQuery.query += `
      ${this.buildDefaultMatch()}
      WHERE community.id IN $communityIds
      SET community.pendingCredits = false, community.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(writeQuery);

    return communityIds;
  }

  /** Backlog count for the current company (mirrors countStaleCommunities). */
  async countPendingCredits(): Promise<number> {
    const query = this.readQuery();
    query.query += `
      ${this.buildDefaultMatch()}
      WHERE community.pendingCredits = true
      RETURN COUNT(community) AS count
    `;
    const result = await this.neo4j.read(query.query, query.queryParams); // nja-lint-ignore: scalar read, no node to map (Carlo, 2026-10-28, WYR-10 spec D4)
    return toNumber(result.records[0]?.get("count"));
  }

  /** Stale groups of the current company. */
  async countStaleCommunities(): Promise<number> {
    const query = this.readQuery();
    query.query += `
      ${this.buildDefaultMatch()}
      WHERE community.isStale = true
      RETURN COUNT(community) AS count
    `;
    const result = await this.neo4j.read(query.query, query.queryParams); // nja-lint-ignore: scalar read, no node to map (Carlo, 2026-10-28, WYR-10 spec D4)
    return toNumber(result.records[0]?.get("count"));
  }

  /**
   * Stale groups with their company ids, for the cron. Runs with no company in CLS, so the
   * default match spans every company (spec D5: no admin repository).
   */
  async findAllStaleCommunities(): Promise<{ communityId: string; companyId: string }[]> {
    const query = this.readQuery();
    query.query += `
      ${this.buildDefaultMatch()}
      WHERE community.isStale = true
        AND (community.pendingCredits IS NULL OR community.pendingCredits = false)
      MATCH (community)-[:BELONGS_TO]->(${communityMeta.nodeName}_${companyMeta.nodeName}:${companyMeta.labelName})
      RETURN community, ${communityMeta.nodeName}_${companyMeta.nodeName}
      ORDER BY community.staleSince ASC
    `;
    const communities = await this.neo4j.readMany<Community>(query);
    return communities.map((community) => ({ communityId: community.id, companyId: community.company?.id }));
  }

  /**
   * The layer root a group was detected under (its SCOPED_TO target), for the current company.
   * `null` on the company layer, with no company in CLS, or when the group has no root.
   *
   * @deprecated rootLabels — accepted and ignored: the layer comes from CommunityLayerService.
   */
  async findScopeRootForCommunity(params: { communityId: string; rootLabels?: string[] }): Promise<AgentScope | null> {
    const layer = await this.layer.ready();
    if (!layer) return null;

    const model = modelRegistry.getByLabelName(layer.labelName);
    if (!model) return null;

    const query = this.neo4j.initQuery({ serialiser: model });
    if (!query.queryParams.companyId) return null;

    query.queryParams = { ...query.queryParams, searchValue: params.communityId };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      MATCH (community)-[:SCOPED_TO]->(${layer.nodeName}:${layer.labelName})
      WHERE EXISTS { MATCH (${layer.nodeName})-[:BELONGS_TO]-(company) }
      RETURN ${layer.nodeName}
    `;
    const root = await this.neo4j.readOne<{ id: string }>(query);
    return root?.id ? { id: root.id, type: layer.type, label: layer.labelName } : null;
  }

  /**
   * Deletes every group detected under one layer root, for the current company. A scope of
   * another type than the layer (or no layer) does nothing; the label comes from the layer.
   */
  async deleteCommunitiesForScope(params: { scope: AgentScope }): Promise<void> {
    const query = this.readQuery();
    // No company in CLS: refuse with a no-op, never a delete across every company.
    if (!query.queryParams.companyId) return;
    const layer = await this.layer.ready();
    if (!layer || params.scope.type !== layer.type) return;

    query.queryParams = { ...query.queryParams, scopeRootId: params.scope.id };
    query.query += `
      ${this.buildDefaultMatch()}
      WHERE EXISTS { MATCH (community)-[:SCOPED_TO]->(:${layer.labelName} { id: $scopeRootId }) }
      DETACH DELETE community
    `;
    await this.neo4j.writeOne(query);
  }

  /** Writes the summary and embedding and clears the stale flag. */
  async updateSummary(params: {
    communityId: string;
    name: string;
    summary: string;
    embedding: number[];
    rating: number;
  }): Promise<void> {
    const query = this.writeQuery("updateSummary");
    query.queryParams = {
      ...query.queryParams,
      searchValue: params.communityId,
      name: params.name,
      summary: params.summary,
      embedding: params.embedding,
      rating: params.rating,
    };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      SET community.name = $name,
          community.summary = $summary,
          community.embedding = $embedding,
          community.rating = $rating,
          community.isStale = false,
          community.staleSince = null,
          community.pendingCredits = false,
          community.lastProcessedAt = datetime(),
          community.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  /** Clears the stale flag without summarising (credit backlog discard). */
  async clearStaleness(params: { communityIds: string[] }): Promise<void> {
    if (params.communityIds.length === 0) return;

    const query = this.writeQuery("clearStaleness");
    query.queryParams = { ...query.queryParams, communityIds: params.communityIds };
    query.query += `
      ${this.buildDefaultMatch()}
      WHERE community.id IN $communityIds
      SET community.isStale = false, community.staleSince = null, community.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  /**
   * Vector search over the current company's groups.
   *
   * FAIL CLOSED on scope. A group summarises many members at once, so in a scoped chat only
   * groups detected within that exact root are eligible. A chat scoped to a type other than the
   * layer (or any scoped chat on the company layer) gets nothing: its groups mix roots.
   */
  async findByVector(params: { embedding: number[]; topK: number; level?: number }): Promise<Community[]> {
    const scope = this.agentScope.current();
    const layer = await this.layer.ready();
    if (scope && (!layer || scope.type !== layer.type)) return [];

    const countQuery = this.readQuery();
    if (!countQuery.queryParams.companyId) return [];

    const conditions = ["community.embedding IS NOT NULL", "community.isStale = false"];
    if (params.level !== undefined) conditions.push("community.level = $level");
    if (scope && layer)
      conditions.push(`EXISTS { MATCH (community)-[:SCOPED_TO]->(:${layer.labelName} { id: $agentScopeId }) }`);

    const filterParams = {
      embedding: params.embedding,
      topK: params.topK,
      level: params.level,
      ...(scope ? { agentScopeId: scope.id } : {}),
    };

    // The vector index ranks ALL companies first and filters afterwards, so identical content
    // in other companies can push this company's groups out of the candidates. Small sets are
    // ranked by exact cosine; the index only above the threshold (mirrors ChunkRepository).
    countQuery.queryParams = { ...countQuery.queryParams, ...filterParams };
    countQuery.query += `
      ${this.buildDefaultMatch()}
      WHERE ${conditions.join(" AND ")}
      RETURN count(community) AS scopedCount
    `;
    const countResult = await this.neo4j.read(countQuery.query, countQuery.queryParams); // nja-lint-ignore: scalar read, no node to map (Carlo, 2026-10-28, WYR-10 spec D4)
    const scopedCount = toNumber(countResult?.records?.[0]?.get("scopedCount"));
    if (scopedCount === 0) return [];

    const query = this.readQuery();
    query.queryParams = { ...query.queryParams, ...filterParams };

    if (scopedCount <= COMMUNITY_EXACT_SCAN_MAX_SCOPED_NODES) {
      query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${conditions.join(" AND ")}
      WITH community, vector.similarity.cosine(community.embedding, $embedding) AS score
      RETURN community, score
      ORDER BY score DESC
      LIMIT toInteger($topK)
    `;
      return this.neo4j.readMany(query);
    }

    // nja-lint-ignore: vector index CALL precedes the default match (Carlo, 2026-10-28, WYR-10 O3)
    query.query += `
      CALL db.index.vector.queryNodes('communities', $topK * 2, $embedding)
      YIELD node AS community, score
      WHERE EXISTS { MATCH (community)-[:BELONGS_TO]-(company) } AND ${conditions.join(" AND ")}
      RETURN community, score
      ORDER BY score DESC
      LIMIT toInteger($topK)
    `;
    return this.neo4j.readMany(query);
  }

  /** Groups of one hierarchy level, for the current company. */
  async findByLevel(params: { level: number }): Promise<Community[]> {
    const query = this.readQuery();
    query.queryParams = { ...query.queryParams, level: params.level };
    query.query += `
      ${this.buildDefaultMatch()}
      WHERE community.level = $level
      RETURN community
      ORDER BY community.rating DESC
    `;
    return this.neo4j.readMany(query);
  }

  /** Member key concepts of a group. */
  async findMemberKeyConcepts(communityId: string): Promise<{ id: string; value: string; description?: string }[]> {
    const query = this.neo4j.initQuery({ serialiser: KeyConceptModel });
    query.queryParams = { ...query.queryParams, searchValue: communityId };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      MATCH (community)-[:HAS_MEMBER]->(keyconcept:KeyConcept)
      RETURN keyconcept
    `;
    const keyConcepts = await this.neo4j.readMany<KeyConcept>(query);
    return keyConcepts.map((keyConcept) => ({
      id: keyConcept.id,
      value: keyConcept.value,
      description: keyConcept.description ?? undefined,
    }));
  }

  /** KeyConceptRelationships between a group's members. */
  async findMemberRelationships(
    communityId: string,
  ): Promise<{ keyConcept1: string; keyConcept2: string; weight: number }[]> {
    const query = this.readQuery();
    query.queryParams = { ...query.queryParams, searchValue: communityId };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      MATCH (community)-[:HAS_MEMBER]->(kc1:KeyConcept)
      MATCH (community)-[:HAS_MEMBER]->(kc2:KeyConcept)
      MATCH (kc1)<-[:RELATES_TO]-(rel:KeyConceptRelationship)-[:RELATES_TO]->(kc2)
      WHERE kc1.value < kc2.value
      RETURN kc1.value AS keyConcept1, kc2.value AS keyConcept2, rel.weight AS weight
    `;
    const result = await this.neo4j.read(query.query, query.queryParams); // nja-lint-ignore: scalar read, no node to map (Carlo, 2026-10-28, WYR-10 spec D4)
    return result.records.map((record: any) => {
      const weight = record.get("weight");
      return {
        keyConcept1: record.get("keyConcept1"),
        keyConcept2: record.get("keyConcept2"),
        weight: weight?.toNumber?.() ?? weight ?? 1.0,
      };
    });
  }

  /** The group and its parent chain, top level first. */
  async getHierarchy(communityId: string): Promise<Community[]> {
    const query = this.readQuery();
    query.queryParams = { ...query.queryParams, searchValue: communityId };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      MATCH path = (parent:Community)-[:PARENT_OF*]->(community)
      WHERE all(node IN nodes(path) WHERE EXISTS { MATCH (node)-[:BELONGS_TO]-(company) })
      UNWIND nodes(path) AS member
      RETURN DISTINCT member AS community
      ORDER BY community.level DESC
    `;
    return this.neo4j.readMany(query);
  }

  /** Child groups of a group. */
  async getChildren(communityId: string): Promise<Community[]> {
    const query = this.readQuery();
    query.queryParams = { ...query.queryParams, searchValue: communityId };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      MATCH (community)-[:PARENT_OF]->(child:Community)
      WHERE EXISTS { MATCH (child)-[:BELONGS_TO]-(company) }
      RETURN child AS community
      ORDER BY community.rating DESC
    `;
    return this.neo4j.readMany(query);
  }

  /** Deletes one group of the current company. */
  async deleteCommunity(communityId: string): Promise<void> {
    const query = this.writeQuery("deleteCommunity");
    query.queryParams = { ...query.queryParams, searchValue: communityId };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      DETACH DELETE community
    `;
    await this.neo4j.writeOne(query);
  }

  /** Deletes every group of the current company. */
  async deleteAllCommunities(): Promise<void> {
    const query = this.writeQuery("deleteAllCommunities");
    query.query += `
      ${this.buildDefaultMatch()}
      DETACH DELETE community
    `;
    await this.neo4j.writeOne(query);
  }

  /** Groups of the current company that contain a key concept. */
  async findCommunitiesByKeyConcept(keyConceptId: string): Promise<Community[]> {
    const query = this.readQuery();
    query.queryParams = { ...query.queryParams, keyConceptId };
    query.query += `
      ${this.buildDefaultMatch()}
      MATCH (community)-[:HAS_MEMBER]->(:KeyConcept {id: $keyConceptId})
      RETURN community
      ORDER BY community.level ASC
    `;
    return this.neo4j.readMany(query);
  }

  /** Group counts per level for the current company. */
  async countByLevel(): Promise<{ level: number; count: number }[]> {
    const query = this.readQuery();
    query.query += `
      ${this.buildDefaultMatch()}
      RETURN community.level AS level, COUNT(community) AS count
      ORDER BY level ASC
    `;
    const result = await this.neo4j.read(query.query, query.queryParams); // nja-lint-ignore: scalar read, no node to map (Carlo, 2026-10-28, WYR-10 spec D4)
    return result.records.map((record: any) => ({
      level: toNumber(record.get("level")),
      count: toNumber(record.get("count")),
    }));
  }

  /**
   * `findById({ id })` is the inherited read. A bare id string is the pre-descriptor signature,
   * kept so existing callers do not break.
   *
   * @deprecated Passing a bare id string: use `findCommunityById(id)` (returns `null` when missing).
   */
  async findById(params: string): Promise<Community | null>;
  async findById(params: { id: string }): Promise<Community>;
  async findById(params: string | { id: string }): Promise<Community | null> {
    if (typeof params === "string") return this.findCommunityById(params);
    return super.findById(params);
  }

  /**
   * Ids of the layer's root nodes the current company owns. `[]` on the company layer
   * or with no company in CLS. The label comes from the layer, never from a caller.
   */
  async findLayerRootIds(): Promise<string[]> {
    const layer = await this.layer.ready();
    if (!layer) return [];

    const model = modelRegistry.getByLabelName(layer.labelName);
    if (!model) return [];

    const query = this.neo4j.initQuery({ serialiser: model });
    if (!query.queryParams.companyId) return [];

    query.query += `
      MATCH (${layer.nodeName}:${layer.labelName})
      WHERE EXISTS { MATCH (${layer.nodeName})-[:BELONGS_TO]-(company) }
      RETURN ${layer.nodeName}
    `;
    const roots = await this.neo4j.readMany<{ id: string }>(query);
    return roots.map((root) => root.id).filter((id): id is string => typeof id === "string");
  }

  /** One group of the current company, or `null`. */
  async findCommunityById(communityId: string): Promise<Community | null> {
    const query = this.readQuery();
    query.queryParams = { ...query.queryParams, searchValue: communityId };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      RETURN community
    `;
    return this.neo4j.readOne(query);
  }

  /**
   * Groups holding key concepts related to a given one, with affinity totals.
   *
   * `scopeRoot` keeps incremental assignment inside its partition: key concepts are shared by
   * value, so a concept two roots share relates to members of both their groups. Its `label` is
   * ignored (the layer's is used); with no layer no scope filter applies.
   */
  async findCommunitiesByRelatedKeyConcepts(
    keyConceptId: string,
    scopeRoot?: { id: string; label: string },
  ): Promise<{ communityId: string; memberCount: number; relationshipCount: number; totalWeight: number }[]> {
    const layer = await this.layer.ready();
    const scopeLabel = scopeRoot && layer ? layer.labelName : undefined;

    const query = this.readQuery();
    query.queryParams = { ...query.queryParams, keyConceptId, scopeRootId: scopeRoot?.id ?? null };
    query.query += `
      ${this.buildDefaultMatch()}
      ${scopeLabel ? `WHERE EXISTS { MATCH (community)-[:SCOPED_TO]->(:${scopeLabel} { id: $scopeRootId }) }` : ""}
      MATCH (community)-[:HAS_MEMBER]->(relatedKc:KeyConcept)
      MATCH (:KeyConcept {id: $keyConceptId})<-[:RELATES_TO]-(rel:KeyConceptRelationship)-[:RELATES_TO]->(relatedKc)
      WITH community,
           count(DISTINCT relatedKc) AS relationshipCount,
           sum(coalesce(rel.weight, 1.0)) AS totalWeight
      RETURN community, relationshipCount, totalWeight
      ORDER BY totalWeight DESC
    `;
    const communities = await this.neo4j.readMany<Community>(query);
    return communities.map((community) => ({
      communityId: community.id,
      memberCount: community.memberCount ?? 0,
      relationshipCount: community.relationshipCount ?? 0,
      totalWeight: community.totalWeight ?? 0,
    }));
  }

  /** Adds one key concept to a group. */
  async addMemberToCommunity(communityId: string, keyConceptId: string): Promise<void> {
    const query = this.writeQuery("addMemberToCommunity");
    await this.neo4j.validateRelatedNodes({ nodes: [{ id: keyConceptId, label: keyConceptMeta.labelName }] });

    query.queryParams = { ...query.queryParams, searchValue: communityId, keyConceptId };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      MATCH (keyconcept:KeyConcept {id: $keyConceptId})
      MERGE (community)-[:HAS_MEMBER]->(keyconcept)
      SET community.memberCount = community.memberCount + 1,
          community.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  /**
   * Key concepts of one content that are in no group of THIS company. `label` must be a
   * registered model's: an unknown label returns `[]` and never reaches the query text.
   */
  async findOrphanKeyConceptsForContent(contentId: string, label: string): Promise<string[]> {
    const model = modelRegistry.getByLabelName(label);
    if (!model) return [];

    const query = this.neo4j.initQuery({ serialiser: KeyConceptModel });
    if (!query.queryParams.companyId) return [];

    query.queryParams = { ...query.queryParams, contentId };
    query.query += `
      MATCH (content:${model.labelName} {id: $contentId})
      WHERE EXISTS { MATCH (content)-[:BELONGS_TO]-(company) }
      MATCH (content)-[:HAS_CHUNK]->()-[:HAS_ATOMIC_FACT]->()-[:HAS_KEY_CONCEPT]->(keyconcept:KeyConcept)
      WHERE NOT EXISTS { MATCH (keyconcept)<-[:HAS_MEMBER]-(community:Community) WHERE EXISTS { MATCH (community)-[:BELONGS_TO]-(company) } }
      RETURN DISTINCT keyconcept
    `;
    const keyConcepts = await this.neo4j.readMany<KeyConcept>(query);
    return keyConcepts.map((keyConcept) => keyConcept.id);
  }
}
