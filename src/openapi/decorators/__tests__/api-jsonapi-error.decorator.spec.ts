import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ApiJsonApiErrors,
  ApiJsonApiReadErrors,
  ApiJsonApiListErrors,
  ApiJsonApiCreateErrors,
  ApiJsonApiUpdateErrors,
  ApiJsonApiDeleteErrors,
} from "../api-jsonapi-error.decorator";

// Store captured error responses
let capturedResponses: any[] = [];

// Mock @nestjs/swagger decorators
vi.mock("@nestjs/swagger", () => ({
  ApiBadRequestResponse: vi.fn((options) => {
    return (target: any, propertyKey: string) => {
      capturedResponses.push({ type: "badRequest", status: 400, ...options });
      if (!target.__apiResponses) target.__apiResponses = [];
      target.__apiResponses.push({ type: "badRequest", status: 400, ...options });
    };
  }),
  ApiUnauthorizedResponse: vi.fn((options) => {
    return (target: any, propertyKey: string) => {
      capturedResponses.push({ type: "unauthorized", status: 401, ...options });
      if (!target.__apiResponses) target.__apiResponses = [];
      target.__apiResponses.push({ type: "unauthorized", status: 401, ...options });
    };
  }),
  ApiForbiddenResponse: vi.fn((options) => {
    return (target: any, propertyKey: string) => {
      capturedResponses.push({ type: "forbidden", status: 403, ...options });
      if (!target.__apiResponses) target.__apiResponses = [];
      target.__apiResponses.push({ type: "forbidden", status: 403, ...options });
    };
  }),
  ApiNotFoundResponse: vi.fn((options) => {
    return (target: any, propertyKey: string) => {
      capturedResponses.push({ type: "notFound", status: 404, ...options });
      if (!target.__apiResponses) target.__apiResponses = [];
      target.__apiResponses.push({ type: "notFound", status: 404, ...options });
    };
  }),
  ApiUnprocessableEntityResponse: vi.fn((options) => {
    return (target: any, propertyKey: string) => {
      capturedResponses.push({ type: "unprocessable", status: 422, ...options });
      if (!target.__apiResponses) target.__apiResponses = [];
      target.__apiResponses.push({ type: "unprocessable", status: 422, ...options });
    };
  }),
  ApiInternalServerErrorResponse: vi.fn((options) => {
    return (target: any, propertyKey: string) => {
      capturedResponses.push({ type: "serverError", status: 500, ...options });
      if (!target.__apiResponses) target.__apiResponses = [];
      target.__apiResponses.push({ type: "serverError", status: 500, ...options });
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

describe("api-jsonapi-error.decorator", () => {
  beforeEach(() => {
    capturedResponses = [];
  });

  describe("ApiJsonApiErrors", () => {
    it("should be a function", () => {
      expect(typeof ApiJsonApiErrors).toBe("function");
    });

    it("should return a MethodDecorator", () => {
      const decorator = ApiJsonApiErrors();
      expect(typeof decorator).toBe("function");
    });

    describe("default behavior", () => {
      it("should add 401 and 500 responses by default", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors();
        decorator(target, "findAll", {} as PropertyDescriptor);

        const statuses = target.__apiResponses.map((r: any) => r.status);
        expect(statuses).toContain(401);
        expect(statuses).toContain(500);
        expect(target.__apiResponses.length).toBe(2);
      });

      it("should reference correct error schemas", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors();
        decorator(target, "findAll", {} as PropertyDescriptor);

        const unauthorizedResponse = target.__apiResponses.find((r: any) => r.status === 401);
        const serverErrorResponse = target.__apiResponses.find((r: any) => r.status === 500);

        expect(unauthorizedResponse.schema.$ref).toBe("#/components/schemas/JsonApi401ErrorResponse");
        expect(serverErrorResponse.schema.$ref).toBe("#/components/schemas/JsonApi500ErrorResponse");
      });
    });

    describe("custom options", () => {
      it("should add 400 response when badRequest is true", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors({ badRequest: true });
        decorator(target, "create", {} as PropertyDescriptor);

        const badRequestResponse = target.__apiResponses.find((r: any) => r.status === 400);
        expect(badRequestResponse).toBeDefined();
        expect(badRequestResponse.schema.$ref).toBe("#/components/schemas/JsonApi400ErrorResponse");
      });

      it("should add 403 response when forbidden is true", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors({ forbidden: true });
        decorator(target, "delete", {} as PropertyDescriptor);

        const forbiddenResponse = target.__apiResponses.find((r: any) => r.status === 403);
        expect(forbiddenResponse).toBeDefined();
        expect(forbiddenResponse.schema.$ref).toBe("#/components/schemas/JsonApi403ErrorResponse");
      });

      it("should add 404 response when notFound is true", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors({ notFound: true });
        decorator(target, "findById", {} as PropertyDescriptor);

        const notFoundResponse = target.__apiResponses.find((r: any) => r.status === 404);
        expect(notFoundResponse).toBeDefined();
        expect(notFoundResponse.schema.$ref).toBe("#/components/schemas/JsonApi404ErrorResponse");
      });

      it("should add 422 response when unprocessable is true", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors({ unprocessable: true });
        decorator(target, "create", {} as PropertyDescriptor);

        const unprocessableResponse = target.__apiResponses.find((r: any) => r.status === 422);
        expect(unprocessableResponse).toBeDefined();
        expect(unprocessableResponse.schema.$ref).toBe("#/components/schemas/JsonApi422ErrorResponse");
      });

      it("should not add 401 when unauthorized is false", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors({ unauthorized: false });
        decorator(target, "findAll", {} as PropertyDescriptor);

        const unauthorizedResponse = target.__apiResponses.find((r: any) => r.status === 401);
        expect(unauthorizedResponse).toBeUndefined();
      });

      it("should not add 500 when serverError is false", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors({ serverError: false });
        decorator(target, "findAll", {} as PropertyDescriptor);

        const serverErrorResponse = target.__apiResponses.find((r: any) => r.status === 500);
        expect(serverErrorResponse).toBeUndefined();
      });
    });

    describe("descriptions", () => {
      it("should have correct description for 400", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors({ badRequest: true });
        decorator(target, "create", {} as PropertyDescriptor);

        const badRequestResponse = target.__apiResponses.find((r: any) => r.status === 400);
        expect(badRequestResponse.description).toContain("Bad Request");
      });

      it("should have correct description for 401", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors();
        decorator(target, "findAll", {} as PropertyDescriptor);

        const unauthorizedResponse = target.__apiResponses.find((r: any) => r.status === 401);
        expect(unauthorizedResponse.description).toContain("Unauthorized");
        expect(unauthorizedResponse.description).toContain("JWT");
      });

      it("should have correct description for 403", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors({ forbidden: true });
        decorator(target, "delete", {} as PropertyDescriptor);

        const forbiddenResponse = target.__apiResponses.find((r: any) => r.status === 403);
        expect(forbiddenResponse.description).toContain("Forbidden");
        expect(forbiddenResponse.description).toContain("permissions");
      });

      it("should have correct description for 404", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors({ notFound: true });
        decorator(target, "findById", {} as PropertyDescriptor);

        const notFoundResponse = target.__apiResponses.find((r: any) => r.status === 404);
        expect(notFoundResponse.description).toContain("Not Found");
      });

      it("should have correct description for 422", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors({ unprocessable: true });
        decorator(target, "create", {} as PropertyDescriptor);

        const unprocessableResponse = target.__apiResponses.find((r: any) => r.status === 422);
        expect(unprocessableResponse.description).toContain("Validation");
      });

      it("should have correct description for 500", () => {
        const target = { __apiResponses: [] as any[] };
        const decorator = ApiJsonApiErrors();
        decorator(target, "findAll", {} as PropertyDescriptor);

        const serverErrorResponse = target.__apiResponses.find((r: any) => r.status === 500);
        expect(serverErrorResponse.description).toContain("Internal Server Error");
      });
    });
  });

  describe("ApiJsonApiReadErrors", () => {
    it("should add 401, 404, and 500 responses", () => {
      const target = { __apiResponses: [] as any[] };
      const decorator = ApiJsonApiReadErrors();
      decorator(target, "findById", {} as PropertyDescriptor);

      const statuses = target.__apiResponses.map((r: any) => r.status);
      expect(statuses).toContain(401);
      expect(statuses).toContain(404);
      expect(statuses).toContain(500);
      expect(statuses.length).toBe(3);
    });
  });

  describe("ApiJsonApiListErrors", () => {
    it("should add 401 and 500 responses", () => {
      const target = { __apiResponses: [] as any[] };
      const decorator = ApiJsonApiListErrors();
      decorator(target, "findAll", {} as PropertyDescriptor);

      const statuses = target.__apiResponses.map((r: any) => r.status);
      expect(statuses).toContain(401);
      expect(statuses).toContain(500);
      expect(statuses.length).toBe(2);
    });
  });

  describe("ApiJsonApiCreateErrors", () => {
    it("should add 400, 401, 422, and 500 responses", () => {
      const target = { __apiResponses: [] as any[] };
      const decorator = ApiJsonApiCreateErrors();
      decorator(target, "create", {} as PropertyDescriptor);

      const statuses = target.__apiResponses.map((r: any) => r.status);
      expect(statuses).toContain(400);
      expect(statuses).toContain(401);
      expect(statuses).toContain(422);
      expect(statuses).toContain(500);
      expect(statuses.length).toBe(4);
    });
  });

  describe("ApiJsonApiUpdateErrors", () => {
    it("should add 400, 401, 404, 422, and 500 responses", () => {
      const target = { __apiResponses: [] as any[] };
      const decorator = ApiJsonApiUpdateErrors();
      decorator(target, "update", {} as PropertyDescriptor);

      const statuses = target.__apiResponses.map((r: any) => r.status);
      expect(statuses).toContain(400);
      expect(statuses).toContain(401);
      expect(statuses).toContain(404);
      expect(statuses).toContain(422);
      expect(statuses).toContain(500);
      expect(statuses.length).toBe(5);
    });
  });

  describe("ApiJsonApiDeleteErrors", () => {
    it("should add 401, 403, 404, and 500 responses", () => {
      const target = { __apiResponses: [] as any[] };
      const decorator = ApiJsonApiDeleteErrors();
      decorator(target, "delete", {} as PropertyDescriptor);

      const statuses = target.__apiResponses.map((r: any) => r.status);
      expect(statuses).toContain(401);
      expect(statuses).toContain(403);
      expect(statuses).toContain(404);
      expect(statuses).toContain(500);
      expect(statuses.length).toBe(4);
    });
  });
});
