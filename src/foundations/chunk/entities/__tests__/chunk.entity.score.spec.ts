import { describe, expect, it } from "vitest";
import { ChunkDescriptor } from "../chunk.entity";

const recordWith = (columns: Record<string, unknown>) => ({
  has: (key: string) => key in columns,
  get: (key: string) => columns[key],
});

const map = (columns: Record<string, unknown>) =>
  ChunkDescriptor.model.mapper({
    data: { id: "chunk-1", content: "text" },
    record: recordWith(columns),
    entityFactory: {},
  }) as { score?: number };

describe("ChunkDescriptor computed score", () => {
  it("maps a projected score column", () => {
    expect(map({ score: 0.42 }).score).toBe(0.42);
    expect(map({ score: { toNumber: () => 1 } }).score).toBe(1);
  });

  it("leaves score undefined when the column is absent", () => {
    expect(map({}).score).toBeUndefined();
  });

  it("leaves score undefined when the column is null (no embedding)", () => {
    expect(map({ score: null }).score).toBeUndefined();
  });
});
