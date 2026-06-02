import { describe, it, expect, vi } from "vitest";
import { HelpContentSyncService } from "../help-content-sync.service";

function makeService(
  overrides: Partial<{
    lockAcquired: boolean;
    manifest: any[];
    existingById: Record<string, any>;
  }> = {},
) {
  const lockAcquired = overrides.lockAcquired ?? true;
  const manifest = overrides.manifest ?? [];
  const existingById = overrides.existingById ?? {};

  const howToRepository = {
    create: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    findAllWithHelpContentSlug: vi.fn(async () => Object.values(existingById).filter((h: any) => h?.helpContentSlug)),
  };
  const howToService = {
    findRecordById: vi.fn(async ({ id }: { id: string }) => existingById[id] ?? null),
    queueHowToForProcessingFromMarkdown: vi.fn(async () => undefined),
  };
  const mdxToMarkdown = { convert: vi.fn(async (s: string) => s) };
  const lock = {
    withLock: vi.fn(async (_k: string, _ttl: number, fn: () => Promise<unknown>) => (lockAcquired ? await fn() : null)),
  };
  const cls = { run: (fn: any) => fn(), get: () => undefined };

  const config = {
    manifest,
    readRawMarkdown: async () => "raw-markdown",
    namespaceUuid: "0c5d1a2e-9c7f-4a8b-9b3c-4f7e8d2a1b6f",
    redirects: [],
  };

  const svc = new HelpContentSyncService(
    config,
    howToRepository as any,
    howToService as any,
    mdxToMarkdown as any,
    lock as any,
    cls as any,
  );
  return { svc, howToRepository, howToService, lock };
}

describe("HelpContentSyncService", () => {
  it("returns early (no-op) if lock is held by another worker", async () => {
    const { svc, howToRepository } = makeService({ lockAcquired: false });
    await svc.run();
    expect(howToRepository.create).not.toHaveBeenCalled();
  });

  it("creates HowTos for new articles and queues processing", async () => {
    const article = {
      slug: "a",
      mode: "how-to",
      title: "A",
      summary: "s",
      order: 1,
      tags: [],
      contextualKeys: [],
      aiIndexed: true,
      draft: false,
      contentHash: "h1",
      path: "how-to/a.mdx",
      headings: [],
      relatedSlugs: [],
      lastUpdated: "",
    };
    const { svc, howToRepository, howToService } = makeService({ manifest: [article] as any });
    await svc.run();
    expect(howToRepository.create).toHaveBeenCalledTimes(1);
    expect(howToService.queueHowToForProcessingFromMarkdown).toHaveBeenCalledTimes(1);
  });

  it("skips articles whose contentHash is unchanged", async () => {
    const article = {
      slug: "a",
      mode: "how-to",
      title: "A",
      summary: "s",
      order: 1,
      tags: [],
      contextualKeys: [],
      aiIndexed: true,
      draft: false,
      contentHash: "h1",
      path: "how-to/a.mdx",
      headings: [],
      relatedSlugs: [],
      lastUpdated: "",
    };
    // The id is computed via toContentId — for testing we look up the resulting id by passing the article through:
    const { toContentId } = await import("../../helpers/to-content-id");
    const id = toContentId("how-to", "a", "0c5d1a2e-9c7f-4a8b-9b3c-4f7e8d2a1b6f");
    const { svc, howToRepository } = makeService({
      manifest: [article] as any,
      existingById: { [id]: { id, helpContentSlug: "how-to/a", contentHash: "h1" } },
    });
    await svc.run();
    expect(howToRepository.create).not.toHaveBeenCalled();
    expect(howToRepository.put).not.toHaveBeenCalled();
  });

  it("patches and re-queues when contentHash differs", async () => {
    const article = {
      slug: "a",
      mode: "how-to",
      title: "A2",
      summary: "s2",
      order: 1,
      tags: [],
      contextualKeys: [],
      aiIndexed: true,
      draft: false,
      contentHash: "h2",
      path: "how-to/a.mdx",
      headings: [],
      relatedSlugs: [],
      lastUpdated: "",
    };
    const { toContentId } = await import("../../helpers/to-content-id");
    const id = toContentId("how-to", "a", "0c5d1a2e-9c7f-4a8b-9b3c-4f7e8d2a1b6f");
    const { svc, howToRepository, howToService } = makeService({
      manifest: [article] as any,
      existingById: { [id]: { id, helpContentSlug: "how-to/a", contentHash: "h1" } },
    });
    await svc.run();
    expect(howToRepository.patch).toHaveBeenCalledTimes(1);
    expect(howToRepository.put).not.toHaveBeenCalled();
    expect(howToService.queueHowToForProcessingFromMarkdown).toHaveBeenCalledTimes(1);
  });

  it("deletes orphan HowTos whose slug vanished from the manifest", async () => {
    const { svc, howToRepository } = makeService({
      manifest: [],
      existingById: {
        "ghost-id": { id: "ghost-id", helpContentSlug: "how-to/gone", contentHash: "h" },
      },
    });
    await svc.run();
    expect(howToRepository.delete).toHaveBeenCalledWith({ id: "ghost-id" });
  });

  it("excludes drafts and ai_indexed=false from upsert", async () => {
    const articles = [
      {
        slug: "d",
        mode: "how-to",
        title: "D",
        summary: "s",
        order: 1,
        tags: [],
        contextualKeys: [],
        aiIndexed: true,
        draft: true,
        contentHash: "h",
        path: "how-to/d.mdx",
        headings: [],
        relatedSlugs: [],
        lastUpdated: "",
      },
      {
        slug: "n",
        mode: "how-to",
        title: "N",
        summary: "s",
        order: 1,
        tags: [],
        contextualKeys: [],
        aiIndexed: false,
        draft: false,
        contentHash: "h",
        path: "how-to/n.mdx",
        headings: [],
        relatedSlugs: [],
        lastUpdated: "",
      },
    ];
    const { svc, howToRepository } = makeService({ manifest: articles as any });
    await svc.run();
    expect(howToRepository.create).not.toHaveBeenCalled();
  });
});
