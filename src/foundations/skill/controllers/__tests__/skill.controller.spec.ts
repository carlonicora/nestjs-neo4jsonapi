import { Reflector } from "@nestjs/core";
import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA, MODULE_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Both controllers carry a class-level `@UseGuards(JwtAuthGuard)`; the testing module
// instantiates the guard, which pulls in ClsService, Neo4j and the auth hook. Stubbed
// as how-to.controller.spec.ts does, so the spec exercises handlers and decorators only.
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
import { skillMeta } from "../../entities/skill.meta";
import { SkillAdminService } from "../../services/skill.admin.service";
import { SkillService } from "../../services/skill.service";
import { SkillModule } from "../../skill.module";
import { SkillController } from "../skill.controller";
import { SkillAdminController } from "../skill.admin.controller";

const ID = "11111111-1111-4111-8111-111111111111";
const reflector = new Reflector();

const handlerNames = (cls: any): string[] =>
  Object.getOwnPropertyNames(cls.prototype).filter(
    (name) => name !== "constructor" && typeof cls.prototype[name] === "function",
  );

const rolesOf = (cls: any, method: string) => reflector.get<string[] | undefined>("roles", cls.prototype[method]);
const aclOf = (target: any) =>
  reflector.get<{ module: string; action?: string } | undefined>(MODULE_ACL_METADATA, target);

