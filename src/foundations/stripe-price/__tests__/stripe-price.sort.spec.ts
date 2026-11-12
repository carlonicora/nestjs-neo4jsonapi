import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StripePriceController } from "../controllers/stripe-price.controller";
import { StripePriceRepository } from "../repositories/stripe-price.repository";
import { StripePriceAdminService } from "../services/stripe-price-admin.service";

/**
 * Column sorting on the library prices list (spec row A22): nickname, unitAmount,
 * recurringInterval, token, active. The repository has no descriptor, so the service
 * validates against an allow-list.
 */

describe("StripePriceController sort", () => {
  it("listPrices forwards sort", async () => {
    const service = { listPrices: vi.fn().mockResolvedValue({}) };
    const controller = new StripePriceController(service as any);
    await controller.listPrices({ send: vi.fn() } as any, {}, undefined, undefined, "-unitAmount");
    expect(service.listPrices).toHaveBeenCalledWith(expect.objectContaining({ sort: "-unitAmount" }));
  });
});

describe("StripePriceAdminService.listPrices sort", () => {
  let repository: { findAll: ReturnType<typeof vi.fn> };
  let service: StripePriceAdminService;

  beforeEach(() => {
    repository = { findAll: vi.fn().mockResolvedValue([]) };
    service = new StripePriceAdminService(
      repository as any,
      {} as any,
      {} as any,
      {} as any,
      {
        buildList: vi.fn().mockResolvedValue({ data: [] }),
      } as any,
    );
  });

  it("passes the validated sort to the repository", async () => {
    await service.listPrices({ query: {}, sort: "recurringInterval,-unitAmount" });
    expect(repository.findAll.mock.calls[0][0].orderByFields).toEqual([
      { field: "recurringInterval", direction: "asc" },
      { field: "unitAmount", direction: "desc" },
    ]);
  });

  it("refuses a hostile or unknown sort with a 400 before any query", async () => {
    for (const sort of ["nickname) DETACH DELETE n //", "stripePriceId", "currency"]) {
      await expect(service.listPrices({ query: {}, sort })).rejects.toThrow(BadRequestException);
    }
    expect(repository.findAll).not.toHaveBeenCalled();
  });
});

describe("StripePriceRepository.findAll sort", () => {
  function setup() {
    const neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} as Record<string, any> })),
      readMany: vi.fn().mockResolvedValue([]),
    };
    return {
      repository: new StripePriceRepository(neo4j as any),
      query: () => neo4j.readMany.mock.calls[0][0].query as string,
    };
  }

  it.each([undefined, "prod_1"])("orders by the requested sort, then the id (productId %s)", async (productId) => {
    const { repository, query } = setup();
    await repository.findAll({ productId, orderByFields: [{ field: "nickname", direction: "asc" }] });
    expect(query()).toContain(
      "ORDER BY CASE WHEN stripePrice.nickname IS :: STRING THEN toLower(stripePrice.nickname) ELSE stripePrice.nickname END ASC, stripePrice.id ASC",
    );
  });

  it("keeps createdAt DESC as its default", async () => {
    const { repository, query } = setup();
    await repository.findAll();
    expect(query()).toContain("ORDER BY stripePrice.createdAt DESC, stripePrice.id ASC");
  });
});
