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

  default(params?: { searchField: string; blockCompanyAndUser?: boolean }): string {
    return `
      MATCH (${contentMeta.nodeName}:${this.getContentTypes().join("|")} ${params ? ` {${params.searchField}: $searchValue}` : ``})
      WHERE $companyId IS NULL
      OR EXISTS {
        MATCH (${contentMeta.nodeName})-[:BELONGS_TO]-(company)
      }
      WITH ${contentMeta.nodeName}${params?.blockCompanyAndUser ? `` : `, company, currentUser`}
    `;
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
      MATCH (${contentMeta.nodeName})<-[:PUBLISHED]-(${contentMeta.nodeName}_${ownerMeta.nodeName}:${ownerMeta.labelName})
      MATCH (${contentMeta.nodeName})<-[:PUBLISHED]-(${contentMeta.nodeName}_${authorMeta.nodeName}:${authorMeta.labelName})`;

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

    // Base RETURN clause
    query += `
      RETURN ${contentMeta.nodeName},
        ${contentMeta.nodeName}_${companyMeta.nodeName},
        ${contentMeta.nodeName}_${ownerMeta.nodeName},
        ${contentMeta.nodeName}_${authorMeta.nodeName}`;

    // Add extension relationship nodes to RETURN
    if (this.extension?.additionalRelationships) {
      for (const rel of this.extension.additionalRelationships) {
        query += `,
        ${contentMeta.nodeName}_${rel.model.nodeName}`;
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
