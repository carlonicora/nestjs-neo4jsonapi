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
  /**
   * Resolved lazily by `resolveInjectedServices()` — NEVER populate this in the
   * constructor. See the comment there for why.
   */
  private resolvedServices?: Record<string, any>;

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
    // NOTE: `descriptor.injectServices` are deliberately NOT resolved here.
    // See resolveInjectedServices().
  }

  /**
   * Resolve `injectServices` on FIRST USE, never at construction time.
   *
   * WHY THIS IS LAZY — this is load-bearing, do not inline it back into
   * setDescriptor(). setDescriptor() runs from a subclass CONSTRUCTOR, i.e.
   * while Nest is still instantiating the provider graph. `ModuleRef.get()`
   * does not participate in that graph: it returns whatever currently sits in
   * the target provider's InstanceWrapper. Nest pre-fills every wrapper with a
   * PLACEHOLDER before anything is constructed (instance-wrapper.js):
   *
   *   instancePerContext.instance = Object.create(this.metatype.prototype);
   *
   * and then, when it really instantiates the provider, it REPLACES that
   * object rather than filling it in (injector.js, instantiateClass):
   *
   *   instanceHost.instance = wrapper.forwardRef
   *     ? Object.assign(instanceHost.instance, new metatype(...instances))
   *     : new metatype(...instances);
   *
   * So a serialiser constructed BEFORE its injected service captured the
   * placeholder — an object with the right prototype and ZERO own properties.
   * Every constructor-injected field on it (configService, logger, …) read as
   * undefined, while every other consumer of the same service worked fine,
   * because they held the replacement object. Whether it broke came down to
   * provider instantiation order, so it surfaced as an unrelated dependency
   * bump silently reordering the graph.
   *
   * Resolving here instead means the lookup happens on the first serialisation
   * — long after the whole graph is constructed — so it always returns the
   * real instance.
   */
  protected resolveInjectedServices(): Record<string, any> {
    if (this.resolvedServices) return this.resolvedServices;

    const services: Record<string, any> = {};
    for (const ServiceClass of this.descriptor.injectServices || []) {
      try {
        services[ServiceClass.name] = this.moduleRef.get(ServiceClass, { strict: false });
      } catch {
        // Service not available - transformer will receive undefined
        console.warn(`Service ${ServiceClass.name} not available for injection in serialiser`);
      }
    }
    this.resolvedServices = services;
    return services;
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
          const services = this.resolveInjectedServices();
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
          const services = this.resolveInjectedServices();
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
      } else {
        // A missing registry entry silently drops the whole relationship from
        // every response — make the failure visible.
        console.warn(
          `[DescriptorBasedSerialiser] relationship "${relName}" of "${this.descriptor.model?.type ?? "?"}" dropped: ` +
            `no model registered for type "${relDef.model.type}" / nodeName "${relDef.model.nodeName}"`,
        );
      }
    }
    this.relationships = relationships;

    return super.create();
  }
}
