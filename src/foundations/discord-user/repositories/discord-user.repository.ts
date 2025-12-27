import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository, Neo4jService, SecurityService } from "../../../core";
import { DiscordUser, DiscordUserDescriptor } from "../entities/discord-user";

@Injectable()
export class DiscordUserRepository extends AbstractRepository<DiscordUser, typeof DiscordUserDescriptor.relationships> {
  protected readonly descriptor = DiscordUserDescriptor;
  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  protected buildReturnStatement(): string {
    return `
      MATCH (discorduser:DiscordUser)-[:BELONGS_TO]->(discorduser_company:Company)
      MATCH (discorduser)<-[:HAS_DISCORD]-(discorduser_user:User)
      RETURN discorduser, discorduser_company, discorduser_user, discorduser_company as discorduser_user_company
    `;
  }

  async findByDiscordId(params: { discordId: string }): Promise<DiscordUser> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      discordId: params.discordId,
    };

    query.query = `
      MATCH (${DiscordUserDescriptor.model.nodeName}:${DiscordUserDescriptor.model.labelName} { discordId: $discordId })
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }
}
