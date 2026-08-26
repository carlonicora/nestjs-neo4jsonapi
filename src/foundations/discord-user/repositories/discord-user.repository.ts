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

  /**
   * The Discord account linked to a platform user, if there is one.
   *
   * The inverse of {@link findByDiscordId}, for the paths that start from an
   * authenticated web user rather than from a Discord interaction (listing the
   * servers that user shares with the bot, resolving a recording's game master
   * when it was started from the web). Undefined when the user has never
   * linked Discord — callers degrade rather than fail.
   *
   * A DiscordUser's `id` is NOT reliably the user's id (only accounts created
   * through the Discord OAuth path share one), so this traverses the edge.
   */
  async findByUserId(params: { userId: string }): Promise<DiscordUser | undefined> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      userId: params.userId,
    };

    query.query = `
      MATCH (:${userMeta.labelName} { id: $userId })-[:HAS_DISCORD]->(${DiscordUserDescriptor.model.nodeName}:${DiscordUserDescriptor.model.labelName})
      ${this.buildReturnStatement()}
      LIMIT 1
    `;

    const users = await this.neo4j.readMany(query);
    return users[0];
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
