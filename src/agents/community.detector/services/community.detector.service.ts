import { Inject, Injectable, Optional } from "@nestjs/common";
import { SCOPE_PREDICATE_SOURCE, ScopePredicateSource } from "../../../common/repositories/scope-predicate.source";
import { AgentScope } from "../../../common/types/agent.scope";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { CommunityRepository } from "../../../foundations/community/repositories/community.repository";
import { GraphCatalogService } from "../../graph/services/graph.catalog.service";
import { buildScopePattern } from "../../graph/services/scope.pattern";

interface DetectedCommunity {
  id: string;
  level: number;
  memberKeyConceptIds: string[];
  parentCommunityId?: string;
}

@Injectable()
export class CommunityDetectorService {
  // Note: OpenGDS doesn't support resolution parameter, so we only run single level
  // Future: could use Leiden with gamma, or post-process for hierarchy
  private readonly louvainResolutions = [1.0];
  private readonly minCommunitySize = 3;

  constructor(
    private readonly neo4j: Neo4jService,
    private readonly logger: AppLoggingService,
    private readonly communityRepository: CommunityRepository,
    @Optional() private readonly catalog?: GraphCatalogService,
    @Optional() @Inject(SCOPE_PREDICATE_SOURCE) private readonly scopePredicates?: ScopePredicateSource,
  ) {}

  /**
   * Detect communities for all KeyConcepts belonging to the current company
   * Creates hierarchical communities at multiple resolution levels
   */
  async detectCommunities(): Promise<void> {
    this.logger.log("Starting community detection", "CommunityDetectorService");

    try {
      // Delete existing communities for this company before regenerating
      await this.communityRepository.deleteAllCommunities();
      this.logger.debug("Deleted existing communities", "CommunityDetectorService");

      // Check if GDS is available
      const gdsAvailable = await this.checkGdsAvailability();
      if (!gdsAvailable) {
        this.logger.warn("Neo4j GDS not available, skipping community detection", "CommunityDetectorService");
        return;
      }

      // Check if there are any KeyConcepts for this company
      const keyConceptCount = await this.countKeyConceptsForCompany();
      if (keyConceptCount === 0) {
        this.logger.warn("No KeyConcepts found for company, skipping community detection", "CommunityDetectorService");
        return;
      }
      this.logger.debug(`Found ${keyConceptCount} KeyConcepts for community detection`, "CommunityDetectorService");

      // One PARTITION per scope root. A community summarises many members at
      // once, so a community detected across two roots cannot be handed to a
      // run confined to either of them — the partition is what makes community
      // retrieval usable in a scoped run at all. Apps with no scope roots get
      // a single company-wide partition, exactly as before.
      const partitions = await this.listScopeRoots();
      this.logger.log(
        partitions.length
          ? `Detecting communities across ${partitions.length} scope root(s)`
          : `No scope roots catalogued — detecting communities company-wide`,
        "CommunityDetectorService",
      );

      let total = 0;
      for (const partition of partitions.length ? partitions : [undefined]) {
        // GDS refuses a projection whose node query matches nothing
        // ("Node-Query returned no nodes"), and an empty partition is the NORM
        // once detection runs per scope root — most roots hold no ingested
        // content at all. Checked here rather than caught downstream so an
        // empty partition is a skip, not a failed company.
        if (partition) {
          const partitionKeyConcepts = await this.countKeyConceptsForCompany(partition);
          if (partitionKeyConcepts === 0) {
            this.logger.debug(
              `No KeyConcepts under ${partition.type}:${partition.id} — skipping its partition`,
              "CommunityDetectorService",
            );
            continue;
          }
        }

        const detected: DetectedCommunity[] = [];

        for (let levelIndex = 0; levelIndex < this.louvainResolutions.length; levelIndex++) {
          const resolution = this.louvainResolutions[levelIndex];
          const level = levelIndex;

          const levelCommunities = await this.detectCommunitiesAtLevel(resolution, level, partition);
          detected.push(...levelCommunities);

          this.logger.debug(
            `Detected ${levelCommunities.length} communities at level ${level}` +
              (partition ? ` for ${partition.type}:${partition.id}` : ""),
            "CommunityDetectorService",
          );
        }

        // Hierarchy is built WITHIN a partition: a parent community must never
        // adopt a child detected under a different scope root.
        await this.buildHierarchy(detected);
        total += detected.length;
      }

      this.logger.log(`Community detection completed: ${total} total communities`, "CommunityDetectorService");
    } catch (error) {
      this.logger.error(`Community detection failed: ${error.message}`, "CommunityDetectorService");
      throw error;
    }
  }

