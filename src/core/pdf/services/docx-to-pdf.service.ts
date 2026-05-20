import { Injectable } from "@nestjs/common";
import * as libre from "libreoffice-convert";

/**
 * Converts a DOCX buffer to a PDF buffer by shelling out to LibreOffice
 * headless via the `libreoffice-convert` wrapper.
 *
 * The system must have `libreoffice` (libreoffice-core + libreoffice-writer)
 * on $PATH. See the api Dockerfile and the api CLAUDE.md for local-dev install
 * instructions.
 *
 * - macOS: `brew install --cask libreoffice`
 * - Linux: `apt-get install libreoffice-core libreoffice-writer`
 *
 * The service is intentionally stateless — no subprocess pooling, no lifecycle
 * hooks. Each call spawns a fresh LibreOffice subprocess (~2–5 s). The
 * `Buffer → Buffer` interface is stable so a future switch to Gotenberg (HTTP)
 * or another engine only requires changing this file's body.
 *
 * Implementation note: `libreoffice-convert@^1.8` is a hybrid function — it
 * takes a callback AND returns a Promise (because it uses `async.auto().then()`
 * internally). Node's `util.promisify` emits DEP0174 ("Calling promisify on a
 * function that returns a Promise is likely a mistake") on hybrid functions,
 * so we wrap the callback directly with `new Promise(...)` instead of
 * `promisify`.
 */
@Injectable()
export class DocxToPdfService {
  /** Convert a DOCX buffer to a PDF buffer. Throws on conversion failure. */
  convert(docxBuffer: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      libre.convert(docxBuffer, ".pdf", undefined, (err, pdfBuffer) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(pdfBuffer);
      });
    });
  }
}
