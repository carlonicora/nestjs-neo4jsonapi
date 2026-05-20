import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { DocxToPdfService } from "./docx-to-pdf.service";

/**
 * Integration test for DocxToPdfService.
 *
 * Requires LibreOffice to be installed and on $PATH:
 *   - macOS:  brew install --cask libreoffice
 *   - Linux:  apt-get install libreoffice-core libreoffice-writer
 *
 * The test is automatically skipped when LibreOffice is not available
 * (e.g. on developer machines without the binary installed). CI installs
 * LibreOffice via the Dockerfile.
 *
 * The test generates a minimal DOCX in-memory using the `docx` library and
 * asserts that the returned buffer is a valid PDF (magic bytes "%PDF-").
 */
function hasLibreOffice(): boolean {
  try {
    execSync("which libreoffice || which soffice", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeIfLibreOffice = hasLibreOffice() ? describe : describe.skip;

describeIfLibreOffice("DocxToPdfService", () => {
  let service: DocxToPdfService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [DocxToPdfService],
    }).compile();
    service = module.get(DocxToPdfService);
  });

  it("converts a DOCX buffer to a PDF buffer", async () => {
    // Build a minimal valid DOCX buffer in-memory so the test has no file-
    // system fixture dependency.  The `docx` library is available in this
    // package (added by T4); `Packer.toBuffer` produces a proper ZIP/DOCX.
    const { Document, Packer, Paragraph, TextRun } = await import("docx");
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [new TextRun("Hello, PDF conversion test.")],
            }),
          ],
        },
      ],
    });
    const docxBuffer = await Packer.toBuffer(doc);

    const pdf = await service.convert(docxBuffer);

    expect(pdf).toBeInstanceOf(Buffer);
    // Every valid PDF starts with the "%PDF-" header
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  }, 30_000); // LibreOffice subprocess can take up to ~5 s; allow 30 s for CI
});