  /**
   * Count KeyConcepts for the current company
   */
  private async countKeyConceptsForCompany(scopeRoot?: AgentScope): Promise<number> {
    const query = this.neo4j.initQuery();
    const predicate = scopeRoot ? this.scopePredicates?.build({ alias: "data", scope: scopeRoot }) : undefined;
    if (scopeRoot && !predicate) return 0;

    query.queryParams = { ...query.queryParams, ...(predicate?.params ?? {}) };
    query.query += `
      MATCH (company)<-[:BELONGS_TO]-(data)-[:HAS_CHUNK]->()-[:HAS_ATOMIC_FACT]->()-[:HAS_KEY_CONCEPT]->(kc:KeyConcept)
      ${predicate ? `WHERE ${predicate.cypher}` : ""}
      RETURN count(DISTINCT kc) AS count
    `;

    // Use raw read() to avoid entity serialization - we just need a count
    const result = await this.neo4j.read(query.query, query.queryParams);
    if (result.records.length > 0) {
      const count = result.records[0].get("count");
      return count?.toNumber?.() ?? count ?? 0;
    }
    return 0;
  }

  /**
   * Check if Neo4j GDS is available
   */
  private async checkGdsAvailability(): Promise<boolean> {
    try {
      // Use raw read() to avoid initQuery() company/user context requirement
      const result = await this.neo4j.read(`RETURN gds.version() AS version`, {});
      if (result.records.length > 0) {
        const version = result.records[0].get("version");
        this.logger.log(`Neo4j GDS version ${version} detected`, "CommunityDetectorService");
        return true;
      }
      return false;
    } catch (error) {
      this.logger.warn(`Neo4j GDS check failed: ${(error as Error).message}`, "CommunityDetectorService");
      return false;
    }
  }

  /**
   * Detect communities at a specific resolution level using Louvain algorithm
   */
  private async detectCommunitiesAtLevel(
    resolution: number,
    level: number,
    scopeRoot?: AgentScope,
  ): Promise<DetectedCommunity[]> {
    const graphName = `keyconcept_graph_${Date.now()}`;

    try {
      // Step 1: Project the KeyConcept graph into GDS
      const projected = await this.projectGraph(graphName, scopeRoot);
      if (!projected) return [];

      // Step 2: Run Louvain community detection
      const communityAssignments = await this.runLouvain(graphName, resolution);

      // Step 3: Create Community nodes from the results
      const detectedCommunities = await this.createCommunityNodes(communityAssignments, level, scopeRoot);

      return detectedCommunities;
    } finally {
      // Clean up: drop the projected graph
      await this.dropGraph(graphName);
    }
  }

