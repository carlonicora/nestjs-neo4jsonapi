import { BadRequestException } from "@nestjs/common";
import JSZip from "jszip";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ChunkerService } from "../chunker.service";
import { DocXService } from "../types/docx.service";

const DOCX_PARAGRAPH = "The innkeeper hides the ledger under the floor";

const DOCUMENT_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:body><w:p><w:r><w:t>${DOCX_PARAGRAPH}</w:t></w:r></w:p></w:body></w:document>`;

const zipOf = async (entries: Record<string, Buffer | string>): Promise<Buffer> => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
};

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const makeConfig = (opts: { mock?: boolean } = {}) =>
  ({
    get: vi.fn((key: string) => {
      if (key === "ai") return { mock: opts.mock ?? false };
      if (key === "chunker") return { strategy: "markdown-structural", ocrLanguage: "eng", targetChars: 1500 };
      return undefined;
    }),
  }) as any;

describe("ChunkerService.extractNotes", () => {
  let dir: string;
  let docxBuffer: Buffer;

  /** The storage stub reads each key from the fixture temp dir. */
  const s3 = {
    downloadFileBuffer: vi.fn(async ({ key }: { key: string }) => ({
      buffer: await readFile(join(dir, key)),
      contentType: "application/octet-stream",
    })),
  } as any;

  const splitter = { splitMarkdownToChunks: vi.fn() } as any;
  const unused = {} as any;

  const makeService = (opts: { mock?: boolean } = {}) =>
    new ChunkerService(
      splitter,
      splitter,
      new DocXService(),
      unused,
      unused,
      unused,
      unused,
      s3,
      unused,
      makeConfig(opts),
    );

  const writeFixture = (name: string, bytes: Buffer | string): string => {
    writeFileSync(join(dir, name), bytes);
    return name;
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "extract-notes-spec-"));
    docxBuffer = await zipOf({ "word/document.xml": DOCUMENT_XML });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("md returns the file text verbatim", async () => {
    const content = "# Old Hobb\n\nHe knows where the *ledger* is.\n";
    const filePath = writeFixture("hobb.md", content);

    const notes = await makeService().extractNotes({ filePath, fileType: "md", title: "Hobb notes.md" });

    expect(notes).toEqual([{ path: "Hobb notes.md", text: content }]);
  });

  it("zip of md + docx + png returns two notes and one skipped image", async () => {
    const filePath = writeFixture(
      "vault-mixed.zip",
      await zipOf({ "a.md": "# A\n\nnote a", "b.docx": docxBuffer, "c.png": PNG_BYTES }),
    );

    const notes = await makeService().extractNotes({ filePath, fileType: "zip", title: "vault.zip" });

    expect(notes.map((note) => note.path)).toEqual(["vault.zip/a.md", "vault.zip/b.docx", "vault.zip/c.png"]);
    expect(notes[0]).toEqual({ path: "vault.zip/a.md", text: "# A\n\nnote a" });
    expect(notes[1].skipped).toBeUndefined();
    expect(notes[1].text).toContain(DOCX_PARAGRAPH);
    expect(notes[2]).toMatchObject({ path: "vault.zip/c.png", skipped: "image" });
  });

  it("zip of csv + html returns both as notes with their whole text", async () => {
    const csv = "name,role\nOld Hobb,fence\n";
    const html = "<h1>Hobb</h1><p>He knows where the ledger is.</p>";
    const filePath = writeFixture("vault-text.zip", await zipOf({ "npcs.csv": csv, "hobb.html": html }));

    const notes = await makeService().extractNotes({ filePath, fileType: "zip", title: "vault.zip" });

    expect(notes).toEqual([
      { path: "vault.zip/npcs.csv", text: csv },
      { path: "vault.zip/hobb.html", text: html },
    ]);
  });

  it("json, jsonl and htm uploads are read whole as plain text", async () => {
    const cases: Array<[string, string]> = [
      ["json", '{"name":"Old Hobb"}'],
      ["jsonl", '{"a":1}\n{"b":2}\n'],
      ["htm", "<p>ledger</p>"],
    ];
    for (const [fileType, content] of cases) {
      const filePath = writeFixture(`note.${fileType}`, content);
      const notes = await makeService().extractNotes({ filePath, fileType, title: `note.${fileType}` });
      expect(notes).toEqual([{ path: `note.${fileType}`, text: content }]);
    }
  });

  it("nested zip is opened", async () => {
    const inner = await zipOf({ "x.md": "inner note" });
    const filePath = writeFixture("vault-nested.zip", await zipOf({ "inner.zip": inner }));

    const notes = await makeService().extractNotes({ filePath, fileType: "zip", title: "vault.zip" });

    expect(notes).toEqual([{ path: "vault.zip/inner.zip/x.md", text: "inner note" }]);
  });

  it("zip nested four deep is skipped too_deep", async () => {
    const level4 = await zipOf({ "deep.md": "too deep" });
    const level3 = await zipOf({ "l4.zip": level4, "ok.md": "third level" });
    const level2 = await zipOf({ "l3.zip": level3 });
    const filePath = writeFixture("vault-deep.zip", await zipOf({ "l2.zip": level2 }));

    const notes = await makeService().extractNotes({ filePath, fileType: "zip", title: "vault.zip" });

    expect(notes).toContainEqual({ path: "vault.zip/l2.zip/l3.zip/ok.md", text: "third level" });
    expect(notes).toContainEqual(
      expect.objectContaining({ path: "vault.zip/l2.zip/l3.zip/l4.zip", skipped: "too_deep" }),
    );
    expect(notes.some((note) => note.path.endsWith("deep.md"))).toBe(false);
  });

  it("__MACOSX entries are ignored", async () => {
    const filePath = writeFixture(
      "vault-mac.zip",
      await zipOf({ "a.md": "note a", "__MACOSX/._a.md": "resource fork", ".DS_Store": "junk" }),
    );

    const notes = await makeService().extractNotes({ filePath, fileType: "zip", title: "vault.zip" });

    expect(notes).toEqual([{ path: "vault.zip/a.md", text: "note a" }]);
  });

  it("zip with only images returns only skipped notes", async () => {
    const filePath = writeFixture("vault-images.zip", await zipOf({ "map.png": PNG_BYTES, "npc.jpg": PNG_BYTES }));

    const notes = await makeService().extractNotes({ filePath, fileType: "zip", title: "vault.zip" });

    expect(notes).toHaveLength(2);
    expect(notes.every((note) => note.skipped === "image")).toBe(true);
  });

  it("zip over the total limit throws the zip-limits BadRequestException", async () => {
    const filePath = writeFixture(
      "vault-big.zip",
      await zipOf({ "a.md": Buffer.alloc(800, "a"), "b.md": Buffer.alloc(800, "b") }),
    );

    await expect(
      makeService().extractNotes({
        filePath,
        fileType: "zip",
        title: "vault.zip",
        zipLimits: { maxEntryBytes: 1024, maxTotalBytes: 1024 },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("nested zips share one budget", async () => {
    // Each inner zip inflates to 600 bytes and the outer one to a few hundred: every
    // archive alone is under the 1024-byte total, all of them together are not.
    const innerA = await zipOf({ "a.md": Buffer.alloc(600, "a") });
    const innerB = await zipOf({ "b.md": Buffer.alloc(600, "b") });
    const filePath = writeFixture("vault-shared-budget.zip", await zipOf({ "a.zip": innerA, "b.zip": innerB }));
    const zipLimits = { maxEntryBytes: 1024, maxTotalBytes: 1024 };

    for (const inner of [innerA, innerB]) {
      const alone = writeFixture(`vault-alone-${inner === innerA ? "a" : "b"}.zip`, inner);
      await expect(
        makeService().extractNotes({ filePath: alone, fileType: "zip", title: "alone.zip", zipLimits }),
      ).resolves.toHaveLength(1);
    }

    await expect(
      makeService().extractNotes({ filePath, fileType: "zip", title: "vault.zip", zipLimits }),
    ).rejects.toThrow(BadRequestException);
  });

  it("ai.mock returns one fixed note", async () => {
    const notes = await makeService({ mock: true }).extractNotes({
      filePath: "bucket/x.zip",
      fileType: "zip",
      title: "x.zip",
    });

    expect(notes).toEqual([{ path: "x.zip", text: "mock note content for smoke testing" }]);
  });
});
