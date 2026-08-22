import { EndToEndSweepResult, RetrievalSweepResult, SweepSummary } from "./retrieval-eval.types";

const isEndToEnd = (result: RetrievalSweepResult): result is EndToEndSweepResult =>
  (result as EndToEndSweepResult).verdict !== undefined;

/** Total `mustRetrieve` snippets for the question — same denominator `evidenceRetrieved` uses. */
const questionSnippetTotal = (result: EndToEndSweepResult): number =>
  result.evidenceRetrieved + result.missingSnippets.length;

/**
 * Renders a sweep to markdown, leading with the number that decides whether a
 * change ships.
 *
 * A token-accounting mismatch is rendered as a banner, not a column: a sweep
 * whose own arithmetic does not close cannot be used as a baseline, and that
 * must not be discoverable only by reading a table.
 */
export function renderSweepReport(summary: SweepSummary<RetrievalSweepResult>): string {
  const lines: string[] = [];
  const graded = summary.results.filter(isEndToEnd);
  const passed = graded.filter((result) => result.verdict.passed).length;

  lines.push(`# Retrieval sweep — ${summary.product} (${summary.mode})`);
  lines.push("");
  lines.push(`Model \`${summary.model}\` · started ${summary.startedAt}`);
  lines.push("");

  // `checked &&` on purpose: a question whose turn never completed carries
  // `checked: false, agrees: false`, and it is already reported as a failure
  // below. Counting it here too would announce a token mismatch that was never
  // measured and cast doubt on a sweep whose arithmetic is fine.
  const mismatched = graded.filter((result) => result.tokenAccounting.checked && !result.tokenAccounting.agrees);
  if (mismatched.length > 0) {
    lines.push(`> **TOKEN ACCOUNTING MISMATCH on ${mismatched.length} question(s).**`);
    lines.push("> This sweep cannot be used as a baseline until the discrepancy is explained.");
    for (const result of mismatched) {
      lines.push(
        `> \`${result.questionId}\`: reported ${result.tokenAccounting.ledgerInput}/` +
          `${result.tokenAccounting.ledgerOutput}, observed ` +
          `${result.tokenAccounting.observedInput}/${result.tokenAccounting.observedOutput}`,
      );
    }
    lines.push("");
  }

  if (graded.length > 0) {
    const totalMustRetrieve = graded.reduce((sum, result) => sum + questionSnippetTotal(result), 0);
    const totalEvidenceRead = graded.reduce((sum, result) => sum + result.evidenceRead, 0);
    lines.push(
      `**Rubric passes: ${passed}/${graded.length}** · evidence read ${totalEvidenceRead}/${totalMustRetrieve}`,
    );
    lines.push("");

    lines.push(
      "| Question | Verdict | Failure mode | Evidence retrieved | Evidence read | Evidence cited | Chunks | Chunks kept | Chunks kept core | Tokens in/out | Answer ms |",
    );
    lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const result of graded) {
      lines.push(
        `| \`${result.questionId}\` | ${result.verdict.passed ? "pass" : "**fail**"} | ` +
          `${result.verdict.failureMode ?? "—"} | ` +
          `${result.evidenceRetrieved}/${result.evidenceRetrieved + result.missingSnippets.length} | ` +
          `${result.readObserved ? `${result.evidenceRead}/${questionSnippetTotal(result)}` : "n/a"} | ` +
          `${result.evidenceCited}/${result.evidenceCited + result.uncitedSnippets.length} | ` +
          `${result.chunksRead} | ${result.chunksKept} | ${result.chunksKeptCore} | ${result.inputTokens}/${result.outputTokens} | ${result.answerMs} |`,
      );
    }
  } else {
    lines.push("| Question | Evidence retrieved | Chunks | Retrieval ms |");
    lines.push("|---|---:|---:|---:|");
    for (const result of summary.results) {
      lines.push(
        `| \`${result.questionId}\` | ` +
          `${result.evidenceRetrieved}/${result.evidenceRetrieved + result.missingSnippets.length} | ` +
          `${result.chunksRead} | ${result.retrievalMs} |`,
      );
    }
  }

  const failures = graded.filter((result) => !result.verdict.passed);
  if (failures.length > 0) {
    lines.push("");
    lines.push("## Failures");
    for (const result of failures) {
      lines.push("");
      lines.push(`### \`${result.questionId}\` — ${result.verdict.failureMode ?? "ungraded"}`);
      lines.push(result.verdict.explanation);
      if (result.missingSnippets.length > 0) {
        lines.push("");
        lines.push(`Never retrieved: ${result.missingSnippets.map((s) => `"${s}"`).join(", ")}`);
      }
    }
  }

  return lines.join("\n");
}
