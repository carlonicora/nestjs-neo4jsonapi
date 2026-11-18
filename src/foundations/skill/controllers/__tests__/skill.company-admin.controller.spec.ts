import { AsyncLocalStorage } from "async_hooks";
import { Reflector } from "@nestjs/core";
import { HttpStatus, NotFoundException } from "@nestjs/common";
import { HTTP_CODE_METADATA, MODULE_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The class-level `@UseGuards(JwtAuthGuard)` pulls in ClsService, Neo4j and the auth hook;
// stubbed as skill.controller.spec.ts does, so the spec exercises handlers and decorators only.
vi.mock("../../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = () => true;
  },
}));

import { CoreModuleId } from "../../../../common/constants/core-module.ids";
import { SystemRoles } from "../../../../common/constants/system.roles";
import { MODULE_ACL_METADATA } from "../../../../common/decorators/module.decorator";
import { CacheService } from "../../../../core/cache/services/cache.service";
import { AuditService } from "../../../audit/services/audit.service";
import { CompanyRepository } from "../../../company/repositories/company.repository";
import { skillMeta } from "../../entities/skill.meta";
import { SkillCompanyAdminService } from "../../services/skill.company-admin.service";
import { SkillService } from "../../services/skill.service";
import { SkillModule } from "../../skill.module";
import { SkillAdminController } from "../skill.admin.controller";
import { SkillCompanyAdminController } from "../skill.company-admin.controller";
import { SkillController } from "../skill.controller";

const ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const reflector = new Reflector();

const handlerNames = (cls: any): string[] =>
  Object.getOwnPropertyNames(cls.prototype).filter(
    (name) => name !== "constructor" && typeof cls.prototype[name] === "function",
  );

