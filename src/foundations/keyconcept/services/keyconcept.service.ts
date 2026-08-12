import { Injectable } from "@nestjs/common";
import { EmbedderAttribution } from "../../../core/llm/services/embedder.service";
import { KeyConceptRepository } from "../../keyconcept/repositories/keyconcept.repository";

@Injectable()
export class KeyConceptService {
  constructor(private readonly keyConceptRepository: KeyConceptRepository) {}

  /** `attribution` is OPTIONAL — see `KeyConceptRepository.createOrphanKeyConcepts`. */
  async createOrphanKeyConcepts(params: {
    keyConceptValues: string[];
    attribution?: EmbedderAttribution;
  }): Promise<void> {
    const availableKeyConcepts = await this.keyConceptRepository.findKeyConceptsByValues({
      keyConceptValues: params.keyConceptValues,
    });

    const missingKeyConcepts = params.keyConceptValues.filter((keyConceptId: string) => {
      return !availableKeyConcepts.some((keyConcept) => keyConcept.id === keyConceptId);
    });

    await this.keyConceptRepository.createOrphanKeyConcepts({
      keyConceptValues: missingKeyConcepts,
      attribution: params.attribution,
    });
  }

  /** `attribution` is OPTIONAL — see `KeyConceptRepository.createKeyConcept`. */
  async createKeyConcept(params: {
    content: string;
    atomicFactId: string;
    attribution?: EmbedderAttribution;
  }): Promise<void> {
    const keyConcept = await this.keyConceptRepository.findKeyConceptByValue({
      keyConceptValue: params.content,
    });

    if (!keyConcept) {
      await this.keyConceptRepository.createKeyConcept({
        keyConceptValue: params.content,
        atomicFactId: params.atomicFactId,
        attribution: params.attribution,
      });
    } else {
      await this.keyConceptRepository.createKeyConceptRelation({
        keyConceptValue: params.content,
        atomicFactId: params.atomicFactId,
      });
    }
  }

  async resizeKeyConceptRelationshipsWeightOnChunkDeletion(params: { chunkId: string }): Promise<void> {
    await this.keyConceptRepository.resizeKeyConceptRelationshipsWeightOnChunkDeletion({
      chunkId: params.chunkId,
    });
  }

  async addKeyConceptRelationships(params: {
    companyId?: string;
    chunkId: string;
    relationships: {
      keyConcept1: string;
      keyConcept2: string;
      relationship: string;
    }[];
  }): Promise<void> {
    await this.keyConceptRepository.createOrUpdateKeyConceptRelationships({
      companyId: params.companyId,
      chunkId: params.chunkId,
      relationships: params.relationships,
    });
  }

  async deleteDisconnectedKeyConcepts(): Promise<void> {
    await this.keyConceptRepository.deleteDisconnectedKeyConcepts();
  }
}
