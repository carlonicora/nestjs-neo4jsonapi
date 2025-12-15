import { Injectable } from "@nestjs/common";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { CommunityRepository } from "../../../foundations/community/repositories/community.repository";

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
  // Louvain resolutions for hierarchical detection (higher = more granular communities)
  private readonly louvainResolutions = [1.0, 0.5, 0.25];
  private readonly minCommunitySize = 3;

  constructor(
    private readonly neo4j: Neo4jService,
    private readonly logger: AppLoggingService,
    private readonly communityRepository: CommunityRepository,
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
    query.query += `
      CALL gds.graph.project.cypher(
        $graphName,
        'MATCH (kc:KeyConcept)<-[:HAS_KEY_CONCEPT]-()-[:HAS_CHUNK]->()-[:HAS_CHUNK|BELONGS_TO*1..2]->(company:Company)
         WHERE company.id = $companyId
         RETURN DISTINCT id(kc) AS id',
        'MATCH (kc1:KeyConcept)<-[:RELATES_TO]-(rel:KeyConceptRelationship)-[:RELATES_TO]->(kc2:KeyConcept)
         MATCH (rel)-[:BELONGS_TO]->(company:Company {id: $companyId})
         RETURN id(kc1) AS source, id(kc2) AS target, rel.weight AS weight',
        { parameters: { companyId: $companyId } }
      )
      YIELD graphName, nodeCount, relationshipCount
      RETURN graphName, nodeCount, relationshipCount
    `;

    query.queryParams = { ...query.queryParams, graphName };

    const result = await this.neo4j.readOne(query);

    this.logger.debug(
      `Graph projected: ${result?.nodeCount || 0} nodes, ${result?.relationshipCount || 0} relationships`,
      "CommunityDetectorService",
    );
  }

  /**
   * Run Louvain community detection algorithm
   */
  private async runLouvain(graphName: string, resolution: number): Promise<Map<string, number>> {
    const query = this.neo4j.initQuery();

    query.query += `
      CALL gds.louvain.stream($graphName, {
        relationshipWeightProperty: 'weight',
        includeIntermediateCommunities: false,
        resolution: $resolution
      })
      YIELD nodeId, communityId
      WITH gds.util.asNode(nodeId) AS node, communityId
      RETURN node.id AS keyConceptId, communityId
    `;

    query.queryParams = { ...query.queryParams, graphName, resolution };

    const results = await this.neo4j.readMany(query);

    const communityAssignments = new Map<string, number>();
    for (const row of results as any[]) {
      communityAssignments.set(row.keyConceptId, row.communityId);
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
}
