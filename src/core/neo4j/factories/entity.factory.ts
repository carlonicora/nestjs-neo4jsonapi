import { Injectable } from "@nestjs/common";
import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { modelRegistry } from "../../../common/registries/registry";
import { TokenResolverService } from "../services/token-resolver.service";

@Injectable()
export class EntityFactory {
  constructor(private readonly tokenResolverService: TokenResolverService) {}

  createGraphList<T extends DataModelInterface<any>>(params: { model: T; records: any[] }): ReturnType<T["mapper"]>[] {
    const nodeMap = new Map<string, any>();
    const rootEntityIds = new Set<string>();

    for (const record of params.records) {
      const rootEntity = this.createOrMerge({
        model: params.model,
        record,
        name: params.model.nodeName,
        nodeMap,
      });

      if (rootEntity?.id) {
        rootEntityIds.add(rootEntity.id);
      }

      this.processRelationships({
        record,
        nodeMap,
      });
    }

    const prefix = `${params.model.nodeName}#`;
    const finalResults: any[] = [];
    nodeMap.forEach((obj: any, key: string) => {
      if (key.startsWith(prefix) && rootEntityIds.has(obj.id)) {
        finalResults.push(obj);
      }
    });

    return finalResults;
  }

  private processRelationships(params: { record: any; nodeMap: Map<string, any> }): void {
    if (!modelRegistry) return;

    const relationshipFields = params.record.keys.filter(
      (key: string) => key.includes("_") && !["_element", "_node"].some((suffix) => key.endsWith(suffix)),
    );

    for (const fieldName of relationshipFields) {
      const relationship = params.record.get(fieldName);
      if (!relationship || !relationship.type || !relationship.properties) {
        continue;
      }

      const parts = fieldName.split("_");
      if (parts.length < 2) continue;

      const entityType = parts[parts.length - 1];
      const childModel = modelRegistry.get(entityType);

      if (!childModel) continue;

      const relationId = relationship.elementId || `${relationship.identity.low}`;
      const mapKey = `${entityType}#${relationId}`;

      if (params.nodeMap.has(mapKey)) continue;

      const entity = childModel.mapper({
        data: {
          id: relationId,
          ...relationship.properties,
          type: relationship.type,
        },
        record: params.record,
        entityFactory: this,
        name: fieldName,
      });

      params.nodeMap.set(mapKey, entity);

      if (relationship.startNodeElementId) {
        const startParts = relationship.startNodeElementId.split(":");
        const startId = startParts[startParts.length - 1].split("_")[0];
        const startType = this.getNodeTypeFromElementId(relationship.startNodeElementId);

        if (startType) {
          const startModel = modelRegistry.get(startType.toLowerCase());
          if (startModel) {
            const startKey = `${startType.toLowerCase()}#${startId}`;
            const startEntity = params.nodeMap.get(startKey);
            if (startEntity) {
              entity.startNode = startEntity;
            }
          }
        }
      }

      if (relationship.endNodeElementId) {
        const endParts = relationship.endNodeElementId.split(":");
        const endId = endParts[endParts.length - 1].split("_")[0];
        const endType = this.getNodeTypeFromElementId(relationship.endNodeElementId);

        if (endType) {
          const endModel = modelRegistry.get(endType.toLowerCase());
          if (endModel) {
            const endKey = `${endType.toLowerCase()}#${endId}`;
            const endEntity = params.nodeMap.get(endKey);
            if (endEntity) {
              entity.endNode = endEntity;
            }
          }
        }
      }
    }
  }

  private getNodeTypeFromElementId(elementId: string): string | null {
    const parts = elementId.split(":");
    if (parts.length < 2) return null;

    return null;
  }

