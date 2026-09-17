/** One timestamped word from a `verbose_json` transcription (`timestamp_granularities` includes "word"). */
export interface DiarizedWord {
  word: string;
  start: number;
  end: number;
  speaker: number;
}

interface SpanCarrier {
  start: number;
  end: number;
  text: string;
}

/** True when at least half of the segments have a real span; an empty list is fine (nothing to place). */
export function hasSegmentSpans(segments: ReadonlyArray<Pick<SpanCarrier, "start" | "end">>): boolean {
  if (segments.length === 0) return true;
  const zeroLength = segments.filter((s) => !(s.end > s.start)).length;
  return zeroLength * 2 < segments.length;
}

const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/**
 * Rebuilds segment spans from the word stream.
 *
 * Azure's diarization path (via OpenRouter, `microsoft/mai-transcribe-2`)
 * sometimes returns every SEGMENT with `start = end = 0` while the WORDS of the
 * same response keep their timestamps. The segments' text is the words joined
 * in order, so walking the word list by each segment's word count recovers the
 * spans exactly. When the counts disagree (a word split differently by the
 * two views), the words are shared out proportionally instead, which keeps
 * every segment on the timeline in the right order even if a boundary drifts
 * by a word.
 */
export function spansFromWords<T extends SpanCarrier>(segments: T[], words: DiarizedWord[]): T[] {
  if (segments.length === 0 || words.length === 0) return segments;
  const counts = segments.map((s) => countWords(s.text));
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return segments;

  const exact = total === words.length;
  // Cumulative rounding: boundary i = round(cumulativeCount_i / total * words.length).
  // The boundaries are monotonic and the last one is exactly words.length, so no
  // segment is starved and the tail never collapses onto the last word.
  let cumulative = 0;
  let cursor = 0;
  return segments.map((segment, index) => {
    cumulative += counts[index];
    const to = exact ? cursor + counts[index] : Math.round((cumulative / total) * words.length);
    const from = cursor;
    cursor = Math.max(to, from);
    const slice = words.slice(from, Math.max(to, from + (counts[index] > 0 ? 1 : 0)));
    if (slice.length === 0) return segment;
    return { ...segment, start: slice[0].start, end: slice[slice.length - 1].end };
  });
}
