import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { beforeEach, describe, expect, it, Mocked, vi } from "vitest";
import { SkillRepository } from "../../repositories/skill.repository";
import { SkillService } from "../skill.service";

const COMPANY_ID = "company0-0001-4000-a000-000000000001";
const SKILL_ID = "11111111-1111-4111-8111-111111111111";
const ORIGINAL_ID = "22222222-2222-4222-8222-222222222222";

const repository = {
  findScopedById: vi.fn(),
  findForCompany: vi.fn(),
  findActiveForCompany: vi.fn(),
  findGlobal: vi.fn(),
  findGlobalById: vi.fn(),
  findById: vi.fn(),
  countOwn: vi.fn(),
  findNameClash: vi.fn(),
  isCopiedByCompany: vi.fn(),
  findGlobalNameClash: vi.fn(),
  setDisabledForCompany: vi.fn(),
  create: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
} as unknown as Mocked<SkillRepository>;

const jsonApiService = {
  buildSingle: vi.fn(async (_model: unknown, record: unknown) => ({ data: record })),
  buildList: vi.fn(async (_model: unknown, records: unknown[]) => ({ data: records })),
} as any;

let companyId: string | undefined = COMPANY_ID;
const clsService = {
  get: vi.fn((key: string) => (key === "companyId" ? companyId : key === "userId" ? "user-1" : undefined)),
  has: vi.fn((key: string) => (key === "companyId" ? !!companyId : key === "userId")),
} as any;

function makeService(): SkillService {
  const service = new SkillService(jsonApiService, repository, clsService);
  // Inherited CRUD is not re-unit-tested here: putFromDTO now overrides the inherited one and
  // reaches it through super, which hands the mapped params to put.
  (service as any).put = vi.fn().mockResolvedValue({ data: { id: "updated" } });
  return service;
}

const body = (attributes: Record<string, unknown> = {}, relationships?: Record<string, unknown>) =>
  ({
    data: {
      type: "skills",
      id: SKILL_ID,
      attributes: {
        name: "quote",
        description: "Writes a quote.",
        instructions: "Do it.",
        isActive: true,
        ...attributes,
      },
      ...(relationships ? { relationships } : {}),
    },
  }) as any;

const copyBody = () => body({ name: "renamed" }, { original: { data: { type: "skills", id: ORIGINAL_ID } } });

const globalSkill = (over: Record<string, unknown> = {}) => ({
  id: ORIGINAL_ID,
  name: "brief",
  description: "d",
  instructions: "i",
  isActive: true,
  isGlobal: true,
  origin: "global",
  isEnabled: true,
  isHidden: false,
  canRestore: false,
  ...over,
});

const ownSkill = (over: Record<string, unknown> = {}) => ({
  id: SKILL_ID,
  name: "quote",
  description: "d",
  instructions: "i",
  isActive: true,
  isGlobal: false,
  origin: "company",
  isEnabled: true,
  isHidden: false,
  canRestore: false,
  ...over,
});

