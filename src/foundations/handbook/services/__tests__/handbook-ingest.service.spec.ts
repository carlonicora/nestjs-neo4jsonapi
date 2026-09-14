import { BadRequestException } from "@nestjs/common";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HandbookIngestService } from "../handbook-ingest.service";

function makeRepository(existing: any[] = []) {
  const pages = [...existing];
  return {
    pages,
    findAllPages: vi.fn(async () => pages),
    createPage: vi.fn(async (p: any) => {
      pages.push({ ...p });
    }),
    updatePage: vi.fn(async () => {}),
    updateMetadata: vi.fn(async () => {}),
    updateDisplay: vi.fn(async () => {}),
    deletePage: vi.fn(async () => {}),
  };
}

function makeSectionRepository() {
  return { findAllSections: vi.fn(async () => []), replaceAll: vi.fn(async () => {}) };
}

function makePageService() {
  return { chunkAndQueue: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
}

function makeLogger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** Configured by default; one test flips it. */
function makeModelService(configured = true) {
  return { isAiConfigured: vi.fn(() => configured) };
}

function makeService(params: {
  config: { path: string; exclude: string[]; displayPath?: string };
  repository?: any;
  sectionRepository?: any;
  pageService?: any;
  modelService?: any;
}) {
  return new HandbookIngestService(
    params.config as any,
    params.repository ?? makeRepository(),
    params.sectionRepository ?? makeSectionRepository(),
    params.pageService ?? makePageService(),
    params.modelService ?? makeModelService(),
    makeLogger() as any,
  );
}

describe("HandbookIngestService.sync", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "handbook-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses when AI is not configured, before reading anything", async () => {
    writeFileSync(join(root, "one.md"), "# One");
    const repository = makeRepository();
    const pageService = makePageService();
    const service = makeService({
      config: { path: root, exclude: [] },
      repository,
      pageService,
      modelService: makeModelService(false),
    });

    await expect(service.sync()).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.findAllPages).not.toHaveBeenCalled();
    expect(repository.createPage).not.toHaveBeenCalled();
    expect(pageService.chunkAndQueue).not.toHaveBeenCalled();
  });

  it("refuses when no path is configured", async () => {
    const service = makeService({ config: { path: "", exclude: [] } });
    await expect(service.sync()).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses when the configured directory does not exist", async () => {
    const service = makeService({ config: { path: join(root, "missing"), exclude: [] } });
    await expect(service.sync()).rejects.toBeInstanceOf(BadRequestException);
  });

  it("creates a page per markdown file and chunks it", async () => {
    writeFileSync(join(root, "one.md"), "# One\n\nBody text here.");
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "two.md"), "# Two\n\nMore body.");
    writeFileSync(join(root, "notes.txt"), "ignored");

    const repository = makeRepository();
    const pageService = makePageService();
    const service = makeService({ config: { path: root, exclude: [] }, repository, pageService });

    const result = await service.sync();

    expect(result.created).toBe(2);
    expect(result.unchanged).toBe(0);
    expect(repository.createPage).toHaveBeenCalledTimes(2);
    expect(pageService.chunkAndQueue).toHaveBeenCalledTimes(2);
    const paths = repository.createPage.mock.calls.map((c: any[]) => c[0].path).sort();
    expect(paths).toEqual(["one.md", "sub/two.md"]);
    expect(repository.createPage.mock.calls[0][0].title).toMatch(/^(One|Two)$/);
  });

  it("skips a file whose hash is unchanged and never re-chunks it", async () => {
    writeFileSync(join(root, "one.md"), "# One\n\nBody.");
    const repository = makeRepository();
    const pageService = makePageService();
    const first = makeService({ config: { path: root, exclude: [] }, repository, pageService });
    await first.sync();
    pageService.chunkAndQueue.mockClear();

    const result = await first.sync();

    expect(result.unchanged).toBe(1);
    expect(result.created).toBe(0);
    expect(pageService.chunkAndQueue).not.toHaveBeenCalled();
  });

  it("re-chunks a file whose content changed", async () => {
    writeFileSync(join(root, "one.md"), "# One\n\nBody.");
    const repository = makeRepository();
    const pageService = makePageService();
    const service = makeService({ config: { path: root, exclude: [] }, repository, pageService });
    await service.sync();
    writeFileSync(join(root, "one.md"), "# One\n\nBody, edited.");
    pageService.chunkAndQueue.mockClear();

    const result = await service.sync();

    expect(result.updated).toBe(1);
    expect(repository.updatePage).toHaveBeenCalledTimes(1);
    expect(pageService.chunkAndQueue).toHaveBeenCalledTimes(1);
  });

  it("takes the title from YAML frontmatter and keeps the block out of the content", async () => {
    writeFileSync(
      join(root, "one.md"),
      "---\ntitle: Day-one checklist\nsection: 00-start-here\nsources_verified: 2026-09-10\n---\n\nNine things to do on your first day.",
    );
    const repository = makeRepository();
    const pageService = makePageService();
    const service = makeService({ config: { path: root, exclude: [] }, repository, pageService });

    await service.sync();

    const created = repository.createPage.mock.calls[0][0];
    expect(created.title).toBe("Day-one checklist");
    expect(created.content).toBe("Nine things to do on your first day.");
    expect(created.content).not.toContain("sources_verified");
    expect(pageService.chunkAndQueue.mock.calls[0][0].markdown).not.toContain("---");
  });

  it("falls back to the first H1, then the filename", async () => {
    writeFileSync(join(root, "heading.md"), "# A real heading\n\nBody.");
    writeFileSync(join(root, "bare.md"), "Body with no heading at all.");
    const repository = makeRepository();
    const service = makeService({ config: { path: root, exclude: [] }, repository });

    await service.sync();

    const byPath = Object.fromEntries(repository.createPage.mock.calls.map((c: any[]) => [c[0].path, c[0].title]));
    expect(byPath["heading.md"]).toBe("A real heading");
    expect(byPath["bare.md"]).toBe("bare");
  });

  it("re-ingests when only the frontmatter changed", async () => {
    writeFileSync(join(root, "one.md"), "---\ntitle: First\n---\n\nBody.");
    const repository = makeRepository();
    const pageService = makePageService();
    const service = makeService({ config: { path: root, exclude: [] }, repository, pageService });
    await service.sync();
    writeFileSync(join(root, "one.md"), "---\ntitle: Second\n---\n\nBody.");
    pageService.chunkAndQueue.mockClear();

    const result = await service.sync();

    expect(result.updated).toBe(1);
    expect(repository.updatePage.mock.calls[0][0].title).toBe("Second");
    expect(pageService.chunkAndQueue).toHaveBeenCalledTimes(1);
  });

  it("honours exclude globs", async () => {
    mkdirSync(join(root, "it"));
    writeFileSync(join(root, "it", "uno.md"), "# Uno");
    writeFileSync(join(root, "one.md"), "# One");

    const repository = makeRepository();
    const service = makeService({ config: { path: root, exclude: ["it/**"] }, repository });

    const result = await service.sync();

    expect(result.created).toBe(1);
    expect(repository.createPage.mock.calls[0][0].path).toBe("one.md");
  });

  it("deletes pages whose file is gone", async () => {
    writeFileSync(join(root, "one.md"), "# One");
    const repository = makeRepository([{ id: "stale-id", path: "removed.md", contentHash: "whatever" }]);
    const pageService = makePageService();
    const service = makeService({ config: { path: root, exclude: [] }, repository, pageService });

    const result = await service.sync();

    expect(result.deleted).toBe(1);
    // Through the service, so the page's chunks go with it — the repository
    // call alone would leave them orphaned and still answering retrieval.
    expect(pageService.delete).toHaveBeenCalledWith({ id: "stale-id" });
  });

  it("records a failing file and keeps walking", async () => {
    writeFileSync(join(root, "one.md"), "# One");
    writeFileSync(join(root, "two.md"), "# Two");
    const repository = makeRepository();
    const pageService = makePageService();
    pageService.chunkAndQueue.mockRejectedValueOnce(new Error("chunker exploded"));
    const service = makeService({ config: { path: root, exclude: [] }, repository, pageService });

    const result = await service.sync();

    expect(result.failed).toHaveLength(1);
    expect(result.created).toBe(1);
  });
});

