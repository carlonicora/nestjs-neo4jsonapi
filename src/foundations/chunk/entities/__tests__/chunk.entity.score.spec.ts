import { describe, expect, it } from "vitest";
import { ChunkDescriptor } from "../chunk.entity";

const recordWith = (columns: Record<string, unknown>) => ({
  has: (key: string) => key in columns,
  get: (key: string) => columns[key],
});

const mapWithRecord = (record: unknown) =>
  ChunkDescriptor.model.mapper({
    data: { id: "chunk-1", content: "text" },
    record,
    entityFactory: {},
  }) as { score?: number };

const map = (columns: Record<string, unknown>) => mapWithRecord(recordWith(columns));

describe("ChunkDescriptor computed score", () => {
  it("maps the chunk_score column", () => {
    expect(map({ chunk_score: 0.42 }).score).toBe(0.42);
    expect(map({ chunk_score: { toNumber: () => 1 } }).score).toBe(1);
  });

  it("ignores a bare score column and another alias's score column", () => {
    expect(map({ score: 0.9 }).score).toBeUndefined();
    expect(map({ judgement_score: 0.9 }).score).toBeUndefined();
  });

  it("leaves score undefined when the column is absent or null", () => {
    expect(map({}).score).toBeUndefined();
    expect(map({ chunk_score: null }).score).toBeUndefined();
  });

  it("leaves score undefined for a value that is not a finite number", () => {
    // Each row also carries a bare `score`, so the test fails today (the bare column is read).
    expect(map({ chunk_score: "0.5", score: 0.5 }).score).toBeUndefined();
    expect(map({ chunk_score: Number.NaN, score: 0.5 }).score).toBeUndefined();
    expect(map({ chunk_score: Number.POSITIVE_INFINITY, score: 0.5 }).score).toBeUndefined();
    expect(map({ chunk_score: { toNumber: () => Number.NaN }, score: 0.5 }).score).toBeUndefined();
  });

  it("does not throw on a record without has, or without a record", () => {
    expect(mapWithRecord({}).score).toBeUndefined();
    expect(mapWithRecord(undefined).score).toBeUndefined();
  });
});
