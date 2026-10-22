import { BadRequestException } from "@nestjs/common";
import JSZip from "jszip";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx-republish";
import {
  loadZipWithinLimits,
  ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES,
  ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES,
} from "../../utils/zip-limits";
import { DocXService } from "../types/docx.service";
import { PptxService } from "../types/pptx.service";
import { XlsxService } from "../types/xlsx.service";

const MIB = 1024 * 1024;

const DOCUMENT_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:body><w:p><w:r><w:t>Hello from a real docx</w:t></w:r></w:p></w:body></w:document>`;

const zipOf = async (entries: Record<string, Buffer | string>): Promise<Buffer> => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
};

/**
 * Rewrites every declared uncompressed size (local headers and central directory) to `size`:
 * the archive then LIES about how much it expands to, which a size check on the headers alone
 * cannot catch.
 */
const lieAboutSizes = (zip: Buffer, size: number): Buffer => {
  const patched = Buffer.from(zip);
  for (let offset = 0; offset < patched.length - 4; offset++) {
    const signature = patched.readUInt32LE(offset);
    if (signature === 0x04034b50) patched.writeUInt32LE(size, offset + 22);
    if (signature === 0x02014b50) patched.writeUInt32LE(size, offset + 24);
  }
  return patched;
};

describe("zip decompression limits", () => {
  let dir: string;
  // A real bomb for the per-entry cap: one entry of zeros one byte past the cap, which deflates to
  // a few tens of KiB and really inflates past the cap. Built once (deflating 64 MiB takes seconds).
  let overEntryZip: Buffer;
  // The total cap at the real limits: entries that each DECLARE just under the per-entry cap and
  // together more than the total. Inflating 256 MiB for real would take the suite minutes; the
  // actual-bytes path of the total cap is proven on the helper with small limits below.
  let overTotalZip: Buffer;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "zip-bomb-spec-"));
    overEntryZip = await zipOf({ "word/document.xml": Buffer.alloc(ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES + 1) });
    const parts = Math.ceil(ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES / (ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES - MIB)) + 1;
    overTotalZip = lieAboutSizes(
      await zipOf({
        "word/document.xml": DOCUMENT_XML,
        ...Object.fromEntries(Array.from({ length: parts }, (_, i) => [`word/media/part${i}.bin`, Buffer.alloc(16)])),
      }),
      ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES - MIB,
    );
  }, 60_000);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const writeTemp = (name: string, bytes: Buffer) => {
    const filePath = join(dir, name);
    writeFileSync(filePath, bytes);
    return filePath;
  };

  describe("loadZipWithinLimits", () => {
    it("refuses an archive whose entry DECLARES more than the per-entry cap", async () => {
      const zip = await zipOf({ "a.xml": Buffer.alloc(2048) });

      await expect(
        loadZipWithinLimits({ buffer: zip, label: "TEST", limits: { maxEntryBytes: 1024 } }),
      ).rejects.toThrow(BadRequestException);
    });

    it("refuses an archive whose entries DECLARE more than the total cap", async () => {
      const zip = await zipOf({ "a.xml": Buffer.alloc(800), "b.xml": Buffer.alloc(800) });

      await expect(
        loadZipWithinLimits({ buffer: zip, label: "TEST", limits: { maxEntryBytes: 1024, maxTotalBytes: 1024 } }),
      ).rejects.toThrow(/in total/);
    });

    it("refuses an archive that declares small sizes but INFLATES past the per-entry cap", async () => {
      const zip = lieAboutSizes(await zipOf({ "a.xml": Buffer.alloc(MIB) }), 10);

      const error = await loadZipWithinLimits({
        buffer: zip,
        label: "TEST",
        limits: { maxEntryBytes: 64 * 1024 },
      }).catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toContain("a.xml");
    });

    it("refuses an archive that declares small sizes but INFLATES past the total cap", async () => {
      // Declared 10 bytes, under both caps; the counter crosses the 30 KiB total mid-entry.
      const zip = lieAboutSizes(await zipOf({ "a.xml": Buffer.alloc(40 * 1024) }), 10);

      await expect(
        loadZipWithinLimits({
          buffer: zip,
          label: "TEST",
          limits: { maxEntryBytes: 64 * 1024, maxTotalBytes: 30 * 1024 },
        }),
      ).rejects.toThrow(/in total/);
    });

    it("refuses an archive that lies about its sizes (declared smaller than it inflates) as corrupt", async () => {
      const zip = lieAboutSizes(
        await zipOf({ "a.xml": Buffer.alloc(40 * 1024), "b.xml": Buffer.alloc(40 * 1024) }),
        10,
      );

      await expect(
        loadZipWithinLimits({ buffer: zip, label: "TEST", limits: { maxEntryBytes: MIB, maxTotalBytes: MIB } }),
      ).rejects.toThrow(/corrupt/);
    });

    it("returns the archive when it is within the limits", async () => {
      const zip = await zipOf({ "word/document.xml": DOCUMENT_XML });

      const loaded = await loadZipWithinLimits({ buffer: zip, label: "TEST" });

      expect(await loaded?.file("word/document.xml")?.async("text")).toBe(DOCUMENT_XML);
    });

    it("returns undefined for bytes that are not a zip", async () => {
      await expect(loadZipWithinLimits({ buffer: Buffer.from("plain,csv\n1,2"), label: "TEST" })).resolves.toBe(
        undefined,
      );
    });
  });

  describe("DocXService", () => {
    const service = new DocXService();

    it("refuses a docx whose document.xml expands past the per-entry cap (BadRequest)", async () => {
      const filePath = writeTemp("entry.docx", overEntryZip);

      await expect(service.load({ filePath })).rejects.toThrow(BadRequestException);
      await expect(service.getRawElements(filePath)).rejects.toThrow(BadRequestException);
    });

    it("refuses a docx whose parts together expand past the total cap (BadRequest)", async () => {
      const filePath = writeTemp("total.docx", overTotalZip);

      await expect(service.load({ filePath })).rejects.toThrow(/in total/);
    });

    it("still reads a normal docx", async () => {
      const filePath = writeTemp("ok.docx", await zipOf({ "word/document.xml": DOCUMENT_XML }));

      const docs = await service.load({ filePath });

      expect(docs.map((doc) => doc.pageContent).join(" ")).toContain("Hello from a real docx");
    });
  });

  describe("XlsxService", () => {
    const service = new XlsxService();

    const realWorkbook = (): Buffer => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ["name", "value"],
          ["alpha", "1"],
        ]),
        "Sheet1",
      );
      return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    };

    it("refuses an xlsx with an entry that expands past the per-entry cap (BadRequest, not an empty result)", async () => {
      const filePath = writeTemp("entry.xlsx", overEntryZip);

      await expect(service.load({ filePath })).rejects.toThrow(BadRequestException);
    });

    it("refuses an xlsx whose parts together expand past the total cap (BadRequest)", async () => {
      const filePath = writeTemp("total.xlsx", overTotalZip);

      await expect(service.extractXlsxContent(filePath)).rejects.toThrow(/in total/);
    });

    it("still reads a normal xlsx", async () => {
      const filePath = writeTemp("ok.xlsx", realWorkbook());

      const docs = await service.load({ filePath });

      expect(docs).toHaveLength(1);
      expect(docs[0].pageContent).toContain("alpha");
    });
  });
  describe("PptxService", () => {
    const service = new PptxService();

    // The smallest deck officeparser reads: content types, presentation.xml and one slide with one text run.
    const realDeck = () =>
      zipOf({
        "[Content_Types].xml":
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
          `</Types>`,
        "ppt/presentation.xml":
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
        "ppt/slides/slide1.xml":
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
          `<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello from a real pptx</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
      });

    it("refuses a pptx with an entry that expands past the per-entry cap (BadRequest, not an empty result)", async () => {
      const filePath = writeTemp("entry.pptx", overEntryZip);

      await expect(service.load({ filePath })).rejects.toThrow(BadRequestException);
      await expect(service.getRawElements(filePath)).rejects.toThrow(BadRequestException);
    });

    it("refuses a pptx whose parts together expand past the total cap (BadRequest)", async () => {
      const filePath = writeTemp("total.pptx", overTotalZip);

      await expect(service.extractPptxContent(filePath)).rejects.toThrow(/in total/);
    });

    it("still reads a normal pptx", async () => {
      const filePath = writeTemp("ok.pptx", await realDeck());

      const docs = await service.load({ filePath });

      expect(docs).toHaveLength(1);
      expect(docs[0].pageContent).toContain("Hello from a real pptx");
    });
  });
});
