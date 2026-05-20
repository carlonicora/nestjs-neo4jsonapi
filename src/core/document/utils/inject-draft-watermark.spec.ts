import JSZip from "jszip";
import { injectDraftWatermark } from "./inject-draft-watermark";

/**
 * Build a minimal DOCX buffer with a proper word/document.xml containing
 * a <w:body> and [Content_Types].xml, so the watermark injection logic
 * finds what it needs.
 */
async function buildMinimalDocx(): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>Hello World</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  );

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );

  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`,
  );

  return zip.generateAsync({ type: "nodebuffer" });
}

describe("injectDraftWatermark", () => {
  it("returns a valid DOCX buffer (ZIP magic bytes PK)", async () => {
    const docxBuffer = await buildMinimalDocx();
    const result = await injectDraftWatermark(docxBuffer);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("injects a header file into the DOCX", async () => {
    const docxBuffer = await buildMinimalDocx();
    const result = await injectDraftWatermark(docxBuffer);

    const zip = await JSZip.loadAsync(result);
    const headerFile = zip.file("word/header1.xml");
    expect(headerFile).not.toBeNull();
  });

  it("embeds the default watermark text BOZZA in the injected header", async () => {
    const docxBuffer = await buildMinimalDocx();
    const result = await injectDraftWatermark(docxBuffer);

    const zip = await JSZip.loadAsync(result);
    const headerXml = await zip.file("word/header1.xml")!.async("text");
    expect(headerXml).toContain("BOZZA");
  });

  it("allows a custom watermark text", async () => {
    const docxBuffer = await buildMinimalDocx();
    const result = await injectDraftWatermark(docxBuffer, "DRAFT");

    const zip = await JSZip.loadAsync(result);
    const headerXml = await zip.file("word/header1.xml")!.async("text");
    expect(headerXml).toContain("DRAFT");
    expect(headerXml).not.toContain("BOZZA");
  });

  it("registers the header relationship in document.xml.rels", async () => {
    const docxBuffer = await buildMinimalDocx();
    const result = await injectDraftWatermark(docxBuffer);

    const zip = await JSZip.loadAsync(result);
    const relsXml = await zip.file("word/_rels/document.xml.rels")!.async("text");
    expect(relsXml).toContain("rIdNeuralErpDraftHeader");
    expect(relsXml).toContain("header1.xml");
  });

  it("registers the header part in [Content_Types].xml", async () => {
    const docxBuffer = await buildMinimalDocx();
    const result = await injectDraftWatermark(docxBuffer);

    const zip = await JSZip.loadAsync(result);
    const ctXml = await zip.file("[Content_Types].xml")!.async("text");
    expect(ctXml).toContain("/word/header1.xml");
  });

  it("is idempotent — running twice does not double-inject", async () => {
    const docxBuffer = await buildMinimalDocx();
    const once = await injectDraftWatermark(docxBuffer);
    const twice = await injectDraftWatermark(once);

    const zip = await JSZip.loadAsync(twice);
    const headerXml = await zip.file("word/header1.xml")!.async("text");

    // The SENTINEL must appear exactly once
    const occurrences = (headerXml.match(/___NEURAL_ERP_DRAFT_WATERMARK___/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});
