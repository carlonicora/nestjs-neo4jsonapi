import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiConnectionService } from "../ai-connection.service";

const repository = {
  findById: vi.fn(),
  findByIds: vi.fn(),
  updatePositions: vi.fn(),
} as any;
const jsonApiService = {} as any;
const clsService = { get: vi.fn(), has: vi.fn() } as any;
const encryption = {
  isConfigured: vi.fn().mockReturnValue(true),
  encrypt: vi.fn((v: string) => `enc(${v})`),
  decrypt: vi.fn((v: string) => v.replace(/^enc\(|\)$/g, "")),
} as any;
const eventEmitter = { emit: vi.fn() } as any;
const configService = { get: vi.fn().mockReturnValue({}) } as any;

function makeService(): AiConnectionService {
  const service = new AiConnectionService(
    jsonApiService,
    repository,
    clsService,
    encryption,
    eventEmitter,
    configService,
  );
  // Inherited CRUD is exercised in Task K's live boot, not re-unit-tested here.
  (service as any).createFromDTO = vi.fn().mockResolvedValue({ data: {} });
  (service as any).putFromDTO = vi.fn().mockResolvedValue({ data: {} });
  return service;
}

const postBody = (attributes: Record<string, unknown>) => ({
  data: {
    type: "ai-connections",
    id: "11111111-1111-4111-8111-111111111111",
    attributes: {
      name: "Primary",
      connectionType: "ai",
      provider: "azure",
      position: 0,
      enabled: true,
      instance: "inst",
      model: "gpt-5",
      apiKey: "sk-live",
      apiVersion: "2024-06-01",
      ...attributes,
    },
  },
});

describe("AiConnectionService.create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("encrypts secrets before persisting and emits the change event", async () => {
    const service = makeService();
    await service.create(postBody({}) as any);
    const forwarded = ((service as any).createFromDTO as any).mock.calls[0][0];
    expect(forwarded.data.attributes.apiKey).toBe("enc(sk-live)");
    expect(eventEmitter.emit).toHaveBeenCalledWith("ai-connections.changed");
  });

  it("rejects registry violations", async () => {
    const service = makeService();
    await expect(service.create(postBody({ provider: "no-such" }) as any)).rejects.toThrow(BadRequestException);
  });

  it("fails loudly when encryption is unconfigured and a secret is supplied", async () => {
    encryption.isConfigured.mockReturnValueOnce(false);
    const service = makeService();
    await expect(service.create(postBody({}) as any)).rejects.toThrow(/ENCRYPTION_KEY/);
  });
});

describe("AiConnectionService.update", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the stored secret when the update sends none", async () => {
    repository.findById.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", apiKey: "enc(sk-old)" });
    const service = makeService();
    await service.update(postBody({ apiKey: undefined }) as any);
    const forwarded = ((service as any).putFromDTO as any).mock.calls[0][0];
    expect(forwarded.data.attributes.apiKey).toBe("enc(sk-old)");
    // A secret with NO stored value must stay ABSENT (an undefined key makes
    // the PUT Cypher reference a parameter the mapper stripped → Neo4jError).
    expect("googleCredentialsBase64" in forwarded.data.attributes).toBe(false);
  });

  it("re-encrypts a newly supplied secret", async () => {
    repository.findById.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", apiKey: "enc(sk-old)" });
    const service = makeService();
    await service.update(postBody({ apiKey: "sk-new" }) as any);
    const forwarded = ((service as any).putFromDTO as any).mock.calls[0][0];
    expect(forwarded.data.attributes.apiKey).toBe("enc(sk-new)");
  });
});

describe("AiConnectionService.reorder", () => {
  const idA = "11111111-1111-4111-8111-111111111111";
  const idB = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => vi.clearAllMocks());

  it("renumbers and emits the change event", async () => {
    repository.findByIds.mockResolvedValue([
      { id: idA, connectionType: "ai", companyId: undefined },
      { id: idB, connectionType: "ai", companyId: undefined },
    ]);
    const service = makeService();
    await service.reorder({ ids: [idA, idB] });
    expect(repository.updatePositions).toHaveBeenCalledWith({ ids: [idA, idB] });
    expect(eventEmitter.emit).toHaveBeenCalledWith("ai-connections.changed");
  });

  it("rejects ids that do not all exist", async () => {
    repository.findByIds.mockResolvedValue([{ id: idA, connectionType: "ai", companyId: undefined }]);
    const service = makeService();
    await expect(service.reorder({ ids: [idA, idB] })).rejects.toThrow(BadRequestException);
    expect(repository.updatePositions).not.toHaveBeenCalled();
  });

  it("rejects a reorder that mixes chains (different type or scope)", async () => {
    repository.findByIds.mockResolvedValue([
      { id: idA, connectionType: "ai", companyId: undefined },
      { id: idB, connectionType: "ai", companyId: "33333333-3333-4333-8333-333333333333" },
    ]);
    const service = makeService();
    await expect(service.reorder({ ids: [idA, idB] })).rejects.toThrow(BadRequestException);
    expect(repository.updatePositions).not.toHaveBeenCalled();
  });
});
