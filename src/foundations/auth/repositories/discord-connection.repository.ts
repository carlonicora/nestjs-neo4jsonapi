import { Injectable, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { DiscordConnection, DiscordConnectionDescriptor } from "../entities/discord-connection";
import { discordConnectionMeta } from "../entities/discord-connection.meta";

@Injectable()
export class DiscordConnectionRepository extends AbstractRepository<
  DiscordConnection,
  typeof DiscordConnectionDescriptor.relationships
> {
  protected readonly descriptor = DiscordConnectionDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /** Adds connected and discordName: the user's linked DiscordUser, if any. */
  protected buildReturnStatement(): string {
    const { nodeName } = discordConnectionMeta;
    return `
      OPTIONAL MATCH (${nodeName})-[:HAS_DISCORD]->(du:DiscordUser)
      RETURN ${nodeName}, du IS NOT NULL AS connected, du.name AS discordName
    `;
  }

  /**
   * The Discord connection of the caller. Any id other than the CLS user's answers 404 before any
   * query ("internal" reads are scoped in the repository), so no one reads another user's Discord name.
   */
  async findCurrent(params: { id: string }): Promise<DiscordConnection> {
    if (!params.id || params.id !== this.clsService.get("userId")) {
      throw new NotFoundException(`Discord connection with id ${params.id} not found`);
    }

    const query = this.neo4j.initQuery({ serialiser: DiscordConnectionDescriptor.model });
    query.queryParams = { ...query.queryParams, searchValue: params.id };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      ${this.buildReturnStatement()}
    `;

    const result = await this.neo4j.readOne(query);
    if (!result) throw new NotFoundException(`Discord connection with id ${params.id} not found`);
    return result;
  }
}
