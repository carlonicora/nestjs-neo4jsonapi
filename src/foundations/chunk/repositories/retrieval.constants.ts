/**
 * Above this many in-scope chunks, exact cosine over the scoped set stops being
 * the cheaper option and the vector index is used with an over-fetch instead.
 * Starting value; Phase 1's harness is what validates it.
 */
export const EXACT_SCAN_MAX_SCOPED_CHUNKS = 5000;

/** Candidates pulled from the vector index before scope filtering, in the fallback path. */
export const CHUNK_VECTOR_OVERFETCH = 2000;

/** Same, for the key-concept index. */
export const KEYCONCEPT_VECTOR_OVERFETCH = 2000;

/**
 * Atomic facts one contextualiser run may pull from the key-concept join.
 * Spec §5.4. Replaces NO limit at all: ten key concepts returned 161 facts on
 * one measured turn, which batched into four scoring calls and queued 45 chunks.
 *
 * The facts are NOT ordered before the cut. Atomic facts carry no embedding
 * (spec §2.4), so there is no relevance signal to order by — this is a spend
 * bound, not a ranking.
 */
export const MAX_ATOMIC_FACTS = 150;

/**
 * Hard backstop on provider calls in one contextualiser run. Replaces
 * `maxHops = 20`, which counted NODES — and three of them advanced the counter
 * by two, so twenty was really about ten nodes and the `hops >= 15` brakes fired
 * after seven. It was never a spend bound.
 *
 * Spec §5.4's value, restored now that Block 3c has landed. The post-3c worst
 * case is SIX provider calls per run — question refiner, rational plan, concept
 * reranking, and at most three atomic-fact batches — because both per-chunk
 * fan-outs are gone. Twelve is therefore double the worst case: a backstop
 * against a routing bug, not a bound anyone should reach.
 *
 * It was deliberately 100 through Blocks 3a and 3b, when `chunk_vector` still
 * reported one call per chunk read (median 25, measured maximum 34) and a budget
 * of 12 would have been spent by that node's own return, routing every question
 * straight to the answer and skipping the whole graph walk.
 */
export const MAX_LLM_CALLS_PER_RUN = 12;

/**
 * Key concepts the reranker may hand to the graph walk. Spec §5.4 — the value
 * is UNCHANGED behaviour, replacing a bare literal `10` at the end of the
 * selection in `keyconcepts.node.service.ts` so the number is named and tunable
 * with the rest.
 */
export const MAX_KEY_CONCEPTS = 10;

/**
 * Characters of notebook the answer node may receive. NEVER applies to seed
 * contexts (C3) — the budget lives inside `buildNotebookSection`, which cannot
 * reach `buildSeedSection`.
 *
 * This is the ONLY thing bounding what the contextualiser sends downstream once
 * Block 3c deletes the per-chunk LLM calls. Owner decision, 2026-08-22: no
 * relevance threshold and no chunk-count cap — entries are sorted best-score
 * first and the weakest are dropped when the budget fills. Measured reason: on
 * this corpus the spec's relative bar admits every candidate (scores bunch into
 * 0.69–0.86) and a count cap of 8 loses required evidence on 4 of 20 questions.
 * A character budget adapts to how large the chunks actually are, which a count
 * cap cannot. See docs/eval/retrieval/calibration-3a.md.
 *
 * 40,000 → 80,000, owner decision 2026-08-22 (shed-widening gate fallback,
 * docs/superpowers/specs/2026-08-22-notebook-budget-shed-widening-design.md §4):
 * at 40k the trim discarded required evidence even after shedding — med-04 kept
 * 4 of 24 entries and the model never read the 55% invalidity figure it was
 * asked about. ~80k chars ≈ ~20k tokens of notebook; measured median input
 * moves from ~20.7k toward the high-20ks, still far below the 104k pre-3c
 * baseline.
 */
export const NOTEBOOK_BUDGET_CHARS = 80_000;