describe("splitFrontmatter", () => {
  const service = makeService({ config: { path: "", exclude: [] } });

  it("returns every scalar key of the block", () => {
    const raw = `---\ntitle: Testing the API\nsection: 03-backend\nsources_verified: 2026-09-10\n---\n\nBody.`;
    const result = (service as any).splitFrontmatter(raw);
    expect(result.frontmatter).toEqual({
      title: "Testing the API",
      section: "03-backend",
      sources_verified: "2026-09-10",
    });
    expect(result.body).toBe("Body.");
  });

  it("returns an empty record for a file with no block", () => {
    const result = (service as any).splitFrontmatter("# Heading\n");
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("# Heading\n");
  });
});

describe("parseIndex", () => {
  const service = makeService({ config: { path: "", exclude: [] } });

  const readme = [
    "# Developer handbook",
    "",
    "## 03-backend",
    "",
    "The API and how it is built.",
    "",
    "- [Testing the API](03-backend/testing.md) — the spec layout and what is mocked.",
    "- [Migrations](03-backend/migrations.md) — how a schema change reaches production.",
  ].join("\n");

  it("maps section keys to title and summary", () => {
    const result = (service as any).parseIndex(readme);
    expect(result.sections.get("03-backend")).toEqual({
      title: "Backend",
      summary: "The API and how it is built.",
    });
  });

  it("maps page paths to their one-line summary", () => {
    const result = (service as any).parseIndex(readme);
    expect(result.summaries.get("03-backend/testing.md")).toBe("the spec layout and what is mocked.");
  });

  it("takes an authored title from a heading that carries one", () => {
    const titled = ["## 06-ai — AI", "", "The model layer.", ""].join("\n");

    const result = (service as any).parseIndex(titled);

    // Not "Ai": derivation sentence-cases the key, and an acronym survives only
    // when the index says so.
    expect(result.sections.get("06-ai")).toEqual({ title: "AI", summary: "The model layer." });
  });

  it("accepts a translated title under the same English key", () => {
    const titled = ["## 09-workflow — Flusso di lavoro", "", "Come si lavora.", ""].join("\n");

    const result = (service as any).parseIndex(titled);

    expect(result.sections.get("09-workflow")).toEqual({
      title: "Flusso di lavoro",
      summary: "Come si lavora.",
    });
  });

  it("does not split a key on its own hyphens", () => {
    const result = (service as any).parseIndex(["## 00-start-here", "", "Orientation.", ""].join("\n"));

    expect([...result.sections.keys()]).toEqual(["00-start-here"]);
    expect(result.sections.get("00-start-here")?.title).toBe("Start here");
  });

  it("accepts a plain hyphen separator as well as an em dash", () => {
    const result = (service as any).parseIndex(["## 05-domains - Domini", "", "I domini.", ""].join("\n"));

    expect(result.sections.get("05-domains")?.title).toBe("Domini");
  });

  it("joins a blurb the index wrapped across several lines", () => {
    const wrapped = [
      "## 00-start-here",
      "",
      "Enough to get the stack running, the vocabulary to read the code, and an index",
      "of common tasks.",
      "",
      "- [Reading order](00-start-here/reading-order.md) — the three paths, page by page.",
    ].join("\n");

    const result = (service as any).parseIndex(wrapped);

    expect(result.sections.get("00-start-here")?.summary).toBe(
      "Enough to get the stack running, the vocabulary to read the code, and an index of common tasks.",
    );
  });

  it("steps over a fenced code block rather than summarising a section with it", () => {
    const fenced = [
      "## Checking the handbook",
      "",
      "```bash",
      "node scripts/check-handbook.mjs",
      "```",
      "",
      "The checker walks every page and fails",
      "on a cited path that does not exist.",
    ].join("\n");

    const result = (service as any).parseIndex(fenced);

    expect(result.sections.get("Checking the handbook")?.summary).toBe(
      "The checker walks every page and fails on a cited path that does not exist.",
    );
  });

  it("returns empty maps for an index it cannot read", () => {
    const result = (service as any).parseIndex("");
    expect(result.sections.size).toBe(0);
    expect(result.summaries.size).toBe(0);
  });
});

