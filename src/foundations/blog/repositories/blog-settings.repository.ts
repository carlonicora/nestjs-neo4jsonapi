import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { BLOG_SETTINGS_ID, BlogListLayout } from "../blog.constants";
import { BlogSettings, BlogSettingsDescriptor } from "../entities/blog-settings";
import { blogSettingsMeta } from "../entities/blog-settings.meta";

const settings = blogSettingsMeta.nodeName;

@Injectable()
export class BlogSettingsRepository extends AbstractRepository<
  BlogSettings,
  typeof BlogSettingsDescriptor.relationships
> {
  protected readonly descriptor = BlogSettingsDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * The single settings node, or null when it was never saved.
   */
  async findSettings(): Promise<BlogSettings | null> {
    const query = this.neo4j.initQuery({ serialiser: BlogSettingsDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: BLOG_SETTINGS_ID };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Creates or updates the single settings node, always on BLOG_SETTINGS_ID.
   */
  async upsert(params: { listLayout: BlogListLayout }): Promise<void> {
    await this.neo4j.executeInTransaction([
      {
        query: `
          MERGE (${settings}:${blogSettingsMeta.labelName} {id: $id})
          ON CREATE SET ${settings}.createdAt = datetime()
          SET ${settings}.listLayout = $listLayout, ${settings}.updatedAt = datetime()
        `,
        params: { id: BLOG_SETTINGS_ID, listLayout: params.listLayout },
      },
    ]);
  }
}
