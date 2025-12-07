import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { Company } from "../../company/entities/company.entity";
import { CompanyModel } from "../../company/entities/company.model";

@Injectable()
export class CompanyRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT company_id IF NOT EXISTS FOR (company:Company) REQUIRE company.id IS UNIQUE`,
    });
  }

  async fetchAll(): Promise<Company[]> {
    const query = this.neo4j.initQuery({ serialiser: CompanyModel });

    query.query = `
      MATCH (company:Company)
      RETURN company
    `;

    return this.neo4j.readMany(query);
  }

  async findByCompanyId(params: { companyId: string }): Promise<Company> {
    const query = this.neo4j.initQuery({ serialiser: CompanyModel });

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
    const query = this.neo4j.initQuery({ serialiser: CompanyModel });

    if (companyId) query.queryParams.companyId = companyId;

    query.query += `
      WHERE company.id = $companyId
      RETURN company
    `;

    return this.neo4j.readOne(query);
  }

  async findSingle(): Promise<Company> {
    const query = this.neo4j.initQuery({ serialiser: CompanyModel });

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
    availableTokens?: number;
    featureIds?: string[];
    moduleIds?: string[];
  }): Promise<Company> {
    const query = this.neo4j.initQuery({ serialiser: CompanyModel });

    query.queryParams = {
      companyId: params.companyId,
      name: params.name,
      configurations: params.configurations ?? "",
      availableTokens: params.availableTokens ?? 0,
      featureIds: params.featureIds ?? [],
      moduleIds: params.moduleIds ?? [],
    };

    query.query = `
      CREATE (company:Company {id: $companyId})
      SET company.name=$name,
        company.configurations=$configurations,
        company.availableTokens=$availableTokens,
        company.createdAt=datetime(),
        company.updatedAt=datetime()
      FOREACH (featureId IN $featureIds |
        MERGE (feature:Feature {id: featureId})
        MERGE (company)-[:HAS_FEATURE]->(feature)
      )
      FOREACH (moduleId IN $moduleIds |
        MERGE (module:Module {id: moduleId})
        MERGE (company)-[:HAS_MODULE]->(module)
      )
      RETURN company
    `;

    const response = await this.neo4j.writeOne(query);
    // await this.createCompanyAgents({ companyId: params.companyId });
    return response;
  }

  async update(params: {
    companyId: string;
    name: string;
    configurations?: string;
    logo?: string;
    availableTokens?: number;
    featureIds?: string[];
    moduleIds?: string[];
  }): Promise<void> {
    const featureQuery =
      params.featureIds && params.featureIds.length > 0
        ? `
      WITH company
      OPTIONAL MATCH (company)-[r:HAS_FEATURE]->()
      DELETE r
      WITH company
      UNWIND $featureIds AS featureId
      MERGE (feature:Feature {id: featureId})
      MERGE (company)-[:HAS_FEATURE]->(feature)
      `
        : ``;

    const moduleQuery =
      params.moduleIds && params.moduleIds.length > 0
        ? `
      WITH company
      OPTIONAL MATCH (company)-[r:HAS_MODULE]->()
      DELETE r
      WITH company
      UNWIND $moduleIds AS moduleId
      MERGE (module:Module {id: moduleId})
      MERGE (company)-[:HAS_MODULE]->(module)
      `
        : ``;

    const updateParams: string[] = [];
    updateParams.push("company.name = $name");
    updateParams.push("company.configurations = $configurations");
    if (params.logo !== undefined) updateParams.push("company.logo = $logo");
    if (params.availableTokens !== undefined) updateParams.push("company.availableTokens = $availableTokens");
    updateParams.push("company.updatedAt = datetime()");
    const update = updateParams.join(", ");

    const query = this.neo4j.initQuery();

    query.queryParams = {
      companyId: params.companyId,
      name: params.name,
      configurations: params.configurations ?? "",
      logo: params.logo ?? "",
      availableTokens: params.availableTokens ?? 0,
      featureIds: params.featureIds ?? [],
      moduleIds: params.moduleIds ?? [],
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      SET ${update}
      ${featureQuery}
      ${moduleQuery}
    `;

    await this.neo4j.writeOne(query);
  }

  async createByName(params: { name: string }): Promise<Company> {
    const query = this.neo4j.initQuery({ serialiser: CompanyModel });

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

    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      usedTokens: tokens,
    };

    if (params.companyId) query.queryParams.companyId = params.companyId;

    query.query += `
      SET company.availableTokens = company.availableTokens - $usedTokens
    `;

    await this.neo4j.writeOne(query);
  }

  async find(params: { term: string; cursor: JsonApiCursorInterface }): Promise<Company[]> {
    const query = this.neo4j.initQuery({ serialiser: CompanyModel, cursor: params.cursor });

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

  async updateLicense(params: {
    companyId: string;
    license: string;
    licenseExpirationDate: string;
    licenseLastValidation: string;
  }): Promise<void> {
    const query = this.neo4j.initQuery({});

    query.queryParams = {
      companyId: params.companyId,
      license: params.license,
      licenseExpirationDate: params.licenseExpirationDate,
      licenseLastValidation: params.licenseLastValidation,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      SET company.license = $license,
          company.licenseExpirationDate = datetime($licenseExpirationDate),
          company.licenseLastValidation = datetime($licenseLastValidation)
    `;

    await this.neo4j.writeOne(query);
  }
}
