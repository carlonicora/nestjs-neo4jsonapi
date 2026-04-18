import { vi, describe, it, expect } from "vitest";
import { NameEmbeddingService } from "./name.embedding.service";

describe("NameEmbeddingService", () => {
  const makeDeps = () => {
    const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
    const neo4j = {
      read: vi.fn(),
      writeOne: vi.fn().mockResolvedValue(undefined),
    };
    const catalog = {
      getCatalogEntityByLabel: vi.fn(),
    };
    const cls = { get: (k: string) => (k === "companyId" ? "c1" : undefined) };
    return { embedder, neo4j, catalog, cls };
  };

  it("composes the embedding text from descriptor.textSearchFields, embeds, and writes back", async () => {
    const { embedder, neo4j, catalog, cls } = makeDeps();
    catalog.getCatalogEntityByLabel.mockReturnValue({ labelName: "Account", textSearchFields: ["name"] });
    neo4j.read.mockResolvedValue({
      records: [{ get: (k: string) => (k === "props" ? { id: "a1", name: "Faby and Carlo" } : undefined) }],
    });

    const svc = new NameEmbeddingService(embedder as any, neo4j as any, catalog as any, cls as any);
    await svc.embed({ entityType: "Account", entityId: "a1" });

    expect(embedder.vectoriseText).toHaveBeenCalledWith({ text: "Faby and Carlo" });
    expect(neo4j.writeOne).toHaveBeenCalledWith({
      query: expect.stringContaining("SET n.name_embedding = $embedding"),
      queryParams: expect.objectContaining({
        id: "a1",
        companyId: "c1",
        embedding: [0.1, 0.2, 0.3],
        source: "Faby and Carlo",
      }),
    });
  });

  it("joins multiple textSearchFields with a space when composing source text", async () => {
    const { embedder, neo4j, catalog, cls } = makeDeps();
    catalog.getCatalogEntityByLabel.mockReturnValue({
      labelName: "Person",
      textSearchFields: ["first_name", "last_name"],
    });
    neo4j.read.mockResolvedValue({
      records: [
        {
          get: (k: string) => (k === "props" ? { id: "p1", first_name: "Mario", last_name: "Rossi" } : undefined),
        },
      ],
    });

    const svc = new NameEmbeddingService(embedder as any, neo4j as any, catalog as any, cls as any);
    await svc.embed({ entityType: "Person", entityId: "p1" });

    expect(embedder.vectoriseText).toHaveBeenCalledWith({ text: "Mario Rossi" });
  });

  it("skips embedding when source text equals stored name_embedding_source (dedup)", async () => {
    const { embedder, neo4j, catalog, cls } = makeDeps();
    catalog.getCatalogEntityByLabel.mockReturnValue({ labelName: "Account", textSearchFields: ["name"] });
    neo4j.read.mockResolvedValue({
      records: [
        {
          get: (k: string) =>
            k === "props" ? { id: "a1", name: "Faby and Carlo", name_embedding_source: "Faby and Carlo" } : undefined,
        },
      ],
    });

    const svc = new NameEmbeddingService(embedder as any, neo4j as any, catalog as any, cls as any);
    await svc.embed({ entityType: "Account", entityId: "a1" });

    expect(embedder.vectoriseText).not.toHaveBeenCalled();
    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });

  it("noops when the descriptor is not chat-enabled (no textSearchFields)", async () => {
    const { embedder, neo4j, catalog, cls } = makeDeps();
    catalog.getCatalogEntityByLabel.mockReturnValue({ labelName: "Account", textSearchFields: undefined });

    const svc = new NameEmbeddingService(embedder as any, neo4j as any, catalog as any, cls as any);
    await svc.embed({ entityType: "Account", entityId: "a1" });

    expect(embedder.vectoriseText).not.toHaveBeenCalled();
    expect(neo4j.writeOne).not.toHaveBeenCalled();
    expect(neo4j.read).not.toHaveBeenCalled();
  });

  it("noops when the composed text is empty", async () => {
    const { embedder, neo4j, catalog, cls } = makeDeps();
    catalog.getCatalogEntityByLabel.mockReturnValue({ labelName: "Account", textSearchFields: ["name"] });
    neo4j.read.mockResolvedValue({
      records: [{ get: (k: string) => (k === "props" ? { id: "a1", name: "" } : undefined) }],
    });

    const svc = new NameEmbeddingService(embedder as any, neo4j as any, catalog as any, cls as any);
    await svc.embed({ entityType: "Account", entityId: "a1" });

    expect(embedder.vectoriseText).not.toHaveBeenCalled();
    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });

  it("noops when the entity does not exist (read returns no records)", async () => {
    const { embedder, neo4j, catalog, cls } = makeDeps();
    catalog.getCatalogEntityByLabel.mockReturnValue({ labelName: "Account", textSearchFields: ["name"] });
    neo4j.read.mockResolvedValue({ records: [] });

    const svc = new NameEmbeddingService(embedder as any, neo4j as any, catalog as any, cls as any);
    await svc.embed({ entityType: "Account", entityId: "missing" });

    expect(embedder.vectoriseText).not.toHaveBeenCalled();
    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });
});
