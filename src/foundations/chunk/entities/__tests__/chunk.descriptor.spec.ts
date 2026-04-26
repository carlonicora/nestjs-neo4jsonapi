import { ChunkDescriptor } from "../chunk.entity";

describe("ChunkDescriptor", () => {
  it("declares the Neo4j label and JSON:API type", () => {
    expect(ChunkDescriptor.model.labelName).toBe("Chunk");
    expect(ChunkDescriptor.model.type).toBe("chunks");
  });

  it("declares the source relationship as polymorphic", () => {
    const source = ChunkDescriptor.relationships.source;
    expect(source.relationship).toBe("HAS_CHUNK");
    expect(source.direction).toBe("in");
    expect(source.cardinality).toBe("one");
    expect(typeof (source as any).polymorphic?.discriminator).toBe("function");
  });

  it("exposes content, nodeId, nodeType, imagePath as fields", () => {
    expect(ChunkDescriptor.fields.content).toBeDefined();
    expect(ChunkDescriptor.fields.nodeId).toBeDefined();
    expect(ChunkDescriptor.fields.nodeType).toBeDefined();
    expect(ChunkDescriptor.fields.imagePath).toBeDefined();
  });
});
