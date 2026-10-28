import { describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../../core/neo4j/abstracts/abstract.service";
import { CommunityDescriptor } from "../../entities/community.entity";
import { CommunityRepository } from "../../repositories/community.repository";
import { CommunityService } from "../community.service";

describe("CommunityService", () => {
  const create = () =>
    new CommunityService(
      { buildSingle: vi.fn(), buildList: vi.fn() } as unknown as Mocked<JsonApiService>,
      { findById: vi.fn() } as unknown as Mocked<CommunityRepository>,
      { get: vi.fn(), has: vi.fn() } as unknown as Mocked<ClsService>,
    );

  it("extends AbstractService on the Community descriptor", () => {
    const service = create();

    expect(service).toBeInstanceOf(AbstractService);
    expect((service as any).descriptor).toBe(CommunityDescriptor);
    expect((service as any).model).toBe(CommunityDescriptor.model);
  });
});
