import JSZip from "jszip";

/**
 * Replace a placeholder string in word/document.xml with a raw XML fragment.
 *
 * The placeholder must already be present in the document's XML. Both
 * placeholder and xmlFragment are inserted verbatim — caller is responsible
 * for producing well-formed WordprocessingML.
 *
 * @param docxBuffer  - A valid DOCX file as a Buffer.
 * @param placeholder - The exact string to find and replace in word/document.xml.
 * @param xmlFragment - The raw XML string that replaces the placeholder.
 * @returns A new DOCX Buffer with the substitution applied.
 * @throws If word/document.xml is missing or the placeholder is not found.
 */
export async function injectXml(docxBuffer: Buffer, placeholder: string, xmlFragment: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBuffer);

  const documentXmlFile = zip.file("word/document.xml");
  if (!documentXmlFile) {
    throw new Error("DOCX is missing word/document.xml");
  }

  const documentXml = await documentXmlFile.async("text");
  if (!documentXml.includes(placeholder)) {
    throw new Error(`Placeholder not found in DOCX: ${placeholder}`);
  }

  const replaced = documentXml.replace(placeholder, xmlFragment);
  zip.file("word/document.xml", replaced);

  return zip.generateAsync({ type: "nodebuffer" });
}
