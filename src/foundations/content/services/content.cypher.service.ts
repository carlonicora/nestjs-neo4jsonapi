import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigContentTypesInterface } from "../../../config/interfaces";
import { companyMeta } from "../../company/entities/company.meta";
import { contentMeta } from "../../content/entities/content.meta";
import { authorMeta, ownerMeta } from "../../user/entities/user.meta";
import { ContentExtensionConfig, CONTENT_EXTENSION_CONFIG } from "../interfaces/content.extension.interface";

@Injectable()
export class ContentCypherService {
  constructor(
    private readonly clsService: ClsService,
    private readonly configService: ConfigService<BaseConfigInterface>,
    @Optional()
    @Inject(CONTENT_EXTENSION_CONFIG)
    private readonly extension?: ContentExtensionConfig,
  ) {}

  private getContentTypes(): string[] {
    const types = this.configService.get<ConfigContentTypesInterface>("contentTypes")?.types ?? [];
    return types.length > 0 ? types : [contentMeta.labelName];
  }

  /** Whether the `author` relationship is matched and returned (default: yes). */
  private get serialiseAuthor(): boolean {
    return this.extension?.serialiseAuthor !== false;
  }

  default(params?: { searchField: string; blockCompanyAndUser?: boolean }): string {
    return `
      MATCH (${contentMeta.nodeName}:${this.getContentTypes().join("|")} ${params ? ` {${params.searchField}: $searchValue}` : ``})
      WHERE ${
        this.extension?.requireTldr
          ? `${contentMeta.nodeName}.tldr IS NOT NULL
      AND ${contentMeta.nodeName}.tldr <> ""
      AND `
          : ``
      }$companyId IS NULL
      OR EXISTS {
        MATCH (${contentMeta.nodeName})-[:BELONGS_TO]-(company)
      }
      WITH ${contentMeta.nodeName}${params?.blockCompanyAndUser ? `` : `, company, currentUser`}
    `;
  }

  /**
   * The `requireTldr` filter as trailing `AND` predicates, for callers that
   * already opened a WHERE clause of their own (e.g. `ContentRepository.findByIds`).
   * Returns an empty string when the filter is disabled (the default).
   */
  tldrFilter(): string {
    if (!this.extension?.requireTldr) return ``;

    return `
        AND ${contentMeta.nodeName}.tldr IS NOT NULL
        AND ${contentMeta.nodeName}.tldr <> ""`;
  }

  /**
   * The Content → owner MATCH clause, driven by `ownerMatchPattern`.
   *
   * Default: `MATCH (content)<-[:PUBLISHED]-(<target>)`.
   *
   * @param params.target - The pattern's node body, e.g. `"content_owner:User"`
   *   (bind an alias) or `":User {id: $ownerId}"` (filter without binding).
   */
  ownerMatch(params: { target: string }): string {
    const pattern = this.extension?.ownerMatchPattern;
    const relationships = pattern?.relationships?.length ? pattern.relationships : ["PUBLISHED"];
    const relationshipTypes = relationships.join("|");

    return pattern?.undirected
      ? `MATCH (${contentMeta.nodeName})-[:${relationshipTypes}]-(${params.target})`
      : `MATCH (${contentMeta.nodeName})<-[:${relationshipTypes}]-(${params.target})`;
  }

  userHasAccess = (params?: { useTotalScore?: boolean }): string => {
    const companyId = this.clsService.get("companyId");
    const userId = this.clsService.get("userId");

    return `
      WITH ${contentMeta.nodeName}${companyId ? `, ${companyMeta.nodeName}` : ``}${userId ? `, currentUser` : ``}${params?.useTotalScore ? `, totalScore` : ``}
    `;
  };

  returnStatement = (params?: { useTotalScore?: boolean }) => {
    // Base MATCH clauses for core relationships
    let query = `
      MATCH (${contentMeta.nodeName})-[:BELONGS_TO]->(${contentMeta.nodeName}_${companyMeta.nodeName}:${companyMeta.labelName})
      ${this.ownerMatch({ target: `${contentMeta.nodeName}_${ownerMeta.nodeName}:${ownerMeta.labelName}` })}`;

    // The author match is OPTIONAL: it traverses the SAME `PUBLISHED` edge as
    // the owner match above, so on package data every row surviving the owner
    // match already resolves it — the row set is unchanged by default. Making
    // it optional stops it from silently dropping every row for apps whose
    // owner edge is not `PUBLISHED` (see `ownerMatchPattern`).
    if (this.serialiseAuthor) {
      query += `
      OPTIONAL MATCH (${contentMeta.nodeName})<-[:PUBLISHED]-(${contentMeta.nodeName}_${authorMeta.nodeName}:${authorMeta.labelName})`;
    }

    // Add OPTIONAL MATCH for extension relationships
    if (this.extension?.additionalRelationships) {
      for (const rel of this.extension.additionalRelationships) {
        // Build relationship pattern based on direction
        // "in" means relationship points TO content: (other)-[:REL]->(content)
        // "out" means relationship points FROM content: (content)-[:REL]->(other)
        const relPattern =
          rel.direction === "in"
            ? `(${contentMeta.nodeName})<-[:${rel.relationship}]-(${contentMeta.nodeName}_${rel.model.nodeName}:${rel.model.labelName})`
            : `(${contentMeta.nodeName})-[:${rel.relationship}]->(${contentMeta.nodeName}_${rel.model.nodeName}:${rel.model.labelName})`;

        query += `
      OPTIONAL MATCH ${relPattern}`;
      }
    }

    // Add the config-driven meta-field clauses (appended verbatim)
    if (this.extension?.metaFields) {
      for (const metaField of this.extension.metaFields) {
        query += `
      ${metaField.optionalMatch}`;
      }
    }

    // Base RETURN clause
    query += `
      RETURN ${contentMeta.nodeName},
        ${contentMeta.nodeName}_${companyMeta.nodeName},
        ${contentMeta.nodeName}_${ownerMeta.nodeName}`;

    if (this.serialiseAuthor) {
      query += `,
        ${contentMeta.nodeName}_${authorMeta.nodeName}`;
    }

    // Add extension relationship nodes to RETURN
    if (this.extension?.additionalRelationships) {
      for (const rel of this.extension.additionalRelationships) {
        query += `,
        ${contentMeta.nodeName}_${rel.model.nodeName}`;
      }
    }

    // Add the config-driven meta-field projections
    if (this.extension?.metaFields) {
      for (const metaField of this.extension.metaFields) {
        query += `,
        ${metaField.returnAlias} AS ${metaField.key}`;
      }
    }

    // Add optional totalScore
    if (params?.useTotalScore) {
      query += `,
        totalScore`;
    }

    return query;
  };
}
