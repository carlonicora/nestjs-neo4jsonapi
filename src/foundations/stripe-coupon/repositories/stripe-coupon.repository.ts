import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { StripeCoupon, StripeCouponDescriptor } from "../entities/stripe-coupon";
import { stripeCouponCodeMeta } from "../entities/stripe-coupon-code.meta";
import { stripeCouponMeta } from "../entities/stripe-coupon.meta";

@Injectable()
export class StripeCouponRepository extends AbstractRepository<
  StripeCoupon,
  typeof StripeCouponDescriptor.relationships
> {
  protected readonly descriptor = StripeCouponDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * The coupon with its codes.
   */
  protected buildReturnStatement(): string {
    const { nodeName } = stripeCouponMeta;

    return `
      OPTIONAL MATCH (${nodeName})-[:HAS_CODE]->(${nodeName}_codes:${stripeCouponCodeMeta.labelName})
      RETURN ${nodeName},
        ${nodeName}_codes
    `;
  }

  /**
   * The coupon mirrored from a Stripe coupon id.
   */
  async findByStripeCouponId(params: { stripeCouponId: string }): Promise<StripeCoupon | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeCouponDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: params.stripeCouponId };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "stripeCouponId" })}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }
}
