import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RelevancyRepository } from "../repositories/relevancy.repository";
import { RelevancyService } from "../services/relevancy.service";

/**
 * Column sorting on the relevance lists (spec rows A10, A15, call C17): `name` (and `email` for
 * users) is sortable; a chosen sort replaces the ranking, and clearing it brings the ranking back.
 */

describe("RelevancyService sort", () => {
  let repository: { findById: ReturnType<typeof vi.fn>; findUsersById: ReturnType<typeof vi.fn> };
  let service: RelevancyService<any>;

  beforeEach(() => {
    repository = { findById: vi.fn().mockResolvedValue([]), findUsersById: vi.fn().mockResolvedValue([]) };
    service = new RelevancyService({ buildList: vi.fn().mockResolvedValue({ data: [] }) } as any, repository as any);
  });

  it("findRelevant passes the validated sort to the repository", async () => {
    await service.findRelevant({ model: {} as any, cypherService: {}, id: "c", sort: "-name" });
    expect(repository.findById.mock.calls[0][0].orderByFields).toEqual([{ field: "name", direction: "desc" }]);
  });

  it("findRelevantUsers passes the validated sort to the repository", async () => {
    await service.findRelevantUsers({ cypherService: {}, id: "c", sort: "email" });
    expect(repository.findUsersById.mock.calls[0][0].orderByFields).toEqual([{ field: "email", direction: "asc" }]);
  });

  it("refuses a hostile or unknown sort with a 400 before any query", async () => {
    for (const sort of ["name) DETACH DELETE n //", "totalScore", "relevance"]) {
      await expect(service.findRelevant({ model: {} as any, cypherService: {}, id: "c", sort })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.findRelevantUsers({ cypherService: {}, id: "c", sort })).rejects.toThrow(
        BadRequestException,
      );
    }
    expect(repository.findById).not.toHaveBeenCalled();
    expect(repository.findUsersById).not.toHaveBeenCalled();
  });
});

describe("RelevancyRepository sort", () => {
  function setup() {
    const neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: { companyId: "co" } as Record<string, any> })),
      readMany: vi.fn().mockResolvedValue([]),
      readOne: vi.fn().mockResolvedValue({ id: "c" }),
    };
    const security = { userHasAccess: vi.fn(({ validator }: any) => validator()) };
    const config = { get: vi.fn(() => ({ types: ["Article"] })) };
    const repository = new RelevancyRepository(neo4j as any, security as any, config as any);
    const cypherService = {
      userHasAccess: vi.fn(() => "WITH content, totalScore"),
      returnStatement: vi.fn(() => "RETURN content"),
    };
    return { repository, cypherService, query: () => neo4j.readMany.mock.calls[0][0].query as string };
  }

  it("relevant contents: a sort replaces the ranking, before {CURSOR}", async () => {
    const { repository, cypherService, query } = setup();
    await repository.findById({
      model: { nodeName: "content" } as any,
      cypherService,
      id: "c",
      cursor: {} as any,
      orderByFields: [{ field: "name", direction: "asc" }],
    });
    expect(query()).toContain(
      "ORDER BY CASE WHEN content.name IS :: STRING THEN toLower(content.name) ELSE content.name END ASC, content.id ASC",
    );
    expect(query()).not.toContain("ORDER BY totalScore DESC");
    expect(query().indexOf("{CURSOR}")).toBeGreaterThan(
      query().indexOf("ORDER BY CASE WHEN content.name IS :: STRING THEN toLower(content.name) ELSE content.name END"),
    );
  });

  it("relevant contents: without a sort the ranking stays", async () => {
    const { repository, cypherService, query } = setup();
    await repository.findById({ model: { nodeName: "content" } as any, cypherService, id: "c", cursor: {} as any });
    expect(query()).toContain("ORDER BY totalScore DESC, content.id ASC");
  });

  it("relevant users: a sort replaces the ranking, before {CURSOR}", async () => {
    const { repository, cypherService, query } = setup();
    await repository.findUsersById({
      cypherService,
      id: "c",
      cursor: {} as any,
      orderByFields: [{ field: "email", direction: "desc" }],
    });
    expect(query()).toContain(
      "ORDER BY CASE WHEN author.email IS :: STRING THEN toLower(author.email) ELSE author.email END DESC, author.id ASC",
    );
    expect(query()).not.toContain("ORDER BY totalScore DESC");
    expect(query().indexOf("{CURSOR}")).toBeGreaterThan(
      query().indexOf("ORDER BY CASE WHEN author.email IS :: STRING THEN toLower(author.email) ELSE author.email END"),
    );
  });

  it("relevant users: without a sort the ranking stays", async () => {
    const { repository, cypherService, query } = setup();
    await repository.findUsersById({ cypherService, id: "c", cursor: {} as any });
    expect(query()).toContain("ORDER BY totalScore DESC, author.id ASC");
  });
});
