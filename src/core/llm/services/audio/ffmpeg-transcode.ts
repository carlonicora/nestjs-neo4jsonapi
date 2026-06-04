import { spawn } from "node:child_process";
import { mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface TranscodeResult {
  /** Absolute path to the resulting 16 kHz mono mp3. */
  path: string;
  /** Duration of the source audio in seconds, parsed from ffmpeg stderr. */
  durationSeconds: number;
  /** Best-effort cleanup. Safe to call multiple times. */
  cleanup: () => Promise<void>;
}

/**
 * Optional, in-pass audio cleanup applied during the transcode. All fields are
 * opt-in — omit them (or pass `{}`) and the transcode behaves exactly as before
 * (plain resample, no filtering). Callers that transcribe speech can enable a
 * high-pass and/or silence trim without a second ffmpeg pass.
 */
export interface TranscodeOptions {
  /**
   * High-pass cutoff in Hz: removes sub-speech rumble, handling noise and
   * plosive energy below this frequency. Typical speech value ≈ 80–100.
   * Omit or set ≤ 0 to disable.
   */
  highpassHz?: number;
  /** Trim leading and trailing silence from the clip. */
  trimSilence?: boolean;
  /** Silence floor (dBFS) used when `trimSilence` is set. Default -50. */
  silenceThresholdDb?: number;
}

/**
 * Build the ffmpeg `-af` filter chain from the opt-in cleanup options. Returns
 * an empty array when nothing is enabled (caller then omits `-af` entirely).
 */
function buildAudioFilters(options: TranscodeOptions): string[] {
  const filters: string[] = [];
  if (options.highpassHz && options.highpassHz > 0) {
    filters.push(`highpass=f=${options.highpassHz}`);
  }
  if (options.trimSilence) {
    const threshold = options.silenceThresholdDb ?? -50;
    // Trim leading silence, reverse, trim the (now-leading) trailing silence,
    // reverse back — the canonical ffmpeg both-ends silenceremove idiom.
    filters.push(
      `silenceremove=start_periods=1:start_threshold=${threshold}dB`,
      "areverse",
      `silenceremove=start_periods=1:start_threshold=${threshold}dB`,
      "areverse",
    );
  }
  return filters;
}

/**
 * Transcode the source audio file to a normalised 16 kHz mono mp3 in a
 * unique temp path. Always re-encodes — never trusts the source container
 * framing (the narr8 recorder writes OGG via a hand-rolled encoder, and
 * STT endpoints can be brittle about non-standard containers).
 *
 * `options` enables optional in-pass cleanup (high-pass, silence trim). When
 * omitted the behaviour is unchanged.
 */
export async function transcodeForDirect(srcPath: string, options: TranscodeOptions = {}): Promise<TranscodeResult> {
  const outDir = join(tmpdir(), "narr8", "audio-direct");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `${randomUUID()}.mp3`);

  const filters = buildAudioFilters(options);

  const args = [
    "-hide_banner",
    "-loglevel",
    "info",
    "-y",
    "-i",
    srcPath,
    ...(filters.length > 0 ? ["-af", filters.join(",")] : []),
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "64k",
    outPath,
  ];

  const { stderr, code } = await runFfmpeg(args);
  if (code !== 0) {
    const tail = stderr.split("\n").slice(-8).join("\n");
    throw new Error(`ffmpeg exited ${code}: ${tail}`);
  }

  const durationSeconds = parseDurationSeconds(stderr);
  if (durationSeconds === null) {
    throw new Error("ffmpeg stderr did not contain a Duration line");
  }

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await unlink(outPath).catch(() => undefined);
  };

  return { path: outPath, durationSeconds, cleanup };
}

function runFfmpeg(args: string[]): Promise<{ stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stderr, code: code ?? -1 }));
  });
}

/**
 * Parse `Duration: HH:MM:SS.ms` from ffmpeg's stderr.
 * Returns total seconds (float) or null if not found.
 */
function parseDurationSeconds(stderr: string): number | null {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  return hours * 3600 + minutes * 60 + seconds;
}
