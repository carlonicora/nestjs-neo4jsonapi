import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StripeProductController } from "../controllers/stripe-product.controller";
import { StripeProductRepository } from "../repositories/stripe-product.repository";
import { StripeProductAdminService } from "../services/stripe-product-admin.service";

/**
 * Column sorting on the library products list (spec row A23): name, active. The repository
 * has no descriptor, so the service validates against an allow-list.
 */

describe("StripeProductController sort", () => {
  it("listProducts forwards sort", async () => {
    const service = { listProducts: vi.fn().mockResolvedValue({}) };
    const controller = new StripeProductController(service as any);
    await controller.listProducts({ send: vi.fn() } as any, {}, undefined, "-active");
    expect(service.listProducts).toHaveBeenCalledWith(expect.objectContaining({ sort: "-active" }));
  });
});

describe("StripeProductAdminService.listProducts sort", () => {
  let repository: { findAll: ReturnType<typeof vi.fn> };
  let service: StripeProductAdminService;

  beforeEach(() => {
    repository = { findAll: vi.fn().mockResolvedValue([]) };
    service = new StripeProductAdminService(
      repository as any,
      {} as any,
      {
        buildList: vi.fn().mockResolvedValue({ data: [] }),
      } as any,
    );
  });

  it("passes the validated sort to the repository", async () => {
    await service.listProducts({ query: {}, sort: "-name" });
    expect(repository.findAll.mock.calls[0][0].orderByFields).toEqual([{ field: "name", direction: "desc" }]);
  });

  it("refuses a hostile or unknown sort with a 400 before any query", async () => {
    for (const sort of ["name) DETACH DELETE n //", "prices", "stripeProductId"]) {
      await expect(service.listProducts({ query: {}, sort })).rejects.toThrow(BadRequestException);
    }
    expect(repository.findAll).not.toHaveBeenCalled();
  });
});

describe("StripeProductRepository.findAll sort", () => {
  function setup() {
    const neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} as Record<string, any> })),
      readMany: vi.fn().mockResolvedValue([]),
    };
    return {
      repository: new StripeProductRepository(neo4j as any),
      query: () => neo4j.readMany.mock.calls[0][0].query as string,
    };
  }

  it("orders by the requested sort, then the id", async () => {
    const { repository, query } = setup();
    await repository.findAll({ orderByFields: [{ field: "active", direction: "desc" }] });
    expect(query()).toContain(
      "ORDER BY CASE WHEN stripeProduct.active IS :: STRING THEN toLower(stripeProduct.active) ELSE stripeProduct.active END DESC, stripeProduct.id ASC",
    );
  });

  it("keeps name as its default", async () => {
    const { repository, query } = setup();
    await repository.findAll();
    expect(query()).toContain("ORDER BY stripeProduct.name ASC, stripeProduct.id ASC");
  });
});
