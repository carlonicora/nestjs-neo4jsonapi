import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { RoleId } from "../../../common/constants/system.roles";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { companyMeta } from "../../company/entities/company.meta";
import { featureMeta } from "../../feature/entities/feature.meta";
import {
  grantCompanyRoles,
  grantPlatformRole,
  membershipRoleMatch,
  membershipRoleMatchRequired,
} from "../../membership/queries/membership.query";
import { ModuleModel } from "../../module/entities/module.model";
import { adminModuleQuery, featureModuleQuery } from "../../module/queries/feature.module.query";
import { roleMeta } from "../../role/entities/role.meta";
import { User, UserDescriptor } from "../../user/entities/user";
import { userMeta } from "../../user/entities/user.meta";
import { UserCypherService } from "../../user/services/user.cypher.service";

/**
 * User repository.
 *
 * Extends `AbstractRepository` so an application can subclass it (see
 * `ExtendedUserRepository` in a consuming app) and have BOTH the inherited
 * generic methods AND every method declared here resolve the *extended*
 * descriptor. Model resolution is by subclass polymorphism — `this.descriptor`
 * — never by a registry lookup: Nest constructs providers long before
 * `onModuleInit`, where models are registered, so a registry lookup at
 * construction time would yield `undefined`.
 *
 * The three domain methods whose names collide with the abstract's generic
 * CRUD (`create` / `put` / `delete`) are named `createUser` / `putUser` /
 * `deleteUser` so the inherited descriptor-driven CRUD stays reachable.
 */
@Injectable()
export class UserRepository extends AbstractRepository<User, typeof UserDescriptor.relationships> {
  protected readonly descriptor = UserDescriptor;

  constructor(
    neo4j: Neo4jService,
    securityService: SecurityService,
    clsService: ClsService,
    protected readonly userCypherService: UserCypherService,
  ) {
    super(neo4j, securityService, clsService);
  }

  /**
   * `AbstractRepository.onModuleInit` creates the constraints and indexes
   * declared by the descriptor. `defineEntity` only ever emits the `id` UNIQUE
   * constraint, so the User-specific `email` UNIQUE constraint is added here.
   * The fulltext index is created by the parent from `descriptor.indexes`
   * (`stringFields`), which excludes `password` and `code` — both carry
   * `excludeFromSearch: true`.
   */
  async onModuleInit() {
    await super.onModuleInit();

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT user_email IF NOT EXISTS FOR (user:User) REQUIRE user.email IS UNIQUE`,
    });
  }

  async makeCompanyAdmin(params: { userId: string; companyId: string }) {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      userId: params.userId,
      companyId: params.companyId,
      membershipId: randomUUID(),
      roleIds: [RoleId.CompanyAdministrator],
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      MATCH (user:User {id: $userId})
      ${grantCompanyRoles({ userAlias: "user", companyAlias: "company" })}
    `;

    await this.neo4j.writeOne(query);
  }