  /**
   * Project KeyConcept graph into Neo4j GDS
   * Uses KeyConceptRelationship weights as relationship weights
   */
  private async projectGraph(graphName: string, scopeRoot?: AgentScope): Promise<boolean> {
    const query = this.neo4j.initQuery();

    // The projection cypher is embedded in a SINGLE-QUOTED Cypher string
    // literal, so the predicate has to be one line — a multi-line predicate
    // would terminate the literal.
    const predicate = scopeRoot ? this.scopePredicates?.build({ alias: "data", scope: scopeRoot }) : undefined;

    if (scopeRoot && !predicate) {
      // FAIL CLOSED, same rule as retrieval: a partition that cannot be
      // expressed produces no communities rather than company-wide ones.
      this.logger.warn(
        `Cannot compile a scope predicate for ${scopeRoot.type}:${scopeRoot.id} — skipping its partition`,
        "CommunityDetectorService",
      );
      return false;
    }

    const flat = predicate ? predicate.cypher.replace(/\s+/g, " ") : "";
    const nodeWhere = predicate ? `WHERE ${flat}` : "";
    const relWhere = predicate
      ? `WHERE EXISTS { MATCH (rel)-[:OCCURS_IN]->(:Chunk)<-[:HAS_CHUNK]-(data) WHERE ${flat} }`
      : "";

    // GDS cypher projection needs parameters passed via configuration
    // Path: Company <- BELONGS_TO - Content -> HAS_CHUNK -> Chunk -> HAS_ATOMIC_FACT -> AtomicFact -> HAS_KEY_CONCEPT -> KeyConcept
    query.query += `
      CALL gds.graph.project.cypher(
        $graphName,
        'MATCH (company:Company {id: $companyId})<-[:BELONGS_TO]-(data)-[:HAS_CHUNK]->()-[:HAS_ATOMIC_FACT]->()-[:HAS_KEY_CONCEPT]->(kc:KeyConcept)
         ${nodeWhere}
         RETURN DISTINCT id(kc) AS id',
        'MATCH (kc1:KeyConcept)<-[:RELATES_TO]-(rel:KeyConceptRelationship)-[:RELATES_TO]->(kc2:KeyConcept)
         MATCH (rel)-[:BELONGS_TO]->(company:Company {id: $companyId})
         ${relWhere}
         RETURN id(kc1) AS source, id(kc2) AS target, coalesce(rel.weight, 1.0) AS weight',
        { parameters: { companyId: $companyId${predicate ? ", agentScopeId: $agentScopeId" : ""} }, validateRelationships: false }
      )
      YIELD graphName, nodeCount, relationshipCount
      RETURN graphName, nodeCount, relationshipCount
    `;

    query.queryParams = { ...query.queryParams, graphName, ...(predicate?.params ?? {}) };

    // Use raw read() to avoid entity serialization
    const result = await this.neo4j.read(query.query, query.queryParams);
    const record = result.records[0];
    const nodeCount = record?.get("nodeCount")?.toNumber?.() ?? record?.get("nodeCount") ?? 0;
    const relationshipCount = record?.get("relationshipCount")?.toNumber?.() ?? record?.get("relationshipCount") ?? 0;

    this.logger.debug(
      `Graph projected: ${nodeCount} nodes, ${relationshipCount} relationships` +
        (scopeRoot ? ` for ${scopeRoot.type}:${scopeRoot.id}` : ""),
      "CommunityDetectorService",
    );

    return nodeCount > 0;
  }

  /**
   * Every scope-root node the current company owns.
   *
   * Root types come from the catalog — an entity whose compiled scope chain is
   * empty IS a root. Without a catalog (a consumer that never loads the graph
   * layer) there are no roots, and detection stays company-wide.
   */
  private async listScopeRoots(): Promise<AgentScope[]> {
    if (!this.catalog || !this.scopePredicates) return [];

    const rootTypes = this.catalog
      .getAllEntities()
      .filter((entity) => entity.scope?.path.length === 0 && entity.scope.rootType === entity.type);

    const roots: AgentScope[] = [];
    for (const rootType of rootTypes) {
      const query = this.neo4j.initQuery();
      query.query += `
        MATCH (root:${rootType.labelName})-[:BELONGS_TO]->(company)
        RETURN root.id AS id
      `;
      const result = await this.neo4j.read(query.query, query.queryParams);
      for (const record of result.records) {
        const id = record.get("id");
        if (typeof id === "string") roots.push({ id, type: rootType.type, label: rootType.labelName });
      }
    }
    return roots;
  }

  /**
   * The scope root a single content node sits under — the inverse of
   * `listScopeRoots`, walking the catalog chain up rather than enumerating
   * down. `undefined` when the app has no catalog, the label is not
   * catalogued, or the node has no chain to a root; the caller then falls back
   * to unpartitioned behaviour, which is correct for content that genuinely
   * belongs to no root.
   */
  private async resolveScopeRootForContent(contentId: string, label: string): Promise<AgentScope | undefined> {
    if (!this.catalog) return undefined;

    const entity = this.catalog.getAllEntities().find((candidate) => candidate.labelName === label);
    const scope = entity?.scope;
    if (!entity || !scope) return undefined;

    if (scope.path.length === 0) {
      // The content IS a scope root.
      return { id: contentId, type: scope.rootType, label: scope.rootLabel };
    }

    const pattern = buildScopePattern({ scope, alias: "content", rootAlias: "scopeRoot" });
    const result = await this.neo4j.read(
      `
      MATCH (content:${entity.labelName} { id: $contentId })
      MATCH ${pattern}
      RETURN scopeRoot.id AS id
      LIMIT 1
      `,
      { contentId },
    );

    const id = result.records[0]?.get("id");
    return typeof id === "string" ? { id, type: scope.rootType, label: scope.rootLabel } : undefined;
  }

