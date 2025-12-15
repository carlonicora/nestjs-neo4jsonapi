import { Injectable } from "@nestjs/common";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { CommunityRepository } from "../../../foundations/community/repositories/community.repository";
import { CommunitySummariserService } from "../../community.summariser/services/community.summariser.service";

interface CommunityDetectionResult {
  level: number;
  communities: Map<number, string[]>; // communityId -> keyConceptIds
}

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
    private readonly summariserService: CommunitySummariserService,
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

      // Detect communities at each resolution level
      const allDetectedCommunities: DetectedCommunity[] = [];

      for (let levelIndex = 0; levelIndex < this.louvainResolutions.length; levelIndex++) {
        const resolution = this.louvainResolutions[levelIndex];
        const level = levelIndex;

        this.logger.debug(
          `Detecting communities at level ${level} (resolution: ${resolution})`,
          "CommunityDetectorService",
        );

        const levelCommunities = await this.detectCommunitiesAtLevel(resolution, level);
        allDetectedCommunities.push(...levelCommunities);

        this.logger.debug(
          `Detected ${levelCommunities.length} communities at level ${level}`,
          "CommunityDetectorService",
        );
      }

      // Build hierarchy relationships between levels
      await this.buildHierarchy(allDetectedCommunities);

      this.logger.log(
        `Community detection completed: ${allDetectedCommunities.length} total communities`,
        "CommunityDetectorService",
      );
    } catch (error) {
      this.logger.error(`Community detection failed: ${error.message}`, "CommunityDetectorService");
      throw error;
    }
  }

  /**
   * Count KeyConcepts for the current company
   */
  private async countKeyConceptsForCompany(): Promise<number> {
    const query = this.neo4j.initQuery();
    query.query += `
      MATCH (company)<-[:BELONGS_TO]-()-[:HAS_CHUNK]->()-[:HAS_ATOMIC_FACT]->()-[:HAS_KEY_CONCEPT]->(kc:KeyConcept)
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
  private async detectCommunitiesAtLevel(resolution: number, level: number): Promise<DetectedCommunity[]> {
    const graphName = `keyconcept_graph_${Date.now()}`;

    try {
      // Step 1: Project the KeyConcept graph into GDS
      await this.projectGraph(graphName);

      // Step 2: Run Louvain community detection
      const communityAssignments = await this.runLouvain(graphName, resolution);

      // Step 3: Create Community nodes from the results
      const detectedCommunities = await this.createCommunityNodes(communityAssignments, level);

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
  private async projectGraph(graphName: string): Promise<void> {
    const query = this.neo4j.initQuery();

    // GDS cypher projection needs parameters passed via configuration
    // Path: Company <- BELONGS_TO - Content -> HAS_CHUNK -> Chunk -> HAS_ATOMIC_FACT -> AtomicFact -> HAS_KEY_CONCEPT -> KeyConcept
    query.query += `
      CALL gds.graph.project.cypher(
        $graphName,
        'MATCH (company:Company {id: $companyId})<-[:BELONGS_TO]-()-[:HAS_CHUNK]->()-[:HAS_ATOMIC_FACT]->()-[:HAS_KEY_CONCEPT]->(kc:KeyConcept)
         RETURN DISTINCT id(kc) AS id',
        'MATCH (kc1:KeyConcept)<-[:RELATES_TO]-(rel:KeyConceptRelationship)-[:RELATES_TO]->(kc2:KeyConcept)
         MATCH (rel)-[:BELONGS_TO]->(company:Company {id: $companyId})
         RETURN id(kc1) AS source, id(kc2) AS target, coalesce(rel.weight, 1.0) AS weight',
        { parameters: { companyId: $companyId }, validateRelationships: false }
      )
      YIELD graphName, nodeCount, relationshipCount
      RETURN graphName, nodeCount, relationshipCount
    `;

    query.queryParams = { ...query.queryParams, graphName };

    // Use raw read() to avoid entity serialization
    const result = await this.neo4j.read(query.query, query.queryParams);
    const record = result.records[0];
    const nodeCount = record?.get("nodeCount")?.toNumber?.() ?? record?.get("nodeCount") ?? 0;
    const relationshipCount = record?.get("relationshipCount")?.toNumber?.() ?? record?.get("relationshipCount") ?? 0;

    this.logger.debug(
      `Graph projected: ${nodeCount} nodes, ${relationshipCount} relationships`,
      "CommunityDetectorService",
    );
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

    const affectedCommunityIds = new Set<string>();

    for (const keyConceptId of orphanKeyConceptIds) {
      // Find communities with related KeyConcepts
      const relatedCommunities = await this.communityRepository.findCommunitiesByRelatedKeyConcepts(keyConceptId);

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

    // Generate summaries for affected communities
    if (affectedCommunityIds.size > 0) {
      this.logger.log(
        `Assigned KeyConcepts to ${affectedCommunityIds.size} communities, generating summaries`,
        "CommunityDetectorService",
      );

      for (const communityId of affectedCommunityIds) {
        const community = await this.communityRepository.findById(communityId);
        if (community) {
          await this.summariserService.generateSummary(community);
        }
      }
    }
  }
}