  private createOrMerge<T extends DataModelInterface<any>>(params: {
    model: T;
    record: any;
    name: string;
    nodeMap: Map<string, any>;
  }): ReturnType<T["mapper"]> | undefined {
    if (!params.record.has(params.name)) return undefined;

    const data = params.record.get(params.name);
    if (!data) return undefined;

    const isNode = data.labels !== undefined;
    const isRelationship = data.type !== undefined && data.properties !== undefined;

    if (!isNode && !isRelationship) return undefined;

    const nodeType = params.model.nodeName;
    let nodeId: string | undefined;
    let mapKey: string | undefined;

    if (isNode) {
      nodeId = data.properties?.id;
      if (!nodeId) return undefined;
      mapKey = `${nodeType}#${nodeId}`;
    } else if (isRelationship) {
      nodeId = data.elementId || `${data.identity.low}`;
      mapKey = `${nodeType}#${nodeId}`;
    }

    if (!mapKey || !nodeId) return undefined;

    let entity = params.nodeMap.get(mapKey);
    if (!entity) {
      if (isNode) {
        entity = params.model.mapper({
          data: {
            ...data.properties,
            labels: data.labels,
          },
          record: params.record,
          entityFactory: this,
          name: params.name,
        });
      } else if (isRelationship) {
        entity = params.model.mapper({
          data: {
            id: nodeId,
            ...data.properties,
            type: data.type,
          },
          record: params.record,
          entityFactory: this,
          name: params.name,
        });
      }

      params.nodeMap.set(mapKey, entity);
    }

    if (!modelRegistry) return entity;

    const model = params.model as any;

    if (model.singleChildrenTokens) {
      for (const token of model.singleChildrenTokens) {
        const childModel = modelRegistry.get(token);
        if (!childModel) continue;

        const childName = `${params.name}_${childModel.nodeName}`;
        const childEntity = this.createOrMerge({
          model: childModel,
          record: params.record,
          name: childName,
          nodeMap: params.nodeMap,
        });

        if (childEntity) {
          entity[childModel.nodeName] = childEntity;
        }
      }
    }

    if (model.childrenTokens) {
      for (const token of model.childrenTokens) {
        const childModel = modelRegistry.get(token);
        if (!childModel) continue;

        const childName = `${params.name}_${childModel.nodeName}`;
        const childEntity = this.createOrMerge({
          model: childModel,
          record: params.record,
          name: childName,
          nodeMap: params.nodeMap,
        });

        if (childEntity) {
          if (!Array.isArray(entity[childModel.nodeName])) {
            entity[childModel.nodeName] = [];
          }
          const already = entity[childModel.nodeName].some((x: any) => x.id === childEntity.id);
          if (!already) {
            entity[childModel.nodeName].push(childEntity);
          }
        }
      }
    }

    // Process edge properties collections for MANY relationships with fields
    this.processEdgePropsCollections({
      entity,
      record: params.record,
      parentName: params.name,
    });

    // Process dynamic patterns
    this.processDynamicTokens({
      model: params.model,
      entity,
      record: params.record,
      parentName: params.name,
      nodeMap: params.nodeMap,
    });

    return entity;
  }

