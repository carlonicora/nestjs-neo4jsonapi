import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository, Neo4jService, SecurityService } from "../../../core";
import { roleMeta } from "../../role";
import { userMeta } from "../../user";
import { GoogleUser, GoogleUserDescriptor } from "../entities/google-user";

@Injectable()
export class GoogleUserRepository extends AbstractRepository<GoogleUser, typeof GoogleUserDescriptor.relationships> {
  protected readonly descriptor = GoogleUserDescriptor;
  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  protected buildReturnStatement(): string {
    return `
      MATCH (googleuser:GoogleUser)-[:BELONGS_TO]->(googleuser_company:Company)
      MATCH (googleuser)<-[:HAS_GOOGLE]-(googleuser_user:User)
      // membershipRoleMatch bound to the matched company alias: findByGoogleId has no
      // $companyId param. See foundations/membership/queries/membership.query.ts.
      OPTIONAL MATCH (googleuser_${userMeta.nodeName})-[:HAS_MEMBERSHIP]->(googleuser_${userMeta.nodeName}_${roleMeta.nodeName}_ms:Membership)
      WHERE (googleuser_${userMeta.nodeName}_${roleMeta.nodeName}_ms)-[:IN_COMPANY]->(googleuser_company)
         OR NOT (googleuser_${userMeta.nodeName}_${roleMeta.nodeName}_ms)-[:IN_COMPANY]->(:Company)
      OPTIONAL MATCH (googleuser_${userMeta.nodeName}_${roleMeta.nodeName}_ms)-[:HAS_ROLE]->(googleuser_${userMeta.nodeName}_${roleMeta.nodeName}:${roleMeta.labelName})

      RETURN googleuser, googleuser_company, googleuser_user, googleuser_company as googleuser_user_company, googleuser_${userMeta.nodeName}_${roleMeta.nodeName}
    `;
  }

  async findByGoogleId(params: { googleId: string }): Promise<GoogleUser> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      googleId: params.googleId,
    };

    query.query = `
      MATCH (${GoogleUserDescriptor.model.nodeName}:${GoogleUserDescriptor.model.labelName} { googleId: $googleId })
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }
}