  async findOneForAdmin(params: { userId: string }): Promise<User> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      userId: params.userId,
    };

    query.query = `
      MATCH (user:User {id: $userId})

      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)
      // membershipRoleMatch bound to the matched company alias: this query has no
      // $companyId param (it is not CLS-scoped). See membership.query.ts.
      OPTIONAL MATCH (user)-[:HAS_MEMBERSHIP]->(user_role_ms:Membership)
      WHERE (user_role_ms)-[:IN_COMPANY]->(user_company)
         OR NOT (user_role_ms)-[:IN_COMPANY]->(:Company)
      OPTIONAL MATCH (user_role_ms)-[:HAS_ROLE]->(user_role:Role)
      RETURN user, user_role, user_company
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Find user for 2FA login completion.
   * Does NOT require companyId in CLS - finds company through user relationship.
   * Returns user with roles, company, and features needed for token creation.
   */
  async findForTwoFactorLogin(params: { userId: string }): Promise<User> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      userId: params.userId,
    };

    query.query = `
      MATCH (${userMeta.nodeName}:User {id: $userId})

      OPTIONAL MATCH (${userMeta.nodeName})-[:BELONGS_TO]->(${userMeta.nodeName}_${companyMeta.nodeName}:${companyMeta.labelName})
      // membershipRoleMatch bound to the matched company alias: this query deliberately
      // does not depend on CLS/$companyId. See membership.query.ts.
      OPTIONAL MATCH (${userMeta.nodeName})-[:HAS_MEMBERSHIP]->(${userMeta.nodeName}_${roleMeta.nodeName}_ms:Membership)
      WHERE (${userMeta.nodeName}_${roleMeta.nodeName}_ms)-[:IN_COMPANY]->(${userMeta.nodeName}_${companyMeta.nodeName})
         OR NOT (${userMeta.nodeName}_${roleMeta.nodeName}_ms)-[:IN_COMPANY]->(:${companyMeta.labelName})
      OPTIONAL MATCH (${userMeta.nodeName}_${roleMeta.nodeName}_ms)-[:HAS_ROLE]->(${userMeta.nodeName}_${roleMeta.nodeName}:${roleMeta.labelName})

      OPTIONAL MATCH (${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}:${featureMeta.labelName})
      WHERE ${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}.isCore = true
      OR EXISTS {((${userMeta.nodeName}_${companyMeta.nodeName})-[:HAS_FEATURE]->(${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}))}

      RETURN ${userMeta.nodeName},
        ${userMeta.nodeName}_${roleMeta.nodeName},
        ${userMeta.nodeName}_${companyMeta.nodeName},
        ${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async findFullUser(params: { userId: string }): Promise<User> {
    let query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      ...query.queryParams,
      searchValue: params.userId,
    };

    query.query += `
      ${this.userCypherService.default({ searchField: "id" })}

      ${membershipRoleMatch({ userAlias: "user", roleAlias: "user_role" })}
      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)
      OPTIONAL MATCH (user_company)-[:HAS_CONFIGURATION]->(user_company_configuration:Configuration)
      MATCH (${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}:${featureMeta.labelName})
      WHERE ${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}.isCore = true 
      OR EXISTS {((${userMeta.nodeName}_${companyMeta.nodeName})-[:HAS_FEATURE]->(${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}))}
      
      RETURN user, user_role, user_company, ${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}
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
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
    };

    if (params.companyId) query.queryParams.companyId = params.companyId;

    query.query = `
      MATCH (company:Company {id: $companyId})
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company)
      ${membershipRoleMatch({ userAlias: "user", roleAlias: "user_role" })}
      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)

      MATCH (${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}:${featureMeta.labelName})
      WHERE ${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}.isCore = true 
      OR EXISTS {((${userMeta.nodeName}_${companyMeta.nodeName})-[:HAS_FEATURE]->(${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}))}

      RETURN user, user_role, user_company, ${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async findByEmail(params: { email: string; includeDeleted?: boolean }): Promise<User> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      email: params.email.toLowerCase(),
    };

    query.query = `
      MATCH (${userMeta.nodeName}:User)
      WHERE toLower(${userMeta.nodeName}.email) = $email
      ${params.includeDeleted ? `` : `AND ${userMeta.nodeName}.isDeleted = false`}
      
      OPTIONAL MATCH (${userMeta.nodeName})-[:BELONGS_TO]->(${userMeta.nodeName}_${companyMeta.nodeName}:${companyMeta.labelName})
      // membershipRoleMatch bound to the matched company alias: the login/lookup path
      // has no $companyId param. See membership.query.ts.
      OPTIONAL MATCH (${userMeta.nodeName})-[:HAS_MEMBERSHIP]->(${userMeta.nodeName}_${roleMeta.nodeName}_ms:Membership)
      WHERE (${userMeta.nodeName}_${roleMeta.nodeName}_ms)-[:IN_COMPANY]->(${userMeta.nodeName}_${companyMeta.nodeName})
         OR NOT (${userMeta.nodeName}_${roleMeta.nodeName}_ms)-[:IN_COMPANY]->(:${companyMeta.labelName})
      OPTIONAL MATCH (${userMeta.nodeName}_${roleMeta.nodeName}_ms)-[:HAS_ROLE]->(${userMeta.nodeName}_${roleMeta.nodeName}:${roleMeta.labelName})

      MATCH (${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}:${featureMeta.labelName})
      WHERE ${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}.isCore = true 
      OR EXISTS {((${userMeta.nodeName}_${companyMeta.nodeName})-[:HAS_FEATURE]->(${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}))}
      RETURN ${userMeta.nodeName}, 
        ${userMeta.nodeName}_${roleMeta.nodeName}, 
        ${userMeta.nodeName}_${companyMeta.nodeName}, 
        ${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async findByCode(params: { code: string }): Promise<User> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      code: params.code,
    };

    query.query = `
      MATCH (user:User {code: $code, isDeleted: false})

      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)
      // membershipRoleMatch bound to the matched company alias: the activation-code
      // lookup has no $companyId param. See membership.query.ts.
      OPTIONAL MATCH (user)-[:HAS_MEMBERSHIP]->(user_role_ms:Membership)
      WHERE (user_role_ms)-[:IN_COMPANY]->(user_company)
         OR NOT (user_role_ms)-[:IN_COMPANY]->(:Company)
      OPTIONAL MATCH (user_role_ms)-[:HAS_ROLE]->(user_role:Role)
      RETURN user, user_role, user_company
    `;

    return this.neo4j.readOne(query);
  }

  async findMany(params: {
    term?: string;
    includeDeleted?: boolean;
    cursor?: JsonApiCursorInterface;
  }): Promise<User[]> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      term: params.term ? `*${params.term.toLowerCase()}*` : undefined,
    };

    if (params.term && this.descriptor.fulltextIndexName) {
      query.query += `CALL db.index.fulltext.queryNodes("${this.descriptor.fulltextIndexName}", $term)
      YIELD node, score
      WHERE (node)-[:BELONGS_TO]->(company)

      WITH node as ${userMeta.nodeName}, score
      ORDER BY score DESC
    `;
    } else {
      query.query += `
      ${this.userCypherService.default()}

      ORDER BY ${userMeta.nodeName}.name ASC
    `;
    }

    query.query += `
      {CURSOR}

      // The company is what makes the platform-wide list readable: an
      // administrator browsing every user needs to see which company each one
      // belongs to. OPTIONAL, because a system administrator belongs to none.
      OPTIONAL MATCH (${userMeta.nodeName})-[:BELONGS_TO]->(${userMeta.nodeName}_${companyMeta.nodeName}:${companyMeta.labelName})
      ${membershipRoleMatch({ userAlias: userMeta.nodeName, roleAlias: `${userMeta.nodeName}_role` })}
      RETURN ${userMeta.nodeName}, ${userMeta.nodeName}_role, ${userMeta.nodeName}_${companyMeta.nodeName}
    `;

    return this.neo4j.readMany(query);
  }

  async findManyByContentIds(params: {
    contentIds: string[];
    term?: string;
    includeDeleted?: boolean;
  }): Promise<User[]> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model, fetchAll: true });

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
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model, cursor: params.cursor });

    query.queryParams = {
      companyId: params.companyId,
      term: params.term,
      isDeleted: params.isDeleted ?? false,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})<-[:BELONGS_TO]-(user:User)
      ${params.isDeleted ? `WHERE user.isDeleted = $isDeleted` : ``}
      ${params.term ? `${params.isDeleted ? `AND` : `WHERE`} toLower(user.name) CONTAINS toLower($term)` : ``}
      ${membershipRoleMatch({ userAlias: "user", roleAlias: "user_role" })}
      RETURN user, user_role
    `;

    return this.neo4j.readMany(query);
  }

  async findInRole(params: { roleId: string; term?: string; cursor: JsonApiCursorInterface }): Promise<User[]> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      roleId: params.roleId,
      term: params.term,
    };

    query.query += `
      MATCH (user:User {isDeleted: false})-[:BELONGS_TO]->(company)
      ${params.term ? "WHERE toLower(user.name) CONTAINS toLower($term)" : ""}
      ${membershipRoleMatchRequired({ userAlias: "user", roleAlias: "role" })}

      WITH DISTINCT user
      ORDER BY user.name ASC
      {CURSOR}

      ${membershipRoleMatch({ userAlias: "user", roleAlias: "user_role" })}
      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)
      RETURN user, user_role, user_company
    `;

    return this.neo4j.readMany(query);
  }

  async findNotInRole(params: { roleId: string; term?: string; cursor: JsonApiCursorInterface }): Promise<User[]> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      roleId: params.roleId,
      term: params.term,
    };

    query.query += `
      MATCH (referenceRole:Role {id: $roleId})
      MATCH (user:User {isDeleted: false})-[:BELONGS_TO]->(company)
      WHERE NOT EXISTS {
        MATCH (user)-[:HAS_MEMBERSHIP]->(nr_ms:Membership)-[:HAS_ROLE]->(referenceRole)
        WHERE (nr_ms)-[:IN_COMPANY]->(:Company {id: $companyId})
           OR NOT (nr_ms)-[:IN_COMPANY]->(:Company)
      }
      ${params.term ? "AND toLower(user.name) CONTAINS toLower($term)" : ""}

      WITH DISTINCT user
      ORDER BY user.name ASC
      {CURSOR}

      ${membershipRoleMatch({ userAlias: "user", roleAlias: "user_role" })}
      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)
      RETURN user, user_role, user_company
    `;

    return this.neo4j.readMany(query);
  }

  async createUser(params: {
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
      currentUserId: this.clsService.has("userId") ? this.clsService.get("userId") : null,
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
      roleIds: params.roleIds ?? [],
      membershipId: randomUUID(),
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

      // Always create the (user, company) Membership — the BELONGS_TO ⇄ Membership
      // invariant holds even when the user starts with no roles.
      WITH user, company
      ${grantCompanyRoles({ userAlias: "user", companyAlias: "company" })}
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

  async putUser(params: {
    isAdmin: boolean;
    userId: string;
    email: string;
    name?: string;
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
    // `name` is optional on the PUT DTO: an omitted name must leave the stored
    // name untouched, never overwrite it with null.
    if (params.name !== undefined) setClauses.push("user.name = $name");
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
      roleIds: params.roles ?? [],
      membershipId: randomUUID(),
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
            // Drop the roles this user no longer holds IN THIS COMPANY.
            // Platform memberships (no IN_COMPANY edge) are untouched here.
            WITH user, company
            OPTIONAL MATCH (user)-[:HAS_MEMBERSHIP]->(put_ms:Membership)-[:IN_COMPANY]->(company)
            OPTIONAL MATCH (put_ms)-[stale:HAS_ROLE]->(stale_role:Role)
            WHERE NOT stale_role.id IN $roleIds
            DELETE stale

            WITH DISTINCT user, company
            ${grantCompanyRoles({ userAlias: "user", companyAlias: "company" })}
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

  async patchAvatar(params: { userId: string; avatar: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
      avatar: params.avatar,
    };

    query.query += `
      MATCH (user:User {id: $userId})
      SET user.avatar = $avatar,
          user.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  async deleteUser(params: { userId: string }): Promise<void> {
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
      membershipId: randomUUID(),
      roleIds: [params.roleId],
    };

    // Administrator is a PLATFORM role: it lives on the membership with no IN_COMPANY
    // edge. Every other role is granted on the CLS company's membership.
    if (params.roleId === RoleId.Administrator) {
      query.query += `
        MATCH (user:User {id: $userId})
        ${grantPlatformRole({ userAlias: "user" })}
      `;
    } else {
      query.query += `
        MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company)
        ${grantCompanyRoles({ userAlias: "user", companyAlias: "company" })}
      `;
    }

    await this.neo4j.writeOne(query);
  }

  async removeUserFromRole(params: { roleId: string; userId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      roleId: params.roleId,
      userId: params.userId,
      administratorRoleId: RoleId.Administrator,
    };

    query.query += `
      MATCH (user:User {id: $userId})-[:HAS_MEMBERSHIP]->(rm_ms:Membership)
      WHERE (rm_ms)-[:IN_COMPANY]->(:Company {id: $companyId})
         OR ($roleId = $administratorRoleId AND NOT (rm_ms)-[:IN_COMPANY]->(:Company))
      MATCH (rm_ms)-[rel:HAS_ROLE]->(:Role {id: $roleId})
      DELETE rel
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Find all platform administrators (Only35 owners)
   * These users have the Administrator role and receive internal payment notifications.
   */
  async findPlatformAdministrators(): Promise<User[]> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model, fetchAll: true });

    query.queryParams = {
      administratorRoleId: RoleId.Administrator,
    };

    query.query = `
      MATCH (user:User {isDeleted: false})-[:HAS_MEMBERSHIP]->(pa_ms:Membership)
      WHERE NOT (pa_ms)-[:IN_COMPANY]->(:Company)
      MATCH (pa_ms)-[:HAS_ROLE]->(:Role {id: $administratorRoleId})
      RETURN DISTINCT user
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Find company admins for a Stripe customer
   * Query path: StripeCustomer -> Company <- User with CompanyAdministrator role
   */
  async findCompanyAdminsByStripeCustomerId(params: { stripeCustomerId: string }): Promise<User[]> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model, fetchAll: true });

    query.queryParams = {
      stripeCustomerId: params.stripeCustomerId,
      companyAdminRoleId: RoleId.CompanyAdministrator,
    };

    query.query = `
      MATCH (stripeCustomer:StripeCustomer {stripeCustomerId: $stripeCustomerId})
      MATCH (company:Company)<-[:BELONGS_TO]-(stripeCustomer)
      MATCH (user:User {isDeleted: false})-[:BELONGS_TO]->(company)
      MATCH (user)-[:HAS_MEMBERSHIP]->(ca_ms:Membership)-[:IN_COMPANY]->(company)
      MATCH (ca_ms)-[:HAS_ROLE]->(:Role {id: $companyAdminRoleId})
      // membershipRoleMatch bound to the matched company alias: this query has no
      // $companyId param. See membership.query.ts.
      OPTIONAL MATCH (user)-[:HAS_MEMBERSHIP]->(user_role_ms:Membership)
      WHERE (user_role_ms)-[:IN_COMPANY]->(company)
         OR NOT (user_role_ms)-[:IN_COMPANY]->(:Company)
      OPTIONAL MATCH (user_role_ms)-[:HAS_ROLE]->(user_role:Role)
      RETURN user, user_role
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Find company admins by company ID
   * Used for deletion warning notifications
   */
  async findAdminsByCompanyId(params: { companyId: string }): Promise<User[]> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model, fetchAll: true });

    query.queryParams = {
      companyId: params.companyId,
      companyAdminRoleId: RoleId.CompanyAdministrator,
    };

    query.query = `
      MATCH (company:Company {id: $companyId})
      MATCH (user:User {isDeleted: false})-[:BELONGS_TO]->(company)
      MATCH (user)-[:HAS_MEMBERSHIP]->(ca_ms:Membership)-[:IN_COMPANY]->(company)
      MATCH (ca_ms)-[:HAS_ROLE]->(:Role {id: $companyAdminRoleId})
      ${membershipRoleMatch({ userAlias: "user", roleAlias: "user_role" })}
      RETURN user, user_role
    `;

    return this.neo4j.readMany(query);
  }
}
