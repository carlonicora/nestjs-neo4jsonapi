import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHelpContentReader } from "../create-help-content-reader";

describe("createHelpContentReader", () => {
  let srcRoot: string;

  beforeAll(async () => {
    srcRoot = await mkdtemp(join(tmpdir(), "help-reader-"));
    await mkdir(join(srcRoot, "how-to"), { recursive: true });
    await writeFile(join(srcRoot, "how-to", "x.mdx"), "hello world");
  });

  afterAll(async () => {
    await rm(srcRoot, { recursive: true, force: true });
  });

  it("reads the file at <srcRoot>/<article.path>", async () => {
    const read = createHelpContentReader({ srcRoot });
    const content = await read({ path: "how-to/x.mdx" } as any);
    expect(content).toBe("hello world");
  });

  it("propagates ENOENT for missing files", async () => {
    const read = createHelpContentReader({ srcRoot });
    await expect(read({ path: "how-to/missing.mdx" } as any)).rejects.toThrow(/ENOENT/);
  });
});
