import { BadRequestException } from "@nestjs/common";
import JSZip from "jszip";

/**
 * Ceilings on what an uploaded OOXML file (DOCX, XLSX: both are zip archives) may expand to
 * before the chunker parses it.
 *
 * A small archive can declare, or simply inflate to, gigabytes (a decompression bomb). The parsers
 * downstream hold whole parts in memory (`document.xml` as one string and then one XML tree; SheetJS
 * the whole workbook), so an uncapped expansion takes the API or worker process down.
 *
 * - Per entry, 64 MiB: the largest single part the chunker accepts. `word/document.xml` for a
 *   2,000-page legal document is in the tens of MiB; one part beyond that is not a real document.
 * - Total, 256 MiB: every part together. Embedded media barely compresses, so a genuine file
 *   expands to roughly its stored size; the upload cap is 100 MB, and 256 MiB leaves room for
 *   heavily compressed XML around it while staying far below the worker heap.
 */
export const ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
export const ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

/** The archive `loadZipWithinLimits` returns. */
export type LoadedZip = JSZip;

export interface ZipLimits {
  maxEntryBytes: number;
  maxTotalBytes: number;
}

const DEFAULT_LIMITS: ZipLimits = {
  maxEntryBytes: ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES,
  maxTotalBytes: ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES,
};

/** The size the central directory declares for an entry. JSZip keeps it on the private `_data`. */
function declaredSize(entry: JSZip.JSZipObject): number {
  const size = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
  return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : 0;
}

function tooLarge(label: string, name: string | undefined, limit: number): BadRequestException {
  return new BadRequestException(
    name
      ? `${label}: entry ${name} expands beyond ${limit} bytes`
      : `${label}: archive expands beyond ${limit} bytes in total`,
  );
}

/**
 * Inflates one entry while counting, discarding the bytes. Rejects as soon as the entry passes the
 * per-entry cap or the running archive total passes the total cap; the declared size is not trusted.
 */
function countEntry(params: {
  entry: JSZip.JSZipObject;
  label: string;
  limits: ZipLimits;
  totalSoFar: number;
}): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const stream = params.entry.nodeStream("nodebuffer");
    let entryBytes = 0;
    let settled = false;
    const stop = (error: BadRequestException) => {
      if (settled) return;
      settled = true;
      stream.pause();
      stream.removeAllListeners("data");
      reject(error);
    };

    stream.on("data", (chunk: Buffer) => {
      entryBytes += chunk.length;
      if (entryBytes > params.limits.maxEntryBytes)
        return stop(tooLarge(params.label, params.entry.name, params.limits.maxEntryBytes));
      if (params.totalSoFar + entryBytes > params.limits.maxTotalBytes)
        return stop(tooLarge(params.label, undefined, params.limits.maxTotalBytes));
    });
    // JSZip fails an entry whose inflated length differs from the declared one ("uncompressed data
    // size mismatch") or whose data is corrupt: an archive that lies about its sizes is refused too.
    stream.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      reject(new BadRequestException(`${params.label}: entry ${params.entry.name} is corrupt (${error.message})`));
    });
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(entryBytes);
    });
  });
}

/**
 * Loads `buffer` as a zip and refuses it (BadRequestException) when any entry, or the archive as a
 * whole, expands beyond the limits. Checks the declared sizes first (cheap, no inflation), then
 * inflates every entry with a running counter, since a crafted archive can declare small sizes and
 * still inflate without bound. Returns the loaded archive, which is then safe to read.
 *
 * Returns `undefined` when `buffer` is not a zip at all; the caller decides what that means.
 */
export async function loadZipWithinLimits(params: {
  buffer: Buffer;
  label: string;
  limits?: Partial<ZipLimits>;
}): Promise<JSZip | undefined> {
  const limits: ZipLimits = { ...DEFAULT_LIMITS, ...params.limits };

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(params.buffer);
  } catch {
    return undefined;
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);

  let declaredTotal = 0;
  for (const entry of entries) {
    const size = declaredSize(entry);
    if (size > limits.maxEntryBytes) throw tooLarge(params.label, entry.name, limits.maxEntryBytes);
    declaredTotal += size;
    if (declaredTotal > limits.maxTotalBytes) throw tooLarge(params.label, undefined, limits.maxTotalBytes);
  }

  let actualTotal = 0;
  for (const entry of entries) {
    actualTotal += await countEntry({ entry, label: params.label, limits, totalSoFar: actualTotal });
  }

  return zip;
}
