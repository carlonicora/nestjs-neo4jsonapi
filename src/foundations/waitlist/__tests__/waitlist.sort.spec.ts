import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WaitlistController } from "../controllers/waitlist.controller";
import { WaitlistDescriptor } from "../entities/waitlist";
import { WaitlistRepository } from "../repositories/waitlist.repository";
import { WaitlistService } from "../services/waitlist.service";

/** Column sorting on the waitlist admin list (spec row A1): email, status, createdAt. */

describe("WaitlistController sort", () => {
  it("forwards sort to the service", async () => {
    const service = { findAllByStatus: vi.fn().mockResolvedValue({}) };
    const controller = new WaitlistController(service as any);
    await controller.findAll({}, undefined, "-email");
    expect(service.findAllByStatus).toHaveBeenCalledWith(expect.objectContaining({ sort: "-email" }));
  });
});

describe("WaitlistService sort", () => {
  let repository: { findAllByStatus: ReturnType<typeof vi.fn> };
  let service: WaitlistService;

  beforeEach(() => {
    repository = { findAllByStatus: vi.fn().mockResolvedValue([]) };
    // Built without the constructor (it needs the mail stack); only the list path is exercised.
    service = Object.assign(Object.create(WaitlistService.prototype), {
      descriptor: WaitlistDescriptor,
      waitlistRepository: repository,
      jsonApiService: { buildList: vi.fn().mockResolvedValue({ data: [] }) },
    });
  });

  it("passes the validated sort to the repository", async () => {
    await service.findAllByStatus({ query: {}, sort: "status,-createdAt" });
    expect(repository.findAllByStatus.mock.calls[0][0].orderByFields).toEqual([
      { field: "status", direction: "asc" },
      { field: "createdAt", direction: "desc" },
    ]);
  });

  it("refuses a hostile or unsortable sort with a 400 before any query", async () => {
    for (const sort of ["email) DETACH DELETE n //", "questionnaire", "inviteCode", "-", ",,"]) {
      await expect(service.findAllByStatus({ query: {}, sort })).rejects.toThrow(BadRequestException);
    }
    expect(repository.findAllByStatus).not.toHaveBeenCalled();
  });
});

describe("WaitlistRepository sort", () => {
  function setup() {
    const neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} as Record<string, any> })),
      readMany: vi.fn().mockResolvedValue([]),
    };
    const repository = new WaitlistRepository(neo4j as any, {} as any, { get: vi.fn() } as any);
    return { repository, query: () => neo4j.readMany.mock.calls[0][0].query as string };
  }

  it("orders by the requested sort, then the id, before {CURSOR}", async () => {
    const { repository, query } = setup();
    await repository.findAllByStatus({ orderByFields: [{ field: "email", direction: "asc" }] });
    expect(query()).toContain(
      "ORDER BY CASE WHEN waitlist.email IS :: STRING THEN toLower(waitlist.email) ELSE waitlist.email END ASC, waitlist.id ASC",
    );
    expect(query().indexOf("{CURSOR}")).toBeGreaterThan(query().indexOf("ORDER BY"));
  });

  it("keeps createdAt DESC as its default", async () => {
    const { repository, query } = setup();
    await repository.findAllByStatus({});
    expect(query()).toContain("ORDER BY waitlist.createdAt DESC, waitlist.id ASC");
  });
});
