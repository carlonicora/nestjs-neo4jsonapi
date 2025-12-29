// Mock problematic modules before any imports
jest.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the barrel export to provide only what we need
jest.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  // Create a mock Neo4jService class
  class Neo4jService {
    writeOne = jest.fn();
    readOne = jest.fn();
    readMany = jest.fn();
    initQuery = jest.fn();
  }

  // Create a mock AbstractJsonApiSerialiser class
  class AbstractJsonApiSerialiser {}

  return {
    Neo4jService,
    AbstractJsonApiSerialiser,
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeProductRepository } from "../stripe-product.repository";
import { stripeProductMeta } from "../../entities/stripe-product.meta";
import { StripeProduct } from "../../entities/stripe-product.entity";

describe("StripeProductRepository", () => {
  let repository: StripeProductRepository;
  let neo4jService: jest.Mocked<Neo4jService>;

  // Test data constants
  const TEST_IDS = {
    productId: "550e8400-e29b-41d4-a716-446655440000",
    stripeProductId: "prod_test123",
  };

  const MOCK_STRIPE_PRODUCT_ACTIVE: StripeProduct = {
    id: TEST_IDS.productId,
    stripeProductId: TEST_IDS.stripeProductId,
    name: "Premium Plan",
    description: "Premium subscription plan",
    active: true,
    metadata: JSON.stringify({ tier: "premium" }),
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };

  const MOCK_STRIPE_PRODUCT_INACTIVE: StripeProduct = {
    id: "660e8400-e29b-41d4-a716-446655440001",
    stripeProductId: "prod_test456",
    name: "Basic Plan",
    description: "Basic subscription plan",
    active: false,
    metadata: JSON.stringify({ tier: "basic" }),
    createdAt: new Date("2025-01-02T00:00:00Z"),
    updatedAt: new Date("2025-01-02T00:00:00Z"),
  };

  const MOCK_STRIPE_PRODUCT_MINIMAL: StripeProduct = {
    id: "770e8400-e29b-41d4-a716-446655440002",
    stripeProductId: "prod_test789",
    name: "Starter Plan",
    description: undefined,
    active: true,
    metadata: undefined,
    createdAt: new Date("2025-01-03T00:00:00Z"),
    updatedAt: new Date("2025-01-03T00:00:00Z"),
  };

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StripeProductRepository, Neo4jService],
    }).compile();

    repository = module.get<StripeProductRepository>(StripeProductRepository);
    neo4jService = module.get<Neo4jService>(Neo4jService) as jest.Mocked<Neo4jService>;

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE CONSTRAINT ${stripeProductMeta.nodeName}_id IF NOT EXISTS FOR (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName}) REQUIRE ${stripeProductMeta.nodeName}.id IS UNIQUE`,
      });
    });

    it("should create unique constraint on stripeProductId field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE CONSTRAINT ${stripeProductMeta.nodeName}_stripeProductId IF NOT EXISTS FOR (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName}) REQUIRE ${stripeProductMeta.nodeName}.stripeProductId IS UNIQUE`,
      });
    });

    it("should create both constraints in sequence", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(2);
    });

    it("should handle constraint creation errors", async () => {
      const error = new Error("Constraint creation failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });
  });

  describe("findAll", () => {
    it("should find all products without filters", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([
        MOCK_STRIPE_PRODUCT_ACTIVE,
        MOCK_STRIPE_PRODUCT_INACTIVE,
        MOCK_STRIPE_PRODUCT_MINIMAL,
      ]);

      const result = await repository.findAll();

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.query).toContain(`MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})`);
      expect(mockQuery.query).toContain(`RETURN ${stripeProductMeta.nodeName}`);
      expect(mockQuery.query).toContain(`ORDER BY ${stripeProductMeta.nodeName}.name`);
      expect(mockQuery.query).not.toContain("WHERE");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toHaveLength(3);
    });

    it("should find all products filtered by active=true", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_STRIPE_PRODUCT_ACTIVE, MOCK_STRIPE_PRODUCT_MINIMAL]);

      const result = await repository.findAll({ active: true });

      expect(mockQuery.queryParams).toEqual({
        active: true,
      });
      expect(mockQuery.query).toContain(`WHERE ${stripeProductMeta.nodeName}.active = $active`);
      expect(mockQuery.query).toContain(`ORDER BY ${stripeProductMeta.nodeName}.name`);
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toHaveLength(2);
      expect(result).toEqual([MOCK_STRIPE_PRODUCT_ACTIVE, MOCK_STRIPE_PRODUCT_MINIMAL]);
    });

    it("should find all products filtered by active=false", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_STRIPE_PRODUCT_INACTIVE]);

      const result = await repository.findAll({ active: false });

      expect(mockQuery.queryParams).toEqual({
        active: false,
      });
      expect(mockQuery.query).toContain(`WHERE ${stripeProductMeta.nodeName}.active = $active`);
      expect(mockQuery.query).toContain(`ORDER BY ${stripeProductMeta.nodeName}.name`);
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_STRIPE_PRODUCT_INACTIVE]);
    });

    it("should order results by name alphabetically", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findAll();

      expect(mockQuery.query).toContain(`ORDER BY ${stripeProductMeta.nodeName}.name`);
      expect(mockQuery.query).not.toContain("createdAt");
    });

    it("should return empty array when no products found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findAll();

      expect(result).toEqual([]);
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database connection error");
      neo4jService.readMany.mockRejectedValue(error);

      await expect(repository.findAll()).rejects.toThrow("Database connection error");
    });
  });

  describe("findById", () => {
    it("should find product by ID successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const result = await repository.findById({ id: TEST_IDS.productId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        id: TEST_IDS.productId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $id})`,
      );
      expect(mockQuery.query).toContain(`RETURN ${stripeProductMeta.nodeName}`);
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_STRIPE_PRODUCT_ACTIVE);
    });

    it("should return null when product not found by ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findById({ id: "nonexistent-id" });

      expect(result).toBeNull();
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Read operation failed");
      neo4jService.readOne.mockRejectedValue(error);

      await expect(repository.findById({ id: TEST_IDS.productId })).rejects.toThrow("Read operation failed");
    });
  });

  describe("findByStripeProductId", () => {
    it("should find product by Stripe product ID successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const result = await repository.findByStripeProductId({ stripeProductId: TEST_IDS.stripeProductId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        stripeProductId: TEST_IDS.stripeProductId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {stripeProductId: $stripeProductId})`,
      );
      expect(mockQuery.query).toContain(`RETURN ${stripeProductMeta.nodeName}`);
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_STRIPE_PRODUCT_ACTIVE);
    });

    it("should return null when product not found by Stripe product ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByStripeProductId({ stripeProductId: "prod_nonexistent" });

      expect(result).toBeNull();
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database connection error");
      neo4jService.readOne.mockRejectedValue(error);

      await expect(repository.findByStripeProductId({ stripeProductId: TEST_IDS.stripeProductId })).rejects.toThrow(
        "Database connection error",
      );
    });
  });

  describe("create", () => {
    describe("required fields", () => {
      const validParams = {
        stripeProductId: "prod_new_test",
        name: "New Product",
        active: true,
      };

      it("should create product with required fields only", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_MINIMAL);

        const result = await repository.create(validParams);

        expect(neo4jService.initQuery).toHaveBeenCalledWith({
          serialiser: expect.anything(),
        });
        expect(mockQuery.queryParams).toMatchObject({
          stripeProductId: validParams.stripeProductId,
          name: validParams.name,
          active: validParams.active,
          description: null,
          metadata: null,
        });
        expect(mockQuery.queryParams.id).toBeDefined();
        expect(mockQuery.query).toContain(`CREATE (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName}`);
        expect(mockQuery.query).toContain("id: $id");
        expect(mockQuery.query).toContain("stripeProductId: $stripeProductId");
        expect(mockQuery.query).toContain("name: $name");
        expect(mockQuery.query).toContain("description: $description");
        expect(mockQuery.query).toContain("active: $active");
        expect(mockQuery.query).toContain("metadata: $metadata");
        expect(mockQuery.query).toContain("createdAt: datetime()");
        expect(mockQuery.query).toContain("updatedAt: datetime()");
        expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
        expect(result).toEqual(MOCK_STRIPE_PRODUCT_MINIMAL);
      });

      it("should create product with all optional fields", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

        const paramsWithOptionals = {
          ...validParams,
          description: "Detailed product description",
          metadata: JSON.stringify({ category: "premium", featured: true }),
        };

        const result = await repository.create(paramsWithOptionals);

        expect(mockQuery.queryParams).toMatchObject({
          stripeProductId: validParams.stripeProductId,
          name: validParams.name,
          active: validParams.active,
          description: "Detailed product description",
          metadata: JSON.stringify({ category: "premium", featured: true }),
        });
        expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
        expect(result).toEqual(MOCK_STRIPE_PRODUCT_ACTIVE);
      });

      it("should create active product", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

        await repository.create({
          ...validParams,
          active: true,
        });

        expect(mockQuery.queryParams.active).toBe(true);
      });

      it("should create inactive product", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_INACTIVE);

        await repository.create({
          ...validParams,
          active: false,
        });

        expect(mockQuery.queryParams.active).toBe(false);
      });
    });

    describe("optional field handling", () => {
      const baseParams = {
        stripeProductId: "prod_field_test",
        name: "Field Test Product",
        active: true,
      };

      it("should set description to null when not provided", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_MINIMAL);

        await repository.create(baseParams);

        expect(mockQuery.queryParams.description).toBeNull();
      });

      it("should set metadata to null when not provided", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_MINIMAL);

        await repository.create(baseParams);

        expect(mockQuery.queryParams.metadata).toBeNull();
      });

      it("should set description to null when undefined", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_MINIMAL);

        await repository.create({
          ...baseParams,
          description: undefined,
        });

        expect(mockQuery.queryParams.description).toBeNull();
      });

      it("should set metadata to null when undefined", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_MINIMAL);

        await repository.create({
          ...baseParams,
          metadata: undefined,
        });

        expect(mockQuery.queryParams.metadata).toBeNull();
      });

      it("should preserve provided description value", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

        const description = "Custom description text";
        await repository.create({
          ...baseParams,
          description,
        });

        expect(mockQuery.queryParams.description).toBe(description);
      });

      it("should preserve provided metadata value", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

        const metadata = JSON.stringify({ custom: "metadata" });
        await repository.create({
          ...baseParams,
          metadata,
        });

        expect(mockQuery.queryParams.metadata).toBe(metadata);
      });
    });

    describe("validation and errors", () => {
      const baseParams = {
        stripeProductId: "prod_error_test",
        name: "Error Test Product",
        active: true,
      };

      it("should generate unique UUID for each product", async () => {
        const mockQuery1 = createMockQuery();
        const mockQuery2 = createMockQuery();
        neo4jService.initQuery.mockReturnValueOnce(mockQuery1).mockReturnValueOnce(mockQuery2);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

        await repository.create(baseParams);
        await repository.create(baseParams);

        expect(mockQuery1.queryParams.id).toBeDefined();
        expect(mockQuery2.queryParams.id).toBeDefined();
        expect(mockQuery1.queryParams.id).not.toEqual(mockQuery2.queryParams.id);
      });

      it("should handle creation errors", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        const error = new Error("Creation failed - duplicate stripeProductId");
        neo4jService.writeOne.mockRejectedValue(error);

        await expect(repository.create(baseParams)).rejects.toThrow("Creation failed - duplicate stripeProductId");
      });

      it("should preserve exact parameter values", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

        const exactParams = {
          stripeProductId: "prod_exact_123",
          name: "Exact Test Product",
          description: "Exact description",
          active: true,
          metadata: JSON.stringify({ exact: "metadata" }),
        };

        await repository.create(exactParams);

        expect(mockQuery.queryParams).toMatchObject({
          stripeProductId: "prod_exact_123",
          name: "Exact Test Product",
          description: "Exact description",
          active: true,
          metadata: JSON.stringify({ exact: "metadata" }),
        });
      });
    });
  });

  describe("update", () => {
    it("should update name field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const params = {
        id: TEST_IDS.productId,
        name: "Updated Product Name",
      };

      const result = await repository.update(params);

      expect(mockQuery.queryParams).toEqual({
        id: TEST_IDS.productId,
        name: "Updated Product Name",
        description: undefined,
        active: undefined,
        metadata: undefined,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $id})`,
      );
      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.name = $name`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_STRIPE_PRODUCT_ACTIVE);
    });

    it("should update description field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const params = {
        id: TEST_IDS.productId,
        description: "Updated description",
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.description = $description`);
      expect(mockQuery.queryParams.description).toBe("Updated description");
    });

    it("should update active field to true", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const params = {
        id: TEST_IDS.productId,
        active: true,
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.active = $active`);
      expect(mockQuery.queryParams.active).toBe(true);
    });

    it("should update active field to false", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_INACTIVE);

      const params = {
        id: TEST_IDS.productId,
        active: false,
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.active = $active`);
      expect(mockQuery.queryParams.active).toBe(false);
    });

    it("should update metadata field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const params = {
        id: TEST_IDS.productId,
        metadata: JSON.stringify({ updated: "metadata" }),
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.metadata = $metadata`);
      expect(mockQuery.queryParams.metadata).toBe(JSON.stringify({ updated: "metadata" }));
    });

    it("should update multiple fields at once", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const params = {
        id: TEST_IDS.productId,
        name: "Multi Update Product",
        description: "Multi update description",
        active: false,
        metadata: JSON.stringify({ multi: "update" }),
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.name = $name`);
      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.description = $description`);
      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.active = $active`);
      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.metadata = $metadata`);
      expect(mockQuery.queryParams).toMatchObject({
        name: "Multi Update Product",
        description: "Multi update description",
        active: false,
        metadata: JSON.stringify({ multi: "update" }),
      });
    });

    it("should only update id when no optional fields provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const params = {
        id: TEST_IDS.productId,
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).not.toContain(`${stripeProductMeta.nodeName}.name = $name`);
      expect(mockQuery.query).not.toContain(`${stripeProductMeta.nodeName}.description = $description`);
      expect(mockQuery.query).not.toContain(`${stripeProductMeta.nodeName}.active = $active`);
      expect(mockQuery.query).not.toContain(`${stripeProductMeta.nodeName}.metadata = $metadata`);
    });

    it("should always update updatedAt timestamp", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      await repository.update({ id: TEST_IDS.productId, name: "Test" });

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.updatedAt = datetime()`);
    });

    it("should handle update errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Update failed - product not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.update({ id: TEST_IDS.productId, name: "Test" })).rejects.toThrow(
        "Update failed - product not found",
      );
    });
  });

  describe("updateByStripeProductId", () => {
    it("should update name field by Stripe product ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const params = {
        stripeProductId: TEST_IDS.stripeProductId,
        name: "Updated via Stripe ID",
      };

      const result = await repository.updateByStripeProductId(params);

      expect(mockQuery.queryParams).toEqual({
        stripeProductId: TEST_IDS.stripeProductId,
        name: "Updated via Stripe ID",
        description: undefined,
        active: undefined,
        metadata: undefined,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {stripeProductId: $stripeProductId})`,
      );
      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.name = $name`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_STRIPE_PRODUCT_ACTIVE);
    });

    it("should update description by Stripe product ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      await repository.updateByStripeProductId({
        stripeProductId: TEST_IDS.stripeProductId,
        description: "Updated description via Stripe ID",
      });

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.description = $description`);
      expect(mockQuery.queryParams.description).toBe("Updated description via Stripe ID");
    });

    it("should update active field to true by Stripe product ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      await repository.updateByStripeProductId({
        stripeProductId: TEST_IDS.stripeProductId,
        active: true,
      });

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.active = $active`);
      expect(mockQuery.queryParams.active).toBe(true);
    });

    it("should update active field to false by Stripe product ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_INACTIVE);

      await repository.updateByStripeProductId({
        stripeProductId: TEST_IDS.stripeProductId,
        active: false,
      });

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.active = $active`);
      expect(mockQuery.queryParams.active).toBe(false);
    });

    it("should update metadata by Stripe product ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      await repository.updateByStripeProductId({
        stripeProductId: TEST_IDS.stripeProductId,
        metadata: JSON.stringify({ stripe: "update" }),
      });

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.metadata = $metadata`);
      expect(mockQuery.queryParams.metadata).toBe(JSON.stringify({ stripe: "update" }));
    });

    it("should update multiple fields at once by Stripe product ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const params = {
        stripeProductId: TEST_IDS.stripeProductId,
        name: "Multi Update Stripe",
        description: "Multi description",
        active: true,
        metadata: JSON.stringify({ multi: "stripe" }),
      };

      await repository.updateByStripeProductId(params);

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.name = $name`);
      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.description = $description`);
      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.active = $active`);
      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.metadata = $metadata`);
      expect(mockQuery.queryParams).toMatchObject({
        name: "Multi Update Stripe",
        description: "Multi description",
        active: true,
        metadata: JSON.stringify({ multi: "stripe" }),
      });
    });

    it("should only update stripeProductId when no optional fields provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      await repository.updateByStripeProductId({
        stripeProductId: TEST_IDS.stripeProductId,
      });

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).not.toContain(`${stripeProductMeta.nodeName}.name = $name`);
      expect(mockQuery.query).not.toContain(`${stripeProductMeta.nodeName}.description = $description`);
      expect(mockQuery.query).not.toContain(`${stripeProductMeta.nodeName}.active = $active`);
      expect(mockQuery.query).not.toContain(`${stripeProductMeta.nodeName}.metadata = $metadata`);
    });

    it("should always update updatedAt timestamp", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      await repository.updateByStripeProductId({
        stripeProductId: TEST_IDS.stripeProductId,
        active: false,
      });

      expect(mockQuery.query).toContain(`${stripeProductMeta.nodeName}.updatedAt = datetime()`);
    });

    it("should handle update errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Update failed - product not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(
        repository.updateByStripeProductId({
          stripeProductId: TEST_IDS.stripeProductId,
          active: true,
        }),
      ).rejects.toThrow("Update failed - product not found");
    });
  });

  describe("delete", () => {
    it("should delete product by ID using DETACH DELETE", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.delete({ id: TEST_IDS.productId });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(mockQuery.queryParams).toEqual({
        id: TEST_IDS.productId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $id})`,
      );
      expect(mockQuery.query).toContain(`DETACH DELETE ${stripeProductMeta.nodeName}`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle delete errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Delete failed - product not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.delete({ id: TEST_IDS.productId })).rejects.toThrow("Delete failed - product not found");
    });

    it("should return void on successful delete", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const result = await repository.delete({ id: TEST_IDS.productId });

      expect(result).toBeUndefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty string values in create for optional fields", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const params = {
        stripeProductId: TEST_IDS.stripeProductId,
        name: "Test Product",
        active: true,
        description: "",
        metadata: "",
      };

      await repository.create(params);

      expect(mockQuery.queryParams.description).toBe("");
      expect(mockQuery.queryParams.metadata).toBe("");
    });

    it("should handle special characters in name", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      await repository.update({
        id: TEST_IDS.productId,
        name: 'Product\'s "Special" & (Complex) Name',
      });

      expect(mockQuery.queryParams.name).toBe('Product\'s "Special" & (Complex) Name');
    });

    it("should handle special characters in description", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const specialDescription = "Description with <html> tags & special chars: @#$%";
      await repository.update({
        id: TEST_IDS.productId,
        description: specialDescription,
      });

      expect(mockQuery.queryParams.description).toBe(specialDescription);
    });

    it("should handle complex JSON metadata", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const complexMetadata = JSON.stringify({
        tier: "enterprise",
        features: ["feature1", "feature2", "feature3"],
        pricing: { model: "usage-based", currency: "usd" },
        nested: { deeply: { nested: "value" } },
      });

      await repository.update({
        id: TEST_IDS.productId,
        metadata: complexMetadata,
      });

      expect(mockQuery.queryParams.metadata).toBe(complexMetadata);
    });

    it("should handle null return from findById gracefully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findById({ id: "nonexistent" });

      expect(result).toBeNull();
    });

    it("should handle null return from findByStripeProductId gracefully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByStripeProductId({ stripeProductId: "nonexistent" });

      expect(result).toBeNull();
    });

    it("should handle very long product names", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const longName = "A".repeat(500);
      await repository.create({
        stripeProductId: TEST_IDS.stripeProductId,
        name: longName,
        active: true,
      });

      expect(mockQuery.queryParams.name).toBe(longName);
    });

    it("should handle very long descriptions", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const longDescription = "B".repeat(1000);
      await repository.create({
        stripeProductId: TEST_IDS.stripeProductId,
        name: "Test",
        active: true,
        description: longDescription,
      });

      expect(mockQuery.queryParams.description).toBe(longDescription);
    });
  });

  describe("Parameter Validation", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";

      await repository.findById({ id: exactId });

      expect(mockQuery.queryParams.id).toBe(exactId);
    });

    it("should preserve exact Stripe product ID format", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const exactStripeProductId = "prod_1MvN8z3FkJ0LJ6p";

      await repository.findByStripeProductId({ stripeProductId: exactStripeProductId });

      expect(mockQuery.queryParams.stripeProductId).toBe(exactStripeProductId);
    });

    it("should preserve exact name values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      const exactName = "Exact Product Name 123";

      await repository.create({
        stripeProductId: TEST_IDS.stripeProductId,
        name: exactName,
        active: true,
      });

      expect(mockQuery.queryParams.name).toBe(exactName);
    });

    it("should preserve boolean active values exactly", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      await repository.create({
        stripeProductId: TEST_IDS.stripeProductId,
        name: "Test",
        active: false,
      });

      expect(mockQuery.queryParams.active).toBe(false);
      expect(mockQuery.queryParams.active).not.toBe(true);
    });
  });

  describe("Service Integration", () => {
    it("should call Neo4jService.initQuery before each read operation", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);
      neo4jService.readMany.mockResolvedValue([MOCK_STRIPE_PRODUCT_ACTIVE]);

      await repository.findAll();
      await repository.findById({ id: TEST_IDS.productId });
      await repository.findByStripeProductId({ stripeProductId: TEST_IDS.stripeProductId });

      expect(neo4jService.initQuery).toHaveBeenCalledTimes(3);
    });

    it("should call Neo4jService.writeOne for create and update operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      await repository.create({
        stripeProductId: TEST_IDS.stripeProductId,
        name: "Test",
        active: true,
      });

      await repository.update({ id: TEST_IDS.productId, active: false });

      await repository.updateByStripeProductId({ stripeProductId: TEST_IDS.stripeProductId, active: true });

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(3);
    });

    it("should call Neo4jService.writeOne for delete operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.delete({ id: TEST_IDS.productId });

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(1);
    });

    it("should call Neo4jService.readMany for findAll operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_STRIPE_PRODUCT_ACTIVE]);

      await repository.findAll();
      await repository.findAll({ active: true });
      await repository.findAll({ active: false });

      expect(neo4jService.readMany).toHaveBeenCalledTimes(3);
    });

    it("should call Neo4jService.readOne for single item retrieval", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      await repository.findById({ id: TEST_IDS.productId });
      await repository.findByStripeProductId({ stripeProductId: TEST_IDS.stripeProductId });

      expect(neo4jService.readOne).toHaveBeenCalledTimes(2);
    });

    it("should pass serialiser to initQuery for read operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_STRIPE_PRODUCT_ACTIVE);

      await repository.findById({ id: TEST_IDS.productId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
    });

    it("should not pass serialiser to initQuery for delete operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.delete({ id: TEST_IDS.productId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith();
    });
  });
});
