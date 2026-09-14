import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiStatus } from "../../../../common/enums/ai.status";
import { HandbookPageRepository } from "../handbook-page.repository";

const captured: { query: string; queryParams: Record<string, unknown> }[] = [];

function makeNeo4j() {
  return {
    initQuery: vi.fn(() => ({ query: "", queryParams: {} })),
    writeOne: vi.fn(async (q: any) => {
      captured.push({ query: q.query, queryParams: q.queryParams ?? {} });
    }),
    // `super.onModuleInit()` inspects SHOW INDEXES before (re)creating the
    // descriptor's FULLTEXT index — an empty record set is "not created yet".
    read: vi.fn(async (_query: string, _params?: any) => ({ records: [] as any[] })),
    readOne: vi.fn(async (_query: any) => null),
    readMany: vi.fn(async (_query: any) => []),
  };
}

describe("HandbookPageRepository", () => {
  let neo4j: ReturnType<typeof makeNeo4j>;
  let repository: HandbookPageRepository;

  beforeEach(() => {
    captured.length = 0;
    neo4j = makeNeo4j();
    // `buildDefaultMatch()` reads companyId/userId off CLS on every read, so the
    // ClsService double must answer `get` even though a global entity ignores both.
    const clsService = { get: vi.fn(() => undefined), set: vi.fn() };
    // The inherited `find` asks SecurityService for the access snippet; a
    // global entity needs none, so the double returns an empty fragment.
    const securityService = { userHasAccess: vi.fn(() => "") };
    repository = new HandbookPageRepository(neo4j as any, securityService as any, clsService as any);
  });

  it("creates a uniqueness constraint on path at boot", async () => {
    await repository.onModuleInit();
    expect(captured.some((c) => /CONSTRAINT handbookpage_path/.test(c.query))).toBe(true);
    expect(captured.some((c) => /REQUIRE handbookPage.path IS UNIQUE/.test(c.query))).toBe(true);
  });

  it("still creates the descriptor's own id constraint at boot", async () => {
    await repository.onModuleInit();
    expect(captured.some((c) => /REQUIRE handbookPage.id IS UNIQUE/.test(c.query))).toBe(true);
  });

  it("binds every value on create rather than interpolating", async () => {
    await repository.createPage({
      id: "id-1",
      path: "03-backend/module-anatomy.md",
      title: "Module anatomy",
      content: "# Module anatomy",
      contentHash: "abc",
      wordCount: 3,
      section: "03-backend",
      order: "03-backend/module-anatomy.md",
    });
    const write = captured.at(-1)!;
    expect(write.query).not.toContain("module-anatomy.md");
    expect(write.queryParams).toMatchObject({
      id: "id-1",
      path: "03-backend/module-anatomy.md",
      title: "Module anatomy",
      contentHash: "abc",
      wordCount: 3,
    });
  });

  it("never attaches a company on create", async () => {
    await repository.createPage({
      id: "id-1",
      path: "a.md",
      title: "A",
      content: "#A",
      contentHash: "h",
      wordCount: 1,
      section: "",
      order: "a.md",
    });
    expect(captured.at(-1)!.query).not.toContain("BELONGS_TO");
  });

  it("updates content without touching path", async () => {
    await repository.updatePage({
      id: "id-1",
      title: "B",
      content: "#B",
      contentHash: "h2",
      wordCount: 2,
      section: "03-backend",
      order: "03-backend/b.md",
    });
    const write = captured.at(-1)!;
    expect(write.query).toContain("SET");
    expect(write.query).not.toContain(".path =");
    expect(write.queryParams).toMatchObject({ id: "id-1", contentHash: "h2" });
  });

  it("writes the status through a bound parameter", async () => {
    await repository.updateStatus({ id: "id-1", aiStatus: AiStatus.Completed });
    expect(captured.at(-1)!.queryParams).toMatchObject({ id: "id-1", aiStatus: "completed" });
  });

  it("deletes by a bound id", async () => {
    await repository.deletePage({ id: "id-1" });
    const write = captured.at(-1)!;
    expect(write.query).toContain("DETACH DELETE");
    expect(write.query).not.toContain("id-1");
    expect(write.queryParams).toMatchObject({ id: "id-1" });
  });

  it("reads through the serialiser, never raw records", async () => {
    await repository.findAllPages();
    expect(neo4j.readMany).toHaveBeenCalled();
    expect(neo4j.initQuery).toHaveBeenCalledWith(expect.objectContaining({ serialiser: expect.anything() }));
  });

  it("binds the path on lookup rather than interpolating it", async () => {
    await repository.findByPath({ path: "03-backend/module-anatomy.md" });
    expect(neo4j.readOne).toHaveBeenCalled();
    const query = neo4j.readOne.mock.calls[0][0] as any;
    expect(query.query).not.toContain("module-anatomy.md");
    expect(query.queryParams).toMatchObject({ path: "03-backend/module-anatomy.md" });
  });
  it("orders the default list by section then order, ahead of the cursor", async () => {
    await repository.find({});

    const query = (neo4j.readMany.mock.calls.at(-1)![0] as any).query as string;
    expect(query).toContain("ORDER BY handbookPage.section ASC, handbookPage.order ASC");
    expect(query.indexOf("ORDER BY handbookPage.section")).toBeLessThan(query.indexOf("{CURSOR}"));
    expect(query).not.toMatch(/\bSKIP\b|\bLIMIT\b/);
  });

  it("lets an explicit ordering from the request win", async () => {
    await repository.find({ orderBy: "title ASC" });

    const query = (neo4j.readMany.mock.calls.at(-1)![0] as any).query as string;
    expect(query).toContain("ORDER BY handbookPage.title ASC");
    expect(query).not.toContain("handbookPage.section ASC");
  });

  it("writes section, order and summary on create", async () => {
    await repository.createPage({
      id: "p1",
      path: "03-backend/testing.md",
      title: "Testing the API",
      content: "body",
      contentHash: "h",
      wordCount: 3,
      section: "03-backend",
      order: "03-backend/testing.md",
      summary: "How the API is tested.",
    });

    const write = captured.at(-1)!;
    expect(write.query).toContain("section: $section");
    expect(write.query).toContain("order: $order");
    expect(write.query).toContain("summary: $summary");
    expect(write.queryParams.section).toBe("03-backend");
    expect(write.queryParams.summary).toBe("How the API is tested.");
  });

  it("binds a missing summary as null rather than an undefined parameter", async () => {
    await repository.createPage({
      id: "p1",
      path: "a.md",
      title: "A",
      content: "#A",
      contentHash: "h",
      wordCount: 1,
      section: "",
      order: "a.md",
    });

    expect(captured.at(-1)!.queryParams.summary).toBeNull();
  });

  it("writes section, order and summary on update", async () => {
    await repository.updatePage({
      id: "p1",
      title: "Testing the API",
      content: "body",
      contentHash: "h2",
      wordCount: 3,
      section: "03-backend",
      order: "03-backend/testing.md",
      summary: "How the API is tested.",
    });

    const write = captured.at(-1)!;
    expect(write.query).toContain("handbookPage.section = $section");
    expect(write.query).toContain("handbookPage.order = $order");
    expect(write.query).toContain("handbookPage.summary = $summary");
  });

  it("updateMetadata writes the index fields and leaves content and hash alone", async () => {
    await repository.updateMetadata({
      id: "p1",
      title: "Testing the API",
      section: "03-backend",
      order: "03-backend/testing.md",
      summary: "How the API is tested.",
    });

    const write = captured.at(-1)!;
    expect(write.query).toContain("SET handbookPage.title = $title");
    expect(write.query).toContain("handbookPage.section = $section");
    expect(write.query).not.toContain("contentHash");
    expect(write.query).not.toContain(".content =");
    expect(write.query).not.toContain("aiStatus");
    expect(write.queryParams).toMatchObject({ id: "p1", section: "03-backend" });
  });

  it("updateDisplay writes only the three display fields, never content, hash or status", async () => {
    await repository.updateDisplay({
      id: "p1",
      displayTitle: "Anatomia di un feature module dell'API",
      displaySummary: "La forma di ogni modulo.",
      displayContent: "Corpo tradotto.",
    });

    const write = captured.at(-1)!;
    expect(write.query).toContain("handbookPage.displayTitle = $displayTitle");
    expect(write.query).toContain("handbookPage.displaySummary = $displaySummary");
    expect(write.query).toContain("handbookPage.displayContent = $displayContent");
    // The retrieval store must come out of a display write byte-for-byte as it
    // went in: the page is indexed in English and only SHOWN translated.
    expect(write.query).not.toContain("handbookPage.content =");
    expect(write.query).not.toContain("contentHash");
    expect(write.query).not.toContain("aiStatus");
  });

  it("updateDisplay binds every value rather than interpolating it", async () => {
    await repository.updateDisplay({ id: "p1", displayTitle: "Anatomia", displayContent: "Corpo tradotto." });

    const write = captured.at(-1)!;
    expect(write.query).not.toContain("Anatomia");
    expect(write.query).not.toContain("Corpo tradotto.");
    expect(write.queryParams).toMatchObject({ id: "p1", displayTitle: "Anatomia", displayContent: "Corpo tradotto." });
  });

  it("updateDisplay binds an absent translation as null rather than an undefined parameter", async () => {
    await repository.updateDisplay({ id: "p1" });

    const params = captured.at(-1)!.queryParams;
    expect(params.displayTitle).toBeNull();
    expect(params.displaySummary).toBeNull();
    expect(params.displayContent).toBeNull();
  });

  describe("findPathsByChunkIds", () => {
    const record = (path: unknown) => ({ get: (column: string) => (column === "path" ? path : undefined) });

    it("returns nothing and touches the database not at all for an empty list", async () => {
      const paths = await repository.findPathsByChunkIds({ chunkIds: [] });
      expect(paths).toEqual([]);
      expect(neo4j.read).not.toHaveBeenCalled();
    });

    it("binds the chunk ids rather than interpolating them", async () => {
      await repository.findPathsByChunkIds({ chunkIds: ["chunk-a", "chunk-b"] });
      const [query, params] = neo4j.read.mock.calls[0] as [string, any];
      expect(query).not.toContain("chunk-a");
      expect(query).toContain("$chunkIds");
      expect(params).toEqual({ chunkIds: ["chunk-a", "chunk-b"] });
    });

    it("walks HAS_CHUNK from the page to the chunk", async () => {
      await repository.findPathsByChunkIds({ chunkIds: ["chunk-a"] });
      const [query] = neo4j.read.mock.calls[0] as [string, any];
      expect(query).toContain("UNWIND $chunkIds AS chunkId");
      expect(query).toContain("(handbookPage:HandbookPage)-[:HAS_CHUNK]->(chunk:Chunk {id: chunkId})");
    });

    it("maps records to plain paths — no raw record ever leaves the repository", async () => {
      neo4j.read.mockResolvedValueOnce({ records: [record("a.md"), record("b.md")] } as any);

      const paths = await repository.findPathsByChunkIds({ chunkIds: ["c1", "c2"] });

      expect(paths).toEqual(["a.md", "b.md"]);
      expect(paths.every((path) => typeof path === "string")).toBe(true);
    });

    it("drops a row whose path is missing or empty rather than returning a blank source", async () => {
      neo4j.read.mockResolvedValueOnce({ records: [record("a.md"), record(null), record("")] } as any);

      expect(await repository.findPathsByChunkIds({ chunkIds: ["c1", "c2", "c3"] })).toEqual(["a.md"]);
    });
  });
});
