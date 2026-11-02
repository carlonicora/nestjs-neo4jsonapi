import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { OfflineChangeSetDescriptor } from "../offline-change-set";

const record = { has: () => false, get: () => undefined };

describe("OfflineChangeSetDescriptor", () => {
  it("results is derived, not a stored field: parsed from resultsJson, or taken as given", () => {
    expect(OfflineChangeSetDescriptor.fields).not.toHaveProperty("results");

    const results = [{ seq: 1, status: "applied" }];
    const stored = OfflineChangeSetDescriptor.model.mapper({
      data: { id: "pkg-1", resultsJson: JSON.stringify(results) },
      record,
      entityFactory: {},
    } as any) as any;
    expect(stored.results).toEqual(results);

    const given = OfflineChangeSetDescriptor.model.mapper({
      data: { id: "pkg-1", results },
      record,
      entityFactory: {},
    } as any) as any;
    expect(given.results).toEqual(results);

    const broken = OfflineChangeSetDescriptor.model.mapper({
      data: { id: "pkg-1", resultsJson: "{not json" },
      record,
      entityFactory: {},
    } as any) as any;
    expect(broken.results).toEqual([]);
  });

  it("results goes on the wire in attributes (never meta); resultsJson never does", () => {
    const Serialiser = OfflineChangeSetDescriptor.model.serialiser as any;
    const serialiser = new Serialiser({} as any, {} as any, { get: () => ({}) } as any);
    const builder = serialiser.create();

    expect(builder.attributes).toHaveProperty("results");
    expect(builder.attributes).not.toHaveProperty("resultsJson");
    expect(builder.meta ?? {}).not.toHaveProperty("results");
  });
});
