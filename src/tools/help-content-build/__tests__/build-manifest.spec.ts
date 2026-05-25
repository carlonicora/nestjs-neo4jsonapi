import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest } from "../build-manifest";

const NAMESPACE = "0c5d1a2e-9c7f-4a8b-9b3c-4f7e8d2a1b6f";

describe("buildManifest", () => {
  let tmpRoot: string;
  let srcDir: string;
  let outputPath: string;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "help-content-"));
    srcDir = join(tmpRoot, "src");
    await mkdir(join(srcDir, "how-to"), { recursive: true });
    outputPath = join(srcDir, "manifest.generated.ts");
    await writeFile(
      join(srcDir, "how-to", "alpha.mdx"),
      `---
title: Alpha
mode: how-to
order: 1
summary: First.
---

## Heading One

Body.`,
    );
    await writeFile(
      join(srcDir, "how-to", "beta.mdx"),
      `---
title: Beta
mode: how-to
order: 2
summary: Second.
draft: true
---

Body.`,
    );
  });

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("emits a manifest file with non-draft articles in production", async () => {
    await buildManifest({ srcDir, outputPath, namespaceUuid: NAMESPACE, includeDrafts: false });
    const out = await readFile(outputPath, "utf8");
    expect(out).toContain("Alpha");
    expect(out).not.toContain("Beta");
  });

  it("includes drafts when explicitly requested (dev mode)", async () => {
    await buildManifest({ srcDir, outputPath, namespaceUuid: NAMESPACE, includeDrafts: true });
    const out = await readFile(outputPath, "utf8");
    expect(out).toContain("Alpha");
    expect(out).toContain("Beta");
  });

  it("rejects articles with a related: target that doesn't exist", async () => {
    const dir = join(srcDir, "how-to");
    await writeFile(
      join(dir, "with-broken-related.mdx"),
      `---
title: Has broken related
mode: how-to
order: 9
summary: References a missing slug.
related:
  - how-to/does-not-exist
---

Body.`,
    );
    await expect(buildManifest({ srcDir, outputPath, namespaceUuid: NAMESPACE, includeDrafts: true })).rejects.toThrow(
      /non-existent/i,
    );
    await rm(join(dir, "with-broken-related.mdx"));
  });

  it("produces ids that match toContentId(mode, slug, namespaceUuid)", async () => {
    const { toContentId } = await import("../../../foundations/help-content-sync/helpers/to-content-id");
    await buildManifest({ srcDir, outputPath, namespaceUuid: NAMESPACE, includeDrafts: false });
    const out = await readFile(outputPath, "utf8");
    const expectedId = toContentId("how-to", "alpha", NAMESPACE);
    expect(out).toContain(`"id": "${expectedId}"`);
  });
});