describe("SkillService", () => {
  let service: SkillService;

  beforeEach(() => {
    vi.clearAllMocks();
    companyId = COMPANY_ID;
    repository.countOwn.mockResolvedValue(0);
    repository.findNameClash.mockResolvedValue(null);
    repository.isCopiedByCompany.mockResolvedValue(false);
    repository.findGlobalNameClash.mockResolvedValue(false);
    repository.findById.mockResolvedValue({ id: SKILL_ID } as any);
    service = makeService();
  });

  describe("without a company in context", () => {
    beforeEach(() => {
      companyId = undefined;
    });

    it.each([
      ["findForCompany", () => service.findForCompany({ query: {} })],
      ["findOneForCompany", () => service.findOneForCompany({ id: SKILL_ID })],
      ["createForCompany", () => service.createForCompany(body())],
      ["update", () => service.update(body())],
      ["remove", () => service.remove({ id: SKILL_ID })],
      ["setEnabled", () => service.setEnabled({ id: SKILL_ID, enabled: true })],
    ])("%s answers 404", async (_name, call) => {
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findScopedById).not.toHaveBeenCalled();
    });

    it("findActive answers the active global skills", async () => {
      repository.findActiveForCompany.mockResolvedValue([globalSkill()] as any);
      const result = await service.findActive();
      expect(result.data).toHaveLength(1);
    });
  });

  describe("a skill the caller cannot see", () => {
    beforeEach(() => repository.findScopedById.mockResolvedValue(null));

    it.each([
      ["findOneForCompany", () => service.findOneForCompany({ id: SKILL_ID })],
      ["update", () => service.update(body())],
      ["remove", () => service.remove({ id: SKILL_ID })],
      ["setEnabled", () => service.setEnabled({ id: SKILL_ID, enabled: false })],
      ["create copy-of", () => service.createForCompany(copyBody())],
    ])("%s answers 404, never 403 or 409", async (_name, call) => {
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.put).not.toHaveBeenCalled();
      expect(repository.patch).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
      expect(repository.setDisabledForCompany).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe("createForCompany (own)", () => {
    it("refuses a name used by one of the company's skills", async () => {
      repository.findNameClash.mockResolvedValue("own");
      await expect(service.createForCompany(body())).rejects.toThrow(new ConflictException("skill.name_taken"));
    });

    it("refuses the name of a listed global", async () => {
      repository.findNameClash.mockResolvedValue("global");
      await expect(service.createForCompany(body())).rejects.toThrow(new ConflictException("skill.name_global"));
    });

    it("refuses the 31st skill", async () => {
      repository.countOwn.mockResolvedValue(30);
      await expect(service.createForCompany(body())).rejects.toThrow(
        new UnprocessableEntityException("skill.limit_reached"),
      );
    });

    it("creates a company skill tied to the company in context", async () => {
      // The inherited create reads the new skill back through the scoped findById override.
      repository.findScopedById.mockResolvedValue(ownSkill() as any);
      await service.createForCompany(body({ isGlobal: true }));
      const forwarded = repository.create.mock.calls[0][0] as any;
      expect(forwarded.isGlobal).toBe(false);
      expect(forwarded.company).toBe(COMPANY_ID);
      expect(forwarded.original).toBeUndefined();
    });
  });

  describe("createForCompany (copy of a global)", () => {
    it("copies a switched-on global with its current name", async () => {
      repository.findScopedById.mockResolvedValue(globalSkill() as any);
      await service.createForCompany(copyBody());
      expect(repository.findScopedById).toHaveBeenCalledWith({ id: ORIGINAL_ID });
      const forwarded = repository.create.mock.calls[0][0] as any;
      expect(forwarded.name).toBe("brief");
      expect(forwarded.isActive).toBe(true);
      expect(forwarded.isGlobal).toBe(false);
      expect(forwarded.original).toBe(ORIGINAL_ID);
      expect(forwarded.company).toBe(COMPANY_ID);
      expect(repository.setDisabledForCompany).not.toHaveBeenCalled();
    });

    it("copies a switched-off global as off and clears the company switch", async () => {
      repository.findScopedById.mockResolvedValue(globalSkill({ isEnabled: false }) as any);
      await service.createForCompany(copyBody());
      const forwarded = repository.create.mock.calls[0][0] as any;
      expect(forwarded.isActive).toBe(false);
      expect(forwarded.name).toBe("brief");
      expect(repository.setDisabledForCompany).toHaveBeenCalledWith({ id: ORIGINAL_ID, disabled: false });
    });

    it.each([
      ["the company's own skill", () => ownSkill({ id: ORIGINAL_ID })],
      ["a copy", () => ownSkill({ id: ORIGINAL_ID, origin: "copy" })],
      ["a hidden global", () => globalSkill({ isHidden: true })],
    ])("refuses %s as skill.changed", async (_name, original) => {
      repository.findScopedById.mockResolvedValue(original() as any);
      await expect(service.createForCompany(copyBody())).rejects.toThrow(new ConflictException("skill.changed"));
    });

    it("refuses a global the company already copied (OVERRIDES edge)", async () => {
      repository.findScopedById.mockResolvedValue(globalSkill() as any);
      repository.isCopiedByCompany.mockResolvedValue(true);
      await expect(service.createForCompany(copyBody())).rejects.toThrow(new ConflictException("skill.changed"));
      expect(repository.isCopiedByCompany).toHaveBeenCalledWith({ id: ORIGINAL_ID });
    });

    it("refuses a second copy after the Administrator renamed the original (the copy kept the old name)", async () => {
      repository.findScopedById.mockResolvedValue(globalSkill() as any);
      // No own skill carries the global's new name, but the company's copy still overrides it.
      repository.findNameClash.mockResolvedValue(null);
      repository.isCopiedByCompany.mockResolvedValue(true);
      await expect(service.createForCompany(copyBody())).rejects.toThrow(new ConflictException("skill.changed"));
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("refuses a copy at 30 skills", async () => {
      repository.findScopedById.mockResolvedValue(globalSkill() as any);
      repository.countOwn.mockResolvedValue(30);
      await expect(service.createForCompany(copyBody())).rejects.toThrow(
        new UnprocessableEntityException("skill.limit_reached"),
      );
    });
  });

  describe("update", () => {
    it("refuses a global skill", async () => {
      repository.findScopedById.mockResolvedValue(globalSkill() as any);
      await expect(service.update(body())).rejects.toThrow(new ForbiddenException("skill.global_readonly"));
    });

    it("keeps a copy's name", async () => {
      repository.findScopedById.mockResolvedValue(ownSkill({ name: "brief", origin: "copy" }) as any);
      await service.update(body({ name: "other" }));
      const forwarded = ((service as any).put as any).mock.calls[0][0];
      expect(forwarded.name).toBe("brief");
      expect(repository.findNameClash).not.toHaveBeenCalled();
    });

    it("refuses a rename to a taken name", async () => {
      repository.findScopedById.mockResolvedValue(ownSkill() as any);
      repository.findNameClash.mockResolvedValue("own");
      await expect(service.update(body({ name: "other" }))).rejects.toThrow(new ConflictException("skill.name_taken"));
      expect(repository.findNameClash).toHaveBeenCalledWith({ name: "other", excludeId: SKILL_ID });
    });

    it("refuses a rename to a listed global's name", async () => {
      repository.findScopedById.mockResolvedValue(ownSkill() as any);
      repository.findNameClash.mockResolvedValue("global");
      await expect(service.update(body({ name: "other" }))).rejects.toThrow(new ConflictException("skill.name_global"));
    });

    it("saves an own skill", async () => {
      repository.findScopedById.mockResolvedValue(ownSkill() as any);
      const result = await service.update(body({ description: "new" }));
      expect(result).toEqual({ data: { id: "updated" } });
      const forwarded = ((service as any).put as any).mock.calls[0][0];
      expect(forwarded.description).toBe("new");
    });
  });

  describe("standard CRUD entry points (createCrudHandlers)", () => {
    it("find is the company list", async () => {
      const spy = vi.spyOn(service, "findForCompany").mockResolvedValue({ data: [] } as any);
      await service.find({ query: { page: 1 }, term: "qu", sort: "name" });
      expect(spy).toHaveBeenCalledWith({ query: { page: 1 }, term: "qu", sort: "name" });
    });

    it("findById is the scoped read", async () => {
      const spy = vi.spyOn(service, "findOneForCompany").mockResolvedValue({ data: {} } as any);
      await service.findById({ id: SKILL_ID });
      expect(spy).toHaveBeenCalledWith({ id: SKILL_ID });
    });

    it("findById answers 404 for a skill the company cannot see", async () => {
      repository.findScopedById.mockResolvedValue(null);
      await expect(service.findById({ id: SKILL_ID })).rejects.toThrow(NotFoundException);
    });

    it("createFromDTO applies the company create rules", async () => {
      const spy = vi.spyOn(service, "createForCompany").mockResolvedValue({ data: {} } as any);
      const dto = body();
      await service.createFromDTO(dto);
      expect(spy).toHaveBeenCalledWith({ data: dto.data });
    });

    it("putFromDTO applies the company update rules", async () => {
      const spy = vi.spyOn(service, "update").mockResolvedValue({ data: {} } as any);
      const dto = body();
      await service.putFromDTO(dto);
      expect(spy).toHaveBeenCalledWith({ data: dto.data });
    });

    it("delete applies the company delete rules", async () => {
      const spy = vi.spyOn(service, "remove").mockResolvedValue(undefined);
      await service.delete({ id: SKILL_ID });
      expect(spy).toHaveBeenCalledWith({ id: SKILL_ID });
    });
  });

  describe("remove", () => {
    it("deletes an own skill", async () => {
      repository.findScopedById.mockResolvedValue(ownSkill() as any);
      await service.remove({ id: SKILL_ID });
      expect(repository.delete).toHaveBeenCalledWith({ id: SKILL_ID });
    });

    it("restores the original of a copy whose original is on", async () => {
      repository.findScopedById.mockResolvedValue(ownSkill({ origin: "copy", canRestore: true }) as any);
      await service.remove({ id: SKILL_ID });
      expect(repository.delete).toHaveBeenCalledWith({ id: SKILL_ID });
    });

    it("refuses to restore a copy whose original is off", async () => {
      repository.findScopedById.mockResolvedValue(ownSkill({ origin: "copy", canRestore: false }) as any);
      await expect(service.remove({ id: SKILL_ID })).rejects.toThrow(new ConflictException("skill.changed"));
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it("refuses a global skill", async () => {
      repository.findScopedById.mockResolvedValue(globalSkill() as any);
      await expect(service.remove({ id: ORIGINAL_ID })).rejects.toThrow(
        new ForbiddenException("skill.global_readonly"),
      );
    });
  });

  describe("setEnabled", () => {
    it.each([
      [true, false],
      [false, true],
    ])("switches a global for the company (enabled %s)", async (enabled, disabled) => {
      repository.findScopedById.mockResolvedValue(globalSkill({ isEnabled: !enabled }) as any);
      const result = await service.setEnabled({ id: ORIGINAL_ID, enabled });
      expect(repository.setDisabledForCompany).toHaveBeenCalledWith({ id: ORIGINAL_ID, disabled });
      expect(repository.findScopedById).toHaveBeenCalledTimes(2);
      expect(result.data).toMatchObject({ id: ORIGINAL_ID });
    });

    it("refuses a hidden global", async () => {
      repository.findScopedById.mockResolvedValue(globalSkill({ isHidden: true }) as any);
      await expect(service.setEnabled({ id: ORIGINAL_ID, enabled: false })).rejects.toThrow(
        new ConflictException("skill.changed"),
      );
    });

    it("refuses a copied global, even when the copy kept an old name", async () => {
      repository.findScopedById.mockResolvedValue(globalSkill() as any);
      repository.findNameClash.mockResolvedValue(null);
      repository.isCopiedByCompany.mockResolvedValue(true);
      await expect(service.setEnabled({ id: ORIGINAL_ID, enabled: false })).rejects.toThrow(
        new ConflictException("skill.changed"),
      );
      expect(repository.setDisabledForCompany).not.toHaveBeenCalled();
    });

    it.each(["company", "copy"])("patches isActive on a %s skill", async (origin) => {
      repository.findScopedById.mockResolvedValue(ownSkill({ origin }) as any);
      await service.setEnabled({ id: SKILL_ID, enabled: false });
      expect(repository.patch).toHaveBeenCalledWith({ id: SKILL_ID, isActive: false });
      expect(repository.setDisabledForCompany).not.toHaveBeenCalled();
    });
  });

  describe("findActive", () => {
    it("never sends the instructions", async () => {
      repository.findActiveForCompany.mockResolvedValue([
        ownSkill(),
        { ...globalSkill(), original: globalSkill() },
      ] as any);
      await service.findActive();
      const records = jsonApiService.buildList.mock.calls[0][1] as any[];
      expect(records).toHaveLength(2);
      for (const record of records) {
        expect("instructions" in record).toBe(false);
        expect(record.original).toBeUndefined();
      }
    });
  });

  describe("findForCompany", () => {
    it("pages the company's list", async () => {
      repository.findForCompany.mockResolvedValue([ownSkill()] as any);
      await service.findForCompany({ query: {}, term: "quote", sort: "name" });
      expect(repository.findForCompany).toHaveBeenCalledWith(
        expect.objectContaining({ term: "quote", orderByFields: [{ field: "name", direction: "asc" }] }),
      );
    });
  });

  describe("global skills", () => {
    it("createGlobal refuses a name another global uses", async () => {
      repository.findGlobalNameClash.mockResolvedValue(true);
      await expect(service.createGlobal(body())).rejects.toThrow(new ConflictException("skill.name_taken"));
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("createGlobal creates a global without a company edge and returns it even when off", async () => {
      repository.findGlobalById.mockResolvedValue(globalSkill({ id: SKILL_ID, isActive: false }) as any);
      const result = await service.createGlobal(
        body({ isActive: false }, { original: { data: { type: "skills", id: ORIGINAL_ID } } }),
      );
      const params = repository.create.mock.calls[0][0] as any;
      expect(params.isGlobal).toBe(true);
      expect(params.isActive).toBe(false);
      expect(params.company).toBeUndefined();
      expect(params.original).toBeUndefined();
      expect(repository.findGlobalById).toHaveBeenCalledWith({ id: SKILL_ID });
      expect(result.data).toMatchObject({ id: SKILL_ID, isActive: false });
    });

    it.each([
      ["updateGlobal", () => service.updateGlobal(body())],
      ["removeGlobal", () => service.removeGlobal({ id: SKILL_ID })],
      ["setGlobalActive", () => service.setGlobalActive({ id: SKILL_ID, active: true })],
      ["findOneGlobal", () => service.findOneGlobal({ id: SKILL_ID })],
    ])("%s answers 404 on a non-global id", async (_name, call) => {
      repository.findGlobalById.mockResolvedValue(null);
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.put).not.toHaveBeenCalled();
      expect(repository.patch).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it("updateGlobal refuses a rename to another global's name", async () => {
      repository.findGlobalById.mockResolvedValue(globalSkill({ id: SKILL_ID }) as any);
      repository.findGlobalNameClash.mockResolvedValue(true);
      await expect(service.updateGlobal(body({ name: "quote" }))).rejects.toThrow(
        new ConflictException("skill.name_taken"),
      );
      expect(repository.findGlobalNameClash).toHaveBeenCalledWith({ name: "quote", excludeId: SKILL_ID });
    });

    it("setGlobalActive patches isActive and returns the global", async () => {
      repository.findGlobalById.mockResolvedValue(globalSkill({ id: SKILL_ID }) as any);
      await service.setGlobalActive({ id: SKILL_ID, active: false });
      expect(repository.patch).toHaveBeenCalledWith({ id: SKILL_ID, isActive: false });
    });

    it("removeGlobal deletes the global", async () => {
      repository.findGlobalById.mockResolvedValue(globalSkill({ id: SKILL_ID }) as any);
      await service.removeGlobal({ id: SKILL_ID });
      expect(repository.delete).toHaveBeenCalledWith({ id: SKILL_ID });
    });
  });
});
