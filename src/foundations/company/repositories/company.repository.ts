import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { updateRelationshipQuery } from "../../../core";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Company, CompanyDescriptor } from "../../company/entities/company";
import { featureMeta } from "../../feature/entities/feature.meta";
import { moduleMeta } from "../../module/entities/module.meta";
import { companyMeta } from "../entities/company.meta";

/**
 * Company repository.
 *
 * Extends `AbstractRepository` so a consuming application can subclass it (see
 * `ExtendedCompanyRepository`) and have BOTH the inherited generic methods AND
 * every method declared here resolve the *extended* descriptor. Model resolution
 * is by subclass polymorphism — `this.descriptor` — never by a registry lookup:
 * Nest constructs providers long before `onModuleInit`, where models are
 * registered, so a registry lookup at construction time would yield `undefined`.
 *
 * COMPANY SCOPING — why this repository never calls `buildDefaultMatch()`.
 * Company is the TENANT ROOT (`CompanyDescriptor.isCompanyScoped: false`): there is
 * no parent company to filter by, and `buildDefaultMatch()` would inject a
 * `BELONGS_TO`→Company join onto the Company node itself, which is meaningless.
 * Tenancy is expressed per query instead: company-scoped reads/writes carry an
 * explicit `MATCH (company:Company {id: $companyId})`, while the deliberately
 * cross-tenant queries (platform-admin listings, deletion sweeps) match the label
 * directly BY DESIGN.
 *
 * The one domain method whose name collides with the abstract's generic CRUD
 * (`create`) is named `createCompanyNode` so the inherited descriptor-driven CRUD
 * stays reachable.
 */
@Injectable()
export class CompanyRepository extends AbstractRepository<Company, typeof CompanyDescriptor.relationships> {
  protected readonly descriptor = CompanyDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  // NOTE: onModuleInit() is inherited from AbstractRepository — it creates the
  // same `company_id` uniqueness constraint the old custom implementation did,
  // derived from CompanyDescriptor's auto-generated `constraints`.

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