describe("SkillCompanyAdminController", () => {
  let controller: SkillCompanyAdminController;
  const cls = new ClsService(new AsyncLocalStorage());
  const doc = { data: { id: ID } };

  /** The CLS company and user each SkillService call ran with. */
  let seen: { companyId: unknown; userId: unknown; roles: unknown }[];
  const record = <T>(value: T) =>
    vi.fn(async () => {
      seen.push({ companyId: cls.get("companyId"), userId: cls.get("userId"), roles: cls.get("roles") });
      return value;
    });

  const skillService = {
    find: record(doc),
    findById: record(doc),
    createFromDTO: record(doc),
    putFromDTO: record(doc),
    delete: record(undefined),
    setEnabled: record(doc),
    findActive: record(doc),
    findGlobal: record(doc),
    findOneGlobal: record(doc),
    createGlobal: record(doc),
    updateGlobal: record(doc),
    removeGlobal: record(undefined),
    setGlobalActive: record(doc),
  };
  const companyRepository = { findByCompanyId: vi.fn() };
  const auditService = { logRead: vi.fn() };
  const cacheService = { invalidateByType: vi.fn(), invalidateByElement: vi.fn() };
  const reply = { send: vi.fn(), status: vi.fn().mockReturnThis(), code: vi.fn().mockReturnThis() } as any;
  const req = { params: { companyId: COMPANY_ID, skillId: ID } } as any;
  const body = { data: { id: ID, type: skillMeta.type, attributes: { name: "quote" } } } as any;

  /** Runs `fn` as the Administrator's request: user id and role, no company. */
  const asAdministrator = <T>(fn: () => Promise<T>) =>
    cls.run(async () => {
      cls.set("userId", ADMIN_ID);
      cls.set("roles", [SystemRoles.Administrator]);
      const result = await fn();
      // The request's own context is untouched once the company call ends.
      expect(cls.get("companyId")).toBeUndefined();
      expect(cls.get("userId")).toBe(ADMIN_ID);
      return result;
    });

  beforeEach(async () => {
    vi.clearAllMocks();
    seen = [];
    companyRepository.findByCompanyId.mockResolvedValue({ id: COMPANY_ID });
    const module = await Test.createTestingModule({
      controllers: [SkillCompanyAdminController],
      providers: [
        SkillCompanyAdminService,
        { provide: ClsService, useValue: cls },
        { provide: CompanyRepository, useValue: companyRepository },
        { provide: SkillService, useValue: skillService },
        { provide: CacheService, useValue: cacheService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();
    controller = module.get(SkillCompanyAdminController);
  });

  /** One SkillService method ran, once, with `args`, in the picked company and with no user id. */
  const expectOnly = (method: keyof typeof skillService, ...args: unknown[]) => {
    expect(companyRepository.findByCompanyId).toHaveBeenCalledWith({ companyId: COMPANY_ID });
    expect(skillService[method]).toHaveBeenCalledTimes(1);
    expect(skillService[method]).toHaveBeenCalledWith(...args);
    for (const [name, fn] of Object.entries(skillService)) if (name !== method) expect(fn).not.toHaveBeenCalled();
    expect(seen).toEqual([{ companyId: COMPANY_ID, userId: null, roles: [SystemRoles.Administrator] }]);
  };

  describe("authorisation metadata", () => {
    it("restricts every handler to the Administrator", () => {
      const names = handlerNames(SkillCompanyAdminController);
      expect(names).toHaveLength(7);
      for (const method of names) {
        expect(reflector.get("roles", (SkillCompanyAdminController.prototype as any)[method])).toEqual([
          SystemRoles.Administrator,
        ]);
      }
    });

    it("puts the controller in the Skill section and checks enable / disable as updates", () => {
      expect(reflector.get(MODULE_ACL_METADATA, SkillCompanyAdminController)).toEqual({ module: CoreModuleId.Skill });
      for (const method of ["enable", "disable"]) {
        expect(reflector.get(MODULE_ACL_METADATA, (SkillCompanyAdminController.prototype as any)[method])).toEqual({
          module: CoreModuleId.Skill,
          action: "update",
        });
      }
    });

    it("answers 204 on DELETE", () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, SkillCompanyAdminController.prototype.delete)).toBe(
        HttpStatus.NO_CONTENT,
      );
    });

    it("mounts the routes under skills/companies/:companyId", () => {
      const path = (method: string) =>
        Reflect.getMetadata("path", (SkillCompanyAdminController.prototype as any)[method]);
      expect(path("findAll")).toBe("skills/companies/:companyId");
      expect(path("create")).toBe("skills/companies/:companyId");
      expect(path("findById")).toBe("skills/companies/:companyId/:skillId");
      expect(path("update")).toBe("skills/companies/:companyId/:skillId");
      expect(path("delete")).toBe("skills/companies/:companyId/:skillId");
      expect(path("enable")).toBe("skills/companies/:companyId/:skillId/enable");
      expect(path("disable")).toBe("skills/companies/:companyId/:skillId/disable");
    });

    it("is listed in SkillModule before SkillController", () => {
      const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, SkillModule) as unknown[];
      expect(controllers.indexOf(SkillAdminController)).toBe(0);
      expect(controllers.indexOf(SkillCompanyAdminController)).toBeGreaterThan(0);
      expect(controllers.indexOf(SkillCompanyAdminController)).toBeLessThan(controllers.indexOf(SkillController));
    });
  });

  describe("handlers run the company methods in the picked company", () => {
    it("findAll", async () => {
      await asAdministrator(() => controller.findAll(reply, COMPANY_ID, { page: 1 }, "quote", "name"));
      expectOnly("find", { query: { page: 1 }, term: "quote", fetchAll: undefined, orderBy: undefined, sort: "name" });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });

    it("findById", async () => {
      await asAdministrator(() => controller.findById(req, reply, COMPANY_ID, ID));
      expectOnly("findById", { id: ID });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });

    it("create", async () => {
      await asAdministrator(() => controller.create(reply, COMPANY_ID, body));
      expectOnly("createFromDTO", { data: body.data, included: undefined });
      expect(cacheService.invalidateByType).toHaveBeenCalledWith(skillMeta.endpoint);
    });

    it("update", async () => {
      await asAdministrator(() => controller.update(req, reply, COMPANY_ID, body));
      expectOnly("putFromDTO", { data: body.data, included: undefined });
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith(skillMeta.endpoint, ID);
    });

    it("delete", async () => {
      await asAdministrator(() => controller.delete(req, reply, COMPANY_ID, ID));
      expectOnly("delete", { id: ID });
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith(skillMeta.endpoint, ID);
    });

    it("enable", async () => {
      await asAdministrator(() => controller.enable(req, reply, COMPANY_ID, ID));
      expectOnly("setEnabled", { id: ID, enabled: true });
      expect(reply.send).toHaveBeenCalledWith(doc);
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith(skillMeta.endpoint, ID);
    });

    it("disable", async () => {
      await asAdministrator(() => controller.disable(req, reply, COMPANY_ID, ID));
      expectOnly("setEnabled", { id: ID, enabled: false });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });
  });

  describe("unknown company", () => {
    beforeEach(() => companyRepository.findByCompanyId.mockResolvedValue(null));

    const calls: [string, () => Promise<unknown>][] = [
      ["findAll", () => controller.findAll(reply, COMPANY_ID, {})],
      ["findById", () => controller.findById(req, reply, COMPANY_ID, ID)],
      ["create", () => controller.create(reply, COMPANY_ID, body)],
      ["update", () => controller.update(req, reply, COMPANY_ID, body)],
      ["delete", () => controller.delete(req, reply, COMPANY_ID, ID)],
      ["enable", () => controller.enable(req, reply, COMPANY_ID, ID)],
      ["disable", () => controller.disable(req, reply, COMPANY_ID, ID)],
    ];

    it.each(calls)("%s answers 404 and runs no skill method", async (_name, call) => {
      await expect(asAdministrator(call)).rejects.toBeInstanceOf(NotFoundException);
      for (const fn of Object.values(skillService)) expect(fn).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
      expect(cacheService.invalidateByType).not.toHaveBeenCalled();
      expect(cacheService.invalidateByElement).not.toHaveBeenCalled();
    });
  });
});
