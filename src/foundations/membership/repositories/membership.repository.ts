import { Injectable, OnModuleInit } from "@nestjs/common";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";

@Injectable()
export class MembershipRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT membership_id IF NOT EXISTS FOR (membership:Membership) REQUIRE membership.id IS UNIQUE`,
    });
  }
}