  private processDynamicTokens<T extends DataModelInterface<any>>(params: {
    model: T;
    entity: any;
    record: any;
    parentName: string;
    nodeMap: Map<string, any>;
  }): void {
    if (!modelRegistry) return;

    const availableFields = params.record.keys;
    const model = params.model as any;

    // Process dynamic single children patterns
    if (model.dynamicSingleChildrenPatterns) {
      for (const pattern of model.dynamicSingleChildrenPatterns) {
        const resolved = this.tokenResolverService.resolveDynamicTokens({
          pattern,
          parentName: params.parentName,
          availableFields,
        });

        for (const { model: childModel, fieldName, dynamicPart } of resolved) {
          const childEntity = this.createOrMerge({
            model: childModel,
            record: params.record,
            name: fieldName,
            nodeMap: params.nodeMap,
          });

          if (childEntity) {
            params.entity[dynamicPart] = childEntity;
          }
        }

        // Handle cases where dynamic part doesn't resolve to a specific model
        const regex = this.tokenResolverService.patternToRegex(pattern, params.parentName);

        for (const fieldName of availableFields) {
          const match = fieldName.match(regex);
          if (match && match.groups?.dynamicPart) {
            const dynamicPart = match.groups.dynamicPart;

            // Check if we already processed this via resolved models
            const alreadyProcessed = resolved.some((r) => r.fieldName === fieldName);
            if (!alreadyProcessed && params.record.has(fieldName)) {
              // Try to resolve model based on Neo4j labels
              const data = params.record.get(fieldName);

              if (data) {
                const resolvedModel = this.resolveModelFromLabels(data);

                if (resolvedModel) {
                  // Use the resolved model to create a proper entity
                  const childEntity = this.createOrMerge({
                    model: resolvedModel,
                    record: params.record,
                    name: fieldName,
                    nodeMap: params.nodeMap,
                  });
                  if (childEntity) {
                    // For dynamic children patterns, create array and add to it
                    if (!Array.isArray(params.entity[dynamicPart])) {
                      params.entity[dynamicPart] = [];
                    }
                    const already = params.entity[dynamicPart].some((x: any) => x.id === childEntity.id);
                    if (!already) {
                      params.entity[dynamicPart].push(childEntity);
                    }
                  }
                } else {
                  // Fallback to generic entity
                  if (!Array.isArray(params.entity[dynamicPart])) {
                    params.entity[dynamicPart] = [];
                  }
                  const genericEntity = this.createGenericEntity(data);
                  if (genericEntity) {
                    params.entity[dynamicPart].push(genericEntity);
                  }
                }
              }
            }
          }
        }
      }
    }

    // Process dynamic children patterns
    if (model.dynamicChildrenPatterns) {
      for (const pattern of model.dynamicChildrenPatterns) {
        const resolved = this.tokenResolverService.resolveDynamicTokens({
          pattern,
          parentName: params.parentName,
          availableFields,
        });

        for (const { model: childModel, fieldName, dynamicPart } of resolved) {
          const childEntity = this.createOrMerge({
            model: childModel,
            record: params.record,
            name: fieldName,
            nodeMap: params.nodeMap,
          });

          if (childEntity) {
            // For dynamic children patterns, create array and add to it using dynamicPart
            if (!Array.isArray(params.entity[dynamicPart])) {
              params.entity[dynamicPart] = [];
            }
            const already = params.entity[dynamicPart].some((x: any) => x.id === childEntity.id);
            if (!already) {
              params.entity[dynamicPart].push(childEntity);
            }
          }
        }

        // Handle cases where dynamic part doesn't resolve to a specific model
        const regex = this.tokenResolverService.patternToRegex(pattern, params.parentName);

        for (const fieldName of availableFields) {
          const match = fieldName.match(regex);
          if (match && match.groups?.dynamicPart) {
            const dynamicPart = match.groups.dynamicPart;

            // Check if we already processed this via resolved models
            const alreadyProcessed = resolved.some((r) => r.fieldName === fieldName);
            if (!alreadyProcessed && params.record.has(fieldName)) {
              // Try to resolve model based on Neo4j labels
              const data = params.record.get(fieldName);

              if (data) {
                const resolvedModel = this.resolveModelFromLabels(data);

                if (resolvedModel) {
                  // Use the resolved model to create a proper entity
                  const childEntity = this.createOrMerge({
                    model: resolvedModel,
                    record: params.record,
                    name: fieldName,
                    nodeMap: params.nodeMap,
                  });
                  if (childEntity) {
                    // For dynamic children patterns, create array and add to it
                    if (!Array.isArray(params.entity[dynamicPart])) {
                      params.entity[dynamicPart] = [];
                    }
                    const already = params.entity[dynamicPart].some((x: any) => x.id === childEntity.id);
                    if (!already) {
                      params.entity[dynamicPart].push(childEntity);
                    }
                  }
                } else {
                  // Fallback to generic entity
                  if (!Array.isArray(params.entity[dynamicPart])) {
                    params.entity[dynamicPart] = [];
                  }
                  const genericEntity = this.createGenericEntity(data);
                  if (genericEntity) {
                    params.entity[dynamicPart].push(genericEntity);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  private resolveModelFromLabels(data: any): DataModelInterface<any> | undefined {
    if (!modelRegistry) return undefined;

    if (data && data.labels && Array.isArray(data.labels)) {
      for (const label of data.labels) {
        const model = modelRegistry.resolveModel(label);
        if (model) {
          return model;
        }
      }
    }

    return undefined;
  }

  private createGenericEntity(data: any): any {
    if (!data) return undefined;

    // Handle Neo4j node structure
    if (data.properties !== undefined) {
      return {
        id: data.properties.id,
        ...data.properties,
        labels: data.labels,
      };
    }

    // Handle direct data
    return data;
  }

  /**
   * Process edge properties collections for MANY relationships with fields.
   * Looks for *_edgePropsCollection keys in the record and converts them
   * to EdgeProps maps on the entity.
   */
  private processEdgePropsCollections(params: { entity: any; record: any; parentName: string }): void {
    if (!params.record?.keys) return;

    // Look for edge props collection keys (e.g., "photograph_photographs_edgePropsCollection")
    const collectionSuffix = "_edgePropsCollection";
    const prefix = `${params.parentName}_`;

    for (const key of params.record.keys) {
      if (key.startsWith(prefix) && key.endsWith(collectionSuffix)) {
        // Extract relationship name from key
        // e.g., "contactsheet_photographs_edgePropsCollection" -> "photographs"
        const relNameWithSuffix = key.slice(prefix.length);
        const relName = relNameWithSuffix.slice(0, -collectionSuffix.length);

        const collection = params.record.get(key);
        if (!collection || !Array.isArray(collection)) continue;

        // Build edge props map from collection
        const edgePropsMap: Record<string, Record<string, any>> = {};
        for (const item of collection) {
          if (item?.nodeId && item?.edgeProps) {
            edgePropsMap[item.nodeId] = item.edgeProps;
          }
        }

        // Store on entity
        if (Object.keys(edgePropsMap).length > 0) {
          params.entity[`${relName}EdgeProps`] = edgePropsMap;
        }
      }
    }
  }
}
