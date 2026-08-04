import { DynamicModule, Inject, Module, OnModuleInit } from "@nestjs/common";
import { EntityDescriptor, RelationshipDef } from "../../common/interfaces/entity.schema.interface";
import { modelRegistry } from "../../common/registries/registry";
import { RelevancyModule } from "../relevancy/relevancy.module";
import { ContentController } from "./controllers/content.controller";
import { buildContentDescriptor, Content } from "./entities/content";
import {
  ContentExtensionConfig,
  CONTENT_DESCRIPTOR,
  CONTENT_EXTENSION_CONFIG,
} from "./interfaces/content.extension.interface";
import { ContentRepository } from "./repositories/content.repository";
import { ContentCypherService } from "./services/content.cypher.service";
import { ContentService } from "./services/content.service";

/**
 * ContentModule - Configurable module for Content management.
 *
 * Supports optional extension via ContentExtensionConfig. The configuration
 * shapes both the entity descriptor and the generated Cypher:
 * - `additionalRelationships` — extra relationships on the descriptor, an
 *   OPTIONAL MATCH per relationship, and the related node in the RETURN
 * - `ownerMatchPattern` — the owner edge's relationship types / direction
 * - `requireTldr` — restricts reads to records carrying a non-empty tldr
 * - `metaFields` — extra computed meta keys hydrated by extra OPTIONAL MATCHes
 * - `serialiseAuthor` — whether the `author` relationship exists at all
 *
 * With no configuration the module behaves exactly as it always has.
 *
 * The module is `global: true` so `ContentCypherService` can be handed to
 * RelevancyService from any module. It is nonetheless excludable from the
 * foundations composition by class reference
 * (`FoundationsModule.forRoot({ exclude: [ContentModule] })`).
 *
 * @example
 * ```typescript
 * // Without extension (default behavior)
 * ContentModule.forRoot()
 *
 * // With extension
 * ContentModule.forRoot({
 *   additionalRelationships: [
 *     { model: topicMeta, relationship: 'HAS_KNOWLEDGE', direction: 'in', cardinality: 'many' },
 *   ],
 * })
 * ```
 */
@Module({})
export class ContentModule implements OnModuleInit {
  constructor(
    @Inject(CONTENT_DESCRIPTOR)
    private readonly descriptor: EntityDescriptor<Content, Record<string, RelationshipDef>>,
  ) {}

  /**
   * Configure ContentModule with optional extension.
   *
   * @param extension - Optional configuration for the Content descriptor and Cypher
   * @returns DynamicModule configured with extension support
   */
  static forRoot(extension?: ContentExtensionConfig): DynamicModule {
    // The descriptor is built ONCE here so that the serialiser class provided
    // to the container is the very class carried by the model registered in
    // onModuleInit (JsonApiSerialiserFactory resolves it through ModuleRef).
    const descriptor = buildContentDescriptor(extension);

    return {
      module: ContentModule,
      global: true, // Make module global so ContentCypherService is available to other modules
      controllers: [ContentController],
      providers: [
        {
          provide: CONTENT_EXTENSION_CONFIG,
          useValue: extension,
        },
        {
          provide: CONTENT_DESCRIPTOR,
          useValue: descriptor,
        },
        descriptor.model.serialiser,
        ContentRepository,
        ContentService,
        ContentCypherService,
      ],
      exports: [ContentCypherService, CONTENT_EXTENSION_CONFIG, CONTENT_DESCRIPTOR],
      imports: [RelevancyModule],
    };
  }

  onModuleInit() {
    modelRegistry.register(this.descriptor.model);
  }
}
