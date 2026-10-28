import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { StripeProductRepository } from "../stripe-product.repository";
import { Neo4jService } from "../../../../core/neo4j";
import { StripeProduct } from "../../entities/stripe-product.entity";
import { stripeProductMeta } from "../../entities/stripe-product.meta";

describe("StripeProductRepository", () => {
  let repository: StripeProductRepository;
  let neo4jService: Mocked<Neo4jService>;

  const mockProduct: StripeProduct = {
    id: "test-uuid-123",
    type: stripeProductMeta.type,
    stripeProductId: "prod_test_123",
    name: "Test Product",
    description: "Test Description",
    active: true,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockNeo4jService = {
      initQuery: vi.fn().mockReturnValue({
        query: "",
        queryParams: {},
        serialiser: undefined,
      }),
      writeOne: vi.fn(),
      readOne: vi.fn(),
      readMany: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeProductRepository,
        {
          provide: Neo4jService,
          useValue: mockNeo4jService,
        },
      ],
    }).compile();

    repository = module.get<StripeProductRepository>(StripeProductRepository);
    neo4jService = module.get(Neo4jService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findAll - active filter", () => {
    const priceActive = `${stripeProductMeta.nodeName}_stripePrice.active = true`;

    it("keeps only the active prices of active products", async () => {
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findAll({ active: true });

      const query = neo4jService.readMany.mock.calls[0][0];
      expect(query.query).toContain(`${stripeProductMeta.nodeName}.active = $active`);
      expect(query.query).toContain(priceActive);
      expect(query.queryParams.active).toBe(true);
    });

    it("returns every price when no active filter is given (admin list)", async () => {
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findAll();

      expect(neo4jService.readMany.mock.calls[0][0].query).not.toContain(priceActive);
    });

    it("returns every price of archived products", async () => {
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findAll({ active: false });

      expect(neo4jService.readMany.mock.calls[0][0].query).not.toContain(priceActive);
    });
  });

  describe("update - active status changes", () => {
    it("should update product to active=false (archive)", async () => {
      const archivedProduct = { ...mockProduct, active: false };
      neo4jService.writeOne.mockResolvedValue(archivedProduct);

      const result = await repository.update({
        id: mockProduct.id,
        active: false,
      });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(neo4jService.writeOne).toHaveBeenCalled();

      const writeOneCall = neo4jService.writeOne.mock.calls[0][0];
      expect(writeOneCall.query).toContain("MATCH");
      expect(writeOneCall.query).toContain(stripeProductMeta.labelName);
      expect(writeOneCall.query).toContain("SET");
      expect(writeOneCall.query).toContain(`${stripeProductMeta.nodeName}.active = $active`);
      expect(writeOneCall.query).toContain(`${stripeProductMeta.nodeName}.updatedAt = datetime()`);
      expect(writeOneCall.queryParams.id).toBe(mockProduct.id);
      expect(writeOneCall.queryParams.active).toBe(false);

      expect(result).toEqual(archivedProduct);
      expect(result.active).toBe(false);
    });

    it("should update product to active=true (reactivate)", async () => {
      const reactivatedProduct = { ...mockProduct, active: true };
      neo4jService.writeOne.mockResolvedValue(reactivatedProduct);

      const result = await repository.update({
        id: mockProduct.id,
        active: true,
      });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(neo4jService.writeOne).toHaveBeenCalled();

      const writeOneCall = neo4jService.writeOne.mock.calls[0][0];
      expect(writeOneCall.query).toContain("MATCH");
      expect(writeOneCall.query).toContain(stripeProductMeta.labelName);
      expect(writeOneCall.query).toContain("SET");
      expect(writeOneCall.query).toContain(`${stripeProductMeta.nodeName}.active = $active`);
      expect(writeOneCall.query).toContain(`${stripeProductMeta.nodeName}.updatedAt = datetime()`);
      expect(writeOneCall.queryParams.id).toBe(mockProduct.id);
      expect(writeOneCall.queryParams.active).toBe(true);

      expect(result).toEqual(reactivatedProduct);
      expect(result.active).toBe(true);
    });

    it("should update updatedAt timestamp", async () => {
      const updatedProduct = { ...mockProduct, active: false };
      neo4jService.writeOne.mockResolvedValue(updatedProduct);

      await repository.update({
        id: mockProduct.id,
        active: false,
      });

      const writeOneCall = neo4jService.writeOne.mock.calls[0][0];
      expect(writeOneCall.query).toContain(`${stripeProductMeta.nodeName}.updatedAt = datetime()`);
    });

    it("should preserve other fields when updating active status", async () => {
      const updatedProduct = { ...mockProduct, active: false };
      neo4jService.writeOne.mockResolvedValue(updatedProduct);

      await repository.update({
        id: mockProduct.id,
        active: false,
      });

      const writeOneCall = neo4jService.writeOne.mock.calls[0][0];
      // Should only update active and updatedAt, not name, description, etc.
      expect(writeOneCall.query).not.toContain(`${stripeProductMeta.nodeName}.name =`);
      expect(writeOneCall.query).not.toContain(`${stripeProductMeta.nodeName}.description =`);
      expect(writeOneCall.query).not.toContain(`${stripeProductMeta.nodeName}.stripeProductId =`);
      expect(writeOneCall.query).toContain(`${stripeProductMeta.nodeName}.active = $active`);
    });

    it("should return updated product", async () => {
      const updatedProduct = { ...mockProduct, active: false };
      neo4jService.writeOne.mockResolvedValue(updatedProduct);

      const result = await repository.update({
        id: mockProduct.id,
        active: false,
      });

      expect(result).toBeDefined();
      expect(result.id).toBe(mockProduct.id);
      expect(result.active).toBe(false);
    });
  });
});
