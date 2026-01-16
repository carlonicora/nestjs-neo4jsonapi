import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { modelRegistry } from "../../../common/registries/registry";
import { BaseConfigInterface } from "../../../config/interfaces";
import { AbstractJsonApiSerialiser } from "../../../core/jsonapi/abstracts/abstract.jsonapi.serialiser";
import { JsonApiSerialiserFactory } from "../../../core/jsonapi/factories/jsonapi.serialiser.factory";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiServiceInterface } from "../../../core/jsonapi/interfaces/jsonapi.service.interface";
import { ContentModel } from "../../content/entities/content.model";
import { OwnerDescriptor, AuthorDescriptor } from "../../user/entities/user";
import { ContentExtensionConfig, CONTENT_EXTENSION_CONFIG } from "../interfaces/content.extension.interface";

@Injectable()
export class ContentSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(
    serialiserFactory: JsonApiSerialiserFactory,
    configService: ConfigService<BaseConfigInterface>,
    @Optional()
    @Inject(CONTENT_EXTENSION_CONFIG)
    private readonly extension?: ContentExtensionConfig,
  ) {
    super(serialiserFactory, configService);
  }

  get type(): string {
    return ContentModel.endpoint;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      name: "name",
      abstract: "abstract",
      tldr: "tldr",
    };

    this.meta = {
      aiStatus: "aiStatus",
      relevance: "relevance",
      contentType: "contentType",
    };

    this.relationships = {
      owner: {
        data: this.serialiserFactory.create(OwnerDescriptor.model),
      },
      author: {
        data: this.serialiserFactory.create(AuthorDescriptor.model),
      },
    };

    // Add extension relationships
    if (this.extension?.additionalRelationships) {
      for (const rel of this.extension.additionalRelationships) {
        const relatedModel = modelRegistry.get(rel.model.nodeName);
        if (relatedModel) {
          const relationship: Record<string, any> = {
            data: this.serialiserFactory.create(relatedModel),
          };
          // Use dtoKey for JSON:API relationship name if provided
          if (rel.dtoKey) {
            relationship.name = rel.dtoKey;
          }
          this.relationships[rel.model.nodeName] = relationship;
        }
      }
    }

    return super.create();
  }
}
