import { Injectable, OnModuleInit } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { HandbookSection, HandbookSectionDescriptor } from "../entities/handbook-section";
import { handbookSectionMeta } from "../entities/handbook-section.meta";

@Injectable()
export class HandbookSectionRepository
  extends AbstractRepository<HandbookSection, typeof HandbookSectionDescriptor.relationships>
  implements OnModuleInit
{
  protected readonly descriptor = HandbookSectionDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * `key` is the natural key of the ingest. `super.onModuleInit()` runs FIRST
   * and is not optional: the base implementation turns the descriptor's own
   * constraints and indexes into real Neo4j objects, exactly as
   * HandbookPageRepository documents.
   */
  async onModuleInit(): Promise<void> {
    await super.onModuleInit();

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT handbooksection_key IF NOT EXISTS FOR (${handbookSectionMeta.nodeName}:${handbookSectionMeta.labelName}) REQUIRE ${handbookSectionMeta.nodeName}.key IS UNIQUE`,
    });
  }

  /** Every section, unpaginated — there are ten of them. */
  async findAllSections(): Promise<HandbookSection[]> {
    const query = this.neo4j.initQuery({ serialiser: HandbookSectionDescriptor.model });
    query.query = `
      ${this.buildDefaultMatch()}
      ORDER BY ${handbookSectionMeta.nodeName}.order ASC
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readMany(query);
  }

  /**
   * Sections are replaced wholesale on every sync: there are ten of them and
   * diffing buys nothing. One statement, so a failed sync cannot leave the
   * tree half-described.
   */
  async replaceAll(params: {
    sections: {
      id: string;
      key: string;
      title: string;
      summary?: string;
      order: string;
      displayTitle?: string;
      displaySummary?: string;
    }[];
  }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      // An absent optional is bound as `null`, never left `undefined`: the
      // driver takes no `undefined`, and `null` is what writes "this section
      // has no blurb / no translation" rather than a stale value.
      sections: params.sections.map((section) => ({
        ...section,
        summary: section.summary ?? null,
        displayTitle: section.displayTitle ?? null,
        displaySummary: section.displaySummary ?? null,
      })),
    };
    query.query = `
      OPTIONAL MATCH (existing:${handbookSectionMeta.labelName})
      DETACH DELETE existing
      WITH count(*) AS ignored
      UNWIND $sections AS section
      CREATE (${handbookSectionMeta.nodeName}:${handbookSectionMeta.labelName} {
        id: section.id,
        key: section.key,
        title: section.title,
        summary: section.summary,
        order: section.order,
        displayTitle: section.displayTitle,
        displaySummary: section.displaySummary,
        createdAt: datetime(),
        updatedAt: datetime()
      })
    `;
    await this.neo4j.writeOne(query);
  }
}
