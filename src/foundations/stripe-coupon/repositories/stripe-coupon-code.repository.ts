import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { StripeCouponCode, StripeCouponCodeDescriptor } from "../entities/stripe-coupon-code";
import { stripeCouponCodeMeta } from "../entities/stripe-coupon-code.meta";
import { stripeCouponMeta } from "../entities/stripe-coupon.meta";

@Injectable()
export class StripeCouponCodeRepository extends AbstractRepository<
  StripeCouponCode,
  typeof StripeCouponCodeDescriptor.relationships
> {
  protected readonly descriptor = StripeCouponCodeDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * The code with its coupon.
   */
  protected buildReturnStatement(): string {
    const { nodeName } = stripeCouponCodeMeta;

    return `
      MATCH (${nodeName})<-[:HAS_CODE]-(${nodeName}_coupon:${stripeCouponMeta.labelName})
      RETURN ${nodeName},
        ${nodeName}_coupon
    `;
  }

  /**
   * The active code marked "Apply automatically", with its coupon. At most one exists.
   */
  async findAutomatic(): Promise<StripeCouponCode | null> {
    const { nodeName } = stripeCouponCodeMeta;
    const query = this.neo4j.initQuery({ serialiser: StripeCouponCodeDescriptor.model });

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${nodeName}.automatic = true AND ${nodeName}.active = true
      WITH ${nodeName}
      ORDER BY ${nodeName}.updatedAt DESC
      LIMIT 1
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * The code mirrored from a Stripe promotion code id.
   */
  async findByStripePromotionCodeId(params: { stripePromotionCodeId: string }): Promise<StripeCouponCode | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeCouponCodeDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: params.stripePromotionCodeId };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "stripePromotionCodeId" })}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Switches "Apply automatically" on one code in a single write. Turning it on clears it
   * on every other code first, so two codes never have it; turning it off only clears the target.
   */
  async setAutomatic(params: { id: string; automatic: boolean }): Promise<void> {
    const { nodeName, labelName } = stripeCouponCodeMeta;
    const query = this.neo4j.initQuery({ serialiser: StripeCouponCodeDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: params.id };

    if (!params.automatic) {
      query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      SET ${nodeName}.automatic = false, ${nodeName}.updatedAt = datetime()
    `;
    } else {
      query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      OPTIONAL MATCH (${nodeName}_other:${labelName})
      WHERE ${nodeName}_other.id <> $searchValue AND ${nodeName}_other.automatic = true
      SET ${nodeName}_other.automatic = false, ${nodeName}_other.updatedAt = datetime()
      WITH DISTINCT ${nodeName}
      SET ${nodeName}.automatic = true, ${nodeName}.updatedAt = datetime()
    `;
    }

    await this.neo4j.writeOne(query);
  }
}
