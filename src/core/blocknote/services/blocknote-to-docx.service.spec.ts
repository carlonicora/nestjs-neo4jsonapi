import { describe, it, expect, beforeAll } from "vitest";
import { BlockNoteToDocxService, BlockNoteCompanyInfo } from "./blocknote-to-docx.service";

const company: BlockNoteCompanyInfo = {
  name: "Acme Srl",
  legal_address: "Via Roma 1, 20121 Milano",
  fiscal_data: JSON.stringify({ partita_iva: "12345678901", codice_fiscale: "ACMESRL" }),
};

describe("BlockNoteToDocxService", () => {
  let service: BlockNoteToDocxService;

  beforeAll(() => {
    service = new BlockNoteToDocxService();
  });

  it("renders a raw markdown template buffer to a DOCX buffer", async () => {
    const template = Buffer.from("# Hello World\n\nThis is a paragraph.", "utf8");
    const out = await service.render(template, {
      title: "Test Document",
      company,
    });

    expect(out).toBeInstanceOf(Buffer);
    // DOCX files are ZIP archives — magic bytes are 'PK' (0x50 0x4B)
    expect(out.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("renders a BlockNote JSON template buffer replacing templateField nodes", async () => {
    const blocks = [
      {
        id: "1",
        type: "paragraph",
        props: {},
        content: [
          { type: "text", text: "Customer: ", styles: {} },
          { type: "templateField", props: { fieldId: "customer_name" }, content: [] },
        ],
        children: [],
      },
    ];
    const template = Buffer.from(JSON.stringify(blocks), "utf8");

    const out = await service.render(template, {
      title: "Order Document",
      company,
      customer_name: "Mario Rossi",
    });

    expect(out).toBeInstanceOf(Buffer);
    expect(out.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("renders sections provided in fieldContext", async () => {
    // When fieldContext.sections is supplied the template buffer is
    // ignored — the sections provide the content directly.
    const template = Buffer.from("# should be ignored", "utf8");
    const out = await service.render(template, {
      title: "Multi-section Document",
      company,
      sections: [
        { title: "Section 1", content: "First section content." },
        { title: "Section 2", content: "Second section content with **bold** text." },
      ],
    });

    expect(out).toBeInstanceOf(Buffer);
    expect(out.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("includes company name in the rendered document XML", async () => {
    const template = Buffer.from("Simple content.", "utf8");
    const out = await service.render(template, {
      title: "Company Header Test",
      company: { name: "UNIQUE_COMPANY_XYZ" },
    });

    // Unzip and inspect the document parts — the company name lives in
    // word/header*.xml (rendered as a header element). A raw byte search on
    // the ZIP won't find it because the XML is compressed.
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(out);
    const headerEntries = Object.keys(zip.files).filter((name) => name.startsWith("word/header"));
    expect(headerEntries.length).toBeGreaterThan(0);
    const headerXmlContents = await Promise.all(headerEntries.map((name) => zip.file(name)!.async("string")));
    expect(headerXmlContents.some((xml) => xml.includes("UNIQUE_COMPANY_XYZ"))).toBe(true);
  });
});
