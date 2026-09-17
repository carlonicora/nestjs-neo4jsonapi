import { describe, expect, it } from "vitest";
import { hasSegmentSpans, spansFromWords, type DiarizedWord } from "../diarization-spans";

const w = (word: string, start: number, end: number, speaker = 0): DiarizedWord => ({ word, start, end, speaker });

describe("hasSegmentSpans", () => {
  it("accepts an empty list and real spans, rejects the all-zero answer", () => {
    expect(hasSegmentSpans([])).toBe(true);
    expect(hasSegmentSpans([{ start: 0.2, end: 1.8 }])).toBe(true);
    expect(
      hasSegmentSpans([
        { start: 0, end: 0 },
        { start: 0, end: 0 },
      ]),
    ).toBe(false);
    expect(
      hasSegmentSpans([
        { start: 0, end: 0 },
        { start: 1, end: 2 },
        { start: 3, end: 4 },
      ]),
    ).toBe(true);
  });
});

describe("spansFromWords", () => {
  const segments = [
    { start: 0, end: 0, text: "Experience, and that I'm rich.", speaker: 0 },
    { start: 0, end: 0, text: "And what experience do you have?", speaker: 1 },
  ];
  const words = [
    w("Experience,", 0.16, 0.96),
    w("and", 1.52, 1.68),
    w("that", 1.76, 1.86),
    w("I'm", 1.9, 2.0),
    w("rich.", 2.1, 2.5),
    w("And", 3.0, 3.1, 1),
    w("what", 3.2, 3.3, 1),
    w("experience", 3.4, 3.9, 1),
    w("do", 4.0, 4.1, 1),
    w("you", 4.2, 4.3, 1),
    w("have?", 4.4, 4.8, 1),
  ];

  it("walks the word stream by each segment's word count when the counts agree", () => {
    const out = spansFromWords(segments, words);
    expect(out[0]).toMatchObject({ start: 0.16, end: 2.5, text: segments[0].text, speaker: 0 });
    expect(out[1]).toMatchObject({ start: 3.0, end: 4.8, speaker: 1 });
  });

  it("shares the words out proportionally when the counts disagree, keeping order and coverage", () => {
    const out = spansFromWords(segments, words.slice(0, 10)); // one word short
    expect(out[0].start).toBe(0.16);
    expect(out[1].end).toBe(4.3);
    expect(out[0].end).toBeLessThanOrEqual(out[1].start);
  });

  it("leaves segments untouched when there are no words or no text", () => {
    expect(spansFromWords(segments, [])).toBe(segments);
    const blank = [{ start: 0, end: 0, text: "", speaker: 0 }];
    expect(spansFromWords(blank, words)).toBe(blank);
  });

  it("shares words out cumulatively when the counts disagree, so the tail keeps its own span", () => {
    const words = Array.from({ length: 10 }, (_, i) => ({ word: `w${i}`, start: i, end: i + 0.9, speaker: 0 }));
    // 4 segments claiming 3 words each = 12 ≠ 10 words: every segment must still get a distinct slice
    const segments = [0, 1, 2, 3].map(() => ({ start: 0, end: 0, text: "a b c" }));
    const out = spansFromWords(segments, words);
    expect(out.map((s) => [s.start, s.end])).toEqual([
      [0, 2.9],
      [3, 4.9],
      [5, 7.9],
      [8, 9.9],
    ]);
    expect(new Set(out.map((s) => s.start)).size).toBe(4);
  });
});
