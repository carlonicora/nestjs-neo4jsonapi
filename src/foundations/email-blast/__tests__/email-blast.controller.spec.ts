import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemRoles } from "../../../common/constants/system.roles";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { EmailBlastController } from "../controllers/email-blast.controller";
import { EmailBlastPublicController } from "../controllers/email-blast.public.controller";
import {
  EMAIL_BLAST_UNSUBSCRIBE_SEGMENT,
  EMAIL_BLAST_UNSUBSCRIBE_TYPE,
  emailBlastMeta,
} from "../entities/email-blast.meta";
import { EmailBlastDeliveryService } from "../services/email-blast-delivery.service";
import { EmailBlastService } from "../services/email-blast.service";

const ADMIN_HANDLERS = [
  "findAll",
  "findById",
  "create",
  "patch",
  "delete",
  "findAudience",
  "sendTest",
  "send",
] as const satisfies ReadonlyArray<keyof EmailBlastController>;

const adminHandler = (name: (typeof ADMIN_HANDLERS)[number]): object =>
  EmailBlastController.prototype[name] as unknown as object;

describe("EmailBlastController", () => {
  describe("route metadata", () => {
    it("admin routes carry Roles(Administrator)", () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, EmailBlastController)).toEqual([JwtAuthGuard]);
      for (const name of ADMIN_HANDLERS) {
        expect(Reflect.getMetadata("roles", adminHandler(name))).toEqual([SystemRoles.Administrator]);
      }
    });

    it("the public controller has no guard", () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, EmailBlastPublicController)).toBeUndefined();
      expect(
        Reflect.getMetadata(GUARDS_METADATA, EmailBlastPublicController.prototype.unsubscribe as unknown as object),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(PATH_METADATA, EmailBlastPublicController.prototype.unsubscribe as unknown as object),
      ).toBe(`${emailBlastMeta.endpoint}/${EMAIL_BLAST_UNSUBSCRIBE_SEGMENT}/:token`);
    });
  });

  describe("HTTP", () => {
    let app: NestFastifyApplication;
    const deliveryService = { unsubscribe: vi.fn() };
    const blastService = { sendTest: vi.fn(), send: vi.fn(), findAudience: vi.fn() };
    const cacheService = { invalidateByType: vi.fn(), invalidateByElement: vi.fn() };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [EmailBlastController, EmailBlastPublicController],
        providers: [
          { provide: EmailBlastService, useValue: blastService },
          { provide: EmailBlastDeliveryService, useValue: deliveryService },
          { provide: CacheService, useValue: cacheService },
          { provide: AuditService, useValue: { logRead: vi.fn() } },
        ],
      })
        // Every admin route must refuse here: only the public route may answer.
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

    beforeEach(() => {
      deliveryService.unsubscribe.mockReset().mockResolvedValue(undefined);
      blastService.sendTest.mockReset();
      cacheService.invalidateByType.mockReset().mockResolvedValue(undefined);
    });

    it("the unsubscribe segment routes to the public controller", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/${emailBlastMeta.endpoint}/${EMAIL_BLAST_UNSUBSCRIBE_SEGMENT}/tok-1`,
        payload: { data: { type: EMAIL_BLAST_UNSUBSCRIBE_TYPE } },
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
      expect(deliveryService.unsubscribe).toHaveBeenCalledWith({ token: "tok-1", source: "link" });
      expect(cacheService.invalidateByType).toHaveBeenCalledWith(emailBlastMeta.endpoint);
    });

    it("a token named like an admin segment still reaches the public route", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/${emailBlastMeta.endpoint}/${EMAIL_BLAST_UNSUBSCRIBE_SEGMENT}/test`,
      });

      expect(response.statusCode).toBe(204);
      expect(deliveryService.unsubscribe).toHaveBeenCalledWith({ token: "test", source: "header" });
      expect(blastService.sendTest).not.toHaveBeenCalled();
    });

    it("an admin route without a session is refused", async () => {
      const response = await app.inject({ method: "POST", url: `/${emailBlastMeta.endpoint}/blast-1/test` });

      expect(response.statusCode).toBe(403);
      expect(blastService.sendTest).not.toHaveBeenCalled();
    });
  });
});
