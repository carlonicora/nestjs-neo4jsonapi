import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { RoleId } from "../../../common/constants/system.roles";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { AuthCode } from "../../auth/entities/auth.code.entity";
import { AuthCodeModel } from "../../auth/entities/auth.code.model";
import { Auth } from "../../auth/entities/auth.entity";
import { AuthModel } from "../../auth/entities/auth.model";
import { Company, CompanyDescriptor, companyMeta } from "../../company";
import { featureMeta } from "../../feature/entities/feature.meta";
import { membershipRoleMatch } from "../../membership/queries/membership.query";
import { ModuleModel } from "../../module/entities/module.model";
import { featureModuleQuery } from "../../module/queries/feature.module.query";
import { Role } from "../../role/entities/role";
import { userMeta } from "../../user";
import { User, UserDescriptor } from "../../user/entities/user";

@Injectable()
export class AuthRepository implements OnModuleInit {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly security: SecurityService,
  ) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT authcode_id IF NOT EXISTS FOR (authcode:AuthCode) REQUIRE authcode.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT auth_id IF NOT EXISTS FOR (auth:Auth) REQUIRE auth.id IS UNIQUE`,
    });
  }

  async setLastLogin(params: { userId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      userId: params.userId,
    };

    query.query = `
      MATCH (user:User {id: $userId}) SET user.lastLogin = datetime() RETURN user
    `;

    await this.neo4j.writeOne(query);
  }

  async findByCode(params: { code: string }): Promise<AuthCode> {
    const query = this.neo4j.initQuery({ serialiser: AuthCodeModel });

    query.queryParams = {
      authCodeId: params.code,
    };

    query.query = `
      MATCH (authcode:AuthCode {id: $authCodeId})<-[:HAS_AUTH_CODE]-(authcode_auth:Auth)
      RETURN authcode, authcode_auth
    `;

    return this.neo4j.readOne(query);
  }

  async findById(params: { authId: string }): Promise<Auth> {
    let query = this.neo4j.initQuery({ serialiser: AuthModel });

    query.queryParams = {
      ...query.queryParams,
      authId: params.authId,
    };

    // Role hydration is bound to the `auth_user_company` ALIAS rather than to
    // `$companyId` (the membershipRoleMatch helper): the auth-code exchange runs
    // UNAUTHENTICATED, so CLS carries no companyId and `$companyId` would be null,
    // which would silently reduce the session to platform-level roles only. The
    // alias-bound form is the same shape the permission core uses
    // (feature.module.query.ts) and keeps the returned roles consistent with the
    // company returned on the very same row. Platform memberships (no IN_COMPANY
    // edge) are still included, so the global Administrator keeps its roles.
    query.query = `
      MATCH (auth:Auth {id: $authId})
      MATCH (auth)<-[:HAS_AUTH]-(auth_user:User)
      OPTIONAL MATCH (auth_user)-[:BELONGS_TO]->(auth_user_company:Company)
      OPTIONAL MATCH (auth_user)-[:HAS_MEMBERSHIP]->(auth_user_role_ms:Membership)
      WHERE (auth_user_role_ms)-[:IN_COMPANY]->(auth_user_company)
         OR NOT (auth_user_role_ms)-[:IN_COMPANY]->(:Company)
      OPTIONAL MATCH (auth_user_role_ms)-[:HAS_ROLE]->(auth_user_role:Role)
      OPTIONAL MATCH (auth_user_company)-[:HAS_CONFIGURATION]->(auth_user_company_configuration:Configuration)
      OPTIONAL MATCH (auth_user_company)-[:HAS_FEATURE]->(auth_user_company_feature:Feature)
      RETURN auth, auth_user, auth_user_role, auth_user_company, auth_user_company_configuration, auth_user_company_feature
    `;

    const auth = await this.neo4j.readOne(query);

    query = this.neo4j.initQuery({ serialiser: ModuleModel });
    // Spread first: initQuery() keeps the prefix MATCH on `$currentUserId` whenever CLS
    // carries a userId, so that parameter must survive — the company-selection flow is
    // the first caller that reaches here with a userId but no companyId in CLS.
    query.queryParams = {
      ...query.queryParams,
      companyId: auth.user.company.id,
      userId: auth.user.id,
    };

    query.query = `
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company:Company {id: $companyId})
      ${featureModuleQuery}
    `;

    const modules = await this.neo4j.readMany(query);
    auth.user.module = modules;

    return auth;
  }

  async deleteByCode(params: { code: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      authCodeId: params.code,
    };

    query.query = `
      MATCH (authcode:AuthCode {id: $authCodeId})
      DETACH DELETE authcode
    `;

    await this.neo4j.writeOne(query);
  }

  async deleteByToken(params: { token: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      token: params.token,
    };

    query.query = `
      MATCH (auth:Auth {token: $token})
      DETACH DELETE auth
    `;

    await this.neo4j.writeOne(query);
  }

  async createCode(params: { authCodeId: string; authId: string; expiration: Date }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      authCodeId: params.authCodeId,
      authId: params.authId,
      expiration: params.expiration.toISOString(),
    };

    query.query = `
      MATCH (auth:Auth {id: $authId})
      CREATE (authcode:AuthCode {
        id: $authCodeId, 
        expiration: datetime($expiration), 
        createdAt: datetime(), 
        updatedAt: datetime()
      })
      WITH auth, authcode
      MERGE (auth)-[:HAS_AUTH_CODE]->(authcode)
    `;

    await this.neo4j.writeOne(query);
  }

  async refreshToken(params: { authId: string; token: string }): Promise<Auth> {
    const query = this.neo4j.initQuery({ serialiser: AuthModel });

    query.queryParams = {
      authId: params.authId,
      token: params.token,
      expiration: this.security.refreshTokenExpiration.toISOString(),
    };

    query.query = `
      MATCH (auth:Auth {id: $authId}) 
      SET auth.token = $token, 
      auth.expiration = datetime($expiration)
      RETURN auth
    `;

    return this.neo4j.writeOne(query);
  }

  async findByRefreshToken(params: { authId: string }): Promise<Auth> {
    const query = this.neo4j.initQuery({ serialiser: AuthModel });

    query.queryParams = {
      authId: params.authId,
    };

    query.query = `
      MATCH (auth:Auth {id: $authId})<-[:HAS_AUTH]-(auth_user:User)
      RETURN auth, auth_user
    `;

    return this.neo4j.readOne(query);
  }

  async findValidToken(params: { userId: string }): Promise<Auth> {
    const query = this.neo4j.initQuery({ serialiser: AuthModel });

    query.queryParams = {
      userId: params.userId,
      expiration: {
        gte: new Date(),
      },
    };

    query.query = `
      MATCH (auth:Auth {userId: $userId, expiration: $expiration}) 
      RETURN auth
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Reads the user together with the roles effective in a single company.
   *
   * `companyId` scopes BOTH the company hydration and the membership role read to
   * one explicit company (login/company-switch/refresh); platform memberships (no
   * IN_COMPANY edge) always resolve regardless. When omitted, `$companyId` keeps
   * the CLS value injected by `initQuery()` — identical to the previous behaviour.
   */
  async findUserById(params: { userId: string; companyId?: string }): Promise<User> {
    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
    };

    if (params.companyId) query.queryParams.companyId = params.companyId;

    query.query = `
      MATCH (user:User {id: $userId})
      ${membershipRoleMatch({ userAlias: "user", roleAlias: "user_role" })}
      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company${params.companyId ? ` {id: $companyId}` : ``})
      MATCH (${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}:${featureMeta.labelName})
      WHERE ${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}.isCore = true 
      OR EXISTS {((${userMeta.nodeName}_${companyMeta.nodeName})-[:HAS_FEATURE]->(${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}))}

      RETURN user, user_role, user_company, ${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async countUserCompanies(params: { userId: string }): Promise<number> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
    };

    query.query = `
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company:Company)
      RETURN count(DISTINCT company) AS total
    `;

    // Scalar aggregate read (a count, not an entity fetch); mirrors the sanctioned
    // getCompanyAdminGuard pattern in UserRepository. Company scope is derived
    // graph-side from the user, so buildDefaultMatch does not apply: this runs
    // pre-session, when CLS holds no companyId at all.
    const result = await this.neo4j.read(query.query, query.queryParams); // nja-lint-ignore raw-neo4j-query — scalar COUNT, justified above
    const total = result.records[0]?.get("total");

    return total?.toNumber?.() ?? Number(total ?? 0);
  }

  /**
   * The companies the user belongs to — the list rendered by the company-selection
   * screen and the company switcher.
   */
  async findUserCompanies(params: { userId: string }): Promise<Company[]> {
    const query = this.neo4j.initQuery({ serialiser: CompanyDescriptor.model, fetchAll: true });

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
    };

    query.query = `
      MATCH (:User {id: $userId})-[:BELONGS_TO]->(${companyMeta.nodeName}:${companyMeta.labelName})
      RETURN ${companyMeta.nodeName}
      ORDER BY ${companyMeta.nodeName}.name
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * `companyId` pins the session being created to one company: the roles baked
   * into the JWT (signed by AuthService from the same user object) and the roles
   * hydrated onto the returned Auth payload must describe the SAME company, or a
   * user who belongs to more than one company would get a session whose company
   * and roles disagree.
   */
  async create(params: {
    authId: string;
    userId: string;
    token: string;
    expiration: Date;
    companyId?: string;
  }): Promise<Auth> {
    const user = await this.findUserById({ userId: params.userId, companyId: params.companyId });

    let query = this.neo4j.initQuery({ serialiser: AuthModel });
    query.queryParams = {
      ...query.queryParams,
      authId: params.authId,
      userId: params.userId,
      token: params.token,
      expiration: params.expiration.toISOString(),
    };

    // Login runs before CLS carries a companyId, so bind the membership role read to
    // the company `findUserById` resolved for this user (sanctioned explicit-company
    // pattern); platform memberships resolve regardless of the value.
    if (user.company?.id) query.queryParams.companyId = user.company.id;

    // Platform administrator: holds the Administrator role on a platform membership
    // (no IN_COMPANY edge) and therefore has no company in scope. Previously
    // expressed as "exactly one role and it is Administrator" — under the membership
    // model an administrator may legitimately hold several platform roles.
    if (user.role?.some((role: Role) => role.id === RoleId.Administrator) && !user.company) {
      query.query = `
        MATCH (auth_user:User {id: $userId})
        CREATE (auth:Auth {id: $authId, token: $token, expiration: $expiration, createdAt: datetime(), updatedAt: datetime()}) 
        CREATE (auth_user)-[:HAS_AUTH]->(auth)

        WITH auth, auth_user
        ${membershipRoleMatch({ userAlias: "auth_user", roleAlias: "auth_user_role" })}
        OPTIONAL MATCH (auth_user_role)-[perm:HAS_PERMISSIONS]->(module:Module)
        WITH auth, auth_user, auth_user_role, module, apoc.convert.fromJsonList(module.permissions) AS modPerms, collect(perm) AS rolePerms

WITH auth, auth_user, auth_user_role, module, apoc.convert.fromJsonList(module.permissions) AS modPerms

WITH auth, auth_user, auth_user_role, module, 
CASE 
    WHEN head([p IN modPerms WHERE p.type = "create"]) IS NULL THEN false 
    ELSE head([p IN modPerms WHERE p.type = "create"]).value 
  END AS defaultCreate,
CASE 
    WHEN head([p IN modPerms WHERE p.type = "read"]) IS NULL THEN false 
    ELSE head([p IN modPerms WHERE p.type = "read"]).value 
  END AS defaultRead,
CASE 
    WHEN head([p IN modPerms WHERE p.type = "update"]) IS NULL THEN false 
    ELSE head([p IN modPerms WHERE p.type = "update"]).value 
  END AS defaultUpdate,
CASE 
    WHEN head([p IN modPerms WHERE p.type = "delete"]) IS NULL THEN false 
    ELSE head([p IN modPerms WHERE p.type = "delete"]).value 
  END AS defaultDelete

OPTIONAL MATCH (auth_user_role)-[perm:HAS_PERMISSIONS]->(module)
WITH auth, auth_user, auth_user_role, module, defaultCreate, defaultRead, defaultUpdate, defaultDelete, collect(perm) AS rolePerms

WITH auth, auth_user, auth_user_role, module, defaultCreate, defaultRead, defaultUpdate, defaultDelete, apoc.coll.flatten([p IN rolePerms | apoc.convert.fromJsonList(p.permissions)]) AS rolePermsParsed

WITH auth, auth_user, auth_user_role, module,
     defaultCreate, defaultRead, defaultUpdate, defaultDelete, rolePermsParsed,
     [defaultCreate] + [r IN rolePermsParsed WHERE r.type="create" | r.value] AS createValues,
     [defaultRead]   + [r IN rolePermsParsed WHERE r.type="read"   | r.value] AS readValues,
     [defaultUpdate] + [r IN rolePermsParsed WHERE r.type="update" | r.value] AS updateValues,
     [defaultDelete] + [r IN rolePermsParsed WHERE r.type="delete" | r.value] AS deleteValues

WITH auth, auth_user,  auth_user_role, module,
     CASE 
       WHEN any(x IN createValues WHERE x = true) THEN true
       WHEN any(x IN createValues WHERE x <> true AND x <> false) THEN head([x IN createValues WHERE x <> true AND x <> false])
       WHEN any(x IN createValues WHERE x = false) THEN false ELSE false END AS effectiveCreate,
     CASE 
       WHEN any(x IN readValues WHERE x = true) THEN true
       WHEN any(x IN readValues WHERE x <> true AND x <> false) THEN head([x IN readValues WHERE x <> true AND x <> false])
       WHEN any(x IN readValues WHERE x = false) THEN false ELSE false END AS effectiveRead,
     CASE 
       WHEN any(x IN updateValues WHERE x = true) THEN true
       WHEN any(x IN updateValues WHERE x <> true AND x <> false) THEN head([x IN updateValues WHERE x <> true AND x <> false])
       WHEN any(x IN updateValues WHERE x = false) THEN false ELSE false END AS effectiveUpdate,
     CASE 
       WHEN any(x IN deleteValues WHERE x = true) THEN true
       WHEN any(x IN deleteValues WHERE x <> true AND x <> false) THEN head([x IN deleteValues WHERE x <> true AND x <> false])
       WHEN any(x IN deleteValues WHERE x = false) THEN false ELSE false END AS effectiveDelete

          CALL apoc.create.vNode(
            labels(module),
            apoc.map.merge(
              properties(module),
              { permissions: apoc.convert.toJson([
                  { type: "create", value: effectiveCreate },
                  { type: "read",   value: effectiveRead },
                  { type: "update", value: effectiveUpdate },
                  { type: "delete", value: effectiveDelete }
                ])
              }
            )
          ) YIELD node AS auth_user_module

      RETURN auth, auth_user, auth_user_role, auth_user_module
      `;

      return this.neo4j.writeOne(query);
    }

    query.query = `
      MATCH (auth_user:User {id: $userId})
      CREATE (auth:Auth {id: $authId, token: $token, expiration: $expiration, createdAt: datetime(), updatedAt: datetime()}) 
      CREATE (auth_user)-[:HAS_AUTH]->(auth)

      WITH auth, auth_user
      ${membershipRoleMatch({ userAlias: "auth_user", roleAlias: "auth_user_role" })}
      OPTIONAL MATCH (auth_user)-[:BELONGS_TO]->(auth_user_company:Company)

      MATCH (auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}:${featureMeta.labelName})
      WHERE auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}.isCore = true 
      OR EXISTS {((auth_${userMeta.nodeName}_${companyMeta.nodeName})-[:HAS_FEATURE]->(auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}))}
      
      OPTIONAL MATCH (auth_user_company)-[:HAS_CONFIGURATION]->(auth_user_company_configuration:Configuration)
      RETURN auth, auth_user, auth_user_role, auth_user_company, auth_user_company_feature, auth_user_company_configuration
    `;

    const auth = await this.neo4j.writeOne(query);

    query = this.neo4j.initQuery({ serialiser: ModuleModel });
    query.queryParams = {
      companyId: auth.user.company.id,
      userId: params.userId,
    };

    query.query = `
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company:Company {id: $companyId})
      ${featureModuleQuery}
    `;

    const modules = await this.neo4j.readMany(query);
    auth.user.module = modules;

    return auth;
  }

  async findByToken(params: { token: string }): Promise<Auth> {
    let query = this.neo4j.initQuery({ serialiser: AuthModel });
    query.queryParams = {
      ...query.queryParams,
      token: params.token,
    };

    query.query = `
      MATCH (auth:Auth {token: $token})<-[:HAS_AUTH]-(auth_user:User)
      WITH auth, auth_user
      ${membershipRoleMatch({ userAlias: "auth_user", roleAlias: "auth_user_role" })}
      OPTIONAL MATCH (auth_user)-[:BELONGS_TO]->(auth_user_company:Company)
      OPTIONAL MATCH (auth_user_company)-[:HAS_CONFIGURATION]->(auth_user_company_configuration:Configuration)
      OPTIONAL MATCH (auth_user_company)-[:HAS_FEATURE]->(auth_user_company_feature:Feature)
      RETURN auth, auth_user, auth_user_role, auth_user_company, auth_user_company_feature, auth_user_company_configuration
    `;

    const auth = await this.neo4j.writeOne(query);

    query = this.neo4j.initQuery({ serialiser: ModuleModel });
    query.queryParams = {
      companyId: auth.user.company.id,
      userId: auth.user.id,
      currentUserId: auth.user.id,
    };

    query.query += `
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company)
      ${featureModuleQuery}
    `;

    const modules = await this.neo4j.readMany(query);
    auth.user.module = modules;

    return auth;
  }

  async deleteById(params: { authId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      authId: params.authId,
    };

    query.query = `
      MATCH (auth:Auth {id: $authId})
      DELETE auth
    `;

    await this.neo4j.writeOne(query);
  }

  async startResetPassword(params: { userId: string }): Promise<User> {
    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model });

    query.queryParams = {
      userId: params.userId,
      code: randomUUID(),
      codeExpiration: new Date(Date.now() + 3600000).toISOString(),
    };

    query.query = `
      MATCH (user:User {id: $userId}) 
      SET user.code = $code, 
        user.codeExpiration = datetime($codeExpiration)
      RETURN user
    `;
    return this.neo4j.writeOne(query);
  }

  async resetPassword(params: { userId: string; password: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      userId: params.userId,
      password: params.password,
    };

    query.query = `
      MATCH (user:User {id: $userId}) 
      SET user.password = $password, 
        user.code = null, 
        user.codeExpiration = null
      RETURN user
    `;

    await this.neo4j.writeOne(query);
  }

  async acceptInvitation(params: { userId: string; password: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      userId: params.userId,
      password: params.password,
    };

    query.query = `
      MATCH (user:User {id: $userId}) 
      SET user.password = $password, 
        user.isActive = true,
        user.isDeleted = false,
        user.code = null, 
        user.codeExpiration = null 
    `;

    await this.neo4j.writeOne(query);
  }

  async activateAccount(params: { userId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      userId: params.userId,
    };

    query.query = `
      MATCH (user:User {id: $userId}) 
      SET user.isActive = true, 
        user.code = null, 
        user.codeExpiration = null 
    `;

    await this.neo4j.writeOne(query);
  }

  async deleteExpiredAuths(params: { userId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      userId: params.userId,
    };

    query.query = `
      MATCH (user:User {id: $userId})
      MATCH (user)-[:HAS_AUTH]->(auth:Auth)
      WHERE auth.expiration < datetime() 
      DETACH DELETE auth
    `;

    await this.neo4j.writeOne(query);
  }
}
