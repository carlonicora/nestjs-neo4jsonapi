import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { EmbedderAttribution } from "../../../core/llm/services/embedder.service";
import { AtomicFactRepository } from "../../atomicfact/repositories/atomicfact.repository";
import { KeyConceptService } from "../../keyconcept/services/keyconcept.service";

@Injectable()
export class AtomicFactService {
  constructor(
    private readonly atomicFactRepository: AtomicFactRepository,
    private readonly keyConceptService: KeyConceptService,
  ) {}

  /**
   * `attribution` is OPTIONAL and only forwarded: creating an atomic fact costs
   * nothing, but each key concept it introduces is embedded, and that spend
   * belongs to the entity whose ingestion produced this fact.
   */
  async createAtomicFact(params: {
    chunkId: string;
    content: string;
    keyConcepts: string[];
    attribution?: EmbedderAttribution;
  }): Promise<void> {
    const atomicFactId = createHash("md5").update(params.content).digest("hex");

    await this.atomicFactRepository.createAtomicFact({
      atomicFactId: atomicFactId,
      chunkId: params.chunkId,
      content: params.content,
    });

    for (const keyConcept of params.keyConcepts) {
      await this.keyConceptService.createKeyConcept({
        content: keyConcept,
        atomicFactId: atomicFactId,
        attribution: params.attribution,
      });
    }
  }

  async deleteDisconnectedAtomicFacts(): Promise<void> {
    await this.atomicFactRepository.deleteDisconnectedAtomicFacts();
    await this.keyConceptService.deleteDisconnectedKeyConcepts();
  }
}
