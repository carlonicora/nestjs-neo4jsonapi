import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { RoleId } from "../../../common/constants/system.roles";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { companyMeta } from "../../company/entities/company.meta";
import { ModuleModel } from "../../module/entities/module.model";
import { adminModuleQuery, featureModuleQuery } from "../../module/queries/feature.module.query";
import { roleMeta } from "../../role/entities/role.meta";
import { UserDescriptor, User } from "../../user/entities/user";
import { userMeta } from "../../user/entities/user.meta";
import { UserCypherService } from "../../user/services/user.cypher.service";

@Injectable()
export class UserRepository implements OnModuleInit {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly cls: ClsService,
    private readonly userCypherService: UserCypherService,
  ) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT user_id IF NOT EXISTS FOR (user:User) REQUIRE user.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT user_email IF NOT EXISTS FOR (user:User) REQUIRE user.email IS UNIQUE`,
    });
  }

  async makeCompanyAdmin(params: { userId: string }) {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      userId: params.userId,
      roleId: RoleId.CompanyAdministrator,
    };

    query.query = `
      MATCH (role:Role {id: $roleId})
      MATCH (user:User {id: $userId})
      MERGE (user)-[:MEMBER_OF]->(role)
    `;

    await this.neo4j.writeOne(query);
  }

  async findOneForAdmin(params: { userId: string }): Promise<User> {
    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model });

    query.queryParams = {
      userId: params.userId,
    };

    query.query = `
      MATCH (user:User {id: $userId})

      OPTIONAL MATCH (user)-[:MEMBER_OF]->(user_role:Role) 
      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)
      RETURN user, user_role, user_company
    `;

    return this.neo4j.readOne(query);
  }

  async findFullUser(params: { userId: string }): Promise<User> {
    let query = this.neo4j.initQuery({ serialiser: UserDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      searchValue: params.userId,
    };

    query.query += `
      ${this.userCypherService.default({ searchField: "id" })}

      OPTIONAL MATCH (user)-[:MEMBER_OF]->(user_role:Role)
      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)
      OPTIONAL MATCH (user_company)-[:HAS_CONFIGURATION]->(user_company_configuration:Configuration)
      OPTIONAL MATCH (user_company)-[:HAS_FEATURE]->(user_company_feature:Feature)
      RETURN user, user_role, user_company, user_company_feature
    `;

    const user = await this.neo4j.readOne(query);

    const isAdministrator = user.role?.some((r: any) => r.id === RoleId.Administrator);

    query = this.neo4j.initQuery({ serialiser: ModuleModel });
    query.queryParams = {
      companyId: user.company?.id ?? null,
      searchValue: params.userId,
      currentUserId: params.userId,
    };

    let modules: any[] = [];

    if (isAdministrator) {
      query.query = adminModuleQuery;
      try {
        modules = await this.neo4j.readMany(query);
      } catch {
        modules = [];
      }
    } else {
      query.query += `
        ${this.userCypherService.default({ searchField: "id" })}
        ${featureModuleQuery}
      `;
      modules = await this.neo4j.readMany(query);
    }

    user.module = modules;

    return user;
  }

  async findByUserId(params: { userId: string; companyId?: string }): Promise<User> {
    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
    };

    if (params.companyId) query.queryParams.companyId = params.companyId;

    query.query = `
      MATCH (company:Company {id: $companyId})
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company)
      OPTIONAL MATCH (user)-[:MEMBER_OF]->(user_role:Role) 
      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)
      RETURN user, user_role, user_company
    `;

    return this.neo4j.readOne(query);
  }

  async findByEmail(params: { email: string; includeDeleted?: boolean }): Promise<User> {
    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model });

    query.queryParams = {
      email: params.email.toLowerCase(),
    };

    query.query = `
      MATCH (${userMeta.nodeName}:User)
      WHERE toLower(${userMeta.nodeName}.email) = $email
      ${params.includeDeleted ? `` : `AND ${userMeta.nodeName}.isDeleted = false`}
      
      OPTIONAL MATCH (${userMeta.nodeName})-[:MEMBER_OF]->(${userMeta.nodeName}_${roleMeta.nodeName}:${roleMeta.labelName}) 
      OPTIONAL MATCH (${userMeta.nodeName})-[:BELONGS_TO]->(${userMeta.nodeName}_${companyMeta.nodeName}:${companyMeta.labelName})
      RETURN ${userMeta.nodeName}, ${userMeta.nodeName}_${roleMeta.nodeName}, ${userMeta.nodeName}_${companyMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async findByCode(params: { code: string }): Promise<User> {
    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model });

    query.queryParams = {
      code: params.code,
    };

    query.query = `
      MATCH (user:User {code: $code, isDeleted: false}) 
      
      OPTIONAL MATCH (user)-[:MEMBER_OF]->(user_role:Role) 
      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)
      RETURN user, user_role, user_company
    `;

    return this.neo4j.readOne(query);
  }

  async findMany(params: {
    term?: string;
    includeDeleted?: boolean;
    cursor?: JsonApiCursorInterface;
  }): Promise<User[]> {
    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      term: params.term,
    };

    query.query += `
     ${this.userCypherService.default()}
      
      ORDER BY user.name ASC
      {CURSOR}

      OPTIONAL MATCH (user)-[:MEMBER_OF]->(user_role:Role)
      RETURN user, user_role
    `;

    return this.neo4j.readMany(query);
  }

  async findManyByContentIds(params: {
    contentIds: string[];
    term?: string;
    includeDeleted?: boolean;
  }): Promise<User[]> {
    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model, fetchAll: true });

    query.queryParams = {
      ...query.queryParams,
      term: params.term,
      contentIds: params.contentIds,
    };

    query.query += `
     ${this.userCypherService.default()}
     MATCH (${userMeta.nodeName})-[:PUBLISHED|:EDITED]->(content)
     WHERE content.id IN $contentIds
      
      ORDER BY user.name ASC
      {CURSOR}

      ${this.userCypherService.returnStatement()}
    `;

    return this.neo4j.readMany(query);
  }

  async findManyByCompany(params: {
    companyId: string;
    term?: string;
    includeDeleted?: boolean;
    isDeleted?: boolean;
    cursor?: JsonApiCursorInterface;
  }): Promise<User[]> {
    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model, cursor: params.cursor });

    query.queryParams = {
      companyId: params.companyId,
      term: params.term,
      isDeleted: params.isDeleted ?? false,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})<-[:BELONGS_TO]-(user:User)
      ${params.isDeleted ? `WHERE user.isDeleted = $isDeleted` : ``}
      ${params.term ? `${params.isDeleted ? `AND` : `WHERE`} toLower(user.name) CONTAINS toLower($term)` : ``}
      OPTIONAL MATCH (user)-[:MEMBER_OF]->(user_role:Role)
      RETURN user, user_role
    `;

    return this.neo4j.readMany(query);
  }

  async findInRole(params: { roleId: string; term?: string; cursor: JsonApiCursorInterface }): Promise<User[]> {
    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      roleId: params.roleId,
      term: params.term,
    };

    query.query += `
      MATCH (user:User {isDeleted: false})-[:BELONGS_TO]->(company)
      ${params.term ? "WHERE toLower(user.name) CONTAINS toLower($term)" : ""}
      MATCH (user)-[:MEMBER_OF]->(role:Role {id: $roleId})
      
      WITH user
      ORDER BY user.name ASC
      {CURSOR}
      
      OPTIONAL MATCH (user)-[:MEMBER_OF]->(user_role:Role) 
      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)
      RETURN user, user_role, user_company
    `;

    return this.neo4j.readMany(query);
  }

  async findNotInRole(params: { roleId: string; term?: string; cursor: JsonApiCursorInterface }): Promise<User[]> {
    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      roleId: params.roleId,
      term: params.term,
    };

    query.query += `
      MATCH (referenceRole:Role {id: $roleId})
      MATCH (user:User {isDeleted: false})-[:BELONGS_TO]->(company)
      WHERE NOT (user)-[:MEMBER_OF]->(referenceRole)
      ${params.term ? "WHERE toLower(user.name) CONTAINS toLower($term)" : ""}
      
      WITH user
      ORDER BY user.name ASC
      {CURSOR}
      
      OPTIONAL MATCH (user)-[:MEMBER_OF]->(user_role:Role) 
      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)
      RETURN user, user_role, user_company
    `;

    return this.neo4j.readMany(query);
  }

  async create(params: {
    userId: string;
    email: string;
    name: string;
    title?: string;
    bio?: string;
    password: string;
    avatar?: string;
    companyId: string;
    roleIds: string[];
    isActive?: boolean;
    phone?: string;
    termsAcceptedAt?: string;
    marketingConsent?: boolean;
    marketingConsentAt?: string;
  }): Promise<User> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      currentUserId: this.cls.has("userId") ? this.cls.get("userId") : null,
      userId: params.userId,
      email: params.email.toLowerCase(),
      name: params.name,
      title: params.title ?? "",
      bio: params.bio ?? "",
      password: params.password,
      isActive: params.isActive ?? false,
      phone: params.phone ?? "",
      avatar: params.avatar ?? "",
      code: randomUUID(),
      codeExpiration: new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      companyId: params.companyId,
      roleIds: params.roleIds,
      termsAcceptedAt: params.termsAcceptedAt ?? null,
      marketingConsent: params.marketingConsent ?? false,
      marketingConsentAt: params.marketingConsentAt ?? null,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      CREATE (user:User {
        id: $userId,
        email: $email,
        name: $name,
        title: $title,
        bio: $bio,
        password: $password,
        isDeleted: false,
        isActive: $isActive,
        phone: $phone,
        code: $code,
        ${params.avatar ? "avatar: $avatar," : ""}
        ${params.termsAcceptedAt ? "termsAcceptedAt: datetime($termsAcceptedAt)," : ""}
        marketingConsent: $marketingConsent,
        ${params.marketingConsentAt ? "marketingConsentAt: datetime($marketingConsentAt)," : ""}
        codeExpiration: datetime($codeExpiration),
        createdAt: datetime(),
        updatedAt: datetime()
      })-[:BELONGS_TO]->(company)
      ${
        params.roleIds && params.roleIds.length > 0
          ? `
            WITH user, company
            UNWIND $roleIds AS roleId
            MATCH (role:Role {id: roleId})
            CREATE (user)-[:MEMBER_OF]->(role)
          `
          : ""
      }
    `;

    await this.neo4j.writeOne(query);

    return this.findByUserId({ userId: params.userId, companyId: params.companyId });
  }

  async resetCode(params: { userId: string }): Promise<User> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
      code: randomUUID(),
      codeExpiration: new Date(new Date().getTime() + 24 * 60 * 60 * 1000).toISOString(),
    };

    query.query += `
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company)
      SET user.code=$code, user.codeExpiration=datetime($codeExpiration)
    `;

    await this.neo4j.writeOne(query);

    return this.findByUserId({ userId: params.userId });
  }

  async put(params: {
    isAdmin: boolean;
    userId: string;
    email: string;
    name: string;
    title?: string;
    bio?: string;
    password?: string;
    avatar?: string;
    roles?: string[];
    isActive?: boolean;
    phone?: string;
    preserveAvatar?: boolean;
  }): Promise<void> {
    const setClauses = [];
    setClauses.push("user.name = $name");
    setClauses.push("user.email = $email");
    setClauses.push("user.title = $title");
    setClauses.push("user.bio = $bio");
    if (!params.preserveAvatar) setClauses.push("user.avatar = $avatar");
    if (params.password !== undefined && params.password !== "") setClauses.push("user.password = $password");
    if (params.isActive !== undefined) {
      params.isActive = params.isActive ? true : false;
      setClauses.push("user.isActive = $isActive");
    }
    if (params.phone !== undefined) setClauses.push("user.phone = $phone");

    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
      email: params.email.toLowerCase(),
      name: params.name,
      title: params.title ?? null,
      bio: params.bio ?? null,
      password: params.password,
      avatar: params.avatar ?? null,
      roleIds: params.roles,
      isActive: params.isActive,
      phone: params.phone ?? null,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      MATCH (user:User {id: $userId})
      SET ${setClauses.join(", ")}

      ${
        params.isAdmin && params.roles !== undefined
          ? `
            // Delete outdated MEMBER_OF relationships
            WITH user
            OPTIONAL MATCH (user)-[roleRel:MEMBER_OF]->(role:Role)
            WHERE NOT role.id IN $roleIds
            DELETE roleRel

            // Add new MEMBER_OF relationships
            WITH user, $roleIds AS roleIds
            UNWIND roleIds AS roleId
            MATCH (role:Role {id: roleId})
            MERGE (user)-[:MEMBER_OF]->(role)
          `
          : ``
      }
    `;

    await this.neo4j.writeOne(query);
  }

  async updateAvatar(params: { userId: string; avatar?: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
      avatar: params.avatar ?? null,
    };

    query.query = `
      MATCH (user:User {id: $userId})
      SET user.avatar = $avatar, user.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  async reactivate(params: { userId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
    };

    query.query += `
      MATCH (user:User {id: $userId})
      SET user.isDeleted = false
    `;

    await this.neo4j.writeOne(query);
  }

  async patchRate(params: { userId: string; rate: number }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
      rate: params.rate,
    };

    query.query += `
      MATCH (user:User {id: $userId})
      SET user.rate = $rate,
          user.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  async delete(params: { userId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
    };

    query.query = `
      MATCH (company:Company)
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company)
        SET user.isDeleted = true
      `;

    await this.neo4j.writeOne(query);
  }

  async addUserToRole(params: { userId: string; roleId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      roleId: params.roleId,
      userId: params.userId,
    };

    query.query += `
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company)
      MATCH (role:Role {id: $roleId})
      CREATE (user)-[:MEMBER_OF]->(role)
    `;

    await this.neo4j.writeOne(query);
  }

  async removeUserFromRole(params: { roleId: string; userId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      roleId: params.roleId,
      userId: params.userId,
    };

    query.query += `
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company)
      MATCH (role:Role {id: $roleId})
      MATCH (user)-[rel:MEMBER_OF]->(role)
      DELETE rel
    `;

    await this.neo4j.writeOne(query);
  }
}
