import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { updateRelationshipQuery } from "../../../core";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { Company, CompanyDescriptor } from "../../company/entities/company";
import { featureMeta } from "../../feature/entities/feature.meta";
import { moduleMeta } from "../../module";
import { companyMeta } from "../entities/company.meta";

@Injectable()
export class CompanyRepository implements OnModuleInit {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly clsService: ClsService,
  ) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT company_id IF NOT EXISTS FOR (company:Company) REQUIRE company.id IS UNIQUE`,
    });
  }

  async fetchAll(): Promise<Company[]> {
    const query = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model });

    query.query = `
      MATCH (company:Company)
      RETURN company
    `;

    return this.neo4j.readMany(query);
  }

  async findByCompanyId(params: { companyId: string }): Promise<Company> {
    const query = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model });

    query.queryParams = {
      companyId: params.companyId,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      OPTIONAL MATCH (company)-[:HAS_FEATURE]->(company_feature:Feature)
      OPTIONAL MATCH (company)-[:HAS_MODULE]->(company_module:Module)
      RETURN company, company_feature, company_module
    `;

    return this.neo4j.readOne(query);
  }

  async findCurrent(companyId?: string): Promise<Company> {
    const query = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model });

    if (companyId) query.queryParams.companyId = companyId;

    query.query += `
      WHERE company.id = $companyId
      RETURN company
    `;

    return this.neo4j.readOne(query);
  }

  async findSingle(): Promise<Company> {
    const query = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model });

    query.queryParams = {};

    query.query = `
      MATCH (company:Company)
      RETURN company
    `;

    return this.neo4j.readOne(query);
  }

  // async createCompanyAgents(params: { companyId: string }): Promise<void> {
  // await this.neo4j.writeOne({
  //   query: `
  //       MATCH (c:Company { id: $companyId })
  //       WITH c,
  //         substring(c.id, 0, size(c.id) - 12) AS prefix,
  //         apoc.text.lpad(toString(toInteger($id)), 12, '0') AS suffix
  //       WITH c, prefix + suffix AS userId
  //       MERGE (u:User {id: userId})
  //       ON CREATE SET
  //         u.name       = $name,
  //         u.isActive   = true,
  //         u.isDeleted  = false,
  //         u.avatar     = $avatar,
  //         u.createdAt  = datetime(),
  //         u.updatedAt  = datetime()
  //       MERGE (u)-[:BELONGS_TO]->(c)
  //       WITH u
  //       MATCH (r:Role)
  //       WHERE r.id IN $roles
  //       MERGE (u)-[:MEMBER_OF]->(r)
  //     `,
  //   queryParams: {
  //     companyId: params.companyId,
  //     id: 1,
  //     name: "Support Operator",
  //     avatar: "~/images/support_operator.webp",
  //     roles: [RoleId.SupportAgent],
  //   },
  // });
  // }

  async create(params: {
    companyId: string;
    name: string;
    configurations?: string;
    monthlyTokens?: number;
    availableMonthlyTokens?: number;
    availableExtraTokens?: number;
    featureIds?: string[];
    moduleIds?: string[];
  }): Promise<Company> {
    const query = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model });

    await this.neo4j.validateExistingNodes({
      nodes: [
        ...(params.featureIds && params.featureIds.length > 0
          ? params.featureIds.map((id) => ({ id: id, label: featureMeta.labelName }))
          : []),
        ...(params.moduleIds && params.moduleIds.length > 0
          ? params.moduleIds.map((id) => ({ id: id, label: moduleMeta.labelName }))
          : []),
      ].filter(Boolean),
    });

    query.queryParams = {
      companyId: params.companyId,
      name: params.name,
      configurations: params.configurations ?? "",
      monthlyTokens: params.monthlyTokens ?? 0,
      availableMonthlyTokens: params.availableMonthlyTokens ?? 0,
      availableExtraTokens: params.availableExtraTokens ?? 0,
      featureIds: params.featureIds ?? [],
      moduleIds: params.moduleIds ?? [],
    };

    query.query = `
      CREATE (company:Company {id: $companyId})
      SET company.name=$name,
        company.configurations=$configurations,
        company.monthlyTokens=$monthlyTokens,
        company.availableMonthlyTokens=$availableMonthlyTokens,
        company.availableExtraTokens=$availableExtraTokens,
        company.createdAt=datetime(),
        company.updatedAt=datetime()
    `;

    const relationships = [
      {
        relationshipName: "HAS_FEATURE",
        param: "featureIds",
        label: featureMeta.labelName,
        relationshipToNode: true,
      },
      {
        relationshipName: "HAS_MODULE",
        param: "moduleIds",
        label: moduleMeta.labelName,
        relationshipToNode: true,
      },
    ];

    relationships.forEach(({ relationshipName, param, label, relationshipToNode }) => {
      query.query += updateRelationshipQuery({
        node: companyMeta.nodeName,
        relationshipName: relationshipName,
        relationshipToNode: relationshipToNode,
        label: label,
        param: param,
        values: params[param],
      });
    });

    query.query += `
      RETURN company
    `;

    return this.neo4j.writeOne(query);
  }

  async update(params: {
    companyId: string;
    name: string;
    configurations?: string;
    logo?: string;
    monthlyTokens?: number;
    availableMonthlyTokens?: number;
    availableExtraTokens?: number;
    featureIds?: string[];
    moduleIds?: string[];
  }): Promise<void> {
    const query = this.neo4j.initQuery();

    await this.neo4j.validateExistingNodes({
      nodes: [
        ...(params.featureIds && params.featureIds.length > 0
          ? params.featureIds.map((id) => ({ id: id, label: featureMeta.labelName }))
          : []),
        ...(params.moduleIds && params.moduleIds.length > 0
          ? params.moduleIds.map((id) => ({ id: id, label: moduleMeta.labelName }))
          : []),
      ].filter(Boolean),
    });

    const updateParams: string[] = [];
    updateParams.push("company.name = $name");
    updateParams.push("company.configurations = $configurations");
    if (params.logo !== undefined) updateParams.push("company.logo = $logo");
    if (params.monthlyTokens !== undefined) updateParams.push("company.monthlyTokens = $monthlyTokens");
    if (params.availableMonthlyTokens !== undefined)
      updateParams.push("company.availableMonthlyTokens = $availableMonthlyTokens");
    if (params.availableExtraTokens !== undefined)
      updateParams.push("company.availableExtraTokens = $availableExtraTokens");
    updateParams.push("company.updatedAt = datetime()");
    const update = updateParams.join(", ");

    query.queryParams = {
      companyId: params.companyId,
      name: params.name,
      configurations: params.configurations ?? "",
      logo: params.logo ?? "",
      monthlyTokens: params.monthlyTokens ?? 0,
      availableMonthlyTokens: params.availableMonthlyTokens ?? 0,
      availableExtraTokens: params.availableExtraTokens ?? 0,
      featureIds: params.featureIds ?? [],
      moduleIds: params.moduleIds ?? [],
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      SET ${update}
      WITH company
    `;

    const relationships = [
      {
        relationshipName: "HAS_FEATURE",
        param: "featureIds",
        label: featureMeta.labelName,
        relationshipToNode: true,
      },
      {
        relationshipName: "HAS_MODULE",
        param: "moduleIds",
        label: moduleMeta.labelName,
        relationshipToNode: true,
      },
    ];

    relationships.forEach(({ relationshipName, param, label, relationshipToNode }) => {
      query.query += updateRelationshipQuery({
        node: companyMeta.nodeName,
        relationshipName: relationshipName,
        relationshipToNode: relationshipToNode,
        label: label,
        param: param,
        values: params[param],
      });
    });

    await this.neo4j.writeOne(query);
  }

  async updateConfigurations(params: { companyId: string; configurations: string }): Promise<void> {
    const updateParams: string[] = [];
    updateParams.push("company.configurations = $configurations");
    updateParams.push("company.updatedAt = datetime()");
    const update = updateParams.join(", ");

    const query = this.neo4j.initQuery();

    query.queryParams = {
      companyId: params.companyId,
      configurations: params.configurations ?? "",
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      SET ${update}
    `;

    await this.neo4j.writeOne(query);
  }

  async createByName(params: { name: string }): Promise<Company> {
    const query = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model });

    query.queryParams = {
      companyId: randomUUID(),
      name: params.name,
      configurations: "",
    };

    query.query = `
      CREATE (company:Company {
        id: $companyId, 
        name: $name, 
        configurations: $configurations,
        createdAt: datetime(), 
        updatedAt: datetime()
      }) RETURN company
    `;

    const response = await this.neo4j.writeOne(query);
    // await this.createCompanyAgents({ companyId: response.id });
    return response;
  }

  async useTokens(params: { input: number; output: number; companyId?: string }): Promise<void> {
    const tokens = params.input + params.output;

    const companyQuery = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model });
    companyQuery.queryParams = {
      companyId: params.companyId ?? this.clsService.get("companyId"),
    };
    companyQuery.query = `MATCH (company:Company {id: $companyId}) RETURN company`;
    const company: Company = await this.neo4j.readOne(companyQuery);

    // Convert BigInt values from Neo4j to numbers for arithmetic operations
    const availableMonthlyTokens = Number(company.availableMonthlyTokens ?? 0);
    const availableExtraTokens = Number(company.availableExtraTokens ?? 0);

    const query = this.neo4j.initQuery();
    query.queryParams = {
      companyId: params.companyId ?? this.clsService.get("companyId"),
    };

    if (availableMonthlyTokens >= tokens) {
      query.queryParams.availableMonthlyTokens = availableMonthlyTokens - tokens;

      query.query = `
      MATCH (company:Company {id: $companyId})
      SET company.availableMonthlyTokens = $availableMonthlyTokens,
          company.updatedAt = datetime()
    `;
    } else if (availableMonthlyTokens > 0) {
      const remainingTokens = tokens - availableMonthlyTokens;
      query.queryParams.availableMonthlyTokens = 0;
      query.queryParams.availableExtraTokens = availableExtraTokens - remainingTokens;

      query.query = `
      MATCH (company:Company {id: $companyId})
      SET company.availableMonthlyTokens = $availableMonthlyTokens,
          company.availableExtraTokens = $availableExtraTokens,
          company.updatedAt = datetime()
    `;
    }

    await this.neo4j.writeOne(query);
  }

  async markSubscriptionStatus(params: { companyId: string; isActiveSubscription: boolean }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      companyId: params.companyId,
      isActiveSubscription: params.isActiveSubscription,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      SET company.isActiveSubscription = $isActiveSubscription,
          company.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Update company token allocation fields
   *
   * Used by TokenAllocationService to reset tokens on subscription payment
   * or pro-rate tokens on plan changes.
   *
   * @param params - Update parameters
   * @param params.companyId - Company identifier
   * @param params.monthlyTokens - Optional new monthly token allocation
   * @param params.availableMonthlyTokens - Optional new available monthly tokens
   * @param params.availableExtraTokens - Optional new available extra tokens
   */
  async updateTokens(params: {
    companyId: string;
    monthlyTokens?: number;
    availableMonthlyTokens?: number;
    availableExtraTokens?: number;
  }): Promise<void> {
    const setParams: string[] = [];
    setParams.push("company.updatedAt = datetime()");

    if (params.monthlyTokens !== undefined) {
      setParams.push("company.monthlyTokens = $monthlyTokens");
    }
    if (params.availableMonthlyTokens !== undefined) {
      setParams.push("company.availableMonthlyTokens = $availableMonthlyTokens");
    }
    if (params.availableExtraTokens !== undefined) {
      setParams.push("company.availableExtraTokens = $availableExtraTokens");
    }

    const query = this.neo4j.initQuery();

    query.queryParams = {
      companyId: params.companyId,
      monthlyTokens: params.monthlyTokens,
      availableMonthlyTokens: params.availableMonthlyTokens,
      availableExtraTokens: params.availableExtraTokens,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      SET ${setParams.join(", ")}
    `;

    await this.neo4j.writeOne(query);
  }

  async find(params: { term: string; cursor: JsonApiCursorInterface }): Promise<Company[]> {
    const query = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      term: params.term,
    };

    const whereParams: string[] = [];
    if (params.term) whereParams.push("toLower(company.name) CONTAINS toLower($term)");

    const where = whereParams.length > 0 ? `WHERE ${whereParams.join(" AND ")}` : "";

    query.query = `
      MATCH (company:Company)
      ${where}
      
      WITH company
      {CURSOR}
      
      RETURN company
    `;

    return this.neo4j.readMany(query);
  }

  async delete(params: { companyId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      companyId: params.companyId,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      DETACH DELETE company
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Find company by stripe customer internal ID
   *
   * Follows the BELONGS_TO relationship from StripeCustomer to Company.
   * Used by TokenAllocationService to find company for token allocation.
   *
   * @param params - Query parameters
   * @param params.stripeCustomerId - Internal stripe customer ID (NOT the Stripe cus_ ID)
   * @returns Company if found, null otherwise
   */
  async findByStripeCustomerId(params: { stripeCustomerId: string }): Promise<Company | null> {
    const query = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model });

    query.queryParams = {
      stripeCustomerId: params.stripeCustomerId,
    };

    query.query = `
      MATCH (stripeCustomer:StripeCustomer {id: $stripeCustomerId})-[:BELONGS_TO]->(company:Company)
      OPTIONAL MATCH (company)-[:HAS_FEATURE]->(company_feature:Feature)
      RETURN company, company_feature
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Add features to company (additive - won't remove existing)
   * Uses MERGE to create only relationships that don't exist (idempotent)
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.featureIds - Array of feature IDs to add
   * @returns Array of feature IDs that were actually added
   */
  async addFeatures(params: { companyId: string; featureIds: string[] }): Promise<string[]> {
    if (params.featureIds.length === 0) {
      return [];
    }

    const query = this.neo4j.initQuery();

    query.queryParams = {
      companyId: params.companyId,
      featureIds: params.featureIds,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      WITH company
      UNWIND $featureIds AS featureId
      MATCH (feature:Feature {id: featureId})
      MERGE (company)-[:HAS_FEATURE]->(feature)
      RETURN collect(DISTINCT feature.id) AS addedFeatureIds
    `;

    const result = await this.neo4j.writeOne(query);
    return result?.addedFeatureIds ?? [];
  }

  /**
   * Remove specific features from company
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.featureIds - Array of feature IDs to remove
   * @returns Array of feature IDs that were actually removed
   */
  async removeFeatures(params: { companyId: string; featureIds: string[] }): Promise<string[]> {
    if (params.featureIds.length === 0) {
      return [];
    }

    const query = this.neo4j.initQuery();

    query.queryParams = {
      companyId: params.companyId,
      featureIds: params.featureIds,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})-[rel:HAS_FEATURE]->(feature:Feature)
      WHERE feature.id IN $featureIds
      DELETE rel
      RETURN collect(feature.id) AS removedFeatureIds
    `;

    const result = await this.neo4j.writeOne(query);
    return result?.removedFeatureIds ?? [];
  }

  async countCompanyUsers(params: { companyId: string }): Promise<number> {
    //TODO: Fix this to ensure all the AI agents are removed
    const query = `
        MATCH (company:Company {id: $companyId})<-[:BELONGS_TO]-(user:User)
        // WHERE user.name <> "Support Operator"
        RETURN COUNT(user) AS userCount
      `;

    const queryParams = {
      companyId: params.companyId,
    };

    const result = await this.neo4j.read(query, queryParams);
    return result?.userCount || 0;
  }

  async scheduleCompanyDeletion(params: {
    companyId: string;
    endDate: Date;
    reason: "trial_expired" | "subscription_cancelled";
  }): Promise<void> {
    const { companyId, endDate, reason } = params;
    const scheduledDeletionAt = new Date(endDate);
    scheduledDeletionAt.setDate(scheduledDeletionAt.getDate() + 30);

    const query = this.neo4j.initQuery();
    query.queryParams = {
      companyId,
      subscriptionEndedAt: endDate.toISOString(),
      scheduledDeletionAt: scheduledDeletionAt.toISOString(),
      deactivationReason: reason,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      SET company.subscriptionEndedAt = datetime($subscriptionEndedAt),
          company.scheduledDeletionAt = datetime($scheduledDeletionAt),
          company.deactivationReason = $deactivationReason,
          company.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  async clearDeletionSchedule(params: { companyId: string }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = { companyId: params.companyId };

    query.query = `
      MATCH (company:Company {id: $companyId})
      SET company.subscriptionEndedAt = null,
          company.scheduledDeletionAt = null,
          company.deactivationReason = null,
          company.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  async findCompaniesForDeletion(): Promise<Company[]> {
    const query = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model });

    query.query = `
      MATCH (company:Company)
      WHERE company.scheduledDeletionAt IS NOT NULL
        AND company.scheduledDeletionAt <= datetime()
        AND company.isActiveSubscription = false
      RETURN company
    `;

    return this.neo4j.readMany(query);
  }

  async findCompaniesForDeletionWarning(params: { daysBeforeDeletion: number }): Promise<Company[]> {
    const query = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model });

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + params.daysBeforeDeletion);

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    query.queryParams = {
      startOfDay: startOfDay.toISOString(),
      endOfDay: endOfDay.toISOString(),
    };

    query.query = `
      MATCH (company:Company)
      WHERE company.scheduledDeletionAt IS NOT NULL
        AND company.isActiveSubscription = false
        AND company.scheduledDeletionAt >= datetime($startOfDay)
        AND company.scheduledDeletionAt <= datetime($endOfDay)
      RETURN company
    `;

    return this.neo4j.readMany(query);
  }
}
