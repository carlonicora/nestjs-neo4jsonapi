import { Injectable } from "@nestjs/common";
import { KeyConceptRepository } from "../../keyconcept/repositories/keyconcept.repository";

@Injectable()
export class KeyConceptService {
  constructor(private readonly keyConceptRepository: KeyConceptRepository) {}

  async createOrphanKeyConcepts(params: { keyConceptValues: string[] }): Promise<void> {
    const availableKeyConcepts = await this.keyConceptRepository.findKeyConceptsByValues({
      keyConceptValues: params.keyConceptValues,
    });

    const missingKeyConcepts = params.keyConceptValues.filter((keyConceptId: string) => {
      return !availableKeyConcepts.some((keyConcept) => keyConcept.id === keyConceptId);
    });

    await this.keyConceptRepository.createOrphanKeyConcepts({
      keyConceptValues: missingKeyConcepts,
    });
  }

  async createKeyConcept(params: { content: string; atomicFactId: string }): Promise<void> {
    const keyConcept = await this.keyConceptRepository.findKeyConceptByValue({
      keyConceptValue: params.content,
    });

    if (!keyConcept) {
      await this.keyConceptRepository.createKeyConcept({
        keyConceptValue: params.content,
        atomicFactId: params.atomicFactId,
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
