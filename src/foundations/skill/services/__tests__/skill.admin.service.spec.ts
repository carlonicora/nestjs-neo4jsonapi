import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import type { SkillRepository } from "../../repositories/skill.repository";
import { SkillAdminService } from "../skill.admin.service";
import type { SkillService } from "../skill.service";

/**
 * SkillAdminService is the createCrudHandlers entry point of the Administrator's routes:
 * every inherited CRUD method maps to a global-skill method of SkillService, never to the
 * company-scoped one (decision P2).
 */
describe("SkillAdminService", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const doc = { data: { id: ID } } as any;
  const skillService = {
    findGlobal: vi.fn().mockResolvedValue(doc),
    findOneGlobal: vi.fn().mockResolvedValue(doc),
    createGlobal: vi.fn().mockResolvedValue(doc),
    updateGlobal: vi.fn().mockResolvedValue(doc),
    removeGlobal: vi.fn().mockResolvedValue(undefined),
    findForCompany: vi.fn(),
    findOneForCompany: vi.fn(),
    createForCompany: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  } as unknown as Mocked<SkillService>;
  const repository = {} as unknown as SkillRepository;
  let service: SkillAdminService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SkillAdminService({} as any, repository, { get: vi.fn() } as any, skillService);
  });

  const companyMethodsUntouched = () => {
    for (const method of ["findForCompany", "findOneForCompany", "createForCompany", "update", "remove"] as const) {
      expect(skillService[method]).not.toHaveBeenCalled();
    }
  };

  it("find is the global list", async () => {
    await expect(service.find({ query: { page: 1 }, term: "qu", sort: "name" })).resolves.toBe(doc);
    expect(skillService.findGlobal).toHaveBeenCalledWith({ query: { page: 1 }, term: "qu", sort: "name" });
    companyMethodsUntouched();
  });

  it("findById is the global read", async () => {
    await expect(service.findById({ id: ID })).resolves.toBe(doc);
    expect(skillService.findOneGlobal).toHaveBeenCalledWith({ id: ID });
    companyMethodsUntouched();
  });

  it("createFromDTO creates a global skill", async () => {
    const data = { id: ID, type: "skills", attributes: { name: "quote" } } as any;
    await expect(service.createFromDTO({ data })).resolves.toBe(doc);
    expect(skillService.createGlobal).toHaveBeenCalledWith({ data });
    companyMethodsUntouched();
  });

  it("putFromDTO updates a global skill", async () => {
    const data = { id: ID, type: "skills", attributes: { name: "quote" } } as any;
    await expect(service.putFromDTO({ data })).resolves.toBe(doc);
    expect(skillService.updateGlobal).toHaveBeenCalledWith({ data });
    companyMethodsUntouched();
  });

  it("delete deletes a global skill", async () => {
    await service.delete({ id: ID });
    expect(skillService.removeGlobal).toHaveBeenCalledWith({ id: ID });
    companyMethodsUntouched();
  });
});
