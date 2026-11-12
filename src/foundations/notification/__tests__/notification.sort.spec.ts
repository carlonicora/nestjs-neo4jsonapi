import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationController } from "../controllers/notification.controller";
import { NotificationRepository } from "../repositories/notification.repository";
import { NotificationServices } from "../services/notification.service";

/** Column sorting on the library notifications list (spec row A6): createdAt. */

describe("NotificationController sort", () => {
  it("forwards sort to the service", async () => {
    const service = { findForUser: vi.fn().mockResolvedValue({}) };
    const controller = new NotificationController(service as any, {} as any);
    await controller.findList({ user: { userId: "u" } }, {}, undefined, "createdAt");
    expect(service.findForUser).toHaveBeenCalledWith(expect.objectContaining({ sort: "createdAt", userId: "u" }));
  });
});

describe("NotificationServices sort", () => {
  let repository: { findForUser: ReturnType<typeof vi.fn> };
  let service: NotificationServices;

  beforeEach(() => {
    repository = { findForUser: vi.fn().mockResolvedValue([]) };
    service = new NotificationServices(
      { buildList: vi.fn().mockResolvedValue({ data: [] }) } as any,
      repository as any,
      { get: vi.fn() } as any,
    );
  });

  it("passes the validated sort to the repository", async () => {
    await service.findForUser({ query: {}, userId: "u", sort: "createdAt" });
    expect(repository.findForUser.mock.calls[0][0].orderByFields).toEqual([{ field: "createdAt", direction: "asc" }]);
  });

  it("refuses a hostile or unsortable sort with a 400 before any query", async () => {
    for (const sort of ["createdAt) DETACH DELETE n //", "message", "isRead"]) {
      await expect(service.findForUser({ query: {}, userId: "u", sort })).rejects.toThrow(BadRequestException);
    }
    expect(repository.findForUser).not.toHaveBeenCalled();
  });
});

describe("NotificationRepository.findForUser sort", () => {
  function setup() {
    const neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} as Record<string, any> })),
      readMany: vi.fn().mockResolvedValue([]),
    };
    const repository = new NotificationRepository(neo4j as any, {} as any, { get: vi.fn() } as any);
    return { repository, query: () => neo4j.readMany.mock.calls[0][0].query as string };
  }

  it("orders by the requested sort, then the id, before {CURSOR}", async () => {
    const { repository, query } = setup();
    await repository.findForUser({ userId: "u", orderByFields: [{ field: "createdAt", direction: "asc" }] });
    expect(query()).toContain("ORDER BY notification.createdAt ASC, notification.id ASC");
    expect(query().indexOf("{CURSOR}")).toBeGreaterThan(query().indexOf("ORDER BY"));
  });

  it("keeps createdAt DESC as its default", async () => {
    const { repository, query } = setup();
    await repository.findForUser({ userId: "u" });
    expect(query()).toContain("ORDER BY notification.createdAt DESC, notification.id ASC");
  });
});
