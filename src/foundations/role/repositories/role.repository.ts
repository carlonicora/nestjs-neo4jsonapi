import { RoleId } from "../../../common/constants/system.roles";
import { Injectable, OnModuleInit } from "@nestjs/common";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { RoleDescriptor, Role } from "../../role/entities/role";

@Injectable()
export class RoleRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT role_id IF NOT EXISTS FOR (role:Role) REQUIRE role.id IS UNIQUE`,
    });
  }

  async findByNameNotId(params: { roleId: string; name: string }): Promise<Role> {
    const query = this.neo4j.initQuery({ serialiser: RoleDescriptor.model });

    query.queryParams = {
      roleId: params.roleId,
      name: params.name,
    };

    query.query = `
      MATCH (role:Role {name: $name})
      WHERE role.id <> $roleId
      RETURN role
    `;

    return this.neo4j.readOne(query);
  }

  async findByName(params: { name: string }): Promise<Role> {
    const query = this.neo4j.initQuery({ serialiser: RoleDescriptor.model });

    query.queryParams = {
      name: params.name,
    };

    query.query = `
      MATCH (role:Role {name: $name})
      RETURN role
    `;

    return this.neo4j.readOne(query);
  }

  async findById(params: { roleId: string }): Promise<Role> {
    const query = this.neo4j.initQuery({ serialiser: RoleDescriptor.model });

    query.queryParams = {
      roleId: params.roleId,
    };

    query.query = `
      MATCH (role:Role {id: $roleId})
      RETURN role
    `;

    return this.neo4j.readOne(query);
  }

  async find(params: { term?: string; cursor: JsonApiCursorInterface }): Promise<Role[]> {
    const query = this.neo4j.initQuery({ serialiser: RoleDescriptor.model, cursor: params.cursor });

    query.queryParams = {
      term: params.term,
      administratorsId: RoleId.Administrator,
    };

    query.query = `
      MATCH (role:Role)
      WHERE role.id <> $administratorsId
      ${params.term ? "AND toLower(role.name) CONTAINS toLower($term)" : ""}
      
      WITH role
      ORDER BY role.name ASC
      {CURSOR}
      
      RETURN role
    `;

    return this.neo4j.readMany(query);
  }

  async findForUser(params: { userId: string; term?: string; cursor: JsonApiCursorInterface }): Promise<Role[]> {
    const query = this.neo4j.initQuery({ serialiser: RoleDescriptor.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
      term: params.term,
      administratorsId: RoleId.Administrator,
    };

    query.query += `
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company)
      // Required (MATCH) variant of membershipRoleMatch bound to the company alias
      // already matched above — see membership.query.ts. Company roles + platform roles.
      MATCH (user)-[:HAS_MEMBERSHIP]->(role_ms:Membership)
      WHERE (role_ms)-[:IN_COMPANY]->(company)
         OR NOT (role_ms)-[:IN_COMPANY]->(:Company)
      MATCH (role_ms)-[:HAS_ROLE]->(role:Role)
      WHERE role.id <> $administratorsId
      ${params.term ? "AND toLower(role.name) CONTAINS toLower($term)" : ""}

      WITH DISTINCT role
      ORDER BY role.name ASC
      {CURSOR}
      
      RETURN role
    `;

    return this.neo4j.readMany(query);
  }

  async findNotInUser(params: { userId: string; term?: string; cursor: JsonApiCursorInterface }): Promise<Role[]> {
    const query = this.neo4j.initQuery({ serialiser: RoleDescriptor.model, cursor: params.cursor, fetchAll: true });

    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
      term: params.term,
      administratorsId: RoleId.Administrator,
    };

    query.query += `
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company)
      MATCH (role:Role)
      // Negated membership read (see membership.query.ts): the role must not be held
      // through the company membership NOR through the platform membership.
      WHERE NOT EXISTS {
        MATCH (user)-[:HAS_MEMBERSHIP]->(nu_ms:Membership)-[:HAS_ROLE]->(role)
        WHERE (nu_ms)-[:IN_COMPANY]->(company)
           OR NOT (nu_ms)-[:IN_COMPANY]->(:Company)
      }
      ${params.term ? "AND toLower(role.name) CONTAINS toLower($term)" : ""}
      AND role.id <> $administratorsId
      
      WITH role
      ORDER BY role.name ASC
      {CURSOR}
      
      RETURN role
    `;

    return this.neo4j.readMany(query);
  }

  async create(params: { id: string; name: string; description?: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      name: params.name,
      description: params.description,
    };

    query.query = `
      CREATE (role:Role {
        id: $id, 
        name: $name, 
        description: $description, 
        createdAt: datetime(), 
        updatedAt: datetime()})
    `;

    await this.neo4j.writeOne(query);
  }

  async update(params: { id: string; name: string; description?: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      id: params.id,
      name: params.name,
      description: params.description,
    };

    query.query = `
      MATCH (role:Role {id: $id}) 
      SET role.name = $name, 
        role.description = $description, 
        role.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  async delete(params: { roleId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      roleId: params.roleId,
    };

    query.query = `
      MATCH (role:Role {id: $roleId}) 
      DETACH DELETE role
    `;
    await this.neo4j.writeOne(query);
  }
}
