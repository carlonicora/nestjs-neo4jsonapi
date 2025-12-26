import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigApiInterface } from "../../../config/interfaces";
import { DataModelInterface, JsonApiSerialiserFactory } from "../factories/jsonapi.serialiser.factory";
import { JsonApiDataInterface } from "../interfaces/jsonapi.data.interface";
import { JsonApiPaginator } from "../serialisers/jsonapi.paginator";
import { JsonApiIncludedFields } from "../types/JsonApiIncludedFields";

export interface LoggingService {
  error(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  log(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

@Injectable()
export class JsonApiService {
  constructor(
    private readonly serialiserFactory: JsonApiSerialiserFactory,
    private readonly clsService: ClsService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {}

  private get apiConfig(): ConfigApiInterface {
    return this.configService.get<ConfigApiInterface>("api");
  }

  async buildSingle<T extends DataModelInterface<any>>(model: T, record: any): Promise<any> {
    const builder = this.serialiserFactory.create(model) as any;
    if (!record) throw new HttpException(`not found`, HttpStatus.NOT_FOUND);

    if (typeof record[`${builder.id}`] === "string")
      return await this.serialise(
        record,
        builder.create(),
        `${this.apiConfig.url}${builder.endpoint}/${record[`${builder.id}`]}`,
      );

    return await this.serialise(
      record,
      builder.create(),
      `${this.apiConfig.url}${builder.endpoint}/${record[`${builder.id}`]}`,
    );
  }

  async buildList<T extends DataModelInterface<any>>(
    model: T,
    records: any[],
    paginator?: JsonApiPaginator,
  ): Promise<any> {
    const builder = this.serialiserFactory.create(model) as any;

    // Use request URL from CLS if available, fallback to model endpoint
    const requestUrl = this.clsService?.get("requestUrl");
    const url = requestUrl || `${this.apiConfig.url}${builder.endpoint}${builder.endpointParameters}`;

    return await this.serialise(records, builder.create(), url, paginator);
  }

  private _addToIncluded(includedElements: any[], newElements: any[], paginator?: JsonApiPaginator) {
    const uniqueIdentifiers = new Set(includedElements.map((e) => `${e.type}-${e.id}`));

    newElements.forEach((element) => {
      // If include parameter was explicitly specified, filter based on includedType
      if (paginator && paginator.includeSpecified) {
        if (!paginator.includedType.includes(element.type)) {
          return; // Filter out types not in the include parameter
        }
      }
      // If include not specified, allow all types (default behavior)

      const identifier = `${element.type}-${element.id}`;

      if (!uniqueIdentifiers.has(identifier)) {
        includedElements.push(element);
        uniqueIdentifiers.add(identifier);
      }
    });
  }

  async serialise<T, R extends JsonApiDataInterface>(
    data: T | T[],
    builder: R,
    url: string,
    paginator?: JsonApiPaginator,
  ): Promise<JsonApiDataInterface> {
    const response: any = {
      links: {
        self: url,
      },
      data: undefined,
    };

    if (paginator && Array.isArray(data)) {
      if (url) {
        const links = paginator.generateLinks(data, url);
        response.links.self = links.self;
        if (links.next) response.links.next = links.next;
        if (links.previous) response.links.prev = links.previous;
      } else {
        delete response.links;
      }
    }

    const included: any[] = [];

    if (Array.isArray(data)) {
      const serialisedResults = await Promise.all(data.map((item: T) => this.serialiseData(item, builder, paginator)));

      response.data = serialisedResults.map((result) => result.serialisedData);

      this._addToIncluded(
        included,
        ([] as any[]).concat(...serialisedResults.map((result) => result.includedElements)),
        paginator,
      );
    } else {
      const { serialisedData, includedElements } = await this.serialiseData(data, builder, paginator);
      response.data = serialisedData;
      this._addToIncluded(included, includedElements, paginator);
    }

    if (included.length > 0) response.included = included;

    return response;
  }

  private async serialiseData<T, R extends JsonApiDataInterface>(
    data: T,
    builder: R,
    paginator?: JsonApiPaginator,
  ): Promise<{
    serialisedData: any | any[];
    includedElements: any[];
  }> {
    const includedElements: any[] = [];
    const serialisedData: any = {
      type: builder.type,
    };

    if (typeof builder.id === "function") {
      serialisedData.id = builder.id(data);
    } else {
      serialisedData.id = (data as any)[builder.id];
    }

    if (builder.links) {
      serialisedData.links = {
        self: builder.links.self(data),
      };
    }

    serialisedData.attributes = {};

    for (const attribute of Object.keys(builder.attributes)) {
      let includedField;
      if (paginator) {
        includedField = paginator.includedFields.find(
          (includedField: JsonApiIncludedFields) => includedField.type === builder.type,
        );
      }
      if (!paginator || !includedField || (includedField && includedField.fields.includes(attribute))) {
        if (typeof builder.attributes[attribute] === "function") {
          serialisedData.attributes[attribute] = await builder.attributes[attribute](data);
        } else {
          serialisedData.attributes[attribute] = (data as any)[attribute];
        }
      }
    }

    if (builder.meta) {
      serialisedData.meta = {};
      for (const meta of Object.keys(builder.meta)) {
        if (typeof builder.meta[meta] === "function") {
          serialisedData.meta[meta] = await builder.meta[meta](data);
        } else {
          serialisedData.meta[meta] = (data as any)[meta];
        }
      }
    }

    if (builder.relationships) {
      serialisedData.relationships = {};

      for (const [key, relationship] of Object.entries(builder.relationships)) {
        let resourceLinkage: any = {};
        const manyToManyRelationships = key.split("__");

        if (relationship.resourceIdentifier) {
          const minimalData: any = {
            type: relationship.resourceIdentifier.type,
          };

          try {
            if (typeof relationship.resourceIdentifier.id === "function") {
              minimalData.id = relationship.resourceIdentifier.id(data);
            } else {
              minimalData.id = (data as any)[relationship.resourceIdentifier.id];
            }

            resourceLinkage = {
              data: minimalData,
            };
            if (relationship.links && relationship.links.related) {
              resourceLinkage.links = {
                related: relationship.links.related(data),
              };
            }

            serialisedData.relationships[relationship.name ?? key] = resourceLinkage;
          } catch (e) {
            console.error(e);
          }
        } else if ((data as any)[key]) {
          const { minimalData, relationshipLink, additionalIncludeds } = await this.serialiseRelationship(
            (data as any)[key],
            await relationship.data?.create(),
            paginator,
            relationship,
            data, // Pass parent entity for per-item meta access
          );

          resourceLinkage = relationship.forceSingle === true ? { data: minimalData[0] } : { data: minimalData };

          if (relationshipLink) {
            resourceLinkage.links = relationshipLink;
          } else if (relationship.links && relationship.links.related) {
            resourceLinkage.links = {
              related: relationship.links.related(data),
            };
          }

          // Add relationship meta (for edge properties like position)
          if (relationship.meta) {
            resourceLinkage.meta = {};
            for (const metaKey of Object.keys(relationship.meta)) {
              if (typeof relationship.meta[metaKey] === "function") {
                resourceLinkage.meta[metaKey] = await relationship.meta[metaKey](data);
              } else {
                resourceLinkage.meta[metaKey] = (data as any)[relationship.meta[metaKey]];
              }
            }
          }

          if (!relationship.excluded && additionalIncludeds.length > 0) includedElements.push(...additionalIncludeds);

          serialisedData.relationships[relationship.name ?? key] = resourceLinkage;
        } else if (
          manyToManyRelationships.length > 1 &&
          (data as any)[manyToManyRelationships[0]] !== undefined &&
          (data as any)[manyToManyRelationships[0]].length > 0
        ) {
          serialisedData.relationships[relationship.name ?? key] = { data: [] };
          for (const item of (data as any)[manyToManyRelationships[0]]) {
            const { minimalData, additionalIncludeds } = await this.serialiseRelationship(
              item[manyToManyRelationships[1]],
              await relationship.data?.create(),
              paginator,
              relationship,
              item, // Pass parent item for per-item meta access
            );

            if (!relationship.excluded && additionalIncludeds.length > 0) includedElements.push(...additionalIncludeds);

            if (relationship.forceSingle === true) {
              serialisedData.relationships[relationship.name ?? key] = {
                data: minimalData,
              };
            } else {
              serialisedData.relationships[relationship.name ?? key].data.push(minimalData);
            }
          }
        } else if (relationship.links && relationship.links.related) {
          const related = relationship.links.related(data);

          if (related) {
            resourceLinkage.links = {
              related: related,
            };
            serialisedData.relationships[relationship.name ?? key] = resourceLinkage;
          }
        }
      }

      if (Object.keys(serialisedData.relationships).length === 0) delete serialisedData.relationships;
    }

    return {
      serialisedData: serialisedData,
      includedElements: includedElements,
    };
  }

  private async serialiseRelationship<T, R extends JsonApiDataInterface>(
    data: T | T[],
    builder: R,
    paginator?: JsonApiPaginator,
    relationship?: any,
    parentEntity?: any,
  ): Promise<{
    minimalData: any | any[];
    relationshipLink: any;
    additionalIncludeds: any[];
  }> {
    const response: {
      minimalData: any;
      relationshipLink: any;
      additionalIncludeds: any[];
    } = {
      minimalData: undefined as any,
      relationshipLink: undefined as any,
      additionalIncludeds: [],
    };

    if (Array.isArray(data)) {
      // Check if this relationship has a dynamic factory
      if (relationship?.dynamicFactory) {
        const serialisedResults = await Promise.all(
          data.map(async (item: T) => {
            try {
              const dynamicSerializer = relationship.dynamicFactory.createDynamicRelationship(item);
              const dynamicBuilder = dynamicSerializer ? await dynamicSerializer.create() : null;
              const actualBuilder = dynamicBuilder || builder;
              return this.serialiseData(item, actualBuilder, paginator);
            } catch (error) {
              throw error;
            }
          }),
        );

        const serialisedData = serialisedResults.map((result) => result.serialisedData);
        const includedElements = serialisedResults.map((result) => result.includedElements).flat();

        response.minimalData = this.buildMinimalDataWithPerItemMeta(serialisedData, relationship, parentEntity);

        this._addToIncluded(response.additionalIncludeds, includedElements.concat(serialisedData));
      } else {
        // Use Promise.all to handle async operations within map (original logic)
        const serialisedResults = await Promise.all(
          data.map((item: T) => this.serialiseData(item, builder, paginator)),
        );

        const serialisedData = serialisedResults.map((result) => result.serialisedData);

        const includedElements = serialisedResults.map((result) => result.includedElements).flat();

        response.minimalData = this.buildMinimalDataWithPerItemMeta(serialisedData, relationship, parentEntity);

        this._addToIncluded(response.additionalIncludeds, includedElements.concat(serialisedData));
      }
    } else {
      const { serialisedData, includedElements } = await this.serialiseData(data, builder, paginator);

      response.minimalData = {
        type: serialisedData.type,
        id: serialisedData.id,
      };

      if (serialisedData.links) {
        response.relationshipLink = {
          self: serialisedData.links.self,
        };
      }

      this._addToIncluded(response.additionalIncludeds, [...includedElements, serialisedData]);
    }

    return response;
  }

  /**
   * Build minimal data array with per-item meta for MANY relationships with edge properties.
   * If the relationship has perItemMeta flag, adds meta from the EdgePropsMap to each item.
   */
  private buildMinimalDataWithPerItemMeta(serialisedData: any[], relationship?: any, parentEntity?: any): any[] {
    if (relationship?.perItemMeta && relationship?.edgePropsKey && parentEntity) {
      const edgePropsMap = parentEntity[relationship.edgePropsKey];
      return serialisedData.map((result) => {
        const minData: any = { type: result.type, id: result.id };
        if (edgePropsMap && edgePropsMap[result.id] && relationship.edgeFields) {
          minData.meta = {};
          for (const field of relationship.edgeFields) {
            if (edgePropsMap[result.id][field.name] !== undefined) {
              minData.meta[field.name] = edgePropsMap[result.id][field.name];
            }
          }
        }
        return minData;
      });
    }

    // Default behavior: return type and id only
    return serialisedData.map((result) => ({ type: result.type, id: result.id }));
  }
}
