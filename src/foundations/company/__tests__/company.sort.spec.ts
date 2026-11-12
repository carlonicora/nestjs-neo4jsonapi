import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyDescriptor } from "../entities/company";
import { CompanyController } from "../controllers/company.controller";
import { CompanyRepository } from "../repositories/company.repository";
import { CompanyService } from "../services/company.service";

/** Column sorting on the library companies list (spec row A24): name. The list had no ORDER BY. */

describe("CompanyController sort", () => {
  it("forwards sort to the service", async () => {
    const service = { find: vi.fn().mockResolvedValue({}) };
    const controller = new CompanyController(service as any, {} as any);
    await controller.fetchAllCompanies({} as any, { send: vi.fn() } as any, {}, undefined, "-name");
    expect(service.find).toHaveBeenCalledWith(expect.objectContaining({ sort: "-name" }));
  });
});

describe("CompanyService.find sort", () => {
  let repository: { find: ReturnType<typeof vi.fn> };
  let service: CompanyService;

  beforeEach(() => {
    repository = { find: vi.fn().mockResolvedValue([]) };
    // Built without the constructor (queue, websocket, …); only the list path is exercised.
    service = Object.assign(Object.create(CompanyService.prototype), {
      descriptor: CompanyDescriptor,
      companyRepository: repository,
      builder: { buildList: vi.fn().mockResolvedValue({ data: [] }) },
    });
  });

  it("passes the validated sort to the repository", async () => {
    await service.find({ query: {}, sort: "-name" });
    expect(repository.find.mock.calls[0][0].orderByFields).toEqual([{ field: "name", direction: "desc" }]);
  });

  it("refuses a hostile or unsortable sort with a 400 before any query", async () => {
    for (const sort of ["name) DETACH DELETE n //", "ownerEmail", "monthlyCredits"]) {
      await expect(service.find({ query: {}, sort })).rejects.toThrow(BadRequestException);
    }
    expect(repository.find).not.toHaveBeenCalled();
  });
});

describe("CompanyRepository.find sort", () => {
  function setup() {
    const neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} as Record<string, any> })),
      readMany: vi.fn().mockResolvedValue([]),
    };
    const repository = new CompanyRepository(neo4j as any, {} as any, { get: vi.fn() } as any);
    return { repository, query: () => neo4j.readMany.mock.calls[0][0].query as string };
  }

  it("orders by the requested sort, then the id, before {CURSOR}", async () => {
    const { repository, query } = setup();
    await repository.find({
      term: undefined as any,
      cursor: {} as any,
      orderByFields: [{ field: "name", direction: "desc" }],
    });
    expect(query()).toContain(
      "ORDER BY CASE WHEN company.name IS :: STRING THEN toLower(company.name) ELSE company.name END DESC, company.id ASC",
    );
    expect(query().indexOf("{CURSOR}")).toBeGreaterThan(query().indexOf("ORDER BY"));
  });

  it("gives the list a stable default order (name, then id)", async () => {
    const { repository, query } = setup();
    await repository.find({ term: undefined as any, cursor: {} as any });
    expect(query()).toContain("ORDER BY company.name ASC, company.id ASC");
  });
});
