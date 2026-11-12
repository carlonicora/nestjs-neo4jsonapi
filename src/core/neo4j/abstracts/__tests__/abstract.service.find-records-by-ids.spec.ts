import { describe, expect, it, vi } from "vitest";
import { AbstractService } from "../abstract.service";
import { EntityDescriptor, RelationshipDef } from "../../../../common/interfaces/entity.schema.interface";
import { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";

type Thing = { id: string; name: string };

const descriptor = {
  fieldNames: ["name"],
  fieldDefaults: {},
  relationships: {},
  fields: {},
  computed: {},
  virtualFields: {},
  isCompanyScoped: true,
  model: { type: "things", endpoint: "things", nodeName: "thing", labelName: "Thing" },
} as unknown as EntityDescriptor<Thing, Record<string, RelationshipDef>>;

const model = {
  type: "things",
  endpoint: "things",
  nodeName: "thing",
  labelName: "Thing",
} as DataModelInterface<Thing>;

class ThingService extends AbstractService<Thing> {
  protected readonly descriptor = descriptor;
}

describe("AbstractService.findRecordsByIds (default)", () => {
  const build = (records: Record<string, Thing>) => {
    const repository = {
      findById: vi.fn(async ({ id }: { id: string }) => {
        if (!records[id]) throw new Error(`no ${id}`);
        return records[id];
      }),
    };
    const service = new ThingService({} as any, repository as any, {} as any, model);
    return { service, repository };
  };

  it("pairs each record with the id asked for, in the order of the ids, and leaves out misses", async () => {
    const { service } = build({ a: { id: "a", name: "A" }, b: { id: "b", name: "B" } });

    const result = await service.findRecordsByIds({ ids: ["b", "gone", "a"] });

    expect(result).toEqual([
      { id: "b", record: { id: "b", name: "B" } },
      { id: "a", record: { id: "a", name: "A" } },
    ]);
  });

  it("reads each id through findRecordById, one after the other", async () => {
    const { service } = build({ a: { id: "a", name: "A" }, b: { id: "b", name: "B" } });
    const spy = vi.spyOn(service, "findRecordById");

    await service.findRecordsByIds({ ids: ["a", "b"] });

    expect(spy.mock.calls).toEqual([[{ id: "a" }], [{ id: "b" }]]);
  });

  it("answers an empty list without reading", async () => {
    const { service, repository } = build({});

    expect(await service.findRecordsByIds({ ids: [] })).toEqual([]);
    expect(repository.findById).not.toHaveBeenCalled();
  });
});
