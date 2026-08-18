import { HttpException, HttpStatus } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeyConceptEmbeddingProcessor } from "../keyconcept.embedding.processor";

/**
 * The structural twin of `ChunkEmbeddingProcessor`, which carries both gates.
 * This one carried neither: it called `vectoriseTextBatch` in a batch loop over
 * every KeyConcept in the company, reachable from
 * `POST /key-concepts/rebuild-embeddings` and `POST /chunks/rebuild-all-embeddings`.
 */
describe("KeyConceptEmbeddingProcessor", () => {
  const JOB_NAME = "embedding:rebuild_keyconcepts";

  let clsService: any;
  let keyConceptRepository: any;
  let embedderService: any;
  let configService: any;

  const makeJob = (overrides: any = {}) =>
    ({
      name: JOB_NAME,
      data: { companyId: "company-1", userId: "user-1" },
      updateProgress: vi.fn(),
      ...overrides,
    }) as any;

  const build = (creditValidator?: any) =>
    new KeyConceptEmbeddingProcessor(clsService, keyConceptRepository, embedderService, configService, creditValidator);

  beforeEach(() => {
    vi.clearAllMocks();
    clsService = { run: (fn: () => unknown) => fn(), set: vi.fn() };
    keyConceptRepository = {
      recreateVectorIndex: vi.fn(async () => undefined),
      findAllKeyConcepts: vi.fn(async () => [
        { id: "kc-1", value: "one" },
        { id: "kc-2", value: "two" },
      ]),
      updateEmbedding: vi.fn(async () => undefined),
    };
    embedderService = { vectoriseTextBatch: vi.fn(async () => [[0.1], [0.2]]) };
    configService = { get: vi.fn(() => ({ process: { rebuild_keyconcepts: JOB_NAME } })) };
  });

  it("embeds every key concept when the plan has AI and the company has credits", async () => {
    const validator = { validateCredits: vi.fn(), isAiEnabled: vi.fn(async () => true) };

    const result = await build(validator).process(makeJob());

    expect(result).toEqual({ processed: 2 });
    expect(embedderService.vectoriseTextBatch).toHaveBeenCalledWith(["one", "two"]);
    expect(keyConceptRepository.updateEmbedding).toHaveBeenCalledTimes(2);
  });

  it("DROPS without touching the embedder or the index when the plan carries no AI", async () => {
    const validator = { validateCredits: vi.fn(), isAiEnabled: vi.fn(async () => false) };

    const result = await build(validator).process(makeJob());

    expect(result).toEqual({ processed: 0 });
    expect(embedderService.vectoriseTextBatch).not.toHaveBeenCalled();
    // Nothing at all is written — not even the vector index is recreated.
    expect(keyConceptRepository.recreateVectorIndex).not.toHaveBeenCalled();
    expect(keyConceptRepository.updateEmbedding).not.toHaveBeenCalled();
    // Ordered above the credit check, so no AI-free company can be asked to pay.
    expect(validator.validateCredits).not.toHaveBeenCalled();
  });

  it("skips cleanly when the company has AI but no credits", async () => {
    const validator = {
      isAiEnabled: vi.fn(async () => true),
      validateCredits: vi.fn(async () => {
        throw new HttpException("NO_CREDITS", HttpStatus.PAYMENT_REQUIRED);
      }),
    };

    const result = await build(validator).process(makeJob());

    // Same shape as the AI-free return — the admin re-embed path treats both as
    // "skipped cleanly" and neither writes a marker (this is maintenance work,
    // it is not deferred into the backlog).
    expect(result).toEqual({ processed: 0 });
    expect(validator.validateCredits).toHaveBeenCalledWith({ companyId: "company-1" });
    expect(embedderService.vectoriseTextBatch).not.toHaveBeenCalled();
  });

  it("proceeds when no validator is bound (ungated deployments)", async () => {
    const result = await build(undefined).process(makeJob());

    expect(result).toEqual({ processed: 2 });
    expect(embedderService.vectoriseTextBatch).toHaveBeenCalled();
  });

  it("rejects a job name it does not own before any gate runs", async () => {
    const validator = { validateCredits: vi.fn(), isAiEnabled: vi.fn(async () => true) };

    await expect(build(validator).process(makeJob({ name: "something-else" }))).rejects.toThrow(
      "not handled by KeyConceptEmbeddingProcessor",
    );
    expect(validator.isAiEnabled).not.toHaveBeenCalled();
  });
});
