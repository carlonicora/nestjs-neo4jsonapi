import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ApiJsonApiListQuery,
  ApiJsonApiInclude,
  ApiJsonApiPagination,
  ApiJsonApiFilter,
} from "../api-jsonapi-query.decorator";

// Store captured ApiQuery calls
let capturedQueries: any[] = [];

// Mock @nestjs/swagger decorators
vi.mock("@nestjs/swagger", () => ({
  ApiQuery: vi.fn((options) => {
    return (target: any, propertyKey: string) => {
      capturedQueries.push(options);
      if (!target.__apiQueries) target.__apiQueries = [];
      target.__apiQueries.push(options);
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

describe("api-jsonapi-query.decorator", () => {
  beforeEach(() => {
    capturedQueries = [];
  });

  describe("ApiJsonApiListQuery", () => {
    it("should be a function", () => {
      expect(typeof ApiJsonApiListQuery).toBe("function");
    });

    it("should return a MethodDecorator", () => {
      const decorator = ApiJsonApiListQuery();
      expect(typeof decorator).toBe("function");
    });

    it("should add page[offset] query parameter", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiListQuery();
      decorator(target, "findAll", {} as PropertyDescriptor);

      const offsetQuery = target.__apiQueries.find((q: any) => q.name === "page[offset]");
      expect(offsetQuery).toBeDefined();
      expect(offsetQuery.type).toBe(Number);
      expect(offsetQuery.required).toBe(false);
      expect(offsetQuery.example).toBe(0);
    });

    it("should add page[size] query parameter", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiListQuery();
      decorator(target, "findAll", {} as PropertyDescriptor);

      const sizeQuery = target.__apiQueries.find((q: any) => q.name === "page[size]");
      expect(sizeQuery).toBeDefined();
      expect(sizeQuery.type).toBe(Number);
      expect(sizeQuery.required).toBe(false);
      expect(sizeQuery.example).toBe(20);
    });

    it("should add orderBy query parameter", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiListQuery();
      decorator(target, "findAll", {} as PropertyDescriptor);

      const orderByQuery = target.__apiQueries.find((q: any) => q.name === "orderBy");
      expect(orderByQuery).toBeDefined();
      expect(orderByQuery.type).toBe(String);
      expect(orderByQuery.example).toBe("-createdAt");
    });

    it("should add fetchAll query parameter", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiListQuery();
      decorator(target, "findAll", {} as PropertyDescriptor);

      const fetchAllQuery = target.__apiQueries.find((q: any) => q.name === "fetchAll");
      expect(fetchAllQuery).toBeDefined();
      expect(fetchAllQuery.type).toBe(Boolean);
      expect(fetchAllQuery.example).toBe(false);
    });

    it("should add search query parameter", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiListQuery();
      decorator(target, "findAll", {} as PropertyDescriptor);

      const searchQuery = target.__apiQueries.find((q: any) => q.name === "search");
      expect(searchQuery).toBeDefined();
      expect(searchQuery.type).toBe(String);
    });

    it("should add all 5 query parameters", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiListQuery();
      decorator(target, "findAll", {} as PropertyDescriptor);

      expect(target.__apiQueries.length).toBe(5);
    });
  });

  describe("ApiJsonApiInclude", () => {
    it("should be a function", () => {
      expect(typeof ApiJsonApiInclude).toBe("function");
    });

    it("should return a MethodDecorator", () => {
      const decorator = ApiJsonApiInclude(["roll", "metadata"]);
      expect(typeof decorator).toBe("function");
    });

    it("should add include query parameter", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiInclude(["roll", "metadata", "faces"]);
      decorator(target, "findAll", {} as PropertyDescriptor);

      const includeQuery = target.__apiQueries.find((q: any) => q.name === "include");
      expect(includeQuery).toBeDefined();
      expect(includeQuery.type).toBe(String);
      expect(includeQuery.required).toBe(false);
    });

    it("should list allowed relationships in description", () => {
      const target = { __apiQueries: [] as any[] };
      const relationships = ["roll", "metadata", "faces"];
      const decorator = ApiJsonApiInclude(relationships);
      decorator(target, "findAll", {} as PropertyDescriptor);

      const includeQuery = target.__apiQueries.find((q: any) => q.name === "include");
      expect(includeQuery.description).toContain("roll");
      expect(includeQuery.description).toContain("metadata");
      expect(includeQuery.description).toContain("faces");
    });

    it("should provide example with first two relationships", () => {
      const target = { __apiQueries: [] as any[] };
      const relationships = ["roll", "metadata", "faces"];
      const decorator = ApiJsonApiInclude(relationships);
      decorator(target, "findAll", {} as PropertyDescriptor);

      const includeQuery = target.__apiQueries.find((q: any) => q.name === "include");
      expect(includeQuery.example).toBe("roll,metadata");
    });

    it("should handle single relationship", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiInclude(["author"]);
      decorator(target, "findAll", {} as PropertyDescriptor);

      const includeQuery = target.__apiQueries.find((q: any) => q.name === "include");
      expect(includeQuery.example).toBe("author");
    });
  });

  describe("ApiJsonApiPagination", () => {
    it("should be a function", () => {
      expect(typeof ApiJsonApiPagination).toBe("function");
    });

    it("should return a MethodDecorator", () => {
      const decorator = ApiJsonApiPagination();
      expect(typeof decorator).toBe("function");
    });

    it("should add only pagination parameters (offset and size)", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiPagination();
      decorator(target, "findAll", {} as PropertyDescriptor);

      expect(target.__apiQueries.length).toBe(2);

      const offsetQuery = target.__apiQueries.find((q: any) => q.name === "page[offset]");
      const sizeQuery = target.__apiQueries.find((q: any) => q.name === "page[size]");

      expect(offsetQuery).toBeDefined();
      expect(sizeQuery).toBeDefined();
    });

    it("should not include orderBy, fetchAll, or search", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiPagination();
      decorator(target, "findAll", {} as PropertyDescriptor);

      const orderByQuery = target.__apiQueries.find((q: any) => q.name === "orderBy");
      const fetchAllQuery = target.__apiQueries.find((q: any) => q.name === "fetchAll");
      const searchQuery = target.__apiQueries.find((q: any) => q.name === "search");

      expect(orderByQuery).toBeUndefined();
      expect(fetchAllQuery).toBeUndefined();
      expect(searchQuery).toBeUndefined();
    });
  });

  describe("ApiJsonApiFilter", () => {
    it("should be a function", () => {
      expect(typeof ApiJsonApiFilter).toBe("function");
    });

    it("should return a MethodDecorator", () => {
      const decorator = ApiJsonApiFilter("status");
      expect(typeof decorator).toBe("function");
    });

    it("should create filter parameter with correct name format", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiFilter("status");
      decorator(target, "findAll", {} as PropertyDescriptor);

      const filterQuery = target.__apiQueries.find((q: any) => q.name === "filter[status]");
      expect(filterQuery).toBeDefined();
    });

    it("should include enum when allowedValues provided", () => {
      const target = { __apiQueries: [] as any[] };
      const values = ["active", "pending", "completed"];
      const decorator = ApiJsonApiFilter("status", values);
      decorator(target, "findAll", {} as PropertyDescriptor);

      const filterQuery = target.__apiQueries.find((q: any) => q.name === "filter[status]");
      expect(filterQuery.enum).toEqual(values);
      expect(filterQuery.example).toBe("active");
    });

    it("should use custom description when provided", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiFilter("status", undefined, {
        description: "Filter by status field",
      });
      decorator(target, "findAll", {} as PropertyDescriptor);

      const filterQuery = target.__apiQueries.find((q: any) => q.name === "filter[status]");
      expect(filterQuery.description).toBe("Filter by status field");
    });

    it("should support required option", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiFilter("status", undefined, { required: true });
      decorator(target, "findAll", {} as PropertyDescriptor);

      const filterQuery = target.__apiQueries.find((q: any) => q.name === "filter[status]");
      expect(filterQuery.required).toBe(true);
    });

    it("should default to optional", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiFilter("status");
      decorator(target, "findAll", {} as PropertyDescriptor);

      const filterQuery = target.__apiQueries.find((q: any) => q.name === "filter[status]");
      expect(filterQuery.required).toBe(false);
    });

    it("should generate default description", () => {
      const target = { __apiQueries: [] as any[] };
      const decorator = ApiJsonApiFilter("status");
      decorator(target, "findAll", {} as PropertyDescriptor);

      const filterQuery = target.__apiQueries.find((q: any) => q.name === "filter[status]");
      expect(filterQuery.description).toBe("Filter by status");
    });
  });
});