  /**
   * Run Louvain community detection algorithm
   */
  private async runLouvain(graphName: string, _resolution: number): Promise<Map<string, number>> {
    const query = this.neo4j.initQuery();

    // Note: OpenGDS doesn't support 'resolution' parameter, using basic Louvain
    query.query += `
      CALL gds.louvain.stream($graphName, {
        relationshipWeightProperty: 'weight'
      })
      YIELD nodeId, communityId
      WITH gds.util.asNode(nodeId) AS node, communityId
      RETURN node.id AS keyConceptId, communityId
    `;

    query.queryParams = { ...query.queryParams, graphName };

    // Use raw read() to avoid entity serialization
    const result = await this.neo4j.read(query.query, query.queryParams);

    const communityAssignments = new Map<string, number>();
    for (const record of result.records) {
      const keyConceptId = record.get("keyConceptId");
      const communityId = record.get("communityId")?.toNumber?.() ?? record.get("communityId");
      communityAssignments.set(keyConceptId, communityId);
    }

    return communityAssignments;
  }

  /**
   * Create Community nodes from Louvain results
   */
  private async createCommunityNodes(
    communityAssignments: Map<string, number>,
    level: number,
    scopeRoot?: AgentScope,
  ): Promise<DetectedCommunity[]> {
    // Group KeyConcepts by community
    const communitiesMap = new Map<number, string[]>();
    for (const [keyConceptId, communityId] of communityAssignments) {
      if (!communitiesMap.has(communityId)) {
        communitiesMap.set(communityId, []);
      }
      communitiesMap.get(communityId)!.push(keyConceptId);
    }

    const detectedCommunities: DetectedCommunity[] = [];

    // Create Community nodes for each cluster
    for (const [, keyConceptIds] of communitiesMap) {
      // Skip communities smaller than minimum size
      if (keyConceptIds.length < this.minCommunitySize) {
        continue;
      }

      // Create the community node
      const community = await this.communityRepository.createCommunity({
        name: `Community L${level}`, // Temporary name, will be updated by summariser
        level,
        memberCount: keyConceptIds.length,
        rating: 0, // Will be updated by summariser
        scopeRoot: scopeRoot ? { id: scopeRoot.id, label: scopeRoot.label } : undefined,
      });

      // Add HAS_MEMBER relationships
      await this.communityRepository.updateCommunityMembers({
        communityId: community.id,
        keyConceptIds,
      });

      detectedCommunities.push({
        id: community.id,
        level,
        memberKeyConceptIds: keyConceptIds,
      });
    }

    return detectedCommunities;
  }

  /**
   * Build PARENT_OF hierarchy between communities at different levels
   * A parent community at level N+1 contains child communities at level N
   * if the child's members are a subset of the parent's members
   */
  private async buildHierarchy(allCommunities: DetectedCommunity[]): Promise<void> {
    // Group communities by level
    const communitiesByLevel = new Map<number, DetectedCommunity[]>();
    for (const community of allCommunities) {
      if (!communitiesByLevel.has(community.level)) {
        communitiesByLevel.set(community.level, []);
      }
      communitiesByLevel.get(community.level)!.push(community);
    }

    // For each level, find parent communities in the next level
    const levels = Array.from(communitiesByLevel.keys()).sort((a, b) => a - b);

    for (let i = 0; i < levels.length - 1; i++) {
      const childLevel = levels[i];
      const parentLevel = levels[i + 1];

      const childCommunities = communitiesByLevel.get(childLevel) || [];
      const parentCommunities = communitiesByLevel.get(parentLevel) || [];

      for (const child of childCommunities) {
        // Find the best parent (highest overlap)
        let bestParent: DetectedCommunity | null = null;
        let bestOverlap = 0;

        const childMembers = new Set(child.memberKeyConceptIds);

        for (const parent of parentCommunities) {
          const parentMembers = new Set(parent.memberKeyConceptIds);

          // Count overlap
          let overlap = 0;
          for (const member of childMembers) {
            if (parentMembers.has(member)) {
              overlap++;
            }
          }

          // Parent must contain majority of child's members
          const overlapRatio = overlap / childMembers.size;
          if (overlapRatio > 0.5 && overlap > bestOverlap) {
            bestParent = parent;
            bestOverlap = overlap;
          }
        }

        if (bestParent) {
          await this.communityRepository.setParentCommunity({
            childCommunityId: child.id,
            parentCommunityId: bestParent.id,
          });
        }
      }
    }

    this.logger.debug("Community hierarchy built", "CommunityDetectorService");
  }