  /**
   * Create a new company with its defaults and HAS_FEATURE/HAS_MODULE relationships.
   *
   * RENAMED from `create` to `createCompanyNode` (TS2416): the inherited
   * `AbstractRepository.create()` is descriptor-driven and returns `Promise<void>`,
   * so this DTO-independent, domain-specific creator cannot override it. The name
   * mirrors the shipped a360ai reference implementation, which already compiles
   * against the abstracts.
   */
  async createCompanyNode(params: {
    companyId: string;
    name: string;
    configurations?: string;
    monthlyCredits?: number;
    availableMonthlyCredits?: number;
    availableExtraCredits?: number;
    featureIds?: string[];
    moduleIds?: string[];
    legal_address?: string;
    street_number?: string;
    street?: string;
    city?: string;
    province?: string;
    region?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
    fiscal_data?: string;
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

    const createSetParams: string[] = [];
    createSetParams.push("company.name=$name");
    createSetParams.push("company.configurations=$configurations");
    createSetParams.push("company.monthlyCredits=$monthlyCredits");
    createSetParams.push("company.availableMonthlyCredits=$availableMonthlyCredits");
    createSetParams.push("company.availableExtraCredits=$availableExtraCredits");
    if (params.legal_address !== undefined) createSetParams.push("company.legal_address=$legal_address");
    if (params.street_number !== undefined) createSetParams.push("company.street_number=$street_number");
    if (params.street !== undefined) createSetParams.push("company.street=$street");
    if (params.city !== undefined) createSetParams.push("company.city=$city");
    if (params.province !== undefined) createSetParams.push("company.province=$province");
    if (params.region !== undefined) createSetParams.push("company.region=$region");
    if (params.postcode !== undefined) createSetParams.push("company.postcode=$postcode");
    if (params.country !== undefined) createSetParams.push("company.country=$country");
    if (params.country_code !== undefined) createSetParams.push("company.country_code=$country_code");
    if (params.fiscal_data !== undefined) createSetParams.push("company.fiscal_data=$fiscal_data");
    createSetParams.push("company.createdAt=datetime()");
    createSetParams.push("company.updatedAt=datetime()");

    query.queryParams = {
      companyId: params.companyId,
      name: params.name,
      configurations: params.configurations ?? "",
      monthlyCredits: params.monthlyCredits ?? 0,
      availableMonthlyCredits: params.availableMonthlyCredits ?? 0,
      availableExtraCredits: params.availableExtraCredits ?? 0,
      featureIds: params.featureIds ?? [],
      moduleIds: params.moduleIds ?? [],
      ...(params.legal_address !== undefined && { legal_address: params.legal_address }),
      ...(params.street_number !== undefined && { street_number: params.street_number }),
      ...(params.street !== undefined && { street: params.street }),
      ...(params.city !== undefined && { city: params.city }),
      ...(params.province !== undefined && { province: params.province }),
      ...(params.region !== undefined && { region: params.region }),
      ...(params.postcode !== undefined && { postcode: params.postcode }),
      ...(params.country !== undefined && { country: params.country }),
      ...(params.country_code !== undefined && { country_code: params.country_code }),
      ...(params.fiscal_data !== undefined && { fiscal_data: params.fiscal_data }),
    };

    query.query = `
      CREATE (company:Company {id: $companyId})
      SET ${createSetParams.join(",\n        ")}
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
    monthlyCredits?: number;
    availableMonthlyCredits?: number;
    availableExtraCredits?: number;
    featureIds?: string[];
    moduleIds?: string[];
    legal_address?: string;
    street_number?: string;
    street?: string;
    city?: string;
    province?: string;
    region?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
    fiscal_data?: string;
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
    if (params.monthlyCredits !== undefined) updateParams.push("company.monthlyCredits = $monthlyCredits");
    if (params.availableMonthlyCredits !== undefined)
      updateParams.push("company.availableMonthlyCredits = $availableMonthlyCredits");
    if (params.availableExtraCredits !== undefined)
      updateParams.push("company.availableExtraCredits = $availableExtraCredits");
    if (params.legal_address !== undefined) updateParams.push("company.legal_address = $legal_address");
    if (params.street_number !== undefined) updateParams.push("company.street_number = $street_number");
    if (params.street !== undefined) updateParams.push("company.street = $street");
    if (params.city !== undefined) updateParams.push("company.city = $city");
    if (params.province !== undefined) updateParams.push("company.province = $province");
    if (params.region !== undefined) updateParams.push("company.region = $region");
    if (params.postcode !== undefined) updateParams.push("company.postcode = $postcode");
    if (params.country !== undefined) updateParams.push("company.country = $country");
    if (params.country_code !== undefined) updateParams.push("company.country_code = $country_code");
    if (params.fiscal_data !== undefined) updateParams.push("company.fiscal_data = $fiscal_data");
    updateParams.push("company.updatedAt = datetime()");
    const update = updateParams.join(", ");

    query.queryParams = {
      companyId: params.companyId,
      name: params.name,
      configurations: params.configurations ?? "",
      logo: params.logo ?? "",
      monthlyCredits: params.monthlyCredits ?? 0,
      availableMonthlyCredits: params.availableMonthlyCredits ?? 0,
      availableExtraCredits: params.availableExtraCredits ?? 0,
      featureIds: params.featureIds ?? [],
      moduleIds: params.moduleIds ?? [],
      ...(params.legal_address !== undefined && { legal_address: params.legal_address }),
      ...(params.street_number !== undefined && { street_number: params.street_number }),
      ...(params.street !== undefined && { street: params.street }),
      ...(params.city !== undefined && { city: params.city }),
      ...(params.province !== undefined && { province: params.province }),
      ...(params.region !== undefined && { region: params.region }),
      ...(params.postcode !== undefined && { postcode: params.postcode }),
      ...(params.country !== undefined && { country: params.country }),
      ...(params.country_code !== undefined && { country_code: params.country_code }),
      ...(params.fiscal_data !== undefined && { fiscal_data: params.fiscal_data }),
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

    return await this.neo4j.writeOne(query);
  }

  /**
   * Deduct billing credits from a company's balances (monthly allowance first,
   * then the extra top-up balance).
   *
   * @param params - Parameters
   * @param params.credits - Credits to deduct (fractional, 2 decimals)
   * @param params.companyId - Company identifier; defaults to the CLS company
   */
  async useCredits(params: {
    credits: number;
    companyId?: string;
  }): Promise<{ availableMonthlyCredits: number; availableExtraCredits: number } | undefined> {
    if (params.credits <= 0) return undefined;

    const query = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model });
    query.queryParams = {
      companyId: params.companyId ?? this.clsService.get("companyId"),
      credits: params.credits,
    };

    // Single-statement read-and-write: the monthly-then-extra waterfall is computed
    // inside the SET so concurrent deductions cannot lose updates. Balances are
    // 2-dp floats and are deliberately NOT clamped (a mid-operation overrun may go
    // negative; the pre-flight guard blocks the NEXT operation).
    query.query = `
      MATCH (company:Company {id: $companyId})
      WITH company,
           toFloat(coalesce(company.availableMonthlyCredits, 0)) AS m,
           toFloat(coalesce(company.availableExtraCredits, 0)) AS e,
           toFloat($credits) AS c
      SET company.availableMonthlyCredits = CASE WHEN m >= c THEN round(m - c, 2) ELSE 0.0 END,
          company.availableExtraCredits   = CASE WHEN m >= c THEN e
                                                 WHEN m > 0  THEN round(e - (c - m), 2)
                                                 ELSE round(e - c, 2) END,
          company.updatedAt = datetime()
      RETURN company
    `;

    const company: Company = await this.neo4j.writeOne(query);
    if (!company) return undefined;
    return {
      availableMonthlyCredits: Number(company.availableMonthlyCredits ?? 0),
      availableExtraCredits: Number(company.availableExtraCredits ?? 0),
    };
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
   * Update company credit allocation fields
   *
   * Used by TokenAllocationService to reset credits on subscription payment
   * or pro-rate credits on plan changes.
   *
   * @param params - Update parameters
   * @param params.companyId - Company identifier
   * @param params.monthlyCredits - Optional new monthly credit allocation
   * @param params.availableMonthlyCredits - Optional new available monthly credits
   * @param params.availableExtraCredits - Optional new available extra credits
   */
  async updateTokens(params: {
    companyId: string;
    monthlyCredits?: number;
    availableMonthlyCredits?: number;
    availableExtraCredits?: number;
  }): Promise<void> {
    const setParams: string[] = [];
    setParams.push("company.updatedAt = datetime()");

    if (params.monthlyCredits !== undefined) {
      setParams.push("company.monthlyCredits = $monthlyCredits");
    }
    if (params.availableMonthlyCredits !== undefined) {
      setParams.push("company.availableMonthlyCredits = $availableMonthlyCredits");
    }
    if (params.availableExtraCredits !== undefined) {
      setParams.push("company.availableExtraCredits = $availableExtraCredits");
    }

    const query = this.neo4j.initQuery();

    query.queryParams = {
      companyId: params.companyId,
      monthlyCredits: params.monthlyCredits,
      availableMonthlyCredits: params.availableMonthlyCredits,
      availableExtraCredits: params.availableExtraCredits,
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

  /**
   * Delete a company and cascade its Memberships.
   *
   * KEPT under the name `delete` (overriding `AbstractRepository.delete()`) — the
   * Membership cascade below MUST run for every caller, including an application
   * subclass that overrides it. The param was renamed from `companyId` to `id` to
   * match `AbstractRepository.delete()`'s exact `{ id: string }` shape (required to
   * satisfy `extends AbstractRepository`); this mirrors the shipped a360ai
   * reference implementation.
   */
  async delete(params: { id: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      companyId: params.id,
    };

    // SC-3 invariant: an orphaned Membership whose company vanished would read as a
    // PLATFORM membership (privilege escalation), so it must go with the company.
    query.query = `
      MATCH (company:Company {id: $companyId})
      OPTIONAL MATCH (:User)-[:HAS_MEMBERSHIP]->(orphan_ms:Membership)-[:IN_COMPANY]->(company)
      DETACH DELETE orphan_ms

      WITH DISTINCT company
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

  /**
   * Find company by referral code
   *
   * @param params - Query parameters
   * @param params.referralCode - The referral code to search for
   * @returns Company if found, null otherwise
   */
  async findByReferralCode(params: { referralCode: string }): Promise<Company | null> {
    const query = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model });

    query.queryParams = {
      referralCode: params.referralCode,
    };

    query.query = `
      MATCH (company:Company {referralCode: $referralCode})
      RETURN company
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Set referral code for a company
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.referralCode - The referral code to set
   */
  async setReferralCode(params: { companyId: string; referralCode: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      companyId: params.companyId,
      referralCode: params.referralCode,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      SET company.referralCode = $referralCode,
          company.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Add extra credits to a company (increments availableExtraCredits)
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.credits - Number of credits to add
   */
  async addExtraCredits(params: { companyId: string; credits: number }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      companyId: params.companyId,
      credits: params.credits,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      SET company.availableExtraCredits = round(COALESCE(company.availableExtraCredits, 0) + $credits, 2),
          company.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }
}