describe("Skill controllers", () => {
  let controller: SkillController;
  let admin: SkillAdminController;
  const auditService = { logRead: vi.fn() };
  const cacheService = { invalidateByType: vi.fn(), invalidateByElement: vi.fn() };
  const doc = { data: { id: ID } };
  // Standard CRUD reaches the services through createCrudHandlers: the inherited entry points
  // (find / findById / createFromDTO / putFromDTO / delete), which the services override.
  const skillService = {
    find: vi.fn().mockResolvedValue(doc),
    findById: vi.fn().mockResolvedValue(doc),
    createFromDTO: vi.fn().mockResolvedValue(doc),
    putFromDTO: vi.fn().mockResolvedValue(doc),
    delete: vi.fn().mockResolvedValue(undefined),
    findActive: vi.fn().mockResolvedValue(doc),
    findForCompany: vi.fn().mockResolvedValue(doc),
    findOneForCompany: vi.fn().mockResolvedValue(doc),
    createForCompany: vi.fn().mockResolvedValue(doc),
    update: vi.fn().mockResolvedValue(doc),
    remove: vi.fn().mockResolvedValue(undefined),
    setEnabled: vi.fn().mockResolvedValue(doc),
    findGlobal: vi.fn().mockResolvedValue(doc),
    findOneGlobal: vi.fn().mockResolvedValue(doc),
    createGlobal: vi.fn().mockResolvedValue(doc),
    updateGlobal: vi.fn().mockResolvedValue(doc),
    removeGlobal: vi.fn().mockResolvedValue(undefined),
    setGlobalActive: vi.fn().mockResolvedValue(doc),
  };
  const skillAdminService = {
    find: vi.fn().mockResolvedValue(doc),
    findById: vi.fn().mockResolvedValue(doc),
    createFromDTO: vi.fn().mockResolvedValue(doc),
    putFromDTO: vi.fn().mockResolvedValue(doc),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const reply = { send: vi.fn(), status: vi.fn().mockReturnThis(), code: vi.fn().mockReturnThis() } as any;
  const req = { params: { skillId: ID } } as any;
  const body = { data: { id: ID, type: skillMeta.type, attributes: { name: "quote" } } } as any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [SkillAdminController, SkillController],
      providers: [
        { provide: SkillService, useValue: skillService },
        { provide: SkillAdminService, useValue: skillAdminService },
        { provide: CacheService, useValue: cacheService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();
    controller = module.get(SkillController);
    admin = module.get(SkillAdminController);
  });

  /** Asserts one service method was called once with `args`, and that no other method of either service ran. */
  const expectOnlyOn = (service: Record<string, any>, method: string, ...args: unknown[]) => {
    expect(service[method]).toHaveBeenCalledTimes(1);
    expect(service[method]).toHaveBeenCalledWith(...args);
    for (const target of [skillService, skillAdminService] as Record<string, any>[]) {
      for (const [name, fn] of Object.entries(target)) {
        if (!(target === service && name === method)) expect(fn).not.toHaveBeenCalled();
      }
    }
  };
  const expectOnly = (method: keyof typeof skillService, ...args: unknown[]) =>
    expectOnlyOn(skillService, method, ...args);
  const expectOnlyAdmin = (method: keyof typeof skillAdminService, ...args: unknown[]) =>
    expectOnlyOn(skillAdminService, method, ...args);

  describe("authorisation metadata", () => {
    it("restricts every company handler but findActive to the Company Administrator", () => {
      for (const method of handlerNames(SkillController)) {
        if (method === "findActive") {
          expect(rolesOf(SkillController, method)).toBeUndefined();
        } else {
          expect(rolesOf(SkillController, method)).toContain(SystemRoles.CompanyAdministrator);
        }
      }
    });

    it("restricts every admin handler to the Administrator", () => {
      const names = handlerNames(SkillAdminController);
      expect(names.length).toBeGreaterThanOrEqual(7);
      for (const method of names) {
        expect(rolesOf(SkillAdminController, method)).toContain(SystemRoles.Administrator);
      }
    });

    it("puts both controllers in the Skill section", () => {
      expect(aclOf(SkillController)).toEqual({ module: CoreModuleId.Skill });
      expect(aclOf(SkillAdminController)).toEqual({ module: CoreModuleId.Skill });
    });

    it("checks enable and disable as updates", () => {
      for (const cls of [SkillController, SkillAdminController] as any[]) {
        expect(aclOf(cls.prototype.enable)).toEqual({ module: CoreModuleId.Skill, action: "update" });
        expect(aclOf(cls.prototype.disable)).toEqual({ module: CoreModuleId.Skill, action: "update" });
      }
    });

    it("answers 204 on DELETE", () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, SkillController.prototype.delete)).toBe(HttpStatus.NO_CONTENT);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, SkillAdminController.prototype.delete)).toBe(
        HttpStatus.NO_CONTENT,
      );
    });

    it("lists SkillAdminController before SkillController in SkillModule", () => {
      const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, SkillModule) as unknown[];
      expect(controllers.indexOf(SkillAdminController)).toBeGreaterThanOrEqual(0);
      expect(controllers.indexOf(SkillAdminController)).toBeLessThan(controllers.indexOf(SkillController));
    });
  });

  describe("SkillController handlers", () => {
    it("findActive", async () => {
      await controller.findActive(reply);
      expectOnly("findActive");
      expect(reply.send).toHaveBeenCalledWith(doc);
    });

    it("findAll", async () => {
      await controller.findAll(reply, { page: 1 }, "quote", "name");
      expectOnly("find", { query: { page: 1 }, term: "quote", fetchAll: undefined, orderBy: undefined, sort: "name" });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });

    it("findById", async () => {
      await controller.findById(req, reply, ID);
      expectOnly("findById", { id: ID });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });

    it("create", async () => {
      await controller.create(reply, body);
      expectOnly("createFromDTO", { data: body.data, included: undefined });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });

    it("update", async () => {
      await controller.update(req, reply, body);
      expectOnly("putFromDTO", { data: body.data, included: undefined });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });

    it("delete", async () => {
      await controller.delete(req, reply, ID);
      expectOnly("delete", { id: ID });
      expect(reply.send).toHaveBeenCalled();
    });

    it("enable", async () => {
      await controller.enable(req, reply, ID);
      expectOnly("setEnabled", { id: ID, enabled: true });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });

    it("disable", async () => {
      await controller.disable(req, reply, ID);
      expectOnly("setEnabled", { id: ID, enabled: false });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });
  });

  describe("SkillAdminController handlers", () => {
    it("findAll", async () => {
      await admin.findAll(reply, { page: 1 }, "quote", "name");
      expectOnlyAdmin("find", {
        query: { page: 1 },
        term: "quote",
        fetchAll: undefined,
        orderBy: undefined,
        sort: "name",
      });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });

    it("findById", async () => {
      await admin.findById(req, reply, ID);
      expectOnlyAdmin("findById", { id: ID });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });

    it("create", async () => {
      await admin.create(reply, body);
      expectOnlyAdmin("createFromDTO", { data: body.data, included: undefined });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });

    it("update", async () => {
      await admin.update(req, reply, body);
      expectOnlyAdmin("putFromDTO", { data: body.data, included: undefined });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });

    it("delete", async () => {
      await admin.delete(req, reply, ID);
      expectOnlyAdmin("delete", { id: ID });
      expect(reply.send).toHaveBeenCalled();
    });

    it("enable", async () => {
      await admin.enable(req, reply, ID);
      expectOnly("setGlobalActive", { id: ID, active: true });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });

    it("disable", async () => {
      await admin.disable(req, reply, ID);
      expectOnly("setGlobalActive", { id: ID, active: false });
      expect(reply.send).toHaveBeenCalledWith(doc);
    });
  });
});
