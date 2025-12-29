import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeProduct } from "../entities/stripe-product.entity";
import { stripeProductMeta } from "../entities/stripe-product.meta";
import { StripeProductModel } from "../entities/stripe-product.model";

@Injectable()
export class StripeProductRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripeProductMeta.nodeName}_id IF NOT EXISTS FOR (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName}) REQUIRE ${stripeProductMeta.nodeName}.id IS UNIQUE`,
    });

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${stripeProductMeta.nodeName}_stripeProductId IF NOT EXISTS FOR (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName}) REQUIRE ${stripeProductMeta.nodeName}.stripeProductId IS UNIQUE`,
    });
  }

  async findAll(params?: { active?: boolean }): Promise<StripeProduct[]> {
    const query = this.neo4j.initQuery({ serialiser: StripeProductModel });

    const whereParams: string[] = [];
    if (params?.active !== undefined) {
      query.queryParams.active = params.active;
      whereParams.push(`${stripeProductMeta.nodeName}.active = $active`);
    }

    const where = whereParams.length > 0 ? `WHERE ${whereParams.join(" AND ")}` : "";

    query.query = `
      MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})
      ${where}
      RETURN ${stripeProductMeta.nodeName}
      ORDER BY ${stripeProductMeta.nodeName}.name
    `;

    return this.neo4j.readMany(query);
  }

  async findById(params: { id: string }): Promise<StripeProduct | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeProductModel });

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $id})
      RETURN ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async findByStripeProductId(params: { stripeProductId: string }): Promise<StripeProduct | null> {
    const query = this.neo4j.initQuery({ serialiser: StripeProductModel });

    query.queryParams = {
      stripeProductId: params.stripeProductId,
    };

    query.query = `
      MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {stripeProductId: $stripeProductId})
      RETURN ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.readOne(query);
  }

  async create(params: {
    stripeProductId: string;
    name: string;
    description?: string;
    active: boolean;
    metadata?: string;
  }): Promise<StripeProduct> {
    const query = this.neo4j.initQuery({ serialiser: StripeProductModel });

    const id = randomUUID();

    query.queryParams = {
      id,
      stripeProductId: params.stripeProductId,
      name: params.name,
      description: params.description ?? null,
      active: params.active,
      metadata: params.metadata ?? null,
    };

    query.query = `
      CREATE (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {
        id: $id,
        stripeProductId: $stripeProductId,
        name: $name,
        description: $description,
        active: $active,
        metadata: $metadata,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      RETURN ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  async update(params: {
    id: string;
    name?: string;
    description?: string;
    active?: boolean;
    metadata?: string;
  }): Promise<StripeProduct> {
    const query = this.neo4j.initQuery({ serialiser: StripeProductModel });

    const setParams: string[] = [];
    setParams.push(`${stripeProductMeta.nodeName}.updatedAt = datetime()`);

    if (params.name !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.name = $name`);
    }
    if (params.description !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.description = $description`);
    }
    if (params.active !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.active = $active`);
    }
    if (params.metadata !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.metadata = $metadata`);
    }

    query.queryParams = {
      id: params.id,
      name: params.name,
      description: params.description,
      active: params.active,
      metadata: params.metadata,
    };

    query.query = `
      MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $id})
      SET ${setParams.join(", ")}
      RETURN ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  async updateByStripeProductId(params: {
    stripeProductId: string;
    name?: string;
    description?: string;
    active?: boolean;
    metadata?: string;
  }): Promise<StripeProduct> {
    const query = this.neo4j.initQuery({ serialiser: StripeProductModel });

    const setParams: string[] = [];
    setParams.push(`${stripeProductMeta.nodeName}.updatedAt = datetime()`);

    if (params.name !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.name = $name`);
    }
    if (params.description !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.description = $description`);
    }
    if (params.active !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.active = $active`);
    }
    if (params.metadata !== undefined) {
      setParams.push(`${stripeProductMeta.nodeName}.metadata = $metadata`);
    }

    query.queryParams = {
      stripeProductId: params.stripeProductId,
      name: params.name,
      description: params.description,
      active: params.active,
      metadata: params.metadata,
    };

    query.query = `
      MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {stripeProductId: $stripeProductId})
      SET ${setParams.join(", ")}
      RETURN ${stripeProductMeta.nodeName}
    `;

    return this.neo4j.writeOne(query);
  }

  async delete(params: { id: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $id})
      DETACH DELETE ${stripeProductMeta.nodeName}
    `;

    await this.neo4j.writeOne(query);
  }
}
