import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository, Neo4jService, SecurityService } from "../../../core";
import { roleMeta } from "../../role";
import { userMeta } from "../../user";
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
      // membershipRoleMatch bound to the matched company alias: findByDiscordId has no
      // $companyId param. See foundations/membership/queries/membership.query.ts.
      OPTIONAL MATCH (discorduser_${userMeta.nodeName})-[:HAS_MEMBERSHIP]->(discorduser_${userMeta.nodeName}_${roleMeta.nodeName}_ms:Membership)
      WHERE (discorduser_${userMeta.nodeName}_${roleMeta.nodeName}_ms)-[:IN_COMPANY]->(discorduser_company)
         OR NOT (discorduser_${userMeta.nodeName}_${roleMeta.nodeName}_ms)-[:IN_COMPANY]->(:Company)
      OPTIONAL MATCH (discorduser_${userMeta.nodeName}_${roleMeta.nodeName}_ms)-[:HAS_ROLE]->(discorduser_${userMeta.nodeName}_${roleMeta.nodeName}:${roleMeta.labelName})

      RETURN discorduser, discorduser_company, discorduser_user, discorduser_company as discorduser_user_company, discorduser_${userMeta.nodeName}_${roleMeta.nodeName}
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