describe("sectionTitle", () => {
  const service = makeService({ config: { path: "", exclude: [] } });

  it("strips the numeric prefix and sentence-cases the rest", () => {
    expect((service as any).sectionTitle("00-start-here")).toBe("Start here");
    expect((service as any).sectionTitle("02-framework")).toBe("Framework");
    expect((service as any).sectionTitle("handbook")).toBe("Handbook");
  });
});

describe("HandbookIngestService index fields", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "handbook-index-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("derives section from frontmatter and order from the path", () => {
    mkdirSync(join(root, "03-backend"));
    writeFileSync(
      join(root, "03-backend", "testing.md"),
      "---\ntitle: Testing the API\nsection: 03-backend\n---\n\nBody.",
    );
    const service = makeService({ config: { path: root, exclude: [] } });

    const file = (service as any).walk.call(service, root)[0];

    expect(file.section).toBe("03-backend");
    expect(file.order).toBe("03-backend/testing.md");
  });

  it("falls back to the first path segment when frontmatter has no section", () => {
    mkdirSync(join(root, "04-frontend"));
    writeFileSync(join(root, "04-frontend", "access-control.md"), "---\ntitle: Access control\n---\n\nBody.");
    const service = makeService({ config: { path: root, exclude: [] } });

    const file = (service as any).walk.call(service, root)[0];

    expect(file.section).toBe("04-frontend");
  });

  it("writes index fields without re-chunking when the hash is unchanged", async () => {
    mkdirSync(join(root, "03-backend"));
    writeFileSync(
      join(root, "03-backend", "testing.md"),
      "---\ntitle: Testing the API\nsection: 03-backend\n---\n\nBody.",
    );
    const repository = makeRepository();
    const pageService = makePageService();
    const service = makeService({ config: { path: root, exclude: [] }, repository, pageService });
    await service.sync();
    pageService.chunkAndQueue.mockClear();

    await service.sync();

    expect(repository.updateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ section: "03-backend", order: "03-backend/testing.md" }),
    );
    expect(pageService.chunkAndQueue).not.toHaveBeenCalled();
  });

  it("replaces sections from the sections the walked files declare", async () => {
    mkdirSync(join(root, "03-backend"));
    writeFileSync(
      join(root, "03-backend", "testing.md"),
      "---\ntitle: Testing the API\nsection: 03-backend\n---\n\nBody.",
    );
    mkdirSync(join(root, "09-workflow"));
    writeFileSync(join(root, "09-workflow", "conventions.md"), "---\ntitle: Conventions\n---\n\nBody.");
    const sectionRepository = makeSectionRepository();
    const service = makeService({ config: { path: root, exclude: ["README.md"] }, sectionRepository });

    await service.sync();

    const written = sectionRepository.replaceAll.mock.calls.at(-1)![0].sections;
    expect(written.map((s: any) => s.key).sort()).toEqual(["03-backend", "09-workflow"]);
  });

  it("ignores a README heading with no section of its own but still titles the one that has", async () => {
    mkdirSync(join(root, "03-backend"));
    writeFileSync(
      join(root, "03-backend", "testing.md"),
      "---\ntitle: Testing the API\nsection: 03-backend\n---\n\nBody.",
    );
    writeFileSync(
      join(root, "README.md"),
      [
        "# Developer handbook",
        "",
        "## Checking the handbook",
        "",
        "Prose, not a directory.",
        "",
        "## 03-backend",
        "",
        "The API and how it is built.",
      ].join("\n"),
    );
    const sectionRepository = makeSectionRepository();
    const service = makeService({ config: { path: root, exclude: ["README.md"] }, sectionRepository });

    await service.sync();

    const written = sectionRepository.replaceAll.mock.calls.at(-1)![0].sections;
    expect(written.map((s: any) => s.key)).toEqual(["03-backend"]);
    expect(written[0]).toEqual(
      expect.objectContaining({
        key: "03-backend",
        title: "Backend",
        summary: "The API and how it is built.",
        order: "03-backend",
      }),
    );
  });

  it("does not bump the content hash for an index-only change", async () => {
    mkdirSync(join(root, "03-backend"));
    writeFileSync(
      join(root, "03-backend", "testing.md"),
      "---\ntitle: Testing the API\nsection: 03-backend\n---\n\nBody.",
    );
    const repository = makeRepository();
    const service = makeService({ config: { path: root, exclude: ["README.md"] }, repository });
    await service.sync();

    // The index arrives on the second pass: a new summary must not re-hash the page.
    writeFileSync(
      join(root, "README.md"),
      [
        "# Developer handbook",
        "",
        "## 03-backend",
        "",
        "The API and how it is built.",
        "",
        "- [Testing the API](03-backend/testing.md) — the spec layout and what is mocked.",
      ].join("\n"),
    );

    await service.sync();

    expect(repository.updatePage).not.toHaveBeenCalled();
    expect(repository.updateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "the spec layout and what is mocked." }),
    );
  });
});

