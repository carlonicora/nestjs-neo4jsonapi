import { describe, it, expect, vi } from "vitest";
import { RelatedEdgesService } from "../related-edges.service";

function mockRecords(rows: { id: string; label: string }[]) {
  return {
    records: rows.map((row) => ({
      get: (key: string) => (row as any)[key],
    })),
  };
}

describe("RelatedEdgesService", () => {
  it("matches both directions, returns DISTINCT id + label, and bounds with toInteger($limit)", async () => {
    const neo4j: any = { read: vi.fn(async () => mockRecords([{ id: "a1", label: "Alpha" }])) };
    const service = new RelatedEdgesService(neo4j);

    const out = await service.findRelatedIds({
      labelName: "Thing",
      id: "id1",
      cypherLabel: "RELATES_TO",
      limit: 11,
    });

    expect(neo4j.read).toHaveBeenCalledTimes(1);
    const [cypher, params] = neo4j.read.mock.calls[0];
    // Undirected match: a link recorded either way must be found.
    expect(cypher).toContain("MATCH (source:Thing { id: $id })-[:RELATES_TO]-(x)");
    expect(cypher).not.toContain("]->(x)");
    expect(cypher).not.toContain("<-[:");
    expect(cypher).toContain("RETURN DISTINCT x.id AS id, labels(x)[0] AS label");
    // Hand-written LIMIT must cast: a JS number renders as "11.0" otherwise.
    expect(cypher).toContain("LIMIT toInteger($limit)");
    // id and limit are parameters, never interpolated.
    expect(cypher).not.toContain("id1");
    expect(cypher).not.toContain("11");
    expect(params).toEqual({ id: "id1", limit: 11 });

    expect(out).toEqual([{ id: "a1", label: "Alpha" }]);
  });

  it("maps every returned record to { id, label }", async () => {
    const neo4j: any = {
      read: vi.fn(async () =>
        mockRecords([
          { id: "a1", label: "Alpha" },
          { id: "b1", label: "Beta" },
        ]),
      ),
    };
    const service = new RelatedEdgesService(neo4j);
    const out = await service.findRelatedIds({ labelName: "Thing", id: "id1", cypherLabel: "RELATES_TO", limit: 5 });
    expect(out).toEqual([
      { id: "a1", label: "Alpha" },
      { id: "b1", label: "Beta" },
    ]);
  });

  it("returns an empty array when the driver yields no records", async () => {
    const neo4j: any = { read: vi.fn(async () => ({})) };
    const service = new RelatedEdgesService(neo4j);
    await expect(
      service.findRelatedIds({ labelName: "Thing", id: "id1", cypherLabel: "RELATES_TO", limit: 5 }),
    ).resolves.toEqual([]);
  });
});