  /**
   * Drop a projected graph from GDS
   */
  private async dropGraph(graphName: string): Promise<void> {
    try {
      await this.neo4j.writeOne({
        query: `CALL gds.graph.drop($graphName, false) YIELD graphName RETURN graphName`,
        queryParams: { graphName },
      });
    } catch {
      // Graph might not exist, ignore error
    }
  }

  /**
   * Mark communities affected by a KeyConcept change as stale
   */
  async markAffectedCommunitiesStale(keyConceptId: string): Promise<void> {
    const communities = await this.communityRepository.findCommunitiesByKeyConcept(keyConceptId);
    const communityIds = communities.map((c) => c.id);

    if (communityIds.length > 0) {
      await this.communityRepository.markAsStale(communityIds);
      this.logger.debug(
        `Marked ${communityIds.length} communities as stale for KeyConcept ${keyConceptId}`,
        "CommunityDetectorService",
      );
    }
  }

  /**
   * Incrementally assign KeyConcepts from a content to existing communities
   * Called after document processing completes
   */
  async assignKeyConceptsToCommunities(contentId: string, label: string): Promise<void> {
    this.logger.debug(`Assigning KeyConcepts from ${label}:${contentId} to communities`, "CommunityDetectorService");

    // Find KeyConcepts from this content that aren't in any community yet
    const orphanKeyConceptIds = await this.communityRepository.findOrphanKeyConceptsForContent(contentId, label);

    if (orphanKeyConceptIds.length === 0) {
      this.logger.debug("No orphan KeyConcepts to assign", "CommunityDetectorService");
      return;
    }

    this.logger.debug(`Found ${orphanKeyConceptIds.length} orphan KeyConcepts to assign`, "CommunityDetectorService");

    // The partition this content belongs to. Candidate communities are confined
    // to it, so incremental assignment cannot undo what detection partitioned.
    const scopeRoot = await this.resolveScopeRootForContent(contentId, label);

    const affectedCommunityIds = new Set<string>();

    for (const keyConceptId of orphanKeyConceptIds) {
      // Find communities with related KeyConcepts
      const relatedCommunities = await this.communityRepository.findCommunitiesByRelatedKeyConcepts(
        keyConceptId,
        scopeRoot ? { id: scopeRoot.id, label: scopeRoot.label } : undefined,
      );

      if (relatedCommunities.length > 0) {
        // Assign to community with highest affinity (totalWeight)
        const bestCommunity = relatedCommunities[0];
        await this.communityRepository.addMemberToCommunity(bestCommunity.communityId, keyConceptId);
        affectedCommunityIds.add(bestCommunity.communityId);

        const msg = `Assigned KeyConcept ${keyConceptId} to community ${bestCommunity.communityId} (weight: ${bestCommunity.totalWeight})`;
        this.logger.debug(msg, "CommunityDetectorService");
      }
      // If no related communities, leave as orphan for next full detection
    }

    if (affectedCommunityIds.size > 0) {
      this.logger.log(
        `Assigned KeyConcepts to ${affectedCommunityIds.size} communities, marking as stale`,
        "CommunityDetectorService",
      );

      await this.communityRepository.markAsStale(Array.from(affectedCommunityIds));
    }
  }

  /**
   * Detect or assign communities based on current state.
   * - If no communities exist: run full Louvain detection
   * - If communities exist: incrementally assign orphan KeyConcepts
   */
  async detectAndAssignCommunities(contentId: string, label: string): Promise<void> {
    const levelCounts = await this.communityRepository.countByLevel();
    const totalCommunities = levelCounts.reduce((sum, lc) => sum + lc.count, 0);

    if (totalCommunities === 0) {
      await this.detectCommunities();
    } else {
      await this.assignKeyConceptsToCommunities(contentId, label);
    }
  }
}