/**
 * The handbook is INDEXED in English and SHOWN in the display language.
 *
 * Every test here holds the line that makes that true: the display pass writes
 * `displayTitle` / `displaySummary` / `displayContent` and nothing else — no
 * chunk, no embedding, no queue job, no hash — so the retrieval store after a
 * sync with a translation is the store it would have been without one.
 */
describe("HandbookIngestService display translation", () => {
  let root: string;

  /**
   * The English tree, its Italian mirror under `it/`, and an index on each
   * side. The mirror uses the SAME relative paths, which is what lets the
   * display README's link paths key straight onto the English pages.
   */
  function seed(params: { orphan?: boolean } = {}) {
    mkdirSync(join(root, "03-backend"));
    writeFileSync(
      join(root, "03-backend", "testing.md"),
      "---\ntitle: Testing the API\nsection: 03-backend\n---\n\nThe spec layout.",
    );
    writeFileSync(
      join(root, "README.md"),
      [
        "# Developer handbook",
        "",
        "## 03-backend",
        "",
        "The API and how it is built.",
        "",
        "- [Testing the API](03-backend/testing.md) — the spec layout and what is mocked.",
      ].join("\n"),
    );

    mkdirSync(join(root, "it"));
    mkdirSync(join(root, "it", "03-backend"));
    writeFileSync(
      join(root, "it", "03-backend", "testing.md"),
      "---\ntitle: Testare l'API\nsection: 03-backend\nsource: ../../03-backend/testing.md\n---\n\nLa forma delle spec.",
    );
    writeFileSync(
      join(root, "it", "README.md"),
      [
        "# Manuale dello sviluppatore",
        "",
        "## 03-backend",
        "",
        "L'API e come è costruita.",
        "",
        "- [Testare l'API](03-backend/testing.md) — la forma delle spec e che cosa è mockato.",
      ].join("\n"),
    );

    if (params.orphan)
      writeFileSync(join(root, "it", "03-backend", "solo-italiano.md"), "---\ntitle: Solo italiano\n---\n\nCorpo.");
  }

  const config = { path: () => ({ path: root, exclude: ["it/**"], displayPath: "it" }) };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "handbook-display-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes the translated title, summary and body onto the English page of the same path", async () => {
    seed();
    const repository = makeRepository();
    const service = makeService({ config: config.path(), repository });

    await service.sync();

    const created = repository.createPage.mock.calls.map((c: any[]) => c[0]);
    const page = created.find((p: any) => p.path === "03-backend/testing.md")!;
    expect(repository.updateDisplay).toHaveBeenCalledWith({
      id: page.id,
      displayTitle: "Testare l'API",
      displaySummary: "la forma delle spec e che cosa è mockato.",
      displayContent: "La forma delle spec.",
    });
  });

  it("leaves the indexed English page exactly as it was — content, hash and status untouched", async () => {
    seed();
    const repository = makeRepository();
    const service = makeService({ config: config.path(), repository });

    await service.sync();

    const page = repository.createPage.mock.calls
      .map((c: any[]) => c[0])
      .find((p: any) => p.path === "03-backend/testing.md")!;
    expect(page.content).toBe("The spec layout.");
    expect(page.title).toBe("Testing the API");
    expect(page.summary).toBe("the spec layout and what is mocked.");
    // The display pass rewrites nothing the retriever reads.
    expect(repository.updatePage).not.toHaveBeenCalled();
    const displayed = repository.updateDisplay.mock.calls[0][0];
    expect(Object.keys(displayed).sort()).toEqual(["displayContent", "displaySummary", "displayTitle", "id"]);
  });

  it("chunks the two English files and nothing at all for their translations", async () => {
    seed();
    const pageService = makePageService();
    const service = makeService({ config: config.path(), pageService });

    await service.sync();

    // The English tree here is `README.md` + `03-backend/testing.md`. The
    // mirror has a file for each, and neither reaches the chunker.
    const chunked = pageService.chunkAndQueue.mock.calls.map((c: any[]) => c[0].markdown);
    expect(chunked).toHaveLength(2);
    expect(chunked.some((markdown: string) => markdown.includes("The spec layout."))).toBe(true);
    expect(chunked.some((markdown: string) => markdown.includes("La forma delle spec."))).toBe(false);
    expect(chunked.some((markdown: string) => markdown.includes("Manuale dello sviluppatore"))).toBe(false);
  });

  it("re-translates on a later sync without re-chunking anything", async () => {
    seed();
    const repository = makeRepository();
    const pageService = makePageService();
    const service = makeService({ config: config.path(), repository, pageService });
    await service.sync();
    pageService.chunkAndQueue.mockClear();
    repository.updateDisplay.mockClear();

    const result = await service.sync();

    expect(result.unchanged).toBe(2);
    // One per translated file: `it/README.md` and `it/03-backend/testing.md`.
    expect(repository.updateDisplay).toHaveBeenCalledTimes(2);
    expect(pageService.chunkAndQueue).not.toHaveBeenCalled();
  });

  it("skips a translated file with no English counterpart rather than creating a page for it", async () => {
    seed({ orphan: true });
    const repository = makeRepository();
    const service = makeService({ config: config.path(), repository });

    await service.sync();

    const createdPaths = repository.createPage.mock.calls.map((c: any[]) => c[0].path).sort();
    expect(createdPaths).toEqual(["03-backend/testing.md", "README.md"]);
    expect(createdPaths).not.toContain("03-backend/solo-italiano.md");
    expect(repository.updateDisplay).toHaveBeenCalledTimes(2);
  });

  it("gives each section the display title and summary the translated README carries", async () => {
    seed();
    const sectionRepository = makeSectionRepository();
    const service = makeService({ config: config.path(), sectionRepository });

    await service.sync();

    const written = sectionRepository.replaceAll.mock.calls.at(-1)![0].sections;
    const backend = written.find((section: any) => section.key === "03-backend")!;
    expect(backend.summary).toBe("The API and how it is built.");
    expect(backend.displaySummary).toBe("L'API e come è costruita.");
    expect(backend.displayTitle).toBe("Backend");
  });

  it("touches nothing when displayPath is unset, even with the mirror on disk", async () => {
    seed();
    const repository = makeRepository();
    const sectionRepository = makeSectionRepository();
    const pageService = makePageService();
    const service = makeService({
      config: { path: root, exclude: ["it/**"] },
      repository,
      sectionRepository,
      pageService,
    });

    await service.sync();

    expect(repository.updateDisplay).not.toHaveBeenCalled();
    const written = sectionRepository.replaceAll.mock.calls.at(-1)![0].sections;
    expect(written.every((section: any) => section.displayTitle === undefined)).toBe(true);
    expect(written.every((section: any) => section.displaySummary === undefined)).toBe(true);
    expect(pageService.chunkAndQueue).toHaveBeenCalledTimes(2);
  });

  it("ignores a displayPath naming a directory that is not there", async () => {
    mkdirSync(join(root, "03-backend"));
    writeFileSync(join(root, "03-backend", "testing.md"), "---\ntitle: Testing\nsection: 03-backend\n---\n\nBody.");
    const repository = makeRepository();
    const service = makeService({ config: { path: root, exclude: [], displayPath: "it" }, repository });

    const result = await service.sync();

    expect(result.created).toBe(1);
    expect(repository.updateDisplay).not.toHaveBeenCalled();
  });
});
