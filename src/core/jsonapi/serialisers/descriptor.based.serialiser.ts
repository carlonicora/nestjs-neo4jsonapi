import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { BaseConfigInterface } from "../../../config/interfaces";
import { EntityDescriptor, RelationshipDef } from "../../../common/interfaces/entity.schema.interface";
import { modelRegistry } from "../../../common/registries/registry";
import { AbstractJsonApiSerialiser } from "../abstracts/abstract.jsonapi.serialiser";
import { JsonApiSerialiserFactory } from "../factories/jsonapi.serialiser.factory";
import { PolymorphicRelationshipFactory } from "../factories/polymorphic.relationship.factory";
import { JsonApiDataInterface } from "../interfaces/jsonapi.data.interface";
import { JsonApiServiceInterface } from "../interfaces/jsonapi.service.interface";

/**
 * Base class for auto-generated serialisers from EntityDescriptor.
 * Derives attributes, meta, and relationships from the descriptor configuration.
 *
 * Subclasses should call `setDescriptor()` in their constructor.
 */
@Injectable()
export class DescriptorBasedSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  protected descriptor: EntityDescriptor<any, any>;
  protected injectedServices: Record<string, any> = {};

  constructor(
    serialiserFactory: JsonApiSerialiserFactory,
    protected readonly moduleRef: ModuleRef,
    configService: ConfigService<BaseConfigInterface>,
  ) {
    super(serialiserFactory, configService);
  }

  /**
   * Set the descriptor and inject required services.
   * Must be called by subclasses in their constructor.
   */
  protected setDescriptor(descriptor: EntityDescriptor<any, any>): void {
    this.descriptor = descriptor;

    // Inject requested services using ModuleRef
    for (const ServiceClass of descriptor.injectServices || []) {
      try {
        this.injectedServices[ServiceClass.name] = this.moduleRef.get(ServiceClass, { strict: false });
      } catch {
        // Service not available - transformer will receive undefined
        console.warn(`Service ${ServiceClass.name} not available for injection in serialiser`);
      }
    }
  }

  get type(): string {
    return this.descriptor.model.type;
  }

  create(): JsonApiDataInterface {
    // 1. Build attributes from fields (non-meta, non-excluded, not serialise:false)
    const attributes: Record<string, any> = {};
    for (const [fieldName, fieldDef] of Object.entries(this.descriptor.fields || {})) {
      if (fieldDef.serialise === false) continue;
      if (!fieldDef.meta && !fieldDef.excludeFromJsonApi) {
        if (fieldDef.transform) {
          // Wrap transformer with injected services
          const transformer = fieldDef.transform;
          const services = this.injectedServices;
          attributes[fieldName] = async (data: any) => {
            return await transformer(data, services);
          };
        } else {
          // Direct mapping
          attributes[fieldName] = fieldName;
        }
      }
    }
    // 1b. Add virtual fields to attributes (or meta if specified, not excluded)
    for (const [fieldName, virtualDef] of Object.entries(this.descriptor.virtualFields || {})) {
      if (!virtualDef.meta && !virtualDef.excludeFromJsonApi) {
        // Virtual field value already computed by mapper, direct mapping
        attributes[fieldName] = fieldName;
      }
    }
    this.attributes = attributes;

    // 2. Build meta from fields + computed (where meta: true, not excluded, not serialise:false)
    const meta: Record<string, any> = {};
    for (const [fieldName, fieldDef] of Object.entries(this.descriptor.fields || {})) {
      if (fieldDef.serialise === false) continue;
      if (fieldDef.meta && !fieldDef.excludeFromJsonApi) {
        if (fieldDef.transform) {
          const transformer = fieldDef.transform;
          const services = this.injectedServices;
          meta[fieldName] = async (data: any) => {
            return await transformer(data, services);
          };
        } else {
          meta[fieldName] = fieldName;
        }
      }
    }
    for (const [fieldName, computedDef] of Object.entries(this.descriptor.computed || {})) {
      if (computedDef.meta && !computedDef.excludeFromJsonApi) {
        // Computed value already calculated by mapper
        meta[fieldName] = fieldName;
      }
    }
    // Add virtual fields with meta: true to meta section (not excluded)
    for (const [fieldName, virtualDef] of Object.entries(this.descriptor.virtualFields || {})) {
      if (virtualDef.meta && !virtualDef.excludeFromJsonApi) {
        meta[fieldName] = fieldName;
      }
    }
    this.meta = meta;

    // 3. Build relationships - resolve Models from registry at serialisation time
    const relationships: Record<string, any> = {};
    for (const [relName, relDef] of Object.entries(this.descriptor.relationships) as [string, RelationshipDef][]) {
      // Get the related model from registry using nodeName
      // Resolve by JSON:API type first — it is the registry's UNIQUE key.
      // nodeName collides across modules (e.g. proceedings vs portal-proceedings
      // both use nodeName "proceeding"), and get(nodeName) returns whichever
      // module registered last.
      const relatedModel = modelRegistry.getByType(relDef.model.type) ?? modelRegistry.get(relDef.model.nodeName);
      if (relatedModel) {
        const relationship: any = {
          data: this.serialiserFactory.create(relatedModel),
        };
        // Use dtoKey if provided (e.g., 'topics' instead of 'topic')
        if (relDef.dtoKey && relDef.dtoKey !== relName) {
          relationship.name = relDef.dtoKey;
        }
        // Register serializers for polymorphic candidate models and set up dynamic factory
        if (relDef.polymorphic) {
          for (const candidateMeta of relDef.polymorphic.candidates) {
            const candidateModel =
              modelRegistry.getByType(candidateMeta.type) ?? modelRegistry.get(candidateMeta.nodeName);
            if (candidateModel) {
              this.serialiserFactory.create(candidateModel);
            }
          }
          // Create dynamic factory for polymorphic relationships
          relationship.dynamicFactory = new PolymorphicRelationshipFactory(this.serialiserFactory, relDef.polymorphic);
        }
        // Add relationship meta for edge properties (stored on the relationship)
        if (relDef.fields && relDef.fields.length > 0) {
          if (relDef.cardinality === "one") {
            // SINGLE relationship: use relationship-level meta (existing behavior)
            relationship.meta = {};
            for (const field of relDef.fields) {
              // Maps entity property (populated by computed field) to relationship meta
              relationship.meta[field.name] = field.name;
            }
          } else {
            // MANY relationship: use per-item meta
            relationship.perItemMeta = true;
            relationship.edgePropsKey = `${relName}EdgeProps`;
            relationship.edgeFields = relDef.fields;
          }
        }
        relationships[relName] = relationship;
      }
    }
    this.relationships = relationships;

    return super.create();
  }
}
