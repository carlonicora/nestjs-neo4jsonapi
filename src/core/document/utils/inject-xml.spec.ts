import JSZip from "jszip";
import { injectXml } from "./inject-xml";

/**
 * Build a minimal valid DOCX buffer containing word/document.xml with the
 * given content. We use JSZip directly to avoid depending on the `docx`
 * library here — the test only needs a ZIP that contains the right file.
 */
async function buildMinimalDocx(documentXmlContent: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", documentXmlContent);
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("injectXml", () => {
  const PLACEHOLDER = "{LINES_TABLE}";
  const XML_FRAGMENT = "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Line 1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
  const BASE_DOCUMENT_XML = `<?xml version="1.0"?><w:document><w:body><w:p>${PLACEHOLDER}</w:p></w:body></w:document>`;

  it("replaces the placeholder with the XML fragment", async () => {
    const docxBuffer = await buildMinimalDocx(BASE_DOCUMENT_XML);

    const result = await injectXml(docxBuffer, PLACEHOLDER, XML_FRAGMENT);

    expect(result).toBeInstanceOf(Buffer);

    // Unzip the result and verify the substitution
    const resultZip = await JSZip.loadAsync(result);
    const resultXml = await resultZip.file("word/document.xml")!.async("text");

    expect(resultXml).toContain(XML_FRAGMENT);
    expect(resultXml).not.toContain(PLACEHOLDER);
  });

  it("returns a valid ZIP buffer (DOCX magic bytes PK)", async () => {
    const docxBuffer = await buildMinimalDocx(BASE_DOCUMENT_XML);

    const result = await injectXml(docxBuffer, PLACEHOLDER, XML_FRAGMENT);

    // DOCX/ZIP magic bytes are 'PK' (0x50 0x4B)
    expect(result.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("throws when word/document.xml is missing from the DOCX", async () => {
    const zip = new JSZip();
    zip.file("not-document.xml", "<root/>");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    await expect(injectXml(buffer, PLACEHOLDER, XML_FRAGMENT)).rejects.toThrow("DOCX is missing word/document.xml");
  });

  it("throws when the placeholder is not found in word/document.xml", async () => {
    const docxBuffer = await buildMinimalDocx(
      `<?xml version="1.0"?><w:document><w:body><w:p>No placeholder here</w:p></w:body></w:document>`,
    );

    await expect(injectXml(docxBuffer, PLACEHOLDER, XML_FRAGMENT)).rejects.toThrow(
      `Placeholder not found in DOCX: ${PLACEHOLDER}`,
    );
  });
});
