import { GUARDS_METADATA } from "@nestjs/common/constants";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SystemRoles } from "../../../common/constants/system.roles";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { AccountDeletionController } from "../controllers/account-deletion.controller";
import { AccountDeletionService } from "../services/account-deletion.service";

const handler = (name: keyof AccountDeletionController) => AccountDeletionController.prototype[name] as any;

describe("AccountDeletionController", () => {
  describe("route metadata", () => {
    it("admin GET and POST :userId carry Roles(Administrator)", () => {
      expect(Reflect.getMetadata("roles", handler("findByUser"))).toEqual([SystemRoles.Administrator]);
      expect(Reflect.getMetadata("roles", handler("requestForUser"))).toEqual([SystemRoles.Administrator]);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler("findByUser"))).toEqual([JwtAuthGuard]);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler("requestForUser"))).toEqual([JwtAuthGuard]);
    });

    it("self routes need a session but no role", () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler("findMine"))).toEqual([JwtAuthGuard]);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler("request"))).toEqual([JwtAuthGuard]);
      expect(Reflect.getMetadata("roles", handler("findMine"))).toBeUndefined();
      expect(Reflect.getMetadata("roles", handler("request"))).toBeUndefined();
    });

    it("keep route has no session guard", () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler("keep"))).toBeUndefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, AccountDeletionController)).toBeUndefined();
    });
  });

  describe("HTTP", () => {
    let app: NestFastifyApplication;
    const service = { keep: vi.fn().mockResolvedValue(undefined), findPreview: vi.fn(), request: vi.fn() };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [AccountDeletionController],
        providers: [
          { provide: AccountDeletionService, useValue: service },
          { provide: CacheService, useValue: { invalidateByType: vi.fn(), invalidateByElement: vi.fn() } },
          { provide: AuditService, useValue: { logRead: vi.fn() } },
        ],
      })
        // A session route must refuse here: the keep route is the only one that may answer.
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => false })
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    });

    afterAll(async () => {
      await app?.close();
    });

    it("POST account-deletions/keep returns 204 without Authorization", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/account-deletions/keep",
        payload: {
          data: {
            type: "account-deletions",
            id: "9b2f6a3e-1c4d-4e5f-8a9b-0c1d2e3f4a5b",
            attributes: { token: "raw-token" },
          },
        },
      });

      expect(response.statusCode).toBe(204);
      expect(service.keep).toHaveBeenCalledWith({ token: "raw-token" });
    });

    it("GET account-deletions/me without a session is refused", async () => {
      const response = await app.inject({ method: "GET", url: "/account-deletions/me" });

      expect(response.statusCode).toBe(403);
      expect(service.findPreview).not.toHaveBeenCalled();
    });
  });
});
