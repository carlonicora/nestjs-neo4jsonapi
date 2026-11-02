import { vi, describe, it, expect } from "vitest";
import { AbstractService } from "../abstract.service";
import { EntityDescriptor, RelationshipDef } from "../../../../common/interfaces/entity.schema.interface";
import { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";

class TestEntity {
  id: string;
}

const testDescriptor = {
  fieldNames: [],
  fieldDefaults: {},
  relationships: {},
  fields: {},
  computed: {},
  virtualFields: {},
  isCompanyScoped: true,
  model: { type: "tests", endpoint: "tests", nodeName: "test", labelName: "Test" },
} as unknown as EntityDescriptor<TestEntity, Record<string, RelationshipDef>>;

const testModel = {
  type: "tests",
  endpoint: "tests",
  nodeName: "test",
  labelName: "Test",
} as DataModelInterface<TestEntity>;

class TestService extends AbstractService<TestEntity> {
  protected readonly descriptor = testDescriptor;
}

const buildSut = () => {
  const repository: any = { findByRelated: vi.fn().mockResolvedValue([]) };
  const jsonApiService: any = { buildList: vi.fn().mockReturnValue({ data: [] }) };
  const clsService: any = { get: vi.fn() };
  const service = new TestService(jsonApiService, repository, clsService, testModel);
  return { service, repository };
};

describe("AbstractService.findByRelated with updatedSince", () => {
  it("findByRelated passes query.updatedSince to the repository", async () => {
    const { service, repository } = buildSut();

    await service.findByRelated({
      relationship: "campaign" as never,
      id: "campaign-1",
      query: { updatedSince: "2026-10-31T10:00:00.000Z", fetchAll: "true" },
      fetchAll: true,
    });

    expect(repository.findByRelated).toHaveBeenCalledWith(
      expect.objectContaining({ updatedSince: "2026-10-31T10:00:00.000Z" }),
    );
  });

  it("passes no updatedSince when the query has none", async () => {
    const { service, repository } = buildSut();

    await service.findByRelated({ relationship: "campaign" as never, id: "campaign-1", query: {} });

    expect(repository.findByRelated.mock.calls[0][0].updatedSince).toBeUndefined();
  });
});
