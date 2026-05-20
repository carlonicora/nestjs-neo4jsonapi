/**
 * Generic "BOZZA" (draft) watermark injection for DOCX files.
 *
 * Ported from apps/api/src/features/finance/invoice/document/inject-draft-watermark.ts
 * and adapted to accept/return a Buffer instead of a JSZip instance, so it
 * can be used as a standalone utility without the caller needing to manage
 * the JSZip lifecycle.
 *
 * The original file remains in place until T5/T6 migration work (it will be
 * deleted once the invoice generator is refactored to use this library util).
 */

import JSZip from "jszip";

const SENTINEL = "___NEURAL_ERP_DRAFT_WATERMARK___";
const DEFAULT_HEADER_PATH = "word/header1.xml";
const INJECTED_FLAG = "__neuralErpDraftWatermarkInjected";

/**
 * Inject an idempotent "BOZZA" watermark into the document's default header.
 *
 * Accepts a DOCX as a Buffer and returns a new DOCX Buffer with the watermark
 * applied. Re-running on the same document is safe — the SENTINEL marker is
 * checked first so the watermark is never double-injected.
 *
 * @param docxBuffer - A valid DOCX file as a Buffer.
 * @param text       - Watermark text (defaults to "BOZZA").
 * @returns A new DOCX Buffer with the watermark injected.
 */
export async function injectDraftWatermark(docxBuffer: Buffer, text = "BOZZA"): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBuffer);
  await _injectWatermarkIntoZip(zip, text);
  return zip.generateAsync({ type: "nodebuffer" });
}

// ---------------------------------------------------------------------------
// Internal implementation (operates on a JSZip instance)
// ---------------------------------------------------------------------------

async function _injectWatermarkIntoZip(zip: JSZip, text: string): Promise<void> {
  const zipWithFlag = zip as JSZip & { [INJECTED_FLAG]?: true };
  if (zipWithFlag[INJECTED_FLAG]) return;
  zipWithFlag[INJECTED_FLAG] = true;

  const existingHeaderFile = zip.file(DEFAULT_HEADER_PATH);

  // Branch 1: template already has its own header (the common case for real
  // templates with company logo / fiscal data in the header band). Inject the
  // watermark paragraph INTO the existing header before its closing `</w:hdr>`.
  if (existingHeaderFile) {
    let headerXml = await existingHeaderFile.async("string");
    // Idempotency: skip if our SENTINEL bookmark is already present.
    if (headerXml.includes(SENTINEL)) return;
    headerXml = headerXml.replace("</w:hdr>", `${_watermarkParagraph(text)}</w:hdr>`);
    zip.file(DEFAULT_HEADER_PATH, headerXml);
    return;
  }

  // Branch 2: no header in the template — create one from scratch and wire up
  // the relationship + content-type + sectPr reference.
  const documentXmlFile = zip.file("word/document.xml");
  if (!documentXmlFile) return;
  let documentXml = await documentXmlFile.async("string");

  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
       xmlns:v="urn:schemas-microsoft-com:vml"
       xmlns:o="urn:schemas-microsoft-com:office:office"
       xmlns:w10="urn:schemas-microsoft-com:office:word"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  ${_watermarkParagraph(text)}
</w:hdr>`;
  zip.file(DEFAULT_HEADER_PATH, headerXml);

  const relsPath = "word/_rels/document.xml.rels";
  const relsFile = zip.file(relsPath);
  let relsXml = relsFile
    ? await relsFile.async("string")
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;
  const relId = "rIdNeuralErpDraftHeader";
  if (!relsXml.includes(relId)) {
    relsXml = relsXml.replace(
      "</Relationships>",
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`,
    );
    zip.file(relsPath, relsXml);
  }

  const ctPath = "[Content_Types].xml";
  const ctFile = zip.file(ctPath);
  if (ctFile) {
    let ctXml = await ctFile.async("string");
    if (!ctXml.includes("/word/header1.xml")) {
      ctXml = ctXml.replace(
        "</Types>",
        `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`,
      );
      zip.file(ctPath, ctXml);
    }
  }

  if (documentXml.includes("<w:sectPr")) {
    documentXml = documentXml.replace(
      /<w:sectPr\b([^>]*)>/,
      `<w:sectPr$1><w:headerReference w:type="default" r:id="${relId}"/>`,
    );
  } else {
    documentXml = documentXml.replace(
      "</w:body>",
      `<w:sectPr><w:headerReference w:type="default" r:id="${relId}"/></w:sectPr></w:body>`,
    );
  }
  zip.file("word/document.xml", documentXml);
}

function _watermarkParagraph(text: string): string {
  // Build a watermark using DrawingML (`<w:drawing>` inside `<mc:AlternateContent>`)
  // with a VML fallback. DrawingML is rendered correctly by both Microsoft Word
  // AND LibreOffice (which produces the PDF). The VML path is kept as a
  // legacy fallback for older renderers via `<mc:Fallback>`.
  //
  // Size: ~7620000 EMU wide × ~1524000 EMU tall (≈ 21cm × 4cm).
  // Rotation: -2700000 (60ths of a degree → -45°, i.e. bottom-left to top-right).
  return `<w:p>
    <w:bookmarkStart w:id="9999" w:name="${SENTINEL}"/>
    <w:r>
      <w:rPr><w:noProof/></w:rPr>
      <mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
        <mc:Choice xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" Requires="wps">
          <w:drawing>
            <wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">
              <wp:simplePos x="0" y="0"/>
              <wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>
              <wp:positionV relativeFrom="page"><wp:align>center</wp:align></wp:positionV>
              <wp:extent cx="7620000" cy="1524000"/>
              <wp:effectExtent l="0" t="0" r="0" b="0"/>
              <wp:wrapNone/>
              <wp:docPr id="1" name="DraftWatermark"/>
              <wp:cNvGraphicFramePr/>
              <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                  <wps:wsp>
                    <wps:cNvSpPr txBox="1"/>
                    <wps:spPr>
                      <a:xfrm rot="-2700000">
                        <a:off x="0" y="0"/>
                        <a:ext cx="7620000" cy="1524000"/>
                      </a:xfrm>
                      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                      <a:noFill/>
                      <a:ln><a:noFill/></a:ln>
                    </wps:spPr>
                    <wps:txbx>
                      <w:txbxContent>
                        <w:p>
                          <w:pPr>
                            <w:jc w:val="center"/>
                            <w:rPr>
                              <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
                              <w:color w:val="D3D3D3"/>
                              <w:sz w:val="200"/>
                            </w:rPr>
                          </w:pPr>
                          <w:r>
                            <w:rPr>
                              <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
                              <w:color w:val="D3D3D3"/>
                              <w:sz w:val="200"/>
                            </w:rPr>
                            <w:t>${text}</w:t>
                          </w:r>
                        </w:p>
                      </w:txbxContent>
                    </wps:txbx>
                    <wps:bodyPr wrap="none" rtlCol="0" anchor="ctr"/>
                  </wps:wsp>
                </a:graphicData>
              </a:graphic>
            </wp:anchor>
          </w:drawing>
        </mc:Choice>
        <mc:Fallback>
          <w:pict>
            <v:shape id="DraftWatermarkFallback" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:600pt;height:120pt;rotation:-45;z-index:-251658240;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" fillcolor="#D3D3D3" stroked="f">
              <v:fill opacity=".5"/>
              <v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="${text}"/>
            </v:shape>
          </w:pict>
        </mc:Fallback>
      </mc:AlternateContent>
    </w:r>
    <w:bookmarkEnd w:id="9999"/>
  </w:p>`;
}
