import { describe, it, expect, vi } from "vitest";
import { ApiJsonApiResponse } from "../api-jsonapi-response.decorator";
import { EntityDescriptor, RelationshipDef } from "../../../common/interfaces/entity.schema.interface";

// Mock @nestjs/swagger decorators
vi.mock("@nestjs/swagger", () => ({
  ApiOkResponse: vi.fn((options) => {
    return (target: any, propertyKey: string) => {
      if (!target.__apiResponses) target.__apiResponses = [];
      target.__apiResponses.push({ type: "ok", ...options });
    };
  }),
  ApiCreatedResponse: vi.fn((options) => {
    return (target: any, propertyKey: string) => {
      if (!target.__apiResponses) target.__apiResponses = [];
      target.__apiResponses.push({ type: "created", ...options });
    };
  }),
  ApiNoContentResponse: vi.fn((options) => {
    return (target: any, propertyKey: string) => {
      if (!target.__apiResponses) target.__apiResponses = [];
      target.__apiResponses.push({ type: "noContent", ...options });
    };
  }),
}));

// Mock @nestjs/common
vi.mock("@nestjs/common", () => ({
  applyDecorators: vi.fn((...decorators) => {
    return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
      decorators.forEach((decorator) => decorator(target, propertyKey, descriptor));
      return descriptor;
    };
  }),
}));

// Mock entity descriptor for testing
const mockDescriptor: EntityDescriptor<any, Record<string, RelationshipDef>> = {
  model: {
    type: "photographs",
    endpoint: "photographs",
    nodeName: "photograph",
    labelName: "Photograph",
    childrenTokens: [],
    mapper: {} as any,
  },
  isCompanyScoped: true,
  relationships: {},
  relationshipKeys: {},
  fieldNames: ["title"],
  stringFields: ["title"],
  requiredFields: ["title"],
  fieldDefaults: {},
  fields: {
    title: { type: "string", required: true },
  },
  computed: {},
  injectServices: [],
  constraints: [],
  indexes: [],
};

describe("api-jsonapi-response.decorator", () => {
  describe("ApiJsonApiResponse", () => {
    it("should be a function", () => {
      expect(typeof ApiJsonApiResponse).toBe("function");
    });

    it("should return a MethodDecorator", () => {
      const decorator = ApiJsonApiResponse(mockDescriptor);
      expect(typeof decorator).toBe("function");
    });

    describe("single resource response", () => {
      it("should create schema with correct structure", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiResponse(mockDescriptor);
        decorator(target, "findById", {} as PropertyDescriptor);

        const response = target.__apiResponses[0];
        expect(response.type).toBe("ok");
        expect(response.schema.properties.data.$ref).toBe("#/components/schemas/Photographs");
      });

      it("should include links and included in response", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiResponse(mockDescriptor);
        decorator(target, "findById", {} as PropertyDescriptor);

        const response = target.__apiResponses[0];
        expect(response.schema.properties.links.$ref).toBe("#/components/schemas/JsonApiLinks");
        expect(response.schema.properties.included).toBeDefined();
      });

      it("should have data as required field", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiResponse(mockDescriptor);
        decorator(target, "findById", {} as PropertyDescriptor);

        const response = target.__apiResponses[0];
        expect(response.schema.required).toContain("data");
      });

      it("should generate default description for single resource", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiResponse(mockDescriptor);
        decorator(target, "findById", {} as PropertyDescriptor);

        const response = target.__apiResponses[0];
        expect(response.description).toBe("Returns a single photograph");
      });
    });

    describe("collection response", () => {
      it("should create array schema when isList is true", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiResponse(mockDescriptor, { isList: true });
        decorator(target, "findAll", {} as PropertyDescriptor);

        const response = target.__apiResponses[0];
        expect(response.schema.properties.data.type).toBe("array");
        expect(response.schema.properties.data.items.$ref).toBe("#/components/schemas/Photographs");
      });

      it("should include meta with pagination for collection", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiResponse(mockDescriptor, { isList: true });
        decorator(target, "findAll", {} as PropertyDescriptor);

        const response = target.__apiResponses[0];
        expect(response.schema.properties.meta.$ref).toBe("#/components/schemas/JsonApiPaginationMeta");
      });

      it("should generate default description for collection", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiResponse(mockDescriptor, { isList: true });
        decorator(target, "findAll", {} as PropertyDescriptor);

        const response = target.__apiResponses[0];
        expect(response.description).toBe("Returns a list of photographs");
      });
    });

    describe("created response (201)", () => {
      it("should use ApiCreatedResponse when status is 201", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiResponse(mockDescriptor, { status: 201 });
        decorator(target, "create", {} as PropertyDescriptor);

        const response = target.__apiResponses[0];
        expect(response.type).toBe("created");
      });
    });

    describe("no content response (204)", () => {
      it("should use ApiNoContentResponse when noContent is true", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiResponse(mockDescriptor, { noContent: true });
        decorator(target, "delete", {} as PropertyDescriptor);

        const response = target.__apiResponses[0];
        expect(response.type).toBe("noContent");
      });

      it("should have default description for no content", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiResponse(mockDescriptor, { noContent: true });
        decorator(target, "delete", {} as PropertyDescriptor);

        const response = target.__apiResponses[0];
        expect(response.description).toBe("Operation completed successfully");
      });
    });

    describe("custom description", () => {
      it("should use custom description when provided", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiResponse(mockDescriptor, {
          description: "Custom description for endpoint",
        });
        decorator(target, "findById", {} as PropertyDescriptor);

        const response = target.__apiResponses[0];
        expect(response.description).toBe("Custom description for endpoint");
      });
    });

    describe("PascalCase conversion", () => {
      it("should convert kebab-case type to PascalCase", () => {
        const kebabDescriptor = {
          ...mockDescriptor,
          model: {
            ...mockDescriptor.model,
            type: "photo-albums",
          },
        };
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiResponse(kebabDescriptor);
        decorator(target, "findById", {} as PropertyDescriptor);

        const response = target.__apiResponses[0];
        expect(response.schema.properties.data.$ref).toBe("#/components/schemas/PhotoAlbums");
      });

      it("should convert snake_case type to PascalCase", () => {
        const snakeDescriptor = {
          ...mockDescriptor,
          model: {
            ...mockDescriptor.model,
            type: "photo_albums",
          },
        };
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiResponse(snakeDescriptor);
        decorator(target, "findById", {} as PropertyDescriptor);

        const response = target.__apiResponses[0];
        expect(response.schema.properties.data.$ref).toBe("#/components/schemas/PhotoAlbums");
      });
    });
  });
});
