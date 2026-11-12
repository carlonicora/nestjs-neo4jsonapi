import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";
import { EntityDescriptor, RelationshipDef } from "../../../../common/interfaces/entity.schema.interface";
import { SortCriterion } from "../../types/filter.criterion";
import { AbstractService } from "../abstract.service";

type TestEntity = { id: string; name: string; secret: string; company?: { id: string } };

const testDescriptor = {
  fieldNames: ["name", "secret"],
  fieldDefaults: {},
  relationships: { owner: { model: { labelName: "User" }, direction: "in", relationship: "CREATED" } },
  fields: { name: { type: "string", sortable: true }, secret: { type: "string" } },
  computed: {},
  virtualFields: {},
  isCompanyScoped: true,
  model: { type: "tests", endpoint: "tests", nodeName: "test", labelName: "Test" },
} as unknown as EntityDescriptor<TestEntity, Record<string, RelationshipDef>>;

class TestService extends AbstractService<TestEntity> {
  protected readonly descriptor = testDescriptor;

  /** Exposes the protected helper to the spec. */
  public parseSortForSpec(sort?: string, allow?: readonly string[]): SortCriterion[] | undefined {
    return this.parseSort(sort, allow);
  }
}

describe("AbstractService sort", () => {
  let service: TestService;
  let repository: { find: ReturnType<typeof vi.fn>; findByRelated: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    repository = { find: vi.fn().mockResolvedValue([]), findByRelated: vi.fn().mockResolvedValue([]) };
    const jsonApiService = { buildList: vi.fn().mockResolvedValue({ data: [] }) };
    service = new TestService(
      jsonApiService as any,
      repository as any,
      { get: vi.fn() } as any,
      { type: "tests" } as DataModelInterface<TestEntity>,
    );
  });

  describe("find", () => {
    it("turns sort into orderByFields and ignores the legacy orderBy", async () => {
      await service.find({ query: {}, sort: "name", orderBy: "secret DESC" });

      const args = repository.find.mock.calls[0][0];
      expect(args.orderByFields).toEqual([{ field: "name", direction: "asc" }]);
      expect(args.orderBy).toBeUndefined();
    });

    it("refuses a field the descriptor does not mark sortable with a 400, before any query", async () => {
      await expect(service.find({ query: {}, sort: "secret" })).rejects.toThrow(BadRequestException);
      expect(repository.find).not.toHaveBeenCalled();
    });

    it("keeps the legacy orderBy when no sort is sent (library backward compatibility)", async () => {
      await service.find({ query: {}, orderBy: "name" });

      const args = repository.find.mock.calls[0][0];
      expect(args.orderBy).toBe("name");
      expect(args.orderByFields).toBeUndefined();
    });

    it("forwards the search term together with the sort", async () => {
      await service.find({ query: {}, term: "acme", sort: "-createdAt" });

      const args = repository.find.mock.calls[0][0];
      expect(args.term).toBe("acme");
      expect(args.orderByFields).toEqual([{ field: "createdAt", direction: "desc" }]);
    });
  });

  describe("findByRelated", () => {
    it("turns sort into orderByFields and ignores the legacy orderBy", async () => {
      await service.findByRelated({ relationship: "owner", id: "u-1", query: {}, sort: "-name", orderBy: "secret" });

      const args = repository.findByRelated.mock.calls[0][0];
      expect(args.orderByFields).toEqual([{ field: "name", direction: "desc" }]);
      expect(args.orderBy).toBeUndefined();
    });

    it("refuses a non-sortable field with a 400", async () => {
      await expect(
        service.findByRelated({ relationship: "owner", id: "u-1", query: {}, sort: "secret" }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.findByRelated).not.toHaveBeenCalled();
    });

    it("keeps the legacy orderBy when no sort is sent", async () => {
      await service.findByRelated({ relationship: "owner", id: "u-1", query: {}, orderBy: "name" });

      const args = repository.findByRelated.mock.calls[0][0];
      expect(args.orderBy).toBe("name");
      expect(args.orderByFields).toBeUndefined();
    });
  });

  describe("parseSort", () => {
    it("validates against this service's descriptor plus the caller's allow-list", () => {
      expect(service.parseSortForSpec("name,-rank", ["rank"])).toEqual([
        { field: "name", direction: "asc" },
        { field: "rank", direction: "desc" },
      ]);
      expect(service.parseSortForSpec(undefined)).toBeUndefined();
      expect(() => service.parseSortForSpec("rank")).toThrow(BadRequestException);
    });
  });
});
