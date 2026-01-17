import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { RoleId } from "../../../common/constants/system.roles";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { AuthCode } from "../../auth/entities/auth.code.entity";
import { AuthCodeModel } from "../../auth/entities/auth.code.model";
import { Auth } from "../../auth/entities/auth.entity";
import { AuthModel } from "../../auth/entities/auth.model";
import { companyMeta } from "../../company";
import { featureMeta } from "../../feature/entities/feature.meta";
import { ModuleModel } from "../../module/entities/module.model";
import { featureModuleQuery } from "../../module/queries/feature.module.query";
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
      authId: params.authId,
    };

    query.query = `
      MATCH (auth:Auth {id: $authId})
      MATCH (auth)<-[:HAS_AUTH]-(auth_user:User)
      OPTIONAL MATCH (auth_user)-[:MEMBER_OF]->(auth_user_role:Role)
      OPTIONAL MATCH (auth_user)-[:MEMBER_OF]->(auth_user_group:Group) 
      OPTIONAL MATCH (auth_user)-[:BELONGS_TO]->(auth_user_company:Company)
      OPTIONAL MATCH (auth_user_company)-[:HAS_CONFIGURATION]->(auth_user_company_configuration:Configuration)
      OPTIONAL MATCH (auth_user_company)-[:HAS_FEATURE]->(auth_user_company_feature:Feature)
      RETURN auth, auth_user, auth_user_role, auth_user_group, auth_user_company, auth_user_company_configuration, auth_user_company_feature
    `;

    const auth = await this.neo4j.readOne(query);

    query = this.neo4j.initQuery({ serialiser: ModuleModel });
    query.queryParams = {
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

  async findUserById(params: { userId: string }): Promise<User> {
    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model });

    query.queryParams = {
      userId: params.userId,
    };

    query.query = `
      MATCH (user:User {id: $userId}) 
      OPTIONAL MATCH (user)-[:MEMBER_OF]->(user_role:Role)
      OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)
      MATCH (${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}:${featureMeta.labelName})
      WHERE ${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}.isCore = true 
      OR EXISTS {((${userMeta.nodeName}_${companyMeta.nodeName})-[:HAS_FEATURE]->(${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}))}

      RETURN user, user_role, user_company, ${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async create(params: { authId: string; userId: string; token: string; expiration: Date }): Promise<Auth> {
    const user = await this.findUserById({ userId: params.userId });

    let query = this.neo4j.initQuery({ serialiser: AuthModel });
    query.queryParams = {
      authId: params.authId,
      userId: params.userId,
      token: params.token,
      expiration: params.expiration.toISOString(),
    };

    if (user.role && user.role.length === 1 && user.role[0].id === RoleId.Administrator) {
      query.query = `
        MATCH (auth_user:User {id: $userId})
        CREATE (auth:Auth {id: $authId, token: $token, expiration: $expiration, createdAt: datetime(), updatedAt: datetime()}) 
        CREATE (auth_user)-[:HAS_AUTH]->(auth)

        OPTIONAL MATCH (auth_user)-[:BELONGS_TO]->(auth_user_company:Company)
        MATCH (auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}:${featureMeta.labelName})
        WHERE auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}.isCore = true 
        OR EXISTS {((auth_${userMeta.nodeName}_${companyMeta.nodeName})-[:HAS_FEATURE]->(auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}))}



        WITH auth, auth_user, auth_user_company, auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}
        OPTIONAL MATCH (auth_user)-[:MEMBER_OF]->(auth_user_role:Role)
        OPTIONAL MATCH (auth_user_role)-[perm:HAS_PERMISSIONS]->(module:Module)
        WITH auth, auth_user, auth_user_company, auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}, auth_user_role, module, apoc.convert.fromJsonList(module.permissions) AS modPerms, collect(perm) AS rolePerms

WITH auth, auth_user, auth_user_company, auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}, auth_user_role, module, apoc.convert.fromJsonList(module.permissions) AS modPerms

WITH auth, auth_user, auth_user_company, auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}, auth_user_role, module, 
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
WITH auth, auth_user, auth_user_company, auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}, auth_user_role, module, defaultCreate, defaultRead, defaultUpdate, defaultDelete, collect(perm) AS rolePerms

WITH auth, auth_user, auth_user_company, auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}, auth_user_role, module, defaultCreate, defaultRead, defaultUpdate, defaultDelete, apoc.coll.flatten([p IN rolePerms | apoc.convert.fromJsonList(p.permissions)]) AS rolePermsParsed

WITH auth, auth_user, auth_user_company, auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName}, auth_user_role, module,
     defaultCreate, defaultRead, defaultUpdate, defaultDelete, rolePermsParsed,
     [defaultCreate] + [r IN rolePermsParsed WHERE r.type="create" | r.value] AS createValues,
     [defaultRead]   + [r IN rolePermsParsed WHERE r.type="read"   | r.value] AS readValues,
     [defaultUpdate] + [r IN rolePermsParsed WHERE r.type="update" | r.value] AS updateValues,
     [defaultDelete] + [r IN rolePermsParsed WHERE r.type="delete" | r.value] AS deleteValues

WITH auth, auth_user, auth_user_company, auth_${userMeta.nodeName}_${companyMeta.nodeName}_${featureMeta.nodeName},  auth_user_role, module,
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
      OPTIONAL MATCH (auth_user)-[:MEMBER_OF]->(auth_user_role:Role)
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
      token: params.token,
    };

    query.query = `
      MATCH (auth:Auth {token: $token})<-[:HAS_AUTH]-(auth_user:User)
      WITH auth, auth_user
      OPTIONAL MATCH (auth_user)-[:MEMBER_OF]->(auth_user_role:Role)
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
