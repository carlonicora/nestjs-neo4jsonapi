import { vi, describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { transcodeForDirect } from "../ffmpeg-transcode";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

const mockSpawn = vi.mocked(spawn);

/** Fake ffmpeg: emit a Duration line on stderr, then close with `code`. */
function queueFfmpeg(code = 0, stderr = "  Duration: 00:00:05.00, start: 0.0\n"): void {
  const proc: any = new EventEmitter();
  proc.stderr = new EventEmitter();
  mockSpawn.mockImplementationOnce((() => {
    setImmediate(() => {
      proc.stderr.emit("data", Buffer.from(stderr));
      proc.emit("close", code);
    });
    return proc;
  }) as any);
}

/** Extract the `-af` filter string from the most recent spawn call, or null. */
function lastFilterArg(): string | null {
  const [, args] = mockSpawn.mock.calls.at(-1) as [string, string[]];
  const i = args.indexOf("-af");
  return i === -1 ? null : args[i + 1];
}

describe("transcodeForDirect filter options", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emits NO -af when no options are passed (unchanged behaviour)", async () => {
    queueFfmpeg();
    const result = await transcodeForDirect("/tmp/stem.ogg");
    expect(lastFilterArg()).toBeNull();
    expect(result.durationSeconds).toBe(5);
  });

  it("emits NO -af for an empty options object", async () => {
    queueFfmpeg();
    await transcodeForDirect("/tmp/stem.ogg", {});
    expect(lastFilterArg()).toBeNull();
  });

  it("adds a high-pass filter when highpassHz is set", async () => {
    queueFfmpeg();
    await transcodeForDirect("/tmp/stem.ogg", { highpassHz: 85 });
    expect(lastFilterArg()).toBe("highpass=f=85");
  });

  it("ignores highpassHz when ≤ 0", async () => {
    queueFfmpeg();
    await transcodeForDirect("/tmp/stem.ogg", { highpassHz: 0 });
    expect(lastFilterArg()).toBeNull();
  });

  it("adds the both-ends silence-trim idiom when trimSilence is set", async () => {
    queueFfmpeg();
    await transcodeForDirect("/tmp/stem.ogg", { trimSilence: true });
    const filter = lastFilterArg();
    expect(filter).toContain("silenceremove=start_periods=1:start_threshold=-50dB");
    expect(filter).toContain("areverse");
  });

  it("honours a custom silence threshold", async () => {
    queueFfmpeg();
    await transcodeForDirect("/tmp/stem.ogg", { trimSilence: true, silenceThresholdDb: -45 });
    expect(lastFilterArg()).toContain("-45dB");
  });

  it("chains high-pass before silence-trim", async () => {
    queueFfmpeg();
    await transcodeForDirect("/tmp/stem.ogg", { highpassHz: 85, trimSilence: true });
    const filter = lastFilterArg() ?? "";
    expect(filter.startsWith("highpass=f=85,")).toBe(true);
    expect(filter).toContain("silenceremove");
  });
});
